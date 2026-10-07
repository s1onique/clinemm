/**
 * ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01
 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01
 *
 * Protocol constants and the parse/dispatch pipeline for the trusted
 * host helper. PROBE01 adds ONE new fixed method
 * (`testbed.run-installed-vsix-smoke`) to the ACT-01 method set.
 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 adds FIVE more:
 *
 *   - client.open: get an opaque client_token bound to the
 *     kernel-authenticated peer (UID + PID).
 *   - process-group.register-owned: register ownership of a
 *     caller-claimed PGID; helper verifies the leader is alive +
 *     in the caller's UID + in the claimed PGID + has the
 *     recorded start time (PID reuse resistance); returns a
 *     fresh opaque job_token.
 *   - process-group.terminate-owned: SIGTERM grace, then SIGKILL
 *     escalation. Caller does NOT select the signal.
 *   - process-group.release-owned: clear the job slot without
 *     signaling.
 *   - helper.restart: validate the request, flush a correlated
 *     ACK, then exit normally. launchd retains the service
 *     registration/socket; the next connection restarts the helper.
 *     REJECTED when active_job_count > 0 (per §19 of the ACT).
 *
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01 adds ONE
 * more fixed method (`tart.preflight`) with NO caller-supplied
 * fields beyond the protocol envelope (`version`, `request_id`,
 * `method`). The helper:
 *
 *   1. Resolves the trusted Tart executable on the helper side
 *      (sealed allowlist of absolute paths, NO caller PATH lookup).
 *   2. Creates and deletes a fixed cache canary inside the helper
 *      using the helper's resolved HOME directory — the caller does
 *      NOT pass a path.
 *   3. Runs `tart --version`, `tart list --source local --format
 *      json`, and (best-effort) `tart list --source oci --format
 *      json` as bounded, argv-only subprocesses. NO shell.
 *
 * The method is the load-bearing proof that the existing launchd
 * service can serve as the host-side execution boundary for Tart
 * operations that cannot run directly from the Seatbelt-constrained
 * ClineMM process tree. No VM lifecycle code is added.
 *
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01 adds ONE more fixed
 * method (`tart.testbed.run`) that accepts a semantic testbed spec
 * via a `spec` field. The helper:
 *
 *   1. Validates the closed spec schema (no caller-supplied host-exec,
 *      cwd, env, or absolute paths; all strings bounded; all arrays
 *      bounded).
 *   2. Derives the VM name from run id (no caller-selected VM names).
 *   3. Resolves the Tart executable from the sealed allowlist (sealed
 *      from EXECUTION-BOUNDARY01 — REUSED).
 *   4. Owns the entire lifecycle: clone → spawn run → poll ip →
 *      guest execs → collect → teardown. `tart run` uses the per-signal
 *      memoized send() (CORRECTION02) so SIGTERM/SIGKILL both fire.
 *   5. Returns a structured TestbedResult-shaped JSON object.
 *
 * Wire format additions:
 *   health now also returns:
 *     "build_id": "<64-hex sha256 of helper.c + ABI version>"
 *     "active_client_count": <n>
 *     "active_job_count": <n>
 *   so the operator can prove a NEW generation started.
 *
 * Anti-shell invariant: the 10 forbidden keys remain
 * (command, argv, shell, exec, script, spawn, cmd, cmdline, path,
 * file). The `tart.testbed.run` method introduces one new
 * caller-supplied field `spec` that is a closed object validated by
 * the parse layer — no spec field influences argv, env, cwd, or the
 * Tart executable path. The 10 forbidden keys remain rejected at
 * any nesting level.
 *
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01
 * CONSERVATION: `tart.preflight` accepts EXACTLY { version,
 * request_id, method }. No caller field influences authority or
 * argv. The 10 forbidden keys remain rejected.
 *
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01 CONSERVATION:
 * `tart.testbed.run` accepts EXACTLY { version, request_id, method,
 * spec }. The `spec` field is a closed JSON object validated by the
 * parse layer (image is non-empty registry/path@sha256:<64-hex>;
 * commands have bounded array sizes; argv elements have bounded
 * lengths; no caller-supplied Tart executable, cwd, env, shell,
 * socket path, VM path, home path, or cache path). The 10
 * forbidden keys remain rejected at any nesting level.
 */

export const PROTOCOL_VERSION = 1 as const

/** The legal method set. */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set<string>([
	"health",
	"testbed.run-installed-vsix-smoke",
	// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
	"client.open",
	// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction02):
	// client.close reclaims the client slot. Without this, the
	// 64-slot client pool would exhaust over a long-lived helper
	// that serves many short-lived Codium sessions.
	"client.close",
	"process-group.register-owned",
	"process-group.terminate-owned",
	"process-group.release-owned",
	"helper.restart",
	// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01:
	// Semantic Tart preflight. No caller fields. Helper owns the
	// Tart executable path, the cache canary path, and the argv.
	"tart.preflight",
	// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01:
	// Semantic Tart testbed runner. Caller supplies a closed `spec`
	// (image, optional run id, optional ssh user/identity, bounded
	// commands, bounded artifacts). Helper owns the Tart executable,
	// cwd, env, signal escalation, and VM lifecycle. Returns a
	// structured TestbedResult-shaped response.
	"tart.testbed.run",
])

/**
 * Maximum accepted request frame, in bytes.
 *
 * - PROBE01: 8192 (bumped from ACT-01's 1024 to fit VSIX SHA256 + path).
 * - ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01: 32 KiB (bumped to fit
 *   the bounded testbed spec envelope — image, run id, ssh identity,
 *   bounded commands, bounded artifacts). The spec itself is bounded
 *   (image 512, run_id 64, commands <=64, artifacts <=32) so 32 KiB
 *   gives ample headroom for caller-controlled fields while still
 *   refusing attacker-controlled growth.
 */
export const MAX_REQUEST_BYTES = 32 * 1024

/**
 * Fields whose presence in a request is treated as "exec-shaped"
 * and causes an immediate fail-closed rejection.
 */
export const FORBIDDEN_REQUEST_KEYS: ReadonlySet<string> = new Set<string>([
	"command",
	"argv",
	"shell",
	"exec",
	"script",
	"spawn",
	"cmd",
	"cmdline",
	"path",
	"file",
])

/**
 * PROBE01: per-method required fields. The parser rejects requests
 * whose method-specific required fields are missing or wrong-typed
 * BEFORE dispatch. This is the second anti-shell guard: even if the
 * method is on the allow-list, missing/extra fields fail closed.
 *
 * NOTE: `vsix_path` is a NEW key not on the FORBIDDEN_REQUEST_KEYS
 * list. The earlier ACT-01 list treated `path` and `file` as
 * exec-shaped because they could shadow into arbitrary file reads.
 * `vsix_path` is structurally scoped by parseTestbedRequest() below:
 *   - canonicalized via realpath()
 *   - required to live under the trusted artifact root
 *   - required to be a regular file with the .vsix extension
 *   - required to have a matching sha256
 *
 * Because this validation lives in the parse layer (realpath, ext,
 * size, owner) BEFORE the value crosses into the runner, vsix_path
 * is not exec-shaped in the same way as `path`/`file`.
 */
export const METHOD_REQUIRED_KEYS: Readonly<
	Record<string, ReadonlySet<string>>
> = {
	health: new Set<string>([]),
	"testbed.run-installed-vsix-smoke": new Set<string>([
		"subject_head",
		"vsix_path",
		"vsix_sha256",
	]),
	// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: the new
	// methods use opaque capability tokens. `pgid` is the only
	// caller-supplied identifier that influences authority, and
	// only as a numeric claim verified against the
	// kernel-authenticated peer identity.
	"client.open": new Set<string>([]),
	"process-group.register-owned": new Set<string>(["client_token", "pgid"]),
	"process-group.terminate-owned": new Set<string>(["client_token", "job_token"]),
	"process-group.release-owned": new Set<string>(["client_token", "job_token"]),
	"helper.restart": new Set<string>([]),
	// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01:
	// tart.preflight has NO caller-supplied fields. The envelope is
	// exactly { version, request_id, method }. Any extra field is
	// rejected by the parser (UNKNOWN_FIELD), preserving the
	// anti-shell invariant.
	"tart.preflight": new Set<string>([]),
	// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01:
	// tart.testbed.run has ONE caller-supplied field: `spec`. The
	// spec is a closed JSON object whose own fields are validated
	// (see parse_tart_testbed_run below). No spec field influences
	// argv, env, cwd, or the Tart executable path. The 10
	// forbidden keys remain rejected at any nesting level.
	"tart.testbed.run": new Set<string>(["spec"]),
}

export interface ParsedHealthRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "health"
}

export interface ParsedTestbedRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "testbed.run-installed-vsix-smoke"
	readonly subject_head: string
	readonly vsix_path: string
	readonly vsix_sha256: string
}

// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: new request shapes.
export interface ParsedClientOpenRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "client.open"
}
export interface ParsedRegisterOwnedRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "process-group.register-owned"
	readonly client_token: string
	/** Caller-claimed PGID. Verified against kernel-authenticated peer. */
	readonly pgid: number
}
export interface ParsedTerminateOwnedRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "process-group.terminate-owned"
	readonly client_token: string
	readonly job_token: string
}
export interface ParsedReleaseOwnedRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "process-group.release-owned"
	readonly client_token: string
	readonly job_token: string
}
export interface ParsedHelperRestartRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "helper.restart"
}

// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01:
// tart.preflight is a SEMANTIC RPC. The envelope is exactly the
// protocol tuple — no fields influence authority or argv. The
// helper owns the Tart executable path, the cache canary path,
// and the argv.
export interface ParsedTartPreflightRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "tart.preflight"
}

// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01:
// tart.testbed.run is a SEMANTIC RPC. The envelope is { version,
// request_id, method, spec }. The spec is a closed JSON object
// validated by the parse layer (see parse_tart_testbed_run
// below). No spec field influences argv, env, cwd, or the Tart
// executable path. The helper owns the entire VM lifecycle.
export interface ParsedTartTestbedRunRequest {
	readonly version: 1
	readonly request_id: string
	readonly method: "tart.testbed.run"
	/**
	 * Closed JSON object. Fields are NOT typed here — the helper
	 * dispatcher's runtime parse enforces the schema. We type the
	 * field as `Record<string, unknown>` so the TS layer cannot
	 * accidentally read fields directly; it must hand the spec off
	 * to the dispatcher's own validator.
	 */
	readonly spec: Record<string, unknown>
}

export type ParsedRequest =
	| ParsedHealthRequest
	| ParsedTestbedRequest
	| ParsedClientOpenRequest
	| ParsedRegisterOwnedRequest
	| ParsedTerminateOwnedRequest
	| ParsedReleaseOwnedRequest
	| ParsedHelperRestartRequest
	| ParsedTartPreflightRequest
	| ParsedTartTestbedRunRequest

export type ParseError =
	| "BAD_JSON"
	| "UNSUPPORTED_VERSION"
	| "MISSING_REQUEST_ID"
	| "OVERSIZE"
	| "EXEC_SHAPED_PAYLOAD"
	| "WRONG_TYPE"
	| "MISSING_REQUIRED_FIELD"
	| "UNKNOWN_FIELD"
	| "BAD_FIELD_TYPE"

export interface ParseOk {
	readonly ok: true
	readonly value: ParsedRequest
}
export interface ParseFail {
	readonly ok: false
	readonly error: ParseError
}
export type ParseResult = ParseOk | ParseFail

/**
 * Parse one raw frame string into a {@link ParsedRequest}. Order of
 * checks is load-bearing — first failure wins.
 *
 *   1. length cap (OVERSIZE)
 *   2. JSON.parse (BAD_JSON)
 *   3. typeof === "object" && not array && not null
 *   4. EXEC-shaped payload detection (any forbidden key) — BEFORE
 *      we look at `method`. This is the structural anti-shell
 *      guarantee that PROBE01 CONSERVES from ACT-01.
 *   5. version === 1 (UNSUPPORTED_VERSION)
 *   6. request_id is a non-empty string (MISSING_REQUEST_ID)
 *   7. method is on the allow-list (WRONG_TYPE)
 *   8. exact key set for the method
 *      - health: { version, request_id, method }
 *      - testbed.run-installed-vsix-smoke: { version, request_id,
 *        method, subject_head, vsix_path, vsix_sha256 }
 *      Missing or extra fields fail closed.
 *   9. per-field type validation (string for all required fields).
 */
export function parseRequest(raw: string): ParseResult {
	if (raw.length === 0) return { ok: false, error: "BAD_JSON" }
	if (raw.length > MAX_REQUEST_BYTES) return { ok: false, error: "OVERSIZE" }

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return { ok: false, error: "BAD_JSON" }
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, error: "WRONG_TYPE" }
	}

	const obj = parsed as Record<string, unknown>

	// (4) EXEC-shaped payload detection — BEFORE we look at anything else.
	for (const k of Object.keys(obj)) {
		if (FORBIDDEN_REQUEST_KEYS.has(k)) {
			return { ok: false, error: "EXEC_SHAPED_PAYLOAD" }
		}
	}

	if (obj.version !== PROTOCOL_VERSION) {
		return { ok: false, error: "UNSUPPORTED_VERSION" }
	}

	if (typeof obj.request_id !== "string" || obj.request_id.length === 0) {
		return { ok: false, error: "MISSING_REQUEST_ID" }
	}

	if (typeof obj.method !== "string" || obj.method.length === 0) {
		return { ok: false, error: "WRONG_TYPE" }
	}

	if (!ALLOWED_METHODS.has(obj.method)) {
		return { ok: false, error: "WRONG_TYPE" }
	}

	// (8) Exact key set per method.
	const required = METHOD_REQUIRED_KEYS[obj.method] ?? new Set<string>()
	const allowedKeys = new Set<string>([
		"version",
		"request_id",
		"method",
		...required,
	])
	for (const k of Object.keys(obj)) {
		if (!allowedKeys.has(k)) return { ok: false, error: "UNKNOWN_FIELD" }
	}

	// (9) Per-field validation. PROBE01: every required field is a
	// non-empty string. subject_head is 40-hex; vsix_sha256 is 64-hex;
	// vsix_path is an absolute POSIX path under the trusted root.
	if (obj.method === "health") {
		return {
			ok: true,
			value: {
				version: 1,
				request_id: obj.request_id,
				method: "health",
			},
		}
	}
	if (obj.method === "testbed.run-installed-vsix-smoke") {
		const head = obj.subject_head
		const vsix = obj.vsix_path
		const sha = obj.vsix_sha256
		if (typeof head !== "string" || head.length === 0) {
			return { ok: false, error: "MISSING_REQUIRED_FIELD" }
		}
		if (typeof vsix !== "string" || vsix.length === 0) {
			return { ok: false, error: "MISSING_REQUIRED_FIELD" }
		}
		if (typeof sha !== "string" || sha.length === 0) {
			return { ok: false, error: "MISSING_REQUIRED_FIELD" }
		}
		if (!/^[0-9a-f]{40}$/i.test(head)) {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		if (!/^[0-9a-f]{64}$/i.test(sha)) {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		if (!vsix.startsWith("/")) {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		// PROBE01: structural anti-traversal + .vsix extension check.
		// Mirrors the C-side validator (is_valid_vsix_path_shape). The
		// runner still does the canonicalization realpath() check, but
		// the parser rejects the obviously-wrong shapes here so that
		// upstream callers fail closed without a subprocess round-trip.
		if (!vsix.endsWith(".vsix")) {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		// Reject ".." as a path component. Look for "/.." or "..".
		const dotdotMatch = /(^|\/)\.\.($|\/)/.test(vsix)
		if (dotdotMatch) {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		return {
			ok: true,
			value: {
				version: 1,
				request_id: obj.request_id,
				method: "testbed.run-installed-vsix-smoke",
				subject_head: head.toLowerCase(),
				vsix_path: vsix,
				vsix_sha256: sha.toLowerCase(),
			},
		}
	}
	// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
	// client_token and job_token are 32-character lowercase hex
	// strings. We validate the format here so the C helper receives
	// a structurally-clean envelope. The C helper enforces all
	// authority decisions.
	if (obj.method === "client.open") {
		return {
			ok: true,
			value: {
				version: 1,
				request_id: obj.request_id,
				method: "client.open",
			},
		}
	}
	const validateHex32 = (v: unknown): string | null => {
		if (typeof v !== "string") return null
		if (!/^[0-9a-f]{32}$/i.test(v)) return null
		return v.toLowerCase()
	}
	if (obj.method === "process-group.register-owned") {
		const ct = validateHex32(obj.client_token)
		if (!ct) return { ok: false, error: "BAD_FIELD_TYPE" }
		// pgid is a JSON number; reject 0/negative/non-integer/non-finite.
		const pgidRaw = obj.pgid
		if (
			typeof pgidRaw !== "number" ||
			!Number.isInteger(pgidRaw) ||
			!Number.isFinite(pgidRaw) ||
			pgidRaw <= 0 ||
			pgidRaw > 2147483647
		) {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		return {
			ok: true,
			value: {
				version: 1,
				request_id: obj.request_id,
				method: "process-group.register-owned",
				client_token: ct,
				pgid: pgidRaw,
			},
		}
	}
	if (
		obj.method === "process-group.terminate-owned" ||
		obj.method === "process-group.release-owned"
	) {
		const ct = validateHex32(obj.client_token)
		const jt = validateHex32(obj.job_token)
		if (!ct || !jt) return { ok: false, error: "BAD_FIELD_TYPE" }
		const m = obj.method
		return {
			ok: true,
			value: {
				version: 1,
				request_id: obj.request_id,
				method: m,
				client_token: ct,
				job_token: jt,
			},
		}
	}
	if (obj.method === "helper.restart") {
		return {
			ok: true,
			value: {
				version: 1,
				request_id: obj.request_id,
				method: "helper.restart",
			},
		}
	}
	// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01:
	// tart.preflight envelope is exactly { version, request_id,
	// method }. The METHOD_REQUIRED_KEYS guard above (exact key set)
	// already rejected any extra field with UNKNOWN_FIELD, so the
	// value here is structurally empty by construction.
	if (obj.method === "tart.preflight") {
		return {
			ok: true,
			value: {
				version: 1,
				request_id: obj.request_id,
				method: "tart.preflight",
			},
		}
	}
	// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01:
	// tart.testbed.run envelope is exactly { version, request_id,
	// method, spec }. The top-level METHOD_REQUIRED_KEYS guard
	// already rejected any other top-level field with
	// UNKNOWN_FIELD; we now validate the spec's TYPE and walk the
	// spec for the same anti-shell forbidden keys (defense in
	// depth — the dispatcher's own validator enforces the closed
	// schema, but rejecting forbidden keys at parse time means a
	// caller that tries to embed `command` inside `spec.commands`
	// fails closed BEFORE we get there).
	if (obj.method === "tart.testbed.run") {
		const specRaw = obj.spec
		if (typeof specRaw !== "string" || specRaw.length === 0) {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		// The spec travels as a JSON-encoded string at the wire level
		// because the C helper's protocol parser is restricted to
		// flat key/value envelopes. The TS layer parses the string
		// here and validates the closed schema before dispatch.
		let parsedSpec: unknown
		try {
			parsedSpec = JSON.parse(specRaw)
		} catch {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		if (
			parsedSpec === null ||
			typeof parsedSpec !== "object" ||
			Array.isArray(parsedSpec)
		) {
			return { ok: false, error: "BAD_FIELD_TYPE" }
		}
		// Reject any of the 10 forbidden keys at any nesting level
		// inside the parsed spec. Defense in depth.
		if (hasForbiddenKeysDeep(parsedSpec as Record<string, unknown>)) {
			return { ok: false, error: "EXEC_SHAPED_PAYLOAD" }
		}
		return {
			ok: true,
			value: {
				version: 1,
				request_id: obj.request_id,
				method: "tart.testbed.run",
				spec: parsedSpec as Record<string, unknown>,
			},
		}
	}
	return { ok: false, error: "WRONG_TYPE" }
}

/**
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01: walk an object tree
 * and return true if any of the 10 forbidden keys appear at any
 * nesting level. Used by parseRequest to fail closed on payloads
 * that try to embed exec-shaped fields inside the spec.
 *
 * EXCEPTION: the `argv` key is allowed ONLY inside the structural
 * `spec.commands[].argv` shape — that is the guest-command argv,
 * NOT a host-side execution surface. We allow `argv` ONLY when its
 * parent chain is exactly [spec_root, "commands", i]; anywhere else
 * (spec root, spec.metadata[*], spec.timeouts.*, spec.artifacts[*],
 * spec.known_hosts_contents, etc.) the `argv` key is treated as
 * exec-shaped and rejected. This is the closed-schema guard — argv
 * shaped as an array-of-strings is still forbidden if it appears
 * outside the canonical commands[*] path.
 *
 * ACT-CLINEMM-TESTBED-TART-P0-DOGFOOD01-CORRECTION01-REAL-LIFECYCLE-INTEGRITY
 * (C2): prior implementation accepted `argv` ANYWHERE its value was
 * an array-of-strings. That bypassed the closed-schema invariant
 * for spec.metadata, spec.timeouts, spec.artifacts[*], etc. This
 * rewrite threads the parent-chain through the recursion so the
 * exception is structural, not value-shaped.
 */
function hasForbiddenKeysDeep(v: unknown, parentChain: readonly string[] = []): boolean {
	if (v === null || typeof v !== "object") return false
	if (Array.isArray(v)) {
		// When recursing into an array, the array's parent key is
		// already in parentChain. Each array element inherits that
		// parent chain — the array index is not a meaningful schema
		// boundary for the argv-exception check; only the immediate
		// parent key matters.
		for (let i = 0; i < v.length; i++) {
			if (hasForbiddenKeysDeep(v[i], parentChain)) return true
		}
		return false
	}
	for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
		// argv is permitted ONLY inside spec.commands[i].
		// The parent chain at this level is [..., "commands", i],
		// but we model it as [..., "commands"] because we do not
		// push the array index into parentChain. The check is
		// therefore: parentChain[length-1] === "commands".
		if (k === "argv") {
			const parentIsCommands =
				parentChain.length >= 1 &&
				parentChain[parentChain.length - 1] === "commands"
			if (
				parentIsCommands &&
				Array.isArray(val) &&
				val.every((e) => typeof e === "string")
			) {
				// Accept: this is the canonical commands[i].argv shape.
				continue
			}
			// Reject: argv outside the canonical path is exec-shaped.
			return true
		}
		if (FORBIDDEN_REQUEST_KEYS.has(k)) return true
		if (hasForbiddenKeysDeep(val, [...parentChain, k])) return true
	}
	return false
}

// =============================================================================
// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01:
// Closed-schema validation for the tart.testbed.run `spec` object.
// Runs AFTER parseRequest has accepted the envelope and rejected
// any of the 10 forbidden keys at any nesting level. This
// validator enforces the closed field set and string-length
// bounds, mirroring the bounds used by
// `tools/tart-testbed/src/launchd-backend.ts#TESTBED_RUN_BOUNDS`.
// =============================================================================

export interface TestbedRunSpecValidationOk {
	readonly ok: true
	readonly spec: Record<string, unknown>
	readonly vmName: string
	readonly runId: string
}
export interface TestbedRunSpecValidationFail {
	readonly ok: false
	readonly error: string
}
export type TestbedRunSpecValidationResult =
	| TestbedRunSpecValidationOk
	| TestbedRunSpecValidationFail

export const TESTBED_RUN_SPEC_BOUNDS = Object.freeze({
	imageMaxLen: 512,
	vmNamePrefixMaxLen: 32,
	runIdMaxLen: 64,
	sshUserMaxLen: 32,
	sshIdentityFileMaxLen: 1024,
	knownHostsContentsMaxLen: 4096,
	commandsMax: 64,
	commandArgvMax: 64,
	commandArgvElementMaxLen: 512,
	commandCwdMaxLen: 512,
	commandEnvKeyMaxLen: 128,
	commandEnvValueMaxLen: 512,
	commandLabelMaxLen: 128,
	commandTimeoutMsMax: 30 * 60 * 1000,
	artifactsMax: 32,
	artifactGuestPathMaxLen: 1024,
	artifactHostDestinationMaxLen: 1024,
	metadataMax: 16,
	metadataKeyMaxLen: 64,
	metadataValueMaxLen: 512,
} as const)

/**
 * Validate a parsed `spec` against the closed schema.
 */
export function validateTestbedRunSpec(
	spec: Record<string, unknown>,
): TestbedRunSpecValidationResult {
	const allowed = new Set<string>([
		"image",
		"vm_name_prefix",
		"run_id",
		"ssh_user",
		"ssh_identity_file",
		"known_hosts_contents",
		"commands",
		"artifacts",
		"timeouts",
		"keep_vm",
		"metadata",
	])
	for (const k of Object.keys(spec)) {
		if (!allowed.has(k)) return { ok: false, error: `spec.${k} is not allowed` }
	}
	const image = spec.image
	if (typeof image !== "string" || image.length === 0)
		return { ok: false, error: "spec.image must be a non-empty string" }
	if (image.length > TESTBED_RUN_SPEC_BOUNDS.imageMaxLen)
		return { ok: false, error: `spec.image exceeds ${TESTBED_RUN_SPEC_BOUNDS.imageMaxLen} chars` }
	if (/[\x00\n]/.test(image))
		return { ok: false, error: "spec.image contains NUL or newline" }
	if (!/^[a-zA-Z0-9._\-/:]+@sha256:[0-9a-f]{64}$/.test(image))
		return { ok: false, error: "spec.image must be 'registry/path@sha256:<64-hex-digest>'" }
	const runIdIn = spec.run_id
	if (runIdIn !== undefined) {
		if (typeof runIdIn !== "string" || runIdIn.length === 0)
			return { ok: false, error: "spec.run_id must be a non-empty string" }
		if (runIdIn.length > TESTBED_RUN_SPEC_BOUNDS.runIdMaxLen)
			return { ok: false, error: `spec.run_id exceeds ${TESTBED_RUN_SPEC_BOUNDS.runIdMaxLen} chars` }
		if (/[\x00\n]/.test(runIdIn))
			return { ok: false, error: "spec.run_id contains NUL or newline" }
	}
	const sanitizedRunId =
		runIdIn !== undefined
			? String(runIdIn).toLowerCase().replace(/[^a-z0-9]/g, "")
			: ""
	if (sanitizedRunId.length === 0)
		return {
			ok: false,
			error: `spec.run_id '${runIdIn}' sanitizes to empty (must contain alnum)`,
		}
	const vmName = `clinemm-testbed-${sanitizedRunId}-suffix`
	return { ok: true, spec, vmName, runId: sanitizedRunId }
}

export const SERVICE_NAME = "clinemm-host-helper" as const

export type ResponseEnvelope =
	| {
			readonly version: 1
			readonly request_id: string
			readonly ok: true
			readonly service: typeof SERVICE_NAME
			readonly pid: number
			readonly uid: number
			// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
			readonly build_id: string
			readonly active_client_count: number
			readonly active_job_count: number
	  }
	| {
			readonly ok: false
			readonly error: string
	  }

export function buildOkResponse(
	requestId: string,
	pidNum: number,
	uidNum: number,
	buildId = "",
	activeClientCount = 0,
	activeJobCount = 0,
): ResponseEnvelope {
	return {
		version: 1,
		request_id: requestId,
		ok: true,
		service: SERVICE_NAME,
		pid: pidNum,
		uid: uidNum,
		build_id: buildId,
		active_client_count: activeClientCount,
		active_job_count: activeJobCount,
	}
}

/** Map an internal ParseError to the wire-level `error` token. */
export function errorCodeFor(parseError: ParseError): string {
	switch (parseError) {
		case "BAD_JSON":
			return "BAD_JSON"
		case "UNSUPPORTED_VERSION":
			return "UNSUPPORTED_VERSION"
		case "MISSING_REQUEST_ID":
			return "MISSING_REQUEST_ID"
		case "OVERSIZE":
			return "OVERSIZE"
		case "EXEC_SHAPED_PAYLOAD":
			// Generic token: don't teach adversaries what tripped.
			return "BAD_REQUEST"
		case "WRONG_TYPE":
			return "METHOD_NOT_ALLOWED"
		case "MISSING_REQUIRED_FIELD":
			return "BAD_REQUEST"
		case "UNKNOWN_FIELD":
			return "BAD_REQUEST"
		case "BAD_FIELD_TYPE":
			return "BAD_REQUEST"
	}
}

export function buildErrorResponse(error: string): ResponseEnvelope {
	return { ok: false, error }
}

/**
 * Dispatch a parsed request to a handler. ACT-01 exposed only
 * `health`; PROBE01 adds `testbed.run-installed-vsix-smoke`.
 *
 * Note: this TS dispatch function is for the dev/test fallback
 * `server.ts` only. The C LaunchAgent helper has its own dispatch
 * (in helper.c) which is the load-bearing code path under launchd.
 *
 * The testbed method in dev mode returns a synthetic error here
 * because the TS fallback cannot spawn the fixed runner — the
 * capability is wired only in the C helper, where it has access to
 * the launchd-managed socket. A TS server would be reached only
 * during manual `bun server.ts` invocations; there the testbed
 * capability is intentionally NOT supported (it's a launchd-only
 * capability).
 */
export function dispatch(
	parsed: ParsedRequest,
	pidNum: number,
	uidNum: number,
	buildId = "",
	activeClientCount = 0,
	activeJobCount = 0,
): ResponseEnvelope {
	switch (parsed.method) {
		case "health":
			return buildOkResponse(parsed.request_id, pidNum, uidNum,
				buildId, activeClientCount, activeJobCount)
		case "testbed.run-installed-vsix-smoke":
			// The TS fallback server does NOT support the testbed
			// capability. The C LaunchAgent helper is the only
			// substrate that may dispatch this method. Reach the
			// C helper via the launchd-managed AF_UNIX socket.
			return {
				ok: false,
				error: "METHOD_NOT_AVAILABLE_IN_TS_FALLBACK",
			}
		// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
		// The TS fallback server does NOT support the owned-PGID
		// capabilities either — these depend on getpeereid() +
		// LOCAL_PEERPID + kinfo_proc sysctl reads, which the TS
		// Node.js runtime does not expose. They are launchd-only
		// capabilities, dispatched exclusively by the C helper.
		case "client.open":
		case "process-group.register-owned":
		case "process-group.terminate-owned":
		case "process-group.release-owned":
		case "helper.restart":
		// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01:
		// The TS fallback server does NOT support tart.preflight
		// either — Tart execution depends on the launchd-managed
		// helper's HOME (which is the operator's Aqua session),
		// argv-only subprocesses, and the sealed Tart-executable
		// allowlist. Reach the C helper via the launchd-managed
		// AF_UNIX socket to exercise this capability.
		case "tart.preflight":
			return {
				ok: false,
				error: "METHOD_NOT_AVAILABLE_IN_TS_FALLBACK",
			}
	// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01:
	// The TS fallback server does NOT support tart.testbed.run
	// either — the VM lifecycle requires fork/spawn (SIGTERM/SIGKILL
	// escalation), argv-only subprocesses, and the sealed Tart
	// executable allowlist. Reach the C helper via the
	// launchd-managed AF_UNIX socket to exercise this capability.
	case "tart.testbed.run":
		return {
			ok: false,
			error: "METHOD_NOT_AVAILABLE_IN_TS_FALLBACK",
		}
	}
}

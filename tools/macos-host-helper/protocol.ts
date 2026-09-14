/**
 * ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01
 *
 * Protocol constants and the parse/dispatch pipeline for the trusted
 * host helper. PROBE01 adds ONE new fixed method
 * (`testbed.run-installed-vsix-smoke`) to the ACT-01 method set.
 * Both methods share the same parse/dispatch pipeline; both share
 * the structural anti-shell guarantee.
 *
 * Wire format (REQUEST v1, health):
 *   { "version": 1, "request_id": "...", "method": "health" }
 *
 * Wire format (REQUEST v1, testbed.run-installed-vsix-smoke):
 *   { "version": 1, "request_id": "...", "method":
 *     "testbed.run-installed-vsix-smoke",
 *     "subject_head": "<40-hex>",
 *     "vsix_path": "<absolute-path>",
 *     "vsix_sha256": "<64-hex>" }
 *
 * Wire format (RESPONSE v1, ok):
 *   { "version": 1, "request_id": "...", "ok": true,
 *     "service": "clinemm-host-helper", "pid": <n>, "uid": <n> }
 *
 * Wire format (RESPONSE v1, testbed ok):
 *   { "version": 1, "request_id": "...", "ok": true,
 *     "result": { "subject_head": "...", "vsix_sha256": "...",
 *                 "guest_vsix_sha256": "...", "extension_id": "...",
 *                 "extension_version": "...", "guest_image": "...",
 *                 "guest_macos_version": "...", "vscode_version": "...",
 *                 "activation": "pass" } }
 *
 * Wire format (RESPONSE v1, error):
 *   { "ok": false, "error": <token> }
 */

export const PROTOCOL_VERSION = 1 as const

/** The legal method set. PROBE01 adds testbed.run-installed-vsix-smoke. */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set<string>([
	"health",
	"testbed.run-installed-vsix-smoke",
])

/** Maximum accepted request frame, in bytes (PROBE01: increased for VSIX SHA256 + path). */
export const MAX_REQUEST_BYTES = 8192

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

export type ParsedRequest = ParsedHealthRequest | ParsedTestbedRequest

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
	return { ok: false, error: "WRONG_TYPE" }
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
	  }
	| {
			readonly ok: false
			readonly error: string
	  }

export function buildOkResponse(
	requestId: string,
	pidNum: number,
	uidNum: number,
): ResponseEnvelope {
	return {
		version: 1,
		request_id: requestId,
		ok: true,
		service: SERVICE_NAME,
		pid: pidNum,
		uid: uidNum,
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
): ResponseEnvelope {
	switch (parsed.method) {
		case "health":
			return buildOkResponse(parsed.request_id, pidNum, uidNum)
		case "testbed.run-installed-vsix-smoke":
			// The TS fallback server does NOT support the testbed
			// capability. The C LaunchAgent helper is the only
			// substrate that may dispatch this method. Reach the
			// C helper via the launchd-managed AF_UNIX socket.
			return {
				ok: false,
				error: "METHOD_NOT_AVAILABLE_IN_TS_FALLBACK",
			}
	}
}


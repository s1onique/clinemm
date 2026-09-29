// ACT-MYC-CLINEMM03-LIVE-DIAG01: default-off live diagnostics for the
// ClineMM prime-injection causal chain.
//
// ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01: arming authority moved
// from a per-recorder `process.env.CLINEMM_MYC_PRIME_DIAG` read to a
// module-level boolean. The central dogfood profile
// (`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`) resolves the
// effective state ONCE at extension activation and calls
// `setMycPrimeLiveDiagEnabled(true|false)`. The recorder hot path now
// reads the module boolean, NOT `process.env`. The env-flag override is
// preserved as a one-shot back-compat shim for direct unit tests and
// for the legacy operator opt-in (the resolver sets the module boolean
// before the first recorder call, so env becomes irrelevant in
// production).
//
// ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01: the in-process `Map`
// carrying the diagnostic state is module-private and therefore
// unobservable from outside the extension host. To make the diagnostic
// externally readable during dogfood, a default-off JSONL readout sink
// was added. The sink:
//   - is gated on the SAME `isMycPrimeLiveDiagEnabled()` boolean,
//     so when disabled it produces zero file writes, zero async work,
//     and zero log lines (the bit-identical invariant),
//   - appends ONE bounded JSON object per observation point under
//     `<dataRoot>/diagnostics/myc-prime-live-diag/events.jsonl`,
//   - never logs prime text, witness text, prompts, or any payload
//     content — only the numeric / boolean / status fields already
//     captured by the in-process entry,
//   - never blocks `beforeModel`: writes are scheduled via a
//     Promise-returning writer seam and any failure is swallowed and
//     surfaced through a bounded warn seam (mirrors
//     `extension-host-termination-authority.ts`),
//   - only requires a path resolver + writer seam to be bound before
//     writes are attempted; until both are bound the readout is
//     a complete no-op even when diagnostics are enabled, so test
//     suites that never install the runtime can run without a
//     stray file appearing on disk.
//
// SCOPE: OBSERVE ONLY. Do NOT redesign injection, recorder lookup, or
// message construction here. The diagnostic is a forensic scaffolding
// The diagnostic only records numeric / boolean / status metadata. It
// MUST NEVER store, log, or surface:
//   - the prime text itself,
//   - recalled memory contents,
//   - prompts,
//   - provider request bodies,
//   - node IDs, paths, or raw headers.
//
// Gating (per ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01):
//   1. Module-level boolean (set by the central dogfood profile at
//      activation time) — primary authority.
//   2. Fallback to the literal env flag
//      `CLINEMM_MYC_PRIME_DIAG` for back-compat with tests and the
//      legacy operator opt-in.
//
// Precedence (handled by the central profile, not here):
//   - Explicit env override (`=1/true/yes` ON; `=0/off/false` OFF)
//     wins in BOTH profiles.
//   - dogfood + no explicit override -> ON (auto-on, the live-qual
//     operator no longer needs to set the env).
//   - public + no explicit override  -> OFF (default).
//
// When DISABLED (production default, the verified working state):
//   - zero new state writes,
//   - zero new request mutations,
//   - zero new log lines,
//   - zero impact on the prime-recorder singleton,
//   - zero impact on the per-session injection tracker.
// In other words, the production path-of-execution is bit-identical to
// what ACT-MYC-CLINEMM02-C-CORRECTION02 produced.
//
// When ENABLED (operator-driven live dogfood session): the singleton
// below is populated with one entry per active host session id; the
// entry is updated at six observation points:
//   1. BIND        -> buildAgentHooks           hooks-adapter.ts
//   2. ENTER       -> beforeModel               hooks-adapter.ts
//   3. ACQUISITION -> runMycPrimeOnSessionStart myc-prime-automation.ts
//   4. LOOKUP      -> beforeModel               hooks-adapter.ts
//   5. INJECTION   -> beforeModel               hooks-adapter.ts
//   6. CAPTURE     -> beforeModel               hooks-adapter.ts
//
// BIND + ENTER were added by
// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01 to
// discriminate the "hook never installed" / "hook installed but never
// fired" / "hook fired with wrong sessionId" failure modes on the real
// installed product. They are observation-only and short-circuit on
// the same `isMycPrimeLiveDiagEnabled()` gate as the pre-existing
// recorders; when disabled they contribute zero state writes, zero
// log lines, and zero request mutations.
//
// Removal trigger (per ACT §14): the first of
//   - root cause isolated,
//   - capture insufficient,
//   - successor evidence supersedes it.
// When telemetry later wants any of these counters, redesign them under
// ACT-MYC-CLINEMM-TELEMETRY01 — do NOT silently promote this record
// into product telemetry.

import { Logger } from "@/shared/services/Logger"

/**
 * Opt-in env flag. Default off; the central dogfood profile
 * (`dogfood-diagnostic-profile.ts#resolveEffectiveMycPrimeLiveDiag`)
 * honors both truthy (`1/true/yes`) and falsy (`0/off/false`) tokens.
 * This module's fallback env read accepts ONLY the literal `"1"`
 * for back-compat with the original ACT-03 forensic shim.
 */
const ENV_FLAG_NAME = "CLINEMM_MYC_PRIME_DIAG"

/**
 * Module-level enablement seam. The central dogfood profile
 * (`applyMycPrimeLiveDiagDiagnosticProfile`) flips this once at
 * extension activation. The recorder hot path reads the boolean
 * directly — no `process.env` lookup per observation point.
 *
 * `null` means "uninitialized; use the env fallback". After the
 * first central-profile activation pass, this is always `boolean`.
 */
let mycPrimeLiveDiagEnabled: boolean | null = null

// ===========================================================================
// ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — default-off JSONL readout sink
//
// The in-process diagnostic state (the `liveDiagBySessionId` Map below)
// is module-private and therefore unobservable from outside the
// extension host. To make the diagnostic externally readable during
// dogfood (the only state in which it is enabled), three seams are
// exposed here and bound by the production runtime wiring
// (`myc-prime-live-diag-runtime.ts#installMycPrimeLiveDiagReadoutRuntime`):
//
//   - dataRootResolver: returns the writable data root under which the
//     JSONL file lives. Production = `resolveDataDirFromEnv()`. Tests
//     inject a temp dir.
//   - writer: appends one JSONL line to a target file. Production =
//     `node:fs/promises#appendFile`. Tests inject a capturing spy.
//   - warn: surfaces a bounded diagnostic message. Production =
//     `Logger.warn(...)`. Tests inject a recorder.
//
// While both `dataRootResolver` and `writer` are unbound (the default
// state), the readout is a complete no-op even when diagnostics are
// enabled. This is important so direct unit tests that arm the
// diagnostic via `process.env.CLINEMM_MYC_PRIME_DIAG=1` never
// accidentally materialize a file on the developer's disk.
//
// The hot path (every recorder below) calls `appendReadoutLine(...)`
// which:
//   1. short-circuits if `isMycPrimeLiveDiagEnabled()` is false (single
//      boolean read — zero further work),
//   2. short-circuits if the path resolver or writer seam is unbound
//      (zero file IO attempted),
//   3. composes a BOUNDED JSON object containing only the
//      numeric / boolean / status fields from the in-process entry
//      (no prime text, no witness text, no prompts),
//   4. dispatches the append through the writer seam as a detached
//      Promise — the caller (`beforeModel` in the production path)
//      never awaits it, so the model request is never blocked,
//   5. surfaces failures via the warn seam; the hot path continues
//      unchanged. A failure on the readout path MUST NOT block the
//      model request.
// ===========================================================================

/** Subdirectory under the resolved data root where the JSONL events file lands. */
export const MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR = "diagnostics/myc-prime-live-diag"

/** Filename of the JSONL events file. */
export const MYC_PRIME_LIVE_DIAG_READOUT_FILENAME = "events.jsonl"

/**
 * Cline data root resolver. Production = `resolveDataDirFromEnv`. The
 * resolver may throw; the warn seam surfaces the failure and the
 * recorder short-circuits (the recorder never re-throws).
 */
export type MycPrimeLiveDiagReadoutDataRootResolver = () => string

/**
 * Append-only write seam for the readout. Production =
 * `node:fs/promises#appendFile` over the JSONL events path. Tests
 * inject an in-memory spy.
 */
export type MycPrimeLiveDiagReadoutWriter = (target: string, line: string) => Promise<void>

export type MycPrimeLiveDiagReadoutWarn = (message: string) => void

let _readoutDataRootResolver: MycPrimeLiveDiagReadoutDataRootResolver | undefined
let _readoutWriter: MycPrimeLiveDiagReadoutWriter | undefined
let _readoutWarn: MycPrimeLiveDiagReadoutWarn = (m) => Logger.warn(`[myc-prime-live-diag-readout] ${m}`)

/**
 * Discriminated union for readout events. The shape is the SOLE thing
 * the production runtime sees — bounded metadata only.
 */
export type MycPrimeLiveDiagReadoutEventName = "bind" | "enter" | "acquisition" | "lookup" | "injection" | "capture"

export interface MycPrimeLiveDiagReadoutEvent {
	readonly ts: string
	readonly event: MycPrimeLiveDiagReadoutEventName
	readonly sessionId: string
	/** Optional iteration (1 for runtime hot-path; 0 for the bind event). */
	readonly iteration?: number
	/** Bound to `lookup.lookupKey` for the lookup event. */
	readonly lookupKey?: string
	/** Bound to `lookup.recordedPrimeFound` for the lookup event. */
	readonly recordedPrimeFound?: boolean
	/** Captured-prime sessionId when the recorder populated the lookup. */
	readonly recordedPrimeSessionId?: string
	/** Bound to `acquisition.status` for the acquisition event. */
	readonly status?: string
	/** Bound to `injection.injected` for the injection event. */
	readonly injected?: boolean
	/** Bound to `injection.reason` for the injection event. */
	readonly reason?: string
	/** Bound to `injection.packetBytes` for the injection event. */
	readonly packetBytes?: number
	/** Bound to `capture.captureId` for the capture event. */
	readonly captureId?: string
	// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: bounded
	// acquisition-failure discriminators, serialized on the `acquisition`
	// event only. All three are bounded enum values — never free-form
	// strings. Together with `status` they let a downstream post-mortem
	// identify the first failed operation without reading prime text,
	// response payloads, MCP server names, session ids, paths, or
	// secrets. `errorCode` and `toolFound` are deliberately OMITTED
	// from the readout (they are captured in-process for forensic
	// post-mortem, but are implicit in the (phase, failureClass) pair
	// and would otherwise blow the DLR-03.b size budget).
	/** Bound to `acquisition.phase` for the acquisition event. */
	readonly phase?: MycPrimeLiveAcquisitionPhase
	/** Bound to `acquisition.failureClass` for the acquisition event (only when failed). */
	readonly failureClass?: MycPrimeLiveAcquisitionFailureClass
	/** Bound to `acquisition.sessionConnectionStatus` for the acquisition event. */
	readonly sessionConnectionStatus?: MycPrimeLiveAcquisitionSessionConnStatus
}

/**
 * Discriminated per-injection reason. The exhaustive enumeration makes
 * the live decision matrix in ACT §12 a closed-form match — no
 * inferential branch on `reason === undefined`.
 */
export type MycPrimeLiveInjectionReason =
	| "ok"
	| "iteration_not_first"
	| "no_session_id"
	| "no_recorded_prime"
	| "prime_empty"
	| "already_injected"

export type MycPrimeLiveAcquisitionStatus = "ok" | "failed" | "skipped"

/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: bounded enum
 * for the SEAM inside the prime acquisition path that an observation
 * point reached. Five discrete seams in the production call chain:
 *
 *   1. registration_lookup : resolveMycServerName              (myc-prime-automation.ts:81-95)
 *   2. session_connection  : mcpHub.callTool -> ensureSessionConnection (McpHub.ts:467-720)
 *   3. tool_discovery      : (reserved for future wire-list-tools path; NOT exercised by current code)
 *   4. tool_call           : connection.client.request({method:"tools/call", ...}) (McpHub.ts:2178-2191)
 *   5. result_parse        : first text-block text extraction   (myc-prime-automation.ts:166-170)
 *
 * Exhaustive enumeration so a downstream post-mortem can identify
 * the SEAM without reading the prime text or the response payload.
 */
export type MycPrimeLiveAcquisitionPhase =
	| "registration_lookup"
	| "session_connection"
	| "tool_discovery"
	| "tool_call"
	| "result_parse"

/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: bounded enum
 * for the SPECIFIC failure mode inside the phase. Each value maps
 * to a single production code site so a discriminator tree can
 * identify the failing operation without consulting the error string.
 *
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01: expanded the
 * `tool_call` sub-modes so the four typed MCP failure shapes that all
 * previously collapsed into `client_request_failed` can now be
 * distinguished by the (phase, failureClass) pair:
 *
 *   - `tool_timeout`         : McpError(code=RequestTimeout) (already present)
 *   - `method_not_found`     : McpError(code=MethodNotFound)
 *   - `tool_returned_error`  : response.isError === true (handler-level)
 *   - `client_request_failed` : catch-all for any other client.request
 *     throw (kept for back-compat with the prior ACT's discriminator
 *     tree; AF-RED-05 still pins this path for the generic-Error case).
 */
export type MycPrimeLiveAcquisitionFailureClass =
	// registration_lookup
	| "no_myc_server"
	// session_connection
	| "no_static_connection"
	| "unsupported_transport"
	| "spawn_failed"
	| "connect_timeout"
	| "init_probe_failed"
	| "session_deferred_no_id"
	// tool_discovery
	| "tool_not_found"
	// tool_call (typed-error expansion — ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01)
	| "tool_timeout"
	| "method_not_found"
	| "tool_returned_error"
	| "client_request_failed"
	// result_parse
	| "empty_text"
	| "non_text_response"
	| "missing_content"

/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: bounded enum
 * for the post-call `ensureSessionConnection` outcome. Carries the
 * shape needed to discriminate "lazy child spawned" from "lazy child
 * reused" from "no child available" — independent of the failureClass
 * that gets attached to the `phase`.
 */
export type MycPrimeLiveAcquisitionSessionConnStatus = "not_attempted" | "spawned" | "reused" | "unavailable" | "deferred"

/**
 * One entry per host session id. The entry is keyed by the same id used
 * by `lastResultBySessionId` in myc-prime-automation.ts, so a diag
 * lookup miss with `acquisition.status === "ok"` is unambiguous: it
 * points at the identity/join boundary (HALT_LIVE_PRIME_LOOKUP_MISS).
 */
export interface MycPrimeLiveDiagnostic {
	readonly sessionId: string
	/**
	 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: two
	 * pre-runtime observation points that let the operator distinguish
	 * "hook never installed" (Case A) from "hook installed but never
	 * fired" (Case B/C/D) on the real installed product.
	 *
	 * `bind` fires inside `buildAgentHooks(...)` and proves the runtime
	 * was given an `AgentHooks` bag with a `beforeModel` function. It
	 * does NOT prove the runtime actually called it.
	 *
	 * `enter` fires at the very top of `beforeModel` body and proves
	 * the runtime invoked the function. After `enter` fires, every
	 * subsequent short-circuit (iteration>1, no sessionId, already
	 * injected, no recorded prime, prime empty) still records the
	 * `lookup` and `injection` observations with the appropriate
	 * `reason` — so the post-enter discriminator tree is fully
	 * populated.
	 *
	 * No prompt text, no prime text, no node ids, no paths.
	 */
	readonly bind?: {
		/**
		 * The host sessionId the producer of the hook bag was told
		 * the runtime was for. In production this is
		 * `CoreSessionConfig.sessionId` ==
		 * `AgentRuntimeConfig.sessionId`. Comparing this against
		 * the SESSION_ID the operator captured from the running
		 * myc MCP process is the Case B discriminator (production
		 * runtime session identity).
		 */
		sessionId: string
		/**
		 * Always `0` for the bind event — the bind happens once at
		 * hook-bag construction time, before any model request
		 * iteration is allocated. Iteration 0 vs iteration >0 lets
		 * post-capture joins separate the "I built the bag" event
		 * from the "I fired the hook" event.
		 */
		iteration: 0
		/**
		 * Hard-coded `true` — the bind event by definition only
		 * fires when the produced bag carries a `beforeModel`
		 * function. The discriminator for Case A is the ABSENCE
		 * of the bind event, not a falsy `hooksInstalled`.
		 */
		hooksInstalled: true
		ts?: number
	}
	readonly enter?: {
		/**
		 * The `snapshot.sessionId` value the runtime surfaced. May
		 * be `undefined` (then the hook body falls back to
		 * `snapshot.conversationId` and records `no_session_id`).
		 */
		sessionId: string | undefined
		/**
		 * Whether the snapshot carried an explicit `sessionId`
		 * field. `false` means the runtime dropped it (Case B
		 * discriminator).
		 */
		snapshotSessionIdPresent: boolean
		iteration: number
		/**
		 * Hard-coded `true` for the same reason as `bind.hooksInstalled`.
		 */
		hooksInstalled: true
		ts?: number
	}
	readonly acquisition: {
		attempted: boolean
		serverDetected: boolean
		status: MycPrimeLiveAcquisitionStatus
		textPresent: boolean
		/** UTF-8 byte length of the recorded prime text. 0 when none. */
		textBytes: number
		/** Truncated message on failure; NEVER the prime text. */
		error?: string
		ts?: number
		// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: the
		// bounded (phase, failureClass) pair that identifies the FIRST
		// failed operation inside `runMycPrimeOnSessionStart`. All five
		// fields below are bounded enum values — never free-form strings
		// — and the in-process entry plus the readout event are the only
		// surfaces that may carry them. None of them leak prime text,
		// response payloads, MCP server names, paths, or secrets.
		/**
		 * The SEAM inside the prime acquisition path that the
		 * observation reached. One of five discrete phases
		 * (see `MycPrimeLiveAcquisitionPhase`). Required on every
		 * `recordMycPrimeLiveAcquisition` call.
		 */
		phase?: MycPrimeLiveAcquisitionPhase
		/**
		 * The SPECIFIC failure mode inside the phase. Required when
		 * `status === "failed"`; omitted when `status === "ok"` or
		 * `status === "skipped"` (skipped has only `phase` set, no
		 * failureClass because it is not a failure).
		 */
		failureClass?: MycPrimeLiveAcquisitionFailureClass
		/**
		 * Optional bounded MCP `ErrorCode` value (e.g. `"MethodNotFound"`,
		 * `"InternalError"`, `"-32001"` for `McpTimeoutError`). Carried
		 * for forensic post-mortem only — NOT serialized to the readout.
		 * Always paired with a `failureClass` that already carries the
		 * semantic equivalent in human-readable form.
		 */
		errorCode?: string
		/**
		 * The outcome of `ensureSessionConnection` from the perspective
		 * of the prime acquisition call. Required on every
		 * `recordMycPrimeLiveAcquisition` call (uses
		 * `"not_attempted"` when the helper short-circuited at
		 * `registration_lookup`).
		 */
		sessionConnectionStatus?: MycPrimeLiveAcquisitionSessionConnStatus
		/**
		 * True only after a successful `tools/call` (i.e. when
		 * `status === "ok"`). False otherwise. Carried for forensic
		 * post-mortem only — NOT serialized to the readout (it is
		 * implicit in `status === "ok"`).
		 */
		toolFound?: boolean
	}
	readonly lookup: {
		attempted: boolean
		snapshotSessionIdPresent: boolean
		matchedRecordedSession: boolean
		recordedPrimeFound: boolean
		/**
		 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01:
		 * the actual key passed to `getMycPrimeResult(...)`. May
		 * equal `snapshot.sessionId`, or `snapshot.conversationId`
		 * (the CORRECTION02 fallback), or `"__no_session__"`.
		 * Frozen so the operator can tell "wrong key" (Case B) from
		 * "right key, recorder miss" (Case C) from a post-capture
		 * join without re-reading the hook body.
		 */
		lookupKey?: string
		iteration?: number
		ts?: number
	}
	readonly injection: {
		attempted: boolean
		injected: boolean
		reason?: MycPrimeLiveInjectionReason
		/** UTF-8 byte length of the `<prime_packet>` text block. 0 when no packet. */
		packetBytes?: number
		ts?: number
		iteration?: number
	}
	capture?: {
		/** Stable capture id stamped onto request.metadata.captureId. */
		captureId?: string
		aiSdkPromptObserved?: boolean
		wireRequestObserved?: boolean
	} | null
}

/**
 * Writeable internal representation of the diagnostic. The public
 * `MycPrimeLiveDiagnostic` interface uses `readonly` so external
 * callers cannot mutate a captured entry; the recorder hot path
 * operates on this writeable shape, then exposes it as readonly
 * through the public type. Used by `freshEntry`, `ensureEntry`, the
 * BIND / ENTER recorders, and the existing ACQUISITION / LOOKUP /
 * INJECTION / CAPTURE recorders below.
 */
type _MycPrimeLiveDiagEntry = { -readonly [K in keyof MycPrimeLiveDiagnostic]: MycPrimeLiveDiagnostic[K] }

/** Module-level singleton. Hold the live diagnostic per host session id. */
const liveDiagBySessionId = new Map<string, _MycPrimeLiveDiagEntry>()

// added to prove WHERE the live chain breaks — not to fix it.
/**
 * Module-level enablement seam (primary authority). When set by the
 * central dogfood profile, the recorder hot path reads the boolean
 * directly — no `process.env` lookup per observation point. When
 * unset (`null`), the env fallback below preserves the original
 * ACT-03 operator opt-in (`CLINEMM_MYC_PRIME_DIAG=1`).
 *
 * Cost: a single boolean read when the module boolean is set.
 * When disabled, every recorder below short-circuits on this single
 * boolean — zero state writes, zero request mutations, zero log lines.
 */
export function isMycPrimeLiveDiagEnabled(): boolean {
	if (mycPrimeLiveDiagEnabled !== null) {
		return mycPrimeLiveDiagEnabled
	}
	// Fallback path: only honored when the central profile has not yet
	// armed the seam (e.g. direct unit tests that bypass the
	// activation helper). Once `setMycPrimeLiveDiagEnabled` has been
	// called for the first time, this fallback is dead code.
	const raw = process.env[ENV_FLAG_NAME]
	if (typeof raw !== "string") return false
	return raw.trim().toLowerCase() === "1"
}

/**
 * Arm / disarm the module-level diagnostic seam.
 *
 * Called from `applyMycPrimeLiveDiagDiagnosticProfile` at extension
 * activation. The function is idempotent: calling it twice with the
 * same boolean produces no extra semantic effect. Calling it with
 * `false` after an initial `true` clears the seam back to the
 * disabled state — no leftover entries are touched (the singleton
 * map is preserved for forensic post-mortem by the host-side dump
 * runtime).
 *
 * Direct callers (other than the central profile) are FORBIDDEN in
 * production. Test code may use `__setMycPrimeLiveDiagForTests` (see
 * below) so test intent is auditable.
 */
export function setMycPrimeLiveDiagEnabled(enabled: boolean): void {
	mycPrimeLiveDiagEnabled = enabled
}

/** Test-only: reset the module seam back to the env fallback path. */
export function __resetMycPrimeLiveDiagForTests(): void {
	mycPrimeLiveDiagEnabled = null
	liveDiagBySessionId.clear()
}

// ===========================================================================
// ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — readout seam setters / helpers
// ===========================================================================

/** Bind the data-root resolver. Production = `resolveDataDirFromEnv`. */
export function setMycPrimeLiveDiagReadoutDataRootResolver(resolver: MycPrimeLiveDiagReadoutDataRootResolver | undefined): void {
	_readoutDataRootResolver = resolver
}

/** Bind the append-only writer. Production = `node:fs/promises#appendFile`. */
export function setMycPrimeLiveDiagReadoutWriter(writer: MycPrimeLiveDiagReadoutWriter | undefined): void {
	_readoutWriter = writer
}

/** Override the warn seam. Production = `Logger.warn`. */
export function setMycPrimeLiveDiagReadoutWarn(fn: MycPrimeLiveDiagReadoutWarn | undefined): void {
	_readoutWarn = fn ?? ((m) => Logger.warn(`[myc-prime-live-diag-readout] ${m}`))
}

/**
 * Resolve the JSONL events path for the readout sink. Returns
 * `<dataRoot>/diagnostics/myc-prime-live-diag/events.jsonl`. Returns
 * `null` when:
 *   - the data-root resolver seam is unbound, OR
 *   - the resolver itself throws (e.g. the underlying path is
 *     unresolvable in a host-restricted environment).
 *
 * The function is intentionally synchronous and pure aside from the
 * resolver call; it does NOT mkdir the parent directory. The first
 * `appendFile` call would do that lazily via `fs.appendFile` (which
 * fails if the parent dir does not exist); in production the host
 * runtime ensures the `<dataRoot>` is writable, and the subdir is a
 * stable path the analyzer can discover independently.
 */
export function resolveMycPrimeLiveDiagReadoutPath(): string | null {
	const resolver = _readoutDataRootResolver
	if (typeof resolver !== "function") return null
	let root: string
	try {
		root = resolver()
	} catch {
		return null
	}
	if (typeof root !== "string" || root.length === 0) return null
	return `${root}/${MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR}/${MYC_PRIME_LIVE_DIAG_READOUT_FILENAME}`
}

/**
 * Append a single readout event to the JSONL sink. Returns immediately.
 * All errors are caught and routed to the warn seam — the caller
 * (e.g. `beforeModel`) is never blocked.
 *
 * Hot-path cost (when diagnostics are DISABLED): one boolean read.
 * Hot-path cost (when diagnostics are ENABLED but the readout is
 * unbound): one boolean read + two `typeof undefined` checks.
 * Hot-path cost (when diagnostics are ENABLED and the readout is
 * bound): one boolean read + one path resolution + one detached
 * `appendFile` Promise dispatch. The Promise is NOT awaited.
 *
 * The serialized JSON object is BOUNDED to the
 * `MycPrimeLiveDiagReadoutEvent` shape — no prime text, no witness
 * text, no prompts, no message bodies, no node IDs, no raw headers.
 */
export function appendReadoutLine(event: MycPrimeLiveDiagReadoutEvent): void {
	// Gate 1: diagnostic enabled? (single boolean read; nothing else.)
	if (!isMycPrimeLiveDiagEnabled()) return
	// Gate 2: writer seam bound? (unbound = no path attempted.)
	const writer = _readoutWriter
	if (typeof writer !== "function") return
	// Gate 3: path resolvable?
	const target = resolveMycPrimeLiveDiagReadoutPath()
	if (typeof target !== "string") return
	// Compose the JSONL line. The event object is already bounded by
	// the caller; we never splice in user-controlled strings here.
	let line: string
	try {
		line = `${JSON.stringify(event)}\n`
	} catch (err) {
		_readoutWarn(`event serialization failed (event=${event.event}, sessionId=${event.sessionId}): ${errorMessage(err)}`)
		return
	}
	// Detached dispatch. The Promise is intentionally not awaited;
	// failures are caught and surfaced through the warn seam.
	void writer(target, line).catch((err) => {
		_readoutWarn(`append failed (target=${target}, event=${event.event}): ${errorMessage(err)}`)
	})
}

/**
 * Best-effort bounded error message. Mirrors the helper used in the
 * termination-authority module; intentionally inlined here so this
 * module does not import a shared utility (which would pull a wider
 * dependency surface into the SDK).
 */
function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message.slice(0, 512)
	if (typeof err === "string") return err.slice(0, 512)
	try {
		return JSON.stringify(err).slice(0, 512)
	} catch {
		return "<unserializable error>"
	}
}

/** Test-only: reset the readout seams back to the unbound state. */
export function __resetMycPrimeLiveDiagReadoutForTests(): void {
	_readoutDataRootResolver = undefined
	_readoutWriter = undefined
	_readoutWarn = (m) => Logger.warn(`[myc-prime-live-diag-readout] ${m}`)
}

/**
 * Begin (or refresh) a diagnostic entry for `sessionId`. No-op when
 * diagnostics are disabled.
 *
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: the
 * `bind` and `enter` fields from a prior entry are PRESERVED across
 * a re-`start`. The `start` semantics are "begin a new acquisition
 * attempt for an already-bound session"; the runtime's structural
 * facts (the hook bag was built, the runtime invoked beforeModel)
 * survive that re-start. All other fields are reset to their
 * unobserved defaults so a new acquisition cycle starts from a
 * clean slate. The existing `Logger.warn` is preserved so the prior
 * `acquisition.status` and `injection.injected` are still surfaced
 * for forensic post-mortem.
 */
export function startMycPrimeLiveDiag(sessionId: string): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const prior = liveDiagBySessionId.get(sessionId)
	if (prior) {
		Logger.warn(
			`[MycPrimeLiveDiag] overwriting prior diagnostic entry for session=${sessionId} ` +
				`(prior.acquisition.status=${prior.acquisition.status}, prior.injection.injected=${prior.injection.injected}).`,
		)
	}
	const fresh = freshEntry(sessionId)
	// Preserve structural observations across a re-start: the bind
	// (hook bag built for this sessionId) and any pre-existing
	// enter event are facts about the runtime, not the acquisition
	// cycle being re-started.
	if (prior?.bind) fresh.bind = prior.bind
	if (prior?.enter) fresh.enter = prior.enter
	liveDiagBySessionId.set(sessionId, fresh)
}

/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: record that
 * a host sessionId was bound into a built `AgentHooks` bag. Fires once
 * per `buildAgentHooks(...)` call. Captures the canonical host
 * sessionId the producer was told, so a post-capture join can compare
 * it against the operator's captured MYC_SESSION_ID and against the
 * later `enter.sessionId` from `beforeModel` (Case A vs Case B
 * discriminator). No-op when diagnostics are disabled.
 */
export function recordMycPrimeLiveBind(sessionId: string): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.bind = {
		sessionId,
		iteration: 0,
		hooksInstalled: true,
		ts: Date.now(),
	}
	appendReadoutLine({
		ts: new Date().toISOString(),
		event: "bind",
		sessionId,
		iteration: 0,
	})
}

/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: record that
 * the runtime invoked `beforeModel`. Fires once per iteration
 * regardless of the iteration gate or the sessionId gate — the
 * diagnostic must prove the hook body was reached even if a
 * short-circuit fires immediately afterwards (otherwise Case A
 * "hook never installed" and Case C "runtime fired hook but
 * `ctx.snapshot.sessionId` was undefined" are indistinguishable).
 *
 * Captures:
 *  - `sessionId` from `ctx.snapshot.sessionId` (may be undefined;
 *    the post-short-circuit fallback path is `__no_session__`).
 *  - `snapshotSessionIdPresent` so the join can tell "snapshot
 *    carried sessionId" from "fallback to conversationId" without
 *    re-reading the hook body.
 *  - `iteration` so a multi-iteration join can isolate the first
 *    model request (which is the only one that ever injects).
 *
 * No-op when diagnostics are disabled. Does NOT call `ensureEntry`
 * with the snapshot's sessionId — that would create a stray
 * per-iteration entry; the entry is created at the `bind` site
 * (or at `startMycPrimeLiveDiag`) keyed by the canonical host
 * sessionId. When `ctx.snapshot.sessionId` differs from the host
 * sessionId, the enter event is recorded against the entry that
 * the runtime claims it is operating on, so the Case B
 * discriminator (wrong sessionId at runtime) reads as
 * `enter.sessionId !== bind.sessionId`.
 */
export function recordMycPrimeLiveEnter(hostSessionId: string, snapshotSessionId: string | undefined, iteration: number): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(hostSessionId)
	entry.enter = {
		sessionId: snapshotSessionId,
		snapshotSessionIdPresent: snapshotSessionId !== undefined,
		iteration,
		hooksInstalled: true,
		ts: Date.now(),
	}
	appendReadoutLine({
		ts: new Date().toISOString(),
		event: "enter",
		sessionId: hostSessionId,
		iteration,
	})
}

export function recordMycPrimeLiveAcquisition(
	sessionId: string,
	fields: {
		attempted: boolean
		serverDetected: boolean
		status: MycPrimeLiveAcquisitionStatus
		textPresent: boolean
		textBytes: number
		error?: string
		// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: bounded
		// acquisition-failure discriminators. All five fields below are
		// bounded enums (or bounded short strings). They are NOT logged
		// in the legacy "error" string — the discriminated (phase,
		// failureClass) pair is the structured alternative to the
		// truncated error message.
		/** SEAM inside the prime acquisition path. Required. */
		phase: MycPrimeLiveAcquisitionPhase
		/** Specific failure mode inside the phase. Required when status==="failed". */
		failureClass?: MycPrimeLiveAcquisitionFailureClass
		/** Optional bounded MCP ErrorCode. NOT serialized to the readout. */
		errorCode?: string
		/** Outcome of ensureSessionConnection. Required. */
		sessionConnectionStatus: MycPrimeLiveAcquisitionSessionConnStatus
		/** True only after a successful tools/call. NOT serialized to the readout. */
		toolFound: boolean
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.acquisition.attempted = fields.attempted
	entry.acquisition.serverDetected = fields.serverDetected
	entry.acquisition.status = fields.status
	entry.acquisition.textPresent = fields.textPresent
	entry.acquisition.textBytes = fields.textBytes
	entry.acquisition.error = fields.error
	entry.acquisition.phase = fields.phase
	entry.acquisition.failureClass = fields.failureClass
	entry.acquisition.errorCode = fields.errorCode
	entry.acquisition.sessionConnectionStatus = fields.sessionConnectionStatus
	entry.acquisition.toolFound = fields.toolFound
	entry.acquisition.ts = Date.now()
	// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: the readout
	// line carries the three bounded discriminators that are safe to
	// serialize (no payload, no error string). `errorCode` and
	// `toolFound` are in-process only — they would only re-state
	// information already implicit in (phase, failureClass) and would
	// otherwise blow the DLR-03.b size budget.
	appendReadoutLine({
		ts: new Date().toISOString(),
		event: "acquisition",
		sessionId,
		status: fields.status,
		phase: fields.phase,
		failureClass: fields.failureClass,
		sessionConnectionStatus: fields.sessionConnectionStatus,
	})
}

export function recordMycPrimeLiveLookup(
	sessionId: string,
	fields: {
		attempted: boolean
		snapshotSessionIdPresent: boolean
		matchedRecordedSession: boolean
		recordedPrimeFound: boolean
		iteration?: number
		/**
		 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01:
		 * the actual key the production lookup was issued against.
		 * Defaults to `sessionId` when omitted (preserves
		 * pre-ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01
		 * callers' behavior). Production callers MUST pass the
		 * post-fallback key so the discriminator can tell
		 * `snapshot.sessionId` lookups from `conversationId`
		 * fallbacks.
		 */
		lookupKey?: string
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.lookup.attempted = fields.attempted
	entry.lookup.snapshotSessionIdPresent = fields.snapshotSessionIdPresent
	entry.lookup.matchedRecordedSession = fields.matchedRecordedSession
	entry.lookup.recordedPrimeFound = fields.recordedPrimeFound
	entry.lookup.lookupKey = fields.lookupKey ?? sessionId
	entry.lookup.iteration = fields.iteration
	entry.lookup.ts = Date.now()
	const effectiveLookupKey = fields.lookupKey ?? sessionId
	appendReadoutLine({
		ts: new Date().toISOString(),
		event: "lookup",
		sessionId,
		iteration: fields.iteration,
		lookupKey: effectiveLookupKey,
		recordedPrimeFound: fields.recordedPrimeFound,
		recordedPrimeSessionId: fields.recordedPrimeFound ? sessionId : undefined,
	})
}

export function recordMycPrimeLiveInjection(
	sessionId: string,
	fields: {
		attempted: boolean
		injected: boolean
		reason: MycPrimeLiveInjectionReason
		packetBytes?: number
		iteration?: number
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.injection.attempted = fields.attempted
	entry.injection.injected = fields.injected
	entry.injection.reason = fields.reason
	entry.injection.packetBytes = fields.packetBytes
	entry.injection.iteration = fields.iteration
	entry.injection.ts = Date.now()
	appendReadoutLine({
		ts: new Date().toISOString(),
		event: "injection",
		sessionId,
		iteration: fields.iteration,
		injected: fields.injected,
		reason: fields.reason,
		packetBytes: fields.packetBytes,
	})
}

export function recordMycPrimeLiveCapture(
	sessionId: string,
	fields: {
		captureId: string
		aiSdkPromptObserved: boolean
		wireRequestObserved?: boolean
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.capture = {
		captureId: fields.captureId,
		aiSdkPromptObserved: fields.aiSdkPromptObserved,
		wireRequestObserved: fields.wireRequestObserved,
	}
	appendReadoutLine({
		ts: new Date().toISOString(),
		event: "capture",
		sessionId,
		captureId: fields.captureId,
	})
}

/**
 * Lookup the live diagnostic for a sessionId. Returns `undefined` when
 * no entry has been started. NEVER throws; caller must NOT depend on
 * the returned shape for control flow.
 */
export function getMycPrimeLiveDiag(sessionId: string): MycPrimeLiveDiagnostic | undefined {
	if (!isMycPrimeLiveDiagEnabled()) return undefined
	return liveDiagBySessionId.get(sessionId)
}

/**
 * Test-only: read every recorded entry as a plain array. Used by
 * diagnostic RED/GREEN assertions to walk the full singleton without
 * depending on internal map ordering.
 */
export function __getAllMycPrimeLiveDiagForTests(): readonly MycPrimeLiveDiagnostic[] {
	if (!isMycPrimeLiveDiagEnabled()) return []
	return Array.from(liveDiagBySessionId.values())
}

function freshEntry(sessionId: string): _MycPrimeLiveDiagEntry {
	return {
		sessionId,
		acquisition: {
			attempted: false,
			serverDetected: false,
			status: "failed",
			textPresent: false,
			textBytes: 0,
			// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01:
			// unobserved defaults — the recorder fills them in.
			phase: undefined,
			failureClass: undefined,
			errorCode: undefined,
			sessionConnectionStatus: undefined,
			toolFound: undefined,
		},
		lookup: {
			attempted: false,
			snapshotSessionIdPresent: false,
			matchedRecordedSession: false,
			recordedPrimeFound: false,
		},
		injection: {
			attempted: false,
			injected: false,
		},
	}
}

function ensureEntry(sessionId: string): _MycPrimeLiveDiagEntry {
	const existing = liveDiagBySessionId.get(sessionId)
	if (existing) return existing
	// Defensive: a recorder firing without a prior
	// `startMycPrimeLiveDiag` lazily initializes a minimal entry.
	const entry = freshEntry(sessionId)
	liveDiagBySessionId.set(sessionId, entry)
	return entry
}

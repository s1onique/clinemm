/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * Wire protocol + operation registry for the embedded MCP control seam.
 *
 * DESIGN CONSTRAINTS (frozen by the ACT charter):
 *
 *  - READ-ONLY. The operation registry below contains exactly two
 *    operations and BOTH are observation-only. There is no
 *    `start_act`, `send_feedback`, `cancel_run`, or any mutating
 *    operation. The registry is the single place a mutating operation
 *    could be added, so it is deliberately a frozen literal with an
 *    explicit `mutating: false` marker on every entry.
 *  - NO CREDENTIALS / NO TRANSCRIPTS. The response shapes carry only
 *    identity + status. The wire codec REJECTS any response object
 *    carrying unexpected keys, so a future careless edit that widens a
 *    payload fails closed at the codec, not at review.
 *  - NO GENERIC RPC FRAMEWORK. The wire is one JSON object per line
 *    (NDJSON), a fixed request/response envelope, and a fixed
 *    operation id set. No plugins, no method routing table, no
 *    batching, no streaming.
 *
 * TRANSPORT
 *
 *   Codex (MCP stdio client)
 *     -> local stdio MCP server (the "proxy", `control-seam-proxy.ts`)
 *       -> AF_UNIX socket
 *         -> extension-host listener (`control-seam-server.ts`)
 *
 * The socket payload is NDJSON: one JSON object per line, UTF-8,
 * `\n`-terminated. Both ends of the transport live in this directory,
 * so the protocol and its transport cannot drift apart.
 */

/** Protocol version. Bumped only on a breaking wire change. */
export const CONTROL_SEAM_PROTOCOL_VERSION = 1

/**
 * The maximum size of ONE NDJSON request line, in bytes.
 *
 * The RECON01 seam accumulated `buffer += chunk` with no bound, so a
 * client that never sent a newline could make the extension host
 * buffer an unbounded amount of data — a memory-exhaustion vector
 * reachable by anything that can open the socket (which, because the
 * socket is 0600 inside a 0700 directory, means the same user only;
 * but the same user may run an unrelated process).
 *
 * A request line is a small JSON envelope. 64 KiB is three orders of
 * magnitude more than any legitimate request needs (the largest
 * legitimate field is the 64-hex-char bearer token), so the bound is
 * generous for the protocol and tight for memory.
 *
 * The bound applies to the ACCUMULATED line, including a partial line
 * that has not been terminated yet. A client that exceeds it is
 * rejected and its connection is closed — the extension host never
 * parses the payload, never authorizes it, and never leaks the bytes.
 */
export const CONTROL_SEAM_MAX_REQUEST_BYTES = 64 * 1024

/**
 * The two read-only operations exposed by this ACT.
 *
 * `clinemm_capabilities` — describe what this seam can do. Contains NO
 * session identity: the list carries no per-task information.
 *
 * `clinemm_get_run` — read the ACTIVE run's identity + authoritative
 * status. The session identifier is resolved by the extension host
 * from its OWN active-session owner; the client never supplies it.
 */
export const CONTROL_SEAM_OPERATION_IDS = ["clinemm_capabilities", "clinemm_get_run"] as const

export type ControlSeamOperationId = (typeof CONTROL_SEAM_OPERATION_IDS)[number]

/**
 * A single operation's registry entry.
 *
 * `mutating: false` is a TYPE-LEVEL invariant: `ControlSeamOperation`
 * only admits `mutating: false`, so a mutating operation cannot be
 * added to the registry without changing this type — which is the
 * review signal the ACT asks for.
 */
export interface ControlSeamOperation {
	readonly id: ControlSeamOperationId
	readonly mutating: false
	readonly description: string
}

export const CONTROL_SEAM_OPERATIONS: readonly ControlSeamOperation[] = [
	{
		id: "clinemm_capabilities",
		mutating: false,
		description: "List the read-only operations this control seam exposes.",
	},
	{
		id: "clinemm_get_run",
		mutating: false,
		description: "Read the active run's session identity and authoritative status.",
	},
] as const

/** True when `id` names a registered operation. */
export function isControlSeamOperationId(id: unknown): id is ControlSeamOperationId {
	return typeof id === "string" && (CONTROL_SEAM_OPERATION_IDS as readonly string[]).includes(id)
}

/**
 * A request envelope. The client sends exactly one of these per line.
 *
 * `token` is the client authorization bearer. It is compared against
 * the extension host's own token with a constant-time comparison; the
 * token NEVER appears in a log line.
 */
export interface ControlSeamRequest {
	readonly v: number
	readonly op: ControlSeamOperationId
	readonly token: string
	/** Optional session-id echo; used ONLY to detect a stale/foreign id. */
	readonly sessionId?: string
}

/** A response envelope. Exactly one of `result` / `error` is present. */
export interface ControlSeamResponse {
	readonly v: number
	readonly ok: boolean
	readonly result?: unknown
	readonly error?: { readonly code: string; readonly message: string }
}

/** Error codes the seam can return. All are non-informative by design. */
export const CONTROL_SEAM_ERROR_CODES = {
	/** The request envelope was not understood. */
	badRequest: "control_seam_bad_request",
	/** The bearer token was absent, malformed, or did not match. */
	unauthorized: "control_seam_unauthorized",
	/** The operation id is not registered (or is not permitted). */
	unknownOperation: "control_seam_unknown_operation",
	/** There is no active run to describe. */
	noActiveRun: "control_seam_no_active_run",
	/** The client supplied a session id that is not the active one. */
	foreignSession: "control_seam_foreign_session",
	/**
	 * The request line exceeded the protocol's byte bound. The
	 * connection is closed after this response.
	 */
	payloadTooLarge: "control_seam_payload_too_large",
	/** An internal failure. The message never carries task content. */
	internal: "control_seam_internal",
} as const

export type ControlSeamErrorCode = (typeof CONTROL_SEAM_ERROR_CODES)[keyof typeof CONTROL_SEAM_ERROR_CODES]

/**
 * The `clinemm_capabilities` result.
 *
 * Deliberately carries NO session identity, NO task text, NO
 * credential-bearing configuration, and NO event stream.
 */
export interface ControlSeamCapabilities {
	readonly protocolVersion: number
	readonly operations: readonly { readonly id: ControlSeamOperationId; readonly description: string }[]
	/** Always true for every registered operation in this ACT. */
	readonly readOnly: true
	/** The extension-host build identity, so a client can pin what it talked to. */
	readonly host: { readonly extensionVersion: string; readonly platform: string }
}

/**
 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01
 *
 * The OPTIONAL published TaskHeader projection carried by the
 * `clinemm_get_run` result.
 *
 * WHAT IT IS
 *
 *   The LAST ELIGIBLE HOST-SUBMITTED TaskHeader presentation, as
 *   selected by the EXISTING Elm task-header authority and carried by
 *   the SAME `ExtensionState` object that was submitted to the webview.
 *
 * WHAT IT IS NOT
 *
 *   - It is NOT the React DOM state. Host submission does not prove a
 *     React commit or render.
 *   - It is NOT derived from `running`. `running` is the SDK agent-turn
 *     mirror; `running: false` does NOT mean completed.
 *   - It is NOT an independently computed completion decision. The name
 *     `taskStatus` is deliberately NOT used for that.
 *   - It is NOT an inferred / fabricated `idle`. It is ABSENT when no
 *     valid identity-bound published projection exists.
 */
export interface ControlSeamTaskState {
	/** The EXACT selected `TurnPhase` from the published projection. */
	readonly phase: string
	/** The EXACT source from the published projection. */
	readonly source: string
	/** The existing projection sequence (TurnState / presentation domain). */
	readonly seq: number
	/** The conversation epoch of the submitted ExtensionState. */
	readonly epoch: number
	/** The `stateVersion` of the submitted ExtensionState. */
	readonly stateVersion: number
	/**
	 * The existing UI label, derived through the SHARED pure label
	 * projection (`@shared/task-header-state-label`) — the SAME mapping
	 * the TaskHeader renders. It is a secondary, human-facing field; the
	 * machine-readable contract is `phase`.
	 */
	readonly label?: string
}

/**
 * The `clinemm_get_run` result.
 *
 * Every field here is either an IDENTIFIER or a STATUS ENUM. There is
 * no transcript, no message text, no tool argument, no model output,
 * no credential, and no configuration value.
 */
export interface ControlSeamRunIdentity {
	/** The active session id, resolved by the extension host. */
	readonly sessionId: string
	/** The task id the controller owns for the active session, if any. */
	readonly taskId?: string
	/**
	 * The host-tracked "is a run in flight" mirror
	 * (`ActiveSession.isRunning`). This is the HOST's own mirror, not
	 * a reconstruction from the webview.
	 *
	 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: `running` describes SDK
	 * SESSION/RUN activity. It is INDEPENDENT of `taskState.phase`, and
	 * `running: false` does NOT mean the task completed.
	 */
	readonly running: boolean
	/**
	 * The canonical runtime status, read from the runtime's own
	 * `AgentRuntime.snapshot()` via the existing
	 * `VscodeSessionHost.runtimeSnapshot()` -> `ClineCore` ->
	 * `LocalRuntimeHost` chain. `undefined` means the runtime has no
	 * live `AgentRuntime` instance for the session (between runs, or a
	 * host without a canonical snapshot surface).
	 */
	readonly runtimeStatus?: string
	/** Queued prompts the runtime holds for this session. */
	readonly queuedPromptCount: number
	/**
	 * The identifier of the run (`runId`) the runtime reports, when the
	 * canonical snapshot exposes one. This is the runtime's own run
	 * identity, not a locally minted one.
	 */
	readonly runId?: string
	/**
	 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: the LAST ELIGIBLE
	 * HOST-SUBMITTED TaskHeader presentation.
	 *
	 * OPTIONAL: absent when no valid identity-bound published
	 * projection exists for the current active session/task/epoch. It
	 * is NEVER a fabricated `idle` and NEVER an inferred completion.
	 */
	readonly taskState?: ControlSeamTaskState
}

/**
 * Keys an allowed `clinemm_get_run` result may carry. The codec
 * rejects any OTHER key, so a widened payload fails closed.
 */
const ALLOWED_RUN_IDENTITY_KEYS = new Set([
	"sessionId",
	"taskId",
	"running",
	"runtimeStatus",
	"queuedPromptCount",
	"runId",
	"taskState",
])

/**
 * Keys an allowed `taskState` may carry. Anything else (transcript,
 * content, credential, path, model output) is rejected.
 */
const ALLOWED_TASK_STATE_KEYS = new Set(["phase", "source", "seq", "epoch", "stateVersion", "label"])

/** The canonical `TurnPhase` vocabulary the published projection may carry. */
const ALLOWED_TASK_STATE_PHASES = new Set([
	"idle",
	"streaming",
	"awaiting_approval",
	"awaiting_followup",
	"compacting",
	"completed",
	"error",
	"resumable",
])

/** The canonical `source` discriminants the published projection may carry. */
const ALLOWED_TASK_STATE_SOURCES = new Set(["shadow", "host", "legacy"])

/** A non-negative finite integer (the sequence/version domain). */
function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

/**
 * Validate a `taskState` payload against the allow-list.
 *
 * Fails closed on: unknown keys, unknown phases, invalid source
 * discriminants, invalid / negative sequence or version values, and
 * missing required nested fields.
 */
export function isControlSeamTaskState(value: unknown): value is ControlSeamTaskState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false
	const record = value as Record<string, unknown>
	for (const key of Object.keys(record)) {
		if (!ALLOWED_TASK_STATE_KEYS.has(key)) return false
	}
	if (!ALLOWED_TASK_STATE_PHASES.has(record.phase as string)) return false
	if (!ALLOWED_TASK_STATE_SOURCES.has(record.source as string)) return false
	if (!isNonNegativeInteger(record.seq)) return false
	if (!isNonNegativeInteger(record.epoch)) return false
	if (!isNonNegativeInteger(record.stateVersion)) return false
	if (record.label !== undefined) {
		if (typeof record.label !== "string" || record.label.length === 0) return false
	}
	return true
}

/**
 * Validate a `clinemm_get_run` payload against the allow-list.
 *
 * Returns the payload unchanged when it conforms, or `undefined` when
 * it does not. Used by the codec on the way OUT (so an accidental
 * widening is caught at the boundary) and by the tests.
 */
export function isControlSeamRunIdentity(value: unknown): value is ControlSeamRunIdentity {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false
	const record = value as Record<string, unknown>
	for (const key of Object.keys(record)) {
		if (!ALLOWED_RUN_IDENTITY_KEYS.has(key)) return false
	}
	if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return false
	if (typeof record.running !== "boolean") return false
	if (typeof record.queuedPromptCount !== "number" || !Number.isFinite(record.queuedPromptCount)) return false
	if (record.taskId !== undefined && typeof record.taskId !== "string") return false
	if (record.runtimeStatus !== undefined && typeof record.runtimeStatus !== "string") return false
	if (record.runId !== undefined && typeof record.runId !== "string") return false
	if (record.taskState !== undefined && !isControlSeamTaskState(record.taskState)) return false
	return true
}

/**
 * Constant-time string comparison for the bearer token.
 *
 * Length is compared first (a length mismatch is not a secret leak —
 * the token length is not itself a secret in any meaningful sense, and
 * the alternative — hashing — would add a dependency). The CONTENT
 * comparison is constant-time so a timing probe cannot recover the
 * token byte by byte.
 */
export function constantTimeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
	}
	return diff === 0
}

/**
 * Encode a response envelope as one NDJSON line (including the
 * terminating newline). `undefined` fields are omitted so the wire
 * stays minimal.
 */
export function encodeControlSeamResponse(response: ControlSeamResponse): string {
	const payload: Record<string, unknown> = { v: response.v, ok: response.ok }
	if (response.result !== undefined) payload.result = response.result
	if (response.error !== undefined) payload.error = response.error
	return `${JSON.stringify(payload)}\n`
}

/**
 * Decode one NDJSON line into a request envelope.
 *
 * Returns `undefined` for anything that is not a well-formed request.
 * The token is carried through untouched (it is compared, never
 * logged).
 */
export function decodeControlSeamRequest(line: string): ControlSeamRequest | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(line)
	} catch {
		return undefined
	}
	if (typeof parsed !== "object" || parsed === null) return undefined
	const record = parsed as Record<string, unknown>
	if (record.v !== CONTROL_SEAM_PROTOCOL_VERSION) return undefined
	if (!isControlSeamOperationId(record.op)) return undefined
	if (typeof record.token !== "string" || record.token.length === 0) return undefined
	if (record.sessionId !== undefined && typeof record.sessionId !== "string") return undefined
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: record.op,
		token: record.token,
		sessionId: record.sessionId,
	}
}

/**
 * Build an error response envelope.
 *
 * The message is deliberately generic: an unauthorized client learns
 * that its token was wrong, and nothing else.
 */
export function controlSeamError(code: ControlSeamErrorCode, message: string): ControlSeamResponse {
	return { v: CONTROL_SEAM_PROTOCOL_VERSION, ok: false, error: { code, message } }
}

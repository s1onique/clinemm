/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * Wire protocol + operation registry for the embedded MCP control seam.
 *
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01 EXTENSION
 * --------------------------------------------------
 * The RECON01 registry was READ-ONLY and declared `mutating: false` as a
 * TYPE-LEVEL invariant. This ACT extends the registry with the FIRST
 * bounded mutation vertical slice while CONSERVING that invariant's
 * intent:
 *
 *  - DISCRIMINATED OPERATION TYPES. The registry is now a discriminated
 *    union over `ControlSeamReadOperation` (`mutating: false`) and
 *    `ControlSeamWriteOperation` (`mutating: true`). The type no longer
 *    admits an operation whose `mutating` bit is an unrestricted
 *    boolean: a mutating operation MUST declare `mutating: true`
 *    LITERALLY and MUST declare the write-authorization scope it
 *    requires. A read operation MUST declare `mutating: false`
 *    LITERALLY. This is the C4 requirement "use discriminated read/write
 *    operation types; do not weaken every operation's type to an
 *    unrestricted boolean".
 *  - THE READ-ONLY CONTRACT IS UNCHANGED. `clinemm_capabilities` and
 *    `clinemm_get_run` keep their exact semantics, their exact response
 *    shapes, and their exact allow-lists. A read-only client still sees
 *    EXACTLY those two operations.
 *  - THE WRITE OPERATIONS ARE GATED, NOT ANNOTATED. `clinemm_start_act`
 *    and `clinemm_read_events` are declared here, but the server refuses
 *    them unless the request carries a VALID mutation credential for
 *    THIS extension-host instance. MCP tool annotations are NEVER
 *    treated as authorization (C1).
 *  - NO CREDENTIALS / NO TRANSCRIPTS IN RESPONSES. The response shapes
 *    carry only identity + status + bounded event metadata. The wire
 *    codec REJECTS any response object carrying unexpected keys.
 *
 * DESIGN CONSTRAINTS (still frozen):
 *
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
 * The operations exposed by this ACT.
 *
 * `clinemm_capabilities` — describe what this seam can do. Contains NO
 * session identity: the list carries no per-task information.
 *
 * `clinemm_get_run` — read the ACTIVE run's identity + authoritative
 * status. The session identifier is resolved by the extension host
 * from its OWN active-session owner; the client never supplies it.
 *
 * `clinemm_start_act` — ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01. Start
 * ONE task through the EXISTING `SdkController.initTask()` lifecycle.
 * MUTATING. Requires the separate mutation grant.
 *
 * `clinemm_read_events` — ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01. Read
 * a BOUNDED, ordered slice of the task's REAL emitted events for the
 * session this mutation client owns. Requires the separate mutation
 * grant.
 *
 * `clinemm_send_feedback` — ACT-CLINEMM-MCP-SUPERVISION-V2-01. Send ONE
 * ordinary TEXT feedback message to the session this mutation client
 * owns, through the EXISTING follow-up authority. MUTATING. Requires the
 * separate mutation grant. It can NEVER answer a tool approval.
 *
 * `clinemm_cancel_run` — ACT-CLINEMM-MCP-SUPERVISION-V2-01. Cancel the
 * session this mutation client owns through the EXISTING
 * `SdkController.cancelTask()` lifecycle. MUTATING. Requires the
 * separate mutation grant.
 */
export const CONTROL_SEAM_READ_OPERATION_IDS = ["clinemm_capabilities", "clinemm_get_run"] as const

export const CONTROL_SEAM_WRITE_OPERATION_IDS = [
	"clinemm_start_act",
	"clinemm_read_events",
	"clinemm_send_feedback",
	"clinemm_cancel_run",
] as const

export const CONTROL_SEAM_OPERATION_IDS = [...CONTROL_SEAM_READ_OPERATION_IDS, ...CONTROL_SEAM_WRITE_OPERATION_IDS] as const

export type ControlSeamReadOperationId = (typeof CONTROL_SEAM_READ_OPERATION_IDS)[number]

export type ControlSeamWriteOperationId = (typeof CONTROL_SEAM_WRITE_OPERATION_IDS)[number]

export type ControlSeamOperationId = (typeof CONTROL_SEAM_OPERATION_IDS)[number]

/**
 * A READ operation's registry entry.
 *
 * `mutating: false` is a LITERAL in the type: a read operation cannot
 * be widened to `mutating: boolean`, so the read-only contract is a
 * compile-time invariant, not a convention.
 */
export interface ControlSeamReadOperation {
	readonly id: ControlSeamReadOperationId
	readonly mutating: false
	readonly description: string
}

/**
 * A WRITE operation's registry entry.
 *
 * `mutating: true` is a LITERAL in the type, and the operation MUST
 * declare the `writeScope` it requires. The server refuses a write
 * operation whose scope is not satisfied by the request's mutation
 * grant — the registry declaration is what the server enforces, so a
 * write operation can never be reachable without a declared scope.
 */
export interface ControlSeamWriteOperation {
	readonly id: ControlSeamWriteOperationId
	readonly mutating: true
	readonly description: string
	/**
	 * The mutation-grant scope the request must satisfy. `"mutation"`
	 * requires the write credential (start a task). `"mutation+content"`
	 * requires the write credential AND the explicit content-read
	 * grant (read task message text).
	 */
	readonly writeScope: ControlSeamWriteScope
}

/** The mutation-grant scopes a write operation may require. */
export type ControlSeamWriteScope = "mutation" | "mutation+content"

/** The discriminated registry entry union. */
export type ControlSeamOperation = ControlSeamReadOperation | ControlSeamWriteOperation

/**
 * The FULL registry.
 *
 * The two READ operations are unchanged from RECON01. The two WRITE
 * operations are new in ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01.
 */
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
	{
		id: "clinemm_start_act",
		mutating: true,
		description: "Start one task in the installed extension's workspace through the existing ClineMM task lifecycle.",
		writeScope: "mutation",
	},
	{
		id: "clinemm_read_events",
		mutating: true,
		description: "Read a bounded, ordered slice of the owned task's real emitted events.",
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the scope is
		// `"mutation"`, NOT `"mutation+content"`. The CONTENT-READ
		// grant gates only the message TEXT: without it, the operation
		// still returns the event METADATA (cursor, epoch, type, kind,
		// timestamp) - the conservative path - and omits every `text`
		// field. The metadata-only path needs no separate content
		// grant.
		writeScope: "mutation",
	},
	{
		id: "clinemm_send_feedback",
		mutating: true,
		description:
			"Send one ordinary text feedback message to the task this client owns, through the extension's existing follow-up authority.",
		// ACT-CLINEMM-MCP-SUPERVISION-V2-01: the scope is `"mutation"`.
		// The CONTENT-READ grant governs READING task message text; it
		// does not govern WRITING one. A mutation-authorized client may
		// steer its own task without gaining any read access to the
		// transcript.
		writeScope: "mutation",
	},
	{
		id: "clinemm_cancel_run",
		mutating: true,
		description: "Cancel the task this client owns through the extension's existing cancellation lifecycle.",
		// ACT-CLINEMM-MCP-SUPERVISION-V2-01: the scope is `"mutation"`.
		// Cancelling needs no transcript read access.
		writeScope: "mutation",
	},
] as const

/** The READ-ONLY registry projection — what a read-only client sees. */
export const CONTROL_SEAM_READ_OPERATIONS: readonly ControlSeamReadOperation[] = CONTROL_SEAM_OPERATIONS.filter(
	(operation): operation is ControlSeamReadOperation => operation.mutating === false,
)

/** True when `id` names a registered operation. */
export function isControlSeamOperationId(id: unknown): id is ControlSeamOperationId {
	return typeof id === "string" && (CONTROL_SEAM_OPERATION_IDS as readonly string[]).includes(id)
}

/** True when `id` names a registered READ operation. */
export function isControlSeamReadOperationId(id: unknown): id is ControlSeamReadOperationId {
	return typeof id === "string" && (CONTROL_SEAM_READ_OPERATION_IDS as readonly string[]).includes(id)
}

/** True when `id` names a registered WRITE operation. */
export function isControlSeamWriteOperationId(id: unknown): id is ControlSeamWriteOperationId {
	return typeof id === "string" && (CONTROL_SEAM_WRITE_OPERATION_IDS as readonly string[]).includes(id)
}

/** The registry entry for `id`, or `undefined` when `id` is not registered. */
export function getControlSeamOperation(id: unknown): ControlSeamOperation | undefined {
	if (!isControlSeamOperationId(id)) {
		return undefined
	}
	return CONTROL_SEAM_OPERATIONS.find((operation) => operation.id === id)
}

/**
 * A request envelope. The client sends exactly one of these per line.
 *
 * `token` is the client authorization bearer. It is compared against
 * the extension host's own token with a constant-time comparison; the
 * token NEVER appears in a log line.
 *
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: `writeToken` is the
 * SEPARATE, DISTINCT mutation credential. It is NEVER the read token,
 * never derived from it, and never accepted in its place. A write
 * operation requires BOTH the read token (so the read path keeps its
 * existing semantics unchanged) AND a valid `writeToken`.
 */
export interface ControlSeamRequest {
	readonly v: number
	readonly op: ControlSeamOperationId
	readonly token: string
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the SEPARATE mutation
	 * credential. Required for every WRITE operation; ignored for
	 * READ operations.
	 */
	readonly writeToken?: string
	/** Optional session-id echo; used ONLY to detect a stale/foreign id. */
	readonly sessionId?: string
	/**
	 * The operation-specific payload. Read operations take no payload;
	 * write operations take their own discriminated payload.
	 */
	readonly payload?: ControlSeamWritePayload
}

/**
 * The WRITE operation payloads.
 *
 * Discriminated on `op` so the codec can reject a payload that does not
 * match the operation it travelled with — a `clinemm_start_act` request
 * carrying a `clinemm_read_events` payload fails closed.
 */
export type ControlSeamWritePayload =
	| { readonly op: "clinemm_start_act"; readonly input: ControlSeamStartActInput }
	| { readonly op: "clinemm_read_events"; readonly input: ControlSeamReadEventsInput }
	| { readonly op: "clinemm_send_feedback"; readonly input: ControlSeamSendFeedbackInput }
	| { readonly op: "clinemm_cancel_run"; readonly input: ControlSeamCancelRunInput }

/**
 * The `clinemm_start_act` input.
 *
 * `requestId` is the CLIENT-SUPPLIED idempotency key. It is scoped to
 * ONE extension-host instance and is bounded by the instance-local
 * operation ledger.
 *
 * `expectedWorkspace` is the client's ASSERTION about the workspace.
 * The extension host resolves the ACTUAL workspace identity from its
 * OWN installed-workspace owner and compares it to this value. A
 * mismatch is rejected — the client can never SELECT a workspace.
 */
export interface ControlSeamStartActInput {
	readonly requestId: string
	readonly prompt: string
	readonly expectedWorkspace: string
}

/**
 * The `clinemm_read_events` input.
 *
 * `sessionId` MUST be the session this mutation client owns. The
 * extension host rejects a foreign session id — the client cannot read
 * another task's transcript.
 */
export interface ControlSeamReadEventsInput {
	readonly sessionId: string
	readonly afterCursor?: string
	readonly limit?: number
}

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01 — the `clinemm_send_feedback` input.
 *
 * `requestId` is the CLIENT-SUPPLIED idempotency key. It is scoped to ONE
 * extension-host instance and is bounded by the instance-local operation
 * ledger (the SAME ledger `clinemm_start_act` uses).
 *
 * `sessionId` MUST be the session this mutation client owns. The extension
 * host rejects a foreign session id — the client can never steer a task it
 * did not start.
 *
 * `expectedEpoch` MUST be the CURRENT conversation epoch of the owned
 * session, as reported by `clinemm_get_run` (`taskState.epoch`) or by the
 * `epoch` field of the owned session's published events. It is the
 * CONVERSATION epoch (`MessageIdMinter.epoch`) — NEVER a UI sequence
 * number and NEVER a publication `stateVersion`. Those are different
 * clocks; substituting either of them for the epoch would make the fence
 * meaningless (a `stateVersion` monotonically increases across epochs, so
 * a stale-epoch request could pass a `stateVersion` check).
 *
 * `expectedRunId` is OPTIONAL. When the runtime reports a run identity, the
 * client MUST supply it, and the extension host compares it against the
 * run identity observed at the dispatch boundary. When it is ABSENT, the
 * request is NOT treated as permission to steer an arbitrary task: the
 * session-ownership fence and the epoch fence still apply, and an absent
 * run id never widens the fence.
 *
 * `text` is the ordinary, free-form user message. It is TEXT-ONLY: this
 * ACT does not forward attachments, file paths, or images.
 */
export interface ControlSeamSendFeedbackInput {
	readonly requestId: string
	readonly sessionId: string
	readonly expectedEpoch: number
	readonly expectedRunId?: string
	readonly text: string
}

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01 — the `clinemm_cancel_run` input.
 *
 * The fences are IDENTICAL to `clinemm_send_feedback`: the session must be
 * the one this client owns, the epoch must be the current conversation
 * epoch, and the run id (when supplied) must match the run observed at the
 * dispatch boundary.
 *
 * There is deliberately NO `text` field: cancellation carries no
 * user-authored content, so there is nothing to leak and nothing to
 * interpret.
 */
export interface ControlSeamCancelRunInput {
	readonly requestId: string
	readonly sessionId: string
	readonly expectedEpoch: number
	readonly expectedRunId?: string
}

/**
 * The maximum accepted prompt length for `clinemm_start_act`, in
 * characters. A longer prompt is rejected before any lifecycle call.
 */
export const CONTROL_SEAM_MAX_PROMPT_LENGTH = 32_000

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: the maximum accepted feedback text
 * length, in characters. It matches the start-prompt bound so a feedback
 * message can never be larger than the prompt that started the task.
 */
export const CONTROL_SEAM_MAX_FEEDBACK_LENGTH = 32_000

/**
 * The maximum accepted `requestId` length, in characters.
 */
export const CONTROL_SEAM_MAX_REQUEST_ID_LENGTH = 200

/**
 * The maximum accepted `limit` for `clinemm_read_events`.
 */
export const CONTROL_SEAM_MAX_EVENT_LIMIT = 100

/**
 * The default `limit` for `clinemm_read_events` when the client omits
 * it.
 */
export const CONTROL_SEAM_DEFAULT_EVENT_LIMIT = 20

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
	/** An internal failure. The message never carries task content. */
	internal: "control_seam_internal",
	/** The client supplied a session id that is not the active one. */
	foreignSession: "control_seam_foreign_session",
	/**
	 * The request line exceeded the protocol's byte bound. The
	 * connection is closed after this response.
	 */
	payloadTooLarge: "control_seam_payload_too_large",
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the write operation was
	 * refused because the request carried no mutation credential, the
	 * mutation credential was invalid, or mutation control is OFF.
	 */
	mutationNotAuthorized: "control_seam_mutation_not_authorized",
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the operation was
	 * refused because its preconditions failed (workspace mismatch, an
	 * existing active task owner, invalid input). NO execution started.
	 */
	rejected: "control_seam_rejected",
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the operation was
	 * superseded by another lifecycle operation. NO execution was
	 * installed by this operation.
	 */
	superseded: "control_seam_superseded",
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the transport or host
	 * failure prevents proving whether the start occurred.
	 */
	unknownOutcome: "control_seam_unknown_outcome",
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the requested cursor is
	 * older than the retained event window, or the retained window has
	 * a gap. The events that ARE retained are returned; the gap is
	 * reported explicitly.
	 */
	cursorExpired: "control_seam_cursor_expired",
} as const

export type ControlSeamErrorCode = (typeof CONTROL_SEAM_ERROR_CODES)[keyof typeof CONTROL_SEAM_ERROR_CODES]

/**
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the outcome vocabulary of
 * `clinemm_start_act`.
 *
 *   - `accepted` — task/session creation is ACKNOWLEDGED by the
 *     authoritative lifecycle (`startNewSession` returned `started`).
 *     The `sessionId` is the REAL accepted identity.
 *   - `rejected` — preconditions failed; NO execution started.
 *   - `superseded` — another lifecycle operation took ownership; NO
 *     session was installed by this operation.
 *   - `unknown_outcome` — transport or host failure prevents proving
 *     whether a start occurred.
 *
 * An acknowledgement is NOT task completion. `accepted` says nothing
 * about whether the task later completed, failed, or was cancelled.
 */
export type ControlSeamStartActOutcome = "accepted" | "rejected" | "superseded" | "unknown_outcome"

/**
 * The `clinemm_start_act` result.
 *
 * `accepted` REQUIRES `sessionId` — the server must never report an
 * acceptance without an authoritative session identity.
 */
export interface ControlSeamStartActResult {
	readonly outcome: ControlSeamStartActOutcome
	/**
	 * The REAL accepted session identity. Present IFF `outcome` is
	 * `"accepted"`.
	 */
	readonly sessionId?: string
	/** The task id the controller owns for the accepted session, if any. */
	readonly taskId?: string
	/**
	 * The client-supplied idempotency key this outcome was recorded
	 * under. Echoed so the client can correlate a replayed request with
	 * its original outcome.
	 */
	readonly requestId: string
	/**
	 * A non-informative reason for a `rejected` / `superseded` /
	 * `unknown_outcome` outcome. It NEVER carries task content, a
	 * credential, or a file path beyond the workspace the client
	 * already asserted.
	 */
	readonly reason?: string
}

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: the outcome vocabulary of
 * `clinemm_send_feedback`.
 *
 *   - `accepted` — the authoritative follow-up authority ACKNOWLEDGED
 *     the feedback as an ordinary user message for the owned session.
 *     This says NOTHING about whether the agent executed it, acted on
 *     it, or completed. It is NOT completion authority.
 *   - `queued` — the EXISTING production pending-prompt queue accepted
 *     the message AND returned a correlatable identity for it (the
 *     queue's own prompt id). The item is bound to the owned session
 *     and its owner; it is not yet consumed.
 *   - `rejected` — a precondition failed (fence mismatch, unsupported
 *     phase, competing interaction). NOTHING was delivered.
 *   - `superseded` — the session/task changed while the request was in
 *     flight. NOTHING was delivered to the replacement task.
 *   - `unknown_outcome` — the host could not prove whether the feedback
 *     was delivered. It MUST NOT be retried automatically: the client
 *     has to reconcile through `clinemm_get_run` /
 *     `clinemm_read_events` first.
 */
export type ControlSeamSendFeedbackOutcome = "accepted" | "queued" | "rejected" | "superseded" | "unknown_outcome"

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: the `clinemm_send_feedback` result.
 *
 * `outcome` is the AUTHORITATIVE disposition of the feedback operation.
 *
 * `queuedPromptId` is present IFF the outcome is `"queued"`. It is the
 * queue's OWN identity for the enqueued item, so the client can later
 * correlate the item's consumption by the intended run. It is NEVER
 * minted locally by the seam.
 */
export interface ControlSeamSendFeedbackResult {
	readonly outcome: ControlSeamSendFeedbackOutcome
	/** The client-supplied idempotency key this outcome was recorded under. */
	readonly requestId: string
	/** The session the feedback was addressed to. */
	readonly sessionId: string
	/**
	 * The queue's own identity for the enqueued item. Present IFF the
	 * outcome is `"queued"`.
	 */
	readonly queuedPromptId?: string
	/**
	 * The authoritative task phase observed at the dispatch boundary,
	 * when it could be established safely. It is a STATUS ENUM only —
	 * never a fabricated `idle` and never a completion claim.
	 */
	readonly phase?: string
	/**
	 * A non-informative reason for a `rejected` / `superseded` /
	 * `unknown_outcome` outcome. It NEVER carries task content, a
	 * credential, or a file path.
	 */
	readonly reason?: string
}

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: the outcome vocabulary of
 * `clinemm_cancel_run`.
 *
 *   - `accepted` — the EXISTING cancellation lifecycle accepted the
 *     cancellation for the owned session. This is NOT proof that the run
 *     stopped: the authoritative `cancelTask()` path owns the abort, the
 *     interaction cleanup, and the background-job containment, and it
 *     publishes the resulting phase asynchronously.
 *   - `already_terminal` — the owned session had already reached a
 *     terminal phase. The cancellation was a no-op and did NOT overwrite
 *     the committed terminal completion.
 *   - `superseded` — the session/task changed while the request was in
 *     flight. The cancellation did NOT touch the replacement task.
 *   - `rejected` — a precondition failed. NOTHING was cancelled.
 *   - `unknown_outcome` — the host could not prove whether the
 *     cancellation took effect. It MUST NOT be retried automatically.
 */
export type ControlSeamCancelRunOutcome = "accepted" | "already_terminal" | "superseded" | "rejected" | "unknown_outcome"

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: the `clinemm_cancel_run` result.
 *
 * `phase` is the authoritative task phase observed AFTER the cancellation
 * lifecycle settled, when it could be established safely. It is a STATUS
 * ENUM only.
 */
export interface ControlSeamCancelRunResult {
	readonly outcome: ControlSeamCancelRunOutcome
	/** The client-supplied idempotency key this outcome was recorded under. */
	readonly requestId: string
	/** The session the cancellation was addressed to. */
	readonly sessionId: string
	/** The authoritative task phase after the cancellation settled, if known. */
	readonly phase?: string
	/**
	 * A non-informative reason for a `rejected` / `superseded` /
	 * `unknown_outcome` outcome.
	 */
	readonly reason?: string
}

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: ONE observed event.
 *
 * The event's identity and ordering come from the EXISTING production
 * message stream (`ClineMessage.seq` / `.epoch`), NOT from a
 * reconstructed timeline. The `type` is the existing `ClineMessage`
 * shape tag (`say` / `ask`), and `kind` carries the EXISTING sub-kind
 * when there is one.
 *
 * The payload carries NO raw tool arguments, NO credentials, NO hidden
 * reasoning, and NO unrestricted file contents. `text` is present ONLY
 * when the content-read grant is present AND the message is a
 * user-visible text kind; it is truncated to a bounded length.
 */
export interface ControlSeamEvent {
	/** The EXISTING ordering identity: the `ClineMessage.seq`. */
	readonly cursor: string
	/** The EXISTING conversation epoch the event belongs to. */
	readonly epoch: number
	/** The event kind (`say` / `ask`). */
	readonly type: string
	/** The existing sub-kind (e.g. `task`, `text`, `tool`). */
	readonly kind?: string
	/** The event's own timestamp (the existing `ClineMessage.ts`). */
	readonly ts: number
	/**
	 * The message text. Present ONLY under the explicit content-read
	 * grant. Bounded by `CONTROL_SEAM_MAX_EVENT_TEXT_LENGTH`.
	 */
	readonly text?: string
}

/**
 * The maximum length of an event's `text` on the wire. A longer text
 * is TRUNCATED (with an explicit marker), never dropped silently.
 */
export const CONTROL_SEAM_MAX_EVENT_TEXT_LENGTH = 2_000

/**
 * The `clinemm_read_events` result.
 *
 * `events` is in the EXISTING production order. `nextCursor` is the
 * cursor the client passes as `afterCursor` for the next slice.
 * `cursorExpired` is `true` when the retained window has moved past
 * the requested cursor — the caller MUST NOT assume it observed every
 * event.
 */
export interface ControlSeamEventsResult {
	readonly sessionId: string
	readonly events: readonly ControlSeamEvent[]
	/** The cursor to resume from, or `undefined` when there are no more. */
	readonly nextCursor?: string
	/**
	 * True when the requested cursor is older than the retained window
	 * (or a gap was detected). The caller MUST treat the returned slice
	 * as INCOMPLETE.
	 */
	readonly cursorExpired: boolean
}

/**
 * The `clinemm_capabilities` result.
 *
 * Deliberately carries NO session identity, NO task text, NO
 * credential-bearing configuration, and NO event stream.
 */
export interface ControlSeamCapabilities {
	readonly protocolVersion: number
	readonly operations: readonly { readonly id: ControlSeamOperationId; readonly description: string }[]
	/**
	 * Whether THIS CALLER's operation view is read-only.
	 *
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: a read-only client
	 * (no valid write credential) sees `readOnly: true` and EXACTLY the
	 * original two operations — its view is byte-for-byte the RECON01
	 * view. A mutation-authorized client sees `readOnly: false` and
	 * the two write operations as well.
	 */
	readonly readOnly: boolean
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
	// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the write credential is
	// OPTIONAL at the codec level (a READ request never carries one),
	// but when present it MUST be a non-empty string.
	if (record.writeToken !== undefined && (typeof record.writeToken !== "string" || record.writeToken.length === 0)) {
		return undefined
	}
	const payload = decodeControlSeamWritePayload(record.op, record.payload)
	if (payload === null) {
		// A write operation with a malformed or mismatched payload is
		// rejected at the codec. A read operation that carries a
		// payload is likewise rejected: the read path's request shape
		// is unchanged.
		return undefined
	}
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: record.op,
		token: record.token,
		...(record.writeToken !== undefined ? { writeToken: record.writeToken } : {}),
		...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
		...(payload !== undefined ? { payload } : {}),
	}
}

/**
 * Decode + validate the operation-specific payload.
 *
 * Returns `undefined` when the operation takes no payload (READ
 * operations) and the request carried none. Returns `null` when the
 * request is malformed: a WRITE operation without a payload, a WRITE
 * operation whose payload does not match its own operation id, a READ
 * operation that carries a payload, or a payload whose fields fail
 * their own schema.
 */
function decodeControlSeamWritePayload(op: ControlSeamOperationId, raw: unknown): ControlSeamWritePayload | undefined | null {
	if (isControlSeamReadOperationId(op)) {
		// A read operation MUST NOT carry a payload.
		return raw === undefined ? undefined : null
	}
	if (raw === undefined || raw === null) {
		return null
	}
	if (typeof raw !== "object" || Array.isArray(raw)) {
		return null
	}
	const record = raw as Record<string, unknown>
	if (record.op !== op) {
		// The payload must belong to the operation that carried it.
		return null
	}
	if (op === "clinemm_start_act") {
		const input = record.input
		if (typeof input !== "object" || input === null || Array.isArray(input)) {
			return null
		}
		const inputRecord = input as Record<string, unknown>
		if (typeof inputRecord.requestId !== "string" || inputRecord.requestId.length === 0) {
			return null
		}
		if (inputRecord.requestId.length > CONTROL_SEAM_MAX_REQUEST_ID_LENGTH) {
			return null
		}
		if (typeof inputRecord.prompt !== "string" || inputRecord.prompt.length === 0) {
			return null
		}
		if (inputRecord.prompt.length > CONTROL_SEAM_MAX_PROMPT_LENGTH) {
			return null
		}
		if (typeof inputRecord.expectedWorkspace !== "string" || inputRecord.expectedWorkspace.length === 0) {
			return null
		}
		return {
			op: "clinemm_start_act",
			input: {
				requestId: inputRecord.requestId,
				prompt: inputRecord.prompt,
				expectedWorkspace: inputRecord.expectedWorkspace,
			},
		}
	}
	if (op === "clinemm_send_feedback") {
		return decodeControlSeamSendFeedbackPayload(record.input)
	}
	if (op === "clinemm_cancel_run") {
		return decodeControlSeamCancelRunPayload(record.input)
	}
	// clinemm_read_events
	const input = record.input
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return null
	}
	const inputRecord = input as Record<string, unknown>
	if (typeof inputRecord.sessionId !== "string" || inputRecord.sessionId.length === 0) {
		return null
	}
	if (inputRecord.afterCursor !== undefined && typeof inputRecord.afterCursor !== "string") {
		return null
	}
	if (inputRecord.limit !== undefined) {
		if (typeof inputRecord.limit !== "number" || !Number.isInteger(inputRecord.limit)) {
			return null
		}
		if (inputRecord.limit < 1 || inputRecord.limit > CONTROL_SEAM_MAX_EVENT_LIMIT) {
			return null
		}
	}
	return {
		op: "clinemm_read_events",
		input: {
			sessionId: inputRecord.sessionId,
			...(inputRecord.afterCursor !== undefined ? { afterCursor: inputRecord.afterCursor } : {}),
			...(inputRecord.limit !== undefined ? { limit: inputRecord.limit } : {}),
		},
	}
}

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: decode + validate the shared
 * SUPERVISION input fields.
 *
 * `clinemm_send_feedback` and `clinemm_cancel_run` share the same fence
 * fields (requestId / sessionId / expectedEpoch / expectedRunId?), so the
 * validation lives here ONCE — the two operations cannot drift apart on
 * their fences.
 *
 * Returns `null` when any field fails its schema.
 */
function decodeControlSeamSupervisionInput(input: unknown): {
	requestId: string
	sessionId: string
	expectedEpoch: number
	expectedRunId?: string
} | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return null
	}
	const inputRecord = input as Record<string, unknown>
	if (typeof inputRecord.requestId !== "string" || inputRecord.requestId.length === 0) {
		return null
	}
	if (inputRecord.requestId.length > CONTROL_SEAM_MAX_REQUEST_ID_LENGTH) {
		return null
	}
	if (typeof inputRecord.sessionId !== "string" || inputRecord.sessionId.length === 0) {
		return null
	}
	// The epoch is a NON-NEGATIVE INTEGER. A float, a negative number, a
	// string, or `NaN` is rejected at the codec: a malformed epoch would
	// otherwise compare unequal to every real epoch and produce a
	// confusing `rejected` instead of a `bad_request`.
	if (
		typeof inputRecord.expectedEpoch !== "number" ||
		!Number.isInteger(inputRecord.expectedEpoch) ||
		inputRecord.expectedEpoch < 0
	) {
		return null
	}
	if (inputRecord.expectedRunId !== undefined) {
		if (typeof inputRecord.expectedRunId !== "string" || inputRecord.expectedRunId.length === 0) {
			return null
		}
	}
	return {
		requestId: inputRecord.requestId,
		sessionId: inputRecord.sessionId,
		expectedEpoch: inputRecord.expectedEpoch,
		...(inputRecord.expectedRunId !== undefined ? { expectedRunId: inputRecord.expectedRunId } : {}),
	}
}

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: `clinemm_send_feedback`.
 *
 * The feedback text is TEXT-ONLY. An `images` / `files` / `attachments`
 * field is NOT part of the contract, and the codec DROPS unknown keys
 * rather than forwarding them — so an attachment can never be smuggled
 * through the feedback path.
 */
function decodeControlSeamSendFeedbackPayload(input: unknown): ControlSeamWritePayload | null {
	const decoded = decodeControlSeamSupervisionInput(input)
	if (!decoded) {
		return null
	}
	const inputRecord = input as Record<string, unknown>
	if (typeof inputRecord.text !== "string" || inputRecord.text.length === 0) {
		return null
	}
	if (inputRecord.text.length > CONTROL_SEAM_MAX_FEEDBACK_LENGTH) {
		return null
	}
	return {
		op: "clinemm_send_feedback",
		input: {
			...decoded,
			text: inputRecord.text,
		},
	}
}

/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: `clinemm_cancel_run`.
 *
 * There is NO `text` field. A request that carries one is REJECTED at the
 * codec: cancellation carries no user-authored content, and accepting an
 * unused field would widen the operation's surface for no reason.
 */
function decodeControlSeamCancelRunPayload(input: unknown): ControlSeamWritePayload | null {
	const decoded = decodeControlSeamSupervisionInput(input)
	if (!decoded) {
		return null
	}
	const inputRecord = input as Record<string, unknown>
	if (inputRecord.text !== undefined) {
		return null
	}
	return {
		op: "clinemm_cancel_run",
		input: decoded,
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

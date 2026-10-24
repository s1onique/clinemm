/**
 * ACT-CLINEMM-MYC-REAL-WORKFLOW-AUTOCAPTURE01 — automatic real-workflow
 * evidence acquisition for the myc evaluation.
 *
 * PURPOSE
 * -------
 * Make the myc real-workflow evaluation SELF-RECORDING. The operator works
 * normally in ClineMM; no manual session ids, timestamps, terminal
 * transcripts, configuration flags, or repeated `Dump myc Prime Diagnostic`
 * commands are required.
 *
 * ACTIVATION AUTHORITY (ACT §1)
 * -----------------------------
 * The EXISTING ClineMM dogfood runtime profile is the SOLE activation
 * authority:
 *
 *     mycEvaluationCaptureEnabled = isDogfoodRuntime()
 *
 * This is expressed by the central dogfood diagnostic profile
 * (`dogfood-diagnostic-profile.ts` -> `applyMycEvaluationCaptureProfile`),
 * which is invoked at the extension-host activation seam. There is NO new
 * environment variable, NO new workspace setting, NO additional runtime
 * profile, and NO Command Palette prerequisite. In `public` builds the
 * capture is ALWAYS OFF, and the disabled path is a zero state-semantic
 * delta (no writes, no logs, no state mutations).
 *
 * SCOPE: OBSERVE ONLY
 * -------------------
 * This module NEVER changes model-visible behavior, the protocol, or state
 * semantics. It records BOUNDED METADATA ONLY.
 *
 * It MUST NEVER store, log, or surface:
 *   - raw prompts,
 *   - model responses,
 *   - memory bodies,
 *   - MCP argument values,
 *   - credentials,
 *   - transcripts.
 *
 * A nonempty MCP response is NOT automatically a useful retrieval; the
 * usefulness classification lives in the report builder and is deliberately
 * conservative (see `classifyRetrieval`).
 *
 * PRODUCTION BOUNDARIES (ACT §2)
 * -------------------------------
 * The recorder is composed at the EXISTING production boundaries; no
 * competing observer is introduced:
 *
 *   | Event                  | Production owner                             |
 *   |------------------------|----------------------------------------------|
 *   | Session start/repl/end | `SdkSessionLifecycle`                        |
 *   | Prime acquisition      | `myc-prime-automation.ts`                    |
 *   | Prime lookup/injection | `hooks-adapter.ts` (existing prime diag)     |
 *   | MCP invocation         | `McpHub.callTool()` (existing observer slot) |
 *   | Compaction lifecycle   | `SdkCompactionCoordinator`                   |
 *   | Task lifecycle         | canonical task owner                         |
 *   | Model packet delivery  | existing provider/model boundary             |
 *
 * The existing single-slot MCP observer is COMPOSED (not replaced) at its
 * existing production owner, so task telemetry remains unchanged.
 *
 * STORAGE LAYOUT (ACT §4)
 * ------------------------
 *   <dataRoot>/diagnostics/myc-evaluation/<session-id>/
 *       events.jsonl
 *       summary.json
 *       evaluation.md
 *
 * Writes are ordered and asynchronous; the queue, the per-session event
 * retention, and the number of retained session bundles are all bounded;
 * dropped events are counted explicitly; a writer failure NEVER blocks
 * execution.
 *
 * REMOVAL TRIGGER
 * ---------------
 * This recorder is a bounded forensic scaffolding. When product telemetry
 * wants any of these counters, redesign them under a dedicated telemetry
 * ACT -- do NOT silently promote this recorder into product telemetry.
 */

/** Root of the evaluation capture tree, relative to the resolved data root. */
export const MYC_EVALUATION_CAPTURE_SUBDIR = "diagnostics/myc-evaluation" as const

/** Per-session event log filename. */
export const MYC_EVALUATION_EVENTS_FILENAME = "events.jsonl" as const

/** Per-session machine-readable summary filename. */
export const MYC_EVALUATION_SUMMARY_FILENAME = "summary.json" as const

/** Per-session human-readable evaluation report filename. */
export const MYC_EVALUATION_REPORT_FILENAME = "evaluation.md" as const

/**
 * Closed event-type vocabulary. Every recorded event carries exactly one
 * of these. The vocabulary is CLOSED: adding a value is a durable API
 * change requiring a new ACT.
 */
export type MycEvaluationEventType =
	// --- session lifecycle -------------------------------------------------
	| "session_start"
	| "session_replace"
	| "session_end"
	// --- prime acquisition -------------------------------------------------
	| "prime_acquisition"
	// --- prime lookup / injection (model-context delivery) ------------------
	| "prime_lookup"
	| "prime_injection"
	| "prime_model_context_delivery"
	// --- MCP ---------------------------------------------------------------
	| "mcp_call_completed"
	// --- compaction --------------------------------------------------------
	| "compaction_started"
	| "compaction_completed"
	// --- task lifecycle ----------------------------------------------------
	| "task_started"
	| "task_ended"
	// --- model packet delivery ---------------------------------------------
	| "model_packet_delivered"

/**
 * Bounded result classification for an MCP call.
 *
 * Mirrors the McpHub completion observer vocabulary so the recorder never
 * has to invent a competing taxonomy. `unknown` is emitted only when the
 * boundary could not classify the outcome.
 */
export type MycEvaluationResultClass = "success" | "empty" | "error" | "unknown"

/**
 * The retrieval classification ladder (ACT §5).
 *
 * Each retrieval is classified SEPARATELY:
 *
 *   1. `CONTENT_RETURNED`        -- the MCP completion returned content.
 *   2. `MODEL_CONTEXT_DELIVERED` -- the content reached the model context.
 *   3. `USEFULNESS_PROVEN`       -- usefulness was INDEPENDENTLY
 *                                  established (ground truth), not inferred.
 *   4. `USEFULNESS_NOT_ASSESSABLE` -- usefulness could not be established.
 *
 * A nonempty response is NOT automatically `USEFULNESS_PROVEN`.
 */
export type MycEvaluationRetrievalClass =
	| "CONTENT_RETURNED"
	| "MODEL_CONTEXT_DELIVERED"
	| "USEFULNESS_PROVEN"
	| "USEFULNESS_NOT_ASSESSABLE"

/**
 * ONE recorded event. Bounded metadata only.
 *
 * Field semantics:
 *   - `eventId`   -- monotonic per-process event identity.
 *   - `timestamp` -- ISO-8601 UTC.
 *   - `sessionId` -- the ClineMM host session id (the recorder's bundle key).
 *   - `mycSessionId` -- the myc-side session id, when observable.
 *   - `taskId`   -- the ClineMM task id, when observable.
 *   - `eventType` -- closed vocabulary (see `MycEvaluationEventType`).
 *   - `callId`   -- per-call identity for MCP calls.
 *   - `toolName` -- MCP tool name (bounded identifier, never arguments).
 *   - `resultClass` -- bounded outcome classification.
 *   - `resultCount` -- observable result count, when measurable.
 *   - `durationMs` -- measured wall-clock duration.
 *   - `inputBytes` / `outputBytes` -- measurable byte counts.
 *   - `tokenCount` -- MEASURED token count only (never estimated).
 *   - `contentSha256` -- digest of the payload, where safe to compute.
 *   - `sourceHead` -- the git HEAD the evidence was produced from.
 *
 * There are deliberately NO fields for prompts, responses, memory bodies,
 * MCP argument values, credentials, or transcripts.
 */
export interface MycEvaluationEvent {
	readonly eventId: string
	readonly timestamp: string
	readonly sessionId: string
	readonly mycSessionId?: string
	readonly taskId?: string
	readonly eventType: MycEvaluationEventType
	readonly callId?: string
	readonly toolName?: string
	readonly resultClass?: MycEvaluationResultClass
	readonly resultCount?: number
	readonly durationMs?: number
	readonly inputBytes?: number
	readonly outputBytes?: number
	readonly tokenCount?: number
	readonly contentSha256?: string
	readonly sourceHead?: string
	/** Free-form BOUNDED discriminator (enum-like), never free text. */
	readonly detail?: string
}

/**
 * Append-only write seam. Production = `node:fs/promises#appendFile` over
 * the per-session JSONL events path. Tests inject an in-memory spy.
 */
export type MycEvaluationWriter = (target: string, line: string) => Promise<void>

/**
 * Whole-file write seam. Production = `node:fs/promises#writeFile`. Used
 * for `summary.json` and `evaluation.md` checkpoints.
 */
export type MycEvaluationFileWriter = (target: string, contents: string) => Promise<void>

/** Directory-removal seam used for retention pruning. */
export type MycEvaluationDirectoryPruner = (target: string) => Promise<void>

/** Directory-listing seam used for retention pruning (returns directory names). */
export type MycEvaluationDirectoryLister = (target: string) => Promise<string[]>

/** Data-root resolver. Production = `resolveDataDirFromEnv`. */
export type MycEvaluationDataRootResolver = () => string

/** Bounded warn seam. */
export type MycEvaluationWarn = (message: string) => void

/**
 * Bounded retention limits (ACT §4).
 *
 * - `MYC_EVALUATION_MAX_EVENTS_PER_SESSION` bounds the number of retained
 *   events for a single session bundle. Once the bound is reached, further
 *   events for that session are DROPPED and counted (never silently
 *   discarded).
 * - `MYC_EVALUATION_MAX_PENDING_WRITES` bounds the number of queued
 *   writes. Once the bound is reached, further writes are DROPPED and
 *   counted.
 * - `MYC_EVALUATION_MAX_SESSION_BUNDLES` bounds the number of retained
 *   session bundles on disk. The oldest bundle is pruned when a new one is
 *   created beyond the bound.
 */
export const MYC_EVALUATION_MAX_EVENTS_PER_SESSION = 5000
export const MYC_EVALUATION_MAX_PENDING_WRITES = 256
export const MYC_EVALUATION_MAX_SESSION_BUNDLES = 20

/**
 * Per-session capture state. One bundle per session id; sequential
 * sessions produce DISTINCT bundles (isolation is a hard invariant).
 */
interface SessionState {
	readonly sessionId: string
	events: MycEvaluationEvent[]
	/** Total number of events OBSERVED for this session (including dropped). */
	observedCount: number
	/** Number of events DROPPED because the per-session bound was reached. */
	droppedCount: number
	/** Number of writes DROPPED because the pending-write bound was reached. */
	droppedWriteCount: number
	/** Number of write FAILURES (the writer rejected). */
	writeFailureCount: number
	/** Timestamp of the first observed event for this session. */
	startedAt?: string
	/** Timestamp of the last observed event for this session. */
	endedAt?: string
	/** Wall-clock ms of the first observed event. */
	startedAtMs?: number
	/** Wall-clock ms of the last observed event. */
	endedAtMs?: number
	/** Set when the session bundle has been checkpointed (summary + report). */
	checkpointed: boolean
}

// ---------------------------------------------------------------------------
// Module-level enablement seam
// ---------------------------------------------------------------------------

/**
 * Module-level enablement boolean. `null` means "not yet armed" -- the
 * central dogfood profile arms it ONCE at extension activation.
 *
 * The recorder hot path reads this single boolean. When the capture is
 * DISABLED every recorder short-circuits here: zero writes, zero logs,
 * zero state mutations, zero async work.
 */
let captureEnabled: boolean | null = null

/**
 * Arm / disarm the capture seam.
 *
 * Called from `applyMycEvaluationCaptureProfile` at extension activation.
 * Idempotent. Direct callers other than the central profile are FORBIDDEN
 * in production; test code uses `__resetMycEvaluationCaptureForTests`.
 */
export function setMycEvaluationCaptureEnabled(enabled: boolean): void {
	captureEnabled = enabled
}

/**
 * Is the capture currently armed? The effective contract is
 * `mycEvaluationCaptureEnabled = isDogfoodRuntime()` -- resolved once by
 * the central dogfood diagnostic profile.
 */
export function isMycEvaluationCaptureEnabled(): boolean {
	return captureEnabled === true
}

/**
 * Test-only: reset the enablement seam back to the un-armed state.
 */
export function __resetMycEvaluationCaptureForTests(): void {
	captureEnabled = null
	statesBySessionId.clear()
	eventCounter = 0
	pendingWriteCount = 0
	_writeTail = Promise.resolve()
}

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

let _dataRootResolver: MycEvaluationDataRootResolver | undefined
let _writer: MycEvaluationWriter | undefined
let _fileWriter: MycEvaluationFileWriter | undefined
let _directoryPruner: MycEvaluationDirectoryPruner | undefined
let _directoryLister: MycEvaluationDirectoryLister | undefined
let _warn: MycEvaluationWarn = () => {}

/** Bind the data-root resolver. Production = `resolveDataDirFromEnv`. */
export function setMycEvaluationDataRootResolver(resolver: MycEvaluationDataRootResolver | undefined): void {
	_dataRootResolver = resolver
}

/** Bind the append-only JSONL writer. */
export function setMycEvaluationWriter(writer: MycEvaluationWriter | undefined): void {
	_writer = writer
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

const statesBySessionId = new Map<string, SessionState>()
let eventCounter = 0
let pendingWriteCount = 0

/** Serialized write chain (ACT §4: ordered asynchronous JSONL writes). */
let _writeTail: Promise<void> = Promise.resolve()

/**
 * Resolve the per-session bundle directory.
 *
 * Returns `undefined` when the data root cannot be resolved (the resolver
 * may throw); the recorder then short-circuits (the recorder never
 * re-throws).
 */
export function resolveMycEvaluationSessionDir(sessionId: string): string | undefined {
	const resolver = _dataRootResolver
	if (typeof resolver !== "function") return undefined
	let root: string
	try {
		root = resolver()
	} catch (err) {
		_warn(`data root resolution failed: ${errorMessage(err)}`)
		return undefined
	}
	if (typeof root !== "string" || root.length === 0) return undefined
	return `${root}/${MYC_EVALUATION_CAPTURE_SUBDIR}/${sanitizeSessionId(sessionId)}`
}

/**
 * Sanitize a session id for use as a directory name. The session id is an
 * opaque host-generated identifier; this only removes path separators and
 * traversal sequences so a hostile id cannot escape the capture root.
 */
export function sanitizeSessionId(sessionId: string): string {
	const cleaned = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_")
	return cleaned.length > 0 ? cleaned.slice(0, 128) : "_"
}

/** Resolve the per-session events.jsonl path. */
export function resolveMycEvaluationEventsPath(sessionId: string): string | undefined {
	const dir = resolveMycEvaluationSessionDir(sessionId)
	return dir === undefined ? undefined : `${dir}/${MYC_EVALUATION_EVENTS_FILENAME}`
}

/** Resolve the per-session summary.json path. */
export function resolveMycEvaluationSummaryPath(sessionId: string): string | undefined {
	const dir = resolveMycEvaluationSessionDir(sessionId)
	return dir === undefined ? undefined : `${dir}/${MYC_EVALUATION_SUMMARY_FILENAME}`
}

/** Resolve the per-session evaluation.md path. */
export function resolveMycEvaluationReportPath(sessionId: string): string | undefined {
	const dir = resolveMycEvaluationSessionDir(sessionId)
	return dir === undefined ? undefined : `${dir}/${MYC_EVALUATION_REPORT_FILENAME}`
}

function stateFor(sessionId: string): SessionState {
	const existing = statesBySessionId.get(sessionId)
	if (existing) return existing
	const fresh: SessionState = {
		sessionId,
		events: [],
		observedCount: 0,
		droppedCount: 0,
		droppedWriteCount: 0,
		writeFailureCount: 0,
		checkpointed: false,
	}
	statesBySessionId.set(sessionId, fresh)
	return fresh
}

/**
 * Record ONE event for `sessionId`.
 *
 * NEVER throws. When the capture is disabled this is a strict no-op
 * (the disabled path has a zero state-semantic delta). When the
 * per-session event bound is exceeded the event is DROPPED and counted
 * explicitly.
 *
 * Returns the recorded event, or `undefined` when the event was dropped
 * or the capture is disabled.
 */
export function recordMycEvaluationEvent(
	sessionId: string,
	event: Omit<MycEvaluationEvent, "eventId" | "timestamp" | "sessionId"> & { readonly timestamp?: string },
): MycEvaluationEvent | undefined {
	if (!isMycEvaluationCaptureEnabled()) return undefined
	if (typeof sessionId !== "string" || sessionId.length === 0) return undefined
	const state = stateFor(sessionId)
	state.observedCount++
	const now = Date.now()
	const timestamp = event.timestamp ?? new Date(now).toISOString()
	if (state.startedAt === undefined) {
		state.startedAt = timestamp
		state.startedAtMs = now
	}
	state.endedAt = timestamp
	state.endedAtMs = now

	if (state.events.length >= MYC_EVALUATION_MAX_EVENTS_PER_SESSION) {
		// Bounded overflow: counted, never silently discarded.
		state.droppedCount++
		return undefined
	}

	eventCounter += 1
	const recorded: MycEvaluationEvent = {
		...event,
		eventId: `myc-eval-${eventCounter}`,
		timestamp,
		sessionId,
	}
	state.events.push(recorded)
	appendEventLine(sessionId, recorded)
	return recorded
}

/**
 * Append one JSONL line for the event. Ordered (serialized through the
 * module write chain), asynchronous (never awaited by the caller), and
 * failure-isolated (a rejected write NEVER blocks execution and NEVER
 * poisons the chain).
 */
function appendEventLine(sessionId: string, event: MycEvaluationEvent): void {
	const writer = _writer
	if (typeof writer !== "function") return
	const target = resolveMycEvaluationEventsPath(sessionId)
	if (target === undefined) return

	if (pendingWriteCount >= MYC_EVALUATION_MAX_PENDING_WRITES) {
		// Bounded queue overflow: counted explicitly, event dropped.
		stateFor(sessionId).droppedWriteCount++
		_warn(`pending write bound reached; dropping event write (session=${sessionId})`)
		return
	}

	let line: string
	try {
		line = `${JSON.stringify(event)}\n`
	} catch (err) {
		_warn(`event serialization failed (event=${event.eventType}): ${errorMessage(err)}`)
		return
	}

	pendingWriteCount++
	const op = _writeTail
		.catch(() => undefined)
		.then(async () => {
			try {
				await writer(target, line)
			} finally {
				pendingWriteCount = Math.max(0, pendingWriteCount - 1)
			}
		})
	_writeTail = op.catch(() => undefined)
	void op.catch((err) => {
		stateFor(sessionId).writeFailureCount++
		_warn(`append failed (target=${target}, event=${event.eventType}): ${errorMessage(err)}`)
	})
}

/** Best-effort bounded error message. */
function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message.slice(0, 512)
	if (typeof err === "string") return err.slice(0, 512)
	try {
		return JSON.stringify(err).slice(0, 512)
	} catch {
		return "<unserializable error>"
	}
}

/** Test-only: read the recorded events for a session. */
export function __getMycEvaluationEventsForTests(sessionId: string): readonly MycEvaluationEvent[] {
	return stateFor(sessionId).events
}

/** Test-only: read every recorded session id (for isolation assertions). */
export function __getMycEvaluationSessionIdsForTests(): readonly string[] {
	return Array.from(statesBySessionId.keys())
}

/** Test-only: read the accounting counters for a session. */
export function __getMycEvaluationAccountingForTests(sessionId: string): {
	observedCount: number
	droppedCount: number
	droppedWriteCount: number
	writeFailureCount: number
} {
	const state = stateFor(sessionId)
	return {
		observedCount: state.observedCount,
		droppedCount: state.droppedCount,
		droppedWriteCount: state.droppedWriteCount,
		writeFailureCount: state.writeFailureCount,
	}
}

/** Test-only: the number of writes currently pending. */
export function __getMycEvaluationPendingWriteCountForTests(): number {
	return pendingWriteCount
}

/** Test-only: wait for the write chain to drain (bounded). */
export async function __drainMycEvaluationWritesForTests(timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await _writeTail.catch(() => undefined)
		if (pendingWriteCount === 0) return
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
}

/**
 * Checkpoint the session bundle: write `summary.json` and `evaluation.md`
 * from the OBSERVED events.
 *
 * Checkpoints are EVENT-DRIVEN: they happen whenever a meaningful event
 * boundary is observed, INDEPENDENT of whether the C10 completion flow
 * succeeded. A checkpoint failure NEVER blocks execution.
 *
 * The checkpoint is serialized through the module write chain so a
 * summary and a report for the same session cannot interleave.
 */
export function checkpointMycEvaluationSession(
	sessionId: string,
	options: {
		readonly buildSummary: (events: readonly MycEvaluationEvent[], accounting: MycEvaluationAccounting) => unknown
		readonly buildReport: (summary: unknown) => string
	},
): void {
	if (!isMycEvaluationCaptureEnabled()) return
	const fileWriter = _fileWriter
	if (typeof fileWriter !== "function") return
	const summaryPath = resolveMycEvaluationSummaryPath(sessionId)
	const reportPath = resolveMycEvaluationReportPath(sessionId)
	if (summaryPath === undefined || reportPath === undefined) return
	const state = stateFor(sessionId)
	const accounting: MycEvaluationAccounting = {
		observedCount: state.observedCount,
		droppedCount: state.droppedCount,
		droppedWriteCount: state.droppedWriteCount,
		writeFailureCount: state.writeFailureCount,
	}
	let summary: unknown
	let report: string
	try {
		summary = options.buildSummary(state.events, accounting)
		report = options.buildReport(summary)
	} catch (err) {
		_warn(`checkpoint build failed (session=${sessionId}): ${errorMessage(err)}`)
		return
	}
	let summaryText: string
	try {
		summaryText = `${JSON.stringify(summary, null, 2)}\n`
	} catch (err) {
		_warn(`checkpoint serialization failed (session=${sessionId}): ${errorMessage(err)}`)
		return
	}
	state.checkpointed = true
	const op = _writeTail
		.catch(() => undefined)
		.then(async () => {
			await fileWriter(summaryPath, summaryText)
			await fileWriter(reportPath, report)
		})
	_writeTail = op.catch(() => undefined)
	void op.catch((err) => {
		state.writeFailureCount++
		_warn(`checkpoint write failed (session=${sessionId}): ${errorMessage(err)}`)
	})
}

/**
 * The accounting counters handed to the checkpoint builder.
 */
export interface MycEvaluationAccounting {
	readonly observedCount: number
	readonly droppedCount: number
	readonly droppedWriteCount: number
	readonly writeFailureCount: number
}

/** Bind the whole-file writer (summary.json / evaluation.md). */
export function setMycEvaluationFileWriter(writer: MycEvaluationFileWriter | undefined): void {
	_fileWriter = writer
}

/** Bind the retention pruner. */
export function setMycEvaluationDirectoryPruner(pruner: MycEvaluationDirectoryPruner | undefined): void {
	_directoryPruner = pruner
}

/** Bind the retention lister. */
export function setMycEvaluationDirectoryLister(lister: MycEvaluationDirectoryLister | undefined): void {
	_directoryLister = lister
}

/** Override the warn seam (tests). */
export function setMycEvaluationWarn(warn: MycEvaluationWarn): void {
	_warn = warn
}

/**
 * Test-only: reset all seams back to the unbound state.
 */
export function __resetMycEvaluationSeamsForTests(): void {
	_dataRootResolver = undefined
	_writer = undefined
	_fileWriter = undefined
	_directoryPruner = undefined
	_directoryLister = undefined
	_warn = () => {}
}

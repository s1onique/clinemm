/**
 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
 *
 * Bounded diagnostic capture for the autonomous-turn boundary
 * (`1 -> 2` cardinality expansion for one `jobId`). Captures
 * load-bearing observation at every production seam capable of
 * starting another model turn, so a single dump can mechanically
 * classify the LIVE occurrence of duplicate completion / duplicate
 * continuation as CC0..CC8 (see 04-live-cardinality-trace.md).
 *
 * Cardinality stages (frozen in this ACT):
 *
 *   C1  terminal_committed          CommandJobManager.finalize
 *   C2  notify_consume_enter        BackgroundNotifyCoordinator.consumeTerminal
 *   C3  wake_created                formatTerminalWakePrompt + enqueueTerminalWake
 *   C4  pending_prompt_enqueued     PendingPromptsController.enqueue
 *   C5  pending_prompt_dequeued     PendingPromptService.shiftNext (drain)
 *   C6  continuation_scheduled      every "start another turn now"
 *   C7  run_turn_started            LocalRuntimeHost.runTurn
 *   C8  agent_turn_done             agent_event {type:"done"} equivalent
 *   C9  submit_and_exit_seen        wasAttemptCompletionSeen + content_end
 *   C10 task_completion_committed   setTurnPhase("completed", ...)
 *
 * Trust binding (mirrors BJLA / BOCOR / TSWPD / THSICAP):
 *   - Default off: the module-level captureEnabled seam starts
 *     false. When disabled, every record is a complete no-op so the
 *     production path semantics are unchanged.
 *   - One user action: the dogfood diagnostic profile resolver
 *     (dogfood-diagnostic-profile.ts) flips the seam at extension
 *     activation in dogfood. There is NO separate env-var, NO
 *     workspace toggle, NO webview surface.
 *   - One dump action: cline.debug.dumpContinuationCardinalityAuthority
 *     serializes the bounded ring to
 *     <globalStorageUri>/continuation-cardinality-authority.jsonl.
 *     The dump is unconditional so an operator can inspect whatever
 *     was captured even after the diagnostic is disabled.
 *   - Bounded: FIFO ring (default 512 records — generous for one
 *     full reproduction including both a notify=true job and its
 *     autonomous continuation / completion commits).
 *   - Privacy-safe: no prompt content, no model output, no tool
 *     args, no turn body. The record only carries the cardinality
 *     identity (seq, at, sessionId, taskId, jobId, stage, origin,
 *     promptId, correlationId) and the capture timestamp.
 *   - Read-only: never mutates the production state shape. Zero new
 *     wire fields, zero React-side state, zero public API.
 *
 * REMOVAL_TRIGGER (per ACT sec 31 / 32):
 *   first 1 -> 2 cardinality seam mechanically identified AND
 *   ablation returns cardinality to 1 (PASS_CONTINUATION_*) - OR -
 *   CAPTURE_INSUFFICIENT - OR - HALT_RED_NOT_REPRODUCED - OR -
 *   better evidence supersedes it. No quiet promotion to
 *   architecture.
 *
 * The contract on `stage` and `origin` is FROZEN in this ACT.
 * Adding a new enum value is a breaking change for the
 * post-capture cardinality tests.
 */

export type ContinuationCardinalityStage =
	| "terminal_committed"
	| "notify_consume_enter"
	| "wake_created"
	| "pending_prompt_enqueued"
	| "pending_prompt_dequeued"
	| "continuation_scheduled"
	| "run_turn_started"
	| "agent_turn_done"
	| "submit_and_exit_seen"
	| "task_completion_committed"

/**
 * Structural identity of the authority that triggered the capture.
 * "unknown" is the default until a subsequent ACT pins it. FROZEN —
 * adding a value is a breaking change.
 */
export type ContinuationCardinalityOrigin =
	| "background_terminal"
	| "pending_prompt_drain"
	| "deferred_continuation"
	| "explicit_user"
	| "mode_continuation"
	| "session_resume"
	| "unknown"

const DEFAULT_BUFFER_SIZE = 512

// -----------------------------------------------------------------------------
// Module-level capture seam. The dogfood diagnostic profile resolver
// sets this once at extension activation; production capture consults
// ONLY this seam.
// -----------------------------------------------------------------------------

let captureEnabled = false

export function isContinuationCardinalityAuthorityCaptureEnabled(): boolean {
	return captureEnabled
}

export function setContinuationCardinalityAuthorityCaptureEnabled(enabled: boolean): void {
	captureEnabled = Boolean(enabled)
}

// -----------------------------------------------------------------------------
// Per-stage counters (cheap monotonic snapshot for the post-capture
// cardinality classification; NOT the same shape as the bounded ring).
// -----------------------------------------------------------------------------

interface PerStageCounter {
	count: number
	origins: Set<ContinuationCardinalityOrigin>
}

const stageCounters: { [K in ContinuationCardinalityStage]: PerStageCounter } = {
	terminal_committed: { count: 0, origins: new Set() },
	notify_consume_enter: { count: 0, origins: new Set() },
	wake_created: { count: 0, origins: new Set() },
	pending_prompt_enqueued: { count: 0, origins: new Set() },
	pending_prompt_dequeued: { count: 0, origins: new Set() },
	continuation_scheduled: { count: 0, origins: new Set() },
	run_turn_started: { count: 0, origins: new Set() },
	agent_turn_done: { count: 0, origins: new Set() },
	submit_and_exit_seen: { count: 0, origins: new Set() },
	task_completion_committed: { count: 0, origins: new Set() },
}

/**
 * Snapshot of the per-stage counts + origins. Read-only.
 *
 * Reset ONLY via `resetContinuationCardinalityAuthorityCounters`
 * (test-only). The production path never resets the counters — the
 * bounded ring is the durable evidence, the counters are the cheap
 * post-capture discriminator.
 */
export interface ContinuationCardinalityCountersSnapshot {
	readonly total: number
	readonly stages: Readonly<{
		[K in ContinuationCardinalityStage]: {
			count: number
			origins: readonly ContinuationCardinalityOrigin[]
		}
	}>
}

export function getContinuationCardinalityAuthorityCounters(): ContinuationCardinalityCountersSnapshot {
	const stages = {} as {
		[K in ContinuationCardinalityStage]: { count: number; origins: readonly ContinuationCardinalityOrigin[] }
	}
	let total = 0
	for (const k of Object.keys(stageCounters) as ContinuationCardinalityStage[]) {
		const c = stageCounters[k]
		stages[k] = { count: c.count, origins: Array.from(c.origins) }
		total += c.count
	}
	return { total, stages: stages as ContinuationCardinalityCountersSnapshot["stages"] }
}

// -----------------------------------------------------------------------------
// Bounded ring of records.
// -----------------------------------------------------------------------------

export interface ContinuationCardinalityAuthorityRecord {
	readonly seq: number
	readonly at: number
	readonly stage: ContinuationCardinalityStage
	readonly origin: ContinuationCardinalityOrigin
	readonly sessionId?: string
	readonly taskId?: string
	readonly jobId?: string
	/** Stable prompt identity from PendingPromptsController when known. */
	readonly promptId?: string
	/** Caller-supplied correlation token (test seam only). */
	readonly correlationId?: string
}

const buffer: ContinuationCardinalityAuthorityRecord[] = []
let bufferSize = DEFAULT_BUFFER_SIZE
let nextSeq = 1

/**
 * Append one cardinality-observation record. Bounded FIFO eviction.
 * No-op when the capture seam is OFF (default). Increments the
 * per-stage counter on the way through so a cheap post-capture
 * count is available without re-reading the ring.
 */
export function captureContinuationCardinalityAuthorityRecord(record: {
	readonly stage: ContinuationCardinalityStage
	readonly origin?: ContinuationCardinalityOrigin
	readonly sessionId?: string
	readonly taskId?: string
	readonly jobId?: string
	readonly promptId?: string
	readonly correlationId?: string
}): void {
	if (!captureEnabled) return
	const origin: ContinuationCardinalityOrigin = record.origin ?? "unknown"
	const rec: ContinuationCardinalityAuthorityRecord = {
		seq: nextSeq++,
		at: Date.now(),
		stage: record.stage,
		origin,
		...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
		...(record.taskId !== undefined ? { taskId: record.taskId } : {}),
		...(record.jobId !== undefined ? { jobId: record.jobId } : {}),
		...(record.promptId !== undefined ? { promptId: record.promptId } : {}),
		...(record.correlationId !== undefined ? { correlationId: record.correlationId } : {}),
	}
	buffer.push(rec)
	if (buffer.length > bufferSize) {
		buffer.shift()
	}
	const counter = stageCounters[record.stage]
	counter.count++
	counter.origins.add(origin)
}

/**
 * Bounded ring reader. Returns the live buffer (callers must not
 * mutate). Mirrors the BJLA reader contract.
 */
export function getContinuationCardinalityAuthorityCaptureRecords(): readonly ContinuationCardinalityAuthorityRecord[] {
	return buffer
}

/**
 * Test-only: clear the ring + counters + seq. Production code never
 * calls this; the dump command does NOT clear (dump != clear — an
 * accidental first dump must not destroy evidence).
 */
export function clearContinuationCardinalityAuthorityCapture(): void {
	buffer.length = 0
	nextSeq = 1
	for (const k of Object.keys(stageCounters) as ContinuationCardinalityStage[]) {
		stageCounters[k].count = 0
		stageCounters[k].origins.clear()
	}
}

/**
 * Test-only: override the ring buffer size.
 */
export function setContinuationCardinalityAuthorityCaptureBufferSize(size: number): void {
	const clamped = Math.max(0, Math.floor(size))
	bufferSize = clamped
	if (buffer.length > bufferSize) {
		buffer.length = bufferSize
	}
}

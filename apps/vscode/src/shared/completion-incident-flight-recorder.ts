/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01
 *
 * Bounded, per-incident causal flight recorder for the completion
 * barrier (BCB) decision chain in
 * `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The prior diagnostic layer answers "how many times did X happen?"
 * but NOT "why did THIS task's completion get held, and what
 * happened to the barrier afterwards?".
 *
 * Three specific gaps this module closes:
 *
 *   1. COVERAGE. The existing BCB capture
 *      (`@shared/bcb-observation-unavailable-capture`) only fires in
 *      the ELIGIBLE coalesced-continuation branch. A hold caused by
 *      pending-prompt uncertainty, unconsumed terminal results, or
 *      a running owner is NOT recorded at all.
 *   2. CORRELATION. The upstream counters
 *      (`./completion-continuation-upstream-runtime`) are
 *      PROCESS-WIDE aggregates. After the user switches tasks,
 *      `sessionMismatch=1` cannot be attributed to the task that
 *      actually suffered it.
 *   3. IDENTITY. A boolean mismatch counter cannot say WHICH
 *      identity mismatched. The marker identity and the active
 *      session identity must both be captured.
 *
 * DESIGN
 * ------
 * Per-task CAPSULES, not a global aggregate:
 *   - Every record belongs to a task capsule, keyed by taskId.
 *   - The recorder keeps recent capsules so switching to task B does
 *     NOT evict task A's evidence.
 *   - The last N (default 4) ANOMALOUS capsules are retained even
 *     after newer tasks become active, so the incident that the user
 *     is investigating is still present at dump time.
 *
 * Strictly bounded:
 *   - Per-capsule record cap (ring).
 *   - Global capsule cap (oldest-first eviction, anomalous last).
 *   - Global record cap with EXPLICIT eviction accounting — a
 *     truncated capture is reported, never silently presented as
 *     complete.
 *
 * The `NOT_EVALUATED` distinction is load-bearing: a predicate that
 * was never consulted on a branch MUST NOT be reported as `false`,
 * because "false" would assert a fact production never established.
 *
 * PRIVACY
 * -------
 * Records carry identities, predicate VALUES, counts and phase
 * names. They never carry prompt text, credentials, command output,
 * tool arguments, or raw provider payloads. Held job ids are OPAQUE
 * identifiers (not command text) and are carried as ids only.
 *
 * Trust binding (mirrors TSWPD / BCAPT01 / CCARD):
 *   - Default off: `enabled` starts false. When disabled, every
 *     record call is a complete no-op — production path semantics
 *     are unchanged.
 *   - No new env var. The enablement is owned by the central
 *     dogfood diagnostic profile.
 *   - Read-only: never mutates production state shape. Zero new
 *     wire fields, zero React-side state, zero new public API.
 *   - The `barrierId` is DIAGNOSTIC ONLY. It is minted here and
 *     never fed back into the runtime's identity model, the marker,
 *     the epoch, or any public protocol.
 */

import type { TurnPhase } from "./ExtensionMessage"

/**
 * The envelope carried by every causal record. `schemaVersion` is
 * bumped when the envelope SHAPE changes (not when a stage is
 * added) so an operator can tell the two apart.
 */
export const COMPLETION_INCIDENT_SCHEMA_VERSION = 1

/**
 * The decision boundaries the recorder can observe. FROZEN for this
 * ACT: adding a value is a breaking change for consumers that
 * enumerate the stage set.
 *
 * - `completion_attempt`     — the C10 completion attempt boundary.
 * - `barrier_registration`   — the BCB marker registration.
 * - `barrier_reevaluation`   — the BCB re-evaluation (marker vs active).
 * - `early_return`           — the exact branch/predicate that returned early.
 * - `marker_clearance`       — why the marker was cleared.
 * - `continuation`           — the bounded coalesced continuation.
 * - `completion_authority`   — the final Elm authority decision.
 */
export type CompletionIncidentStage =
	| "completion_attempt"
	| "barrier_registration"
	| "barrier_reevaluation"
	| "early_return"
	| "marker_clearance"
	| "continuation"
	| "completion_authority"

/**
 * The tri-state used for predicate values. `NOT_EVALUATED` means the
 * production code never consulted the predicate on this branch — it
 * is NOT the same as `false`.
 */
export type CompletionIncidentPredicateValue = boolean | number | string | null | "NOT_EVALUATED"

/**
 * The identity triple the runtime already uses. The marker identity
 * and the active identity are captured SEPARATELY so a mismatch can
 * be attributed precisely.
 */
export interface CompletionIncidentIdentity {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly epoch: number
}

export interface CompletionIncidentRecord {
	readonly schemaVersion: number
	/** Monotonic, process-wide, 1-based sequence. Orders the timeline. */
	readonly eventSeq: number
	/** ISO-8601 UTC timestamp. */
	readonly timestamp: string
	readonly taskId: string | undefined
	readonly sessionId: string
	readonly epoch: number
	/** Diagnostic-only identity of the coordinator instance. */
	readonly coordinatorInstanceId: string
	/** Diagnostic-only barrier correlation id. NEVER enters the runtime identity model. */
	readonly barrierId: string
	readonly stage: CompletionIncidentStage
	/** The bounded outcome vocabulary for this stage. */
	readonly outcome: string
	/** The predicate values production actually evaluated on this branch. */
	readonly predicates: Readonly<Record<string, CompletionIncidentPredicateValue>>
	/** The identity of the marker as registered. Absent when no marker exists. */
	readonly markerIdentity?: CompletionIncidentIdentity
	/** The identity of the currently active session/task/epoch. */
	readonly activeIdentity?: CompletionIncidentIdentity
	/** The phase writer identity, when the boundary wrote or consulted a phase. */
	readonly phaseWriter?: string
	/** The phase value, when the boundary wrote or consulted a phase. */
	readonly phase?: TurnPhase
	/** Extra bounded, privacy-safe detail (counts, opaque ids, capability names). */
	readonly detail?: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>
}

/**
 * A per-task capsule. The capsule is the unit of retention: an
 * anomalous capsule survives the user switching to another task.
 */
export interface CompletionIncidentCapsule {
	readonly taskId: string | undefined
	readonly records: readonly CompletionIncidentRecord[]
	/** True when the capsule contains at least one anomalous record. */
	readonly anomalous: boolean
	/** The highest epoch observed in this capsule. */
	readonly lastEpoch: number
	/** The most recent sessionId observed in this capsule. */
	readonly lastSessionId: string
	/** Records dropped from this capsule by the per-capsule ring bound. */
	readonly droppedRecords: number
}

export interface CompletionIncidentRecorderStats {
	readonly enabled: boolean
	readonly totalRecords: number
	readonly capsuleCount: number
	/** Capsules evicted because the global capsule cap was reached. */
	readonly evictedCapsules: number
	/** Records evicted because the global record cap was reached. */
	readonly evictedRecords: number
	/** Records dropped inside a capsule by the per-capsule ring bound. */
	readonly capsuleDroppedRecords: number
	/**
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	 * Capsules DROPPED BY CHECKPOINT TRUNCATION. The persisted
	 * checkpoint is a bounded artifact; when the serialized form
	 * exceeded the byte bound the oldest capsules were dropped to
	 * fit. That is EVIDENCE LOSS and it is counted here so the
	 * bundle can declare it — a truncated capture is never
	 * presented as complete.
	 */
	readonly checkpointTruncatedCapsules: number
	/** Records dropped by checkpoint truncation (capsule-level count). */
	readonly checkpointTruncatedRecords: number
	/** Number of checkpoints that failed to persist. */
	readonly failedCheckpoints: number
	/** Number of successful checkpoints. */
	readonly successfulCheckpoints: number
}

// ============================================================================
// BOUNDS
// ============================================================================

/**
 * Per-capsule record cap. Generous for one incident reproduction
 * (the causal chain of a single held completion) and small enough
 * that 16 capsules cannot exhaust the extension host.
 */
const DEFAULT_CAPSULE_RECORD_CAP = 256

/**
 * Global capsule cap. The recorder keeps the RECENT capsules so a
 * task switch does not evict the incident under investigation.
 */
const DEFAULT_CAPSULE_CAP = 16

/**
 * How many ANOMALOUS capsules are retained even after newer tasks
 * become active. This is the ACT requirement: "Retain the last four
 * anomalous task capsules even when another task becomes active."
 */
const DEFAULT_ANOMALOUS_CAPSULE_RETENTION = 4

/**
 * Global record cap across all capsules. Exceeding it evicts the
 * OLDEST records and increments `evictedRecords` so the manifest can
 * report the loss explicitly.
 */
const DEFAULT_GLOBAL_RECORD_CAP = 2048

/**
 * A record is ANOMALOUS when it records a hold, a mismatch, a
 * clearance, a rejected continuation, or a withheld completion. The
 * normal-completion path records none of these.
 */
const ANOMALOUS_OUTCOMES = new Set<string>([
	"held",
	"session_mismatch",
	"task_mismatch",
	"epoch_mismatch",
	"session_missing",
	"marker_missing",
	"released",
	"rejected",
	"withheld",
	"failed",
	"blocked",
	"not_delivered",
	"suppressed",
	"observation_unavailable",
	"stalled_no_progress",
	"delivery_rejected",
])

function isAnomalousOutcome(outcome: string): boolean {
	return ANOMALOUS_OUTCOMES.has(outcome)
}

// ============================================================================
// STATE
// ============================================================================

interface RecorderState {
	enabled: boolean
	seq: number
	capsules: Map<string, CompletionIncidentCapsule>
	/** Insertion order of capsule keys, oldest first. */
	capsuleOrder: string[]
	evictedCapsules: number
	evictedRecords: number
	capsuleDroppedRecords: number
	/**
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	 * Capsules dropped by CHECKPOINT TRUNCATION (the persisted
	 * checkpoint exceeded its byte bound). Counted as evidence loss.
	 */
	checkpointTruncatedCapsules: number
	/**
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	 * Records dropped by CHECKPOINT TRUNCATION.
	 */
	checkpointTruncatedRecords: number
	failedCheckpoints: number
	successfulCheckpoints: number
	/**
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	 * The diagnostic barrier-lifecycle map. Keyed by the LIFECYCLE
	 * identity `(coordinatorInstanceId, sessionId, taskId, epoch)`;
	 * the value is the stable diagnostic barrier id for that
	 * lifecycle. A re-registration within the SAME epoch reuses the
	 * SAME id (it is the same obligation); a NEW epoch mints a NEW
	 * id (it is a new lifecycle).
	 *
	 * This map is DIAGNOSTIC ONLY. It never enters the runtime
	 * identity model, the marker, or any protocol.
	 */
	barrierLifecycles: Map<string, string>
	/**
	 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	 * Monotonic counter backing the minted barrier-lifecycle ids.
	 */
	barrierLifecycleSeq: number
}

function freshState(): RecorderState {
	return {
		enabled: false,
		seq: 0,
		capsules: new Map(),
		capsuleOrder: [],
		evictedCapsules: 0,
		evictedRecords: 0,
		capsuleDroppedRecords: 0,
		checkpointTruncatedCapsules: 0,
		checkpointTruncatedRecords: 0,
		failedCheckpoints: 0,
		successfulCheckpoints: 0,
		barrierLifecycles: new Map(),
		barrierLifecycleSeq: 0,
	}
}

let state: RecorderState = freshState()

let capsuleRecordCap = DEFAULT_CAPSULE_RECORD_CAP
let capsuleCap = DEFAULT_CAPSULE_CAP
let anomalousCapsuleRetention = DEFAULT_ANOMALOUS_CAPSULE_RETENTION
let globalRecordCap = DEFAULT_GLOBAL_RECORD_CAP

/**
 * The coordinator-instance identity. Diagnostic only — it never
 * participates in the runtime identity model.
 */
let coordinatorInstanceId = "coordinator-unknown"

function capsuleKey(taskId: string | undefined): string {
	return taskId ?? "(none)"
}

// ============================================================================
// ENABLEMENT
// ============================================================================

export function isCompletionIncidentFlightRecorderEnabled(): boolean {
	return state.enabled
}

export function setCompletionIncidentFlightRecorderEnabled(enabled: boolean): void {
	state.enabled = enabled
}

/**
 * Set the diagnostic-only coordinator instance identity. Called by the
 * coordinator constructor. This id is NEVER used for identity
 * comparison — only for timeline correlation.
 */
export function setCompletionIncidentCoordinatorInstanceId(instanceId: string): void {
	coordinatorInstanceId = instanceId
}

export function getCompletionIncidentCoordinatorInstanceId(): string {
	return coordinatorInstanceId
}

// ============================================================================
// BOUND CONFIGURATION (tests)
// ============================================================================

export function setCompletionIncidentRecorderBounds(options: {
	capsuleRecordCap?: number
	capsuleCap?: number
	anomalousCapsuleRetention?: number
	globalRecordCap?: number
}): void {
	if (options.capsuleRecordCap !== undefined) capsuleRecordCap = Math.max(1, options.capsuleRecordCap)
	if (options.capsuleCap !== undefined) capsuleCap = Math.max(1, options.capsuleCap)
	if (options.anomalousCapsuleRetention !== undefined) {
		anomalousCapsuleRetention = Math.max(0, options.anomalousCapsuleRetention)
	}
	if (options.globalRecordCap !== undefined) globalRecordCap = Math.max(1, options.globalRecordCap)
}

export function resetCompletionIncidentRecorderBounds(): void {
	capsuleRecordCap = DEFAULT_CAPSULE_RECORD_CAP
	capsuleCap = DEFAULT_CAPSULE_CAP
	anomalousCapsuleRetention = DEFAULT_ANOMALOUS_CAPSULE_RETENTION
	globalRecordCap = DEFAULT_GLOBAL_RECORD_CAP
}

// ============================================================================
// RECORDING
// ============================================================================

/**
 * The input shape for a causal record. `outcome` is REQUIRED — every
 * causal record states what was decided. `predicates` carries the
 * values production actually evaluated on this branch; a predicate
 * that was not consulted is simply ABSENT (the reader treats an
 * absent predicate as NOT_EVALUATED).
 */
export interface CompletionIncidentRecordInput {
	readonly stage: CompletionIncidentStage
	readonly outcome: string
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly epoch: number
	readonly barrierId?: string
	readonly predicates?: Readonly<Record<string, CompletionIncidentPredicateValue>>
	readonly markerIdentity?: CompletionIncidentIdentity
	readonly activeIdentity?: CompletionIncidentIdentity
	readonly phaseWriter?: string
	readonly phase?: TurnPhase
	readonly detail?: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>
}

/**
 * Record one causal record.
 *
 * This is a complete no-op when the recorder is disabled — the
 * production path semantics are unchanged (no allocation, no counter
 * mutation, no observable state change).
 *
 * The record is appended to the capsule for `taskId`. The per-capsule
 * ring bound evicts the OLDEST record in that capsule; the global
 * record bound evicts the oldest records globally. Both evictions are
 * COUNTED so the dump can report the loss explicitly.
 */
export function recordCompletionIncident(input: CompletionIncidentRecordInput): void {
	if (!state.enabled) {
		return
	}
	state.seq += 1
	const record: CompletionIncidentRecord = {
		schemaVersion: COMPLETION_INCIDENT_SCHEMA_VERSION,
		eventSeq: state.seq,
		timestamp: new Date().toISOString(),
		taskId: input.taskId,
		sessionId: input.sessionId,
		epoch: input.epoch,
		coordinatorInstanceId,
		barrierId: input.barrierId ?? mintBarrierId(input),
		stage: input.stage,
		outcome: input.outcome,
		predicates: input.predicates ?? {},
		...(input.markerIdentity ? { markerIdentity: input.markerIdentity } : {}),
		...(input.activeIdentity ? { activeIdentity: input.activeIdentity } : {}),
		...(input.phaseWriter ? { phaseWriter: input.phaseWriter } : {}),
		...(input.phase ? { phase: input.phase } : {}),
		...(input.detail ? { detail: input.detail } : {}),
	}
	appendToCapsule(record)
	enforceGlobalRecordCap()
}

/**
 * Mint a diagnostic-only barrier id. It correlates the records of ONE
 * barrier lifecycle. It is derived from the diagnostic coordinator
 * instance and the LIFECYCLE identity — NEVER from the runtime
 * identity model, and it is never written back into the marker.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * The id MUST be STABLE across the whole lifecycle. The previous
 * implementation embedded `state.seq` — the process-wide event
 * counter — in the id, so EVERY record of one lifecycle got a
 * DIFFERENT id and the causal chain could not be followed through
 * the timeline. The coordinator never supplied an explicit id, so
 * the broken fallback was always taken.
 *
 * The id is now keyed by the LIFECYCLE identity
 * `(coordinatorInstanceId, sessionId, taskId, epoch)`:
 *
 *   - registration → re-evaluation → clearance → completion in the
 *     SAME epoch share ONE id (it is the same obligation);
 *   - a re-registration WITHIN the same epoch reuses the SAME id;
 *   - a NEW epoch mints a NEW id (it is a new lifecycle).
 */
function mintBarrierId(input: CompletionIncidentRecordInput): string {
	const lifecycleKey = [coordinatorInstanceId, input.sessionId, input.taskId ?? "none", String(input.epoch)].join("|")
	const existing = state.barrierLifecycles.get(lifecycleKey)
	if (existing) {
		return existing
	}
	state.barrierLifecycleSeq += 1
	const minted = `barrier-${coordinatorInstanceId}-${input.sessionId}-${input.taskId ?? "none"}-${input.epoch}-${state.barrierLifecycleSeq}`
	state.barrierLifecycles.set(lifecycleKey, minted)
	return minted
}

/**
 * Append a record to its task capsule, applying the per-capsule ring
 * bound.
 */
function appendToCapsule(record: CompletionIncidentRecord): void {
	const key = capsuleKey(record.taskId)
	const existing = state.capsules.get(key)
	const anomalous = isAnomalousOutcome(record.outcome)
	if (!existing) {
		state.capsules.set(key, {
			taskId: record.taskId,
			records: [record],
			anomalous: anomalous,
			lastEpoch: record.epoch,
			lastSessionId: record.sessionId,
			droppedRecords: 0,
		})
		state.capsuleOrder.push(key)
		enforceCapsuleCap()
		return
	}
	// Append, then trim to the per-capsule cap.
	const records = existing.records.concat(record)
	let dropped = existing.droppedRecords
	while (records.length > capsuleRecordCap) {
		records.shift()
		dropped += 1
		state.capsuleDroppedRecords += 1
	}
	state.capsules.set(key, {
		taskId: existing.taskId,
		records,
		anomalous: existing.anomalous || anomalous,
		lastEpoch: Math.max(existing.lastEpoch, record.epoch),
		lastSessionId: record.sessionId,
		droppedRecords: dropped,
	})
}

/**
 * Enforce the global capsule cap.
 *
 * The eviction order preserves the ACT requirement: ANOMALOUS
 * capsules are the LAST to be evicted. A capsule is evicted only
 * when it is neither anomalous nor among the most recent
 * `anomalousCapsuleRetention` anomalous capsules.
 */
function enforceCapsuleCap(): void {
	while (state.capsuleOrder.length > capsuleCap) {
		const victimKey = selectCapsuleToEvict()
		if (victimKey === undefined) {
			// Every capsule is protected (all anomalous within the
			// retention window). Evict the oldest anyway rather than
			// growing without bound; the loss is reported.
			const oldest = state.capsuleOrder[0]
			if (oldest === undefined) return
			state.capsuleOrder.shift()
			state.capsules.delete(oldest)
			state.evictedCapsules += 1
			continue
		}
		const idx = state.capsuleOrder.indexOf(victimKey)
		if (idx >= 0) state.capsuleOrder.splice(idx, 1)
		state.capsules.delete(victimKey)
		state.evictedCapsules += 1
	}
}

/**
 * Choose the capsule to evict: the OLDEST capsule that is not
 * protected. A capsule is protected when it is anomalous AND is among
 * the last `anomalousCapsuleRetention` anomalous capsules.
 */
function selectCapsuleToEvict(): string | undefined {
	const anomalousKeys = state.capsuleOrder.filter((key) => state.capsules.get(key)?.anomalous === true)
	const protectedAnomalous = new Set(anomalousKeys.slice(Math.max(0, anomalousKeys.length - anomalousCapsuleRetention)))
	for (const key of state.capsuleOrder) {
		const capsule = state.capsules.get(key)
		if (capsule?.anomalous === true && protectedAnomalous.has(key)) {
			continue
		}
		return key
	}
	return undefined
}

/**
 * Enforce the global record cap by evicting the oldest records
 * globally. Loss is counted and reported.
 */
function enforceGlobalRecordCap(): void {
	let total = 0
	for (const key of state.capsuleOrder) {
		total += state.capsules.get(key)?.records.length ?? 0
	}
	if (total <= globalRecordCap) {
		return
	}
	let overflow = total - globalRecordCap
	while (overflow > 0) {
		// Find the oldest capsule that still has records.
		let victimKey: string | undefined
		for (const key of state.capsuleOrder) {
			const capsule = state.capsules.get(key)
			if (capsule && capsule.records.length > 0) {
				victimKey = key
				break
			}
		}
		if (victimKey === undefined) break
		const capsule = state.capsules.get(victimKey)
		if (!capsule) break
		const records = capsule.records.slice()
		records.shift()
		state.capsules.set(victimKey, {
			taskId: capsule.taskId,
			records,
			anomalous: capsule.anomalous,
			lastEpoch: capsule.lastEpoch,
			lastSessionId: capsule.lastSessionId,
			droppedRecords: capsule.droppedRecords + 1,
		})
		state.capsuleDroppedRecords += 1
		state.evictedRecords += 1
		overflow -= 1
	}
}

// ============================================================================
// READING
// ============================================================================

/**
 * All capsules in insertion order, oldest first.
 */
export function getCompletionIncidentCapsules(): readonly CompletionIncidentCapsule[] {
	return state.capsuleOrder.map((key) => state.capsules.get(key)).filter((c): c is CompletionIncidentCapsule => c !== undefined)
}

/**
 * All records across all capsules, ordered by their global event
 * sequence. This is the timeline the bundle's `barrier-timeline.jsonl`
 * is built from.
 */
export function getCompletionIncidentRecords(): readonly CompletionIncidentRecord[] {
	const all: CompletionIncidentRecord[] = []
	for (const capsule of getCompletionIncidentCapsules()) {
		all.push(...capsule.records)
	}
	all.sort((a, b) => a.eventSeq - b.eventSeq)
	return all
}

/**
 * The records of a single task capsule, if present.
 */
export function getCompletionIncidentCapsuleForTask(taskId: string | undefined): CompletionIncidentCapsule | undefined {
	return state.capsules.get(capsuleKey(taskId))
}

/**
 * The task ids of every retained capsule.
 */
export function getCompletionIncidentRetainedTaskIds(): readonly (string | undefined)[] {
	return getCompletionIncidentCapsules().map((c) => c.taskId)
}

export function getCompletionIncidentRecorderStats(): CompletionIncidentRecorderStats {
	let totalRecords = 0
	for (const capsule of getCompletionIncidentCapsules()) {
		totalRecords += capsule.records.length
	}
	return {
		enabled: state.enabled,
		totalRecords,
		capsuleCount: state.capsules.size,
		evictedCapsules: state.evictedCapsules,
		evictedRecords: state.evictedRecords,
		capsuleDroppedRecords: state.capsuleDroppedRecords,
		checkpointTruncatedCapsules: state.checkpointTruncatedCapsules,
		checkpointTruncatedRecords: state.checkpointTruncatedRecords,
		failedCheckpoints: state.failedCheckpoints,
		successfulCheckpoints: state.successfulCheckpoints,
	}
}

/**
 * True when the recorder dropped evidence. The bundle manifest MUST
 * report this so a truncated capture is never presented as complete.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * CHECKPOINT TRUNCATION is evidence loss too. The previous
 * implementation ignored it, so after a restart the bundle could
 * report `evidenceLoss: false` even though records had been dropped
 * while shrinking the persisted checkpoint to fit its byte bound.
 */
export function hasCompletionIncidentEvidenceLoss(): boolean {
	const stats = getCompletionIncidentRecorderStats()
	return (
		stats.evictedCapsules > 0 ||
		stats.evictedRecords > 0 ||
		stats.capsuleDroppedRecords > 0 ||
		stats.checkpointTruncatedCapsules > 0 ||
		stats.checkpointTruncatedRecords > 0
	)
}

// ============================================================================
// CHECKPOINTING
// ============================================================================

/**
 * A serializable checkpoint of the recorder's capsules. The
 * checkpoint is what lets an anomalous capsule survive an
 * extension-host restart or a task switch.
 */
export interface CompletionIncidentCheckpoint {
	readonly schemaVersion: number
	readonly savedAt: string
	readonly capsules: readonly {
		readonly taskId: string | undefined
		readonly records: readonly CompletionIncidentRecord[]
		readonly anomalous: boolean
		readonly lastEpoch: number
		readonly lastSessionId: string
		readonly droppedRecords: number
	}[]
	readonly stats: CompletionIncidentRecorderStats
}

/**
 * Serialize the current recorder state for persistence. Pure — no
 * I/O, no mutation. The caller owns the write and MUST NOT block
 * production execution on it.
 */
export function buildCompletionIncidentCheckpoint(): CompletionIncidentCheckpoint {
	return {
		schemaVersion: COMPLETION_INCIDENT_SCHEMA_VERSION,
		savedAt: new Date().toISOString(),
		capsules: getCompletionIncidentCapsules().map((c) => ({
			taskId: c.taskId,
			records: c.records,
			anomalous: c.anomalous,
			lastEpoch: c.lastEpoch,
			lastSessionId: c.lastSessionId,
			droppedRecords: c.droppedRecords,
		})),
		stats: getCompletionIncidentRecorderStats(),
	}
}

/**
 * Restore capsules from a checkpoint. Used on extension-host startup
 * so a capsule checkpointed on task switch (or on shutdown) survives
 * the restart.
 *
 * The restore is bounded by the SAME caps: the per-capsule ring and
 * the global capsule cap are re-applied, so a hostile or corrupt
 * checkpoint cannot grow the recorder without bound.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * The checkpoint's LOSS STATISTICS are restored too. The previous
 * implementation restored the capsules but NOT the eviction/failure
 * statistics, so after a restart the bundle could report
 * `evidenceLoss: false` even though records had been lost (for
 * example while the checkpoint was truncated to fit its byte bound).
 * The restored counters are ADDED to the live counters — the restore
 * never erases loss that already happened in this process.
 */
export function restoreCompletionIncidentCheckpoint(checkpoint: CompletionIncidentCheckpoint | undefined): void {
	if (!checkpoint || checkpoint.schemaVersion !== COMPLETION_INCIDENT_SCHEMA_VERSION) {
		return
	}
	for (const capsule of checkpoint.capsules) {
		const key = capsuleKey(capsule.taskId)
		if (state.capsules.has(key)) {
			continue
		}
		const records = capsule.records.slice(-capsuleRecordCap)
		const dropped = capsule.droppedRecords + (capsule.records.length - records.length)
		if (dropped > 0) state.capsuleDroppedRecords += dropped
		state.capsules.set(key, {
			taskId: capsule.taskId,
			records,
			anomalous: capsule.anomalous,
			lastEpoch: capsule.lastEpoch,
			lastSessionId: capsule.lastSessionId,
			droppedRecords: dropped,
		})
		state.capsuleOrder.push(key)
	}
	enforceCapsuleCap()
	// Continue the sequence past anything restored so the timeline
	// stays strictly ordered.
	for (const capsule of checkpoint.capsules) {
		for (const record of capsule.records) {
			if (record.eventSeq > state.seq) {
				state.seq = record.eventSeq
			}
		}
	}
	// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	// Restore the PREVIOUS eviction / failure / truncation
	// statistics. Without this, a restart silently resets the loss
	// accounting and the bundle reports `evidenceLoss: false` for a
	// capture that DID lose records.
	//
	// The TRUNCATION counters are restored as a HIGH-WATER MARK
	// (the maximum), because the checkpoint carries the CUMULATIVE
	// truncation count — adding it would double-count the same
	// truncation that the live process already recorded.
	const restored = checkpoint.stats
	if (restored) {
		state.evictedCapsules += restored.evictedCapsules ?? 0
		state.evictedRecords += restored.evictedRecords ?? 0
		state.capsuleDroppedRecords += restored.capsuleDroppedRecords ?? 0
		state.checkpointTruncatedCapsules = Math.max(state.checkpointTruncatedCapsules, restored.checkpointTruncatedCapsules ?? 0)
		state.checkpointTruncatedRecords = Math.max(state.checkpointTruncatedRecords, restored.checkpointTruncatedRecords ?? 0)
		state.failedCheckpoints += restored.failedCheckpoints ?? 0
		state.successfulCheckpoints += restored.successfulCheckpoints ?? 0
	}
}

/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * Record the evidence LOST while the persisted checkpoint was
 * truncated to fit its byte bound.
 *
 * The caller (`completion-incident-checkpoint-runtime.ts`) computes
 * how many capsules the bounded builder had to drop and reports them
 * here. The previous implementation DISCARDED that count, so the
 * truncation silently lost evidence with no trace in the loss
 * accounting.
 *
 * The counts are ABSOLUTE (cumulative), not deltas: the recorder
 * keeps the HIGHEST value it has been told. A repeated checkpoint
 * therefore never double-counts the same truncation, and the value
 * still survives a restart (the checkpoint carries the cumulative
 * count in its own `stats` block, which the restore adds).
 */
export function recordCompletionIncidentCheckpointTruncation(droppedCapsules: number, droppedRecords: number): void {
	if (droppedCapsules > state.checkpointTruncatedCapsules) {
		state.checkpointTruncatedCapsules = droppedCapsules
	}
	if (droppedRecords > state.checkpointTruncatedRecords) {
		state.checkpointTruncatedRecords = droppedRecords
	}
}

/**
 * Record the outcome of a checkpoint write so the bundle can report
 * failed checkpoints explicitly.
 */
export function recordCompletionIncidentCheckpointOutcome(succeeded: boolean): void {
	if (succeeded) {
		state.successfulCheckpoints += 1
	} else {
		state.failedCheckpoints += 1
	}
}

// ============================================================================
// TEST CONTROL
// ============================================================================

/**
 * Clear every recorded capsule AND reset the counters. Test-only.
 * The dump command NEVER calls this (dump != clear).
 */
export function clearCompletionIncidentRecorder(): void {
	state.capsules.clear()
	state.capsuleOrder = []
	state.seq = 0
	state.evictedCapsules = 0
	state.evictedRecords = 0
	state.capsuleDroppedRecords = 0
	state.checkpointTruncatedCapsules = 0
	state.checkpointTruncatedRecords = 0
	state.failedCheckpoints = 0
	state.successfulCheckpoints = 0
	// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
	// The barrier-lifecycle map is CLEARED too — a fresh process
	// starts a fresh lifecycle map, so the same identity in the new
	// process gets a NEW barrier id (it is a new coordinator
	// instance and therefore a new lifecycle).
	state.barrierLifecycles.clear()
	state.barrierLifecycleSeq = 0
}

/**
 * Reset the module to its exact default state (disabled + empty).
 * Test-only.
 */
export function resetCompletionIncidentRecorderForTests(): void {
	state = freshState()
	resetCompletionIncidentRecorderBounds()
	coordinatorInstanceId = "coordinator-unknown"
}

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 15 — Differential recorder.
 *
 * Bounded ring buffer of classified divergences. Privacy-safe
 * (ELM10 / Phase 15 strict contract):
 *
 *   - NO message prose
 *   - NO assistant text / reasoning
 *   - NO tool arguments or outputs
 *   - NO API payloads
 *   - NO control keys
 *   - NO file contents
 *
 * Only typed state. Every record is tagged with a `classification`
 * from the D00–D10 taxonomy and, when a divergence exists, an
 * `arbitration` outcome (LEGACY_CORRECT / SHADOW_CORRECT /
 * BOTH_VALID_DIFFERENT_PROJECTION / INSUFFICIENT_EVIDENCE).
 *
 * INVARIANT VIOLATIONS
 *
 * The shadow's invariant library (`TaskInvariantViolation[]`) is
 * evaluated after every observation. When `invariantViolations > 0`
 * the recorder surfaces a hard diagnostic — the `onInvariantViolation`
 * hook is invoked synchronously and a counter is incremented. Tests
 * and qualification builds assert this counter stays at 0.
 *
 * EFFECT_EXECUTION_ENABLED is FALSE. The recorder is observation-only;
 * it never writes to legacy state, the webview, or the runtime.
 */
import { TaskState } from "@cline/agents"
import type { AgentRunStatus, AgentRuntimeExecutionState, RecoveryState } from "@cline/shared"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { TaskShadowDivergence } from "./task-state-shadow"
import type { TaskShadowRuntimeOrigin } from "./task-state-shadow-host-wiring"

type TaskInvariantViolation = TaskState.TaskInvariantViolation
type TaskMsg = TaskState.TaskMsg
type TaskModel = TaskState.TaskModel

/**
 * Divergence classification per the E5-E6 contract. Stable strings —
 * referenced from qualification reports and downstream tooling.
 */
export type DivergenceClass =
	| "D00_AGREE"
	| "D01_LEGACY_FALSE_IDLE"
	| "D02_SHADOW_FALSE_ACTIVE"
	| "D03_TERMINAL_ORDERING"
	| "D04_APPROVAL_PRECEDENCE"
	| "D05_TOOL_CARDINALITY"
	| "D06_RESUME_BOUNDARY"
	| "D07_FAILURE_MAPPING"
	| "D08_FOLLOWUP_EXTERNAL"
	| "D09_EVENT_GAP"
	| "D10_UNKNOWN"
	| "D11_HOST_PREENGAGED"

export type ArbitrationOutcome = "LEGACY_CORRECT" | "SHADOW_CORRECT" | "BOTH_VALID_DIFFERENT_PROJECTION" | "INSUFFICIENT_EVIDENCE"

/**
 * Privacy-safe differential record. Field allowlist is enforced by
 * the structural test in `task-state-shadow-recorder.test.ts`.
 */
export interface TaskShadowDifferentialRecord {
	readonly seq: number
	readonly timestamp: number
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01 R5:
	 * The origin that produced this record. Persisted on every
	 * record so downstream qualification can answer "which authority
	 * path generated this observation" without consulting the
	 * suppression counters.
	 */
	readonly origin: TaskShadowRuntimeOrigin
	readonly event: TaskMsg["type"] | "noop"
	readonly legacyPhase: TurnPhase
	readonly shadowPhase: TurnPhase
	readonly lifecycleKind: string
	readonly modelStreaming: boolean
	readonly activeToolCount: number
	readonly awaitingApproval: boolean
	readonly toolCalls: number
	readonly recoveryBudgetFailures: number
	/** Opaque task-local key; never the visible `taskId`. */
	readonly taskEpochOrOpaqueTaskKey?: string
	/** Optional runtime status carry-through. */
	readonly runtimeStatus?: AgentRunStatus
	readonly classification: DivergenceClass
	readonly arbitration?: ArbitrationOutcome
}

/**
 * Per-record inputs from the comparator. Bundled so the recorder has
 * one boundary; never carries raw legacy `AgentEvent`s.
 */
export interface TaskShadowRecordInput {
	readonly seq: number
	readonly timestamp: number
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01 R5:
	 * Origin of the ingress that produced this record. Persisted
	 * onto the differential record (`TaskShadowDifferentialRecord.origin`)
	 * for downstream qualification. The recorder treats this as
	 * authoritative; the unified coordinator MUST set it on every
	 * record it persists.
	 */
	readonly origin: TaskShadowRuntimeOrigin
	readonly divergence: TaskShadowDivergence | undefined
	readonly observationEvent: TaskMsg["type"] | "noop"
	readonly observationLifecycleKind: string
	readonly observationModel: TaskModel
	readonly observationToolCalls: number
	readonly observationRecoveryBudgetFailures: number
	/** Optional opaque task-local key supplied by the host wiring. */
	readonly taskEpochOrOpaqueTaskKey?: string
	/** Optional runtime status carry-through from the host wiring. */
	readonly runtimeStatus?: AgentRunStatus
	/**
	 * Canonical arbiter projections read from `AgentRuntime.snapshot()`.
	 * Always supplied by the host wiring — the recorder never reads
	 * AgentRuntime directly.
	 */
	readonly arbiter: ArbiterSnapshot
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
	 * Optional classification override supplied by the unified
	 * observation coordinator. When present, the recorder uses this
	 * value INSTEAD of its built-in classifier. Currently used for
	 * `D11_HOST_PREENGAGED` — the host-pre-engaged window is
	 * classified by the coordinator (which owns the
	 * canonical-vs-legacy vocabulary mismatch semantics), not by
	 * the recorder's projection classifier.
	 */
	readonly classificationOverride?: DivergenceClass
	/**
	 * C2.2: optional arbitration override supplied alongside the
	 * classification override. When present, the recorder uses this
	 * value INSTEAD of its built-in `arbitrate()`. Used together
	 * with `classificationOverride` for D11 (host-pre-engaged is
	 * arbitrated as `BOTH_VALID_DIFFERENT_PROJECTION` because the
	 * legacy "streaming" and canonical "model not streaming"
	 * projections answer different questions).
	 */
	readonly arbitrationOverride?: ArbitrationOutcome
}

/**
 * Snapshot of the canonical runtime facts the recorder uses to
 * classify / arbitrate a divergence. The recorder treats any field
 * as authoritative; the host wiring is responsible for ensuring these
 * reflect `AgentRuntime.snapshot()` at the moment of the observation.
 */
export interface ArbiterSnapshot {
	readonly execution: AgentRuntimeExecutionState
	readonly recoveryState: RecoveryState
	readonly status: AgentRunStatus
	readonly pendingToolCalls: readonly string[]
}

/**
 * Aggregate counters exposed by the recorder. Used by qualification
 * tests and the E5-E6 evidence report.
 */
export interface TaskShadowRecorderCounts {
	readonly eventsObserved: number
	readonly comparisons: number
	readonly agreements: number
	readonly divergences: number
	readonly divergenceCountsByClass: Readonly<Record<DivergenceClass, number>>
	readonly invariantViolations: number
	readonly droppedRecords: number
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
	 * Per-origin count of observations that were SUPPRESSED at the
	 * authority resolver because a higher-authority observation
	 * (canonical > reconstructed, HOST_TASK > nothing) had already
	 * produced the semantic transition.
	 *
	 * Diagnostic only. State-mutation counts remain governed by
	 * `eventsObserved`/`comparisons`; this counter explains the
	 * delta.
	 */
	readonly observationsSuppressedByOrigin: Readonly<Record<TaskShadowRuntimeOrigin, number>>
	/**
	 * C2.2-CORRECTION01 R8: per-origin count of diagnostic-only
	 * observations (e.g. HOST_RECOVERY when canonicalAvailable=true).
	 * Diagnostic observations do not mutate state.
	 */
	readonly observationsDiagnosticByOrigin: Readonly<Record<TaskShadowRuntimeOrigin, number>>
	/**
	 * C2.2: count of HOST_RECOVERY observations applied as fallback
	 * when canonical recovery transport was unavailable. Should be
	 * 0 for LocalRuntimeHost (canonicalAvailable=true); >0 only for
	 * Hub/RemoteRuntimeHost paths that have not yet been qualified.
	 */
	readonly fallbackRecoveryApplied: number
	/**
	 * C2.2: count of observation paths that threw inside the
	 * coordinator transaction but did not affect legacy/runtime
	 * authority. A non-zero value indicates a diagnostic gap; the
	 * transition that was already applied is reported as EVIDENCE_GAP
	 * by the recorder and this counter records the failure.
	 */
	readonly observerErrors: number
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01 R4:
	 * count of EVIDENCE_GAP events: a state mutation was committed
	 * to the comparator's shadow but the differential record
	 * could not be persisted. The shadow has advanced without a
	 * corresponding bounded record; this counter is the only
	 * qualification signal for that asymmetry.
	 */
	readonly evidenceGaps: number
}

const ALL_CLASSES: readonly DivergenceClass[] = [
	"D00_AGREE",
	"D01_LEGACY_FALSE_IDLE",
	"D02_SHADOW_FALSE_ACTIVE",
	"D03_TERMINAL_ORDERING",
	"D04_APPROVAL_PRECEDENCE",
	"D05_TOOL_CARDINALITY",
	"D06_RESUME_BOUNDARY",
	"D07_FAILURE_MAPPING",
	"D08_FOLLOWUP_EXTERNAL",
	"D09_EVENT_GAP",
	"D10_UNKNOWN",
	"D11_HOST_PREENGAGED",
] as const

/**
 * Re-export the full divergence-class array for downstream tests
 * that want to assert coverage of every class.
 */
export const ALL_DIFFERENCE_TYPES: readonly DivergenceClass[] = ALL_CLASSES

/**
 * Maximum number of records retained per recorder instance. Once the
 * buffer is full, the oldest record is dropped to make room.
 */
export const MAX_RECORDS_PER_TASK = 256

/**
 * Bounded classified differential recorder. Owns its own ring buffer
 * (`records`); the buffer size is `MAX_RECORDS_PER_TASK`. Once full,
 * the oldest record is dropped and `droppedRecords` is incremented.
 *
 * INVARIANT VIOLATION handling is consolidated: when the comparator
 * reports any `TaskInvariantViolation` on an observation, the recorder
 * surfaces it through `onInvariantViolation` and bumps
 * `invariantViolations` by one (not by the violation count — we
 * count the *event* the shadow emitted, not the violations inside
 * it).
 */
export class TaskShadowRecorder {
	private readonly records: TaskShadowDifferentialRecord[] = []
	private divergenceCounts: Record<DivergenceClass, number> = makeClassCounts()
	private eventsObserved = 0
	private comparisons = 0
	private agreements = 0
	private divergences = 0
	private invariantViolations = 0
	private droppedRecords = 0
	private suppressedCounts: Record<TaskShadowRuntimeOrigin, number> = makeSuppressedCounts()
	private diagnosticCounts: Record<TaskShadowRuntimeOrigin, number> = makeSuppressedCounts()
	private fallbackRecoveryApplied = 0
	private observerErrors = 0
	private evidenceGaps = 0

	constructor(
		/**
		 * Invariant-violation sink. Called synchronously after every
		 * record that carried a violation. Defaults to a no-op so
		 * unit tests can exercise the recorder in isolation.
		 */
		private readonly onInvariantViolation: (
			record: TaskShadowDifferentialRecord,
			violations: readonly TaskInvariantViolation[],
		) => void = () => {},
	) {}

	/**
	 * Record a single observation. Returns the persisted record (or
	 * `undefined` if it was dropped) for test ergonomics.
	 */
	record(
		input: TaskShadowRecordInput,
		violations: readonly TaskInvariantViolation[],
	): TaskShadowDifferentialRecord | undefined {
		this.eventsObserved += 1
		this.comparisons += 1
		const classification = input.classificationOverride ?? classify(input)
		const arbitration =
			classification === "D00_AGREE" ? undefined : (input.arbitrationOverride ?? arbitrate(input, classification))
		const record: TaskShadowDifferentialRecord = {
			seq: input.seq,
			timestamp: input.timestamp,
			origin: input.origin,
			event: input.observationEvent,
			legacyPhase: input.divergence?.legacyPhase ?? "idle",
			shadowPhase: input.divergence?.shadowPhase ?? "idle",
			lifecycleKind: input.observationLifecycleKind,
			modelStreaming: input.observationModel.activity.modelStreaming,
			activeToolCount: input.observationModel.activity.activeToolCallIds.length,
			awaitingApproval: input.observationModel.activity.awaitingApproval,
			toolCalls: input.observationToolCalls,
			recoveryBudgetFailures: input.observationRecoveryBudgetFailures,
			taskEpochOrOpaqueTaskKey: input.taskEpochOrOpaqueTaskKey,
			runtimeStatus: input.runtimeStatus,
			classification,
			arbitration,
		}
		const dropped = pushBounded(this.records, record)
		if (dropped) this.droppedRecords += 1
		this.divergenceCounts[classification] += 1
		if (classification === "D00_AGREE") this.agreements += 1
		else this.divergences += 1
		if (violations.length > 0) {
			this.invariantViolations += 1
			try {
				this.onInvariantViolation(record, violations)
			} catch {
				// Observation-only; the recorder must never throw.
			}
		}
		return dropped ? undefined : record
	}

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
	 * Count an observation that was SUPPRESSED at the authority
	 * resolver (a higher-authority ingress had already produced the
	 * semantic transition). Diagnostic only — does NOT add a record
	 * to the bounded buffer and does NOT mutate state.
	 */
	recordSuppression(origin: TaskShadowRuntimeOrigin): void {
		this.suppressedCounts[origin] += 1
	}

	/**
	 * C2.2: count a HOST_RECOVERY observation that was applied as
	 * fallback (canonicalAvailable === false). Should be 0 for the
	 * LocalRuntimeHost production path.
	 */
	recordFallbackRecoveryApplied(): void {
		this.fallbackRecoveryApplied += 1
	}

	/**
	 * C2.2: count an exception that occurred inside the coordinator
	 * transaction. Legacy/runtime authority is unaffected; the
	 * transition that was already applied is reported as
	 * EVIDENCE_GAP by the coordinator.
	 */
	recordObserverError(): void {
		this.observerErrors += 1
	}

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01 R4:
	 * Count an explicit EVIDENCE_GAP: a state mutation was applied
	 * to the comparator's shadow, but the corresponding differential
	 * record could not be persisted (the recorder threw). The
	 * shadow's state diverges from the recorded evidence by exactly
	 * one transition. The counter is qualification-only — production
	 * authority is unaffected.
	 */
	recordEvidenceGap(): void {
		this.evidenceGaps += 1
	}

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01 R8:
	 * Count an observation that was admitted as DIAGNOSTIC_ONLY by
	 * the authority resolver (e.g. HOST_RECOVERY with
	 * canonicalAvailable=true). Diagnostic observations do NOT
	 * mutate state and do NOT add to the bounded record buffer;
	 * this counter surfaces the diagnostic volume to qualification.
	 */
	recordDiagnosticObservation(origin: TaskShadowRuntimeOrigin): void {
		this.diagnosticCounts[origin] += 1
	}

	/** Read-only snapshot of the bounded buffer. */
	getRecords(): readonly TaskShadowDifferentialRecord[] {
		return this.records
	}

	/** Aggregate counters for qualification tests / evidence reports. */
	getCounts(): TaskShadowRecorderCounts {
		return {
			eventsObserved: this.eventsObserved,
			comparisons: this.comparisons,
			agreements: this.agreements,
			divergences: this.divergences,
			divergenceCountsByClass: { ...this.divergenceCounts },
			invariantViolations: this.invariantViolations,
			droppedRecords: this.droppedRecords,
			observationsSuppressedByOrigin: { ...this.suppressedCounts },
			observationsDiagnosticByOrigin: { ...this.diagnosticCounts },
			fallbackRecoveryApplied: this.fallbackRecoveryApplied,
			observerErrors: this.observerErrors,
			evidenceGaps: this.evidenceGaps,
		}
	}

	/** Reset (test-only). Clears the buffer and counters. */
	debugReset(): void {
		this.records.length = 0
		this.divergenceCounts = makeClassCounts()
		this.eventsObserved = 0
		this.comparisons = 0
		this.agreements = 0
		this.divergences = 0
		this.invariantViolations = 0
		this.droppedRecords = 0
		this.suppressedCounts = makeSuppressedCounts()
		this.diagnosticCounts = makeSuppressedCounts()
		this.fallbackRecoveryApplied = 0
		this.observerErrors = 0
		this.evidenceGaps = 0
	}
}

function makeSuppressedCounts(): Record<TaskShadowRuntimeOrigin, number> {
	return {
		RUNTIME_CANONICAL: 0,
		RUNTIME_RECONSTRUCTED: 0,
		HOST_TASK: 0,
		HOST_RECOVERY: 0,
	}
}

function pushBounded<T>(arr: T[], value: T): T | undefined {
	if (arr.length >= MAX_RECORDS_PER_TASK) {
		// Drop the oldest record to make room for the new one. Without
		// the subsequent push, the buffer would shrink below the bound.
		const dropped = arr.shift()
		arr.push(value)
		return dropped
	}
	arr.push(value)
	return undefined
}

function makeClassCounts(): Record<DivergenceClass, number> {
	const counts = {} as Record<DivergenceClass, number>
	for (const c of ALL_CLASSES) counts[c] = 0
	return counts
}

// Re-export the canonical TaskInvariantViolation type from the package
// for downstream tests.
export type { TaskInvariantViolation }

/**
 * Classify a single comparison.
 *
 * Algorithm (per E5-E6 contract §5):
 *
 *   D00_AGREE                legacy phase == shadow phase
 *   D01_LEGACY_FALSE_IDLE    legacy=idle, shadow=streaming|awaiting_approval
 *   D02_SHADOW_FALSE_ACTIVE  shadow active, canonical runtime says no activity
 *   D03_TERMINAL_ORDERING    legacy terminal vs shadow active, or converse
 *   D04_APPROVAL_PRECEDENCE  disagreement involving awaiting_approval
 *   D05_TOOL_CARDINALITY     mismatch attributable to parallel/orphan/duplicate tools
 *   D06_RESUME_BOUNDARY      disagreement around resumable / same_task_continued
 *   D07_FAILURE_MAPPING      failed / error mismatch
 *   D08_FOLLOWUP_EXTERNAL    host awaiting_followup projection
 *   D09_EVENT_GAP            shadow lacks enough input
 *   D10_UNKNOWN              unclassified (must be 0 in qualification)
 */
export function classify(input: TaskShadowRecordInput): DivergenceClass {
	const { divergence, arbiter, observationEvent, observationModel } = input
	if (!divergence) return "D00_AGREE"
	const legacyPhase = divergence.legacyPhase
	const shadowPhase = divergence.shadowPhase
	if (shadowPhase === "awaiting_followup" || legacyPhase === "awaiting_followup") {
		return "D08_FOLLOWUP_EXTERNAL"
	}
	// D04 first — any awaiting_approval disagreement is approval
	// precedence; the legacy-false-idle D01 narrows to streaming only.
	if (shadowPhase === "awaiting_approval" || legacyPhase === "awaiting_approval") {
		return "D04_APPROVAL_PRECEDENCE"
	}
	if (legacyPhase === "idle" && shadowPhase === "streaming") {
		const arbiterActive =
			arbiter.execution.modelStreaming || arbiter.execution.awaitingApproval || arbiter.pendingToolCalls.length > 0
		if (arbiterActive) return "D01_LEGACY_FALSE_IDLE"
	}
	// legacyPhase is now in {"idle","streaming","completed","error","resumable"}
	// (awaiting_followup and awaiting_approval were eliminated above).
	if (
		shadowPhase === "streaming" &&
		legacyPhase !== "streaming" &&
		legacyPhase !== "completed" &&
		legacyPhase !== "error" &&
		legacyPhase !== "resumable"
	) {
		// D02 is "shadow false active" — only when neither side is
		// terminal and the canonical arbiter agrees with the shadow's
		// active projection, the shadow is just wrong.
		const arbiterActive =
			arbiter.execution.modelStreaming || arbiter.execution.awaitingApproval || arbiter.pendingToolCalls.length > 0
		if (!arbiterActive) return "D02_SHADOW_FALSE_ACTIVE"
	}
	if (shadowPhase === "completed" && (legacyPhase === "idle" || legacyPhase === "streaming")) {
		// Inverse: shadow says terminal, legacy says active/idle. The
		// canonical arbiter has not flipped to a terminal status, so
		// the shadow is ahead of the canonical truth (LEGACY_CORRECT).
		const arbiterTerminal = arbiter.status === "completed" || arbiter.status === "failed" || arbiter.status === "aborted"
		if (!arbiterTerminal) return "D02_SHADOW_FALSE_ACTIVE"
	}
	if (shadowPhase === "idle" && (legacyPhase === "streaming" || legacyPhase === "completed")) {
		// Inverse: shadow says idle while legacy reports activity or
		// terminal. The arbiter has not confirmed activity — the
		// shadow's lifecycle is the authoritative truth (LEGACY_CORRECT).
		// D09 (event-gap) takes precedence: when the shadow received
		// no TaskMsg for this legacy event, we cannot arbitrate the
		// projection disagreement.
		if (observationEvent === "noop") return "D09_EVENT_GAP"
		const arbiterActive =
			arbiter.execution.modelStreaming || arbiter.execution.awaitingApproval || arbiter.pendingToolCalls.length > 0
		if (!arbiterActive) return "D02_SHADOW_FALSE_ACTIVE"
	}
	if ((legacyPhase === "completed" || legacyPhase === "error" || legacyPhase === "resumable") && shadowPhase === "streaming") {
		return "D03_TERMINAL_ORDERING"
	}
	if ((shadowPhase === "completed" || shadowPhase === "error" || shadowPhase === "resumable") && legacyPhase === "streaming") {
		return "D03_TERMINAL_ORDERING"
	}
	const ids = observationModel.activity.activeToolCallIds
	const pending = arbiter.pendingToolCalls
	if (ids.length !== pending.length || !arraysSameOrder(ids, pending)) {
		return "D05_TOOL_CARDINALITY"
	}
	if (shadowPhase === "resumable" || legacyPhase === "resumable") {
		return "D06_RESUME_BOUNDARY"
	}
	if (shadowPhase === "error" || legacyPhase === "error") {
		return "D07_FAILURE_MAPPING"
	}
	// D09 (event-gap) takes precedence over the inverse-D02 fall-through:
	// when the shadow received no TaskMsg for this legacy event, we
	// cannot arbitrate the projection disagreement.
	if (observationEvent === "noop") {
		return "D09_EVENT_GAP"
	}
	return "D10_UNKNOWN"
}

function arraysSameOrder(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

/**
 * Arbitrate a classified divergence against the canonical runtime
 * facts. Returns LEGACY_CORRECT, SHADOW_CORRECT, BOTH_VALID_DIFFERENT
 * _PROJECTION, or INSUFFICIENT_EVIDENCE.
 */
export function arbitrate(input: TaskShadowRecordInput, classification: DivergenceClass): ArbitrationOutcome {
	const { divergence, arbiter } = input
	if (!divergence) return "INSUFFICIENT_EVIDENCE"
	const { legacyPhase, shadowPhase } = divergence
	if (classification === "D08_FOLLOWUP_EXTERNAL") return "BOTH_VALID_DIFFERENT_PROJECTION"
	if (classification === "D09_EVENT_GAP") return "INSUFFICIENT_EVIDENCE"
	if (classification === "D01_LEGACY_FALSE_IDLE") {
		const arbiterActive =
			arbiter.execution.modelStreaming || arbiter.execution.awaitingApproval || arbiter.pendingToolCalls.length > 0
		return arbiterActive ? "SHADOW_CORRECT" : "LEGACY_CORRECT"
	}
	if (classification === "D02_SHADOW_FALSE_ACTIVE") return "LEGACY_CORRECT"
	if (classification === "D03_TERMINAL_ORDERING") {
		if (arbiter.status === "completed" || arbiter.status === "failed") {
			return legacyPhase === "completed" || legacyPhase === "error" ? "LEGACY_CORRECT" : "SHADOW_CORRECT"
		}
		return "INSUFFICIENT_EVIDENCE"
	}
	if (classification === "D04_APPROVAL_PRECEDENCE") {
		if (arbiter.execution.awaitingApproval) {
			return shadowPhase === "awaiting_approval" ? "SHADOW_CORRECT" : "LEGACY_CORRECT"
		}
		return shadowPhase === "awaiting_approval" ? "LEGACY_CORRECT" : "SHADOW_CORRECT"
	}
	if (classification === "D05_TOOL_CARDINALITY") {
		const pending = arbiter.pendingToolCalls
		const shadowActive = shadowPhase === "streaming" || shadowPhase === "awaiting_approval"
		const legacyActive = legacyPhase === "streaming" || legacyPhase === "awaiting_approval"
		if (pending.length > 0) return shadowActive ? "SHADOW_CORRECT" : "LEGACY_CORRECT"
		return legacyActive ? "LEGACY_CORRECT" : "SHADOW_CORRECT"
	}
	if (classification === "D06_RESUME_BOUNDARY") {
		// `circuit_open` is the canonical RecoveryState that maps to
		// `resumable` in the legacy phase taxonomy; other resumable
		// triggers (e.g. explicit cancellation) surface as a separate
		// `RecoveryState` evolution we don't model here. When in doubt
		// we trust the arbiter.
		const recoveryResumable = arbiter.recoveryState === "circuit_open"
		return recoveryResumable ? "SHADOW_CORRECT" : "LEGACY_CORRECT"
	}
	if (classification === "D07_FAILURE_MAPPING") {
		return arbiter.status === "failed" ? "SHADOW_CORRECT" : "LEGACY_CORRECT"
	}
	void legacyPhase
	void shadowPhase
	return "INSUFFICIENT_EVIDENCE"
}

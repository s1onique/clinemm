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

export type ArbitrationOutcome = "LEGACY_CORRECT" | "SHADOW_CORRECT" | "BOTH_VALID_DIFFERENT_PROJECTION" | "INSUFFICIENT_EVIDENCE"

/**
 * Privacy-safe differential record. Field allowlist is enforced by
 * the structural test in `task-state-shadow-recorder.test.ts`.
 */
export interface TaskShadowDifferentialRecord {
	readonly seq: number
	readonly timestamp: number
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
		const classification = classify(input)
		const arbitration = classification === "D00_AGREE" ? undefined : arbitrate(input, classification)
		const record: TaskShadowDifferentialRecord = {
			seq: input.seq,
			timestamp: input.timestamp,
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

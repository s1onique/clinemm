/**
 * ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01
 *
 * Bounded, DEFAULT_OFF causal trace for the C9/C10 completion slice.
 *
 * The trace is an observer, never an authority. It records only facts that
 * the production seam has already observed and carries one decision id from
 * the Elm decision through the requested phase write, committed phase write,
 * and marker publication. No public protocol, React state, or lifecycle
 * semantics are changed by this module.
 */

export type LifecycleTransitionStage =
	| "authority_decision"
	| "effect_requested"
	| "effect_executed"
	| "phase_commit_observed"
	| "marker_promoted"
	| "marker_suppressed"

export interface LifecycleTransitionTraceRecord {
	readonly schema_version: 1
	readonly transition_id: "A-03" | "A-04" | "A-05" | "P-06"
	readonly task_id: string
	readonly turn_seq: number
	readonly decision_id: string
	readonly stage: LifecycleTransitionStage
	readonly outcome: string
	readonly source: string
}

export interface LifecycleTransitionTraceContext {
	readonly taskId: string
	readonly turnSeq: number
	readonly decisionId: string
}

const TRACE_BUFFER_LIMIT = 256
let traceEnabled = false
let traceBuffer: LifecycleTransitionTraceRecord[] = []

/** Default-off opt-in used by executable conformance tests and bounded captures. */
export function setLifecycleTransitionTraceEnabled(enabled: boolean): void {
	traceEnabled = Boolean(enabled)
}

/** Opt in without clearing the existing bounded capture. */
export function enableLifecycleTransitionTrace(): void {
	traceEnabled = true
}

export function isLifecycleTransitionTraceEnabled(): boolean {
	return traceEnabled
}

export function clearLifecycleTransitionTrace(): void {
	traceBuffer = []
}

export function getLifecycleTransitionTraceRecords(): readonly LifecycleTransitionTraceRecord[] {
	return traceBuffer
}

/**
 * Append one already-observed production fact. The caller supplies the
 * decision id captured from the authority decision; correlation therefore
 * does not rely on timestamps or shared task identity alone.
 */
export function recordLifecycleTransitionTrace(record: Omit<LifecycleTransitionTraceRecord, "schema_version">): void {
	if (!traceEnabled) {
		return
	}
	traceBuffer.push({ schema_version: 1, ...record })
	if (traceBuffer.length > TRACE_BUFFER_LIMIT) {
		traceBuffer.shift()
	}
}

/** Build a trace record from the actual decision execution context. */
export function lifecycleTransitionTraceRecord(
	context: LifecycleTransitionTraceContext,
	stage: LifecycleTransitionStage,
	outcome: string,
	source: string,
	transitionId: LifecycleTransitionTraceRecord["transition_id"],
): LifecycleTransitionTraceRecord {
	return {
		schema_version: 1,
		transition_id: transitionId,
		task_id: context.taskId,
		turn_seq: context.turnSeq,
		decision_id: context.decisionId,
		stage,
		outcome,
		source,
	}
}

/**
 * Validate one causal chain. A chain is valid only when its decision and
 * effect records share the same decision id and the effect follows the
 * decision. Chronology alone is deliberately insufficient.
 */
export function validateLifecycleTransitionTrace(
	records: readonly LifecycleTransitionTraceRecord[],
	decisionId: string,
): { valid: boolean; reason?: string } {
	const decision = records.find((record) => record.stage === "authority_decision" && record.decision_id === decisionId)
	if (!decision) {
		return { valid: false, reason: "missing_authority_decision" }
	}
	if (decision.outcome !== "authorized") {
		return { valid: false, reason: "authority_not_authorized" }
	}
	const effect = records.find((record) => record.decision_id === decisionId && record.stage === "marker_promoted")
	if (!effect) {
		return { valid: false, reason: "missing_marker_promoted" }
	}
	const execution = records.find((record) => record.decision_id === decisionId && record.stage === "effect_executed")
	if (!execution) {
		return { valid: false, reason: "missing_effect_executed" }
	}
	const decisionIndex = records.indexOf(decision)
	const executionIndex = records.indexOf(execution)
	const effectIndex = records.indexOf(effect)
	if (executionIndex <= decisionIndex || effectIndex <= executionIndex) {
		return { valid: false, reason: "effect_not_after_decision" }
	}
	return { valid: true }
}

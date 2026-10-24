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
 * The successful C9/C10 causal chain, in the order the production seam
 * observes it. Every stage is REQUIRED: a chain that authorizes, executes,
 * and promotes a marker without ever observing the phase commit is NOT a
 * causal proof of "the authorized decision caused a committed completion".
 *
 * The transition id of each stage is part of the contract: the authority
 * decision is A-03, the phase request and the observed phase commit are
 * A-04, and the marker execution and promotion are P-06.
 */
const SUCCESSFUL_CHAIN: readonly {
	readonly stage: LifecycleTransitionStage
	readonly transition_id: LifecycleTransitionTraceRecord["transition_id"]
}[] = [
	{ stage: "authority_decision", transition_id: "A-03" },
	{ stage: "effect_requested", transition_id: "A-04" },
	{ stage: "phase_commit_observed", transition_id: "A-04" },
	{ stage: "effect_executed", transition_id: "P-06" },
	{ stage: "marker_promoted", transition_id: "P-06" },
] as const

/**
 * Validate one causal chain.
 *
 * A chain is valid only when ALL of the following hold:
 *   1. Every required stage of the successful chain is present.
 *   2. Every required stage carries the expected transition id.
 *   3. Every required stage shares the decision id, the task id, and the
 *      turn sequence of the authority decision (one execution context).
 *   4. The stages appear in the required order.
 *
 * Chronology alone is deliberately insufficient, and so is the mere
 * presence of the three headline stages: without the observed phase
 * commit the chain does not prove that a commit ever happened.
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

	// Resolve each required stage in chain order. The first record that
	// matches the decision id AND the expected transition id wins; a
	// mismatch is reported rather than silently skipped.
	const chain: LifecycleTransitionTraceRecord[] = []
	for (const required of SUCCESSFUL_CHAIN) {
		const match = records.find(
			(record) =>
				record.decision_id === decisionId &&
				record.stage === required.stage &&
				record.transition_id === required.transition_id,
		)
		if (!match) {
			// Distinguish "the stage is absent" from "the stage is present
			// but carries the wrong transition id" so the failure reason
			// names the actual defect.
			const wrongIdentity = records.some((record) => record.decision_id === decisionId && record.stage === required.stage)
			return {
				valid: false,
				reason: wrongIdentity ? `transition_identity_mismatch:${required.stage}` : `missing_${required.stage}`,
			}
		}
		chain.push(match)
	}

	// One execution context: the task id and the turn sequence must not
	// drift across the chain, otherwise the records belong to different
	// executions that merely share a decision id.
	for (const record of chain) {
		if (record.task_id !== decision.task_id) {
			return { valid: false, reason: "task_identity_mismatch" }
		}
		if (record.turn_seq !== decision.turn_seq) {
			return { valid: false, reason: "turn_identity_mismatch" }
		}
	}

	// Strict ordering: each stage must come after the previous one in
	// the observed record sequence.
	for (let index = 1; index < chain.length; index++) {
		if (records.indexOf(chain[index]) <= records.indexOf(chain[index - 1])) {
			return { valid: false, reason: "stage_order_violation" }
		}
	}

	return { valid: true }
}

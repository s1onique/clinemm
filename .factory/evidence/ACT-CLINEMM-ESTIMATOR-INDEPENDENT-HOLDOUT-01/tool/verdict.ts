/**
 * ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 — verdict selection.
 *
 * ## Why this module exists
 *
 * CORRECTION01: the runner previously chose `AWAITING_INDEPENDENT_DOGFOOD_
 * SESSION` whenever the eligible row count was zero. That conflated two
 * materially different states:
 *
 *   - NO independent session exists at all → the operator must collect one
 *     (`AWAITING_INDEPENDENT_DOGFOOD_SESSION`), and
 *   - an independent session EXISTS but yields zero eligible attempts → the
 *     capture is present but not comparable (`CAPTURE_INSUFFICIENT`).
 *
 * The second state is a capture defect that must be reported as such; it is
 * NOT an instruction to go collect a session that was already collected.
 */
import { classifyVerdict, type CandidateComparison, type EligibleRow, type QualificationResult } from "./holdout";

export interface VerdictInput {
	readonly independentSessionIds: readonly string[];
	readonly eligibleAttempts: number;
	readonly comparisons: readonly CandidateComparison[];
	readonly rows?: readonly EligibleRow[];
}


export function decideVerdict(input: VerdictInput): QualificationResult {
	if (input.eligibleAttempts === 0) {
		if (input.independentSessionIds.length === 0) {
			return {
				verdict: "AWAITING_INDEPENDENT_DOGFOOD_SESSION",
				reason:
					"No eligible independent dogfood trace exists. The only surviving sanitized latency-trace exports carry the training session id; the previously known independent export was overwritten and its session predates the authoritative capture contract.",
			};
		}
		return {
			verdict: "CAPTURE_INSUFFICIENT",
			reason: `An independent dogfood trace was supplied (${input.independentSessionIds.join(", ")}) but it yielded zero eligible attempts. The capture exists but cannot provide an authoritatively joined, comparable provider-accounting pair.`,
		};
	}
	return classifyVerdict(input.rows ?? [], input.comparisons);
}

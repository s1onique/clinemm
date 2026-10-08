/**
 * ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED
 *
 * P0 adversarial test for the new fail-closed sortedness boundary.
 *
 * Background (from the factory reviewer's HALT on the predecessor ACT):
 *
 *   The CORRECTION01 fix routed unsorted input through
 *   `classifyHeldSetProgress` → `Indeterminate` → `Policy.decide`
 *   fall-through → `decideAfterStallCheck` → `ObserveThenRetry`
 *   (when observation capability is available) → `delivered`.
 *   This was a fail-OPEN path for malformed input.
 *
 *   The CORRECTION02 fix moves the sortedness check INTO
 *   `Domain.factsIsExpected`, so `Policy.decide` short-circuits
 *   at P0 with `FailClosed MalformedFacts` BEFORE
 *   `classifyHeldSetProgress` is consulted.
 *
 * The test inputs are injected at the Elm facts boundary (the
 * real production seam `pickContinuationDirectiveForPublication`,
 * which is what the production caller in
 * `sdk-session-event-coordinator.ts` invokes). Relying
 * exclusively on ordinary caller fixtures would never exercise
 * this defect, because the production caller pre-sorts its
 * arrays at line 1476.
 *
 * Spec (from the reviewer's HALT):
 *
 *   prior = ["j1", "j2"]
 *   current = ["j2", "j1"]  // invalid wire ordering
 *
 *   expected:
 *     directive = fail_closed(malformed_facts)
 *     delivery_count = 0
 *     REARM slot unchanged
 *     STALL state unchanged
 *     completion_commits = 0
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
	pickContinuationDirectiveForPublication,
	resetCompletionContinuationControlElmAuthorityForTests,
} from "../completion-continuation-control-elm"

interface MalformedFacts {
	readonly unconsumedCount: number
	readonly capabilities: { readonly canObserveHeldResults: boolean; readonly canRetryCompletion: boolean }
	readonly priorHeldSetSorted: readonly string[]
	readonly currentHeldSetSorted: readonly string[]
	readonly sessionMatches: boolean
	readonly taskMatches: boolean
	readonly alreadyCommitted: boolean
}

function makeMalformedFacts(over: {
	priorHeldSetSorted?: readonly string[] | undefined
	currentHeldSetSorted?: readonly string[]
	unconsumedCount?: number
} = {}): MalformedFacts {
	return {
		unconsumedCount: over.unconsumedCount ?? 2,
		capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
		priorHeldSetSorted: over.priorHeldSetSorted ?? [],
		currentHeldSetSorted: over.currentHeldSetSorted ?? ["j1", "j2"],
		sessionMatches: true,
		taskMatches: true,
		alreadyCommitted: false,
	}
}
describe("ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED (C0)", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
	})

	describe("P0: malformed sortedness fails closed at the trust boundary", () => {
		it("reviewer-spec: prior=['j1','j2'], current=['j2','j1'] -> FailClosed MalformedFacts", async () => {
			// The reviewer's exact adversarial test from the HALT
			// verdict. This is the boundary case the CORRECTION01
			// fix mis-classified as `Indeterminate` (fail-OPEN).
			const d = await pickContinuationDirectiveForPublication(
				makeMalformedFacts({
					priorHeldSetSorted: ["j1", "j2"],
					currentHeldSetSorted: ["j2", "j1"],
				}),
			)
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("malformed_facts")
			}
		})

		it("reverse direction: prior=['j2','j1'], current=['j1','j2'] -> FailClosed MalformedFacts", async () => {
			const d = await pickContinuationDirectiveForPublication(
				makeMalformedFacts({
					priorHeldSetSorted: ["j2", "j1"],
					currentHeldSetSorted: ["j1", "j2"],
				}),
			)
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("malformed_facts")
			}
		})

		it("three-element unsorted current -> FailClosed MalformedFacts", async () => {
			// The validator must catch any inversion, not just
			// adjacent swaps.
			const d = await pickContinuationDirectiveForPublication(
				makeMalformedFacts({
					priorHeldSetSorted: ["j1", "j2", "j3"],
					currentHeldSetSorted: ["j3", "j1", "j2"],
				}),
			)
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("malformed_facts")
			}
		})

		it("adjacent tie-breaking (j1=j1) on current is still sorted -> NOT MalformedFacts", async () => {
			// Duplicates are allowed; the validator uses `<=`
			// (not `<`). A sorted list with equal adjacent
			// elements must still pass the trust boundary.
			const d = await pickContinuationDirectiveForPublication(
				makeMalformedFacts({
					priorHeldSetSorted: ["j1", "j1", "j2"],
					currentHeldSetSorted: ["j1", "j1", "j2"],
				}),
			)
			// Same canonical multiset → NoProgress → FailClosed
			// StalledNoProgress (NOT MalformedFacts).
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("stalled_no_progress")
			}
		})
	})

	describe("P0: legitimate first-call case still delivers (regression guard)", () => {
		it("prior=[], current=['j1','j2'] (sorted) -> ObserveThenRetry (first call preserved)", async () => {
			// The CORRECTION02 fix must NOT regress the
			// legitimate first-call semantic.
			const d = await pickContinuationDirectiveForPublication(
				makeMalformedFacts({
					priorHeldSetSorted: [],
					currentHeldSetSorted: ["j1", "j2"],
				}),
			)
			expect(d.tag).toBe("observe_then_retry")
		})

		it("prior=['j1','j2'], current=['j2','j3'] (sorted) -> ObserveThenRetry (membership shift)", async () => {
			// The CORRECTION02 fix must NOT regress the real
			// progress case.
			const d = await pickContinuationDirectiveForPublication(
				makeMalformedFacts({
					priorHeldSetSorted: ["j1", "j2"],
					currentHeldSetSorted: ["j2", "j3"],
				}),
			)
			expect(d.tag).toBe("observe_then_retry")
		})

		it("prior=['j1','j2'], current=['j1','j2'] (sorted) -> FailClosed StalledNoProgress (NOT MalformedFacts)", async () => {
			// The CORRECTION02 fix must NOT mis-classify a
			// properly-sorted, equal held set as MalformedFacts.
			// This is the canonical NoProgress case.
			const d = await pickContinuationDirectiveForPublication(
				makeMalformedFacts({
					priorHeldSetSorted: ["j1", "j2"],
					currentHeldSetSorted: ["j1", "j2"],
				}),
			)
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("stalled_no_progress")
			}
		})
	})
})

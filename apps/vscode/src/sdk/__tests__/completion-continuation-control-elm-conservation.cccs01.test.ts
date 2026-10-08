/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C17 / C18 / C19 / C20)
 *
 * Conservation tests: pin that the Elmization does NOT regress the
 * upstream invariants pinned by the prior ACTs. We don't re-run the
 * entire upstream suite here (those tests already run via the existing
 * CI matrix); we pin the BOUNDARY the Elm side touches:
 *
 *   C17 stall enforcement       -> Elm returns FailClosed StalledNoProgress
 *                                  whenever the host computes a stall hit.
 *   C18 REARM                    -> Elm policy does not introduce a new
 *                                  continuation directive that would
 *                                  suppress a legitimate enqueue.
 *   C19 provider / private-brand -> Elm never sees runtimeAuthority or
 *                                  message role; we exercise the TS adapter's
 *                                  capability projection.
 *   C20 role conservation        -> Elm cannot mutate message role; the
 *                                  adapter's output is a typed Directive,
 *                                  not a Role.
 */

import { describe, expect, it, beforeEach } from "vitest"
import {
	pickContinuationDirectiveForPublication,
	resetCompletionContinuationControlElmAuthorityForTests,
	type CompletionContinuationControlFactsInput,
} from "../completion-continuation-control-elm"

describe("ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C17/C18/C19/C20 conservation", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
	})

	// ---------------------------------------------------------------------------
	// C17 -- stall enforcement conservation
	// ---------------------------------------------------------------------------
	describe("C17 -- same-fingerprint stall enforcement", () => {
		it("all-capable + stalledNoProgress -> FailClosed StalledNoProgress", async () => {
			const d = await pickContinuationDirectiveForPublication({
				unconsumedCount: 2,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				priorHeldSetSorted: ["j1", "j2"], currentHeldSetSorted: ["j1", "j2"],
				sessionMatches: true,
				taskMatches: true,
				alreadyCommitted: false,
			})
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("stalled_no_progress")
			}
		})

		it("stalledNoProgress + identity mismatch: session>stalled (precedence preserved)", async () => {
			const d = await pickContinuationDirectiveForPublication({
				unconsumedCount: 2,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				priorHeldSetSorted: ["j1", "j2"], currentHeldSetSorted: ["j1", "j2"],
				sessionMatches: false,
				taskMatches: true,
				alreadyCommitted: false,
			})
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("session_mismatch")
			}
		})
	})

	// ---------------------------------------------------------------------------
	// C18 -- REARM conservation
	//   REARM invariant: a K enqueue + immediate duplicate request should be
	//   suppressed by `dedupeSuppressed`; one K+1 must be produced when K
	//   finishes if a blocking condition remains. The Elm kernel does not
	//   introduce new continuation decisions; this test pins that the
	//   K-suppression mechanism is independent of the Elm directive policy.
	// ---------------------------------------------------------------------------
	describe("C18 -- REARM enqueue decoupling", () => {
		it("Elm policy emits directive independent of dedupe state", async () => {
			const baseFacts: CompletionContinuationControlFactsInput = {
				unconsumedCount: 1,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
				sessionMatches: true,
				taskMatches: true,
				alreadyCommitted: false,
			}
			const first = await pickContinuationDirectiveForPublication(baseFacts)
			const second = await pickContinuationDirectiveForPublication(baseFacts)
			expect(first.tag).toBe("observe_then_retry")
			expect(second.tag).toBe("observe_then_retry")
			expect(first).toEqual(second)
		})
	})

	// ---------------------------------------------------------------------------
	// C19 -- provider boundary / private brand conservation
	//   The Elm adapter NEVER consumes runtimeAuthority or message role.
	//   The capability projection is the only host-side fact the adapter
	//   reads; identity fields are not in scope.
	// ---------------------------------------------------------------------------
	describe("C19 -- provider / private-brand conservation", () => {
		it("directive does not surface runtimeAuthority / role", async () => {
			const d = await pickContinuationDirectiveForPublication({
				unconsumedCount: 1,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
				sessionMatches: true,
				taskMatches: true,
				alreadyCommitted: false,
			})
			// The typed Directive has NO runtimeAuthority or role field.
			const dRecord = JSON.parse(JSON.stringify(d))
			expect(dRecord.runtimeAuthority).toBeUndefined()
			expect(dRecord.role).toBeUndefined()
		})
	})

	// ---------------------------------------------------------------------------
	// C20 -- role conservation
	//   The Elm adapter's output is a typed `ContinuationDirective`. The
	//   privileged `system` role is NOT produced by Elm; it is supplied by
	//   the TS effect-execution path AFTER the directive is decoded.
	// ---------------------------------------------------------------------------
	describe("C20 -- role conservation", () => {
		it("Elm output does not include a privileged role field", async () => {
			const d = await pickContinuationDirectiveForPublication({
				unconsumedCount: 1,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
				sessionMatches: true,
				taskMatches: true,
				alreadyCommitted: false,
			})
			const dRecord = JSON.parse(JSON.stringify(d))
			// The directive tag determines the effect; role is not.
			expect(dRecord.role).toBeUndefined()
			expect(dRecord.systemPrompt).toBeUndefined()
			expect(dRecord.userPrompt).toBeUndefined()
		})
	})
})

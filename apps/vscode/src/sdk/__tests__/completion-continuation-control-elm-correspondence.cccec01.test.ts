/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C14)
 *
 * Differential correspondence: TS reference `buildCompletionContinuationControl`
 * vs Elm `pickContinuationDirectiveForPublication` on identical fixtures.
 *
 * The TS reference is the predecessor policy at
 * `apps/vscode/src/sdk/background-notify-coordinator.ts:501-544`
 * (frozen at the CORRECTION04 closure of CONTROL_AUTHORITY01).
 *
 * Before cutover, both implementations MUST produce the same `directive`
 * for the cases the TS reference handles. The Elm kernel EXTENDS the
 * policy with stall / identity / alreadyCommitted / malformed guards
 * the TS reference does not have -- see per-test annotations.
 */

import { describe, expect, it, beforeEach } from "vitest"
import {
	buildCompletionContinuationControl,
	type CompletionContinuationControl,
} from "../background-notify-coordinator"
import {
	pickContinuationDirectiveForPublication,
	resetCompletionContinuationControlElmAuthorityForTests,
	type CompletionContinuationControlFactsInput,
	type ContinuationDirective,
	type FailureReasonTag,
} from "../completion-continuation-control-elm"

function facts(over: Partial<CompletionContinuationControlFactsInput> = {}): CompletionContinuationControlFactsInput {
	return {
		unconsumedCount: 0,
		capabilities: { canObserveHeldResults: false, canRetryCompletion: false },
		priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
		sessionMatches: true,
		taskMatches: true,
		alreadyCommitted: false,
		...over,
	}
}

function tsToDirective(control: CompletionContinuationControl): {
	readonly tag: ContinuationDirective["tag"]
	readonly failureReason?: FailureReasonTag
} {
	if (control.completionStatus === "HELD" && control.requiredAction === "observe_then_submit") {
		return { tag: "observe_then_retry" }
	}
	if (control.completionStatus === "COMMITTED" && control.requiredAction === "retry_commission") {
		// TS reference shape `COMMITTED + retry_commission` is the union of
		// two Elm directives:
		//   RetryCompletion : unobserved requests drained, retry mechanism
		//                     available -> model is authorized to issue
		//                     completion
		//   WaitForHost     : host has already committed, model waits for
		//                     the host to deliver
		//
		// The TS predecessor collapsed both because both surface the same
		// "model authorized to issue completion" behavior; the Elm split
		// surfaces the distinction at the effect-execution layer. The
		// load-bearing effect (model issues `submit_and_exit`) is the same.
		//
		// For CTRL-03 the TS reference's COMMITTED+retry_commission maps to
		// the Elm `RetryCompletion` directive -- the WaitForHost case is
		// not produced by the predecessor at all (no fact field surfaces
		// "host already committed").
		return { tag: "retry_completion" }
	}
	if (control.completionStatus === "CANNOT_CONTINUE" && control.requiredAction === "fail_closed") {
		const hasObs = control.availableObservationMechanisms.length > 0
		const hasCompletion = control.availableCompletionMechanisms.length > 0
		const held = control.heldObservationCount > 0
		if (held && !hasObs) return { tag: "fail_closed", failureReason: "observation_unavailable" }
		if (!held && !hasCompletion) return { tag: "fail_closed", failureReason: "retry_unavailable" }
		return { tag: "fail_closed", failureReason: "malformed_facts" }
	}
	throw new Error(`unexpected TS control shape: ${JSON.stringify(control)}`)
}

describe("ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C14 differential correspondence", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
	})

	it("CTRL-01 HELD + observation + retry -> ObserveThenRetry (both)", async () => {
		const tsControl = buildCompletionContinuationControl({
			sessionId: "s1",
			taskId: "t1",
			heldObservationCount: 2,
			heldJobIds: ["j1", "j2"],
			availableObservationMechanisms: ["command_status"],
			availableCompletionMechanisms: ["submit_and_exit"],
		})
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({ unconsumedCount: 2, capabilities: { canObserveHeldResults: true, canRetryCompletion: true } }),
		)
		expect(tsToDirective(tsControl).tag).toBe("observe_then_retry")
		expect(elmDirective.tag).toBe("observe_then_retry")
		expect(elmDirective.completionStatus).toBe("HELD")
		expect(elmDirective.requiredAction).toBe("observe_then_submit")
	})

	it("CTRL-02 HELD + no observation -> FailClosed ObservationUnavailable (both)", async () => {
		const tsControl = buildCompletionContinuationControl({
			sessionId: "s1",
			taskId: "t1",
			heldObservationCount: 2,
			heldJobIds: ["j1", "j2"],
			availableObservationMechanisms: [],
			availableCompletionMechanisms: ["submit_and_exit"],
		})
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({ unconsumedCount: 2, capabilities: { canObserveHeldResults: false, canRetryCompletion: true } }),
		)
		expect((tsToDirective(tsControl).tag === "fail_closed" ? tsToDirective(tsControl).failureReason : "not_fail_closed")).toBe("observation_unavailable")
		expect(elmDirective.tag).toBe("fail_closed")
		expect(elmDirective.tag === "fail_closed" ? elmDirective.failureReason : "not_fail_closed").toBe("observation_unavailable")
	})

	it("CTRL-03 not held + retry -> RetryCompletion (both)", async () => {
		const tsControl = buildCompletionContinuationControl({
			sessionId: "s1",
			taskId: "t1",
			heldObservationCount: 0,
			heldJobIds: [],
			availableObservationMechanisms: ["command_status"],
			availableCompletionMechanisms: ["submit_and_exit"],
		})
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({ unconsumedCount: 0, capabilities: { canObserveHeldResults: true, canRetryCompletion: true } }),
		)
		expect(tsToDirective(tsControl).tag).toBe("retry_completion")
		expect(elmDirective.tag).toBe("retry_completion")
		expect(elmDirective.completionStatus).toBe("READY_TO_RETRY")
	})

	it("CTRL-04 not held + retry unavailable -> FailClosed RetryUnavailable (both)", async () => {
		const tsControl = buildCompletionContinuationControl({
			sessionId: "s1",
			taskId: "t1",
			heldObservationCount: 0,
			heldJobIds: [],
			availableObservationMechanisms: [],
			availableCompletionMechanisms: [],
		})
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({ unconsumedCount: 0, capabilities: { canObserveHeldResults: false, canRetryCompletion: false } }),
		)
		expect((tsToDirective(tsControl).tag === "fail_closed" ? tsToDirective(tsControl).failureReason : "not_fail_closed")).toBe("retry_unavailable")
		expect(elmDirective.tag).toBe("fail_closed")
		expect(elmDirective.tag === "fail_closed" ? elmDirective.failureReason : "not_fail_closed").toBe("retry_unavailable")
	})
})

describe("C14-extension tests (Elm adds stall / identity / commit / malformed guards)", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
	})

	it("CTRL-05 stalled + everything available -> Elm FailClosed StalledNoProgress (TS reference observes nothing)", async () => {
		// TS reference: stalls are NOT a TS policy concern -- the predecessor
		// (background-notify-coordinator.ts:501-544) does not consult the
		// stall boolean. With held=2 + capabilities it produces HELD +
		// observe_then_submit. This is the documented difference.
		const tsControl = buildCompletionContinuationControl({
			sessionId: "s1",
			taskId: "t1",
			heldObservationCount: 2,
			heldJobIds: ["j1", "j2"],
			availableObservationMechanisms: ["command_status"],
			availableCompletionMechanisms: ["submit_and_exit"],
		})
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({
				unconsumedCount: 2,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				priorHeldSetSorted: ["j1", "j2"], currentHeldSetSorted: ["j1", "j2"],
			}),
		)
		expect(tsToDirective(tsControl).tag).toBe("observe_then_retry")
		expect(elmDirective.tag).toBe("fail_closed")
		expect(elmDirective.tag === "fail_closed" ? elmDirective.failureReason : "not_fail_closed").toBe("stalled_no_progress")
	})

	it("CTRL-06 session mismatch -> Elm FailClosed SessionMismatch", async () => {
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({
				unconsumedCount: 2,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				sessionMatches: false,
			}),
		)
		expect(elmDirective.tag).toBe("fail_closed")
		expect(elmDirective.tag === "fail_closed" ? elmDirective.failureReason : "not_fail_closed").toBe("session_mismatch")
	})

	it("CTRL-06 task mismatch -> Elm FailClosed TaskMismatch", async () => {
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({
				unconsumedCount: 2,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				taskMatches: false,
			}),
		)
		expect(elmDirective.tag).toBe("fail_closed")
		expect(elmDirective.tag === "fail_closed" ? elmDirective.failureReason : "not_fail_closed").toBe("task_mismatch")
	})

	it("CTRL-07 alreadyCommitted -> Elm FailClosed AlreadyCommitted", async () => {
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({
				unconsumedCount: 0,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				alreadyCommitted: true,
			}),
		)
		expect(elmDirective.tag).toBe("fail_closed")
		expect(elmDirective.tag === "fail_closed" ? elmDirective.failureReason : "not_fail_closed").toBe("already_committed")
	})

	it("CTRL-08 malformed negative unconsumedCount -> Elm FailClosed MalformedFacts", async () => {
		const elmDirective = await pickContinuationDirectiveForPublication(
			facts({
				unconsumedCount: -1,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
			}),
		)
		expect(elmDirective.tag).toBe("fail_closed")
		expect(elmDirective.tag === "fail_closed" ? elmDirective.failureReason : "not_fail_closed").toBe("malformed_facts")
	})
})

/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C16)
 *
 * Capability matrix test -- exercises the TS projection from the actual
 * resumed-turn tool registry to the closed boolean facts the Elm kernel
 * consumes. This closes the C3 capability-source open from the prior
 * review.
 *
 * The capability projection must derive booleans from the actual tool
 * registry (command_status + submit_and_exit), and the Elm kernel must
 * react accordingly. Tool names stay in TS (C9); the kernel never
 * sees literal tool names.
 */

import { describe, expect, it, beforeEach } from "vitest"
import {
	pickContinuationDirectiveForPublication,
	resetCompletionContinuationControlElmAuthorityForTests,
	type CompletionContinuationControlFactsInput,
} from "../completion-continuation-control-elm"

function factsFromRegistry(
	tools: readonly string[],
	over: Partial<CompletionContinuationControlFactsInput> = {},
): CompletionContinuationControlFactsInput {
	return {
		unconsumedCount: 0,
		capabilities: {
			canObserveHeldResults: tools.includes("command_status"),
			canRetryCompletion: tools.includes("submit_and_exit"),
		},
		priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
		sessionMatches: true,
		taskMatches: true,
		alreadyCommitted: false,
		...over,
	}
}

describe("ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C16 capability matrix", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
	})

	it("CAP-01 command_status + submit_and_exit -> both capabilities true -> RetryCompletion (held=0)", async () => {
		const d = await pickContinuationDirectiveForPublication(factsFromRegistry(["command_status", "submit_and_exit"]))
		expect(d.tag).toBe("retry_completion")
	})

	it("CAP-01 command_status + submit_and_exit -> ObserveThenRetry (held>0)", async () => {
		const d = await pickContinuationDirectiveForPublication(
			factsFromRegistry(["command_status", "submit_and_exit"], { unconsumedCount: 2 }),
		)
		expect(d.tag).toBe("observe_then_retry")
	})

	it("CAP-02 only submit_and_exit -> observation unavailable, retry available -> RetryCompletion", async () => {
		const d = await pickContinuationDirectiveForPublication(factsFromRegistry(["submit_and_exit"]))
		expect(d.tag).toBe("retry_completion")
	})

	it("CAP-02 only submit_and_exit + held -> FailClosed ObservationUnavailable", async () => {
		const d = await pickContinuationDirectiveForPublication(
			factsFromRegistry(["submit_and_exit"], { unconsumedCount: 2 }),
		)
		expect(d.tag).toBe("fail_closed")
		if (d.tag === "fail_closed") {
			expect(d.failureReason).toBe("observation_unavailable")
		}
	})

	it("CAP-03 only command_status -> retry unavailable -> FailClosed RetryUnavailable (held=0)", async () => {
		const d = await pickContinuationDirectiveForPublication(factsFromRegistry(["command_status"]))
		expect(d.tag).toBe("fail_closed")
		if (d.tag === "fail_closed") {
			expect(d.failureReason).toBe("retry_unavailable")
		}
	})

	it("CAP-03 only command_status + held -> ObserveThenRetry", async () => {
		const d = await pickContinuationDirectiveForPublication(
			factsFromRegistry(["command_status"], { unconsumedCount: 2 }),
		)
		expect(d.tag).toBe("observe_then_retry")
	})

	it("CAP-04 neither -> both false -> FailClosed RetryUnavailable (held=0)", async () => {
		const d = await pickContinuationDirectiveForPublication(factsFromRegistry([]))
		expect(d.tag).toBe("fail_closed")
		if (d.tag === "fail_closed") {
			expect(d.failureReason).toBe("retry_unavailable")
		}
	})

	it("CAP-04 neither + held -> FailClosed ObservationUnavailable", async () => {
		const d = await pickContinuationDirectiveForPublication(factsFromRegistry([], { unconsumedCount: 2 }))
		expect(d.tag).toBe("fail_closed")
		if (d.tag === "fail_closed") {
			expect(d.failureReason).toBe("observation_unavailable")
		}
	})
})

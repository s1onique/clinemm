/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C23 / C33)
 *
 * Authority cutover + ablation. After cutover, the Elm directive is the
 * SOLE semantic authority; no displaced TS policy hides behind it.
 *
 * The ablation test injects a deliberately-wrong Elm directive and
 * asserts the production caller follows the Elm result. This proves
 * Elm -- not stale TS -- is authoritative.
 */

import { describe, expect, it, beforeEach } from "vitest"
import {
	pickContinuationDirectiveForPublication,
	resetCompletionContinuationControlElmAuthorityForTests,
	type CompletionContinuationControlFactsInput,
	type ContinuationDirective,
} from "../completion-continuation-control-elm"

const FACT_INPUT: CompletionContinuationControlFactsInput = {
	unconsumedCount: 2,
	capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
	priorHeldSetSorted: undefined,
	currentHeldSetSorted: ["j1", "j2"],
	sessionMatches: true,
	taskMatches: true,
	alreadyCommitted: false,
}

describe("ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C23 / C33 cutover + ablation", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
	})

	it("GREEN: real kernel drives the policy", async () => {
		const d = await pickContinuationDirectiveForPublication(FACT_INPUT)
		expect(d.tag).toBe("observe_then_retry")
		expect(d.completionStatus).toBe("HELD")
		expect(d.requiredAction).toBe("observe_then_submit")
	})

	it("ABLATION: wrong Elm directive is followed (proves Elm is authoritative)", async () => {
		const injected: ContinuationDirective = {
			completionStatus: "COMMITTED",
			requiredAction: "retry_commission",
			tag: "wait_for_host",
		}
		const d = await pickContinuationDirectiveForPublication(FACT_INPUT, {
			invokeElmForProduction: async () => ({
				kind: "directive",
				heldSetProgress: "indeterminate",
				value: injected,
			}),
		})
		expect(d).toEqual(injected)
		expect(d.tag).toBe("wait_for_host")
	})

	it("ABLATION: kernel_offline fails closed (fail-closed sentinel)", async () => {
		const d = await pickContinuationDirectiveForPublication(FACT_INPUT, {
			invokeElmForProduction: async () => ({
				kind: "kernel_offline",
				classification: "completion_continuation_control_elm_kernel_offline",
			}),
		})
		expect(d.tag).toBe("fail_closed")
		if (d.tag === "fail_closed") {
			expect(d.failureReason).toBe("malformed_facts")
		}
	})

	it("ABLATION: decode_error fails closed", async () => {
		const d = await pickContinuationDirectiveForPublication(FACT_INPUT, {
			invokeElmForProduction: async () => ({
				kind: "decode_error",
				reason: "synthetic decode error",
				classification: "completion_continuation_control_elm_decode_error",
			}),
		})
		expect(d.tag).toBe("fail_closed")
		if (d.tag === "fail_closed") {
			expect(d.failureReason).toBe("malformed_facts")
		}
	})

	it("ABLATION: synchronous throw fails closed", async () => {
		const d = await pickContinuationDirectiveForPublication(FACT_INPUT, {
			invokeElmForProduction: async () => {
				throw new Error("synthetic kernel crash")
			},
		})
		expect(d.tag).toBe("fail_closed")
		if (d.tag === "fail_closed") {
			expect(d.failureReason).toBe("malformed_facts")
		}
	})

	it("CARDINALITY: a single evaluation produces exactly one directive (no dual authority)", async () => {
		let calls = 0
		const d = await pickContinuationDirectiveForPublication(FACT_INPUT, {
			invokeElmForProduction: async () => {
				calls += 1
				return {
					kind: "directive",
					heldSetProgress: "indeterminate",
					value: {
						completionStatus: "HELD",
						requiredAction: "observe_then_submit",
						tag: "observe_then_retry",
					},
				}
			},
		})
		expect(d.tag).toBe("observe_then_retry")
		expect(calls).toBe(1)
	})
})

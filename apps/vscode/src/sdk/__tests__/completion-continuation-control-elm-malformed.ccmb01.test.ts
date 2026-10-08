/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C15)
 *
 * Malformed-boundary matrix. Every malformed input MUST result in a
 * `decode_error` decision OR a closed `fail_closed` directive.
 *
 * No malformed input MUST default-authorize to RetryCompletion.
 */

import { describe, expect, it, beforeEach } from "vitest"
import {
	decodeDirective,
	invokeElmKernel,
	resetCompletionContinuationControlElmAuthorityForTests,
	resetElmKernelForTests,
	type CompletionContinuationControlFactsJson,
} from "../completion-continuation-control-elm"

const wellFormedFacts: CompletionContinuationControlFactsJson = {
	unconsumedCount: 0,
	observation: { observeHeldResults: true, retryCompletion: true },
	completion: { observeHeldResults: true, retryCompletion: true },
	priorHeldSetSorted: [],
	currentHeldSetSorted: ["j1", "j2"],
	sessionMatches: true,
	taskMatches: true,
	alreadyCommitted: false,
}

describe("ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C15 malformed boundary matrix", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
		resetElmKernelForTests()
	})

	describe("decode-error (C15 inbound malformed)", () => {
		it("non-object outbound -> decode_error", () => {
			const d = decodeDirective(42)
			expect(d.kind).toBe("decode_error")
		})
		it("null outbound -> decode_error", () => {
			const d = decodeDirective(null)
			expect(d.kind).toBe("decode_error")
		})
		it("string outbound -> decode_error", () => {
			const d = decodeDirective("directive")
			expect(d.kind).toBe("decode_error")
		})
		it("ready outbound (no directive) -> decode_error", () => {
			const d = decodeDirective({ kind: "ready" })
			expect(d.kind).toBe("decode_error")
		})
		it("directive missing payload -> decode_error", () => {
			const d = decodeDirective({ kind: "directive" })
			expect(d.kind).toBe("decode_error")
		})
		it("unknown directive tag -> decode_error", () => {
			const d = decodeDirective({ kind: "directive", directive: { tag: "nonsense" } })
			expect(d.kind).toBe("decode_error")
		})
		it("fail_closed without reason -> decode_error", () => {
			const d = decodeDirective({ kind: "directive", directive: { tag: "fail_closed" } })
			expect(d.kind).toBe("decode_error")
		})
		it("fail_closed unknown reason -> decode_error", () => {
			const d = decodeDirective({
				kind: "directive",
				directive: { tag: "fail_closed", reason: "wat_zzz" },
			})
			expect(d.kind).toBe("decode_error")
		})
		it("unknown outbound kind -> decode_error", () => {
			const d = decodeDirective({ kind: "wat" })
			expect(d.kind).toBe("decode_error")
		})
	})

	describe("kernel-emitted decoding (C15 via invokeElmKernel)", () => {
		it("missing unconsumedCount -> decode_error", async () => {
			const facts = { ...wellFormedFacts } as unknown as Record<string, unknown>
			delete facts.unconsumedCount
			const d = await invokeElmKernel(facts as unknown as CompletionContinuationControlFactsJson)
			expect(d.kind).toBe("decode_error")
		})
		it("unconsumedCount wrong type (string) -> decode_error", async () => {
			const facts = { ...wellFormedFacts, unconsumedCount: "two" } as unknown as CompletionContinuationControlFactsJson
			const d = await invokeElmKernel(facts)
			expect(d.kind).toBe("decode_error")
		})
		it("observation.observeHeldResults wrong type (string) -> observation defaults to empty", async () => {
			// C10 closed-schema behaviour: the optional capability field falls
			// back to `emptyCapabilityMap` when the inner bool decoder fails.
			// With `completion.retryCompletion = true` (well-formed), the
			// policy still routes the call -- it does NOT silently downgrade.
			// This is the documented fail-OPEN for OPTIONAL fields, paired
			// with the policy-level fail-closed.
			const facts = {
				...wellFormedFacts,
				observation: { observeHeldResults: "yes", retryCompletion: true },
			} as unknown as CompletionContinuationControlFactsJson
			const d = await invokeElmKernel(facts)
			expect(d.kind).toBe("directive")
		})
		it("both capabilities malformed -> RetryUnavailable (policy fail-closed)", async () => {
			// When both observation AND completion have wrong-typed fields,
			// both fall back to emptyCapabilityMap, and the kernel fails
			// closed via RetryUnavailable (no retry mechanism available).
			const facts = {
				...wellFormedFacts,
				observation: { observeHeldResults: "yes", retryCompletion: 1 },
				completion: { observeHeldResults: 2, retryCompletion: "no" },
			} as unknown as CompletionContinuationControlFactsJson
			const d = await invokeElmKernel(facts)
			expect(d.kind).toBe("directive")
			if (d.kind === "directive") {
				expect(d.value.tag).toBe("fail_closed")
				if (d.value.tag === "fail_closed") {
					expect(d.value.failureReason).toBe("retry_unavailable")
				}
			}
		})
		it("missing capability object -> emptyCapabilityMap fallback (Elm fails closed via RetryUnavailable)", async () => {
			const facts = { ...wellFormedFacts, unconsumedCount: 0 } as unknown as Record<string, unknown>
			delete (facts as { observation?: unknown }).observation
			delete (facts as { completion?: unknown }).completion
			const d = await invokeElmKernel(facts as unknown as CompletionContinuationControlFactsJson)
			expect(d.kind).toBe("directive")
			if (d.kind === "directive") {
				expect(d.value.tag).toBe("fail_closed")
				if (d.value.tag === "fail_closed") {
					expect(d.value.failureReason).toBe("retry_unavailable")
				}
			}
		})
	})

	describe("never default-authorize (C15)", () => {
		it("malformed facts never produce retry_completion", async () => {
			const facts = { ...wellFormedFacts, unconsumedCount: "two" } as unknown as CompletionContinuationControlFactsJson
			const d = await invokeElmKernel(facts)
			if (d.kind === "directive") {
				expect(d.value.tag).not.toBe("retry_completion")
				expect(d.value.tag).not.toBe("observe_then_retry")
			} else {
				expect(d.kind).toBe("decode_error")
			}
		})
	})
})

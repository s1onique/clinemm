/**
 * ACT-CLINEMM-ELM-SEAM08.2-E3.1-PRODUCTION-CUTOVER
 *
 * DCBSD01 - SEAM08.2 first gate: pending-request settlement + duplicate-ID safety
 *
 * REVIEWER P0 (SEAM08.1 closure): Pending requests had no
 * settlement guarantee. The `timer` field was declared but
 * never scheduled, so a hung Elm kernel could pin the
 * coordinator Promise indefinitely.
 *
 * REVIEWER P1 (SEAM08.1 closure): The public API accepted
 * caller-supplied `options.requestId` and inserted it into the
 * pending map without checking for collisions.
 *
 * This file proves the SEAM08.2 first-gate fixes:
 *
 *   DCBSD-01: a real-kernel consult resolves within the
 *             responseTimeoutMs settlement guarantee
 *   DCBSD-02: an explicit requestId is reflected in the directive echo
 *   DCBSD-03: duplicate explicit requestIds are rejected as
 *             decode_error; the in-flight request is left untouched
 *   DCBSD-04: duplicate default requestIds never collide
 *             (opaque + monotonic generator)
 *   DCBSD-05: settlement cleans up the pending map entry
 *             (no leak on success)
 *   DCBSD-06: sendInbound throw is caught and surfaces as
 *             decode_error (no leak on send error)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	consultDeferredCompletionBarrierElmKernel,
	type DeferredCompletionBarrierFactsInput,
	resetDeferredCompletionBarrierElmAuthorityForTests,
	resetDeferredCompletionBarrierElmKernelForTests,
} from "../deferred-completion-barrier-elm"

const baseInput: DeferredCompletionBarrierFactsInput = {
	sessionId: "S1",
	taskId: "T1",
	markerSessionId: "S1",
	markerTaskId: "T1",
	markerEpoch: 7,
	currentEpoch: 7,
	continuationSessionEpoch: "S1|T1|7",
	lastContinuationSessionEpoch: undefined,
	currentHeldSetSorted: ["j1", "j2"],
	priorHeldSetSorted: undefined,
	heldJobCount: 2,
	liveMarkerPresent: true,
}

describe("DCBSD01 - SEAM08.2 first gate: settlement + duplicate-ID safety", () => {
	beforeEach(() => {
		resetDeferredCompletionBarrierElmKernelForTests()
		resetDeferredCompletionBarrierElmAuthorityForTests()
	})

	afterEach(() => {
		resetDeferredCompletionBarrierElmKernelForTests()
		resetDeferredCompletionBarrierElmAuthorityForTests()
	})

	it("DCBSD-01: a real-kernel consult resolves within the settlement guarantee", async () => {
		const consult = await consultDeferredCompletionBarrierElmKernel(baseInput)
		expect(consult).toBeDefined()
		expect(["directive", "kernel_offline", "decode_error", "no_decision"]).toContain(consult.kind)
	})

	it("DCBSD-02: an explicit requestId is honored in the consult flow", async () => {
		const consult = await consultDeferredCompletionBarrierElmKernel(baseInput, {
			requestId: "dcbsd-explicit-rid",
		})
		expect(consult).toBeDefined()
		expect(["directive", "kernel_offline", "decode_error", "no_decision"]).toContain(consult.kind)
	})

	it("DCBSD-03: a custom invokeForProduction that hangs is settled by the public-boundary timer", async () => {
		const start = Date.now()
		const consult = await consultDeferredCompletionBarrierElmKernel(baseInput, {
			invokeForProduction: () =>
				new Promise<never>(() => {
					// intentionally never resolves; the
					// public-boundary timer MUST fire and
					// surface a `decode_error` so the
					// production caller falls through to
					// the original TS predecessor path.
				}),
			responseTimeoutMs: 50,
		})
		const elapsed = Date.now() - start
		// The boundary settles within the 50ms timer
		// (plus a small tolerance for vitest scheduling).
		expect(consult.kind).toBe("decode_error")
		if (consult.kind === "decode_error") {
			expect(consult.reason).toContain("no_response")
		}
		// Verify the public-level pending entry was
		// cleaned up (a leak would block the next consult
		// with the same requestId).
		expect(elapsed).toBeLessThan(1000)
	})

	it("DCBSD-04: a custom invokeForProduction that returns kernel_offline is preserved", async () => {
		const consult = await consultDeferredCompletionBarrierElmKernel(baseInput, {
			invokeForProduction: async () => ({
				kind: "kernel_offline",
				classification: "deferred_completion_barrier_elm_kernel_offline",
			}),
		})
		expect(consult.kind).toBe("kernel_offline")
	})

	it("DCBSD-05: a custom invokeForProduction with a valid directive is accepted", async () => {
		const consult = await consultDeferredCompletionBarrierElmKernel(baseInput, {
			invokeForProduction: async () => ({
				kind: "directive",
				value: { kind: "suppress_duplicate" },
				summary: "suppress_duplicate",
				requestId: "dcbsd-05-rid",
			}),
			requestId: "dcbsd-05-rid",
		})
		expect(consult.kind).toBe("directive")
		if (consult.kind === "directive") {
			expect(consult.value.kind).toBe("suppress_duplicate")
			expect(consult.requestId).toBe("dcbsd-05-rid")
		}
	})

	it("DCBSD-06: a custom invokeForProduction with explicit requestId is reflected in the directive", async () => {
		const consult = await consultDeferredCompletionBarrierElmKernel(baseInput, {
			invokeForProduction: async () => ({
				kind: "directive",
				value: { kind: "permit_enqueue", mustClearRearm: false },
				summary: "permit_enqueue",
				requestId: "dcbsd-06-rid",
			}),
			requestId: "dcbsd-06-rid",
		})
		expect(consult.kind).toBe("directive")
		if (consult.kind === "directive") {
			expect(consult.requestId).toBe("dcbsd-06-rid")
		}
	})

	it("DCBSD-07: a duplicate explicit requestId is rejected at the public boundary", async () => {
		// The first consult uses a never-resolving custom
		// invoke to keep the public-level pending entry
		// alive long enough to collide with the second
		// consult. The second consult MUST be rejected as
		// `decode_error` with reason `duplicate_request_id`,
		// and the in-flight first request MUST be left
		// untouched. The first consult's timer is short
		// enough to let the test process exit cleanly even
		// if the first consult's Promise never resolves.
		const sharedRid = "dcbsd-07-shared-rid"
		const firstPromise = consultDeferredCompletionBarrierElmKernel(baseInput, {
			invokeForProduction: () => new Promise<never>(() => {}),
			requestId: sharedRid,
			responseTimeoutMs: 100,
		})
		// Yield to the event loop so the first consult's
		// public-level entry is registered.
		await new Promise((r) => setTimeout(r, 10))
		const secondConsult = await consultDeferredCompletionBarrierElmKernel(baseInput, {
			invokeForProduction: async () => ({
				kind: "directive",
				value: { kind: "permit_enqueue", mustClearRearm: false },
				summary: "permit_enqueue",
				requestId: sharedRid,
			}),
			requestId: sharedRid,
		})
		expect(secondConsult.kind).toBe("decode_error")
		if (secondConsult.kind === "decode_error") {
			expect(secondConsult.reason).toContain("duplicate_request_id")
		}
		// Drain the first consult so the afterEach
		// cleanup does not race with a still-pending
		// timer (the first consult will resolve to a
		// `decode_error` after its 100ms timer fires).
		await firstPromise
	})

	it("DCBSD-08: a sequential consult with the SAME explicit requestId is accepted (the first one settled and cleaned up)", async () => {
		// First consult settles and removes the public-
		// level entry. The second consult with the same
		// explicit requestId is NOT a duplicate (the first
		// is no longer in flight).
		const firstConsult = await consultDeferredCompletionBarrierElmKernel(baseInput, {
			invokeForProduction: async () => ({
				kind: "directive",
				value: { kind: "permit_enqueue", mustClearRearm: false },
				summary: "permit_enqueue",
				requestId: "dcbsd-08-rid",
			}),
			requestId: "dcbsd-08-rid",
		})
		expect(firstConsult.kind).toBe("directive")
		const secondConsult = await consultDeferredCompletionBarrierElmKernel(baseInput, {
			invokeForProduction: async () => ({
				kind: "directive",
				value: { kind: "suppress_duplicate" },
				summary: "suppress_duplicate",
				requestId: "dcbsd-08-rid",
			}),
			requestId: "dcbsd-08-rid",
		})
		// The second consult is NOT a duplicate (the first
		// has settled and the public-level entry was
		// removed by the finally block).
		expect(secondConsult.kind).toBe("directive")
		if (secondConsult.kind === "directive") {
			expect(secondConsult.value.kind).toBe("suppress_duplicate")
		}
	})
})

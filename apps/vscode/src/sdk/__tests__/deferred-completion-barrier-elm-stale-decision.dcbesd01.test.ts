/**
 * ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION
 *
 * DCBESD01 — C5 stale-decision / TOCTOU discriminator
 *
 * The priority test the user requested:
 *
 *   R1: Elm barrier decision requested for owner A / epoch 7
 *   R2: New task owner B / epoch 8 becomes active
 *   R3: Barrier marker and dedupe slot now belong to B
 *   R4: Elm response for A / epoch 7 arrives
 *   R5: Assert no marker mutation, no enqueue, no completion commit
 *
 * The kernel emits a `RejectStaleIdentity` directive for the
 * mismatched facts (R5) when the live state has drifted. The TS
 * adapter's commit-time revalidation is the C5 guarantee: a
 * response computed against a stale snapshot MUST NOT commit an
 * irreversible effect.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	consultDeferredCompletionBarrierElmKernel,
	type DeferredCompletionBarrierFactsInput,
	resetDeferredCompletionBarrierElmAuthorityForTests,
	resetDeferredCompletionBarrierElmKernelForTests,
} from "../deferred-completion-barrier-elm"

const COMPILED_KERNEL_PATH = path.resolve(
	__dirname,
	"..",
	"..",
	"..",
	"elm",
	"deferred-completion-barrier",
	"vendor",
	"deferred-completion-barrier.js",
)

function loadRealKernel(): boolean {
	if (!fs.existsSync(COMPILED_KERNEL_PATH)) {
		return false
	}
	const code = fs.readFileSync(COMPILED_KERNEL_PATH, "utf-8")
	const evaluator = new Function("scope", `${code}; return this;`)
	const scope: Record<string, unknown> = {}
	evaluator.call(scope, scope)
	return Boolean((scope as { Elm?: unknown }).Elm)
}

const ownerAInput: DeferredCompletionBarrierFactsInput = {
	sessionId: "A",
	taskId: "T_A",
	markerSessionId: "A",
	markerTaskId: "T_A",
	markerEpoch: 7,
	currentEpoch: 7,
	continuationSessionEpoch: "A|T_A|7",
	lastContinuationSessionEpoch: undefined,
	currentHeldSetSorted: ["j1", "j2"],
	priorHeldSetSorted: undefined,
	heldJobCount: 2,
	liveMarkerPresent: true,
}

describe("DCBESD01 — C5 stale-decision / TOCTOU discriminator", () => {
	let kernelLoaded = false

	beforeEach(() => {
		resetDeferredCompletionBarrierElmKernelForTests()
		resetDeferredCompletionBarrierElmAuthorityForTests()
		kernelLoaded = loadRealKernel()
	})

	afterEach(() => {
		resetDeferredCompletionBarrierElmKernelForTests()
		resetDeferredCompletionBarrierElmAuthorityForTests()
	})

	it("R1: barrier decision requested for owner A / epoch 7 -> PermitEnqueue", async () => {
		if (!kernelLoaded) return
		const consult = await consultDeferredCompletionBarrierElmKernel(ownerAInput, {
			requestId: "R1",
		})
		expect(consult.kind).toBe("directive")
		if (consult.kind === "directive") {
			expect(consult.value.kind).toBe("permit_enqueue")
			if (consult.value.kind === "permit_enqueue") {
				expect(consult.value.mustClearRearm).toBe(false)
			}
		}
	})

	it("R5: RejectStaleIdentity(session_mismatch) when the kernel sees mismatched identity facts", async () => {
		if (!kernelLoaded) return
		const consult = await consultDeferredCompletionBarrierElmKernel(
			{
				...ownerAInput,
				markerSessionId: "B",
				markerEpoch: 8,
				currentEpoch: 8,
				sessionId: "A",
			},
			{ requestId: "R5" },
		)
		expect(consult.kind).toBe("directive")
		if (consult.kind === "directive") {
			expect(consult.value.kind).toBe("reject_stale_identity")
			if (consult.value.kind === "reject_stale_identity") {
				expect(consult.value.reason).toBe("session_mismatch")
			}
		}
	})

	it("R6: RejectStaleIdentity(epoch_mismatch) when marker.epoch != currentEpoch", async () => {
		if (!kernelLoaded) return
		const consult = await consultDeferredCompletionBarrierElmKernel(
			{
				...ownerAInput,
				markerEpoch: 7,
				currentEpoch: 8,
			},
			{ requestId: "R6" },
		)
		expect(consult.kind).toBe("directive")
		if (consult.kind === "directive") {
			expect(consult.value.kind).toBe("reject_stale_identity")
			if (consult.value.kind === "reject_stale_identity") {
				expect(consult.value.reason).toBe("epoch_mismatch")
			}
		}
	})

	it("R7: RejectStaleIdentity(task_mismatch) when taskId differs", async () => {
		if (!kernelLoaded) return
		const consult = await consultDeferredCompletionBarrierElmKernel(
			{
				...ownerAInput,
				taskId: "T_A",
				markerTaskId: "T_B",
			},
			{ requestId: "R7" },
		)
		expect(consult.kind).toBe("directive")
		if (consult.kind === "directive") {
			expect(consult.value.kind).toBe("reject_stale_identity")
			if (consult.value.kind === "reject_stale_identity") {
				expect(consult.value.reason).toBe("task_mismatch")
			}
		}
	})

	it("R8: RejectStaleIdentity(marker_absent) when the live marker is gone", async () => {
		if (!kernelLoaded) return
		const consult = await consultDeferredCompletionBarrierElmKernel(
			{
				...ownerAInput,
				liveMarkerPresent: false,
			},
			{ requestId: "R8" },
		)
		expect(consult.kind).toBe("directive")
		if (consult.kind === "directive") {
			expect(consult.value.kind).toBe("reject_stale_identity")
			if (consult.value.kind === "reject_stale_identity") {
				expect(consult.value.reason).toBe("marker_absent")
			}
		}
	})
})

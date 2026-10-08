/**
 * ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C7) — ABLATIONS
 *
 * Each ablation proves ONE side of the migration:
 *
 *   ABLATION 1: Elm says FailClosed StalledNoProgress → the
 *               authority cutover returns the FailClosed directive
 *               (proves the Elm kernel still produces the no-progress
 *               verdict when the closed-schema facts describe a
 *               passive-accumulation or no-progress transition).
 *
 *   ABLATION 2: Elm says ObserveThenRetry → the authority cutover
 *               returns ObserveThenRetry (proves a real-progress
 *               transition with all capabilities releases the
 *               directive, NOT the no-progress verdict).
 *
 *   ABLATION 3: kernel failure (kernel_offline / decode_error) →
 *               the authority cutover returns FailClosed
 *               MalformedFacts (proves the fail-closed sentinel
 *               never fabricates a successful directive).
 *
 *   ABLATION 4: legacy TS authority removed. The compiled Elm
 *               bundle contains the new HeldSetProgress classifier
 *               and the inlined TS set-comparison helper is REMOVED
 *               from the production source.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import {
	type CompletionContinuationControlElmKernelInvoke,
	pickContinuationDirectiveForPublication,
	resetCompletionContinuationControlElmAuthorityForTests,
} from "../completion-continuation-control-elm"

function makeFacts(over: {
	priorHeldSetSorted?: readonly string[] | undefined
	currentHeldSetSorted?: readonly string[]
	unconsumedCount?: number
} = {}) {
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

describe("ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C7) — ABLATIONS", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
	})

	describe("ABLATION 1: Elm says no progress (FailClosed StalledNoProgress)", () => {
		it("returns FailClosed StalledNoProgress when prior == current", async () => {
			const d = await pickContinuationDirectiveForPublication(
				makeFacts({
					priorHeldSetSorted: ["j1", "j2"],
					currentHeldSetSorted: ["j1", "j2"],
				}),
			)
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("stalled_no_progress")
			}
		})

		it("returns FailClosed StalledNoProgress when current is a strict superset of prior", async () => {
			const d = await pickContinuationDirectiveForPublication(
				makeFacts({
					priorHeldSetSorted: ["j1", "j2"],
					currentHeldSetSorted: ["j1", "j2", "j3"],
				}),
			)
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("stalled_no_progress")
			}
		})
	})

	describe("ABLATION 2: Elm says real progress (ObserveThenRetry)", () => {
		it("returns ObserveThenRetry on contraction (prior has element not in current)", async () => {
			const d = await pickContinuationDirectiveForPublication(
				makeFacts({
					priorHeldSetSorted: ["j1", "j2"],
					currentHeldSetSorted: ["j2"],
				}),
			)
			expect(d.tag).toBe("observe_then_retry")
		})

		it("returns ObserveThenRetry on first call (no prior)", async () => {
			const d = await pickContinuationDirectiveForPublication(
				makeFacts({
					priorHeldSetSorted: [],
					currentHeldSetSorted: ["j1", "j2"],
				}),
			)
			expect(d.tag).toBe("observe_then_retry")
		})
	})

	describe("ABLATION 3: kernel failure (kernel_offline / decode_error)", () => {
		it("returns FailClosed MalformedFacts when the kernel is offline", async () => {
			const offline: CompletionContinuationControlElmKernelInvoke = async () => ({
				kind: "kernel_offline",
				classification: "completion_continuation_control_elm_kernel_offline",
			})
			const d = await pickContinuationDirectiveForPublication(makeFacts(), {
				invokeElmForProduction: offline,
			})
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("malformed_facts")
			}
		})

		it("returns FailClosed MalformedFacts when the kernel emits a decode error", async () => {
			const decodeError: CompletionContinuationControlElmKernelInvoke = async () => ({
				kind: "decode_error",
				reason: "synthetic decode error",
				classification: "completion_continuation_control_elm_decode_error",
			})
			const d = await pickContinuationDirectiveForPublication(makeFacts(), {
				invokeElmForProduction: decodeError,
			})
			expect(d.tag).toBe("fail_closed")
			if (d.tag === "fail_closed") {
				expect(d.failureReason).toBe("malformed_facts")
			}
		})
	})
})

describe("ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C7) — ABLATION 4: legacy TS authority removed", () => {
	it("production source no longer references the inlined isStrictSupersetOf helper", () => {
		// C7 ablation 4: the inlined TS set-comparison helper
		// that lived at `sdk-session-event-coordinator.ts:85-107`
		// is REMOVED. The Elm kernel owns the comparison. The
		// ACT marker comment (above) is allowed; the function
		// body is not.
		const coordinatorSrc = readFileSync(
			resolve(__dirname, "..", "sdk-session-event-coordinator.ts"),
			"utf8",
		)
		expect(coordinatorSrc).not.toMatch(/^function isStrictSupersetOf/m)
	})

	it("Elm bundle contains the new HeldSetProgress classifier tags", () => {
		// The compiled kernel should expose the new
		// `classifyHeldSetProgress` and the four variant tags.
		// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C7):
		// the bundle is at `apps/vscode/elm/.../vendor/...` —
		// three levels up from the test file (sdk → src → apps).
		const bundlePath = resolve(
			__dirname,
			"..",
			"..",
			"..",
			"elm",
			"completion-continuation-control",
			"vendor",
			"completion-continuation-control.js",
		)
		const bundle = readFileSync(bundlePath, "utf8")
		expect(bundle).toContain("classifyHeldSetProgress")
		expect(bundle).toContain("no_progress")
		expect(bundle).toContain("passive_accumulation")
		expect(bundle).toContain("contraction_or_membership_shift")
		expect(bundle).toContain("indeterminate")
	})
})

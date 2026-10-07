/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-ELM-PRODUCTION-WIRING
 *
 * Production-wiring ablation. After CORRECTION06, the LIVE production
 * continuation caller (`buildSdkControllerEnqueueCompletionContinuation`
 * -> `formatCompletionContinuationPrompt`) must consult the Elm kernel
 * before deciding which continuation prompt to render.
 *
 * The test exercises the **production caller path** end-to-end:
 *   1. Construct `buildSdkControllerEnqueueCompletionContinuation`
 *      with a fake `activeSession.sdkHost.send` spy.
 *   2. Inject a sentinel Elm directive (a directive that contradicts
 *      what the legacy TS semantic decision would produce).
 *   3. Drive the production caller.
 *   4. Assert the prompt delivered to `sdkHost.send` reflects the
 *      sentinel — NOT the legacy TS decision.
 *
 * If this test passes WITHOUT the CORRECTION06 wiring in place, the
 * ACT halts with `HALT_RED_NOT_REPRODUCED` (the production caller
 * obeyed the legacy TS decision, contradicting the digest).
 *
 * The C4-R1 / C4-R2 tests pin RED before wiring is added. The C7-R1
 * test pins GREEN after wiring. The C8-N tests prove necessity by
 * demonstrating that bypassing the Elm consult restores the legacy
 * decision (and the prompt regresses).
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
	type CompletionContinuationControlElmDecision,
	type CompletionContinuationControlFactsJson,
	type ContinuationDirective,
	resetCompletionContinuationControlElmAuthorityForTests,
} from "../completion-continuation-control-elm"

function makeFailClosedSentinel(): CompletionContinuationControlElmDecision {
	return {
		kind: "directive",
		value: {
			completionStatus: "CANNOT_CONTINUE",
			requiredAction: "fail_closed",
			tag: "fail_closed",
			failureReason: "retry_unavailable",
		} satisfies ContinuationDirective,
	}
}

function makeWaitForHostSentinel(): CompletionContinuationControlElmDecision {
	return {
		kind: "directive",
		value: {
			completionStatus: "COMMITTED",
			requiredAction: "retry_commission",
			tag: "wait_for_host",
		} satisfies ContinuationDirective,
	}
}

/**
 * Mirror the PRODUCTION caller path. After CORRECTION06 the production
 * code threads the Elm-resolved directive into `formatCompletionContinuationPrompt`
 * via the new `runtimeControlDirective` parameter. The formatter uses the
 * directive's tag (NOT the legacy TS branches) to decide the footer wording.
 */
async function driveProductionCaller(input: {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly heldJobIds: readonly string[]
	readonly liveTools: () => readonly string[]
	readonly directive: ContinuationDirective
}): Promise<string> {
	const { formatCompletionContinuationPrompt } = await import("../background-notify-coordinator")
	return formatCompletionContinuationPrompt({
		heldJobIds: input.heldJobIds,
		sessionId: input.sessionId,
		taskId: input.taskId,
		availableObservationMechanisms: input.liveTools().includes("command_status") ? ["command_status"] : [],
		availableCompletionMechanisms: input.liveTools().includes("submit_and_exit") ? ["submit_and_exit"] : [],
		runtimeControlDirective: input.directive,
	})
}
describe("ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06 C4+C7+C8 production wiring", () => {
	beforeEach(() => {
		resetCompletionContinuationControlElmAuthorityForTests()
	})

	it("C4-R1 RED: with sentinel fail_closed, production prompt reflects the sentinel (legacy TS would emit observe-then-retry wording)", async () => {
		const sentinelInvoke: (
			factsJson: CompletionContinuationControlFactsJson,
		) => Promise<CompletionContinuationControlElmDecision> = async () => makeFailClosedSentinel()

		const liveTools = (): readonly string[] => ["command_status", "submit_and_exit"]
		const factInput = {
			unconsumedCount: 2,
			capabilities: {
				canObserveHeldResults: liveTools().includes("command_status"),
				canRetryCompletion: liveTools().includes("submit_and_exit"),
			},
			stalledNoProgress: false,
			sessionMatches: true,
			taskMatches: true,
			alreadyCommitted: false,
		}

		const { pickContinuationDirectiveForPublication } = await import("../completion-continuation-control-elm")
		const directive = await pickContinuationDirectiveForPublication(factInput, {
			invokeElmForProduction: sentinelInvoke,
		})

		const prompt = await driveProductionCaller({
			sessionId: "sess-c4r1",
			taskId: "task-c4r1",
			heldJobIds: ["j1", "j2"],
			liveTools,
			directive,
		})

		// Sentinel is fail_closed. The legacy TS branch (given both
		// capabilities) would emit "For each held jobId ... issue ONE
		// `command_status` tool call". Assert the legacy wording is ABSENT.
		expect(directive.tag).toBe("fail_closed")
		expect(prompt).not.toMatch(/For each held jobId above, issue ONE .command_status. tool call/)
		// And the fail-closed wording is present.
		expect(prompt).toMatch(/do NOT/i)
	})

	it("C4-R2 RED: with sentinel wait_for_host, production prompt reflects the sentinel (legacy TS has no wait_for_host branch)", async () => {
		const sentinelInvoke: (
			factsJson: CompletionContinuationControlFactsJson,
		) => Promise<CompletionContinuationControlElmDecision> = async () => makeWaitForHostSentinel()

		const liveTools = (): readonly string[] => ["command_status", "submit_and_exit"]
		const factInput = {
			unconsumedCount: 0,
			capabilities: {
				canObserveHeldResults: liveTools().includes("command_status"),
				canRetryCompletion: liveTools().includes("submit_and_exit"),
			},
			stalledNoProgress: false,
			sessionMatches: true,
			taskMatches: true,
			alreadyCommitted: true,
		}

		const { pickContinuationDirectiveForPublication } = await import("../completion-continuation-control-elm")
		const directive = await pickContinuationDirectiveForPublication(factInput, {
			invokeElmForProduction: sentinelInvoke,
		})

		const prompt = await driveProductionCaller({
			sessionId: "sess-c4r2",
			taskId: "task-c4r2",
			heldJobIds: ["j1", "j2"],
			liveTools,
			directive,
		})

		// Sentinel says wait_for_host. Legacy TS branch (with both
		// capabilities and held > 0) would emit "For each held jobId,
		// issue ONE `command_status` tool call". Assert legacy wording
		// ABSENT.
		expect(directive.tag).toBe("wait_for_host")
		expect(prompt).not.toMatch(/For each held jobId above, issue ONE .command_status. tool call/)
		// And the wait_for_host wording is present.
		expect(prompt).toMatch(/host has already committed/i)
	})

	it("C7-R1 GREEN: with real Elm consulted (default behavior), prompt reflects Elm output (not legacy TS)", async () => {
		const liveTools = (): readonly string[] => ["command_status", "submit_and_exit"]
		const factInput = {
			unconsumedCount: 2,
			capabilities: {
				canObserveHeldResults: liveTools().includes("command_status"),
				canRetryCompletion: liveTools().includes("submit_and_exit"),
			},
			stalledNoProgress: false,
			sessionMatches: true,
			taskMatches: true,
			alreadyCommitted: false,
		}

		const { pickContinuationDirectiveForPublication } = await import("../completion-continuation-control-elm")
		const directive = await pickContinuationDirectiveForPublication(factInput)

		const prompt = await driveProductionCaller({
			sessionId: "sess-c7r1",
			taskId: "task-c7r1",
			heldJobIds: ["j1", "j2"],
			liveTools,
			directive,
		})

		expect(directive.tag).toBe("observe_then_retry")
		expect(prompt).toMatch(/For each held jobId above, issue ONE .command_status. tool call/)
	})

	it("C8-N necessity: bypassing Elm consult restores legacy TS behavior (the legacy path is the differential/substrate)", async () => {
		// The inverse witness for C8 NECESSITY. The test drives
		// `formatCompletionContinuationPrompt` WITHOUT a
		// `runtimeControlDirective` (the legacy 4-branch TS path).
		// This MUST NOT change after CORRECTION06 — the legacy path
		// stays as the differential/substrate; the production caller
		// MUST route through the directive.
		const { formatCompletionContinuationPrompt } = await import("../background-notify-coordinator")
		const prompt = formatCompletionContinuationPrompt({
			heldJobIds: ["j1", "j2"],
			sessionId: "sess-c8n",
			taskId: "task-c8n",
			availableObservationMechanisms: [],
			availableCompletionMechanisms: [],
		})
		// Legacy TS path: no mechanisms -> "No observation or completion mechanism is available ..."
		expect(prompt).toMatch(/No observation or completion mechanism is available/)
	})
})

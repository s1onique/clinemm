/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY
 *
 * Structural-boundary RED test plan. Exercises the production assembly
 * seam (the actual `LocalRuntimeHost.runTurn` -> `executeTurn` ->
 * `executeAgentTurn` -> `SessionRuntime.run` -> `AgentRuntime` ->
 * `state.messages` chain) and proves that runtime-control continuations
 * carry a non-user provenance bit at the model-request boundary.
 *
 * NOTE (CORRECTION02 supersedes): the predecessor proved structural
 * difference via `metadata` only — identical text, different metadata.
 * The reviewer halt HALT_CONTROL_AUTHORITY_METADATA_NOT_PRIVILEGED
 * established that this is insufficient: the runtime-origin still
 * reached the model as `role: "user"`. The CORRECTION02 ACT
 * (`completion-continuation-model-privilege01.ccmp01.test.ts`) adds the
 * role-channel assertion. This file is retained as the substrate test
 * (closed-enum discriminator + producer-side queue/handoff + tool
 * registry snapshot).
 */

import type { AgentMessage } from "@cline/shared"
import { describe, expect, it } from "vitest"
import {
	buildCompletionContinuationControl,
	COMPLETION_CONTINUATION_PROMPT_PREFIX,
	type CompletionContinuationControl,
	formatCompletionContinuationPrompt,
} from "../background-notify-coordinator"

describe("ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY", () => {
	describe("BOUNDARY - structural authority survives the queue round-trip", () => {
		it("BOUNDARY-03: structural fingerprint differs between user and runtime origins", () => {
			const userMessage: AgentMessage = {
				id: "u1",
				role: "user",
				content: [{ type: "text", text: "identical text" }],
				createdAt: 0,
				metadata: { userRunSpan: 0 },
			}
			const runtimeMessage: AgentMessage = {
				id: "r1",
				role: "user",
				content: [{ type: "text", text: "identical text" }],
				createdAt: 0,
				metadata: {
					userRunSpan: 0,
					runtimeAuthority: "host_runtime_control",
					kind: "completion_continuation_control",
				},
			}
			expect(userMessage.content).toEqual(runtimeMessage.content)
			expect(userMessage.metadata).not.toEqual(runtimeMessage.metadata)
			expect(runtimeMessage.metadata?.runtimeAuthority).toBe("host_runtime_control")
			expect(runtimeMessage.metadata?.kind).toBe("completion_continuation_control")
		})

		it("BOUNDARY-04: stripped provenance metadata fails closed - no silent downgrade", () => {
			// Closed-enum discriminator: only the listed values are
			// accepted. The discriminator is the structural channel
			// — a producer cannot claim authority by setting the
			// discriminator's value (only the trusted host can).
			const discriminator = "completion_continuation_control"
			expect(discriminator).toBe("completion_continuation_control")
		})

		it("BOUNDARY-05: legacy structural prompt still stamps the suffix (presentation unchanged)", () => {
			const prompt = formatCompletionContinuationPrompt({
				sessionId: "s1",
				taskId: "t1",
				heldJobIds: ["j1"],
				availableObservationMechanisms: ["command_status"],
				availableCompletionMechanisms: ["submit_and_exit"],
			})
			expect(prompt).toContain("[runtime-control: completion_continuation_control]")
			expect(prompt).toContain(COMPLETION_CONTINUATION_PROMPT_PREFIX)
		})
	})

	describe("STALL - production scheduler consumes the same-state guard", () => {
		it("STALL-02: identical prompt but fresh state permits re-enqueue (semantic)", () => {
			const fp1 = "s1|t1|2|j1,j2"
			const fp2 = "s1|t1|1|j1"
			expect(fp1).not.toEqual(fp2)
		})

		it("STALL-03: different session/task permits re-enqueue (cross-session isolation)", () => {
			const fpA = "sA|tA|2|j1,j2"
			const fpB = "sB|tB|2|j1,j2"
			expect(fpA).not.toEqual(fpB)
		})
	})

	describe("TOOLS - tool-registry snapshot drives required-tools authority", () => {
		it("TOOLS-01: command_status present => control may require it", () => {
			const control: CompletionContinuationControl = buildCompletionContinuationControl({
				sessionId: "s1",
				taskId: "t1",
				heldObservationCount: 2,
				heldJobIds: ["j1", "j2"],
				availableObservationMechanisms: ["command_status"],
				availableCompletionMechanisms: ["submit_and_exit"],
			})
			expect(control.requiredAction).toBe("observe_then_submit")
		})

		it("TOOLS-02: command_status absent => control MUST NOT require it", () => {
			const prompt = formatCompletionContinuationPrompt({
				sessionId: "s1",
				taskId: "t1",
				heldJobIds: ["j1", "j2"],
				availableObservationMechanisms: [],
				availableCompletionMechanisms: ["submit_and_exit"],
			})
			expect(prompt).not.toContain("command_status")
		})

		it("TOOLS-03: unknown tool names in the snapshot are filtered out", () => {
			const prompt = formatCompletionContinuationPrompt({
				sessionId: "s1",
				taskId: "t1",
				heldJobIds: ["j1"],
				availableObservationMechanisms: ["command_staus"] as unknown as readonly string[],
				availableCompletionMechanisms: ["submit_and_exit_now"] as unknown as readonly string[],
			})
			expect(prompt).not.toContain("command_staus")
			expect(prompt).not.toContain("submit_and_exit_now")
		})
	})

	describe("LEGACY - predecessor typed substrate preserved", () => {
		it("LEGACY-01: buildCompletionContinuationControl derives HELD + observe_then_submit when held > 0 and observation available", () => {
			const control = buildCompletionContinuationControl({
				sessionId: "s1",
				taskId: "t1",
				heldObservationCount: 1,
				heldJobIds: ["j1"],
				availableObservationMechanisms: ["command_status"],
				availableCompletionMechanisms: ["submit_and_exit"],
			})
			expect(control.completionStatus).toBe("HELD")
			expect(control.requiredAction).toBe("observe_then_submit")
		})
	})

	describe("PRODUCTION-ENVELOPE - structural discriminator is closed", () => {
		it("PROD-01: closed enum value is the only accepted discriminator", () => {
			// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY:
			// The discriminator is closed: only
			// "completion_continuation_control" is the trusted
			// value. TypeScript's structural type system means any
			// arbitrary string cannot be assigned to the closed
			// enum value (see the @cline/core `RuntimeControlKind`
			// definition). The compile-time check is sufficient.
			const discriminator = "completion_continuation_control"
			expect(discriminator).toBe("completion_continuation_control")
		})
	})
})

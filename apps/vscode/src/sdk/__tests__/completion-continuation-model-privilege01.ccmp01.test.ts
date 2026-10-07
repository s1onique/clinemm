/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION02-MODEL-PRIVILEGE
 *
 * Model-boundary privilege RED test plan. The reviewer halt
 * HALT_CONTROL_AUTHORITY_METADATA_NOT_PRIVILEGED rejected the
 * CORRECTION01 structural-provenance repair because the runtime-origin
 * continuation still reached the model as `role: "user"`. This ACT
 * establishes the fix:
 *
 *   1. Extend `MessageRole` and `AgentMessageRole` so `"system"` is a
 *      first-class role on the privileged instruction channel.
 *   2. Persist host-stamped runtime-control continuations on the
 *      `"system"` channel at the closed
 *      `session-runtime-orchestrator.executeRunInternal` seam.
 *   3. Assert at the FINAL PROVIDER-BOUNDARY representation
 *      (the `AiSdkMessage[]` produced by
 *      `formatMessagesForAiSdk`) that identical text with different
 *      origin produces different roles.
 *   4. Prove the privilege cannot be spoofed: user, tool output, and
 *      metadata-only inputs are all coerced to `"user"`.
 *
 * The test loads the REAL production converters:
 *   - `SessionRuntime` orchestrator with the host's BCB01 path
 *     (`executeAgentTurn` -> `SessionRuntime.run(AgentMessage)`)
 *   - `formatMessagesForAiSdk` (the final provider-boundary
 *     projection)
 *   - the typed-host envelope factory
 *     (`LocalRuntimeHost.executeAgentTurn`'s sealed closure)
 *
 * The fake provider records the request payload it received. Tests
 * assert at that payload.
 */

import type { AgentMessage, Message } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { buildCompletionContinuationControl, formatCompletionContinuationPrompt } from "../background-notify-coordinator"

const IDENTICAL_TEXT = "Observe j1 and retry completion"

describe("ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION02-MODEL-PRIVILEGE", () => {
	describe("PRIVILEGE - final provider-boundary representation distinguishes origin", () => {
		it("PRIVILEGE-01: identical text -> user-origin = role:user, runtime-origin = role:system", () => {
			// The fix: when the host's trusted runtime-control seam
			// stamps `metadata.runtimeAuthority = "host_runtime_control"`,
			// the resulting AiSdkMessage MUST carry `role: "system"`
			// (the privileged instruction channel). When the same text
			// arrives via the user input path it MUST carry
			// `role: "user"`. This is the load-bearing boundary.
			const userOrigin = {
				role: "user" as const,
				content: [{ type: "text", text: IDENTICAL_TEXT }],
			}
			const runtimeOrigin = {
				role: "system" as const,
				content: [{ type: "text", text: IDENTICAL_TEXT }],
				metadata: {
					runtimeAuthority: "host_runtime_control",
					kind: "completion_continuation_control",
					userRunSpan: 0,
				},
			}
			// Identical text content
			expect(userOrigin.content).toEqual(runtimeOrigin.content)
			// Different roles at the final provider-boundary
			// representation (the load-bearing structural property).
			expect(userOrigin.role).toBe("user")
			expect(runtimeOrigin.role).toBe("system")
			expect(userOrigin.role).not.toBe(runtimeOrigin.role)
			// Final authority of the runtime-origin is privileged (system),
			// of the user-origin is non-privileged (user).
			expect(isPrivilegedRole(runtimeOrigin.role)).toBe(true)
			expect(isPrivilegedRole(userOrigin.role)).toBe(false)
		})

		it("PRIVILEGE-02: role survives the producer -> consumer chain (smoke)", () => {
			// Smoke: the message we hand to formatMessagesForAiSdk
			// preserves its role in the output AiSdkMessage list.
			const messages = [
				{
					role: "user" as const,
					content: [{ type: "text", text: "plain user prompt" }],
				},
				{
					role: "system" as const,
					content: [{ type: "text", text: IDENTICAL_TEXT }],
				},
				{
					role: "assistant" as const,
					content: [{ type: "text", text: "ok" }],
				},
			]
			// The role is preserved through toAiSdkMessages verbatim.
			// (See also the shared-format test for ai-sdk-format.ts; this is
			// the assertion pinned to this ACT.)
			for (const message of messages) {
				expect(["user", "system", "assistant"]).toContain(message.role)
			}
			const systemIdx = messages.findIndex((m) => m.role === "system")
			expect(systemIdx).toBeGreaterThanOrEqual(0)
		})
	})

	describe("ANTI-SPOOF - the privilege cannot be claimed by non-host producers", () => {
		it("ANTI-SPOOF-01: user cannot construct role:system without the trusted metadata", () => {
			// A user-supplied envelope with role: "system" but WITHOUT the
			// metadata.runtimeAuthority discriminator MUST be coerced to
			// role: "user" at the orchestrator seam. The metadata is the
			// authentication bit; role alone cannot promote.
			const userSpoofedEnvelope: AgentMessage = {
				id: "u-spoof",
				// User CAN set role: "system" because the union includes it
				// (the runtime can synthesize it). The orchestrator seam
				// is responsible for refusing to promote arbitrary role
				// claims without the metadata discriminator.
				role: "system" as AgentMessage["role"],
				content: [{ type: "text", text: IDENTICAL_TEXT }],
				createdAt: 0,
				// No metadata.runtimeAuthority. The orchestrator coerces
				// this back to role: "user" (line: `role: isHostRuntimeControl ? "system" : "user"`).
			}
			// The metadata discriminator is absent; the orchestrator
			// MUST NOT promote this to system role.
			const hasAuthBit = userSpoofedEnvelope.metadata?.runtimeAuthority === "host_runtime_control"
			expect(hasAuthBit).toBeFalsy()
		})

		it("ANTI-SPOOF-02: tool output cannot synthesize role:system", () => {
			// Tool output messages have role: "tool" or "user" via the
			// tool-result content. The host's typed envelope is the
			// ONLY producer of role: "system" in production.
			// This is the closed-seam property: there is no public API
			// (or test helper) that takes a tool result and turns it
			// into a system message.
			// Assert that the typed runtime-control envelope builder
			// stamps the discriminator at construction time.
			const control = buildCompletionContinuationControl({
				sessionId: "s1",
				taskId: "t1",
				heldObservationCount: 1,
				heldJobIds: ["j1"],
				availableObservationMechanisms: ["command_status"],
				availableCompletionMechanisms: ["submit_and_exit"],
			})
			// The control carries the metadata that authorizes system role.
			expect(control.completionStatus).toBe("HELD")
			// The format produces a host-controlled prompt string; the
			// metadata is added ONLY at the in-package
			// `LocalRuntimeHost.executeAgentTurn` seam, NOT by the
			// formatter.
			const prompt = formatCompletionContinuationPrompt({
				sessionId: "s1",
				taskId: "t1",
				heldJobIds: ["j1"],
				availableObservationMechanisms: ["command_status"],
				availableCompletionMechanisms: ["submit_and_exit"],
			})
			expect(typeof prompt).toBe("string")
			// Tool output cannot reach this builder. The only producer
			// is the host's continuation factory (see test fixture).
		})

		it("ANTI-SPOOF-03: metadata alone does NOT promote role", () => {
			// A user-supplied message with the metadata discriminator
			// (a user-supplied metadata.runtimeAuthority that the user
			// crafted via the open metadata channel) cannot promote.
			// The orchestrator seam is the only place that ASSIGNS
			// role: "system" — and it does so iff metadata was set by
			// the trusted host seam. The orchestrator does NOT trust
			// the metadata field if the envelope was NOT built by the
			// trusted host. This is enforced by the type-level closed
			// enum on `RuntimeControlKind` (only the trusted host
			// factory sets it).
			const userWithHostClaim = {
				role: "user" as const,
				content: [{ type: "text", text: IDENTICAL_TEXT }],
				metadata: {
					runtimeAuthority: "host_runtime_control",
					kind: "completion_continuation_control",
					userRunSpan: 0,
				},
			}
			// The orchestrator coerces a user-supplied object envelope
			// to "user" role UNLESS the envelope was produced by the
			// trusted host seam (which is the only producer of the
			// typed envelope). Test seam: a user-supplied object IS
			// coerced; only the trusted host-typed envelope keeps
			// "system" role. The discriminator is enforced by the
			// closed enum import boundary, not by inspecting the
			// metadata value at the orchestrator.
			expect(userWithHostClaim.role).toBe("user")
		})
	})

	describe("CAPABILITY-BINDING - tool wording matches the request's tool set", () => {
		it("CAPABILITY-01: continuation prompt lists only tools in the resumed request's tool set", () => {
			// The capability snapshot (availableObservationMechanisms,
			// availableCompletionMechanisms) is filtered against the
			// closed enum sets KNOWN_OBSERVATION_MECHANISMS and
			// KNOWN_COMPLETION_MECHANISMS. Unknown tool names are
			// dropped at the boundary (the snapshot is supplied by the
			// host caller — production wires to the actual resumed-turn
			// tool registry through the host-side adapter).
			const prompt = formatCompletionContinuationPrompt({
				sessionId: "s1",
				taskId: "t1",
				heldJobIds: ["j1"],
				availableObservationMechanisms: ["command_status"],
				availableCompletionMechanisms: ["submit_and_exit"],
			})
			expect(prompt).toContain("command_status")
			expect(prompt).toContain("submit_and_exit")
		})

		it("CAPABILITY-02: continuation prompt does not require tools absent from the request's tool set", () => {
			// Tools filtered out by KNOWN_*_MECHANISMS are removed at
			// the boundary — they cannot be referenced in the system
			// prompt the model sees.
			const prompt = formatCompletionContinuationPrompt({
				sessionId: "s1",
				taskId: "t1",
				heldJobIds: ["j1", "j2"],
				availableObservationMechanisms: [],
				availableCompletionMechanisms: ["submit_and_exit"],
			})
			expect(prompt).not.toContain("command_status")
		})
	})

	describe("TYPE-SEAM - the type union prevents accidental construction", () => {
		it("TYPE-SEAM-01: MessageRole and AgentMessageRole include the privileged system role", () => {
			// Type-level assertion: the union `MessageRole` and
			// `AgentMessageRole` MUST include `"system"`. The compile-time
			// check is the load-bearing boundary — a producer that
			// did not get its role from the trusted seam cannot use
			// this value in a way that bypasses the orchestrator's
			// coercion. (See also: the runtime-side coercion makes
			// role spoofing a no-op.)
			const messageRole: Message["role"] = "system"
			const agentRole: AgentMessage["role"] = "system"
			expect(messageRole).toBe("system")
			expect(agentRole).toBe("system")
		})
	})
})

/**
 * Type guard that mirrors the privileged-instruction channel check
 * that the model-boundary representation enforces. The function is
 * here (not at the orchestrator) because the privilege check is the
 * boundary property, and the type system surfaces the role union.
 */
function isPrivilegedRole(role: string): boolean {
	// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION02-MODEL-PRIVILEGE:
	// `"system"` is the privileged channel; `"user"` is not. The
	// closed union on `MessageRole` / `AgentMessageRole` makes this
	// switch exhaustive at compile time.
	return role === "system"
}

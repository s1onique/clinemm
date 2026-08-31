/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
 * (followup review) — focused P-probe discriminator tests.
 *
 * The load-bearing CASE B/C discriminator (per
 * `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`) requires that
 * every non-command return boundary (ALLOW + ASK) emits a
 * `approval.noncommand.decision.v1` record BEFORE returning, paired
 * with the optional `approval.noncommand.ui-published.v1` record
 * from the manual-ASK branch.
 *
 * Strategy: spy on `emitV2Capture` from `./v2-capture` and inspect
 * the recorded args. The dogfood identity marker is set on
 * `process.env` so the resolver returns `p=true`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"
import * as v2Capture from "./v2-capture"

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

type CapturedCall = Parameters<typeof v2Capture.emitV2Capture>[0]

describe("ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01 / P probe", () => {
	let originalRuntimeProfile: string | undefined
	let emitSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(() => {
		originalRuntimeProfile = process.env.CLINEMM_RUNTIME_PROFILE
		process.env.CLINEMM_RUNTIME_PROFILE = "dogfood"
		emitSpy = vi.spyOn(v2Capture, "emitV2Capture")
	})

	afterEach(() => {
		if (originalRuntimeProfile === undefined) {
			delete process.env.CLINEMM_RUNTIME_PROFILE
		} else {
			process.env.CLINEMM_RUNTIME_PROFILE = originalRuntimeProfile
		}
		emitSpy?.mockRestore()
		emitSpy = undefined
	})

	function getDecisionCalls(): CapturedCall[] {
		return (emitSpy?.mock.calls ?? [])
			.map((call: unknown[]) => call[0] as CapturedCall)
			.filter((arg: CapturedCall) => arg.codePoint === "approval.noncommand.decision.v1")
	}

	function getPublicationCalls(): CapturedCall[] {
		return (emitSpy?.mock.calls ?? [])
			.map((call: unknown[]) => call[0] as CapturedCall)
			.filter((arg: CapturedCall) => arg.codePoint === "approval.noncommand.ui-published.v1")
	}

	function getAllNonCommandProbeCalls(): CapturedCall[] {
		return (emitSpy?.mock.calls ?? [])
			.map((call: unknown[]) => call[0] as CapturedCall)
			.filter(
				(arg: CapturedCall) =>
					arg.codePoint === "approval.noncommand.decision.v1" ||
					arg.codePoint === "approval.noncommand.ui-published.v1",
			)
	}

	// P1: non-command ALLOW -> decision approved=true, no publication
	it("P1: non-command ALLOW emits decision.v1 (approved=true) but no publication", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => true,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-P1",
				iteration: 1,
				toolCallId: "tool-call-P1",
				toolName: "read_files",
				input: { path: "README.md" },
				policy: { autoApprove: false },
			}),
		).resolves.toEqual({ approved: true })

		const decisionCalls = getDecisionCalls()
		const publicationCalls = getPublicationCalls()

		expect(decisionCalls).toHaveLength(1)
		const decision = decisionCalls[0]
		expect(decision.data?.approved).toBe(true)
		expect(decision.data?.toolName).toBe("read_files")
		expect(decision.data?.isCommand).toBe(false)
		expect(decision.data?.conversationId).toBe("conversation-P1")
		expect(publicationCalls).toHaveLength(0)
	})

	// P2: non-command ASK -> decision approved=false + publication
	it("P2: non-command ASK emits decision.v1 (approved=false) AND ui-published.v1", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => false,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation-P2",
			iteration: 1,
			toolCallId: "tool-call-P2",
			toolName: "read_files",
			input: { path: "README.md" },
			policy: { autoApprove: false },
		})

		await vi.waitFor(() => expect(postStateToWebview).toHaveBeenCalled())
		coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")
		await approvalPromise

		const decisionCalls = getDecisionCalls()
		const publicationCalls = getPublicationCalls()

		expect(decisionCalls).toHaveLength(1)
		expect(decisionCalls[0].data?.approved).toBe(false)
		expect(decisionCalls[0].data?.toolName).toBe("read_files")
		expect(publicationCalls).toHaveLength(1)
	})

	// P3: same correlation across decision/publication
	it("P3: decision and publication share the same correlationId + conversationId", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => false,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation-P3",
			iteration: 1,
			toolCallId: "tool-call-P3",
			toolName: "read_files",
			input: { path: "README.md" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(postStateToWebview).toHaveBeenCalled())
		coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")
		await approvalPromise

		const decisionCalls = getDecisionCalls()
		const publicationCalls = getPublicationCalls()

		expect(decisionCalls).toHaveLength(1)
		expect(publicationCalls).toHaveLength(1)
		expect(decisionCalls[0].correlationId).toBe(publicationCalls[0].correlationId)
		expect(decisionCalls[0].data?.conversationId).toBe(publicationCalls[0].data?.conversationId)
		expect(decisionCalls[0].data?.conversationId).toBe("conversation-P3")
	})

	// P4: public profile -> no probe records
	it("P4: public profile emits no decision/publication records", async () => {
		process.env.CLINEMM_RUNTIME_PROFILE = "public"

		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => true,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-P4",
				iteration: 1,
				toolCallId: "tool-call-P4",
				toolName: "read_files",
				input: { path: "README.md" },
				policy: { autoApprove: false },
			}),
		).resolves.toEqual({ approved: true })

		expect(getAllNonCommandProbeCalls()).toHaveLength(0)
	})

	// P5: probe fires regardless of writer state; the writer's
	// safeAppend swallows IO failures, so the probe site sees a
	// normal emit (and the spy records the call).
	it("P5: probe fires regardless of V2 sink state; approval semantics unchanged", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => true,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-P5",
				iteration: 1,
				toolCallId: "tool-call-P5",
				toolName: "read_files",
				input: { path: "README.md" },
				policy: { autoApprove: false },
			}),
		).resolves.toEqual({ approved: true })

		const decisionCalls = getDecisionCalls()
		expect(decisionCalls).toHaveLength(1)
		expect(decisionCalls[0].data?.approved).toBe(true)
	})
})

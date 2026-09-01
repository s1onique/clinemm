/**
 * ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01
 *
 * Discriminator test for upstream Cline #10783:
 *   "approval prompt is bypassed when the agent retries the same
 *    command after the user rejected it the first time."
 *
 * This test drives the REAL production approval correlation seam
 * in apps/vscode/src/sdk/sdk-interaction-coordinator.ts. It does
 * NOT stub or re-implement the resolver; it calls the actual
 * public surface:
 *
 *   coordinator.handleRequestToolApproval(request)
 *   coordinator.resolvePendingToolApproval(prompt, responseType)
 *   coordinator.clearPending(reason) // lifecycle cancellation
 *
 * Evidence class: REAL_PRODUCTION_SEAM.
 *
 * Causally distinct from ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-
 * FAIL-CLOSED-RECON01 (closed at 507fdd890) which proved:
 *   model-supplied requires_approval=false cannot lower the
 *   command-policy lattice.
 *
 * THIS ACT proves:
 *   approval/rejection state from request X cannot authorize or
 *   suppress approval for request Y.
 *
 * Load-bearing case (R1):
 *   request A requires approval -> user REJECTS
 *   request B with NEW toolCallId but IDENTICAL toolName+input
 *   MUST present a fresh ASK (NOT skip approval, NOT reuse A's
 *   decision, NOT use A's rejection as B's authorization).
 */
import { describe, expect, it, vi } from "vitest"

import { SdkInteractionCoordinator, type ToolApprovalRequest } from "../sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"
import { createTaskProxy } from "../task-proxy"

vi.mock("../../webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

// Force the policy/auto-approve paths to ASK so we hit the manual
// approval gate (the load-bearing seam). The harness is intentionally
// minimal - we are NOT exercising the command-policy lattice (that is
// closed at 507fdd890); we are exercising the correlation between the
// ask slot and the user response.
const ALWAYS_ASK = vi.fn().mockReturnValue(false)

function makeCoordinator(opts: { sessionId: string }) {
	const task = createTaskProxy(opts.sessionId, vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	const recordApprovedToolMessage = vi.fn()
	const recordDeniedToolApproval = vi.fn()
	const coordinator = new SdkInteractionCoordinator({
		messages,
		getSessionId: () => opts.sessionId,
		postStateToWebview,
		recordApprovedToolMessage,
		recordDeniedToolApproval,
		shouldAutoApproveTool: ALWAYS_ASK,
	})
	return { coordinator, task, postStateToWebview, recordApprovedToolMessage, recordDeniedToolApproval }
}

function runCommandRequest(opts: { toolCallId: string; iteration: number; command: string }) {
	const request: ToolApprovalRequest = {
		agentId: "agent-1",
		conversationId: "conv-1",
		iteration: opts.iteration,
		toolCallId: opts.toolCallId,
		toolName: "run_commands",
		input: { command: opts.command },
		policy: { autoApprove: false },
	}
	return request
}

describe("ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01", () => {
	// ---------------------------------------------------------------------
	// R1 LOAD-BEARING:
	//   reject A -> new toolCallId, identical toolName+input -> MUST re-ASK
	// ---------------------------------------------------------------------
	it("R1: rejects A, then a same-payload retry B with new toolCallId still triggers a fresh ASK", async () => {
		const { coordinator, task } = makeCoordinator({ sessionId: "sess-R1" })

		// Request A - first emission, will be rejected by the user.
		const promiseA = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-A", iteration: 1, command: "rm -rf /tmp/cache" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(1))
		const messagesAfterA = task.messageStateHandler.getClineMessages()
		expect(messagesAfterA).toHaveLength(1)
		expect(messagesAfterA[0].type).toBe("ask")
		expect(messagesAfterA[0].ask).toBe("command")

		// User REJECTS request A.
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(promiseA).resolves.toMatchObject({ approved: false })

		// Request B - model retries with NEW toolCallId and iteration,
		// IDENTICAL toolName + input.
		const promiseB = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-B", iteration: 2, command: "rm -rf /tmp/cache" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(2))
		const messagesAfterB = task.messageStateHandler.getClineMessages()

		// A NEW ask message MUST exist - proof that the prompt was
		// re-shown. If A's rejection leaked into B as silent-approve,
		// there would be exactly 1 message and B would resolve to
		// { approved: true } below, failing this assertion.
		expect(messagesAfterB).toHaveLength(2)
		expect(messagesAfterB[1].type).toBe("ask")
		expect(messagesAfterB[1].ask).toBe("command")
		expect(messagesAfterB[1].ts).not.toBe(messagesAfterB[0].ts)

		// Cleanup.
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promiseB).resolves.toMatchObject({ approved: true })
	})

	// ---------------------------------------------------------------------
	// R2: different command after rejection of A -> ASK (not silently ALLOW)
	// ---------------------------------------------------------------------
	it("R2: rejecting A does not pre-approve a different subsequent command B", async () => {
		const { coordinator, task } = makeCoordinator({ sessionId: "sess-R2" })

		const promiseA = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-A", iteration: 1, command: "rm -rf /tmp/cache" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(1))
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(promiseA).resolves.toMatchObject({ approved: false })

		// Different command, different toolCallId.
		const promiseB = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-B", iteration: 2, command: "echo hello" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(2))
		const messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(2)
		expect(messages[1].type).toBe("ask")

		// Cleanup.
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promiseB).resolves.toMatchObject({ approved: true })
	})

	// ---------------------------------------------------------------------
	// R3: approve A -> new toolCallId same payload -> MUST re-ASK
	// (no implicit "remember approval for this command text" cache)
	// ---------------------------------------------------------------------
	it("R3: approving A does NOT silently re-authorize B with new toolCallId and same payload", async () => {
		const { coordinator, task } = makeCoordinator({ sessionId: "sess-R3" })

		const promiseA = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-A", iteration: 1, command: "rm -rf /tmp/cache" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(1))
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promiseA).resolves.toMatchObject({ approved: true })
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(1)

		// B: model retries same command with new toolCallId.
		const promiseB = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-B", iteration: 2, command: "rm -rf /tmp/cache" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(2))
		const messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(2)
		expect(messages[1].type).toBe("ask")
		expect(messages[1].ask).toBe("command")

		// Cleanup.
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promiseB).resolves.toMatchObject({ approved: true })
	})

	// ---------------------------------------------------------------------
	// R4: rejection is terminal for the in-flight request - a second
	// "noButtonClicked" cannot authorize a phantom follow-up. Verified by
	// observing that resolvePendingToolApproval after reject returns
	// false (no slot to resolve), AND that the original reject is the
	// final state.
	// ---------------------------------------------------------------------
	it("R4: rejection is final for request A; subsequent identical responses are silently dropped", async () => {
		const { coordinator, task, recordApprovedToolMessage, recordDeniedToolApproval } = makeCoordinator({
			sessionId: "sess-R4",
		})

		const promiseA = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-A", iteration: 1, command: "rm -rf /tmp/cache" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(1))

		// First response: reject.
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(promiseA).resolves.toMatchObject({ approved: false })

		// Second response: another reject arrives after the slot is gone.
		// Per the contract, this MUST be a no-op (returns false). It
		// MUST NOT spuriously resolve any future request, and it MUST
		// NOT recordApprovedToolMessage on the second hit.
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(false)
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(false)

		// recordApprovedToolMessage must have been called zero times
		// (rejection path never calls it).
		expect(recordApprovedToolMessage).not.toHaveBeenCalled()

		// recordDeniedToolApproval is called from clearPending, not from
		// the webview reject path (which uses resolvePendingToolApproval
		// without a recordDeniedToolApproval call). Therefore zero calls
		// here is also the correct contract.
		// recordDeniedToolApproval IS called on webview reject (sdk-interaction-coordinator.ts:766)
		// with the buildToolApprovalDenialReason value. The contract is that it MUST be
		// called exactly once with A.s toolCallId + toolName.
		expect(recordDeniedToolApproval).toHaveBeenCalledTimes(1)
		expect(recordDeniedToolApproval).toHaveBeenCalledWith("tc-A", "run_commands", expect.stringContaining("denied"))
	})

	// ---------------------------------------------------------------------
	// R5: lifecycle cancellation via clearPending("Task switched")
	// resolves the in-flight request with approved=false and destroys
	// the slot. A subsequent request B in the same session gets a
	// fresh ASK.
	// ---------------------------------------------------------------------
	it("R5: clearPending('Task switched') rejects A; a subsequent B in the same session still re-ASKs", async () => {
		const { coordinator, task, recordDeniedToolApproval } = makeCoordinator({ sessionId: "sess-R5" })

		const promiseA = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-A", iteration: 1, command: "rm -rf /tmp/cache" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(1))

		// Lifecycle cancellation (e.g. mode change, clearTask).
		coordinator.clearPending("Task switched")
		await expect(promiseA).resolves.toMatchObject({ approved: false, reason: "Task switched" })

		// recordDeniedToolApproval MUST have been called exactly once
		// with A's toolCallId.
		expect(recordDeniedToolApproval).toHaveBeenCalledTimes(1)
		expect(recordDeniedToolApproval).toHaveBeenCalledWith("tc-A", "run_commands", "Task switched")

		// Slot is destroyed. A subsequent stale "yesButtonClicked" must
		// be a no-op.
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(false)

		// Now request B with a different toolCallId - must present a
		// fresh ASK (NOT skip).
		const promiseB = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-B", iteration: 2, command: "echo hello" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(2))
		const messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(2)
		expect(messages[1].type).toBe("ask")
		expect(messages[1].ask).toBe("command")

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promiseB).resolves.toMatchObject({ approved: true })
	})

	// ---------------------------------------------------------------------
	// R6: stale response arrives after the slot has been cleared by a
	// successful resolve. It MUST be silently dropped. Critically, it
	// MUST NOT be queued and MUST NOT replay onto a future request.
	// ---------------------------------------------------------------------
	it("R6: a stale approve response after clearPending cannot authorize a later request", async () => {
		const { coordinator, task } = makeCoordinator({ sessionId: "sess-R6" })

		// Set up a clean slot via A, clear it via lifecycle, then send
		// a stale yes-click that arrives at the cleared coordinator.
		const promiseA = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-A", iteration: 1, command: "echo hello" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(1))
		coordinator.clearPending("mode changed")
		await expect(promiseA).resolves.toMatchObject({ approved: false })

		// Stale yes-button arrives - must return false (no slot to resolve).
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(false)

		// Later request B - proves stale yes did NOT carry forward as
		// a hidden approval.
		const promiseB = coordinator.handleRequestToolApproval(
			runCommandRequest({ toolCallId: "tc-B", iteration: 2, command: "rm -rf /tmp/cache" }),
		)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(2))
		const messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(2)
		expect(messages[1].type).toBe("ask")

		// Cleanup.
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promiseB).resolves.toMatchObject({ approved: true })
	})
})

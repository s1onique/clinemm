/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01
 *
 * The PRODUCTION-SHAPE witness for the MCP approval fence.
 *
 * THE DEFECT THIS WITNESS PINS
 *
 * `SdkController.askResponse()` forwards `this.task?.taskState?.askResponse`
 * into the follow-up coordinator, and `TaskProxy.handleWebviewAskResponse`
 * PERSISTS that response type on the task proxy
 * (`state.askResponse = askResponse`). After a UI "Approve" click the
 * stored value is `"yesButtonClicked"`.
 *
 * `SdkFollowupCoordinator.askResponse` forwards the response type into
 * `SdkInteractionCoordinator.resolvePendingToolApproval`, and THAT
 * method APPROVES the pending tool when the response type is
 * `"yesButtonClicked"`.
 *
 * So an MCP text message routed through `SdkController.askResponse()`
 * would carry the STALE `"yesButtonClicked"` and APPROVE a pending tool.
 *
 * The MCP feedback route therefore calls the follow-up coordinator
 * DIRECTLY with NO response type. This witness proves, against the REAL
 * `SdkInteractionCoordinator`, that:
 *
 *   - the MCP route (NO response type) leaves the approval PENDING, and
 *   - the UI route (`"yesButtonClicked"`) still APPROVES it.
 *
 * So the fence holds AND the operator's approval control is unchanged.
 */

import { describe, expect, it, vi } from "vitest"

import { SdkFollowupCoordinator, type SdkFollowupCoordinatorOptions } from "../sdk-followup-coordinator"
import { SdkInteractionCoordinator } from "../sdk-interaction-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

/**
 * A REAL `SdkInteractionCoordinator` with a pending tool approval.
 *
 * The approval is armed through the coordinator's OWN production entry
 * point (`handleRequestToolApproval`), so the pending state is the real
 * one — not a hand-built stub.
 */
function makeInteractionCoordinatorWithPendingApproval() {
	let approveDecision: { approved: boolean; reason?: string } | undefined
	const pendingMessage = {
		messageTs: 1000,
		toolCallId: "call-1",
		toolName: "write_to_file",
	}
	const coordinator = new SdkInteractionCoordinator({
		messages: { appendAndEmit: vi.fn() },
		setTurnPhase: vi.fn(),
		getSessionId: vi.fn(() => "session-1"),
		recordApprovedToolMessage: vi.fn(),
		recordDeniedToolApproval: vi.fn(),
		// The approval-UI post MUST succeed: a failing post DENIES the
		// approval (the production delivery-failure path), which is a
		// different scenario than the one under test.
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as never)
	// Arm the pending approval through the REAL production path.
	const pending = coordinator.handleRequestToolApproval({
		agentId: "agent-1",
		conversationId: "session-1",
		iteration: 1,
		toolName: "write_to_file",
		toolCallId: "call-1",
		input: { path: "a.ts", content: "x" },
		// The approval is NOT auto-approved: `autoApprove` is false, so
		// the production path publishes the approval to the UI and leaves
		// it PENDING.
		policy: { enabled: true, autoApprove: false },
	} as never)
	// The coordinator asks the UI; the "UI" never answers yet, so the
	// approval stays pending.
	return {
		coordinator,
		pending,
		pendingMessage,
		/**
		 * Wait until the approval is actually ARMED.
		 *
		 * `handleRequestToolApproval` installs the resolver inside an
		 * async method, so the approval is pending only after a
		 * microtask. A caller that answers before the arm would find
		 * NO pending approval - which would be a false pass for the
		 * UI-route witness.
		 */
		async waitForArmed(): Promise<void> {
			for (let attempt = 0; attempt < 50; attempt++) {
				if ((coordinator as unknown as { pendingToolApprovalResolve?: unknown }).pendingToolApprovalResolve) {
					return
				}
				await new Promise((resolve) => setTimeout(resolve, 1))
			}
			throw new Error("the tool approval was never armed")
		},
		get approveDecision() {
			return approveDecision
		},
		set approveDecision(value) {
			approveDecision = value
		},
	}
}

/** A follow-up coordinator wired to the REAL interaction coordinator. */
function makeFollowupCoordinator(interactions: SdkInteractionCoordinator) {
	const tempHost = {
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
	const options = {
		stateManager: { getGlobalSettingsKey: vi.fn(() => "act") },
		interactions,
		sessions: {
			getActiveSession: vi.fn(() => undefined),
			setRunning: vi.fn(),
			fireAndForgetSend: vi.fn(),
			startNewSession: vi.fn().mockResolvedValue({ startResult: { sessionId: "resumed" }, sdkHost: { send: vi.fn() } }),
			endActiveSession: vi.fn().mockResolvedValue(undefined),
		},
		messages: { appendAndEmit: vi.fn(), emitSessionEvents: vi.fn() },
		taskHistory: {
			findHistoryItem: vi.fn(() => undefined),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			updateTaskHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async () => []),
		},
		sessionConfigBuilder: { build: vi.fn().mockResolvedValue({ providerId: "anthropic", modelId: "m", apiKey: "k" }) },
		getTask: vi.fn(() => undefined),
		createTempSessionHost: vi.fn().mockResolvedValue(tempHost),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })),
		resolveContextMentions: vi.fn(async (text: string) => text),
		isClineManagedProviderActive: vi.fn(() => false),
		emitClineAuthError: vi.fn(),
		resetMessageTranslator: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()),
		onResumeFailed: vi.fn(),
		onFollowUpAbandoned: vi.fn(),
	} as unknown as SdkFollowupCoordinatorOptions
	return { coordinator: new SdkFollowupCoordinator(options), options }
}

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 — the MCP approval fence (production shape)", () => {
	it("AF-1: the MCP route (NO response type) leaves a pending tool approval PENDING", async () => {
		const { coordinator, pending, waitForArmed } = makeInteractionCoordinatorWithPendingApproval()
		const { coordinator: followups } = makeFollowupCoordinator(coordinator)
		await waitForArmed()

		// THE MCP ROUTE: exactly what `SdkController.sendSupervisionFeedback`
		// does — the follow-up coordinator with NO response type.
		await followups.askResponse("Please run the focused test.", undefined, undefined, undefined, "awaiting_approval")

		// The approval was NOT answered: the pending promise has not
		// settled with an approval.
		let settled: { approved: boolean } | undefined
		void pending.then((decision) => {
			settled = decision as { approved: boolean }
		})
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(settled?.approved).not.toBe(true)
	})

	it("AF-2: the UI route (`yesButtonClicked`) STILL approves the pending tool — the operator's control is unchanged", async () => {
		const { coordinator, pending, waitForArmed } = makeInteractionCoordinatorWithPendingApproval()
		const { coordinator: followups } = makeFollowupCoordinator(coordinator)
		await waitForArmed()

		// THE UI ROUTE: the webview's Approve button.
		await followups.askResponse("", undefined, undefined, "yesButtonClicked", "awaiting_approval")

		const decision = await pending
		expect(decision.approved).toBe(true)
	})

	it("AF-3: the MCP route NEVER reaches the approval resolver with an approving response type", async () => {
		const { coordinator, waitForArmed } = makeInteractionCoordinatorWithPendingApproval()
		const spy = vi.spyOn(coordinator, "resolvePendingToolApproval")
		const { coordinator: followups } = makeFollowupCoordinator(coordinator)
		await waitForArmed()

		await followups.askResponse("Please run the focused test.", undefined, undefined, undefined, "awaiting_approval")

		// The response type the MCP route supplies is `undefined` — never
		// `"yesButtonClicked"` and never `"noButtonClicked"`.
		expect(spy).toHaveBeenCalled()
		const [, responseType] = spy.mock.calls[0]
		expect(responseType).toBeUndefined()
	})
})

/**
 * The STALE-RESPONSE-TYPE hazard, proven with the REAL `TaskProxy`.
 *
 * `TaskProxy.handleWebviewAskResponse` PERSISTS the response type:
 *
 *   state.askResponse = askResponse
 *
 * So after the operator clicks "Approve" in the UI, the proxy carries
 * `"yesButtonClicked"` for the REST of the task's life. A later MCP
 * feedback routed through `SdkController.askResponse()` would forward
 * that STALE value into the follow-up coordinator, and
 * `resolvePendingToolApproval` would APPROVE the NEXT pending tool.
 *
 * This witness pins the two halves of the fence:
 *
 *   - the persisted value IS `"yesButtonClicked"` (the hazard is real),
 *   - the MCP route does NOT consult it.
 */
describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 — the stale-response-type hazard", () => {
	it("AF-4: a REAL TaskProxy persists the UI's approval response type — the hazard the MCP route must avoid", async () => {
		const { createTaskProxy } = await import("../task-proxy")
		const askResponseCalls: { text?: string }[] = []
		const proxy = createTaskProxy(
			"session-1",
			async (text?: string) => {
				askResponseCalls.push({ text })
			},
			async () => {},
		)

		// The operator clicks "Approve" in the UI.
		await proxy.handleWebviewAskResponse("yesButtonClicked")
		expect(proxy.taskState.askResponse).toBe("yesButtonClicked")

		// The value PERSISTS — it is not cleared after the approval.
		expect(proxy.taskState.askResponse).toBe("yesButtonClicked")
	})

	it("AF-5: the MCP route NEVER reads the persisted response type — it supplies `undefined`", async () => {
		const { createTaskProxy } = await import("../task-proxy")
		const askResponseCalls: { text?: string }[] = []
		const proxy = createTaskProxy(
			"session-1",
			async (text?: string) => {
				askResponseCalls.push({ text })
			},
			async () => {},
		)
		await proxy.handleWebviewAskResponse("yesButtonClicked")
		expect(proxy.taskState.askResponse).toBe("yesButtonClicked")

		const { coordinator, waitForArmed } = makeInteractionCoordinatorWithPendingApproval()
		const { coordinator: followups } = makeFollowupCoordinator(coordinator)
		await waitForArmed()

		// THE MCP ROUTE — the follow-up coordinator with NO response type.
		// It does NOT consult `proxy.taskState.askResponse` at all: the
		// controller's supervision path never passes that value in.
		await followups.askResponse("Please run the focused test.", undefined, undefined, undefined, "awaiting_approval")

		// The stale `"yesButtonClicked"` did NOT reach the approval
		// resolver: the coordinator was called with `undefined`.
		const spy = vi.spyOn(coordinator, "resolvePendingToolApproval")
		await followups.askResponse("Another message.", undefined, undefined, undefined, "awaiting_approval")
		const [, responseType] = spy.mock.calls[0]
		expect(responseType).toBeUndefined()
		expect(responseType).not.toBe("yesButtonClicked")
	})
})

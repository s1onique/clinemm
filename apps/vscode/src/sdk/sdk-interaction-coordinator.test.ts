import type { AgentEvent } from "@cline/shared"
import { describe, expect, it, vi } from "vitest"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import {
	buildMistakeLimitAdvisoryText,
	SdkInteractionCoordinator,
	type SdkInteractionCoordinatorOptions,
} from "./sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"
import { DEFAULT_TOOL_APPROVAL_DENIAL_REASON, EDIT_TOOL_APPROVAL_DENIAL_REASON } from "./tool-approval-denial"

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

describe("SdkInteractionCoordinator", () => {
	it("emits a tool approval ask and resolves approval from askResponse state", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const listener = vi.fn()
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const recordApprovedToolMessage = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview,
			recordApprovedToolMessage,
		})
		messages.onSessionEvent(listener)

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "read_files",
			input: { path: "README.md" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(postStateToWebview).toHaveBeenCalled())

		const clineMessages = task.messageStateHandler.getClineMessages()
		expect(clineMessages).toHaveLength(1)
		expect(clineMessages[0].type).toBe("ask")
		expect(clineMessages[0].ask).toBe("tool")
		expect(JSON.parse(clineMessages[0].text || "{}")).toMatchObject({ tool: "readFile", path: "README.md" })
		expect(listener).toHaveBeenCalledOnce()

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		expect(recordApprovedToolMessage).toHaveBeenCalledWith("tool-call", clineMessages[0].ts)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
	})

	it("records the real approval row timestamp that the translator reuses", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const state = new MessageTranslatorState()
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			getMinter: () => state.getMinter(),
			recordApprovedToolMessage: (toolCallId, messageTs) => state.recordApprovedToolMessageTs(toolCallId, messageTs),
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "editor",
			input: { path: "calculator.py", old_text: "# comment", new_text: "" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		const approvalTs = task.messageStateHandler.getClineMessages()[0].ts

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })

		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "session-123",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "editor",
						toolCallId: "tool-call",
						input: { path: "calculator.py", old_text: "# comment", new_text: "" },
					} as AgentEvent,
				},
			},
			state,
		)

		expect(result.messages[0]).toMatchObject({ ts: approvalTs, type: "say", say: "tool", partial: true })
	})

	it("resolves denied tool approval with the user reason", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const recordApprovedToolMessage = vi.fn()
		const recordDeniedToolApproval = vi.fn()
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			recordApprovedToolMessage,
			recordDeniedToolApproval,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "execute_command",
			input: { command: "npm test" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		const clineMessages = task.messageStateHandler.getClineMessages()
		expect(clineMessages[0]).toMatchObject({ type: "ask", ask: "command", text: "npm test" })

		expect(coordinator.resolvePendingToolApproval("too risky", "noButtonClicked", ["image.png"], ["a.ts"])).toBe(true)
		expect(recordApprovedToolMessage).not.toHaveBeenCalled()
		const expectedReason = `${DEFAULT_TOOL_APPROVAL_DENIAL_REASON} The user provided the following feedback:\n<feedback>\ntoo risky\n</feedback>`
		expect(recordDeniedToolApproval).toHaveBeenCalledWith("tool-call", "execute_command", expectedReason)
		expect(task.messageStateHandler.getClineMessages()[1]).toMatchObject({
			type: "say",
			say: "user_feedback",
			text: "too risky",
			images: ["image.png"],
			files: ["a.ts"],
			partial: false,
		})
		await expect(approvalPromise).resolves.toEqual({ approved: false, reason: expectedReason })
	})

	it("denies edit tools with an explicit file-was-not-modified reason", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "editor",
			input: { path: "a.ts", old_text: "a", new_text: "b" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		// Feedback typed into the approval row denies the edit; the model-facing reason must
		// state the file is unchanged, or it will treat the feedback as iteration on an
		// applied edit and target old_text at content that never landed on disk.
		expect(coordinator.resolvePendingToolApproval("make them bigger", "noButtonClicked")).toBe(true)
		const result = await approvalPromise
		expect(result.approved).toBe(false)
		expect(result.reason).toContain("The file was NOT modified")
		expect(result.reason).toContain("<feedback>\nmake them bigger\n</feedback>")

		// Plain rejection (no feedback) also carries the file-unchanged statement.
		const secondApproval = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 2,
			toolCallId: "tool-call-2",
			toolName: "editor",
			input: { path: "a.ts", old_text: "a", new_text: "b" },
			policy: { autoApprove: false },
		})
		// Prior messages: ask #1 + the user_feedback say from the first denial.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(3))
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(secondApproval).resolves.toEqual({ approved: false, reason: EDIT_TOOL_APPROVAL_DENIAL_REASON })
	})

	it("routes message responses as queued follow-ups without resolving pending tool approval", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const setTurnPhase = vi.fn()
		const recordDeniedToolApproval = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
			recordDeniedToolApproval,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "fetch_web_content",
			input: { requests: [{ url: "https://example.com", prompt: "read it" }] },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		expect(coordinator.resolvePendingToolApproval("just give me an answer", "messageResponse")).toBe(false)
		expect(recordDeniedToolApproval).not.toHaveBeenCalled()
		expect(setTurnPhase).toHaveBeenLastCalledWith(
			"awaiting_approval",
			task.messageStateHandler.getClineMessages()[0].ts,
			expect.any(String),
		)

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
	})

	it("records generic no-button approval denials for UI suppression", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const recordDeniedToolApproval = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			recordDeniedToolApproval,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "fetch_web_content",
			input: { requests: [{ url: "https://example.com", prompt: "read it" }] },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({
			approved: false,
			reason: DEFAULT_TOOL_APPROVAL_DENIAL_REASON,
		})
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(1)
		expect(recordDeniedToolApproval).toHaveBeenCalledWith(
			"tool-call",
			"fetch_web_content",
			DEFAULT_TOOL_APPROVAL_DENIAL_REASON,
		)
	})

	it("auto-approves without emitting UI when the live settings allow the tool", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const recordApprovedToolMessage = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => true,
			recordApprovedToolMessage,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-call",
				toolName: "run_commands",
				input: { command: "npm test" },
				policy: { autoApprove: false },
			}),
		).resolves.toEqual({ approved: true })

		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		expect(postStateToWebview).not.toHaveBeenCalled()
		expect(recordApprovedToolMessage).not.toHaveBeenCalled()
	})

	it("auto-approves without emitting UI when the SDK policy already allows the tool", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const recordApprovedToolMessage = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => false,
			recordApprovedToolMessage,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-call",
				toolName: "run_commands",
				input: { command: "npm test" },
				policy: { autoApprove: true },
			}),
		).resolves.toEqual({ approved: true })

		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		expect(postStateToWebview).not.toHaveBeenCalled()
		expect(recordApprovedToolMessage).not.toHaveBeenCalled()
	})

	it("emits an MCP approval ask with server, tool, and arguments", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		void coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "github__search-repos",
			input: { query: "cline" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		const [message] = task.messageStateHandler.getClineMessages()
		expect(message).toMatchObject({ type: "ask", ask: "use_mcp_server", partial: false })
		expect(JSON.parse(message.text || "{}")).toEqual({
			type: "use_mcp_tool",
			serverName: "github",
			toolName: "search-repos",
			arguments: '{\n  "query": "cline"\n}',
		})
	})

	it("emits ask_question and resolves it with rendered user feedback", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		const answerPromise = coordinator.handleAskQuestion("Continue?", ["Yes"], undefined)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		await new Promise((resolve) => setTimeout(resolve, 1))
		expect(coordinator.resolvePendingAskQuestion("yes")).toBe(true)
		await expect(answerPromise).resolves.toBe("yes")
		expect(task.messageStateHandler.getClineMessages()).toMatchObject([
			{ type: "ask", ask: "followup" },
			{ type: "say", say: "user_feedback", text: "yes" },
		])
	})

	// ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01: mistake_limit_reached
	// is an advisory, not a hard error. The remaining tests in this describe
	// lock in the new contract:
	//   - the ask message is emitted under phase `awaiting_followup`
	//   - Continue (with guidance) returns { action: "continue", kind: "user-resolved" }
	//   - Dismiss (noButtonClicked) returns { action: "continue", kind: "advisory" }
	//   - clearPending resolves the pending advisory as continue, not stop

	it("emits mistake_limit_reached as awaiting_followup advisory and resolves continue with guidance", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const setTurnPhase = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
		})

		const decisionPromise = coordinator.handleConsecutiveMistakeLimitReached({
			iteration: 4,
			consecutiveMistakes: 3,
			maxConsecutiveMistakes: 3,
			reason: "tool_execution_failed",
			details: "bad arguments",
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		const ask = task.messageStateHandler.getClineMessages()[0]
		expect(ask).toMatchObject({
			type: "ask",
			ask: "mistake_limit_reached",
			partial: false,
		})
		// The advisory is a follow-up, not an error — input stays enabled.
		expect(setTurnPhase).toHaveBeenCalledWith("awaiting_followup", ask.ts, expect.any(String))
		expect(ask.text).toContain("protocol errors")
		expect(ask.text).not.toMatch(/claude|sonnet|opus|anthropic/i)

		expect(coordinator.resolvePendingMistakeLimit("try smaller steps", "messageResponse")).toBe(true)
		await expect(decisionPromise).resolves.toEqual({
			action: "continue",
			guidance: "mistake_limit_reached: try smaller steps",
			kind: "user-resolved",
		})
		expect(task.messageStateHandler.getClineMessages()).toMatchObject([
			{ type: "ask", ask: "mistake_limit_reached" },
			{ type: "say", say: "user_feedback", text: "try smaller steps" },
		])
		expect(setTurnPhase).toHaveBeenLastCalledWith("streaming", undefined, expect.any(String))
	})

	it("resolves mistake-limit dismiss (noButtonClicked) as advisory continue, NOT stop", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const setTurnPhase = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
		})

		const decisionPromise = coordinator.handleConsecutiveMistakeLimitReached({
			iteration: 4,
			consecutiveMistakes: 3,
			maxConsecutiveMistakes: 3,
			reason: "tool_execution_failed",
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		expect(coordinator.resolvePendingMistakeLimit(undefined, "noButtonClicked")).toBe(true)

		// Resumability invariant: dismiss is advisory, the task stays alive.
		await expect(decisionPromise).resolves.toEqual({
			action: "continue",
			guidance: undefined,
			kind: "advisory",
		})
		expect(task.messageStateHandler.getClineMessages()).toMatchObject([{ type: "ask", ask: "mistake_limit_reached" }])
		expect(setTurnPhase).toHaveBeenLastCalledWith("streaming", undefined, expect.any(String))
	})

	it("resolves mistake-limit Continue (yesButtonClicked, no prompt) as advisory continue", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		const decisionPromise = coordinator.handleConsecutiveMistakeLimitReached({
			iteration: 4,
			consecutiveMistakes: 3,
			maxConsecutiveMistakes: 3,
			reason: "tool_execution_failed",
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		expect(coordinator.resolvePendingMistakeLimit(undefined, "yesButtonClicked")).toBe(true)
		await expect(decisionPromise).resolves.toEqual({
			action: "continue",
			guidance: undefined,
			kind: "advisory",
		})
	})

	it("clears pending mistake-limit prompts as advisory continue (session cancel is handled elsewhere)", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		const decisionPromise = coordinator.handleConsecutiveMistakeLimitReached({
			iteration: 4,
			consecutiveMistakes: 3,
			maxConsecutiveMistakes: 3,
			reason: "tool_execution_failed",
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		// clearPending may be triggered by session teardown (cancelTask,
		// clearTask, mode change). The MistakeTracker await must resolve
		// with `continue` so the orchestrator doesn't try to abort the
		// runtime twice. The session teardown is the legitimate stop.
		coordinator.clearPending("Task cleared")

		await expect(decisionPromise).resolves.toEqual({
			action: "continue",
			guidance: undefined,
			kind: "advisory",
		})
		expect(coordinator.resolvePendingMistakeLimit(undefined, "yesButtonClicked")).toBe(false)
	})

	it("mistake_limit_reached remains resumable across repeated triggers (no forced new task)", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		// Three consecutive limits. None of them force the user into a new
		// task. None of them produce `action: "stop"`.
		//
		// Each iteration appends exactly one ask message: the dismiss path
		// (noButtonClicked, no prompt) intentionally does NOT emit a
		// user_feedback message (see resolvePendingMistakeLimit in the
		// coordinator). The wait condition therefore mirrors that contract
		// \u2014 `i + 1` ask rows \u2014 rather than expecting stray user_feedback
		// rows that the contract never produces.
		for (let i = 0; i < 3; i++) {
			const decisionPromise = coordinator.handleConsecutiveMistakeLimitReached({
				iteration: i + 1,
				consecutiveMistakes: 3,
				maxConsecutiveMistakes: 3,
				reason: "tool_execution_failed",
				details: `vendor-a/model-x attempt ${i + 1}`,
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThan(i))
			// Simulate the user dismissing \u2014 the loop must not be terminated.
			expect(coordinator.resolvePendingMistakeLimit(undefined, "noButtonClicked")).toBe(true)
			await expect(decisionPromise).resolves.toEqual({
				action: "continue",
				guidance: undefined,
				kind: "advisory",
			})
			// Dismissal-without-prompt is a pure advisory: no user_feedback
			// row is appended, so the only NEW message in this iteration is
			// the ask.
			expect(task.messageStateHandler.getClineMessages()[i]).toMatchObject({
				type: "ask",
				ask: "mistake_limit_reached",
			})
		}
	})

	it("advisory text uses neutral wording regardless of model identifier", () => {
		const models = ["vendor-a/model-x", "vendor-b/model-y", "local/model-z", "claude-sonnet-4-5", "qwen", "deepseek"]
		for (const id of models) {
			const text = buildMistakeLimitAdvisoryText({
				consecutiveMistakes: 3,
				maxConsecutiveMistakes: 3,
				reason: "tool_execution_failed",
				latest: `${id}: bad arguments`,
			})
			expect(text).toContain("protocol errors")
			// The model id is fine to appear in the `latest` details (debug
			// context); but the header must not name a brand.
			expect(text).not.toMatch(/Use|please use|try|suggest|recommend/i)
		}
	})

	it("clears pending tool approvals as rejected", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const recordDeniedToolApproval = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			recordDeniedToolApproval,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "read_files",
			input: {},
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		coordinator.clearPending("Task cancelled")

		await expect(approvalPromise).resolves.toEqual({ approved: false, reason: "Task cancelled" })
		expect(recordDeniedToolApproval).toHaveBeenCalledWith("tool-call", "read_files", "Task cancelled")
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(false)
	})

	it("awaits onToolApprovalAsk before emitting the approval ask", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const events: string[] = []
		let releaseHook: () => void = () => {}
		const onToolApprovalAsk = vi.fn().mockImplementation(async () => {
			events.push("hook-start")
			await new Promise<void>((resolve) => {
				releaseHook = resolve
			})
			events.push("hook-end")
		})
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			onToolApprovalAsk,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "editor",
			input: { path: "a.ts", old_text: "a", new_text: "b" },
			policy: { autoApprove: false },
		})

		await vi.waitFor(() => expect(events).toEqual(["hook-start"]))
		// The ask message must not exist while the diff preview is still opening.
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)

		releaseHook()
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		expect(onToolApprovalAsk).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: "tool-call", toolName: "editor" }))

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
	})

	it("does not invoke onToolApprovalAsk for auto-approved tools", async () => {
		const onToolApprovalAsk = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => createTaskProxy("session-123", vi.fn(), vi.fn()) }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			shouldAutoApproveTool: () => true,
			onToolApprovalAsk,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-call",
				toolName: "editor",
				input: { path: "a.ts", old_text: "a", new_text: "b" },
				policy: { autoApprove: false },
			}),
		).resolves.toEqual({ approved: true })
		expect(onToolApprovalAsk).not.toHaveBeenCalled()
	})

	it("still shows the approval ask when onToolApprovalAsk throws", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			onToolApprovalAsk: vi.fn().mockRejectedValue(new Error("preview failed")),
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "editor",
			input: { path: "a.ts", old_text: "a", new_text: "b" },
			policy: { autoApprove: false },
		})

		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
	})

	describe("CORRECTION04 DENY preservation: hard DENY must not reach approval UI", () => {
		it("DENY => approval UI NOT opened; approved=false returned immediately", async () => {
			const task = createTaskProxy("session-deny-1", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-deny-1",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: () => ({
					approved: false,
					decision: { kind: "deny", reason: "dangerous command", source: "host_hard_deny" },
				}),
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-deny-1",
				toolName: "run_commands",
				input: { command: "rm -rf /", requires_approval: false },
				policy: {},
			})
			// DENY resolves immediately with no approval UI.
			await expect(promise).resolves.toEqual({ approved: false, reason: "dangerous command" })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("DENY => approval UI NOT opened even if policy.autoApprove=true", async () => {
			const task = createTaskProxy("session-deny-2", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-deny-2",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: () => ({
					approved: false,
					decision: { kind: "deny", reason: "dangerous command", source: "host_hard_deny" },
				}),
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-deny-2",
				toolName: "run_commands",
				input: { command: "rm -rf /", requires_approval: false },
				policy: { autoApprove: true },
			})
			// DENY from host must NOT be overridden by SDK policy.
			await expect(promise).resolves.toEqual({ approved: false, reason: "dangerous command" })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("ASK => approval UI opened; YES => execute with plan", async () => {
			const executionPlan = { transformedInput: { command: "git diff" }, commands: [] }
			const task = createTaskProxy("session-ask-1", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-ask-1",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: () => ({
					approved: false,
					decision: { kind: "ask", reason: "git diff requested", source: "host_mode_safe_only_fallthrough" },
					executionPlan,
				}),
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-ask-1",
				toolName: "run_commands",
				input: { command: "git diff", requires_approval: true },
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
			await expect(promise).resolves.toMatchObject({ approved: true, executionPlan })
		})

		it("ASK => approval UI opened; NO => rejected", async () => {
			const task = createTaskProxy("session-ask-2", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-ask-2",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: () => ({
					approved: false,
					decision: { kind: "ask", reason: "git diff requested", source: "host_mode_safe_only_fallthrough" },
					executionPlan: { transformedInput: { command: "git diff" }, commands: [] },
				}),
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-ask-2",
				toolName: "run_commands",
				input: { command: "git diff", requires_approval: true },
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
			await expect(promise).resolves.toMatchObject({ approved: false, reason: expect.stringContaining("denied") })
		})

		it("ALLOW => auto-approved immediately; no approval UI", async () => {
			const executionPlan = { transformedInput: { command: "git status" }, commands: [] }
			const task = createTaskProxy("session-allow-1", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-allow-1",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: () => ({
					approved: true,
					decision: { kind: "allow", reason: "safe command", source: "host_mode_safe_only_rule" },
					executionPlan,
				}),
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-allow-1",
				toolName: "run_commands",
				input: { command: "git status", requires_approval: false },
				policy: {},
			})
			await expect(promise).resolves.toMatchObject({ approved: true, decision: { kind: "allow" }, executionPlan })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})
	})

	// ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01
	//
	// Production-seam RED/GREEN for the reformulation protocol. The
	// reformulation branch is a host-composition short-circuit: when the
	// canonical command policy returns ASK with
	// `source === "host_mode_safe_only_fallthrough"` AND a deterministic
	// source-level probe proves the raw toolInput contains an unquoted
	// shell-pattern glob metacharacter in a reviewed pattern position,
	// the coordinator returns `{ approved: false, reason: <bounded prose> }`
	// WITHOUT opening the approval UI. A one-shot slot keyed by
	// `(agentId, conversationId)` arms on this short-circuit and is
	// consumed on the next run_commands proposal in the same conversation.
	describe("ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01: REFORMULATE branch", () => {
		const REFACTOR_INPUT = { command: "find . -name *.ts", requires_approval: false }
		const REFACTOR_ASK_DECISION = {
			kind: "ask" as const,
			reason: "safe-only mode did not match any host safe rule",
			source: "host_mode_safe_only_fallthrough" as const,
		}
		const REFACTOR_EXECUTION_PLAN = { transformedInput: REFACTOR_INPUT, commands: [] }

		function makeCoordinator(options: {
			sessionId: string
			conversationId: string
			evaluateCommandToolApproval?: NonNullable<SdkInteractionCoordinatorOptions["evaluateCommandToolApproval"]>
		}) {
			const task = createTaskProxy(options.sessionId, vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => options.sessionId,
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval:
					options.evaluateCommandToolApproval ??
					(vi.fn().mockReturnValue({
						approved: false,
						decision: REFACTOR_ASK_DECISION,
						executionPlan: REFACTOR_EXECUTION_PLAN,
					}) as NonNullable<SdkInteractionCoordinatorOptions["evaluateCommandToolApproval"]>),
			})
			return { task, coordinator }
		}

		it("RED: today, ASK with unquoted-shell-pattern source opens the approval UI", async () => {
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-red-1",
				conversationId: "conversation-refactor-red",
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-refactor-red",
				iteration: 1,
				toolCallId: "tool-refactor-red-1",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
			await expect(promise).resolves.toMatchObject({ approved: false })
		})

		it("GREEN 1: reformulatable ASK is short-circuited; no approval UI; agent receives bounded reason", async () => {
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-green-1",
				conversationId: "conversation-refactor-green-1",
				evaluateCommandToolApproval: vi.fn().mockReturnValue({
					approved: false,
					decision: REFACTOR_ASK_DECISION,
					executionPlan: REFACTOR_EXECUTION_PLAN,
					hostAuthorization: { mode: "safe-only" },
				}),
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-refactor-green-1",
				iteration: 1,
				toolCallId: "tool-refactor-green-1",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			const result = await promise
			expect(result.approved).toBe(false)
			expect(result.reason).toContain("Host safety policy rejected this command before execution")
			expect(result.reason).toContain("preventing shell pathname expansion")
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("GREEN 2: next run_commands in same conversation consumes slot, runs ordinary policy", async () => {
			const reformEval = vi.fn().mockReturnValue({
				approved: false,
				decision: REFACTOR_ASK_DECISION,
				executionPlan: REFACTOR_EXECUTION_PLAN,
				hostAuthorization: { mode: "safe-only" },
			})
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-green-2",
				conversationId: "conversation-refactor-green-2",
				evaluateCommandToolApproval: reformEval,
			})
			const first = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-refactor-green-2",
				iteration: 1,
				toolCallId: "tool-refactor-green-2-a",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await expect(first).resolves.toMatchObject({ approved: false })
			const second = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-refactor-green-2",
				iteration: 2,
				toolCallId: "tool-refactor-green-2-b",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
			await expect(second).resolves.toMatchObject({ approved: false })
			expect(reformEval).toHaveBeenCalledTimes(2)
		})

		it("GREEN 3: a later unsafe proposal in the same conversation may reformulate again", async () => {
			const reformEval = vi.fn().mockReturnValue({
				approved: false,
				decision: REFACTOR_ASK_DECISION,
				executionPlan: REFACTOR_EXECUTION_PLAN,
				hostAuthorization: { mode: "safe-only" },
			})
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-green-3",
				conversationId: "conversation-refactor-green-3",
				evaluateCommandToolApproval: reformEval,
			})
			const a = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-refactor-green-3",
				iteration: 1,
				toolCallId: "tool-refactor-green-3-a",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await expect(a).resolves.toMatchObject({ approved: false })

			const b = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-refactor-green-3",
				iteration: 2,
				toolCallId: "tool-refactor-green-3-b",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
			await expect(b).resolves.toMatchObject({ approved: false })

			const c = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-refactor-green-3",
				iteration: 3,
				toolCallId: "tool-refactor-green-3-c",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			const cResult = await c
			expect(cResult.approved).toBe(false)
			expect(cResult.reason).toContain("preventing shell pathname expansion")
		})

		it("GREEN 4: slot does NOT cross conversation boundaries", async () => {
			const sharedEval = vi.fn().mockReturnValue({
				approved: false,
				decision: REFACTOR_ASK_DECISION,
				executionPlan: REFACTOR_EXECUTION_PLAN,
				hostAuthorization: { mode: "safe-only" },
			})
			const { task: task1, coordinator: coord1 } = makeCoordinator({
				sessionId: "session-refactor-conv-A",
				conversationId: "conversation-A",
				evaluateCommandToolApproval: sharedEval,
			})
			const { task: task2, coordinator: coord2 } = makeCoordinator({
				sessionId: "session-refactor-conv-B",
				conversationId: "conversation-B",
				evaluateCommandToolApproval: sharedEval,
			})
			const a = coord1.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-A",
				iteration: 1,
				toolCallId: "tool-A-1",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await expect(a).resolves.toMatchObject({ approved: false })

			const b = coord2.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-B",
				iteration: 1,
				toolCallId: "tool-B-1",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			const bResult = await b
			expect(bResult.approved).toBe(false)
			expect(bResult.reason).toContain("preventing shell pathname expansion")
			expect(task1.messageStateHandler.getClineMessages()).toHaveLength(0)
			expect(task2.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("clearPending() drops the pending reformulation slot", async () => {
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-clear-1",
				conversationId: "conversation-clear",
				evaluateCommandToolApproval: vi.fn().mockReturnValue({
					approved: false,
					decision: REFACTOR_ASK_DECISION,
					executionPlan: REFACTOR_EXECUTION_PLAN,
					hostAuthorization: { mode: "safe-only" },
				}),
			})
			const a = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-clear",
				iteration: 1,
				toolCallId: "tool-clear-1-a",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await expect(a).resolves.toMatchObject({ approved: false })
			coordinator.clearPending("test teardown")
			const b = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-clear",
				iteration: 2,
				toolCallId: "tool-clear-1-b",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			const bResult = await b
			expect(bResult.approved).toBe(false)
			expect(bResult.reason).toContain("preventing shell pathname expansion")
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("NEGATIVE: DENY decision is unchanged by the reformulation branch", async () => {
			const denyEval = vi.fn().mockReturnValue({
				approved: false,
				decision: { kind: "deny", reason: "dangerous command", source: "host_hard_deny" },
				hostAuthorization: { mode: "safe-only" },
			})
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-neg-deny",
				conversationId: "conversation-neg-deny",
				evaluateCommandToolApproval: denyEval,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-neg-deny",
				iteration: 1,
				toolCallId: "tool-neg-deny-1",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await expect(promise).resolves.toEqual({ approved: false, reason: "dangerous command" })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("NEGATIVE: ASK from a non-safe-only source does NOT reformulate", async () => {
			const realpathEval = vi.fn().mockReturnValue({
				approved: false,
				decision: {
					kind: "ask",
					reason: "realpath authority failed",
					source: "host_workspace_realpath_authority",
				},
				executionPlan: REFACTOR_EXECUTION_PLAN,
				hostAuthorization: { mode: "safe-only" },
			})
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-neg-realpath",
				conversationId: "conversation-neg-realpath",
				evaluateCommandToolApproval: realpathEval,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-neg-realpath",
				iteration: 1,
				toolCallId: "tool-neg-realpath-1",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
			await expect(promise).resolves.toMatchObject({ approved: false })
		})

		it("NEGATIVE: ask from safe-only fallthrough for a QUOTED pattern does NOT reformulate", async () => {
			const quotedEval = vi.fn().mockReturnValue({
				approved: false,
				decision: REFACTOR_ASK_DECISION,
				executionPlan: { transformedInput: { command: "find . -name '*.ts'" }, commands: [] },
				hostAuthorization: { mode: "safe-only" },
			})
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-neg-quoted",
				conversationId: "conversation-neg-quoted",
				evaluateCommandToolApproval: quotedEval,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-neg-quoted",
				iteration: 1,
				toolCallId: "tool-neg-quoted-1",
				toolName: "run_commands",
				input: { command: "find . -name '*.ts'" },
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
			await expect(promise).resolves.toMatchObject({ approved: false })
		})

		it("NEGATIVE: host mode != safe-only does NOT reformulate", async () => {
			const manualEval = vi.fn().mockReturnValue({
				approved: false,
				decision: REFACTOR_ASK_DECISION,
				executionPlan: REFACTOR_EXECUTION_PLAN,
				hostAuthorization: { mode: "manual" },
			})
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-neg-mode",
				conversationId: "conversation-neg-mode",
				evaluateCommandToolApproval: manualEval,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-neg-mode",
				iteration: 1,
				toolCallId: "tool-neg-mode-1",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
			await expect(promise).resolves.toMatchObject({ approved: false })
		})

		it("ABLATION: when hostAuthorization is omitted, reformulation is skipped (safe-by-default)", async () => {
			const noAuthEval = vi.fn().mockReturnValue({
				approved: false,
				decision: REFACTOR_ASK_DECISION,
				executionPlan: REFACTOR_EXECUTION_PLAN,
				// hostAuthorization intentionally omitted
			})
			const { task, coordinator } = makeCoordinator({
				sessionId: "session-refactor-abl",
				conversationId: "conversation-abl",
				evaluateCommandToolApproval: noAuthEval,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation-abl",
				iteration: 1,
				toolCallId: "tool-abl-1",
				toolName: "run_commands",
				input: REFACTOR_INPUT,
				policy: {},
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
			await expect(promise).resolves.toMatchObject({ approved: false })
		})
	})

	describe("CORRECTION04 non-command regression: ToolPolicy.autoApprove must not be intercepted by atomic command evaluator", () => {
		it("non-command tool with autoApprove=true => auto-approved without command evaluator", async () => {
			const evaluateSpy = vi.fn()
			const task = createTaskProxy("session-nonc-1", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-nonc-1",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: evaluateSpy,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-nonc-1",
				toolName: "read_files",
				input: { path: "README.md" },
				policy: { autoApprove: true },
			})
			await expect(promise).resolves.toEqual({ approved: true })
			expect(evaluateSpy).not.toHaveBeenCalled()
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("non-command tool with autoApprove=false => approval UI opened", async () => {
			const task = createTaskProxy("session-nonc-2", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-nonc-2",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: () => ({
					approved: false,
					decision: { kind: "deny", reason: "should not reach", source: "test" },
				}),
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-nonc-2",
				toolName: "edit",
				input: { path: "a.ts", old_text: "a", new_text: "b" },
				policy: { autoApprove: false },
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
			await expect(promise).resolves.toEqual({ approved: true })
		})

		// ACT-CLINEMM-UPSTREAM-SETTINGS-AUTHORITY-PARITY01
		// EDIT-AUTOAPPROVE-AUTHORITY-REGRESSION01: non-command tools (read/edit/browser)
		// must honor the host shouldAutoApproveTool callback. Upstream v4.1.10 wires
		// this to isToolAutoApproved; ClineMM must do the same so that the AutoApprove
		// menu truthfully governs runtime authority.
		it("non-command edit with shouldAutoApproveTool=true => auto-approved", async () => {
			const task = createTaskProxy("session-nonc-edit", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-nonc-edit",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				shouldAutoApproveTool: () => true,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-nonc-edit",
				toolName: "editor",
				input: { path: "a.ts", old_text: "a", new_text: "b" },
				policy: { autoApprove: false },
			})
			await expect(promise).resolves.toEqual({ approved: true })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("non-command read with shouldAutoApproveTool=true => auto-approved", async () => {
			const task = createTaskProxy("session-nonc-read", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-nonc-read",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				shouldAutoApproveTool: () => true,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-nonc-read",
				toolName: "read_files",
				input: { path: "README.md" },
				policy: { autoApprove: false },
			})
			await expect(promise).resolves.toEqual({ approved: true })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("non-command web fetch with shouldAutoApproveTool=true => auto-approved", async () => {
			const task = createTaskProxy("session-nonc-web", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-nonc-web",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				shouldAutoApproveTool: () => true,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-nonc-web",
				toolName: "fetch_web_content",
				input: { url: "https://example.com" },
				policy: { autoApprove: false },
			})
			await expect(promise).resolves.toEqual({ approved: true })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("non-command edit with shouldAutoApproveTool=false => approval UI opened", async () => {
			const task = createTaskProxy("session-nonc-edit-no", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "session-nonc-edit-no",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				shouldAutoApproveTool: () => false,
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-nonc-edit-no",
				toolName: "editor",
				input: { path: "a.ts", old_text: "a", new_text: "b" },
				policy: { autoApprove: false },
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
			await expect(promise).resolves.toEqual({ approved: true })
		})
	})
	// ----------------------------------------------------------------
	// ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL02-CORRECTION01
	// Card-publication seam probes: a request that is auto-approved /
	// bypassed MUST NOT enter the manual-ask publishing branch, so the
	// `approval.ui.branch.v2` and `approval.ui.published.v2` code points
	// MUST NOT fire for it.
	//
	// This test pins the diagnostic, not a behavior change. It only
	// asserts the absence of those two code points when the host
	// decision is "allow / host_mode_all" (the live YOLO / ⚡ ALL —
	// this task path). If this test ever fails, that is the load-bearing
	// evidence that the card-publishing branch is being reached for an
	// auto-approved request — exactly the live-recon defect class.
	// ----------------------------------------------------------------
	describe("ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL02: card-publication seam probes", () => {
		it("auto-approved / host_mode_all request does NOT fire approval.ui.branch.v2 or approval.ui.published.v2", async () => {
			const { mkdtempSync, readFileSync, rmSync } = await import("node:fs")
			const { tmpdir } = await import("node:os")
			const { join } = await import("node:path")
			const { __resetV2CaptureForTests, isV2CaptureEnabled } = await import("./v2-capture")

			const originalEnv = process.env.CLINEMM_CAPTURE_V2_PATH
			const tmpDir = mkdtempSync(join(tmpdir(), "card-seam-"))
			const capturePath = join(tmpDir, "capture.jsonl")
			process.env.CLINEMM_CAPTURE_V2_PATH = capturePath
			__resetV2CaptureForTests()

			try {
				expect(isV2CaptureEnabled()).toBe(true)

				const task = createTaskProxy("session-host-mode-all", vi.fn(), vi.fn())
				const coordinator = new SdkInteractionCoordinator({
					messages: new SdkMessageCoordinator({ getTask: () => task }),
					getSessionId: () => "session-host-mode-all",
					postStateToWebview: vi.fn().mockResolvedValue(undefined),
					recordApprovedToolMessage: vi.fn(),
					// SDK policy short-circuit — the live YOLO / ⚡ ALL — this task path.
					// No onToolApprovalAsk, no messages.appendAndEmit, no
					// setTurnPhase awaiting_approval. The request returns BEFORE the
					// seam probes.
					shouldAutoApproveTool: () => true,
				})

				await expect(
					coordinator.handleRequestToolApproval({
						agentId: "agent",
						conversationId: "conversation",
						iteration: 1,
						toolCallId: "tool-host-mode-all",
						toolName: "run_commands",
						input: { command: "printf 'approval-live-probe\\n'" },
						policy: { autoApprove: true },
					}),
				).resolves.toEqual({ approved: true })

				// Auto-approved request MUST NOT have published a card row.
				expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)

				// Even if capture was somehow partially written (it must not be,
				// but we read defensively to keep this assertion honest), the two
				// card-seam code points must NOT appear in the JSONL output.
				let contents = ""
				try {
					contents = readFileSync(capturePath, "utf8")
				} catch {
					contents = ""
				}
				const records = contents
					.split("\n")
					.filter((l) => l.length > 0)
					.map((l) => JSON.parse(l))
				const branchHits = records.filter((r) => r.codePoint === "approval.ui.branch.v2")
				const publishedHits = records.filter((r) => r.codePoint === "approval.ui.published.v2")
				expect(branchHits).toEqual([])
				expect(publishedHits).toEqual([])
			} finally {
				if (originalEnv === undefined) {
					delete process.env.CLINEMM_CAPTURE_V2_PATH
				} else {
					process.env.CLINEMM_CAPTURE_V2_PATH = originalEnv
				}
				__resetV2CaptureForTests()
				try {
					rmSync(tmpDir, { recursive: true, force: true })
				} catch {
					// best-effort cleanup
				}
			}
		})
	})
})

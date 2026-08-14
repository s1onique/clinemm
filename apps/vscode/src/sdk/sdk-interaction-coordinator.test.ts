import type { AgentEvent } from "@cline/shared"
import { describe, expect, it, vi } from "vitest"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import { buildMistakeLimitAdvisoryText, SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
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
		expect(setTurnPhase).toHaveBeenLastCalledWith("awaiting_approval", task.messageStateHandler.getClineMessages()[0].ts)

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
		expect(setTurnPhase).toHaveBeenCalledWith("awaiting_followup", ask.ts)
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
		expect(setTurnPhase).toHaveBeenLastCalledWith("streaming")
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
		expect(setTurnPhase).toHaveBeenLastCalledWith("streaming")
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
		for (let i = 0; i < 3; i++) {
			const decisionPromise = coordinator.handleConsecutiveMistakeLimitReached({
				iteration: i + 1,
				consecutiveMistakes: 3,
				maxConsecutiveMistakes: 3,
				reason: "tool_execution_failed",
				details: `vendor-a/model-x attempt ${i + 1}`,
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThan(i * 2))
			// Simulate the user dismissing — the loop must not be terminated.
			expect(coordinator.resolvePendingMistakeLimit(undefined, "noButtonClicked")).toBe(true)
			await expect(decisionPromise).resolves.toEqual({
				action: "continue",
				guidance: undefined,
				kind: "advisory",
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
})

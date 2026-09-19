/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01 — bounded
 * presentation contract for the command card + the task-header
 * ownership label while a background CommandJob is alive.
 *
 * Per ACT §6/§7/§8/§17 (BGCL-01..BGCL-14).
 */
import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"

import { ChatRowContent } from "../ChatRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		clineMessages: [],
		vscodeTerminalExecutionMode: "backgroundExec",
		showFeatureTips: false,
		enableCheckpointsSetting: false,
		turnState: { phase: "idle", seq: 0 } as TurnState,
		thinkingPresentation: undefined,
		backgroundEditEnabled: false,
		backgroundCommandRunning: false,
	}),
	__esModule: true,
}))

vi.mock("@/components/chat/CommandOutputRow", () => ({
	CommandOutputRow: (
		props: React.PropsWithChildren<{
			message: ClineMessage
			isCommandExecuting?: boolean
			isCommandPending?: boolean
			isCommandCompleted?: boolean
			isCommandRejected?: boolean
			isCommandBackgrounded?: boolean
			isBackgroundExec?: boolean
			onCancelCommand?: (jobId?: string) => void
			icon?: React.ReactNode
			title?: React.ReactNode
		}>,
	) => {
		const showCancel =
			(props.isCommandExecuting || props.isCommandPending || props.isCommandBackgrounded) &&
			typeof props.onCancelCommand === "function" &&
			props.isBackgroundExec
		const pill = (() => {
			if (props.isCommandRejected) return "Rejected"
			if (props.isCommandBackgrounded) return "Backgrounded"
			if (props.isCommandExecuting) return "Running"
			if (props.isCommandPending) return "Pending"
			if (props.isCommandCompleted) return "Completed"
			return "Skipped"
		})()
		const jobId = (() => {
			try {
				const m = (props.message.text ?? "").match(/"jobId"\s*:\s*"([^"]+)"/)
				return m?.[1]
			} catch {
				return undefined
			}
		})()
		return (
			<div data-testid="command-output-row-stub">
				{props.icon}
				{props.title}
				<span data-testid="status-pill">{pill}</span>
				{showCancel ? (
					<button
						data-testid="cancel-button"
						onClick={() => {
							if (props.isCommandBackgrounded) {
								props.onCancelCommand?.(jobId)
							} else {
								props.onCancelCommand?.()
							}
						}}
						type="button">
						cancel
					</button>
				) : null}
			</div>
		)
	},
	CommandOutputContent: () => null,
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { openFile: vi.fn(), openIntegratedTerminal: vi.fn() },
	UiServiceClient: { scrollToSettings: vi.fn() },
}))

vi.mock("@/components/chat/chat-view/utils/messageUtils", () => ({
	canRestoreWorkspaceFromMessage: () => false,
}))

function runningCommandRow(jobId: string, overrides: Partial<ClineMessage> = {}): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "command",
		text: `sleep 600\n<<<COMMAND OUTPUT>>>\n{"status":"running","jobId":"${jobId}","elapsedMs":1234,"deadlineRemainingMs":9999,"outputTruncated":false,"stdout":""}`,
		commandCompleted: false,
		commandExecutionDisposition: "backgrounded",
		...overrides,
	}
}

function terminalSuccessRow(): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "command",
		text: "echo done\n<<<COMMAND OUTPUT>>>\n",
		commandCompleted: true,
		commandExecutionDisposition: "executed",
	}
}

function terminalFailureRow(): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "command",
		text: "false\n<<<COMMAND OUTPUT>>>\nError: exit 1",
		commandCompleted: true,
		commandExecutionDisposition: "executed",
	}
}

function rejectedRow(): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "command",
		text: 'foo\n<<<COMMAND OUTPUT>>>\nError: {"error":"✖ Invalid input"}',
		commandCompleted: true,
		commandExecutionDisposition: "rejected_before_execution",
	}
}

function makeProps(message: ClineMessage, onCancelCommand?: (jobId?: string) => void) {
	return {
		message,
		isExpanded: true,
		onToggleExpand: vi.fn(),
		lastModifiedMessage: message,
		isLast: true,
		onSetQuote: vi.fn(),
		onCancelCommand,
		inputValue: "",
		sendMessageFromChatRow: undefined,
		onLastRowContentChange: undefined,
	}
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01 — command card lifecycle", () => {
	it("BGCL-01 running job projects 'Backgrounded' (NOT 'Completed')", () => {
		render(<ChatRowContent {...makeProps(runningCommandRow("cmd_mu8no3phxj5uf53n"))} />)
		expect(screen.getByTestId("status-pill").textContent).toBe("Backgrounded")
		expect(screen.queryByText("Completed")).toBeNull()
	})

	it("BGCL-02 terminal success stays 'Completed'", () => {
		render(<ChatRowContent {...makeProps(terminalSuccessRow())} />)
		expect(screen.getByTestId("status-pill").textContent).toBe("Completed")
	})

	it("BGCL-03 terminal failure stays 'Completed' (failure mode is in the output text)", () => {
		render(<ChatRowContent {...makeProps(terminalFailureRow())} />)
		expect(screen.getByTestId("status-pill").textContent).toBe("Completed")
	})

	it("BGCL-05 backgrounded job shows Cancel", () => {
		const onCancelCommand = vi.fn()
		render(<ChatRowContent {...makeProps(runningCommandRow("cmd_mu8no3phxj5uf53n"), onCancelCommand)} />)
		expect(screen.getByTestId("cancel-button")).toBeInTheDocument()
	})

	it("BGCL-06 Cancel dispatch carries exact jobId", () => {
		const onCancelCommand = vi.fn()
		render(<ChatRowContent {...makeProps(runningCommandRow("cmd_mu8no3phxj5uf53n"), onCancelCommand)} />)
		fireEvent.click(screen.getByTestId("cancel-button"))
		expect(onCancelCommand).toHaveBeenCalledTimes(1)
		expect(onCancelCommand).toHaveBeenCalledWith("cmd_mu8no3phxj5uf53n")
	})

	it("BGCL-07 terminal job hides Cancel", () => {
		const onCancelCommand = vi.fn()
		render(<ChatRowContent {...makeProps(terminalSuccessRow(), onCancelCommand)} />)
		expect(screen.queryByTestId("cancel-button")).toBeNull()
	})

	it("BGCL-08 rejected-before-execution stays 'Rejected' (no regression to RCP01)", () => {
		render(<ChatRowContent {...makeProps(rejectedRow())} />)
		expect(screen.getByTestId("status-pill").textContent).toBe("Rejected")
		expect(screen.queryByText("Completed")).toBeNull()
	})
})

describe("ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01 — task header ownership", () => {
	it("BGCL-10 header helper: awaiting_followup + backgroundRunning → 'Working'", async () => {
		const { taskHeaderStateLabelWithBackground } = await import("../task-header/taskHeaderTelemetryHelpers")
		const ts: TurnState = { phase: "awaiting_followup", seq: 5 }
		expect(taskHeaderStateLabelWithBackground(ts, true).label).toBe("Working")
	})

	it("BGCL-11 header helper: awaiting_followup + no background → 'Your turn'", async () => {
		const { taskHeaderStateLabelWithBackground } = await import("../task-header/taskHeaderTelemetryHelpers")
		const ts: TurnState = { phase: "awaiting_followup", seq: 5 }
		expect(taskHeaderStateLabelWithBackground(ts, false).label).toBe("Your turn")
	})

	it("BGCL-12 header helper: awaiting_approval → 'Approval' (regression guard)", async () => {
		const { taskHeaderStateLabelWithBackground } = await import("../task-header/taskHeaderTelemetryHelpers")
		const ts: TurnState = { phase: "awaiting_approval", seq: 5 }
		expect(taskHeaderStateLabelWithBackground(ts, false).label).toBe("Approval")
		expect(taskHeaderStateLabelWithBackground(ts, true).label).toBe("Approval")
	})

	it("BGCL-13 ⎇ semantics unchanged — a running row does not affect the projection contract", () => {
		const onCancelCommand = vi.fn()
		const { container } = render(
			<ChatRowContent {...makeProps(runningCommandRow("cmd_mu8no3phxj5uf53n"), onCancelCommand)} />,
		)
		expect(container.querySelector('[data-testid="active-command-jobs-glyph"]')).toBeNull()
	})
})

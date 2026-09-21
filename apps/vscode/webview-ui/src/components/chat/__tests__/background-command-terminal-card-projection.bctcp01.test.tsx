/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01 — BCTCP01
 *
 * RED witness: the chat card continues to render "Backgrounded" +
 * a Cancel affordance after the underlying CommandJob has reached
 * a terminal state, because the production render path reads ONLY
 * the immutable historical `commandExecutionDisposition` flag
 * (apps/vscode/webview-ui/src/components/chat/ChatRow.tsx:236) and
 * has no live per-job liveness projection to consult.
 *
 * Pre-repair contract (frozen here):
 *
 *   BCTCP-RED-01   historical backgrounded + live terminal projection
 *                  → row STILL shows "Backgrounded" + Cancel
 *                  (the live projection is ignored)
 *
 * Post-repair contract (the GREEN this ACT ships):
 *
 *   BCTCP-01..10   per-job projection overrides historical flag
 *                  when live state says terminal; historical tool
 *                  result text remains immutable.
 *
 * Mock discipline (§11): REAL ChatRowContent + REAL CommandOutputRow.
 * Only `useExtensionState` is mocked so the live per-job projection
 * can be driven externally without pulling the entire ExtensionState
 * wiring into the test.
 */
import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ChatRowContent } from "../ChatRow"

// One module-level mutable so individual `it()` cases can drive the
// live per-job projection without re-importing the module.
let liveJobStates: Record<string, "running" | "terminal"> = {}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		clineMessages: [],
		vscodeTerminalExecutionMode: "backgroundExec",
		showFeatureTips: false,
		enableCheckpointsSetting: false,
		turnState: { phase: "idle", seq: 0 } as { phase: string; seq: number },
		thinkingPresentation: undefined,
		backgroundEditEnabled: false,
		backgroundCommandRunning: Object.values(liveJobStates).some((s) => s === "running"),
		// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01:
		// the per-job liveness projection under test.
		backgroundCommandJobStates: { ...liveJobStates },
	}),
	__esModule: true,
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { openFile: vi.fn(), openIntegratedTerminal: vi.fn() },
	UiServiceClient: { scrollToSettings: vi.fn() },
}))

vi.mock("@/components/chat/chat-view/utils/messageUtils", () => ({
	canRestoreWorkspaceFromMessage: () => false,
}))

function runningCommandRow(jobId: string): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "command",
		// The historical envelope the message-translator stamps at
		// content_end. Note: status: "running" is the producer-side
		// contract for the backgrounded run — the webview can never
		// observe a terminal envelope on this row (no row-mutation
		// seam exists in production today; see BGCL-09).
		text: `sleep 600\nOutput:\n{"status":"running","jobId":"${jobId}","elapsedMs":1234,"deadlineRemainingMs":9999,"outputTruncated":false,"stdout":""}`,
		commandCompleted: false,
		commandExecutionDisposition: "backgrounded",
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

describe("ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01 — RED/GREEN", () => {
	// ─────────────────────────────────────────────────────────────────
	// RED witness — the bug today. Will FAIL after the repair.
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-RED-01 RED: historical backgrounded + live terminal projection → row must no longer be Backgrounded", () => {
		const jobId = "cmd_redo1terminalcard"
		const message = runningCommandRow(jobId)
		liveJobStates = { [jobId]: "terminal" }
		render(<ChatRowContent {...makeProps(message, vi.fn())} />)
		// Post-repair expectation (this is what fails RED today):
		expect(screen.queryByText("Backgrounded")).toBeNull()
		expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
		// The historical tool result remains immutable (CPJ-CTL-01).
		expect(message.commandExecutionDisposition).toBe("backgrounded")
		expect(message.commandCompleted).toBe(false)
	})

	// ─────────────────────────────────────────────────────────────────
	// Conservation — running job must still show Backgrounded + Cancel.
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-01 running projection → Backgrounded + Cancel (conservation)", () => {
		const jobId = "cmd_runningconserved"
		const message = runningCommandRow(jobId)
		liveJobStates = { [jobId]: "running" }
		render(<ChatRowContent {...makeProps(message, vi.fn())} />)
		expect(screen.getByText("Backgrounded")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
	})

	// ─────────────────────────────────────────────────────────────────
	// Natural terminal — historical "running" + live "terminal".
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-02 natural exit projection → terminal (no Backgrounded, no Cancel)", () => {
		const jobId = "cmd_naturalexit"
		const message = runningCommandRow(jobId)
		liveJobStates = { [jobId]: "terminal" }
		render(<ChatRowContent {...makeProps(message, vi.fn())} />)
		expect(screen.queryByText("Backgrounded")).toBeNull()
		expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
	})

	// ─────────────────────────────────────────────────────────────────
	// Cancel projection → same terminal presentation.
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-03 cancelled projection → terminal (no Backgrounded, no Cancel)", () => {
		const jobId = "cmd_cancelled"
		const message = runningCommandRow(jobId)
		liveJobStates = { [jobId]: "terminal" }
		render(<ChatRowContent {...makeProps(message, vi.fn())} />)
		expect(screen.queryByText("Backgrounded")).toBeNull()
		expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
	})

	// ─────────────────────────────────────────────────────────────────
	// Deadline terminal projection — the 600s LIVE specimen case.
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-04 deadline_exceeded projection → terminal (no Backgrounded, no Cancel)", () => {
		const jobId = "cmd_deadline"
		const message = runningCommandRow(jobId)
		liveJobStates = { [jobId]: "terminal" }
		render(<ChatRowContent {...makeProps(message, vi.fn())} />)
		expect(screen.queryByText("Backgrounded")).toBeNull()
		expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
	})

	// ─────────────────────────────────────────────────────────────────
	// Different-job control (CPJ-CTL-03) — only THIS job terminalized;
	// the historical row is unaffected when its own projection is
	// absent (e.g. reload before projection was emitted).
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-05 absent projection (different job terminalized) → row stays Backgrounded", () => {
		const jobId = "cmd_unaffectedrow"
		const message = runningCommandRow(jobId)
		// Some OTHER job terminated; THIS row's projection was never
		// published (or was already forgotten).
		liveJobStates = { cmd_otherjob: "terminal" }
		render(<ChatRowContent {...makeProps(message, vi.fn())} />)
		expect(screen.getByText("Backgrounded")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
	})

	// ─────────────────────────────────────────────────────────────────
	// Multi-job independence (CPJ-CTL-03 / §15) — one row's
	// terminality does not cascade to a sibling row.
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-06 multi-job: row A terminal + row B running → independent presentation", () => {
		const jobA = "cmd_rowA"
		const jobB = "cmd_rowB"
		const messageA = runningCommandRow(jobA)
		const messageB = runningCommandRow(jobB)
		liveJobStates = { [jobA]: "terminal", [jobB]: "running" }
		const { rerender } = render(<ChatRowContent {...makeProps(messageA, vi.fn())} />)
		expect(screen.queryByText("Backgrounded")).toBeNull()
		expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
		rerender(<ChatRowContent {...makeProps(messageB, vi.fn())} />)
		expect(screen.getByText("Backgrounded")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
	})

	// ─────────────────────────────────────────────────────────────────
	// Historical immutability (CPJ-CTL-01).
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-07 historical tool result stays immutable across live terminal projection", () => {
		const jobId = "cmd_immutablehistory"
		const message = runningCommandRow(jobId)
		const textSnapshot = message.text
		const commandCompletedSnapshot = message.commandCompleted
		const dispositionSnapshot = message.commandExecutionDisposition
		liveJobStates = { [jobId]: "terminal" }
		render(<ChatRowContent {...makeProps(message, vi.fn())} />)
		expect(message.text).toBe(textSnapshot)
		expect(message.commandCompleted).toBe(commandCompletedSnapshot)
		expect(message.commandExecutionDisposition).toBe(dispositionSnapshot)
	})

	// ─────────────────────────────────────────────────────────────────
	// Duplicate terminal projection is idempotent (§34).
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-08 duplicate terminal projection → idempotent terminal", () => {
		const jobId = "cmd_dupterminal"
		const message = runningCommandRow(jobId)
		liveJobStates = { [jobId]: "terminal" }
		const { rerender } = render(<ChatRowContent {...makeProps(message, vi.fn())} />)
		expect(screen.queryByText("Backgrounded")).toBeNull()
		// re-publish (e.g. background refetch); same effect
		rerender(<ChatRowContent {...makeProps(message, vi.fn())} />)
		expect(screen.queryByText("Backgrounded")).toBeNull()
		expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
	})

	// ─────────────────────────────────────────────────────────────────
	// Cancel dispatch still carries the exact jobId (CPJ-CTL-09).
	// ─────────────────────────────────────────────────────────────────
	it("BCTCP-09 Cancel dispatch carries exact jobId while running", () => {
		const jobId = "cmd_canceldispatch"
		const message = runningCommandRow(jobId)
		liveJobStates = { [jobId]: "running" }
		const onCancelCommand = vi.fn()
		render(<ChatRowContent {...makeProps(message, onCancelCommand)} />)
		fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
		expect(onCancelCommand).toHaveBeenCalledTimes(1)
		expect(onCancelCommand).toHaveBeenCalledWith(jobId)
	})
})

import type { ClineMessage } from "@shared/ExtensionMessage"
import { act, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CommandOutputContent, CommandOutputRow } from "./CommandOutputRow"

vi.mock("../common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <pre>{source}</pre>,
}))

describe("CommandOutputContent", () => {
	it("notifies when visible output changes", async () => {
		const onOutputChange = vi.fn()
		const { rerender } = render(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output="first line"
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(1))

		rerender(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"first line\nsecond line"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(2))
	})

	it("notifies when visible output expansion changes", async () => {
		const onOutputChange = vi.fn()
		const { rerender } = render(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"1\n2\n3\n4\n5\n6"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(1))

		rerender(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={true}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"1\n2\n3\n4\n5\n6"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(2))
	})

	it("does not notify while the container is collapsed", async () => {
		const onOutputChange = vi.fn()
		render(
			<CommandOutputContent
				isContainerExpanded={false}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output="hidden"
			/>,
		)

		await act(async () => {})
		expect(onOutputChange).not.toHaveBeenCalled()
	})

	// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01 — RCP07
	// status-pill truth at the CommandOutputRow seam.
	it("rejected-before-execution pill says 'Rejected' (NOT 'Completed')", () => {
		const message: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "command",
			text: 'git status\n<<<COMMAND OUTPUT>>>\nError: {"error":"✖ Invalid input"}',
			commandCompleted: true,
			commandExecutionDisposition: "rejected_before_execution",
		}
		render(
			<CommandOutputRow
				icon={null}
				isCommandRejected={true}
				isOutputFullyExpanded={false}
				message={message}
				setIsOutputFullyExpanded={vi.fn()}
				title={null}
			/>,
		)
		expect(screen.getByText("Rejected")).toBeInTheDocument()
		expect(screen.queryByText("Completed")).toBeNull()
	})

	it("executed (success) pill still says 'Completed'", () => {
		const message: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "command",
			text: "git status\n<<<COMMAND OUTPUT>>>\nOn branch main",
			commandCompleted: true,
			commandExecutionDisposition: "executed",
		}
		render(
			<CommandOutputRow
				icon={null}
				isCommandCompleted={true}
				isOutputFullyExpanded={false}
				message={message}
				setIsOutputFullyExpanded={vi.fn()}
				title={null}
			/>,
		)
		expect(screen.getByText("Completed")).toBeInTheDocument()
	})
})

import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CompletionOutputRow } from "./CompletionOutputRow"
import PlanCompletionOutputRow from "./PlanCompletionOutputRow"
import { resolveTerminalReportFraming, type TerminalReportFraming } from "./terminalReportFraming"

vi.mock("./MarkdownRow", () => ({
	MarkdownRow: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}))

vi.mock("@/components/common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}))

const checkpointLatestChangesCount = vi.fn()

vi.mock("@/services/grpc-client", () => ({
	CheckpointsServiceClient: {
		checkpointLatestChangesCount: (...args: unknown[]) => checkpointLatestChangesCount(...args),
		checkpointViewLatestChanges: vi.fn(() => Promise.resolve({})),
	},
}))

// Render VSCodeButton (used by SuccessButton) as a native button so it is
// observable through testing-library roles.
vi.mock("@vscode/webview-ui-toolkit/react", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		VSCodeButton: ({
			children,
			disabled,
			onClick,
		}: {
			children?: React.ReactNode
			disabled?: boolean
			onClick?: () => void
		}) => (
			<button disabled={disabled} onClick={onClick} type="button">
				{children}
			</button>
		),
	}
})

const hiddenQuoteButton = { visible: false, top: 0, left: 0, selectedText: "" }

const COMPLETED_FRAMING: TerminalReportFraming = {
	kind: "completed",
	label: "Completed",
	ariaLabel: "Task completed",
	title: "Task completed successfully",
}

describe("CompletionOutputRow", () => {
	const writeText = vi.fn(() => Promise.resolve())

	beforeEach(() => {
		writeText.mockClear()
		Object.assign(navigator, { clipboard: { writeText } })
	})

	it("shows a small Completed header with a copy button", () => {
		render(
			<CompletionOutputRow
				framing={COMPLETED_FRAMING}
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="All done!"
			/>,
		)

		// ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01: the visible label
		// is now a `✓ Completed` badge (the `✓ ` is a text-node prefix inside
		// the span). Assert via the testid so we don't depend on whitespace
		// normalization.
		const badge = screen.getByTestId("terminal-completion-framing")
		expect(badge).toHaveTextContent("✓ Completed")
		expect(screen.getByRole("button", { name: "Copy response" })).toBeInTheDocument()
	})

	it("copies the response text to the clipboard", async () => {
		render(
			<CompletionOutputRow
				framing={COMPLETED_FRAMING}
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="All done!"
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Copy response" }))

		await waitFor(() => expect(writeText).toHaveBeenCalledWith("All done!"))
	})
})

describe("CompletionOutputRow View Changes", () => {
	beforeEach(() => {
		checkpointLatestChangesCount.mockReset()
	})

	const renderWithViewChanges = () =>
		render(
			<CompletionOutputRow
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				showViewChanges
				text="All done!"
			/>,
		)

	it("shows the button once the host confirms the latest run changed files", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ value: 2 })

		renderWithViewChanges()

		const button = await screen.findByRole("button", { name: /View Changes/ })
		expect(button).not.toBeDisabled()
	})

	it("stays hidden while the count is still being checked", () => {
		checkpointLatestChangesCount.mockReturnValue(new Promise(() => {}))

		renderWithViewChanges()

		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})

	it("stays hidden when nothing changed since the last message", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ value: 0 })

		renderWithViewChanges()

		await waitFor(() => expect(checkpointLatestChangesCount).toHaveBeenCalled())
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})

	it("stays hidden when the count request fails (e.g. no checkpoint to compare against)", async () => {
		checkpointLatestChangesCount.mockRejectedValue(new Error("boom"))

		renderWithViewChanges()

		await waitFor(() => expect(checkpointLatestChangesCount).toHaveBeenCalled())
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})

	it("never renders the button when showViewChanges is not set", () => {
		checkpointLatestChangesCount.mockResolvedValue({ value: 2 })

		render(<CompletionOutputRow handleQuoteClick={vi.fn()} quoteButtonState={hiddenQuoteButton} text="All done!" />)

		expect(checkpointLatestChangesCount).not.toHaveBeenCalled()
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})

	it("re-checks instead of reusing a stale positive answer when showViewChanges toggles", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ value: 2 })

		const { rerender } = renderWithViewChanges()
		await screen.findByRole("button", { name: /View Changes/ })

		rerender(<CompletionOutputRow handleQuoteClick={vi.fn()} quoteButtonState={hiddenQuoteButton} text="All done!" />)
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()

		// Second evaluation never resolves: the earlier `true` must not leak
		// through and flash the button while the host is still checking.
		checkpointLatestChangesCount.mockReturnValue(new Promise(() => {}))
		rerender(
			<CompletionOutputRow
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				showViewChanges
				text="All done!"
			/>,
		)
		expect(checkpointLatestChangesCount).toHaveBeenCalledTimes(2)
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})
})

describe("PlanCompletionOutputRow", () => {
	const writeText = vi.fn(() => Promise.resolve())

	beforeEach(() => {
		writeText.mockClear()
		Object.assign(navigator, { clipboard: { writeText } })
	})

	it("shows a small Plan header with a copy button", () => {
		render(<PlanCompletionOutputRow text="Here is the plan" />)

		expect(screen.getByText("Plan")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Copy plan response" })).toBeInTheDocument()
	})

	it("copies the plan response text to the clipboard", async () => {
		render(<PlanCompletionOutputRow text="Here is the plan" />)

		fireEvent.click(screen.getByRole("button", { name: "Copy plan response" }))

		await waitFor(() => expect(writeText).toHaveBeenCalledWith("Here is the plan"))
	})
})

// ===========================================================================
// ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01
//
// Presentation-layer matrix. The pure-helper matrix lives in
// `terminalReportFraming.test.ts`; this block asserts that the
// `CompletionOutputRow` component honors the framing prop the way the
// ACT §2 / §8 / §9 contract demands (badge visibility, accessibility,
// M-killer text-derived framing is rejected).
// ===========================================================================

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 — CompletionOutputRow framing", () => {
	it("renders the ✓ Completed badge with aria-label and title when framing.kind === 'completed'", () => {
		render(
			<CompletionOutputRow
				framing={COMPLETED_FRAMING}
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="All done!"
			/>,
		)

		const badge = screen.getByTestId("terminal-completion-framing")
		expect(badge).toHaveTextContent("✓ Completed")
		expect(badge).toHaveAttribute("aria-label", "Task completed")
		expect(badge).toHaveAttribute("title", "Task completed successfully")
		expect(badge).toHaveAttribute("role", "status")
	})

	it("omits the Completed badge when framing is undefined (defensive default — old callers without framing prop)", () => {
		render(<CompletionOutputRow handleQuoteClick={vi.fn()} quoteButtonState={hiddenQuoteButton} text="All done!" />)

		expect(screen.queryByTestId("terminal-completion-framing")).toBeNull()
		expect(screen.queryByText("Completed")).toBeNull()
		// Card body still renders — visual result boundary is preserved.
		expect(screen.getByText("All done!")).toBeInTheDocument()
	})

	it("M-killer: text says 'Completed everything successfully' but framing is undefined → MUST NOT render badge", () => {
		// The ACT explicitly forbids text-derived completion inference. The
		// component trusts the `framing` prop, never the message text. If a
		// caller forgets to compute the framing (or runtime truth is not
		// completed), the badge is absent — even if the text happens to
		// contain the literal word "Completed".
		render(
			<CompletionOutputRow
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="Completed everything successfully."
			/>,
		)

		// The framing badge must not be rendered. (The body text is allowed
		// to contain the literal word "Completed" — that is the model's
		// prose, NOT a presentation truth claim.)
		expect(screen.queryByTestId("terminal-completion-framing")).toBeNull()
	})

	it("renders the card body even when framing is undefined (visual boundary preserved)", () => {
		render(
			<CompletionOutputRow
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="Some assistant prose that is NOT a terminal completion."
			/>,
		)

		// Body text still renders so the result row stays a clear visual
		// boundary — only the "Completed" badge is the conditional piece.
		expect(screen.getByText("Some assistant prose that is NOT a terminal completion.")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Copy response" })).toBeInTheDocument()
		expect(screen.queryByTestId("terminal-completion-framing")).toBeNull()
	})

	it("flips the badge off when framing goes from completed → undefined (resume continues, intermediate response arrives)", () => {
		const { rerender } = render(
			<CompletionOutputRow
				framing={COMPLETED_FRAMING}
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="First turn complete."
			/>,
		)
		expect(screen.getByTestId("terminal-completion-framing")).toBeInTheDocument()

		// Resume → new intermediate response. Phase is now streaming, framing
		// is undefined. The historical Completed badge should NOT linger on
		// the now-current message; the historical row keeps its own badge
		// because that row's framing is still completed.
		rerender(
			<CompletionOutputRow
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="Working on the follow-up…"
			/>,
		)
		expect(screen.queryByTestId("terminal-completion-framing")).toBeNull()
		// Sanity: the message text updated.
		expect(screen.getByText("Working on the follow-up…")).toBeInTheDocument()
	})

	it("flips the badge back on when framing returns to completed (second terminal completion after resume)", () => {
		const { rerender } = render(
			<CompletionOutputRow
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="Working on the follow-up…"
			/>,
		)
		expect(screen.queryByTestId("terminal-completion-framing")).toBeNull()

		rerender(
			<CompletionOutputRow
				framing={COMPLETED_FRAMING}
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				text="Now also done."
			/>,
		)
		expect(screen.getByTestId("terminal-completion-framing")).toBeInTheDocument()
	})
})

// -----------------------------------------------------------------------
// ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01:
// the reviewer's two-row and three-row discriminators, exercised at the
// presentation layer. Multiple rows render simultaneously, each through
// the helper, sharing the SAME current turnState — this proves the badge
// survives the phase flip for historical completed rows without leaking
// to the active turn's intermediate rows.
// -----------------------------------------------------------------------

function sayCompletionResult(text: string, marker = false): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "completion_result",
		text,
		partial: false,
		isAuthoritativelyCompletedResult: marker || undefined,
	}
}

function textSay(text: string): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "text",
		text,
	}
}

function MultiRowHarness({ rows, turnState, mode }: { rows: ClineMessage[]; turnState: TurnState; mode: Mode }) {
	return (
		<div data-testid="harness">
			{rows.map((m) => {
				const framing = resolveTerminalReportFraming({ message: m, turnState, mode })
				return (
					<div data-testid={`row-${m.ts}`} key={`row-${m.ts}`}>
						<CompletionOutputRow
							framing={framing}
							handleQuoteClick={vi.fn()}
							quoteButtonState={hiddenQuoteButton}
							text={m.text || ""}
						/>
					</div>
				)
			})}
		</div>
	)
}

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01 — two-row invariant (reviewer's discriminator)", () => {
	it("historical completed result + intermediate streaming follow-up: row A keeps badge, row B doesn't", () => {
		const RESUMED_PHASE: TurnState = { phase: "streaming", seq: 99 }
		const rows: ClineMessage[] = [
			{ ...sayCompletionResult("All done.", true), ts: 1 }, // row A: historical completed
			{ ...textSay("Working on the follow-up…"), ts: 2 }, // row B: intermediate
		]

		render(<MultiRowHarness mode="act" rows={rows} turnState={RESUMED_PHASE} />)

		const rowA = screen.getByTestId("row-1")
		const rowB = screen.getByTestId("row-2")
		expect(rowA.querySelector('[data-testid="terminal-completion-framing"]')).not.toBeNull()
		expect(rowB.querySelector('[data-testid="terminal-completion-framing"]')).toBeNull()
	})

	it("three rows: historical completed + intermediate streaming + second terminal completion → A=badge, B=no, C=badge", () => {
		const RESUMED_PHASE: TurnState = { phase: "streaming", seq: 99 }
		const rows: ClineMessage[] = [
			{ ...sayCompletionResult("All done the first thing.", true), ts: 1 }, // row A: historical completed
			{ ...textSay("Working on the follow-up…"), ts: 2 }, // row B: intermediate
			{ ...sayCompletionResult("All done the second thing.", true), ts: 3 }, // row C: second terminal
		]

		render(<MultiRowHarness mode="act" rows={rows} turnState={RESUMED_PHASE} />)

		const rowA = screen.getByTestId("row-1")
		const rowB = screen.getByTestId("row-2")
		const rowC = screen.getByTestId("row-3")
		expect(rowA.querySelector('[data-testid="terminal-completion-framing"]')).not.toBeNull()
		expect(rowB.querySelector('[data-testid="terminal-completion-framing"]')).toBeNull()
		expect(rowC.querySelector('[data-testid="terminal-completion-framing"]')).not.toBeNull()
	})

	it("M-killer: text says 'Completed' but no marker → no badge (text inference forbidden)", () => {
		const RESUMED_PHASE: TurnState = { phase: "streaming", seq: 99 }
		const rows: ClineMessage[] = [
			{ ...sayCompletionResult("Completed everything successfully.", false), ts: 1 }, // text says Completed, but no marker
		]

		render(<MultiRowHarness mode="act" rows={rows} turnState={RESUMED_PHASE} />)

		const rowA = screen.getByTestId("row-1")
		expect(rowA.querySelector('[data-testid="terminal-completion-framing"]')).toBeNull()
	})
})

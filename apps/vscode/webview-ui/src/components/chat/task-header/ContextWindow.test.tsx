import type { ClineMessage } from "@shared/ExtensionMessage"
import { getLastApiReqContextInputObservation } from "@shared/getApiMetrics"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ButtonHTMLAttributes, PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ContextWindow from "./ContextWindow"
import { ContextWindowSummary } from "./ContextWindowSummary"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
		<button {...props}>{children}</button>
	),
}))

vi.mock("@/components/ui/hover-card", () => ({
	HoverCard: ({ children }: PropsWithChildren) => <div>{children}</div>,
	HoverCardContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
	HoverCardTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))

vi.mock("@/components/ui/progress", () => ({
	Progress: ({ value }: { value?: number }) => (
		<div aria-label="Context window usage progress" role="progressbar">
			{value}
		</div>
	),
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
	TooltipContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
	TooltipTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
}))

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
		<button {...props}>{children}</button>
	),
}))

describe("ContextWindow compact button", () => {
	beforeEach(() => vi.clearAllMocks())

	it("runs the shared compact handler after confirmation instead of sending /compact as a message", () => {
		const compactTask = vi.fn().mockResolvedValue(true)
		const onSendMessage = vi.fn()

		render(
			<ContextWindow
				compactDisabled={false}
				compactTask={compactTask}
				contextWindow={200_000}
				lastApiReqContextInputTokens={120_000}
				onSendMessage={onSendMessage}
				useAutoCondense={false}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /compact task/i }))
		fireEvent.click(screen.getByRole("button", { name: /^compact$/i }))

		expect(compactTask).toHaveBeenCalledTimes(1)
		expect(onSendMessage).not.toHaveBeenCalled()
	})

	it("disables compaction during API error recovery", () => {
		render(
			<ContextWindow
				compactDisabled={true}
				compactTask={vi.fn()}
				contextWindow={200_000}
				lastApiReqTotalTokens={120_000}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByRole("button", { name: /compact task/i })).toBeDisabled()
	})
})

describe("ContextWindow occupancy projection", () => {
	it("uses lastApiReqContextInputTokens — not the billed total — for the percentage and the displayed used value", () => {
		// ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01): the bar
		// reflects the provider-normalized context-input occupancy (the AI SDK
		// `inputTokens.total` contract: `tokensIn + cacheReads + cacheWrites`)
		// vs the model's window. Output tokens describe the previous response
		// and are deliberately excluded; the billed request activity is
		// preserved as a separate dimension for callers that want it.
		render(
			<ContextWindow
				contextWindow={200_000}
				lastApiReqContextInputTokens={20_000}
				lastApiReqTotalTokens={120_000}
				useAutoCondense={false}
			/>,
		)

		// 20_000 / 200_000 = 0.10 = 10%.
		expect(screen.getByRole("progressbar")).toHaveTextContent("10")
	})

	it("does not let lastApiReqTotalTokens inflate the occupancy bar", () => {
		// Without the ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 fix, the bar
		// would show 120_000 / 200_000 = 60%. With it, the bar reflects
		// 20_000 / 200_000 = 10%, and the billed total is preserved as a
		// separate dimension for callers that want it.
		const { rerender } = render(
			<ContextWindow
				contextWindow={200_000}
				lastApiReqContextInputTokens={20_000}
				lastApiReqTotalTokens={120_000}
				useAutoCondense={false}
			/>,
		)
		expect(screen.getByRole("progressbar")).toHaveTextContent("10")

		rerender(
			<ContextWindow
				contextWindow={200_000}
				lastApiReqContextInputTokens={120_000}
				lastApiReqTotalTokens={120_000}
				useAutoCondense={false}
			/>,
		)
		expect(screen.getByRole("progressbar")).toHaveTextContent("60")
	})

	it("renders nothing when contextWindow is 0", () => {
		render(
			<ContextWindow
				contextWindow={0}
				lastApiReqContextInputTokens={20_000}
				lastApiReqTotalTokens={20_000}
				useAutoCondense={false}
			/>,
		)
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
	})

	it("treats lastApiReqContextInputTokens as the provider-normalized total (cacheReads + cacheWrites contribute)", () => {
		// ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01): the numerator
		// is `tokensIn + cacheReads + cacheWrites` (the AI SDK inclusive
		// `inputTokens.total` contract). For an Anthropic-native request with
		// 50 uncached + 100_000 cache-read + 0 cache-write tokens, the actual
		// prompt size that competed for the window is 100_050 — not 50.
		render(
			<ContextWindow
				contextWindow={200_000}
				lastApiReqContextInputTokens={100_050}
				lastApiReqTotalTokens={100_100}
				useAutoCondense={false}
			/>,
		)

		// 100_050 / 200_000 ≈ 0.50025 = 50.025 → displayed as 50 (rounded).
		expect(screen.getByRole("progressbar")).toHaveTextContent("50")
	})
})

describe("Task header provider-usage authority", () => {
	const P = 68_900
	const W = 148_800
	const CONTEXT = 256_000

	it("prefers provider-reported input from the last reported request and keeps the estimate separate", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={W}
				lastApiReqContextInputTokens={P}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByRole("progressbar")).toHaveTextContent(String((P / CONTEXT) * 100))
		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("68.9k")
		expect(screen.getAllByText(/provider-reported input/i).length).toBeGreaterThan(0)
		expect(screen.getByText(/next-request estimate/i).parentElement).toHaveTextContent("148.8k")
		expect(screen.getAllByText(/estimated/i).length).toBeGreaterThan(0)
		expect(screen.queryByTitle(/current tokens used in this request/i)).not.toBeInTheDocument()
	})

	it("uses an explicitly labeled estimate when provider input is unavailable", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={85_500}
				lastApiReqContextInputTokens={undefined}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByRole("progressbar")).toHaveTextContent(String((85_500 / CONTEXT) * 100))
		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("85.5k")
		expect(screen.getAllByText(/estimated/i).length).toBeGreaterThan(0)
		expect(screen.queryByText(/provider-reported input/i)).not.toBeInTheDocument()
	})

	it("renders unavailable rather than fabricating zero when neither authority exists", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={null}
				lastApiReqContextInputTokens={undefined}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByText(/context usage unavailable/i)).toBeInTheDocument()
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
	})

	it("does not replace provider input with the estimate during unrelated telemetry updates", () => {
		const { rerender } = render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={85_500}
				lastApiReqContextInputTokens={P}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("68.9k")
		rerender(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={W}
				lastApiReqContextInputTokens={P}
				useAutoCondense={false}
			/>,
		)
		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("68.9k")
		expect(screen.getByRole("progressbar")).toHaveTextContent(String((P / CONTEXT) * 100))
	})

	it("does not synthesize a smaller provider count after compaction", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={30_000}
				lastApiReqContextInputTokens={100_000}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("100.0k")
		expect(screen.getByText(/next-request estimate/i).parentElement).toHaveTextContent("30.0k")
		expect(screen.getByTestId("context-window-used-tokens")).not.toHaveTextContent("30.0k")
	})

	it("rejects invalid provider input and falls back to a valid estimate", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={85_500}
				lastApiReqContextInputTokens={Number.NaN}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("85.5k")
		expect(screen.getByTestId("context-window-usage-authority")).toHaveTextContent("Est")
		expect(screen.getByTestId("context-window-usage-authority")).not.toHaveTextContent("Prv")
	})
})

describe("ContextWindow compact usage-authority label", () => {
	const P = 68_900
	const W = 148_800
	const CONTEXT = 256_000

	it("renders the compact provider abbreviation with the full description on hover", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={W}
				lastApiReqContextInputTokens={P}
				useAutoCondense={false}
			/>,
		)

		const badge = screen.getByTestId("context-window-usage-authority")
		expect(badge).toHaveTextContent("Prv")
		// The Radix tooltip is the only tooltip mechanism; a native `title`
		// attribute would render a second, browser-native popup on hover.
		expect(badge).not.toHaveAttribute("title")
		expect(badge).toHaveAttribute("aria-label", "Provider-reported input for the last reported request")
		expect(
			screen.getByRole("button", {
				name: "Provider-reported input for the last reported request",
			}),
		).toBeInTheDocument()
	})

	it("renders the compact estimate abbreviation with the full description on hover", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={W}
				lastApiReqContextInputTokens={undefined}
				useAutoCondense={false}
			/>,
		)

		const badge = screen.getByTestId("context-window-usage-authority")
		expect(badge).toHaveTextContent("Est")
		expect(badge).not.toHaveAttribute("title")
		expect(badge).toHaveAttribute("aria-label", "Estimated next-request input")
	})

	it("keeps the compact header free of the full label text and leaves it in the expanded details", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={W}
				lastApiReqContextInputTokens={P}
				useAutoCondense={false}
			/>,
		)

		// The compact badge shows only the abbreviation — the full description
		// is not rendered as visible text next to the token count.
		const badge = screen.getByTestId("context-window-usage-authority")
		expect(badge.textContent?.trim()).toBe("Prv")
		expect(badge.textContent).not.toMatch(/provider-reported input/i)
		expect(badge.textContent).not.toMatch(/estimated/i)

		// The full description is still available in the expanded context
		// details.
		expect(screen.getByText("Provider-reported input:")).toBeInTheDocument()
	})

	it("keeps the used-token accessibility label unchanged", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={W}
				lastApiReqContextInputTokens={P}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByTestId("context-window-used-tokens")).toHaveAttribute(
			"aria-label",
			"Provider-reported input for the last reported request",
		)
		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("68.9k")
	})
})

describe("ContextWindow provider-usage provenance", () => {
	it("preserves an observed zero provider input through the producer-consumer selector", () => {
		const zeroUsage: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 0, tokensOut: 10, cacheReads: 0, cacheWrites: 0 }),
			},
		]
		const providerInputTokens = getLastApiReqContextInputObservation(zeroUsage)?.value
		render(
			<ContextWindow
				contextWindow={256_000}
				currentWorkingContextEstimate={148_800}
				lastApiReqContextInputTokens={providerInputTokens}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("0")
		expect(screen.getByRole("progressbar")).toHaveTextContent("0")
		expect(screen.getByTestId("context-window-usage-authority")).toHaveTextContent("Prv")
		expect(screen.getByTestId("context-window-usage-authority")).not.toHaveTextContent("Est")
	})

	it("uses the latest eligible main-model usage row and ignores subagent aggregates", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 68_900, tokensOut: 1_000, cacheReads: 0, cacheWrites: 0 }),
			},
			{
				ts: 2,
				type: "say",
				say: "subagent_usage",
				text: JSON.stringify({ source: "subagents", tokensIn: 500_000, tokensOut: 1_000 }),
			},
		]
		const providerInputTokens = getLastApiReqContextInputObservation(messages)?.value
		render(
			<ContextWindow
				contextWindow={256_000}
				currentWorkingContextEstimate={148_800}
				lastApiReqContextInputTokens={providerInputTokens}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("68.9k")
		expect(screen.getByRole("progressbar")).toHaveTextContent(String((68_900 / 256_000) * 100))
	})
})

describe("ContextWindowSummary usage-authority details", () => {
	it("expands, collapses, and expands the context details section", () => {
		render(
			<ContextWindowSummary
				contextWindow={256_000}
				percentage={26.9140625}
				providerInputTokens={68_900}
				tokenUsed={68_900}
				usageLabel="Provider-reported input"
				usageTitle="Provider-reported input for the last reported request"
				workingContextEstimate={148_800}
			/>,
		)

		const heading = screen.getByText("Context Window")
		const details = screen.getByText("Last reported input:").parentElement
		expect(details).toBeInTheDocument()

		fireEvent.click(heading)
		expect(screen.queryByText("Last reported input:")).not.toBeInTheDocument()

		fireEvent.click(heading)
		expect(screen.getByText("Last reported input:").parentElement).toBeInTheDocument()
	})

	it("shows provider input and the next-request estimate as separate rows", () => {
		render(
			<ContextWindowSummary
				contextWindow={256_000}
				percentage={26.9140625}
				providerInputTokens={68_900}
				tokenUsed={68_900}
				usageLabel="Provider-reported input"
				usageTitle="Provider-reported input for the last reported request"
				workingContextEstimate={148_800}
			/>,
		)

		expect(screen.getByText("Last reported input:").parentElement).toHaveTextContent("68.9k")
		expect(screen.getByText("Next-request estimate (Estimated):").parentElement).toHaveTextContent("148.8k")
		expect(screen.getByText("Total:").parentElement).toHaveTextContent("256.0k")
	})
})

// ============================================================================
// ACT-CLINEMM-TASK-HEADER-PROVIDER-USAGE-AUTHORITY-01
// Provider-reported input (P) is the primary displayed authority. The
// working-context estimate (W) remains visible only as a separately labeled
// next-request estimate and is the fallback when P is unavailable.
// ============================================================================

describe("ContextWindow provider-authority conservation", () => {
	const P_SENTINEL = 364_900
	const W_SENTINEL = 271_337

	it("keeps provider input as the primary numerator while W is labeled separately", () => {
		render(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={W_SENTINEL}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByRole("progressbar")).toHaveTextContent(String((P_SENTINEL / 200_000) * 100))
		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("364.9k")
		expect(screen.getByText(/next-request estimate/i).parentElement).toHaveTextContent("271.3k")
	})

	it("retains the last provider observation when the runtime clears W", () => {
		render(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={null}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByRole("progressbar")).toHaveTextContent(String((P_SENTINEL / 200_000) * 100))
		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("364.9k")
		expect(screen.queryByText(/next-request estimate/i)).not.toBeInTheDocument()
	})

	it("preserves the legacy P-only path", () => {
		render(<ContextWindow contextWindow={200_000} lastApiReqContextInputTokens={P_SENTINEL} useAutoCondense={false} />)

		expect(screen.getByRole("progressbar")).toHaveTextContent(String((P_SENTINEL / 200_000) * 100))
		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("364.9k")
	})

	it("does not rescale the provider observation when W changes after compaction", () => {
		const W_BEFORE = 380_000
		const W_AFTER = 90_000
		const { rerender } = render(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={W_BEFORE}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByRole("progressbar")).toHaveTextContent(String((P_SENTINEL / 200_000) * 100))
		expect(screen.getByText(/next-request estimate/i).parentElement).toHaveTextContent("380.0k")

		rerender(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={W_AFTER}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByRole("progressbar")).toHaveTextContent(String((P_SENTINEL / 200_000) * 100))
		expect(screen.getByTestId("context-window-used-tokens")).toHaveTextContent("364.9k")
		expect(screen.getByText(/next-request estimate/i).parentElement).toHaveTextContent("90.0k")
	})

	it("does not import or invoke an estimator in the presentation component", () => {
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const file = fs.readFileSync(path.resolve(__dirname, "ContextWindow.tsx"), "utf8")
		expect(file).not.toMatch(/estimateRequestInputTokens/)
		expect(file).not.toMatch(/estimateMessageTokens/)
		expect(file).not.toMatch(/@\/utils\/tokenEstimators/)
	})
})

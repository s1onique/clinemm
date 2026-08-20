import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ButtonHTMLAttributes, PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ContextWindow from "./ContextWindow"

const condense = vi.fn().mockResolvedValue(undefined)

vi.mock("@/services/grpc-client", () => ({
	SlashServiceClient: {
		condense: (request: unknown) => condense(request),
	},
}))

vi.mock("@shared/proto/cline/common", () => ({
	StringRequest: {
		create: (request: unknown) => request,
	},
}))

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
	beforeEach(() => {
		condense.mockClear()
	})

	it("runs the compact RPC after confirmation instead of sending /compact as a message", async () => {
		const onSendMessage = vi.fn()

		render(
			<ContextWindow
				contextWindow={200_000}
				lastApiReqContextInputTokens={120_000}
				onSendMessage={onSendMessage}
				useAutoCondense={false}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /compact task/i }))
		fireEvent.click(screen.getByRole("button", { name: /^compact$/i }))

		await waitFor(() => expect(condense).toHaveBeenCalledWith({ value: "compact" }))
		expect(onSendMessage).not.toHaveBeenCalled()
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

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ButtonHTMLAttributes, PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ContextWindow from "./ContextWindow"

/**
 * These tests deliberately exercise the REAL Radix tooltip primitive (no
 * `vi.mock("@/components/ui/tooltip")` here) so that the rendered trigger
 * semantics are verified against production behavior rather than against a
 * mock that strips `asChild`.
 *
 * Radix's `TooltipTrigger` renders a `Primitive.button` unless `asChild` is
 * passed; without `asChild` the `aria-label` would land on a nested `<span>`
 * and the focusable button would be announced as "Prv" / "Est" instead of the
 * full description.
 */

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

const CONTEXT = 256_000
const PROVIDER_DESCRIPTION = "Provider-reported input for the last reported request"
const ESTIMATE_DESCRIPTION = "Estimated next-request input"

describe("ContextWindow compact authority badge accessibility", () => {
	beforeEach(() => {
		// Radix's floating-ui positioning requires ResizeObserver, which jsdom
		// does not implement. Mirrors the pattern in `src/components/ui/popover.test.tsx`.
		vi.stubGlobal(
			"ResizeObserver",
			class ResizeObserver {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
	})

	it("exposes the full description as the accessible name of the provider badge", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={148_800}
				lastApiReqContextInputTokens={68_900}
				useAutoCondense={false}
			/>,
		)

		expect(
			screen.getByRole("button", {
				name: "Provider-reported input for the last reported request",
			}),
		).toBeInTheDocument()
	})

	it("exposes the full description as the accessible name of the estimate badge", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={148_800}
				lastApiReqContextInputTokens={undefined}
				useAutoCondense={false}
			/>,
		)

		expect(
			screen.getByRole("button", {
				name: "Estimated next-request input",
			}),
		).toBeInTheDocument()
	})

	it("renders the badge as the focusable trigger itself, not a wrapper around a nested label", () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={148_800}
				lastApiReqContextInputTokens={68_900}
				useAutoCondense={false}
			/>,
		)

		const badge = screen.getByTestId("context-window-usage-authority")
		expect(badge.tagName).toBe("BUTTON")
		expect(badge).toHaveAttribute("type", "button")
		expect(badge).toHaveAttribute("aria-label", PROVIDER_DESCRIPTION)
		expect(badge).not.toHaveAttribute("title")
		expect(badge).toHaveAccessibleName(PROVIDER_DESCRIPTION)
		expect(badge.textContent?.trim()).toBe("Prv")
	})

	it("opens the tooltip when the badge receives focus", async () => {
		render(
			<ContextWindow
				contextWindow={CONTEXT}
				currentWorkingContextEstimate={148_800}
				lastApiReqContextInputTokens={68_900}
				useAutoCondense={false}
			/>,
		)

		const badge = screen.getByTestId("context-window-usage-authority")
		expect(screen.queryByText(PROVIDER_DESCRIPTION)).not.toBeInTheDocument()

		fireEvent.focus(badge)

		await waitFor(() => {
			expect(screen.getByText(PROVIDER_DESCRIPTION)).toBeInTheDocument()
		})
	})
})

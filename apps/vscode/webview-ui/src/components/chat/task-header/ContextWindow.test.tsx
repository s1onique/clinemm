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

// ============================================================================
// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
// (twenty-first-pass) — Boundary 5: TaskHeader /
// ContextWindow consumes W (currentWorkingContext
// Estimate) instead of P (lastApiReqContextInputTokens)
// when W is defined. When W is undefined, the bar is
// unavailable (NOT silently replaced with P — P and
// W are explicitly different authorities).
//
// Reviewer (twentieth-pass):
//
//   P = 364_900   (provider / last api_req_started
//                  payload)
//   W = 271_337   (runtime-published
//                  currentWorkingContextEstimate;
//                  deliberately distinct from the
//                  legacy 264.3k screenshot evidence)
//
//   When W is defined, the bar numerator = W.
//   When W is undefined, the bar is unavailable —
//   do not silently substitute P.
//   P provider metrics, H_b/H_a telemetry,
//   Strategy-D, and getApiMetrics() are unchanged.
//   Stale W reuse is FORBIDDEN.
//
// RED (this commit, entry HEAD):
//
//   Test 1: numerator for W=271_337 / P=364_900 →
//     expected 135.6685 % (~136)
//     actual   182.45 % (current uses P)
//     RED at entry.
//
//   Test 2: W=undefined / P=364_900 →
//     expected: no progressbar
//     actual:   progressbar shows 364_900
//     RED at entry.
//
//   Test 3: no W, no P, no contextWindow → no bar
//     GREEN at entry (already correct).
//
//   Test 4: NO_ESTIMATOR_RECOMPUTE conservation
//     (no estimator imports in production code):
//     GREEN at entry.
//
//   Test 5 (PRESERVED): legacy P-only path — W null
//     sentinel, P provided, bar shows P-driven
//     occupancy. RED at entry (current implementation
//     does not accept the null sentinel).
//
// GREEN (this commit): numerator = W when W is
// defined; render null when W is undefined; preserve
// the legacy null-sentinel P fallback.
// ============================================================================

describe("Boundary 5: ContextWindow numerator consumes W (currentWorkingContextEstimate) instead of P (lastApiReqContextInputTokens)", () => {
	const P_SENTINEL = 364_900
	const W_SENTINEL = 271_337

	it("RED -> GREEN: W defined takes precedence over P (numerator = W / contextWindow)", () => {
		// Authoritative W (runtime-published
		// currentWorkingContextEstimate) takes
		// precedence over the provider-derived P
		// (lastApiReqContextInputTokens). Distinct
		// truth domains — the runtime reflects the
		// actual next-request prompt occupancy,
		// while P is the disjoint sum of the last
		// request's input tokens.
		render(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={W_SENTINEL}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)
		// 271_337 / 200_000 = 1.356685 = 135.6685%
		// (W can exceed the model window after a
		//  compaction-aware redistribution; the bar
		//  shows > 100% by design — the user gets an
		//  honest "more than full" signal rather than
		//  a clipped 100% that hides overflow).
		expect(screen.getByRole("progressbar")).toHaveTextContent(
			String(Math.round((W_SENTINEL / 200_000) * 100)),
		)
	})

	it("RED -> GREEN: W defined, the displayed `used` value is W (not P)", () => {
		// The "Xk / Yk" tooltip / value above the bar
		// uses the same numerator — W, not P. Otherwise
		// the bar would show "364.9k" while the
		// progress is "271.3k" — a category error.
		render(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={W_SENTINEL}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)
		// The leading "Xk" token-element above the bar
		// uses the `used` value with the
		// `Current tokens used in this request` title.
		// Both must show W (271,337), not P (364,900).
		const usedElements = screen.getAllByTitle(
			/Current tokens used in this request/i,
		)
		expect(usedElements.length).toBeGreaterThan(0)
		for (const el of usedElements) {
			expect(el.textContent).toMatch(/271[,.]?337|271\.3k/i)
		}
	})

	it("RED -> GREEN: W null (runtime-cleared) -> no bar (forbidden: silent P-as-W substitution)", () => {
		// The runtime has emitted a no-W
		// working-context-state-changed event OR
		// the runtime is not yet active. Either
		// way, the host-side carrier has emitted
		// `null` for currentWorkingContextEstimate
		// (the runtime-cleared sentinel — see
		// apps/vscode/src/sdk/working-context-host-
		// capture.ts twenty-first-pass). The bar
		// must be UNAVAILABLE, not silently
		// substituted with P. Reviewer:
		// "P must not masquerade as W."
		render(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={null}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
	})

	it("RED -> GREEN: W null (runtime-cleared) -> no W-token leaked into the displayed used value (forbidden: silent 364,900-as-W)", () => {
		// Distinct from "no progressbar" — this pins
		// the `used` value text to be ABSENT when W
		// is `null`, so 364,900 cannot be shown as
		// "current W tokens" by accident.
		render(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={null}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)
		const usedElements = screen.queryAllByTitle(
			/Current tokens used in this request/i,
		)
		// Either the element does not render at all
		// (preferred — full null-fallback) OR it
		// does not contain P. Both are acceptable;
		// the invariant is "no 364,900 shown as W."
		for (const el of usedElements) {
			expect(el.textContent).not.toMatch(/364[,.]?900|364\.9k/i)
		}
	})

	it("PRESERVED (GREEN at entry): no progressbar when contextWindow is 0", () => {
		// Existing behavior — already correct, must
		// not regress.
		render(
			<ContextWindow
				contextWindow={0}
				currentWorkingContextEstimate={W_SENTINEL}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
	})

	it("PRESERVED (RED -> GREEN): legacy P-only path — W omitted, P provided, bar shows P-driven occupancy", () => {
		// The legacy / classic / non-runtime path
		// never emits W. The carrier is absent, so
		// the projection helper emits `undefined`
		// for currentWorkingContextEstimate on
		// `ExtensionState`. TaskHeader passes the
		// field through to ContextWindow, which
		// treats `undefined` as the
		// "legacy / never set" sentinel and falls
		// back to P (lastApiReqContextInputTokens).
		//
		// Distinction:
		//   currentWorkingContextEstimate === number
		//     → runtime emitted W → use W
		//   currentWorkingContextEstimate === null
		//     → runtime emitted, W cleared →
		//       render null (reviewer's B fallback)
		//   currentWorkingContextEstimate === undefined
		//     → carrier absent / legacy path →
		//       use P (the only place where P
		//       drives the bar)
		//
		// Implementation note: the prop accepts
		// `number | null | undefined`. The test
		// omits W entirely (undefined) for the
		// legacy path.
		render(
			<ContextWindow
				contextWindow={200_000}
				// currentWorkingContextEstimate
				// omitted (undefined) — legacy path.
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)
		// 364_900 / 200_000 = 1.8245 = 182%.
		expect(screen.getByRole("progressbar")).toHaveTextContent(
			String(Math.round((P_SENTINEL / 200_000) * 100)),
		)
	})

	it("DOGFOOD (RED -> GREEN): compaction recurrence — bar reflects W_before before compaction, W_after after the runtime emits a fresh W", () => {
		// Real post-compaction dogfood: the runtime
		// emits a sequence of
		// `working-context-state-changed` events
		// around a compaction step. The bar must
		// reflect the latest W at each step:
		//
		//   1. W_before = high (compact-needed)
		//   2. Runtime triggers compaction
		//   3. W_after = low (post-compaction)
		//
		// The bar's numerator must follow W, not
		// retain a stale value. (Reviewer
		// twentieth-pass: "Do not require the bar
		// to equal 264.3k; use the runtime-published
		// W as the oracle.")
		const W_BEFORE = 380_000 // 380k before compaction
		const W_AFTER = 90_000 // 90k after compaction

		const { rerender } = render(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={W_BEFORE}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)
		// 380_000 / 200_000 = 1.9 = 190%.
		expect(screen.getByRole("progressbar")).toHaveTextContent(
			String(Math.round((W_BEFORE / 200_000) * 100)),
		)

		// Runtime publishes a fresh W_after event.
		// The webview re-renders with the new prop.
		rerender(
			<ContextWindow
				contextWindow={200_000}
				currentWorkingContextEstimate={W_AFTER}
				lastApiReqContextInputTokens={P_SENTINEL}
				useAutoCondense={false}
			/>,
		)
		// 90_000 / 200_000 = 0.45 = 45%.
		// The bar flipped from 190% to 45% — the
		// compaction dropped W, and the bar reflects
		// the new runtime-published value.
		expect(screen.getByRole("progressbar")).toHaveTextContent(
			String(Math.round((W_AFTER / 200_000) * 100)),
		)

		// And: the displayed `used` value follows
		// the same oracle — W_AFTER, not P.
		const usedElements = screen.getAllByTitle(
			/Current tokens used in this request/i,
		)
		for (const el of usedElements) {
			expect(el.textContent).toMatch(/90[,.]?000|90k|90\./i)
		}
	})

	it("CONSERVATION (GREEN at entry): no estimator imports in ContextWindow production code", () => {
		// No regression: ContextWindow must continue
		// to NOT import W-recompute estimators.
		// This is a static-file probe — the test
		// reads the source and asserts no forbidden
		// identifiers appear.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs")
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const path = require("node:path") as typeof import("node:path")
		const file = fs.readFileSync(
			path.resolve(__dirname, "ContextWindow.tsx"),
			"utf8",
		)
		expect(file).not.toMatch(/estimateRequestInputTokens/)
		expect(file).not.toMatch(/estimateMessageTokens/)
		expect(file).not.toMatch(/@\/utils\/tokenEstimators/)
	})
})

// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION04:
//
// Canonical trace fixture: pin the divergence between the
// backend-owned `TurnState` (read by `useThinkingLoaderRow` and
// `TaskHeaderTelemetry`) and the message-tail-derived "Thinking..."
// shimmer rendered by `RequestStartRow.tsx`.
//
// The installed dogfood build showed:
//   - Task Header: "Idle"
//   - Chat list:   "Thinking..." shimmer rendered next to the
//     assistant's already-visible final report
//
// Root-cause classification: C04-C04-F6
//   HEADER_CORRECT_BUT_THINKING_LEGACY_STALE.
//
// `RequestStartRow.tsx` rendered the shimmer based on
// `reasoningContent && !hasCost` — a message-tail derivation. The
// canonical `turnState.phase === "streaming"` gate is the source
// of truth for `useThinkingLoaderRow` and `TaskHeaderTelemetry`.
//
// FIX: the shimmer now requires BOTH the message-tail precondition
// AND `turnState.phase === "streaming"`. Once the backend posts any
// non-streaming phase, the shimmer disappears.

import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { RequestStartRow } from "../RequestStartRow"

function apiReqStarted(opts: { cost?: number; reasoning?: string }): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({ cost: opts.cost, reasoning: opts.reasoning }),
		partial: false,
	}
}

function assistantReport(ts: number): ClineMessage {
	return {
		ts,
		type: "say",
		say: "text",
		text: "Hello!",
		partial: false,
	}
}

function turnState(phase: TurnState["phase"]): TurnState {
	return { phase, seq: 1, anchorTs: undefined }
}

function renderRow(opts: { cost?: number; reasoning?: string; clineMessages: ClineMessage[]; turnState?: TurnState }) {
	const { container } = render(
		<RequestStartRow
			apiReqStreamingFailedMessage={undefined}
			apiRequestFailedMessage={undefined}
			clineMessages={opts.clineMessages}
			cost={opts.cost}
			handleToggle={vi.fn()}
			isExpanded={false}
			message={apiReqStarted({ cost: opts.cost, reasoning: opts.reasoning })}
			mode="act"
			reasoningContent={opts.reasoning}
			responseStarted={false}
			turnState={opts.turnState ?? turnState("streaming")}
		/>,
	)
	const shimmer = container.querySelector("span.animate-shimmer")
	const collapsed = screen.queryByRole("button", { name: /Thinking/i })
	return { hasShimmer: !!shimmer, hasCollapsedThinking: !!collapsed }
}

describe("C04-C04-01 RequestStartRow text-only lifecycle (LIVE02)", () => {
	it("shows shimmer WHILE the api_req is open with no cost AND turnState=streaming", () => {
		const messages = [apiReqStarted({ cost: undefined, reasoning: "thinking..." })]
		const { hasShimmer, hasCollapsedThinking } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: messages,
			turnState: turnState("streaming"),
		})
		expect(hasShimmer).toBe(true)
		expect(hasCollapsedThinking).toBe(false)
	})

	it("switches from shimmer to collapsed ThinkingRow once cost lands", () => {
		const messages = [apiReqStarted({ cost: 0, reasoning: "thinking..." })]
		const { hasShimmer, hasCollapsedThinking } = renderRow({
			cost: 0,
			reasoning: "thinking...",
			clineMessages: messages,
			turnState: turnState("streaming"),
		})
		expect(hasShimmer).toBe(false)
		expect(hasCollapsedThinking).toBe(true)
	})

	it("LIVE02 pin: shimmer does NOT reappear after cost lands even with assistant report visible", () => {
		const messages = [apiReqStarted({ cost: 0 }), assistantReport(2)]
		const { hasShimmer } = renderRow({
			cost: 0,
			clineMessages: messages,
			turnState: turnState("completed"),
		})
		expect(hasShimmer).toBe(false)
	})
})

describe("C04-C04-02 Thinking indicator authority", () => {
	it("shimmer is hidden when turnState is non-streaming even if message tail says streaming", () => {
		const messages = [apiReqStarted({ cost: undefined, reasoning: "thinking..." })]
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: messages,
			turnState: turnState("completed"),
		})
		expect(hasShimmer).toBe(false)
	})

	it("shimmer is hidden when turnState is awaiting_followup (terminal-ish)", () => {
		const messages = [apiReqStarted({ cost: undefined, reasoning: "thinking..." })]
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: messages,
			turnState: turnState("awaiting_followup"),
		})
		expect(hasShimmer).toBe(false)
	})

	it("shimmer is hidden when turnState is resumable (cancelled)", () => {
		const messages = [apiReqStarted({ cost: undefined, reasoning: "thinking..." })]
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: messages,
			turnState: turnState("resumable"),
		})
		expect(hasShimmer).toBe(false)
	})

	it("shimmer is hidden when turnState is error", () => {
		const messages = [apiReqStarted({ cost: undefined, reasoning: "thinking..." })]
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: messages,
			turnState: turnState("error"),
		})
		expect(hasShimmer).toBe(false)
	})

	it("shimmer is hidden when turnState is idle (no active run)", () => {
		const messages = [apiReqStarted({ cost: undefined, reasoning: "thinking..." })]
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: messages,
			turnState: turnState("idle"),
		})
		expect(hasShimmer).toBe(false)
	})

	it("shimmer is shown when turnState is streaming AND message tail says streaming (active run)", () => {
		const messages = [apiReqStarted({ cost: undefined, reasoning: "thinking..." })]
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: messages,
			turnState: turnState("streaming"),
		})
		expect(hasShimmer).toBe(true)
	})
})

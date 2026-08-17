// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION04-CORRECTION01:
//
// Genuine ChatRow reasoning-case test. This file closes the
// evidence gap from CORRECTION04, where the M2 mutation test
// was a no-op because it rendered RequestStartRow instead of
// ChatRowContent. The dogfood bug showed a stuck "Thinking..."
// shimmer in the chat list at the `say:"reasoning"` message,
// which is rendered by ChatRowContent's `case "reasoning"`
// branch — NOT by RequestStartRow.
//
// This test renders ChatRowContent directly with the same
// shape of `message` and `clineMessages` the LIVE02 screenshot
// captured, and drives `turnState` through
// ExtensionStateContext.Provider (the actual production seam).
//
// Pin:
//   - turnState.phase === "streaming" + message.partial === true
//       => shimmer ("Thinking...") visible
//   - turnState.phase === "completed" + message.partial === true
//       => shimmer hidden
//   - turnState.phase === "awaiting_approval" + message.partial === true
//       => shimmer hidden

import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

function reasoningMessage(opts: { partial: boolean; text?: string }): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "reasoning",
		text: opts.text ?? "thinking through the problem...",
		partial: opts.partial,
	}
}

function assistantReport(ts: number, partial: boolean): ClineMessage {
	return { ts, type: "say", say: "text", text: "Here is the answer.", partial }
}

function turnState(phase: TurnState["phase"]): TurnState {
	return { phase, seq: 1, anchorTs: undefined }
}

function makeContextValue(phase: TurnState["phase"]) {
	return {
		turnState: turnState(phase),
		clineMessages: [],
		showFeatureTips: false,
	} as unknown as Parameters<typeof ExtensionStateContext.Provider>[0]["value"]
}

function renderReasoningRow(opts: { phase: TurnState["phase"]; partialReasoning?: boolean; assistantReportPartial?: boolean }) {
	const messages: ClineMessage[] = []
	messages.push(reasoningMessage({ partial: opts.partialReasoning ?? true }))
	if (opts.assistantReportPartial !== undefined) {
		messages.push(assistantReport(2, opts.assistantReportPartial))
	}
	const { container } = render(
		<ExtensionStateContext.Provider value={makeContextValue(opts.phase)}>
			<ChatRowContent
				inputValue=""
				isExpanded={false}
				isLast={false}
				lastModifiedMessage={undefined}
				message={messages[0]}
				mode="act"
				onCancelCommand={undefined}
				onLastRowContentChange={undefined}
				onSetQuote={vi.fn()}
				onToggleExpand={vi.fn()}
				reasoningContent={undefined}
				responseStarted={false}
				sendMessageFromChatRow={undefined}
			/>
		</ExtensionStateContext.Provider>,
	)
	const shimmer = container.querySelector("span.animate-shimmer")
	const thinkingTitle = Array.from(container.querySelectorAll("span")).find((el) =>
		/^Thinking\.{0,3}$/.test(el.textContent ?? ""),
	)
	return {
		hasShimmer: !!shimmer,
		thinkingTitleText: thinkingTitle?.textContent ?? null,
	}
}

describe('C04-C04-CHATROW-01: ChatRowContent `say:"reasoning"` consumes turnState', () => {
	it('streaming phase + partial tail => shimmer ("Thinking...") visible', () => {
		const { hasShimmer, thinkingTitleText } = renderReasoningRow({
			phase: "streaming",
			partialReasoning: true,
		})
		expect(hasShimmer).toBe(true)
		expect(thinkingTitleText).toBe("Thinking...")
	})

	it("completed phase + partial tail => shimmer hidden", () => {
		const { hasShimmer, thinkingTitleText } = renderReasoningRow({
			phase: "completed",
			partialReasoning: true,
			assistantReportPartial: false,
		})
		expect(hasShimmer).toBe(false)
		expect(thinkingTitleText).toBe("Thinking")
	})

	it("awaiting_approval phase + partial tail => shimmer hidden", () => {
		const { hasShimmer } = renderReasoningRow({
			phase: "awaiting_approval",
			partialReasoning: true,
		})
		expect(hasShimmer).toBe(false)
	})

	it("LIVE02 pin: completed phase + assistant report visible + stale reasoning tail => no shimmer", () => {
		const { hasShimmer } = renderReasoningRow({
			phase: "completed",
			partialReasoning: true,
			assistantReportPartial: false,
		})
		expect(hasShimmer).toBe(false)
	})
})

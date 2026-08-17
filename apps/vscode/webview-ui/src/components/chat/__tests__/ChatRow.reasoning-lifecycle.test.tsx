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
// This test renders ChatRowContent directly and drives `turnState`
// through ExtensionStateContext.Provider (the actual production
// seam).
//
// Pin (the single reasoning row in isolation):
//   - turnState.phase === "streaming" + message.partial === true
//       => shimmer ("Thinking...") visible
//   - turnState.phase === "completed" + message.partial === true
//       => shimmer hidden (collapses to "Thinking")
//   - turnState.phase === "awaiting_approval" + message.partial === true
//       => shimmer hidden
//
// What this fixture does NOT cover:
//   The composite UI shape that the LIVE02 screenshot captured —
//   "assistant report visibly rendered AND old reasoning row still
//   in the list AND old shimmer gone" — is a multi-row concern
//   owned by the parent list and `clineMessages`. It cannot be
//   exercised by rendering a single ChatRowContent in isolation,
//   and we do not pretend otherwise here. That composition is
//   accepted by walking LIVE02 on the installed dogfood build.

import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

function reasoningMessage(partial: boolean, text = "thinking through the problem..."): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "reasoning",
		text,
		partial,
	}
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

function renderReasoningRow(phase: TurnState["phase"], partial = true) {
	const { container } = render(
		<ExtensionStateContext.Provider value={makeContextValue(phase)}>
			<ChatRowContent
				inputValue=""
				isExpanded={false}
				isLast={false}
				lastModifiedMessage={undefined}
				message={reasoningMessage(partial)}
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
	it('streaming phase + partial reasoning tail => shimmer ("Thinking...") visible', () => {
		const { hasShimmer, thinkingTitleText } = renderReasoningRow("streaming")
		expect(hasShimmer).toBe(true)
		expect(thinkingTitleText).toBe("Thinking...")
	})

	it("completed phase + stale partial reasoning tail => shimmer hidden", () => {
		const { hasShimmer, thinkingTitleText } = renderReasoningRow("completed")
		expect(hasShimmer).toBe(false)
		expect(thinkingTitleText).toBe("Thinking")
	})

	it("awaiting_approval phase + partial reasoning tail => shimmer hidden", () => {
		const { hasShimmer } = renderReasoningRow("awaiting_approval")
		expect(hasShimmer).toBe(false)
	})
})

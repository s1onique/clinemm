// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION04-CORRECTION01:
//
// Real mutation campaign for the ChatRowContent `say:"reasoning"`
// branch. CORRECTION04 listed an "M2" mutation that was actually
// a no-op: the test rendered RequestStartRow, not ChatRow, so it
// could not detect removal of the ChatRow gate. CORRECTION01
// fixes that by rendering ChatRowContent directly and driving
// turnState through ExtensionStateContext.Provider.
//
// M2 kill: revert ChatRow's reasoning branch to
//     const isReasoningStreaming = messageTailStreaming
// (i.e. drop the `&& turnStateIsStreaming` conjunction). The
// "completed phase + stale reasoning tail" test must fail in the
// mutated state and pass again when the gate is restored.
//
// M3 kill: invert the gate so the shimmer shows only when
// turnState is NOT streaming. The "streaming phase + partial
// tail" test must fail in the mutated state.
//
// M5 kill: truthy check on turnState instead of consulting
// phase. With `turnState = { phase: "completed" }`, a truthy
// check yields streaming; the "completed phase" tests must fail.
//
// M6 kill: gate on a phase other than `streaming`. The
// `awaiting_approval` test must fail when the gate is
// `turnState?.phase === "awaiting_approval"`.

import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

function reasoningMessage(partial: boolean): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "reasoning",
		text: "thinking through the problem...",
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

function renderReasoning(phase: TurnState["phase"], partial: boolean) {
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
	return { hasShimmer: !!container.querySelector("span.animate-shimmer") }
}

describe("M2: ChatRowContent reasoning drop the turnState gate", () => {
	it("M2 kill: completed phase + stale reasoning tail => no shimmer", () => {
		const { hasShimmer } = renderReasoning("completed", true)
		expect(hasShimmer).toBe(false)
	})
	it("M2 pin: streaming phase + partial tail => shimmer visible", () => {
		const { hasShimmer } = renderReasoning("streaming", true)
		expect(hasShimmer).toBe(true)
	})
})

describe("M3: ChatRowContent reasoning invert the gate", () => {
	it("M3 kill: streaming phase + partial tail still shows the shimmer", () => {
		const { hasShimmer } = renderReasoning("streaming", true)
		expect(hasShimmer).toBe(true)
	})
})

describe("M5: ChatRowContent reasoning must consult phase, not just truthiness", () => {
	it("M5 kill: completed phase yields no shimmer even when turnState is provided", () => {
		const { hasShimmer } = renderReasoning("completed", true)
		expect(hasShimmer).toBe(false)
	})
})

describe("M6: ChatRowContent reasoning gates on `streaming`, not on `awaiting_approval`", () => {
	it("M6 kill: streaming phase yields the shimmer", () => {
		const { hasShimmer } = renderReasoning("streaming", true)
		expect(hasShimmer).toBe(true)
	})
	it("M6 kill: awaiting_approval phase does NOT yield the shimmer", () => {
		const { hasShimmer } = renderReasoning("awaiting_approval", true)
		expect(hasShimmer).toBe(false)
	})
})

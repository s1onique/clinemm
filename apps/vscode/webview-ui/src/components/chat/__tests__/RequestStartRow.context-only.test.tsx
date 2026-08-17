// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION04-CORRECTION01:
//
// Context-vertical witnesses for RequestStartRow. CORRECTION04's
// mutation suite passed `turnState` as a prop in every test, which
// proves the prop path but says nothing about the production path
// (consumption via ExtensionStateContext). These two tests pin the
// actual production consumption seam: no `turnState` prop, the
// component reads from `ExtensionStateContext.Provider`.
//
// Pin:
//   provider turnState={ phase: "streaming" }
//     -> shimmer visible (production: agent is streaming)
//   provider turnState={ phase: "completed" }
//     -> shimmer hidden  (production: agent finished)

import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
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

function turnState(phase: TurnState["phase"]): TurnState {
	return { phase, seq: 1, anchorTs: undefined }
}

function makeContextValue(phase: TurnState["phase"]) {
	return {
		turnState: turnState(phase),
		clineMessages: [],
	} as unknown as Parameters<typeof ExtensionStateContext.Provider>[0]["value"]
}

function renderRowFromContext(opts: {
	cost?: number
	reasoning?: string
	clineMessages: ClineMessage[]
	phase: TurnState["phase"]
}) {
	const { container } = render(
		// KEY: no `turnState` prop. The component must read it
		// from the provider.
		<ExtensionStateContext.Provider value={makeContextValue(opts.phase)}>
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
			/>
		</ExtensionStateContext.Provider>,
	)
	return { hasShimmer: !!container.querySelector("span.animate-shimmer") }
}

describe("C04-C04-CTV-01: RequestStartRow consumes turnState from ExtensionStateContext", () => {
	it("context phase=streaming + reasoning text + no cost => shimmer visible", () => {
		const { hasShimmer } = renderRowFromContext({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			phase: "streaming",
		})
		expect(hasShimmer).toBe(true)
	})

	it("context phase=completed + reasoning text + no cost => shimmer hidden", () => {
		const { hasShimmer } = renderRowFromContext({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			phase: "completed",
		})
		expect(hasShimmer).toBe(false)
	})

	it("context phase=awaiting_approval + reasoning text => shimmer hidden", () => {
		const { hasShimmer } = renderRowFromContext({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			phase: "awaiting_approval",
		})
		expect(hasShimmer).toBe(false)
	})
})

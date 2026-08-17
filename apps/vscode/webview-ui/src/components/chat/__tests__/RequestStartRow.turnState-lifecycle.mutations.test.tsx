// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION04:
//
// RequestStartRow mutation campaign (Phase Q).
//
// M1 - drop the turnState gate in RequestStartRow (legacy reverts)
// M3 - invert the gate (shimmer shows only when NOT streaming)
// M4 - turnStateProp silently ignored, useOptionalTurnState only
// M5 - turnStateProp used as a truthy flag instead of consulting phase
// M6 - gate on a different phase like "awaiting_approval"
//
// NOTE on M2: the real ChatRowContent `say:"reasoning"` mutation
// evidence lives in
//   src/components/chat/__tests__/ChatRow.reasoning-lifecycle.mutations.test.tsx
// (added in CORRECTION04-CORRECTION01). The original M2 row was
// structurally identical to the M1 row because both targeted
// RequestStartRow — it could not detect removal of the ChatRow
// gate. See CORRECTION01 for the corrected disposition.

import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { render } from "@testing-library/react"
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
	return { ts, type: "say", say: "text", text: "Hello!", partial: false }
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
	return { hasShimmer: !!shimmer }
}

describe("C04-C04-F6 base invariant (LIVE02)", () => {
	it("assistant report visible + turnState=completed -> NO shimmer", () => {
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." }), assistantReport(2)],
			turnState: turnState("completed"),
		})
		expect(hasShimmer).toBe(false)
	})

	it("turnState=streaming + tail streaming -> SHIMMER", () => {
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			turnState: turnState("streaming"),
		})
		expect(hasShimmer).toBe(true)
	})
})

describe("M1: RequestStartRow drop the turnState gate", () => {
	it("M1 kill: completed turn + assistant report does NOT show the shimmer", () => {
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." }), assistantReport(2)],
			turnState: turnState("completed"),
		})
		expect(hasShimmer).toBe(false)
	})
})

describe("M3: invert the turnState gate", () => {
	it("M3 kill: streaming + tail DOES show the shimmer", () => {
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			turnState: turnState("streaming"),
		})
		expect(hasShimmer).toBe(true)
	})
})

describe("M4: prop fall-through must work", () => {
	it("M4 kill: streaming prop drives the shimmer even without a context", () => {
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			turnState: turnState("streaming"),
		})
		expect(hasShimmer).toBe(true)
	})
})

describe("M5: turnState.phase is consulted (not just truthiness)", () => {
	it("M5 kill: completed prop -> no shimmer even though prop is provided", () => {
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			turnState: turnState("completed"),
		})
		expect(hasShimmer).toBe(false)
	})
})

describe("M6: gate on streaming specifically", () => {
	it("M6 kill: streaming phase shows the shimmer", () => {
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			turnState: turnState("streaming"),
		})
		expect(hasShimmer).toBe(true)
	})
	it("M6 kill: awaiting_approval phase does NOT show the shimmer", () => {
		const { hasShimmer } = renderRow({
			cost: undefined,
			reasoning: "thinking...",
			clineMessages: [apiReqStarted({ cost: undefined, reasoning: "thinking..." })],
			turnState: turnState("awaiting_approval"),
		})
		expect(hasShimmer).toBe(false)
	})
})

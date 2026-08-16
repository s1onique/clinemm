// ACT-CLINEMM-COMPLETION-CHANGESET-UI-STATE-TRUTH01:
//
// The two consumers that derive runtime-task activity from the
// backend-owned `TurnState` (InputSection for the composer
// lockout, useMessageHandlers for the follow-up routing) now
// read from centralised pure selectors. This suite pins the
// selectors across every consumer-facing truth table so a
// future change to either the phase vocabulary or the
// consumer semantics cannot silently regress the state model.
//
// SCOPE NOTE (board archaeology): the parent ACT title says
// "completion-changeset UI state truth". What this commit
// ACTUALLY migrated is the chat-view consumer of `TurnState`
// (composer lockout + follow-up routing). The completion
// changeset gate itself — `turnState.phase === "completed"`
// inside `buttonConfig.ts` / `ActionButtons.tsx` — was
// ALREADY a typed-authoritative gate before this ACT and is
// NOT modified here. The right reading of the parent ACT
// title is "the chat consumer whose presentation includes
// completion-changeset UI" rather than "the completion
// changeset calculation". The completion/changeset
// checkpoint-diff surface and the "Start New Task" gating
// were not touched.
//
// The IDs (CUI01..CUI12 here; CUI13/CUI14 are exercised in
// `useMessageHandlers.test.tsx` and `InputSection.test.tsx`)
// track the matrix the parent ACT committed to in §32 of its
// plan. The mutation campaign in §33
// (`turnStateSelectors.mutations.test.ts`) replays the
// canonical mutations against this matrix.

import type { TurnPhase, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { allowsQueuedSubmit, isRunLive, isRunTerminal, turnAllowsFollowup } from "./turnStateSelectors"

function turnState(phase: TurnPhase, seq = 1): TurnState {
	return { phase, seq }
}

const EVERY_PHASE: TurnPhase[] = [
	"idle",
	"streaming",
	"awaiting_approval",
	"awaiting_followup",
	"completed",
	"error",
	"resumable",
]

describe("ACT-CLINEMM-COMPLETION-CHANGESET-UI-STATE-TRUTH01 / CUI selector truth table", () => {
	// CUI01: idle.
	it("CUI01: idle is non-live, terminal, no queued submit, no follow-up", () => {
		const ts = turnState("idle")
		expect(allowsQueuedSubmit(ts)).toBe(false)
		expect(turnAllowsFollowup(ts)).toBe(false)
		expect(isRunLive(ts)).toBe(false)
		expect(isRunTerminal(ts)).toBe(true)
	})

	// CUI02: streaming (model producing content or tool running).
	it("CUI02: streaming is live and accepts queued submit + follow-up", () => {
		const ts = turnState("streaming")
		expect(allowsQueuedSubmit(ts)).toBe(true)
		expect(turnAllowsFollowup(ts)).toBe(true)
		expect(isRunLive(ts)).toBe(true)
		expect(isRunTerminal(ts)).toBe(false)
	})

	// CUI03: tooling (broad Option A). The webview never sees a
	// separate `tooling` phase; the SDK keeps phase `streaming`
	// while a tool runs. The selector agrees.
	it("CUI03: tooling is observed at the streaming phase, not a separate phase", () => {
		expect(allowsQueuedSubmit(turnState("streaming"))).toBe(true)
		expect(isRunLive(turnState("streaming"))).toBe(true)
	})

	// CUI04: awaiting_approval.
	it("CUI04: awaiting_approval is live + queued submit, NOT a follow-up slot", () => {
		const ts = turnState("awaiting_approval")
		expect(allowsQueuedSubmit(ts)).toBe(true)
		expect(turnAllowsFollowup(ts)).toBe(false)
		expect(isRunLive(ts)).toBe(true)
		expect(isRunTerminal(ts)).toBe(false)
	})

	// CUI05: completed. The load-bearing between-turn active
	// case. completed is terminal + non-live but the user can
	// keep typing against the run. The two selectors split the
	// run-active / busy question.
	it("CUI05: completed is terminal + non-live but a follow-up slot", () => {
		const ts = turnState("completed")
		expect(turnAllowsFollowup(ts)).toBe(true)
		expect(isRunLive(ts)).toBe(false)
		expect(isRunTerminal(ts)).toBe(true)
		expect(allowsQueuedSubmit(ts)).toBe(false)
	})

	// CUI06: resumable (post-abort / interrupted). The
	// `useMessageHandlers` no-clineAsk follow-up path does NOT
	// include `resumable`; resumable tasks flow through the
	// dedicated `clineAsk === "resume_task"` branch (which sends
	// `yesButtonClicked`), not the generic follow-up routing.
	// `resumable` is terminal + non-live here, but it is NOT a
	// follow-up slot at this selector — Resume is its own
	// surface.
	it("CUI06: resumable is terminal + non-live, NOT a follow-up slot", () => {
		const ts = turnState("resumable")
		expect(turnAllowsFollowup(ts)).toBe(false)
		expect(isRunLive(ts)).toBe(false)
		expect(isRunTerminal(ts)).toBe(true)
		expect(allowsQueuedSubmit(ts)).toBe(false)
	})

	// CUI07: terminal beats stale partial. The selectors read
	// ONLY turnState. The `lastMessage.partial === true` prose
	// never enters the projection. If someone later edits a
	// consumer to read prose again, the InputSection / useMessage
	// tests will catch it; here we pin the selector side.
	it("CUI07: a stale partial cannot keep the runtime live when turnState is terminal", () => {
		expect(isRunLive(turnState("completed"))).toBe(false)
		expect(isRunTerminal(turnState("completed"))).toBe(true)
		expect(turnAllowsFollowup(turnState("completed"))).toBe(true)
	})

	// CUI08: error.
	it("CUI08: error is terminal + non-live + NOT a follow-up slot", () => {
		const ts = turnState("error")
		expect(turnAllowsFollowup(ts)).toBe(false)
		expect(isRunLive(ts)).toBe(false)
		expect(isRunTerminal(ts)).toBe(true)
		expect(allowsQueuedSubmit(ts)).toBe(false)
	})

	// CUI09: awaiting_followup.
	it("CUI09: awaiting_followup is terminal + non-live + follow-up slot", () => {
		const ts = turnState("awaiting_followup")
		expect(turnAllowsFollowup(ts)).toBe(true)
		expect(isRunLive(ts)).toBe(false)
		expect(isRunTerminal(ts)).toBe(true)
		expect(allowsQueuedSubmit(ts)).toBe(false)
	})

	// CUI10: undefined turnState is conservative across the board.
	it("CUI10: missing canonical state is conservative in every selector", () => {
		expect(allowsQueuedSubmit(undefined)).toBe(false)
		expect(turnAllowsFollowup(undefined)).toBe(false)
		expect(isRunLive(undefined)).toBe(false)
		expect(isRunTerminal(undefined)).toBe(false)
	})

	// CUI11: exhaustive truth table. Every (phase × selector)
	// cell. Catches edits that forget a selector.
	it("CUI11: exhaustive truth table across every phase", () => {
		const expected: Record<TurnPhase, { live: boolean; terminal: boolean; followup: boolean; queued: boolean }> = {
			idle: { live: false, terminal: true, followup: false, queued: false },
			streaming: { live: true, terminal: false, followup: true, queued: true },
			awaiting_approval: { live: true, terminal: false, followup: false, queued: true },
			awaiting_followup: { live: false, terminal: true, followup: true, queued: false },
			completed: { live: false, terminal: true, followup: true, queued: false },
			error: { live: false, terminal: true, followup: false, queued: false },
			resumable: { live: false, terminal: true, followup: false, queued: false },
		}
		for (const phase of EVERY_PHASE) {
			const ts = turnState(phase)
			expect({
				live: isRunLive(ts),
				terminal: isRunTerminal(ts),
				followup: turnAllowsFollowup(ts),
				queued: allowsQueuedSubmit(ts),
			}).toEqual(expected[phase])
		}
		// isRunLive is the negation of isRunTerminal for every phase.
		for (const phase of EVERY_PHASE) {
			expect(isRunLive(turnState(phase))).toBe(!isRunTerminal(turnState(phase)))
		}
	})

	// CUI12: referentially transparent. The selector must remain
	// pure so React's identity check on the dependency array
	// does not retrigger render storms.
	it("CUI12: selectors are referentially transparent (pure)", () => {
		for (let i = 0; i < 4; i++) {
			expect(allowsQueuedSubmit(turnState("streaming", i))).toBe(true)
			expect(turnAllowsFollowup(turnState("completed", i))).toBe(true)
			expect(isRunLive(turnState("awaiting_approval", i))).toBe(true)
			expect(isRunTerminal(turnState("idle", i))).toBe(true)
		}
	})
})

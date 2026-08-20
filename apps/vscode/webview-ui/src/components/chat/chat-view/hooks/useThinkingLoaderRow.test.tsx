import type { ClineMessage, ThinkingPresentationProjection, TurnState } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	computeIsWaitingForResponse,
	THINKING_LOADER_GRACE_MS,
	type ThinkingLoaderInputs,
	useThinkingLoaderRow,
} from "./useThinkingLoaderRow"

// ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01:
// Regression guards for the pure-presentation defect class. Each test
// asserts that under the canonical shadow projection, the loader
// correctly disappears when the canonical runtime state has transitioned
// away from `modelStreaming = true`. If a future change re-introduces a
// stale-presentation authority (a local `isThinking` boolean that
// outlives the canonical transition, a stale-event winner, etc.), the
// matching STP test fails.
//
// These tests are intentionally written to be tautologically PASS on
// the post-E7.1 codebase: the goal is to LOCK the post-E7.1 invariant
// so future regressions are caught, NOT to manufacture a new RED. The
// closing verdict of the ACT is NOT_REPRODUCED — these tests are the
// guardrail for that verdict.
function shadowOff(seq: number): ThinkingPresentationProjection {
	return { modelStreaming: false, source: "shadow", seq }
}
function shadowOn(seq: number): ThinkingPresentationProjection {
	return { modelStreaming: true, source: "shadow", seq }
}

function say(ts: number, sayType: ClineMessage["say"], partial?: boolean, text = ""): ClineMessage {
	return { ts, type: "say", say: sayType, text, partial }
}

function streaming(seq = 1): TurnState {
	return { phase: "streaming", seq }
}

function inputsFor(messages: ClineMessage[], turnState: TurnState | undefined): ThinkingLoaderInputs {
	return {
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01:
		// The pre-E7.1 turnState-path and legacy-path tests below intentionally
		// pass `undefined` for the new `thinkingPresentation` field so the
		// projector falls back to the legacy `turnState.phase` gate. This
		// preserves the existing test contract while opening the new
		// canonical-shadow path (covered by the `e7.1` describe block
		// further down).
		thinkingPresentation: undefined,
		turnState,
		lastRawMessage: messages.at(-1),
		groupedMessages: messages,
		lastVisibleRow: messages.at(-1),
		lastVisibleMessage: messages.at(-1),
		modifiedMessages: messages,
	}
}

describe("computeIsWaitingForResponse (turnState path)", () => {
	it("waits while streaming with no visible rows yet", () => {
		expect(computeIsWaitingForResponse(inputsFor([], streaming()))).toBe(true)
	})

	it("does not wait while a content row is actively streaming", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", true)], streaming()))).toBe(false)
	})

	it("waits when the last visible row is no longer partial while streaming", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", false)], streaming()))).toBe(true)
	})

	it("never waits outside the streaming phase", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", false)], { phase: "awaiting_followup", seq: 2 }))).toBe(
			false,
		)
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", false)], { phase: "completed", seq: 2 }))).toBe(false)
	})

	it("does not wait on a final completion_result even while phase is still streaming", () => {
		// attempt_completion's say("completion_result") lands before the done event flips the
		// phase to "completed"; the loader must not flash during that gap.
		expect(computeIsWaitingForResponse(inputsFor([say(1, "completion_result", false)], streaming()))).toBe(false)
	})
})

describe("computeIsWaitingForResponse (legacy path)", () => {
	it("does not wait when the last raw message is an ask", () => {
		const ask: ClineMessage = { ts: 1, type: "ask", ask: "followup", text: "?", partial: false }
		expect(computeIsWaitingForResponse(inputsFor([ask], undefined))).toBe(false)
	})

	it("does not wait on a final completion_result", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "completion_result", false)], undefined))).toBe(false)
	})

	it("waits when the last visible row is not actively partial", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", false)], undefined))).toBe(true)
	})
})

// ===========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01:
//
// Canonical-shadow path for the thinking loader. When the backend
// publishes a `thinkingPresentation` projection (LOCAL with qualified
// shadow, or the legacy fallback for Hub/Remote), the loader reads
// from it directly — the legacy `turnState` gate is bypassed for the
// "is the agent thinking" decision. The two-source rule pins the
// shadow-source wins + legacy-source compatibility.
//
// The witness matrix:
//   T-S1..T-S6 — shadow branch reads only modelStreaming
//   T-L1..T-L2 — legacy branch matches existing turnState-path tests
// ===========================================================================

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1 / computeIsWaitingForResponse (shadow path)", () => {
	function inputsWithShadow(
		messages: ClineMessage[],
		thinkingPresentation: ThinkingPresentationInputs["thinkingPresentation"],
		turnState?: TurnState,
	): ThinkingLoaderInputs {
		return {
			thinkingPresentation,
			turnState,
			lastRawMessage: messages.at(-1),
			groupedMessages: messages,
			lastVisibleRow: messages.at(-1),
			lastVisibleMessage: messages.at(-1),
			modifiedMessages: messages,
		}
	}

	it("T-S1: shadow modelStreaming=true with no visible rows → wait", () => {
		expect(computeIsWaitingForResponse(inputsWithShadow([], { modelStreaming: true, source: "shadow", seq: 1 }))).toBe(true)
	})

	it("T-S2: shadow modelStreaming=true with actively-partial text → no wait (suppressed)", () => {
		expect(
			computeIsWaitingForResponse(
				inputsWithShadow([say(1, "text", true)], { modelStreaming: true, source: "shadow", seq: 1 }),
			),
		).toBe(false)
	})

	it("T-S3: shadow modelStreaming=false → no wait (regardless of legacy phase)", () => {
		// T2_LEGACY_INDEPENDENCE — shadow wins, legacy phase='streaming'
		// is IGNORED.
		expect(
			computeIsWaitingForResponse(
				inputsWithShadow(
					[say(1, "text", false)],
					{ modelStreaming: false, source: "shadow", seq: 1 },
					{ phase: "streaming", seq: 1 },
				),
			),
		).toBe(false)
	})

	it("T-S4: shadow modelStreaming=false → no wait outside streaming phase", () => {
		expect(
			computeIsWaitingForResponse(
				inputsWithShadow(
					[say(1, "text", false)],
					{ modelStreaming: false, source: "shadow", seq: 1 },
					{ phase: "completed", seq: 1 },
				),
			),
		).toBe(false)
	})

	it("T-S5: shadow source='legacy' + modelStreaming=true from legacy fallback is byte-equivalent to the legacy path", () => {
		// The Hub/Remote absence-state collapse: shadow source='legacy',
		// modelStreaming = legacyPhase === 'streaming'.
		expect(
			computeIsWaitingForResponse(
				inputsWithShadow([], { modelStreaming: true, source: "legacy", seq: 1 }, { phase: "streaming", seq: 1 }),
			),
		).toBe(true)
	})

	it("T-S6: shadow source='legacy' + completion_result anti-flicker", () => {
		expect(
			computeIsWaitingForResponse(
				inputsWithShadow(
					[say(1, "completion_result", false)],
					{ modelStreaming: true, source: "legacy", seq: 1 },
					{ phase: "streaming", seq: 1 },
				),
			),
		).toBe(false)
	})
})

describe("useThinkingLoaderRow anti-flash debounce", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	function renderLoader(initial: ThinkingLoaderInputs) {
		return renderHook((inputs: ThinkingLoaderInputs) => useThinkingLoaderRow(inputs), { initialProps: initial })
	}

	it("does not flash when the turn completes right after the tail message finalizes", () => {
		// Streaming text row: loader hidden.
		const { result, rerender } = renderLoader(inputsFor([say(1, "text", true)], streaming()))
		expect(result.current).toBe(false)

		// Tail finalizes (partial -> false) while turnState still says "streaming":
		// the loader must NOT appear immediately.
		rerender(inputsFor([say(1, "text", false)], streaming()))
		expect(result.current).toBe(false)

		// The done event flips the phase before the grace period elapses: no flash.
		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS - 100)
		})
		rerender(inputsFor([say(1, "text", false)], { phase: "awaiting_followup", seq: 2 }))
		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS)
		})
		expect(result.current).toBe(false)
	})

	it("shows the loader after the grace period when the wait is real (mid-turn)", () => {
		const { result, rerender } = renderLoader(inputsFor([say(1, "text", true)], streaming()))
		expect(result.current).toBe(false)

		rerender(inputsFor([say(1, "text", false)], streaming()))
		expect(result.current).toBe(false)

		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS)
		})
		expect(result.current).toBe(true)
	})

	it("shows the loader immediately at turn start (no finalizing tail involved)", () => {
		const userMessage = say(1, "user_feedback", false, "do the thing")
		const { result, rerender } = renderLoader(inputsFor([userMessage], { phase: "awaiting_followup", seq: 1 }))
		expect(result.current).toBe(false)

		rerender(inputsFor([userMessage], streaming(2)))
		expect(result.current).toBe(true)
	})

	it("hides the loader as soon as new content starts streaming during the wait", () => {
		const { result, rerender } = renderLoader(inputsFor([say(1, "text", false)], streaming()))
		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS)
		})
		expect(result.current).toBe(true)

		rerender(inputsFor([say(1, "text", false), say(2, "reasoning", true, "hmm")], streaming()))
		expect(result.current).toBe(false)
	})

	it("shows immediately when a reasoning tail finalizes mid-turn (no grace gap before the next tool call)", () => {
		// Reasoning streaming: the reasoning row's own shimmer is visible, loader hidden.
		const { result, rerender } = renderLoader(inputsFor([say(1, "reasoning", true, "hmm")], streaming()))
		expect(result.current).toBe(false)

		// Reasoning finalizes while the turn keeps streaming (model is now assembling a tool
		// call). Reasoning never ends a turn, so the loader must take over without the grace
		// gap that made the thinking indicator disappear and reappear before the tool row.
		rerender(inputsFor([say(1, "reasoning", false, "hmm")], streaming()))
		expect(result.current).toBe(true)
	})

	it("keeps an already-visible loader shown when a tool group tail finalizes", () => {
		const toolAsk = (partial: boolean): ClineMessage => ({
			ts: 2,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "readFile", path: "a.ts" }),
			partial,
		})
		const toolGroupInputs = (tail: ClineMessage): ThinkingLoaderInputs => {
			const group = Object.assign([tail], { _isToolGroup: true }) as ClineMessage[]
			return {
				turnState: streaming(),
				lastRawMessage: tail,
				groupedMessages: [group],
				lastVisibleRow: group,
				lastVisibleMessage: tail,
				modifiedMessages: [tail],
			}
		}

		// Loader is visible below the streaming tool group.
		const { result, rerender } = renderLoader(toolGroupInputs(toolAsk(true)))
		expect(result.current).toBe(true)

		// The group's tail finalizing must not blink the visible loader off for the grace period.
		rerender(toolGroupInputs(toolAsk(false)))
		expect(result.current).toBe(true)
	})

	it("does not flash on attempt_completion turns even without the debounce timing", () => {
		const { result, rerender } = renderLoader(inputsFor([say(1, "completion_result", true)], streaming()))
		expect(result.current).toBe(false)

		rerender(inputsFor([say(1, "completion_result", false)], streaming()))
		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS)
		})
		expect(result.current).toBe(false)
	})
})

describe("useThinkingLoaderRow optimistic response handoff", () => {
	function renderLoader(initial: ThinkingLoaderInputs) {
		return renderHook((inputs: ThinkingLoaderInputs) => useThinkingLoaderRow(inputs), { initialProps: initial })
	}

	function LoaderProbe({ inputs }: { inputs: ThinkingLoaderInputs }) {
		return <span>{useThinkingLoaderRow(inputs) ? "visible" : "hidden"}</span>
	}

	it("shows in the initial render before passive effects run", () => {
		const inputs = {
			...inputsFor([say(1, "completion_result", false, "done")], { phase: "completed", seq: 5 }),
			forceShow: true,
		}

		expect(renderToString(<LoaderProbe inputs={inputs} />)).toContain("visible")
	})

	it.each([
		"idle",
		"completed",
		"awaiting_followup",
	] as const)("shows immediately while the webview still has the stale %s phase", (phase) => {
		const { result } = renderLoader({ ...inputsFor([], { phase, seq: 1 }), forceShow: true })
		expect(result.current).toBe(true)
	})

	it("does not show for a stale idle turnState without the marker", () => {
		const { result } = renderLoader(inputsFor([], { phase: "idle", seq: 1 }))
		expect(result.current).toBe(false)
	})

	it("shows for a follow-up even when the tail is the previous turn's completion_result", () => {
		// Follow-up after a completed turn: the tail is the previous turn's completion_result and
		// the phase is still "completed" until the streaming TurnState posts. Both would normally
		// suppress the loader; the optimistic marker bypasses them at turn START.
		const conversation = [say(1, "completion_result", false, "done")]
		const { result } = renderLoader({
			...inputsFor(conversation, { phase: "completed", seq: 5 }),
			forceShow: true,
		})
		expect(result.current).toBe(true)
	})

	it("never shows while a visible content row is actively streaming, even with the marker", () => {
		const conversation = [say(1, "text", true, "already streaming")]
		const { result } = renderLoader({
			...inputsFor(conversation, { phase: "completed", seq: 5 }),
			forceShow: true,
		})
		expect(result.current).toBe(false)
	})

	it("hands off without a gap when the fresh streaming state arrives", () => {
		const task = say(1, "task", false, "do the thing")
		const withoutVisibleRows = (turnState: TurnState, forceShow: boolean): ThinkingLoaderInputs => ({
			...inputsFor([], turnState),
			lastRawMessage: task,
			forceShow,
		})
		const { result, rerender } = renderLoader(withoutVisibleRows({ phase: "idle", seq: 1 }, true))
		expect(result.current).toBe(true)

		rerender(withoutVisibleRows(streaming(2), false))
		expect(result.current).toBe(true)
	})

	it("does not leave a forced loader after a fresh terminal state", () => {
		const { result, rerender } = renderLoader({
			...inputsFor([say(1, "text", false)], { phase: "completed", seq: 1 }),
			forceShow: true,
		})
		expect(result.current).toBe(true)

		rerender({ ...inputsFor([say(1, "text", false)], { phase: "error", seq: 2 }), forceShow: false })
		expect(result.current).toBe(false)
	})
})

// ===========================================================================
// ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01:
//
// RED-matrix regression guards (STP01..STP08). These tests exercise the
// pure-presentation defect class: the canonical TaskState shadow has
// already transitioned to modelStreaming=false, so the in-list loader
// row MUST NOT render. They exercise the consumer seam (`computeIsWaitingForResponse`)
// directly with a non-empty message list to mirror the post-terminal
// dogfood walk (LIVE-E71-R1) where the assistant's final report was
// visible but the loader would have re-rendered under a stale authority.
//
// Each test corresponds to a discriminator from §8..§14 of the ACT.
// A regression in the canonical projection seam — local duplicate
// authority, stale-event winner, missing modelStreaming reset, prose
// heuristic, etc. — breaks at least one of these.
// ===========================================================================

describe("ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01 / shadow-path STP discriminators", () => {
	function withShadow(
		messages: ClineMessage[],
		shadow: ThinkingPresentationProjection,
		turnState?: TurnState,
	): ThinkingLoaderInputs {
		return {
			thinkingPresentation: shadow,
			turnState,
			lastRawMessage: messages.at(-1),
			groupedMessages: messages,
			lastVisibleRow: messages.at(-1),
			lastVisibleMessage: messages.at(-1),
			modifiedMessages: messages,
		}
	}

	// STP01: streaming → awaiting_followup (canonical phase flip, no message deletion)
	it("STP01: shadow modelStreaming=false clears the loader (streaming → awaiting_followup)", () => {
		const conversation = [say(1, "text", false, "done with the turn")]
		expect(computeIsWaitingForResponse(withShadow(conversation, shadowOff(2), { phase: "awaiting_followup", seq: 2 }))).toBe(
			false,
		)
	})

	// STP02: streaming → completed (terminal canonical phase flip)
	it("STP02: shadow modelStreaming=false clears the loader (streaming → completed)", () => {
		const conversation = [say(1, "completion_result", false, "result")]
		expect(computeIsWaitingForResponse(withShadow(conversation, shadowOff(2), { phase: "completed", seq: 2 }))).toBe(false)
	})

	// STP03: streaming → error (terminal canonical phase flip)
	it("STP03: shadow modelStreaming=false clears the loader (streaming → error)", () => {
		const conversation = [say(1, "text", false, "interrupted")]
		expect(computeIsWaitingForResponse(withShadow(conversation, shadowOff(2), { phase: "error", seq: 2 }))).toBe(false)
	})

	// STP04: streaming → compacting → awaiting_followup
	// (Compacting owns its own label/row; loader must not co-render.)
	it("STP04: shadow modelStreaming=false clears the loader (streaming → compacting)", () => {
		const conversation: ClineMessage[] = []
		expect(computeIsWaitingForResponse(withShadow(conversation, shadowOff(2), { phase: "compacting", seq: 2 }))).toBe(false)
	})

	// STP05: background command tail canonical reset (RTP-ASYNC01 contract).
	// The transition is an authority reset, not a heuristic.
	it("STP05: shadow modelStreaming=false clears the loader after a background command tail", () => {
		const conversation = [say(1, "text", false, "command returned")]
		expect(computeIsWaitingForResponse(withShadow(conversation, shadowOff(2), { phase: "awaiting_followup", seq: 2 }))).toBe(
			false,
		)
	})

	// STP06: historical reasoning content remains visible where intended.
	// The loader does not render when shadow says off EVEN IF the last
	// visible row is the completed reasoning row itself (it would render
	// the static ThinkingRow via ChatRow, not the loader).
	it("STP06: shadow modelStreaming=false does not re-introduce the loader above a finalized reasoning row", () => {
		const conversation = [say(1, "reasoning", false, "thought about the problem")]
		expect(computeIsWaitingForResponse(withShadow(conversation, shadowOff(2), { phase: "completed", seq: 2 }))).toBe(false)
	})

	// STP07: new active run begins. The shadow projection is the SINGLE
	// source of truth — turning it back on re-introduces the loader.
	it("STP07: shadow modelStreaming=true re-introduces the loader for a fresh active run", () => {
		const conversation: ClineMessage[] = []
		expect(computeIsWaitingForResponse(withShadow(conversation, shadowOn(3)))).toBe(true)
	})

	// STP08: stale older task/turn state cannot resurrect Thinking after
	// a newer canonical update has set modelStreaming=false. This is the
	// canonical "post-terminal authority split" discriminator.
	it("STP08: a new shadow-off push wins over any stale phase=streaming carry-over", () => {
		const conversation = [say(1, "text", false, "assistant finished")]
		// The turnState was streaming (legacy carry-over), but the shadow
		// projection has already flipped to false — the shadow wins
		// (T-S3 contract: shadow modelStreaming=false → no wait,
		// regardless of legacy phase).
		expect(computeIsWaitingForResponse(withShadow(conversation, shadowOff(5), { phase: "streaming", seq: 4 }))).toBe(false)
	})
})

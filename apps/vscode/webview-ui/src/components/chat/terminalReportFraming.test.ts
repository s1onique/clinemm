/**
 * ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01
 *
 * Pure-helper matrix covering ACT §3 (RED matrix) and ACT §8
 * (minimum useful matrix). The presentation layer
 * (`CompletionOutputRow`) reuses the same truth via a single prop, so
 * this file is the single source of authority for the
 * "visible `Completed` framing" decision.
 *
 * The matrix MUST stay hand-written and exhaustive — the ACT
 * specifically forbids text-derived inference, so this suite is the
 * regression net against "I saw the word 'Completed' so it must be done".
 */
import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { resolveTerminalReportFraming } from "./terminalReportFraming"

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

const COMPLETED_PHASE: TurnState = { phase: "completed", seq: 1 }
const STREAMING_PHASE: TurnState = { phase: "streaming", seq: 1 }
const AWAITING_FOLLOWUP_PHASE: TurnState = { phase: "awaiting_followup", seq: 1 }
const ERROR_PHASE: TurnState = { phase: "error", seq: 1 }
const RESUMABLE_PHASE: TurnState = { phase: "resumable", seq: 1 }
const IDLE_PHASE: TurnState = { phase: "idle", seq: 1 }
const AWAITING_APPROVAL_PHASE: TurnState = { phase: "awaiting_approval", seq: 1 }
const COMPACTING_PHASE: TurnState = { phase: "compacting", seq: 1 }

function sayCompletionResult(text: string, partial = false, marker = false): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "completion_result",
		text,
		partial,
		// ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01:
		// optional marker; default `false` so existing negative tests
		// keep their semantics (marker absent → no badge unless legacy
		// ask fallback applies).
		isAuthoritativelyCompletedResult: marker || undefined,
	}
}

function askCompletionResult(text: string): ClineMessage {
	return {
		ts: 1,
		type: "ask",
		ask: "completion_result",
		text,
	}
}

function planCompletionResultSay(text: string): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "plan_completion_result",
		text,
	}
}

function textSay(text: string): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "text",
		text,
	}
}

// -----------------------------------------------------------------------
// ACT §3 — RED target: completed + final assistant result → framing
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 — completed projection", () => {
	it("completed + final say completion_result with marker → visible Completed framing (canonical path)", () => {
		const framing = resolveTerminalReportFraming({
			message: sayCompletionResult("All done.", false, true),
			mode: "act",
			turnState: COMPLETED_PHASE,
		})
		expect(framing).toEqual({
			kind: "completed",
			label: "Completed",
			ariaLabel: "Task completed",
			title: "Task completed successfully",
		})
	})

	it("completed + ask completion_result with non-empty text → visible Completed framing (legacy authority)", () => {
		const framing = resolveTerminalReportFraming({
			message: askCompletionResult("Done."),
			mode: "act",
			turnState: COMPLETED_PHASE,
		})
		expect(framing?.kind).toBe("completed")
	})

	it("completed + empty ask completion_result → no framing (filterVisibleMessages already excludes, but defend in depth)", () => {
		expect(
			resolveTerminalReportFraming({
				message: askCompletionResult(""),
				mode: "act",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})
})

// -----------------------------------------------------------------------
// ACT §8 — negative / conservation cases (must NOT show Completed)
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 — non-completed states", () => {
	it("streaming + say completion_result → no Completed framing (not terminal)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: STREAMING_PHASE,
			}),
		).toBeUndefined()
	})

	it("awaiting_followup + say completion_result → no Completed framing (terminal but not completed)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Here is the plan.", false),
				mode: "act",
				turnState: AWAITING_FOLLOWUP_PHASE,
			}),
		).toBeUndefined()
	})

	it("error + say completion_result → no Completed framing (no false-positive when the run errored)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: ERROR_PHASE,
			}),
		).toBeUndefined()
	})

	it("resumable + say completion_result → no Completed framing (cancelled/interrupted, not terminal completed)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: RESUMABLE_PHASE,
			}),
		).toBeUndefined()
	})

	it("idle + say completion_result → no Completed framing", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: IDLE_PHASE,
			}),
		).toBeUndefined()
	})

	it("awaiting_approval + say completion_result → no Completed framing", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: AWAITING_APPROVAL_PHASE,
			}),
		).toBeUndefined()
	})

	it("compacting + say completion_result → no Completed framing", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: COMPACTING_PHASE,
			}),
		).toBeUndefined()
	})

	it("undefined turnState + say completion_result → no Completed framing (fail closed)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: undefined,
			}),
		).toBeUndefined()
	})

	it("partial say completion_result + completed phase → no Completed framing (content still streaming)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", true),
				mode: "act",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})
})

// -----------------------------------------------------------------------
// ACT §6 / §8 — plan-mode is always a separate sentinel (no Completed)
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 — plan mode sentinel", () => {
	it("plan mode + say completion_result → no Completed framing (PlanCompletionOutputRow handles plans)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Here is the plan.", false),
				mode: "plan",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})

	it("plan mode + ask completion_result → no Completed framing", () => {
		expect(
			resolveTerminalReportFraming({
				message: askCompletionResult("Here is the plan."),
				mode: "plan",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})

	it("plan_completion_result say + plan mode + completed phase → no Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: planCompletionResultSay("Implement the plan."),
				mode: "plan",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})
})

// -----------------------------------------------------------------------
// ACT §8 — message-shape gates (non-completion rows never get Completed)
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 — message-shape gates", () => {
	it("text say + completed phase → no Completed framing (wrong message kind)", () => {
		expect(
			resolveTerminalReportFraming({
				message: textSay("Done."),
				mode: "act",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})

	it("plan_completion_result say + completed phase + act mode → no Completed (plan routes through PlanCompletionOutputRow)", () => {
		expect(
			resolveTerminalReportFraming({
				message: planCompletionResultSay("Implement the plan."),
				mode: "act",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})
})

// -----------------------------------------------------------------------
// ACT §8 — M-killer: text-derived completion is forbidden
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 — model-killer: text does NOT imply completion", () => {
	it("text says 'Completed everything successfully' but phase is streaming → MUST NOT frame as Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Completed everything successfully.", false),
				mode: "act",
				turnState: STREAMING_PHASE,
			}),
		).toBeUndefined()
	})

	it("text says 'Completed' but phase is undefined → MUST NOT frame as Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Completed.", false),
				mode: "act",
				turnState: undefined,
			}),
		).toBeUndefined()
	})

	it("text says 'Done' but phase is error → MUST NOT frame as Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: ERROR_PHASE,
			}),
		).toBeUndefined()
	})
})

// -----------------------------------------------------------------------
// ACT §6 — Resume conservation: completed result must remain correctly framed
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 — resume / second completion", () => {
	it("historical completed result after resume → remains Completed", () => {
		// ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01:
		// the per-message marker (primary authority) keeps the badge
		// even though the resumed task's current turn phase is "streaming".
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done the first thing.", false, true),
				mode: "act",
				turnState: STREAMING_PHASE,
			})?.kind,
		).toBe("completed")
	})

	it("intermediate response after resume → no Completed (phase goes back to streaming)", () => {
		// Marker absent → both primary and legacy paths fail closed.
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Working on it…", false),
				mode: "act",
				turnState: STREAMING_PHASE,
			}),
		).toBeUndefined()
	})

	it("second terminal completion after resume → Completed framing (new final result)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Now done the second thing.", false, true),
				mode: "act",
				turnState: COMPLETED_PHASE,
			})?.kind,
		).toBe("completed")
	})
})

// -----------------------------------------------------------------------
// ACT §3 — output object is frozen + single-tenant (no allocation churn)
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 — output stability", () => {
	it("returns a frozen framing object so consumers can't mutate it", () => {
		const framing = resolveTerminalReportFraming({
			message: sayCompletionResult("Done.", false, true),
			mode: "act",
			turnState: COMPLETED_PHASE,
		})
		expect(Object.isFrozen(framing)).toBe(true)
	})

	it("returns the same singleton for repeated calls (no allocation churn)", () => {
		const a = resolveTerminalReportFraming({
			message: sayCompletionResult("Done.", false, true),
			mode: "act",
			turnState: COMPLETED_PHASE,
		})
		const b = resolveTerminalReportFraming({
			message: askCompletionResult("Done."),
			mode: "act",
			turnState: COMPLETED_PHASE,
		})
		expect(a).toBe(b)
	})
})

// -----------------------------------------------------------------------
// ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01:
// per-message immutable marker is the primary authority. The historical
// completion_result row keeps its badge even when the current task is
// mid-stream / mid-compaction / just-resumed.
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01 — per-message marker is primary authority", () => {
	it("marker=true + phase=streaming → visible Completed (historical row survives phase flip)", () => {
		// The reviewer's two-row discriminator: a historical completed
		// row carries the marker; the resumed task is now mid-stream.
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done the first thing.", false, true),
				mode: "act",
				turnState: STREAMING_PHASE,
			})?.kind,
		).toBe("completed")
	})

	it("marker=true + phase=awaiting_followup → visible Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false, true),
				mode: "act",
				turnState: AWAITING_FOLLOWUP_PHASE,
			})?.kind,
		).toBe("completed")
	})

	it("marker=true + phase=resumable → visible Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false, true),
				mode: "act",
				turnState: RESUMABLE_PHASE,
			})?.kind,
		).toBe("completed")
	})

	it("marker=true + phase=compacting → visible Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false, true),
				mode: "act",
				turnState: COMPACTING_PHASE,
			})?.kind,
		).toBe("completed")
	})

	it("marker=true + undefined turnState → visible Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false, true),
				mode: "act",
				turnState: undefined,
			})?.kind,
		).toBe("completed")
	})

	it("marker=true + plan mode → no Completed (plan-mode sentinel still wins)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false, true),
				mode: "plan",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})
})

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01 — marker is required for say path (no fallback to phase)", () => {
	it("marker absent + phase=completed + say completion_result non-partial → no framing (legacy path is ask-only)", () => {
		// The say path requires the marker; legacy ask fallback does
		// NOT cover say rows. This is the boundary between modern SDK
		// tasks (always stamped) and legacy tasks (always ask).
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", false),
				mode: "act",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})

	it("marker=false (explicit) + phase=completed → no framing (opt-out beats completion)", () => {
		expect(
			resolveTerminalReportFraming({
				message: { ...sayCompletionResult("Done.", false), isAuthoritativelyCompletedResult: false },
				mode: "act",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})

	it("marker=true + partial say completion_result → visible Completed (marker is row identity, partial is content stream)", () => {
		// The marker is monotonic per row; a partial say row stamped
		// at content_start is replaced in place at content_end, so a
		// stamped partial would only be visible transiently. If it does
		// become visible, the marker is still authoritative.
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done.", true, true),
				mode: "act",
				turnState: COMPLETED_PHASE,
			})?.kind,
		).toBe("completed")
	})
})

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01 — legacy ask path still requires phase", () => {
	it("legacy ask + phase=completed + non-empty text → visible Completed", () => {
		expect(
			resolveTerminalReportFraming({
				message: askCompletionResult("Done."),
				mode: "act",
				turnState: COMPLETED_PHASE,
			})?.kind,
		).toBe("completed")
	})

	it("legacy ask + phase=streaming + non-empty text → no Completed (legacy still needs phase=completed)", () => {
		expect(
			resolveTerminalReportFraming({
				message: askCompletionResult("Done."),
				mode: "act",
				turnState: STREAMING_PHASE,
			}),
		).toBeUndefined()
	})

	it("legacy ask + phase=completed + empty text → no Completed (defense in depth)", () => {
		expect(
			resolveTerminalReportFraming({
				message: askCompletionResult(""),
				mode: "act",
				turnState: COMPLETED_PHASE,
			}),
		).toBeUndefined()
	})
})

describe("ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01 — three-row invariant (reviewer's discriminator)", () => {
	// The reviewer's three-row discriminator. A single helper call
	// doesn't render two rows at once, but the per-row tests below
	// together prove that:
	//   - row A (historical, marker=true) keeps the badge
	//   - row B (current streaming follow-up, marker absent) doesn't
	//   - row C (second terminal completion, marker=true) gets a new badge
	// all rendered against the SAME current turnState.phase=streaming.

	const RESUMED_PHASE: TurnState = { phase: "streaming", seq: 99 }

	it("row A: historical completed result with marker + streaming phase → visible", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("All done.", false, true),
				mode: "act",
				turnState: RESUMED_PHASE,
			})?.kind,
		).toBe("completed")
	})

	it("row B: intermediate streaming follow-up → no Completed", () => {
		// Not a say: completion_result, and no marker. Both paths fail closed.
		expect(
			resolveTerminalReportFraming({
				message: textSay("Working on it…"),
				mode: "act",
				turnState: RESUMED_PHASE,
			}),
		).toBeUndefined()
	})

	it("row C: second terminal completion with marker + streaming phase → visible (new final result)", () => {
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Now done.", false, true),
				mode: "act",
				turnState: RESUMED_PHASE,
			})?.kind,
		).toBe("completed")
	})
})

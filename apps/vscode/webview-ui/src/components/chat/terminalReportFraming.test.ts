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

function sayCompletionResult(text: string, partial = false): ClineMessage {
	return {
		ts: 1,
		type: "say",
		say: "completion_result",
		text,
		partial,
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
	it("completed + final say completion_result → visible Completed framing", () => {
		const framing = resolveTerminalReportFraming({
			message: sayCompletionResult("All done.", false),
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
		// The persisted session status drives phase = "completed" for
		// resumed-completed tasks (sdk-task-control-coordinator.ts:269).
		expect(
			resolveTerminalReportFraming({
				message: sayCompletionResult("Done the first thing.", false),
				mode: "act",
				turnState: COMPLETED_PHASE,
			})?.kind,
		).toBe("completed")
	})

	it("intermediate response after resume → no Completed (phase goes back to streaming)", () => {
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
				message: sayCompletionResult("Now done the second thing.", false),
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
			message: sayCompletionResult("Done.", false),
			mode: "act",
			turnState: COMPLETED_PHASE,
		})
		expect(Object.isFrozen(framing)).toBe(true)
	})

	it("returns the same singleton for repeated calls (no allocation churn)", () => {
		const a = resolveTerminalReportFraming({
			message: sayCompletionResult("Done.", false),
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

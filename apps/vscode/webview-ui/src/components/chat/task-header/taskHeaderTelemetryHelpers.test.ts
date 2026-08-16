/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / pure helper tests.
 *
 * THA02 — formatElapsed, THA03 — terminal freeze,
 * THA05..THA12 — state label matrix, plus a few invariants for the
 * elapsed-time resolver.
 */
import type { TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { formatElapsed, resolveElapsedDisplayMs, stateLabel, taskHeaderStateLabel } from "./taskHeaderTelemetryHelpers"

describe("ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / formatElapsed", () => {
	it("formats sub-minute durations as mm:ss", () => {
		expect(formatElapsed(0)).toBe("00:00")
		expect(formatElapsed(43_000)).toBe("00:43")
		expect(formatElapsed(2 * 60_000 + 5_000)).toBe("02:05")
	})

	it("formats sub-hour durations as mm:ss (no hour prefix)", () => {
		expect(formatElapsed(59 * 60_000 + 59_000)).toBe("59:59")
	})

	it("formats sub-day durations as h:mm:ss", () => {
		expect(formatElapsed(60 * 60_000)).toBe("1:00:00")
		expect(formatElapsed(2 * 60 * 60_000 + 5 * 60_000 + 9_000)).toBe("2:05:09")
	})

	it("formats multi-day durations as `d hh:mm`", () => {
		expect(formatElapsed(24 * 60 * 60_000)).toBe("1d 00:00")
		expect(formatElapsed(2 * 24 * 60 * 60_000 + 3 * 60 * 60_000 + 4 * 60_000 + 5_000)).toBe("2d 03:04")
	})

	it("returns 0:00 for negative or non-finite inputs (no NaN leaks)", () => {
		expect(formatElapsed(-1)).toBe("00:00")
		expect(formatElapsed(NaN)).toBe("00:00")
		expect(formatElapsed(Infinity)).toBe("00:00")
	})
})

describe("ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / resolveElapsedDisplayMs", () => {
	it("THA03: freezes at endedAt - startedAt even when now is far in the future", () => {
		const startedAt = 1_700_000_000_000
		const endedAt = startedAt + 90_000
		const now = startedAt + 10 * 60_000
		expect(resolveElapsedDisplayMs(startedAt, endedAt, now)).toBe(90_000)
	})

	it("THA02: ticks when no endedAt is set", () => {
		const startedAt = 1_700_000_000_000
		expect(resolveElapsedDisplayMs(startedAt, undefined, startedAt + 5_000)).toBe(5_000)
	})

	it("ignores invalid endedAt (falls back to live tick)", () => {
		const startedAt = 1_700_000_000_000
		expect(resolveElapsedDisplayMs(startedAt, NaN, startedAt + 5_000)).toBe(5_000)
	})

	it("returns 0 when startedAt is invalid", () => {
		expect(resolveElapsedDisplayMs(NaN, undefined, 1_700_000_000_000)).toBe(0)
	})

	it("THA03: endedAt before startedAt is ignored (freezes not, falls back to live tick)", () => {
		const startedAt = 1_700_000_000_000
		const endedAt = startedAt - 1_000 // bogus
		expect(resolveElapsedDisplayMs(startedAt, endedAt, startedAt + 5_000)).toBe(5_000)
	})
})

describe("ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / stateLabel", () => {
	// CUI05..CUI12 mirroring the parent ACT vocabulary.
	it("THA05: idle → Idle (non-live)", () => {
		expect(stateLabel("idle")).toEqual({ label: "Idle", glyph: "○", live: false })
	})
	it("THA06: streaming → Working (live)", () => {
		expect(stateLabel("streaming")).toEqual({ label: "Working", glyph: "●", live: true })
	})
	it("THA07: awaiting_approval → Approval (live)", () => {
		expect(stateLabel("awaiting_approval")).toEqual({ label: "Approval", glyph: "?", live: true })
	})
	it("THA08: awaiting_followup → Waiting (non-live)", () => {
		expect(stateLabel("awaiting_followup")).toEqual({ label: "Waiting", glyph: "…", live: false })
	})
	it("THA09: completed → Complete (non-live)", () => {
		expect(stateLabel("completed")).toEqual({ label: "Complete", glyph: "✓", live: false })
	})
	it("THA10: error → Error (non-live)", () => {
		expect(stateLabel("error")).toEqual({ label: "Error", glyph: "!", live: false })
	})
	it("THA11: resumable → Paused (non-live)", () => {
		expect(stateLabel("resumable")).toEqual({ label: "Paused", glyph: "↻", live: false })
	})
	it("THA12: undefined → Unknown (non-live)", () => {
		expect(stateLabel(undefined)).toEqual({ label: "Unknown", glyph: "?", live: false })
	})
})

describe("ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / taskHeaderStateLabel", () => {
	it("projects from a TurnState", () => {
		const ts: TurnState = { phase: "streaming", seq: 1 }
		expect(taskHeaderStateLabel(ts)).toEqual({ label: "Working", glyph: "●", live: true })
	})
	it("returns Unknown when TurnState is undefined (no chat-tail fallback)", () => {
		expect(taskHeaderStateLabel(undefined)).toEqual({ label: "Unknown", glyph: "?", live: false })
	})
})

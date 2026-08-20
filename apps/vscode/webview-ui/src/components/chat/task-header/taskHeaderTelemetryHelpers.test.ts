/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / pure helper tests.
 *
 * THA02 — formatElapsed, THA03 — terminal freeze,
 * THA05..THA12 — state label matrix, plus a few invariants for the
 * elapsed-time resolver.
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
 * THA08 inverted — `awaiting_followup` is now LIVE (same task
 * continues when user replies). Terminal-freeze tests cover the
 * error/resumable/completed set explicitly.
 */
import type { TaskHeaderPresentationProjection, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	formatElapsed,
	resolveElapsedDisplayMs,
	stateLabel,
	taskHeaderPresentationStateLabel,
	taskHeaderStateLabel,
} from "./taskHeaderTelemetryHelpers"

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

describe("ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01 / resolveElapsedDisplayMs terminal-freeze", () => {
	it("THA03: freezes at endedAt - startedAt even when now is far in the future", () => {
		const startedAt = 1_700_000_000_000
		const endedAt = startedAt + 90_000
		const now = startedAt + 10 * 60_000
		expect(resolveElapsedDisplayMs(startedAt, endedAt, now)).toBe(90_000)
	})

	it("THA28: a remount one hour after terminal still shows the original elapsed", () => {
		const startedAt = 1_700_000_000_000
		const endedAt = startedAt + 90_000
		const remountAt = endedAt + 3_600_000
		expect(resolveElapsedDisplayMs(startedAt, endedAt, remountAt)).toBe(90_000)
	})

	it("THA02: ticks when no endedAt is set", () => {
		const startedAt = 1_700_000_000_000
		expect(resolveElapsedDisplayMs(startedAt, undefined, startedAt + 5_000)).toBe(5_000)
	})

	it("THA28b: awaiting_followup keeps ticking (no endedAt on the wire)", () => {
		const startedAt = 1_700_000_000_000
		expect(resolveElapsedDisplayMs(startedAt, undefined, startedAt + 5_000)).toBe(5_000)
		expect(resolveElapsedDisplayMs(startedAt, undefined, startedAt + 60_000)).toBe(60_000)
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
	it("THA08 (CORRECTION01): awaiting_followup → Waiting (LIVE — same task continues)", () => {
		expect(stateLabel("awaiting_followup")).toEqual({ label: "Waiting", glyph: "…", live: true })
	})
	it("THA09: completed → Complete (non-live, terminal)", () => {
		expect(stateLabel("completed")).toEqual({ label: "Complete", glyph: "✓", live: false })
	})
	it("THA10: error → Error (non-live, terminal)", () => {
		expect(stateLabel("error")).toEqual({ label: "Error", glyph: "!", live: false })
	})
	it("THA11: resumable → Paused (non-live, terminal)", () => {
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

// ============================================================================
// ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / helper tests
// ============================================================================
//
// The migration ACT's consumer-side witness matrix. The new
// `taskHeaderPresentationStateLabel` entry point reads the canonical
// `taskHeaderPresentation` projection (when present) and falls back
// to the legacy `turnState.phase` derivation only when the projection
// is absent (Hub/Remote / pre-observation absence).
//
// These tests verify the helper-level contract. The component-level
// proof (TaskHeader renders the migrated label) is in the SDK
// selector suite `task-state-shadow-task-header-presentation.thcp01.test.ts`
// and the consumer-level integration tests added next to this file.

describe("ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / taskHeaderPresentationStateLabel", () => {
	// Build a small projection object helper
	const projection = (
		phase: TaskHeaderPresentationProjection["phase"],
		source: TaskHeaderPresentationProjection["source"] = "shadow",
		seq = 1,
	): TaskHeaderPresentationProjection => ({ phase, source, seq })

	it("THCP01 (helper): when projection says awaiting_followup, label is Waiting (not Working from stale streaming)", () => {
		// Truthful divergence: legacy turnState is `streaming`
		// (Working), but the canonical projection says
		// `awaiting_followup`. The helper must follow the projection.
		const st = { phase: "streaming" as const, seq: 1 }
		const p = projection("awaiting_followup", "shadow", 5)
		// We cannot import taskHeaderPresentationStateLabel at module
		// top because the existing test file imports use a different
		// path; the import is added below.
		expect(taskHeaderPresentationStateLabel(p, st)).toEqual({ label: "Waiting", glyph: "\u2026", live: true })
	})

	it("THCP02 (helper): when projection says compacting (host source), label is Compacting", () => {
		const st = { phase: "compacting" as const, seq: 7 }
		const p = projection("compacting", "host", 7)
		expect(taskHeaderPresentationStateLabel(p, st)).toEqual({ label: "Compacting", glyph: "\u2304", live: true })
	})

	it("THCP04 (helper): when projection says error, label is Error (not Working from stale streaming)", () => {
		const st = { phase: "streaming" as const, seq: 1 }
		const p = projection("error", "shadow", 9)
		expect(taskHeaderPresentationStateLabel(p, st)).toEqual({ label: "Error", glyph: "!", live: false })
	})

	it("THCP05 (helper): when projection is undefined, falls back to legacy turnState.phase", () => {
		// Hub/Remote host: no projection. The helper must produce the
		// exact same legacy projection as `taskHeaderStateLabel`.
		const st = { phase: "resumable" as const, seq: 4 }
		expect(taskHeaderPresentationStateLabel(undefined, st)).toEqual({ label: "Paused", glyph: "\u21bb", live: false })
	})

	it("THCP05b (helper): both undefined returns Unknown (no chat-tail fallback)", () => {
		expect(taskHeaderPresentationStateLabel(undefined, undefined)).toEqual({ label: "Unknown", glyph: "?", live: false })
	})

	it("THCP07 (helper): shadow streaming beats arbitrary legacy → Working/live", () => {
		// Even if the legacy tracker is mid-transition (e.g. idle),
		// the shadow's streaming must win once observed.
		const st = { phase: "idle" as const, seq: 1 }
		const p = projection("streaming", "shadow", 17)
		expect(taskHeaderPresentationStateLabel(p, st)).toEqual({ label: "Working", glyph: "\u25cf", live: true })
	})

	it("THCP08 (helper): shadow completed → Complete/non-live", () => {
		const st = { phase: "streaming" as const, seq: 1 }
		const p = projection("completed", "shadow", 21)
		expect(taskHeaderPresentationStateLabel(p, st)).toEqual({ label: "Complete", glyph: "\u2713", live: false })
	})
})

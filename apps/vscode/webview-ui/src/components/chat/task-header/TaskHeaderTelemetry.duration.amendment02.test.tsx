/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02)
 *
 * The webview-side witnesses for the HEADER-FRESHNESS repair (W4).
 *
 * WHAT IS UNDER TEST
 *
 *   The displayed ACTIVE / WAITING / UNKNOWN split must NOT silently jump
 *   from an extrapolated duration back to the host's original snapshot
 *   when the freshness bound expires.
 *
 *   The pre-repair projection STOPPED at the bound and returned the
 *   host's ORIGINAL snapshot verbatim, so the displayed wait counter ran
 *   up and then snapped back to zero.
 *
 *   The repair makes the projection MONOTONE across the boundary and
 *   marks the expired value as explicitly ESTIMATED.
 *
 * EVIDENCE CLASSIFICATION
 *
 *   SYNTHETIC_REAL      - the REAL pure projection helper driven by a
 *                        synthetic chronology.
 *   REAL_PRODUCTION_SEAM - the REAL React component rendering the REAL
 *                        helper with a REAL host snapshot and CONTROLLED
 *                        time advancement.
 */

import type { TaskDurationSnapshot } from "@shared/ExtensionMessage"
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"
import { projectDurationForward } from "./taskHeaderTelemetryHelpers"

const BOUND = 5 * 60_000
const PUBLISHED_AT = 1_700_000_000_000

function snapshot(overrides: Partial<TaskDurationSnapshot> = {}): TaskDurationSnapshot {
	return {
		taskId: "task-webview-am02",
		elapsedMs: 10_000,
		activeMs: 10_000,
		waitingMs: 0,
		unknownMs: 0,
		phase: "active",
		coverage: "complete",
		...overrides,
	}
}

/**
 * Parse the rendered duration text back into milliseconds so the witness
 * can compare two rendered magnitudes numerically.
 *
 * The rendered form is the compact "Xm Ys" / "Ys" form produced by
 * `formatDuration`.
 */
function parseDurationText(text: string): number {
	const cleaned = text.replace(/[^0-9hms ]/g, "").trim()
	const minutes = /(\d+)m/.exec(cleaned)
	const seconds = /(\d+)s/.exec(cleaned)
	const hours = /(\d+)h/.exec(cleaned)
	return (
		(hours ? Number(hours[1]) * 3_600_000 : 0) +
		(minutes ? Number(minutes[1]) * 60_000 : 0) +
		(seconds ? Number(seconds[1]) * 1_000 : 0)
	)
}

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02) / W4 header freshness", () => {
	// -------------------------------------------------------------------
	// The FRESHNESS BOUNDARY — the projection must not jump backwards.
	// -------------------------------------------------------------------
	it("W4-BOUNDARY-1 [SYNTHETIC_REAL]: the projected value never jumps backwards at the freshness boundary", () => {
		const base = snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000 })

		// One millisecond BEFORE the bound.
		const before = projectDurationForward(base, PUBLISHED_AT + BOUND - 1, PUBLISHED_AT, BOUND)
		expect(before?.stale).toBe(false)
		expect(before?.snapshot.elapsedMs).toBe(10_000 + BOUND - 1)

		// EXACTLY at the bound.
		const at = projectDurationForward(base, PUBLISHED_AT + BOUND, PUBLISHED_AT, BOUND)
		expect(at?.snapshot.elapsedMs).toBe(10_000 + BOUND)
		expect(at?.stale).toBe(false)

		// One millisecond AFTER the bound: the value does NOT go back to
		// the host's original snapshot, and it is marked STALE.
		const after = projectDurationForward(base, PUBLISHED_AT + BOUND + 1, PUBLISHED_AT, BOUND)
		expect(after?.snapshot.elapsedMs).toBe(10_000 + BOUND)
		expect(after?.stale).toBe(true)

		// Far beyond the bound: STILL not the original snapshot.
		const far = projectDurationForward(base, PUBLISHED_AT + 60 * BOUND, PUBLISHED_AT, BOUND)
		expect(far?.snapshot.elapsedMs).toBe(10_000 + BOUND)
		expect(far?.stale).toBe(true)
	})

	it("W4-BOUNDARY-2 [SYNTHETIC_REAL]: the stale projection preserves the host's phase, reason and coverage", () => {
		const base = snapshot({
			phase: "waiting",
			elapsedMs: 10_000,
			activeMs: 0,
			waitingMs: 10_000,
			waitingReason: "USER_INPUT",
			coverage: "partial",
		})
		const stale = projectDurationForward(base, PUBLISHED_AT + 10 * BOUND, PUBLISHED_AT, BOUND)
		expect(stale?.snapshot.phase).toBe("waiting")
		expect(stale?.snapshot.waitingReason).toBe("USER_INPUT")
		expect(stale?.snapshot.coverage).toBe("partial")
		expect(stale?.stale).toBe(true)
	})

	it("W4-BOUNDARY-3 [SYNTHETIC_REAL]: a TERMINAL snapshot is frozen and never stale", () => {
		const base = snapshot({ phase: "terminal", elapsedMs: 10_000, activeMs: 10_000 })
		const projected = projectDurationForward(base, PUBLISHED_AT + 60 * BOUND, PUBLISHED_AT, BOUND)
		expect(projected?.snapshot.elapsedMs).toBe(10_000)
		expect(projected?.snapshot.activeMs).toBe(10_000)
		expect(projected?.stale).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// W4-COMPONENT — the REAL component with CONTROLLED time advancement,
// including a quiet gate and the freshness expiry.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02) / W4 component freshness", () => {
	let currentTime = PUBLISHED_AT

	beforeEach(() => {
		currentTime = PUBLISHED_AT
		vi.useFakeTimers()
		vi.setSystemTime(currentTime)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("W4-COMPONENT-1 [REAL_PRODUCTION_SEAM]: the displayed split progresses through a quiet gate and does NOT snap back at the expiry", async () => {
		const { rerender } = render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)

		// The host's snapshot is published; the anchor is set.
		await act(async () => {
			vi.advanceTimersByTime(0)
		})

		// A QUIET GATE: no new host snapshot arrives. The component
		// re-renders on its presentation tick only.
		currentTime = PUBLISHED_AT + 60_000
		await act(async () => {
			vi.setSystemTime(currentTime)
			vi.advanceTimersByTime(1_000)
		})

		const duringGate = screen.getByTestId("task-header-duration-waiting").textContent ?? ""
		expect(duringGate).toContain("1m")
		// No stale marker yet: the snapshot is inside the bound.
		expect(screen.queryByTestId("task-header-duration-estimated")).toBeNull()

		// The FRESHNESS EXPIRY: the snapshot ages past the bound.
		currentTime = PUBLISHED_AT + BOUND + 30_000
		await act(async () => {
			vi.setSystemTime(currentTime)
			vi.advanceTimersByTime(1_000)
		})

		// The value is explicitly marked as estimated.
		expect(screen.getByTestId("task-header-duration-estimated")).toBeDefined()

		// AND it did NOT snap back to the host's original snapshot. The
		// clamped projection is `10s snapshot + 5m bound` = "5m 10s";
		// the pre-repair behaviour would have shown the host's original
		// "10s".
		const afterExpiry = screen.getByTestId("task-header-duration-waiting").textContent ?? ""
		expect(afterExpiry).toContain("5m 10s")
		// The value never went BACKWARDS across the freshness boundary:
		// the clamped magnitude ("5m 10s" = 310 000 ms) is at least the
		// value shown during the quiet gate ("1m 11s" = 71 000 ms).
		expect(parseDurationText(afterExpiry)).toBeGreaterThanOrEqual(parseDurationText(duringGate))

		// A fresh host publication replaces the projection entirely and
		// clears the stale marker.
		rerender(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "waiting", elapsedMs: 400_000, activeMs: 0, waitingMs: 400_000 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(1_000)
		})
		expect(screen.queryByTestId("task-header-duration-estimated")).toBeNull()
	})

	it("W4-COMPONENT-2 [REAL_PRODUCTION_SEAM]: a NEW snapshot never uses an OLDER snapshot's anchor", async () => {
		const { rerender } = render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(0)
		})

		// A NEW snapshot arrives (a different elapsed value => a
		// different snapshot identity => a NEW anchor).
		currentTime = PUBLISHED_AT + 30_000
		await act(async () => {
			vi.setSystemTime(currentTime)
		})
		rerender(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "waiting", elapsedMs: 40_000, activeMs: 0, waitingMs: 40_000 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(1_000)
		})

		// The NEW snapshot is anchored at ITS OWN publication time, so
		// the projection is the new snapshot plus (now - new anchor),
		// NOT the new snapshot plus (now - the OLD anchor).
		const shown = screen.getByTestId("task-header-duration-waiting").textContent ?? ""
		// 40 000 + 1 000 = 41 000 -> "41s". With the OLD anchor it would
		// have been 40 000 + 31 000 = 71 000 -> "1m 11s".
		expect(shown).toContain("41s")
		expect(shown).not.toContain("1m")
	})

	it("W4-COMPONENT-3 [REAL_PRODUCTION_SEAM]: a TERMINAL snapshot stays frozen and is never marked estimated", async () => {
		render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "terminal", elapsedMs: 10_000, activeMs: 10_000 }),
				}}
				turnState={{ phase: "completed", seq: 1 }}
			/>,
		)
		currentTime = PUBLISHED_AT + 60 * BOUND
		await act(async () => {
			vi.setSystemTime(currentTime)
			vi.advanceTimersByTime(1_000)
		})

		expect(screen.getByTestId("task-header-duration-active").textContent).toContain("10s")
		expect(screen.queryByTestId("task-header-duration-estimated")).toBeNull()
	})
})

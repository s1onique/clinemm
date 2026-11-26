/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01)
 *
 * The webview-side witnesses for the header-freshness repair (W4 / F6).
 *
 * WHAT IS UNDER TEST
 *
 *   The displayed ACTIVE / WAITING / UNKNOWN split must PROGRESS while
 *   the task sits at a human-input gate with NO unrelated message
 *   publications. The progress must be a PRESENTATION-ONLY forward
 *   projection of the HOST's snapshot:
 *
 *   - the webview owns no accumulated duration;
 *   - only the bucket the HOST says is open is projected;
 *   - a terminal phase is frozen;
 *   - the projection is BOUNDED (a stale snapshot is never
 *     extrapolated without limit);
 *   - the phase, the waiting reason and the coverage are the HOST's
 *     authority and are never changed by the projection.
 *
 * EVIDENCE CLASSIFICATION
 *
 *   SYNTHETIC_REAL - the REAL pure projection helper driven by a
 *                     synthetic chronology.
 *   REAL_PRODUCTION_SEAM - the REAL React component rendering the REAL
 *                     helper with a REAL host snapshot.
 */

import type { TaskDurationSnapshot } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"
import { projectDurationForward } from "./taskHeaderTelemetryHelpers"

const BOUND = 5 * 60_000

function snapshot(overrides: Partial<TaskDurationSnapshot> = {}): TaskDurationSnapshot {
	return {
		taskId: "task-webview",
		elapsedMs: 10_000,
		activeMs: 10_000,
		waitingMs: 0,
		unknownMs: 0,
		phase: "active",
		coverage: "complete",
		...overrides,
	}
}

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / W4 header freshness", () => {
	it("W4-PROJ-1: the WAITING bucket projects forward while the host says the task is waiting", () => {
		const base = snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000 })
		const projected = projectDurationForward(base, 1_700_000_030_000, 1_700_000_000_000, BOUND)
		expect(projected?.snapshot?.waitingMs).toBe(40_000)
		expect(projected?.snapshot?.activeMs).toBe(0)
		expect(projected?.snapshot?.elapsedMs).toBe(40_000)
	})

	it("W4-PROJ-2: the ACTIVE bucket projects forward while the host says the task is active", () => {
		const base = snapshot({ phase: "active" })
		const projected = projectDurationForward(base, 1_700_000_005_000, 1_700_000_000_000, BOUND)
		expect(projected?.snapshot?.activeMs).toBe(15_000)
		expect(projected?.snapshot?.waitingMs).toBe(0)
	})

	it("W4-PROJ-3: a TERMINAL phase is FROZEN - nothing is projected", () => {
		const base = snapshot({ phase: "terminal", elapsedMs: 10_000, activeMs: 10_000 })
		const projected = projectDurationForward(base, 1_700_000_600_000, 1_700_000_000_000, BOUND)
		expect(projected?.snapshot?.elapsedMs).toBe(10_000)
		expect(projected?.snapshot?.activeMs).toBe(10_000)
	})

	it("W4-PROJ-4: a snapshot older than the BOUND is NOT extrapolated", () => {
		const base = snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000 })
		// One hour old - beyond the 5-minute bound.
		//
		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 /
		// W4): the projection is CLAMPED to the bound, so the displayed
		// value never jumps BACKWARDS at the freshness boundary, and the
		// result is explicitly marked STALE.
		const projected = projectDurationForward(base, 1_700_003_600_000, 1_700_000_000_000, BOUND)
		expect(projected?.snapshot?.waitingMs).toBe(10_000 + BOUND)
		expect(projected?.snapshot?.elapsedMs).toBe(10_000 + BOUND)
		expect(projected?.stale).toBe(true)
	})

	it("W4-PROJ-5: the projection NEVER changes the host's phase, reason or coverage", () => {
		const base = snapshot({
			phase: "waiting",
			elapsedMs: 10_000,
			activeMs: 0,
			waitingMs: 10_000,
			waitingReason: "USER_INPUT",
			coverage: "partial",
		})
		const projected = projectDurationForward(base, 1_700_000_030_000, 1_700_000_000_000, BOUND)
		expect(projected?.snapshot?.phase).toBe("waiting")
		expect(projected?.snapshot?.waitingReason).toBe("USER_INPUT")
		expect(projected?.snapshot?.coverage).toBe("partial")
	})

	it("W4-PROJ-6: an ABSENT snapshot stays absent (a legacy task is never given a fabricated zero)", () => {
		expect(projectDurationForward(undefined, 1_700_000_030_000, 1_700_000_000_000, BOUND)).toBeUndefined()
	})

	it("W4-PROJ-7: a snapshot from the FUTURE is not projected", () => {
		const base = snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000 })
		const projected = projectDurationForward(base, 1_699_999_000_000, 1_700_000_000_000, BOUND)
		expect(projected?.snapshot?.waitingMs).toBe(10_000)
	})

	it("W4-RENDER: the component renders the host's split and the unavailable placeholder", () => {
		const { unmount } = render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: 1_700_000_000_000,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot(),
				}}
				turnState={{ phase: "streaming", seq: 1 }}
			/>,
		)
		expect(screen.getByTestId("task-header-duration")).toBeDefined()
		expect(screen.getByTestId("task-header-duration-active").textContent).toContain("10s")
		unmount()

		// A legacy task (no accounting) renders the unavailable marker.
		render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{ startedAt: 1_700_000_000_000, toolCalls: 0, recoveryBudgetFailures: 0 }}
				turnState={{ phase: "streaming", seq: 1 }}
			/>,
		)
		expect(screen.getByTestId("task-header-duration-unavailable")).toBeDefined()
	})
})

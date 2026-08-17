/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / TaskHeaderTelemetry component tests.
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02:
 *   - `recoveryInterventions` renamed to `recoveryBudgetFailures`
 *     (CORRECTION01), and the aria-label corrected from
 *     "Recoverable tool failures observed" to "Recovery budget
 *     failures" (CORRECTION02 — the underlying counter is the
 *     bounded-recovery control-plane metric, not all recoverable
 *     tool failures).
 *   - Tooltip for tool count corrected.
 */
import type { TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"

function ts(phase: TurnState["phase"], seq = 1): TurnState {
	return { phase, seq }
}

function telemetry(partial: Partial<TaskHeaderTelemetryStrip> = {}): TaskHeaderTelemetryStrip {
	return {
		startedAt: 1_700_000_000_000,
		toolCalls: 0,
		recoveryBudgetFailures: 0,
		...partial,
	}
}

describe("ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / TaskHeaderTelemetry", () => {
	it("THA01: renders the canonical placeholder when telemetry is undefined", () => {
		render(<TaskHeaderTelemetry telemetry={undefined} turnState={undefined} />)
		expect(screen.getByTestId("task-header-telemetry-empty")).toBeTruthy()
		expect(screen.queryByTestId("task-header-telemetry")).toBeNull()
	})

	it("THA02: renders elapsed + state + tool count when telemetry is present", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ startedAt: 1_700_000_000_000, toolCalls: 7 })}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByTestId("task-header-telemetry")).toBeTruthy()
		expect(screen.getByTestId("task-header-tool-count").textContent).toContain("7")
		expect(screen.getByTestId("task-header-state").textContent).toContain("Working")
		expect(screen.getByTestId("task-header-elapsed")).toBeTruthy()
	})

	it("THA19: hides recovery at zero", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryBudgetFailures: 0 })} turnState={ts("idle")} />)
		expect(screen.queryByTestId("task-header-recovery-count")).toBeNull()
	})

	it("renders recovery when recoveryBudgetFailures > 0", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryBudgetFailures: 2 })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-recovery-count").textContent).toContain("2")
	})

	it("THA05..TH12: state label reflects canonical turnState phase", () => {
		for (const [phase, expected] of [
			["idle", "Idle"],
			["streaming", "Working"],
			["awaiting_approval", "Approval"],
			["awaiting_followup", "Waiting"],
			["completed", "Complete"],
			["error", "Error"],
			["resumable", "Paused"],
		] as const) {
			const { unmount } = render(<TaskHeaderTelemetry telemetry={telemetry()} turnState={ts(phase)} />)
			expect(screen.getByTestId("task-header-state").textContent).toContain(expected)
			unmount()
		}
	})

	it("M2 killer: turnState is the ONLY source of the state label — undefined turnState means 'Unknown'", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry()} turnState={undefined} />)
		expect(screen.getByTestId("task-header-state").textContent).toContain("Unknown")
	})

	it("M3 killer: tool count comes from canonical telemetry.toolCalls, NOT from messages", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ toolCalls: 5 })} turnState={ts("idle")} />)
		expect(screen.getByTestId("task-header-tool-count").textContent).toContain("5")
	})

	it("M4 killer: recovery count reflects the canonical counter", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryBudgetFailures: 7 })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-recovery-count").textContent).toContain("7")
	})

	it("THA03 + THA28: endedAt freezes the display — 90 seconds stays 90 seconds even under streaming", () => {
		const startedAt = 1_700_000_000_000
		const endedAt = startedAt + 90_000
		render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt, endedAt })} turnState={ts("streaming")} />)
		const elapsed = screen.getByTestId("task-header-elapsed").textContent ?? ""
		expect(elapsed).toContain("01:30")
		expect(elapsed).not.toMatch(/10:|0:10/)
	})

	it("renders accessible aria-labels for each counter (CORRECTION02: recovery uses 'Recovery budget failures')", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ toolCalls: 3, recoveryBudgetFailures: 1 })}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByLabelText(/Elapsed task time/i)).toBeTruthy()
		expect(screen.getByLabelText(/Task state: Working/i)).toBeTruthy()
		expect(screen.getByLabelText(/Tool calls: 3/i)).toBeTruthy()
		expect(screen.getByLabelText(/Recovery budget failures: 1/i)).toBeTruthy()
	})

	it("M5 killer: same task identity across two renders preserves elapsed from the same epoch", () => {
		const startedAt = 1_700_000_000_000
		const first = render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
		const firstText = screen.getByTestId("task-header-elapsed").textContent ?? ""
		first.unmount()
		render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-elapsed").textContent).toBe(firstText)
	})

	it("THA28b: awaiting_followup keeps the timer live (no endedAt from the host)", () => {
		const startedAt = 1_700_000_000_000
		render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("awaiting_followup")} />)
		expect(screen.getByTestId("task-header-state").textContent).toContain("Waiting")
		expect(screen.getByTestId("task-header-elapsed")).toBeTruthy()
	})

	// =========================================================================
	// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION01
	//
	// When the runtime phase is "live" (streaming / awaiting_approval /
	// awaiting_followup), the elapsed display must visibly advance at
	// 1-second granularity. Without an active interval the display froze
	// at e.g. "00:00" until the next state post — which the user reported
	// as "the clock is dead". The fix upstream: ensure the canonical
	// phase reaches the webview as `streaming` (see CORRECTION01 in
	// `sdk-task-start-coordinator.test.ts`). These tests pin the
	// half the user observes: given `state.live === true`, the
	// component schedules `setInterval(1000)` and repaints.
	// =========================================================================

	describe("elapsed clock tick", () => {
		beforeEach(() => {
			vi.useFakeTimers()
		})
		afterEach(() => {
			vi.useRealTimers()
		})

		it("CLOCK-1: at T0 the elapsed display is 00:00 when the phase is streaming", () => {
			const startedAt = 1_700_000_000_000
			vi.setSystemTime(startedAt)
			render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("00:00")
		})

		it("CLOCK-2: at T0+1500ms the elapsed display advances to 00:01 (sub-second tick)", () => {
			const startedAt = 1_700_000_000_000
			vi.setSystemTime(startedAt)
			render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
			act(() => {
				vi.advanceTimersByTime(1_500)
			})
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("00:01")
		})

		it("CLOCK-3: at T0+6500ms the elapsed display is 00:06", () => {
			const startedAt = 1_700_000_000_000
			vi.setSystemTime(startedAt)
			render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
			act(() => {
				vi.advanceTimersByTime(6_500)
			})
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("00:06")
		})

		it("CLOCK-4: at T0+65000ms the elapsed display crosses the minute boundary to 01:05", () => {
			const startedAt = 1_700_000_000_000
			vi.setSystemTime(startedAt)
			render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
			act(() => {
				vi.advanceTimersByTime(65_000)
			})
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("01:05")
		})

		it("CLOCK-5: when phase is idle, no interval is scheduled and the elapsed stays at the snapshot", () => {
			const startedAt = 1_700_000_000_000
			vi.setSystemTime(startedAt + 30_000)
			render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("idle")} />)
			act(() => {
				vi.advanceTimersByTime(5_000)
			})
			// idle phase → no interval → elapsed stays at snapshot value (30s).
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("00:30")
		})

		it("CLOCK-6: transitioning from idle → streaming schedules the interval and advances the display", () => {
			const startedAt = 1_700_000_000_000
			vi.setSystemTime(startedAt + 5_000)
			const { rerender } = render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("idle")} />)
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("00:05")

			act(() => {
				vi.advanceTimersByTime(60_000)
			})
			// Still idle — display is frozen at the render snapshot (no interval).
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("00:05")

			rerender(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
			act(() => {
				vi.advanceTimersByTime(2_000)
			})
			// Phase is now live → interval ticks → elapsed reads the CURRENT
			// wall-clock delta from `startedAt`: startedAt + 60s + 2s = 01:07,
			// not 00:07. The interval picks up where the wall-clock is.
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("01:07")
		})

		it("CLOCK-7 (M4 killer): when endedAt is set, the clock does NOT advance even on a live phase", () => {
			const startedAt = 1_700_000_000_000
			const endedAt = startedAt + 30_000
			vi.setSystemTime(startedAt + 60_000) // pretend 30s more wall-time has passed
			render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt, endedAt })} turnState={ts("streaming")} />)
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("00:30")
			act(() => {
				vi.advanceTimersByTime(10_000)
			})
			// endedAt freezes the display; the live phase does NOT override it.
			expect(screen.getByTestId("task-header-elapsed").textContent ?? "").toContain("00:30")
		})
	})
})

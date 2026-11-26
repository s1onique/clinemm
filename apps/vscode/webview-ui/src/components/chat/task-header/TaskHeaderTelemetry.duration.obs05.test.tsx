/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01
 *
 * Webview rendering tests for the ACTIVE / WAITING / UNKNOWN duration
 * split in the Task Header.
 *
 * Invariants pinned here:
 *   - the split renders the HOST's authoritative numbers verbatim — the
 *     webview never adds to them;
 *   - active and waiting remain distinguishable;
 *   - the current waiting reason is visible;
 *   - partial coverage is visibly identified;
 *   - known unknown time is displayed separately;
 *   - a legacy task (no accounting) renders UNAVAILABLE, never a
 *     fabricated zero;
 *   - the compact layout stays readable.
 */
import type { TaskDurationSnapshot, TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"
import { durationDisplayProjection, formatDuration } from "./taskHeaderTelemetryHelpers"

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

function duration(partial: Partial<TaskDurationSnapshot> = {}): TaskDurationSnapshot {
	return {
		taskId: "task-obs05",
		elapsedMs: 0,
		activeMs: 0,
		waitingMs: 0,
		unknownMs: 0,
		phase: "active",
		coverage: "complete",
		...partial,
	}
}

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 / TaskHeaderTelemetry duration", () => {
	it("OBS05UI-01: renders the elapsed / active / waiting split from the host snapshot", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					duration: duration({
						elapsedMs: 19_260_000,
						activeMs: 6_120_000,
						waitingMs: 13_140_000,
					}),
				})}
				turnState={ts("streaming")}
			/>,
		)
		const strip = screen.getByTestId("task-header-duration")
		expect(strip).toBeTruthy()
		expect(screen.getByTestId("task-header-duration-active").textContent).toContain("1h 42m")
		expect(screen.getByTestId("task-header-duration-waiting").textContent).toContain("3h 39m")
		expect(strip.textContent).toContain("5h 21m")
	})

	it("OBS05UI-02: a legacy task without accounting renders UNAVAILABLE, never a fabricated zero", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ toolCalls: 4 })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-duration-unavailable")).toBeTruthy()
		expect(screen.queryByTestId("task-header-duration")).toBeNull()
		// The V1 elapsed display is unaffected.
		expect(screen.getByTestId("task-header-elapsed")).toBeTruthy()
	})

	it("OBS05UI-03: the current waiting reason is visible", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					duration: duration({
						elapsedMs: 30_000,
						activeMs: 10_000,
						waitingMs: 20_000,
						phase: "waiting",
						waitingReason: "TOOL_APPROVAL",
					}),
				})}
				turnState={ts("awaiting_approval")}
			/>,
		)
		expect(screen.getByTestId("task-header-duration-waiting-reason").textContent).toContain("tool approval")
	})

	it("OBS05UI-04: partial coverage is visibly identified", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					duration: duration({
						elapsedMs: 10_000,
						activeMs: 10_000,
						coverage: "partial",
					}),
				})}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByTestId("task-header-duration-partial")).toBeTruthy()
	})

	it("OBS05UI-05: known unknown time is displayed separately", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					duration: duration({
						elapsedMs: 15_000,
						activeMs: 10_000,
						unknownMs: 5_000,
						coverage: "partial",
					}),
				})}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByTestId("task-header-duration-unknown").textContent).toContain("5s")
	})

	it("OBS05UI-06: the webview never adds to the host's numbers", () => {
		// The projection is a pure mapping: two renders of the SAME
		// snapshot produce the SAME text — the webview does not
		// accumulate anything between renders.
		const snap = duration({ elapsedMs: 60_000, activeMs: 30_000, waitingMs: 30_000 })
		const first = durationDisplayProjection(snap)
		const second = durationDisplayProjection(snap)
		expect(first?.elapsedText).toBe(second?.elapsedText)
		expect(first?.activeText).toBe(second?.activeText)
		expect(first?.waitingText).toBe(second?.waitingText)
		expect(first?.elapsedText).toBe("1m 0s")
	})

	it("OBS05UI-07: the format helper is deterministic and never emits NaN", () => {
		expect(formatDuration(0)).toBe("0s")
		expect(formatDuration(-5)).toBe("0s")
		expect(formatDuration(Number.NaN)).toBe("0s")
		expect(formatDuration(45_000)).toBe("45s")
		expect(formatDuration(750_000)).toBe("12m 30s")
		expect(formatDuration(19_260_000)).toBe("5h 21m")
	})

	it("OBS05UI-08: a terminal task renders frozen totals", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					duration: duration({
						elapsedMs: 90_000,
						activeMs: 60_000,
						waitingMs: 30_000,
						phase: "terminal",
					}),
				})}
				turnState={ts("completed")}
			/>,
		)
		expect(screen.getByTestId("task-header-duration-active").textContent).toContain("1m 0s")
		expect(screen.getByTestId("task-header-duration-waiting").textContent).toContain("30s")
	})
})

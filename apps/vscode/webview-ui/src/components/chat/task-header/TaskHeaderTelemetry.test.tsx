/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / TaskHeaderTelemetry component tests.
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
 *   - `recoveryInterventions` renamed to `recoveryFailures`.
 *   - aria-label for recovery now reads "Recoverable tool failures observed".
 *   - Tooltip for tool count corrected.
 */
import type { TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"

function ts(phase: TurnState["phase"], seq = 1): TurnState {
	return { phase, seq }
}

function telemetry(partial: Partial<TaskHeaderTelemetryStrip> = {}): TaskHeaderTelemetryStrip {
	return {
		startedAt: 1_700_000_000_000,
		toolCalls: 0,
		recoveryFailures: 0,
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
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryFailures: 0 })} turnState={ts("idle")} />)
		expect(screen.queryByTestId("task-header-recovery-count")).toBeNull()
	})

	it("renders recovery when recoveryFailures > 0", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryFailures: 2 })} turnState={ts("streaming")} />)
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
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryFailures: 7 })} turnState={ts("streaming")} />)
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

	it("renders accessible aria-labels for each counter (CORRECTION01)", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ toolCalls: 3, recoveryFailures: 1 })} turnState={ts("streaming")} />)
		expect(screen.getByLabelText(/Elapsed task time/i)).toBeTruthy()
		expect(screen.getByLabelText(/Task state: Working/i)).toBeTruthy()
		expect(screen.getByLabelText(/Tool calls: 3/i)).toBeTruthy()
		expect(screen.getByLabelText(/Recoverable tool failures observed: 1/i)).toBeTruthy()
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
})

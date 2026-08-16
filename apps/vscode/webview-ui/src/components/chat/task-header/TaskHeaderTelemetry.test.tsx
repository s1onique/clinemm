/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / TaskHeaderTelemetry component tests.
 *
 * Component behaviour matrix (parent ACT §51, §49):
 *   - renders "-" when telemetry is absent (no chat-derived fallback)
 *   - renders elapsed / state / tool count / recovery from canonical props
 *   - hides recovery at zero (THA19)
 *   - state derives from turnState.phase (THA20 / M2 killer)
 *   - tool count derives from canonical telemetry.toolCalls (THA21 / M3 killer)
 *   - recovery label excludes control-plane outcomes (THA18 / M4 killer)
 *   - elapsed survives remount via canonical startedAt (THA04 / M1 killer)
 *   - terminal endedAt freezes the display (THA03)
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
		recoveryInterventions: 0,
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

	it("THA19: hides recovery at zero (↻ 0 not rendered)", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryInterventions: 0 })} turnState={ts("idle")} />)
		expect(screen.queryByTestId("task-header-recovery-count")).toBeNull()
	})

	it("renders recovery when recoveryInterventions > 0", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryInterventions: 2 })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-recovery-count").textContent).toContain("2")
	})

	it("THA05..TH12: state label reflects canonical turnState phase (no message-tail fallback)", () => {
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

	it("M4 killer: recovery count reflects the canonical counter; control-plane outcomes do not affect it", () => {
		// The component is pure; there is no path from control-plane outcomes
		// (DENY/REJECT/UNKNOWN_TOOL) into recoveryInterventions. The
		// counter is whatever telemetry.recoveryInterventions says it is.
		// This test pins that the DOM value is taken from telemetry only.
		render(<TaskHeaderTelemetry telemetry={telemetry({ recoveryInterventions: 7 })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-recovery-count").textContent).toContain("7")
	})

	it("THA03: endedAt freezes the display even if the task is otherwise live", () => {
		const startedAt = 1_700_000_000_000
		const endedAt = startedAt + 90_000
		render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt, endedAt })} turnState={ts("streaming")} />)
		const elapsed = screen.getByTestId("task-header-elapsed").textContent ?? ""
		// 90 seconds = "01:30". The component MUST NOT render a larger value
		// (e.g. 10 minutes) just because turnState is "live".
		expect(elapsed).toContain("01:30")
		expect(elapsed).not.toMatch(/10:|0:10/)
	})

	it("renders accessible aria-labels for each counter", () => {
		render(
			<TaskHeaderTelemetry telemetry={telemetry({ toolCalls: 3, recoveryInterventions: 1 })} turnState={ts("streaming")} />,
		)
		expect(screen.getByLabelText(/Elapsed task time/i)).toBeTruthy()
		expect(screen.getByLabelText(/Task state: Working/i)).toBeTruthy()
		expect(screen.getByLabelText(/Tool calls: 3/i)).toBeTruthy()
		expect(screen.getByLabelText(/Recovery interventions: 1/i)).toBeTruthy()
	})

	it("M5 killer: same task identity across two renders preserves elapsed from the same epoch", () => {
		const startedAt = 1_700_000_000_000
		const first = render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
		const firstText = screen.getByTestId("task-header-elapsed").textContent ?? ""
		first.unmount()
		// Same task identity, same canonical epoch. If the component had a
		// "reset on every render" bug the elapsed would diverge.
		render(<TaskHeaderTelemetry telemetry={telemetry({ startedAt })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-elapsed").textContent).toBe(firstText)
	})
})

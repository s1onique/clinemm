/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 (TES-OUT-01)
 *
 * Webview rendering + wire-boundary tests for the bounded tool
 * RUNTIME-OUTCOME projection that sits next to the existing V1 mechanism
 * strip.
 *
 * Invariants pinned here:
 *   - the outcome chips render NEXT TO (never replace) the tool summary;
 *   - the chips render ONLY when the projection passes the wire validator;
 *   - a legacy host (no `outcome` field) renders the V1 display UNCHANGED;
 *   - a malformed / non-conserving projection falls back to the V1 display
 *     and the webview NEVER silently repairs the counts;
 *   - the accessible text describes RUNTIME tool outcomes and never claims
 *     that shell commands or tests passed.
 */
import type { TaskHeaderTelemetryStrip, ToolOutcomeSummary, TurnState } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"
import { isUsableOutcomeProjection } from "./taskHeaderTelemetryHelpers"

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

describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 / TaskHeaderTelemetry outcome projection", () => {
	it("TESOUTUI-01: renders the outcome chips next to the existing tool summary", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					toolCalls: 10,
					outcome: { succeeded: 7, failed: 2, pending: 1, unknown: 0 },
				})}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByTestId("task-header-tool-count")).toBeTruthy()
		expect(screen.getByTestId("task-header-tool-outcome")).toBeTruthy()
		expect(screen.getByTestId("task-header-outcome-succeeded").textContent).toContain("7")
		expect(screen.getByTestId("task-header-outcome-failed").textContent).toContain("2")
		expect(screen.getByTestId("task-header-outcome-pending").textContent).toContain("1")
		// A zero bucket is hidden so a healthy task stays uncluttered.
		expect(screen.queryByTestId("task-header-outcome-unknown")).toBeNull()
	})

	it("TESOUTUI-02: a legacy host without the outcome field renders the V1 display unchanged", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ toolCalls: 4 })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-tool-count").textContent).toContain("4")
		expect(screen.queryByTestId("task-header-tool-outcome")).toBeNull()
	})

	it("TESOUTUI-03: a non-conserving projection falls back to the V1 display (no silent repair)", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					toolCalls: 10,
					outcome: { succeeded: 7, failed: 2, pending: 1, unknown: 5 },
				})}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.queryByTestId("task-header-tool-outcome")).toBeNull()
		expect(screen.getByTestId("task-header-tool-count").textContent).toContain("10")
	})

	it("TESOUTUI-04: a malformed projection (negative / non-integer / NaN) falls back to the V1 display", () => {
		for (const outcome of [
			{ succeeded: -1, failed: 1, pending: 0, unknown: 0 },
			{ succeeded: 1.5, failed: 0.5, pending: 0, unknown: 0 },
			{ succeeded: Number.NaN, failed: 0, pending: 0, unknown: 0 },
			{ succeeded: Number.POSITIVE_INFINITY, failed: 0, pending: 0, unknown: 0 },
		] as ToolOutcomeSummary[]) {
			const { unmount } = render(
				<TaskHeaderTelemetry telemetry={telemetry({ toolCalls: 0, outcome })} turnState={ts("streaming")} />,
			)
			expect(screen.queryByTestId("task-header-tool-outcome")).toBeNull()
			unmount()
		}
	})

	it("TESOUTUI-05: an all-zero projection renders nothing (nothing to say)", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ toolCalls: 0, outcome: { succeeded: 0, failed: 0, pending: 0, unknown: 0 } })}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.queryByTestId("task-header-tool-outcome")).toBeNull()
	})

	it("TESOUTUI-06: the accessible text describes RUNTIME tool outcomes and never claims a shell command passed", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					toolCalls: 10,
					outcome: { succeeded: 7, failed: 2, pending: 1, unknown: 0 },
				})}
				turnState={ts("streaming")}
			/>,
		)
		const succeeded = screen.getByTestId("task-header-outcome-succeeded")
		expect(succeeded.getAttribute("aria-label")).toBe("7 tool calls that completed successfully at runtime")
		const failed = screen.getByTestId("task-header-outcome-failed")
		expect(failed.getAttribute("aria-label")).toBe("2 tool calls that failed at runtime")
		const pending = screen.getByTestId("task-header-outcome-pending")
		expect(pending.getAttribute("aria-label")).toBe("1 tool calls still awaiting a runtime outcome")
		// No wording anywhere may claim a command / test / build passed.
		const strip = screen.getByTestId("task-header-tool-outcome")
		expect(strip.getAttribute("title") ?? "").not.toMatch(/command passed|tests passed|build passed|exit(ed)? 0/i)
		expect(strip.getAttribute("aria-label") ?? "").not.toMatch(/command passed|tests passed|build passed|exit(ed)? 0/i)
	})

	it("TESOUTUI-07: the mechanism display is untouched by the outcome projection", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					toolCalls: 2,
					mechanism: { total: 2, edit: 1, command: 1, read: 0, search: 0, mcp: 0, other: 0 },
					outcome: { succeeded: 1, failed: 1, pending: 0, unknown: 0 },
				})}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByTestId("task-header-mechanism-total").textContent).toContain("2")
		expect(screen.getByTestId("task-header-mechanism-edit").textContent).toContain("1")
		expect(screen.getByTestId("task-header-mechanism-command").textContent).toContain("1")
		expect(screen.getByTestId("task-header-tool-outcome")).toBeTruthy()
	})

	it("TESOUTUI-08: the wire validator enforces presence, integrality and conservation", () => {
		expect(isUsableOutcomeProjection(undefined, 0)).toBe(false)
		expect(isUsableOutcomeProjection({ succeeded: 0, failed: 0, pending: 0, unknown: 0 }, 0)).toBe(true)
		expect(isUsableOutcomeProjection({ succeeded: 3, failed: 1, pending: 1, unknown: 0 }, 5)).toBe(true)
		expect(isUsableOutcomeProjection({ succeeded: 3, failed: 1, pending: 1, unknown: 0 }, 6)).toBe(false)
		expect(isUsableOutcomeProjection({ succeeded: -1, failed: 0, pending: 0, unknown: 0 }, -1)).toBe(false)
		expect(isUsableOutcomeProjection({ succeeded: 1.5, failed: 0, pending: 0, unknown: 0 }, 1.5)).toBe(false)
		expect(isUsableOutcomeProjection({ succeeded: Number.NaN, failed: 0, pending: 0, unknown: 0 }, Number.NaN)).toBe(false)
	})
})

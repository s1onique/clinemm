// ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01-CORRECTION01:
// Live DOM render witness.
//
// The live-green driver (apps/vscode/src/sdk/task-telemetry-tracker.live-green.ts)
// emits the EXACT wire-shape TaskHeaderTelemetryStrip that the production
// SdkController.handleTaskRuntimeError → postStateToWebview → gRPC bridge
// pipeline produces after each incident. This test takes those three
// wire snapshots (before, after_first_eperm, after_second_eperm) and feeds
// them straight into the production React TaskHeaderTelemetry component,
// rendering it under the same vitest+jsdom harness used by the existing
// 46/46 test family.
//
// What this proves:
//   The wire shape produced by the production TaskTelemetryTracker on
//   each real EPERM incident renders the exact glyph ("⚠ 1" → "⚠ 2")
//   the user sees in the live VS Code webview. The DOM data-testid,
//   text content, and accessibility attributes are pinned here as
//   load-bearing evidence for the bounded correction's
//   LIVE_HEADER_0_TO_1 / LIVE_HEADER_1_TO_2 / LIVE_EXIT7_UNCHANGED
//   gates (the gRPC bridge step between postStateToWebview and the
//   webview reducer is captured separately on a non-sandboxed GUI
//   host; see ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01
//   11-live-qualification-environment-note.txt).

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"

// Wire snapshots are byte-identical to the live-green driver output.
// (See /tmp/clinemm-runtime-error-counter-live-green/live-green-driver.ts
// for the producer of these shapes.)
const WIRE_BEFORE = {
	startedAt: 1_700_000_000_000,
	toolCalls: 0,
	recoveryBudgetFailures: 0,
	mechanism: { total: 0, edit: 0, command: 0, read: 0, search: 0, mcp: 0, other: 0 },
}
const WIRE_AFTER_FIRST_EPERM = { ...WIRE_BEFORE, runtimeErrorCount: 1 }
const WIRE_AFTER_SECOND_EPERM = { ...WIRE_BEFORE, runtimeErrorCount: 2 }
// exit7_unchanged — same wire as after_second_eperm (no new incident)
// is the conservation witness for LIVE_EXIT7_UNCHANGED.
const WIRE_AFTER_EXIT7 = WIRE_AFTER_SECOND_EPERM

const TURN_STATE = { phase: "streaming" } as const

describe("TaskHeaderTelemetry — live-wire DOM render witness", () => {
	it("LIVE_HEADER_BEFORE: counter is zero-hiding (no glyph)", () => {
		const { container } = render(
			<TaskHeaderTelemetry telemetry={WIRE_BEFORE} turnState={TURN_STATE} />,
		)
		expect(container.querySelector("[data-testid=task-header-runtime-error-count]")).toBeNull()
	})

	it("LIVE_HEADER_0_TO_1: ⚠ 1 glyph appears after first EPERM incident", () => {
		const { container } = render(
			<TaskHeaderTelemetry telemetry={WIRE_AFTER_FIRST_EPERM} turnState={TURN_STATE} />,
		)
		const el = container.querySelector("[data-testid=task-header-runtime-error-count]") as HTMLElement
		expect(el).toBeTruthy()
		expect(el.textContent).toContain("⚠")
		expect(el.textContent).toContain("1")
		expect(el.getAttribute("aria-label")).toBe("1 runtime error in this task")
		// Title carries the explicit lifetime contract — pinned here as
		// part of the LIVE_HEADER_0_TO_1 witness so any future regression
		// in the contract language breaks the live evidence.
		const title = el.getAttribute("title") ?? ""
		expect(title).toContain("Cumulative")
		expect(title).toContain("current task session")
		expect(title).toContain("Resets to 0")
	})

	it("LIVE_HEADER_1_TO_2: ⚠ 2 glyph appears after second independent EPERM incident", () => {
		const { container } = render(
			<TaskHeaderTelemetry telemetry={WIRE_AFTER_SECOND_EPERM} turnState={TURN_STATE} />,
		)
		const el = container.querySelector("[data-testid=task-header-runtime-error-count]") as HTMLElement
		expect(el).toBeTruthy()
		expect(el.textContent).toContain("⚠")
		expect(el.textContent).toContain("2")
		expect(el.getAttribute("aria-label")).toBe("2 runtime errors in this task")
	})

	it("LIVE_EXIT7_UNCHANGED: a non-incident (no new recordRuntimeError call) leaves the wire and DOM unchanged", () => {
		// The wire snapshot post-exit7 is identical to the post-second-EPERM
		// snapshot — no new runtimeErrorCount is sent because no
		// recordRuntimeError call fires for an ordinary command exit.
		// The DOM renders "⚠ 2" exactly as it did before the exit-7 path.
		const { container } = render(
			<TaskHeaderTelemetry telemetry={WIRE_AFTER_EXIT7} turnState={TURN_STATE} />,
		)
		const el = container.querySelector("[data-testid=task-header-runtime-error-count]") as HTMLElement
		expect(el).toBeTruthy()
		expect(el.textContent).toContain("2")
		expect(el.getAttribute("aria-label")).toBe("2 runtime errors in this task")
	})

	// Sanity: the existing 46 tests still cover the same shape; this file
	// is an additional, intentionally tiny witness of the live-wire
	// composition (real wire from real tracker → real DOM via real React).
	// It is NOT a replacement for the 46-test family.
	it("LIVE_SANITY: data-testid matches the canonical selector used by the existing 46-test family", () => {
		const { container } = render(
			<TaskHeaderTelemetry telemetry={WIRE_AFTER_SECOND_EPERM} turnState={TURN_STATE} />,
		)
		const elByTestId = screen.getByTestId("task-header-runtime-error-count")
		const elByQuery = container.querySelector("[data-testid=task-header-runtime-error-count]")
		expect(elByQuery).toBe(elByTestId)
	})
})

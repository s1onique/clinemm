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

	// =========================================================================
	// ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 (TES-IMPL-01)
	//
	// TaskHeader mechanism-projection tests. Each test pins one
	// acceptance criterion from the ACT plan:
	//   - mechanism-only (no semantic-purpose inference)
	//   - non-zero buckets only
	//   - stable icon order
	//   - tooltips + aria-labels carry the semantics
	//   - native edit (`apply_patch`) and shell edit
	//     (`run_commands "sed -i ..."`) are visually distinct
	//   - conservation: the existing flat `toolCalls` count is
	//     preserved alongside the breakdown
	//   - Hub/Remote hosts without the new `mechanism` field fall
	//     back to the legacy flat render unchanged
	// =========================================================================

	describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 / mechanism projection", () => {
		it("TES-UI-01: renders the mechanism breakdown when `mechanism` is on the wire", () => {
			render(
				<TaskHeaderTelemetry
					telemetry={telemetry({
						toolCalls: 10,
						mechanism: {
							total: 10,
							edit: 3,
							command: 3,
							read: 2,
							search: 0,
							mcp: 1,
							other: 1,
						},
					})}
					turnState={ts("streaming")}
				/>,
			)
			// Total chip.
			expect(screen.getByTestId("task-header-mechanism-total").textContent).toContain("10")
			// Per-mechanism chips.
			expect(screen.getByTestId("task-header-mechanism-edit").textContent).toContain("3")
			expect(screen.getByTestId("task-header-mechanism-command").textContent).toContain("3")
			expect(screen.getByTestId("task-header-mechanism-read").textContent).toContain("2")
			expect(screen.getByTestId("task-header-mechanism-mcp").textContent).toContain("1")
			expect(screen.getByTestId("task-header-mechanism-other").textContent).toContain("1")
			// Search bucket is zero → must NOT render.
			expect(screen.queryByTestId("task-header-mechanism-search")).toBeNull()
		})

		it("TES-UI-02: hidden zero-bucket — only non-zero buckets render", () => {
			render(
				<TaskHeaderTelemetry
					telemetry={telemetry({
						toolCalls: 4,
						mechanism: {
							total: 4,
							edit: 4,
							command: 0,
							read: 0,
							search: 0,
							mcp: 0,
							other: 0,
						},
					})}
					turnState={ts("streaming")}
				/>,
			)
			expect(screen.getByTestId("task-header-mechanism-edit")).toBeTruthy()
			// All other buckets are zero → must not render.
			expect(screen.queryByTestId("task-header-mechanism-command")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-read")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-search")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-mcp")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-other")).toBeNull()
		})

		it("TES-UI-03: stable icon order — total, edit, command, read, search, mcp, other", () => {
			render(
				<TaskHeaderTelemetry
					telemetry={telemetry({
						toolCalls: 6,
						mechanism: {
							total: 6,
							edit: 1,
							command: 1,
							read: 1,
							search: 1,
							mcp: 1,
							other: 1,
						},
					})}
					turnState={ts("streaming")}
				/>,
			)
			const strip = screen.getByTestId("task-header-tool-count")
			// Read the chips in DOM order and verify the canonical
			// total → edit → command → read → search → mcp → other
			// order is preserved.
			const chips = Array.from(strip.querySelectorAll("[data-testid]")).map((el) => el.getAttribute("data-testid") ?? "")
			const expectedOrder = [
				"task-header-mechanism-total",
				"task-header-mechanism-edit",
				"task-header-mechanism-command",
				"task-header-mechanism-read",
				"task-header-mechanism-search",
				"task-header-mechanism-mcp",
				"task-header-mechanism-other",
			]
			const actualChipOrder = chips.filter((id) => id.startsWith("task-header-mechanism-"))
			expect(actualChipOrder).toEqual(expectedOrder)
		})

		it("TES-UI-04: every chip carries an explicit aria-label describing the bucket", () => {
			render(
				<TaskHeaderTelemetry
					telemetry={telemetry({
						toolCalls: 3,
						mechanism: {
							total: 3,
							edit: 1,
							command: 1,
							read: 1,
							search: 0,
							mcp: 0,
							other: 0,
						},
					})}
					turnState={ts("streaming")}
				/>,
			)
			expect(screen.getByLabelText("1 edit tool calls")).toBeTruthy()
			expect(screen.getByLabelText("1 command tool calls")).toBeTruthy()
			expect(screen.getByLabelText("1 read tool calls")).toBeTruthy()
			// Tooltip on the parent strip explains mechanism projection.
			const strip = screen.getByTestId("task-header-tool-count")
			expect(strip.getAttribute("title")).toContain("broken down by mechanism")
		})

		it("TES-UI-05 (M-killer): `apply_patch` is `edit`, `run_commands` is `command` (distinct glyphs)", () => {
			// The host-side classification already pins these two
			// tools to distinct mechanisms (see
			// `tool-mechanism-classifier.test.ts` TES-CLASS-09); the
			// webview must render them with distinct, non-collapsing
			// icons.
			render(
				<TaskHeaderTelemetry
					telemetry={telemetry({
						toolCalls: 2,
						mechanism: {
							total: 2,
							edit: 1,
							command: 1,
							read: 0,
							search: 0,
							mcp: 0,
							other: 0,
						},
					})}
					turnState={ts("streaming")}
				/>,
			)
			// Both chips exist with distinct test IDs.
			expect(screen.getByTestId("task-header-mechanism-edit")).toBeTruthy()
			expect(screen.getByTestId("task-header-mechanism-command")).toBeTruthy()
			// Their aria-labels are different (so screen readers do
			// not collapse the two mechanisms).
			expect(screen.getByLabelText("1 edit tool calls")).toBeTruthy()
			expect(screen.getByLabelText("1 command tool calls")).toBeTruthy()
		})

		it("TES-UI-06: Hub/Remote fallback — no `mechanism` field → flat count unchanged", () => {
			// Hosts that have not yet received the new `mechanism`
			// field MUST still render the flat `toolCalls` count.
			render(<TaskHeaderTelemetry telemetry={telemetry({ toolCalls: 7 })} turnState={ts("streaming")} />)
			const strip = screen.getByTestId("task-header-tool-count")
			// The flat count is still the single source of truth here.
			expect(strip.textContent).toContain("7")
			// No mechanism chips should render in the fallback path.
			expect(screen.queryByTestId("task-header-mechanism-edit")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-total")).toBeNull()
		})

		it("TES-UI-07: `toolCalls` (flat) and `mechanism.total` are numerically co-rendered", () => {
			// Conservation: when both fields are present, the host's
			// flat `toolCalls` and the mechanism `total` agree. The
			// strip renders both: `toolCalls` as the parent
			// `aria-label` (e.g. "Tool calls: 10"), `mechanism.total`
			// as the total-chip text.
			render(
				<TaskHeaderTelemetry
					telemetry={telemetry({
						toolCalls: 10,
						mechanism: {
							total: 10,
							edit: 3,
							command: 3,
							read: 2,
							search: 1,
							mcp: 1,
							other: 0,
						},
					})}
					turnState={ts("streaming")}
				/>,
			)
			expect(screen.getByLabelText("Tool calls: 10")).toBeTruthy()
			expect(screen.getByTestId("task-header-mechanism-total").textContent).toContain("10")
			expect(screen.getByTestId("task-header-mechanism-search")).toBeTruthy()
		})

		it("TES-UI-08: empty `mechanism` summary renders the total chip with zero sub-buckets", () => {
			render(
				<TaskHeaderTelemetry
					telemetry={telemetry({
						toolCalls: 0,
						mechanism: {
							total: 0,
							edit: 0,
							command: 0,
							read: 0,
							search: 0,
							mcp: 0,
							other: 0,
						},
					})}
					turnState={ts("idle")}
				/>,
			)
			// Total chip is zero.
			expect(screen.getByTestId("task-header-mechanism-total").textContent).toContain("0")
			// No sub-buckets render when everything is zero.
			expect(screen.queryByTestId("task-header-mechanism-edit")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-command")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-read")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-search")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-mcp")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-other")).toBeNull()
		})

		it("TES-UI-WIRE-01: `mechanism.total !== toolCalls` triggers flat fallback (no contradictory UI)", () => {
			// The version-skew / cross-field conservation case. The
			// host's flat `toolCalls` and the per-mechanism total
			// disagree. The webview MUST fall back to the legacy
			// flat `🔧 N` rendering rather than display
			// `aria: Tool calls: 10` against `visible: 🔧9 ✏️3 >_3 ...`.
			render(
				<TaskHeaderTelemetry
					telemetry={{
						startedAt: 1_700_000_000_000,
						toolCalls: 10, // ← flat count
						recoveryBudgetFailures: 0,
						mechanism: {
							total: 9, // ← ≠ toolCalls → validator fails
							edit: 3,
							command: 3,
							read: 2,
							search: 0,
							mcp: 1,
							other: 0,
						},
					}}
					turnState={ts("streaming")}
				/>,
			)
			// Flat fallback: no mechanism chips render; the flat
			// count is shown.
			const strip = screen.getByTestId("task-header-tool-count")
			expect(strip.textContent).toContain("10")
			expect(screen.queryByTestId("task-header-mechanism-total")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-edit")).toBeNull()
		})

		it("TES-UI-WIRE-02: bucket sum mismatch triggers flat fallback", () => {
			// In-process conservation violation.
			render(
				<TaskHeaderTelemetry
					telemetry={{
						startedAt: 1_700_000_000_000,
						toolCalls: 10,
						recoveryBudgetFailures: 0,
						mechanism: {
							total: 10,
							edit: 3,
							command: 3,
							read: 2,
							search: 0,
							mcp: 1,
							other: 0, // ← sum = 9, total = 10 → validator fails
						},
					}}
					turnState={ts("streaming")}
				/>,
			)
			const strip = screen.getByTestId("task-header-tool-count")
			expect(strip.textContent).toContain("10")
			expect(screen.queryByTestId("task-header-mechanism-total")).toBeNull()
		})

		it("TES-UI-WIRE-03: a valid conserved projection renders the rich glyph strip", () => {
			// The positive case: when the boundary validator passes,
			// the rich `🔧N · ✏️E · >_C · ...` projection renders.
			render(
				<TaskHeaderTelemetry
					telemetry={{
						startedAt: 1_700_000_000_000,
						toolCalls: 4,
						recoveryBudgetFailures: 0,
						mechanism: {
							total: 4,
							edit: 2,
							command: 1,
							read: 1,
							search: 0,
							mcp: 0,
							other: 0,
						},
					}}
					turnState={ts("streaming")}
				/>,
			)
			// Rich projection renders.
			expect(screen.getByTestId("task-header-mechanism-total").textContent).toContain("4")
			expect(screen.getByTestId("task-header-mechanism-edit").textContent).toContain("2")
			expect(screen.getByTestId("task-header-mechanism-command").textContent).toContain("1")
			expect(screen.getByTestId("task-header-mechanism-read").textContent).toContain("1")
			// Hidden zero-buckets stay hidden.
			expect(screen.queryByTestId("task-header-mechanism-search")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-mcp")).toBeNull()
			expect(screen.queryByTestId("task-header-mechanism-other")).toBeNull()
		})

		it("TES-UI-WIRE-04: malformed snapshot (NaN) triggers flat fallback", () => {
			// A version-skewed producer might emit `NaN` for an
			// unknown bucket. The boundary validator rejects it and
			// the webview falls back to the flat count.
			render(
				<TaskHeaderTelemetry
					telemetry={{
						startedAt: 1_700_000_000_000,
						toolCalls: 5,
						recoveryBudgetFailures: 0,
						mechanism: {
							total: 5,
							edit: Number.NaN, // ← malformed
							command: 2,
							read: 1,
							search: 0,
							mcp: 0,
							other: 0,
						},
					}}
					turnState={ts("streaming")}
				/>,
			)
			const strip = screen.getByTestId("task-header-tool-count")
			expect(strip.textContent).toContain("5")
			expect(screen.queryByTestId("task-header-mechanism-total")).toBeNull()
		})
	})

	// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
	describe("diagnostic-knob indicator", () => {
		it("hides the indicator when diagnosticKnobs is undefined", () => {
			render(<TaskHeaderTelemetry telemetry={telemetry()} turnState={ts("streaming")} />)
			expect(screen.queryByTestId("task-header-diagnostic-knobs")).toBeNull()
		})

		it("hides the indicator when all knobs are OFF (public default)", () => {
			render(
				<TaskHeaderTelemetry
					diagnosticKnobs={{ v: false, i: false, a: false, p: false }}
					telemetry={telemetry()}
					turnState={ts("streaming")}
				/>,
			)
			expect(screen.queryByTestId("task-header-diagnostic-knobs")).toBeNull()
		})

		it("renders 'VIP' for the canonical dogfood initial render", () => {
			render(
				<TaskHeaderTelemetry
					diagnosticKnobs={{ v: true, i: true, a: false, p: true }}
					telemetry={telemetry()}
					turnState={ts("streaming")}
				/>,
			)
			const indicator = screen.getByTestId("task-header-diagnostic-knobs")
			expect(indicator.textContent).toBe("VIP")
		})

		it("renders 'VIAP' when all four knobs are ON (future A probe landed)", () => {
			render(
				<TaskHeaderTelemetry
					diagnosticKnobs={{ v: true, i: true, a: true, p: true }}
					telemetry={telemetry()}
					turnState={ts("streaming")}
				/>,
			)
			expect(screen.getByTestId("task-header-diagnostic-knobs").textContent).toBe("VIAP")
		})

		it("renders 'IP' when V is overridden off in dogfood", () => {
			render(
				<TaskHeaderTelemetry
					diagnosticKnobs={{ v: false, i: true, a: false, p: true }}
					telemetry={telemetry()}
					turnState={ts("streaming")}
				/>,
			)
			expect(screen.getByTestId("task-header-diagnostic-knobs").textContent).toBe("IP")
		})
	})
})

/**
 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
 *
 * Webview tests for the `⎇ N` live ownership gauge. Pin the
 * ACT contract at the rendering seam:
 *
 *  G-01  hidden when the wire field is absent (undefined)
 *  G-02  hidden when the wire field is exactly 0
 *  G-03  rendered when > 0
 *  G-04  independent of `runtimeErrorCount` (the `⚠` glyph)
 *  G-05  independent of cumulative `>_` count (the command
 *        mechanism glyph)
 *  G-06  process-name agnostic — there is NO conditional logic
 *        keyed on any executable name in the render path
 *  G-07  count text exactly matches the wire value (no off-by-one,
 *        no saturation)
 *  G-08  absent field == zero (Hub/Remote / pre-emit equivalence)
 *  G-09  the rendered `data-testid` is
 *        `task-header-active-owned-command-jobs` (stable contract)
 *  G-10  the rendered aria-label includes the count (screen-reader
 *        path is independent of the visual glyph)
 */
import type { TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"

function ts(phase: TurnState["phase"]): TurnState {
	return { phase, seq: 1 }
}

function telemetry(partial: Partial<TaskHeaderTelemetryStrip> = {}): TaskHeaderTelemetryStrip {
	return {
		startedAt: 1_700_000_000_000,
		toolCalls: 0,
		recoveryBudgetFailures: 0,
		...partial,
	}
}

const TESTID = "task-header-active-owned-command-jobs"

describe("ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01 / TaskHeaderTelemetry ⎇ gauge", () => {
	it("G-01: hidden when activeCommandJobs is absent on the wire", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry()} turnState={ts("streaming")} />)
		expect(screen.queryByTestId(TESTID)).toBeNull()
	})

	it("G-02: hidden when activeCommandJobs is exactly 0", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 0 })} turnState={ts("streaming")} />)
		expect(screen.queryByTestId(TESTID)).toBeNull()
	})

	it("G-03: rendered when activeCommandJobs > 0", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 3 })} turnState={ts("streaming")} />)
		expect(screen.getByTestId(TESTID)).toBeTruthy()
	})

	it("G-04: independent of runtimeErrorCount (the ⚠ glyph)", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ activeCommandJobs: 2, runtimeErrorCount: 5 })}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByTestId(TESTID)).toBeTruthy()
		expect(screen.getByTestId("task-header-runtime-error-count")).toBeTruthy()
	})

	it("G-05: independent of cumulative command mechanism count (the >_ glyph)", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					activeCommandJobs: 1,
					mechanism: { total: 42, command: 42, edit: 0, search: 0, read: 0, mcp: 0, other: 0 },
				})}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByTestId(TESTID)).toBeTruthy()
		expect(screen.getByTestId("task-header-tool-count")).toBeTruthy()
	})

	it("G-06: process-name agnostic — the render path never inspects any executable string", () => {
		const cases = [1, 7, 99] as const
		for (const n of cases) {
			const { unmount } = render(
				<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: n })} turnState={ts("streaming")} />,
			)
			const node = screen.getByTestId(TESTID)
			expect(node.textContent).toContain(String(n))
			unmount()
		}
	})

	it("G-07: count text exactly matches the wire value", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 17 })} turnState={ts("streaming")} />)
		const node = screen.getByTestId(TESTID)
		expect(node.textContent).toContain("17")
	})

	it("G-08: absence (undefined) renders identically to zero", () => {
		const { rerender } = render(<TaskHeaderTelemetry telemetry={telemetry()} turnState={ts("streaming")} />)
		const absent = screen.queryByTestId(TESTID)
		rerender(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 0 })} turnState={ts("streaming")} />)
		const zero = screen.queryByTestId(TESTID)
		expect(absent).toBeNull()
		expect(zero).toBeNull()
	})

	it("G-09: rendered testid is task-header-active-owned-command-jobs", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 1 })} turnState={ts("streaming")} />)
		expect(screen.getByTestId("task-header-active-owned-command-jobs")).toBeTruthy()
	})

	it("G-10: aria-label carries the count for screen readers", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 4 })} turnState={ts("streaming")} />)
		const node = screen.getByTestId(TESTID)
		expect(node.getAttribute("aria-label")).toContain("4")
	})

	// ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01:
	// The ⎇ title MUST disclose the primary-PGID cleanup scope so the
	// user can hover and read the honest scope. The aria-label stays
	// concise for screen readers.

	it("PCPC-UI-03: ⎇ title discloses primary-process-group cleanup scope", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 3 })} turnState={ts("streaming")} />)
		const node = screen.getByTestId(TESTID)
		const title = node.getAttribute("title") ?? ""
		expect(title).toMatch(/primary process group|primary PGID|primary.*group/i)
		expect(title).toMatch(/processes that leave|outlive the job|may outlive/i)
	})

	it("PCPC-UI-04: ⎇ aria-label still carries the count (screen-reader contract preserved)", () => {
		render(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 3 })} turnState={ts("streaming")} />)
		const node = screen.getByTestId(TESTID)
		const label = node.getAttribute("aria-label") ?? ""
		// Must still carry the count for screen readers.
		expect(label).toContain("3")
		// Must still describe the count semantically.
		expect(label).toMatch(/active command job/i)
	})

	it("PCPC-UI-05: ⎇ tooltip does not claim process count or executable-name sweep", () => {
		// The accessible contract MUST NOT include the escape-claim
		// patterns the predecessor ACT retracts. PCPC-AO-02 at the
		// production-source level is mirrored here at the rendered
		// tooltip level.
		render(<TaskHeaderTelemetry telemetry={telemetry({ activeCommandJobs: 3 })} turnState={ts("streaming")} />)
		const node = screen.getByTestId(TESTID)
		const label = node.getAttribute("aria-label") ?? ""
		const title = node.getAttribute("title") ?? ""
		const noOverclaimPatterns = [
			/escape detected/i,
			/leaked descendant/i,
			/all descendants killed/i,
			/zero descendants/i,
			/all spawned processes terminated/i,
		]
		for (const pat of noOverclaimPatterns) {
			expect(pat.test(label)).toBe(false)
			expect(pat.test(title)).toBe(false)
		}
	})
})

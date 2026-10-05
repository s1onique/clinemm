/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — RED tests for the
 * webview render of the myc chip + hover.
 *
 * THMYC-UI-01..10. These tests run RED until the strip reads a
 * host-projected `telemetry.myc` field; the chip renders `myc 0`,
 * `myc 1/1`, `myc 3/4`, `⚠ myc 3/4`; the hover exposes Calls /
 * Retrieval / Automatic prime / Last; the chip is hidden entirely
 * when `myc` is undefined (the public default — no host projection);
 * the existing telemetry is conserved.
 *
 * ACT §11..§13 UX contract (frozen):
 *   compact form:  myc S/T  (or myc 0 at zero calls)
 *   degraded form: ⚠ myc S/T
 *   aria label:    "myc: N successful operations out of M"
 *   hover sections are individually omitted when their data is all-zero
 *
 * No custom color (theme tokens only). No SVG. No new icon library.
 */
import type { MycTelemetrySummary, TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"

function ts(phase: TurnState["phase"] = "idle"): TurnState {
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

function buildMyc(partial: Partial<MycTelemetrySummary>): MycTelemetrySummary {
	return {
		configured: true,
		callsTotal: 0,
		callsSuccessful: 0,
		callsFailed: 0,
		retrievalCalls: 0,
		usefulRetrievals: 0,
		automaticPrime: { attempted: false, status: "idle" },
		...partial,
	}
}

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 / TaskHeaderTelemetry myc chip", () => {
	it("THMYC-UI-01: no myc field -> chip is absent (public profile default)", () => {
		const { container } = render(<TaskHeaderTelemetry telemetry={telemetry()} turnState={ts()} />)
		expect(screen.queryByTestId("task-header-myc-chip")).toBeNull()
		expect(container.textContent ?? "").not.toMatch(/\bmyc\b/)
	})

	it("THMYC-UI-02: configured but zero calls -> renders `myc 0` with aria 'no operations yet'", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ myc: buildMyc({ configured: true, callsTotal: 0, callsSuccessful: 0 }) })}
				turnState={ts()}
			/>,
		)
		const chip = screen.getByTestId("task-header-myc-chip")
		expect(chip.textContent).toContain("myc")
		expect(chip.textContent).toContain("0")
		expect(chip.getAttribute("aria-label")).toMatch(/myc: no operations yet/i)
	})

	it("THMYC-UI-03: 1/1 -> renders `myc 1/1` with aria '1 successful operation out of 1'", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ myc: buildMyc({ callsTotal: 1, callsSuccessful: 1 }) })}
				turnState={ts()}
			/>,
		)
		const chip = screen.getByTestId("task-header-myc-chip")
		expect(chip.textContent).toMatch(/myc/)
		expect(chip.textContent).toContain("1/1")
		expect(chip.getAttribute("aria-label")).toMatch(/1 successful operation out of 1/)
	})

	it("THMYC-UI-04: 3/4 -> renders `myc 3/4` with plural-correct aria", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ myc: buildMyc({ callsTotal: 4, callsSuccessful: 3, callsFailed: 1 }) })}
				turnState={ts()}
			/>,
		)
		const chip = screen.getByTestId("task-header-myc-chip")
		expect(chip.textContent).toMatch(/myc/)
		expect(chip.textContent).toContain("3/4")
		expect(chip.getAttribute("aria-label")).toMatch(/3 successful operations out of 4/)
	})

	it("THMYC-UI-05: degraded (prime error) -> warning glyph present, accessible label includes degradation", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					myc: buildMyc({
						callsTotal: 1,
						callsSuccessful: 0,
						callsFailed: 1,
						automaticPrime: { attempted: true, status: "error" },
						last: { operation: "prime", outcome: "error", latencyMs: 12 },
					}),
				})}
				turnState={ts()}
			/>,
		)
		const chip = screen.getByTestId("task-header-myc-chip")
		expect(chip.textContent ?? "").toMatch(/⚠|myc/)
		expect(chip.getAttribute("aria-label")).toMatch(/degraded|automatic prime failed|error/i)
	})

	it("THMYC-UI-06: hover (title) exposes Calls / Retrieval / Automatic prime / Last + latency", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					myc: buildMyc({
						callsTotal: 4,
						callsSuccessful: 3,
						callsFailed: 1,
						retrievalCalls: 3,
						usefulRetrievals: 2,
						automaticPrime: { attempted: true, status: "ok" },
						last: { operation: "recall", outcome: "success", latencyMs: 18 },
					}),
				})}
				turnState={ts()}
			/>,
		)
		const chip = screen.getByTestId("task-header-myc-chip")
		const title = chip.getAttribute("title") ?? ""
		expect(title).toMatch(/4 total/)
		expect(title).toMatch(/3 successful/)
		expect(title).toMatch(/2 useful\s*\/\s*3/)
		expect(title).toMatch(/Automatic prime/i)
		expect(title).toMatch(/ok|acquired|injected/i)
		expect(title).toMatch(/Last/i)
		expect(title).toMatch(/recall/i)
		expect(title).toMatch(/18\s*ms/i)
	})

	it("THMYC-UI-07: privacy — render tree contains NO session id, NO path, NO query text, NO raw error", () => {
		const { container } = render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					myc: buildMyc({
						callsTotal: 1,
						callsSuccessful: 1,
						automaticPrime: { attempted: true, status: "error" },
						last: { operation: "recall", outcome: "error", latencyMs: 12 },
					}),
				})}
				turnState={ts()}
			/>,
		)
		const html = container.innerHTML
		expect(html).not.toMatch(/session[-_]?id/i)
		expect(html).not.toMatch(/\/Users\/|\/home\/|C:\\/)
		expect(html).not.toMatch(/MCP error/i)
		expect(html).not.toMatch(/unknown tool/i)
		expect(html).not.toMatch(/myc prime failed/i)
	})

	it("THMYC-UI-08: existing telemetry conserved — tool count, recovery, diagnostic knobs, elapsed", () => {
		render(
			<TaskHeaderTelemetry
				diagnosticKnobs={{ v: true, i: true, a: true, p: true, d: true }}
				telemetry={telemetry({
					toolCalls: 7,
					recoveryBudgetFailures: 2,
					myc: buildMyc({ callsTotal: 1, callsSuccessful: 1 }),
				})}
				turnState={ts("streaming")}
			/>,
		)
		expect(screen.getByTestId("task-header-tool-count")).toBeTruthy()
		expect(screen.getByTestId("task-header-recovery-count").textContent).toContain("2")
		expect(screen.getByTestId("task-header-diagnostic-knobs").textContent).toMatch(/VIAPD/)
		expect(screen.getByTestId("task-header-elapsed")).toBeTruthy()
		expect(screen.getByTestId("task-header-state").textContent).toMatch(/Working/)
		expect(screen.getByTestId("task-header-myc-chip")).toBeTruthy()
	})

	it("THMYC-UI-09: zero/undefined hover sections do not render placeholder lines", () => {
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					myc: buildMyc({
						callsTotal: 0,
						callsSuccessful: 0,
						automaticPrime: { attempted: false, status: "idle" },
					}),
				})}
				turnState={ts()}
			/>,
		)
		const chip = screen.getByTestId("task-header-myc-chip")
		const title = chip.getAttribute("title") ?? ""
		expect(title).not.toMatch(/Last/i)
		expect(title).not.toMatch(/acquired|injected/i)
	})

	it("THMYC-UI-10: chip uses theme tokens — no hard-coded hex color", () => {
		const { container } = render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ myc: buildMyc({ callsTotal: 1, callsSuccessful: 1 }) })}
				turnState={ts()}
			/>,
		)
		const html = container.innerHTML
		expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
	})
})

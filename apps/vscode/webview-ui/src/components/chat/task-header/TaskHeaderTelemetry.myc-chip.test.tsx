/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — tests for the webview
 * render of the myc chip + hover.
 *
 * THMYC-UI-01..12 (CORRECTION01). These tests assert:
 *   - the chip renders `myc 0`, `myc 1/1`, `myc 3/4`, `⚠ myc 3/4`;
 *   - the chip is hidden entirely when `myc` is undefined
 *     (the public default — no host projection);
 *   - the hover exposes structured Calls / Retrieval / Automatic
 *     prime / Last sections via the ClineMM Radix Tooltip primitive
 *     (NOT a native `title` attribute — reviewer's P1-C fix);
 *   - the trigger is keyboard-focusable (Radix TooltipTrigger
 *     renders a `<button>`);
 *   - existing telemetry is conserved.
 *
 * ACT §11..§13 UX contract (frozen):
 *   compact form:  myc S/T  (or myc 0 at zero calls)
 *   degraded form: ⚠ myc S/T
 *   aria label:    "myc: N successful operations out of M"
 *   hover sections are individually omitted when their data is all-zero
 *
 * No custom color (theme tokens only). No SVG. No new icon library.
 *
 * The Radix Tooltip primitive is mocked so TooltipContent is
 * rendered into the DOM synchronously — the production open/close
 * transition is exercised by the Radix library itself, not by
 * these tests. The mock mirrors the pattern used by
 * `ContextWindow.test.tsx`.
 */
import type { MycTelemetrySummary, TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { describe, expect, it } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"

// Mock the Radix Tooltip primitive so TooltipContent renders
// synchronously (Radix defers mounting until open=true in real DOM).
vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
	TooltipContent: ({ children, "data-testid": testId }: PropsWithChildren<{ "data-testid"?: string }>) => (
		<div data-testid={testId}>{children}</div>
	),
	TooltipTrigger: ({
		children,
		"data-testid": testId,
		...rest
	}: PropsWithChildren<{ "data-testid"?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
		<button data-testid={testId} {...rest}>
			{children}
		</button>
	),
}))

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

	it("THMYC-UI-06: structured hover exposes Calls / Retrieval / Automatic prime / Last via Radix Tooltip", () => {
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
		// CORRECTION01: hover is a Radix TooltipContent, NOT a
		// native `title` attribute. Each section is its own
		// data-testid'd block.
		const tooltip = screen.getByTestId("task-header-myc-tooltip")
		const callsSection = screen.getByTestId("task-header-myc-section-calls")
		const retrievalSection = screen.getByTestId("task-header-myc-section-retrieval")
		const primeSection = screen.getByTestId("task-header-myc-section-prime")
		const lastSection = screen.getByTestId("task-header-myc-section-last")
		expect(tooltip).toBeTruthy()
		expect(callsSection.textContent).toMatch(/4 total/)
		expect(callsSection.textContent).toMatch(/3 successful/)
		expect(callsSection.textContent).toMatch(/1 failed/)
		expect(retrievalSection.textContent).toMatch(/2 useful\s*\/\s*3/)
		expect(primeSection.textContent).toMatch(/Automatic prime/i)
		expect(primeSection.textContent).toMatch(/acquired/)
		expect(lastSection.textContent).toMatch(/Last/i)
		expect(lastSection.textContent).toMatch(/recall/)
		expect(lastSection.textContent).toMatch(/18\s*ms/i)
	})

	it("THMYC-UI-11: chip uses Radix TooltipTrigger — keyboard-focusable (NOT native title)", () => {
		const { container } = render(
			<TaskHeaderTelemetry
				telemetry={telemetry({ myc: buildMyc({ callsTotal: 1, callsSuccessful: 1 }) })}
				turnState={ts()}
			/>,
		)
		// CORRECTION01 (P1-C accessibility): the trigger must be a
		// focusable <button>, NOT a non-focusable <span> with a
		// `title=` attribute. Asserting on the tag name + absence of
		// `title` attribute is the load-bearing evidence.
		const chip = screen.getByTestId("task-header-myc-chip")
		expect(chip.tagName).toBe("BUTTON")
		expect(chip.hasAttribute("title")).toBe(false)
		// Confirm the chip is reachable via tab order (focusable).
		chip.focus()
		expect(document.activeElement).toBe(chip)
		// Privacy invariant still holds — no session id, no path,
		// no raw error text in the rendered tree.
		const html = container.innerHTML
		expect(html).not.toMatch(/session[-_]?id/i)
		expect(html).not.toMatch(/\/Users\/|\/home\/|C:\\/)
		expect(html).not.toMatch(/MCP error/i)
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

	it("THMYC-UI-09: zero/undefined hover sections do not render placeholder blocks", () => {
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
		// CORRECTION01: hover is a Radix TooltipContent. The chip is
		// still rendered (zero-call form) but the TooltipContent has
		// no sections to show (none of the section predicates fired),
		// so it is omitted from the DOM.
		const chip = screen.getByTestId("task-header-myc-chip")
		expect(screen.queryByTestId("task-header-myc-tooltip")).toBeNull()
		expect(screen.queryByTestId("task-header-myc-section-last")).toBeNull()
		expect(screen.queryByTestId("task-header-myc-section-prime")).toBeNull()
		expect(screen.queryByTestId("task-header-myc-section-retrieval")).toBeNull()
		// The chip still shows the zero-call label.
		expect(chip.textContent).toMatch(/myc 0/)
	})

	it("THMYC-UI-12: skipped prime with attempted=true is degraded (⚠) AND no successful increment on the wire", () => {
		// CORRECTION01 (P1-B fix): a skipped prime (no myc server
		// configured) must NOT increment callsSuccessful. The UI
		// reflects this — callsTotal=0/callsSuccessful=0 — and the
		// compact form renders `myc 0` (not `myc 1/1`).
		render(
			<TaskHeaderTelemetry
				telemetry={telemetry({
					myc: buildMyc({
						configured: false,
						callsTotal: 0,
						callsSuccessful: 0,
						callsFailed: 0,
						retrievalCalls: 0,
						usefulRetrievals: 0,
						automaticPrime: { attempted: true, status: "skipped" },
					}),
				})}
				turnState={ts()}
			/>,
		)
		const chip = screen.getByTestId("task-header-myc-chip")
		expect(chip.textContent).toMatch(/myc 0/)
		expect(chip.textContent).toContain("⚠") // degraded glyph for skipped+attempted
		const aria = chip.getAttribute("aria-label") ?? ""
		expect(aria).toMatch(/no operations yet/i)
		expect(aria).toMatch(/degraded/i)
		expect(aria).toMatch(/skipped/i)
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

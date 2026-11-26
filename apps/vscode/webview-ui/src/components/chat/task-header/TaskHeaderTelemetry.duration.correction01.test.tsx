/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (CORRECTION-01)
 *
 * The webview-side witnesses for the REPLACEMENT-SNAPSHOT ANCHOR repair.
 *
 * WHAT IS UNDER TEST
 *
 *   A REPLACEMENT duration snapshot must never be extrapolated from the
 *   PREVIOUS snapshot's anchor.
 *
 *   The pre-repair identity was the (taskId, elapsedMs, phase) TRIPLE.
 *   That triple does NOT identify a PUBLICATION: a replacement can
 *   carry the SAME triple (a coverage downgrade, a waiting-reason
 *   change, or an elapsed that did not advance). When that happened
 *   the anchor was NOT reset, so the replacement was silently aged by
 *   the time that belonged to the PREVIOUS publication.
 *
 *   The repair uses the HOST'S PUBLICATION IDENTITY when it is
 *   available, and otherwise the snapshot's FULL CONTENT identity. The
 *   five-minute clamp and the explicit "estimated" marker are RETAINED.
 *
 * EVIDENCE CLASSIFICATION
 *
 *   SYNTHETIC_REAL      - the REAL pure projection helper driven by a
 *                        synthetic chronology.
 *   REAL_PRODUCTION_SEAM - the REAL React component rendering the REAL
 *                        helper with a REAL host snapshot and CONTROLLED
 *                        time advancement.
 */

import type { TaskDurationSnapshot } from "@shared/ExtensionMessage"
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"

const BOUND = 5 * 60_000
const PUBLISHED_AT = 1_700_000_000_000

function snapshot(overrides: Partial<TaskDurationSnapshot> = {}): TaskDurationSnapshot {
	return {
		taskId: "task-webview-c01",
		elapsedMs: 10_000,
		activeMs: 10_000,
		waitingMs: 0,
		unknownMs: 0,
		phase: "active",
		coverage: "complete",
		...overrides,
	}
}

/**
 * Parse the rendered duration text back into milliseconds so the witness
 * can compare two rendered magnitudes numerically.
 */
function parseDurationText(text: string): number {
	const cleaned = text.replace(/[^0-9hms ]/g, "").trim()
	const minutes = /(\d+)m/.exec(cleaned)
	const seconds = /(\d+)s/.exec(cleaned)
	const hours = /(\d+)h/.exec(cleaned)
	return (
		(hours ? Number(hours[1]) * 3_600_000 : 0) +
		(minutes ? Number(minutes[1]) * 60_000 : 0) +
		(seconds ? Number(seconds[1]) * 1_000 : 0)
	)
}

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (CORRECTION-01) / replacement-snapshot anchor", () => {
	let currentTime = PUBLISHED_AT

	beforeEach(() => {
		currentTime = PUBLISHED_AT
		vi.useFakeTimers()
		vi.setSystemTime(currentTime)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("W2-COMPONENT-1 [REAL_PRODUCTION_SEAM]: a REPLACEMENT publication with the SAME (taskId, elapsedMs, phase) triple is NOT extrapolated from the previous anchor", async () => {
		const { rerender } = render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					// The FIRST publication.
					duration: snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000, publicationId: 1 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(0)
		})

		// Time passes: the quiet gate advances.
		currentTime = PUBLISHED_AT + 30_000
		await act(async () => {
			vi.setSystemTime(currentTime)
			vi.advanceTimersByTime(1_000)
		})
		const duringGate = screen.getByTestId("task-header-duration-waiting").textContent ?? ""
		// 10 000 + 30 000 + the presentation tick = 41 000 -> "41s".
		expect(duringGate).toContain("41s")

		// A REPLACEMENT publication arrives. It carries the SAME
		// (taskId, elapsedMs, phase) triple — only the coverage changed —
		// so the pre-repair identity did NOT change and the anchor was
		// NOT reset. The replacement was therefore extrapolated from the
		// PREVIOUS publication's anchor.
		//
		// The host's PUBLICATION IDENTITY changed, so the replacement
		// re-anchors at ITS OWN publication time.
		currentTime = PUBLISHED_AT + 60_000
		await act(async () => {
			vi.setSystemTime(currentTime)
		})
		rerender(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({
						phase: "waiting",
						elapsedMs: 10_000,
						activeMs: 0,
						waitingMs: 10_000,
						coverage: "partial",
						publicationId: 2,
					}),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(1_000)
		})

		// The REPLACEMENT is anchored at its OWN publication time: the
		// projection is the replacement snapshot plus the time since the
		// replacement was published. With the OLD anchor it would have
		// been 10 000 + 60 000 = 70 000 -> "1m 10s".
		const shown = screen.getByTestId("task-header-duration-waiting").textContent ?? ""
		expect(shown).not.toContain("1m")
		expect(parseDurationText(shown)).toBeLessThan(parseDurationText("1m 10s"))
	})

	it("W2-COMPONENT-2 [REAL_PRODUCTION_SEAM]: a REPLACEMENT without a publication identity is still distinguished by its CONTENT", async () => {
		const { rerender } = render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(0)
		})

		currentTime = PUBLISHED_AT + 30_000
		await act(async () => {
			vi.setSystemTime(currentTime)
			vi.advanceTimersByTime(1_000)
		})

		// A REPLACEMENT with the SAME triple but a different coverage and
		// NO publication identity (an older host).
		currentTime = PUBLISHED_AT + 60_000
		await act(async () => {
			vi.setSystemTime(currentTime)
		})
		rerender(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({
						phase: "waiting",
						elapsedMs: 10_000,
						activeMs: 0,
						waitingMs: 10_000,
						coverage: "partial",
					}),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(1_000)
		})

		const shown = screen.getByTestId("task-header-duration-waiting").textContent ?? ""
		// The replacement re-anchored: it is NOT the old anchor's
		// extrapolation ("1m 10s").
		expect(shown).not.toContain("1m")
	})

	it("W2-COMPONENT-3 [REAL_PRODUCTION_SEAM]: the SAME publication keeps its anchor across a re-render", async () => {
		const { rerender } = render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000, publicationId: 7 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(0)
		})

		currentTime = PUBLISHED_AT + 30_000
		await act(async () => {
			vi.setSystemTime(currentTime)
			vi.advanceTimersByTime(1_000)
		})
		const first = screen.getByTestId("task-header-duration-waiting").textContent ?? ""

		// A RE-RENDER of the SAME publication (identical content, the
		// SAME publication identity) must NOT re-anchor — otherwise the
		// quiet gate would restart on every unrelated state push.
		currentTime = PUBLISHED_AT + 40_000
		await act(async () => {
			vi.setSystemTime(currentTime)
		})
		rerender(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000, publicationId: 7 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(1_000)
		})

		const second = screen.getByTestId("task-header-duration-waiting").textContent ?? ""
		// The anchor was KEPT: the projection kept advancing from the
		// original publication (10 000 + 40 000 + the presentation tick =
		// 51 000 -> "51s"), it did not restart from 10 000 ("11s").
		expect(second).toContain("51s")
		expect(second).not.toContain("11s")
		expect(parseDurationText(second)).toBeGreaterThan(parseDurationText(first))
	})

	it("W2-COMPONENT-4 [REAL_PRODUCTION_SEAM]: the five-minute clamp and the estimated marker are RETAINED", async () => {
		render(
			<TaskHeaderTelemetry
				taskHeaderPresentation={undefined}
				telemetry={{
					startedAt: PUBLISHED_AT,
					toolCalls: 0,
					recoveryBudgetFailures: 0,
					duration: snapshot({ phase: "waiting", elapsedMs: 10_000, activeMs: 0, waitingMs: 10_000, publicationId: 1 }),
				}}
				turnState={{ phase: "awaiting_followup", seq: 1 }}
			/>,
		)
		await act(async () => {
			vi.advanceTimersByTime(0)
		})

		currentTime = PUBLISHED_AT + BOUND + 30_000
		await act(async () => {
			vi.setSystemTime(currentTime)
			vi.advanceTimersByTime(1_000)
		})

		// The value is CLAMPED at the bound (10s snapshot + 5m bound) and
		// explicitly marked as estimated.
		const shown = screen.getByTestId("task-header-duration-waiting").textContent ?? ""
		expect(shown).toContain("5m 10s")
		expect(screen.queryByTestId("task-header-duration-estimated")).not.toBeNull()
	})
})

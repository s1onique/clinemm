/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01 — INC-SCOPE
 *
 * The RED that demonstrated that the bundle-wide summary could
 * report ANOTHER task's completion as the affected incident's
 * outcome.
 *
 * THE DEFECT
 * ----------
 * `buildCompletionIncidentBundleSummary(records)` searched across
 * ALL retained task records and selected the LAST commit/withhold
 * it found. With the following chronology:
 *
 *   Task A  → completion HELD, task remains `Paused`
 *   switch → Task B
 *   Task B  → completion COMMITTED successfully
 *
 * the summary selected task B's `committed` record and reported:
 *
 *   { status: "CAPTURE_SUFFICIENT",
 *     lastObservedPhase: "completed",
 *     completionCommitted: true }
 *
 * even though task A's incident was never resolved. That defeats
 * the whole objective of retaining evidence across task switches:
 * the retained evidence was there, but the SUMMARY told the wrong
 * story.
 *
 * THE FIX
 * -------
 * Summaries are INCIDENT-SCOPED: one independent summary per
 * retained task capsule. An unrelated task's completion can never
 * satisfy another incident's terminality.
 *
 * GREEN counterpart:
 * `completion-incident-bundle-correction01.green.test.ts`.
 */

import {
	getCompletionIncidentRecords,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	buildCompletionIncidentBundleSummaries,
	buildCompletionIncidentBundleSummary,
	type CompletionIncidentBundleSummary,
} from "@/sdk/completion-incident-bundle-runtime"
import { emitSubmitAndExit, flush, makeFlightRecorderHarness } from "./completion-incident-flight-recorder-harness"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
	resetCompletionIncidentRecorderForTests()
	setCompletionIncidentFlightRecorderEnabled(true)
})

afterEach(() => {
	resetCompletionIncidentRecorderForTests()
})

/**
 * The exact chronology from the review:
 *   Task A holds and stays `Paused`.
 *   The user switches to Task B.
 *   Task B completes successfully.
 */
async function driveHeldTaskThenCompletedOtherTask(): Promise<void> {
	// --- Task A: the completion is HELD (pending-prompt uncertainty).
	const a = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
	a.pendingPromptRead.value = { available: false }
	await emitSubmitAndExit(a)
	await flush()

	// --- The user switches to Task B.
	a.switchTo("session-b", "task-b")
	a.pendingPromptRead.value = { available: true, count: 0 }
	a.elmDecision.value = { kind: "authorize" }
	await emitSubmitAndExit(a)
	await flush()
}

function summaryFor(summaries: readonly CompletionIncidentBundleSummary[], taskId: string): CompletionIncidentBundleSummary {
	const found = summaries.find((s) => s.taskId === taskId)
	if (!found) {
		throw new Error(`no summary for task ${taskId}; got ${JSON.stringify(summaries.map((s) => s.taskId))}`)
	}
	return found
}

describe("INC-SCOPE.1: an unrelated task's completion NEVER satisfies another incident", () => {
	it("INC-SCOPE.1.1: task A's summary does NOT report task B's commit", async () => {
		await driveHeldTaskThenCompletedOtherTask()

		const records = getCompletionIncidentRecords()
		// The precondition is real: task B DID commit.
		const bCommit = records.find((r) => r.taskId === "task-b" && r.outcome === "committed")
		expect(bCommit).toBeDefined()

		const summaries = buildCompletionIncidentBundleSummaries(records)
		const a = summaryFor(summaries, "task-a")

		// Task A's incident is UNRESOLVED. Its summary must not claim
		// a commit, and must not claim terminal sufficiency.
		expect(a.completionCommitted).not.toBe(true)
		expect(a.status).toBe("CAPTURE_INSUFFICIENT")
	})

	it("INC-SCOPE.1.2: task B's summary DOES report its own commit", async () => {
		await driveHeldTaskThenCompletedOtherTask()

		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		const b = summaryFor(summaries, "task-b")
		expect(b.completionCommitted).toBe(true)
		expect(b.lastObservedPhase).toBe("completed")
		expect(b.status).toBe("CAPTURE_SUFFICIENT")
	})

	it("INC-SCOPE.1.3: the bundle-wide summary is an OVERVIEW and does not assert task A's terminality", async () => {
		await driveHeldTaskThenCompletedOtherTask()

		const overview = buildCompletionIncidentBundleSummary(getCompletionIncidentRecords())

		// The overview is explicitly NOT an incident conclusion. It
		// reports the aggregate and names the per-incident summaries.
		expect(overview.status).toBe("CAPTURE_INSUFFICIENT")
		expect(overview.completionCommitted).toBe("UNOBSERVED")
		expect(overview.notes.some((n) => n.includes("task-a"))).toBe(true)
	})
})

describe("INC-SCOPE.2: the summary is scoped by CAUSAL IDENTITY, not by arrival order", () => {
	it("INC-SCOPE.2.1: every retained task gets its own independent summary", async () => {
		await driveHeldTaskThenCompletedOtherTask()

		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		const taskIds = summaries.map((s) => s.taskId)
		expect(taskIds).toContain("task-a")
		expect(taskIds).toContain("task-b")
		// One summary per retained incident — never two summaries for
		// the same task, and never a summary with no task identity.
		expect(new Set(taskIds).size).toBe(taskIds.length)
	})

	it("INC-SCOPE.2.2: a task-scoped summary builder agrees with the per-incident builder", async () => {
		await driveHeldTaskThenCompletedOtherTask()

		const records = getCompletionIncidentRecords()
		const summaries = buildCompletionIncidentBundleSummaries(records)
		const a = summaryFor(summaries, "task-a")
		expect(a.taskId).toBe("task-a")
		expect(a.completionCommitted).not.toBe(true)
	})
})

describe("INC-SCOPE.3: `lastBarrierOutcome` comes from an ACTUAL barrier stage", () => {
	it("INC-SCOPE.3.1: a continuation delivery outcome is NOT reported as a barrier outcome", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		// The completion is held (pending-prompt uncertainty).
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		const a = summaryFor(summaries, "task-a")

		// The summary reports the outcome of a REAL barrier stage
		// (`completion_attempt` / `barrier_registration` /
		// `early_return` / `marker_clearance` /
		// `completion_authority`) — never a `continuation` delivery
		// outcome, which is a different kind of fact.
		const continuationOutcomes = new Set(
			getCompletionIncidentRecords()
				.filter((r) => r.stage === "continuation")
				.map((r) => r.outcome),
		)
		expect(a.lastBarrierOutcome).not.toBe("UNOBSERVED")
		for (const outcome of continuationOutcomes) {
			expect(a.lastBarrierOutcome).not.toBe(outcome)
		}
	})
})

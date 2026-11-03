/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02 — LIFECYCLE SCOPE
 *
 * The RED that demonstrated that a task-scoped summary still mixed
 * DIFFERENT COMPLETION LIFECYCLES of the SAME task.
 *
 * THE DEFECT
 * ----------
 * `buildCompletionIncidentBundleSummaries()` grouped records by
 * `taskId` ONLY, and `buildIncidentSummary()` selected the LAST
 * `committed` / `withheld` record ANYWHERE in that task's history.
 *
 * Within ONE task, a task can go through MULTIPLE completion
 * lifecycles. Each lifecycle is a distinct barrier obligation,
 * identified by `(sessionId, taskId, epoch)` — the same key the
 * recorder uses to mint `barrierId`.
 *
 * Consider this chronology for a SINGLE task:
 *
 *   Task A, epoch 10 → the completion COMMITs (lifecycle 1 done)
 *   Task A, epoch 11 → the completion is HELD (lifecycle 2 unresolved)
 *
 * The summary for task A reported:
 *
 *   { status: "CAPTURE_SUFFICIENT",
 *     lastObservedPhase: "resumable",
 *     completionCommitted: true }
 *
 * The `true` belongs to epoch 10. The `resumable` phase belongs to
 * epoch 11. The summary MIXED two lifecycles — the SAME wrong-
 * terminal-outcome defect that CORRECTION01 fixed ACROSS tasks,
 * reintroduced WITHIN one task.
 *
 * THE FIX
 * -------
 * Terminality is scoped to the SELECTED completion lifecycle
 * (`barrierId` / epoch), never to the whole task history. When a
 * task contains several completion attempts, EACH lifecycle keeps
 * its own outcome.
 *
 * GREEN counterpart:
 * `completion-incident-bundle-correction02.lifecycle-scope.green.test.ts`.
 */

import {
	getCompletionIncidentRecords,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	buildCompletionIncidentBundleSummaries,
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
 * The exact chronology from the review, inside ONE task:
 *   epoch N   → the completion COMMITs
 *   epoch N+1 → the completion is HELD (resumable)
 *
 * Both lifecycles belong to the SAME task, so the task-scoped
 * grouping cannot separate them — only the LIFECYCLE key can.
 */
async function driveCommitThenHoldInSameTask(): Promise<void> {
	const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })

	// --- Lifecycle 1 (epoch N): the completion COMMITs.
	h.elmDecision.value = { kind: "authorize" }
	h.pendingPromptRead.value = { available: true, count: 0 }
	await emitSubmitAndExit(h)
	await flush()

	// --- The task advances to a NEW epoch: a NEW completion lifecycle.
	h.translatorState.getMinter().bumpEpoch()

	// --- Lifecycle 2 (epoch N+1): the completion is HELD.
	h.elmDecision.value = { kind: "hold", reason: "second-lifecycle-held" }
	h.pendingPromptRead.value = { available: false }
	await emitSubmitAndExit(h)
	await flush()
}

/**
 * The summary of the LATEST lifecycle of a task.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
 * A task can have SEVERAL completion lifecycles, so a task id is
 * NOT a unique summary key any more. The lifecycle is identified by
 * its epoch (and its barrier id).
 */
function latestLifecycleSummary(
	summaries: readonly CompletionIncidentBundleSummary[],
	taskId: string,
): CompletionIncidentBundleSummary {
	const forTask = summaries.filter((s) => s.taskId === taskId)
	if (forTask.length === 0) {
		throw new Error(`no summary for task ${taskId}; got ${JSON.stringify(summaries.map((s) => s.taskId))}`)
	}
	return forTask.reduce((latest, s) => ((s.epoch as number) > (latest.epoch as number) ? s : latest))
}

describe("LIFECYCLE-SCOPE.1: a later lifecycle NEVER inherits an earlier lifecycle's commit", () => {
	it("LIFECYCLE-SCOPE.1.1: the epoch N+1 hold is NOT reported as committed", async () => {
		await driveCommitThenHoldInSameTask()

		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		const latest = latestLifecycleSummary(summaries, "task-a")

		// The LATEST lifecycle (epoch N+1) was HELD. It must NOT
		// inherit epoch N's `committed` outcome.
		expect(latest.completionCommitted).not.toBe(true)
	})

	it("LIFECYCLE-SCOPE.1.2: the latest lifecycle reports UNOBSERVED, not the older commit", async () => {
		await driveCommitThenHoldInSameTask()

		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		const latest = latestLifecycleSummary(summaries, "task-a")

		// The second lifecycle was HELD by the BCB BEFORE the Elm
		// authority was consulted, so no commit/withhold was ever
		// recorded for it. The ACT's honesty rule forbids inferring
		// "not committed" from that silence — the summary reports
		// `UNOBSERVED` for THIS lifecycle, and NEVER the older
		// lifecycle's `true`.
		expect(latest.completionCommitted).toBe("UNOBSERVED")
		expect(latest.status).toBe("CAPTURE_INSUFFICIENT")
	})

	it("LIFECYCLE-SCOPE.1.3: the summary's phase belongs to the SAME lifecycle as its outcome", async () => {
		await driveCommitThenHoldInSameTask()

		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		const latest = latestLifecycleSummary(summaries, "task-a")

		// The held lifecycle published `resumable`. The `completed`
		// phase belongs to the OLDER, committed lifecycle — the
		// summary must not mix them.
		expect(latest.lastObservedPhase).not.toBe("completed")
		expect(latest.lastObservedPhase).toBe("resumable")
	})
})

describe("LIFECYCLE-SCOPE.2: each lifecycle keeps its OWN outcome", () => {
	it("LIFECYCLE-SCOPE.2.1: both lifecycles are reported separately", async () => {
		await driveCommitThenHoldInSameTask()

		const records = getCompletionIncidentRecords()
		const taskARecords = records.filter((r) => r.taskId === "task-a")
		const barrierIds = [...new Set(taskARecords.map((r) => r.barrierId))]
		// The two lifecycles are distinct barrier obligations.
		expect(barrierIds.length).toBeGreaterThanOrEqual(2)

		const summaries = buildCompletionIncidentBundleSummaries(records)
		const forTaskA = summaries.filter((s) => s.taskId === "task-a")
		// One summary per LIFECYCLE, not one per task.
		expect(forTaskA.length).toBeGreaterThanOrEqual(2)

		// The committed lifecycle reports `true` and its own phase.
		const committed = forTaskA.find((s) => s.completionCommitted === true)
		expect(committed).toBeDefined()
		expect(committed?.lastObservedPhase).toBe("completed")

		// The held lifecycle reports ITS OWN outcome — it does NOT
		// inherit the commit, and its phase is its own.
		const held = forTaskA.find((s) => s.completionCommitted !== true)
		expect(held).toBeDefined()
		expect(held?.lastObservedPhase).toBe("resumable")
		expect(held?.status).toBe("CAPTURE_INSUFFICIENT")
	})

	it("LIFECYCLE-SCOPE.2.2: each summary carries its own lifecycle identity", async () => {
		await driveCommitThenHoldInSameTask()

		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		const forTaskA = summaries.filter((s) => s.taskId === "task-a")

		// Every lifecycle summary names the lifecycle it describes.
		for (const summary of forTaskA) {
			expect(summary.barrierId).not.toBe("UNOBSERVED")
			expect(typeof summary.epoch).toBe("number")
		}
		// The two lifecycles are distinguishable by BOTH their barrier
		// id and their epoch.
		expect(new Set(forTaskA.map((s) => s.barrierId)).size).toBe(forTaskA.length)
		expect(new Set(forTaskA.map((s) => s.epoch)).size).toBe(forTaskA.length)
	})
})

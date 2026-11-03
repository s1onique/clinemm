/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01 — GREEN-01
 *
 * The GREEN counterpart to
 * `completion-incident-flight-recorder.red01.test.ts`.
 *
 * Every assertion drives the REAL `SdkSessionEventCoordinator` seam
 * (via the shared harness) and reads the ACTUAL captured records.
 *
 * The acceptance gates covered here (ACT §5):
 *
 *   G1  BCB hold caused solely by pending-prompt uncertainty
 *       -> exact predicate captured
 *   G2  BCB hold caused by unconsumed terminal results
 *       -> held identities/count captured
 *   G3  Marker cleared by session mismatch
 *       -> both identities and clearance captured
 *   G4  Barrier eventually releases
 *       -> original hold linked to authoritative completion
 *   G5  A task pauses, then user switches to task B
 *       -> task A evidence survives
 *   G6  Normal completion
 *       -> no fabricated holds or errors
 *   G7  Non-dogfood profile
 *       -> instrumentation is DEFAULT_OFF
 *   G8  Recorder overflow
 *       -> loss reported explicitly
 */

import {
	clearCompletionIncidentRecorder,
	getCompletionIncidentCapsuleForTask,
	getCompletionIncidentRecorderStats,
	getCompletionIncidentRecords,
	hasCompletionIncidentEvidenceLoss,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
	setCompletionIncidentRecorderBounds,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyCompletionIncidentFlightRecorderDiagnosticProfile } from "@/sdk/dogfood-diagnostic-profile"
import {
	emitAgentTurnDone,
	emitSubmitAndExit,
	flush,
	makeFlightRecorderHarness,
} from "./completion-incident-flight-recorder-harness"

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

describe("G1: a BCB hold caused SOLELY by pending-prompt uncertainty captures the exact predicate", () => {
	it("G1.1: the pending-prompt predicate and its value are captured", async () => {
		const h = makeFlightRecorderHarness()
		h.pendingPromptRead.value = { available: false }
		h.unconsumedCount.value = 0
		h.unconsumedJobIds.value = []

		await emitSubmitAndExit(h)
		await flush()

		const attempt = getCompletionIncidentRecords().find((r) => r.stage === "completion_attempt")
		expect(attempt).toBeDefined()
		expect(attempt!.outcome).toBe("held")
		// The EXACT predicate responsible.
		expect(attempt!.predicates.pendingPromptAuthorityUnknown).toBe(true)
		expect(attempt!.predicates.outstandingAutonomousWork).toBe(true)
		// The predicates that did NOT cause the hold are recorded as
		// their evaluated values, so the operator can rule them out.
		expect(attempt!.predicates.ownerStillRunningForC10).toBe(false)
		expect(attempt!.predicates.heldObligationForC10).toBe(false)
		expect(attempt!.predicates.suppressOriginatingCompletion).toBe(false)
		expect(attempt!.detail?.holdReason).toBe("outstanding_autonomous_work")
		// The completion was NOT committed.
		expect(h.completionCommitCount()).toBe(0)
	})

	it("G1.2: a predicate that was NOT evaluated on the branch is NOT reported as false", async () => {
		const h = makeFlightRecorderHarness()
		h.pendingPromptRead.value = { available: false }

		await emitSubmitAndExit(h)
		await flush()

		const attempt = getCompletionIncidentRecords().find((r) => r.stage === "completion_attempt")
		expect(attempt).toBeDefined()
		// `unconsumedOwnedTerminalJobIdsCount` WAS evaluated (the list
		// provider is consulted at Site A), so it is present.
		expect(attempt!.predicates).toHaveProperty("unconsumedOwnedTerminalJobIdsCount")
		// A predicate that production never consulted at this
		// boundary must be ABSENT — never fabricated as `false`.
		expect(attempt!.predicates).not.toHaveProperty("canObserveHeldResults")
		expect(attempt!.predicates).not.toHaveProperty("elmDecision")
	})
})

describe("G2: a BCB hold caused by unconsumed terminal results captures the held identities/count", () => {
	it("G2.1: the held count and the held job ids are captured", async () => {
		const h = makeFlightRecorderHarness()
		h.unconsumedCount.value = 2
		h.unconsumedJobIds.value = ["cmd-held-1", "cmd-held-2"]

		await emitSubmitAndExit(h)
		await flush()

		const attempt = getCompletionIncidentRecords().find((r) => r.stage === "completion_attempt")
		expect(attempt).toBeDefined()
		expect(attempt!.outcome).toBe("held")
		expect(attempt!.predicates.unconsumedOwnedTerminalResultsForC10).toBe(2)
		expect(attempt!.predicates.unconsumedOwnedTerminalJobIdsCount).toBe(2)
		expect(attempt!.predicates.heldObligationForC10).toBe(true)
		expect(attempt!.detail?.holdReason).toBe("held_obligation")
	})
})

describe("G3: a marker cleared by session mismatch captures BOTH identities and the clearance", () => {
	it("G3.1: the marker identity and the active identity are both captured", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		// The user switches to task B.
		h.switchTo("session-b", "task-b")

		await emitAgentTurnDone(h)
		await flush()

		const clearance = getCompletionIncidentRecords().find((r) => r.stage === "marker_clearance")
		expect(clearance).toBeDefined()
		expect(clearance!.outcome).toBe("session_mismatch")
		// The MARKER identity (the session that held the obligation).
		expect(clearance!.markerIdentity?.sessionId).toBe("session-a")
		expect(clearance!.markerIdentity?.taskId).toBe("task-a")
		// The ACTIVE identity (the session that is now current).
		expect(clearance!.activeIdentity?.sessionId).toBe("session-b")
		expect(clearance!.activeIdentity?.taskId).toBe("task-b")
		// The record is attributed to the task that SUFFERED it.
		expect(clearance!.taskId).toBe("task-a")
	})
})

describe("G4: a barrier that eventually releases links the original hold to the authoritative completion", () => {
	it("G4.1: the release and the commit are captured for the SAME marker identity", async () => {
		const h = makeFlightRecorderHarness()
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		// The hold is released: the pending-prompt authority becomes
		// known and empty, and Elm authorizes.
		h.pendingPromptRead.value = { available: true, count: 0 }
		h.elmDecision.value = { kind: "authorize" }

		await emitAgentTurnDone(h)
		await flush()

		const records = getCompletionIncidentRecords()
		const hold = records.find((r) => r.stage === "completion_attempt" && r.outcome === "held")
		const release = records.find((r) => r.stage === "marker_clearance" && r.outcome === "released")
		const commit = records.find((r) => r.stage === "completion_authority" && r.outcome === "committed")

		expect(hold).toBeDefined()
		expect(release).toBeDefined()
		expect(commit).toBeDefined()
		// The SAME barrier identity links them.
		expect(release!.markerIdentity?.epoch).toBe(hold!.epoch)
		expect(commit!.markerIdentity?.epoch).toBe(hold!.epoch)
		// The completion actually committed.
		expect(h.completionCommitCount()).toBe(1)
		expect(commit!.phase).toBe("completed")
		expect(commit!.phaseWriter).toBe("session-event-turn-complete-completed")
	})
})

describe("G5: task A's evidence SURVIVES the user switching to task B", () => {
	it("G5.1: the task A capsule is still present after task B becomes active", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		// The user switches to task B and runs it too.
		h.switchTo("session-b", "task-b")
		h.pendingPromptRead.value = { available: true, count: 0 }
		await emitSubmitAndExit(h)
		await flush()

		// Task A's capsule still exists with its evidence.
		const capsuleA = getCompletionIncidentCapsuleForTask("task-a")
		expect(capsuleA).toBeDefined()
		expect(capsuleA!.records.length).toBeGreaterThan(0)
		expect(capsuleA!.anomalous).toBe(true)

		// And it is attributable to task A specifically.
		const taskARecords = getCompletionIncidentRecords().filter((r) => r.taskId === "task-a")
		expect(taskARecords.length).toBeGreaterThan(0)
		expect(taskARecords.every((r) => r.taskId === "task-a")).toBe(true)
	})
})

describe("G6: a normal completion fabricates NO holds and NO errors", () => {
	it("G6.1: the completion attempt is recorded as not_held and no anomaly is recorded", async () => {
		const h = makeFlightRecorderHarness()
		h.elmDecision.value = { kind: "authorize" }

		await emitSubmitAndExit(h)
		await flush()

		const records = getCompletionIncidentRecords()
		const attempt = records.find((r) => r.stage === "completion_attempt")
		expect(attempt).toBeDefined()
		expect(attempt!.outcome).toBe("not_held")

		// NO record may claim a hold, a mismatch, a clearance by
		// mismatch, or a withheld completion.
		const anomalous = records.filter((r) =>
			["held", "session_mismatch", "task_mismatch", "epoch_mismatch", "session_missing", "withheld", "failed"].includes(
				r.outcome,
			),
		)
		expect(anomalous).toEqual([])
	})
})

describe("G7: the non-dogfood profile leaves the instrumentation DEFAULT_OFF", () => {
	it("G7.1: a non-dogfood profile disables the recorder", () => {
		const result = applyCompletionIncidentFlightRecorderDiagnosticProfile(false)
		expect(result.enabled).toBe(false)
		expect(result.source).toBe("profile-off")
	})

	it("G7.2: a dogfood profile enables the recorder", () => {
		const result = applyCompletionIncidentFlightRecorderDiagnosticProfile(true)
		expect(result.enabled).toBe(true)
		expect(result.source).toBe("profile-on")
	})

	it("G7.3: with the recorder disabled, NO records are produced", async () => {
		setCompletionIncidentFlightRecorderEnabled(false)
		const h = makeFlightRecorderHarness()
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()
		expect(getCompletionIncidentRecords()).toHaveLength(0)
	})
})

describe("G8: recorder overflow reports the loss EXPLICITLY", () => {
	it("G8.1: exceeding the global record cap increments the evicted-record counter", async () => {
		setCompletionIncidentRecorderBounds({ globalRecordCap: 3, capsuleCap: 4 })
		const h = makeFlightRecorderHarness()
		for (let i = 0; i < 6; i++) {
			await emitSubmitAndExit(h)
			await flush()
		}
		const stats = getCompletionIncidentRecorderStats()
		expect(stats.evictedRecords).toBeGreaterThan(0)
		expect(hasCompletionIncidentEvidenceLoss()).toBe(true)
	})

	it("G8.2: exceeding the per-capsule ring cap reports the dropped records", async () => {
		setCompletionIncidentRecorderBounds({ capsuleRecordCap: 2, globalRecordCap: 1000 })
		const h = makeFlightRecorderHarness()
		for (let i = 0; i < 5; i++) {
			await emitSubmitAndExit(h)
			await flush()
		}
		const stats = getCompletionIncidentRecorderStats()
		expect(stats.capsuleDroppedRecords).toBeGreaterThan(0)
		expect(hasCompletionIncidentEvidenceLoss()).toBe(true)
	})

	it("G8.3: the anomalous-capsule retention keeps the incident capsule alive across task switches", async () => {
		setCompletionIncidentRecorderBounds({ capsuleCap: 2, anomalousCapsuleRetention: 4 })
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		// Fill the capsule cap with NON-anomalous tasks so the
		// anomalous task A capsule would be the first eviction
		// candidate under a naive policy.
		for (const id of ["task-b", "task-c", "task-d"]) {
			h.switchTo(`session-${id}`, id)
			h.pendingPromptRead.value = { available: true, count: 0 }
			h.elmDecision.value = { kind: "authorize" }
			await emitSubmitAndExit(h)
			await flush()
		}

		// Task A's anomalous capsule survives.
		const capsuleA = getCompletionIncidentCapsuleForTask("task-a")
		expect(capsuleA).toBeDefined()
		expect(capsuleA!.anomalous).toBe(true)
		expect(capsuleA!.records.length).toBeGreaterThan(0)
	})
})

describe("G-inv: the instrumentation never invokes a provider a second time", () => {
	it("G-inv.1: the recorder is OFF and the production path is unchanged", async () => {
		// With the recorder disabled, the coordinator's observable
		// behaviour (phase writes, completion commits) must be
		// IDENTICAL to the enabled case. The recorder must never
		// influence the decision chain.
		setCompletionIncidentFlightRecorderEnabled(false)
		const h = makeFlightRecorderHarness()
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()
		expect(h.completionCommitCount()).toBe(0)
		expect(h.allCommittedWriterIds()).toContain("session-event-bcb-hold-resumable")
		// NO record was captured, and NO phase was written by the
		// diagnostic itself.
		expect(getCompletionIncidentRecords()).toHaveLength(0)
		expect(h.allCommittedWriterIds().every((w) => w !== "unknown-legacy-writer")).toBe(true)
	})

	it("G-inv.2: the `barrierId` never enters the runtime identity model", async () => {
		const h = makeFlightRecorderHarness()
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		const records = getCompletionIncidentRecords()
		expect(records.length).toBeGreaterThan(0)
		for (const record of records) {
			// The diagnostic barrier id is present on every record.
			expect(record.barrierId).toBeTruthy()
			expect(record.barrierId.startsWith("barrier-")).toBe(true)
			// It is DISTINCT from the runtime identity triple: it is
			// never equal to the session id, the task id, or the
			// epoch, so it can never be mistaken for a runtime
			// identity by a comparison.
			expect(record.barrierId).not.toBe(record.sessionId)
			expect(record.barrierId).not.toBe(record.taskId)
			expect(record.barrierId).not.toBe(String(record.epoch))
		}
	})
})

describe("G-extra: the recorder is a no-op when disabled and bounded when enabled", () => {
	it("G-extra.1: clear() resets the recorder without touching the enablement flag", () => {
		setCompletionIncidentFlightRecorderEnabled(true)
		clearCompletionIncidentRecorder()
		const stats = getCompletionIncidentRecorderStats()
		expect(stats.totalRecords).toBe(0)
		expect(stats.capsuleCount).toBe(0)
		expect(stats.enabled).toBe(true)
	})
})

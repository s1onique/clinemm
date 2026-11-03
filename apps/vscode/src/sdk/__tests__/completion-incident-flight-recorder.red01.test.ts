/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01 — RED-01
 *
 * The focused RED that demonstrated the telemetry gap, and which now
 * PINS the closure of that gap.
 *
 * The gap this ACT closed:
 *
 *   "The existing BCB capture is restricted to the eligible
 *    coalesced-continuation branch. It does not record every barrier
 *    hold. The upstream counters are process-wide aggregates, so
 *    after switching tasks, we cannot reliably attribute
 *    `sessionMismatch=1` to the affected task."
 *
 * HISTORY
 * -------
 * Before the coordinator instrumentation landed, the assertions in
 * this file read `expect(records).toHaveLength(0)` — i.e. the file
 * PASSED by proving that the hold was real, invisible to the
 * existing diagnostic layer, and unattributable. That is the
 * executable proof that the gap was real and not merely
 * theoretical.
 *
 * Now that the flight recorder observes the decision boundaries,
 * the SAME scenarios assert the OPPOSITE: the hold IS recorded, and
 * the mismatch IS attributable to a specific task. This file is the
 * regression guard for that closure — if the instrumentation is
 * removed or weakened, these assertions fail again.
 *
 * The GREEN counterpart is
 * `completion-incident-flight-recorder.green01.test.ts`.
 */

import {
	clearBcbObservationUnavailableCapture,
	disableBcbObservationUnavailableCapture,
	getBcbObservationUnavailableCaptureRecords,
} from "@shared/bcb-observation-unavailable-capture"
import {
	getCompletionIncidentRecords,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
	disableBcbObservationUnavailableCapture()
	clearBcbObservationUnavailableCapture()
	resetCompletionIncidentRecorderForTests()
	setCompletionIncidentFlightRecorderEnabled(true)
})

afterEach(() => {
	disableBcbObservationUnavailableCapture()
	clearBcbObservationUnavailableCapture()
	resetCompletionIncidentRecorderForTests()
})

describe("RED-01: the telemetry gap this ACT closed stays closed", () => {
	it("RED-01.1: a pending-prompt-uncertainty hold is now captured even though it is NOT in the eligible branch", async () => {
		const h = makeFlightRecorderHarness()
		// The pending-prompt authority is UNKNOWN — this is the
		// `pendingPromptAuthorityUnknown` conjunct of the BCB hold.
		h.pendingPromptRead.value = { available: false }
		// NOTE: no unconsumed terminal results → the hold is NOT in
		// the eligible coalesced-continuation branch.
		h.unconsumedCount.value = 0
		h.unconsumedJobIds.value = []

		await emitSubmitAndExit(h)
		await flush()

		// The EXISTING BCB capture STILL does not fire — it remains
		// restricted to the eligible coalesced-continuation branch.
		// That restriction is unchanged by this ACT (the ACT adds
		// coverage; it does not change the existing diagnostic).
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(0)

		// The completion was HELD (no `completed` phase write).
		expect(h.completionCommitCount()).toBe(0)

		// THE GAP IS CLOSED: the flight recorder captures the hold
		// with the exact predicate that caused it.
		const records = getCompletionIncidentRecords()
		const attempt = records.find((r) => r.stage === "completion_attempt")
		expect(attempt).toBeDefined()
		expect(attempt!.outcome).toBe("held")
		expect(attempt!.predicates.pendingPromptAuthorityUnknown).toBe(true)
	})

	it("RED-01.2: a session mismatch is now attributable to the task that suffered it", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		h.unconsumedCount.value = 0

		await emitSubmitAndExit(h)
		await flush()

		// The user switches to task B.
		h.switchTo("session-b", "task-b")
		await emitAgentTurnDone(h)
		await flush()

		// THE GAP IS CLOSED: the mismatch is attributed to task A, and
		// BOTH identities are captured.
		const records = getCompletionIncidentRecords()
		const clearance = records.find((r) => r.stage === "marker_clearance")
		expect(clearance).toBeDefined()
		expect(clearance!.outcome).toBe("session_mismatch")
		expect(clearance!.taskId).toBe("task-a")
		expect(clearance!.markerIdentity?.sessionId).toBe("session-a")
		expect(clearance!.activeIdentity?.sessionId).toBe("session-b")
	})
})

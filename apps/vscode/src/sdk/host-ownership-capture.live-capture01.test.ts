/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION02
 *
 * Tests for the synchronized capture helper. SYNCHRONOUS end-to-end:
 * the helper does NOT return a Promise and the probe is NOT async.
 *
 * Verifies:
 *
 *   - no-op when diagnostic disabled (sync),
 *   - no-op emits correlated unavailable row when activeSession absent
 *     (CORRECTION02 P1 fix),
 *   - correlated unavailable row when probe is absent,
 *   - correlated unavailable row when probe has no readHostFacts,
 *   - exact five-field identity roundtrip through real sync helper,
 *   - observationAvailable=true + candidateAwaitingFollowup on success,
 *   - captureFromActiveSession passes the activeSession.sdkHost as probe,
 *   - **TEMPORAL BINDING**: probe mutation is observed before helper
 *     returns -- NO microtask boundary between identity stamp and
 *     host-facts read (CORRECTION02 P0 #1 closure).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest"
import {
	disableHostOwnershipDiagnostic,
	enableHostOwnershipDiagnostic,
	isHostOwnershipDiagnosticEnabled,
	clearHostOwnershipDiagnostic,
	getHostOwnershipDiagnostic,
} from "@/shared/host-ownership-diagnostic"
import {
	captureAndRecordHostOwnershipFacts,
	captureFromActiveSession,
	type HostOwnershipProbe,
	type HostOwnershipHostFacts,
} from "./host-ownership-capture"
import type { ActiveSession as VscodeActiveSession } from "@/sdk/cline-session-factory"

function makeProbe(
	opts: { implements?: boolean; facts?: HostOwnershipHostFacts } = { implements: true },
): HostOwnershipProbe {
	if (opts.implements === false) return {}
	return {
		readHostFacts: (_sessionId: string | undefined) =>
			opts.facts ?? {
				lastInteractiveTurnFinishReason: "completed",
				sessionStatus: "idle",
				pendingPromptCount: 0,
				drainingPendingPrompts: false,
				agentCanStartRun: true,
			},
	}
}

describe("ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION02 / captureAndRecordHostOwnershipFacts", () => {
	beforeEach(() => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})
	afterEach(() => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})

	it("SYNCHRONOUS signature: returns void, not Promise", () => {
		enableHostOwnershipDiagnostic()
		const result = captureAndRecordHostOwnershipFacts({
			stateVersion: 1,
			sessionId: "s1",
			sessionIsRunning: false,
			probe: makeProbe(),
		})
		expect(result).toBeUndefined()
		// Type-level assertion: the function signature MUST NOT be a Promise
		// type. If a future change accidentally re-adds `async`/`Promise`,
		// this test should still compile (TypeScript would catch the wrong
		// type) but the structural expectation is explicit.
	})

	it("no-op when diagnostic disabled", () => {
		captureAndRecordHostOwnershipFacts({
			stateVersion: 100,
			_ptadPushId: 5,
			sessionId: "s1",
			sessionIsRunning: false,
			probe: makeProbe(),
		})
		expect(isHostOwnershipDiagnosticEnabled()).toBe(false)
		expect(getHostOwnershipDiagnostic()).toEqual([])
	})

	it("writes correlated unavailable row when probe is absent", () => {
		enableHostOwnershipDiagnostic()
		captureAndRecordHostOwnershipFacts({
			stateVersion: 100,
			_ptadPushId: 5,
			taskId: "task-A",
			sessionId: "s1",
			epoch: 7,
			sessionIsRunning: false,
			probe: undefined,
		})
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0].observationAvailable).toBe(false)
		expect(got[0].stateVersion).toBe(100)
		expect(got[0]._ptadPushId).toBe(5)
		expect(got[0].taskId).toBe("task-A")
		expect(got[0].sessionId).toBe("s1")
		expect(got[0].epoch).toBe(7)
		expect(got[0].lastInteractiveTurnFinishReason).toBeUndefined()
	})

	it("writes correlated unavailable row when probe has no readHostFacts method", () => {
		enableHostOwnershipDiagnostic()
		captureAndRecordHostOwnershipFacts({
			stateVersion: 100,
			_ptadPushId: 5,
			taskId: "task-A",
			sessionId: "s1",
			epoch: 7,
			sessionIsRunning: false,
			probe: makeProbe({ implements: false }),
		})
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0].observationAvailable).toBe(false)
	})

	it("exact five-field identity roundtrip through real sync helper", () => {
		enableHostOwnershipDiagnostic()
		captureAndRecordHostOwnershipFacts({
			stateVersion: 1234,
			_ptadPushId: 56,
			taskId: "task-A",
			epoch: 7,
			sessionId: "session-S",
			sessionIsRunning: true,
			probe: makeProbe(),
		})
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0].stateVersion).toBe(1234)
		expect(got[0]._ptadPushId).toBe(56)
		expect(got[0].taskId).toBe("task-A")
		expect(got[0].epoch).toBe(7)
		expect(got[0].sessionId).toBe("session-S")
	})

	it("records observationAvailable=true + candidateAwaitingFollowup on success", () => {
		enableHostOwnershipDiagnostic()
		captureAndRecordHostOwnershipFacts({
			stateVersion: 100,
			_ptadPushId: 42,
			sessionId: "s1",
			sessionIsRunning: true,
			probe: makeProbe(),
		})
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0].observationAvailable).toBe(true)
		expect(got[0].sessionIsRunning).toBe(true)
		expect(got[0].lastInteractiveTurnFinishReason).toBe("completed")
		expect(got[0].candidateAwaitingFollowup).toBe(true)
	})

	// ============================================================
	// CORRECTION02 P0 #1 closure: TEMPORAL BINDING TEST
	// ============================================================
	it("TEMPORAL BINDING: probe mutation is observed synchronously inside the helper call", () => {
		enableHostOwnershipDiagnostic()
		// The probe mutates an external marker synchronously when it is read.
		// After captureAndRecordHostOwnershipFacts returns, the marker MUST
		// already be set. If there were an `await` boundary, the marker
		// would still be `false` when the helper returns -- the next
		// microtask would set it. With synchronous capture, the marker is
		// set BEFORE the helper returns.
		let probeReadMarker = false
		const probe: HostOwnershipProbe = {
			readHostFacts: (_sessionId: string | undefined): HostOwnershipHostFacts | undefined => {
				probeReadMarker = true
				return {
					lastInteractiveTurnFinishReason: "completed",
					sessionStatus: "idle",
					pendingPromptCount: 0,
					drainingPendingPrompts: false,
					agentCanStartRun: true,
				}
			},
		}
		captureAndRecordHostOwnershipFacts({
			stateVersion: 1,
			sessionId: "s1",
			sessionIsRunning: false,
			probe,
		})
		// Marker MUST be set synchronously, before this assertion runs.
		expect(probeReadMarker).toBe(true)
		// And the record MUST already be in the ring.
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0].observationAvailable).toBe(true)
		expect(got[0].lastInteractiveTurnFinishReason).toBe("completed")
	})

	it("captureFromActiveSession: P1 fix - missing activeSession writes correlated unavailable row", () => {
		enableHostOwnershipDiagnostic()
		captureFromActiveSession(1, 5, "task-A", 7, undefined)
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0].observationAvailable).toBe(false)
		expect(got[0].stateVersion).toBe(1)
		expect(got[0]._ptadPushId).toBe(5)
		expect(got[0].taskId).toBe("task-A")
		expect(got[0].epoch).toBe(7)
		expect(got[0].sessionId).toBeUndefined()
	})

	it("captureFromActiveSession passes the activeSession.sdkHost as probe", () => {
		enableHostOwnershipDiagnostic()
		const fakeSession = {
			sessionId: "session-S",
			isRunning: true,
			sdkHost: makeProbe(),
		} as unknown as VscodeActiveSession
		captureFromActiveSession(1234, 56, "task-A", 7, fakeSession)
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0].stateVersion).toBe(1234)
		expect(got[0]._ptadPushId).toBe(56)
		expect(got[0].taskId).toBe("task-A")
		expect(got[0].epoch).toBe(7)
		expect(got[0].sessionId).toBe("session-S")
		expect(got[0].observationAvailable).toBe(true)
	})
})

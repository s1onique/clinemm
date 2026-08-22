/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01
 *
 * Tests for the synchronized capture helper. Drives the EXACT 5-field
 * identity roundtrip through the real capture path (NOT bypassing it).
 * Verifies:
 *
 *   - no-op when diagnostic disabled,
 *   - no-op when probe absent (writes correlated unavailable row)
 *   - no-op when probe.readHostFacts absent (writes correlated
 *     unavailable row),
 *   - exact five-field identity roundtrip (stateVersion + _ptadPushId +
 *     taskId + sessionId + epoch),
 *   - sessionIsRunning from the host-side mirror is included,
 *   - candidateAwaitingFollowup is stamped as DIAGNOSTIC_DERIVATION_ONLY,
 *   - captureFromActiveSession no-ops on missing activeSession,
 *   - records show observationAvailable=true on success and
 *     observationAvailable=false on absent host.
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
		readHostFacts: async (_sessionId: string | undefined) =>
			opts.facts ?? {
				lastInteractiveTurnFinishReason: "completed",
				sessionStatus: "idle",
				pendingPromptCount: 0,
				drainingPendingPrompts: false,
				agentCanStartRun: true,
			},
	}
}

describe("ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01 / captureAndRecordHostOwnershipFacts", () => {
	beforeEach(() => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})
	afterEach(() => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})

	it("no-op when diagnostic disabled", async () => {
		await captureAndRecordHostOwnershipFacts({
			stateVersion: 100,
			_ptadPushId: 5,
			sessionId: "s1",
			sessionIsRunning: false,
			probe: makeProbe(),
		})
		expect(isHostOwnershipDiagnosticEnabled()).toBe(false)
		expect(getHostOwnershipDiagnostic()).toEqual([])
	})

	it("writes correlated unavailable row when probe is absent (no probe passed)", async () => {
		enableHostOwnershipDiagnostic()
		await captureAndRecordHostOwnershipFacts({
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

	it("writes correlated unavailable row when probe has no readHostFacts method", async () => {
		enableHostOwnershipDiagnostic()
		await captureAndRecordHostOwnershipFacts({
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

	// CORRECTION01: exact five-field identity roundtrip through the REAL helper
	it("exact five-field identity roundtrip through real capture helper", async () => {
		enableHostOwnershipDiagnostic()
		await captureAndRecordHostOwnershipFacts({
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

	it("records observationAvailable=true + candidateAwaitingFollowup on success", async () => {
		enableHostOwnershipDiagnostic()
		await captureAndRecordHostOwnershipFacts({
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

	it("captureFromActiveSession no-ops on missing activeSession", async () => {
		enableHostOwnershipDiagnostic()
		await captureFromActiveSession(1, 1, undefined, undefined, undefined)
		expect(getHostOwnershipDiagnostic()).toEqual([])
	})

	it("captureFromActiveSession passes the activeSession.sdkHost as probe", async () => {
		enableHostOwnershipDiagnostic()
		const fakeSession = {
			sessionId: "session-S",
			isRunning: true,
			sdkHost: makeProbe(),
		} as unknown as VscodeActiveSession
		await captureFromActiveSession(1234, 56, "task-A", 7, fakeSession)
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0].stateVersion).toBe(1234)
		expect(got[0]._ptadPushId).toBe(56)
		expect(got[0].taskId).toBe("task-A")
		expect(got[0].epoch).toBe(7)
		expect(got[0].sessionId).toBe("session-S")
	})
})

/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01
 *
 * Tests for the synchronized capture helper. Verifies:
 *   - no-op when diagnostic disabled,
 *   - no-op when sdkHost.captureHostOwnershipFacts absent,
 *   - records the assembled snapshot at the SAME `_ptadPushId` as the
 *     PTAD identity when present,
 *   - sessionIsRunning from the host-side mirror is included,
 *   - candidateAwaitingFollowup is stamped as DIAGNOSTIC_DERIVATION_ONLY.
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
} from "./host-ownership-capture"
import type { SdkSessionHost } from "./session-host"

function makeSdkHost(opts: { implements?: boolean } = { implements: true }): SdkSessionHost {
	return {
		runtimeSnapshot: () => undefined,
		captureHostOwnershipFacts: opts.implements
			? (sessionId: string | undefined) =>
					sessionId
						? {
								lastInteractiveTurnFinishReason: "completed",
								sessionStatus: "idle",
								pendingPromptCount: 0,
								drainingPendingPrompts: false,
								agentCanStartRun: true,
							}
						: undefined
				: undefined,
	} as unknown as SdkSessionHost
}

describe("ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01 / captureAndRecordHostOwnershipFacts", () => {
	beforeEach(() => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})
	afterEach(() => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})

	it("no-op when diagnostic disabled", () => {
		captureAndRecordHostOwnershipFacts({
			stateVersion: 100,
			_ptadPushId: 5,
			sessionId: "s1",
			sessionIsRunning: false,
			sdkHost: makeSdkHost(),
		})
		expect(isHostOwnershipDiagnosticEnabled()).toBe(false)
		expect(getHostOwnershipDiagnostic()).toEqual([])
	})

	it("no-op when sdkHost.captureHostOwnershipFacts is absent (Hub/Remote hosts)", () => {
		enableHostOwnershipDiagnostic()
		captureAndRecordHostOwnershipFacts({
			stateVersion: 100,
			_ptadPushId: 5,
			sessionId: "s1",
			sessionIsRunning: false,
			sdkHost: makeSdkHost({ implements: false }),
		})
		expect(getHostOwnershipDiagnostic()).toEqual([])
	})

	it("records the snapshot with `_ptadPushId` identity preserved", () => {
		enableHostOwnershipDiagnostic()
		captureAndRecordHostOwnershipFacts({
			stateVersion: 100,
			_ptadPushId: 42,
			sessionId: "s1",
			sessionIsRunning: true,
			sdkHost: makeSdkHost(),
		})
		const got = getHostOwnershipDiagnostic()
		expect(got).toHaveLength(1)
		expect(got[0]._ptadPushId).toBe(42)
		expect(got[0].sessionIsRunning).toBe(true)
		expect(got[0].lastInteractiveTurnFinishReason).toBe("completed")
		expect(got[0].candidateAwaitingFollowup).toBe(true)
	})

	it("captureFromActiveSession no-ops on missing activeSession", () => {
		enableHostOwnershipDiagnostic()
		captureFromActiveSession(1, 1, undefined)
		expect(getHostOwnershipDiagnostic()).toEqual([])
	})
})

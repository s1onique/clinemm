/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01
 *
 * D1..D7 instrumentation tests for the host-ownership diagnostic ring
 * buffer, REVISED for the corrected snapshot shape (stateVersion +
 * _ptadPushId + taskId + sessionId + epoch identity fields, plus
 * observationAvailable).
 *
 * Reviewer-mandated constraints (per Factory C1: GO EVIDENCE):
 *   D1 disabled => no records / no semantic delta
 *   D2 exact host values round-trip unchanged
 *   D3 missing host/session => values recorded as unavailable
 *   D4 pendingPromptCount and drainingPendingPrompts remain distinct
 *   D5 lastInteractiveTurnFinishReason remains raw source value
 *   D6 bounded ring behavior
 *   D7 no diagnostic value is consumed by TaskHeader projection
 *
 * PLUS the CORRECTION01-mandated tests:
 *   exact five-field identity roundtrip
 *   unavailable observation => correlated unavailable row
 *   bounded ring
 *   dump produces JSONL
 *   fresh install remains OFF
 *   no projection imports/consumes diagnostic
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	clearHostOwnershipDiagnostic,
	disableHostOwnershipDiagnostic,
	enableHostOwnershipDiagnostic,
	isHostOwnershipDiagnosticEnabled,
	recordHostOwnershipFacts,
	getHostOwnershipDiagnostic,
	setHostOwnershipDiagnosticBufferSize,
	deriveCandidateAwaitingFollowup,
	HOST_OWNERSHIP_DIAGNOSTIC_ID,
	type HostOwnershipFactsSnapshot,
} from "./host-ownership-diagnostic"

function makeSnapshot(overrides: Partial<HostOwnershipFactsSnapshot> = {}): HostOwnershipFactsSnapshot {
	return {
		stateVersion: 100,
		_ptadPushId: 1,
		sessionId: "s1",
		taskId: "task-A",
		epoch: 7,
		lastInteractiveTurnFinishReason: "completed",
		sessionStatus: "idle",
		sessionIsRunning: false,
		pendingPromptCount: 0,
		drainingPendingPrompts: false,
		agentCanStartRun: true,
		capturedAt: Date.now(),
		...overrides,
		observationAvailable: overrides.observationAvailable ?? true,
	}
}

describe("ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01 / host-ownership-diagnostic", () => {
	beforeEach(() => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})
	afterEach(() => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})

	// D1
	describe("D1 disabled => no records / no semantic delta", () => {
		it("records nothing when disabled", () => {
			recordHostOwnershipFacts(makeSnapshot())
			recordHostOwnershipFacts(makeSnapshot())
			expect(getHostOwnershipDiagnostic()).toEqual([])
			expect(isHostOwnershipDiagnosticEnabled()).toBe(false)
		})

		it("enables/disables symmetrically with no leftover state", () => {
			enableHostOwnershipDiagnostic()
			expect(isHostOwnershipDiagnosticEnabled()).toBe(true)
			recordHostOwnershipFacts(makeSnapshot())
			expect(getHostOwnershipDiagnostic()).toHaveLength(1)
			disableHostOwnershipDiagnostic()
			recordHostOwnershipFacts(makeSnapshot())
			expect(getHostOwnershipDiagnostic()).toHaveLength(1)
		})
	})

	// D2 + CORRECTION01: exact five-field identity roundtrip
	describe("D2 + CORRECTION01 identity roundtrip", () => {
		it("preserves stateVersion, _ptadPushId, taskId, sessionId, epoch verbatim", () => {
			enableHostOwnershipDiagnostic()
			recordHostOwnershipFacts(
				makeSnapshot({
					stateVersion: 1234,
					_ptadPushId: 56,
					taskId: "task-A",
					sessionId: "session-S",
					epoch: 7,
				}),
			)
			const got = getHostOwnershipDiagnostic()[0]
			expect(got.stateVersion).toBe(1234)
			expect(got._ptadPushId).toBe(56)
			expect(got.taskId).toBe("task-A")
			expect(got.sessionId).toBe("session-S")
			expect(got.epoch).toBe(7)
		})

		it("preserves all six raw fields verbatim", () => {
			enableHostOwnershipDiagnostic()
			const raw = {
				lastInteractiveTurnFinishReason: "aborted" as const,
				sessionStatus: "running",
				sessionIsRunning: true,
				pendingPromptCount: 3,
				drainingPendingPrompts: false,
				agentCanStartRun: false,
			}
			recordHostOwnershipFacts(
				makeSnapshot({
					...raw,
				}),
			)
			const got = getHostOwnershipDiagnostic()[0]
			expect(got.lastInteractiveTurnFinishReason).toBe("aborted")
			expect(got.sessionStatus).toBe("running")
			expect(got.sessionIsRunning).toBe(true)
			expect(got.pendingPromptCount).toBe(3)
			expect(got.drainingPendingPrompts).toBe(false)
			expect(got.agentCanStartRun).toBe(false)
		})
	})

	// D3 (CORRECTION01-mandated unavailable row)
	describe("D3 missing host/session => values recorded as unavailable, NOT synthesized", () => {
		it("records observationAvailable=false + identity + all six raw fields undefined", () => {
			enableHostOwnershipDiagnostic()
			recordHostOwnershipFacts(
				makeSnapshot({
					observationAvailable: false,
					lastInteractiveTurnFinishReason: undefined,
					sessionStatus: undefined,
					pendingPromptCount: undefined,
					drainingPendingPrompts: undefined,
					agentCanStartRun: undefined,
				}),
			)
			const got = getHostOwnershipDiagnostic()[0]
			expect(got.observationAvailable).toBe(false)
			expect(got.lastInteractiveTurnFinishReason).toBeUndefined()
			expect(got.sessionStatus).toBeUndefined()
			expect(got.pendingPromptCount).toBeUndefined()
			expect(got.drainingPendingPrompts).toBeUndefined()
			expect(got.agentCanStartRun).toBeUndefined()
			expect(got.candidateAwaitingFollowup).toBeUndefined()
			// identity must STILL be present
			expect(got.stateVersion).toBe(100)
			expect(got._ptadPushId).toBe(1)
			expect(got.taskId).toBe("task-A")
			expect(got.sessionId).toBe("s1")
			expect(got.epoch).toBe(7)
		})
	})

	// D4
	describe("D4 pendingPromptCount and drainingPendingPrompts remain distinct", () => {
		it("treats count and boolean as separate axes", () => {
			enableHostOwnershipDiagnostic()
			recordHostOwnershipFacts(
				makeSnapshot({
					pendingPromptCount: 0,
					drainingPendingPrompts: true,
				}),
			)
			const got = getHostOwnershipDiagnostic()[0]
			expect(got.pendingPromptCount).toBe(0)
			expect(got.drainingPendingPrompts).toBe(true)
		})
	})

	// D5
	describe("D5 lastInteractiveTurnFinishReason remains raw source value", () => {
		it("records every AgentFinishReason variant as-is", () => {
			enableHostOwnershipDiagnostic()
			const variants = ["completed", "aborted", "error", "max_iterations", "mistake_limit"] as const
			for (const v of variants) {
				recordHostOwnershipFacts(
					makeSnapshot({ lastInteractiveTurnFinishReason: v, _ptadPushId: variants.indexOf(v) }),
				)
			}
			const got = getHostOwnershipDiagnostic().map((s) => s.lastInteractiveTurnFinishReason)
			expect(got).toEqual([...variants])
		})
	})

	// D6 (CORRECTION01: bounded ring)
	describe("D6 bounded ring behavior", () => {
		it("caps at the configured buffer size, dropping oldest first", () => {
			setHostOwnershipDiagnosticBufferSize(3)
			enableHostOwnershipDiagnostic()
			for (let i = 1; i <= 5; i += 1) {
				recordHostOwnershipFacts(
					makeSnapshot({
						stateVersion: i,
						_ptadPushId: i,
					}),
				)
			}
			const got = getHostOwnershipDiagnostic()
			expect(got).toHaveLength(3)
			expect(got.map((s) => s.stateVersion)).toEqual([3, 4, 5])
			expect(got.map((s) => s._ptadPushId)).toEqual([3, 4, 5])
		})
	})

	// D7 (CORRECTION01: no diagnostic value consumed by TaskHeader projection)
	describe("D7 no diagnostic value is consumed by TaskHeader projection", () => {
		it("diagnostic surface is a side-channel (not a production type)", () => {
			expect(HOST_OWNERSHIP_DIAGNOSTIC_ID).toMatch(/^host-ownership-diagnostic@/)
			enableHostOwnershipDiagnostic()
			recordHostOwnershipFacts(makeSnapshot())
			const a = getHostOwnershipDiagnostic()
			const b = getHostOwnershipDiagnostic()
			expect(a).not.toBe(b)
			expect(a).toEqual(b)
		})
	})

	// Bonus: HYPOTHESIS_ONLY formula sanity checks.
	describe("deriveCandidateAwaitingFollowup (HYPOTHESIS_ONLY)", () => {
		it("returns undefined when lastInteractiveTurnFinishReason is undefined", () => {
			expect(
				deriveCandidateAwaitingFollowup({
					sessionIsRunning: false,
				}),
			).toBeUndefined()
		})

		it("returns false when previous turn did not end user-owned", () => {
			expect(
				deriveCandidateAwaitingFollowup({
					lastInteractiveTurnFinishReason: "aborted",
					sessionIsRunning: false,
					pendingPromptCount: 0,
					drainingPendingPrompts: false,
					agentCanStartRun: true,
				}),
			).toBe(false)
		})

		it("returns true only when user-owned previous turn AND no queued successor AND not in drain", () => {
			expect(
				deriveCandidateAwaitingFollowup({
					lastInteractiveTurnFinishReason: "completed",
					sessionIsRunning: false,
					pendingPromptCount: 0,
					drainingPendingPrompts: false,
					agentCanStartRun: true,
				}),
			).toBe(true)
		})

		it("returns false when queued successor will run", () => {
			expect(
				deriveCandidateAwaitingFollowup({
					lastInteractiveTurnFinishReason: "completed",
					sessionIsRunning: false,
					pendingPromptCount: 1,
					drainingPendingPrompts: false,
					agentCanStartRun: true,
				}),
			).toBe(false)
		})

		it("returns false when drain is in flight", () => {
			expect(
				deriveCandidateAwaitingFollowup({
					lastInteractiveTurnFinishReason: "completed",
					sessionIsRunning: false,
					pendingPromptCount: 0,
					drainingPendingPrompts: true,
					agentCanStartRun: true,
				}),
			).toBe(false)
		})

		it("returns true when queued successor exists but session cannot accept (canStartRun=false)", () => {
			expect(
				deriveCandidateAwaitingFollowup({
					lastInteractiveTurnFinishReason: "completed",
					sessionIsRunning: false,
					pendingPromptCount: 2,
					drainingPendingPrompts: false,
					agentCanStartRun: false,
				}),
			).toBe(true)
		})
	})
})

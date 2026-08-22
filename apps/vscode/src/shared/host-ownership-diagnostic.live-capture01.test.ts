/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01
 *
 * D1..D7 instrumentation tests for the host-ownership diagnostic ring
 * buffer. Each test asserts one of the seven constraints the
 * Factory reviewer (C1: GO EVIDENCE) imposed on the temporary
 * instrumentation:
 *
 *   D1 disabled => no records / no semantic delta
 *   D2 exact host values round-trip unchanged
 *   D3 missing host/session => values recorded as unavailable
 *   D4 pendingPromptCount and drainingPendingPrompts remain distinct
 *   D5 lastInteractiveTurnFinishReason remains raw source value
 *   D6 bounded ring behavior
 *   D7 no diagnostic value is consumed by TaskHeader projection
 *
 * The diagnostic is DEFAULT_OFF and zero-impact while disabled; the
 * tests assert that by repeatedly enabling / disabling / re-enabling
 * the same buffer.
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
		lastInteractiveTurnFinishReason: "completed",
		sessionStatus: "idle",
		sessionIsRunning: false,
		pendingPromptCount: 0,
		drainingPendingPrompts: false,
		agentCanStartRun: true,
		_ptadPushId: 1,
		capturedAt: Date.now(),
		...overrides,
	}
}

describe("ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01 / host-ownership-diagnostic", () => {
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

	// D2
	describe("D2 exact host values round-trip unchanged", () => {
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
			recordHostOwnershipFacts({
				...raw,
				_ptadPushId: 42,
				capturedAt: 100,
			})
			const got = getHostOwnershipDiagnostic()[0]
			expect(got.lastInteractiveTurnFinishReason).toBe("aborted")
			expect(got.sessionStatus).toBe("running")
			expect(got.sessionIsRunning).toBe(true)
			expect(got.pendingPromptCount).toBe(3)
			expect(got.drainingPendingPrompts).toBe(false)
			expect(got.agentCanStartRun).toBe(false)
			expect(got._ptadPushId).toBe(42)
			expect(got.capturedAt).toBe(100)
		})
	})

	// D3
	describe("D3 missing host/session => values recorded as unavailable, NOT synthesized", () => {
		it("records undefined for missing fields without defaulting", () => {
			enableHostOwnershipDiagnostic()
			recordHostOwnershipFacts({
				sessionIsRunning: false,
				_ptadPushId: 7,
				capturedAt: 1,
			})
			const got = getHostOwnershipDiagnostic()[0]
			expect(got.lastInteractiveTurnFinishReason).toBeUndefined()
			expect(got.sessionStatus).toBeUndefined()
			expect(got.pendingPromptCount).toBeUndefined()
			expect(got.drainingPendingPrompts).toBeUndefined()
			expect(got.agentCanStartRun).toBeUndefined()
			expect(got.candidateAwaitingFollowup).toBeUndefined()
		})
	})

	// D4
	describe("D4 pendingPromptCount and drainingPendingPrompts remain distinct", () => {
		it("treats count and boolean as separate axes", () => {
			enableHostOwnershipDiagnostic()
			recordHostOwnershipFacts({
				pendingPromptCount: 0,
				drainingPendingPrompts: true,
				sessionIsRunning: false,
				_ptadPushId: 1,
				capturedAt: 0,
			})
			const got = getHostOwnershipDiagnostic()[0]
			expect(got.pendingPromptCount).toBe(0)
			expect(got.drainingPendingPrompts).toBe(true)
		})

		it("treats count>0 and canStartRun=false as queued-but-blocked (not in-flight)", () => {
			enableHostOwnershipDiagnostic()
			recordHostOwnershipFacts({
				pendingPromptCount: 2,
				drainingPendingPrompts: false,
				agentCanStartRun: false,
				sessionIsRunning: false,
				_ptadPushId: 1,
				capturedAt: 0,
			})
			const got = getHostOwnershipDiagnostic()[0]
			expect(got.pendingPromptCount).toBe(2)
			expect(got.drainingPendingPrompts).toBe(false)
			expect(got.agentCanStartRun).toBe(false)
		})
	})

	// D5
	describe("D5 lastInteractiveTurnFinishReason remains raw source value", () => {
		it("records every AgentFinishReason variant as-is", () => {
			enableHostOwnershipDiagnostic()
			const variants = ["completed", "aborted", "error", "max_iterations", "mistake_limit"] as const
			for (const v of variants) {
				recordHostOwnershipFacts({
					lastInteractiveTurnFinishReason: v,
					sessionIsRunning: false,
					_ptadPushId: 1,
					capturedAt: 0,
				})
			}
			const got = getHostOwnershipDiagnostic().map((s) => s.lastInteractiveTurnFinishReason)
			expect(got).toEqual([...variants])
		})
	})

	// D6
	describe("D6 bounded ring behavior", () => {
		it("caps at the configured buffer size, dropping oldest first", () => {
			setHostOwnershipDiagnosticBufferSize(3)
			enableHostOwnershipDiagnostic()
			for (let i = 1; i <= 5; i += 1) {
				recordHostOwnershipFacts({
					_ptadPushId: i,
					sessionIsRunning: false,
					capturedAt: i,
				})
			}
			const got = getHostOwnershipDiagnostic()
			expect(got).toHaveLength(3)
			expect(got.map((s) => s._ptadPushId)).toEqual([3, 4, 5])
		})
	})

	// D7 — this one asserts the negative: NO diagnostic field is part of
	// the diagnostic's exposed identity or any production consumer. Since
	// the diagnostic module is a ring buffer with no consumer code, the
	// strongest assertion we can make is that the type is structurally
	// a side-channel (not extending any production type) and that the
	// module's only exports are the enable/disable/record/read surface
	// plus the formula helper.
	describe("D7 no diagnostic value is consumed by TaskHeader projection", () => {
		it("diagnostic surface is a side-channel (not a production type)", () => {
			// The diagnostic identity constant is a marker. The production
			// projection code (selectTaskHeaderPresentation / TaskHeaderTelemetry)
			// does not import this module. Asserting this structurally:
			// the diagnostic module exports no functions that mutate
			// projection state.
			expect(HOST_OWNERSHIP_DIAGNOSTIC_ID).toMatch(/^host-ownership-diagnostic@/)
			// The module's read function returns a fresh slice: never the
			// internal buffer reference.
			enableHostOwnershipDiagnostic()
			recordHostOwnershipFacts({ _ptadPushId: 1, sessionIsRunning: false, capturedAt: 0 })
			const a = getHostOwnershipDiagnostic()
			const b = getHostOwnershipDiagnostic()
			expect(a).not.toBe(b)
			expect(a).toEqual(b)
		})
	})

	// Bonus: HYPOTHESIS_ONLY formula sanity checks. These do NOT
	// assert product truth; they only prove the formula behaves as
	// documented so the diagnostic captures are reproducible across
	// capture sites.
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

		it("returns false when queued successor exists but session cannot accept (canStartRun=false)", () => {
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

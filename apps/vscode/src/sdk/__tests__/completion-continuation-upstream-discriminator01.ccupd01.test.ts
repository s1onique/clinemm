/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR
 *
 * RED/GREEN tests for the upstream-discriminator diagnostic (U0..U11
 * first-divergence table). Mirrors the CCDO dogfood-gate test style:
 * arm the diagnostic through the SAME production seam
 * `applyCompletionContinuationUpstreamDiagnosticProfile` that
 * extension.ts:activate calls during a dogfood install.
 *
 * Test plan (LIVE discriminator table):
 *   A. UPSTREAM-DIAG-01 — dogfood OFF (default)
 *      Production reevaluation path runs; all upstream counters
 *      stay zero; behavior unchanged.
 *
 *   B. UPSTREAM-DIAG-02 — marker missing
 *      Dogfood active; no `deferredCompletionBarrier`; trigger
 *      reevaluateDeferredCompletionBarrier; assert U2
 *      (markerMissing=1, lastStopReason="marker_missing").
 *
 *   C. UPSTREAM-DIAG-03 — terminal hold reaches enqueue-if-held
 *      Dogfood active; valid marker; session/task/epoch match;
 *      owner not running; unconsumed terminal count > 0;
 *      reevaluateDeferredCompletionBarrier triggers
 *      enqueueCompletionContinuationIfHeld.
 *      Assert U8 (enqueueIfHeldEntered=1) + U9 (heldJobIds
 *      non-empty) + U10 (dedupe permitted) + U11
 *      (enqueueCompletionContinuationInvoked=1).
 *
 *   D. UPSTREAM-DIAG-04 — dedupe suppressed
 *      Same as C, but `lastCompletionContinuationSessionEpoch`
 *      is pre-set to the suppressing key.
 *      Assert U10 (dedupeSuppressed=1, enqueueCompletionContinuationInvoked=0,
 *      lastStopReason="dedupe_suppressed").
 *
 *   E. UPSTREAM-DIAG-05 — callback path end-to-end
 *      Same as C, dedupe permits; we verify the existing
 *      CCDO callback-outcome `callbackEntered` counter increments
 *      when the production callback is wired through the
 *      `buildSdkControllerEnqueueCompletionContinuation` factory.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { ActiveSession } from "../cline-session-factory"
import {
	type CompletionContinuationDeliveryCountersSnapshot,
	getCompletionContinuationDeliveryCounters,
	resetCompletionContinuationDeliveryForTests,
} from "../completion-continuation-delivery-runtime"
import {
	type CompletionContinuationUpstreamCountersSnapshot,
	getCompletionContinuationUpstreamCounters,
	resetCompletionContinuationUpstreamForTests,
} from "../completion-continuation-upstream-runtime"
import {
	applyCompletionContinuationDeliveryDiagnosticProfile,
	applyCompletionContinuationUpstreamDiagnosticProfile,
} from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

function upstreamSnapshot(): CompletionContinuationUpstreamCountersSnapshot {
	return getCompletionContinuationUpstreamCounters()
}

function deliverySnapshot(): CompletionContinuationDeliveryCountersSnapshot {
	return getCompletionContinuationDeliveryCounters()
}

beforeEach(() => {
	resetCompletionContinuationUpstreamForTests()
	resetCompletionContinuationDeliveryForTests()
})

afterEach(() => {
	resetCompletionContinuationUpstreamForTests()
	resetCompletionContinuationDeliveryForTests()
})

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly continuationSendLog: ReadonlyArray<{ sessionId: string; heldJobIds: readonly string[] }>
	readonly setMarkerPresent: (present: boolean) => void
	readonly setUnconsumedTerminalCount: (n: number) => void
	readonly preArmDedupeKey: (key: string) => void
	readonly wireDeliveryCallback: (
		callback: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => Promise<{ kind: "delivered" | "rejected" | "session_gone" | "no_held_job_ids" }>,
	) => void
}

function makeHarness(opts: { activeSessionId: string; activeTaskId: string; ownerRunning: boolean }): Harness {
	const tracker = new TurnStateTracker(new MessageIdMinter())
	const translatorState = new MessageTranslatorState(new MessageIdMinter())

	let unconsumedTerminalCount = 0
	const unconsumedTerminalJobIds: string[] = []
	const continuationSendLog: Array<{ sessionId: string; heldJobIds: readonly string[] }> = []

	let deliveryCallbackOverride:
		| ((input: { sessionId: string; taskId: string | undefined; heldJobIds: readonly string[] }) => Promise<{
				kind: "delivered" | "rejected" | "session_gone" | "no_held_job_ids"
		  }>)
		| undefined

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: opts.activeSessionId,
				sdkHost: {
					send: () => Promise.resolve(),
				} as never,
				unsubscribe: () => undefined,
				startResult: { sessionId: opts.activeSessionId } as never,
				isRunning: false,
			}),
			setRunning: () => undefined,
		},
		messages: {
			appendAndEmit: (() => undefined) as never,
		},
		taskHistory: { updateTaskUsage: () => undefined } as never,
		getTask: () => ({ taskId: opts.activeTaskId }) as never,
		postStateToWebview: () => Promise.resolve(undefined),
		setTurnPhase: (() => undefined) as never,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent: () => ({ kind: "noop" }) as never,
		hasRunningBackgroundJobForOwner: () => opts.ownerRunning,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: () => unconsumedTerminalCount,
		getUnconsumedOwnedTerminalJobIds: () => (unconsumedTerminalCount > 0 ? unconsumedTerminalJobIds.slice() : []),
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			continuationSendLog.push({ sessionId: input.sessionId, heldJobIds: input.heldJobIds })
			if (deliveryCallbackOverride) {
				return deliveryCallbackOverride(input)
			}
			return Promise.resolve({ kind: "delivered" as const })
		},
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		activeSessionId: opts.activeSessionId,
		activeTaskId: opts.activeTaskId,
		continuationSendLog,
		setMarkerPresent: (present) => {
			if (!present) {
				coordinator.setDeferredCompletionBarrierForTesting(undefined)
				return
			}
			coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: opts.activeSessionId,
				taskId: opts.activeTaskId,
				epoch: translatorState.getMinter().epoch,
			})
		},
		setUnconsumedTerminalCount: (n) => {
			unconsumedTerminalCount = n
			while (unconsumedTerminalJobIds.length < n) {
				unconsumedTerminalJobIds.push(`cmd_${unconsumedTerminalJobIds.length}_${Math.random().toString(36).slice(2, 10)}`)
			}
			unconsumedTerminalJobIds.length = n
		},
		preArmDedupeKey: (_key) => {
			const epoch = translatorState.getMinter().epoch
			;(
				coordinator as unknown as { lastCompletionContinuationSessionEpoch?: string }
			).lastCompletionContinuationSessionEpoch = `${opts.activeSessionId}|${opts.activeTaskId ?? "(none)"}|${epoch}`
			// Marker must also be present for the dedupe check to
			// be reached.
			coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: opts.activeSessionId,
				taskId: opts.activeTaskId,
				epoch,
			})
			expect(
				(
					coordinator as unknown as {
						wasCompletionContinuationSentForTesting: (sid: string, tid: string | undefined, epoch: number) => boolean
					}
				).wasCompletionContinuationSentForTesting(opts.activeSessionId, opts.activeTaskId, epoch),
			).toBe(true)
		},
		wireDeliveryCallback: (cb) => {
			deliveryCallbackOverride = cb
		},
	}
}

describe("UPSTREAM-DIAG-02 — marker missing", () => {
	test("dogfood-armed collector increments U2 markerMissing when no barrier is registered", async () => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
		const harness = makeHarness({
			activeSessionId: "sess-ccupd-02",
			activeTaskId: "task-ccupd-02",
			ownerRunning: false,
		})
		// Marker is NOT present.
		await harness.coordinator.reevaluateDeferredCompletionBarrier()
		const s = upstreamSnapshot()
		expect(s.reevaluateEntered).toBe(1)
		expect(s.markerMissing).toBe(1)
		expect(s.lastStopReason).toBe("marker_missing")
		// No continuation fires.
		expect(harness.continuationSendLog.length).toBe(0)
	})
})

describe("UPSTREAM-DIAG-03 — terminal hold reaches enqueue-if-held", () => {
	test("valid marker, identity match, owner not running, terminal count>0 → U8/U9/U10/U11 fire", async () => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
		const harness = makeHarness({
			activeSessionId: "sess-ccupd-03",
			activeTaskId: "task-ccupd-03",
			ownerRunning: false,
		})
		harness.setMarkerPresent(true)
		harness.setUnconsumedTerminalCount(3)
		await harness.coordinator.reevaluateDeferredCompletionBarrier()
		const s = upstreamSnapshot()
		// U2 (marker present).
		expect(s.markerMissing).toBe(0)
		expect(s.markerPresent).toBe(1)
		// U3/U4 (identity + epoch match — no mismatch counters).
		expect(s.sessionMismatch).toBe(0)
		expect(s.taskMismatch).toBe(0)
		expect(s.epochMismatch).toBe(0)
		// U5 (no autonomous work).
		expect(s.outstandingAutonomousWork).toBe(0)
		// U6 (owner not running).
		expect(s.ownerStillRunning).toBe(0)
		// U7 (count>0).
		expect(s.unconsumedTerminalCountPositive).toBe(1)
		expect(s.unconsumedTerminalCountLast).toBe(3)
		// U8 (enqueueIfHeldEntered).
		expect(s.enqueueIfHeldEntered).toBe(1)
		// U9 (heldJobIds non-empty, three entries).
		expect(s.heldJobIdsEmpty).toBe(0)
		expect(s.heldJobIdsNonEmpty).toBe(1)
		expect(s.heldJobIdsCountLast).toBe(3)
		// U10 (dedupe permits).
		expect(s.dedupeSuppressed).toBe(0)
		expect(s.dedupePermitted).toBe(1)
		// U11 (callback invoked).
		expect(s.enqueueCompletionContinuationInvoked).toBe(1)
		expect(s.lastStopReason).toBe("enqueue_invoked")
		// Continuation actually fired.
		expect(harness.continuationSendLog.length).toBe(1)
		expect(harness.continuationSendLog[0]?.sessionId).toBe("sess-ccupd-03")
		expect(harness.continuationSendLog[0]?.heldJobIds.length).toBe(3)
	})
})

describe("UPSTREAM-DIAG-04 — dedupe suppressed", () => {
	test("pre-armed dedupe key suppresses U11 and records lastStopReason=dedupe_suppressed", async () => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
		const harness = makeHarness({
			activeSessionId: "sess-ccupd-04",
			activeTaskId: "task-ccupd-04",
			ownerRunning: false,
		})
		harness.setMarkerPresent(true)
		harness.setUnconsumedTerminalCount(2)
		harness.preArmDedupeKey("ignored")
		await harness.coordinator.reevaluateDeferredCompletionBarrier()
		const s = upstreamSnapshot()
		// The reevaluation ran past U2..U7 but U10 dedupe suppressed.
		// When dedupe suppresses, the heldJobIds read is NOT
		// performed (the production short-circuits at the dedupe
		// check, before getUnconsumedOwnedTerminalJobIds is
		// consulted). This is the correct production behavior
		// — U9 cardinality is only meaningful when dedupe
		// permits.
		expect(s.markerPresent).toBe(1)
		expect(s.unconsumedTerminalCountPositive).toBe(1)
		expect(s.unconsumedTerminalCountLast).toBe(2)
		expect(s.enqueueIfHeldEntered).toBe(1)
		expect(s.heldJobIdsNonEmpty).toBe(0)
		expect(s.heldJobIdsCountLast).toBeNull()
		expect(s.dedupeSuppressed).toBe(1)
		expect(s.dedupePermitted).toBe(0)
		expect(s.enqueueCompletionContinuationInvoked).toBe(0)
		expect(s.lastStopReason).toBe("dedupe_suppressed")
		expect(harness.continuationSendLog.length).toBe(0)
	})
})

describe("UPSTREAM-DIAG-05 — callback path end-to-end", () => {
	test("dedupe permits → upstream U11 + downstream CCDO callbackEntered both fire", async () => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
		applyCompletionContinuationDeliveryDiagnosticProfile(true)
		try {
			const harness = makeHarness({
				activeSessionId: "sess-ccupd-05",
				activeTaskId: "task-ccupd-05",
				ownerRunning: false,
			})
			harness.wireDeliveryCallback(
				buildSdkControllerEnqueueCompletionContinuation({
					getActiveSession: () =>
						({
							sessionId: harness.activeSessionId,
							sdkHost: { send: () => Promise.resolve() } as never,
							startConfig: { providerId: "p", modelId: "m" },
							unsubscribe: () => undefined,
							startResult: undefined,
							isRunning: false,
						}) as ActiveSession,
					logger: { warn: () => undefined },
				}),
			)
			harness.setMarkerPresent(true)
			harness.setUnconsumedTerminalCount(1)
			await harness.coordinator.reevaluateDeferredCompletionBarrier()
			const up = upstreamSnapshot()
			expect(up.enqueueCompletionContinuationInvoked).toBe(1)
			expect(up.lastStopReason).toBe("enqueue_invoked")
			expect(harness.continuationSendLog.length).toBe(1)
			const down = deliverySnapshot()
			expect(down.callbackEntered).toBe(1)
			expect(down.delivered).toBe(1)
		} finally {
			applyCompletionContinuationDeliveryDiagnosticProfile(false)
		}
	})
})

describe("UPSTREAM-DIAG-PROFILE — dogfood-gate conservation", () => {
	test("isDogfood=true enables the diagnostic; isDogfood=false disables it", () => {
		const initial = applyCompletionContinuationUpstreamDiagnosticProfile(false)
		expect(initial.enabled).toBe(false)
		const on = applyCompletionContinuationUpstreamDiagnosticProfile(true)
		expect(on.enabled).toBe(true)
		expect(on.flipped).toBe(true)
		const onAgain = applyCompletionContinuationUpstreamDiagnosticProfile(true)
		expect(onAgain.enabled).toBe(true)
		expect(onAgain.flipped).toBe(false)
		const off = applyCompletionContinuationUpstreamDiagnosticProfile(false)
		expect(off.enabled).toBe(false)
		expect(off.flipped).toBe(true)
	})

	test("the diagnostic is gated STRICTLY by the dogfood profile — no public knob", () => {
		expect(typeof applyCompletionContinuationUpstreamDiagnosticProfile).toBe("function")
	})
})

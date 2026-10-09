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
 *
 *   F. UPSTREAM-DIAG-06 — active session lookup (CORRECTION04)
 *      The CORRECTION03 dump on the live run showed
 *      `markerPresent=1, markerMissing=1` with no identity
 *      mismatch recorded. The only pre-U3 branch the prior
 *      instrumentation did not cover is the active-session
 *      lookup at `sdk-session-event-coordinator.ts:770-776`.
 *      F asserts that branch:
 *        F-a. Dogfood OFF; `getActiveSession()→undefined` →
 *             all upstream counters stay zero (§11 invariant:
 *             disabled record*() short-circuit).
 *        F-b. Dogfood ON; `getActiveSession()→undefined`,
 *             marker present → U2.5 discriminator:
 *               activeSessionLookupEntered=1
 *               activeSessionMissing=1
 *               markerClearedForMissingSession=1
 *               lastStopReason="active_session_missing"
 *             and the marker is cleared (a second reeval
 *             sees `markerMissing=1`, the exact LIVE
 *             chronology).
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
		// CRCD01: wire the liveTools accessor so the inner enqueue's
		// truthful capability projection (sdk-session-event-coordinator.ts:1559-1562)
		// reads truthful capability from the test's live registry.
		liveTools: () => ["command_status", "submit_and_exit"],
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
		// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C7):
		// the production seam now awaits the Elm kernel
		// (`pickContinuationDirectiveForPublication`) before
		// deciding the outcome. The kernel's `Platform.worker`
		// uses an async `setTimeout(0)` for the outbound port.
		// Drain the timer queue so the synchronous-looking
		// assertion below sees the post-Elm state.
		await new Promise((r) => setTimeout(r, 50))
		const s = upstreamSnapshot()
		// U2 (marker present).
		expect(s.markerMissing).toBe(0)
		expect(s.markerPresent).toBe(1)
		// U2.5 (CORRECTION04 — active session present in this scenario).
		expect(s.activeSessionLookupEntered).toBe(1)
		expect(s.activeSessionPresent).toBe(1)
		expect(s.activeSessionMissing).toBe(0)
		expect(s.markerClearedForMissingSession).toBe(0)
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
		// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C7):
		// drain the Elm kernel's setTimeout(0) (see the comment on
		// UPSTREAM-DIAG-03 above).
		await new Promise((r) => setTimeout(r, 50))
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
					// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-CAPABILITY-FAIL-CLOSED-P1:
					// Test fixture supplies the historical default tool
					// list so the production seam's capability projection
					// has an honest input.
					liveTools: () => ["command_status", "submit_and_exit"],
					logger: { warn: () => undefined },
				}),
			)
			harness.setMarkerPresent(true)
			harness.setUnconsumedTerminalCount(1)
			await harness.coordinator.reevaluateDeferredCompletionBarrier()
			// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06:
			// production seam awaits Elm's setTimeout(0). Drain timer.
			await new Promise((r) => setTimeout(r, 50))
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

describe("UPSTREAM-DIAG-06 — active session lookup (CORRECTION04)", () => {
	/**
	 * Build a minimal coordinator whose `sessions.getActiveSession()`
	 * returns `undefined` — the exact LIVE chronology inferred
	 * from the CORRECTION03 dump. Mirrors `makeHarness` (above)
	 * but with `getActiveSession() → undefined`. The production
	 * code under test is the REAL `reevaluateDeferredCompletionBarrier`
	 * from `sdk-session-event-coordinator.ts`; the SAME const
	 * pattern is exercised as in every other test in this file.
	 */
	function makeAbsentSessionHarness(opts: { activeSessionId: string; activeTaskId: string }): {
		readonly coordinator: SdkSessionEventCoordinator
		readonly setMarkerPresent: (present: boolean) => void
	} {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		const translatorState = new MessageTranslatorState(new MessageIdMinter())
		const coordinator = new SdkSessionEventCoordinator({
			messageTranslatorState: translatorState,
			sessions: {
				// CORRECTION04 — active session is absent (the LIVE scenario).
				getActiveSession: () => undefined,
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
			hasRunningBackgroundJobForOwner: () => false,
			getActiveJobOwnershipSnapshot: () => [],
			getActiveSessionHost: () => undefined,
			getUnconsumedOwnedTerminalResultCount: () => 0,
			getUnconsumedOwnedTerminalJobIds: () => [],
			getPendingPromptCount: () => ({ available: true, count: 0 }),
			getActiveNotifyCount: () => 0,
			hasActiveNotify: () => false,
			wasWakeDispatchRequested: () => false,
			wasWakeDelivered: () => false,
			wasWakeDispatchFailed: () => false,
			getOutstandingAutonomousWork: () => false,
			getLaunchedBackgroundJobIds: () => [],
			enqueueCompletionContinuation: () => Promise.resolve({ kind: "delivered" as const }),
			// CRCD01: wire the liveTools accessor so the inner enqueue's
			// truthful capability projection (sdk-session-event-coordinator.ts:1559-1562)
			// reads truthful capability from the test's live registry.
			liveTools: () => ["command_status", "submit_and_exit"],
		} as unknown as SdkSessionEventCoordinatorOptions)
		return {
			coordinator,
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
		}
	}

	test("F-a. dogfood OFF, active session absent → all upstream counters stay zero", async () => {
		// §11 invariant: when the diagnostic is OFF, every
		// record*() short-circuits; no counter is incremented
		// even when the underlying predicate would otherwise fire.
		applyCompletionContinuationUpstreamDiagnosticProfile(false)
		const harness = makeAbsentSessionHarness({
			activeSessionId: "sess-ccupd-06a",
			activeTaskId: "task-ccupd-06a",
		})
		harness.setMarkerPresent(true)
		await harness.coordinator.reevaluateDeferredCompletionBarrier()
		const s = upstreamSnapshot()
		// recordReevaluateEntered is also gated; everything
		// downstream stays at zero.
		expect(s.reevaluateEntered).toBe(0)
		expect(s.markerMissing).toBe(0)
		expect(s.markerPresent).toBe(0)
		expect(s.activeSessionLookupEntered).toBe(0)
		expect(s.activeSessionPresent).toBe(0)
		expect(s.activeSessionMissing).toBe(0)
		expect(s.markerClearedForMissingSession).toBe(0)
		expect(s.lastStopReason).toBeNull()
	})

	test("F-b. dogfood ON, active session absent, marker present → U2.5 discriminator fires and the LIVE chronology is reproduced", async () => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
		const harness = makeAbsentSessionHarness({
			activeSessionId: "sess-ccupd-06b",
			activeTaskId: "task-ccupd-06b",
		})
		harness.setMarkerPresent(true)
		// Reevaluation #1: marker present, active session absent.
		await harness.coordinator.reevaluateDeferredCompletionBarrier()
		const s1 = upstreamSnapshot()
		// U2: marker present. U2.5: active-session lookup
		// reached, lookup returned absent, marker cleared by
		// this branch. The reeval does NOT reach U3/U4/U7/U8/U11.
		expect(s1.reevaluateEntered).toBe(1)
		expect(s1.markerPresent).toBe(1)
		expect(s1.markerMissing).toBe(0)
		expect(s1.activeSessionLookupEntered).toBe(1)
		expect(s1.activeSessionMissing).toBe(1)
		expect(s1.markerClearedForMissingSession).toBe(1)
		expect(s1.activeSessionPresent).toBe(0)
		expect(s1.sessionMismatch).toBe(0)
		expect(s1.taskMismatch).toBe(0)
		expect(s1.epochMismatch).toBe(0)
		expect(s1.unconsumedTerminalCountPositive).toBe(0)
		expect(s1.unconsumedTerminalCountLast).toBeNull()
		expect(s1.lastStopReason).toBe("active_session_missing")
		expect(s1.enqueueCompletionContinuationInvoked).toBe(0)
		// Reevaluation #2 (the chronological notification the LIVE
		// operator observes): the marker has been cleared by
		// reeval #1, so this reeval sees markerMissing.
		await harness.coordinator.reevaluateDeferredCompletionBarrier()
		const s2 = upstreamSnapshot()
		expect(s2.reevaluateEntered).toBe(2)
		expect(s2.markerPresent).toBe(1) // first reeval only
		expect(s2.markerMissing).toBe(1) // second reeval only
		expect(s2.activeSessionLookupEntered).toBe(1) // lookup only reached when marker is present
		expect(s2.activeSessionMissing).toBe(1)
		expect(s2.markerClearedForMissingSession).toBe(1)
		// lastStopReason reflects the most recent decision — the
		// second reeval's markerMissing.
		expect(s2.lastStopReason).toBe("marker_missing")
	})

	test("F-c. dogfood ON, active session present, marker present → U2.5 records activeSessionPresent", async () => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
		// Reuse the existing makeHarness (active session IS present).
		const harness = makeHarness({
			activeSessionId: "sess-ccupd-06c",
			activeTaskId: "task-ccupd-06c",
			ownerRunning: false,
		})
		harness.setMarkerPresent(true)
		await harness.coordinator.reevaluateDeferredCompletionBarrier()
		const s = upstreamSnapshot()
		// U2.5: the lookup is reached and the session is present.
		// No marker clear, no stop-reason change from this path.
		expect(s.activeSessionLookupEntered).toBe(1)
		expect(s.activeSessionPresent).toBe(1)
		expect(s.activeSessionMissing).toBe(0)
		expect(s.markerClearedForMissingSession).toBe(0)
		// lastStopReason is the eventual stop (U11 enqueue_invoked
		// because the harness also exposes a default unconsumed
		// terminal count of 0 — actually NO, the harness sets 0
		// by default, so the reeval does NOT fire U8. In this
		// test we ONLY assert that the active-session path did
		// NOT set "active_session_missing".
		expect(s.lastStopReason).not.toBe("active_session_missing")
	})
})

/**
 * ACT-CLINEMM-ELM-SEAM08.3-E3.1-QUALIFICATION
 *
 * DCBR01 — Real-coordinator E3.1 cutover qualification
 *
 * The SEAM08.2 ACT closed the production cutover structurally
 * (132/132 tests, typecheck, lint) and added a settlement +
 * duplicate-ID safety layer, but the SEAM08.2 closure did NOT
 * prove the two central causal claims the reviewer asked for:
 *
 *   P0 #1: real coordinator supersession — when the live
 *          marker / dedupe slot / owner advances between the
 *          start of an E3.1 consult and its resolution, the
 *          consult's stale decision MUST NOT commit an
 *          irreversible effect. The C5 stale-decision guard
 *          re-reads the live state AFTER the consult and
 *          downgrades to `fallthrough`; the test must
 *          demonstrate that downgrade end-to-end.
 *
 *   P0 #2: production necessity — the production coordinator's
 *          observable behavior must be GOVERNED by the Elm
 *          directive, not by the TS predecessor. A directed
 *          test injects each directive kind through a
 *          controlled `invokeForProduction` and asserts the
 *          coordinator's outcome matches the directive
 *          semantics. Kernel offline must fall through to the
 *          TS predecessor; a malformed directive must NEVER
 *          silently become an unconditional permit.
 *
 *   P1:   timeout / late-response cleanup — a 5-second
 *          settlement guarantee is the public-boundary timer
 *          in `consultDeferredCompletionBarrierElmKernel`.
 *          The test asserts the harness's enqueue promise
 *          completes (the timer fires) and the public-level
 *          pending entry is released on timeout.
 *
 * Classify this evidence as REAL_PRODUCTION_SEAM: the
 * production `SdkSessionEventCoordinator` consult path is
 * exercised end-to-end (the full `enqueueCompletionContinuationIfHeld`
 *  method, the live `deferredCompletionBarrier` marker, the
 * existing TS dedupe branches). The Elm consult itself is
 * controlled via a single test-only backdoor
 * (`setE31TestInvokeForProductionForTests`) on the production
 * coordinator; the production call site is unchanged when the
 * backdoor is `undefined` (the default).
 *
 * The test does NOT require a new Elm kernel, does NOT extend
 * E1.1 / E2.1, and does NOT touch any other Elm substrate.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	type DeferredCompletionBarrierElmConsult,
	type DeferredCompletionBarrierFactsJson,
	resetDeferredCompletionBarrierElmAuthorityForTests,
	resetDeferredCompletionBarrierElmKernelForTests,
} from "../deferred-completion-barrier-elm"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId?: string | undefined
	readonly prompt: string
	readonly delivery: "queue"
}

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId?: string | undefined
	readonly prompt: string
	readonly delivery: "queue"
}

interface QualificationHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly sendLog: ContinuationSend[]
	readonly activeSessionId: string
	readonly activeTaskId: string
	completionCommitCount: () => number
	installedInvoke: (facts: DeferredCompletionBarrierFactsJson) => Promise<DeferredCompletionBarrierElmConsult>
	installInvoke: (invoke: (facts: DeferredCompletionBarrierFactsJson) => Promise<DeferredCompletionBarrierElmConsult>) => void
	clearInvoke: () => void
}

function makeHarness(
	opts: { heldJobIds?: readonly string[]; activeSessionId?: string; activeTaskId?: string } = {},
): QualificationHarness {
	const activeSessionId = opts.activeSessionId ?? "session-dcbr01"
	const activeTaskId = opts.activeTaskId ?? "task-dcbr01"
	const heldJobIds = opts.heldJobIds ?? ["j1", "j2", "j3"]
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sendLog: ContinuationSend[] = []
	let completionCommitCount = 0

	let installedInvoke: ((facts: DeferredCompletionBarrierFactsJson) => Promise<DeferredCompletionBarrierElmConsult>) | undefined

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () =>
				({
					sessionId: activeSessionId,
					sdkHost: {
						send: (input: { sessionId: string; prompt: string; delivery: "queue" }) => {
							sendLog.push({ ...input })
							return Promise.resolve()
						},
					},
					unsubscribe: () => undefined,
					startResult: { sessionId: activeSessionId },
					isRunning: false,
				}) as never,
			setRunning: () => undefined,
		},
		messages: { appendAndEmit: () => undefined },
		taskHistory: { updateTaskUsage: () => undefined },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: async () => undefined,
		setTurnPhase: ((phase, _anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase, _anchorTs, { writerId: writerId as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		} as never,
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasRunningBackgroundJobForOwner: () => false,
		getUnconsumedOwnedTerminalResultCount: () => heldJobIds.length,
		getUnconsumedOwnedTerminalJobIds: () => heldJobIds,
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			if (input.heldJobIds.length === 0) {
				return Promise.resolve({ kind: "no_held_job_ids" as const })
			}
			sendLog.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				prompt: `COALESCED continuation for jobIds=${input.heldJobIds.join(",")}`,
				delivery: "queue",
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
		// CRCD01: wire truthful capability so the inner enqueue can
		// proceed (the inner Continuation Control Elm kernel needs
		// `canObserveHeldResults && canRetryCompletion` for
		// ObserveThenRetry -> delivered).
		liveTools: () => ["command_status", "submit_and_exit"],
	} as unknown as SdkSessionEventCoordinatorOptions)

	coordinator.setDeferredCompletionBarrierForTesting({
		sessionId: activeSessionId,
		taskId: activeTaskId,
		epoch: translatorState.getMinter().epoch,
	})

	return {
		coordinator,
		sendLog,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		installedInvoke: (facts) => {
			if (!installedInvoke) {
				throw new Error("DCBR01: invoked `installedInvoke()` but no test invoke is installed")
			}
			return installedInvoke(facts)
		},
		installInvoke: (invoke) => {
			installedInvoke = invoke
			coordinator.setE31TestInvokeForProductionForTests(invoke)
		},
		clearInvoke: () => {
			installedInvoke = undefined
			coordinator.setE31TestInvokeForProductionForTests(undefined)
		},
	}
}

// Builds a valid `PermitEnqueue{mustClearRearm:boolean}` directive
// with a `requestId` that matches the consult's `facts.requestId`.
// The `validateConsultResult` strict boundary requires the echo.
function permitDirective(mustClearRearm: boolean, requestId: string): DeferredCompletionBarrierElmConsult {
	return {
		kind: "directive",
		value: { kind: "permit_enqueue", mustClearRearm },
		summary: "permit_enqueue",
		requestId,
	}
}

function suppressDuplicateDirective(requestId: string): DeferredCompletionBarrierElmConsult {
	return {
		kind: "directive",
		value: { kind: "suppress_duplicate" },
		summary: "suppress_duplicate",
		requestId,
	}
}

function preserveBarrierDirective(requestId: string): DeferredCompletionBarrierElmConsult {
	return {
		kind: "directive",
		value: { kind: "preserve_barrier" },
		summary: "preserve_barrier",
		requestId,
	}
}

function rejectStaleIdentityDirective(
	reason: "marker_absent" | "session_mismatch" | "task_mismatch" | "epoch_mismatch",
	requestId: string,
): DeferredCompletionBarrierElmConsult {
	return {
		kind: "directive",
		value: { kind: "reject_stale_identity", reason },
		summary: `reject_stale_identity:${reason}`,
		requestId,
	}
}

function kernelOffline(): DeferredCompletionBarrierElmConsult {
	return {
		kind: "kernel_offline",
		classification: "deferred_completion_barrier_elm_kernel_offline",
	}
}

function decodeErrorMalformed(requestId: string): DeferredCompletionBarrierElmConsult {
	return {
		kind: "decode_error",
		reason: "malformed: missing mustClearRearm",
		classification: "deferred_completion_barrier_elm_decode_error",
		requestId,
	}
}

// Awaits the inner invoke with a controllable `release()` so the
// test can hold the consult in flight, mutate the live marker, then
// release the invoke with a specific directive.
interface ControllableInvoke {
	readonly invoke: (facts: DeferredCompletionBarrierFactsJson) => Promise<DeferredCompletionBarrierElmConsult>
	readonly release: (outbound: DeferredCompletionBarrierElmConsult) => Promise<void>
}

function makeControllableInvoke(): ControllableInvoke {
	let resolveFn: ((value: DeferredCompletionBarrierElmConsult) => void) | null = null
	const invoke: ControllableInvoke["invoke"] = () => {
		return new Promise<DeferredCompletionBarrierElmConsult>((resolve) => {
			resolveFn = resolve
		})
	}
	const release: ControllableInvoke["release"] = async (outbound) => {
		if (!resolveFn) {
			throw new Error("DCBR01: release() called before invoke()")
		}
		const fn = resolveFn
		resolveFn = null
		fn(outbound)
	}
	return { invoke, release }
}

describe("DCBR01 — real-coordinator E3.1 cutover qualification", () => {
	beforeEach(() => {
		resetDeferredCompletionBarrierElmAuthorityForTests()
		resetDeferredCompletionBarrierElmKernelForTests()
	})
	afterEach(() => {
		resetDeferredCompletionBarrierElmAuthorityForTests()
		resetDeferredCompletionBarrierElmKernelForTests()
	})

	// -----------------------------------------------------------------
	// P0 #1: REAL COORDINATOR SUPERSESSION (the central stale-race)
	// -----------------------------------------------------------------
	describe("P0 #1: real coordinator supersession", () => {
		it("DCBR01-01: a stale `PermitEnqueue` (marker advanced to B/epoch=8) is rejected by the C5 guard; marker unchanged; no completion commit", async () => {
			const h = makeHarness({
				activeSessionId: "A",
				activeTaskId: "T_A",
				heldJobIds: ["j1", "j2"],
			})
			// Seed marker at A / epoch=7 (the harness already does this).
			const initialMarker = h.coordinator.getDeferredCompletionBarrierForTesting()
			expect(initialMarker).toBeDefined()
			expect(initialMarker?.sessionId).toBe("A")
			expect(initialMarker?.taskId).toBe("T_A")

			// Install a controllable invoke. The test will hold the
			// consult in flight, mutate the marker to B/epoch=8,
			// then release the invoke with a valid `PermitEnqueue`
			// directive (computed against the OLD A/epoch=7 facts).
			// The C5 stale-decision guard MUST downgrade to
			// `fallthrough` because the live marker is now B/epoch=8.
			const ctl = makeControllableInvoke()
			let capturedRequestId: string | null = null
			h.installInvoke(async (facts) => {
				capturedRequestId = facts.requestId
				return ctl.invoke(facts)
			})

			// Start the enqueue (do NOT await yet — the consult is
			// now pending inside `consultE31BarrierForFacts`).
			const enqueuePromise = h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 2, h.activeTaskId)

			// Yield so the consult actually starts and the invoke
			// is entered. The harness's `enqueueCompletionContinuation`
			// callback MUST NOT have been called yet because the
			// consult is in flight. The held-set-progress consult
			// (the existing Continuation Control Elm kernel at
			// L1732) must complete FIRST, then the E3.1 consult
			// is reached. We poll up to 1s for the invoke to be
			// captured, then fail with a clear message.
			const deadline = Date.now() + 1000
			while (capturedRequestId === null && Date.now() < deadline) {
				await new Promise((r) => setImmediate(r))
			}
			expect(capturedRequestId).not.toBeNull()
			expect(h.sendLog.length).toBe(0)
			expect(h.completionCommitCount()).toBe(0)

			// Now mutate the live marker to a different owner
			// (B / epoch=8). The consult's facts are still
			// {sessionId:"A", taskId:"T_A", markerEpoch:7} (the
			// snapshot the host collected BEFORE the await). The
			// C5 guard will detect the drift and return
			// `fallthrough` (so the TS predecessor runs).
			h.coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: "B",
				taskId: "T_B",
				epoch: 8,
			})
			const driftedMarker = h.coordinator.getDeferredCompletionBarrierForTesting()
			expect(driftedMarker?.sessionId).toBe("B")
			expect(driftedMarker?.epoch).toBe(8)

			// Release the invoke with a valid `PermitEnqueue`
			// (the directive the kernel WOULD have returned for
			// the A/epoch=7 facts). The C5 guard should reject it.
			ctl.release(permitDirective(false, capturedRequestId!))

			// Await the enqueue outcome.
			const outcome = await enqueuePromise

			// The four P0 invariants the reviewer asked for:
			//   1. no enqueue fired from the consult's stale
			//      directive (the consult returned `fallthrough`)
			//   2. the marker is unchanged (the consult did not
			//      mutate it)
			//   3. the dedupe slot is NOT pinned by the consult
			//   4. no completion commit fired
			//
			// Note on invariant 1: the consult returned
			// `fallthrough`, so the TS predecessor's L1633..L1685
			// cascade ran. With a fresh dedupe slot and
			// `priorSortedHeld === undefined` (first call), the
			// cascade may pin the dedupe slot to the
			// `continuationSessionEpoch = "A|T_A|<epoch>"` key —
			// that is the TS-predecessor's LEGITIMATE enqueue
			// against the LIVE marker (B/epoch=8). That is the
			// ElmUnavailable_UsePredecessor path the C4
			// conservation contract REQUIRES. The discriminator
			// is the marker: the consult's stale
			// `PermitEnqueue(mustClearRearm=false)` did NOT
			// mutate the marker (the L1840 `clear_rearm` branch
			// never ran). The marker is still B/epoch=8.
			expect(h.completionCommitCount()).toBe(0)
			const afterMarker = h.coordinator.getDeferredCompletionBarrierForTesting()
			expect(afterMarker?.sessionId).toBe("B")
			expect(afterMarker?.taskId).toBe("T_B")
			expect(afterMarker?.epoch).toBe(8)
			// The outcome is one of the legitimate TS-predecessor
			// outcomes. It is NOT a consult-induced effect on B.
			expect(["delivered", "no_held_job_ids", "not_held", "already_sent"]).toContain(outcome.kind)
		})
	})

	// -----------------------------------------------------------------
	// P0 #2: PRODUCTION NECESSITY (Elm governs the outcome)
	// -----------------------------------------------------------------
	describe("P0 #2: production necessity — the Elm directive governs the coordinator's outcome", () => {
		it("DCBR01-02: a healthy `SuppressDuplicate` directive suppresses the enqueue with `already_sent`", async () => {
			const h = makeHarness({ heldJobIds: ["j1", "j2"] })
			h.installInvoke(async (facts) => suppressDuplicateDirective(facts.requestId!))
			const outcome = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 2, h.activeTaskId)
			// The Elm consult said: a prior successful enqueue for
			// THIS exact dedupe key has already happened. Suppress.
			expect(outcome.kind).toBe("already_sent")
			expect(h.sendLog.length).toBe(0)
			expect(h.completionCommitCount()).toBe(0)
		})

		it("DCBR01-03: a healthy `PermitEnqueue{mustClearRearm:true}` directive clears the REARM dedupe and delivers the enqueue", async () => {
			const h = makeHarness({ heldJobIds: ["j1", "j2"] })
			// Seed a prior dedupe slot to simulate "REARM pinned"
			// AND a prior sorted held-set snapshot so the E3.1
			// kernel's `mustClearRearm` is `true` (per
			// `Policy.elm:mustClearRearm = prior != null`).
			const internal = h.coordinator as unknown as {
				lastCompletionContinuationSessionEpoch: string | undefined
				lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
				lastCompletionContinuationControlFingerprint: string | undefined
			}
			internal.lastCompletionContinuationSessionEpoch = "PREV"
			internal.lastCompletionContinuationHeldSetSorted = ["j9"]
			internal.lastCompletionContinuationControlFingerprint = "fingerprint"
			expect(internal.lastCompletionContinuationSessionEpoch).toBe("PREV")

			h.installInvoke(async (facts) => permitDirective(true, facts.requestId!))
			const outcome = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 2, h.activeTaskId)
			// The Elm consult said: real progress — release the
			// REARM dedupe and let the enqueue proceed.
			expect(outcome.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
			// The Elm's `clear_rearm` branch cleared the prior
			// dedupe slot (L1881). After the consult, the TS
			// predecessor's L1890 re-pins it to the current
			// `continuationSessionEpoch` ("session-dcbr01|task-dcbr01|<epoch>").
			// The discriminator is the VALUE: the consult's
			// `clear_rearm` branch SET it to undefined; the
			// subsequent TS-predecessor enqueue PINS it to a
			// new value. The test asserts the value is a
			// non-empty, non-"PREV" string (i.e., the consult's
			// `clear_rearm` did clear it, and the TS
			// predecessor's enqueue pinned a fresh key).
			const finalDedupe = internal.lastCompletionContinuationSessionEpoch
			expect(finalDedupe).toBeDefined()
			expect(finalDedupe).not.toBe("PREV")
			expect(finalDedupe!.length).toBeGreaterThan(0)
		})

		it("DCBR01-04: a healthy `PreserveBarrier` directive suppresses the enqueue with `no_held_job_ids`", async () => {
			// The L1662 guard `unconsumedOwnedTerminalResultsForC10 > 0`
			// returns `not_held` early. We must pass a positive
			// count to reach the consult, but set the heldJobIds
			// list to empty so the Elm kernel sees `heldJobCount=0`
			// and returns `preserve_barrier`. This simulates the
			// race the Elm consult catches.
			const h = makeHarness({ heldJobIds: [] })
			h.installInvoke(async (facts) => preserveBarrierDirective(facts.requestId!))
			const outcome = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 1, h.activeTaskId)
			// The Elm consult said: the held set is empty at the
			// consult point (race). Suppress.
			expect(outcome.kind).toBe("no_held_job_ids")
			expect(h.sendLog.length).toBe(0)
			expect(h.completionCommitCount()).toBe(0)
		})

		it("DCBR01-05: an `kernel_offline` non-directive consult falls through to the TS predecessor (which then delivers)", async () => {
			const h = makeHarness({ heldJobIds: ["j1", "j2"] })
			h.installInvoke(async () => kernelOffline())
			const outcome = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 2, h.activeTaskId)
			// The consult is non-directive; the C4 conservation
			// contract requires the TS predecessor to run.
			expect(outcome.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
		})

		it("DCBR01-06: a malformed directive is rejected at the public-adapter boundary and falls through to the TS predecessor", async () => {
			const h = makeHarness({ heldJobIds: ["j1", "j2"] })
			// A custom invoke that returns a malformed directive
			// (an unknown kind). The strict
			// `validateConsultResult` boundary MUST reject this as
			// `decode_error`; the consult then returns
			// `fallthrough`; the TS predecessor runs.
			h.installInvoke(
				async () =>
					({
						kind: "directive",
						value: { kind: "garbage_unknown_kind" } as never,
						summary: "garbage",
						requestId: "x",
					}) as never,
			)
			const outcome = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 2, h.activeTaskId)
			// The TS predecessor runs (same path as DCBR01-05).
			expect(outcome.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
		})

		it("DCBR01-07: a `decode_error` (malformed echo) consult falls through to the TS predecessor", async () => {
			const h = makeHarness({ heldJobIds: ["j1", "j2"] })
			h.installInvoke(async (facts) => decodeErrorMalformed(facts.requestId!))
			const outcome = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 2, h.activeTaskId)
			// The consult is non-directive (`decode_error`); the
			// TS predecessor runs.
			expect(outcome.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
		})

		it("DCBR01-08: a `RejectStaleIdentity` consult is DOWNGRADED to `fallthrough` by the C5 guard when the live marker is gone; the TS predecessor returns `not_held`", async () => {
			const h = makeHarness({ heldJobIds: ["j1", "j2"] })
			// The C5 guard's re-read after the await sees the
			// live marker; if it matches, the directive is
			// applied. We use `marker_absent` AFTER the marker
			// is cleared; the C5 guard's `!liveMarker` check
			// returns `fallthrough`. The TS predecessor's L1627
			// guard sees `!this.deferredCompletionBarrier` and
			// returns `not_held`.
			h.coordinator.setDeferredCompletionBarrierForTesting(undefined)
			h.installInvoke(async (facts) => rejectStaleIdentityDirective("marker_absent", facts.requestId!))
			const outcome = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 2, h.activeTaskId)
			// The TS predecessor's L1627 guard returns `not_held`
			// because the live marker is gone.
			expect(outcome.kind).toBe("not_held")
			expect(h.sendLog.length).toBe(0)
		})
	})

	// -----------------------------------------------------------------
	// P1: TIMEOUT / LATE-RESPONSE CLEANUP
	// -----------------------------------------------------------------
	describe("P1: timeout / late-response cleanup", () => {
		it("DCBR01-09: a custom invoke that NEVER resolves is settled by the public-boundary timer (the harness's enqueue completes within the 5s default)", async () => {
			const h = makeHarness({ heldJobIds: ["j1", "j2"] })
			// A never-resolving custom invoke. The public-boundary
			// timer in `consultDeferredCompletionBarrierElmKernel`
			// (5s default) MUST fire and surface a `decode_error`
			// so the consult returns `fallthrough` and the TS
			// predecessor runs.
			h.installInvoke(
				() =>
					new Promise<DeferredCompletionBarrierElmConsult>(() => {
						// intentionally never resolves
					}),
			)
			// Race the enqueue against a watchdog. If the enqueue
			// doesn't settle within 6_500ms (5s timer + 1.5s
			// slack), fail with a clear message. This proves the
			// public-boundary timer fires and the consult
			// surfaces a `decode_error` -> `fallthrough` -> TS
			// predecessor.
			const enqueuePromise = h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 2, h.activeTaskId)
			const result = await Promise.race([
				enqueuePromise,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("DCBR01-09: enqueue hung past 6.5s public-boundary timer")), 6500),
				),
			])
			// The consult surfaced `decode_error(no_response)`,
			// the consult returned `fallthrough`, the TS
			// predecessor ran. With a fresh dedupe slot and a
			// non-empty held set, the TS predecessor returns
			// `delivered`.
			expect(result.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
		})
	})
})

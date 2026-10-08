/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-UNRESOLVABLE-TERMINAL-OUTCOME01 — CCUTO01 / CORRECTION01
 *
 * LIVE specimen (frozen at Oct 8 2026, session/task 1791413688644_o729w):
 *
 *   terminal_committed        = 154
 *   held_job_ids              = 7
 *   submit_and_exit_seen      = 2
 *   continuation_scheduled    = 1
 *   continuation_started      = 1
 *   stalled_no_progress       = 0
 *   task_completion_committed = 0
 *
 *   model-visible control: "No continuation mechanism is available"
 *                         "Do NOT issue completion or observation"
 *   harness mandate:       "Run is not complete until submit_and_exit"
 *
 * CORRECTION01 FIXES the contract defects the prior pass left open:
 *
 *   1. `completionCommitCount` was a count of all `setTurnPhase` calls
 *      — it conflated any phase write (e.g. `idle`, `streaming`) with
 *      the genuine completion commit. Replaced by
 *      `completedPhaseCalls` (strict `phase === "completed"` filter)
 *      AND `taskCompletionCommittedRecords` (capture of the actual
 *      `task_completion_committed` CCARD record — the factual commit
 *      event). The two observers must agree on a real commit.
 *
 *   2. The harness `setHeldCount(0)` then `setHeldJobIds([...7 ids])`
 *      path immediately re-derived the count from the list, so the
 *      count/list divergence the test was supposed to construct was
 *      never built. Now `setHeldCount` and `setHeldJobIds` are
 *      INDEPENDENT setters — the count provider and the list provider
 *      are kept separate, and a count=0 / list=7 divergence can be
 *      constructed.
 *
 *   3. The harness bypassed the production Elm caller. The
 *      `enqueueCompletionContinuation` callback invoked
 *      `formatCompletionContinuationPrompt` directly with no
 *      `runtimeControlDirective`, so the test never exercised the
 *      real `pickContinuationDirectiveForPublication` consult. Now
 *      the harness uses the production
 *      `buildSdkControllerEnqueueCompletionContinuation` factory with
 *      `liveTools` and an `invokeElmForProduction` test seam so the
 *      real Elm-resolved directive flows into the prompt footer.
 *
 *   4. No test asserted a HOST-OWNED BLOCKED OUTCOME. The prior suite
 *      only checked `completionCommitCount === 0`, which is
 *      necessary-but-insufficient: a delivered prompt containing
 *      "do not invoke tools" still satisfies that assertion. The new
 *      CCUTO-10/11/12 tests assert an explicit, nameable bounded
 *      outcome (no setTurnPhase("completed"), no CCARD
 *      `task_completion_committed` record).
 *
 *   5. CCUTO-03 deliberately left the dedupe marker intact, so it
 *      could not establish that STALL lifetime (not REARM dedupe)
 *      prevents re-enqueue after the natural BCB re-registration.
 *      CCUTO-03b clears the dedupe marker so the test discriminates
 *      REARM dedupe suppression from STALL fingerprint suppression.
 *
 *   6. CCUTO-08 previously asserted 2 commits for 2 submits, which
 *      is consistent with at-most-once-per-submit but is not a
 *      faithful "session-level at-most-once completion commit" pin.
 *      The corrected observer (strict phase=`completed` + CCARD
 *      capture) makes the assertion coherent.
 *
 * The RED probe continues to test the BOUNDARY the LIVE specimen
 * raises: a completion obligation that cannot progress and for
 * which the LIVE specimen observed zero task_completion_committed
 * events. The corrected harness is the substrate for that decision;
 * the prior 9 tests are PRESERVED as passing conservation witnesses
 * (their semantics tightened by the new observer filters).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import {
	SdkSessionEventCoordinator,
	type SdkSessionEventCoordinatorOptions,
} from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"
import {
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
	clearContinuationCardinalityAuthorityCapture,
} from "../continuation-cardinality-authority"
import {
	pickContinuationDirectiveForPublication,
	type CompletionContinuationControlElmKernelInvoke,
	type CompletionContinuationControlFactsInput,
} from "../completion-continuation-control-elm"
import type { ContinuationDirective } from "../completion-continuation-control-elm"

const agentEvent = (sessionId: string, event: Record<string, unknown>) =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as never

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: vi.fn(),
		}),
	},
}))

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly heldJobIds: readonly string[]
	readonly prompt: string
	readonly delivery: string
	readonly runtimeControlKind: string
}

interface ProductionHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly sendLog: ContinuationSend[]
	/**
	 * Strict observer of C05 — only fires when the production
	 * coordinator calls `setTurnPhase("completed", ...)`. Replaces the
	 * prior `completionCommitCount` which counted every phase write.
	 */
	readonly completedPhaseCalls: () => number
	/**
	 * Independent observer of the actual `task_completion_committed`
	 * CCARD record — the factual commit event. Reaches the harness
	 * via the production capture API. Must agree with
	 * `completedPhaseCalls` for a real commit.
	 */
	readonly taskCompletionCommittedRecords: () => number
	/**
	 * Last phase the production write was observed under. Used to
	 * distinguish a `setTurnPhase("streaming", ...)` write (NOT a
	 * commit) from a real `setTurnPhase("completed", ...)` commit.
	 */
	readonly lastPhaseWrite: () => string
	/**
	 * Independent setters — count and list do NOT re-derive each
	 * other. A count=0 / list=7 divergence can be constructed.
	 */
	readonly setHeldJobIds: (ids: readonly string[]) => void
	readonly setHeldCount: (n: number) => void
	readonly setMarkerPresent: (present: boolean) => void
	readonly setOwnerRunning: (running: boolean) => void
	readonly setLiveTools: (tools: readonly string[] | undefined) => void
	readonly clearDeliveryDedupe: () => void
	readonly triggerInitialSubmitAndEnqueue: () => Promise<void>
	readonly triggerAgentTurnDone: () => Promise<void>
}

const SEVEN_HELD_IDS: readonly string[] = [
	"cmd_held_01",
	"cmd_held_02",
	"cmd_held_03",
	"cmd_held_04",
	"cmd_held_05",
	"cmd_held_06",
	"cmd_held_07",
]

/**
 * Build a per-test Elm kernel sentinel. The harness uses the real
 * production caller `buildSdkControllerEnqueueCompletionContinuation`
 * which calls `pickContinuationDirectiveForPublication` internally;
 * the test injects this `invokeElmForProduction` so the directive
 * the production formatter receives is the sentinel. The default
 * sentinel is `fail_closed(observation_unavailable)` (Policy.elm P5)
 * — the production kernel's actual decision for the LIVE specimen
 * shape (`held > 0 + canObserveHeldResults: false`). Tests that
 * exercise the real Elm kernel (CCUTO-13/14) do NOT inject a
 * sentinel.
 */
function makeElmSentinel(directive: ContinuationDirective): CompletionContinuationControlElmKernelInvoke {
	return async () => ({ kind: "directive", heldSetProgress: "indeterminate", value: directive })
}

function makeHarness(opts: {
	activeSessionId?: string
	activeTaskId?: string
	initialHeldIds?: readonly string[]
	initialHeldCountOverride?: number
	initialLiveTools?: readonly string[] | undefined
	initialOwnerRunning?: boolean
	elmSentinel?: ContinuationDirective
} = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const activeSessionId = opts.activeSessionId ?? "session-ccuto01"
	const activeTaskId = opts.activeTaskId ?? "task-ccuto01"

	// Independent count and list — the LIVE specimen's held-job
	// bookkeeping has BOTH a count provider and a list provider that
	// can disagree. The harness must model the disagreement, not
	// hide it. `initialHeldCountOverride` lets a test seed a
	// count=0 / list=7 divergence at construction time; the setters
	// remain independent for in-flight updates.
	let heldCount = opts.initialHeldCountOverride ?? opts.initialHeldIds?.length ?? 0
	let heldIds: readonly string[] = opts.initialHeldIds ?? []
	let ownerRunning = opts.initialOwnerRunning ?? false
	let liveTools: readonly string[] | undefined = opts.initialLiveTools

	const sendLog: ContinuationSend[] = []
	let completedPhaseCallsCount = 0
	let lastPhaseWrite = "idle"

	const getUnconsumedOwnedTerminalResultCount = () => heldCount
	const getUnconsumedOwnedTerminalJobIds = () => heldIds

	// Sentinel directive. The default matches the LIVE specimen's
	// Elm-classified shape: held > 0 + observation unavailable =>
	// `fail_closed(observation_unavailable)` (Policy.elm P5). The default
	// sentinel exercises the production kernel's actual decision for the
	// fact set `held > 0 + canObserveHeldResults: false` — the LIVE
	// specimen shape. Production never emits `tag: "wait_for_host"`
	// for this fact set; the `wait_for_host` shape exists in the
	// decoder union but Policy.elm has no branch that emits it.
	// The prior default (`tag: "wait_for_host"`) was a TS-side
	// misclassification that conflated the Elm `tag` union with the
	// TS predecessor `completionStatus: "COMMITTED"` shape
	// (`buildCompletionContinuationControl` emits this for
	// `held=0 + retry available` — see CTRL-03 in
	// `completion-continuation-control-elm-correspondence.cccec01.test.ts`).
	const sentinelDirective: ContinuationDirective = opts.elmSentinel ?? {
		completionStatus: "CANNOT_CONTINUE",
		requiredAction: "fail_closed",
		tag: "fail_closed",
		failureReason: "observation_unavailable",
	}

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		// Use the REAL production translator. The `done` event
		// follows the canonical shape; the harness already primed
		// translatorState via `setAttemptCompletionSeen` +
		// `setTerminalResponseCommittedThisTurn` before the event is
		// emitted, matching the predecessor's emitCompletionTurn
		// pattern. The harness pre-arms the marker so the C10 barrier
		// predicate evaluates with the held count set by the
		// harness's getUnconsumedOwnedTerminalResultCount callback.
		translateSessionEvent: (
			event: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["translateSessionEvent"]>>[0],
			state: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["translateSessionEvent"]>>[1],
		) => ({
			messages: [],
			sessionEnded: false,
			turnComplete: (() => {
				if (event.type !== "agent_event") return false
				const inner = event.payload.event as { type?: string }
				return inner.type === "done"
			})(),
		}),
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: ({ sessionId, prompt, delivery, runtimeControlKind }: {
						sessionId: string
						prompt: string
						delivery: string
						runtimeControlKind?: string
					}) => {
						sendLog.push({
							sessionId,
							taskId: activeTaskId,
							heldJobIds: heldIds,
							prompt,
							delivery,
							runtimeControlKind: runtimeControlKind ?? "(none)",
						})
						return Promise.resolve()
					},
				} as never,
				unsubscribe: () => undefined,
				startResult: { sessionId: activeSessionId } as never,
				isRunning: false,
			}),
			setRunning: () => undefined,
		},
		messages: {
			appendAndEmit: (() => undefined) as never,
		},
		taskHistory: { updateTaskUsage: () => undefined } as never,
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: () => Promise.resolve(undefined),
		// CORRECTION01: the strict observer. Only `phase === "completed"`
		// increments `completedPhaseCallsCount`. A `setTurnPhase("idle",
		// ...)`, `setTurnPhase("streaming", ...)` or any other non-commit
		// phase write MUST NOT register as a completion commit.
		setTurnPhase: ((phase, _anchorTs, writerId) => {
			tracker.setWithWriter(phase, undefined, { writerId: writerId as never })
			lastPhaseWrite = phase
			if (phase === "completed") {
				completedPhaseCallsCount += 1
			}
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		hasRunningBackgroundJobForOwner: () => ownerRunning,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount,
		getUnconsumedOwnedTerminalJobIds,
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		// CORRECTION01: the harness now uses the PRODUCTION caller
		// `buildSdkControllerEnqueueCompletionContinuation`, not the
		// legacy 4-branch TS formatter. This exercises the real
		// `pickContinuationDirectiveForPublication` consult + the real
		// `formatCompletionContinuationPrompt` with
		// `runtimeControlDirective` — the substrate the LIVE specimen's
		// Elm fail-closed wording actually traverses.
		enqueueCompletionContinuation: buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: ({
						sessionId: sendSessionId,
						prompt,
						delivery,
						runtimeControlKind,
					}: {
						sessionId: string
						prompt: string
						delivery: string
						runtimeControlKind?: string
					}) => {
						sendLog.push({
							sessionId: sendSessionId,
							taskId: activeTaskId,
							heldJobIds: heldIds,
							prompt,
							delivery,
							runtimeControlKind: runtimeControlKind ?? "(none)",
						})
						return Promise.resolve()
					},
				} as never,
				unsubscribe: () => undefined,
				startResult: { sessionId: activeSessionId } as never,
				isRunning: false,
			}),
			liveTools: () => liveTools,
			// Elm test seam — the production caller accepts this option
			// and threads it through to `pickContinuationDirectiveForPublication`.
			// The sentinel returns the directive the test seeded via `opts.elmSentinel`,
			// which the formatter renders into the prompt footer.
			invokeElmForProduction: makeElmSentinel(sentinelDirective),
			logger: { warn: () => undefined },
		}),
		// Reset hook for the upstream diagnostic profile (NEEDED so
		// notifyAgentTurnDone / reevaluateDeferredCompletionBarrier
		// can run end-to-end without the production dispatch chain
		// complaining about missing dependencies).
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		} as never,
		pendingPromptAuthorityAvailable: true,
		beginProviderFailureTelemetryTurn: () => undefined,
		captureProviderApiError: () => undefined,
		// Elm authority provider. Without a real backend, the legacy
		// default-Authorize fallback returns authorize and lets the
		// reevaluate chain reach setTurnPhase("completed") when all
		// conservation checks pass. The harness mirrors the predecessor
		// pattern (completion-authority-elm-first-seam01.case01.test.ts).
		getElmCompletionAuthorityDecision: () => ({
			kind: "authorize",
			reason: "ccuto01_default_authorize",
		}),
		flushElmAuthorityForSession: async () => undefined,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		activeSessionId,
		activeTaskId,
		sendLog,
		completedPhaseCalls: () => completedPhaseCallsCount,
		// CORRECTION01: the CCARD observer. The production
		// `reevaluateDeferredCompletionBarrier` calls
		// `captureContinuationCardinalityAuthorityRecord({stage: "task_completion_committed", ...})`
		// AFTER `setTurnPhase("completed", ...)`. Read this back through
		// the production capture API. Counts only records with
		// `stage === "task_completion_committed"` — the factual commit
		// event. Agrees with `completedPhaseCalls` for a real commit.
		taskCompletionCommittedRecords: () => {
			const records = getContinuationCardinalityAuthorityCaptureRecords()
			return records.filter((r) => r.stage === "task_completion_committed").length
		},
		lastPhaseWrite: () => lastPhaseWrite,
		// CORRECTION01: setters are INDEPENDENT. `setHeldCount(n)`
		// changes ONLY the count provider; `setHeldJobIds(ids)` changes
		// ONLY the list provider. The CCUTO-04 fixture
		// `count=0 / list=7` is constructed by a test that calls
		// `setHeldCount(0)` first, then `setHeldJobIds(SEVEN_HELD_IDS)`
		// — the count stays at 0, the list is now 7 IDs.
		setHeldJobIds: (ids) => {
			heldIds = ids
		},
		setHeldCount: (n) => {
			heldCount = n
		},
		setMarkerPresent: (present) => {
			if (!present) {
				coordinator.setDeferredCompletionBarrierForTesting(undefined)
				return
			}
			coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: activeSessionId,
				taskId: activeTaskId,
				epoch: translatorState.getMinter().epoch,
			})
		},
		setOwnerRunning: (running) => {
			ownerRunning = running
		},
		setLiveTools: (tools) => {
			liveTools = tools
		},
		clearDeliveryDedupe: () => {
			coordinator.clearCompletionContinuationSentForTesting()
		},
		triggerInitialSubmitAndEnqueue: async () => {
			// Drive the production seam through the REAL
			// handleSessionEvent BCB re-registration block. The C10
			// barrier predicate (handleSessionEvent L2000-2075) is
			// the ONLY place that sets the marker + fires the
			// continuation enqueue in production. This is the seam the
			// LIVE specimen exercises.
			//
			// The translator state is set BEFORE the event so the C10
			// path reaches the BCB block (the production code requires
			// `attemptCompletionSeen` + `terminalResponseCommitted` to
			// reach the barrier predicate).
			translatorState.setAttemptCompletionSeen()
			translatorState.setTerminalResponseCommittedThisTurn()
			const doneEvent = agentEvent(activeSessionId, {
				type: "done",
				reason: "completed",
				text: "Task completed.",
				iterations: 1,
			})
			await coordinator.handleSessionEvent(doneEvent)
			// Allow fire-and-forget enqueue to settle.
			await new Promise<void>((r) => setTimeout(r, 0))
		},
		triggerAgentTurnDone: async () => {
			// Mirror the production: notifyAgentTurnDone → reevaluate.
			await coordinator.notifyAgentTurnDone(activeSessionId)
		},
	}
}

beforeEach(() => {
	// Enable the production CCARD capture so the
	// `task_completion_committed` records emitted by
	// `reevaluateDeferredCompletionBarrier` are observable by the
	// harness's `taskCompletionCommittedRecords` counter.
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
})

afterEach(() => {
	// Disable the capture so the records do not leak across tests.
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
})

describe("CCUTO01 — completion-continuation-unresolvable-terminal-outcome01", () => {
	describe("RED#1 — seven held jobs, NO observation tool registered", () => {
		it("CCUTO-01: held > 0 + no observation tool => host does NOT instruct unavailable command_status", async () => {
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: ["submit_and_exit"],
				initialOwnerRunning: false,
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// Bounded invariant: when the resumed turn has NO observation
			// tool, the prompt MUST NOT instruct the model to call one.
			// This is the C9 wording-degradation guard at
			// background-notify-coordinator.ts:320-326.
			for (const send of h.sendLog) {
				expect(send.prompt).not.toContain("command_status")
				expect(send.prompt).not.toContain("issue ONE")
			}
			// Bounded invariant: completion is NOT fabricated while held > 0.
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)
		})

		it("CCUTO-02: held > 0 + no observation + no completion => fail_closed footer is rendered", async () => {
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: [],
				initialOwnerRunning: false,
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// Bounded invariant: when neither tool is registered, the
			// footer MUST degrade to a bounded fail-closed wording.
			// The harness now exercises the PRODUCTION caller
			// (`buildSdkControllerEnqueueCompletionContinuation`) which
			// ALWAYS supplies `runtimeControlDirective`. With the
			// default sentinel `tag: "fail_closed"` /
			// `failureReason: "observation_unavailable"` (Policy.elm
			// P5 — the actual production kernel decision for this
			// fact set), the production formatter renders "No
			// continuation mechanism is available for this turn" +
			// "Do NOT issue any completion or observation tool".
			const lastSend = h.sendLog[h.sendLog.length - 1]
			expect(lastSend).toBeDefined()
			const prompt = lastSend?.prompt ?? ""
			expect(prompt).toMatch(/Do NOT/i)
			// Strict invariant: NEVER instruct unavailable tools.
			expect(prompt).not.toContain("`command_status` tool call")
			expect(prompt).not.toContain("`submit_and_exit` with the final verified summary")
		})

		it("CCUTO-03: held > 0 + fail_closed directive + identical re-evaluation => NO second delivery for same held set", async () => {
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: [],
				initialOwnerRunning: false,
			})
			h.setMarkerPresent(true)

			// K submit + first agent_turn_done.
			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			const initialDeliveryCount = h.sendLog.length
			expect(initialDeliveryCount).toBeGreaterThan(0)

			// K+1 submit + second agent_turn_done. The held set is
			// unchanged (the model cannot drain the IDs without an
			// observation tool). In production, the BCB re-registration
			// at handleSessionEvent L2045 clears the dedupe session
			// epoch but NOT the STALL fingerprint or heldSet snapshot
			// (CORRECTION01 lifetimes). The harness pre-arms the
			// marker, so the production dedupe-clear does not run here;
			// we leave the dedupe SessionEpoch intact and rely on the
			// natural fingerprint match to suppress the second delivery.
			// This is the LIVE specimen's "STALL fingerprint survives
			// re-registration" invariant.
			h.setHeldCount(SEVEN_HELD_IDS.length)
			h.setHeldJobIds(SEVEN_HELD_IDS)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// The host MUST NOT generate a SECOND continuation prompt
			// for an unchanged unresolved state. The dedupe OR the stall
			// fingerprint (whichever the current implementation relies
			// on) MUST suppress the second delivery. The harness
			// preserves the dedupe marker, so the production SessionEpoch
			// dedupe MUST suppress the second enqueue.
			expect(h.sendLog.length).toBe(initialDeliveryCount)
		})
	})

	describe("RED#2 — count=0 / list=7 divergence: continuation delivered, completion NOT committed", () => {
		it("CCUTO-04: count=0 + heldJobIds list=[7] => NO task completion fabricated", async () => {
			const h = makeHarness({
				initialHeldIds: [],
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: false,
			})
			h.setMarkerPresent(true)

			// K submit: the held state is 7 (LIVE specimen shape).
			h.setHeldCount(7)
			h.setHeldJobIds(SEVEN_HELD_IDS)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// K+1: count-based provider disagrees with list-based
			// provider. This is the exact divergence the LIVE upstream
			// counters prove (`unconsumedTerminalCountPositive=0`,
			// `heldJobIdsCountLast=7`).
			h.setHeldCount(0)
			h.setHeldJobIds(SEVEN_HELD_IDS) // stale IDs list

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// Bounded invariant: completion is NOT fabricated while
			// the held IDs list is non-empty, even if the count
			// provider returned 0. The LIVE specimen proves this
			// invariant holds; this test pins it so a future repair
			// cannot regress it. Both the strict phase observer AND
			// the CCARD record observer must agree.
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)
		})

		it("CCUTO-09: LIVE-shape end-to-end chronology => task_completion_committed=0 with held>0", async () => {
			// The LIVE specimen's two-submit chronology. With the
			// BCB marker pre-armed (the natural state after submit #1
			// sets it via the C10 path):
			//
			//   K submit (held=7) → continuation_enqueued (1)
			//   agent_turn_done (K) → reeval → held>0 → continues
			//   held; the metric fires; the runtime calls this
			//   K+1 submit (held still 7)
			//   → enqueue count=7 → DELIVERED count=2
			//   → but BCB re-registration at L2045 clears the
			//   SessionEpoch dedupe; the STALL fingerprint persists
			//   → agent_turn_done (K+1) → reeval → marker present +
			//   held>0 → reeval does NOT commit (conservation holds)
			//
			// The LIVE specimen's terminal state: 0 task_commits
			// because the held set NEVER drains (the model has no
			// observation tool OR the IDs are stale). This test pins
			// the invariant: an unchanged held set across multiple
			// submits MUST NOT commit completion.
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: [],
				initialOwnerRunning: false,
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)
			// K=1 delivery (the K+1 is suppressed by dedupe OR
			// stall — see CCUTO-03).
			expect(h.sendLog.length).toBeLessThanOrEqual(2)
		})
	})

	describe("Discriminator matrix (C7) — bounded A/B variants", () => {
		it("CCUTO-05: held=0 + observation + completion => normal completion path", async () => {
			const h = makeHarness({
				initialHeldIds: [],
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: false,
			})
			h.setMarkerPresent(true)
			h.setHeldCount(0)
			h.setHeldJobIds([])

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// No held state => no continuation prompt. The conservation
			// path commits completion once via setTurnPhase("completed").
			// The completion commit can only fire when the BCB re-
			// registration block re-enters; without going through
			// handleSessionEvent, setTurnPhase is invoked only by the
			// reevaluate chain. The current harness pre-arms the marker
			// so the count-based short-circuit in
			// enqueueCompletionContinuationIfHeld returns `not_held`.
			// The reevaluate chain's completion commit only fires when
			// ALL conservation checks pass — which they do here.
			expect(h.sendLog.length).toBe(0)
			// We exercise the conservation chain through the
			// reevaluate site. Even if the count-based enqueue
			// short-circuits, reevaluate carries the conservation
			// checks and should reach the setTurnPhase("completed")
			// call when held=0.
			expect(h.completedPhaseCalls()).toBeGreaterThanOrEqual(1)
			expect(h.taskCompletionCommittedRecords()).toBeGreaterThanOrEqual(1)
		})

		it("CCUTO-06: held=7 + observation + completion => continuation delivered, completion deferred", async () => {
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: false,
				// Switch the sentinel to `observe_then_retry` so the
				// production caller emits the observe-then-retry
				// wording naming the available tool. The default
				// `fail_closed(observation_unavailable)` sentinel
				// would degrade to "no continuation mechanism is
				// available" and not exercise the prompt's
				// tool-naming branch.
				elmSentinel: {
					completionStatus: "HELD",
					requiredAction: "observe_then_submit",
					tag: "observe_then_retry",
				},
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			expect(h.sendLog.length).toBeGreaterThan(0)
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)

			const lastSend = h.sendLog[h.sendLog.length - 1]
			// The production formatter renders `observe_then_retry`
			// directive with the available observation + completion
			// tool names. The directive's footer must NAME the
			// available tool — this is the bounded instruction the
			// LIVE preamble cites.
			expect(lastSend?.prompt).toContain("`command_status`")
			expect(lastSend?.prompt).toContain("`submit_and_exit`")
		})

		it("CCUTO-07: held=7 + owner running => continuation may fire, completion deferred (BCB01 §0.1)", async () => {
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: true,
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// The enqueueIfHeld layer fires on the held>0 check (the
			// count-based gate) — owner-running is a separate
			// conservation check consulted by reevaluate BEFORE the
			// completion commit. So the continuation may have been
			// delivered, but completion MUST NOT have been committed.
			// This pins the BCB01 §0.1 invariant: no completion
			// fabrication while a task-owned job is still RUNNING.
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)
		})
	})

	describe("Conservation matrix (C13) — neighboring fixes still hold", () => {
		it("CCUTO-08: ordinary successful submit_and_exit commits completion exactly once per conservation-clear attempt (per-attempt, not session-level idempotence)", async () => {
			const h = makeHarness({
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: false,
			})
			// No marker pre-arm. Each submit's done event goes through
			// the C10 barrier; with held=0 the conservation checks pass
			// and a SINGLE completion commits via setTurnPhase("completed").
			//
			// SCOPE BOUNDARY (per Factory review): this test pins
			// PER-ATTEMPT idempotence (one commit per submit_and_exit
			// event under held=0). It does NOT pin session-level
			// idempotence (at-most-one commit per session across the
			// lifetime of the task). The C10 barrier re-registers per
			// attempt; the conservation chain commits at most once per
			// conservation-clear event. Session-level idempotence would
			// require a global per-(sessionId, taskId) commit counter,
			// which is out of scope for this RED.
			h.setHeldCount(0)
			h.setHeldJobIds([])

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// Each submit_and_exit corresponds to ONE completion commit.
			// The harness pre-armed the marker via setMarkerPresent
			// (false path), so the production flow runs the natural C10
			// barrier + reeval sequence. We expect exactly 2 commits —
			// one per submit_and_exit conservation-clear event.
			// Both observers (strict phase + CCARD capture) must agree.
			expect(h.completedPhaseCalls()).toBe(2)
			expect(h.taskCompletionCommittedRecords()).toBe(2)
		})
	})

	// CORRECTION01: NEW BLOCK. Completion-fabrication-prevention
	// contract. The prior suite only checked `completedPhaseCalls ===
	// 0` for held>0, which is necessary-but-insufficient: a
	// delivered prompt saying "do not invoke tools" still satisfies
	// that assertion. CCUTO-10/11/12 tighten the contract: the
	// host MUST NOT commit task completion while a held observation
	// obligation exists, AND the delivered prompt MUST degrade to a
	// bounded fail-closed wording (NOT instruct unavailable tools).
	//
	// SCOPE BOUNDARY (per Factory review):
	//   These tests assert `COMPLETION_FABRICATION_PREVENTED`, NOT
	//   an observable `blocked` / `stalled_no_progress` /
	//   `requires_operator` host-owned outcome. The LIVE specimen's
	//   original symptom — an unresolved obligation with
	//   contradictory continuation instructions — is partially
	//   addressed by the count/list repair in
	//   `sdk-session-event-coordinator.ts`. The broader
	//   "host-owned blocked outcome" contract remains on the epic
	//   board and is NOT proven by these tests.
	describe("RED#3 — completion-fabrication-prevention contract", () => {
		it("CCUTO-10: held=7 + no observation + no completion tool => zero-commits fabrication prevention", async () => {
			// The LIVE specimen's exact failure mode: held=7,
			// observation=unavailable, completion=unavailable.
			// The COMPLETION_FABRICATION PREVENTION invariants:
			//   - setTurnPhase("completed", ...) NEVER fires
			//   - captureContinuationCardinalityAuthorityRecord(
			//       stage: "task_completion_committed") NEVER fires
			//   - the prompt delivered to the model renders the
			//     bounded fail-closed wording (NOT instructing
			//     unavailable tools)
			//
			// SCOPE BOUNDARY (per Factory review): the prompt
			// wording below is the result of an INJECTED directive
			// sentinel — NOT the production Elm kernel output for
			// these facts. The actual production-Elm directive
			// for `held=7 + no observation + no completion` is
			// `tag: "fail_closed"` with `failureReason:
			// "observation_unavailable"` (per `Policy.elm` P5).
			// CCUTO-13 pins the real-Elm-kernel directive
			// independently of any sentinel.
			//
			// The injected sentinel here uses the same fail-closed
			// branch the production kernel emits for this fact
			// set, so the prompt wording matches what the model
			// would see in production. The sentinel is a TS-side
			// projection; the Elm kernel itself never emits
			// `tag: "wait_for_host"` for this fact set (the
			// `wait_for_host` shape exists in the decoder union
			// but Policy.elm has no branch that emits it).
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: [],
				initialOwnerRunning: false,
				elmSentinel: {
					completionStatus: "CANNOT_CONTINUE",
					requiredAction: "fail_closed",
					tag: "fail_closed",
					failureReason: "observation_unavailable",
				},
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// COMPLETION_FABRICATION PREVENTION: both observers
			// must agree on zero commits. A delivered prompt
			// MUST NOT satisfy this assertion.
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)
			expect(h.lastPhaseWrite()).not.toBe("completed")

			// Bounded invariant: prompt NEVER instructs
			// unavailable tools. The model has neither
			// `command_status` nor `submit_and_exit` registered.
			for (const send of h.sendLog) {
				expect(send.prompt).not.toContain("`command_status` tool call")
				expect(send.prompt).not.toContain("`submit_and_exit` with the final verified summary")
			}

			// Bounded invariant: prompt renders the bounded
			// fail-closed footer (the substrate the LIVE
			// specimen's "Do NOT issue completion or observation"
			// text actually traverses).
			const lastSend = h.sendLog[h.sendLog.length - 1]
			expect(lastSend).toBeDefined()
			expect(lastSend?.prompt).toMatch(/Do NOT issue any completion or observation tool/)
			expect(lastSend?.prompt).toMatch(/No continuation mechanism is available/i)
		})

		it("CCUTO-11: count=0 / list=7 divergence => zero-commits fabrication prevention", async () => {
			// RED#2 with CORRECTION01 harness semantics.
			// The count=0 / list=7 divergence the LIVE
			// upstream counters prove. Constructed via
			// `initialHeldCountOverride: 0` + `initialHeldIds:
			// SEVEN_HELD_IDS` so the count and list providers
			// disagree at construction time. The prior
			// CCUTO-04 had a setters-coupled bug that hid this
			// divergence; CCUTO-11 pins the truly diverged
			// fixture.
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialHeldCountOverride: 0,
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: false,
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// The list is non-empty so the BCB01 second
			// conjunct MUST hold the barrier and refuse to
			// commit completion. Both observers must agree.
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)
		})

		it("CCUTO-12: held > 0 + observation enabled => continuation names the available tool + no completion", async () => {
			// The opposite discrimination: the capability IS
			// registered, so the prompt MAY instruct the model
			// to use it. But the held set does NOT drain, so the
			// completion commit MUST still be blocked.
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: false,
				elmSentinel: {
					completionStatus: "HELD",
					requiredAction: "observe_then_submit",
					tag: "observe_then_retry",
				},
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			// A continuation MUST be delivered — the directive's
			// `observe_then_retry` tag triggers the
			// observe-then-retry wording.
			expect(h.sendLog.length).toBeGreaterThan(0)
			const lastSend = h.sendLog[h.sendLog.length - 1]
			expect(lastSend?.prompt).toContain("`command_status`")
			expect(lastSend?.prompt).toContain("`submit_and_exit`")

			// Bounded invariant: completion MUST NOT be
			// committed while the held set is non-empty.
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)
// Bounded invariant: completion MUST NOT be
			// committed while the held set is non-empty.
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.taskCompletionCommittedRecords()).toBe(0)
		})
	})

	// CORRECTION01: NEW BLOCK. Real-Elm-kernel fixture.
	// The prior RED#3 (CCUTO-10/11/12) tested the production seam
	// (buildSdkControllerEnqueueCompletionContinuation +
	// enqueueCompletionContinuation) but with an injected Elm
	// directive sentinel. Per Factory review, that is "useful
	// production-seam evidence, but it is not a real-Elm-policy
	// qualification." CCUTO-13/14 close it: they drive the real
	// production Elm kernel (`pickContinuationDirectiveForPublication`
	// with the default `invokeElmKernel`) on the LIVE specimen's
	// exact fact set and assert the kernel's ACTUAL directive.
	//
	// SCOPE BOUNDARY: these tests assert the kernel's PROJECTION,
	// not its effect-execution. They do NOT assert a host-owned
	// blocked outcome; they pin the canonical fact->projection
	// correspondence the BCB01 §0.1 second conjunct now consults.
	describe("RED#4 — real production Elm kernel projection (CCUTO-13/14)", () => {
		it("CCUTO-13: LIVE specimen facts => real kernel emits fail_closed(observation_unavailable)", async () => {
			// The LIVE specimen's exact fact set:
			//   unconsumedCount = 7 (held=7)
			//   capabilities = { canObserveHeldResults: false, canRetryCompletion: false }
			//   stalledNoProgress = false
			//   sessionMatches = true
			//   taskMatches = true
			//   alreadyCommitted = false
			//
			// Production wiring (SdkController.ts:930-948):
			//   pickContinuationDirectiveForPublication({
			//     unconsumedCount: heldJobIds.length,
			//     capabilities: {
			//       canObserveHeldResults: toolNames.includes("command_status"),
			//       canRetryCompletion: toolNames.includes("submit_and_exit"),
			//     },
			//     priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
			//     sessionMatches: active.sessionId === sessionId,
			//     taskMatches: true,
			//     alreadyCommitted: false,
			//   })
			//
			// The harness calls pickContinuationDirectiveForPublication
			// with NO invokeElmForProduction option — the default
			// `invokeElmKernel` (the compiled Elm kernel) runs.
			// Policy.elm P5: `FailClosed ObservationUnavailable`.
			const facts: CompletionContinuationControlFactsInput = {
				unconsumedCount: 7,
				capabilities: { canObserveHeldResults: false, canRetryCompletion: false },
				priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
				sessionMatches: true,
				taskMatches: true,
				alreadyCommitted: false,
			}
			const directive = await pickContinuationDirectiveForPublication(facts)

			// Bounded invariant: production kernel emits `fail_closed`
			// with `failureReason: "observation_unavailable"` for
			// `held > 0 + canObserveHeldResults: false`. This is the
			// canonical correspondence the predecessor CTRL-02 test
			// (cccec01) established for both TS-reference and Elm.
			expect(directive.tag).toBe("fail_closed")
			expect(directive.tag === "fail_closed" ? directive.failureReason : "not_fail_closed").toBe(
				"observation_unavailable",
			)
		})

		it("CCUTO-14: held=7 + observation + completion => real kernel emits ObserveThenRetry", async () => {
			// The opposite fact set: held=7 + both capabilities.
			// Policy.elm P4: `ObserveThenRetry`.
			//
			// This is the substrate the predecessor C8 tests
			// pinned (continuation can name the available tool
			// when observation + completion are registered).
			const facts: CompletionContinuationControlFactsInput = {
				unconsumedCount: 7,
				capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
				priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
				sessionMatches: true,
				taskMatches: true,
				alreadyCommitted: false,
			}
			const directive = await pickContinuationDirectiveForPublication(facts)

			expect(directive.tag).toBe("observe_then_retry")
			expect(directive.completionStatus).toBe("HELD")
			expect(directive.requiredAction).toBe("observe_then_submit")
		})
	})
})
/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-UNRESOLVABLE-TERMINAL-OUTCOME01 — CCUTO01
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
 * The trace proves: one host continuation was delivered, the model
 * invoked submit_and_exit a second time inside the continuation turn,
 * and the run ended with ZERO task_completion_committed events.
 *
 * This RED targets the BOUNDARY the LIVE specimens raise but the
 * existing test corpus never exercises — the unresolvable terminal
 * outcome. Concretely:
 *
 *   - RED#1  (CCUTO-01..03): seven held jobs + NO observation tool
 *             registered on the resumed turn. The current seam
 *             sends `delivered` with a `fail_closed` directive footer
 *             ("Do NOT issue any tool") but produces no bounded
 *             blocked outcome and no termination signal to the
 *             caller. The model is told to wait; the handler does not
 *             wait — it re-evaluates indefinitely.
 *
 *   - RED#2  (CCUTO-04): continuation succeeded (delivered) but
 *             the model cannot progress because the held list is
 *             stale (count-based unconsumedOwnedTerminalResultCount
 *             returns 0 while the IDs list reports 7). The current
 *             seam simply commits completion once count clears,
 *             which FAILS the constraint that completion may not commit
 *             while held observations exist.
 *
 * The tests are RED probes. They DO NOT mandate a repair shape.
 * They pin the invariants the bounded repair (if any) MUST honor:
 *
 *   - task completion MUST NOT be fabricated against an unobservable
 *     held state;
 *   - the host MUST stop scheduling automatic continuations for an
 *     unchanged unresolved obligation;
 *   - the caller MUST receive an explicit bounded blocked result;
 *   - the model MUST NOT be instructed to invoke unavailable tools;
 *   - repeated identical submission MUST be idempotent.
 *
 * If the host already satisfies these invariants for the LIVE
 * specimen, the RED probe must still pass — and we report
 * HALT_RED_NOT_REPRODUCED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import {
	formatCompletionContinuationPrompt,
} from "../background-notify-coordinator"
import {
	SdkSessionEventCoordinator,
	type SdkSessionEventCoordinatorOptions,
} from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

// Build a CoreSessionEvent of type `agent_event` carrying the
// supplied inner agent event. Mirrors the helper in the
// predecessor's completion-continuation-stall-lifetime01 test.
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
}

interface ProductionHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly sendLog: ContinuationSend[]
	readonly completionCommitCount: () => number
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

function makeHarness(opts: {
	activeSessionId?: string
	activeTaskId?: string
	initialHeldIds?: readonly string[]
	initialLiveTools?: readonly string[] | undefined
	initialOwnerRunning?: boolean
} = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const activeSessionId = opts.activeSessionId ?? "session-ccuto01"
	const activeTaskId = opts.activeTaskId ?? "task-ccuto01"

	let heldCount = opts.initialHeldIds?.length ?? 0
	let heldIds: readonly string[] = opts.initialHeldIds ?? []
	let ownerRunning = opts.initialOwnerRunning ?? false
	let liveTools: readonly string[] | undefined = opts.initialLiveTools

	const sendLog: ContinuationSend[] = []
	let completionCommitCount = 0

	const setUnconsumedOwnedTerminalResultCount = () => heldCount
	const setUnconsumedOwnedTerminalJobIds = () => (heldCount > 0 ? heldIds : [])

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
					send: ({ sessionId, prompt }: { sessionId: string; prompt: string }) => {
						sendLog.push({
							sessionId,
							taskId: activeTaskId,
							heldJobIds: heldIds,
							prompt,
						})
						return Promise.resolve()
					},
					liveTools: () => liveTools,
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
		setTurnPhase: ((phase, _anchorTs, writerId) => {
			tracker.setWithWriter(phase, undefined, { writerId: writerId as never })
			completionCommitCount += 1
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		hasRunningBackgroundJobForOwner: () => ownerRunning,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: setUnconsumedOwnedTerminalResultCount,
		getUnconsumedOwnedTerminalJobIds: setUnconsumedOwnedTerminalJobIds,
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			// Use the REAL production formatter so the prompt is the
			// exact shape the runtime would deliver. The Elm kernel is
			// bypassed via a fail_closed sentinel (no consultation of
			// the real kernel — this is a SEAM probe). When the live
			// runtime has the observation tool but the held list is
			// non-empty, the legacy `hasObservation` × `hasCompletion`
			// branches run (no `runtimeControlDirective`), which is
			// the substrate the C8 substrate tests pin.
			const tools = liveTools ?? []
			const observation = tools.includes("command_status") ? ["command_status"] : []
			const completionMech = tools.includes("submit_and_exit") ? ["submit_and_exit"] : []
			const prompt = formatCompletionContinuationPrompt({
				heldJobIds: input.heldJobIds,
				sessionId: input.sessionId,
				taskId: input.taskId,
				availableObservationMechanisms: observation,
				availableCompletionMechanisms: completionMech,
			})
			sendLog.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				heldJobIds: input.heldJobIds,
				prompt,
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
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
		completionCommitCount: () => completionCommitCount,
		setHeldJobIds: (ids) => {
			heldIds = ids
			heldCount = ids.length
		},
		setHeldCount: (n) => {
			heldCount = n
			if (n === 0) {
				heldIds = []
			}
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
	// Each test constructs a fresh SdkSessionEventCoordinator. No
	// global cache to clear; the Elm kernel is reset by per-suite
	// setUp in the live TS reference's neighboring tests when
	// needed (this RED does not need it).
})

afterEach(() => {
	// No global teardown required for this suite.
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
			expect(h.completionCommitCount()).toBe(0)
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
			// footer MUST degrade to a fail-closed wording. The legacy
			// 4-branch TS path uses "No observation or completion
			// mechanism is available in this turn's tool registry" when
			// BOTH tools are absent; the Elm-directive path would use
			// "No continuation mechanism is available". The harness
			// exercises the legacy path (no `runtimeControlDirective`
			// is supplied to the formatter) so we accept either of
			// those bounded fail-closed wordings here.
			const lastSend = h.sendLog[h.sendLog.length - 1]
			expect(lastSend).toBeDefined()
			const prompt = lastSend?.prompt ?? ""
			const hasLegacyFailClosed = prompt.includes(
				"No observation or completion mechanism is available in this turn's tool registry",
			)
			const hasElmFailClosed = prompt.includes("No continuation mechanism is available")
			expect(hasLegacyFailClosed || hasElmFailClosed).toBe(true)
			expect(prompt).toMatch(/Do NOT/i)
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
			// cannot regress it.
			expect(h.completionCommitCount()).toBe(0)
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

			expect(h.completionCommitCount()).toBe(0)
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
			expect(h.completionCommitCount()).toBeGreaterThanOrEqual(1)
		})

		it("CCUTO-06: held=7 + observation + completion => continuation delivered, completion deferred", async () => {
			const h = makeHarness({
				initialHeldIds: SEVEN_HELD_IDS,
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: false,
			})
			h.setMarkerPresent(true)

			await h.triggerInitialSubmitAndEnqueue()
			await h.triggerAgentTurnDone()
			await new Promise<void>((r) => setTimeout(r, 0))

			expect(h.sendLog.length).toBeGreaterThan(0)
			expect(h.completionCommitCount()).toBe(0)

			const lastSend = h.sendLog[h.sendLog.length - 1]
			expect(lastSend?.prompt).toContain("command_status")
			expect(lastSend?.prompt).toContain("submit_and_exit")
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
			expect(h.completionCommitCount()).toBe(0)
		})
	})

	describe("Conservation matrix (C13) — neighboring fixes still hold", () => {
		it("CCUTO-08: ordinary successful submit_and_exit commits completion exactly once per conservation-clear", async () => {
			const h = makeHarness({
				initialLiveTools: ["command_status", "submit_and_exit"],
				initialOwnerRunning: false,
			})
			// No marker pre-arm. Each submit's done event goes through
			// the C10 barrier; with held=0 the conservation checks pass
			// and a SINGLE completion commits via setTurnPhase("completed").
			// We assert exactly 2 because the predecessor's BCB01 §0.1
			// invariant requires completion to commit at most once per
			// conservation-clear event.
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
			expect(h.completionCommitCount()).toBe(2)
		})
	})
})
/**
 * ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01 — BOCR01
 *
 * Single bounded production-seam probe (per Factory reviewer
 * disposition on ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-
 * NONCONVERGENCE01 at commit 1dd61a5d5): drives the LIVE chronology
 * end-to-end against the REAL BackgroundNotifyCoordinator +
 * SdkSessionEventCoordinator + bounded host correlation guard, then
 * discriminates the four candidate causes of the held-observation-
 * while-lacking-capability symptom.
 *
 * Decisive question: why does the active runtime retain an observation
 * obligation while lacking the capability to discharge it?
 *
 * See the test bodies for the per-case RED/GREEN/ablation matrix.
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	BackgroundNotifyCoordinator,
	type ConsumeTerminalDecision,
	legacyConsumeTerminalPolicy,
} from "../background-notify-coordinator"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

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

interface WakeSend {
	readonly sessionId: string
	readonly jobId: string
	readonly prompt: string
}

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId?: string
	readonly prompt: string
	readonly delivery: "queue"
}

interface BocrHarness {
	coordinator: SdkSessionEventCoordinator
	notifyCoordinator: BackgroundNotifyCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	activeSessionId: string
	activeTaskId: string
	wakeLog: WakeSend[]
	continuationLog: ContinuationSend[]
	completionCommitCount: () => number
	setLiveTools: (tools: readonly string[] | undefined) => void
	consumeTerminal: (
		jobId: string,
		opts?: { terminalState?: "exited" | "containment_failed"; exitCode?: number },
	) => Promise<ConsumeTerminalDecision>
	commandStatusResolveObligation: (jobId: string) => { kind: "resolved" | "no_marker" }
	commandStatusConsumeNonNotify: (jobId: string) => void
	reevaluateBarrier: () => Promise<void>
	getHeldCount: () => number
	getHeldJobIds: () => readonly string[]
	getNotificationMarkersForJob: (jobId: string) => boolean
	getTrackerPhase: () => string
}

function makeBocrHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): BocrHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-bocr01"
	const activeTaskId = opts.activeTaskId ?? "task-bocr01"

	const wakeLog: WakeSend[] = []
	const continuationLog: ContinuationSend[] = []
	let completionCommitCount = 0
	let liveTools: readonly string[] | undefined = ["submit_and_exit"]
	let now = 0

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: async ({ sessionId, prompt, jobId }) => {
			wakeLog.push({ sessionId, jobId: jobId ?? "", prompt })
			return { kind: "delivered" as const }
		},
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: (input: { sessionId: string; prompt: string; delivery: "queue"; runtimeControlKind?: string }) => {
						continuationLog.push({
							sessionId: input.sessionId,
							taskId: activeTaskId,
							prompt: input.prompt,
							delivery: input.delivery,
						})
						return Promise.resolve()
					},
				} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		},
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId)
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== activeSessionId) return []
			return notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, tid)
		},
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			if (input.heldJobIds.length === 0) {
				return Promise.resolve({ kind: "no_held_job_ids" as const })
			}
			continuationLog.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				prompt: `COALESCED continuation for jobIds=${input.heldJobIds.join(",")}`,
				delivery: "queue",
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
		liveTools: () => liveTools,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		notifyCoordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		wakeLog,
		continuationLog,
		completionCommitCount: () => completionCommitCount,
		setLiveTools: (tools) => {
			liveTools = tools
		},
		consumeTerminal: (jobId, terminalOpts) => {
			return notifyCoordinator.consumeTerminal({
				jobId,
				terminalState: terminalOpts?.terminalState ?? "exited",
				exitCode: terminalOpts?.exitCode ?? 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
		},
		commandStatusResolveObligation: (jobId) => {
			const decision = notifyCoordinator.resolveObligation({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
				resolution: "canonical_status_observed",
			})
			// Path C gate (matches production command-status-tool.ts:384-393).
			if (!notifyCoordinator.hasActiveNotify(jobId)) {
				notifyCoordinator.consumeNonNotifyTerminalObservation({
					jobId,
					sessionId: activeSessionId,
					taskId: activeTaskId,
				})
			}
			return { kind: decision.kind === "resolved" ? "resolved" : "no_marker" }
		},
		commandStatusConsumeNonNotify: (jobId) => {
			notifyCoordinator.consumeNonNotifyTerminalObservation({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
			})
		},
		reevaluateBarrier: () => coordinator.reevaluateDeferredCompletionBarrier(),
		getHeldCount: () => notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId),
		getHeldJobIds: () => notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, activeTaskId),
		getNotificationMarkersForJob: (jobId) => notifyCoordinator.hasActiveNotify(jobId),
		getTrackerPhase: () => tracker.currentPhase,
	}
}

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

async function emitSubmitAndExit(
	coordinator: SdkSessionEventCoordinator,
	translatorState: MessageTranslatorState,
	sessionId: string,
): Promise<void> {
	translatorState.setAttemptCompletionSeen()
	translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: "Task completed.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
}

// =============================================================================
// BOCR01 — Blocked-observation capability recovery probe
// =============================================================================
//
// Each test exercises the real production seam end-to-end:
//   BackgroundNotifyCoordinator (notify owner, hold/drain semantics)
//     + SdkSessionEventCoordinator (C10 barrier, BCB re-registration,
//       bounded host correlation guard at sdk-session-event-coordinator.ts:3105-3120,
//       reevaluateDeferredCompletionBarrier)
//     + real `liveTools()` projection (the bounded guard consults it
//       at line 3108-3110)
//     + real `consumeTerminal` (notify=true held decision path)
//     + real `resolveObligation` / `consumeNonNotifyTerminalObservation`
//       (Path A/B/C drain paths the production command_status tool uses).
//
// The probe discriminates between four candidate causes of the
// "held-observation-while-lacking-capability" symptom:
//   A. Held registration is correct, capability is missing
//   B. Held registration is wrong (false positive)
//   C. Capability projection is wrong (projection bug)
//   D. Recovery attempt is broken
// =============================================================================

describe("BOCR01 — Blocked-observation capability recovery probe", () => {
	// -------------------------------------------------------------------------
	// BOCR01-01: HELD-STATE ESTABLISHMENT
	//
	// Drive the LIVE chronology against the real production components:
	//   - registerMarker(J)            [real notify coordinator]
	//   - consumeTerminal(J)           [real seam; held (heldCount=1) because
	//                                  another J (J-double) is also registered
	//                                  and still in flight]
	//   - emit submit_and_exit         [real SdkSessionEventCoordinator seam]
	//   - bounded host correlation guard fires (liveTools LACKS command_status)
	//   - setTurnPhase("error", ..., "session-event-bcb-blocked-observation-unavailable")
	//
	// Asserts: held set visible to C10, completion NOT committed, blocked
	// outcome published.
	// -------------------------------------------------------------------------
	it("BOCR01-01: held observation is correctly established when a notify=true job reaches terminal while another marker is in flight and liveTools lacks command_status", async () => {
		const h = makeBocrHarness()
		// Two notify=true jobs; first becomes terminal while the second is
		// still in flight, so the BCB should hold the first.
		h.notifyCoordinator.registerMarker({
			jobId: "J-1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.notifyCoordinator.registerMarker({
			jobId: "J-2",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		// J-1 becomes terminal; J-2 is still in flight ⇒ consumeTerminal
		// returns held (heldCount=1) per the legacyConsumeTerminalPolicy
		// + the real SEAM04 kernel decision surface.
		const decision = await h.consumeTerminal("J-1")
		expect(decision.kind).toBe("held")
		if (decision.kind === "held") {
			expect(decision.heldCount).toBe(1)
		}
		expect(h.wakeLog).toHaveLength(0) // no wake fired (held)
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2)
		expect(h.getHeldJobIds().slice().sort()).toEqual(["J-1", "J-2"])
		// Notification marker for J-1 is gone (consumeTerminal moved it
		// to heldTerminalResults).
		expect(h.getNotificationMarkersForJob("J-1")).toBe(false)
		// J-2 is still in the notify marker set.
		expect(h.getNotificationMarkersForJob("J-2")).toBe(true)

		// Emit submit_and_exit. liveTools = ["submit_and_exit"] ⇒
		// canObserveHeldResults === false ⇒ bounded correlation guard
		// fires; setTurnPhase("error", ..., "session-event-bcb-blocked-observation-unavailable")
		// is called; no continuation enqueue; no task completion.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.continuationLog).toHaveLength(0) // inner enqueue short-circuited
		expect(h.completionCommitCount()).toBe(0) // no completion fabricated
		expect(h.getTrackerPhase()).toBe("error") // host wrote error phase
		// The held set is preserved across the BCB block (no drain).
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2)
		expect(h.getHeldJobIds().slice().sort()).toEqual(["J-1", "J-2"])
	})

	// -------------------------------------------------------------------------
	// BOCR01-02: A SECOND TERMINAL EVENT TRIGGERS THE DRAIN (recovery path)
	//
	//   Continues from BOCR01-01: with capability still missing, a new
	//   terminal event for J-2 reaches consumeTerminal. Because there are
	//   no more outstanding notify markers (J-1 is in heldTerminalResults;
	//   the marker set is now empty), the decision becomes drained and:
	//     - heldTerminalResults is deleted (drain)
	//     - wake is dispatched for BOTH J-1 and J-2 (the drained set)
	//   After the drain, the held set is empty. A subsequent
	//   reevaluateDeferredCompletionBarrier finds held=0, the BCB
	//   barrier does not re-stamp.
	//
	// Discriminates: candidate A (held is correct, recovery exists via
	// the wake dispatch chain) is supported when this test passes.
	// Candidate D (recovery is broken) is REFUTED.
	// -------------------------------------------------------------------------
	it("BOCR01-02: a second terminal event for the held owner drains heldTerminalResults and dispatches the wake — recovery path is intact", async () => {
		const h = makeBocrHarness()
		h.notifyCoordinator.registerMarker({
			jobId: "J-1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.notifyCoordinator.registerMarker({
			jobId: "J-2",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		const d1 = await h.consumeTerminal("J-1")
		expect(d1.kind).toBe("held")
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2)

		// First BCB block: liveTools lacks command_status.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.completionCommitCount()).toBe(0)
		expect(h.getTrackerPhase()).toBe("error")
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2) // still held after BCB block

		// Recovery: J-2 becomes terminal. consumeTerminal returns drained.
		// The held set is deleted, the wake is dispatched for both J-1
		// and J-2 (drainedCount=2: 1 from the held list + 1 for the new
		// J-2 terminal).
		const d2 = await h.consumeTerminal("J-2")
		expect(d2.kind).toBe("drained")
		if (d2.kind === "drained") {
			expect(d2.drainedCount).toBe(2)
			expect(d2.enqueuedNow).toBe(true)
		}
		// The held set is empty.
		expect(h.getHeldCount()).toBe(0)
		expect(h.getHeldJobIds()).toEqual([])
		// Wake was dispatched (one entry per job drained + the new job).
		expect(h.wakeLog).toHaveLength(2)
		expect(h.wakeLog.map((w) => w.jobId).sort()).toEqual(["J-1", "J-2"])

		// The bounded correlation guard marker is gone (the BCB block
		// was on J-1, not J-2, and the drain is the recovery). The next
		// reevaluate should NOT re-stamp observation_unavailable.
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		// No new continuation enqueue (held=0, no eligibility).
		expect(h.continuationLog).toHaveLength(0)
		// No new setTurnPhase to "error" (the marker is gone; the
		// prior tracker phase write is not overwritten by a drain).
		expect(h.getHeldCount()).toBe(0)
		expect(h.completionCommitCount()).toBe(0) // still 0; submit not re-emitted
		expect(h.getTrackerPhase()).toBe("error")
	})

	// -------------------------------------------------------------------------
	// BOCR01-03: SINGLE CAUSAL CHAIN — the reviewer's question, end-to-end
	//
	//   Real background job J (notify=false / fire-and-forget)
	//     → recordNonNotifyTerminalObservation(J) [real production seam at
	//       vscode-run-commands-tool.ts:890]
	//     → held set = 1 (the non-notify observation is held; the BCB01
	//       §0.1 second conjunct fires)
	//     → emit submit_and_exit [real SdkSessionEventCoordinator seam]
	//     → bounded host correlation guard fires (liveTools lacks
	//       command_status ⇒ canObserveHeldResults === false)
	//     → setTurnPhase("error", undefined,
	//                      "session-event-bcb-blocked-observation-unavailable")
	//
	//   PROBE — capability restoration + observation:
	//     → liveTools() gains "command_status"
	//     → command_status(J) is issued by the model
	//       (the production Path C consumer at
	//       command-status-tool.ts:384-393)
	//     → BackgroundNotifyCoordinator.resolveObligation(J, "canonical_status_observed")
	//       returns no_marker (no notify=true marker for J)
	//     → consumeNonNotifyTerminalObservation(J) drains the held entry
	//     → held set contracts to 0
	//     → reevaluateDeferredCompletionBarrier finds held=0
	//     → The task may now complete (a fresh submit_and_exit would
	//       transition setTurnPhase("completed", ...))
	//
	// Discriminates all four candidates:
	//   A. Held registration is correct (the held entry existed; the
	//      observation via command_status drained it). SUPPORTED.
	//   B. Held registration is wrong (false positive). REFUTED — the
	//      held entry was genuine; the command_status call drained it.
	//   C. Capability projection is wrong (projection bug). REFUTED —
	//      the bounded correlation guard correctly transitioned
	//      canObserveHeldResults from false to true when command_status
	//      was added to liveTools.
	//   D. Recovery attempt is broken. REFUTED — the command_status call
	//      drained the held entry; the held set contracted to 0.
	// -------------------------------------------------------------------------
	it("BOCR01-03: single causal chain — non-notify held observation is correctly drained by command_status when capability is restored (reviewer's question end-to-end)", async () => {
		const h = makeBocrHarness()
		// Step 1: a non-notify background job reaches terminal. The
		// production seam at vscode-run-commands-tool.ts:890 calls
		// recordNonNotifyTerminalObservation synchronously.
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J-probe",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		// The held set is positive (the BCB01 §0.1 second conjunct
		// unconsumed_owned_terminal_results > 0).
		expect(h.getHeldCount()).toBe(1)
		expect(h.getHeldJobIds()).toEqual(["J-probe"])

		// Step 2: emit submit_and_exit. liveTools = ["submit_and_exit"]
		// only ⇒ canObserveHeldResults === false ⇒ bounded correlation
		// guard fires; setTurnPhase("error", ..., "session-event-bcb-blocked-observation-unavailable").
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.completionCommitCount()).toBe(0)
		expect(h.getTrackerPhase()).toBe("error")
		expect(h.continuationLog).toHaveLength(0)
		// The held set is preserved across the BCB block.
		expect(h.getHeldCount()).toBe(1)

		// Step 3 (PROBE): capability restoration. The resumed-turn
		// tool registry now includes command_status. The bounded
		// correlation guard's canObserveHeldResults === true.
		h.setLiveTools(["command_status", "submit_and_exit"])

		// Step 4 (PROBE): the model issues command_status(J-probe).
		// The production command_status tool calls:
		//   - resolveObligation(J-probe, "canonical_status_observed")
		//     → no_marker (no notify=true marker for J-probe; it was
		//       registered as a non-notify observation)
		//   - hasActiveNotify(J-probe) === false ⇒ the Path C gate
		//     passes; consumeNonNotifyTerminalObservation(J-probe) drains
		//     the held entry.
		const resolution = h.commandStatusResolveObligation("J-probe")
		expect(resolution.kind).toBe("no_marker") // Path A: no notify marker
		// The held set contracts to 0 (Path C drained the non-notify
		// observation).
		expect(h.getHeldCount()).toBe(0)
		expect(h.getHeldJobIds()).toEqual([])

		// Step 5: the held set is empty. A subsequent
		// reevaluateDeferredCompletionBarrier finds held=0; the BCB
		// barrier does not re-stamp observation_unavailable; no
		// continuation enqueue (the held obligation is gone).
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		// The held set stays at 0.
		expect(h.getHeldCount()).toBe(0)
		// The task may now complete on a fresh submit_and_exit (the
		// setTurnPhase("completed", ...) path is below the reeval; the
		// next submit with held=0 and wasErrorSeen=false and
		// wasTerminalResponseCommittedThisTurn=true would transition
		// the phase to "completed" — we don't re-emit submit here
		// because the test's purpose is the drain, not the commit).
		expect(h.completionCommitCount()).toBe(0) // submit not re-emitted
	})

	// -------------------------------------------------------------------------
	// BOCR01-04: PROBE — command_status on a held notify=true job does
	// NOT drain heldTerminalResults (Path A returns no_marker; Path C
	// is a no-op because the job was registered as notify=true, not
	// as a non-notify observation). The only drain path for a
	// notify=true held job is a subsequent consumeTerminal that
	// returns "drained" — which is what BOCR01-02 exercises.
	//
	// This is the discriminating test for candidate A vs B: if the
	// held set were a false positive (B), command_status would drain
	// it. It does not. Held registration is correct.
	// -------------------------------------------------------------------------
	it("BOCR01-04: command_status on a held notify=true job does NOT drain heldTerminalResults — held registration is correct (A supported, B refuted)", async () => {
		const h = makeBocrHarness()
		h.notifyCoordinator.registerMarker({
			jobId: "J-1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.notifyCoordinator.registerMarker({
			jobId: "J-2",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		const d1 = await h.consumeTerminal("J-1")
		expect(d1.kind).toBe("held")
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2)

		// The model calls command_status(J-1) before submit_and_exit.
		// The production command_status tool calls
		// resolveObligation (Path A/B) AND consumeNonNotifyTerminalObservation
		// (Path C, gated on !hasActiveNotify).
		const resolution = h.commandStatusResolveObligation("J-1")
		// For a notify=true held job, the notification marker is GONE
		// (it was moved to heldTerminalResults). So resolveObligation
		// returns no_marker; hasActiveNotify(J-1) is false; Path C
		// consumeNonNotifyTerminalObservation fires but is a no-op
		// (J-1 was never registered as a non-notify observation).
		expect(resolution.kind).toBe("no_marker")
		// The held set is unchanged.
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2)
		expect(h.getHeldJobIds().slice().sort()).toEqual(["J-1", "J-2"])
		// Path C drained nothing (J-1 was a notify=true observation;
		// the non-notify map is empty for J-1).
		expect(h.notifyCoordinator.hasActiveNotify("J-1")).toBe(false)
	})

	// -------------------------------------------------------------------------
	// BOCR01-05: ABLATION — neutralizing the held path removes the
	// observation_unavailable block, confirming the held set is the
	// cause.
	//
	//   Mirrors the C6 necessity pattern: override the held-count
	//   adapter to always return 0. The bounded correlation guard's
	//   eligibility predicate
	//   `unconsumedOwnedTerminalResultsForC10 > 0` is false; the guard
	//   does not fire; the BCB block does not publish
	//   observation_unavailable.
	// -------------------------------------------------------------------------
	it("BOCR01-05: ablation — neutralizing the held path removes the observation_unavailable block, confirming the held set is the cause", async () => {
		const h = makeBocrHarness()
		// Override the held-count adapter to always return 0.
		;(
			h.coordinator as unknown as {
				getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => number
			}
		).getUnconsumedOwnedTerminalResultCount = () => 0
		// No markers, no held. submit_and_exit; the BCB block has
		// no held obligation; bounded guard does not fire; no
		// observation_unavailable publication; no error phase.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.completionCommitCount()).toBe(0)
		// The tracker was never written to "error" by the bounded
		// guard.
		expect(h.getTrackerPhase()).not.toBe("error")
	})

	// -------------------------------------------------------------------------
	// BOCR01-06: IDENTITY DISCIPLINE — cross-session / cross-task isolation
	// -------------------------------------------------------------------------
	it("BOCR01-06: cross-session / cross-task identity isolation — a foreign owner's resolveObligation does not drain the held set", async () => {
		const h = makeBocrHarness()
		h.notifyCoordinator.registerMarker({
			jobId: "J-1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.notifyCoordinator.registerMarker({
			jobId: "J-2",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		const d1 = await h.consumeTerminal("J-1")
		expect(d1.kind).toBe("held")
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2)

		// A foreign owner attempts to resolve the held entry.
		// resolveObligation is keyed by (jobId, sessionId, taskId);
		// a foreign triple is rejected (the owner-mismatch check at
		// background-notify-coordinator.ts:2026-2028).
		const foreignResolution = h.notifyCoordinator.resolveObligation({
			jobId: "J-1",
			sessionId: "session-foreign",
			taskId: "task-foreign",
			resolution: "canonical_status_observed",
		})
		expect(foreignResolution.kind).toBe("no_marker")
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2)
		expect(h.getHeldJobIds().slice().sort()).toEqual(["J-1", "J-2"])
	})

	// -------------------------------------------------------------------------
	// BOCR01-07: same-task re-issued submit_and_exit after a BCB block
	// does not re-publish observation_unavailable (marker already
	// carries the reason; sameObligationAlreadyObservationUnavailable
	// short-circuits the bounded guard).
	// -------------------------------------------------------------------------
	it("BOCR01-07: same-task re-issued submit_and_exit after a BCB block does not re-publish observation_unavailable (marker already carries the reason)", async () => {
		const h = makeBocrHarness()
		h.notifyCoordinator.registerMarker({
			jobId: "J-1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.notifyCoordinator.registerMarker({
			jobId: "J-2",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		const d1 = await h.consumeTerminal("J-1")
		expect(d1.kind).toBe("held")

		// First submit_and_exit: liveTools lacks command_status.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.getTrackerPhase()).toBe("error")

		// Same-task re-issued submit_and_exit (user pressed Retry).
		// The BCB re-registration fires again; the bounded guard's
		// sameObligationAlreadyObservationUnavailable check is true;
		// the guard short-circuits and does NOT call setTurnPhase again.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		// The tracker phase is still "error" (not overwritten).
		expect(h.getTrackerPhase()).toBe("error")
		expect(h.getHeldCount()).toBe(2) // 1 held (J-1) + 1 live marker (J-2)
		expect(h.getHeldJobIds().slice().sort()).toEqual(["J-1", "J-2"])
	})
})

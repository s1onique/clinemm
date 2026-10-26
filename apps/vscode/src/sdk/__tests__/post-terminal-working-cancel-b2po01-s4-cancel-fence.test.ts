/**
 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
 * / B2PO01 — S4 CANCELLATION WRITER / FENCE SEMANTICS.
 *
 * THE REVIEW'S S4 REQUIREMENT
 *
 *   "Strengthen S4 with the actual cancellation writer/fence semantics.
 *   Specifically verify that a BCB-owned `resumable` cannot remain
 *   classified as BCB-owned after an explicit user cancellation and
 *   cause a late completion to bypass the cancellation straggler guard."
 *
 * THE DEFECT THIS WITNESS IS BOUNDED TO
 *
 *   The predecessor's `bcbHoldResumablePublished` flag is documented as:
 *
 *     "set ONLY by the BCB-hold write and cleared by EVERY other
 *      phase write, so it can never describe a `resumable` this
 *      coordinator did not publish."
 *
 *   THAT DOCUMENTATION IS FALSE IN PRODUCTION. The flag is a
 *   coordinator-private field. It is cleared ONLY at the coordinator's
 *   OWN `setTurnPhase` write sites. The production CANCEL path does
 *   NOT write through the coordinator:
 *
 *     `SdkController.cancelTask()` (apps/vscode/src/sdk/SdkController.ts:4293)
 *       -> this.turnStateTracker.setWithWriter(
 *            "resumable", undefined,
 *            this.writerIdentity("controller-cancel-task"))   // DIRECT tracker write
 *       -> await this.taskControl.cancelTask()
 *            -> raiseCancelFence()  // bumpEpoch() -> the epoch fence
 *            -> sdkHost.abort(sessionId)
 *            -> sessions.setRunning(false)
 *
 *   The cancel path therefore REWRITES the committed phase to
 *   `resumable` with a DIFFERENT writer identity
 *   (`controller-cancel-task`) and NEVER clears
 *   `bcbHoldResumablePublished`. The flag stays `true` and now
 *   describes a `resumable` this coordinator did NOT publish — it
 *   describes the CANCEL's `resumable`.
 *
 *   The turn-complete straggler guard keys on that flag:
 *
 *     sdk-session-event-coordinator.ts:3750
 *       if (!activeSession.isRunning &&
 *           this.options.getTurnPhase?.() === "resumable" &&
 *           !this.bcbHoldResumablePublished) {
 *         // preserve the CANCEL's resumable
 *       } else if (...) {
 *         // NORMAL COMPLETION PATH — NOT SUPPRESSED
 *       }
 *
 *   With the stale flag set, the guard is DISABLED and the late
 *   completion falls into the NORMAL completion path, which can
 *   commit `completed` and a C10 `task_completion_committed` — i.e.
 *   the late completion BYPASSES the cancellation straggler guard and
 *   FABRICATES a completion for a turn the user explicitly cancelled.
 *
 * WHAT THIS WITNESS DOES
 *
 *   It drives the REAL production seams:
 *     - the REAL `SdkSessionEventCoordinator` (the REAL phase writer
 *       and the REAL straggler guard),
 *     - the REAL `TurnStateTracker` (the REAL committed phase),
 *     - the REAL `MessageTranslatorState` / `MessageIdMinter` (the
 *       REAL epoch fence),
 *     - the REAL BCB hold path (the REAL `session-event-bcb-hold-resumable`
 *       writer),
 *     - the REAL cancellation writer / fence semantics (the EXACT
 *       sequence `SdkController.cancelTask` performs: the DIRECT
 *       tracker write with the `controller-cancel-task` writer identity,
 *       then the epoch bump, then the abort, then `setRunning(false)`).
 *
 * EVIDENCE LEVEL
 *
 *   REAL_PRODUCTION_SEAM for the coordinator, the tracker, the epoch
 *   fence and the task-control coordinator. The Elm COMPLETION-authority
 *   decision is INJECTED at the existing provider boundary (the same
 *   INJECTED_DECISION posture as the predecessor ACT).
 */

import type { CoreSessionEvent } from "@cline-internal/core/types/events"
import { describe, expect, it, vi } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkTaskControlCoordinator } from "../sdk-task-control-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

const ACTIVE_SESSION_ID = "session-b2po01-s4"
const ACTIVE_TASK_ID = "task-b2po01-s4"

/** The four held terminal observations named by the LIVE BCB specimen. */
const LIVE_HELD_JOB_IDS: readonly string[] = [
	"cmd_mvo9fosf9tyu4xb3",
	"cmd_mvo9fosftrej06ye",
	"cmd_mvo9fosfbixo2qfc",
	"cmd_mvo9hvbop47y3i42",
]

interface PhaseWrite {
	readonly phase: string
	readonly writerId: string | undefined
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

describe("B2PO01-S4 — the ACTUAL cancellation writer/fence semantics", () => {
	it("B2PO01-S4a: a BCB-owned `resumable` CANNOT remain classified as BCB-owned after an explicit user cancellation", async () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const translatorState = new MessageTranslatorState(minter)

		let running = false
		let completionCommitCount = 0
		const phaseWrites: PhaseWrite[] = []

		const setTurnPhase = ((phase: string, anchorTs: number | undefined, writerId: string | undefined) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			phaseWrites.push({ phase, writerId })
			tracker.setWithWriter(phase as never, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>

		const coordinator = new SdkSessionEventCoordinator({
			messageTranslatorState: translatorState,
			sessions: {
				getActiveSession: () => ({
					sessionId: ACTIVE_SESSION_ID,
					sdkHost: {},
					unsubscribe: vi.fn(),
					startResult: { sessionId: ACTIVE_SESSION_ID },
					isRunning: running,
				}),
				setRunning: (next: boolean) => {
					running = next
				},
			},
			messages: { appendAndEmit: vi.fn() },
			taskHistory: { updateTaskUsage: vi.fn() },
			getTask: () => ({ taskId: ACTIVE_TASK_ID }) as never,
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
			getTurnPhase: () => tracker.currentPhase,
			// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
			// / B2PO01: mirror the PRODUCTION wiring
			// (`SdkController` -> `getTurnPhaseWriterId: () =>
			// this.turnStateTracker.currentWriterId`).
			getTurnPhaseWriterId: () => tracker.currentWriterId,
			translateSessionEvent,
			// INJECTED_DECISION (the Elm completion authority).
			getElmCompletionAuthorityDecision: () => ({ kind: "authorize", reason: "b2po01-s4-injected" }),
			flushElmAuthorityForSession: async () => {},
			getPendingPromptCount: () => ({ available: true as const, count: 0 }),
			getActiveNotifyCount: () => 0,
			wasWakeDispatchFailed: () => false,
			isWakeAuthoritySettled: () => false,
			hasRunningBackgroundJobForOwner: () => false,
			getUnconsumedOwnedTerminalResultCount: () => LIVE_HELD_JOB_IDS.length,
			getUnconsumedOwnedTerminalJobIds: () => LIVE_HELD_JOB_IDS,
			getBackgroundCommandJobStates: () => ({}),
			getBackgroundCommandJobOwners: () => ({}),
			liveTools: () => ["run_commands", "command_status"],
		} as unknown as SdkSessionEventCoordinatorOptions)

		// -------------------------------------------------------------------
		// 1. THE BCB HOLD — the REAL production hold path.
		// -------------------------------------------------------------------
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		translatorState.setAttemptCompletionSeen()
		translatorState.setTerminalResponseCommittedThisTurn()
		await coordinator.handleSessionEvent(
			agentEvent(ACTIVE_SESSION_ID, {
				type: "done",
				reason: "aborted",
				text: "",
				iterations: 1,
			}),
		)

		// The REAL BCB hold published the truthful non-running `resumable`
		// through the REAL BCB-hold writer.
		expect(tracker.currentPhase).toBe("resumable")
		expect(phaseWrites.at(-1)?.writerId).toBe("session-event-bcb-hold-resumable")

		// -------------------------------------------------------------------
		// 2. THE EXPLICIT USER CANCELLATION — the REAL writer/fence semantics.
		// -------------------------------------------------------------------
		//
		// `SdkController.cancelTask()` performs, in order:
		//   (a) the DIRECT tracker write with the `controller-cancel-task`
		//       writer identity (NOT a coordinator write),
		//   (b) `taskControl.cancelTask()` which raises the cancel fence
		//       (bumpEpoch) BEFORE the abort, awaits the abort, and then
		//       sets the runtime not-running.
		//
		// The coordinator is NEVER consulted for (a), so the coordinator's
		// private BCB-ownership flag CANNOT be cleared by the cancel.
		const abortOrder: string[] = []
		const taskControl = new SdkTaskControlCoordinator({
			sessions: {
				getActiveSession: () => ({
					sessionId: ACTIVE_SESSION_ID,
					sdkHost: {
						abort: async () => {
							abortOrder.push("abort")
						},
					},
					unsubscribe: vi.fn(),
					startResult: { sessionId: ACTIVE_SESSION_ID },
					isRunning: running,
				}),
				setRunning: (next: boolean) => {
					running = next
				},
			},
			interactions: { clearPending: vi.fn() },
			taskOperationFence: { isCurrent: () => true, begin: () => 0 },
			messages: { appendAndEmit: vi.fn() },
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			raiseCancelFence: () => {
				abortOrder.push("fence")
				translatorState.clearApprovedToolMessageTs()
				minter.bumpEpoch()
			},
		} as never)

		// (a) the production phase write — DIRECT to the tracker.
		tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" as never })
		// (b) the production fence + abort + not-running sequence.
		await taskControl.cancelTask()

		// The production ordering is asserted: the fence is raised BEFORE
		// the abort is awaited.
		expect(abortOrder).toEqual(["fence", "abort"])
		expect(running).toBe(false)

		// The committed phase is the CANCEL's `resumable`, and the
		// COMMITTED WRITER is the cancel's writer — NOT the BCB-hold
		// writer. This is the fact the straggler guard now reads.
		expect(tracker.currentPhase).toBe("resumable")
		expect(tracker.currentWriterId).toBe("controller-cancel-task")
		expect(tracker.currentWriterId).not.toBe("session-event-bcb-hold-resumable")

		// -------------------------------------------------------------------
		// 3. THE LATE `done` STRAGGLER.
		// -------------------------------------------------------------------
		//
		// This is the straggler the cancellation straggler guard exists to
		// suppress. It carries a completion attempt (the aborted turn had
		// already declared one), so WITHOUT the guard it would fall into
		// the NORMAL completion path and commit `completed`.
		translatorState.setAttemptCompletionSeen()
		translatorState.setTerminalResponseCommittedThisTurn()
		const writesBeforeStraggler = phaseWrites.length

		await coordinator.handleSessionEvent(
			agentEvent(ACTIVE_SESSION_ID, {
				type: "done",
				reason: "aborted",
				text: "",
				iterations: 1,
			}),
		)

		// -------------------------------------------------------------------
		// 4. THE ASSERTIONS — the cancellation authority MUST be preserved.
		// -------------------------------------------------------------------
		const writesAfterStraggler = phaseWrites.slice(writesBeforeStraggler)

		// THE LOAD-BEARING ASSERTION — the cancellation straggler guard
		// MUST be ACTIVE.
		//
		// The guard (sdk-session-event-coordinator.ts:3750) suppresses the
		// turn-complete phase write entirely when the committed phase is
		// the CANCEL's `resumable` and the runtime is not running. A
		// BCB-owned `resumable` that remains classified as BCB-owned
		// after the cancel DISABLES the guard, and the late completion
		// falls into the NORMAL completion path — which re-publishes the
		// BCB hold (or commits `completed`).
		//
		// The straggler MUST write NO phase of its own.
		expect(writesAfterStraggler).toHaveLength(0)

		// The committed phase MUST still be the CANCEL's `resumable`.
		expect(tracker.currentPhase).toBe("resumable")

		// NO completion was fabricated.
		expect(completionCommitCount).toBe(0)
	})

	// -------------------------------------------------------------------------
	// S4b — the SEVERE consequence: the fabricated C10.
	// -------------------------------------------------------------------------
	it("B2PO01-S4b: after an explicit user cancellation, a late completion MUST NOT fabricate `completed` (no C10)", async () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const translatorState = new MessageTranslatorState(minter)

		let running = false
		let completionCommitCount = 0
		const phaseWrites: PhaseWrite[] = []
		// The held obligation DRAINS while the cancelled turn is still
		// settling. This is the shape in which the stale BCB flag is most
		// dangerous: the BCB hold no longer re-registers, so the late
		// completion falls all the way through to the IMMEDIATE C10
		// commit and FABRICATES a completion for a turn the user
		// explicitly cancelled.
		let heldTerminalCount = LIVE_HELD_JOB_IDS.length
		let heldTerminalJobIds: readonly string[] = LIVE_HELD_JOB_IDS

		const setTurnPhase = ((phase: string, anchorTs: number | undefined, writerId: string | undefined) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			phaseWrites.push({ phase, writerId })
			tracker.setWithWriter(phase as never, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>

		const coordinator = new SdkSessionEventCoordinator({
			messageTranslatorState: translatorState,
			sessions: {
				getActiveSession: () => ({
					sessionId: ACTIVE_SESSION_ID,
					sdkHost: {},
					unsubscribe: vi.fn(),
					startResult: { sessionId: ACTIVE_SESSION_ID },
					isRunning: running,
				}),
				setRunning: (next: boolean) => {
					running = next
				},
			},
			messages: { appendAndEmit: vi.fn() },
			taskHistory: { updateTaskUsage: vi.fn() },
			getTask: () => ({ taskId: ACTIVE_TASK_ID }) as never,
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
			getTurnPhase: () => tracker.currentPhase,
			getTurnPhaseWriterId: () => tracker.currentWriterId,
			translateSessionEvent,
			getElmCompletionAuthorityDecision: () => ({ kind: "authorize", reason: "b2po01-s4b-injected" }),
			flushElmAuthorityForSession: async () => {},
			getPendingPromptCount: () => ({ available: true as const, count: 0 }),
			getActiveNotifyCount: () => 0,
			wasWakeDispatchFailed: () => false,
			isWakeAuthoritySettled: () => false,
			hasRunningBackgroundJobForOwner: () => false,
			getUnconsumedOwnedTerminalResultCount: () => heldTerminalCount,
			getUnconsumedOwnedTerminalJobIds: () => heldTerminalJobIds,
			getBackgroundCommandJobStates: () => ({}),
			getBackgroundCommandJobOwners: () => ({}),
			liveTools: () => ["run_commands", "command_status"],
		} as unknown as SdkSessionEventCoordinatorOptions)

		// 1. THE BCB HOLD.
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		translatorState.setAttemptCompletionSeen()
		translatorState.setTerminalResponseCommittedThisTurn()
		await coordinator.handleSessionEvent(
			agentEvent(ACTIVE_SESSION_ID, { type: "done", reason: "aborted", text: "", iterations: 1 }),
		)
		expect(tracker.currentPhase).toBe("resumable")
		expect(tracker.currentWriterId).toBe("session-event-bcb-hold-resumable")

		// 2. THE EXPLICIT USER CANCELLATION (production writer + fence).
		const abortOrder: string[] = []
		const taskControl = new SdkTaskControlCoordinator({
			sessions: {
				getActiveSession: () => ({
					sessionId: ACTIVE_SESSION_ID,
					sdkHost: {
						abort: async () => {
							abortOrder.push("abort")
						},
					},
					unsubscribe: vi.fn(),
					startResult: { sessionId: ACTIVE_SESSION_ID },
					isRunning: running,
				}),
				setRunning: (next: boolean) => {
					running = next
				},
			},
			interactions: { clearPending: vi.fn() },
			taskOperationFence: { isCurrent: () => true, begin: () => 0 },
			messages: { appendAndEmit: vi.fn() },
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			raiseCancelFence: () => {
				abortOrder.push("fence")
				translatorState.clearApprovedToolMessageTs()
				minter.bumpEpoch()
			},
		} as never)
		tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" as never })
		await taskControl.cancelTask()
		expect(abortOrder).toEqual(["fence", "abort"])
		expect(running).toBe(false)
		expect(tracker.currentWriterId).toBe("controller-cancel-task")

		// 3. THE HELD OBLIGATION DRAINS (the observation landed while the
		//    cancelled turn was settling) — so the BCB hold does NOT
		//    re-register and the late completion reaches the IMMEDIATE
		//    C10 commit.
		heldTerminalCount = 0
		heldTerminalJobIds = []

		// 4. THE LATE `done` STRAGGLER.
		translatorState.setAttemptCompletionSeen()
		translatorState.setTerminalResponseCommittedThisTurn()
		const writesBeforeStraggler = phaseWrites.length

		await coordinator.handleSessionEvent(
			agentEvent(ACTIVE_SESSION_ID, { type: "done", reason: "aborted", text: "", iterations: 1 }),
		)

		// 5. THE ASSERTIONS.
		const writesAfterStraggler = phaseWrites.slice(writesBeforeStraggler)
		expect(writesAfterStraggler.filter((w) => w.phase === "completed")).toHaveLength(0)
		expect(writesAfterStraggler).toHaveLength(0)
		expect(tracker.currentPhase).toBe("resumable")
		expect(completionCommitCount).toBe(0)
	})
})

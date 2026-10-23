import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import { Logger } from "@/shared/services/Logger"
import {
	recordCancelLivenessAbortCompleted,
	recordCancelLivenessAbortInvoked,
	recordCancelLivenessAccepted,
	recordCancelLivenessPublished,
	recordCancelLivenessRequest,
} from "./cancel-liveness-diagnostic"
import type { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { isAbortError, type SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import { TaskOperationFence } from "./task-operation-fence"
import { createTaskProxy, type TaskProxy } from "./task-proxy"

export interface SdkTaskControlCoordinatorOptions {
	sessions: SdkSessionLifecycle
	interactions: SdkInteractionCoordinator
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	/**
	 * Shared task-operation generation authority. The coordinator
	 * advances the fence on `clearTask` and captures tokens on
	 * `clearTask` / `showTaskWithId` so the user's latest intent
	 * always wins. See `./task-operation-fence.ts` for the contract.
	 */
	taskOperationFence: TaskOperationFence
	getTask: () => TaskProxy | undefined
	setTask: (task: TaskProxy | undefined) => void
	onAskResponse: (text?: string, images?: string[], files?: string[]) => Promise<void>
	resetMessageTranslator: () => void
	postStateToWebview: () => Promise<void>
	/**
	 * Drops the StateManager's task-scoped settings overlay (persisting pending
	 * writes first). Task settings — e.g. autoApprovalSettings written by
	 * toggling auto-approve while a task is open — shadow global settings in
	 * getGlobalSettingsKey(). If the overlay outlives the task view, later
	 * global updates are accepted but never surface in posted state (the stale
	 * overlay version wins), which froze the auto-approve checkboxes after
	 * "New Task" (#13260). Must run whenever the task view is cleared or
	 * switched to another task.
	 */
	clearTaskSettings: () => Promise<void>
	/**
	 * Sets the authoritative turn phase. showTaskWithId must derive the phase
	 * from the reopened conversation (resumable/completed) — leaving the
	 * previous task's phase in place hides the Resume button for interrupted
	 * sessions opened from History (and can leak stale buttons in general).
	 */
	setTurnPhase: (phase: TurnPhase, anchorTs?: number, writerId?: TurnStateWriterId) => void
	/**
	 * ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01 (PTLL01-L2):
	 * Reads the CURRENT committed turn phase. Required by the Cancel
	 * recovery transition so it can tell a truthful `resumable` recovery
	 * apart from an ALREADY-committed terminal phase, which Cancel must
	 * never clobber (LCV-09).
	 *
	 * Optional for backward compatibility: when absent the recovery
	 * transition still runs, it just cannot distinguish the terminal case
	 * and therefore always publishes `resumable` (the pre-existing
	 * active-session behavior).
	 */
	getTurnPhase?: () => TurnPhase
	/**
	 * Raise the cancel fence SYNCHRONOUSLY before aborting the SDK session: bump the epoch so any
	 * straggler events the SDK emits after the abort request carry the old epoch (and are dropped
	 * by the webview), and mark the active turn cancelled so the session-event coordinator
	 * suppresses its remaining DISPLAY output (usage is still accounted).
	 */
	raiseCancelFence?: () => void
}

export class SdkTaskControlCoordinator {
	constructor(private readonly options: SdkTaskControlCoordinatorOptions) {}

	/**
	 * Capture a fence check function for an external operation that
	 * already holds a token (the result of `fence.begin()`).
	 */
	private isCurrent(token: number): boolean {
		return this.options.taskOperationFence.isCurrent(token)
	}

	async cancelClineTaskOnSignOut(isClineManagedProvider: boolean): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!isClineManagedProvider || !activeSession?.isRunning) {
			return
		}

		await this.cancelTask()
	}

	async cancelTask(): Promise<void> {
		// ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01: cancel_request
		// is the FIRST sub-boundary inside cancelTask. It fires before
		// the active-session guard AND before clearPending (so the
		// capture is the very first observable event on Cancel). The
		// H-A "no active session" signature is
		// `(req=1, acc=0, inv=0, cmp=0, pub=0)`. The session is
		// sampled eagerly (BEFORE clearPending) so the request
		// capture mirrors the production call site exactly.
		//
		// PRODUCTION INVARIANT: `interactions.clearPending` resolves
		// pending tool-approval / ask-question / mistake-limit
		// promises on the INTERACTION coordinator; it does NOT
		// mutate the SESSION lifecycle. The single read below
		// is therefore the canonical active-session check — no
		// re-read is required after clearPending. The diagnostic
		// is observation-only.
		const activeSession = this.options.sessions.getActiveSession()
		recordCancelLivenessRequest({
			hasActiveSession: !!activeSession,
			activeSessionId: activeSession?.sessionId ?? null,
		})

		this.options.interactions.clearPending("Task cancelled")

		// ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01 (PTLL01-L2):
		// NO-ACTIVE-SESSION RECOVERY. Previously this branch returned
		// immediately, which meant a Cancel against a task view whose SDK
		// session had already gone away performed NO lifecycle transition at
		// all: the cancel fence was never raised (straggler SDK events kept
		// the CURRENT epoch and were NOT dropped), no turn-phase write
		// occurred, and `postStateToWebview` was never invoked. The committed
		// webview state therefore still said `streaming`, so the TaskHeader
		// kept rendering Working + Cancel — and because the Cancel affordance
		// dispatches `TaskServiceClient.cancelTask` again, every further click
		// re-entered this same branch. The task could never leave the false
		// Working state: an indefinite, self-perpetuating no-op.
		//
		// The fix is to keep the transition, not to skip it. We deliberately
		// DO NOT skip to a "just hide the button" shortcut:
		//   - we do NOT force `completed` (that would be completion authority);
		//   - we do NOT invent a `resumable` phase when the canonical
		//     completion already committed a terminal phase (see the guard
		//     below — LCV-09);
		//   - we do NOT dispatch an extra user prompt to make the UI look
		//     idle (LCV-12).
		// `resumable` is the truthful recovery affordance here: the run was
		// abandoned before it produced a terminal response, so Resume is the
		// honest next action.
		if (!activeSession) {
			Logger.warn(
				"[SdkController] cancelTask: No active session — raising the cancel fence and publishing a resumable recovery phase instead of returning a no-op",
			)
			// Fence FIRST, exactly as in the active-session path: bump the
			// epoch so any straggler SDK event is dropped by the webview.
			this.options.raiseCancelFence?.()
			// LCV-09: never clobber an ALREADY-committed terminal phase. If
			// canonical completion already ran, `completed` stands and Cancel
			// only refreshes the published state. The terminal phase set is
			// the closed set of phase values that mean "this turn already
			// reached an authoritative outcome".
			const phaseBefore = this.options.getTurnPhase?.()
			const alreadyTerminal = phaseBefore === "completed" || phaseBefore === "error" || phaseBefore === "resumable"
			if (!alreadyTerminal) {
				this.options.setTurnPhase?.("resumable", undefined, "task-control-cancel-no-active-session")
			}
			await this.options.postStateToWebview()
			// Mirror the active-session diagnostic tail so the published
			// sub-boundary is observable for the no-session path too. The
			// existing H-A signature `(req=1, acc=0, inv=0, cmp=0, pub=0)`
			// now becomes `(req=1, acc=0, inv=0, cmp=0, pub=1)`.
			recordCancelLivenessPublished({ activeSessionId: "<no-active-session>" })
			Logger.log("[SdkController] Task cancelled (no active session): published resumable recovery phase")
			return
		}

		// ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01: cancel_accepted
		// fires AFTER the active-session guard passed and BEFORE the
		// fence raise. The discriminator uses this to separate H-A
		// (never reaches here) from H-B / H-C / Healthy.
		recordCancelLivenessAccepted({ activeSessionId: activeSession.sessionId })

		const { sdkHost, sessionId } = activeSession

		// FENCE FIRST: raise the cancel fence synchronously BEFORE awaiting the abort. Any event
		// the SDK emits after this point carries the old epoch (dropped by the webview) and is
		// marked cancelled (display suppressed by the session-event coordinator; usage still
		// accounted). Order matters — aborting first would leave a window where a straggler gets
		// the new epoch.
		this.options.raiseCancelFence?.()

		// ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01: abort_invoked
		// fires immediately BEFORE the await. The diagnostic records
		// `t0 = Date.now()` keyed by sessionId, so a matching
		// abort_completed records the wall-clock delta. If H-B
		// reproduces, abort_completed NEVER fires and the bucket
		// never receives a delta.
		recordCancelLivenessAbortInvoked({ activeSessionId: sessionId, now: Date.now() })

		let _abortOutcome: "resolved" | "caught" = "resolved"
		try {
			await sdkHost.abort(sessionId)
		} catch (error) {
			_abortOutcome = "caught"
			if (!isAbortError(error)) {
				Logger.error("[SdkController] Failed to abort session:", error)
			} else {
				Logger.debug(`[SdkController] AbortError during cancelTask (expected): ${sessionId}`)
			}
		}

		// ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01: abort_completed
		// fires AFTER the try/catch (so it captures BOTH "resolved"
		// AND "caught" — the H-B boundary is the await, not its
		// outcome). Records the wall-clock delta from the matching
		// abort_invoked capture.
		recordCancelLivenessAbortCompleted({
			activeSessionId: sessionId,
			now: Date.now(),
			outcome: _abortOutcome,
		})

		this.options.sessions.setRunning(false)

		const resumeMessage: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "resume_task",
			text: "",
			partial: false,
		}
		this.options.messages.appendAndEmit([resumeMessage], { type: "status", payload: { sessionId, status: "cancelled" } })

		await this.options.postStateToWebview()
		// ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01: cancel_published
		// fires AFTER the postStateToWebview await resolves, at the
		// end of cancelTask. H-C (defensive — fence raised, abort
		// settled, but post-state never published) is the only
		// signature with (req=1, acc=1, inv=1, cmp=1, pub=0).
		recordCancelLivenessPublished({ activeSessionId: sessionId })
		Logger.log(`[SdkController] Task cancelled: ${sessionId}`)
	}

	async clearTask(): Promise<void> {
		// Supersede any in-flight showTaskWithId / initTask so they cannot
		// re-install a task after the user cleared the view (e.g. clicked
		// New Task). The fence is the SAME authority that initTask and
		// showTaskWithId check, so a single shared instance is required.
		const token = this.options.taskOperationFence.begin()
		await this.clearTaskForOperation(token)
	}

	/**
	 * Internal `clearTask` that performs the same teardown under an
	 * EXISTING operation token, without advancing the fence. Used by
	 * `SdkTaskStartCoordinator.initTask`'s internal clear step so the
	 * initTask's own fence token is preserved (a naive
	 * `fence.begin()` here would self-supersede the initTask).
	 *
	 * External callers (the user clicking New Task / "clear view")
	 * always go through `clearTask` which advances the fence.
	 */
	async clearTaskForOperation(token: number): Promise<void> {
		// FENCE-FIRST: validate ownership BEFORE any destructive work.
		// A stale internal clear must NOT clear pending interactions
		// or terminate a newer operation's active session.
		if (!this.isCurrent(token)) {
			Logger.debug(
				`[SdkController] clearTaskForOperation: token=${token} already superseded; abandoning without destructive action`,
			)
			return
		}

		this.options.interactions.clearPending("Task cleared")

		await this.options.sessions.endActiveSession("clearTask")

		// FENCE again after the awaited endActiveSession — a
		// concurrent external clearTask or new initTask could have
		// advanced the fence during the await.
		if (!this.isCurrent(token)) {
			Logger.debug(
				`[SdkController] clearTaskForOperation: token=${token} superseded during endActiveSession; abandoning teardown`,
			)
			return
		}

		// The originating operation owns the resulting state under its
		// own token. After the clear, the operation continues.
		const task = this.options.getTask()
		if (task) {
			// SDK session persistence owns conversation history. Do not write classic
			// ui_messages.json here; history viewing reloads from SDK readMessages().
			this.options.messages.cancelPendingSave()
			task.messageStateHandler.clear()
			this.options.setTask(undefined)
		}

		await this.options.clearTaskSettings()

		this.options.resetMessageTranslator()
	}

	/**
	 * Opens a task from History. The view generation is allocated synchronously
	 * on entry — BEFORE any asynchronous work, including the history lookup —
	 * so the newest user selection always holds the newest generation and every
	 * older in-flight request self-abandons at its next fence check. (The
	 * lookup used to live in SdkController before the generation was taken; a
	 * stalled preflight could then re-enter with a NEWER generation than a
	 * later selection and replace it.)
	 *
	 * Returns the task's HistoryItem, or undefined when the task is unknown.
	 * A superseded call still returns the item (the lookup succeeded); it just
	 * skips mutating the task view.
	 */
	async showTaskWithId(taskId: string): Promise<HistoryItem | undefined> {
		const token = this.options.taskOperationFence.begin()
		const isSuperseded = (): boolean => {
			const result = !this.isCurrent(token)
			if (result) {
				Logger.debug(`[SdkController] showTaskWithId superseded by a newer selection; skipping: ${taskId}`)
			}
			return result
		}

		let historyItem: HistoryItem | undefined
		try {
			historyItem = await this.options.taskHistory.findHistoryItem(taskId)
		} catch (error) {
			Logger.error(`[SdkController] Failed to look up task in history: ${taskId}`, error)
			return undefined
		}
		if (!historyItem) {
			Logger.error(`[SdkController] Task not found in history: ${taskId}`)
			return undefined
		}

		// FENCE: before stopping the active session. A superseded request must
		// not stop a session that a newer selection just started or resumed.
		if (isSuperseded()) {
			return historyItem
		}

		try {
			// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION02-SHOWTASKWITHID-FULL-IDEMPOTENCE
			// (P1 bounded fix; replaces the half-measure
			//  CORRECTION01 which skipped endActiveSession + the
			//  task-view clear block but still fell through to
			//  createTaskProxy + setTask, replacing the TaskProxy
			//  underneath the preserved ActiveSession — an
			//  ownership mismatch).
			//
			// When the active session already represents the requested task
			// AND it is idle (no in-flight turn), this is a true no-op
			// user intent (re-clicking the currently active history
			// entry). Bail out BEFORE the end+reinstall cycle so:
			//   - activeSession reference is preserved verbatim
			//   - the deferred-completion-barrier (BCB01) marker is
			//     NOT silently cleared by the missing-session branch
			//   - the TaskProxy reference is preserved verbatim
			//     (no createTaskProxy + setTask replacement)
			//   - interactions.clearPending is NOT called (no
			//     outstanding approvals need rejection when there is
			//     no task switch)
			//   - the outgoing task's settings overlay is NOT cleared
			//     (no outgoing task)
			//   - messageStateHandler.clear is NOT called
			//   - resetMessageTranslator is NOT called
			//   - the postStateToWebview() final state push is NOT
			//     re-issued (no state changed)
			//
			// For RUNNING same-task sessions the original
			// endActiveSession + awaitStop + reinstall cycle still
			// fires (the comment below about persisted-session-status
			// still applies). For different-task switches the
			// original teardown also still fires.
			const activeSession = this.options.sessions.getActiveSession()
			const isSameTaskIdle = activeSession?.sessionId === taskId && activeSession?.isRunning === false
			if (isSameTaskIdle) {
				Logger.debug(`[SdkController] showTaskWithId same-task idle early-return: ${taskId}`)
				return historyItem
			}

			// Reject any outstanding approval before tearing down the old session. Approval
			// resolvers live on the shared interaction coordinator, so ending the session
			// alone does not discard them; if one leaks across this task switch, the first
			// message sent in the newly selected task is consumed as the old task's response.
			this.options.interactions.clearPending("Task switched")

			// When reopening the task that is currently active, wait for its stop to
			// land so the persisted session status read below reflects how the last
			// turn actually ended (completed vs cancelled) instead of a transient
			// non-terminal status.
			await this.options.sessions.endActiveSession("showTaskWithId", {
				awaitStop: activeSession?.sessionId === taskId,
			})

			// FENCE: everything below mutates the shared task view (clearing the
			// current task, installing the new proxy, setting the turn phase). If a
			// newer showTaskWithId/clearTask started while this call awaited I/O,
			// bail out so the stale request cannot clobber the newer selection.
			if (isSuperseded()) {
				return historyItem
			}

			// Tear down the task view state now that the active session is ended.
			// (The previous same-task-idle branch already returned, so this only
			// fires for different-task or RUNNING same-task.)
			const currentTask = this.options.getTask()
			if (currentTask) {
				currentTask.messageStateHandler.clear()
			}

			// The outgoing task's settings overlay must not apply to the newly
			// opened task (see clearTaskSettings option doc).
			await this.options.clearTaskSettings()

			this.options.resetMessageTranslator()

			// Load messages before installing the new task proxy so any concurrent
			// postStateToWebview() caller never sees the new id with empty messages.
			const isLegacyTask = await this.options.taskHistory.isLegacyTask(taskId)
			const sessionStatus = isLegacyTask ? undefined : await this.options.taskHistory.getSessionStatus(taskId)
			const rawMessages = await this.options.taskHistory.getClineMessages(taskId)
			if (isSuperseded()) {
				return historyItem
			}
			const messages = this.options.messages.finalizeMessagesForSave(rawMessages)
			const cleanedMessages = isLegacyTask
				? this.appendLegacyTaskWarningAndResumeMessage(messages)
				: messages.length > 0
					? this.appendFreshResumeMessage(messages, sessionStatus)
					: []

			const task = createTaskProxy(
				taskId,
				(text?: string, images?: string[], files?: string[]) => this.options.onAskResponse(text, images, files),
				() => this.cancelTask(),
			)
			if (cleanedMessages.length > 0) {
				task.messageStateHandler.addMessages(cleanedMessages)
			}
			this.options.setTask(task)

			// Derive the turn phase from the appended resume ask. The webview
			// renders footer buttons from the authoritative TurnState, so without
			// this the phase left over from the previous context (often "idle")
			// hides the Resume button for interrupted/failed sessions.
			const lastMessage = cleanedMessages.at(-1)
			if (lastMessage?.type === "ask" && lastMessage.ask === "resume_completed_task") {
				this.options.setTurnPhase("completed", lastMessage.ts, "task-control-resume-ask")
			} else if (lastMessage?.type === "ask" && lastMessage.ask === "resume_task") {
				this.options.setTurnPhase("resumable", lastMessage.ts, "task-control-resumable-ask")
			} else {
				this.options.setTurnPhase("idle", undefined, "task-control-idle-fallback")
			}

			if (cleanedMessages.length > 0) {
				Logger.log(`[SdkController] Loaded ${cleanedMessages.length} messages for task: ${taskId}`)
			} else {
				Logger.log(`[SdkController] No messages found for task: ${taskId}`)
			}

			// The final state update below includes the loaded clineMessages. Avoid pushing
			// each historical message through the partial-message stream one-by-one; for
			// long tasks that serial loop can dominate history-open latency.
			await this.options.postStateToWebview()
			Logger.log(`[SdkController] Showing task: ${taskId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to show task:", error)
		}
		return historyItem
	}

	private appendFreshResumeMessage(messages: ClineMessage[], sessionStatus?: string): ClineMessage[] {
		// The persisted session status is the only reliable completion signal:
		// SDK conversations do not record a completion tool call in the
		// transcript (a completed turn and a turn interrupted mid-stream both
		// end with plain assistant text), and history rendering appends a
		// synthetic trailing ask:"completion_result" either way, so the message
		// tail cannot be used. When the status is unknown (e.g. a transient
		// read failure), default to the Resume affordance: resuming a completed
		// task is harmless, while hiding Resume on an interrupted one is the
		// data-loss illusion this exists to prevent.
		const resumeAsk = sessionStatus === "completed" ? "resume_completed_task" : "resume_task"
		const cleanedMessages = messages.filter((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
		cleanedMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: resumeAsk,
			text: "",
		})
		return cleanedMessages
	}

	private appendLegacyTaskWarningAndResumeMessage(messages: ClineMessage[]): ClineMessage[] {
		const cleanedMessages = messages.filter((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
		const now = Date.now()
		cleanedMessages.push(
			{
				ts: now,
				type: "say",
				say: "text",
				text: "⚠️ This is a legacy task. It may not work as well because tool names may have changed.",
			},
			{
				ts: now + 1,
				type: "ask",
				ask: "resume_task",
				text: "",
			},
		)
		return cleanedMessages
	}
}

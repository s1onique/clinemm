import type { AgentEvent, CoreSessionEvent, PendingPromptCountRead } from "@cline/core"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import { refreshClineRecommendedModels } from "@/core/controller/models/refreshClineRecommendedModels"
import type { StateManager } from "@/core/storage/StateManager"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/cline/recommended-models"
import type { ClineApiReqInfo, TurnPhase } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { isClineManagedProvider } from "@/shared/utils/cline"
import { getDiagnosticHostId, getDiagnosticManagerId } from "./background-job-liveness-authority"
import { type BackgroundOwnerCorrelationActiveJob, captureBackgroundOwnerCorrelationRecord } from "./background-owner-correlation"
import type { MessageTranslatorState, TranslationResult } from "./message-translator"
import { translateSessionEvent } from "./message-translator"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE, type ProviderFailureTelemetry } from "./provider-failure-telemetry"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { TaskProxy } from "./task-proxy"

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase()
}

type AgentFailureTelemetry = Pick<ProviderFailureTelemetry, "sessionId" | "error" | "errorType"> | undefined

export interface SdkSessionEventCoordinatorOptions {
	messageTranslatorState: MessageTranslatorState
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	getTask: () => TaskProxy | undefined
	postStateToWebview: () => Promise<void>
	stateManager?: StateManager
	translateSessionEvent?: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult
	isClineFreeModel?: () => Promise<boolean>
	/**
	 * Set the authoritative UI turn phase. Called as the agent streams (streaming), on a
	 * completed turn (completed if attempt_completion was used, else awaiting_followup), and on
	 * error. Optional for tests.
	 */
	setTurnPhase?: (phase: TurnPhase, anchorTs?: number, writerId?: TurnStateWriterId) => void
	/** Current authoritative UI turn phase, from the controller's TurnStateTracker. */
	getTurnPhase?: () => TurnPhase
	captureProviderApiError?: (event: ProviderFailureTelemetry) => void
	beginProviderFailureTelemetryTurn?: () => void
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 / Q5 composition
	 * seam (resume Waiting Q5 RED/repair):
	 *
	 * Authority input: per-owner background-job liveness query
	 * consulted in the `done-without-completion` branch (the
	 * `else` at the bottom of the `if (result.sessionEnded ||
	 * result.turnComplete)` block) before the
	 * `setTurnPhase("awaiting_followup", ...)` call. When this
	 * returns `true` for the active session, the phase transition
	 * is suppressed (the post-terminal-02 symptom family: the
	 * runtime would otherwise promote a still-running job's owning
	 * turn to `awaiting_followup`, losing the "Proceed While
	 * Running" affordance and dropping the footer indicator).
	 *
	 * Wired by `SdkController` to a thin adapter that delegates to
	 * `VscodeSessionHost.hasRunningBackgroundJobForOwner(activeSession.sessionId)`
	 * (the host-only method following the `cancelBackgroundCommand`
	 * precedent). Optional so this coordinator remains testable
	 * without a `VscodeSessionHost` instance (per the ACAS01
	 * harness precedent).
	 *
	 * Default behavior when absent: the coordinator preserves the
	 * pre-Q5 behavior (unconditional `awaiting_followup` in the
	 * done-without-completion case), so existing tests that do not
	 * pass this option are unaffected.
	 */
	hasRunningBackgroundJobForOwner?: (ownerSessionId: string | undefined) => boolean
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01:
	 *
	 * INTERNAL read-only diagnostic accessor that returns the
	 * underlying identity tuple (jobId / state / ownerSessionId)
	 * for every job currently held in the active CommandJobManager
	 * map. Wired by `SdkController` to a thin adapter that
	 * delegates to
	 * `CommandJobManager.getActiveJobOwnershipSnapshot()` (the
	 * closed-runtime P1 accessor added by this ACT). The
	 * coordinator calls this from the Q5 decision boundary
	 * BEFORE evaluating `hasRunningBackgroundJobForOwner` so the
	 * captured BOCOR record mechanically proves OC1 / OC2 / OC3
	 * without relying on a guessed owner identity.
	 *
	 * Optional (same default semantic as
	 * `hasRunningBackgroundJobForOwner`): when absent, the BOCOR
	 * capture records `activeJobs: []` so tests that omit the
	 * option remain deterministic.
	 */
	getActiveJobOwnershipSnapshot?: () => readonly BackgroundOwnerCorrelationActiveJob[]
	/**
	 * ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01 /
	 * CORRECTION01:
	 *
	 * Synchronous accessor for the count of queued prompts in the
	 * canonical `ClineCore.pendingPrompts` service for the given
	 * sessionId. Wired by `SdkController` to a thin adapter that
	 * delegates to
	 * `activeSession.sdkHost.pendingPrompts("count", { sessionId })`,
	 * which reaches the transport-neutral `pendingPrompts.count`
	 * service operation on the underlying runtime host (Local /
	 * Hub / Remote).
	 *
	 * CORRECTION01: returns a {@link PendingPromptCountRead}
	 * discriminated union — NOT a bare number — so the Q5 consumer
	 * can distinguish "queue is known to be empty" from
	 * "queue mirror has not yet been initialized for this session".
	 * The Hub transport's mirror can lag the authoritative hub queue
	 * (an unmirrored session would otherwise be read as `count = 0`
	 * and authorize operator handoff despite authoritative work
	 * pending remotely — PROVISIONAL_FAIL_OPEN_RISK fixed by
	 * CORRECTION01). The Q5 guard chain treats
	 * `{ available: false }` as "authority unavailable — do NOT
	 * authorize operator handoff" rather than "queue is empty".
	 *
	 * AUTHORITATIVE: the count is read synchronously at the call
	 * site, NOT from any cached projection. A wake enqueued at time
	 * T is observable at time T (same JavaScript turn), regardless
	 * of whether `getStateToPostToWebview` has run. The previous
	 * LHOWA01 implementation that pointed at
	 * `host.pendingPromptsCount?.()` has been removed: the upstream
	 * architecture rule (ARCHITECTURE.md lines 454-460) explicitly
	 * states that pending-prompt query/mutation semantics belong
	 * OUTSIDE the minimal `RuntimeHost` primitive vocabulary.
	 *
	 * The Q5 guard chain consults this in Branch 4 to defer
	 * `awaiting_followup` when an autonomous wake has already
	 * been enqueued into PendingPromptsController but the
	 * BackgroundNotifyCoordinator marker has been consumed
	 * (Shape D in `03-turn-authority-map.md`).
	 *
	 * Optional: when absent, the Q5 logic falls back to
	 * `{ available: false }` semantics (treat as authority
	 * unavailable; fail-closed defer), preserving the
	 * PROVISIONAL_FAIL_OPEN_RISK fix.
	 */
	getPendingPromptCount?: (sessionId: string | undefined) => PendingPromptCountRead
	/**
	 * ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01:
	 *
	 * Synchronous accessor for the count of ACTIVE
	 * BackgroundNotifyCoordinator markers owned by
	 * (sessionId, taskId). Wired by `SdkController` to a thin
	 * adapter that delegates to
	 * `BackgroundNotifyCoordinator.activeNotifyCountForOwner`.
	 * The Q5 guard chain consults this in Branch 4 to defer
	 * `awaiting_followup` when a held-result marker is still
	 * present (Shape E).
	 *
	 * Optional: when absent, the count defaults to 0 (Shape F).
	 */
	getActiveNotifyCount?: (sessionId: string | undefined, taskId: string | undefined) => number
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01:
	 *
	 * Returns the active session's `SdkSessionHost` instance so the
	 * coordinator can derive diagnostic `managerInstance` /
	 * `hostInstance` correlation tokens for the Q5 BOCOR
	 * enrichment. Optional: when absent, the Q5 BOCOR record
	 * carries `managerInstance=null` and `hostInstance=null` so
	 * downstream consumers (and tests) remain deterministic.
	 */
	getActiveSessionHost?: () => { readonly sdkHost?: object | undefined } | undefined
}

/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
 *
 * Bounded marker recorded at Q5 deferral time. Holds the
 * identity triple (sessionId + taskId + epoch) so a late
 * terminal event cannot mutate a newer turn (BTCONT-CTL-03 epoch
 * supersession). The marker is cleared on commit or on any newer
 * turn that supersedes the deferral. The marker is NOT a
 * general-purpose continuation queue - it holds at most ONE
 * pending continuation per coordinator instance.
 */
interface DeferredContinuation {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly epoch: number
	readonly deferredAt: number
}

export class SdkSessionEventCoordinator {
	private readonly translateSessionEvent: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
	 * bounded continuation marker (at most one entry per coordinator
	 * instance). Cleared on commit or on epoch supersession.
	 */
	private deferredContinuation: DeferredContinuation | undefined

	constructor(private readonly options: SdkSessionEventCoordinatorOptions) {
		this.translateSessionEvent = options.translateSessionEvent ?? translateSessionEvent
	}

	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
	 * external entry point invoked by `SdkController` when the
	 * active session's background-command projection flips from
	 * running=true to running=false (the >0->0 cardinal transition).
	 *
	 * Re-evaluates the deferred continuation under the four
	 * conservation rules (BTCONT-CTL-02/03/04/05):
	 *   1. the deferred marker MUST exist for the active session;
	 *      otherwise this is a no-op (other-session terminality
	 *      never affects this session)
	 *   2. the deferred marker's epoch MUST still match the active
	 *      minter epoch; otherwise the deferral has been superseded
	 *      by a newer turn and the late terminal event is discarded
	 *   3. the live `hasRunningBackgroundJobForOwner(activeSession.sessionId)`
	 *      lookup MUST return false; otherwise another matching job
	 *      is still alive and the continuation stays deferred
	 *   4. on success, the canonical writer
	 *      `session-event-turn-complete-resumable-straggler-preserve`
	 *      commits `awaiting_followup` exactly once and the
	 *      marker is cleared
	 */
	reevaluateDeferredContinuation(): void {
		const marker = this.deferredContinuation
		if (!marker) return
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			this.deferredContinuation = undefined
			return
		}
		if (marker.sessionId !== activeSession.sessionId) {
			// different-session terminality (BTCONT-CTL-05: two
			// coordinators), OR same-coordinator session replacement
			// (BTCONT-CTL-06: active session swapped to a different
			// session before the late terminal arrived). In both
			// cases the marker is stale; clear it and return.
			this.deferredContinuation = undefined
			return
		}
		const taskId = this.options.getTask?.()?.taskId
		if (marker.taskId !== taskId) {
			// task identity changed (e.g. task was cleared and a new
			// task started before the late terminal arrived, or the
			// task ended and taskId became undefined). The deferred
			// marker is bound to the taskId at deferral time; any
			// taskId mismatch means the deferral has been superseded.
			this.deferredContinuation = undefined
			return
		}
		const currentEpoch = this.options.messageTranslatorState.getMinter().epoch
		if (marker.epoch !== currentEpoch) {
			// newer epoch supersedes the old deferral
			this.deferredContinuation = undefined
			return
		}
		// The third conservation: another matching job may STILL be
		// running (BTCONT-CTL-04 multi-job case). The terminal event
		// for job J1 just settled; if J2 is still alive, the lookup
		// returns true and we stay deferred. The deferred marker is
		// PRESERVED across this re-evaluation so J2's terminal event
		// can re-drive the same continuation.
		const ownerStillRunning = this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
		if (ownerStillRunning) return

		// All four conservation checks pass: commit the canonical
		// awaiting_followup transition exactly once.
		Logger.warn(
			`[SdkController] background job terminal idle re-evaluating deferred Q5 completion for session ${activeSession.sessionId} (epoch=${marker.epoch})`,
		)
		this.deferredContinuation = undefined
		this.options.setTurnPhase?.("awaiting_followup", undefined, "session-event-turn-complete-resumable-straggler-preserve")
	}

	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
	 * test-only backdoor exposing the deferred-continuation marker
	 * so the BTCONT-CTL-03 / BTCONT-CTL-04 / BTCONT-CTL-05 suites can
	 * verify the marker's identity triple (sessionId, taskId, epoch)
	 * without depending on indirect observable side-effects. Returns
	 * a copy of the marker; mutating the return value does NOT
	 * affect the coordinator's internal state. Returns `undefined`
	 * when no deferral is pending.
	 */
	getDeferredContinuationForTesting():
		| { readonly sessionId: string; readonly taskId: string | undefined; readonly epoch: number }
		| undefined {
		if (!this.deferredContinuation) return undefined
		return {
			sessionId: this.deferredContinuation.sessionId,
			taskId: this.deferredContinuation.taskId,
			epoch: this.deferredContinuation.epoch,
		}
	}

	async handleSessionEvent(event: CoreSessionEvent): Promise<void> {
		this.logQueueEvents(event)

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession || event.payload.sessionId !== activeSession.sessionId) {
			Logger.debug(
				`[SdkController] Ignoring stale SDK event for session ${event.payload.sessionId}; active=${activeSession?.sessionId ?? "none"}`,
			)
			return
		}

		if (event.type === "pending_prompts") {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post pending-prompt state update:", err)
			})
		}

		const result = this.translateSessionEvent(event, this.options.messageTranslatorState)
		const agentFailure = this.getAgentFailureTelemetry(event)
		if (agentFailure && !this.options.messageTranslatorState.isSuppressedToolApprovalDenial(agentFailure.error)) {
			this.options.captureProviderApiError?.({
				sessionId: agentFailure.sessionId,
				error: agentFailure.error,
				errorType: agentFailure.errorType,
				failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
			})
		}
		if (event.type === "pending_prompt_submitted") {
			this.options.beginProviderFailureTelemetryTurn?.()
			this.options.messageTranslatorState.clearTurnOutcome()
			this.options.sessions.setRunning(true)
			this.options.setTurnPhase?.(PROVIDER_FAILURE_PHASE.STREAMING, undefined, "session-event-pending-prompt-submitted")
		}
		const zeroCostPromise = this.zeroCostForFreeClineModel(result)
		if (zeroCostPromise) {
			await zeroCostPromise
		}

		if (!activeSession.isRunning && result.messages.length > 0) {
			result.messages = result.messages.filter(
				(m) => !(m.type === "ask" && (m.ask === "completion_result" || m.ask === "resume_completed_task")),
			)
		}

		if (result.messages.length > 0) {
			this.options.messages.appendAndEmit(result.messages, event)
		}

		if (activeSession) {
			if (result.sessionEnded || result.turnComplete) {
				// Authoritative UI phase at turn end. If the completion tool was used this turn
				// the phase is "completed" (green box + Start New Task); otherwise the agent
				// simply stopped and is waiting for the user ("awaiting_followup"). Error turns
				// are surfaced as the error phase. The webview reads this, not the array tail.
				//
				// EXCEPTION: a turn-complete from a turn that was cancelled (cancelTask set phase
				// "resumable" and aborted) is a straggler. Overwriting it here would clobber
				// "resumable" with "awaiting_followup"/"completed" and the footer would lose the
				// Resume Task button (showing the scroll-arrow default instead), so the cancel-set
				// phase is preserved. Check the phase itself, not just isRunning: when the SDK
				// drains a queued prompt at turn end, the PREVIOUS turn's send promise settles
				// after the new turn already started and its completion bookkeeping flips
				// isRunning back to false mid-turn (see fireAndForgetSend). Keying on isRunning
				// alone made the queued turn's real completion look like this straggler, leaving
				// the phase stuck on "streaming" (endless Thinking).
				if (!activeSession.isRunning && this.options.getTurnPhase?.() === "resumable") {
					Logger.debug("[SdkController] turn-complete straggler after cancel; preserving resumable phase")
				} else if (this.options.messageTranslatorState.wasErrorSeen()) {
					// The turn surfaced a provider error (ask:"api_req_failed" was emitted) —
					// offer error recovery (Retry / Start New Task), not the followup state.
					this.options.setTurnPhase?.("error", undefined, "session-event-turn-complete-error")
				} else if (this.options.messageTranslatorState.wasAttemptCompletionSeen()) {
					// ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01: a completion tool
					// was declared but we still need to confirm a terminal response was
					// actually committed. Without this gate, a `done` arriving after a
					// `content_start` for attempt_completion but BEFORE its `content_end`
					// (CRA03) would promote the turn to "completed" with only a partial
					// completion_result as the user-visible terminal content. The
					// translator sets terminalResponseCommittedThisTurn at the completion
					// tool's content_end; if it didn't, refuse the promotion.
					if (this.options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()) {
						this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")
					} else {
						// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01-CORRECTION01:
						// symmetric to the CPL01 "done-without-completion" liveness
						// case. The completion tool's `content_start` was observed
						// (so `attemptCompletionSeen === true`) but its `content_end`
						// never arrived (or arrived without a recognized terminal
						// result), and the agent-run termination fired
						// `finishRun("completed")` — either via the
						// session-termination fallback at
						// `sdk/packages/agents/src/agent-runtime.ts:1313-1336` after
						// the completion-reminder loop exhausted, or via an external
						// termination that arrived between `content_start` and
						// `content_end` (race / canceled / malformed stream). The
						// runtime has no runnable successor: no completion-tool
						// content_end to deliver, no retry scheduled, no completion
						// continuation loop, no pending prompt. The only truthful
						// projection is the same user-owned incomplete yield as CPL01:
						// `awaiting_followup`. The completion CONTENT authority
						// contract is UNCHANGED — no `completion_result` row is
						// synthesized (the partial `completion_result` row that
						// `content_start` emitted remains partial, with `partial:
						// true`).
						//
						// Distinction from the original CRA03 straggler guard: the
						// CRA03 reasoning (left runtime-owned "streaming") was about
						// the IN-PROGRESS case, before `done` — the model could still
						// iterate to deliver a proper `content_end`. Once `done` has
						// fired, the run is over: there is no in-progress work to
						// keep runtime-owned.
						Logger.warn(
							"[SdkController] attempt_completion declared but no terminal response committed; yielding turn as awaiting_followup (liveness)",
						)
						this.options.setTurnPhase?.(
							"awaiting_followup",
							undefined,
							"session-event-turn-complete-awaiting-followup-liveness",
						)
					}
				} else {
					// ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01: the
					// completion CONTENT authority contract — a `completion_result`
					// (or `plan_completion_result`) row may ONLY be synthesized from
					// a committed terminal response. Without that authority the
					// user-visible terminal content is whatever intermediate
					// debugging row was last — the LIVE screenshot witness. The
					// translator does NOT fall back to the last assistant
					// text/reasoning or stranded partial: the `done` handler at
					// `apps/vscode/src/sdk/message-translator.ts:1921-1930`
					// explicitly does not synthesize a `completion_result` from
					// prior text. The CRA02-empty case (no assistant content
					// committed this turn) leaves the flag false and refuses the
					// promotion.
					//
					// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01: the PHASE
					// transition is independent of the CONTENT authority. The
					// TaskHeader state label is a pure projection from
					// `turnState.phase` (`apps/vscode/webview-ui/src/components/
					// chat/task-header/TaskHeaderTelemetry.tsx` + the
					// `taskHeaderStateLabel` helper), so leaving
					// `phase = "streaming"` for the done-without-completion case
					// stuck the visible header on "Working" forever with no
					// model/tool/approval in flight. The EXISTING phase-enum
					// contract for this case is `awaiting_followup` (see
					// `apps/vscode/src/shared/ExtensionMessage.ts:355`,
					// "done-without-completion"). `turnAllowsFollowup()` returns
					// true for `awaiting_followup`, so the composer stays enabled
					// and CRA13 user follow-up auto-drain continues to work. The
					// completion authority contract is UNCHANGED: no
					// `completion_result` row is synthesized here.
					if (this.options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()) {
						this.options.setTurnPhase?.(
							"awaiting_followup",
							undefined,
							"session-event-turn-complete-awaiting-followup",
						)
					} else {
						// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01: explicit
						// user-owned incomplete yield for the done-without-
						// completion case. The phase is no longer runtime-owned
						// (no work is in flight) but no terminal content was
						// committed — `awaiting_followup` truthfully projects
						// "the agent stopped without an explicit completion
						// declaration; the user can respond."
						// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 / Q5
						// composition seam (resume Waiting Q5 RED/repair):
						// the post-terminal-02 specimen
						// (`cmd_mtj6kki83r1bmrfz`,
						// `taskId=1788297479245_hv9w5`, `epoch=4`,
						// `host_status=aborted`,
						// `turnState.phase=awaiting_followup`) captured the
						// symptom family where the runtime promoted the active
						// session's phase to `awaiting_followup` while a
						// background command it owned was still alive. The
						// `hasRunningBackgroundJobForOwner(activeSession.sessionId)`
						// query (delegated by `SdkController` to
						// `VscodeSessionHost.hasRunningBackgroundJobForOwner`)
						// gates this transition: when the active session still
						// owns a RUNNING `CommandJob`, the transition is
						// suppressed (the phase stays at whatever the prior
						// phase was - typically `streaming`). The suppression
						// is the smallest correct repair at the composition
						// seam: it preserves the "Proceed While Running"
						// affordance without inventing a replacement phase.
						// Per the Factory reviewer's directive, "do NOT yet
						// freeze the specific phase A *must* become" - this
						// branch only asserts `phase !== awaiting_followup`;
						// the actual state-machine semantics are the umbrella
						// Q5 next cycle's concern.
						//
						// When `hasRunningBackgroundJobForOwner` is not wired
						// (e.g. tests that omit the option), behavior is
						// unchanged: unconditional `awaiting_followup`.
						const ownerStillRunning = this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
						// ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 /
						// CORRECTION01:
						// Read the two NEW canonical projections of
						// autonomous-work state at the Q5 decision boundary.
						// Together with `ownerStillRunning`, they form the
						// complete `outstandingAutonomousWork` predicate that
						// determines whether `awaiting_followup` is the truthful
						// phase (Shape F — genuine operator handoff) or a
						// false-positive that should defer (Shapes A / B / D / E).
						//
						// CORRECTION01: pendingPromptCountRead is now an
						// availability-aware union. `{ available: false }`
						// means authority for this read is unavailable
						// (Hub session has never been initialized on this
						// host). That is NOT the same as "queue is empty"
						// — it must produce a deferred outcome, not a
						// committed `awaiting_followup`. `available: true &&
						// count > 0` keeps the existing defer behavior;
						// `available: true && count === 0` is the only
						// state in which `awaiting_followup` may be
						// committed. Defaulting an unwired option to
						// `{ available: false }` keeps the Q5 logic
						// fail-closed against an unwired adapter.
						const pendingPromptCountRead: PendingPromptCountRead = this.options.getPendingPromptCount?.(
							activeSession.sessionId,
						) ?? {
							available: false,
						}
						// For BOCOR diagnostic capture we record a
						// tri-valued projection: `true` / `false` /
						// `"unavailable"`. The boolean
						// `pendingPromptsKnown > 0` collapses the
						// availability union into the existing
						// outstandingAutonomousWork semantics for downstream
						// consumers (BOCOR schema is additive).
						const pendingPromptsKnown = pendingPromptCountRead.available === true ? pendingPromptCountRead.count : 0
						const activeNotifyCount =
							this.options.getActiveNotifyCount?.(activeSession.sessionId, this.options.getTask?.()?.taskId) ?? 0
						// CORRECTION01: when `pendingPromptCountRead.available
						// === false`, authority is unavailable — this MUST
						// not be read as "queue is empty". We treat
						// authority-unavailable as "outstanding work
						// cannot be ruled out" → defer (the same code
						// path as `pendingPromptsKnown > 0`). Only the
						// `available: true && count === 0` case permits
						// commit of `awaiting_followup`.
						const pendingPromptAuthorityUnknown = pendingPromptCountRead.available === false
						const outstandingAutonomousWork =
							ownerStillRunning || pendingPromptAuthorityUnknown || pendingPromptsKnown > 0 || activeNotifyCount > 0
						// ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01:
						// capture ONE decision-boundary observation right
						// BEFORE the if/else resolves. The capture is gated
						// ONLY by the BOCOR module seam (default OFF in public,
						// ON in dogfood via the central profile resolver).
						// Zero semantic delta when the seam is OFF —
						// `captureBackgroundOwnerCorrelationRecord` returns
						// immediately and the if/else evaluates exactly as
						// before.
						//
						// The record captures the LIVE tuple:
						//   queriedOwnerSessionId = activeSession.sessionId
						//   activeJobs           = closed-runtime snapshot of
						//                            every job in the active map
						//   guardAvailable        = whether the production
						//                            SdkController wired the option
						//   guardResult          = the exact boolean the guard
						//                            returned
						//   candidateWriterId    = always
						//     session-event-turn-complete-resumable-straggler-preserve
						//
						// Mechanical classification (see ACT sec 27):
						//   OC1 producer owner stamp defect
						//     activeJobs[N].ownerSessionId is null/undefined
						//     AND guardResult === false
						//   OC2 active session identity drift
						//     activeJobs[N].ownerSessionId !== activeSession.sessionId
						//     AND guardResult === false
						//   OC3 guard unavailable
						//     guardAvailable === false (option not wired)
						//   Contradiction
						//     owner matches AND guard === true AND result === false
						captureBackgroundOwnerCorrelationRecord({
							event: "background_owner_correlation_decision",
							capturedAt: Date.now(),
							taskId: this.options.getTask?.()?.taskId ?? null,
							sessionEventSessionId: typeof event.payload?.sessionId === "string" ? event.payload.sessionId : null,
							activeSessionId: activeSession.sessionId,
							currentPhase: "streaming",
							candidatePhase: "awaiting_followup",
							guardAvailable: typeof this.options.hasRunningBackgroundJobForOwner === "function",
							queriedOwnerSessionId: activeSession.sessionId,
							guardResult: typeof ownerStillRunning === "boolean" ? ownerStillRunning : null,
							activeJobs: this.options.getActiveJobOwnershipSnapshot?.() ?? [],
							candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve",
							// ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01:
							// BJLA diagnostic enrichment — add managerInstance /
							// hostInstance correlation tokens to the Q5 BOCOR
							// record. Both default to null when the BJLA
							// capture seam is OFF; the existing BOCOR schema
							// remains valid for all downstream consumers that
							// ignore the new fields.
							managerInstance: this.resolveActiveManagerInstance(),
							hostInstance: this.resolveActiveHostInstance(),
							// ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 /
							// CORRECTION01:
							// Enrich the BOCOR record with the two NEW canonical
							// autonomous-work projections. Existing consumers that
							// do not read these fields are unaffected (the schema
							// is additive). CORRECTION01 captures BOTH the
							// availability-aware `pendingPromptCountRead`
							// (the raw discriminated union) AND the legacy
							// `pendingPromptCount` (the known-count scalar;
							// 0 when authority is unavailable, for additive
							// backward compatibility).
							pendingPromptCount: pendingPromptsKnown,
							pendingPromptCountRead,
							pendingPromptAuthorityUnknown,
							activeNotifyCount,
							outstandingAutonomousWork,
						})
						if (outstandingAutonomousWork) {
							Logger.warn(
								`[SdkController] done with no committed terminal response but active session ${activeSession.sessionId} has outstanding autonomous work (running=${ownerStillRunning}, pendingPrompts=${pendingPromptsKnown}${pendingPromptAuthorityUnknown ? "/authority-unavailable" : ""}, activeNotify=${activeNotifyCount}); suppressing awaiting_followup transition (LHOWA01 boundary)`,
							)
							// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
							// record the bounded deferred-continuation marker
							// so the terminal-idle consumer can re-evaluate
							// the suppression exactly once. The marker
							// carries {sessionId, taskId, epoch} so a late
							// terminal event for an older deferral cannot
							// mutate a newer turn (BTCONT-CTL-03 epoch
							// supersession). Any existing marker is OVERWRITTEN
							// - there is at most ONE pending continuation per
							// coordinator instance, matching the
							// session-event-turn-complete-resumable-straggler-preserve
							// writer's exactly-one-commit-per-turn contract.
							this.deferredContinuation = {
								sessionId: activeSession.sessionId,
								taskId: this.options.getTask?.()?.taskId,
								epoch: this.options.messageTranslatorState.getMinter().epoch,
								deferredAt: Date.now(),
							}
						} else {
							Logger.warn(
								"[SdkController] done with no committed terminal response; yielding turn as awaiting_followup (liveness)",
							)
							this.options.setTurnPhase?.(
								"awaiting_followup",
								undefined,
								"session-event-turn-complete-resumable-straggler-preserve",
							)
						}
					}
				}

				this.options.sessions.setRunning(false)
			}

			if (result.usage && activeSession.startResult) {
				Promise.resolve(
					this.options.taskHistory.updateTaskUsage(
						this.options.getTask()?.taskId ?? this.options.sessions.getActiveSession()?.sessionId,
						result.usage,
					),
				).catch((error) => {
					Logger.error("[SdkController] Failed to persist task usage:", error)
				})
			}
		}

		// Post state when there are messages to ship OR when the turn ended. A clean turn end's
		// `done` event carries no transcript message, yet the authoritative phase just changed to
		// completed/awaiting_followup/error above; without posting here the webview would stay on
		// the prior phase (footer stuck on the streaming/scroll state). The webview reducer gates
		// turnState by seq, so an extra no-message post is safe.
		if (
			result.messages.length > 0 ||
			result.sessionEnded ||
			result.turnComplete ||
			event.type === "pending_prompt_submitted"
		) {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post state after event:", err)
			})
		}
	}

	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01:
	 *
	 * BJLA diagnostic helpers. Resolve the manager-instance /
	 * host-instance correlation tokens for the Q5 boundary so the
	 * BOCOR record can carry them. The helpers consult the
	 * `getActiveSessionHost` option; when absent (test paths that
	 * omit the option), they return `null` and the BOCOR record
	 * carries `managerInstance=null` / `hostInstance=null` —
	 * preserving the pre-ACT schema.
	 *
	 * The `getCommandJobManager()` accessor is host-only; the
	 * coordinator reaches it via a duck-typed cast on the active
	 * session host (the same pattern the
	 * `hasRunningBackgroundJobForOwner` and
	 * `getActiveJobOwnershipSnapshot` options use).
	 */
	private resolveActiveHostInstance(): string | null {
		const hostOption = this.options.getActiveSessionHost?.()
		const sdkHost = hostOption?.sdkHost
		return getDiagnosticHostId(sdkHost)
	}

	private resolveActiveManagerInstance(): string | null {
		const hostOption = this.options.getActiveSessionHost?.()
		const sdkHost = hostOption?.sdkHost
		if (!sdkHost) return null
		const managerAccessor = (
			sdkHost as {
				getCommandJobManager?: () => object
			}
		).getCommandJobManager
		if (typeof managerAccessor !== "function") return null
		const manager = managerAccessor.call(sdkHost)
		return getDiagnosticManagerId(manager)
	}

	private getAgentFailureTelemetry(event: CoreSessionEvent): AgentFailureTelemetry {
		if (event.type !== "agent_event") {
			return undefined
		}

		const agentEvent: AgentEvent = event.payload.event
		if (agentEvent.type === "error") {
			if (agentEvent.error == null) {
				return undefined
			}
			// Only terminal failures are provider failures. `recoverable: true`
			// error events are in-run notices — the MistakeTracker emits one for
			// EVERY recorded mistake (with the tool/mistake details as the
			// message, e.g. "2 tool call(s) failed: [shell] ...") and hook
			// failures surface the same way. Counting those here misclassified
			// tool noise as provider API errors and inflated the SDK bundle's
			// error rate ~9x vs legacy in the A/B rollout dashboards. Genuine
			// run failures (run-failed) always carry `recoverable: false`.
			if (agentEvent.recoverable !== false) {
				return undefined
			}
			return {
				sessionId: event.payload.sessionId,
				error: agentEvent.error,
				errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_ERROR,
			}
		}
		if (agentEvent.type === "done" && agentEvent.reason === "error") {
			const errorMessage = agentEvent.text.trim() || "SDK agent finished with error"
			return {
				sessionId: event.payload.sessionId,
				error: errorMessage,
				errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_DONE_ERROR,
			}
		}
		return undefined
	}

	private zeroCostForFreeClineModel(result: TranslationResult): Promise<void> | undefined {
		const hasUsageCost = typeof result.usage?.totalCost === "number" && result.usage.totalCost !== 0
		const hasMessageCost = result.messages.some((message) => {
			if (message.type !== "say" || message.say !== "api_req_started" || !message.text) {
				return false
			}
			try {
				const info = JSON.parse(message.text) as ClineApiReqInfo
				return typeof info.cost === "number" && info.cost !== 0
			} catch {
				return false
			}
		})

		if (!hasUsageCost && !hasMessageCost) {
			return undefined
		}

		return (async () => {
			if (!(await this.isCurrentClineModelFree())) {
				return
			}

			if (result.usage) {
				result.usage = { ...result.usage, totalCost: 0 }
			}

			result.messages = result.messages.map((message) => {
				if (message.type !== "say" || message.say !== "api_req_started" || !message.text) {
					return message
				}
				try {
					const info = JSON.parse(message.text) as ClineApiReqInfo
					if (typeof info.cost !== "number") {
						return message
					}
					return {
						...message,
						text: JSON.stringify({ ...info, cost: 0 } satisfies ClineApiReqInfo),
					}
				} catch {
					return message
				}
			})
		})()
	}

	private async isCurrentClineModelFree(): Promise<boolean> {
		if (this.options.isClineFreeModel) {
			return this.options.isClineFreeModel()
		}

		const stateManager = this.options.stateManager
		if (!stateManager) {
			return false
		}

		try {
			const apiConfig = stateManager.getApiConfiguration()
			const mode = stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
			const provider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
			// Free models are also selectable on ClinePass — they ride usage billing at $0
			if (!isClineManagedProvider(provider)) {
				return false
			}

			const modelId = this.getCurrentClineModelId()
			if (!modelId) {
				return false
			}

			const normalizedModelId = normalizeModelId(modelId)
			const models = await refreshClineRecommendedModels()
			const freeIds = models.free.map((model) => normalizeModelId(model.id)).filter(Boolean)
			const resolvedFreeIds =
				freeIds.length > 0 ? freeIds : CLINE_RECOMMENDED_MODELS_FALLBACK.free.map((model) => normalizeModelId(model.id))
			return resolvedFreeIds.includes(normalizedModelId)
		} catch (error) {
			Logger.error("[SdkController] Failed to check Cline free model list:", error)
			const modelId = this.getCurrentClineModelId()
			if (!modelId) {
				return false
			}
			const fallbackFreeIds = CLINE_RECOMMENDED_MODELS_FALLBACK.free.map((model) => normalizeModelId(model.id))
			return fallbackFreeIds.includes(normalizeModelId(modelId))
		}
	}

	private getCurrentClineModelId(): string | undefined {
		const stateManager = this.options.stateManager
		if (!stateManager) {
			return undefined
		}
		const apiConfig = stateManager.getApiConfiguration()
		const mode = stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
		const provider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		if (provider === "cline-pass") {
			return mode === "plan" ? apiConfig.planModeClinePassModelId : apiConfig.actModeClinePassModelId
		}
		return mode === "plan" ? apiConfig.planModeClineModelId : apiConfig.actModeClineModelId
	}

	private logQueueEvents(event: CoreSessionEvent): void {
		if (event.type === "pending_prompts") {
			const count = event.payload.prompts.length
			Logger.log(
				`[SdkController] Pending prompts updated: ${count} prompt(s) in queue for session ${event.payload.sessionId}`,
			)
			return
		}

		if (event.type === "pending_prompt_submitted") {
			Logger.log(
				`[SdkController] Pending prompt submitted: "${event.payload.prompt.substring(0, 80)}" for session ${event.payload.sessionId}`,
			)
		}
	}
}

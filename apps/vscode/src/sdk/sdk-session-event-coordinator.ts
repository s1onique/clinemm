import type { AgentEvent, CoreSessionEvent, PendingPromptCountRead } from "@cline/core"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import { refreshClineRecommendedModels } from "@/core/controller/models/refreshClineRecommendedModels"
import type { StateManager } from "@/core/storage/StateManager"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/cline/recommended-models"
import type { ClineApiReqInfo, RuntimeErrorIncident, RuntimeErrorSource, TurnPhase } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { isClineManagedProvider } from "@/shared/utils/cline"
import { getDiagnosticHostId, getDiagnosticManagerId } from "./background-job-liveness-authority"
import { type BackgroundOwnerCorrelationActiveJob, captureBackgroundOwnerCorrelationRecord } from "./background-owner-correlation"
import {
	// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
	// the silent default-Authorize fallback is REMOVED from the authority
	// module. The coordinator MUST be constructed with a real Elm provider
	// (or rely on the unconditional `SdkController` wiring, which injects
	// `ElmAuthorityModule.getElmAuthorityCompletionDecision`). There is no
	// silent default-Authorize fallback.
	type ElmCompletionAuthorityDecision,
} from "./completion-authority-elm-authority"
// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C6 / C7):
// the held-set progress classification is a kernel concern. The
// production seam (`enqueueCompletionContinuationIfHeld`) consults
// the existing Continuation Control Elm kernel BEFORE deciding
// the outcome. The kernel's `failureReason: "stalled_no_progress"`
// is the SOLE semantic authority for the no-progress blocking
// decision; the host's prior inlined `isStrictSupersetOf` check is
// removed (C7 ablation 4 — legacy TS authority removed).
import { pickContinuationDirectiveForPublication } from "./completion-continuation-control-elm"
import {
	recordActiveSessionLookupEntered,
	recordActiveSessionMissing,
	recordActiveSessionPresent,
	recordAgentTurnDoneNotificationSeen,
	recordAuthorityCheckReached,
	recordBlockedOutcomeDeliveryRejected,
	recordBlockedOutcomeObservationUnavailable,
	recordBlockedOutcomeStalledNoProgress,
	recordDedupePermitted,
	recordDedupeSuppressed,
	recordEnqueueCompletionContinuationInvoked,
	recordEnqueueIfHeldEntered,
	recordEpochMismatch,
	recordHeldJobIdsRead,
	recordMarkerMissing,
	recordMarkerPresent,
	recordNoHeldJobIds,
	recordNotifyAgentTurnDoneEntered,
	recordNoUnconsumedTerminal,
	recordOutstandingAutonomousWork,
	recordOwnerStillRunning,
	recordReevaluateEntered,
	recordRequestedSessionMatched,
	recordSessionMismatch,
	recordStalledNoProgress,
	recordTaskMismatch,
	recordUnconsumedTerminalCountRead,
} from "./completion-continuation-upstream-runtime"
import { captureContinuationCardinalityAuthorityRecord } from "./continuation-cardinality-authority"
// ACT-CLINEMM-ELM-SEAM08.2-E3.1-PRODUCTION-CUTOVER:
// the bounded E3.1 post-await transition (the dedupe-vs-permit
// decision) is migrated to a new Elm kernel. The production
// seam consults the new kernel AFTER the existing held-set-
// progress consult and BEFORE the TS-owned dedupe branches.
// On a `directive` outcome, the host revalidates the live
// (sessionId, taskId, epoch) identity BEFORE applying the
// directive (C5 stale-decision / TOCTOU guard). On any
// non-directive outcome (kernel_offline / decode_error /
// no_decision), the host falls through to the original TS
// predecessor path (C4 / C13 conservation).
import {
	consultDeferredCompletionBarrierElmKernel,
	type DeferredCompletionBarrierElmConsult,
	type DeferredCompletionBarrierFactsInput,
	type DeferredCompletionBarrierFactsJson,
} from "./deferred-completion-barrier-elm"
import {
	enterExtensionHostHotloopHandleSessionEvent,
	isExtensionHostHotloopDiagnosticEnabled,
	leaveExtensionHostHotloopHandleSessionEvent,
	recordExtensionHostHotloopLogQueueEvent,
	recordExtensionHostHotloopSessionEvent,
} from "./extension-host-hotloop-diagnostic"
import { shouldEmitExtensionHostQueueLog } from "./extension-host-queue-log-policy"
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

// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01:
// The `isStrictSupersetOf` helper was REMOVED by
// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C7 ablation 4
// — legacy TS authority removed). The held-set progress classification
// is now a property of the existing Continuation Control Elm kernel
// (`Policy.classifyHeldSetProgress` at
// apps/vscode/elm/completion-continuation-control/src/Policy.elm:230-255).
// The kernel's `failureReason: "stalled_no_progress"` is the SOLE
// semantic authority for the no-progress blocking decision; the
// production seam at `enqueueCompletionContinuationIfHeld` consults
// the kernel and routes the `stalled_no_progress` outcome through
// the existing `recordStalledNoProgress` counter.

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
	 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
	 *
	 * Synchronous accessor for the count of UNCONSUMED terminal
	 * result identities for an owner. This is the second conjunct
	 * of the BCB01 §0.1 frozen invariant:
	 *
	 *   C10 commit
	 *     ⇒ owned_background_jobs_nonterminal == 0
	 *       AND unconsumed_owned_terminal_results == 0
	 *
	 * Wired by `SdkController` to a thin adapter that delegates to
	 * `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner`
	 * (which itself sums live notify markers + held terminal
	 * results + non-notify terminal observations for the owner).
	 *
	 * Consumed by both the re-evaluation seam
	 * (`reevaluateDeferredCompletionBarrier` at ~L522) and the
	 * C10 completion-commit barrier (~L982) — completion is held
	 * if the count is > 0, exactly like the running-job check.
	 *
	 * Optional: when absent, the count defaults to 0 (legacy
	 * fail-open behavior matching the pre-CORRECTION01 state).
	 * Tests that omit this option preserve pre-CORRECTION01
	 * behavior. Production MUST wire this to maintain the BCB01
	 * §0.1 invariant.
	 */
	getUnconsumedOwnedTerminalResultCount?: (ownerSessionId: string | undefined) => number
	/**
	 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03:
	 *
	 * List-form sibling of `getUnconsumedOwnedTerminalResultCount`.
	 * Returns the union of `jobId`s that contributed to the count
	 * in stable insertion order (notificationMarkers first, then
	 * heldTerminalResults, then nonNotifyTerminalObservations).
	 *
	 * Wired by `SdkController` to a thin adapter that delegates
	 * to
	 * `BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner`.
	 *
	 * Consumed by the completion-continuation enqueue trigger to
	 * build the coalesced prompt's held-jobIds list. The list
	 * instructs the model to issue parallel `command_status` tool
	 * calls — one per held jobId — to drain BCB01 §0.1 second
	 * conjunct via Path B (notify=true) and Path C
	 * (non-notify, fire-and-forget).
	 *
	 * Optional: when absent, `enqueueCompletionContinuationIfHeld`
	 * falls back to `getUnconsumedOwnedTerminalResultCount` and
	 * only fires the continuation if the count > 0 (without
	 * listing specific jobIds). Tests that omit this option
	 * observe the legacy fire-rate-only behavior.
	 */
	getUnconsumedOwnedTerminalJobIds?: (sessionId: string, taskId: string | undefined) => readonly string[]
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
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
	 *
	 * Exact per-job liveness probe consulted at the C10
	 * completion-result filter (the message-level filter at
	 * `sdk-session-event-coordinator.ts:514-535`). Returns true iff
	 * there is currently an outstanding BackgroundNotifyCoordinator
	 * marker for the given `jobId`. Wired by `SdkController` to a
	 * thin adapter that delegates to
	 * `BackgroundNotifyCoordinator.hasActiveNotify(jobId)`.
	 *
	 * Optional: when absent, the C10 filter falls back to the
	 * over-broad aggregate `activeNotifyCount > 0` predicate (the
	 * pre-repair P7b behavior). Tests that omit this option remain
	 * deterministic.
	 */
	hasActiveNotify?: (jobId: string) => boolean
	/**
	 * ACT-CLINEMM-C10-FILTER-ABLATION01:
	 *
	 * TEST-ONLY option-bag method that directly gates the C10
	 * message-layer completion_result filter. Returns true iff the
	 * filter should drop the `say:"completion_result"` rows from
	 * `result.messages` before they reach `appendAndEmit`.
	 *
	 * When present, this method is consulted EXCLUSIVELY by the
	 * SEAM-A filter at
	 * `sdk-session-event-coordinator.ts` (the message-layer
	 * branch at L692..L738). It is NOT consulted by SEAM B
	 * (the framework-level completion-commit barrier at
	 * `setTurnPhase("completed", ...)`), which continues to read
	 * the real `hasActiveNotify` / `wasWakeDelivered` / etc.
	 * state through the normal option-bag methods.
	 *
	 * This predicate is the seam-a-only ablation switch required
	 * by the C10-ABLATION review (HALTC10-ABLATION-NOT-ISOLATED):
	 * turning it OFF does NOT contaminate SEAM B's lifecycle
	 * decision because SEAM B reads the real coordinator state
	 * regardless of what this returns.
	 *
	 * Optional: when absent, SEAM A falls back to its standard
	 * `hasActiveNotify(jobId)` per-jid lookup followed by the
	 * over-broad aggregate fallback. Tests that omit this option
	 * observe the production behavior unchanged.
	 */
	shouldFilterCompletionResult?: (ownedJobIds: readonly string[]) => boolean
	/**
	 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01:
	 *
	 * Per-job wake-delivered probe consulted at the C10
	 * completion-commit seam (the
	 * `setTurnPhase("completed", ...)` barrier at
	 * `sdk-session-event-coordinator.ts:691-733`). Returns true
	 * iff Path A's async transport has resolved with "delivered"
	 * for the given `jobId` (i.e. the wake actually landed in
	 * PendingPromptsController). When true, the originating
	 * turn's completion commit is SUPPRESSED because the
	 * wake-driven turn owns terminal completion for J.
	 *
	 * Wired by `SdkController` to a thin adapter that delegates
	 * to `BackgroundNotifyCoordinator.wasWakeDelivered(jobId)`.
	 *
	 * Optional: when absent, the C10 barrier falls back to the
	 * pre-repair TQCB01 predicate (originating turn's completion
	 * is held until marker drains, then released — which produces
	 * the live double-completion defect when the wake is in
	 * flight). Tests that omit this option remain deterministic.
	 */
	wasWakeDelivered?: (jobId: string) => boolean
	/**
	 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 /
	 * CORRECTION03 (HALT_WAKE_DELIVERY_ACK_PROMOTED):
	 *
	 * Per-job wake-dispatch-requested probe consulted at the C10
	 * completion-commit seam. Returns true iff the host's
	 * `enqueueTerminalWake(...)` callback was invoked for the
	 * given `jobId` BUT the async delivery ack has not yet
	 * resolved (dispatch in flight).
	 *
	 * When true, the C10 barrier HOLDS the originating turn's
	 * completion commit (waiting for the ack to resolve). This
	 * is the three-state contract boundary: REQUESTED ≠
	 * DELIVERED ≠ FAILED.
	 *
	 * Wired by `SdkController` to a thin adapter that delegates
	 * to `BackgroundNotifyCoordinator.wasWakeDispatchRequested(jobId)`.
	 */
	wasWakeDispatchRequested?: (jobId: string) => boolean
	/**
	 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 /
	 * CORRECTION03 (HALT_WAKE_DELIVERY_ACK_PROMOTED):
	 *
	 * Per-job wake-dispatch-failed probe consulted at the C10
	 * completion-commit seam. Returns true iff the host's async
	 * transport resolved with "rejected" or "session_gone" for
	 * the given `jobId` (the wake is LOST; no wake-driven turn
	 * will fire).
	 *
	 * When true, the C10 barrier ALLOWS the originating turn's
	 * completion commit so the originator becomes the canonical
	 * terminal-completion authority for J (semantic completion
	 * count is 1, not 0).
	 *
	 * Wired by `SdkController` to a thin adapter that delegates
	 * to `BackgroundNotifyCoordinator.wasWakeDispatchFailed(jobId)`.
	 */
	wasWakeDispatchFailed?: (jobId: string) => boolean
	/**
	 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01:
	 *
	 * Per-job wake-authority settled probe consulted at the C10
	 * completion-commit seam. Returns true iff the wake authority
	 * for the given `jobId` has been committed to a terminal
	 * sink (delivered to PendingPromptsController OR discarded
	 * via `discardQueuedWake`).
	 *
	 * Wired by `SdkController` to a thin adapter that delegates
	 * to `BackgroundNotifyCoordinator.isWakeAuthoritySettled(jobId)`.
	 *
	 * Optional: when absent, the C10 barrier falls back to the
	 * pre-repair TQCB01 predicate (same rationale as
	 * `wasWakeDelivered`).
	 */
	isWakeAuthoritySettled?: (jobId: string) => boolean
	/**
	 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03:
	 *
	 * The bounded finalization-authority seam. When the BCB01 §0.1
	 * barrier holds completion against unconsumed owned terminal
	 * results AND the active session's runtime has already called
	 * `finishRun("completed", ...)` (the `submit_and_exit` tool's
	 * `lifecycle.completesRun === true` semantics end the agent
	 * loop on first non-error result), the coordinator calls this
	 * callback AT MOST ONCE per (sessionId, epoch) to enqueue a
	 * coalesced continuation turn via
	 * `activeSession.sdkHost.send({ delivery: "queue" })`.
	 *
	 * The continuation prompt lists ALL held jobIds (snapshot from
	 * `BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner`)
	 * and instructs the model to issue parallel `command_status`
	 * calls per held jobId, then re-issue `submit_and_exit`. After
	 * the model observes each held jobId, the BCB01 second conjunct
	 * (`unconsumed_owned_terminal_results == 0`) resolves and the
	 * held completion commits exactly once via
	 * `reevaluateDeferredCompletionBarrier`.
	 *
	 * Firing policy:
	 *   - Bounded: AT MOST ONE call per `(sessionId, epoch)`,
	 *     tracked via internal `completionContinuationSentForEpoch`.
	 *   - Idempotent across multiple `done` events for the same
	 *     epoch (the message-translator's translator emits one
	 *     `turnComplete` per event; the coordinator deduplicates).
	 *   - The coordinator SUPPRESSES the call if no deferred-
	 *     completion-barrier marker is registered (i.e. completion
	 *     was allowed to commit normally).
	 *   - The coordinator SUPPRESSES the call if
	 *     `unconsumedOwnedTerminalResultCount == 0` (i.e. no
	 *     observations are held; the barrier is held by a different
	 *     authority — running jobs, queued prompts, or active notify
	 *     markers — and continuation is not the right intervention).
	 *
	 * Optional: when absent, the BCB01 barrier remains in
	 * `deferredCompletionBarrier` state and the held completion is
	 * released by `reevaluateDeferredCompletionBarrier` (only when
	 * the barrier state drains, e.g. via terminal-idle event).
	 * Tests that omit this option observe the pre-CORRECTION03
	 * behavior (no continuation enqueue).
	 */
	enqueueCompletionContinuation?: (input: {
		sessionId: string
		taskId: string | undefined
		heldJobIds: readonly string[]
	}) => Promise<{
		kind: "delivered" | "rejected" | "session_gone" | "no_held_job_ids"
	}>
	/**
	 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01:
	 *
	 * Bounded host correlation accessor for the live resumed-turn tool
	 * registry. The coordinator consults this synchronously at the
	 * BCB01-CORRECTION03 re-registration + enqueue trigger
	 * (`handleSessionEvent` L2570+). When the model has no
	 * `command_status` (or any observation capability), the
	 * coalesced continuation is useless — handing the model a prompt
	 * that lists held jobIds but instructs it to call a tool it
	 * does not have produces a bounded loop where the model re-issues
	 * `submit_and_exit` (its only available action) and the BCB
	 * re-registers. The host publishes a SINGLE typed blocked
	 * outcome (`reason: "observation_unavailable"`) and stops
	 * re-firing the coalesced continuation.
	 *
	 * The per-job wake path (`enqueueTerminalWake` →
	 * `formatTerminalWakePrompt` → `sdkHost.send`) is NOT policed
	 * by this accessor — the wake is the genuine observation
	 * notification path. The bounded correlation only affects the
	 * COALESCED continuation.
	 *
	 * Optional: when absent, the coordinator preserves the
	 * pre-CTQC01 behavior (no correlation check; the host re-fires
	 * the coalesced continuation regardless of capability).
	 */
	liveTools?: () => readonly string[] | undefined
	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01:
	 *
	 * Elm-authority decision seam. The coordinator consults this
	 * synchronously IMMEDIATELY BEFORE invoking the production
	 * `setTurnPhase("completed", ...)` commit effect at both
	 * commit-effect sites:
	 *
	 *   1. The deferred-completion-barrier re-entry site
	 *      (`reevaluateDeferredCompletionBarrier`).
	 *   2. The initial-dispatch C10 commit site (the
	 *      `submit_and_exit_seen` → C10 capture → `setTurnPhase`
	 *      path in `handleSessionEvent`).
	 *
	 * Authority contract (per ACT §3, §7, §9):
	 *   - `kind: "authorize"`  → invoke the existing TS commit
	 *     effect exactly once (no behavior change).
	 *   - `kind: "hold"`       → DO NOT invoke the commit effect.
	 *     The TS predicate chain has already cleared, so Elm is
	 *     the sole remaining barrier; the held completion commits
	 *     on the next BCB/BNCA re-evaluation that does not
	 *     re-trigger this hold.
	 *   - `kind: "failure"`    → DO NOT invoke the commit effect.
	 *     No silent TS fallback. Elm unavailability is logged
	 *     explicitly via `Logger.warn` with the classification.
	 *
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
	 * this option is REQUIRED. The coordinator MUST be constructed
	 * with a real Elm authority provider. The legacy silent default-
	 * Authorize fallback has been deleted. The production wiring
	 * (`SdkController > SdkSessionEventCoordinatorOptions`) injects
	 * `ElmAuthorityModule.getElmAuthorityCompletionDecision`. Tests
	 * inject their own provider. There is no opt-out.
	 */
	getElmCompletionAuthorityDecision: (sessionId?: string) => ElmCompletionAuthorityDecision
	/**
	 * ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01 / MAPPING01-CORRECTION01:
	 *
	 * Host-owned runtime-incident publication sink. The coordinator
	 * invokes `taskTelemetry.recordRuntimeError(incident)` from inside
	 * `applyBlockedCompletionContinuationOutcome(...)` AFTER the C4
	 * adversarial guards pass and AFTER the marker stamp, for the
	 * closed-enum set `{ "stalled_no_progress", "rejected" }` of
	 * non-delivered enqueue outcomes. Every other union member is
	 * a no-op (the helper returns early; no incident is recorded).
	 *
	 * The closed-enum `RuntimeErrorIncident` shape
	 * (ExtensionMessage.ts:1064-1068) is the existing production
	 * payload used by `CommandJobManager.cancel` for EPERM and
	 * `command_containment_failed`. The new call site reuses the
	 * existing `UNKNOWN_RUNTIME_ERROR` `errorClass` and adds two
	 * additive values to the closed `RuntimeErrorSource` enum
	 * (`"completion-continuation-stalled"` /
	 * `"completion-continuation-delivery-rejected"`). The V1 webview
	 * ignores the source string (per the V1 contract at
	 * ExtensionMessage.ts:1121-1148), so additive enum extensions
	 * are safe.
	 *
	 * The marker is at-most-one per coordinator instance, so
	 * two stalls → one typed publication (idempotence preserved by
	 * the existing C4 guards; a successful publication also
	 * increments the cumulative `TaskHeaderTelemetryStrip.runtimeErrorCount`
	 * wire field, mirroring the existing
	 * `command_containment_failed` precedent).
	 *
	 * Optional: when absent, the helper returns without invoking
	 * any incident sink (the existing pre-MAPPING01 behavior). The
	 * `applyBlockedCompletionContinuationOutcome` marker stamp and
	 * the opt-in dogfood counters continue to fire.
	 */
	taskTelemetry?: {
		readonly recordRuntimeError: (incident: RuntimeErrorIncident) => void
	}
	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER:
	 * Optional microtask-flush helper the coordinator awaits before
	 * consulting the authority decision. Drains the per-session
	 * authority queue (records delivered via the CCARD capture path) into
	 * the live Elm kernel. When absent, the coordinator falls back to
	 * a no-op flush (the legacy seam remains synchronous). When authority
	 * is OFF, the helper is a no-op regardless of records.
	 */
	flushElmAuthorityForSession?: (sessionId: string) => Promise<void>
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

/**
 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
 *
 * Bounded marker recorded at the `wasAttemptCompletionSeen() +
 * wasTerminalResponseCommittedThisTurn()` branch when an outstanding
 * autonomous obligation exists. Holds the identity triple (sessionId
 * + taskId + epoch) so a late terminal event cannot mutate a newer
 * task (TQCB01-CTL-07 / TQCB01-CTL-08 / epoch supersession). Cleared
 * on commit (exactly once) or on epoch supersession.
 *
 * The marker is NOT a general-purpose continuation queue — it holds
 * at most ONE pending completion per coordinator instance.
 */
/**
 * ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01:
 *
 * Closed enum for the typed host-owned reason a deferred
 * completion barrier carries. The marker is the existing
 * production "blocked" surface; the `reason` field is the
 * missing typed verdict. Stamped only by
 * `applyBlockedCompletionContinuationOutcome` from a
 * non-delivered enqueue outcome whose captured session/task
 * still match the live active session/task (C4 adversarial
 * guard). A `delivered` / `not_held` / `no_held_job_ids` /
 * `already_sent` / `session_gone` / `no_callback` outcome
 * MUST NOT stamp a blocked reason.
 *
 * Invariants:
 *   - One value per call-site mapping (no free-form strings).
 *   - "stalled_no_progress" maps from the upstream TS disc
 *     (enqueueIfHeld L1404-1421) — Elm policy is NOT consulted
 *     for the disc verdict (the disc is causal-state, not
 *     capability).
 *   - "delivery_rejected" maps from the production callback's
 *     `rejected` outcome (sdkHost.send threw OR liveTools
 *     returned undefined).
 *   - "observation_unavailable" is reserved for the case where
 *     the Elm policy fail-closed on observation_unavailable is
 *     carried into a host publication; not currently produced
 *     by the production seam (the C5 RED-2 / RED#2 cases pin
 *     this is preserved as a CLOSED enum value, not an
 *     open-ended string).
 */
type DeferredCompletionBarrierReason = "stalled_no_progress" | "delivery_rejected" | "observation_unavailable"

interface DeferredCompletionBarrier {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly epoch: number
	readonly deferredAt: number
	readonly reason?: DeferredCompletionBarrierReason
}

export class SdkSessionEventCoordinator {
	private readonly translateSessionEvent: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
	 * bounded continuation marker (at most one entry per coordinator
	 * instance). Cleared on commit or on epoch supersession.
	 */
	private deferredContinuation: DeferredContinuation | undefined

	/**
	 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
	 * bounded completion-barrier marker (at most one entry per
	 * coordinator instance). Cleared on commit or on epoch
	 * supersession. Same identity-triple semantics as
	 * `deferredContinuation` (BTCONT01).
	 */
	private deferredCompletionBarrier: DeferredCompletionBarrier | undefined

	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-MCP-TOOL-RESTART-CAUSAL-REPRODUCTION:
	 *
	 * Test-only accessor exposing the marker state. Production wiring in
	 * `SdkController` mirrors this via the `isDeferredCompletionOutstanding`
	 * predicate on `SdkSessionRebuildScheduler`. The marker is the source
	 * of truth for "the deferred completion obligation is still being
	 * held by the BCB01 §0.1 conservation predicates" — the rebuild
	 * scheduler's drain must wait for it to clear before firing any
	 * passive rebuild that clears `activeSession`.
	 */
	isDeferredCompletionBarrierOutstandingForTesting(): boolean {
		return this.deferredCompletionBarrier !== undefined
	}

	/**
	 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03 /
	 * CORRECTION04:
	 *
	 * Bounded single-key marker for the completion-continuation
	 * enqueue. Stores the LAST `(sessionId, taskId, epoch)` triple
	 * for which the continuation was enqueued; any future trigger
	 * with the same triple is suppressed. A single string slot is
	 * `O(1)` memory regardless of coordinator lifetime — the
	 * earlier Set-based implementation grew unboundedly across
	 * epoch advances (P1 halt surfaced by
	 * HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION).
	 *
	 * Format: `${sessionId}|${taskId ?? "(none)"}|${epoch}`.
	 * On epoch supersession, the next trigger's key is naturally
	 * different (the new epoch), so the dedupe correctly allows
	 * the next continuation. No explicit cleanup needed.
	 */
	private lastCompletionContinuationSessionEpoch: string | undefined

	/**
	 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01:
	 *
	 * Canonical sorted snapshot of the held-job-ids set that produced
	 * the LAST successful enqueue through this coordinator. Stored
	 * separately from `lastCompletionContinuationControlFingerprint` so
	 * the stall discriminator can perform a SET comparison (pure
	 * superset ⇒ no progress ⇒ stall) rather than a coarse
	 * string-equality check. The pre-fix fingerprint included the
	 * held count and the raw sorted IDs, so a passive superset
	 * accumulation (new background terminals arriving while the model
	 * has no observation capability) would shift the fingerprint and
	 * BYPASS the stall detector. Storing the sorted set explicitly
	 * closes the LIVE stalled-rearm-loop defect.
	 *
	 * Cleared by `clearCompletionContinuationSentForTesting` (test
	 * backdoor). Not cleared on epoch advance — a stall across an
	 * epoch is a stall, regardless of epoch bump (BIND_TIMEs).
	 *
	 * `undefined` means "no prior successful enqueue"; the first
	 * enqueue is always permitted.
	 */
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: written by the production code (L1907 / L1962)
	private lastCompletionContinuationControlFingerprint: string | undefined

	/**
	 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01:
	 *
	 * Canonical sorted snapshot of the held-job-ids set that produced
	 * the LAST successful enqueue through this coordinator. Stored
	 * separately from `lastCompletionContinuationControlFingerprint` so
	 * the stall discriminator can perform a SET comparison (pure
	 * superset ⇒ no progress ⇒ stall) rather than a coarse
	 * string-equality check. The pre-fix fingerprint included the
	 * held count and the raw sorted IDs, so a passive superset
	 * accumulation (new background terminals arriving while the model
	 * has no observation capability) would shift the fingerprint and
	 * BYPASS the stall detector. Storing the sorted set explicitly
	 * closes the LIVE stalled-rearm-loop defect.
	 *
	 * Cleared by `clearCompletionContinuationSentForTesting` (test
	 * backdoor). Not cleared on epoch advance — a stall across an
	 * epoch is a stall, regardless of epoch bump (BIND_TIMEs).
	 *
	 * `undefined` means "no prior successful enqueue"; the first
	 * enqueue is always permitted.
	 */
	private lastCompletionContinuationHeldSetSorted: readonly string[] | undefined

	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §21-G:
	 * monotonic, coordinator-local counter that mints a unique
	 * `submitId` per C9 (`submit_and_exit_seen`) event creation.
	 * One C9 event → one submitId; two C9 events → two distinct
	 * submitIds. BCB hold/release does NOT mint a new submitId
	 * (the C9 is the only event-creating seam).
	 */
	private nextSubmitEventId = 0

	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §21-H:
	 * monotonic, coordinator-local counter that mints a unique
	 * `completionId` per C10 completion event
	 * creation. One C10 → one completionId; two real C10 commits
	 * → two distinct completionIds. Presentation, reopen, and BCB
	 * do NOT mint completionIds (the C10 is the only event-creating
	 * seam).
	 */
	private nextCompletionCommitEventId = 0

	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
	 * The Elm-authority decision provider, captured at construction.
	 * REQUIRED (no fallback). The provider is the real Elm runtime
	 * (`ElmAuthorityModule.getElmAuthorityCompletionDecision`) in
	 * production; tests inject their own. The legacy silent default-
	 * Authorize fallback is gone.
	 */
	private readonly getElmCompletionAuthorityDecision: (sessionId?: string) => ElmCompletionAuthorityDecision

	constructor(private readonly options: SdkSessionEventCoordinatorOptions) {
		this.translateSessionEvent = options.translateSessionEvent ?? translateSessionEvent
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
		// The option is required; do not fall back to a default-
		// Authorize. Tests must inject a provider.
		this.getElmCompletionAuthorityDecision = options.getElmCompletionAuthorityDecision
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
	 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
	 *
	 * External entry point invoked by `SdkController` when an
	 * outstanding autonomous obligation resolves (Path A wake
	 * consumption or Path B command_status observation). Mirrors the
	 * four conservation rules of `reevaluateDeferredContinuation`
	 * (BTCONT01):
	 *   1. the deferred-completion-barrier marker MUST exist for the
	 *      active session; otherwise this is a no-op
	 *   2. the marker's epoch MUST still match the active minter
	 *      epoch; otherwise the deferral has been superseded by a
	 *      newer turn and the late terminal event is discarded
	 *   3. the completion-barrier predicate (`outstandingAutonomousWork`)
	 *      MUST report zero; otherwise the held completion stays
	 *      deferred. The predicate is the SAME one used at admission:
	 *        pendingPromptAuthorityUnknown  (PPAT01 fail-closed)
	 *        || pendingPromptsKnown > 0
	 *        || activeNotifyCount > 0
	 *      Notably the aggregate `hasRunningBackgroundJobForOwner` is
	 *      NOT consulted here — notify=false jobs are fire-and-forget
	 *      and must NEVER block completion (TQCB01 P1 correction).
	 *   4. on success, the canonical writer
	 *      `session-event-turn-complete-completed` commits `completed`
	 *      exactly once and the marker is cleared
	 */
	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01:
	 *
	 * Consults the Elm-authority decision provider. Returns true iff
	 * the production commit effect MAY proceed. When the provider
	 * returns `kind: "hold"` or `kind: "failure"`, logs an explicit
	 * bounded diagnostic and returns false.
	 *
	 * This helper is a single-character delta at both commit sites:
	 * the existing TS predicate chain clears first; Elm is the FINAL
	 * gate.
	 *
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
	 * the legacy silent default-Authorize fallback (which returned
	 * `kind: "authorize"` when the option was absent) has been
	 * removed. The provider is REQUIRED. When the runtime is not
	 * armed, `getElmAuthorityCompletionDecision` returns a
	 * `failure` decision and this helper suppresses the commit effect.
	 */
	private async checkElmCompletionAuthority(writerId: TurnStateWriterId): Promise<boolean> {
		const activeSession = this.options.sessions.getActiveSession()
		const sessionId = activeSession?.sessionId
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER:
		// flush the per-session authority queue before reading the decision so
		// the Elm kernel has processed all records delivered up to the
		// consult point. The flush is a no-op when authority is OFF.
		try {
			await this.options.flushElmAuthorityForSession?.(sessionId ?? "")
		} catch (err) {
			Logger.warn(
				`[SdkController] Elm completion-authority flush threw at writerId=${writerId}; suppressing commit effect (no silent TS fallback): ${
					err instanceof Error ? err.message : String(err)
				}`,
			)
			return false
		}
		let decision: ElmCompletionAuthorityDecision
		try {
			decision = this.getElmCompletionAuthorityDecision(sessionId)
		} catch (err) {
			Logger.warn(
				`[SdkController] Elm completion-authority decision provider threw at writerId=${writerId}; suppressing commit effect (no silent TS fallback): ${
					err instanceof Error ? err.message : String(err)
				}`,
			)
			return false
		}
		if (decision.kind === "authorize") return true
		if (decision.kind === "hold") {
			Logger.warn(
				`[SdkController] Elm completion-authority returned HOLD at writerId=${writerId} (reason=${decision.reason}); suppressing commit effect`,
			)
			return false
		}
		// failure: per ACT §3, no silent TS fallback. Suppress the
		// commit effect and surface the bounded classification.
		Logger.warn(
			`[SdkController] Elm completion-authority returned FAILURE at writerId=${writerId} (classification=${decision.classification}); suppressing commit effect (no silent TS fallback)`,
		)
		return false
	}

	/**
	 * ACT-CLINEMM-ELM-SEAM08.3-E3.1-QUALIFICATION:
	 *
	 * Test-only seam: lets a test inject a custom
	 * `invokeForProduction` for the E3.1 consult WITHOUT changing
	 * the production path (the default is `undefined`, so the
	 * production call uses the real `defaultInvokeElmKernel`). The
	 * seam is a single private field with a test backdoor setter;
	 * production code NEVER touches it. It exists to let the
	 * SEAM08.3 race / necessity tests exercise the production
	 * coordinator's E3.1 consult path with a controlled invoke
	 * (e.g. one that holds the consult in flight while the test
	 * mutates the live marker, or one that returns a specific
	 * directive kind to verify the host routing).
	 */
	private _e31TestInvokeForProduction:
		| ((facts: DeferredCompletionBarrierFactsJson) => Promise<DeferredCompletionBarrierElmConsult>)
		| undefined = undefined

	setE31TestInvokeForProductionForTests(
		invoke: ((facts: DeferredCompletionBarrierFactsJson) => Promise<DeferredCompletionBarrierElmConsult>) | undefined,
	): void {
		this._e31TestInvokeForProduction = invoke
	}

	/**
	 * ACT-CLINEMM-ELM-SEAM08.2-E3.1-PRODUCTION-CUTOVER:
	 * consult the deferred-completion-barrier Elm kernel for
	 * the E3.1 dedupe-vs-permit decision. The host retains all
	 * effect ownership; the Elm outcome routes to the existing
	 * TS branches.
	 *
	 * Returns one of:
	 *   "fallthrough"        — Elm authority unavailable (kernel
	 *                          offline, decode error, no_response,
	 *                          or non-directive consult). The
	 *                          ORIGINAL TS predecessor path runs.
	 *                          The C4 / C13 conservation contract
	 *                          requires this: the original request
	 *                          remains valid because the kernel
	 *                          never made a directive.
	 *   "request_superseded" — The live state has drifted since
	 *                          the consult was started (sessionId /
	 *                          taskId / epoch / marker presence).
	 *                          The original request is now OBSOLETE
	 *                          — it was computed against a snapshot
	 *                          that no longer represents the live
	 *                          owner. The TS predecessor must NOT
	 *                          run; the request is TERMINAL with
	 *                          no enqueue, no marker mutation, no
	 *                          dedupe mutation, and no completion
	 *                          commit. This holds REGARDLESS of the
	 *                          consult's outcome kind: a directive
	 *                          computed for an obsolete owner, a
	 *                          kernel_offline on an obsolete
	 *                          request, and a decode_error on an
	 *                          obsolete request all terminate the
	 *                          same way. (DCBR01 RED witness; see
	 *                          SEAM08.3-CORRECTION01 §P0 and the
	 *                          stale-fallback-on-drift review.)
	 *   "permit"             — the Elm consult says: this is a
	 *                          fresh obligation; fall through to
	 *                          the existing dedupe check. The
	 *                          Elm's `mustClearRearm` was already
	 *                          applied (or not) at the consult
	 *                          site.
	 *   "clear_rearm"        — the Elm consult says: real
	 *                          progress; release the REARM dedupe.
	 *                          (Equivalent to the TS L1633 branch.)
	 *   "already_sent"       — the Elm consult says: a prior
	 *                          successful enqueue for THIS exact
	 *                          dedupe key has already happened.
	 *                          Suppress.
	 *   "no_held_job_ids"    — the Elm consult says: the held set
	 *                          is empty at the consult point.
	 *                          Suppress.
	 *
	 * C5 stale-decision guard: the host revalidates the live
	 * identity AFTER the consult completes but BEFORE the
	 * outcome is returned. The precedence is:
	 *
	 *   - live state drift (regardless of directive kind) ->
	 *     "request_superseded" (TERMINAL; the original request
	 *     is obsolete, so the TS predecessor cannot run).
	 *   - still-valid request + non-directive consult
	 *     (kernel_offline / decode_error / no_response) ->
	 *     "fallthrough" (TS predecessor is safe because the
	 *     original request is still valid; the kernel made no
	 *     decision).
	 *   - still-valid request + directive consult -> the
	 *     directive routes to the existing branches.
	 */
	private async consultE31BarrierForFacts(
		facts: DeferredCompletionBarrierFactsInput,
	): Promise<"fallthrough" | "request_superseded" | "permit" | "clear_rearm" | "already_sent" | "no_held_job_ids"> {
		let consultResult: Awaited<ReturnType<typeof consultDeferredCompletionBarrierElmKernel>>
		try {
			// ACT-CLINEMM-ELM-SEAM08.3-E3.1-QUALIFICATION: when a test
			// has injected `_e31TestInvokeForProduction`, route the
			// consult through that custom invoke so the test can
			// observe / control the kernel's response. The test seam
			// only affects the E3.1 consult; production code never
			// sets this field. The custom invoke's return value is
			// passed through `validateConsultResult` by the public
			// adapter, so unknown kinds / wrong requestId echoes /
			// missing mustClearRearm are still rejected as
			// `decode_error` (REVIEWER P1 / SEAM08.1 invariant).
			consultResult = await consultDeferredCompletionBarrierElmKernel(facts, {
				...(this._e31TestInvokeForProduction ? { invokeForProduction: this._e31TestInvokeForProduction } : {}),
			})
		} catch (err) {
			// C4 / C13: the consult promise rejected; surface as
			// fallthrough so the original TS path runs.
			Logger.warn(
				`[SdkController] E3.1 deferred-completion-barrier consult threw; falling through to TS predecessor: ${
					err instanceof Error ? err.message : String(err)
				}`,
			)
			return "fallthrough"
		}
		// C5 stale-decision guard (commit-time identity
		// revalidation). RE-READ the live state after the
		// consult completes; if the live state has drifted
		// since the kernel computed the directive, the
		// request is `request_superseded`
		// (ACT-CLINEMM-ELM-SEAM08.3-CORRECTION01-STALE-FALLBACK-ON-DRIFT).
		// The host reads:
		//   - sessionId: must equal facts.sessionId
		//   - taskId:    must equal facts.taskId
		//   - epoch:     must equal facts.markerEpoch
		//   - marker:    must still be present
		//
		// Precedence (CORRECTION01-bounded repair of the
		// SEAM08.3-CORRECTION01 ordering): the live-state
		// check fires BEFORE the directive-type check. The
		// reviewer's invariant is:
		//
		//   "A failed Elm consult can use the TypeScript
		//    predecessor. An obsolete request must not use
		//    the predecessor to perform effects against a
		//    newer owner."
		//
		// Therefore the obsolete-request check is the
		// OUTER guard, not the inner one. A non-directive
		// consult (kernel_offline / decode_error /
		// no_response) on a STILL-VALID request returns
		// "fallthrough" so the original TS predecessor
		// runs (the C4 / C13 invariant — the request is
		// still valid because the kernel made no decision).
		// The same non-directive consult on a SUPERSEDED
		// request (live marker cleared or advanced to a
		// new owner / task / epoch) returns
		// "request_superseded" — the kernel never made a
		// decision, but the request is obsolete and the
		// TS predecessor is NOT permitted to run effects
		// against a newer owner. A directive consult whose
		// facts no longer match the live state also returns
		// "request_superseded" for the same reason.
		//
		// Captured marker identity is sufficient to
		// identify the original operation; the
		// ownership-generation checks below remain
		// authoritative (the captured facts.sessionId /
		// facts.taskId / facts.markerEpoch are the
		// snapshot the host collected BEFORE the await).
		const liveMarker = this.deferredCompletionBarrier
		const liveStateDrifted =
			liveMarker === undefined ||
			liveMarker.sessionId !== facts.sessionId ||
			liveMarker.taskId !== facts.taskId ||
			liveMarker.epoch !== facts.markerEpoch
		// OBSOLETE-REQUEST GUARD (outer). Fires for BOTH
		// directive and non-directive consults when the
		// live state has drifted. An Elm rejection or a
		// kernel failure on a stale request is still an
		// obsolete request — the TS predecessor is NOT
		// permitted to run.
		if (liveStateDrifted) {
			return "request_superseded"
		}
		// Non-directive outcomes (kernel_offline /
		// decode_error / no_decision) on a STILL-VALID
		// request: the TS predecessor path runs. The
		// request is still valid because the kernel
		// made no decision.
		if (consultResult.kind !== "directive") {
			return "fallthrough"
		}
		const v = consultResult.value
		switch (v.kind) {
			case "permit_enqueue":
				// The Elm consult's `mustClearRearm` is the
				// authoritative signal. The TS L1633 branch
				// (in the caller's pre-cond state) was
				// pre-Elm-cutover; under SEAM08.2 the Elm's
				// signal drives the same effect. We surface
				// `clear_rearm` to the caller so the caller
				// can decide whether to clear the dedupe slot.
				// Note: the caller's existing `if
				// (priorSortedHeld !== undefined)` branch
				// (TS L1633) STILL runs on the fallthrough
				// path; under the Elm-directive path, the
				// Elm's signal OVERRIDES the TS branch via
				// the explicit `clear_rearm` return.
				return v.mustClearRearm ? "clear_rearm" : "permit"
			case "suppress_duplicate":
				return "already_sent"
			case "preserve_barrier":
				return "no_held_job_ids"
			case "reject_stale_identity":
				// The kernel saw facts that the host's
				// commit-time revalidation (above) also
				// confirmed as drifted; the liveStateDrifted
				// branch already returned "request_superseded".
				// Reaching this case means the kernel rejected
				// but the host's revalidation did not detect
				// drift — a conservative safety net. Treat as
				// supersession rather than running the TS
				// predecessor (the kernel's directive is the
				// authoritative signal; the host must honor
				// it). This preserves the stale-request
				// conservation invariant: an Elm-rejected
				// request is never routed to the TS
				// predecessor.
				Logger.warn(
					`[SdkController] E3.1 deferred-completion-barrier consult returned reject_stale_identity(${v.reason}) but host revalidation saw no drift; treating as request_superseded for safety`,
				)
				return "request_superseded"
			default:
				return "fallthrough"
		}
	}

	async reevaluateDeferredCompletionBarrier(): Promise<void> {
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// U1 discriminator. Every call increments
		// reevaluateEntered; the U2..U7 counters below record the
		// decision the production code made. §11 invariant:
		// every predicate is captured into a local const and the
		// SAME const is used for the production check AND the
		// record*() call. No provider is invoked twice.
		recordReevaluateEntered()
		const marker = this.deferredCompletionBarrier
		if (!marker) {
			recordMarkerMissing()
			return
		}
		recordMarkerPresent()
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION04-LIVE-ACTIVE-SESSION-LOOKUP-DISCRIMINATOR:
		// U2.5 discriminator. The active-session lookup is the
		// ONLY pre-U3 branch the CORRECTION03 instrumentation
		// did not cover. The marker was just observed present; if
		// the active session has been disposed (e.g. by an
		// intervening session switch), this branch silently
		// clears the marker and returns — which is exactly what
		// the LIVE chronology shows (markerPresent=1 followed by
		// markerMissing=1, with no identity mismatch recorded).
		// §11 invariant: getActiveSession() is called exactly
		// once; the same `activeSession` const is reused for
		// BOTH the production check AND the record*() dispatch.
		recordActiveSessionLookupEntered()
		const activeSession = this.options.sessions.getActiveSession()
		const sessionMatched = !!activeSession && marker.sessionId === activeSession.sessionId
		recordRequestedSessionMatched(sessionMatched)
		if (!activeSession) {
			// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION04-LIVE-ACTIVE-SESSION-LOOKUP-DISCRIMINATOR:
			// Captures the LIVE scenario where the marker flip
			// happens at the active-session lookup, NOT at any
			// identity mismatch. The `recordActiveSessionMissing`
			// call also records `markerClearedForMissingSession`
			// and sets `lastStopReason = "active_session_missing"`.
			recordActiveSessionMissing()
			this.deferredCompletionBarrier = undefined
			return
		}
		recordActiveSessionPresent()
		if (marker.sessionId !== activeSession.sessionId) {
			recordSessionMismatch()
			this.deferredCompletionBarrier = undefined
			return
		}
		const taskId = this.options.getTask?.()?.taskId
		if (marker.taskId !== taskId) {
			recordTaskMismatch()
			this.deferredCompletionBarrier = undefined
			return
		}
		const currentEpoch = this.options.messageTranslatorState.getMinter().epoch
		if (marker.epoch !== currentEpoch) {
			recordEpochMismatch()
			this.deferredCompletionBarrier = undefined
			return
		}
		// Same predicate as the admission guard. Fail-closed on
		// pending-prompt authority. NO `ownerStillRunning` —
		// notify=false jobs are not completion-relevant.
		const pendingPromptCountRead: PendingPromptCountRead = this.options.getPendingPromptCount?.(activeSession.sessionId) ?? {
			available: false,
		}
		const pendingPromptAuthorityUnknown = pendingPromptCountRead.available !== true
		const pendingPromptsKnown = pendingPromptCountRead.available === true ? pendingPromptCountRead.count : 0
		const activeNotifyCount = this.options.getActiveNotifyCount?.(activeSession.sessionId, taskId) ?? 0
		// ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01:
		// Per-job wake-authority consult on each notify-owned
		// jobId launched by THIS turn. The same predicate as
		// the C10 barrier admission guard. The barrier re-
		// evaluation MUST also consult this so a held completion
		// does not fire when the wake-driven turn is the canonical
		// authority.
		const launchedBackgroundJobIds = this.options.messageTranslatorState.getLaunchedBackgroundJobIds()
		let perJobOutstandingNotifyWork = false
		let perJobSuppressOriginatingCompletion = false
		if (launchedBackgroundJobIds.length > 0) {
			for (const jid of launchedBackgroundJobIds) {
				if (this.options.hasActiveNotify?.(jid)) {
					// Case 1: marker alive.
					perJobOutstandingNotifyWork = true
				} else if (
					this.options.wasWakeDispatchRequested?.(jid) === true &&
					this.options.wasWakeDelivered?.(jid) !== true &&
					this.options.wasWakeDispatchFailed?.(jid) !== true
				) {
					// CORRECTION03: dispatch REQUESTED, ack pending.
					perJobOutstandingNotifyWork = true
				} else if (this.options.wasWakeDelivered?.(jid)) {
					// Case 3: wake-driven turn owns completion.
					perJobSuppressOriginatingCompletion = true
				}
				// Case 4 (wasWakeDispatchFailed): ALLOW. Wake lost.
				// Case 5 (isWakeAuthoritySettled via discard): ALLOW.
			}
		}
		const outstandingAutonomousWork =
			pendingPromptAuthorityUnknown || pendingPromptsKnown > 0 || activeNotifyCount > 0 || perJobOutstandingNotifyWork
		// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01: extend the
		// barrier predicate to include the running task-owned
		// background-job aggregate (the CommandJobManager primitive
		// `hasRunningBackgroundJobForOwner(activeSession.sessionId)`).
		// This closes the live
		// HALT_BACKGROUND_TERMINAL_REENTERS_COMPLETED_TASK defect:
		// the predecessor TQCB01 barrier only consulted notify=true
		// markers, so notify=false (fire-and-forget) jobs did not
		// block completion and 4 such jobs each produced a
		// wake-driven submit_and_exit.
		const ownerStillRunning = this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// U6 discriminator. Capture the predicate once (§11
		// invariant — no provider is invoked twice), record the
		// fact, then the production check uses the same const.
		if (ownerStillRunning) {
			recordOwnerStillRunning()
			return
		}
		// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
		// extend the barrier predicate to include the second
		// conjunct of the BCB01 §0.1 frozen invariant:
		// `unconsumed_owned_terminal_results == 0`. This catches
		// the case where a task-owned job has REACHED terminal
		// state but the agent has not yet observed the terminal
		// fact (notify=true wake in flight / held; notify=false
		// observation registered but not consumed). Without this
		// check, completion would commit against a held terminal
		// identity, silently truncating the conversation's
		// information content. Wired to
		// `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner`
		// by SdkController.
		const unconsumedOwnedTerminalResultCount =
			this.options.getUnconsumedOwnedTerminalResultCount?.(activeSession.sessionId) ?? 0
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// U7 discriminator. The provider is invoked exactly once
		// (§11 invariant — capture to local const, then use the
		// const for BOTH the record and the production check).
		// `unconsumedTerminalCountLast` is captured for every
		// reevaluation so the operator can correlate the LIVE
		// `terminal_committed=3` chronology against the
		// upstream-visible count without exposing raw job IDs.
		recordUnconsumedTerminalCountRead({
			count: unconsumedOwnedTerminalResultCount,
			positive: unconsumedOwnedTerminalResultCount > 0,
		})
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-UNRESOLVABLE-TERMINAL-OUTCOME01-CORRECTION01:
		// The LIVE specimen (session 1791413688644_o729w) proved the
		// BCB01 §0.1 second conjunct has a count/list divergence:
		// `unconsumedTerminalCountPositive=0` BUT
		// `heldJobIdsCountLast=7`. The conservation chain consulted
		// only the COUNT provider; with count=0 it falsely cleared
		// the barrier and committed completion while 7 IDs were
		// still held in the IDs listing.
		//
		// Bounded repair (one line): also consult the IDs list. The
		// barrier holds whenever EITHER the count OR the list reports
		// a non-empty obligation. The IDs-list provider
		// `getUnconsumedOwnedTerminalJobIds` is wired by
		// `SdkController` to
		// `BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner`
		// — the same upstream source as the count provider. The
		// captured local const is reused for BOTH the record*() call
		// AND the production check (§11 invariant — provider invoked
		// exactly once per reevaluation).
		const unconsumedOwnedTerminalJobIds =
			this.options.getUnconsumedOwnedTerminalJobIds?.(activeSession.sessionId, taskId) ?? []
		const heldObligation = unconsumedOwnedTerminalResultCount > 0 || unconsumedOwnedTerminalJobIds.length > 0
		// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION04:
		// Trigger the bounded coalesced continuation at the terminal-
		// idle / Q5 re-evaluation transition (not just at the
		// initial-done path that the CORRECTION03 trigger fired at).
		// This closes the live chronology described in
		// HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION: the model
		// called `submit_and_exit` while a notify=false job was
		// still RUNNING (so `unconsumedOwnedTerminalResultsForC10 ===
		// 0` at submit time and the CORRECTION03 trigger did NOT
		// fire), then the job became terminal and
		// `reevaluateDeferredCompletionBarrier` was driven by the
		// terminal-idle event. With this fix, that terminal-idle
		// re-evaluation fires the coalesced continuation once
		// (deduped by `(sessionId, taskId, epoch)`), giving the
		// model a bounded opportunity to call `command_status` for
		// each held jobId and re-issue `submit_and_exit`.
		//
		// The trigger is fire-and-forget (`void ...`) so the
		// re-evaluation function never blocks on the host's
		// ack. Once the continuation is delivered, the next turn
		// drains the prompt via PendingPromptsController, observes
		// the held terminal facts via Path B / Path C, and the
		// BCB01 second conjunct resolves to 0 — at which point
		// the held completion commits exactly once via the
		// existing setTurnPhase("completed", ...) path below.
		if (heldObligation) {
			// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
			// U8 discriminator. The actual `enqueueIfHeldEntered`
			// counter is incremented INSIDE
			// `enqueueCompletionContinuationIfHeld` (so it counts
			// every entry — including direct callers — not just
			// this reevaluation-driven one). The
			// `recordEnqueueCompletionContinuationInvoked` (U11)
			// counter is incremented INSIDE that method too,
			// right before the actual options callback is invoked.
			// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03:
			// Bounded finalization-authority trigger. Fire AT MOST
			// ONCE per `(sessionId, epoch)`. The dedupe key uses
			// the marker's epoch (the same epoch the barrier
			// was registered under) so the continuation is bound
			// to the just-held submit_and_exit's epoch.
			//
			// ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01:
			// capture sessionId/taskId at fire time so the
			// `.then` mapping can validate the resolution is
			// still current (C4 adversarial guard against a
			// task replacement between fire and resolution).
			//
			// ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01-CORRECTION01-CONSUMER-AND-EPOCH:
			// ALSO capture the enqueue's epoch. The BCB block
			// registered the marker with the same epoch that
			// the enqueue was fired on (the marker is set on
			// the prior line, the enqueue is fired immediately
			// after — both reads of `getMinter().epoch` happen
			// within the same synchronous call frame, so they
			// see the SAME epoch value). The captured
			// `enqueueEpoch` is the obligation's identity; the
			// helper refuses to stamp a marker whose epoch
			// differs (a stale K resolving after the BCB has
			// advanced to K+1 must NOT stamp K+1's marker).
			const capturedSessionId = activeSession.sessionId
			const capturedTaskId = taskId
			const capturedEnqueueEpoch = this.options.messageTranslatorState.getMinter().epoch
			void this.enqueueCompletionContinuationIfHeld(capturedSessionId, unconsumedOwnedTerminalResultCount, capturedTaskId)
				.then((outcome) => {
					if (outcome.kind === "delivered") {
						Logger.warn(
							`[SdkController] completion continuation turn enqueued from terminal-idle re-evaluation for session=${capturedSessionId} heldJobIds=${outcome.heldJobIds.length} (epoch=${outcome.continuationSessionEpoch})`,
						)
					} else if (outcome.kind === "no_held_job_ids") {
						Logger.warn(
							`[SdkController] completion continuation suppressed at terminal-idle re-evaluation for session=${capturedSessionId}: count>0 but getUnconsumedOwnedTerminalJobIds returned 0 (count-based fallback)`,
						)
					}
					// Publish a typed host-owned reason for the
					// blocked outcomes (C5/C6/C7). The mapping
					// is no-op for `delivered`, `not_held`,
					// `no_held_job_ids`, `already_sent`,
					// `session_gone`, `no_callback` — none of
					// these is a "blocked" verdict.
					//
					// CORRECTION01: the helper now receives
					// the captured enqueue epoch and binds the
					// publication to a marker of the same epoch
					// (no fabrication, no cross-epoch stamp).
					this.applyBlockedCompletionContinuationOutcome(
						{ sessionId: capturedSessionId, taskId: capturedTaskId, enqueueEpoch: capturedEnqueueEpoch },
						outcome,
					)
				})
				.catch((error) => {
					Logger.warn(
						`[SdkController] completion continuation enqueue at terminal-idle re-evaluation failed for session=${capturedSessionId}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				})
			return
		}
		if (outstandingAutonomousWork) {
			// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
			// U5 discriminator. Recorded AFTER the predicate
			// (the existing `outstandingAutonomousWork` const
			// already captured at line 833) so the production
			// check and the record*() share the SAME fact (§11
			// invariant).
			recordOutstandingAutonomousWork()
			return
		}
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// U7 discriminator — the negotiated condition was that
		// the unconsumed terminal count was zero AND the
		// reevaluation fell through past the count>0 branch.
		// Record `no_unconsumed_terminal` so a LIVE with
		// `unconsumedTerminalCountPositive=0` AND
		// `lastStopReason=no_unconsumed_terminal` pinpoints
		// HALT_TERMINAL_ACCOUNTING_DIVERGENCE.
		recordNoUnconsumedTerminal()
		// ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01:
		// If the wake-driven turn owns terminal completion for any
		// notify-owned jobId launched by this turn, the originating
		// turn's completion commit is SUPPRESSED — the deferred
		// marker is held forever (the wake-driven turn will commit
		// its own `completed` phase transition when it runs). The
		// epoch supersession check above will eventually clear the
		// deferred marker when the wake-driven turn ends.
		if (perJobSuppressOriginatingCompletion) {
			Logger.warn(
				`[SdkController] outstanding obligations resolved for session ${activeSession.sessionId} but wake-driven turn owns terminal completion; suppressing originating completion commit (BNCA barrier)`,
			)
			return
		}

		// All four conservation checks pass: commit the held
		// completion transition exactly once.
		Logger.warn(
			`[SdkController] outstanding obligations resolved; releasing held completion for session ${activeSession.sessionId} (epoch=${marker.epoch})`,
		)
		this.deferredCompletionBarrier = undefined
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// lastStopReason="authority_check_reached" marks that
		// the reevaluation reached the Elm authority consult.
		// This is the deepest upstream U-class discriminator — it
		// is the LAST positive note before the EDT check. A LIVE
		// with `authority_check_reached` means the BCB01
		// conservation checks all passed for the active
		// session/task/epoch.
		recordAuthorityCheckReached()
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01: Elm is the
		// FINAL gate. When the option is the legacy default
		// (`kind: "authorize"`), the helper returns true and the
		// existing TS effect runs unchanged. When the production
		// helper arms Elm-authority mode, Elm's decision owns this
		// commit.
		if (!(await this.checkElmCompletionAuthority("session-event-turn-complete-completed"))) {
			// ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01:
			// Elm authority HOLD or FAILURE in the re-evaluation
			// path. The marker was just cleared above by the
			// "All four conservation checks pass" branch — but the
			// Elm authority must STILL authorize before commit. If
			// Elm returns HOLD here (e.g. another `agent_turn_done`
			// race), re-register the marker so the next causal
			// trigger (e.g. the upcoming `agent_turn_done`) will
			// re-evaluate. Reuses the existing marker shape so the
			// existing reevaluation path covers Elm holds too.
			this.deferredCompletionBarrier = {
				sessionId: activeSession.sessionId,
				taskId: this.options.getTask?.()?.taskId,
				epoch: this.options.messageTranslatorState.getMinter().epoch,
				deferredAt: Date.now(),
			}
			return
		}
		this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")
		// ACT-CLINEMM-COMPLETION-AUTHORITY-EFFECT-DISCRIMINATOR01:
		// mirror the Site-B C10 capture (line ~1872) so the deferred
		// reevaluation path emits the factual `task_completion_committed`
		// CCARD record. The previous ACT moved this record AFTER
		// Elm authority gate AND setTurnPhase("completed", ...) so a
		// missing `task_completion_committed` proves the successful
		// effect seam was not fully traversed — exactly the LIVE
		// specimen (`run_qpi4eTiw`, session `1791222861936_ay61p`)
		// symptom, where the deferred reevaluation reached
		// authority_check_reached + AUTHORIZE, setTurnPhase fired,
		// but no `task_completion_committed` record was captured.
		// Origin="deferred_continuation" matches the deferred-barrier
		// reevaluation path; Site B uses origin="pending_prompt_drain"
		// because that path runs synchronously inside the C10
		// completion handler. The marker is already cleared above at
		// `this.deferredCompletionBarrier = undefined`, so this
		// capture is the unique C10 record for this turn.
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "deferred_continuation",
			sessionId: activeSession.sessionId,
			taskId: this.options.getTask?.()?.taskId,
			// ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §21-H:
			// mint a coordinator-local completionId for this C10 event.
			// Monotonic, per-coordinator-instance. One C10 -> one completionId.
			completionId: `completion-${activeSession.sessionId}-${++this.nextCompletionCommitEventId}`,
		})
		// ACT-CLINEMM-ELMIZE-P0-TASK-HEADER-TERMINAL-CONVERGENCE01:
		// publication is the consistency boundary (ACT §C7). The
		// deferred-barrier reevaluation path commits `completed` here
		// AFTER the main `done` handler's C10 was deferred (Elm HOLD
		// or a conservation predicate held). The main path fires a
		// `postStateToWebview()` from the bottom of `handleSessionEvent`
		// (line ~2186-2194), but THIS path is invoked from
		// `notifyAgentTurnDone` (the runtime's `agent_turn_done`
		// capture), which has no publication gate. Without this
		// `postStateToWebview()` the webview keeps the stale
		// pre-terminal `turnState` snapshot and the TaskHeader stays
		// on "Working" even though the runtime reached the terminal
		// phase. The fire-and-forget pattern matches the Site-B
		// publication gate (errors are logged, not propagated).
		this.options.postStateToWebview?.().catch((err) => {
			Logger.error("[SdkController] Failed to post state after deferred C10 commit:", err)
		})
	}

	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01:
	 *
	 * Post-run authority re-evaluation trigger. Production invokes
	 * this after `LocalRuntimeHost.runTurn` resolves with the factual
	 * `agent_turn_done` capture (the C8 seam at
	 * sdk/packages/core/src/runtime/host/local-runtime-host.ts:1320).
	 *
	 * Ordering (P0, ACT §8):
	 *   1. `flushElmAuthorityForSession(sessionId)` — drains the
	 *      per-session queue so Elm processes the `agent_turn_done`
	 *      record and clears `activeRun`. This MUST happen before the
	 *      authority consult or the second decision would read stale
	 *      HOLD state. The flush is a no-op when Elm authority is OFF.
	 *   2. `reevaluateDeferredCompletionBarrier()` — re-runs the full
	 *      TS conservation predicate chain. If all predicates clear
	 *      AND a deferred-completion-barrier marker is present, the
	 *      re-evaluation consults Elm again. If Elm now AUTHORIZEs
	 *      (because `activeRun` was just cleared by step 1), commit
	 *      fires exactly once.
	 *
	 * This is the load-bearing post-run liveness seam the LIVE RED
	 * identified was missing. No timing: the call is driven by the
	 * factual `agent_turn_done` event, not by polling.
	 *
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
	 * The legacy "OFF mode is a no-op" early-return guard is REMOVED.
	 * There is no OFF mode. The trigger always fires; the consult
	 * site (`checkElmCompletionAuthority`) fail-closes on kernel
	 * miss / decode error.
	 */
	async notifyAgentTurnDone(sessionId: string): Promise<void> {
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// U0/U1 discriminator. Record the notification was seen
		// (every call reaches this method), then the inner
		// body entered (U0). The reevaluateEntered counter (U1)
		// is incremented at the entry of the reevaluation itself.
		recordAgentTurnDoneNotificationSeen()
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
		// The legacy P1 guard `if (!isElmAuthorityEnabled()) return`
		// is REMOVED. There is no OFF mode. The Elm authority is the
		// sole completion authority; the trigger always fires; the
		// consult site (`checkElmCompletionAuthority`) fail-closes on
		// kernel miss / decode error. The U0 discriminator below still
		// records "entered" for the LIVE-UPSTREAM-CALLBACK diagnostic.
		recordNotifyAgentTurnDoneEntered()
		try {
			await this.options.flushElmAuthorityForSession?.(sessionId)
		} catch (err) {
			Logger.warn(
				`[SdkController] Elm completion-authority flush threw in notifyAgentTurnDone for session=${sessionId}; proceeding to reevaluate anyway (no silent TS fallback): ${
					err instanceof Error ? err.message : String(err)
				}`,
			)
		}
		await this.reevaluateDeferredCompletionBarrier()
	}

	/**
	 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03:
	 *
	 * Bounded finalization-authority trigger. Fires the
	 * `options.enqueueCompletionContinuation` callback AT MOST
	 * ONCE per `(sessionId, epoch)` pair when ALL of the
	 * following hold:
	 *
	 *   1. The BCB01 §0.1 deferred-completion-barrier marker is
	 *      registered (the runtime's `submit_and_exit` is HELD).
	 *   2. The trigger cause is the BCB01 §0.1 second conjunct
	 *      (`unconsumedOwnedTerminalResultsForC10 > 0`). Running
	 *      jobs alone (without terminal observations) is NOT
	 *      sufficient — terminal-idle will eventually release the
	 *      barrier when the last job reaches terminal.
	 *   3. The held-observer accessor (or the count fallback)
	 *      reports at least one jobId to include in the prompt.
	 *   4. No continuation has been enqueued for the current
	 *      `(sessionId, epoch)` yet (the dedupe set).
	 *
	 * Idempotency: the dedupe set is keyed by
	 * `${sessionId}|${taskId ?? "(none)"}|${epoch}`. A new epoch
	 * produces a new key, so successive held-completion cycles
	 * (e.g. the model observes some held jobIds, the barrier
	 * re-holds on a new batch, etc.) each get exactly one
	 * continuation. The earlier marker cleanup on epoch
	 * supersession (the fresh-key semantic) guarantees the
	 * dedupe set never explodes unbounded.
	 *
	 * The method returns the enqueue outcome (`delivered`,
	 * `rejected`, `session_gone`, `no_held_job_ids`, `not_held`,
	 * `already_sent`, `no_callback`) so callers / tests can
	 * verify behavior without consulting the dedupe set.
	 *
	 * ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C7):
	 * the method is `async` because the held-set progress
	 * classification is now made by the existing Continuation
	 * Control Elm kernel. The kernel is a `Platform.worker`
	 * (asynchronous); the host awaits the directive before
	 * deciding the outcome. The `enqueueIfHeldEntered` counter
	 * is recorded at the FIRST line of the method, BEFORE the
	 * `await` — so a synchronous re-entry cannot double-fire.
	 */
	async enqueueCompletionContinuationIfHeld(
		activeSessionId: string,
		unconsumedOwnedTerminalResultsForC10: number,
		taskId: string | undefined,
	): Promise<
		| {
				kind: "delivered"
				heldJobIds: readonly string[]
				continuationSessionEpoch: string
		  }
		| { kind: "rejected"; heldJobIds: readonly string[]; continuationSessionEpoch: string }
		| { kind: "session_gone" }
		| { kind: "no_held_job_ids"; heldJobIds: readonly string[] }
		| { kind: "not_held" }
		| { kind: "already_sent"; continuationSessionEpoch: string }
		| { kind: "no_callback" }
		/**
		 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY:
		 * Production scheduler discriminated a same-state continuation
		 * against the prior enqueue (model produced no progress). The
		 * enqueue is suppressed with this bounded outcome. The task
		 * remains UNRESOLVED — the runtime may still commit completion
		 * if the model progresses on a different turn, but the
		 * continuation prompt will not be re-enqueued with identical
		 * state.
		 */
		| { kind: "stalled_no_progress" }
		/**
		 * ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION01-SAFETY-AND-CLASSIFIER (P0 #1):
		 * Every other `fail_closed` Elm directive (malformed facts,
		 * observation unavailable, retry unavailable, session/task
		 * mismatch, already committed) is terminal at the production
		 * caller. The kind is `fail_closed` with a typed
		 * `failureReason` so the downstream
		 * `applyBlockedCompletionContinuationOutcome` mapping can
		 * surface it via the existing Logger.warn path. The dedupe
		 * slot is NEVER marked — a fail-closed decision must not
		 * become an allowed effect through fallthrough.
		 */
		| { kind: "fail_closed"; failureReason: import("./completion-continuation-control-elm").FailureReasonTag }
		/**
		 * ACT-CLINEMM-ELM-SEAM08.3-E3.1-CORRECTION01-STALE-REQUEST-CONSERVATION (P0):
		 * The E3.1 Elm consult returned a directive for the facts
		 * it was given, but the live marker / owner / epoch has
		 * since advanced. The original request is now OBSOLETE
		 * — applying the directive to the new owner would be an
		 * effect against state the consult did not see. This
		 * outcome is TERMINAL: no enqueue, no marker mutation,
		 * no dedupe slot mutation, no completion commit. The TS
		 * predecessor is NOT permitted to run. A failed Elm
		 * consult can use the TS predecessor (the kernel made
		 * no decision); an obsolete request cannot (the
		 * directive was for a snapshot that no longer
		 * represents the live owner).
		 */
		| { kind: "request_superseded" }
	> {
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// U8 discriminator. Every entry increments
		// `enqueueIfHeldEntered`. U9..U11 instrumentation below
		// captures each short-circuit branch with the same
		// §11 invariant (local const + record-after).
		recordEnqueueIfHeldEntered()
		if (!this.options.enqueueCompletionContinuation) {
			return Promise.resolve({ kind: "no_callback" })
		}
		if (unconsumedOwnedTerminalResultsForC10 <= 0) {
			return Promise.resolve({ kind: "not_held" })
		}
		// Only fire when the deferred-completion-barrier marker is
		// the active hold (not running-job-only holds or queued-
		// prompt-only holds).
		if (!this.deferredCompletionBarrier) {
			return Promise.resolve({ kind: "not_held" })
		}
		const epoch = this.options.messageTranslatorState.getMinter().epoch
		const continuationSessionEpoch = `${activeSessionId}|${taskId ?? "(none)"}|${epoch}`
		const heldJobIds = this.options.getUnconsumedOwnedTerminalJobIds?.(activeSessionId, taskId) ?? []
		const nextSortedHeld = heldJobIds.slice().sort()
		const nextFingerprint = `${activeSessionId}|${taskId ?? "(none)"}|${nextSortedHeld.join(",")}`
		const priorSortedHeld = this.lastCompletionContinuationHeldSetSorted

		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY:
		//
		// PRODUCTION stall check BEFORE the epoch dedupe. The
		// stall fingerprint is a tighter signal than epoch
		// dedupe: same (sessionId, taskId, count, heldJobIds)
		// means the model produced no progress even across an
		// epoch. The epoch dedupe suppresses legitimately
		// distinct continuations (different heldJobIds after a
		// terminal commit); the stall fingerprint is
		// progress-aware and pins the pathological no-progress
		// case. The predecessor helper detected this case but
		// did not feed it into production (C15/C17 halt).
		//
		// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C6 / C7):
		// The held-set progress classification is a property of
		// the existing Continuation Control Elm kernel. The
		// kernel's `Policy.classifyHeldSetProgress` derives the
		// closed `HeldSetProgress` sum from the two immutable
		// sorted snapshots the host passes in:
		//   - `priorHeldSetSorted` — the canonical snapshot at
		//     the LAST successful enqueue (this field's lifetime
		//     stays in TS; Elm only reads it as an immutable
		//     fact).
		//   - `currentHeldSetSorted` — the live projection (this
		//     call's `heldJobIds`, sorted ascending inline).
		// The kernel's P2 guard maps BOTH `NoProgress` and
		// `PassiveAccumulation` to `FailClosed StalledNoProgress`,
		// preserving the live STALLED-REARM-LOOP01 invariant.
		// `ContractionOrMembershipShift` and `Indeterminate` (no
		// prior snapshot) release the directive.
		//
		// C7 ablation 4 — legacy TS authority removed: the
		// inlined `isStrictSupersetOf` check that used to live
		// here is GONE. The Elm kernel's `failureReason` is the
		// SOLE semantic authority.
		//
		// ACT-CLINEMM-P0-COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01:
		// The capability projection must be TRUTHFUL — it is derived
		// from the live resumed-turn tool registry via
		// `this.options.liveTools?.()`. The previous implementation
		// hardcoded `canObserveHeldResults: true, canRetryCompletion:
		// true` which bypassed the bounded correlation guard the
		// BCB re-registration site (line 2704-2734) provides — the
		// reeval path could enqueue a continuation that the model
		// could not observe, repeating the original LIVE defect.
		// The fix projects truthful capability the same way the BCB
		// block does (the closed-scheme `liveToolNames` lookup at
		// line 2707). `liveTools === undefined` is treated as
		// `false` (honest "I don't know") so the Elm kernel can
		// fail-closed via the existing `observation_unavailable`
		// directive.
		const liveToolNames = this.options.liveTools?.() ?? undefined
		const canObserveHeldResults = liveToolNames !== undefined ? liveToolNames.includes("command_status") : false
		const canRetryCompletion = liveToolNames !== undefined ? liveToolNames.includes("submit_and_exit") : false
		const directive = await pickContinuationDirectiveForPublication({
			unconsumedCount: heldJobIds.length,
			capabilities: {
				canObserveHeldResults,
				canRetryCompletion,
			},
			priorHeldSetSorted: priorSortedHeld,
			currentHeldSetSorted: nextSortedHeld,
			sessionMatches: true,
			taskMatches: true,
			alreadyCommitted: false,
		})
		if (directive.tag === "fail_closed") {
			// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION01-SAFETY-AND-CLASSIFIER (P0 #1):
			// EVERY `fail_closed` directive is terminal at the
			// production caller. The Elm kernel is the SOLE
			// semantic authority for the no-progress blocking
			// decision AND for every other fail-closed reason
			// (malformed facts, observation unavailable, retry
			// unavailable, session/task mismatch, already
			// committed). A fail-closed decision must not become
			// an allowed effect through fallthrough. The dedupe
			// slot is NEVER marked (a stall must not poison the
			// next genuine epoch's continuation; a malformed
			// input must not be retried until the host fixes it;
			// an identity mismatch means the obligation is for
			// a different session/task and should not be re-fired
			// against this coordinator instance).
			//
			// The mapping from `failureReason` to the typed
			// production outcome is exact:
			//
			//   stalled_no_progress     -> stalled_no_progress
			//   malformed_facts         -> fail_closed (generic)
			//   observation_unavailable -> fail_closed
			//   retry_unavailable       -> fail_closed
			//   session_mismatch        -> fail_closed (a NEW
			//                               obligation is the
			//                               correct next step)
			//   task_mismatch           -> fail_closed
			//   already_committed       -> fail_closed
			//
			// Only `stalled_no_progress` maps to its own typed
			// outcome kind (the U-class discriminator surface
			// records the same `stalledNoProgress` counter as
			// before). The other reasons are surfaced as
			// `fail_closed` with the reason; the
			// `applyBlockedCompletionContinuationOutcome` mapping
			// already handles `stalled_no_progress` and
			// `delivery_rejected`; the remaining reasons are
			// host-owned diagnostics that flow through
			// `Logger.warn` only (no incident publication —
			// they are local classification outcomes, not
			// runtime errors).
			if (directive.failureReason === "stalled_no_progress") {
				recordStalledNoProgress()
				return Promise.resolve({ kind: "stalled_no_progress" as const })
			}
			// Every other fail-closed reason: terminal with
			// the typed reason. The downstream
			// `applyBlockedCompletionContinuationOutcome`
			// mapping sees a `fail_closed` kind and surfaces
			// it via the existing Logger.warn path (these
			// reasons are not in the closed-enum set
			// `{ "stalled_no_progress", "delivery_rejected" }`
			// that MAPPING01-CORRECTION01 instruments).
			return Promise.resolve({
				kind: "fail_closed" as const,
				failureReason: directive.failureReason,
			})
		}
		if (priorSortedHeld !== undefined) {
			// Real progress: the kernel saw a transition that
			// is NOT `NoProgress` / `PassiveAccumulation` /
			// `Indeterminate` (the closed `Indeterminate` case
			// is the first-call semantic and does not reach
			// this branch because `priorHeldSetSorted !==
			// undefined`). This means the model actually
			// consumed something (the held set contracted) or
			// the membership shifted. Release the epoch dedupe
			// so a fresh continuation can proceed even within
			// the same epoch. The first call (no prior held
			// set) is left alone — the dedupe ownership from
			// any prior successful enqueue must still hold.
			//
			// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED:
			// this branch is reached ONLY for non-fail-closed
			// directives (the `fail_closed` branch above returns
			// early at line 1581-1584). After the CORRECTION02
			// fix, a malformed snapshot (including a mis-sorted
			// one) fails closed at P0 of `Policy.decide` via
			// `Domain.factsIsExpected`, so the comment from
			// CORRECTION01 that claimed `MalformedFacts` is
			// "not stalled" and should release the REARM is no
			// longer reachable — the previous fall-through path
			// (malformed → classifier `Indeterminate` → fall
			// through to `ObserveThenRetry` with observation
			// capability → `delivered`) is closed. A malformed
			// snapshot now produces `kind: "fail_closed"` with
			// `failureReason: "malformed_facts"` and the dedupe
			// slot is preserved.
			this.lastCompletionContinuationSessionEpoch = undefined
		}
		// ACT-CLINEMM-ELM-SEAM08.2-E3.1-PRODUCTION-CUTOVER:
		// the bounded E3.1 transition (the dedupe-vs-permit
		// decision) is now owned by the new deferred-completion-
		// barrier Elm kernel. The host consults the kernel
		// AFTER the held-set-progress consult and BEFORE the
		// TS-owned dedupe branches. The Elm consult is a pure
		// projection; the host retains all effect ownership.
		// The Elm outcome routes to the existing TS branches:
		//
		//   PermitEnqueue  { mustClearRearm=true }  -> clear REARM, fall through to dedupe check
		//   PermitEnqueue  { mustClearRearm=false } -> fall through to dedupe check
		//   SuppressDuplicate                       -> emit already_sent (L1665 equivalent)
		//   PreserveBarrier                          -> emit no_held_job_ids (L1678 equivalent)
		//   RejectStaleIdentity                     -> request_superseded (CORRECTION01)
		//   (kernel_offline / decode_error / no_decision / no_response)
		//                                           -> fall through to ElmUnavailable_UsePredecessor
		//   directive + live state drift            -> request_superseded (CORRECTION01)
		//
		// C5 stale-decision guard
		// (ACT-CLINEMM-ELM-SEAM08.3-CORRECTION01-STALE-FALLBACK-ON-DRIFT):
		// the host revalidates the live identity (sessionId,
		// taskId, epoch, marker present) AFTER the consult
		// completes. The live-state check is the OUTER
		// guard. When the live state has drifted, the
		// request is `request_superseded` REGARDLESS of the
		// consult's directive kind (TERMINAL: no enqueue,
		// no marker mutation, no dedupe mutation, no
		// completion commit). The TS predecessor is NOT
		// permitted to run for an obsolete request, whether
		// the kernel returned a directive, a kernel
		// failure (kernel_offline), a decode error, or a
		// timeout (decode_error from the public-boundary
		// timer). Only when the live state is STILL VALID
		// and the consult was non-directive does the host
		// fall through to the TS predecessor — the original
		// request is still valid because the kernel never
		// made a directive.
		{
			const e31Outcome = await this.consultE31BarrierForFacts({
				sessionId: activeSessionId,
				taskId,
				markerSessionId: this.deferredCompletionBarrier?.sessionId ?? "",
				markerTaskId: this.deferredCompletionBarrier?.taskId,
				markerEpoch: this.deferredCompletionBarrier?.epoch ?? -1,
				currentEpoch: epoch,
				continuationSessionEpoch,
				lastContinuationSessionEpoch: this.lastCompletionContinuationSessionEpoch,
				currentHeldSetSorted: nextSortedHeld,
				priorHeldSetSorted: this.lastCompletionContinuationHeldSetSorted,
				heldJobCount: heldJobIds.length,
				liveMarkerPresent: this.deferredCompletionBarrier !== undefined,
			})
			if (e31Outcome === "fallthrough") {
				// Elm authority unavailable (kernel offline /
				// decode error / no_response). The original
				// request is still valid because the kernel
				// never made a decision. The TS path
				// continues to run. No effect on the dedupe
				// slot or the marker.
			} else if (e31Outcome === "request_superseded") {
				// Elm consult was directive for the OLD
				// owner / task / epoch / marker-absent
				// state. The live state has drifted since
				// the consult was started. The original
				// request is now OBSOLETE. TERMINAL: no
				// enqueue, no marker mutation, no dedupe
				// slot mutation, no completion commit. The
				// TS predecessor is NOT permitted to run
				// (applying a directive computed for the
				// OLD owner to the NEW owner would be an
				// effect against state the consult did not
				// see).
				Logger.warn(
					`[SdkController] E3.1 deferred-completion-barrier request superseded (live state drifted after consult); terminating without enqueue for session=${activeSessionId}`,
				)
				return Promise.resolve({ kind: "request_superseded" })
			} else if (e31Outcome === "clear_rearm") {
				// Real progress signal from the Elm consult;
				// release the REARM dedupe. (Equivalent to the
				// TS L1633 branch.)
				this.lastCompletionContinuationSessionEpoch = undefined
			} else if (e31Outcome === "already_sent") {
				// Elm consult says: a prior successful
				// enqueue for THIS exact dedupe key has
				// already happened. Suppress.
				recordDedupeSuppressed()
				return Promise.resolve({ kind: "already_sent", continuationSessionEpoch })
			} else if (e31Outcome === "no_held_job_ids") {
				// Elm consult says: the held set is empty at
				// the consult point (race between the
				// heldJobIds read and the consult). Suppress.
				recordNoHeldJobIds()
				return Promise.resolve({ kind: "no_held_job_ids", heldJobIds })
			}
			// else "permit" -> fall through to the existing
			// dedupe check below. The Elm consult's
			// `mustClearRearm` was already applied above
			// (or not), so the L1633 branch is now controlled
			// by the Elm consult.
		}
		if (this.lastCompletionContinuationSessionEpoch === continuationSessionEpoch) {
			// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
			// U10 discriminator. The dedupe suppresses.
			recordDedupeSuppressed()
			return Promise.resolve({ kind: "already_sent", continuationSessionEpoch })
		}
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// U9 discriminator. Capture provider cardinality (count
		// only, no IDs — §6 identity policy) so the operator can
		// correlate the LIVE terminal_committed=N chronology
		// against the upstream-visible held-job count without
		// exposing raw jobIds.
		recordHeldJobIdsRead({ ids: heldJobIds })
		if (heldJobIds.length === 0) {
			// The count-based fallback path can produce a 0-length
			// list. In that case we suppress the continuation:
			// the runtime will eventually reach a steady state
			// (terminal-idle + reevaluateDeferredCompletionBarrier).
			recordNoHeldJobIds()
			return Promise.resolve({ kind: "no_held_job_ids", heldJobIds })
		}
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
		// U10 discriminator — dedupe permits. U11 discriminator
		// — invoke recorded RIGHT BEFORE the options callback
		// is invoked. Together these two record*() calls tell
		// the operator the U-class was honored at every layer.
		recordDedupePermitted()
		// Mark BEFORE await so a synchronous re-entry cannot
		// double-fire. O(1) memory regardless of coordinator
		// lifetime (P1 halt fix: replaces the unbounded Set).
		this.lastCompletionContinuationSessionEpoch = continuationSessionEpoch
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY:
		// Persist the post-success fingerprint for the next stall
		// check. Cleared by `clearCompletionContinuationSentForTesting`
		// for the test backdoor.
		this.lastCompletionContinuationControlFingerprint = nextFingerprint
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01:
		// Persist the canonical sorted held-set so the NEXT stall
		// check can compare set membership (pure-superset → stall)
		// rather than coarse string equality. Cleared alongside
		// the fingerprint in `clearCompletionContinuationSentForTesting`.
		this.lastCompletionContinuationHeldSetSorted = nextSortedHeld
		recordEnqueueCompletionContinuationInvoked()
		return this.options
			.enqueueCompletionContinuation({
				sessionId: activeSessionId,
				taskId,
				heldJobIds,
			})
			.then((outcome) => {
				if (outcome.kind === "delivered") {
					return { kind: "delivered" as const, heldJobIds, continuationSessionEpoch }
				}
				if (outcome.kind === "rejected") {
					return { kind: "rejected" as const, heldJobIds, continuationSessionEpoch }
				}
				if (outcome.kind === "session_gone") {
					return { kind: "session_gone" as const }
				}
				return { kind: "no_held_job_ids" as const, heldJobIds }
			})
	}

	/**
	 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03 /
	 * CORRECTION04:
	 *
	 * test-only backdoor exposing the dedupe marker so the trigger
	 * tests (BCB-26..BCB-30) can verify "exactly once" semantics
	 * without depending on indirect queue-observation side-effects.
	 * Returns true iff the coordinator has already fired the
	 * continuation enqueue for the given `(sessionId, taskId, epoch)`
	 * triple.
	 */
	wasCompletionContinuationSentForTesting(sessionId: string, taskId: string | undefined, epoch: number): boolean {
		const key = `${sessionId}|${taskId ?? "(none)"}|${epoch}`
		return this.lastCompletionContinuationSessionEpoch === key
	}

	/**
	 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION04:
	 * test-only backdoor to clear the dedupe marker (e.g. to
	 * simulate a fresh epoch without rebuilding the full
	 * coordinator).
	 */
	clearCompletionContinuationSentForTesting(): void {
		this.lastCompletionContinuationSessionEpoch = undefined
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY:
		// Clear the stall fingerprint so a fresh test scenario can
		// re-enqueue the same heldJobIds.
		this.lastCompletionContinuationControlFingerprint = undefined
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01:
		// Clear the canonical held-set snapshot so the next stall
		// comparison does not falsely suppress a fresh scenario.
		this.lastCompletionContinuationHeldSetSorted = undefined
	}

	/**
	 * ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01:
	 *
	 * Bounded host-owned publication of a non-delivered enqueue
	 * outcome. Called from the `.then((outcome) => ...)` of BOTH
	 * `enqueueCompletionContinuationIfHeld` call sites
	 * (L1113-1131 reevaluate path; L2148-2167 C10 path).
	 *
	 * Mapping (C7):
	 *   "stalled_no_progress" → "stalled_no_progress"
	 *   "rejected"            → "delivery_rejected"
	 *   (any other kind)      → no-op
	 *
	 * The mapping does NOT consult the Elm kernel for the
	 * verdict (C15 — no policy change, no new kernel). The disc
	 * verdict comes from the upstream TS discriminator
	 * (L1432-1453); the production callback's `rejected` is
	 * the production seam's own observation.
	 *
	 * C4 adversarial guard: the captured `sessionId` / `taskId`
	 * must still match the LIVE active session/task at the time
	 * the enqueue resolves. If a task switch happened between
	 * fire and resolution, the resolution is stale and MUST
	 * NOT publish a blocked reason onto the replacement task's
	 * marker. Validation reads the live `getActiveSession()`
	 * and `getTask()`; no I/O, no provider calls.
	 *
	 * ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01-CORRECTION01-CONSUMER-AND-EPOCH:
	 * Three additional invariants the predecessor failed to
	 * enforce (reviewer's P0 findings):
	 *
	 * 1. NO FABRICATION: an existing matching marker must
	 *    already be present at resolution. A blocked
	 *    publication does NOT create a fresh marker. If the
	 *    marker has been cleared (commit) or never registered
	 *    (the BCB predicate did not fire), the resolution is
	 *    inapplicable and the helper returns without
	 *    mutating state. This binds the publication to the
	 *    BCB-registered blocked surface.
	 *
	 * 2. EPOCH BINDING: the captured `enqueueEpoch` (read
	 *    from `getMinter().epoch` at the call site, before
	 *    the `.then` was scheduled) must equal the marker's
	 *    current epoch. The predecessor's check used
	 *    `currentEpoch = getMinter().epoch` at resolution
	 *    time, which permitted the failure mode:
	 *      K fires at epoch 10
	 *      K+1 advances to epoch 11 (a new messageId was
	 *        minted by some other producer)
	 *      BCB re-registers marker at epoch 11
	 *      K resolves at epoch 11
	 *      currentEpoch === 11, marker.epoch === 11, the
	 *        check `marker.epoch !== currentEpoch` is false,
	 *        the helper stamps
	 *    With CORRECTION01, the helper requires
	 *      marker.epoch === captured.enqueueEpoch
	 *    K's captured.enqueueEpoch is 10; the marker is at
	 *    11; the check fails; the helper refuses. K's stale
	 *    resolution is dropped.
	 *
	 * 3. PRODUCTION CONSUMER: on a successful publication the
	 *    helper increments
	 *    `recordBlockedOutcomeStalledNoProgress` /
	 *    `recordBlockedOutcomeDeliveryRejected` — the
	 *    production dogfood diagnostic counters (already
	 *    registered, already exposed via
	 *    `getCompletionContinuationUpstreamCounters`). The
	 *    typed verdict is now observable in a production
	 *    surface, not just a test-accessor decoration.
	 *
	 * Idempotence (C9): the marker is at-most-one per
	 * coordinator instance, so two stalls → one typed
	 * publication. Genuine progress (the next enqueue returns
	 * `delivered` and the BCB clears the marker) releases the
	 * blocked state without further host intervention.
	 *
	 * C11 invariant: a blocked publication MUST NOT advance
	 * the turn phase to "completed" or commit
	 * `task_completion_committed`. The marker is the
	 * production "blocked" surface; the commit path
	 * (`reevaluateDeferredCompletionBarrier` and
	 * `handleSessionEvent`) is independent and consults its
	 * own Elm authority.
	 */
	private applyBlockedCompletionContinuationOutcome(
		captured: {
			readonly sessionId: string
			readonly taskId: string | undefined
			/**
			 * ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01-CORRECTION01-CONSUMER-AND-EPOCH:
			 * the value of `getMinter().epoch` at the moment the
			 * enqueue was fired. The helper binds the
			 * publication to a marker of the SAME epoch (no
			 * cross-epoch stamp).
			 */
			readonly enqueueEpoch: number
		},
		outcome:
			| { kind: "delivered"; heldJobIds: readonly string[]; continuationSessionEpoch: string }
			| { kind: "rejected"; heldJobIds: readonly string[]; continuationSessionEpoch: string }
			| { kind: "session_gone" }
			| { kind: "no_held_job_ids"; heldJobIds: readonly string[] }
			| { kind: "not_held" }
			| { kind: "already_sent"; continuationSessionEpoch: string }
			| { kind: "no_callback" }
			| { kind: "stalled_no_progress" }
			| {
					kind: "fail_closed"
					failureReason: import("./completion-continuation-control-elm").FailureReasonTag
			  }
			/**
			 * ACT-CLINEMM-ELM-SEAM08.3-E3.1-CORRECTION01-STALE-REQUEST-CONSERVATION (P0):
			 * A `request_superseded` outcome is the E3.1 Elm
			 * consult's terminal verdict when the live marker
			 * has drifted since the consult was started. It is
			 * NOT a "blocked" verdict — there is no model
			 * progress to report, no marker stamp, no
			 * incident publication. The helper is a no-op
			 * (the stale-request conservation invariant is
			 * enforced at the call site; this helper just
			 * accepts the union member so the call site does
			 * not need a separate branch).
			 */
			| { kind: "request_superseded" },
	): void {
		let reason: DeferredCompletionBarrierReason | undefined
		if (outcome.kind === "stalled_no_progress") {
			reason = "stalled_no_progress"
		} else if (outcome.kind === "rejected") {
			reason = "delivery_rejected"
		} else if (outcome.kind === "fail_closed") {
			// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION01-SAFETY-AND-CLASSIFIER (P0 #1):
			// the Elm kernel's non-stall fail-closed reasons
			// (malformed_facts, observation_unavailable,
			// retry_unavailable, session_mismatch,
			// task_mismatch, already_committed) are terminal at
			// the production caller. They are NOT in the
			// closed-enum set `{ "stalled_no_progress",
			// "delivery_rejected" }` that the marker stamps
			// (CORRECTION01 invariant). We log them via
			// `Logger.warn` so the operator can see them in
			// the production dogfood dump, but we do NOT
			// publish an incident, do NOT stamp the marker,
			// and do NOT increment the dogfood counters.
			// The reason is host-owned diagnostic only; the
			// kernel is the SOLE semantic authority for the
			// classification, and the host's role is to
			// surface the verdict in a non-effect-bearing log
			// channel. A repeated verdict (idempotence) is
			// also a no-op (we do not re-log either).
			//
			// ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01:
			// EXCEPTION: `observation_unavailable` is a closed-enum
			// value of `DeferredCompletionBarrierReason` (defined at
			// L610) that the host BOTH stamps on the marker AND
			// publishes as a typed blocked outcome. The reason:
			// the host's CTQC01 bounded correlation guard
			// synthesizes a `fail_closed(observation_unavailable)`
			// outcome at the BCB re-registration site when the
			// model has no observation capability. The host's
			// intent is "the model cannot progress; publish a
			// single typed blocked outcome and stop re-firing".
			// This is a HOST-OWNED detection (the kernel does not
			// see the capability projection at the BCB site), so
			// the incident publication is via the existing
			// `recordRuntimeError` sink with the additive source
			// `completion-continuation-observation-unavailable`.
			// The marker is stamped with `reason:
			// "observation_unavailable"` and the
			// `recordBlockedOutcomeObservationUnavailable` counter
			// increments.
			if (outcome.failureReason === "observation_unavailable") {
				reason = "observation_unavailable"
				// Fall through to the marker stamp + counter + incident
				// publication path (the rest of the function).
			} else {
				Logger.warn(
					`[SdkController] Elm continuation-control fail-closed at writerId=block-publication; reason=${outcome.failureReason}`,
				)
				return
			}
		} else {
			// C2: every other union member is not a "blocked"
			// verdict. No-op preserves the marker (the BCB
			// registration already carries sessionId/taskId
			// without a typed reason) and prevents fabricated
			// blocked outcomes for `delivered`, `not_held`,
			// `no_held_job_ids`, `already_sent`, `session_gone`,
			// `no_callback`, AND `request_superseded`
			// (SEAM08.3-CORRECTION01: the E3.1 Elm consult's
			// terminal verdict for a stale request; not a
			// blocked verdict, no marker stamp, no incident
			// publication).
			return
		}
		// C4 adversarial guard: validate identity at resolution.
		const live = this.options.sessions?.getActiveSession?.()
		const liveTaskId = this.options.getTask?.()?.taskId
		if (!live || live.sessionId !== captured.sessionId) {
			// Session gone or replaced. The post-fire session
			// identity differs from the captured identity. The
			// resolution is stale; do not publish.
			return
		}
		if (liveTaskId !== captured.taskId) {
			// Task replacement. The C4 adversarial case: a T1
			// enqueue resolving after a switch to T2 must NOT
			// stamp a blocked reason onto T2's marker.
			return
		}
		// ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01-CORRECTION01-CONSUMER-AND-EPOCH:
		// NO FABRICATION. The marker is the BCB-registered
		// "blocked" surface; an absent marker means the BCB
		// has not registered a hold for the active session,
		// or the marker has been cleared (commit /
		// epoch-supersession). A blocked publication does
		// NOT create a fresh marker; the resolution is
		// inapplicable without a matching registered
		// obligation. This binds the publication to the BCB
		// surface, preventing spurious "blocked" verdicts
		// from races where the BCB cycle had not yet
		// registered (e.g. a stalled enqueue that fired
		// before the BCB block).
		if (!this.deferredCompletionBarrier) {
			return
		}
		// ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01-CORRECTION01-CONSUMER-AND-EPOCH:
		// EPOCH BINDING. The marker's epoch must equal the
		// captured enqueue epoch. The predecessor's check
		// used `currentEpoch = getMinter().epoch` at
		// resolution time, which allowed a K-then-K+1
		// sequence (K fires at epoch 10, K+1 advances to
		// epoch 11, K resolves at epoch 11) to misattribute
		// K's verdict onto K+1's marker. With
		// `enqueueEpoch` captured at fire time, the helper
		// refuses if the marker's epoch has advanced past
		// the enqueue's epoch.
		if (this.deferredCompletionBarrier.epoch !== captured.enqueueEpoch) {
			return
		}
		// Identity triple must also match (defense in depth —
		// the C4 guards already validated session/task
		// identity against the LIVE active session/task; the
		// marker is for the captured identity because the
		// BCB re-registered it just before firing the
		// enqueue, on the same captured values). If a stale
		// marker somehow survived (e.g. a different
		// sessionId), refuse.
		if (
			this.deferredCompletionBarrier.sessionId !== captured.sessionId ||
			this.deferredCompletionBarrier.taskId !== captured.taskId
		) {
			return
		}
		// ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01 / MAPPING01-CORRECTION01-CARDINALITY:
		// IDEMPOTENCE. The marker is at-most-one per
		// coordinator instance; if it already carries the
		// SAME typed `reason` we're about to publish, the
		// resolution is a duplicate for the SAME obligation
		// (same captured session/task/epoch, same held set
		// discriminant, same outcome verdict). Refuse to
		// re-stamp and refuse to invoke the production
		// lifecycle consumer — exactly ONE incident per
		// obligation. A genuinely distinct eligible
		// obligation (epoch bump + new held set) clears
		// the marker via the BCB re-registration pattern;
		// the next helper invocation for THAT obligation
		// sees an unmarked marker and proceeds normally.
		if (this.deferredCompletionBarrier.reason === reason) {
			return
		}
		// Stamp the marker with the typed reason. The marker
		// identity triple (sessionId, taskId, epoch) is
		// preserved exactly — only the `reason` field is
		// added. Idempotence (C9) is preserved because the
		// marker is at-most-one; subsequent resolutions of
		// the same obligation either confirm the reason
		// (the IDEMPOTENCE check above returns early, no
		// re-stamp, no counter increment) or (if the BCB
		// has cycled) the epoch check refuses.
		this.deferredCompletionBarrier = {
			...this.deferredCompletionBarrier,
			reason,
		}
		// ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01-CORRECTION01-CONSUMER-AND-EPOCH:
		// PRODUCTION CONSUMER. The typed verdict is now
		// observable via the production dogfood diagnostic
		// surface (the same `getCompletionContinuationUpstreamCounters`
		// dump the operator already uses for the U0..U11
		// first-divergence table). The counter increments
		// ONCE per successful publication.
		if (reason === "stalled_no_progress") {
			recordBlockedOutcomeStalledNoProgress()
		} else if (reason === "delivery_rejected") {
			recordBlockedOutcomeDeliveryRejected()
		} else if (reason === "observation_unavailable") {
			// ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01:
			// CTQC01 bounded correlation guard published this verdict
			// at the BCB re-registration site. The counter is the
			// production-readable surface that proves the typed
			// verdict is observable, not just a test-accessor
			// decoration.
			recordBlockedOutcomeObservationUnavailable()
		}
		// ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01 / MAPPING01-CORRECTION01:
		// LIFECYCLE CONSUMER. Reuse the existing
		// `TaskTelemetryTracker.recordRuntimeError(incident)` sink
		// that the production host (SdkController.handleTaskRuntimeError
		// at SdkController.ts:5370) already exposes for the V1 EPERM
		// and `command_containment_failed` incidents. The same
		// cumulative `TaskHeaderTelemetryStrip.runtimeErrorCount`
		// wire field renders the user-visible `⚠ N` glyph; the V1
		// webview ignores the source string, so additive enum
		// extensions are safe.
		//
		// The `taskTelemetry` option is OPTIONAL. When absent the
		// helper returns without invoking any incident sink
		// (mirroring the existing pre-MAPPING01 behavior where the
		// dogfood counter and the marker stamp still fire).
		if (this.options.taskTelemetry) {
			let source: RuntimeErrorSource
			if (reason === "stalled_no_progress") {
				source = "completion-continuation-stalled"
			} else if (reason === "observation_unavailable") {
				// ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01:
				// CTQC01 bounded correlation guard. The additive
				// source `completion-continuation-observation-unavailable`
				// (ExtensionMessage.ts:1155) flows through the same
				// `recordRuntimeError(incident)` sink. The V1
				// webview ignores the source string, so the
				// additive enum extension is safe.
				source = "completion-continuation-observation-unavailable"
			} else {
				source = "completion-continuation-delivery-rejected"
			}
			const incident: RuntimeErrorIncident = {
				errorClass: "UNKNOWN_RUNTIME_ERROR",
				source,
				correlationId: `${captured.sessionId}|${captured.taskId ?? "(none)"}|${captured.enqueueEpoch}`,
			}
			this.options.taskTelemetry.recordRuntimeError(incident)
		}
	}

	/**
	 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
	 * test-only backdoor exposing the deferred-completion-barrier
	 * marker so TQCB01 RED/GREEN tests can verify the marker's
	 * identity triple (sessionId, taskId, epoch) without depending
	 * on indirect observable side-effects.
	 *
	 * ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01: the
	 * returned shape now also carries the optional typed `reason`
	 * field, set by `applyBlockedCompletionContinuationOutcome`
	 * from a non-delivered enqueue outcome. The reason is
	 * `undefined` for markers registered solely by the BCB
	 * predicate (a fresh hold, not a typed blocked verdict).
	 */
	getDeferredCompletionBarrierForTesting():
		| {
				readonly sessionId: string
				readonly taskId: string | undefined
				readonly epoch: number
				readonly reason?: DeferredCompletionBarrierReason
		  }
		| undefined {
		if (!this.deferredCompletionBarrier) return undefined
		return {
			sessionId: this.deferredCompletionBarrier.sessionId,
			taskId: this.deferredCompletionBarrier.taskId,
			epoch: this.deferredCompletionBarrier.epoch,
			reason: this.deferredCompletionBarrier.reason,
		}
	}

	/**
	 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
	 * test-only backdoor to set / clear the deferred-completion-barrier
	 * marker so the UPSTREAM-DIAG-02..05 suites can drive the
	 * production reevaluation path with explicit marker
	 * presence/absence without rebuilding the full coordinator.
	 * Production code NEVER calls this.
	 */
	setDeferredCompletionBarrierForTesting(
		barrier: { readonly sessionId: string; readonly taskId: string | undefined; readonly epoch: number } | undefined,
	): void {
		this.deferredCompletionBarrier = barrier ? { ...barrier, deferredAt: Date.now() } : undefined
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
		// ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01:
		// Enter/leave the depth tracker so the EH1 discriminator can
		// detect synchronous re-entry. Both functions short-circuit
		// when the diagnostic is OFF (the public default).
		enterExtensionHostHotloopHandleSessionEvent()
		recordExtensionHostHotloopSessionEvent(event.type)
		try {
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

			// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01:
			// Presentation arbitration at the message commit seam.
			//
			// When a background command with notifyOnCompletion=true is
			// still alive (active notify marker present for the active
			// session/task), the originating explicit_user turn's
			// attempt_completion is an INTERMEDIATE state — it
			// acknowledges "I've started the command" but does NOT
			// own the terminal command result. The wake_drain turn is
			// the legitimate terminal presentation authority (it has
			// the actual command output).
			//
			// Without this filter, BOTH turns would each push one
			// say:"completion_result" row via appendAndEmit, producing
			// two user-visible completion boxes for ONE logical
			// terminal event (frozen CCARD:
			//   terminal_committed = 1, wake_created = 1,
			//   run_turn_started = 2, agent_turn_done = 2,
			//   C10-commit = 1, visible = 2).
			//
			// The predicate is the SAME `outstandingAutonomousWork`
			// the deferredCompletionBarrier (TQCB01) already uses at
			// line ~553 — the load-bearing identity is "this turn's
			// completion attempt is premature because autonomous work
			// for this (sessionId, taskId) is still pending". When
			// the wake drains the pending prompt and the marker is
			// consumed, `outstandingAutonomousWork` flips to false
			// and the wake_drain turn's completion_result passes
			// through unchanged.
			//
			// Fail-closed authority: when `getPendingPromptCount`
			// returns `{ available: false }` we treat it as
			// authority-unavailable (do not know, hold completion) —
			// same shape as the TQCB01 barrier. This prevents a
			// fail-open defect where a stale/uninitialized queue
			// mirror would otherwise authorize completion with
			// autonomous work still pending remotely (the Q5/PPAT
			// invariant).
			//
			// Only completion_result rows are filtered. Non-completion
			// assistant text rows (say:"text", say:"reasoning", say:"command",
			// say:"tool", etc.) flow through unchanged — the user can
			// still see the agent's intermediate answers / tool results
			// for the originating turn (BCTPA-P7 conservation).
			//
			// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
			// The narrowest acceptable filter is now per-message:
			//
			//   for each completion_result C:
			//     let ownedJobIds = messageTranslatorState.getLaunchedBackgroundJobIds()
			//     let ownedJobId  = ownedJobIds.find(jid => hasActiveNotify(jid))
			//     suppress(C) iff ownedJobId !== undefined
			//
			// This replaces the over-broad
			// `outstandingAutonomousWork = activeNotifyCount > 0 || ...`
			// predicate that over-suppressed unrelated completion K
			// (the predecessor BCTPA-P7b RED). The new filter does NOT
			// suppress when:
			//   (a) the turn launched no background jobs (ownedJobIds
			//       is empty), OR
			//   (b) all owned jobs have already had their markers
			//       consumed (no `hasActiveNotify` for any owned jobId),
			// OR both.
			//
			// This is the desired narrow behavior:
			//   - frozen bug (premature J): ownedJobIds=[J],
			//     hasActiveNotify(J)=true → SUPPRESS ✓
			//   - wake completion for J: ownedJobIds=[] (the wake turn
			//     didn't launch any job) → VISIBLE ✓
			//   - P7b unrelated K: ownedJobIds=[] → VISIBLE ✓
			//   - J1/J2 cross-job: per-job ownership means an unrelated
			//     alive marker (e.g. J2) does NOT suppress J1's
			//     completion (the J1 marker is consumed) → ISOLATED ✓
			//
			// Fallback: when `hasActiveNotify` is NOT wired (the option
			// is absent) the filter falls back to the over-broad
			// aggregate predicate so the BCTPA-P7b RED witness remains
			// observable in tests that omit the seam. This is the same
			// shape as the LHOWA01 / PPAT optional wiring.
			if (result.messages.length > 0) {
				const hasCompletionResult = result.messages.some((m) => m.say === "completion_result")
				if (hasCompletionResult) {
					const ownedJobIds = this.options.messageTranslatorState.getLaunchedBackgroundJobIds()
					if (this.options.hasActiveNotify) {
						// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
						// Per-job ownership-aware filter. The narrow
						// predicate only suppresses when an OWNED
						// job is still outstanding (per the
						// `hasActiveNotify(jobId)` exact lookup). The
						// predecessor BCTPA-P7b over-broad predicate
						// was the AGGREGATE `activeNotifyCount > 0` —
						// it suppressed for ANY unrelated background
						// work. The new filter does NOT consult the
						// aggregate (which would defeat the per-job
						// correlation). This is the load-bearing
						// conservation matrix item R4 ("J2 active
						// does not suppress completion belonging to
						// completed J1").
						//
						// ACT-CLINEMM-C10-FILTER-ABLATION01: when the
						// test-only `shouldFilterCompletionResult`
						// predicate is wired, it gates this branch
						// directly without contaminating SEAM B
						// (which reads `hasActiveNotify` through its
						// own option-bag calls).
						let ownedAndOutstanding: boolean
						if (this.options.shouldFilterCompletionResult) {
							ownedAndOutstanding = this.options.shouldFilterCompletionResult(ownedJobIds)
						} else {
							ownedAndOutstanding = false
							for (const jid of ownedJobIds) {
								if (this.options.hasActiveNotify(jid)) {
									ownedAndOutstanding = true
									break
								}
							}
							// ACT-CLINEMM-COMPLETION-PRESENTATION-AUTHORITY01:
							// the BCB barrier at SEAM B (line ~1300-1310) holds
							// on `ownerStillRunningForC10 ||
							// unconsumedOwnedTerminalResultsForC10 > 0`. The
							// C10 message-layer filter (this seam) must reach
							// the SAME conclusion about whether the task is
							// currently authoritatively complete, otherwise a
							// `say:"completion_result"` row leaks through while
							// the BCB barrier correctly holds (the live P0).
							// Reuse the SAME option-bag methods the BCB barrier
							// already consults — no new wiring, no new state.
							if (!ownedAndOutstanding) {
								const ownerStillRunningForC10 =
									this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
								const unconsumedOwnedTerminalResultsForC10 =
									this.options.getUnconsumedOwnedTerminalResultCount?.(activeSession.sessionId) ?? 0
								if (ownerStillRunningForC10 || unconsumedOwnedTerminalResultsForC10 > 0) {
									ownedAndOutstanding = true
								}
							}
						}
						if (ownedAndOutstanding) {
							result.messages = result.messages.filter((m) => m.say !== "completion_result")
						}
					} else {
						// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
						// `hasActiveNotify` is not wired — fall back to
						// the over-broad aggregate predicate so the
						// BCTPA-P7b RED witness remains observable for
						// tests that omit the seam (this preserves the
						// predecessor behavior for any test harness that
						// does not opt into the per-job lookup).
						//
						// ACT-CLINEMM-C10-FILTER-ABLATION01: same
						// gating as the narrow branch — when the
						// test-only `shouldFilterCompletionResult`
						// predicate is wired, it gates this branch
						// directly without contaminating SEAM B.
						let outstandingAutonomousWork: boolean
						if (this.options.shouldFilterCompletionResult) {
							outstandingAutonomousWork = this.options.shouldFilterCompletionResult(ownedJobIds)
						} else {
							const pendingPromptCountRead: PendingPromptCountRead = this.options.getPendingPromptCount?.(
								activeSession.sessionId,
							) ?? { available: false }
							const pendingPromptAuthorityUnknown = pendingPromptCountRead.available !== true
							const pendingPromptsKnown =
								pendingPromptCountRead.available === true ? pendingPromptCountRead.count : 0
							const activeNotifyCount =
								this.options.getActiveNotifyCount?.(activeSession.sessionId, this.options.getTask?.()?.taskId) ??
								0
							// ACT-CLINEMM-COMPLETION-PRESENTATION-AUTHORITY01:
							// the BCB barrier at SEAM B (line ~1300-1310) holds
							// on `ownerStillRunningForC10 ||
							// unconsumedOwnedTerminalResultsForC10 > 0` in
							// addition to the notify-marker / pending-prompt
							// aggregate. The C10 message-layer filter (this
							// fallback branch, taken when `hasActiveNotify` is
							// not wired) must reach the SAME conclusion as SEAM
							// B, otherwise a `say:"completion_result"` row
							// leaks through while the BCB barrier correctly
							// holds. Reuse the SAME option-bag methods.
							const ownerStillRunningForC10 =
								this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
							const unconsumedOwnedTerminalResultsForC10 =
								this.options.getUnconsumedOwnedTerminalResultCount?.(activeSession.sessionId) ?? 0
							outstandingAutonomousWork =
								pendingPromptAuthorityUnknown ||
								pendingPromptsKnown > 0 ||
								activeNotifyCount > 0 ||
								ownerStillRunningForC10 ||
								unconsumedOwnedTerminalResultsForC10 > 0
						}
						if (outstandingAutonomousWork) {
							result.messages = result.messages.filter((m) => m.say !== "completion_result")
						}
					}
				}
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
							// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01:
							// C9 — submit_and_exit_seen capture. Fires when the
							// completion tool's terminal response was committed
							// AND the turn-end path is promoting phase. The
							// host-side capture gate makes this a complete
							// no-op when OFF.
							captureContinuationCardinalityAuthorityRecord({
								stage: "submit_and_exit_seen",
								origin: "pending_prompt_drain",
								sessionId: activeSession.sessionId,
								taskId: this.options.getTask?.()?.taskId,
								// ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §21-G:
								// mint a coordinator-local submitId for this C9 event.
								// Monotonic, per-coordinator-instance. One C9 -> one submitId.
								submitId: `submit-${activeSession.sessionId}-${++this.nextSubmitEventId}`,
							})
							// ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
							// Completion-barrier guard. The completion commit is HELD iff
							// an outstanding autonomous obligation exists for the active
							// (sessionId, taskId). The barrier is conservative: it
							// consults the same predicate as LHOWA01's awaiting_followup
							// deferral (queued prompt + active notify marker). When HELD,
							// a DeferredCompletionBarrier marker is registered so the
							// terminal-idle re-evaluation
							// (reevaluateDeferredCompletionBarrier) can fire the held
							// commit when all obligations resolve. Per the recon
							// (04-background-obligation-map.md §5), only
							// notifyOnCompletion=true obligations are completion-
							// relevant; a notify=false background job (fire-and-forget
							// daemon, dev server, etc.) does NOT block completion.
							//
							// Fail-closed authority for the pending-prompt transport
							// (PPAT01 invariant): when the authority is UNAVAILABLE
							// (`available === false`) we MUST treat it as "do not
							// know, hold completion" — NEVER as "0, allow completion".
							// The completion-barrier must match the established Q5
							// deferral authority exactly; relaxing it here would
							// re-open the same fail-open defect PPAT closed for
							// awaiting_followup (TQCB01 P1 correction).
							const pendingPromptCountRead: PendingPromptCountRead = this.options.getPendingPromptCount?.(
								activeSession.sessionId,
							) ?? {
								available: false,
							}
							const pendingPromptAuthorityUnknown = pendingPromptCountRead.available !== true
							const pendingPromptsKnown =
								pendingPromptCountRead.available === true ? pendingPromptCountRead.count : 0
							const activeNotifyCount =
								this.options.getActiveNotifyCount?.(activeSession.sessionId, this.options.getTask?.()?.taskId) ??
								0
							// ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01:
							// Per-job wake-authority consult on each
							// notify-owned jobId launched by THIS turn.
							// The originator's completion commit is HELD
							// whenever any launched jobId has an
							// outstanding wake authority that is not yet
							// settled, AND is SUPPRESSED (barrier held
							// forever for that jobId) when the wake was
							// delivered (the wake-driven turn owns
							// terminal completion for J).
							//
							// The C10 barrier consults THREE per-job
							// states via BackgroundNotifyCoordinator:
							//
							//   1. `hasActiveNotify(J)` → marker alive
							//      ⇒ wake authority in flight (Path A
							//      will enqueue) ⇒ HOLD until settled.
							//   2. `wasWakeDelivered(J)` → marker gone
							//      AND wake enqueued ⇒ wake-driven turn
							//      owns completion ⇒ SUPPRESS (the
							//      originator MUST NOT commit; the
							//      wake-driven turn will).
							//   3. `isWakeAuthoritySettled(J)` → marker
							//      gone AND wake settled (delivered or
							//      discarded) ⇒ originator may commit.
							//
							// The barrier predicate is OR'd with the
							// existing TQCB01 aggregate. When ANY of
							// the per-job predicates reports "hold" the
							// barrier holds; when the wake was delivered
							// (case 2) the originator's completion is
							// SUPPRESSED entirely (the deferred marker
							// stays forever for that jobId; the
							// wake-driven turn will commit instead).
							const launchedBackgroundJobIds = this.options.messageTranslatorState.getLaunchedBackgroundJobIds()
							let perJobOutstandingNotifyWork = false
							let perJobSuppressOriginatingCompletion = false
							if (launchedBackgroundJobIds.length > 0) {
								for (const jid of launchedBackgroundJobIds) {
									if (this.options.hasActiveNotify?.(jid)) {
										// Case 1: wake authority in flight
										// (Path A will enqueue).
										perJobOutstandingNotifyWork = true
									} else if (
										this.options.wasWakeDispatchRequested?.(jid) === true &&
										this.options.wasWakeDelivered?.(jid) !== true &&
										this.options.wasWakeDispatchFailed?.(jid) !== true
									) {
										// CORRECTION03 (HALT_WAKE_DELIVERY_ACK_PROMOTED):
										// dispatch REQUESTED, ack pending. HOLD until
										// ack resolves. Load-bearing fix: prior ROUND 2
										// conflated REQUESTED with DELIVERED which would
										// SUPPRESS the originator while wake was still
										// in flight — a lost wake would produce 0
										// completions for J.
										perJobOutstandingNotifyWork = true
									} else if (this.options.wasWakeDelivered?.(jid)) {
										// Case 3: wake-driven turn owns terminal
										// completion for this jobId. SUPPRESS (barrier
										// held forever for this jobId).
										perJobSuppressOriginatingCompletion = true
									}
									// Case 4 (wasWakeDispatchFailed): ALLOW. We do
									// NOT set perJobOutstandingNotifyWork and do NOT
									// set perJobSuppressOriginatingCompletion. The wake
									// is lost; the originator must commit; semantic
									// completion count for J becomes exactly 1.
									//
									// Case 5 (isWakeAuthoritySettled via discard):
									// originator may commit. We do NOT set either
									// flag here — the originating turn has already
									// entered this branch (commitment attempt) and
									// will be ALLOWED if no other predicate holds.
								}
							}
							const outstandingAutonomousWork =
								pendingPromptAuthorityUnknown ||
								pendingPromptsKnown > 0 ||
								activeNotifyCount > 0 ||
								perJobOutstandingNotifyWork
							// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01: extend the
							// C10 completion-commit barrier predicate to include
							// the running task-owned background-job aggregate (the
							// CommandJobManager primitive
							// `hasRunningBackgroundJobForOwner(activeSession.sessionId)`).
							// This closes the live
							// HALT_BACKGROUND_TERMINAL_REENTERS_COMPLETED_TASK
							// defect: the predecessor TQCB01 barrier only
							// consulted notify=true markers, so notify=false
							// (fire-and-forget) jobs did not block completion.
							const ownerStillRunningForC10 =
								this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
							// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
							// extend the C10 barrier predicate to include the
							// second conjunct of the BCB01 §0.1 frozen invariant.
							// Even with running_jobs == 0, completion is held
							// if unconsumed_owned_terminal_results > 0 — the
							// agent must observe the terminal facts (notify=true
							// wake OR notify=false observation) before commit.
							const unconsumedOwnedTerminalResultsForC10 =
								this.options.getUnconsumedOwnedTerminalResultCount?.(activeSession.sessionId) ?? 0
							// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-UNRESOLVABLE-TERMINAL-OUTCOME01-CORRECTION01:
							// Mirror the BCB01 §0.1 second-conjunct list check
							// from `reevaluateDeferredCompletionBarrier` at
							// the C10 barrier (handleSessionEvent). When the
							// count and list providers disagree, the IDs
							// list is the authoritative held-set signal.
							const unconsumedOwnedTerminalJobIdsForC10 =
								this.options.getUnconsumedOwnedTerminalJobIds?.(
									activeSession.sessionId,
									this.options.getTask?.()?.taskId,
								) ?? []
							const heldObligationForC10 =
								unconsumedOwnedTerminalResultsForC10 > 0 || unconsumedOwnedTerminalJobIdsForC10.length > 0
							const suppressOriginatingCompletion = perJobSuppressOriginatingCompletion

							if (
								outstandingAutonomousWork ||
								ownerStillRunningForC10 ||
								heldObligationForC10 ||
								suppressOriginatingCompletion
							) {
								// Register the deferred-completion-barrier marker.
								// Same epoch + task + session identity triple as
								// deferredContinuation (BTCONT01). Cleared on commit
								// or on epoch supersession.
								Logger.warn(
									suppressOriginatingCompletion
										? `[SdkController] submit_and_exit suppressed for session ${activeSession.sessionId}: wake-driven turn owns terminal completion for one or more notify-owned jobs launched by this turn (BNCA barrier)`
										: `[SdkController] submit_and_exit requested but active session ${activeSession.sessionId} has outstanding autonomous work (pendingPrompts=${pendingPromptsKnown}, activeNotify=${activeNotifyCount}); holding completion (TQCB01 barrier)`,
								)
								// ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY:
								// Preserve the existing marker's `reason` field
								// across BCB re-registrations ONLY when the
								// previous marker's identity triple (sessionId,
								// taskId, epoch) matches the current obligation
								// (P0 #2 — identity discipline). A new obligation
								// (epoch bump + new held set) does NOT inherit
								// the previous verdict — the bounded guard's
								// `sameObligationAlreadyObservationUnavailable`
								// check must evaluate against the SAME obligation,
								// not "any previous marker".
								const _bcbCurrentSessionId = activeSession.sessionId
								const _bcbCurrentTaskId = this.options.getTask?.()?.taskId
								const _bcbCurrentEpoch = this.options.messageTranslatorState.getMinter().epoch
								const _bcbPreviousMarker = this.deferredCompletionBarrier
								const _bcbSameIdentity =
									_bcbPreviousMarker !== undefined &&
									_bcbPreviousMarker.sessionId === _bcbCurrentSessionId &&
									_bcbPreviousMarker.taskId === _bcbCurrentTaskId &&
									_bcbPreviousMarker.epoch === _bcbCurrentEpoch
								const preservedReason = _bcbSameIdentity ? _bcbPreviousMarker.reason : undefined
								this.deferredCompletionBarrier = {
									sessionId: _bcbCurrentSessionId,
									taskId: _bcbCurrentTaskId,
									epoch: _bcbCurrentEpoch,
									deferredAt: Date.now(),
									...(preservedReason ? { reason: preservedReason } : {}),
								}
								// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01:
								// Clear the completion-continuation-dedupe marker
								// so this very trigger call (the FIRST trigger of
								// the freshly-registered marker lifecycle) can fire
								// K+1. The previous implementation kept the dedupe
								// pinned from the previous run's epoch-scoped key,
								// which caused K's own submit_and_exit to suppress
								// the successor (LIVE defect).
								// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01-CORRECTION01-STALL-LIFETIME:
								// REARM ownership only at this lifetime boundary. A fresh
								// BCB registration may legitimately need a new continuation,
								// so the dedupe marker is attempt-scoped and cleared here.
								//
								// DO NOT clear STALL ownership here. STALL is
								// causal-state-scoped, not attempt-scoped — it must survive
								// a new submit_and_exit / BCB re-registration because the
								// held set is unchanged in the LIVE defect. The predecessor
								// STALLED-REARM-LOOP01 fix cleared the STALL fingerprint AND
								// the canonical held-set snapshot at this same boundary,
								// which (when paired with the REARM clear) defeated the
								// superset-aware discriminator: `priorSortedHeld === undefined`
								// cannot classify same/superset as stalled, so the next
								// attempt always looked like a first observation. Future
								// refactors MUST keep these lifetimes separate.
								this.lastCompletionContinuationSessionEpoch = undefined
								// STALL authority (lastCompletionContinuationControlFingerprint
								// + lastCompletionContinuationHeldSetSorted) is NOT cleared —
								// see lifetime boundary comment above. The legitimate
								// STALL-clear sites are:
								//   - causal progress (contraction / membership shift) in
								//     enqueueCompletionContinuationIfHeld
								//   - task replacement (new coordinator instance)
								//   - session replacement (new coordinator instance)
								//   - true controller/task teardown
								//   - explicit test reset (clearCompletionContinuationSentForTesting)
								// A submit_and_exit re-call, a new BCB registration, a new
								// pending prompt, a new runId, a new timestamp, and a new
								// epoch are NOT causal progress and must NOT clear STALL authority.
								// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03:
								// Bounded finalization-authority trigger (see
								// `enqueueCompletionContinuationIfHeld` docstring).
								// Fire AT MOST ONCE per (sessionId, epoch) when the
								// BCB01 §0.1 second conjunct is the hold cause.
								// ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01:
								// Bounded host correlation guard. When the live
								// resumed-turn tool registry does NOT include `command_status`
								// (the observation mechanism the coalesced continuation prompt
								// instructs the model to call), the coalesced continuation is
								// useless — handing the model a prompt it cannot act on
								// produces a bounded loop. The host publishes a SINGLE typed
								// blocked outcome (`reason: "observation_unavailable"`) and
								// stops re-firing the coalesced continuation until the
								// capability is restored. The per-job wake path is unaffected.
								// CORRECTION01 eligibility-predicate inversion (P0 #1):
								// The bounded host correlation guard must NOT publish
								// a blocked outcome outside the eligibility branch.
								// `canObserveHeldResults` is consulted ONLY inside
								// the eligibility branch (held terminal observation
								// exists AND not suppressed). A non-held BCB block
								// (e.g. `outstandingAutonomousWork === true` from
								// pending prompts only) does NOT enter the
								// eligibility branch and the guard does NOT publish
								// `observation_unavailable` for it. The marker is
								// registered by the BCB block above, but its
								// `reason` field stays undefined (the CORRECTION01
								// identity discipline does not stamp a verdict for
								// a non-held BCB block).
								//
								// `liveTools === undefined` (capability unknown) is
								// a distinct branch: the host does NOT publish
								// `observation_unavailable` either (that would be a
								// false positive); the existing
								// `enqueueCompletionContinuationIfHeld` path runs
								// and the downstream
								// `buildSdkControllerEnqueueCompletionContinuation`
								// returns `rejected` for `liveTools === undefined`.
								const eligibleForCoalescedContinuation =
									unconsumedOwnedTerminalResultsForC10 > 0 && !suppressOriginatingCompletion
								if (eligibleForCoalescedContinuation) {
									const liveToolNames = this.options.liveTools?.() ?? undefined
									const canObserveHeldResults =
										liveToolNames !== undefined ? liveToolNames.includes("command_status") : null
									const sameObligationAlreadyObservationUnavailable =
										this.deferredCompletionBarrier?.reason === "observation_unavailable"
									if (canObserveHeldResults === false) {
										// Bounded correlation: the model has no observation
										// mechanism. Publish a SINGLE typed blocked
										// outcome and skip the enqueue. The marker is
										// held with reason stamped. The next cycle (if
										// it has the same identity + different capability)
										// is allowed to retry.
										const capturedSessionId = activeSession.sessionId
										const capturedTaskId = this.options.getTask?.()?.taskId
										const capturedEnqueueEpoch = this.options.messageTranslatorState.getMinter().epoch
										if (!sameObligationAlreadyObservationUnavailable) {
											this.applyBlockedCompletionContinuationOutcome(
												{
													sessionId: capturedSessionId,
													taskId: capturedTaskId,
													enqueueEpoch: capturedEnqueueEpoch,
												},
												{
													kind: "fail_closed" as const,
													failureReason: "observation_unavailable" as const,
												},
											)
											// ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01
											// (PTBPC01): the BCB has authoritatively stamped
											// the `observation_unavailable` blocked verdict.
											// The host's `currentLegacyPhase` was a SCAR (e.g.
											// `streaming` from `task-start-init-task`); the Elm
											// TaskHeader R2.5 rule (`error` host authority)
											// trusts the host's `error` write over an UNBOUND
											// canonical shadow. This is the bounded
											// host-phase/publication transition that closes
											// the LIVE specimen's `Working` SCAR without
											// fabricating completion. The next
											// `reevaluateDeferredCompletionBarrier` (or
											// epoch-supersession clearing the marker) will
											// overwrite this write when the BCB clears.
											this.options.setTurnPhase?.(
												"error",
												undefined,
												"session-event-bcb-blocked-observation-unavailable",
											)
										}
									} else {
										// canObserveHeldResults === true OR === null (capability unknown).
										// The original code enqueued in both cases (the null case
										// is the "honest capability unknown" host; the downstream
										// SdkController rejects undefined liveTools at L923-930
										// so an honest unknown falls through to `rejected`).
										// The CORRECTION01 bounded guard only fires when capability is
										// PROVEN unavailable (canObserveHeldResults === false).
										// ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01:
										// capture sessionId/taskId at fire time so the
										// `.then` mapping can validate the resolution is
										// still current (C4 adversarial guard against a
										// task replacement between fire and resolution).
										//
										// ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01-CORRECTION01-CONSUMER-AND-EPOCH:
										// ALSO capture the enqueue's epoch. The marker
										// registered on the prior line (BCB block) and
										// the enqueue fired here share the SAME
										// `getMinter().epoch` value (the BCB registration
										// reads the minter, the enqueue reads it again -
										// no `nextMessageId()` happens between them, so
										// the epoch is the same). The captured
										// `enqueueEpoch` is the obligation's identity;
										// the helper refuses to stamp a marker whose
										// epoch differs.
										const capturedSessionId = activeSession.sessionId
										const capturedTaskId = this.options.getTask?.()?.taskId
										const capturedEnqueueEpoch = this.options.messageTranslatorState.getMinter().epoch
										void this.enqueueCompletionContinuationIfHeld(
											capturedSessionId,
											unconsumedOwnedTerminalResultsForC10,
											capturedTaskId,
										)
											.then((outcome) => {
												if (outcome.kind === "delivered") {
													Logger.warn(
														`[SdkController] completion continuation turn enqueued for session=${capturedSessionId} heldJobIds=${outcome.heldJobIds.length} (epoch=${outcome.continuationSessionEpoch})`,
													)
												}
												// Publish a typed host-owned reason
												// for the blocked outcomes (C5/C6/C7).
												// No-op for non-blocked outcomes.
												//
												// CORRECTION01: pass the captured
												// enqueue epoch so the helper binds
												// the publication to a marker of the
												// same epoch.
												this.applyBlockedCompletionContinuationOutcome(
													{
														sessionId: capturedSessionId,
														taskId: capturedTaskId,
														enqueueEpoch: capturedEnqueueEpoch,
													},
													outcome,
												)
											})
											.catch((error) => {
												Logger.warn(
													`[SdkController] completion continuation enqueue failed: ${
														error instanceof Error ? error.message : String(error)
													}`,
												)
											})
									}
								}
							} else {
								// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 +
								// ACT-CLINEMM-COMPLETION-AUTHORITY-CCARD-COMMIT-STAGE-BOUNDARY-MISBOUND-REPAIR01:
								// C10 — task_completion_committed capture. Fires
								// at the actual completion commit seam (the
								// canonical phase transition). One record per
								// user-visible COMPLETED. The host-side capture
								// gate makes this a complete no-op when OFF.
								//
								// REPAIR: the capture now fires AFTER the Elm
								// authority gate AND AFTER the
								// `setTurnPhase("completed", …)` effect. The
								// previous (pre-fix) ordering emitted the record
								// BEFORE the gate, which meant a HOLD decision
								// still produced a "committed" shadow transition
								// (see HALT_CCARD_COMMIT_STAGE_MISBOUND, commit
								// `5f9330c55` LIVE dump). The factual contract for
								// the move is "successful traversal of the
								// production completion-effect seam", not "the
								// call-site ran".
								if (!(await this.checkElmCompletionAuthority("session-event-turn-complete-completed"))) {
									// ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01:
									// Elm authority HOLD or FAILURE returns false from
									// checkElmCompletionAuthority. Register the
									// deferred-completion-barrier marker with the SAME
									// (sessionId, taskId, epoch) triple the existing TS-
									// predicate branch uses. This is the liveness repair
									// the LIVE RED identified: previously the marker was
									// only set on TS-predicate holds, so an Elm HOLD
									// (e.g. active_run) that became releasable on
									// agent_turn_done had no marker to reevaluate. The
									// marker is identical to the existing one (epoch-bound,
									// one outstanding per identity), so the existing
									// reevaluateDeferredCompletionBarrier() path - already
									// wired through SdkController - transparently extends
									// to Elm holds. Reuses the existing path per ACT §7 OPTION 1.
									this.deferredCompletionBarrier = {
										sessionId: activeSession.sessionId,
										taskId: this.options.getTask?.()?.taskId,
										epoch: this.options.messageTranslatorState.getMinter().epoch,
										deferredAt: Date.now(),
									}
									return
								}
								this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")
								captureContinuationCardinalityAuthorityRecord({
									stage: "task_completion_committed",
									origin: "pending_prompt_drain",
									sessionId: activeSession.sessionId,
									taskId: this.options.getTask?.()?.taskId,
									// ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §21-H:
									// mint a coordinator-local completionId for this C10 event.
									// Monotonic, per-coordinator-instance. One C10 -> one completionId.
									completionId: `completion-${activeSession.sessionId}-${++this.nextCompletionCommitEventId}`,
								})
							}
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
							const ownerStillRunning =
								this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
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
							const pendingPromptsKnown =
								pendingPromptCountRead.available === true ? pendingPromptCountRead.count : 0
							const activeNotifyCount =
								this.options.getActiveNotifyCount?.(activeSession.sessionId, this.options.getTask?.()?.taskId) ??
								0
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
								ownerStillRunning ||
								pendingPromptAuthorityUnknown ||
								pendingPromptsKnown > 0 ||
								activeNotifyCount > 0
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
								sessionEventSessionId:
									typeof event.payload?.sessionId === "string" ? event.payload.sessionId : null,
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
		} finally {
			// ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01:
			// Leave the depth tracker. The try/finally guarantees the
			// depth counter returns to its prior value even if the
			// coordinator throws (an exception in the body must NOT
			// permanently inflate maxNestedHandleDepth).
			leaveExtensionHostHotloopHandleSessionEvent()
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
		// ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01:
		// The synchronous `Logger.log(...)` calls in this method were
		// the single dominant source of extension-host CPU time in the
		// LIVE failure captured by exthost-66cdb2.cpuprofile
		// (20.3% of all samples fell below this call site, including
		// the synchronous `Logger.#output` -> subscriber fan-out ->
		// `outputChannel.appendLine` I/O wait). The
		// `pending_prompts` event is emitted from many production
		// call sites (enqueue, update, delete, consumeSteer,
		// discardQueue, drain shift, drain requeue) — for ONE
		// ordinary background-command lifecycle this method is
		// invoked multiple times, and the unconditional
		// `outputChannel.appendLine` synchronously stalls the
		// extension-host thread.
		//
		// PERMANENT PRODUCTION RULE (CORRECTION01 / CORRECTION02):
		// The synchronous breadcrumb is gated behind
		// `shouldEmitExtensionHostQueueLog()` (a function owned by
		// the PERMANENT policy module
		// `./extension-host-queue-log-policy.ts`). The function is
		// DEFAULT_OFF in every profile — public, dogfood, or
		// otherwise. The dogfood profile does NOT grant this. The
		// diagnostic enablement (counters / nested depth / phase
		// write witness) is a separate, cheaper gate, and does NOT
		// own this decision.
		//
		// Decoupling rationale: the dogfood profile IS the environment
		// where the LIVE failure was captured (exthost-66cdb2.cpuprofile,
		// installed build s1onique.clinemm-4.1.16-99006fbcc). A repair
		// that depends on the diagnostic enablement bit to also be
		// the production-soundness gate would, after the diagnostic
		// is removed, leave the hot path UNREPAIRED. The two gates
		// must therefore be independent, AND the production gate must
		// live outside the diagnostic module entirely.
		if (!shouldEmitExtensionHostQueueLog()) {
			// Permanent default: synchronous breadcrumb suppressed.
			// Counters (when armed) record the suppression so the
			// post-mortem can verify the permanent rule held.
			if (isExtensionHostHotloopDiagnosticEnabled()) {
				recordExtensionHostHotloopLogQueueEvent({ producedLog: false })
			}
			return
		}
		if (event.type === "pending_prompts") {
			const count = event.payload.prompts.length
			Logger.log(
				`[SdkController] Pending prompts updated: ${count} prompt(s) in queue for session ${event.payload.sessionId}`,
			)
			if (isExtensionHostHotloopDiagnosticEnabled()) {
				recordExtensionHostHotloopLogQueueEvent({ producedLog: true })
			}
			return
		}

		if (event.type === "pending_prompt_submitted") {
			Logger.log(
				`[SdkController] Pending prompt submitted: "${event.payload.prompt.substring(0, 80)}" for session ${event.payload.sessionId}`,
			)
			if (isExtensionHostHotloopDiagnosticEnabled()) {
				recordExtensionHostHotloopLogQueueEvent({ producedLog: true })
			}
		}
	}
}

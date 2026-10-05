/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION01-LIVE-CALLBACK-OUTCOME
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION02-DOGFOOD-DIAGNOSTIC-GATE-AND-ARTIFACT-BINDING
 *
 * LIVE callback-outcome counter for the completion-continuation
 * enqueue path. Default-off aggregate counter with NO semantic effect
 * on the callback or queue state.
 *
 * Why this module exists:
 *   CCDS01 proved the chain
 *     coordinator -> buildSdkControllerEnqueueCompletionContinuation
 *     -> LocalRuntimeHost -> PendingPromptsController.enqueue
 *   is healthy through a SYNTHETIC_REAL harness (using
 *   AsdkSessionHostBridge which bypasses the VscodeSessionHost /
 *   ClineCore wrapper). LIVE two specimens still showed
 *   pending_prompt_enqueued=0, so the missing information lives in
 *   the actual installed production wrapper/session context, not in
 *   the LocalRuntimeHost queue path.
 *
 *   This runtime supplies the discriminated first-divergence
 *   counters the LIVE discriminator table needs to classify where
 *   production diverges (CASE A..H from the ACT spec §13):
 *     - callbackEntered   (production callback body reached)
 *     - activeSessionMissing  (getActiveSession() === undefined)
 *     - sessionIdMismatch  (active.sessionId !== requested sessionId)
 *     - sdkHostSendEntered  (sdkHost.send invoked)
 *     - delivered  (send returned normally)
 *     - rejected  (send threw -> mapped to { kind: "rejected" })
 *     - sessionGone  (active missing or identity mismatch)
 *     - noHeldJobIds  (input.heldJobIds.length === 0)
 *     - sendThrew  (send raised an error)
 *     - lastOutcome  (string of the last outcome classification)
 *     - lastRequestedSessionMatched (most recent callback identity)
 *     - pendingPromptEnqueuedObserved (optional; correlated via the
 *       existing production capture hooks ONLY when they are armed)
 *
 * CORRECTION02 — Enablement boundary (default-off opt-in):
 *   - The runtime owns a module-level `enabled: boolean` flag
 *     (default false). Every record function short-circuits when
 *     disabled, so the production callback body remains
 *     bit-identical outside dogfood (no counter increment, no
 *     observable state change).
 *   - The flag is set EXCLUSIVELY by the production seam
 *     `setCompletionContinuationDeliveryEnabled` from
 *     `dogfood-diagnostic-profile.ts` via
 *     `applyCompletionContinuationDeliveryDiagnosticProfile`.
 *   - No environment variable. No public config. No workspace
 *     toggle. The diagnostic is enabled iff the existing dogfood
 *     runtime profile is active (`CLINEMM_RUNTIME_PROFILE=dogfood`).
 *   - The dump command and host-side dump runtime remain registered
 *     in all profiles (mirrors CCARD / Elm shadow / Elm authority
 *     convention: dump is unconditional, dump != clear, dump !=
 *     enable). While disabled, the dump reports an all-zero
 *     snapshot so an operator can always confirm the diagnostic is
 *     correctly off.
 *
 * Counter semantics:
 *   - Aggregate counts ONLY; never records prompt bodies, terminal
 *     output, user text, paths, or any high-cardinality content.
 *   - "default-off" qualifier refers to operator-visible effect: the
 *     counters do not mutate the callback or queue state, do not
 *     affect routing, and do not introduce any new protocol surface.
 *   - Mirrors the Elm shadow / authority counter convention
 *     (completion-authority-elm-authority-runtime.ts §3) so the dump
 *     shape is operator-familiar.
 *
 * Identity policy:
 *   - No raw job IDs are stored.
 *   - Only booleans / counts + one "lastOutcome" string + one
 *     "lastRequestedSessionMatched" boolean are recorded.
 *
 * NO SEMANTIC EFFECT. The increments happen inside
 * `buildSdkControllerEnqueueCompletionContinuation` AFTER the
 * decision has been computed; the counter increment does NOT
 * influence the returned outcome.
 */

export interface CompletionContinuationDeliveryCountersSnapshot {
	readonly total: number
	readonly callbackEntered: number
	readonly activeSessionMissing: number
	readonly sessionIdMismatch: number
	readonly sdkHostSendEntered: number
	readonly delivered: number
	readonly rejected: number
	readonly sessionGone: number
	readonly noHeldJobIds: number
	readonly sendThrew: number
	readonly lastOutcome: "delivered" | "rejected" | "session_gone" | "no_held_job_ids" | null
	readonly lastRequestedSessionMatched: boolean | null
	readonly pendingPromptEnqueuedObserved: number | null
}

interface DeliveryState {
	enabled: boolean
	counters: {
		total: number
		callbackEntered: number
		activeSessionMissing: number
		sessionIdMismatch: number
		sdkHostSendEntered: number
		delivered: number
		rejected: number
		sessionGone: number
		noHeldJobIds: number
		sendThrew: number
		lastOutcome: "delivered" | "rejected" | "session_gone" | "no_held_job_ids" | null
		lastRequestedSessionMatched: boolean | null
		pendingPromptEnqueuedObserved: number | null
	}
}

function freshCounters(): DeliveryState["counters"] {
	return {
		total: 0,
		callbackEntered: 0,
		activeSessionMissing: 0,
		sessionIdMismatch: 0,
		sdkHostSendEntered: 0,
		delivered: 0,
		rejected: 0,
		sessionGone: 0,
		noHeldJobIds: 0,
		sendThrew: 0,
		lastOutcome: null,
		lastRequestedSessionMatched: null,
		pendingPromptEnqueuedObserved: null,
	}
}

let _state: DeliveryState = { enabled: false, counters: freshCounters() }

function getOrInitState(): DeliveryState {
	return _state
}

/**
 * Production seam — flip the diagnostic enablement. Called ONLY
 * by `applyCompletionContinuationDeliveryDiagnosticProfile` in
 * dogfood-diagnostic-profile.ts (during extension activation).
 *
 * Outside dogfood the flag is `false` (default) and every record
 * function is a no-op, so the production callback body is
 * bit-identical to the pre-instrumentation path.
 */
export function setCompletionContinuationDeliveryEnabled(enabled: boolean): void {
	_state.enabled = enabled === true
}

/**
 * Read-only view of the diagnostic enablement flag. Used by the
 * dogfood profile resolver to decide whether the previous value
 * differed from the requested value (and a flip is required).
 * Mirrors the `isContinuationCardinalityAuthorityCaptureEnabled`
 * shape used by the CCARD apply helper.
 */
export function isCompletionContinuationDeliveryEnabled(): boolean {
	return _state.enabled === true
}

function _isCompletionContinuationDeliveryEnabledForActivation(): boolean {
	return _state.enabled === true
}

export function recordCallbackEntered(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.total += 1
	state.counters.callbackEntered += 1
}

export function recordActiveSessionMissing(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.activeSessionMissing += 1
	state.counters.sessionGone += 1
	state.counters.lastOutcome = "session_gone"
	state.counters.lastRequestedSessionMatched = null
}

export function recordSessionIdMismatch(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.sessionIdMismatch += 1
	state.counters.sessionGone += 1
	state.counters.lastOutcome = "session_gone"
	state.counters.lastRequestedSessionMatched = false
}

export function recordNoHeldJobIds(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.noHeldJobIds += 1
	state.counters.lastOutcome = "no_held_job_ids"
	state.counters.lastRequestedSessionMatched = null
}

export function recordSdkHostSendEntered(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.sdkHostSendEntered += 1
}

export function recordDelivered(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.delivered += 1
	state.counters.lastOutcome = "delivered"
	state.counters.lastRequestedSessionMatched = true
}

export function recordSendThrew(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.sendThrew += 1
	state.counters.rejected += 1
	state.counters.lastOutcome = "rejected"
	state.counters.lastRequestedSessionMatched = true
}

export function recordPendingPromptEnqueuedObserved(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.pendingPromptEnqueuedObserved = (state.counters.pendingPromptEnqueuedObserved ?? 0) + 1
}

export function getCompletionContinuationDeliveryCounters(): CompletionContinuationDeliveryCountersSnapshot {
	const state = getOrInitState()
	return {
		total: state.counters.total,
		callbackEntered: state.counters.callbackEntered,
		activeSessionMissing: state.counters.activeSessionMissing,
		sessionIdMismatch: state.counters.sessionIdMismatch,
		sdkHostSendEntered: state.counters.sdkHostSendEntered,
		delivered: state.counters.delivered,
		rejected: state.counters.rejected,
		sessionGone: state.counters.sessionGone,
		noHeldJobIds: state.counters.noHeldJobIds,
		sendThrew: state.counters.sendThrew,
		lastOutcome: state.counters.lastOutcome,
		lastRequestedSessionMatched: state.counters.lastRequestedSessionMatched,
		pendingPromptEnqueuedObserved: state.counters.pendingPromptEnqueuedObserved,
	}
}

/**
 * Test-only: reset the counter snapshot to zero AND restore the
 * default-off enablement flag. Production code NEVER calls this.
 * The dump command also does NOT call this — dump != clear (no
 * counter mutation), mirroring the SHADOW / ELM authority
 * convention.
 */
export function resetCompletionContinuationDeliveryForTests(): void {
	_state = { enabled: false, counters: freshCounters() }
}

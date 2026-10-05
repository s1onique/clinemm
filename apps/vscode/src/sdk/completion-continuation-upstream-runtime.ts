/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR
 *
 * LIVE upstream discriminator for the completion-continuation callback.
 *
 * The CORRECTION01 callback-outcome diagnostic
 * (completion-continuation-delivery-runtime.ts) proves only that
 * `buildSdkControllerEnqueueCompletionContinuation` (the production
 * callback body) was NOT entered during the frozen LIVE specimen —
 * `callbackEntered=0`, every other discriminator at zero, lastOutcome=null.
 * It cannot discriminate between U0..U11 of the LIVE discriminator table.
 *
 * This module supplies the U0..U11 first-divergence counters. It owns a
 * narrow aggregate counter snapshot that the LIVE operator can dump from
 * the same Command Palette they already use for the callback diagnostic,
 * so the next LIVE classification can pin the exact pre-callback branch.
 *
 * Diagnostic shape (LIVE discriminator table):
 *     U0   totalAgentTurnDoneNotifications
 *     U0   notifyAgentTurnDoneEntered
 *     U1   reevaluateEntered
 *     U2   markerMissing
 *     U2   markerPresent
 *     U2.5 activeSessionLookupEntered   (CORRECTION04 — pre-U3 active-session lookup)
 *     U2.5 activeSessionPresent
 *     U2.5 activeSessionMissing
 *     U2.5 markerClearedForMissingSession
 *     U3   sessionMismatch
 *     U3   taskMismatch
 *     U4   epochMismatch
 *     U5   outstandingAutonomousWork
 *     U6   ownerStillRunning
 *     U7   unconsumedTerminalCountPositive
 *     U7   unconsumedTerminalCountLast
 *     U8   enqueueIfHeldEntered
 *     U9   heldJobIdsEmpty
 *     U9   heldJobIdsNonEmpty
 *     U9   heldJobIdsCountLast
 *     U10  dedupeSuppressed
 *     U10  dedupePermitted
 *     U11  enqueueCompletionContinuationInvoked
 *     U0..U11 lastStopReason  (bounded internal enum; see §7)
 *
 * CORRECTION04 — narrowed the pre-U3 instrumentation gap:
 *   The CORRECTION03 dump on the live run after installing the
 *   correct artifact showed `markerPresent=1, markerMissing=1`,
 *   every identity mismatch counter = 0, and
 *   `unconsumedTerminalCountLast=null` — three terminal commits
 *   were observed LIVE without any terminal-count read on the
 *   upstream side. The only obvious pre-U3 branch the prior
 *   instrumentation does NOT cover is the active-session lookup
 *   (`sessions.getActiveSession()`) at
 *   `sdk-session-event-coordinator.ts:770-776`, which silently
 *   clears the marker and returns when `!activeSession`.
 *   This correction adds four counters and one stop reason so
 *   the next LIVE run classifies whether the marker flip happens
 *   on the active-session lookup or further downstream. No
 *   provider is invoked twice: the SAME `activeSession` const
 *   that the production check uses is reused for the record*
 *   call (§11 invariant).
 *
 * CORRECTION03 — Enablement boundary (default-off opt-in, mirrors CCDO):
 *   - Module-level `enabled: boolean` flag (default false). Every
 *     record*() function short-circuits when disabled, so the
 *     coordinator's evaluation order is bit-identical outside dogfood
 *     (no counter increment, no observable state change, no provider
 *     call duplication — §11 invariant).
 *   - The flag is set EXCLUSIVELY by the production seam
 *     `setCompletionContinuationUpstreamEnabled` from
 *     `dogfood-diagnostic-profile.ts` via
 *     `applyCompletionContinuationUpstreamDiagnosticProfile`.
 *   - No environment variable. No public config. No workspace toggle.
 *     The diagnostic is enabled iff the existing dogfood runtime
 *     profile is active (`CLINEMM_RUNTIME_PROFILE=dogfood`).
 *   - The dump command and host-side dump runtime remain registered
 *     in all profiles (mirrors CCARD / CCDO / Elm shadow / Elm
 *     authority convention: dump is unconditional, dump != clear,
 *     dump != enable). While disabled, the dump reports an all-zero
 *     snapshot so the operator can always confirm the diagnostic is
 *     correctly off.
 */

export type CompletionContinuationUpstreamStopReason =
	| "marker_missing"
	| "active_session_missing"
	| "session_mismatch"
	| "task_mismatch"
	| "epoch_mismatch"
	| "outstanding_autonomous_work"
	| "owner_still_running"
	| "no_unconsumed_terminal"
	| "no_held_job_ids"
	| "dedupe_suppressed"
	| "enqueue_invoked"
	| "authority_check_reached"
	| "unknown"

export interface CompletionContinuationUpstreamCountersSnapshot {
	readonly totalAgentTurnDoneNotifications: number
	readonly notifyAgentTurnDoneEntered: number
	readonly reevaluateEntered: number
	readonly markerMissing: number
	readonly markerPresent: number
	readonly activeSessionLookupEntered: number
	readonly activeSessionPresent: number
	readonly activeSessionMissing: number
	readonly markerClearedForMissingSession: number
	readonly sessionMismatch: number
	readonly taskMismatch: number
	readonly epochMismatch: number
	readonly outstandingAutonomousWork: number
	readonly ownerStillRunning: number
	readonly unconsumedTerminalCountPositive: number
	readonly unconsumedTerminalCountLast: number | null
	readonly enqueueIfHeldEntered: number
	readonly heldJobIdsEmpty: number
	readonly heldJobIdsNonEmpty: number
	readonly heldJobIdsCountLast: number | null
	readonly dedupeSuppressed: number
	readonly dedupePermitted: number
	readonly enqueueCompletionContinuationInvoked: number
	readonly lastStopReason: CompletionContinuationUpstreamStopReason | null
	/** Tracks whether the requested active session id matched the
	 * marker's sessionId the LAST time the coordinator's
	 * `reevaluateDeferredCompletionBarrier` ran. `null` when the
	 * coordinator never ran. Bool mirror: matches CCARD convention. */
	readonly lastRequestedSessionMatched: boolean | null
}

interface State {
	enabled: boolean
	counters: {
		totalAgentTurnDoneNotifications: number
		notifyAgentTurnDoneEntered: number
		reevaluateEntered: number
		markerMissing: number
		markerPresent: number
		activeSessionLookupEntered: number
		activeSessionPresent: number
		activeSessionMissing: number
		markerClearedForMissingSession: number
		sessionMismatch: number
		taskMismatch: number
		epochMismatch: number
		outstandingAutonomousWork: number
		ownerStillRunning: number
		unconsumedTerminalCountPositive: number
		unconsumedTerminalCountLast: number | null
		enqueueIfHeldEntered: number
		heldJobIdsEmpty: number
		heldJobIdsNonEmpty: number
		heldJobIdsCountLast: number | null
		dedupeSuppressed: number
		dedupePermitted: number
		enqueueCompletionContinuationInvoked: number
		lastStopReason: CompletionContinuationUpstreamStopReason | null
		lastRequestedSessionMatched: boolean | null
	}
}

function freshCounters(): State["counters"] {
	return {
		totalAgentTurnDoneNotifications: 0,
		notifyAgentTurnDoneEntered: 0,
		reevaluateEntered: 0,
		markerMissing: 0,
		markerPresent: 0,
		activeSessionLookupEntered: 0,
		activeSessionPresent: 0,
		activeSessionMissing: 0,
		markerClearedForMissingSession: 0,
		sessionMismatch: 0,
		taskMismatch: 0,
		epochMismatch: 0,
		outstandingAutonomousWork: 0,
		ownerStillRunning: 0,
		unconsumedTerminalCountPositive: 0,
		unconsumedTerminalCountLast: null,
		enqueueIfHeldEntered: 0,
		heldJobIdsEmpty: 0,
		heldJobIdsNonEmpty: 0,
		heldJobIdsCountLast: null,
		dedupeSuppressed: 0,
		dedupePermitted: 0,
		enqueueCompletionContinuationInvoked: 0,
		lastStopReason: null,
		lastRequestedSessionMatched: null,
	}
}

let _state: State = {
	enabled: false,
	counters: freshCounters(),
}

function getOrInitState(): State {
	if (!_state) {
		_state = { enabled: false, counters: freshCounters() }
	}
	return _state
}

/**
 * Enable/disable the upstream diagnostic. EXCLUSIVELY called by the
 * production activation helper
 * `applyCompletionContinuationUpstreamDiagnosticProfile` from
 * `dogfood-diagnostic-profile.ts`. Mirrors the CCARD / CCDO / BJLA
 * / BOCOR / SHADOW / AUTHORITY activation convention.
 */
export function setCompletionContinuationUpstreamEnabled(enabled: boolean): void {
	const state = getOrInitState()
	if (state.enabled === enabled) return
	_state = { enabled, counters: state.counters }
}

export function isCompletionContinuationUpstreamEnabled(): boolean {
	return _state.enabled === true
}

function _isCompletionContinuationUpstreamEnabledForActivation(): boolean {
	return _state.enabled === true
}

// ---------------------------------------------------------------------------
// Production record*() functions. Every function short-circuits when the
// runtime is disabled, matching the §11 invariant: counters never observe
// a predicate, only the *decision* the production code already made.
// ---------------------------------------------------------------------------

export function recordAgentTurnDoneNotificationSeen(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.totalAgentTurnDoneNotifications += 1
}

export function recordNotifyAgentTurnDoneEntered(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.notifyAgentTurnDoneEntered += 1
}

export function recordReevaluateEntered(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.reevaluateEntered += 1
}

export function recordMarkerMissing(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.markerMissing += 1
	state.counters.lastStopReason = "marker_missing"
}

export function recordMarkerPresent(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.markerPresent += 1
}

/**
 * CORRECTION04 — record that `reevaluateDeferredCompletionBarrier`
 * has reached the active-session lookup. Increments the U2.5
 * `activeSessionLookupEntered` counter. Called exactly once per
 * reevaluation that passed the marker check (i.e., always paired
 * with `recordMarkerPresent`), BEFORE the active-session const is
 * reused by `recordActiveSessionPresent` /
 * `recordActiveSessionMissing` so the §11 invariant holds: the
 * production code reads `getActiveSession()` once, captures the
 * const, and dispatches to the appropriate record*() — no provider
 * is invoked twice.
 */
export function recordActiveSessionLookupEntered(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.activeSessionLookupEntered += 1
}

/**
 * CORRECTION04 — record that the active-session lookup returned
 * a defined session. The coordinator proceeds past the
 * `if (!activeSession) { ... return }` branch into the
 * identity-match checks. No stop reason is set here; the marker
 * has not yet been cleared by this code path.
 */
export function recordActiveSessionPresent(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.activeSessionPresent += 1
}

/**
 * CORRECTION04 — record that the active-session lookup returned
 * `undefined` / falsy. The coordinator's production code path
 * clears the deferred-completion marker and returns; this
 * discriminator captures the LIVE evidence that the marker flip
 * happened at the active-session lookup, NOT at the identity
 * mismatch checks.
 *
 * Also records `markerClearedForMissingSession` and sets
 * `lastStopReason = "active_session_missing"` so the operator
 * can classify the failure from a single dump without having to
 * cross-reference the chronology. The two increments are always
 * paired (1:1) when this branch fires.
 */
export function recordActiveSessionMissing(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.activeSessionMissing += 1
	state.counters.markerClearedForMissingSession += 1
	state.counters.lastStopReason = "active_session_missing"
}

export function recordSessionMismatch(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.sessionMismatch += 1
	state.counters.lastStopReason = "session_mismatch"
}

export function recordTaskMismatch(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.taskMismatch += 1
	state.counters.lastStopReason = "task_mismatch"
}

export function recordEpochMismatch(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.epochMismatch += 1
	state.counters.lastStopReason = "epoch_mismatch"
}

export function recordOutstandingAutonomousWork(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.outstandingAutonomousWork += 1
	state.counters.lastStopReason = "outstanding_autonomous_work"
}

export function recordOwnerStillRunning(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.ownerStillRunning += 1
	state.counters.lastStopReason = "owner_still_running"
}

export function recordUnconsumedTerminalCountRead(fact: { count: number; positive: boolean }): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.unconsumedTerminalCountLast = fact.count
	if (fact.positive) {
		state.counters.unconsumedTerminalCountPositive += 1
	}
}

export function recordNoUnconsumedTerminal(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.lastStopReason = "no_unconsumed_terminal"
}

export function recordEnqueueIfHeldEntered(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.enqueueIfHeldEntered += 1
}

export function recordHeldJobIdsRead(fact: { ids: readonly string[] }): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	const n = fact.ids.length
	state.counters.heldJobIdsCountLast = n
	if (n === 0) {
		state.counters.heldJobIdsEmpty += 1
	} else {
		state.counters.heldJobIdsNonEmpty += 1
	}
}

export function recordNoHeldJobIds(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.lastStopReason = "no_held_job_ids"
}

export function recordDedupeSuppressed(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.dedupeSuppressed += 1
	state.counters.lastStopReason = "dedupe_suppressed"
}

export function recordDedupePermitted(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.dedupePermitted += 1
}

export function recordEnqueueCompletionContinuationInvoked(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.enqueueCompletionContinuationInvoked += 1
	state.counters.lastStopReason = "enqueue_invoked"
}

export function recordAuthorityCheckReached(): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.lastStopReason = "authority_check_reached"
}

export function recordRequestedSessionMatched(matched: boolean): void {
	if (!_state.enabled) return
	const state = getOrInitState()
	state.counters.lastRequestedSessionMatched = matched
}

export function getCompletionContinuationUpstreamCounters(): CompletionContinuationUpstreamCountersSnapshot {
	const state = getOrInitState()
	return {
		totalAgentTurnDoneNotifications: state.counters.totalAgentTurnDoneNotifications,
		notifyAgentTurnDoneEntered: state.counters.notifyAgentTurnDoneEntered,
		reevaluateEntered: state.counters.reevaluateEntered,
		markerMissing: state.counters.markerMissing,
		markerPresent: state.counters.markerPresent,
		activeSessionLookupEntered: state.counters.activeSessionLookupEntered,
		activeSessionPresent: state.counters.activeSessionPresent,
		activeSessionMissing: state.counters.activeSessionMissing,
		markerClearedForMissingSession: state.counters.markerClearedForMissingSession,
		sessionMismatch: state.counters.sessionMismatch,
		taskMismatch: state.counters.taskMismatch,
		epochMismatch: state.counters.epochMismatch,
		outstandingAutonomousWork: state.counters.outstandingAutonomousWork,
		ownerStillRunning: state.counters.ownerStillRunning,
		unconsumedTerminalCountPositive: state.counters.unconsumedTerminalCountPositive,
		unconsumedTerminalCountLast: state.counters.unconsumedTerminalCountLast,
		enqueueIfHeldEntered: state.counters.enqueueIfHeldEntered,
		heldJobIdsEmpty: state.counters.heldJobIdsEmpty,
		heldJobIdsNonEmpty: state.counters.heldJobIdsNonEmpty,
		heldJobIdsCountLast: state.counters.heldJobIdsCountLast,
		dedupeSuppressed: state.counters.dedupeSuppressed,
		dedupePermitted: state.counters.dedupePermitted,
		enqueueCompletionContinuationInvoked: state.counters.enqueueCompletionContinuationInvoked,
		lastStopReason: state.counters.lastStopReason,
		lastRequestedSessionMatched: state.counters.lastRequestedSessionMatched,
	}
}

/**
 * Test-only: reset the counter snapshot to zero AND restore the
 * default-off enablement flag. Production code NEVER calls this.
 * The dump command also does NOT call this — dump != clear (no
 * counter mutation), mirroring the SHADOW / ELM authority / CCDO
 * convention.
 */
export function resetCompletionContinuationUpstreamForTests(): void {
	_state = { enabled: false, counters: freshCounters() }
}

/**
 * ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01
 *
 * TEMPORARY Cancel-pipeline liveness diagnostic counters.
 * Production-seam counters that pin the load-bearing witness
 * for the H-A vs H-B discriminator the on-call expert verdict
 * requires.
 *
 * The counters measure five sub-boundaries inside
 * `SdkTaskControlCoordinator.cancelTask()`:
 *
 *   - `cancelRequestCalls`        — `cancelTask` was entered
 *                                   (BEFORE the active-session
 *                                   guard).
 *   - `cancelAcceptedCalls`       — an active session was present
 *                                   and the fence was about to
 *                                   raise.
 *   - `abortInvokedCalls`         — `await sdkHost.abort(sessionId)`
 *                                   was about to be awaited.
 *   - `abortCompletedCalls`       — the `await sdkHost.abort(...)`
 *                                   await settled (resolved OR
 *                                   caught). The wall-clock delta
 *                                   from the matching
 *                                   `abortInvokedCalls` is
 *                                   recorded in `byActiveSession`.
 *   - `cancelPublishedCalls`      — the post-abort publication
 *                                   path completed
 *                                   (`setRunning(false)`,
 *                                   `appendAndEmit`,
 *                                   `postStateToWebview` all
 *                                   returned).
 *
 * Discrimination matrix (per ACT §5):
 *
 *   | Hypothesis | req | acc | inv | cmp | pub |
 *   |------------|-----|-----|-----|-----|-----|
 *   | Healthy    |  1  |  1  |  1  |  1  |  1  |
 *   | H-A        |  1  |  0  |  0  |  0  |  1  |
 *   | H-B        |  1  |  1  |  1  |  0  |  0  |
 *   | H-C        |  1  |  1  |  1  |  1  |  0  |
 *
 * ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01 (PTLL01-L2) CHANGED
 * THE H-A ROW from `pub=0` to `pub=1`. There is still no abort target for
 * H-A (`acc`/`inv`/`cmp` remain 0, so it stays distinguishable from Healthy and
 * H-B), but `cancelTask` now raises the cancel fence and publishes a truthful
 * `resumable` recovery phase instead of returning a no-op. Under the previous
 * `pub=0` contract the committed webview state kept saying `streaming`, so the
 * TaskHeader kept offering Working + Cancel and re-clicking re-entered the same
 * no-op — the false-Working/Cancel defect PTLL01 repairs.
 *
 * DESIGN CONSTRAINTS (frozen in this ACT, mirrors EHLOOP / CCARD
 * / BJLA / BOCOR / TSWPD / THSICAP):
 *
 *   - DEFAULT_OFF: every counter is disabled in public builds.
 *   - DOGFOOD_ONLY: enablement is wired by the central dogfood
 *     profile (no env knob, no override matrix, no parser).
 *   - BOUNDED: counters are plain numbers / bounded Maps with
 *     hard caps (MAX_BUCKETS = 32).
 *   - NO PROTOCOL FIELD: counters never serialize into proto or
 *     ExtensionState.
 *   - NO WEBVIEW FIELD: counters never appear in webview-observable
 *     state.
 *   - NO STATE-SEMANTIC DELTA: counters NEVER change observable
 *     behavior.
 *   - NO SYNCHRONOUS DISK WRITE: counters are RAM-only.
 *
 * ============================================================================
 * THIS MODULE OWERS OBSERVATION ONLY.
 * ============================================================================
 *
 * The synchronous `record*` calls in
 * `sdk-task-control-coordinator.ts:cancelTask()` are pure
 * observation — they do not gate, time, or otherwise alter the
 * production cancel path. Removing this diagnostic after
 * qualification does NOT touch the production code.
 *
 * REMOVAL_TRIGGER (per ACT §15): see the ACT body.
 */

const MAX_BUCKETS = 32

export interface CancelLivenessCounters {
	/** `cancelTask()` was entered. Pre active-session guard. */
	cancelRequestCalls: number
	/** An active session was present, the fence is about to raise. */
	cancelAcceptedCalls: number
	/** `await sdkHost.abort(sessionId)` is about to be awaited. */
	abortInvokedCalls: number
	/** The `await sdkHost.abort(sessionId)` await settled. */
	abortCompletedCalls: number
	/** Post-abort publication completed (state posted to webview). */
	cancelPublishedCalls: number
	/** Per-session abort wall-clock delta (ms) for H-B detection. */
	byActiveSession: Record<string, number>
	/** Buckets overflowed; lost distinct sessionIds after MAX_BUCKETS. */
	overflowed: number
	/** Pending abort invocations dropped after the in-flight cap. */
	pendingAbortOverflowed: number
}

let _enabled = false

let _counters: CancelLivenessCounters = freshCounters()

/**
 * Active abort invocations keyed by sessionId (for H-B wall-clock
 * detection). Capped at MAX_PENDING_ABORTS to match the
 * advertised diagnostic's bounded-observation invariant; an
 * additional session past the cap is counted in
 * `pendingAbortOverflowed` and its abort_completed delta is
 * reported as 0 (the matching t0 was dropped) so the
 * H-B signature cannot be lost in a quiet leak.
 */
const MAX_PENDING_ABORTS = MAX_BUCKETS
const _activeAbortT0BySession = new Map<string, number>()

function freshCounters(): CancelLivenessCounters {
	return {
		cancelRequestCalls: 0,
		cancelAcceptedCalls: 0,
		abortInvokedCalls: 0,
		abortCompletedCalls: 0,
		cancelPublishedCalls: 0,
		byActiveSession: {},
		overflowed: 0,
		pendingAbortOverflowed: 0,
	}
}

export function isCancelLivenessDiagnosticEnabled(): boolean {
	return _enabled
}

export function setCancelLivenessDiagnosticEnabled(enabled: boolean): void {
	_enabled = enabled
}

export function resetCancelLivenessDiagnostic(): void {
	_counters = freshCounters()
	_activeAbortT0BySession.clear()
}

/**
 * Read-only snapshot. The caller (the dump runtime + the RED
 * test) MUST NOT mutate the returned object.
 */
export function getCancelLivenessDiagnosticSnapshot(): Readonly<CancelLivenessCounters> {
	return _counters
}

function bucketFor(sessionId: string | null | undefined, deltaMs?: number): void {
	const key = sessionId ?? "<none>"
	const buckets = _counters.byActiveSession
	if (key in buckets) {
		if (typeof deltaMs === "number") {
			// Take the max so the H-B row's max-elapsed survives a
			// subsequent healthy call from the same session.
			const prev = buckets[key]!
			buckets[key] = Math.max(prev, deltaMs)
		}
	} else if (Object.keys(buckets).length < MAX_BUCKETS) {
		buckets[key] = typeof deltaMs === "number" ? deltaMs : 0
	} else {
		_counters.overflowed++
	}
}

export function recordCancelLivenessRequest(opts: {
	readonly hasActiveSession: boolean
	readonly activeSessionId: string | null
}): void {
	if (!_enabled) return
	_counters.cancelRequestCalls++
	bucketFor(opts.activeSessionId)
}

export function recordCancelLivenessAccepted(opts: { readonly activeSessionId: string }): void {
	if (!_enabled) return
	_counters.cancelAcceptedCalls++
	bucketFor(opts.activeSessionId)
}

export function recordCancelLivenessAbortInvoked(opts: { readonly activeSessionId: string; readonly now: number }): void {
	if (!_enabled) return
	_counters.abortInvokedCalls++
	// Bounded cap matches the diagnostic's advertised invariant
	// (MAX_BUCKETS). When the cap is reached, evict the oldest
	// pending entry (FIFO) so the most recent sessions retain
	// their t0 — the H-B witness is a tail signature. The
	// eviction itself is counted in `pendingAbortOverflowed`
	// so the cap event is observable.
	if (_activeAbortT0BySession.has(opts.activeSessionId)) {
		_activeAbortT0BySession.set(opts.activeSessionId, opts.now)
		return
	}
	if (_activeAbortT0BySession.size >= MAX_PENDING_ABORTS) {
		const oldest = _activeAbortT0BySession.keys().next().value
		if (oldest !== undefined) {
			_activeAbortT0BySession.delete(oldest)
		}
		_counters.pendingAbortOverflowed++
	}
	_activeAbortT0BySession.set(opts.activeSessionId, opts.now)
}

export function recordCancelLivenessAbortCompleted(opts: {
	readonly activeSessionId: string
	readonly now: number
	readonly outcome: "resolved" | "caught"
}): void {
	if (!_enabled) return
	_counters.abortCompletedCalls++
	const t0 = _activeAbortT0BySession.get(opts.activeSessionId)
	const delta = typeof t0 === "number" ? Math.max(0, opts.now - t0) : 0
	_activeAbortT0BySession.delete(opts.activeSessionId)
	bucketFor(opts.activeSessionId, delta)
}

export function recordCancelLivenessPublished(opts: { readonly activeSessionId: string }): void {
	if (!_enabled) return
	_counters.cancelPublishedCalls++
	bucketFor(opts.activeSessionId)
}

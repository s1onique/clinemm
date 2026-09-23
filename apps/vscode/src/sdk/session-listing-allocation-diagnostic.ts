/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01
 *
 * Pure counter-only causal diagnostic for the session-listing /
 * manifest-title subtree that the LIVE allocation checkpoint identified
 * as the dominant ClineMM-owned sampled allocation owner.
 *
 * SCOPE (per ACT §0, §4, §6):
 *   - Measure ACTUAL production invocation cardinality.
 *   - Caller classification is derived from EXPLICIT production call
 *     sites, NEVER from runtime stack traces.
 *   - NO record-per-call arrays, NO JSON writes, NO logging on the
 *     hot path. Only `number++` and bounded Map increments.
 *   - NO filesystem reads on the measured path.
 *   - NO crypto on the hot path. Manifest identity is the raw
 *     sessionId, retained in-process only for the bounded capture
 *     window (cleared on reset). It never leaves this process.
 *
 * LIFECYCLE (per ACT §14):
 *   - Counters are RESET when the allocator profiler trigger flips
 *     to "starting" (capture window starts).
 *   - Counters are READ at every 2-second checkpoint.
 *   - Counters are also READ at `stopSampling` final.
 *
 * OVERHEAD WHEN DISABLED (per ACT §12 + HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN P1):
 *   - When the allocation profiler is NOT armed, every increment
 *     function does ONE optional sink read + optional property
 *     lookup + return. No allocation introduced by this module.
 *   - We do NOT claim "zero cost"; we claim "no allocation expected
 *     when disabled".
 *
 * DESIGN INVARIANTS:
 *   - The increment funcs are integer-only.
 *   - The bounded maps are cleared on every reset.
 *   - Manifest identity is the RAW sessionId string. The diagnostic
 *     retains the Set only inside the capture window (≤60s + grace).
 *     No hashing, no JSON, no Logger, no Error.stack.
 *   - Caller classification uses AsyncLocalStorage (set at the
 *     extension-host call site, read at the SDK wrapper inside the
 *     same async chain). See `sdk/packages/core/src/session/services
 *     /session-listing-diagnostic-sink.ts` for the storage seam.
 */

import { SessionListingCallerClass, type SessionListingCallerClassValue, type SessionListingDiagnosticSink } from "@cline/core"

export { SessionListingCallerClass }
export type { SessionListingCallerClassValue }

/**
 * Stable human-readable name for each caller class.
 */
export function callerClassName(cls: SessionListingCallerClassValue): string {
	switch (cls) {
		case SessionListingCallerClass.WEBVIEW_STATE_PROJECTION:
			return "webview_state_projection"
		case SessionListingCallerClass.SESSION_LIST_RPC:
			return "session_list_rpc"
		case SessionListingCallerClass.SESSION_CREATED_REFRESH:
			return "session_created_refresh"
		case SessionListingCallerClass.SESSION_DELETED_REFRESH:
			return "session_deleted_refresh"
		case SessionListingCallerClass.TASK_EVENT_REFRESH:
			return "task_event_refresh"
		case SessionListingCallerClass.UNKNOWN:
			return "unknown"
		default:
			return `unknown_${cls}`
	}
}
// =============================================================================
// Counters (single mutable record, replaced on reset)
// =============================================================================

/**
 * Bounded counter record. The capture-window lifetime is bounded by
 * the allocation profiler's MAX_DURATION_MS (60s) + checkpoint
 * cadence.
 *
 * NOTE on `repeatReadsSameSessionId` (per
 * HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN P1):
 *   - "Same sessionId seen before in this capture window"
 *     DOES NOT establish "unchanged manifest re-read".
 *   - The diagnostic intentionally does NOT call this
 *     `repeatedManifestReads` because the ACT requires
 *     freshness evidence before claiming SL2 redundancy.
 *   - Until the production seam exposes a cheap freshness
 *     probe (mtime / version / sha), this counter is
 *     candidly named so it cannot be misused.
 */
export interface SessionListingAllocationCounters {
	listSessionsCalls: number
	queryAllCalls: number
	readSessionManifestTitleCalls: number
	distinctSessionIdsSeenInCapture: number
	repeatReadsSameSessionId: number
	listSessionsByCaller: Record<SessionListingCallerClassValue, number>
	sessionSetVersionChanges: number
	manifestIdentityChanges: number
	manifestReadsWithoutTitle: number
}

function freshCounters(): SessionListingAllocationCounters {
	return {
		listSessionsCalls: 0,
		queryAllCalls: 0,
		readSessionManifestTitleCalls: 0,
		distinctSessionIdsSeenInCapture: 0,
		repeatReadsSameSessionId: 0,
		listSessionsByCaller: {
			[SessionListingCallerClass.WEBVIEW_STATE_PROJECTION]: 0,
			[SessionListingCallerClass.SESSION_LIST_RPC]: 0,
			[SessionListingCallerClass.SESSION_CREATED_REFRESH]: 0,
			[SessionListingCallerClass.SESSION_DELETED_REFRESH]: 0,
			[SessionListingCallerClass.TASK_EVENT_REFRESH]: 0,
			[SessionListingCallerClass.UNKNOWN]: 0,
		},
		sessionSetVersionChanges: 0,
		manifestIdentityChanges: 0,
		manifestReadsWithoutTitle: 0,
	}
}

let _counters: SessionListingAllocationCounters = freshCounters()

/**
 * Set of raw sessionId strings whose manifest has been read at
 * least once in the current capture window. Bounded by capture
 * duration (≤60s). Cleared on reset. Never serialized.
 *
 * Per HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN P0-3: NO hashing
 * is performed on the hot path; the sessionId is stored verbatim
 * inside this Set for the lifetime of the capture window.
 */
const _sessionIdsSeen: Set<string> = new Set()

/** Optional diagnostic gate. When false, every increment is a no-op. */
let _enabled = false

// =============================================================================
// Public state machine (lifecycle)
// =============================================================================

export function isSessionListingCausalityEnabled(): boolean {
	return _enabled
}

export function enableSessionListingCausality(): void {
	_enabled = true
}

export function disableSessionListingCausality(): void {
	_enabled = false
}

export function resetSessionListingCausalityCounters(): void {
	_counters = freshCounters()
	_sessionIdsSeen.clear()
}
// =============================================================================
// Hot-path increment API (allocation-light)
// =============================================================================

/**
 * Increment `listSessionsCalls` AND `listSessionsByCaller[caller]`.
 * Caller classification is REQUIRED.
 *
 * Hot-path cost when diagnostic is ENABLED:
 *   - 1 enabled check + 2 number++ + 1 map store. No allocation.
 */
export function recordListSessionsCall(caller: SessionListingCallerClassValue): void {
	if (!_enabled) return
	_counters.listSessionsCalls += 1
	_counters.listSessionsByCaller[caller] = (_counters.listSessionsByCaller[caller] ?? 0) + 1
}

/**
 * Increment `readSessionManifestTitleCalls`. Updates
 * `distinctSessionIdsSeenInCapture`/`repeatReadsSameSessionId`.
 *
 * NO HASHING IS PERFORMED (per HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN
 * P0-3). The raw sessionId is checked against an in-process Set
 * bounded by the capture-window duration; we never serialize the
 * sessionId out of process.
 *
 * Hot-path cost when diagnostic is ENABLED:
 *   - 1 enabled check
 *   - 1 number++ (readSessionManifestTitleCalls)
 *   - 1 Set.has(sessionId)
 *   - if hit:  1 number++
 *   - if miss: 1 Set.add(sessionId) + 1 number++
 *   - if !returnedTitle: 1 number++
 */
export function recordReadSessionManifestTitleCall(sessionId: string, returnedTitle: boolean): void {
	if (!_enabled) return
	_counters.readSessionManifestTitleCalls += 1
	if (_sessionIdsSeen.has(sessionId)) {
		_counters.repeatReadsSameSessionId += 1
	} else {
		_sessionIdsSeen.add(sessionId)
		_counters.distinctSessionIdsSeenInCapture += 1
	}
	if (!returnedTitle) {
		_counters.manifestReadsWithoutTitle += 1
	}
}

export function recordQueryAllCall(): void {
	if (!_enabled) return
	_counters.queryAllCalls += 1
}

export function recordSessionSetVersionChange(): void {
	if (!_enabled) return
	_counters.sessionSetVersionChanges += 1
}

export function recordManifestIdentityChange(): void {
	if (!_enabled) return
	_counters.manifestIdentityChanges += 1
}
// =============================================================================
// Snapshot (cold path; called once per 2-second checkpoint)
// =============================================================================

export interface SessionListingCausalitySnapshot {
	enabled: boolean
	listSessionsCalls: number
	queryAllCalls: number
	readSessionManifestTitleCalls: number
	distinctSessionIdsSeenInCapture: number
	/**
	 * Same sessionId observed twice in the same capture window.
	 *
	 * Does NOT establish that the manifest is unchanged between
	 * reads. See counter-record comment for
	 * `repeatReadsSameSessionId`.
	 */
	repeatReadsSameSessionId: number
	byCaller: Readonly<Record<string, number>>
	sessionSetVersionChanges: number
	manifestIdentityChanges: number
	manifestReadsWithoutTitle: number
}

/**
 * Read-only snapshot of the counters.
 */
export function materializeSessionListingCausalitySnapshot(): SessionListingCausalitySnapshot {
	const byCaller: Record<string, number> = {}
	for (const cls of Object.values(SessionListingCallerClass)) {
		if (typeof cls !== "number") continue
		byCaller[callerClassName(cls)] = _counters.listSessionsByCaller[cls] ?? 0
	}
	return {
		enabled: _enabled,
		listSessionsCalls: _counters.listSessionsCalls,
		queryAllCalls: _counters.queryAllCalls,
		readSessionManifestTitleCalls: _counters.readSessionManifestTitleCalls,
		distinctSessionIdsSeenInCapture: _counters.distinctSessionIdsSeenInCapture,
		repeatReadsSameSessionId: _counters.repeatReadsSameSessionId,
		byCaller,
		sessionSetVersionChanges: _counters.sessionSetVersionChanges,
		manifestIdentityChanges: _counters.manifestIdentityChanges,
		manifestReadsWithoutTitle: _counters.manifestReadsWithoutTitle,
	}
}

/**
 * Test seam. Reset the diagnostic state to its post-init baseline.
 */
export function __resetSessionListingCausalityForTests(): void {
	_enabled = false
	_counters = freshCounters()
	_sessionIdsSeen.clear()
}

// =============================================================================
// Sink (for cross-boundary installation into the SDK)
// =============================================================================

/**
 * Build the production sink that the SDK wrappers call when the
 * diagnostic is installed.
 */
export function buildSessionListingDiagnosticSink(): SessionListingDiagnosticSink {
	return {
		recordListSessionsCall: (caller) => recordListSessionsCall(caller),
		recordReadSessionManifestTitleCall: (sessionId, returnedTitle) =>
			recordReadSessionManifestTitleCall(sessionId, returnedTitle),
		recordQueryAllCall: () => recordQueryAllCall(),
		recordSessionSetVersionChange: () => recordSessionSetVersionChange(),
		recordManifestIdentityChange: () => recordManifestIdentityChange(),
	}
}

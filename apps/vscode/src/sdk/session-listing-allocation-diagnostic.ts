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
 *
 * LIFECYCLE (per ACT §14):
 *   - Counters are RESET when the allocator profiler trigger flips
 *     to "starting" (capture window starts).
 *   - Counters are READ at every 2-second checkpoint.
 *   - Counters are also READ at `stopSampling` final.
 *
 * ZERO-COST WHEN DISABLED (per ACT §12):
 *   - When the allocation profiler is NOT armed, all increment
 *     functions return immediately (single boolean check).
 *
 * DESIGN INVARIANTS:
 *   - The increment funcs are integer-only.
 *   - The bounded maps are cleared on every reset.
 *   - Manifest identity is the bounded string-hash of the sessionId.
 */

import { createHash } from "node:crypto"

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
 */
export interface SessionListingAllocationCounters {
	listSessionsCalls: number
	queryAllCalls: number
	readSessionManifestTitleCalls: number
	uniqueManifestPathsSeen: number
	repeatedManifestReads: number
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
		uniqueManifestPathsSeen: 0,
		repeatedManifestReads: 0,
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
 * Set of bounded sessionId hashes whose manifest has been read at
 * least once in the current capture window.
 */
const _manifestIdsSeen: Set<string> = new Set()

/** Optional diagnostic gate. When false, every increment is a no-op. */
let _enabled = false

function identityHash(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex").slice(0, 16)
}

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
	_manifestIdsSeen.clear()
}
// =============================================================================
// Hot-path increment API (allocation-light)
// =============================================================================

/**
 * Increment `listSessionsCalls` AND `listSessionsByCaller[caller]`.
 * Caller classification is REQUIRED.
 */
export function recordListSessionsCall(caller: SessionListingCallerClassValue): void {
	if (!_enabled) return
	_counters.listSessionsCalls += 1
	_counters.listSessionsByCaller[caller] = (_counters.listSessionsByCaller[caller] ?? 0) + 1
}

/**
 * Increment `readSessionManifestTitleCalls`. Also updates the
 * identity-bound maps.
 */
export function recordReadSessionManifestTitleCall(sessionId: string, returnedTitle: boolean): void {
	if (!_enabled) return
	_counters.readSessionManifestTitleCalls += 1
	const id = identityHash(sessionId)
	if (_manifestIdsSeen.has(id)) {
		_counters.repeatedManifestReads += 1
	} else {
		_manifestIdsSeen.add(id)
		_counters.uniqueManifestPathsSeen += 1
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
	uniqueManifestIds: number
	repeatedManifestReads: number
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
		uniqueManifestIds: _counters.uniqueManifestPathsSeen,
		repeatedManifestReads: _counters.repeatedManifestReads,
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
	_manifestIdsSeen.clear()
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

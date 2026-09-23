/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01
 *
 * Production-side sink interface for the session-listing causal
 * diagnostic. Lives in `@cline/core` so the production wrappers
 * (`UnifiedSessionPersistenceService.listSessions`,
 * `SessionManifestStore.readSessionManifestTitle`,
 * `reconcileDeadSessions`) can call it without importing the
 * diagnostic module from `apps/vscode/src/sdk`.
 *
 * The diagnostic lives in the extension host and sets the sink at
 * wiring time. When the sink is undefined (default), the production
 * methods incur ONE additional `undefined`-check + nothing else.
 *
 * Caller classification uses a transient module-scoped slot: the
 * extension host sets `setActiveListSessionsCaller(class)` BEFORE
 * calling `listHistory`, and the SDK wrappers read it via
 * `consumeActiveListSessionsCaller()` so the actual
 * `recordListSessionsCall(caller)` invocation carries the right
 * class without modifying any production signature.
 */

/**
 * Caller-class integer constants. MUST stay in sync with the
 * diagnostic module's `SessionListingCallerClass` enum in
 * `apps/vscode/src/sdk/session-listing-allocation-diagnostic.ts`.
 */
export const SessionListingCallerClass = {
	WEBVIEW_STATE_PROJECTION: 0,
	SESSION_LIST_RPC: 1,
	SESSION_CREATED_REFRESH: 2,
	SESSION_DELETED_REFRESH: 3,
	TASK_EVENT_REFRESH: 4,
	UNKNOWN: 99,
} as const

export type SessionListingCallerClassValue =
	(typeof SessionListingCallerClass)[keyof typeof SessionListingCallerClass]

/**
 * Sink interface. Each method is optional and corresponds to one
 * counter increment on the diagnostic module. Optionality keeps the
 * sink allocation-free when the diagnostic is not installed.
 */
export interface SessionListingDiagnosticSink {
	readonly recordListSessionsCall?: (caller: SessionListingCallerClassValue) => void
	readonly recordReadSessionManifestTitleCall?: (
		sessionId: string,
		returnedTitle: boolean,
	) => void
	readonly recordQueryAllCall?: () => void
	readonly recordSessionSetVersionChange?: () => void
	readonly recordManifestIdentityChange?: () => void
}

let _sink: SessionListingDiagnosticSink | undefined

/**
 * Install the production sink. Called from the extension-host
 * activation wiring IF AND ONLY IF the diagnostic policy is armed.
 * Idempotent.
 */
export function setSessionListingDiagnosticSink(
	sink: SessionListingDiagnosticSink | undefined,
): void {
	_sink = sink
}

/**
 * Read the currently-installed sink. Returns `undefined` when no
 * diagnostic is installed (the production default).
 */
export function getSessionListingDiagnosticSink(): SessionListingDiagnosticSink | undefined {
	return _sink
}

/**
 * Test seam — clear the sink. Production NEVER calls this.
 */
export function __resetSessionListingDiagnosticSinkForTests(): void {
	_sink = undefined
}

// =============================================================================
// Transient caller-class slot (per ACT §11)
// =============================================================================

/**
 * Transient active-listSessions caller class. The extension host
 * sets this immediately before calling `listHistory`; the SDK
 * wrappers consume it (one-shot read) when the actual
 * `recordListSessionsCall` fires.
 *
 * RACE SAFETY: this slot is safe under JS's single-threaded
 * execution model provided the production-side helper
 * (`withListSessionsCaller(class, fn)` in
 * `apps/vscode/src/sdk/session-listing-diagnostic-runtime.ts`)
 * invokes `setActiveListSessionsCaller` SYNCHRONOUSLY before
 * returning the wrapped promise. The set MUST happen in the same
 * synchronous block as the awaited call so no other async chain
 * can interleave between the set and the SDK wrapper's read.
 */
let _activeListSessionsCaller: SessionListingCallerClassValue = SessionListingCallerClass.UNKNOWN

/**
 * Set the caller class that the NEXT `listSessions` invocation
 * should be attributed to.
 */
export function setActiveListSessionsCaller(
	caller: SessionListingCallerClassValue,
): void {
	_activeListSessionsCaller = caller
}

/**
 * Consume the caller class for the current `listSessions`
 * invocation. Returns UNKNOWN if no caller was set.
 *
 * Calling this RESETS the slot back to UNKNOWN so a missed reset
 * cannot leak the wrong class into a later call.
 */
export function consumeActiveListSessionsCaller(): SessionListingCallerClassValue {
	const cls = _activeListSessionsCaller
	_activeListSessionsCaller = SessionListingCallerClass.UNKNOWN
	return cls
}

/**
 * Peek the caller class WITHOUT consuming. Used by callers that
 * want to chain multiple calls without losing the class. Tests only.
 */
export function peekActiveListSessionsCaller(): SessionListingCallerClassValue {
	return _activeListSessionsCaller
}

/**
 * Test seam — reset the slot.
 */
export function __resetActiveListSessionsCallerForTests(): void {
	_activeListSessionsCaller = SessionListingCallerClass.UNKNOWN
}
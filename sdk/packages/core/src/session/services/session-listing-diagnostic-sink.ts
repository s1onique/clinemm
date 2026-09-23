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
 * Caller-class correlation (per HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN P0-2):
 *   - Uses `AsyncLocalStorage` to thread the active caller class
 *     through the async call chain. The producer
 *     (`withListSessionsCaller(class, fn)` in
 *     `apps/vscode/src/sdk/session-listing-diagnostic-runtime.ts`)
 *     runs the wrapped promise inside
 *     `listSessionsCallerContext.run(class, fn)` so every
 *     suspended continuation (including the deep `await`s inside
 *     `listHistory → listSessions`) reads back the SAME class.
 *   - The consumer (`consumeActiveListSessionsCaller()`) reads
 *     the currently-stored class from the ALS store. This is
 *     documented as safe across `await` boundaries per Node.js
 *     AsyncLocalStorage semantics.
 *   - There is no longer a process-global transient slot: if the
 *     caller never ran `withListSessionsCaller`, the consumer
 *     reads UNKNOWN, which is what we want for untyped traffic.
 */

import { AsyncLocalStorage } from "node:async_hooks"

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
// AsyncLocalStorage-based caller-class correlation (per ACT §11, corrected P0-2)
// =============================================================================

/**
 * AsyncLocalStorage that propagates the active-listSessions caller
 * class through the async call chain. The producer
 * (`withListSessionsCaller(class, fn)` in
 * `apps/vscode/src/sdk/session-listing-diagnostic-runtime.ts`)
 * scopes the wrapped promise inside `listSessionsCallerContext.run`,
 * so every `await` suspension inside `fn` (including the deep
 * `await this.manifestStore.readSessionManifestTitle(row.sessionId)`
 * inside `Promise.all`) sees the SAME `caller` value via
 * `consumeActiveListSessionsCaller()`. Distinct concurrent
 * callers each see their own.
 */
const listSessionsCallerContext = new AsyncLocalStorage<SessionListingCallerClassValue>()

/**
 * Consume the caller class that the CURRENT `listSessions`
 * invocation should be attributed to. Reads from the ALS store;
 * falls back to UNKNOWN if no producer is in the call chain.
 */
export function consumeActiveListSessionsCaller(): SessionListingCallerClassValue {
	return listSessionsCallerContext.getStore() ?? SessionListingCallerClass.UNKNOWN
}

/**
 * Run `fn` inside an AsyncLocalStorage scope tagged with `caller`.
 * Replaces the deprecated transient-slot setter.
 */
export function runInListSessionsCallerContext<T>(
	caller: SessionListingCallerClassValue,
	fn: () => Promise<T>,
): Promise<T> {
	return listSessionsCallerContext.run(caller, fn)
}

/**
 * Peek the caller class WITHOUT consuming. Used by diagnostic-only
 * test code that wants to inspect the ALS store directly.
 */
export function peekActiveListSessionsCaller(): SessionListingCallerClassValue {
	return consumeActiveListSessionsCaller()
}

/**
 * Test seam — clear ALS state for the current execution chain.
 * Production NEVER calls this.
 */
export function __resetActiveListSessionsCallerForTests(): void {
	listSessionsCallerContext.enterWith(SessionListingCallerClass.UNKNOWN)
}
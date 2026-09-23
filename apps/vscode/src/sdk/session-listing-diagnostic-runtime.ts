/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01
 *
 * Production wiring for the session-listing causal diagnostic. This
 * module owns the seam between the diagnostic in
 * `apps/vscode/src/sdk/session-listing-allocation-diagnostic.ts`
 * and the SDK's sink in
 * `sdk/packages/core/src/session/services/session-listing-diagnostic-sink.ts`.
 *
 * The wiring:
 *   1. Installs the sink IF AND ONLY IF the allocation profiler is armed.
 *   2. Provides `withListSessionsCaller(class, fn)` — the production-side
 *      helper that runs the wrapped call inside an AsyncLocalStorage
 *      scope tagged with `class`. The deep `await`s inside the wrapped
 *      promise read back the SAME class via
 *      `consumeActiveListSessionsCaller()`.
 *   3. Wires the diagnostic lifecycle to the allocation profiler.
 *
 * OVERHEAD (per ACT §12 + HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN P1):
 *   When the allocation profiler is NOT armed, this module does NOT
 *   install the sink. The SDK wrappers'
 *   `getSessionListingDiagnosticSink()` returns `undefined`, so the
 *   hot-path cost is one optional-property read + nothing else.
 */

import {
	__resetActiveListSessionsCallerForTests,
	__resetSessionListingDiagnosticSinkForTests,
	consumeActiveListSessionsCaller as _consumeActiveListSessionsCaller,
	runInListSessionsCallerContext as _runInListSessionsCallerContext,
	SessionListingCallerClass,
	type SessionListingCallerClassValue,
	type SessionListingDiagnosticSink,
	setSessionListingDiagnosticSink,
} from "@cline/core"

import {
	buildSessionListingDiagnosticSink,
	disableSessionListingCausality,
	enableSessionListingCausality,
	isSessionListingCausalityEnabled,
	materializeSessionListingCausalitySnapshot,
	resetSessionListingCausalityCounters,
} from "./session-listing-allocation-diagnostic"

export { buildSessionListingDiagnosticSink, setSessionListingDiagnosticSink, type SessionListingDiagnosticSink }

/**
 * Diagnostic-only re-export so callers that wrap
 * `withListSessionsCaller` can read back the SAME `caller` value
 * via the SAME module instance that issued the run.
 */
export { _consumeActiveListSessionsCaller as consumeActiveListSessionsCaller }

// =============================================================================
// Lifecycle: install / uninstall the sink
// =============================================================================

/**
 * Install the diagnostic sink into the SDK. Called from the
 * extension-host activation wiring IF AND ONLY IF the allocation
 * profiler policy is armed.
 */
export function installSessionListingCausalityDiagnostic(): void {
	setSessionListingDiagnosticSink(buildSessionListingDiagnosticSink())
}

/**
 * Uninstall the diagnostic sink.
 */
export function uninstallSessionListingCausalityDiagnostic(): void {
	setSessionListingDiagnosticSink(undefined)
	disableSessionListingCausality()
}
// =============================================================================
// Production-side helper: caller-classification wrapper
// =============================================================================

/**
 * Wrap a call to `listHistory` (or any nested call that eventually
 * reaches `UnifiedSessionPersistenceService.listSessions`) with a
 * caller-class attribution.
 *
 * RACE SAFETY (per HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN P0-2):
 *   - `runInListSessionsCallerContext(caller, fn)` runs `fn` inside
 *     an AsyncLocalStorage scope. The Node.js AsyncLocalStorage
 *     primitive is explicitly designed to preserve a store value
 *     across `await` boundaries within a single async chain.
 *   - Distinct concurrent callers each see their own class — the
 *     ALS store is RE-ENTRANT, not a process-global mutable slot.
 */
export async function withListSessionsCaller<T>(caller: SessionListingCallerClassValue, fn: () => Promise<T>): Promise<T> {
	return await _runInListSessionsCallerContext(caller, fn)
}

// =============================================================================
// Lifecycle: bind to allocation profiler
// =============================================================================

/**
 * Enable + reset the diagnostic counters. Called when the allocation
 * profiler state transitions to "starting" (capture window starts).
 */
export function armSessionListingCausalityForCapture(): void {
	enableSessionListingCausality()
	resetSessionListingCausalityCounters()
}

/**
 * Disable the diagnostic counters. Called when the allocation
 * profiler state transitions to "failed" or "finalized".
 */
export function disarmSessionListingCausalityDiagnostic(): void {
	disableSessionListingCausality()
}

/**
 * Snapshot the diagnostic counters. Called by the allocation
 * profiler during the 2-second checkpoint (cold path). Returns a
 * JSON-safe object suitable for embedding in the meta.json payload.
 */
export function snapshotSessionListingCausalityDiagnostic(): ReturnType<typeof materializeSessionListingCausalitySnapshot> {
	return materializeSessionListingCausalitySnapshot()
}

/**
 * Test seam: check whether the diagnostic is currently recording.
 */
export function isSessionListingCausalityRecording(): boolean {
	return isSessionListingCausalityEnabled()
}

/**
 * Test seam: reset the diagnostic state. Used by the focused tests.
 */
export function __resetSessionListingCausalityRuntimeForTests(): void {
	disableSessionListingCausality()
	resetSessionListingCausalityCounters()
	__resetActiveListSessionsCallerForTests()
	__resetSessionListingDiagnosticSinkForTests()
}

// Re-export the canonical caller class for convenience.
export { SessionListingCallerClass }

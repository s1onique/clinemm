/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION02:
 * production-grade canonical-event subscription helper.
 *
 * This is the single source of truth for the SdkController's
 * `attachCanonicalRuntimeEventSubscription` listener filter logic
 * (sessionId guard + delivery into the shadow boundary). The
 * SdkController owns the *unsubscribe state* (re-entrancy /
 * taskStateRuntimeEventsUnsub), but the *listener semantics* live
 * here so that production and tests invoke the SAME function.
 *
 * Why extract:
 *   - The F1-CORRECTION01 lifecycle test mirrored the controller
 *     body in the test file. A regression in production would not
 *     have been caught.
 *   - Extracting the listener filter into an exported function lets
 *     both the SdkController and the qualification test call the
 *     same implementation.
 *
 * CONTRACT — `POINT_IN_TIME` SUBSCRIPTION MODEL
 * ==============================================
 * `inner.subscribeRuntimeEvents` (where `inner` is typically the
 * `LocalRuntimeHost`) walks *currently active sessions* and
 * attaches the listener to each. It does NOT observe sessions
 * created later.
 *
 * REQUIRED CALLER INVARIANT
 * -------------------------
 * After every `startSession` / `reinit` / `setActiveSession`
 * operation, the caller MUST call
 * `subscribeCanonicalRuntimeEventsToShadow` again with the new
 * sessionId. Failure to re-attach leaves the canonical observation
 * stream silently disconnected for that session.
 *
 * In production this invariant is enforced by `SdkController`
 * (which calls `attachCanonicalRuntimeEventSubscription` from
 * `initTask`, `reinitExistingTaskFromId`, and the
 * `startNewSession` resolution callback). See
 * `apps/vscode/src/sdk/SdkController.ts:1661`.
 */
import type { AgentRuntimeEvent } from "@cline/shared"
import { subscribeRuntimeEventsThroughProxy } from "./runtime-events-proxy"
import type { TaskShadowHostWiring } from "./task-state-shadow-host-wiring"

export type Unsubscribe = () => void

/**
 * Subscribe the wiring to canonical `AgentRuntimeEvent`s delivered
 * by `inner`. Forwards only events whose `sessionId` matches the
 * supplied `sessionId` (drops stale-session events). All non-dropped
 * events reach the wiring via the typed envelope
 * `{ origin: "RUNTIME_CANONICAL", sessionId, event }`.
 *
 * Returns `() => void` — call once to unsubscribe. Calling twice is
 * harmless (the returned function is idempotent).
 */
export function subscribeCanonicalRuntimeEventsToShadow(
	inner: {
		subscribeRuntimeEvents?: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => () => void
	},
	wiring: TaskShadowHostWiring,
	sessionId: string,
): Unsubscribe {
	return subscribeRuntimeEventsThroughProxy(inner, (evtSessionId, event) => {
		if (evtSessionId && evtSessionId !== sessionId) {
			// Stale session — ignore.
			return
		}
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId,
			event,
		})
	})
}

// ===========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03:
// CanonicalRuntimeShadowSubscription owns the unsubscribe handle and is
// the single source of truth for the controller's re-attach lifecycle.
// ===========================================================================

/**
 * Owner of the canonical runtime-event subscription used by the
 * `SdkController`. The controller and the qualification test both
 * use this same object; the controller does not directly store an
 * `unsubscribe` callback anywhere.
 *
 * SEMANTIC CONTRACT
 * -----------------
 * `attach()` is the only way to obtain (or replace) the canonical
 * subscription. It always:
 *
 *   1. Disposes the existing subscription (if any) so the previous
 *      session's events stop flowing through the wiring. This is
 *      the single point at which "old subscription disposed" is
 *      enforced for the SdkController.
 *   2. Replaces the subscription with a fresh one to the supplied
 *      `host`. If the host lacks `subscribeRuntimeEvents` or the
 *      `wiring` is undefined, the owner transitions to a NO-OP
 *      state (no active listener, but the existing unsubscribe is
 *      still called).
 *
 * `dispose()` is the only way to terminate the subscription. It is
 * idempotent; calling it multiple times is safe.
 *
 * TESTING POINT_IN_TIME LIFECYCLE
 * --------------------------------
 * The owner captures the *subscriber's view*: attach returns an
 * unsubscribe function regardless of whether the host currently has
 * any active sessions (the host may expose the method even with
 * zero sessions). The session then appears, the controller calls
 * `attach()` again, and the new subscription observes.
 *
 * This faithfully reflects the documented
 * `LOCAL_RUNTIME_SUBSCRIPTION_MODEL = POINT_IN_TIME` contract:
 *   * the host method EXISTS at all times (when the host is the
 *     LocalRuntimeHost);
 *   * the host attaches the listener to CURRENTLY ACTIVE sessions;
 *   * sessions created AFTER the subscribe call require the caller
 *     to invoke `attach()` again.
 */

export interface RuntimeEventHost {
	subscribeRuntimeEvents?: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => () => void
}

export type CanonicalSessionId = string

/**
 * The owner. The `SdkController` keeps exactly one of these per
 * instance. Tests keep one of these per scenario.
 */
export class CanonicalRuntimeShadowSubscription {
	private unsubscribe: Unsubscribe | undefined

	/**
	 * Replace the active subscription.
	 *
	 *   - Disposes the previous subscription (if any).
	 *   - Calls `subscribeRuntimeEventsThroughProxy` on the new host.
	 *     If the host lacks `subscribeRuntimeEvents` or the wiring is
	 *     undefined, the owner transitions to a NO-OP state (still
	 *     returns `false` from `hasActiveListener`).
	 *
	 * Idempotent with respect to the same `(host, wiring, sessionId)`
	 * triple: the previous subscription is disposed and a fresh one
	 * is established, so the net effect is exactly one new listener.
	 */
	attach(host: RuntimeEventHost | undefined, wiring: TaskShadowHostWiring | undefined, sessionId: CanonicalSessionId): void {
		// Step 1: dispose the previous subscription so old session
		// events stop flowing. This is the single point at which
		// "old subscription disposed" is enforced.
		this.unsubscribe?.()
		this.unsubscribe = undefined

		// Step 2: replace. If anything is missing, we transition to
		// a no-op state — the owner keeps no active listener.
		if (!host?.subscribeRuntimeEvents || !wiring) {
			return
		}
		this.unsubscribe = subscribeCanonicalRuntimeEventsToShadow(host, wiring, sessionId)
	}

	/**
	 * Stop observing and drop the active subscription.
	 * Idempotent.
	 */
	dispose(): void {
		this.unsubscribe?.()
		this.unsubscribe = undefined
	}

	/**
	 * True iff the owner currently holds an active unsubscribe
	 * handle. Exposed for the qualification test (and for any future
	 * debugging surface).
	 */
	hasActiveListener(): boolean {
		return this.unsubscribe !== undefined
	}
}

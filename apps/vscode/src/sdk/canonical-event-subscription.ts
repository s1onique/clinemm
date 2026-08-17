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

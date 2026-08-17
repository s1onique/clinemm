/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
 * canonical `AgentRuntimeEvent` proxy helper.
 *
 * This is the single source of truth for the canonical-event seam
 * between `ClineCore` and any host-side observer (the VS Code
 * shadow wiring is the only current consumer).
 *
 * The function exists as an exported module (not a method body)
 * so that production `VscodeSessionHost.subscribeRuntimeEvents`
 * AND qualification tests both invoke the **same** implementation.
 * A test that re-creates the proxy body would prove nothing.
 *
 * Contract:
 *   - forwards the listener to `inner.subscribeRuntimeEvents` when
 *     present;
 *   - returns a no-op unsubscribe if the inner lacks the hook
 *     (legacy / hub mode — no fabrication);
 *   - never invokes the listener when the inner lacks the hook;
 *   - the returned unsubscribe is idempotent (calling it twice
 *     is harmless).
 */
export function subscribeRuntimeEventsThroughProxy(
	inner: {
		subscribeRuntimeEvents?: (
			listener: (sessionId: string, event: import("@cline/shared").AgentRuntimeEvent) => void,
		) => () => void
	},
	listener: (sessionId: string, event: import("@cline/shared").AgentRuntimeEvent) => void,
): () => void {
	if (!inner.subscribeRuntimeEvents) {
		return () => {}
	}
	return inner.subscribeRuntimeEvents(listener)
}

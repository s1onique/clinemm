/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * The READ-ONLY authority seam.
 *
 * This module is the ONLY place that reaches into the controller's
 * session ownership. It reads:
 *
 *   - the ACTIVE session owner  -> `SdkSessionLifecycle.getActiveSession()`
 *   - the host's own run mirror  -> `ActiveSession.isRunning`
 *   - the host's own queued count -> `ActiveSession.queuedPromptCount`
 *   - the canonical runtime state -> `VscodeSessionHost.runtimeSnapshot()`
 *       -> `ClineCore.getActiveRuntimeSnapshot()` ->
 *       `LocalRuntimeHost.getActiveRuntimeSnapshot()` ->
 *       `AgentRuntime.snapshot()`
 *
 * Every one of those is an EXISTING production surface. This module
 * creates NO session, NO runtime, NO host, and NO `ClineCore`. It
 * therefore cannot become a second execution owner.
 *
 * The `ControlSeamAuthority` interface is the seam this module
 * consumes. The controller satisfies it with closures over its own
 * private `sessions` lifecycle — the same pattern the rest of
 * `SdkController` uses (e.g. `getArbiterSnapshot` at
 * `SdkController.ts:1967`, `attachCanonicalRuntimeEventSubscription`
 * at `SdkController.ts:4552`).
 */

import type { ControlSeamRunIdentity } from "./control-seam-protocol"

/**
 * The narrow read surface the control seam needs from the controller.
 *
 * Every member is a READ. There is no mutating member, so a caller
 * holding only this interface cannot start, steer, or cancel anything.
 */
export interface ControlSeamAuthority {
	/**
	 * The active session's id, or `undefined` when no session is
	 * installed. Resolved by the controller from its own
	 * `SdkSessionLifecycle` — the client cannot supply it.
	 */
	readActiveSessionId(): string | undefined
	/**
	 * The active session's task id, or `undefined`. Resolved by the
	 * controller from the task it owns (`this.task?.taskId`).
	 */
	readActiveTaskId(): string | undefined
	/**
	 * The host's own "a run is in flight" mirror for the active
	 * session (`ActiveSession.isRunning`).
	 */
	readIsRunning(): boolean
	/**
	 * The host's own queued-prompt count for the active session
	 * (`ActiveSession.queuedPromptCount`).
	 */
	readQueuedPromptCount(): number
	/**
	 * The canonical runtime snapshot for the active session, read via
	 * the existing `runtimeSnapshot()` chain. `undefined` when the
	 * runtime has no live `AgentRuntime` instance, or when the host
	 * does not expose the canonical surface.
	 */
	readRuntimeSnapshot(): { readonly status?: string; readonly runId?: string } | undefined
}

/**
 * Build the `clinemm_get_run` payload from the authority seam.
 *
 * Returns `undefined` when there is NO active session — that is the
 * "no active run" case, and it is reported as such rather than being
 * rendered as a synthetic empty session.
 *
 * The returned payload carries identity + status only. It is validated
 * against the protocol's allow-list before it goes on the wire.
 */
export function readControlSeamRunIdentity(authority: ControlSeamAuthority): ControlSeamRunIdentity | undefined {
	const sessionId = authority.readActiveSessionId()
	if (!sessionId) {
		return undefined
	}
	const snapshot = authority.readRuntimeSnapshot()
	// The optional fields are spread in rather than assigned, so the
	// readonly shape of `ControlSeamRunIdentity` is preserved and a
	// `undefined` optional field is OMITTED from the wire payload
	// rather than serialized as `null`.
	const taskId = authority.readActiveTaskId()
	const runtimeStatus = snapshot?.status
	const runId = snapshot?.runId
	return {
		sessionId,
		running: authority.readIsRunning(),
		queuedPromptCount: authority.readQueuedPromptCount(),
		...(taskId !== undefined ? { taskId } : {}),
		...(runtimeStatus !== undefined ? { runtimeStatus } : {}),
		...(runId !== undefined ? { runId } : {}),
	}
}

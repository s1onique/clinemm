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

import { taskHeaderPhaseLabel } from "@shared/task-header-state-label"

import type { PublishedTaskState } from "@/sdk/published-task-state"

import type { ControlSeamRunIdentity, ControlSeamTaskState } from "./control-seam-protocol"

/**
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the outcome of a
 * `clinemm_start_act` request, as observed at the AUTHORITATIVE
 * lifecycle boundary.
 *
 * The authority reports what the EXISTING lifecycle decided. It does
 * not interpret, retry, or soften the result.
 */
export type ControlSeamStartActAuthorityOutcome =
	| { readonly outcome: "accepted"; readonly sessionId: string; readonly taskId?: string }
	| { readonly outcome: "rejected"; readonly reason: string }
	| { readonly outcome: "superseded"; readonly reason: string }
	| { readonly outcome: "unknown_outcome"; readonly reason: string }

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
	/**
	 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: the controller-owned,
	 * bounded record of the LAST ELIGIBLE HOST-SUBMITTED TaskHeader
	 * presentation. `undefined` when no valid published projection
	 * exists.
	 *
	 * This is a READ of an EXISTING record — it never evaluates the Elm
	 * kernel, never builds a snapshot, never posts state, and never
	 * touches the runtime.
	 */
	readPublishedTaskState(): PublishedTaskState | undefined
	/**
	 * The controller's current conversation epoch, or `undefined` when
	 * it cannot be established.
	 *
	 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: the epoch is part of the
	 * published record's identity fence. When the controller cannot
	 * establish the current epoch, the published record is treated as
	 * NOT identity-bound and `taskState` is omitted.
	 */
	readCurrentEpoch(): number | undefined
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the workspace the
	 * extension host resolved from its OWN installed-workspace owner.
	 *
	 * This is the workspace a mutation grant is bound to. The client
	 * can never SELECT a workspace: it may only ASSERT one, and the
	 * assertion is compared against this value.
	 */
	readWorkspaceRoot(): Promise<string>
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: start ONE task through
	 * the EXISTING `SdkController.initTask()` lifecycle.
	 *
	 * The implementation MUST route through the production lifecycle —
	 * it MUST NOT create a second `ClineCore`, `LocalRuntimeHost`,
	 * `SessionRuntime` or execution loop, and it MUST NOT bypass the
	 * native approval authority.
	 *
	 * The returned outcome reports what the authoritative lifecycle
	 * decided. `accepted` is returned ONLY with a REAL session id.
	 */
	startAct(input: { readonly prompt: string }): Promise<ControlSeamStartActAuthorityOutcome>
}

/**
 * Project the published TaskHeader record into the wire shape, IF AND
 * ONLY IF it is identity-bound to the CURRENT active session / task /
 * epoch.
 *
 * Returns `undefined` when:
 *   - there is no published record,
 *   - the record's session id does not match the active session id,
 *   - the record's task id does not match the active task id,
 *   - the record's epoch does not match the current epoch,
 *   - the current epoch cannot be established.
 *
 * The label is derived through the SHARED pure label projection — the
 * SAME mapping the TaskHeader renders. No second switch statement.
 */
export function projectControlSeamTaskState(
	published: PublishedTaskState | undefined,
	activeSessionId: string | undefined,
	activeTaskId: string | undefined,
	currentEpoch: number | undefined,
): ControlSeamTaskState | undefined {
	if (!published) {
		return undefined
	}
	if (!activeSessionId || published.sessionId !== activeSessionId) {
		return undefined
	}
	if (!activeTaskId || published.taskId !== activeTaskId) {
		return undefined
	}
	if (currentEpoch === undefined || published.epoch !== currentEpoch) {
		return undefined
	}
	const label = taskHeaderPhaseLabel(published.projection.phase)
	return {
		phase: published.projection.phase,
		source: published.projection.source,
		seq: published.projection.seq,
		epoch: published.epoch,
		stateVersion: published.stateVersion,
		...(label !== undefined ? { label } : {}),
	}
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
	// ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: the published TaskHeader
	// projection is a READ of an existing controller-owned record. It is
	// omitted unless it is identity-bound to the CURRENT active
	// session / task / epoch. It is NEVER derived from `running` and
	// NEVER a fabricated `idle`.
	const taskState = projectControlSeamTaskState(
		authority.readPublishedTaskState(),
		sessionId,
		taskId,
		authority.readCurrentEpoch(),
	)
	return {
		sessionId,
		running: authority.readIsRunning(),
		queuedPromptCount: authority.readQueuedPromptCount(),
		...(taskId !== undefined ? { taskId } : {}),
		...(runtimeStatus !== undefined ? { runtimeStatus } : {}),
		...(runId !== undefined ? { runId } : {}),
		...(taskState !== undefined ? { taskState } : {}),
	}
}

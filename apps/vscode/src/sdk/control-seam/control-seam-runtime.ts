/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * The controller-side runtime wiring for the embedded MCP control seam.
 *
 * This module owns:
 *
 *   - the `ControlSeamServer` (the AF_UNIX listener),
 *   - the authority closures that read the EXISTING session owner,
 *   - the start/stop lifecycle.
 *
 * It is DEFAULT OFF. When the seam is OFF, `startControlSeam()` does
 * nothing beyond resolving the enablement bit: no listener, no socket
 * file, no token file, and NO change to any task state.
 */

import { Logger } from "@shared/services/Logger"

import type { PublishedTaskState } from "@/sdk/published-task-state"

import type {
	ControlSeamAuthority,
	ControlSeamCancelAuthorityOutcome,
	ControlSeamFeedbackAuthorityOutcome,
	ControlSeamStartActAuthorityOutcome,
} from "./control-seam-authority"
import { ControlSeamEventBuffer } from "./control-seam-event-buffer"
import { ControlSeamServer, type ControlSeamServerHandle } from "./control-seam-server"

/**
 * The minimal controller surface the control seam needs.
 *
 * The READ members are reads. The two WRITE members are the EXISTING
 * production seams the first mutation vertical slice routes through:
 *
 *   - `readWorkspaceRoot` — the controller's OWN installed-workspace
 *     owner. The client may only ASSERT a workspace; it can never
 *     select one.
 *   - `startAct` — the controller's EXISTING `initTask()` lifecycle.
 *     It does NOT create a second runtime: it starts a session through
 *     the SAME `ClineCore` / `LocalRuntimeHost` / `SessionRuntime` the
 *     UI uses, and it preserves the native approval authority.
 */
export interface ControlSeamControllerSurface {
	/** The active session id, or `undefined`. */
	readActiveSessionId(): string | undefined
	/** The active task id, or `undefined`. */
	readActiveTaskId(): string | undefined
	/** The host's own "a run is in flight" mirror. */
	readIsRunning(): boolean
	/** The host's own queued-prompt count. */
	readQueuedPromptCount(): number
	/**
	 * The canonical runtime snapshot for the active session, read via
	 * the existing `runtimeSnapshot()` chain
	 * (`VscodeSessionHost` -> `ClineCore` -> `LocalRuntimeHost` ->
	 * `AgentRuntime.snapshot()`).
	 */
	readRuntimeSnapshot(): { readonly status?: string; readonly runId?: string } | undefined
	/**
	 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: the controller-owned
	 * bounded record of the last eligible host-submitted TaskHeader
	 * presentation. A READ of an existing record — it never triggers a
	 * publication.
	 */
	readPublishedTaskState(): PublishedTaskState | undefined
	/** The controller's current conversation epoch, or `undefined`. */
	readCurrentEpoch(): number | undefined
	/**
	 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: the controller's CURRENT
	 * authoritative turn phase, or `undefined`.
	 */
	readCurrentTurnPhase(): string | undefined
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the controller's OWN
	 * installed-workspace root.
	 */
	readWorkspaceRoot(): Promise<string>
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: start ONE task through
	 * the EXISTING `initTask()` lifecycle.
	 */
	startAct(input: { readonly prompt: string }): Promise<ControlSeamStartActAuthorityOutcome>
	/**
	 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: send ONE ordinary TEXT feedback
	 * message to the OWNED session through the EXISTING follow-up
	 * authority. See `ControlSeamAuthority.sendFeedback` for the
	 * approval-fence contract.
	 */
	sendFeedback(input: {
		readonly sessionId: string
		readonly expectedEpoch: number
		readonly expectedRunId?: string
		readonly text: string
	}): Promise<ControlSeamFeedbackAuthorityOutcome>
	/**
	 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: cancel the OWNED session through
	 * the EXISTING `cancelTask()` lifecycle.
	 */
	cancelRun(input: {
		readonly sessionId: string
		readonly expectedEpoch: number
		readonly expectedRunId?: string
	}): Promise<ControlSeamCancelAuthorityOutcome>
}

/**
 * Build the READ-ONLY authority from the controller surface.
 *
 * The authority is a thin projection of the surface; it adds no
 * behaviour of its own.
 */
export function createControlSeamAuthority(surface: ControlSeamControllerSurface): ControlSeamAuthority {
	return {
		readActiveSessionId: () => surface.readActiveSessionId(),
		readActiveTaskId: () => surface.readActiveTaskId(),
		readIsRunning: () => surface.readIsRunning(),
		readQueuedPromptCount: () => surface.readQueuedPromptCount(),
		readRuntimeSnapshot: () => surface.readRuntimeSnapshot(),
		readPublishedTaskState: () => surface.readPublishedTaskState(),
		readCurrentEpoch: () => surface.readCurrentEpoch(),
		readCurrentTurnPhase: () => surface.readCurrentTurnPhase(),
		readWorkspaceRoot: () => surface.readWorkspaceRoot(),
		startAct: (input) => surface.startAct(input),
		sendFeedback: (input) => surface.sendFeedback(input),
		cancelRun: (input) => surface.cancelRun(input),
	}
}

/**
 * The controller-owned control-seam runtime.
 *
 * Constructed once per controller. `start()` is idempotent; `dispose()`
 * is idempotent and removes every artifact the seam created.
 */
export class ControlSeamRuntime {
	private readonly server: ControlSeamServer
	private started = false
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the bounded buffer that
	 * retains the EXISTING production events for `clinemm_read_events`.
	 *
	 * The controller feeds it from the EXISTING `onSessionEvent`
	 * publication boundary. It is NOT a new event bus.
	 */
	readonly eventBuffer = new ControlSeamEventBuffer()

	constructor(server: ControlSeamServer) {
		this.server = server
	}

	/**
	 * Start the seam if it is enabled.
	 *
	 * Returns `undefined` when the seam is OFF or when the start
	 * failed. A start failure is logged (without the token) and never
	 * propagates into the controller's own lifecycle — a broken
	 * diagnostic seam must not take the extension host down.
	 */
	async start(): Promise<ControlSeamServerHandle | undefined> {
		if (this.started) {
			return this.server.activeHandle
		}
		this.started = true
		try {
			return await this.server.start()
		} catch (error) {
			Logger.error("[ControlSeam] failed to start:", error)
			return undefined
		}
	}

	/** The active handle, if the seam is running. */
	get activeHandle(): ControlSeamServerHandle | undefined {
		return this.server.activeHandle
	}

	/** Stop the seam and remove every artifact it created. */
	async dispose(): Promise<void> {
		this.started = false
		await this.server.dispose()
	}
}

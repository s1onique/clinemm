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

import type { ControlSeamAuthority } from "./control-seam-authority"
import { ControlSeamServer, type ControlSeamServerHandle } from "./control-seam-server"

/**
 * The minimal controller surface the control seam needs.
 *
 * Every member is a READ. The control seam has no way to start, steer,
 * or cancel a run even if it wanted to — the surface it holds does not
 * contain those operations.
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

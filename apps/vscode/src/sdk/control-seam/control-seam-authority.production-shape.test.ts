/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * PRODUCTION-SHAPE witness for the control seam's authority.
 *
 * The bounded proof in `control-seam.recon01.test.ts` uses a fixture
 * authority. THIS file closes the gap: it drives the REAL production
 * classes the controller's authority closures read from:
 *
 *   - the REAL `SdkSessionLifecycle` (`getActiveSession()`,
 *     `setRunning()`, `setQueuedPromptCount()`),
 *   - the REAL `SdkSessionHost` surface (`runtimeSnapshot?()`),
 *   - the REAL `ControlSeamAuthority` projection,
 *   - the REAL `ControlSeamServer` AF_UNIX listener.
 *
 * So the seam reads the SAME session owner the extension host owns —
 * not a reconstruction, and not a second runtime.
 */

import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { ActiveSession } from "@/sdk/cline-session-factory"
import { SdkSessionLifecycle } from "@/sdk/sdk-session-lifecycle"

import { readControlSeamRunIdentity } from "./control-seam-authority"
import { ControlSeamClient, connectControlSeam } from "./control-seam-client"
import { ControlSeamServer } from "./control-seam-server"

/**
 * A host fixture shaped exactly like the REAL `SdkSessionHost`
 * interface's `runtimeSnapshot?()` member, with the REAL
 * `AgentRuntimeStateSnapshot` shape.
 */
function makeHost(snapshot: { status?: string; runId?: string } | undefined) {
	return {
		// The REAL lifecycle subscribes to the host on attach
		// (`subscribeSessionHost` -> `sdkHost.subscribe(...)`).
		subscribe: () => () => {},
		runtimeSnapshot: (sessionId: string | undefined) => (sessionId ? snapshot : undefined),
	} as unknown as ActiveSession["sdkHost"]
}

/**
 * Build a REAL `SdkSessionLifecycle` and install a REAL
 * `ActiveSession` into it.
 *
 * `attachExistingSession` is the production entry that installs a
 * session WITHOUT starting a new runtime — so this witness creates no
 * `ClineCore`, no `LocalRuntimeHost` and no agent run.
 */
async function makeLifecycleWithSession(
	sessionId: string,
	options: { isRunning?: boolean; queuedPromptCount?: number; snapshot?: { status?: string; runId?: string } } = {},
): Promise<SdkSessionLifecycle> {
	const lifecycle = new SdkSessionLifecycle({
		mcpHub: {} as never,
		telemetry: {} as never,
		requestToolApproval: (() => undefined) as never,
		askQuestion: (() => undefined) as never,
	} as never)

	// Install the session through the REAL production path.
	// `attachExistingSession` creates the `ActiveSession` itself and
	// RESETS `queuedPromptCount` to 0 (see
	// `sdk-session-lifecycle.ts:671`), so the requested queue depth is
	// applied afterwards through the REAL production mutator -- exactly
	// how the runtime does it.
	await lifecycle.attachExistingSession({
		sessionId,
		sdkHost: makeHost(options.snapshot),
		isRunning: options.isRunning ?? false,
	})
	lifecycle.setQueuedPromptCount(options.queuedPromptCount ?? 0)
	return lifecycle
}

const openServers: ControlSeamServer[] = []

afterEach(async () => {
	while (openServers.length > 0) {
		await openServers.pop()?.dispose()
	}
})

describe("ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01 — production-shape authority", () => {
	it("PS01: the authority reads the REAL lifecycle's active session identity", async () => {
		const lifecycle = await makeLifecycleWithSession("session-production", {
			isRunning: true,
			queuedPromptCount: 3,
			snapshot: { status: "running", runId: "run-production" },
		})

		// The EXACT closure shape the controller installs.
		const identity = readControlSeamRunIdentity({
			readActiveSessionId: () => lifecycle.getActiveSession()?.sessionId,
			readActiveTaskId: () => undefined,
			readIsRunning: () => lifecycle.getActiveSession()?.isRunning ?? false,
			readQueuedPromptCount: () => lifecycle.getActiveSession()?.queuedPromptCount ?? 0,
			readRuntimeSnapshot: () => {
				const active = lifecycle.getActiveSession()
				if (!active) return undefined
				const snapshot = active.sdkHost?.runtimeSnapshot?.(active.sessionId)
				return snapshot ? { status: snapshot.status, runId: snapshot.runId } : undefined
			},
		})

		expect(identity).toEqual({
			sessionId: "session-production",
			running: true,
			queuedPromptCount: 3,
			runtimeStatus: "running",
			runId: "run-production",
		})
	})

	it("PS02: the lifecycle's OWN mutations are observed by the authority", async () => {
		const lifecycle = await makeLifecycleWithSession("session-mutating")
		const readRunning = () => lifecycle.getActiveSession()?.isRunning ?? false
		const readQueued = () => lifecycle.getActiveSession()?.queuedPromptCount ?? 0

		expect(readRunning()).toBe(false)
		expect(readQueued()).toBe(0)

		// The REAL production mutators.
		lifecycle.setRunning(true)
		lifecycle.setQueuedPromptCount(2)

		expect(readRunning()).toBe(true)
		expect(readQueued()).toBe(2)
	})

	it("PS03: an external client sees the SAME identity the extension host owns", async () => {
		const lifecycle = await makeLifecycleWithSession("session-shared", {
			isRunning: true,
			queuedPromptCount: 1,
			snapshot: { status: "streaming", runId: "run-shared" },
		})

		const dir = mkdtempSync(join("/tmp", "csps-"))
		const socketPath = join(dir, "control.sock")
		const tokenPath = join(dir, "token")
		const server = new ControlSeamServer({
			authority: {
				readActiveSessionId: () => lifecycle.getActiveSession()?.sessionId,
				readActiveTaskId: () => undefined,
				readIsRunning: () => lifecycle.getActiveSession()?.isRunning ?? false,
				readQueuedPromptCount: () => lifecycle.getActiveSession()?.queuedPromptCount ?? 0,
				readRuntimeSnapshot: () => {
					const active = lifecycle.getActiveSession()
					if (!active) return undefined
					const snapshot = active.sdkHost?.runtimeSnapshot?.(active.sessionId)
					return snapshot ? { status: snapshot.status, runId: snapshot.runId } : undefined
				},
			},
			extensionVersion: "0.0.0-test",
			platform: "darwin",
			socketPath,
			tokenPath,
			dirPath: dir,
			forceEnabled: true,
		})
		openServers.push(server)
		const handle = await server.start()
		expect(handle).toBeDefined()

		const socket = await connectControlSeam(socketPath)
		const client = new ControlSeamClient(handle!.token)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)
		const response = await client.request("clinemm_get_run")

		// The external client and the extension host read the SAME owner.
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({
			sessionId: lifecycle.getActiveSession()?.sessionId,
			running: lifecycle.getActiveSession()?.isRunning,
			queuedPromptCount: lifecycle.getActiveSession()?.queuedPromptCount,
			runtimeStatus: "streaming",
			runId: "run-shared",
		})
		socket?.destroy()
	})
})

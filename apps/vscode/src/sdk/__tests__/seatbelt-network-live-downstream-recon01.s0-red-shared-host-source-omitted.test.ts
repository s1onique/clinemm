/**
 * ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — RED (CASE S0)
 * Live host source-omitted RED.
 *
 * Live specimen (frozen at HEAD c59c835da):
 *   .cline/data/sandbox-diag/net01-20260830T133624Z.jsonl
 *     147 prepareCallId transactions
 *     ALL P3 capabilityNetwork = "deny"
 *     ALL P4 networkRule       = "(deny network*)"
 *     ALL P5 argv[1] (profilePath) == P4 profilePath (identity-bound)
 *
 * GlobalState at capture:
 *     clineVersion = "4.1.10-c59c835da"
 *     clinemmSafeYoloAllowNetwork = true
 *     clinemmSafeYoloAllowSshAgent = true
 *
 * The 5 SdkController.ts callsites each pass
 * `safeYoloCapabilitySource` correctly (production binding witness
 * CORRECTION02 c4-red). The 6th callsite — the LIVE primary session
 * host built by `SdkSessionLifecycle.getOrCreateSharedHost()` —
 * does NOT. CommandJobManager.start therefore receives
 * `safeYoloCapabilitySource = undefined`, falls through to the
 * env-only path, and yields network = "deny" regardless of UI=true.
 *
 * This RED reproduces that exact first divergence by driving the
 * actual SdkSessionLifecycle.getOrCreateSharedHost factory (mocking
 * VscodeSessionHost.create with a probe that captures whatever
 * options it was called with) and asserting that
 * `safeYoloCapabilitySource` IS forwarded.
 *
 * Pre-repair:
 *   - getOrCreateSharedHost receives options WITHOUT
 *     safeYoloCapabilitySource (because SdkSessionLifecycleOptions
 *     does not declare the field, and SdkController.ts:969 does not
 *     pass it).
 *   - RED captures the propagation gap and FAILS.
 *
 * Post-repair:
 *   - getOrCreateSharedHost forwards the supplied closure to
 *     VscodeSessionHost.create, RED PASSES, and the existing
 *     CORRECTION02 c4-red pipeline (real StateManager + production
 *     closure → backend.prepare.allow="allow") becomes
 *     end-to-end-active on the primary session host.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CommandCapability, CommandInvocation, SandboxBackend, SandboxPreparedInvocation } from "@cline/core"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { createStorageContext } from "@/shared/storage/storage-context"

interface CapturedPrepare {
	readonly cap: CommandCapability
	readonly cmd: CommandInvocation
}

function makeCaptureBackend(): SandboxBackend & { __captured: CapturedPrepare | null } {
	const capture: { current: CapturedPrepare | null } = { current: null }
	const backend = {
		id: "test-capture-net01-s0",
		__captured: null as CapturedPrepare | null,
		async isAvailable() {
			return true
		},
		async prepare(input: { capability: CommandCapability; command: CommandInvocation }): Promise<SandboxPreparedInvocation> {
			capture.current = { cap: input.capability, cmd: input.command }
			backend.__captured = capture.current
			return {
				executable: "/bin/echo",
				args: ["ok"],
				cwd: input.command.cwd,
				env: { PATH: "/usr/bin:/bin" },
				input: input.command.input,
				envSemantics: "complete",
				backendId: "test-capture-net01-s0",
				cleanup: async () => {},
			}
		},
	} as SandboxBackend & { __captured: CapturedPrepare | null }
	return backend
}

const mockCreateSessionHost = vi.hoisted(() => vi.fn())
const capturedOptions = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("../vscode-session-host", () => ({
	VscodeSessionHost: {
		create: mockCreateSessionHost,
	},
}))

describe("ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — RED (CASE S0)", () => {
	const savedEnv: Record<string, string | undefined> = {}
	const sharedDir = mkdtempSync(join(tmpdir(), "clinemm-net01-red-"))

	beforeAll(async () => {
		HostProvider.initialize(
			() => ({}) as never,
			() => ({}) as never,
			() => ({}) as never,
			{
				workspaceClient: {} as never,
				envClient: {
					getTelemetrySettings: async () => ({ isEnabled: false }),
					subscribeToTelemetrySettings: () => ({ unsubscribe: () => {} }),
					getEnvironmentDetails: async () => ({}),
					getHostVersion: async () => ({
						version: "test-host-version",
						clineVersion: "test-cline-version",
						platform: process.platform,
						clineType: "cline",
					}),
				} as never,
				windowClient: {} as never,
				diffClient: {} as never,
			} as never,
			() => {},
			async () => "",
			async () => "",
			"/tmp/mock-extension",
			"/tmp/mock-global-storage",
		)

		const ctx = createStorageContext({ clineDir: sharedDir, workspacePath: sharedDir })
		await StateManager.initialize(ctx)
	})

	afterAll(async () => {
		// StateManager.dispose is private (it owns the singleton's
		// resource lifecycle); the c4-red test relies on the
		// beforeAll-initialized singleton being torn down by file
		// delete + module reload. Just remove the tmp dir; the
		// singleton is GC'd between test files.
		rmSync(sharedDir, { recursive: true, force: true })
	})

	beforeEach(() => {
		for (const k of [
			"CLINEMM_EXPERIMENTAL_SANDBOX",
			"CLINEMM_SAFE_YOLO_NETWORK",
			"CLINEMM_SAFE_YOLO_SSH_AGENT",
		]) {
			savedEnv[k] = process.env[k]
		}
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
		delete process.env.CLINEMM_SAFE_YOLO_NETWORK
		delete process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
		mockCreateSessionHost.mockReset()
		capturedOptions.current = null
		mockCreateSessionHost.mockImplementation(async (opts: Record<string, unknown>) => {
			capturedOptions.current = opts
			return {
				inner: {},
				commandJobManager: {},
				start: async () => ({ sessionId: "sentinel-session" }),
				stop: async () => {},
				dispose: async () => {},
				subscribe: () => () => {},
				readMessages: async () => [],
				updateSessionModel: () => {},
				runtimeAddress: "sentinel-runtime",
			} as never
		})
	})

	it("RED-S0: shared host factory forwards safeYoloCapabilitySource (UI=true → network='allow' end-to-end)", async () => {
		const { SdkSessionLifecycle } = await import("../sdk-session-lifecycle")
		const { CommandJobManager } = await import("../command-job-manager")

		const sm = StateManager.get()
		sm.setGlobalState("clinemmSafeYoloAllowNetwork", true as never)
		sm.setGlobalState("clinemmSafeYoloAllowSshAgent", false as never)
		await sm.flushPendingState()
		expect(sm.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork")).toBe(true)

		const safeYoloCapabilitySource = () => ({
			network: sm.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork"),
			sshAgent: sm.getGlobalSettingsKey("clinemmSafeYoloAllowSshAgent"),
		})

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: { getServers: () => [] } as never,
			requestToolApproval: (async () => ({ approved: true })) as never,
			askQuestion: (async () => "") as never,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
			safeYoloCapabilitySource,
		})

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for the lifecycle seam
		await lifecycle.startNewSession({} as any)

		expect(capturedOptions.current, "VscodeSessionHost.create must have been called").not.toBeNull()
		const forwarded = capturedOptions.current?.safeYoloCapabilitySource
		expect(typeof forwarded, "shared host factory MUST forward safeYoloCapabilitySource").toBe("function")

		const snap = (forwarded as () => { network: boolean | undefined; sshAgent: boolean | undefined })()
		expect(snap.network, "forwarded closure must read StateManager.clinemmSafeYoloAllowNetwork=true").toBe(true)
		expect(snap.sshAgent).toBe(false)

		const backend = makeCaptureBackend()
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: ["/tmp"],
			safeYoloCapabilitySource: forwarded as never,
			sandboxBackendResolver: async () => backend,
		})
		await manager.start({
			command: "/bin/echo net01-red",
			cwd: "/tmp",
			executionDeadlineMs: 5_000,
			waitBudgetMs: 1_000,
		})
		expect(
			backend.__captured?.cap.network,
			"REAL StateManager=true → shared host → CommandJobManager → prepare MUST yield 'allow'",
		).toBe("allow")
	})

	it("RED-S0-CARDINALITY: shared host factory forwards safeYoloCapabilitySource such that CommandJobManager calls the source exactly once per command build", async () => {
		const { SdkSessionLifecycle } = await import("../sdk-session-lifecycle")
		const { CommandJobManager } = await import("../command-job-manager")

		const sm = StateManager.get()
		sm.setGlobalState("clinemmSafeYoloAllowNetwork", true as never)
		sm.setGlobalState("clinemmSafeYoloAllowSshAgent", false as never)
		await sm.flushPendingState()

		let sourceCallCount = 0
		const safeYoloCapabilitySource = () => {
			sourceCallCount++
			return {
				network: sm.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork"),
				sshAgent: sm.getGlobalSettingsKey("clinemmSafeYoloAllowSshAgent"),
			}
		}

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: { getServers: () => [] } as never,
			requestToolApproval: (async () => ({ approved: true })) as never,
			askQuestion: (async () => "") as never,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
			safeYoloCapabilitySource,
		})

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for the lifecycle seam
		await lifecycle.startNewSession({} as any)
		expect(sourceCallCount, "construction does not invoke the source").toBe(0)

		const forwarded = capturedOptions.current?.safeYoloCapabilitySource
		expect(typeof forwarded).toBe("function")

		const backend = makeCaptureBackend()
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: ["/tmp"],
			// biome-ignore lint/suspicious/noExplicitAny: forwarded source
			safeYoloCapabilitySource: forwarded as any,
			sandboxBackendResolver: async () => backend,
		})

		await manager.start({
			command: "/bin/echo cardinality",
			cwd: "/tmp",
			executionDeadlineMs: 5_000,
			waitBudgetMs: 1_000,
		})

		expect(
			sourceCallCount,
			"source evaluated exactly once per command build (NOT twice — diagnostic cardinality conservation)",
		).toBe(1)
	})
})

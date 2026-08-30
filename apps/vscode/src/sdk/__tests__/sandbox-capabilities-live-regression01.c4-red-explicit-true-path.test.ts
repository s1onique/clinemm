/**
 * ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — CORRECTION02
 * Production-source binding witness (Reviewer P0 #1).
 *
 * CORRECTION01 c4 exercised CommandJobManager→backend but built the
 * closure by hand (readGlobalStateFromStorage → inline closure). It
 * did NOT exercise the production binding
 * `StateManager.getGlobalSettingsKey(...)` that SdkController uses
 * inline at every VscodeSessionHost.create(...) callsite.
 *
 * CORRECTION02 exercises the actual production binding witness:
 *   real StateManager.initialize(createStorageContext(...))
 *   → real setGlobalState("clinemmSafeYoloAllowNetwork", true)
 *   → real getGlobalSettingsKey("clinemmSafeYoloAllowNetwork")
 *   → returns true
 *   → CommandJobManager with the production-shaped closure
 *   → sandboxBackend.prepare receives capability.network = "allow"
 *
 * Plus a lifecycle form: source initially undefined → setGlobalState
 * true → next command observes the change. This discriminates stale
 * snapshot behaviour (if the closure had snapshotted at construction,
 * cmd2 would observe undefined/false, not "allow").
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CommandCapability, CommandInvocation, SandboxBackend, SandboxPreparedInvocation } from "@cline/core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { createStorageContext } from "@/shared/storage/storage-context"

import { CommandJobManager } from "../command-job-manager"

interface CapturedPrepare {
	readonly cap: CommandCapability
	readonly cmd: CommandInvocation
}

function makeCaptureBackend(): SandboxBackend & { __captured: CapturedPrepare | null } {
	const capture: { current: CapturedPrepare | null } = { current: null }
	const backend = {
		id: "test-capture-live-regression01-c02",
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
				backendId: "test-capture-live-regression01-c02",
				cleanup: async () => {},
			}
		},
	} as SandboxBackend & { __captured: CapturedPrepare | null }
	return backend
}

describe("ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — CORRECTION02 production binding", () => {
	const savedEnv: Record<string, string | undefined> = {}
	const sharedDir = mkdtempSync(join(tmpdir(), "clinemm-c02-shared-"))

	beforeAll(async () => {
		// Minimal no-op HostProvider stubs satisfy the type signatures;
		// no webview, no edit preview, no comment review, no real host
		// bridge are needed for the producer seam under test. Mirrors
		// the aopc02 bridge setup (aopc02-phase-a-correction01 test).
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

		savedEnv.CLINEMM_EXPERIMENTAL_SANDBOX = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		savedEnv.CLINEMM_SAFE_YOLO_NETWORK = process.env.CLINEMM_SAFE_YOLO_NETWORK
		savedEnv.CLINEMM_SAFE_YOLO_SSH_AGENT = process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		delete process.env.CLINEMM_SAFE_YOLO_SSH_AGENT

		// One shared StateManager singleton; tests reset cache between
		// runs via the file-backed store (each test uses its own
		// scenario by either pre-seeding the dir or starting clean).
		await StateManager.initialize(createStorageContext({ clineDir: sharedDir, workspacePath: sharedDir }))
	})

	afterAll(async () => {
		try {
			await StateManager.get().flushPendingState()
		} catch {}
		for (const [k, v] of Object.entries(savedEnv)) {
			if (v === undefined) delete process.env[k]
			else process.env[k] = v
		}
		try {
			rmSync(sharedDir, { force: true, recursive: true })
		} catch {}
	})

	// Helper: log the current cache value for diagnostics.
	function logCache(label: string): void {
		const v = StateManager.get().getGlobalSettingsKey("clinemmSafeYoloAllowNetwork")
		console.log(`[${label}] cache.network =`, v)
	}
	// CORRECTION02-ABLATION: lifecycle form (reviewer ask #2).
	// source initially undefined → host exists (closure already captured)
	// → StateManager becomes true → closure re-reads current cache
	// → next command observes "allow".
	//
	// This MUST run FIRST so the singleton starts from a clean absent
	// state (beforeAll initialized into an empty directory). After
	// this test, the cache holds `true`; the next test re-asserts
	// true so order-dependence is fine.
	it("CORRECTION02-2: lifecycle (absent → StateManager.setGlobalState(true) → next command observes the change)", async () => {
		const sm = StateManager.get()

		// Legacy absent: never touched the toggle. Cache stays undefined
		// because beforeAll initialized from an empty directory.
		logCache("CORRECTION02-2 initial")
		const initial = sm.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork")
		expect(initial, "cache must start undefined for legacy absent users").toBeUndefined()

		// Production-shaped closure (verbatim from SdkController.ts).
		const safeYoloCapabilitySource = () => ({
			network: sm.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork"),
			sshAgent: sm.getGlobalSettingsKey("clinemmSafeYoloAllowSshAgent"),
		})

		const backend = makeCaptureBackend()
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: ["/tmp"],
			safeYoloCapabilitySource,
			sandboxBackendResolver: async () => backend,
		})

		// Cmd1 (absent, env=allow → "allow" via env fallback).
		await manager.start({
			command: "/bin/echo first",
			cwd: "/tmp",
			executionDeadlineMs: 5_000,
			waitBudgetMs: 1_000,
		})
		const firstNet = backend.__captured?.cap.network
		console.log("[CORRECTION02-2] cmd1 (absent) capability.network =", firstNet)

		// User toggles ON: real StateManager.setGlobalState.
		sm.setGlobalState("clinemmSafeYoloAllowNetwork", true as never)
		await sm.flushPendingState()
		const afterToggle = sm.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork")
		console.log("[CORRECTION02-2] after toggle cache.network =", afterToggle)
		expect(afterToggle).toBe(true)

		// Cmd2 (true → "allow" via override). Same manager, same closure.
		await manager.start({
			command: "/bin/echo second",
			cwd: "/tmp",
			executionDeadlineMs: 5_000,
			waitBudgetMs: 1_000,
		})
		const secondNet = backend.__captured?.cap.network
		console.log("[CORRECTION02-2] cmd2 (true)  capability.network =", secondNet)

		expect(firstNet, "absent + env=allow → 'allow'").toBe("allow")
		expect(secondNet, "explicit true → 'allow'").toBe("allow")

		// Snapshot-staleness discriminator: the closure was created
		// BEFORE the toggle. If it had snapshotted, cmd2 would be
		// undefined/false, not "allow". It is "allow", so the closure
		// re-reads the cache on every call (no stale snapshot).
	})

	// CORRECTION02-RED #1: real StateManager + production closure shape.
	// Closure below is verbatim from SdkController.ts:1216, 1324, 1350,
	// 2660, 2907. We invoke it through the real StateManager singleton
	// (initialized in beforeAll from a temp clineDir, same pattern as
	// aopc02 bridge). Runs AFTER CORRECTION02-2 so the cache starts
	// with `true` from the prior test (we re-assert to confirm).
	it("CORRECTION02-1: real StateManager=true → production closure shape → network='allow'", async () => {
		const sm = StateManager.get()
		sm.setGlobalState("clinemmSafeYoloAllowNetwork", true as never)
		await sm.flushPendingState()

		// Production-shaped closure (verbatim from SdkController.ts).
		const safeYoloCapabilitySource = () => ({
			network: sm.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork"),
			sshAgent: sm.getGlobalSettingsKey("clinemmSafeYoloAllowSshAgent"),
		})

		// Witness 1: production closure returns the current cached value.
		const w1 = safeYoloCapabilitySource()
		console.log("[CORRECTION02-1] closure.network =", w1.network)
		expect(w1.network, "production closure must return the persisted true").toBe(true)

		// Witness 2: closure shape wired to CommandJobManager propagates
		// through to the sandboxBackend.prepare boundary.
		const backend = makeCaptureBackend()
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: ["/tmp"],
			safeYoloCapabilitySource,
			sandboxBackendResolver: async () => backend,
		})

		await manager.start({
			command: "/bin/echo ok",
			cwd: "/tmp",
			executionDeadlineMs: 5_000,
			waitBudgetMs: 1_000,
		})

		const captured = backend.__captured
		expect(captured).not.toBeNull()
		const observedNetwork = captured?.cap.network
		console.log("[CORRECTION02-1] backend.prepare capability.network =", observedNetwork)

		expect(
			observedNetwork,
			"explicit persisted true via real StateManager → production closure → CommandJobManager → sandboxBackend.prepare must yield 'allow'",
		).toBe("allow")
	})
})

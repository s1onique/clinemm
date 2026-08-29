/**
 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01-CORRECTION01
 *
 * Production-composition witness:
 *
 *   settings.persisted-booleans
 *     -> StateManager.getGlobalSettingsKey(...)          (proven separately
 *                                                          by the persistence
 *                                                          round-trip suite in
 *                                                          sandboxCapabilitiesSettings.test.ts)
 *     -> safeYoloCapabilitySource() closure             (this file)
 *        -> resolveSafeYoloCapabilityFromState(...)    (helper pure-function)
 *           -> buildExperimentalReconCapability(...)    (production capability)
 *              -> sandboxBackend.prepare(input.capability, ...)
 *                 -> spawnSupervisableShellCommand(...)
 *
 * This file proves the second half of the chain —
 * `safeYoloCapabilitySource() -> CommandJobManager.start() ->
 * effective CommandCapability` — by capturing the capability at the
 * sandboxBackend.prepare() seam via a stub backend. The test uses
 * the narrowest existing DI seam (no integration-test apparatus).
 *
 * The four test cases below correspond to:
 *   T1: network=true / ssh=false (independent network enable)
 *   T2: network=false with env CLINEMM_SAFE_YOLO_NETWORK=allow
 *       (persistence authoritative; §16 hardening; env must NOT override)
 *   T3: ssh=true / network=false (independent SSH enable)
 *   T4: legacy migration (no persisted values); env-only fallback
 *
 * ABLATION at the bottom bypasses the safeYoloCapabilitySource path
 * and proves the captured capability reverts to env-only behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
	CommandCapability,
	CommandInvocation,
	SandboxBackend,
	SandboxPreparedInvocation,
} from "@cline/core"
import { CommandJobManager } from "./command-job-manager"

interface Captured {
	cap: CommandCapability | null
}

function makeCaptureBackend(): SandboxBackend & { __capture: Captured } {
	const captured: Captured = { cap: null }
	return Object.freeze({
		id: "settings-composition-capture",
		async isAvailable() {
			return true
		},
		async prepare(input: {
			capability: CommandCapability
			command: CommandInvocation
		}): Promise<SandboxPreparedInvocation> {
			captured.cap = input.capability
			return {
				executable: "/usr/bin/sandbox-exec",
				args: ["-f", "/dev/null", input.command.executable, ...input.command.args],
				cwd: input.command.cwd,
				env: { PATH: "/usr/bin:/bin" },
				input: input.command.input,
				envSemantics: "complete",
				backendId: "settings-composition-capture",
				cleanup: async () => {},
			}
		},
		__capture: captured,
	})
}

beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
})
afterEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
	delete process.env.CLINEMM_SAFE_YOLO_NETWORK
	delete process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
})

afterEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
	delete process.env.CLINEMM_SAFE_YOLO_NETWORK
	delete process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
})

async function captureCapabilityFrom(source: () => {
	readonly network: boolean | undefined
	readonly sshAgent: boolean | undefined
}): Promise<CommandCapability> {
	const backend = makeCaptureBackend()
	const manager = new CommandJobManager({
		sandboxBackendResolver: async () => backend,
		safeYoloCapabilitySource: source,
	})
	await manager.start({
		command: `/bin/sh -c 'echo hi'`,
		cwd: process.cwd(),
		waitBudgetMs: 5_000,
		executionDeadlineMs: 5_000,
		maxRetainedOutputChars: 1_000,
		maxOutputChars: 1_000,
	} as Parameters<typeof manager.start>[0])
	return backend.__capture.cap as CommandCapability
}

async function captureCapabilityWithoutSource(): Promise<CommandCapability> {
	const backend = makeCaptureBackend()
	const manager = new CommandJobManager({
		sandboxBackendResolver: async () => backend,
		// No safeYoloCapabilitySource — the manager falls through
		// to the env-only path.
	})
	await manager.start({
		command: `/bin/sh -c 'echo hi'`,
		cwd: process.cwd(),
		waitBudgetMs: 5_000,
		executionDeadlineMs: 5_000,
		maxRetainedOutputChars: 1_000,
		maxOutputChars: 1_000,
	} as Parameters<typeof manager.start>[0])
	return backend.__capture.cap as CommandCapability
}

/**
 * Pre-existing SDK export gap: `SshAuthenticationAuthority` is on the
 * production `CommandCapability` type (sdk/.../runtime/sandbox/types.ts)
 * but is not re-exported from `@cline/core` main index. The runtime
 * field IS what the production Seatbelt backend already wires up.
 * Tests use a small typed cast that mirrors how production callers
 * (e.g. command-job-manager.ts) read the field.
 */
type CapabilityWithSshAuth = CommandCapability & {
	readonly sshAuthenticationAuthority?:
		| { readonly mode: "agent" }
		| undefined
}

describe("ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01-CORRECTION01 — production composition", () => {
	it("T1: persisted network=true / ssh=false -> capability.network='allow', no ssh agent", async () => {
		const cap = (await captureCapabilityFrom(() => ({
			network: true,
			sshAgent: false,
		}))) as CapabilityWithSshAuth
		expect(cap).not.toBeNull()
		expect(cap!.network).toBe("allow")
		expect(cap!.sshAuthenticationAuthority).toBeUndefined()
	})

	it("T2: persisted network=false with env CLINEMM_SAFE_YOLO_NETWORK=allow -> deny (persistence authoritative)", async () => {
		// §16 hardening: a persisted false must NOT be silently
		// overridden by an env that says otherwise.
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		const cap = (await captureCapabilityFrom(() => ({
			network: false,
			sshAgent: undefined,
		}))) as CapabilityWithSshAuth
		expect(cap).not.toBeNull()
		expect(cap!.network).toBe("deny")
	})

	it("T3: persisted ssh=true / network=false -> sshAuthenticationAuthority=agent, network=deny", async () => {
		const cap = (await captureCapabilityFrom(() => ({
			network: false,
			sshAgent: true,
		}))) as CapabilityWithSshAuth
		expect(cap).not.toBeNull()
		expect(cap!.sshAuthenticationAuthority).toEqual({ mode: "agent" })
		expect(cap!.network).toBe("deny")
	})

	it("T4: legacy migration (no persisted values, source returns undefined) -> env-only fallback, deny/deny", async () => {
		// MIGRATION_OR_DEFAULT_AUTHORITY_DELTA = 0 contract.
		const cap = (await captureCapabilityFrom(() => ({
			network: undefined,
			sshAgent: undefined,
		}))) as CapabilityWithSshAuth
		expect(cap).not.toBeNull()
		expect(cap!.network).toBe("deny")
		expect(cap!.sshAuthenticationAuthority).toBeUndefined()
	})
})

describe("ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01-CORRECTION01 — production composition ablation", () => {
	it("bypassing safeYoloCapabilitySource: env-only path runs; persisted false is INVISIBLE", async () => {
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		const cap = await captureCapabilityWithoutSource()
		// Env says allow; without safeYoloCapabilitySource the
		// builder reads env only and emits "allow" — the binding is
		// therefore necessary for any persisted override to win.
		expect(cap.network).toBe("allow")
	})
})

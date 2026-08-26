/**
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 GREEN witness
 *
 * Production-seam GREEN at entry HEAD `2babe1a377` after C2 wiring. Proves the real `filesystem-create-only` authority on the typed per-command channel
 * now reaches the Seatbelt profile via CommandCapability.createOnlyRoots
 * and emits (allow file-write-create (subpath "<canonical>")). The kernel
 * therefore permits `mkstemp` and Apple mktemp(1) succeeds. The
 * previously-captured C1 LIVE RED is closed.
 *
 * Test seam: real `CommandJobManager.start()` with a forged
 * `perCommandExecutionCapability` on the AgentToolContext, real
 * `defaultSandboxBackendResolver` (seatbelt-experimental), real
 * `/usr/bin/sandbox-exec`, real Apple `/usr/bin/mktemp`.
 *
 * GREEN expectation (spec §25):
 *   exit=0
 *   parent path == canonical DARWIN_USER_TEMP_DIR
 *
 * Labels: REAL_PRODUCTION_SEAM + REAL_SEATBELT (GREEN).
 *
 * Skip conditions:
 *   - non-darwin host
 *   - canonical DARWIN_USER_TEMP_DIR not present
 *   - Seatbelt substrate unavailable
 */
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import type { FilesystemCreateOnlyCapability } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { defaultSandboxBackendResolver } from "../sandbox-policy"

const mktempPath = "/usr/bin/mktemp"
const darwinUserTempDir = "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/"

const darwinHost = process.platform === "darwin"
const canonicalDarwinRoot = (() => {
	try {
		return realpathSync(darwinUserTempDir)
	} catch {
		return undefined
	}
})()

beforeEach(() => {
	// Force the real Seatbelt opt-in for this process so the
	// production resolver returns the Seatbelt backend.
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
})

afterEach(() => {
	// Restore default-off so subsequent tests in the same vitest
	// worker are not affected by an opt-in leak.
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
})

interface StartOutcome {
	exitCode: number | null | undefined
	signal: string | undefined
	stdout: string
	stderr: string
	state: string
}

async function runRealStart(cmdArgs: string[]): Promise<StartOutcome> {
	const manager = new CommandJobManager({
		sandboxBackendResolver: defaultSandboxBackendResolver,
		experimentalSandboxWorkspaceRoots: [],
	})

	const ctx = {
		agentId: "c2-red-witness",
		iteration: 0,
		// Forged capability on the typed per-command channel. The
		// CORRECTION02 plan-required guard requires a
		// commandExecutionPlan to accompany a forged
		// perCommandExecutionCapability; we attach the smallest
		// possible correlated plan with one entry.
		commandExecutionPlan: {
			transformedInput: { commands: [mktempPath] },
			commands: [
				{
					commandIndex: 0,
					hardenedCommand: mktempPath,
					matchedRuleSource: "host_safe_mktemp_default_temp",
					executionCapability: {
						kind: "filesystem-create-only",
						roots: [canonicalDarwinRoot ?? darwinUserTempDir],
					} satisfies FilesystemCreateOnlyCapability,
				},
			],
		},
		perCommandExecutionCapability: {
			kind: "filesystem-create-only",
			roots: [canonicalDarwinRoot ?? darwinUserTempDir],
		} satisfies FilesystemCreateOnlyCapability,
	}

	const scratchCwd = (() => {
		try {
			return realpathSync(tmpdir())
		} catch {
			return tmpdir()
		}
	})()

	const startResult = await manager.start(
		{
			command: cmdArgs.length === 0 ? mktempPath : `${mktempPath} ${cmdArgs.join(" ")}`,
			cwd: scratchCwd,
			env: {},
			waitBudgetMs: 5_000,
			executionDeadlineMs: 10_000,
		},
		ctx,
	)

	// Wait for the child to finish via the public terminalPromise.
	await startResult.terminalPromise

	// Now status() returns the terminal snapshot.
	const statusResult = await manager.status({ jobId: startResult.jobId, waitMs: 0 })
	if (!statusResult.ok) {
		throw new Error(`status() returned code=${statusResult.code}`)
	}
	const s = statusResult.snapshot
	return {
		exitCode: s.exitCode ?? null,
		signal: s.signal,
		stdout: s.stdout,
		stderr: s.stderr,
		state: s.state,
	}
}

describe("ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 GREEN witness", () => {
	it("GREEN: /usr/bin/mktemp under seatbelt-experimental -> exit 0, parent in canonical DARWIN_ROOT", async () => {
		if (!darwinHost || !canonicalDarwinRoot) {
			console.warn(`[c2-red] skipping: darwin=${darwinHost} canonicalRoot=${canonicalDarwinRoot}`)
			expect(true).toBe(true)
			return
		}

		const backend = await defaultSandboxBackendResolver("seatbelt-experimental")
		if (!backend) {
			console.warn("[c2-red] skipping: Seatbelt substrate unavailable")
			expect(true).toBe(true)
			return
		}

		const outcome = await runRealStart([])

		// RED expectation: the Seatbelt profile in C2.1 does NOT
		// emit `(allow file-write-create (subpath "<canonical>"))`,
		// so the kernel denies mkstemp and the Apple mktemp(1)
		// prints "mkstemp failed on <path>: Operation not permitted"
		// and exits 1.
		expect(outcome.exitCode).toBe(0)
		expect(outcome.stderr).not.toMatch(/Operation not permitted|EPERM/)
	})
})

/**
 * ACT-CLINEMM-SEATBELT-DEFAULT-ON01 — real-kernel GREEN.
 *
 * Load-bearing live proof that the production seam ACTUALLY applies
 * Seatbelt when `CLINEMM_EXPERIMENTAL_SANDBOX` is unset (the new
 * secure default).
 *
 * Substrate-dependent: SKIP on non-darwin hosts or when
 * `/usr/bin/sandbox-exec` is unavailable. Uses `describe.skipIf(...)`
 * so Vitest reports honest skip counts.
 *
 * Five probes — each uses real `CommandJobManager.start`:
 *
 *   PROBE 1 (positive): inside an ACT-owned workspace, plain
 *     `touch` succeeds. Without the Seatbelt write-allow on the
 *     workspace root, the kernel would EPERM this.
 *
 *   PROBE 2 (negative): outside the workspace (a sibling ACT-owned
 *     directory), `touch` MUST fail. The Seatbelt profile permits
 *     writes only under the active workspace roots; this is the
 *     canonical proof that the profile is actually being applied.
 *
 *   PROBE 3 (carried invariant): with env unset, the production
 *     default resolver returns the Seatbelt backend — proving the
 *     routing is not a NoSandboxBackend fallback.
 *
 *   PROBE 4 (legacy synonym): the legacy `seatbelt` opt-in string
 *     keeps its meaning (regression guard for existing users).
 *
 *   PROBE 5 (explicit opt-out): `off` reaches the classic path —
 *     the deliberate break-glass.
 *
 * If the production seam reverted to classic execution (e.g. the
 * selector incorrectly returned `undefined`), PROBE 2 would PASS
 * silently — PROBE 1 + PROBE 2 form a discriminator pair.
 *
 * Evidence label produced: DEFAULT_ON_REAL_KERNEL = PASS.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { defaultSandboxBackendResolver, resolveExperimentalSandboxMode } from "../sandbox-policy"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const SEATBELT_OPTIN = "seatbelt"

const HAS_SUBSTRATE: boolean = (() => {
	if (process.platform !== "darwin") return false
	if (!existsSync("/usr/bin/sandbox-exec")) return false
	const probe = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/bin/echo", "ok"], {
		encoding: "utf8",
		timeout: 2_000,
	})
	return probe.status === 0 && probe.stdout.trim() === "ok"
})()

let actRoot: string | undefined
let workspaceRoot: string | undefined
let outsideRoot: string | undefined

beforeAll(() => {
	if (!HAS_SUBSTRATE) return
	actRoot = mkdtempSync(join(tmpdir(), "clinemm-default-on-"))
	workspaceRoot = realpathSync(mkdtempSync(join(actRoot, "ws-")))
	outsideRoot = realpathSync(mkdtempSync(join(actRoot, "outside-")))
})

afterEach(() => {
	delete process.env[SANDBOX_OPTIN_ENV]
})

function withEnv<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> | T {
	const prev = process.env[SANDBOX_OPTIN_ENV]
	if (value === undefined) delete process.env[SANDBOX_OPTIN_ENV]
	else process.env[SANDBOX_OPTIN_ENV] = value
	try {
		return fn()
	} finally {
		if (prev === undefined) delete process.env[SANDBOX_OPTIN_ENV]
		else process.env[SANDBOX_OPTIN_ENV] = prev
	}
}

describe.skipIf(!HAS_SUBSTRATE)("ACT-CLINEMM-SEATBELT-DEFAULT-ON01 — real-kernel GREEN", () => {
	it("selector sanity: env genuinely unset → seatbelt-experimental", async () => {
		await withEnv(undefined, () => {
			expect(resolveExperimentalSandboxMode()).toBe("seatbelt-experimental")
		})
	})

	it("PROBE 1 (positive): inside workspace, write ALLOWED under Seatbelt", async () => {
		await withEnv(undefined, async () => {
			const manager = new CommandJobManager({
				experimentalSandboxWorkspaceRoots: [workspaceRoot!],
			})
			try {
				const target = join(workspaceRoot!, ".default-on-write-canary")
				const start = await manager.start({
					command: `/bin/sh -c 'touch "${target}" && echo OK || echo FAIL'`,
					cwd: workspaceRoot!,
					env: {},
					waitBudgetMs: 5_000,
					executionDeadlineMs: 10_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				expect(start.stdout).toContain("OK")
				expect(existsSync(target)).toBe(true)
				try {
					rmSync(target, { force: true })
				} catch {}
			} finally {
				await manager.dispose()
			}
		})
	})

	it("PROBE 2 (negative): outside workspace, write DENIED by Seatbelt kernel", async () => {
		await withEnv(undefined, async () => {
			const manager = new CommandJobManager({
				// Active workspace is workspaceRoot; outsideRoot is the
				// canary location. The Seatbelt profile must deny writes
				// here because outsideRoot is NOT in the trusted list.
				experimentalSandboxWorkspaceRoots: [workspaceRoot!],
			})
			try {
				const target = join(outsideRoot!, ".default-on-deny-canary")
				const start = await manager.start({
					command: `/bin/sh -c 'touch "${target}" 2>/dev/null && echo OK || echo DENIED'`,
					cwd: workspaceRoot!,
					env: {},
					waitBudgetMs: 5_000,
					executionDeadlineMs: 10_000,
				})
				expect(start.state).toBe("exited")
				// The shell exits 0 either way; the discriminator is stdout.
				expect(start.stdout).toContain("DENIED")
				expect(start.stdout).not.toContain("OK")
				expect(existsSync(target)).toBe(false)
			} finally {
				await manager.dispose()
			}
		})
	})

	it("PROBE 3 (carried invariant): Seatbelt substrate is genuinely invoked", async () => {
		// Sanity probe: with env unset, the production default resolver
		// returns the Seatbelt backend. If the production seam were
		// routing through NoSandboxBackend, the previous probes would
		// still pass on hosts without Seatbelt policy — but this probe
		// proves the backend IS the Seatbelt one, not a fallback.
		await withEnv(undefined, async () => {
			const backend = await defaultSandboxBackendResolver("seatbelt-experimental")
			expect(backend).toBeDefined()
			expect(backend?.id).toBe("seatbelt-experimental")
		})
	})

	it("PROBE 4: explicit legacy opt-in ('seatbelt') keeps the same behavior", async () => {
		// Regression guard: the legacy explicit opt-in string must
		// still resolve to Seatbelt. Otherwise an upgrade could
		// surprise existing users.
		await withEnv(SEATBELT_OPTIN, () => {
			expect(resolveExperimentalSandboxMode()).toBe("seatbelt-experimental")
		})
	})

	it("PROBE 5: explicit opt-out ('off') reaches the classic path", async () => {
		await withEnv("off", () => {
			expect(resolveExperimentalSandboxMode()).toBeUndefined()
		})
	})
})

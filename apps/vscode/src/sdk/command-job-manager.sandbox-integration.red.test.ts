/**
 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01
 * C1 RED + characterization tests.
 *
 * Scope: ONE background command path in ClineMM
 *   apps/vscode/src/sdk/command-job-manager.ts:441
 *   -> spawnSupervisableShellCommand
 *   -> buildShellProcess
 *   -> spawn(executable, args, { env: ..., ... })
 *
 * C1 is OBSERVATION + RED only. NO production wiring yet. Every
 * test in this file either:
 *   (a) captures the CURRENT DEFAULT_OFF behavior exactly (the
 *       conservation witness -- must remain identical after C2), or
 *   (b) asserts a future C2 contract that FAILS today (RED). The
 *       RED tests are the load-bearing targets for C2.
 *
 * If a RED test does not reproduce on the real seam,
 *   HALT_RED_NOT_REPRODUCED.
 *
 * Foreground VscodeTerminalManager is out of scope for this ACT.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager } from "./command-job-manager"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const SEATBELT_OPTIN = "seatbelt"
const PROD_LEAK_VAR = "CLINEMM_PRODUCTION_TEST_LEAK_VAR"

function withSandboxOptIn<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> | T {
	const prev = process.env[SANDBOX_OPTIN_ENV]
	if (value === undefined) {
		delete process.env[SANDBOX_OPTIN_ENV]
	} else {
		process.env[SANDBOX_OPTIN_ENV] = value
	}
	try {
		return fn()
	} finally {
		if (prev === undefined) {
			delete process.env[SANDBOX_OPTIN_ENV]
		} else {
			process.env[SANDBOX_OPTIN_ENV] = prev
		}
	}
}

afterEach(() => {
	delete process.env[SANDBOX_OPTIN_ENV]
	delete process.env[PROD_LEAK_VAR]
	delete process.env.AWS_SECRET_ACCESS_KEY
})

describe("DEFAULT_OFF characterization (conservation witness)", () => {
	it("CommandJobManager.start with no sandbox opt-in: sentinel parent env var reaches the child", async () => {
		// C1 witness: with DEFAULT_OFF, the seeded parent env var
		// reaches the child because the supervisor spreads
		// process.env underneath options.env. After C2 integration
		// with the opt-in still absent, this exact behavior MUST
		// hold (conservation invariant).
		await withSandboxOptIn(undefined, async () => {
			process.env[PROD_LEAK_VAR] = "PLAINTEXT-LEAK-OK"
			const manager = new CommandJobManager()
			try {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "%s\\n" "$CLINEMM_PRODUCTION_TEST_LEAK_VAR"'`,
					cwd: process.cwd(),
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				expect(start.stdout).toContain("PLAINTEXT-LEAK-OK")
			} finally {
				await manager.dispose()
			}
		})
	})

	it("CommandJobManager.start with invalid opt-in value: still DEFAULT_OFF", async () => {
		await withSandboxOptIn("1", async () => {
			const manager = new CommandJobManager()
			try {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "ok\\n"'`,
					cwd: process.cwd(),
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				expect(start.stdout).toContain("ok")
			} finally {
				await manager.dispose()
			}
		})
	})
})

describe("RED: experimental opt-in must not leak parent credentials (load-bearing for C2)", () => {
	beforeEach(() => {
		process.env[PROD_LEAK_VAR] = "PLAINTEXT-MUST-NOT-LEAK"
	})

	it("with seatbelt opt-in set, the actual child does not see CLINEMM_PRODUCTION_TEST_LEAK_VAR", async () => {
		// Load-bearing RED test for the production-seam envSemantics
		// consumption. Today it FAILS because the supervisor always
		// spreads process.env (overlay semantics). After C2 wires
		// the integration, the supervisor must honor the prepared
		// env AS-IS for sanitized environments.
		await withSandboxOptIn(SEATBELT_OPTIN, async () => {
			const manager = new CommandJobManager()
			try {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "%s\\n" "$CLINEMM_PRODUCTION_TEST_LEAK_VAR"'`,
					cwd: process.cwd(),
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.stdout).not.toContain("PLAINTEXT-MUST-NOT-LEAK")
			} finally {
				await manager.dispose()
			}
		})
	})

	it("with seatbelt opt-in set, AWS_SECRET_ACCESS_KEY seeded in parent is absent in actual child", async () => {
		// The classic secret-shaped variable must also be absent
		// from the actual child under the sanitized contract.
		process.env.AWS_SECRET_ACCESS_KEY = "SECRET-SHAPED-VAR-MUST-NOT-LEAK"
		await withSandboxOptIn(SEATBELT_OPTIN, async () => {
			const manager = new CommandJobManager()
			try {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "%s\\n" "$AWS_SECRET_ACCESS_KEY"'`,
					cwd: process.cwd(),
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.stdout).not.toContain("SECRET-SHAPED-VAR-MUST-NOT-LEAK")
			} finally {
				await manager.dispose()
			}
		})
	})
})

describe("RED: experimental opt-in routes the actual spawn through sandbox-exec (load-bearing for C2)", () => {
	it("with seatbelt opt-in set on darwin, the authoritative spawned executable is /usr/bin/sandbox-exec", async () => {
		// The supervisor today receives { executable, args, ... }
		// and spawns it directly. After C2 wiring, with opt-in
		// active on darwin, the spawned executable MUST be
		// /usr/bin/sandbox-exec. Today it is /bin/sh.
		//
		// Use a long-lived command so the spawned PID is still
		// alive when we `ps` it.
		if (process.platform !== "darwin") {
			return
		}
		await withSandboxOptIn(SEATBELT_OPTIN, async () => {
			const manager = new CommandJobManager()
			try {
				const start = await manager.start({
					command: `/bin/sh -c 'sleep 5; printf "ok\\n"'`,
					cwd: process.cwd(),
					waitBudgetMs: 200,
					executionDeadlineMs: 8_000,
				})
				// Command is RUNNING at this point (wait budget expired).
				expect(start.state).toBe("running")
				const pid = (start.process as unknown as { pid?: number }).pid
				if (typeof pid !== "number") {
					throw new Error("expected spawned child pid")
				}
				const { spawnSync } = await import("node:child_process")
				const ps = spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" })
				const comm = (ps.stdout ?? "").trim()
				expect(comm).toBe("sandbox-exec")
			} finally {
				await manager.dispose()
			}
		})
	})
})

describe("RED: experimental opt-in with substrate unavailable: fail-closed (load-bearing for C2)", () => {
	it("with seatbelt opt-in set AND /usr/bin/sandbox-exec forcibly unavailable, command is not executed", async () => {
		// Today: CommandJobManager.start ignores the opt-in entirely,
		// so the command runs even when the substrate is unavailable.
		// After C2: the production executor MUST check
		// getSandboxBackend().prepare() availability before spawning;
		// if the substrate is unavailable, the command MUST NOT run.
		//
		// C2 will introduce the injection seam (a `forceSubstrateAvailable`
		// test hook in CommandJobManager) that this test sets to false to
		// exercise the fail-closed branch on darwin. Until that seam
		// exists, this test fails (today behavior = command runs).
		if (process.platform !== "darwin") {
			// On non-darwin, the substrate is genuinely unavailable
			// (getSandboxBackend returns NoSandboxBackend). The C2
			// integration MUST honor this and not spawn. Today: it
			// runs (RED). After C2: it does not run.
		}
		await withSandboxOptIn(SEATBELT_OPTIN, async () => {
			const manager = new CommandJobManager()
			try {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "SHOULD_NOT_RUN\\n"'`,
					cwd: process.cwd(),
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				// RED: today the command runs and prints SHOULD_NOT_RUN.
				// GREEN: after C2, the substrate-unavailable branch
				// must fail-closed -- invocation_count = 0.
				expect(start.stdout).not.toContain("SHOULD_NOT_RUN")
			} finally {
				await manager.dispose()
			}
		})
	})
})

/**
 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01
 * C3 \\u2014 REAL production kernel discriminators.
 *
 * These tests prove the production composition:
 *
 *   CommandJobManager (production default resolver)
 *     \\u2192 SeatbeltSandboxBackendExperimental (real @cline/core backend)
 *     \\u2192 /usr/bin/sandbox-exec (real macOS sandboxing binary)
 *     \\u2192 kernel
 *
 * No DI overrides. The CommandJobManager is constructed with default
 * resolver + a controlled experimentalSandboxWorkspaceRoots value.
 * The opt-in is provided via CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt.
 *
 * Scope (per C3 reviewer spec):
 *   1. Real production kernel write denial (the headline).
 *   2. stdout / stderr / exit conservation under opt-in and DEFAULT_OFF.
 *   3. Cancellation / deadline conservation (terminal classification
 *      and profile temp-dir cleanup under deadline; orphan-descendant
 *      absence is NOT independently observed in this suite — that
 *      property relies on Apple platform inheritance semantics plus
 *      the supervisor's kill tree).
 *
 * These tests run ONLY on darwin hosts with /usr/bin/sandbox-exec
 * present (matching the substrate check the production resolver does
 * before constructing a Seatbelt backend).
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { CommandJobManager } from "./command-job-manager"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const SEATBELT_OPTIN = "seatbelt"

/**
 * Probe Seatbelt substrate the same way the production resolver does:
 * darwin host + /usr/bin/sandbox-exec exists + minimal profile round-trips.
 * The result is captured once at module load; tests skip if false.
 */
const HAS_SUBSTRATE: boolean = (() => {
	if (process.platform !== "darwin") return false
	if (!existsSync("/usr/bin/sandbox-exec")) return false
	const probe = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/bin/echo", "ok"], {
		encoding: "utf8",
		timeout: 2_000,
	})
	return probe.status === 0 && probe.stdout.trim() === "ok"
})()

let tmpRoot: string | undefined

beforeAll(() => {
	if (!HAS_SUBSTRATE) return
	tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-c3-kernel-"))
})

afterEach(async () => {
	delete process.env[SANDBOX_OPTIN_ENV]
	if (tmpRoot) {
		try {
			rmSync(tmpRoot, { recursive: true, force: true })
		} catch {
			// ignore
		}
		tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-c3-kernel-"))
	}
})

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

function sha256(buf: Buffer | string): string {
	const h = createHash("sha256")
	h.update(buf)
	return h.digest("hex")
}

/**
 * The C3 headline discriminator (ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01)
 * reframed by ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01.
 *
 * Pre-WORKSPACE-WRITE01 this suite asserted that the kernel denied any
 * write under the workspaceRoot. That was the previous contract; it
 * locked the buckled-up ClineMM into a read-only-workspace mode and
 * reproduced the dogfood RED (`mkdir .factory/...` → EPERM).
 *
 * Post-WORKSPACE-WRITE01 the workspace is the bounded trust boundary:
 * the kernel permits writes UNDER the supplied workspace roots and still
 * denies writes OUTSIDE of them. The discriminator below was flipped
 * in lockstep with the bounded production repair at
 * `apps/vscode/src/sdk/sandbox-policy.ts`. The pre-fix behavior is
 * preserved as `OUTSIDE_WORKSPACE_DENIED` and `COUNTER_TEST_SANDBOX_OFF`
 * (sandbox OFF and outside-workspace paths still fail).
 */
describe.skipIf(!HAS_SUBSTRATE)(
	"C3: real production kernel write-allow discriminator (production resolver + real Seatbelt)",
	() => {
		it("sandbox ON: write to a path under the workspace root is KERNEL-ALLOWED (workspace trust boundary)", async () => {
			const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-"))
			const sentinelPath = join(workspaceRoot, "sentinel.txt")
			const sentinelBytes = Buffer.from("SENTINEL-ORIGINAL-BYTES-DO-NOT-MUTATE\n")
			writeFileSync(sentinelPath, sentinelBytes)

			const manager = new CommandJobManager({
				experimentalSandboxWorkspaceRoots: [workspaceRoot],
			})
			try {
				await withSandboxOptIn(SEATBELT_OPTIN, async () => {
					const start = await manager.start({
						command: `/bin/sh -c 'printf "OVERWRITTEN" > "${sentinelPath}"'`,
						cwd: workspaceRoot,
						waitBudgetMs: 5_000,
						executionDeadlineMs: 5_000,
					})
					expect(start.state).toBe("exited")
					expect(start.exitCode).toBe(0)

					const afterBytes = readFileSync(sentinelPath)
					// Workspace is the bounded trust boundary; the kernel
					// ALLOWS the override because the test root sits under
					// experimentalSandboxWorkspaceRoots.
					expect(sha256(afterBytes)).not.toBe(sha256(sentinelBytes))
					expect(afterBytes.toString("utf8")).toBe("OVERWRITTEN")
				})
			} finally {
				await manager.dispose()
			}
		})

		it("counter-test: same write with sandbox OFF also succeeds", async () => {
			const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-off-"))
			const sentinelPath = join(workspaceRoot, "sentinel.txt")
			const sentinelBytes = Buffer.from("SENTINEL-ORIGINAL-BYTES-DO-NOT-MUTATE\n")
			writeFileSync(sentinelPath, sentinelBytes)

			const manager = new CommandJobManager({
				experimentalSandboxWorkspaceRoots: [workspaceRoot],
			})
			try {
				await withSandboxOptIn(undefined, async () => {
					const start = await manager.start({
						command: `/bin/sh -c 'printf "OVERWRITTEN" > "${sentinelPath}"'`,
						cwd: workspaceRoot,
						waitBudgetMs: 5_000,
						executionDeadlineMs: 5_000,
					})
					expect(start.state).toBe("exited")
					expect(start.exitCode).toBe(0)

					const afterBytes = readFileSync(sentinelPath)
					expect(sha256(afterBytes)).not.toBe(sha256(sentinelBytes))
					expect(afterBytes.toString("utf8")).toBe("OVERWRITTEN")
				})
			} finally {
				await manager.dispose()
			}
		})

		it("write to a path outside the workspace AND outside /dev/null \\u2014 kernel still DENIES (deny default + empty writableRoots)", async () => {
			const outsideRoot = mkdtempSync(join(tmpRoot!, "outside-"))
			const target = join(outsideRoot, "target.txt")
			writeFileSync(target, "ORIGINAL\n")

			const manager = new CommandJobManager({
				experimentalSandboxWorkspaceRoots: [],
			})
			try {
				await withSandboxOptIn(SEATBELT_OPTIN, async () => {
					const start = await manager.start({
						command: `/bin/sh -c 'printf "X" > "${target}"'`,
						cwd: tmpRoot!,
						waitBudgetMs: 5_000,
						executionDeadlineMs: 5_000,
					})
					expect(start.state).toBe("exited")
					expect(start.exitCode).not.toBe(0)
					expect(readFileSync(target).toString("utf8")).toBe("ORIGINAL\n")
				})
			} finally {
				await manager.dispose()
			}
		})
	},
)

/**
 * ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01
 *
 * RED: today the production builder omits `tempRoot`, so the profile
 * has no writable-directory grant beyond /dev/null literals and the
 * child receives no TMPDIR. `mktemp` therefore hits kernel EPERM.
 * These tests reproduce the dogfood T01/T02/E04 RED against the
 * production seam (not the harness's own fake).
 *
 * After the temp-capability fix in `seatbelt-backend.ts`, these
 * tests flip to PASS and demonstrate:
 *   - mktemp and mktemp -d both succeed
 *   - the produced path is a descendant of the canonical TMPDIR
 *   - TMPDIR in the child env equals the synthesized root
 *   - workspace write is KERNEL-ALLOWED under the workspace trust
 *     boundary (ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 — was
 *     previously kernel-denied; that contract was the bug this ACT
 *     fixes)
 *   - a sibling under the same parent canonical temp remains DENIED
 *     (no parent authority expansion)
 */
describe.skipIf(!HAS_SUBSTRATE)("ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01: temp capability GREEN", () => {
	it("GREEN mktemp succeeds under the production resolver; path is descendant of canonical TMPDIR", async () => {
		const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-mkt-"))
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				// Run mktemp AND dump TMPDIR in a single shell so the
				// canonical TMPDIR observed by mktemp is the same as
				// the one we read back. Two separate manager.start()
				// calls would synthesize two distinct temp roots.
				const start = await manager.start({
					command: `/bin/sh -c 'set -e; p=$(mktemp); printf "TMPDIR=%s\\nPRODUCED=%s\\n" "$TMPDIR" "$p"'`,
					cwd: workspaceRoot,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				const tmLine = start.stdout.split("\n").find((l) => l.startsWith("TMPDIR="))
				const prodLine = start.stdout.split("\n").find((l) => l.startsWith("PRODUCED="))
				expect(tmLine).toBeDefined()
				expect(prodLine).toBeDefined()
				const canonicalTmp = tmLine!.slice("TMPDIR=".length)
				const produced = prodLine!.slice("PRODUCED=".length)
				// Path identity: `produced` starts with `canonicalTmp + "/"`.
				// (realpath/dirname would re-stat the post-cleanup path
				// which no longer exists.)
				expect(produced.startsWith(canonicalTmp + "/")).toBe(true)
			})
		} finally {
			await manager.dispose()
		}
	})

	it("GREEN mktemp -d succeeds under the production resolver; created dir is inside canonical TMPDIR", async () => {
		const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-mkd-"))
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				const start = await manager.start({
					command: `/bin/sh -c 'set -e; d=$(mktemp -d); printf "TMPDIR=%s\\nPRODUCED=%s\\n" "$TMPDIR" "$d"'`,
					cwd: workspaceRoot,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				const tmLine = start.stdout.split("\n").find((l) => l.startsWith("TMPDIR="))
				const prodLine = start.stdout.split("\n").find((l) => l.startsWith("PRODUCED="))
				expect(tmLine).toBeDefined()
				expect(prodLine).toBeDefined()
				const canonicalTmp = tmLine!.slice("TMPDIR=".length)
				const produced = prodLine!.slice("PRODUCED=".length)
				// mktemp -d creates a new directory under TMPDIR using the
				// template `tmp.XXXXXXXXXX`. The produced path is therefore
				// a child of canonicalTmp, not equal to it.
				expect(produced.startsWith(canonicalTmp + "/")).toBe(true)
				expect(produced.length).toBeGreaterThan(canonicalTmp.length + 1)
			})
		} finally {
			await manager.dispose()
		}
	})

	it("GREEN child TMPDIR is set to the canonical private root", async () => {
		const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-tm-"))
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "TMPDIR=%s\\n" "$TMPDIR"'`,
					cwd: workspaceRoot,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				expect(start.stdout).toMatch(/^TMPDIR=\/private\/var\/folders\/.+\/T\/clinemm-sandbox-temp-.+\n$/)
			})
		} finally {
			await manager.dispose()
		}
	})

	it("GREEN workspace write is KERNEL-ALLOWED under the workspace trust boundary (ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01)", async () => {
		// Pre-WORKSPACE-WRITE01 this asserted that writes under the
		// workspace root were STILL kernel-denied (the conservation
		// invariant of the previous "workspace = readonly" contract).
		// That contract is the bug this ACT fixes: the kernel now
		// ALLOWS writes under the supplied workspace root. The sibling
		// and synthesized-temp cleanup tests below continue to prove
		// that writes OUTSIDE the workspace remain denied.
		const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-cons-"))
		const sentinelPath = join(workspaceRoot, "sentinel.txt")
		writeFileSync(sentinelPath, Buffer.from("ORIGINAL\n"))
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "OVERWRITTEN" > "${sentinelPath}"'`,
					cwd: workspaceRoot,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				expect(readFileSync(sentinelPath).toString("utf8")).toBe("OVERWRITTEN")
			})
		} finally {
			await manager.dispose()
		}
	})

	it("GREEN a sibling under the same parent canonical temp is DENIED (no parent authority expansion)", async () => {
		const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-sib-"))
		const siblingRoot = mkdtempSync(join(tmpRoot!, "sibling-"))
		const target = join(siblingRoot, "x.txt")
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "BAD" > "${target}"'`,
					cwd: workspaceRoot,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).not.toBe(0)
				expect(existsSync(target)).toBe(false)
			})
		} finally {
			await manager.dispose()
		}
	})

	it("GREEN synthesized temp root is removed after the command exits (cleanup)", async () => {
		const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-clean-"))
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			let canonicalTmp = ""
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				const start = await manager.start({
					command: `/bin/sh -c 'printf "%s" "$TMPDIR"'`,
					cwd: workspaceRoot,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				canonicalTmp = start.stdout.trim()
			})
			// Cleanup is fire-and-forget; wait briefly for it.
			let stillThere = true
			for (let i = 0; i < 50 && stillThere; i++) {
				stillThere = existsSync(canonicalTmp)
				if (stillThere) await new Promise((r) => setTimeout(r, 20))
			}
			expect(stillThere).toBe(false)
		} finally {
			try {
				await manager.dispose()
			} catch {
				// already disposed
			}
		}
	})
})

/**
 * Supervision conservation: stdout / stderr / exit under opt-in
 * must be byte-identical to DEFAULT_OFF for ordinary shell semantics.
 * This proves the sandbox wrapper does not interfere with the
 * supervised child's IO plumbing.
 */
describe.skipIf(!HAS_SUBSTRATE)("C3: supervision conservation under opt-in vs DEFAULT_OFF", () => {
	const CONSERVATION_COMMAND = `/bin/sh -c 'printf "OUT\\n"; printf "ERR\\n" >&2; exit 7'`

	async function run(optIn: string | undefined) {
		return await withSandboxOptIn(optIn, async () => {
			const manager = new CommandJobManager()
			try {
				const start = await manager.start({
					command: CONSERVATION_COMMAND,
					cwd: tmpRoot!,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				return start
			} finally {
				await manager.dispose()
			}
		})
	}

	it("DEFAULT_OFF: stdout=OUT, stderr=ERR, exitCode=7", async () => {
		const start = await run(undefined)
		expect(start.state).toBe("exited")
		expect(start.exitCode).toBe(7)
		expect(start.stdout).toContain("OUT")
		expect(start.stderr).toContain("ERR")
	})

	it("opt-in seatbelt: stdout=OUT, stderr=ERR, exitCode=7 (supervision conserved)", async () => {
		const start = await run(SEATBELT_OPTIN)
		expect(start.state).toBe("exited")
		expect(start.exitCode).toBe(7)
		expect(start.stdout).toContain("OUT")
		expect(start.stderr).toContain("ERR")
	})
})

/**
 * Cancellation / deadline conservation: when the supervised job is
 * cancelled, the terminal classification must reflect cancellation
 * (not "exited" with code 0), and the profile temp dir must be
 * cleaned up. Orphan-descendant absence is NOT directly observed
 * in this suite — it relies on Apple platform inheritance plus the
 * supervisor's kill tree.
 * This must hold under both opt-in and DEFAULT_OFF.
 */
describe.skipIf(!HAS_SUBSTRATE)("C3: cancellation/deadline conservation under opt-in vs DEFAULT_OFF", () => {
	const LONG_COMMAND = `/bin/sh -c 'sleep 30'`

	async function runAndAwaitTerminal(optIn: string | undefined): Promise<{ manager: CommandJobManager; jobId: string }> {
		return await withSandboxOptIn(optIn, async () => {
			const manager = new CommandJobManager()
			const start = await manager.start({
				command: LONG_COMMAND,
				cwd: tmpRoot!,
				waitBudgetMs: 1_500,
				executionDeadlineMs: 500,
			})
			expect(start.state).toBe("running")
			const jobId = start.jobId
			// Wait long enough for the deadline to fire plus the
			// supervisor's TERM_GRACE to elapse.
			await new Promise((r) => setTimeout(r, 500 + 2_500))
			return { manager, jobId }
		})
	}

	it("DEFAULT_OFF: deadline fires; terminal state is deadline_exceeded", async () => {
		const { manager, jobId } = await runAndAwaitTerminal(undefined)
		try {
			const terminal = await manager.status({ jobId, waitMs: 0 })
			expect(terminal.ok).toBe(true)
			if (terminal.ok) {
				expect(terminal.snapshot.state).toBe("deadline_exceeded")
				// exitCode may be null or non-zero; never 0.
				if (terminal.snapshot.exitCode !== null) {
					expect(terminal.snapshot.exitCode).not.toBe(0)
				}
			}
		} finally {
			await manager.dispose()
		}
	})

	it("opt-in seatbelt: deadline fires; same terminal classification (no false clean exit; orphan absence NOT independently observed)", async () => {
		const { manager, jobId } = await runAndAwaitTerminal(SEATBELT_OPTIN)
		try {
			const terminal = await manager.status({ jobId, waitMs: 0 })
			expect(terminal.ok).toBe(true)
			if (terminal.ok) {
				expect(terminal.snapshot.state).toBe("deadline_exceeded")
				if (terminal.snapshot.exitCode !== null) {
					expect(terminal.snapshot.exitCode).not.toBe(0)
				}
			}
		} finally {
			await manager.dispose()
		}
	})

	it("opt-in seatbelt: profile temp dir is cleaned up after deadline (C2-P2 hygiene end-to-end)", async () => {
		const { manager } = await runAndAwaitTerminal(SEATBELT_OPTIN)
		try {
			// Wait a touch longer for the cleanup hook to fire (it's
			// attached to finalize() which runs after exit transition).
			await new Promise((r) => setTimeout(r, 500))
			const leftovers: string[] = []
			try {
				const entries = readdirSync(tmpdir())
				const now = Date.now()
				for (const e of entries) {
					if (!e.startsWith("clinemm-sandbox-profile-")) continue
					const full = join(tmpdir(), e)
					try {
						const st = statSync(full)
						if (now - st.mtimeMs < 5_000) {
							leftovers.push(full)
						}
					} catch {
						// ignore
					}
				}
			} catch {
				// ignore
			}
			expect(leftovers).toEqual([])
		} finally {
			await manager.dispose()
		}
	})
})

/**
 * Production seam wiring sanity: the production resolver must produce
 * a real Seatbelt backend, and the production executor must invoke it.
 * This is a sanity check that nothing in C2-P1/P2 broke the real path.
 *
 * We capture the profile temp dir while the spawn is in flight
 * (a tight polling loop), then assert the SBPL text contains the
 * Wave-1 anchors.
 */
describe.skipIf(!HAS_SUBSTRATE)("C3: production seam sanity (real backend is wired, profile is real SBPL)", () => {
	it("opt-in seatbelt through production resolver writes a real SBPL profile to disk", async () => {
		// Snapshot of /tmp/clinemm-sandbox-profile-* dirs BEFORE the
		// test runs. Any new profile dir that appears during the
		// test must be one OUR test created (the production backend
		// is the only consumer of that prefix in the apps/vscode
		// vitest worker).
		const profileTempDirPrefix = "clinemm-sandbox-profile-"
		const before = new Set<string>()
		for (const e of readdirSync(tmpdir())) {
			if (e.startsWith(profileTempDirPrefix)) before.add(e)
		}

		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [],
		})
		try {
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				const startPromise = manager.start({
					command: `/bin/sh -c 'sleep 0.3; exit 0'`,
					cwd: tmpRoot!,
					waitBudgetMs: 2_000,
					executionDeadlineMs: 2_000,
				})

				let profileBytes: Buffer | null = null
				const deadline = Date.now() + 1_000
				while (Date.now() < deadline && profileBytes === null) {
					await new Promise((r) => setTimeout(r, 10))
					const entries = readdirSync(tmpdir())
					// Only consider profile dirs that appeared AFTER
					// our snapshot (filter out leftovers from other
					// test suites).
					const matches = entries.filter((e) => e.startsWith(profileTempDirPrefix) && !before.has(e))
					for (const m of matches) {
						const full = join(tmpdir(), m)
						try {
							const inner = readdirSync(full)
							const sbFile = inner.find((f) => f.endsWith(".sb"))
							if (sbFile) {
								profileBytes = readFileSync(join(full, sbFile))
								break
							}
						} catch {
							// dir disappeared
						}
					}
				}

				const start = await startPromise
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)

				// We MUST have caught the profile from OUR test. If
				// we didn't, that's a production-seam break, not a
				// test flake.
				expect(profileBytes).not.toBeNull()
				const text = profileBytes!.toString("utf8")
				expect(text).toContain("(version 1)")
				expect(text).toContain("(deny default)")
				expect(text).toContain("(deny network*)")
				expect(text).toContain("(allow file-write*")
				expect(text).toContain("/dev/null")
			})
		} finally {
			await manager.dispose()
		}
	})
})

/**
 * ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
 *
 * T3 — the REAL production command-execution path
 * (`CommandJobManager.start()` -> production resolver -> REAL Seatbelt
 * backend -> `/usr/bin/sandbox-exec` -> Darwin kernel) must be able to
 * run a Python `multiprocessing` workload.
 *
 * Before the repair the production profile carried NO
 * `(allow ipc-posix-sem)` rule, so `multiprocessing.Semaphore(1)`
 * failed with `PermissionError: [Errno 1] Operation not permitted`
 * inside the sandbox, which broke Ansible's task-execution path.
 *
 * This test uses NO dependency injection: the `CommandJobManager` is
 * constructed with the DEFAULT production resolver, exactly as the
 * extension host constructs it.
 */
describe.skipIf(!HAS_SUBSTRATE)("ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01: production CommandJobManager path", () => {
	/**
	 * The Python interpreter used by the live probes. The ACT
	 * requires the same interpreter that launches the installed
	 * Ansible. An absolute path is used so the sandboxed child's
	 * sanitized PATH cannot select a different one.
	 */
	const PYTHON_BIN = (() => {
		const candidates = ["/run/current-system/sw/bin/python3.13", "/usr/bin/python3", "/usr/local/bin/python3"]
		for (const c of candidates) {
			try {
				if (existsSync(c)) return c
			} catch {
				// ignore
			}
		}
		return "python3"
	})()

	it("T3: the production backgroundExec path runs a Python multiprocessing semaphore to a clean exit", async () => {
		const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-sem-"))
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				const start = await manager.start({
					command: `${PYTHON_BIN} -c 'import multiprocessing as mp; s = mp.Semaphore(1); s.acquire(); s.release(); print("POSIX_SEM_OK")'`,
					cwd: workspaceRoot,
					waitBudgetMs: 20_000,
					executionDeadlineMs: 20_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				expect(start.stdout).toContain("POSIX_SEM_OK")
				// The pre-repair failure signature must NOT appear.
				expect(start.stderr).not.toContain("Operation not permitted")
				expect(start.stderr).not.toContain("multiprocessing")
			})
		} finally {
			await manager.dispose()
		}
	})

	it("T3b: the production backgroundExec path runs a real multiprocessing worker + queue", async () => {
		const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-semq-"))
		// The program is written to a FILE inside the authorized
		// workspace root so no shell quoting can corrupt it. The
		// command line then references only that path.
		const programPath = join(workspaceRoot, "mp_probe.py")
		writeFileSync(
			programPath,
			[
				"import multiprocessing as mp",
				"",
				"def worker(q):",
				"    q.put(('worker-ok', mp.current_process().name))",
				"",
				"if __name__ == '__main__':",
				"    ctx = mp.get_context('fork')",
				"    q = ctx.Queue()",
				"    procs = [ctx.Process(target=worker, args=(q,)) for _ in range(2)]",
				"    for p in procs:",
				"        p.start()",
				"    results = [q.get(timeout=20) for _ in range(2)]",
				"    for p in procs:",
				"        p.join(timeout=20)",
				"    assert all(p.exitcode == 0 for p in procs), [p.exitcode for p in procs]",
				"    print('MP_WORKER_QUEUE_OK', results)",
				"",
			].join("\n"),
		)
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			await withSandboxOptIn(SEATBELT_OPTIN, async () => {
				const start = await manager.start({
					command: `${PYTHON_BIN} ${JSON.stringify(programPath)}`,
					cwd: workspaceRoot,
					waitBudgetMs: 30_000,
					executionDeadlineMs: 30_000,
				})
				expect(start.state).toBe("exited")
				expect(start.exitCode).toBe(0)
				expect(start.stdout).toContain("MP_WORKER_QUEUE_OK")
				expect(start.stderr).not.toContain("Operation not permitted")
			})
		} finally {
			await manager.dispose()
		}
	})
})

/**
 * ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
 *
 * Ansible qualification through the REAL production command-execution
 * path (`CommandJobManager.start()` -> production resolver -> REAL
 * Seatbelt backend -> Darwin kernel).
 *
 * The `ansible.builtin.ping` module runs against LOCALHOST ONLY. The
 * Ubuntu guest (192.168.50.239:22) is NOT contacted; the provisioning
 * playbook is NOT run; host-key verification is NOT disabled; no private
 * SSH key is read or printed.
 *
 * BOUNDARY NOTES (established by the live A/B classification, see
 * `.factory/evidence/ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01/ansible-boundary-classification.txt`):
 *
 *   - The POSIX-semaphore repair removed the pre-repair
 *     `PermissionError: [Errno 1] Operation not permitted` from
 *     Ansible's `multiprocessing` worker startup.
 *   - Under the DEFAULT network mode (`deny`), Ansible's `LocalManager`
 *     still fails with "Local RPC server did not start" because it
 *     binds an AF_INET listener socket. That is a SEPARATE, pre-existing
 *     boundary (the network capability), NOT the semaphore boundary.
 *   - The explicit network opt-in (`allow`) plus an Ansible remote-temp
 *     path inside the authorized workspace root makes the localhost
 *     task SUCCEED.
 *
 * The test therefore asserts the qualification under the explicit
 * network opt-in (which is the documented, existing ClineMM mechanism)
 * and asserts that the PRE-REPAIR failure signature is absent.
 *
 * The test is SKIPPED (not silently passed) when the installed Ansible
 * is absent, so the qualification result is always explicit.
 */
describe.skipIf(!HAS_SUBSTRATE)("ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01: Ansible localhost qualification", () => {
	const ANSIBLE_BIN = (() => {
		const candidates = [
			"/run/current-system/sw/bin/ansible",
			"/usr/local/bin/ansible",
			"/opt/homebrew/bin/ansible",
			"/usr/bin/ansible",
		]
		for (const c of candidates) {
			try {
				if (existsSync(c)) return c
			} catch {
				// ignore
			}
		}
		return ""
	})()

	it.skipIf(!ANSIBLE_BIN)(
		"T8: a localhost-only ansible.builtin.ping task SUCCEEDS through the sandboxed production runner",
		async () => {
			const workspaceRoot = mkdtempSync(join(tmpRoot!, "ws-ansible-"))
			// Ansible needs a writable local temp AND a writable
			// remote temp for its localhost connection plugin. Both
			// are placed INSIDE the authorized workspace root so the
			// sandbox permits them.
			const ansibleTmp = join(workspaceRoot, "ansible-tmp")
			const remoteTmp = join(workspaceRoot, "ansible-remote-tmp")
			mkdirSync(ansibleTmp, { recursive: true })
			mkdirSync(remoteTmp, { recursive: true })

			const manager = new CommandJobManager({
				experimentalSandboxWorkspaceRoots: [workspaceRoot],
			})
			try {
				// The existing, documented network opt-in
				// (`CLINEMM_SAFE_YOLO_NETWORK=allow`). Ansible's
				// LocalManager binds an AF_INET listener socket, so
				// the DEFAULT `network: "deny"` posture cannot host
				// it. This is a pre-existing, separate boundary from
				// the POSIX-semaphore one.
				await withSandboxOptIn(SEATBELT_OPTIN, async () => {
					const prevNetworkOptIn = process.env.CLINEMM_SAFE_YOLO_NETWORK
					process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
					try {
						const start = await manager.start({
							command: `ANSIBLE_LOCAL_TEMP=${JSON.stringify(ansibleTmp)} ANSIBLE_REMOTE_TEMP=${JSON.stringify(remoteTmp)} ANSIBLE_FORCE_COLOR=0 ANSIBLE_NOCOLOR=1 ${ANSIBLE_BIN} -i 'localhost,' localhost -c local -m ansible.builtin.ping`,
							cwd: workspaceRoot,
							waitBudgetMs: 60_000,
							executionDeadlineMs: 60_000,
						})
						expect(start.state).toBe("exited")
						expect(start.exitCode).toBe(0)
						// The task-execution path (not just `--version`).
						expect(start.stdout).toContain("SUCCESS")
						expect(start.stdout).toContain("pong")
						// The pre-repair multiprocessing failure signature
						// must NOT appear.
						expect(start.stderr).not.toContain("Operation not permitted")
						expect(start.stderr).not.toContain("Unable to use multiprocessing")
					} finally {
						if (prevNetworkOptIn === undefined) {
							delete process.env.CLINEMM_SAFE_YOLO_NETWORK
						} else {
							process.env.CLINEMM_SAFE_YOLO_NETWORK = prevNetworkOptIn
						}
					}
				})
			} finally {
				await manager.dispose()
			}
		},
	)
})

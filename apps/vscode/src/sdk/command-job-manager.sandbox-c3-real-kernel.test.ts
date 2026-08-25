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
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
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
	const probe = spawnSync(
		"/usr/bin/sandbox-exec",
		["-p", "(version 1)(allow default)", "/bin/echo", "ok"],
		{ encoding: "utf8", timeout: 2_000 },
	)
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

function withSandboxOptIn<T>(
	value: string | undefined,
	fn: () => Promise<T> | T,
): Promise<T> | T {
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
 * The headline C3 discriminator. Prove the kernel denies a write
 * that would have succeeded under DEFAULT_OFF.
 *
 * The sentinel lives under the workspaceRoot we passed via
 * experimentalSandboxWorkspaceRoots. By the production wiring
 * contract, that path becomes a readonlyRoot in the Wave-1 capability
 * and emits a write-deny rule in the SBPL profile. Kernel-level
 * evidence of write-deny at this path IS the proof that the production
 * resolver threaded the workspaceRoot into the capability used by the
 * production backend.
 */
describe.skipIf(!HAS_SUBSTRATE)(
	"C3: real production kernel write-deny discriminator (production resolver + real Seatbelt)",
	() => {
		it("sandbox ON: write to a path under the workspace root is KERNEL-DENIED, sentinel bytes unchanged", async () => {
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
					expect(start.exitCode).not.toBe(0)

					const afterBytes = readFileSync(sentinelPath)
					expect(sha256(afterBytes)).toBe(sha256(sentinelBytes))
					expect(afterBytes.toString("utf8")).toBe(sentinelBytes.toString("utf8"))
				})
			} finally {
				await manager.dispose()
			}
		})

		it("counter-test: same write with sandbox OFF succeeds, sentinel bytes change", async () => {
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
 * Supervision conservation: stdout / stderr / exit under opt-in
 * must be byte-identical to DEFAULT_OFF for ordinary shell semantics.
 * This proves the sandbox wrapper does not interfere with the
 * supervised child's IO plumbing.
 */
describe.skipIf(!HAS_SUBSTRATE)(
	"C3: supervision conservation under opt-in vs DEFAULT_OFF",
	() => {
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
	},
)

/**
 * Cancellation / deadline conservation: when the supervised job is
 * cancelled, the terminal classification must reflect cancellation
 * (not "exited" with code 0), and the profile temp dir must be
 * cleaned up. Orphan-descendant absence is NOT directly observed
 * in this suite — it relies on Apple platform inheritance plus the
 * supervisor's kill tree.
 * This must hold under both opt-in and DEFAULT_OFF.
 */
describe.skipIf(!HAS_SUBSTRATE)(
	"C3: cancellation/deadline conservation under opt-in vs DEFAULT_OFF",
	() => {
		const LONG_COMMAND = `/bin/sh -c 'sleep 30'`

		async function runAndAwaitTerminal(
			optIn: string | undefined,
		): Promise<{ manager: CommandJobManager; jobId: string }> {
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
				await new Promise(r => setTimeout(r, 500 + 2_500))
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
				await new Promise(r => setTimeout(r, 500))
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
	},
)

/**
 * Production seam wiring sanity: the production resolver must produce
 * a real Seatbelt backend, and the production executor must invoke it.
 * This is a sanity check that nothing in C2-P1/P2 broke the real path.
 *
 * We capture the profile temp dir while the spawn is in flight
 * (a tight polling loop), then assert the SBPL text contains the
 * Wave-1 anchors.
 */
describe.skipIf(!HAS_SUBSTRATE)(
	"C3: production seam sanity (real backend is wired, profile is real SBPL)",
	() => {
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
						await new Promise(r => setTimeout(r, 10))
						const entries = readdirSync(tmpdir())
						// Only consider profile dirs that appeared AFTER
						// our snapshot (filter out leftovers from other
						// test suites).
						const matches = entries.filter(
							e => e.startsWith(profileTempDirPrefix) && !before.has(e),
						)
						for (const m of matches) {
							const full = join(tmpdir(), m)
							try {
								const inner = readdirSync(full)
								const sbFile = inner.find(f => f.endsWith(".sb"))
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
	},
)

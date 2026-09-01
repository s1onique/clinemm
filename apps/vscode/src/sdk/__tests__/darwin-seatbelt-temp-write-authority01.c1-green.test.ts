/**
 * ACT-CLINEMM-SEATBELT-TEMP-WRITE-AUTHORITY01 — C1 GREEN
 *
 * Bounded production repair: allow ordinary temp-file creation under
 * macOS Seatbelt without broadening filesystem authority beyond
 * canonical temp roots.
 *
 * CORRECTED SCOPE (post-reviewer-verdict):
 *
 *   Pre-fix RED:
 *     - mktemp /tmp/clinemm-XXXXXX → kernel EPERM
 *       (literal /tmp resolves to /private/tmp, which has no write allow)
 *     - write under os.tmpdir() → kernel EPERM
 *       (per-user /private/var/folders/.../T has no write allow)
 *
 *   Post-fix GREEN (this suite):
 *     T1) mktemp /tmp/clinemm-XXXXXX (literal /tmp)         → exit 0
 *         BSD mktemp hard-codes literal /tmp; we grant canonical /tmp
 *         as an explicit compatibility allowance (the only global temp
 *         subpath we add to the profile). Strongest, simplest /tmp
 *         compatibility witness.
 *     T2) mktemp -d (no template)                           → DENIED
 *         BSD mktemp with no template uses getconf
 *         _CS_DARWIN_USER_TEMP_DIR (= os.tmpdir()) by default and
 *         IGNORES the parent's TMPDIR per Apple's platform contract.
 *         Per the CORRECTED scope, os.tmpdir() is NOT in the global
 *         write allow, so a capability-less mktemp -d hit hits EPERM
 *         (or fails to create). The bounded pattern is to use a
 *         capability tempRoot that names os.tmpdir() (or any writable
 *         scratch), and the synthesized per-invocation dir is granted
 *         as a (subpath ...) write rule.
 *     T3) Node inside the real sandbox seam:                 → exit 0
 *         asserts (within Node running INSIDE sandbox-exec)
 *           os.tmpdir()              == <synthesized tempRoot>
 *           process.env.TMPDIR       == <synthesized tempRoot>
 *           process.env.TMP          == <synthesized tempRoot>
 *           process.env.TEMP         == <synthesized tempRoot>
 *           write under os.tmpdir()  → succeeds
 *         Node checks TMPDIR → TMP → TEMP on non-Windows systems,
 *         so the env materialization is correct for Node and this
 *         exercises the real production seam.
 *
 *     CONSERVATION (must REMAINS DENIED):
 *     T4) write outside workspace/temp (~/seatbelt-forbidden)  → DENIED
 *     T5) write ~/.ssh/test                                    → DENIED
 *     T6) write /etc/test                                      → DENIED
 *     T7) sibling path under os.tmpdir() (outside tempRoot)   → DENIED
 *         proves per-user temp authority is bounded to the
 *         capability's tempRoot, NOT to the whole os.tmpdir().
 *
 *     CARRIED INVARIANT:
 *     T8) workspace write                                      → PASS
 *
 *     POLICY DOCUMENTATION (blast radius of /tmp grant):
 *     T9) overwrite an unrelated existing file under /private/tmp → PASS
 *         Documents that the explicit /tmp grant gives the sandboxed
 *         command the ability to create / overwrite / delete ANY file
 *         under canonical /tmp subject to Unix DAC. This is the
 *         documented product-policy choice for /tmp compatibility.
 *
 * Skip conditions: non-darwin host, /usr/bin/sandbox-exec not
 * available, or sandbox-exec minimal probe fails.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const SEATBELT_OPTIN = "seatbelt"

/**
 * Substrate check: darwin host + /usr/bin/sandbox-exec exists +
 * minimal profile round-trips. Tests skip (not pass) when false.
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

const canonicalTmp = (() => {
	try {
		return realpathSync("/tmp")
	} catch {
		return undefined
	}
})()

const canonicalTmpdir = (() => {
	try {
		return realpathSync(tmpdir())
	} catch {
		return undefined
	}
})()

let tmpRoot: string | undefined

beforeAll(() => {
	if (!HAS_SUBSTRATE) return
	tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-temp-auth-c1-"))
})

afterEach(() => {
	delete process.env[SANDBOX_OPTIN_ENV]
	if (tmpRoot) {
		try {
			rmSync(tmpRoot, { recursive: true, force: true })
		} catch {
			// ignore
		}
		tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-temp-auth-c1-"))
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

interface StartOutcome {
	exitCode: number | null | undefined
	signal: string | undefined
	stdout: string
	stderr: string
	state: string
}

interface StartOptions {
	command: string
	cwd?: string
	env?: Record<string, string>
}

async function runSandboxed(opts: StartOptions): Promise<StartOutcome> {
	const manager = new CommandJobManager({
		// Empty workspaceRoots = no workspace write authority. Only
		// the canonical temp roots + readonlyRoots should be writable.
		experimentalSandboxWorkspaceRoots: [],
	})
	const cwd = opts.cwd ?? canonicalTmpdir ?? tmpRoot ?? tmpdir()
	try {
		return await withSandboxOptIn(SEATBELT_OPTIN, async () => {
			const start = await manager.start({
				command: opts.command,
				cwd,
				env: opts.env ?? {},
				waitBudgetMs: 5_000,
				executionDeadlineMs: 10_000,
			})
			await start.terminalPromise
			const statusResult = await manager.status({ jobId: start.jobId, waitMs: 0 })
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
		})
	} finally {
		await manager.dispose()
	}
}

describe.skipIf(!HAS_SUBSTRATE)(
	"ACT-CLINEMM-SEATBELT-TEMP-WRITE-AUTHORITY01 — kernel matrix",
	() => {
		it("T1 GREEN: mktemp /tmp/clinemm-seatbelt-XXXXXX (literal /tmp) -> exit 0, file under canonical /tmp", async () => {
			if (!canonicalTmp) {
				expect(true).toBe(true)
				return
			}
			const out = await runSandboxed({
				command: `/usr/bin/mktemp /tmp/clinemm-seatbelt-c1.XXXXXX`,
			})
			expect(out.exitCode).toBe(0)
			expect(out.stderr).not.toMatch(/Operation not permitted|EPERM/)
			const stdout = out.stdout.trim()
			expect(stdout).toMatch(/^\/tmp\//)
			const real = realpathSync(stdout)
			expect(real.startsWith(canonicalTmp)).toBe(true)
			try {
				rmSync(stdout, { force: true })
			} catch {}
		})

		it("T2 CONSERVATION: mktemp -d (no template) -> exit != 0, no path created, EPERM signal on stderr (per-user os.tmpdir() NOT globally granted)", async () => {
			// macOS BSD mktemp(1) with no template and no -t flag
			// falls back to _CS_DARWIN_USER_TEMP_DIR (== os.tmpdir())
			// and IGNORES the parent's TMPDIR per Apple's platform
			// contract.
			//
			// Per the CORRECTED scope, os.tmpdir() is NOT in the
			// global write allow. Tooling that lands there WITHOUT
			// a capability tempRoot that names it as such will hit
			// EPERM (or fail to create). The CORRECTED test asserts
			// this conservation witness exactly: the kernel MUST
			// deny the operation, no dir MAY be created, and the
			// denial signal MUST be visible.
			//
			// The bounded pattern for normal tooling is: callers
			// supply a `tempRoot` capability pointing at os.tmpdir()
			// (or any writable scratch), and the synthesized
			// per-invocation dir is granted as a (subpath ...) write
			// rule. The TMPDIR/TMP/TEMP env materialization steers
			// $TMPDIR-honoring tools into that root.
			if (!canonicalTmpdir) {
				expect(true).toBe(true)
				return
			}
			const out = await runSandboxed({
				command: `/usr/bin/mktemp -d`,
			})
			// Load-bearing invariant: the kernel denied the write.
			//   - exit code MUST be non-zero (mktemp failed).
			//   - if mktemp printed a candidate path before failing,
			//     that path MUST NOT exist on disk.
			//   - stderr MUST carry a permission-denial marker
			//     (Seatbelt translates sandbox denials to
			//     "Operation not permitted" / EPERM via libbx).
			expect(out.exitCode).not.toBe(0)
			const candidate = out.stdout.trim()
			if (candidate) {
				expect(existsSync(candidate)).toBe(false)
			}
			expect(out.stderr).toMatch(/Operation not permitted|EPERM|not permitted/i)
		})

		it("T3 GREEN: Node inside the real sandbox seam -> os.tmpdir() / TMPDIR / TMP / TEMP all equal capability tempRoot, write under os.tmpdir() succeeds", async () => {
			// Per the CORRECTED scope, os.tmpdir() is NOT in the
			// global write allow. Per-invocation temp authority is
			// bounded to the capability's `tempRoot`. The
			// CommandJobManager (used by `runSandboxed`) synthesizes
			// a per-invocation tempRoot under `os.tmpdir()` and
			// passes it to `materializeEnvironment` as
			// `syntheticTempDir`. With the corrected env helper,
			// that path is set as TMPDIR + TMP + TEMP, and Node.js
			// (which honors TMPDIR → TMP → TEMP on non-Windows)
			// resolves `os.tmpdir()` to it.
			//
			// We run a real Node process INSIDE the sandbox seam
			// and assert on what it sees. This exercises the real
			// production path: CommandJobManager.start →
			// SeatbeltSandboxBackendExperimental.prepare →
			// materializeEnvironment → sandbox-exec → Node.
			//
			// The Node script asserts:
			//   1) os.tmpdir()             == TMPDIR
			//   2) process.env.TMPDIR === process.env.TMP === process.env.TEMP
			//   3) process.env.TMPDIR  is a real directory
			//   4) write to TMPDIR + '/clinemm-t3-' + Date.now() succeeds
			//      AND reads back the content we wrote
			// If any of those fail, the script prints FAIL:<reason>
			// and exits with a non-zero code, which we surface.
			const nodeScript = `
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TMPDIR = process.env.TMPDIR;
const TMP = process.env.TMP;
const TEMP = process.env.TEMP;
const otd = os.tmpdir();
if (typeof TMPDIR !== 'string' || TMPDIR.length === 0) { console.log('FAIL:TMPDIR_empty'); process.exit(2); }
if (TMP !== TMPDIR) { console.log('FAIL:TMP_mismatch:' + TMP); process.exit(3); }
if (TEMP !== TMPDIR) { console.log('FAIL:TEMP_mismatch:' + TEMP); process.exit(4); }
if (otd !== TMPDIR) { console.log('FAIL:os.tmpdir_mismatch:' + otd); process.exit(5); }
if (!fs.statSync(TMPDIR).isDirectory()) { console.log('FAIL:TMPDIR_not_a_directory'); process.exit(6); }
const probe = path.join(TMPDIR, 'clinemm-t3-' + Date.now() + '.txt');
fs.writeFileSync(probe, 'T3_OK');
const back = fs.readFileSync(probe, 'utf8');
if (back !== 'T3_OK') { console.log('FAIL:readback_mismatch:' + back); process.exit(7); }
fs.unlinkSync(probe);
console.log('T3_OK:' + TMPDIR);
`
			const out = await runSandboxed({
				command: `/usr/bin/env node -e ${JSON.stringify(nodeScript)}`,
			})
			// The Node script exits 0 on success. If any assertion
			// in the script fails, the exit code is non-zero and
			// stdout carries the FAIL:<reason> marker. The
			// capability-private tempRoot synthesis is automatic
			// for every CommandJobManager.start, so writes under
			// it succeed (Seatbelt allows (subpath "<tempRoot>")
			// and os.tmpdir() == tempRoot per Node's env lookup).
			expect(out.exitCode).toBe(0)
			expect(out.stderr).not.toMatch(/Operation not permitted|EPERM/)
			const stdout = out.stdout.trim()
			expect(stdout).toMatch(/^T3_OK:/)
			// The reported path MUST be under canonical os.tmpdir()
			// (the synthesized tempRoot is a subdir of os.tmpdir()).
			if (canonicalTmpdir) {
				const reported = stdout.split(":")[1]
				expect(reported).toBeDefined()
				expect(realpathSync(reported!).startsWith(canonicalTmpdir)).toBe(
					true,
				)
			}
		})

		it("T4 CONSERVATION: write outside workspace/temp (~/seatbelt-forbidden) -> REMAINS DENIED", async () => {
			const forbidden = join(homedir(), `seatbelt-forbidden-c1-${Date.now()}`)
			try {
				rmSync(forbidden, { recursive: true, force: true })
			} catch {}
			const sentinel = join(forbidden, "x.txt")
			try {
				const out = await runSandboxed({
					command: `/bin/sh -c 'mkdir -p "${forbidden}" && printf "BAD" > "${sentinel}"'`,
				})
				expect(existsSync(sentinel)).toBe(false)
				if (out.exitCode === 0) {
					expect(existsSync(sentinel)).toBe(false)
				}
			} finally {
				try {
					rmSync(forbidden, { recursive: true, force: true })
				} catch {}
			}
		})

		it("T5 CONSERVATION: write ~/.ssh/test -> REMAINS DENIED", async () => {
			const probe = join(homedir(), ".ssh", `test-c1-${Date.now()}`)
			try {
				const out = await runSandboxed({
					command: `/bin/sh -c 'printf "BAD" > "${probe}"'`,
				})
				expect(existsSync(probe)).toBe(false)
				if (out.exitCode === 0) {
					expect(existsSync(probe)).toBe(false)
				}
			} finally {
				try {
					rmSync(probe, { force: true })
				} catch {}
			}
		})

		it("T6 CONSERVATION: write /etc/cinemm-c1-forbidden -> REMAINS DENIED", async () => {
			const probe = `/etc/clinemm-c1-forbidden-${Date.now()}`
			const out = await runSandboxed({
				command: `/bin/sh -c 'printf "BAD" > "${probe}"'`,
			})
			expect(existsSync(probe)).toBe(false)
			if (out.exitCode === 0) {
				expect(existsSync(probe)).toBe(false)
			}
			try {
				rmSync(probe, { force: true })
			} catch {}
		})

		it("T7 CONSERVATION: sibling path under canonical os.tmpdir() (outside capability tempRoot) -> REMAINS DENIED", async () => {
			// Per-user temp authority is bounded to the capability's
			// tempRoot, NOT to the whole os.tmpdir(). Pick a sibling
			// path inside canonical os.tmpdir() that is NOT the
			// capability's tempRoot — write to it MUST be denied.
			//
			// We seed the sibling file OUTSIDE the sandbox (no
			// Seatbelt restrictions on the test harness), then
			// attempt to overwrite it from inside the sandbox.
			if (!canonicalTmpdir) {
				expect(true).toBe(true)
				return
			}
			const siblingPath = join(canonicalTmpdir, `clinemm-c1-sibling-${Date.now()}.txt`)
			writeFileSync(siblingPath, "ORIGINAL_SIBLING\n", "utf8")
			try {
				const out = await runSandboxed({
					command: `/bin/sh -c 'printf "OVERWRITTEN" > "${siblingPath}"'`,
				})
				// The sentinel content MUST NOT change. The original
				// "ORIGINAL_SIBLING" string remains intact.
				expect(existsSync(siblingPath)).toBe(true)
				const { readFileSync } = await import("node:fs")
				expect(readFileSync(siblingPath, "utf8")).toBe("ORIGINAL_SIBLING\n")
				if (out.exitCode === 0) {
					// Belt-and-suspenders: if the sandboxed command
					// somehow exited 0, the file MUST still be the
					// original sibling content.
					expect(readFileSync(siblingPath, "utf8")).toBe("ORIGINAL_SIBLING\n")
				}
			} finally {
				try {
					rmSync(siblingPath, { force: true })
				} catch {}
			}
		})

		it("T8 CONSERVATION: workspace write -> REMAINS PASS (carried invariant)", async () => {
			const wsRoot = mkdtempSync(join(tmpRoot!, "ws-"))
			const sentinel = join(wsRoot, "sentinel.txt")
			try {
				writeFileSync(sentinel, "WS_ORIGINAL\n", "utf8")
				const manager = new CommandJobManager({
					experimentalSandboxWorkspaceRoots: [wsRoot],
				})
				try {
					const out = await withSandboxOptIn(SEATBELT_OPTIN, async () => {
						const start = await manager.start({
							command: `/bin/sh -c 'printf "OVERWRITTEN" > "${sentinel}"'`,
							cwd: wsRoot,
							waitBudgetMs: 5_000,
							executionDeadlineMs: 5_000,
						})
						await start.terminalPromise
						const statusResult = await manager.status({ jobId: start.jobId, waitMs: 0 })
						if (!statusResult.ok) {
							throw new Error(`status() returned code=${statusResult.code}`)
						}
						return statusResult.snapshot
					})
					expect(out.exitCode).toBe(0)
					expect(existsSync(sentinel)).toBe(true)
					const { readFileSync } = await import("node:fs")
					expect(readFileSync(sentinel, "utf8")).toBe("OVERWRITTEN")
				} finally {
					await manager.dispose()
				}
			} finally {
				try {
					rmSync(wsRoot, { recursive: true, force: true })
				} catch {}
			}
		})

		it("T9 POLICY DOCUMENTATION: blast radius of explicit /tmp grant — overwrite an UNRELATED existing file under /private/tmp -> ALLOWED", async () => {
			// The CORRECTED scope grants canonical /tmp as an
			// explicit compatibility allowance. This means a
			// sandboxed command CAN overwrite, delete, or rename
			// ANY file under canonical /tmp subject to Unix DAC.
			// This test DOCUMENTS that blast radius so the policy
			// choice is explicit.
			//
			// We seed an unrelated file under /private/tmp (the
			// canonical resolution of /tmp) with a marker value,
			// then run a sandboxed command that overwrites it.
			// The expectation is that the overwrite succeeds:
			// the sandboxed command has (subpath "<canonical /tmp>")
			// authority.
			//
			// If this test ever FAILS (Seatbelt denies the
			// overwrite), it means the /tmp grant has been
			// narrowed in some way and the policy documentation
			// needs to be updated.
			if (!canonicalTmp) {
				expect(true).toBe(true)
				return
			}
			const unrelatedPath = join(canonicalTmp, `clinemm-c1-unrelated-${Date.now()}.txt`)
			writeFileSync(unrelatedPath, "UNRELATED_ORIGINAL\n", "utf8")
			try {
				const out = await runSandboxed({
					command: `/bin/sh -c 'printf "OVERWRITTEN_BY_SANDBOX" > "${unrelatedPath}"'`,
				})
				expect(out.exitCode).toBe(0)
				expect(existsSync(unrelatedPath)).toBe(true)
				const { readFileSync } = await import("node:fs")
				expect(readFileSync(unrelatedPath, "utf8")).toBe("OVERWRITTEN_BY_SANDBOX")
			} finally {
				try {
					rmSync(unrelatedPath, { force: true })
				} catch {}
			}
		})
	},
)
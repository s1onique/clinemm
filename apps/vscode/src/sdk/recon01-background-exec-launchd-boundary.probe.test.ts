/**
 * ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01 — P3 probe.
 *
 * READ-ONLY DIAGNOSTIC (test file; never ships in the extension bundle).
 * Exercises the REAL production Background Exec seam:
 *
 *   CommandJobManager.start()
 *     -> defaultSandboxBackendResolver()
 *     -> SeatbeltSandboxBackendExperimental.prepare()
 *     -> /usr/bin/sandbox-exec -f <profile> /bin/sh -c "<command>"
 *     -> kernel
 *
 * Captures (1) the EXACT live SBPL profile bytes applied to the command,
 * and (2) the REAL signal errno when the sandboxed command signals its
 * OWN child (the E1 / Vitest-worker-teardown direction).
 *
 * Marker: CLINEMM_RECON01_SIGNAL_PROBE
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CommandJobManager } from "./command-job-manager"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const PROFILE_TEMP_DIR_PREFIX = "clinemm-sandbox-profile-"

const HAS_SUBSTRATE: boolean = (() => {
	if (process.platform !== "darwin") return false
	if (!existsSync("/usr/bin/sandbox-exec")) return false
	const probe = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/bin/echo", "ok"], {
		encoding: "utf8",
		timeout: 2_000,
	})
	return probe.status === 0 && probe.stdout.trim() === "ok"
})()

const PARENT_SRC = `
import { spawn } from "node:child_process";
const CHILD = __CHILD_PATH__;
const c = spawn(process.execPath, [CHILD], { detached: true, stdio: ["ignore","pipe","pipe"] });
let out = "";
c.stdout.on("data", d => { out += d.toString(); });
c.stderr.on("data", d => { out += d.toString(); });
await new Promise(r => { const t = setInterval(() => { if (out.includes("CHILD_READY")) { clearInterval(t); r(); } }, 20); setTimeout(() => { clearInterval(t); r(); }, 3000); });
let errno = "NONE", ok = false;
try { process.kill(c.pid, "SIGTERM"); ok = true; } catch (e) { errno = e.code ?? ("ERR:" + e.message); }
let groupProbe = "NONE";
try { process.kill(-c.pid, 0); groupProbe = "EXISTS"; } catch (e) { groupProbe = "ERR_" + (e.code ?? "?"); }
let selfProbe = "NONE";
try { process.kill(0, 0); selfProbe = "OK_EXISTS"; } catch (e) { selfProbe = "ERR_" + (e.code ?? "?"); }
let foreignProbe = "NONE";
try { process.kill(1, 0); foreignProbe = "OK_EXISTS"; } catch (e) { foreignProbe = "ERR_" + (e.code ?? "?"); }
console.log("RECON01_SIGNAL " + JSON.stringify({ parentPid: process.pid, childPid: c.pid, signalOk: ok, signalErrno: errno, groupProbe, selfProbe, foreignProbe, childOut: out.trim() }));
await new Promise(r => setTimeout(r, 500));
try { process.kill(c.pid, "SIGKILL"); } catch {}
process.exit(0);
`

const CHILD_SRC = `
console.log("CHILD_READY pid=" + process.pid);
const t = setTimeout(() => { console.log("CHILD_SELF_EXIT"); process.exit(0); }, 4000);
process.on("SIGTERM", () => { console.log("CHILD_GOT_SIGTERM"); clearTimeout(t); process.exit(0); });
setInterval(() => {}, 1000);
`

describe.skipIf(!HAS_SUBSTRATE)("RECON01 P3: production Background Exec seam signal probe", () => {
	it("captures the live profile and the in-sandbox child-signal errno", async () => {
		const tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-recon01-p3-"))
		const workspaceRoot = join(tmpRoot, "ws")
		const scriptDir = join(tmpRoot, "scripts")
		mkdirSync(workspaceRoot, { recursive: true })
		mkdirSync(scriptDir, { recursive: true })

		const parentScript = join(scriptDir, "parent.mjs")
		const childScript = join(scriptDir, "child.mjs")
		writeFileSync(parentScript, PARENT_SRC.replace("__CHILD_PATH__", JSON.stringify(childScript)), "utf8")
		writeFileSync(childScript, CHILD_SRC, "utf8")

		const before = new Set<string>()
		for (const e of readdirSync(tmpdir())) {
			if (e.startsWith(PROFILE_TEMP_DIR_PREFIX)) before.add(e)
		}

		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		const prevOptIn = process.env[SANDBOX_OPTIN_ENV]
		process.env[SANDBOX_OPTIN_ENV] = "seatbelt"
		try {
			const startPromise = manager.start({
				command: `${process.execPath} ${parentScript}`,
				cwd: workspaceRoot,
				waitBudgetMs: 20_000,
				executionDeadlineMs: 20_000,
			})

			let profileBytes: Buffer | null = null
			const deadline = Date.now() + 3_000
			while (Date.now() < deadline && profileBytes === null) {
				await new Promise((r) => setTimeout(r, 10))
				const entries = readdirSync(tmpdir())
				const matches = entries.filter((e) => e.startsWith(PROFILE_TEMP_DIR_PREFIX) && !before.has(e))
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
						/* dir disappeared */
					}
				}
			}

			const start = await startPromise
			const stdout = start.stdout ?? ""
			const stderr = start.stderr ?? ""
			const signalLine = stdout.split("\n").find((l) => l.includes("RECON01_SIGNAL"))

			const report = {
				marker: "CLINEMM_RECON01_SIGNAL_PROBE",
				state: start.state,
				exitCode: start.exitCode,
				signal: start.signal,
				profileCaptured: profileBytes !== null,
				profileText: profileBytes ? profileBytes.toString("utf8") : null,
				signalLine: signalLine ?? null,
				stdout: stdout.slice(0, 4000),
				stderr: stderr.slice(0, 4000),
			}
			console.log(`RECON01_P3_REPORT=${JSON.stringify(report)}`)

			expect(profileBytes).not.toBeNull()
			expect(start.state).toBe("exited")
			expect(signalLine).toBeDefined()
		} finally {
			if (prevOptIn === undefined) delete process.env[SANDBOX_OPTIN_ENV]
			else process.env[SANDBOX_OPTIN_ENV] = prevOptIn
			await manager.dispose()
			try {
				rmSync(tmpRoot, { recursive: true, force: true })
			} catch {
				/* ignore */
			}
		}
	})
})

/**
 * ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 — C2 / real-kernel
 * adversarial conservation corpus.
 *
 * The bounded workspace-write repair ships as TWO simultaneous
 * contracts:
 *
 *   ALLOW: every Active Trusted Workspace root gains recursive
 *          READ + WRITE under the Seatbelt profile.
 *
 *   DENY : $HOME, parent paths, repository siblings, and arbitrary
 *          user-supplied paths remain unwritable when they are not
 *          part of the supplied `experimentalSandboxWorkspaceRoots`.
 *
 * These tests are darwin-host gated (require real `sandbox-exec`).
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"

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
	tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-wsw-c2-"))
})

afterEach(() => {
	delete process.env[SANDBOX_OPTIN_ENV]
	if (tmpRoot) {
		try {
			rmSync(tmpRoot, { recursive: true, force: true })
		} catch {}
		tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-wsw-c2-"))
	}
})

function withSandboxOptIn<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> | T {
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

describe.skipIf(!HAS_SUBSTRATE)(
	"ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 C2 — inside-workspace conservation (real kernel)",
	() => {
		it("WORKSPACE_CREATE (mkdir -p) is ALLOWED under the workspace trust boundary", async () => {
			const workspaceRoot = realpathSync(mkdtempSync(join(tmpRoot!, "ws-c2-create-")))
			const manager = new CommandJobManager({
				experimentalSandboxWorkspaceRoots: [workspaceRoot],
			})
			try {
				const target = join(workspaceRoot, ".factory-write-c2-create")
				await withSandboxOptIn("seatbelt", async () => {
					const start = await manager.start({
						command: `/bin/sh -c 'mkdir -p "${target}" 2>/dev/null && echo MKDIR_OK || echo MKDIR_KDENIED; ls -ld "${target}" 2>/dev/null && echo LS_OK || echo LS_KDENIED; echo DONE'`,
						cwd: workspaceRoot,
						env: {},
						waitBudgetMs: 5_000,
						executionDeadlineMs: 5_000,
					})
					expect(start.exitCode).toBe(0)
					expect(start.stdout).toContain("MKDIR_OK")
					expect(start.stdout).toContain("LS_OK")
					expect(existsSync(target)).toBe(true)
					rmSync(target, { recursive: true, force: true })
				})
			} finally {
				await manager.dispose()
				try {
					rmSync(workspaceRoot, { recursive: true, force: true })
				} catch {}
			}
		})

		it("WORKSPACE_APPEND / TRUNCATE / RENAME / DELETE / RMDIR / GRANDCHILD: ALL ALLOWED", async () => {
			const workspaceRoot = realpathSync(mkdtempSync(join(tmpRoot!, "ws-c2-all-")))
			const manager = new CommandJobManager({
				experimentalSandboxWorkspaceRoots: [workspaceRoot],
			})
			try {
				const grand = join(workspaceRoot, "a", "b", "c")
				await withSandboxOptIn("seatbelt", async () => {
					const start = await manager.start({
						command: `/bin/sh -c '
set +e
ROOT="${workspaceRoot}"
WS_FAMILY_DIR="$ROOT/family"
WS_FILE="$WS_FAMILY_DIR/sentinel.txt"
mkdir -p "$ROOT/parent" 2>/dev/null && echo WS_MKDIR_OK || echo WS_MKDIR_KDENIED
mkdir -p "$WS_FAMILY_DIR" 2>/dev/null
printf "ORIGINAL" > "$WS_FILE" 2>/dev/null && echo WS_CREATE_OK || echo WS_CREATE_KDENIED
printf "APPENDED" >> "$WS_FILE" 2>/dev/null && echo WS_APPEND_OK || echo WS_APPEND_KDENIED
: > "$WS_FILE" 2>/dev/null && echo WS_TRUNCATE_OK || echo WS_TRUNCATE_KDENIED
mv "$WS_FILE" "$WS_FAMILY_DIR/renamed.txt" 2>/dev/null && echo WS_RENAME_OK || echo WS_RENAME_KDENIED
printf "AFTER_RENAME" > "$WS_FAMILY_DIR/renamed.txt" 2>/dev/null && echo WS_OVERWRITE_OK || echo WS_OVERWRITE_KDENIED
rm -f "$WS_FAMILY_DIR/renamed.txt" 2>/dev/null && echo WS_DELETE_OK || echo WS_DELETE_KDENIED
rmdir "$WS_FAMILY_DIR" 2>/dev/null && echo WS_RMDIR_OK || echo WS_RMDIR_KDENIED
rmdir "$ROOT/parent" 2>/dev/null && echo WS_RMPARENT_OK || echo WS_RMPARENT_KDENIED
GRAND="${grand}"
mkdir -p "$GRAND" 2>/dev/null && printf GRAND > "$GRAND/probe" && cat "$GRAND/probe" && echo GRAND_OK || echo GRAND_KDENIED
rm -rf "$ROOT/a" 2>/dev/null && echo WS_GRAND_CLEANUP_OK || echo WS_GRAND_CLEANUP_KDENIED
echo DONE
'`,
						cwd: workspaceRoot,
						env: {},
						waitBudgetMs: 10_000,
						executionDeadlineMs: 10_000,
					})
					expect(start.exitCode).toBe(0)
					expect(start.stdout).toContain("WS_MKDIR_OK")
					expect(start.stdout).toContain("WS_CREATE_OK")
					expect(start.stdout).toContain("WS_APPEND_OK")
					expect(start.stdout).toContain("WS_TRUNCATE_OK")
					expect(start.stdout).toContain("WS_RENAME_OK")
					expect(start.stdout).toContain("WS_OVERWRITE_OK")
					expect(start.stdout).toContain("WS_DELETE_OK")
					expect(start.stdout).toContain("WS_RMDIR_OK")
					expect(start.stdout).toContain("GRAND_OK")
					expect(start.stdout).toContain("WS_GRAND_CLEANUP_OK")
				})
			} finally {
				await manager.dispose()
				try {
					rmSync(workspaceRoot, { recursive: true, force: true })
				} catch {}
			}
		})
	},
)

describe.skipIf(!HAS_SUBSTRATE)("ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 C2 — outside-workspace write is still denied", () => {
	it("HOME_OUTSIDE_WS_CREATE / MODIFY / DELETE / RENAME / CHILD: ALL KERNEL-DENIED (Phase 11 invariant)", async () => {
		const workspaceRoot = realpathSync(mkdtempSync(join(tmpRoot!, "ws-c2-out-ws-")))
		const outsideRoot = realpathSync(mkdtempSync(join(tmpRoot!, "outside-c2-a-")))
		const outsideTarget = join(outsideRoot, "sentinel.txt")
		writeFileSync(outsideTarget, "OUTSIDE_ORIGINAL\n")
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [workspaceRoot],
		})
		try {
			await withSandboxOptIn("seatbelt", async () => {
				const start = await manager.start({
					command: `/bin/sh -c '
set +e
printf "BAD" > "${outsideTarget}" 2>/dev/null && echo OUT_OK || echo OUT_KDENIED
mkdir -p "${outsideRoot}/sub" 2>/dev/null && echo SUBMKDIR_OK || echo SUBMKDIR_KDENIED
mv "${outsideTarget}" "${outsideTarget}.mv" 2>/dev/null && echo MOV_OK || echo MOV_KDENIED
rm -f "${outsideTarget}" 2>/dev/null && echo RM_OK || echo RM_KDENIED
ls -ld "${outsideTarget}" 2>/dev/null && echo LS_OK || echo LS_KDENIED
echo DONE
'`,
					cwd: workspaceRoot,
					env: {},
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.exitCode).toBe(0)
				expect(start.stdout).toContain("OUT_KDENIED")
				expect(start.stdout).toContain("SUBMKDIR_KDENIED")
				expect(start.stdout).toContain("MOV_KDENIED")
				expect(start.stdout).toContain("RM_KDENIED")
				expect(readFileSync(outsideTarget).toString("utf8")).toBe("OUTSIDE_ORIGINAL\n")
			})
		} finally {
			await manager.dispose()
			try {
				rmSync(workspaceRoot, { recursive: true, force: true })
			} catch {}
			try {
				rmSync(outsideRoot, { recursive: true, force: true })
			} catch {}
		}
	})

	it("WORKSPACE_TRUST_BOUNDARY: empty workspaceRoots = NOTHING writable (except /dev/null)", async () => {
		// Defense-in-depth: if the dogfood caller forgets to thread
		// workspace paths, the sandbox falls back to the prior
		// "everything writable except /dev/null = empty" contract.
		// No silent widening.
		const workspaceRoot = realpathSync(mkdtempSync(join(tmpRoot!, "ws-c2-empty-")))
		const manager = new CommandJobManager({
			experimentalSandboxWorkspaceRoots: [],
		})
		try {
			await withSandboxOptIn("seatbelt", async () => {
				const start = await manager.start({
					command: `/bin/sh -c '
set +e
mkdir -p "${workspaceRoot}/X" 2>/dev/null && echo MKDIR_OK || echo MKDIR_KDENIED
printf BAD > "${workspaceRoot}/probe" 2>/dev/null && echo WRITE_OK || echo WRITE_KDENIED
echo DONE
'`,
					cwd: workspaceRoot,
					env: {},
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				expect(start.exitCode).toBe(0)
				expect(start.stdout).toContain("MKDIR_KDENIED")
				expect(start.stdout).toContain("WRITE_KDENIED")
				expect(existsSync(join(workspaceRoot, "X"))).toBe(false)
				expect(existsSync(join(workspaceRoot, "probe"))).toBe(false)
			})
		} finally {
			await manager.dispose()
			try {
				rmSync(workspaceRoot, { recursive: true, force: true })
			} catch {}
		}
	})
})

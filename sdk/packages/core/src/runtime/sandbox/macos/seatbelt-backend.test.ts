/**
 * Tests for the SeatbeltSandboxBackendExperimental — end-to-end.
 *
 * These tests exercise the ACTUAL `/usr/bin/sandbox-exec` binary on
 * macOS. They construct a synthetic-real filesystem fixture, generate
 * a profile, and observe the kernel's deny/allow decisions.
 *
 * Tests cover the recon matrix (filesystem, symlink, inheritance,
 * network, environment) and the fail-closed invariants. They run
 * only on darwin.
 *
 * ACT: ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { noSandboxBackend } from "../no-sandbox-backend";
import {
	SeatbeltSandboxBackendExperimental,
	SEATBELT_BACKEND_ID,
} from "./seatbelt-backend";
import {
	probeSeatbeltAvailability,
	SANDBOX_EXEC_PATH,
} from "./seatbelt-availability";
import { SandboxError } from "../types";
import type { CommandCapability, CommandInvocation } from "../types";

const HAS_SUBSTRATE =
	process.platform === "darwin" && probeSeatbeltAvailability();

/**
 * Run a `SpawnConfig`-shaped invocation via `child_process.spawnSync`.
 * Returns exit code, stdout, stderr.
 *
 * Mirrors the production executor's env-merge behavior:
 *
 *     env: { ...process.env, ...prepared.env }
 *
 * For `inherit` mode, `prepared.env === {}` and the child sees
 * process.env (mirrors the production `CommandJobManager.start`
 * `{ ...process.env, ...options.env ?? {} }`). For `sanitized` mode,
 * `prepared.env` is the fully materialized env and overrides
 * process.env for any keys it sets (mirrors the Seatbelt
 * backend's contract). Tests that assert "no secret-shaped keys
 * leak" must use `sanitized` mode explicitly.
 */
function runPrepared(prepared: {
	executable: string;
	args: readonly string[];
	cwd: string;
	env: Record<string, string>;
	input?: string;
}): { exitCode: number | null; stdout: string; stderr: string } {
	const result = spawnSync(prepared.executable, [...prepared.args], {
		cwd: prepared.cwd,
		env: { ...process.env, ...prepared.env },
		input: prepared.input,
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 30_000,
		encoding: "utf8",
	});
	return {
		exitCode: result.status,
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		stderr: typeof result.stderr === "string" ? result.stderr : "",
	};
}

/**
 * Build a synthetic-real filesystem fixture:
 *
 *   <root>/
 *     inside/
 *       read.txt
 *       write.txt
 *       link-out -> ../outside
 *     outside/
 *       secret.txt
 *
 * The symlink is RELATIVE so resolving INSIDE/link-out/secret.txt hits
 * OUTSIDE/secret.txt (recon gotcha #1: subpath matching is against
 * the resolved vnode).
 */
function buildFixture(): {
	root: string;
	inside: string;
	outside: string;
	linkOut: string;
	secret: string;
	read: string;
	write: string;
} {
	const root = mkdtempSync(join(tmpdir(), "clinemm-sandbox-test-"));
	const inside = join(root, "inside");
	const outside = join(root, "outside");
	mkdirSync(inside, { recursive: true });
	mkdirSync(outside, { recursive: true });

	const read = join(inside, "read.txt");
	const write = join(inside, "write.txt");
	const secret = join(outside, "secret.txt");
	const linkOut = join(inside, "link-out");

	writeFileSync(read, "inside-readable\n");
	writeFileSync(write, "inside-writable-content\n");
	writeFileSync(secret, "TOP-SECRET-DO-NOT-LEAK\n");
	symlinkSync("../outside", linkOut);

	return { root, inside, outside, linkOut, secret, read, write };
}

function cleanupFixture(root: string): void {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

describe.skipIf(!HAS_SUBSTRATE)(
	"SeatbeltSandboxBackendExperimental — REAL substrate",
	() => {
		it("emits a parseable SBPL profile when prepare() is called", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["hello"],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				expect(prepared.executable).toBe(SANDBOX_EXEC_PATH);
				expect(prepared.args[0]).toBe("-f");
				expect(prepared.args[2]).toBe("/bin/echo");
				expect(prepared.args[3]).toBe("hello");

				const profilePath = prepared.args[1] as string;
				expect(existsSync(profilePath)).toBe(true);
				const profile = readFileSync(profilePath, "utf8");
				expect(profile).toContain("(version 1)");

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("filesystem: RW inside write PASSES", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/sh",
					args: [
						"-c",
						`printf X >> ${JSON.stringify(fixture.write)}; echo OK`,
					],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const r = runPrepared(prepared);
				expect(r.exitCode).toBe(0);
				expect(r.stdout).toContain("OK");
				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("filesystem: outside read DENIED", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/cat",
					args: [fixture.secret],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const r = runPrepared(prepared);
				expect(r.exitCode).not.toBe(0);
				expect(r.stderr).toMatch(/Operation not permitted/);
				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("filesystem: outside write DENIED (defense-in-depth)", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				// We deliberately do NOT use `|| echo DENIED` here: that
				// pattern makes the shell exit 0 even when the write
				// fails. We want a non-zero exit code so the kernel
				// deny is observable in the exit status.
				const cmd: CommandInvocation = {
					executable: "/bin/sh",
					args: [
						"-c",
						`printf BAD >> ${JSON.stringify(fixture.secret)}`,
					],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const r = runPrepared(prepared);
				expect(r.exitCode).not.toBe(0);
				expect(r.stderr).toMatch(/Operation not permitted/);
				const after = readFileSync(fixture.secret, "utf8");
				expect(after).toBe("TOP-SECRET-DO-NOT-LEAK\n");
				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("filesystem: symlink escape DENIED", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/cat",
					args: [join(fixture.linkOut, "secret.txt")],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const r = runPrepared(prepared);
				expect(r.exitCode).not.toBe(0);
				expect(r.stderr).toMatch(/Operation not permitted/);
				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("network: deny blocks nc-style outbound connectivity", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "deny",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/usr/bin/nc",
					args: ["-w", "2", "1.1.1.1", "53"],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const r = runPrepared(prepared);
				// `(deny network*)` is silent on stderr; the only
				// observable signal is a non-zero exit code (and the
				// absence of stdout — we did not connect).
				expect(r.exitCode).not.toBe(0);
				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("inheritance: bash child inherits the deny", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/bash",
					args: ["-c", `cat ${JSON.stringify(fixture.secret)}`],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const r = runPrepared(prepared);
				expect(r.exitCode).not.toBe(0);
				expect(r.stderr).toMatch(/Operation not permitted/);
				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("environment: sanitized mode strips SSH_AUTH_SOCK and AWS_* from the child", async () => {
			const fixture = buildFixture();
			try {
				const seedKeys = [
					"SSH_AUTH_SOCK",
					"SSH_AGENT_PID",
					"AWS_ACCESS_KEY_ID",
					"AWS_SECRET_ACCESS_KEY",
					"OPENAI_API_KEY",
					"ANTHROPIC_API_KEY",
					"DOCKER_HOST",
					"KUBECONFIG",
					"NIX_SSL_CERT_FILE",
					"GITHUB_TOKEN",
					"NPM_TOKEN",
				];
				const restore: Record<string, string | undefined> = {};
				for (const k of seedKeys) {
					restore[k] = process.env[k];
					process.env[k] = `FAKE-${k}-value`;
				}

				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "sanitized", allow: [] },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/usr/bin/env",
					args: [],
					cwd: fixture.inside,
					env: {},
				};
				try {
					const prepared =
						await SeatbeltSandboxBackendExperimental.prepare({
							capability: cap,
							command: cmd,
						});
					const r = runPrepared(prepared);
					expect(r.exitCode).toBe(0);
					for (const k of seedKeys) {
						expect(r.stdout).not.toContain(`${k}=FAKE-`);
					}
					expect(r.stdout).toMatch(/^PATH=/m);
					expect(r.stdout).toMatch(/^TERM=/m);
					expect(r.stdout).toMatch(/^LANG=/m);
					await prepared.cleanup?.();
				} finally {
					for (const [k, v] of Object.entries(restore)) {
						if (v === undefined) {
							delete process.env[k];
						} else {
							process.env[k] = v;
						}
					}
				}
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("classifier-mistake: outside write via NoSandboxBackend succeeds (control)", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/sh",
					args: [
						"-c",
						`printf CONTROL >> ${JSON.stringify(fixture.secret)} && echo OK`,
					],
					cwd: fixture.inside,
					env: {},
				};
				const prepared = await noSandboxBackend.prepare({
					capability: cap,
					command: cmd,
				});
				const r = runPrepared(prepared);
				expect(r.exitCode).toBe(0);
				expect(r.stdout).toContain("OK");
				const after = readFileSync(fixture.secret, "utf8");
				expect(after).toContain("CONTROL");
				void prepared;
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("classifier-mistake: same write via SeatbeltBackend is DENIED (DEFENSE_IN_DEPTH_PROOF)", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/sh",
					args: [
						"-c",
						`printf BAD >> ${JSON.stringify(fixture.secret)}`,
					],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const r = runPrepared(prepared);
				expect(r.exitCode).not.toBe(0);
				expect(r.stderr).toMatch(/Operation not permitted/);
				const after = readFileSync(fixture.secret, "utf8");
				expect(after).not.toContain("BAD");
				expect(after).toBe("TOP-SECRET-DO-NOT-LEAK\n");
				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("stdout/stderr/exit conservation for benign commands", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/sh",
					args: ["-c", "printf 'OUT\\n'; printf 'ERR\\n' >&2; exit 7"],
					cwd: fixture.inside,
					env: {},
				};
				const noSandboxPrepared = await noSandboxBackend.prepare({
					capability: cap,
					command: cmd,
				});
				const rDisabled = runPrepared(noSandboxPrepared);

				const seatbeltPrepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const rSeatbelt = runPrepared(seatbeltPrepared);

				expect(rDisabled.exitCode).toBe(7);
				expect(rSeatbelt.exitCode).toBe(7);
				expect(rDisabled.stdout).toBe("OUT\n");
				expect(rSeatbelt.stdout).toBe("OUT\n");
				expect(rDisabled.stderr).toBe("ERR\n");
				expect(rSeatbelt.stderr).toContain("ERR\n");
				await seatbeltPrepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("cleanup hook removes the profile temp dir", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["ok"],
					cwd: fixture.inside,
					env: {},
				};
				const prepared =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				const profilePath = prepared.args[1] as string;
				expect(existsSync(profilePath)).toBe(true);
				await prepared.cleanup?.();
				expect(existsSync(profilePath)).toBe(false);
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("fail-closed: invalid writableRoot throws SandboxError, command NOT executed", async () => {
			const fixture = buildFixture();
			try {
				const cap: CommandCapability = {
					readonlyRoots: [],
					writableRoots: ["/this/path/does/not/exist/at/all"],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["should not run"],
					cwd: fixture.inside,
					env: {},
				};
				let caught: unknown;
				try {
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
				} catch (e) {
					caught = e;
				}
				expect(caught).toBeInstanceOf(SandboxError);
				const err = caught as SandboxError;
				expect(err.backendId).toBe(SEATBELT_BACKEND_ID);
				expect(err.reason).toBe("canonicalization-failed");
			} finally {
				cleanupFixture(fixture.root);
			}
		});
	},
);

describe("SeatbeltSandboxBackendExperimental — non-darwin fail-closed", () => {
	it.runIf(process.platform !== "darwin")(
		"isAvailable() returns false on non-darwin",
		async () => {
			expect(await SeatbeltSandboxBackendExperimental.isAvailable()).toBe(
				false,
			);
		},
	);
});

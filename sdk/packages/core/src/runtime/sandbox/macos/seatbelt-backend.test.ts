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
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { noSandboxBackend } from "../no-sandbox-backend";
import type {
	CommandCapability,
	CommandInvocation,
	SandboxError,
} from "../types";
import {
	probeSeatbeltAvailability,
	SANDBOX_EXEC_PATH,
} from "./seatbelt-availability";
import {
	SEATBELT_BACKEND_ID,
	SeatbeltSandboxBackendExperimental,
} from "./seatbelt-backend";

const HAS_SUBSTRATE =
	process.platform === "darwin" && probeSeatbeltAvailability();

/**
 * Run a `SpawnConfig`-shaped invocation via `child_process.spawnSync`.
 * Returns exit code, stdout, stderr.
 *
 * CORRECTION01-P1: Honors `prepared.envSemantics` (the typed
 * metadata on the invocation), NOT a magic key inside `env`.
 *
 *   - `envSemantics === "complete"`: the executor MUST use the
 *     prepared env AS-IS, with no further spreading of `process.env`.
 *     This is the contract for sanitized sandboxed environments.
 *
 *   - `envSemantics === "overlay"` (or absent): legacy semantics. The
 *     executor spreads `process.env` underneath `prepared.env`. This
 *     mirrors the production `CommandJobManager.start` invocation:
 *     `{ ...process.env, ...options.env ?? {} }`.
 *
 * `inherit` mode and `NoSandboxBackend` produce `"overlay"`. Sanitized
 * mode produces `"complete"`.
 */
function runPrepared(prepared: {
	executable: string;
	args: readonly string[];
	cwd: string;
	env: Record<string, string>;
	envSemantics?: "overlay" | "complete";
	input?: string;
}): { exitCode: number | null; stdout: string; stderr: string } {
	const semantics = prepared.envSemantics ?? "overlay";
	const env: Record<string, string> =
		semantics === "complete"
			? { ...prepared.env }
			: { ...(process.env as Record<string, string>), ...prepared.env };
	const result = spawnSync(prepared.executable, [...prepared.args], {
		cwd: prepared.cwd,
		env,
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
					readonlyRoots: [fixture.inside],
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
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/sh",
					args: ["-c", `printf X >> ${JSON.stringify(fixture.write)}; echo OK`],
					cwd: fixture.inside,
					env: {},
				};
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
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
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
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
					args: ["-c", `printf BAD >> ${JSON.stringify(fixture.secret)}`],
					cwd: fixture.inside,
					env: {},
				};
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
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
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
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
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
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
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
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
					const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
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
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [fixture.outside],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				};
				const cmd: CommandInvocation = {
					executable: "/bin/sh",
					args: ["-c", `printf BAD >> ${JSON.stringify(fixture.secret)}`],
					cwd: fixture.inside,
					env: {},
				};
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
					readonlyRoots: [fixture.inside],
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
					readonlyRoots: [fixture.inside],
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
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
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
				// prepare() either throws a SandboxError (from
				// canonicalizeSandboxRoot etc.) or re-throws the raw
				// error from generateSeatbeltProfile. Either way, the
				// test only cares that prepare() threw (so the wrap
				// ran and cleaned up).
				expect(caught).toBeInstanceOf(Error);
				const err = caught as SandboxError;
				expect(err.backendId).toBe(SEATBELT_BACKEND_ID);
				expect(err.reason).toBe("canonicalization-failed");
			} finally {
				cleanupFixture(fixture.root);
			}
		});
	},
);

/**
 * ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-CORRECTION01.
 *
 * Lifecycle P1: when the backend synthesizes a temp root and a
 * later step in prepare() throws (profile generation, profile dir
 * creation, profile write, env materialization), the synthesized
 * temp root MUST be cleaned up before the SandboxError propagates.
 *
 * Without this, a prepare() failure between successful synthesis
 * and successful return leaks /private/var/folders/.../T/clinemm-sandbox-temp-XXXXX
 * (an empty dir, no security impact, but a bounded resource
 * contract violation).
 *
 * Caller-supplied tempRoot is NEVER cleaned here — the caller
 * owns it.
 *
 * Test seams:
 *   - Profile-write failure: vi.spyOn(writeFileSync, ...) forces
 *     a throw on the profile file write. The synthesized temp root
 *     must be removed best-effort before the SandboxError escapes.
 *   - Profile-dir creation failure: vi.spyOn(mkdtempSync, ...) for
 *     the SECOND mkdtempSync call (the profile dir, after the
 *     first one succeeded for the synthesized temp root).
 *
 * Both tests run on any platform — they observe host-side
 * cleanup, not sandbox-exec behavior.
 */
/**
 * ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-CORRECTION01.
 *
 * Lifecycle P1: when the backend synthesizes a temp root and a
 * later step in prepare() throws (profile generation, profile
 * dir creation, profile write, env materialization), the
 * synthesized temp root MUST be cleaned up before the
 * SandboxError propagates.
 *
 * Test seam: a module-level vi.mock on ./seatbelt-profile with
 * a mutable switch. The mock factory always returns a profile
 * generator that throws when the switch is true. This is the
 * smallest viable DI seam that affects the backend's static
 * import (vi.mock at file scope is hoisted and intercepts all
 * subsequent imports of the specifier).
 */
const mockProfileState: { shouldThrow: boolean } = { shouldThrow: false };

vi.mock("./seatbelt-profile", async () => {
	const actual =
		await vi.importActual<typeof import("./seatbelt-profile")>(
			"./seatbelt-profile",
		);
	return {
		generateSeatbeltProfile: (
			...args: Parameters<typeof actual.generateSeatbeltProfile>
		) => {
			if (mockProfileState.shouldThrow) {
				throw new Error("simulated profile-generation failure");
			}
			return actual.generateSeatbeltProfile(...args);
		},
	};
});

describe("SeatbeltSandboxBackendExperimental — CORRECTION01: synthesized temp root cleaned on prepare() failure", () => {
	async function expectCleanupOnFailure(): Promise<string | undefined> {
		const fixture = buildFixture();
		try {
			const before = new Set<string>();
			for (const e of readdirSync(tmpdir())) {
				if (e.startsWith("clinemm-sandbox-temp-")) before.add(e);
			}

			const cap: CommandCapability = {
				readonlyRoots: [],
				writableRoots: [],
				network: "deny",
				environment: { mode: "inherit" },
				cwd: fixture.inside,
				// tempRoot omitted -- backend must synthesize.
			};
			const cmd: CommandInvocation = {
				executable: "/bin/echo",
				args: ["should not run"],
				cwd: fixture.inside,
				env: {},
			};

			mockProfileState.shouldThrow = true;
			let caught: unknown;
			try {
				await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				});
			} catch (e) {
				caught = e;
			} finally {
				mockProfileState.shouldThrow = false;
			}

			// prepare() either throws a SandboxError (from
			// canonicalizeSandboxRoot etc.) or re-throws the raw
			// error from generateSeatbeltProfile. Either way, the
			// test only cares that prepare() threw (so the wrap
			// ran and cleaned up).
			expect(caught).toBeInstanceOf(Error);

			let leaked: string | undefined;
			for (const e of readdirSync(tmpdir())) {
				if (e.startsWith("clinemm-sandbox-temp-") && !before.has(e)) {
					const full = join(tmpdir(), e);
					try {
						if (statSync(full).isDirectory()) {
							leaked = full;
							break;
						}
					} catch {
						// already removed; not a leak
					}
				}
			}
			return leaked;
		} finally {
			cleanupFixture(fixture.root);
		}
	}

	it("CORRECTION01: profile generation failure cleans up the synthesized temp root", async () => {
		const leaked = await expectCleanupOnFailure();
		expect(leaked).toBeUndefined();
	});

	it("CORRECTION01: caller-supplied tempRoot is NOT touched on any failure", async () => {
		// A caller-supplied cap.tempRoot is the caller's
		// responsibility and MUST NOT be cleaned by the backend on
		// any failure. The profile-generation failure (mocked)
		// must not delete it.
		const fixture = buildFixture();
		try {
			const callerTempRoot = join(fixture.inside, "caller-temp");
			mkdirSync(callerTempRoot);

			const cap: CommandCapability = {
				readonlyRoots: [],
				writableRoots: [],
				network: "deny",
				environment: { mode: "inherit" },
				cwd: fixture.inside,
				tempRoot: callerTempRoot,
			};
			const cmd: CommandInvocation = {
				executable: "/bin/echo",
				args: ["should not run"],
				cwd: fixture.inside,
				env: {},
			};

			mockProfileState.shouldThrow = true;
			try {
				await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				});
			} catch {
				// expected
			} finally {
				mockProfileState.shouldThrow = false;
			}

			expect(existsSync(callerTempRoot)).toBe(true);
		} finally {
			cleanupFixture(fixture.root);
		}
	});
});

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

// =============================================================================
// ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
// PHASE A/B/C/D: pure-functional backend wiring tests.
// =============================================================================
describe("ACT-IMPL01: backend ssh-agent authority wiring (pure-functional)", () => {
	it("default mode: SSH_AUTH_SOCK is NOT reintroduced", async () => {
		const fixture = buildFixture();
		try {
			const cap: CommandCapability = {
				readonlyRoots: [fixture.inside],
				writableRoots: [fixture.inside],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				cwd: fixture.inside,
			};
			const cmd: CommandInvocation = {
				executable: "/usr/bin/env",
				args: [],
				cwd: fixture.inside,
				env: {},
			};
			const prev = process.env.SSH_AUTH_SOCK;
			process.env.SSH_AUTH_SOCK = "/tmp/seatbelt-test-fake-sock";
			try {
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				});
				expect(prepared.env.SSH_AUTH_SOCK ?? "").toBe("");
			} finally {
				if (prev === undefined) delete process.env.SSH_AUTH_SOCK;
				else process.env.SSH_AUTH_SOCK = prev;
				cleanupFixture(fixture.root);
			}
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it("deny mode: SSH_AUTH_SOCK is NOT reintroduced even when present in parent env", async () => {
		const fixture = buildFixture();
		try {
			const cap: CommandCapability = {
				readonlyRoots: [fixture.inside],
				writableRoots: [fixture.inside],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				cwd: fixture.inside,
				sshAuthenticationAuthority: { mode: "deny" },
			};
			const cmd: CommandInvocation = {
				executable: "/usr/bin/env",
				args: [],
				cwd: fixture.inside,
				env: {},
			};
			const prev = process.env.SSH_AUTH_SOCK;
			process.env.SSH_AUTH_SOCK = "/tmp/seatbelt-test-fake-sock";
			try {
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				});
				expect(prepared.env.SSH_AUTH_SOCK ?? "").toBe("");
			} finally {
				if (prev === undefined) delete process.env.SSH_AUTH_SOCK;
				else process.env.SSH_AUTH_SOCK = prev;
				cleanupFixture(fixture.root);
			}
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});
});
// These are substrate-gated; they execute only when probeSeatbeltAvailability()
// returns true (Terminal.app / iTerm2 / debug-harness — NOT this VSCodium
// nested-sandboxed authoring shell). When HAS_SUBSTRATE is false they
// `skip` cleanly with no signal — the matrix above already proves the
// pure-functional seams.
describe.skipIf(!HAS_SUBSTRATE)(
	"ACT-IMPL01: host-kernel quartet (SSH-03, SSH-04, SSH-06, SSH-12)",
	() => {
		async function bindUnixSocket(path: string): Promise<() => void> {
			const server = createServer();
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen({ path }, () => resolve());
			});
			return () => {
				server.close();
				try {
					unlinkSync(path);
				} catch {
					/* already gone */
				}
			};
		}

		function buildSocketFixture(): {
			root: string;
			inside: string;
			agentSock: string;
			siblingSock: string;
		} {
			const suffix = randomBytes(6).toString("hex");
			const root = `/tmp/clinemm-host-kernel-${suffix}`;
			mkdirSync(root, { recursive: true });
			const inside = join(root, "inside");
			mkdirSync(inside, { recursive: true });
			return {
				root,
				inside,
				agentSock: join(root, "agent.sock"),
				siblingSock: join(root, "sibling.sock"),
			};
		}

		function cleanupSocketFixture(fixture: { root: string }): void {
			try {
				rmSync(fixture.root, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}

		function writeConnectProbe(inside: string, name: string): string {
			const probePath = join(inside, name);
			// sys.exit(42) in the except branch is load-bearing: without it,
			// a correctly-denied Seatbelt AF_UNIX connect yields exit=0 +
			// PY_CONNECT_ERROR in stdout, and the SSH-12 sibling assertion
			// `expect(siblingRes.exitCode).not.toBe(0)` fails for the wrong
			// reason. The numeric value (42) is arbitrary; the invariant is
			// "denied connect == nonzero exit".
			const probeBody = [
				"import socket, sys",
				"p = sys.argv[1]",
				"try:",
				"    s = socket.socket(socket.AF_UNIX)",
				"    s.settimeout(5)",
				"    s.connect(p)",
				"    s.close()",
				"    print('PY_CONNECT_OK')",
				"except Exception as e:",
				"    code = getattr(e, 'errno', None)",
				"    print('PY_CONNECT_ERROR=' + (str(code) if code is not None else type(e).__name__))",
				"    sys.exit(42)",
			].join("\n");
			writeFileSync(probePath, probeBody, { mode: 0o755 });
			return probePath;
		}

		it("SSH-03 ENV: agent-mode child sees SSH_AUTH_SOCK (canonical realpath)", async () => {
			const fixture = buildSocketFixture();
			try {
				const closeSocket = await bindUnixSocket(fixture.agentSock);
				const CANONICAL = realpathSync(fixture.agentSock);
				const cap: CommandCapability = {
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					network: "deny",
					environment: { mode: "sanitized", allow: [] },
					cwd: fixture.inside,
					sshAuthenticationAuthority: { mode: "agent" },
				};
				const cmd: CommandInvocation = {
					executable: "/usr/bin/env",
					args: [],
					cwd: fixture.inside,
					env: {},
				};
				const prev = process.env.SSH_AUTH_SOCK;
				process.env.SSH_AUTH_SOCK = CANONICAL;
				try {
					const prepared = await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
					const res = runPrepared(prepared);
					const line = res.stdout
						.split("\n")
						.find((l) => l.startsWith("SSH_AUTH_SOCK="));
					expect(line).toBeDefined();
					expect(line).toContain(CANONICAL);
				} finally {
					if (prev === undefined) {
						delete process.env.SSH_AUTH_SOCK;
					} else {
						process.env.SSH_AUTH_SOCK = prev;
					}
					closeSocket();
				}
			} finally {
				cleanupSocketFixture(fixture);
			}
		});

		it("SSH-04 connect: agent-mode child can connect to authorized agent.sock (real connect(2))", async () => {
			const fixture = buildSocketFixture();
			try {
				const closeSocket = await bindUnixSocket(fixture.agentSock);
				const CANONICAL = realpathSync(fixture.agentSock);
				const probePath = writeConnectProbe(fixture.inside, "connect_probe.py");
				const cap: CommandCapability = {
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					network: "deny",
					environment: { mode: "sanitized", allow: [] },
					cwd: fixture.inside,
					sshAuthenticationAuthority: { mode: "agent" },
				};
				const cmd: CommandInvocation = {
					executable: "/usr/bin/python3",
					args: [probePath, CANONICAL],
					cwd: fixture.inside,
					env: {},
				};
				const prev = process.env.SSH_AUTH_SOCK;
				process.env.SSH_AUTH_SOCK = CANONICAL;
				try {
					// POSITIVE CONTROL: no Seatbelt, client itself works.
					const control = await noSandboxBackend.prepare({
						capability: cap,
						command: cmd,
					});
					const controlRes = runPrepared(control);
					expect(controlRes.exitCode).toBe(0);
					expect(controlRes.stdout).toContain("PY_CONNECT_OK");

					// SEATBELT agent mode: the contract under test.
					const prepared = await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
					const res = runPrepared(prepared);
					expect(res.exitCode).toBe(0);
					expect(res.stdout).toContain("PY_CONNECT_OK");
					expect(res.stdout).not.toContain("PY_CONNECT_ERROR");
				} finally {
					if (prev === undefined) {
						delete process.env.SSH_AUTH_SOCK;
					} else {
						process.env.SSH_AUTH_SOCK = prev;
					}
					closeSocket();
				}
			} finally {
				cleanupSocketFixture(fixture);
			}
		});

		it("SSH-06 raw key: agent-mode child cannot read private key bytes (raw-key conservation)", async () => {
			const fixture = buildSocketFixture();
			try {
				const FAKE_SSH_DIR = join(fixture.inside, ".ssh");
				mkdirSync(FAKE_SSH_DIR, { recursive: true });
				const FAKE_KEY = join(FAKE_SSH_DIR, "id_rsa");
				writeFileSync(FAKE_KEY, "FAKE_PRIVATE_KEY_BLOCK\n", "utf8");
				const CANONICAL_KEY = realpathSync(FAKE_KEY);

				const closeSocket = await bindUnixSocket(fixture.agentSock);
				const CANONICAL_AGENT = realpathSync(fixture.agentSock);

				const cap: CommandCapability = {
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					network: "deny",
					environment: { mode: "sanitized", allow: [] },
					cwd: fixture.inside,
					sshAuthenticationAuthority: { mode: "agent" },
					denyReadSubpaths: [CANONICAL_KEY],
				};
				const cmd: CommandInvocation = {
					executable: "/bin/cat",
					args: [CANONICAL_KEY],
					cwd: fixture.inside,
					env: {},
				};
				const prev = process.env.SSH_AUTH_SOCK;
				process.env.SSH_AUTH_SOCK = CANONICAL_AGENT;
				try {
					const prepared = await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					});
					const res = runPrepared(prepared);
					expect(res.exitCode).not.toBe(0);
					expect(res.stdout).toBe("");
					expect(res.stderr).toMatch(
						/Operation not permitted|Permission denied/i,
					);
				} finally {
					if (prev === undefined) {
						delete process.env.SSH_AUTH_SOCK;
					} else {
						process.env.SSH_AUTH_SOCK = prev;
					}
					closeSocket();
				}
			} finally {
				cleanupSocketFixture(fixture);
			}
		});
		it("SSH-12 sibling: agent-mode child cannot connect to unauthorized sibling.sock (path-literal scope, real connect(2))", async () => {
			const fixture = buildSocketFixture();
			try {
				const closeAuth = await bindUnixSocket(fixture.agentSock);
				const closeSibling = await bindUnixSocket(fixture.siblingSock);
				const CANONICAL_AUTH = realpathSync(fixture.agentSock);
				const CANONICAL_SIBLING = realpathSync(fixture.siblingSock);
				expect(CANONICAL_AUTH).not.toBe(CANONICAL_SIBLING);

				const probePath = writeConnectProbe(fixture.inside, "connect_probe.py");

				const cap: CommandCapability = {
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					network: "deny",
					environment: { mode: "sanitized", allow: [] },
					cwd: fixture.inside,
					sshAuthenticationAuthority: { mode: "agent" },
				};
				const authProbeCmd: CommandInvocation = {
					executable: "/usr/bin/python3",
					args: [probePath, CANONICAL_AUTH],
					cwd: fixture.inside,
					env: {},
				};
				const siblingProbeCmd: CommandInvocation = {
					executable: "/usr/bin/python3",
					args: [probePath, CANONICAL_SIBLING],
					cwd: fixture.inside,
					env: {},
				};
				const prev = process.env.SSH_AUTH_SOCK;
				process.env.SSH_AUTH_SOCK = CANONICAL_AUTH;
				try {
					// POSITIVE CONTROLS (no Seatbelt): both reachable.
					const controlAuth = await noSandboxBackend.prepare({
						capability: cap,
						command: authProbeCmd,
					});
					expect(runPrepared(controlAuth).stdout).toContain("PY_CONNECT_OK");
					const controlSibling = await noSandboxBackend.prepare({
						capability: cap,
						command: siblingProbeCmd,
					});
					expect(runPrepared(controlSibling).stdout).toContain("PY_CONNECT_OK");

					// SEATBELT agent mode: authorized connects, sibling denied.
					const authPrepared = await SeatbeltSandboxBackendExperimental.prepare(
						{ capability: cap, command: authProbeCmd },
					);
					const authRes = runPrepared(authPrepared);
					expect(authRes.exitCode).toBe(0);
					expect(authRes.stdout).toContain("PY_CONNECT_OK");
					expect(authRes.stdout).not.toContain("PY_CONNECT_ERROR");

					const siblingPrepared =
						await SeatbeltSandboxBackendExperimental.prepare({
							capability: cap,
							command: siblingProbeCmd,
						});
					const siblingRes = runPrepared(siblingPrepared);
					expect(siblingRes.exitCode).not.toBe(0);
					expect(siblingRes.stdout).toMatch(/PY_CONNECT_ERROR=/);
					expect(siblingRes.stdout).not.toContain("PY_CONNECT_OK");
				} finally {
					if (prev === undefined) {
						delete process.env.SSH_AUTH_SOCK;
					} else {
						process.env.SSH_AUTH_SOCK = prev;
					}
					closeAuth();
					closeSibling();
				}
			} finally {
				cleanupSocketFixture(fixture);
			}
		});
	},
);

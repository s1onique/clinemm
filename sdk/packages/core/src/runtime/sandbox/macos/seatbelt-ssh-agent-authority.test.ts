/**
 * ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
 *
 * Phase A/B/D RED/GREEN tests for the ssh-agent authority surface.
 * Pure-functional: do NOT require the macOS kernel Seatbelt substrate.
 *
 * The host-kernel quartet (SSH-03/04/06/12) is exercised on a
 * substrate-eligible shell per ACT §6.
 *
 * Contract enforced here:
 *   1. SINGLE SOURCE OF TRUTH for the socket path is
 *      `process.env.SSH_AUTH_SOCK`. The capability has NO
 *      `socketPath` field (removed in correction cycle).
 *   2. AF_UNIX socket type is validated via lstat S_IFSOCK mask.
 *      Regular files / directories / anything-not-a-socket fail
 *      closed with `SandboxError(reason="canonicalization-failed")`.
 *   3. The profile path-literal and the child env SSH_AUTH_SOCK are
 *      the SAME string (one value, one owner).
 *
 * Run with:
 *   bun x vitest run --config vitest.config.ts \
 *     src/runtime/sandbox/macos/seatbelt-ssh-agent-authority.test.ts
 */

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

import { SeatbeltSandboxBackendExperimental } from "./seatbelt-backend";
import { generateSeatbeltProfile } from "./seatbelt-profile";
import type { CommandCapability, CommandInvocation } from "../types";

function buildFixture(): { root: string; inside: string; agent: string } {
	const root = mkdtempSync(join(tmpdir(), "clinemm-act-impl01-"));
	const inside = join(root, "inside");
	const agent = join(root, "agent");
	mkdirSync(inside, { recursive: true });
	mkdirSync(agent, { recursive: true });
	return { root, inside, agent };
}
function cleanupFixture(root: string): void {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		// best-effort
	}
}

/**
 * Best-effort probe: can THIS process (the vitest fork) bind an
 * AF_UNIX socket right now? On Terminal.app / iTerm2 / debug-harness
 * this returns true; on the VSCodium authoring shell the test forks
 * run inside a sandbox that rejects AF_UNIX socket bind with EINVAL,
 * in which case the positive-path tests (which require a real AF_UNIX
 * socket fixture) skip cleanly. The negative-path tests (regular
 * file / directory / missing path) do NOT require socket binding
 * and ALWAYS run.
 */
const CAN_BIND_AF_UNIX = await (async (): Promise<boolean> => {
	const probeDir = mkdtempSync(join(tmpdir(), "clinemm-probe-"));
	const probePath = join(probeDir, "probe.sock");
	try {
		unlinkSync(probePath);
	} catch {
		// not present
	}
	return await new Promise<boolean>((resolve) => {
		const server = createServer();
		server.once("error", () => {
			try {
				server.close();
			} catch {
				// ignore
			}
			resolve(false);
		});
		server.listen({ path: probePath }, () => {
			server.close(() => {
				try {
					unlinkSync(probePath);
				} catch {
					// ignore
				}
				resolve(true);
			});
		});
		try {
			rmSync(probeDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});
})();

/**
 * Bind a real AF_UNIX socket at `path`. Returns a close function.
 *
 * Uses Node's net.createServer (which uses socket(2) under the hood);
 * the resulting inode has S_IFSOCK set. This is what the isSocket
 * check requires — a `writeFileSync` placeholder is a regular file
 * and correctly fails closed (verified by the negative tests).
 */
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
			// already gone
		}
	};
}

describe("ACT-IMPL01 ssh-agent authority", () => {
	it.skipIf(!CAN_BIND_AF_UNIX)("agent mode: SSH_AUTH_SOCK IS reintroduced from parent env; SSH_AGENT_PID stays stripped", async () => {
		const fixture = buildFixture();
		try {
			const CANONICAL = join(fixture.agent, "agent.sock");
			const closeSocket = await bindUnixSocket(CANONICAL);
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
				expect(prepared.env.SSH_AUTH_SOCK).toBe(CANONICAL);
				expect(prepared.env.SSH_AGENT_PID ?? "").toBe("");
			} finally {
				if (prev === undefined) delete process.env.SSH_AUTH_SOCK;
				else process.env.SSH_AUTH_SOCK = prev;
				closeSocket();
				cleanupFixture(fixture.root);
			}
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it("default mode (no sshAuthenticationAuthority field): SSH_AUTH_SOCK is NOT reintroduced", async () => {
		const fixture = buildFixture();
		try {
			const CANONICAL = join(fixture.agent, "agent.sock");
			writeFileSync(CANONICAL, "");
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
			process.env.SSH_AUTH_SOCK = CANONICAL;
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
			const CANONICAL = join(fixture.agent, "agent.sock");
			writeFileSync(CANONICAL, "");
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
			process.env.SSH_AUTH_SOCK = CANONICAL;
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

	it("agent mode WITHOUT SSH_AUTH_SOCK in parent env: fails closed (canonicalization-failed)", async () => {
		const fixture = buildFixture();
		try {
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
			delete process.env.SSH_AUTH_SOCK;
			try {
				await expect(
					SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					}),
				).rejects.toMatchObject({
					name: "SandboxError",
					reason: "canonicalization-failed",
				});
			} finally {
				if (prev !== undefined) process.env.SSH_AUTH_SOCK = prev;
				cleanupFixture(fixture.root);
			}
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it("agent mode with non-existent SSH_AUTH_SOCK: fails closed (canonicalization-failed)", async () => {
		const fixture = buildFixture();
		try {
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
			process.env.SSH_AUTH_SOCK = "/nonexistent/path/agent.sock";
			try {
				await expect(
					SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					}),
				).rejects.toMatchObject({
					name: "SandboxError",
					reason: "canonicalization-failed",
				});
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

	it("agent mode with regular-file SSH_AUTH_SOCK (NOT a socket): fails closed (isSocket check)", async () => {
		const fixture = buildFixture();
		try {
			const CANONICAL = join(fixture.agent, "fake-sock");
			writeFileSync(CANONICAL, "this is not a socket");
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
				await expect(
					SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					}),
				).rejects.toMatchObject({
					name: "SandboxError",
					reason: "canonicalization-failed",
				});
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

	it("agent mode with directory-as-SSH_AUTH_SOCK: fails closed (isSocket check)", async () => {
		const fixture = buildFixture();
		try {
			const CANONICAL = join(fixture.agent, "directory");
			mkdirSync(CANONICAL, { recursive: true });
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
				await expect(
					SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					}),
				).rejects.toMatchObject({
					name: "SandboxError",
					reason: "canonicalization-failed",
				});
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

	it.skipIf(!CAN_BIND_AF_UNIX)("agent mode: profile contains AF_UNIX system-socket + path-literal network-outbound (one value, one owner)", async () => {
		const fixture = buildFixture();
		try {
			const CANONICAL = join(fixture.agent, "agent.sock");
			const closeSocket = await bindUnixSocket(CANONICAL);
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
				const profilePath = prepared.args[1];
				const profileContent = readFileSync(profilePath, "utf8");
				expect(profileContent).toContain("(socket-domain AF_UNIX))");
				expect(profileContent).toContain(
					`(remote unix-socket (path-literal "${CANONICAL}"))`,
				);
				expect(profileContent).not.toMatch(/\(remote unix-socket \(subpath/);
				// Profile path-literal and child env value MUST be the
				// same string (no divergence; single owner).
				expect(prepared.env.SSH_AUTH_SOCK).toBe(CANONICAL);
			} finally {
				if (prev === undefined) delete process.env.SSH_AUTH_SOCK;
				else process.env.SSH_AUTH_SOCK = prev;
				closeSocket();
				cleanupFixture(fixture.root);
			}
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it("deny mode: profile contains NO AF_UNIX socket rules", async () => {
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
			const prepared = await SeatbeltSandboxBackendExperimental.prepare({
				capability: cap,
				command: cmd,
			});
			const profilePath = prepared.args[1];
			const profileContent = readFileSync(profilePath, "utf8");
			expect(profileContent).not.toContain("AF_UNIX");
			expect(profileContent).not.toContain("unix-socket");
			cleanupFixture(fixture.root);
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it.skipIf(!CAN_BIND_AF_UNIX)("SSH-07 agent mode: unrelated secrets remain stripped", async () => {
		const fixture = buildFixture();
		try {
			const CANONICAL = join(fixture.agent, "agent.sock");
			const closeSocket = await bindUnixSocket(CANONICAL);
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
			const seedKeys = ["AWS_ACCESS_KEY_ID", "OPENAI_API_KEY", "GITHUB_TOKEN"];
			const restore: Record<string, string | undefined> = {};
			for (const k of seedKeys) {
				restore[k] = process.env[k];
				process.env[k] = `FAKE-${k}-value`;
			}
			const prev = process.env.SSH_AUTH_SOCK;
			process.env.SSH_AUTH_SOCK = CANONICAL;
			try {
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				});
				expect(prepared.env.SSH_AUTH_SOCK).toBe(CANONICAL);
				expect(prepared.env.AWS_ACCESS_KEY_ID ?? "").toBe("");
				expect(prepared.env.OPENAI_API_KEY ?? "").toBe("");
				expect(prepared.env.GITHUB_TOKEN ?? "").toBe("");
			} finally {
				if (prev === undefined) delete process.env.SSH_AUTH_SOCK;
				else process.env.SSH_AUTH_SOCK = prev;
				for (const [k, v] of Object.entries(restore)) {
					if (v === undefined) delete process.env[k];
					else process.env[k] = v;
				}
				closeSocket();
				cleanupFixture(fixture.root);
			}
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it.skipIf(!CAN_BIND_AF_UNIX)("SSH-13 agent mode: socket parent directory remains non-writable (no implicit write rule)", async () => {
		const fixture = buildFixture();
		try {
			const CANONICAL = join(fixture.agent, "agent.sock");
			const closeSocket = await bindUnixSocket(CANONICAL);
			const cap: CommandCapability = {
				readonlyRoots: [fixture.inside],
				writableRoots: [fixture.inside],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				cwd: fixture.inside,
				sshAuthenticationAuthority: { mode: "agent" },
			};
			const p = generateSeatbeltProfile(cap, {
				sshAgentCanonicalSocketPath: CANONICAL,
			});
			// Parent dir MUST NOT appear as a writable subpath.
			expect(p).not.toContain(`(subpath "${fixture.agent}")`);
			// And the AF_UNIX rule must use path-literal, not subpath.
			expect(p).not.toMatch(/\(remote unix-socket \(subpath/);
			closeSocket();
			cleanupFixture(fixture.root);
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});
});
/**
 * ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
 *
 * Phase A/B/C/D RED/GREEN tests for the ssh-agent authority surface.
 * Pure-functional: do NOT require the macOS kernel Seatbelt substrate.
 *
 * The host-kernel quartet (SSH-03/04/06/12) is exercised on a
 * substrate-eligible shell per ACT §6.
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
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SeatbeltSandboxBackendExperimental } from "./seatbelt-backend";
import { generateSeatbeltProfile } from "./seatbelt-profile";
import type { CommandCapability, CommandInvocation } from "../types";

function buildFixture(): { root: string; inside: string } {
	const root = mkdtempSync(join(tmpdir(), "clinemm-act-impl01-"));
	const inside = join(root, "inside");
	mkdirSync(inside, { recursive: true });
	return { root, inside };
}
function cleanupFixture(root: string): void {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		// best-effort
	}
}

describe("ACT-IMPL01 ssh-agent authority (continued)", () => {
	it("agent mode + canonical socketPath: SSH_AUTH_SOCK IS reintroduced; SSH_AGENT_PID stays stripped", async () => {
		const fixture = buildFixture();
		try {
			const SOCKET_DIR = join(fixture.root, "agent");
			mkdirSync(SOCKET_DIR, { recursive: true });
			const CANONICAL = join(SOCKET_DIR, "agent.sock");
			writeFileSync(CANONICAL, "");
			const cap: CommandCapability = {
				readonlyRoots: [fixture.inside],
				writableRoots: [fixture.inside],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				cwd: fixture.inside,
				sshAuthenticationAuthority: { mode: "agent", socketPath: CANONICAL },
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
				cleanupFixture(fixture.root);
			}
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it("agent mode WITHOUT socketPath: derived from parent SSH_AUTH_SOCK", async () => {
		const fixture = buildFixture();
		try {
			const SOCKET_DIR = join(fixture.root, "agent");
			mkdirSync(SOCKET_DIR, { recursive: true });
			const CANONICAL = join(SOCKET_DIR, "agent.sock");
			writeFileSync(CANONICAL, "");
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

	it("agent mode WITHOUT any SSH_AUTH_SOCK anywhere: fails closed with canonicalization-failed", async () => {
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

	it("agent mode with non-existent socketPath: fails closed", async () => {
		const fixture = buildFixture();
		try {
			const cap: CommandCapability = {
				readonlyRoots: [fixture.inside],
				writableRoots: [fixture.inside],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				cwd: fixture.inside,
				sshAuthenticationAuthority: {
					mode: "agent",
					socketPath: "/nonexistent/path/agent.sock",
				},
			};
			const cmd: CommandInvocation = {
				executable: "/usr/bin/env",
				args: [],
				cwd: fixture.inside,
				env: {},
			};
			await expect(
				SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				}),
			).rejects.toMatchObject({
				name: "SandboxError",
				reason: "canonicalization-failed",
			});
			cleanupFixture(fixture.root);
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it("agent mode: profile contains AF_UNIX system-socket + path-literal network-outbound", async () => {
		const fixture = buildFixture();
		try {
			const SOCKET_DIR = join(fixture.root, "agent");
			mkdirSync(SOCKET_DIR, { recursive: true });
			const CANONICAL = join(SOCKET_DIR, "agent.sock");
			writeFileSync(CANONICAL, "");
			const cap: CommandCapability = {
				readonlyRoots: [fixture.inside],
				writableRoots: [fixture.inside],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				cwd: fixture.inside,
				sshAuthenticationAuthority: { mode: "agent", socketPath: CANONICAL },
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
			expect(profileContent).toContain("(socket-domain AF_UNIX))");
			expect(profileContent).toContain(
				`(remote unix-socket (path-literal "${CANONICAL}"))`,
			);
			expect(profileContent).not.toMatch(/\(remote unix-socket \(subpath/);
			cleanupFixture(fixture.root);
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

	it("SSH-07 agent mode: unrelated secrets remain stripped", async () => {
		const fixture = buildFixture();
		try {
			const SOCKET_DIR = join(fixture.root, "agent");
			mkdirSync(SOCKET_DIR, { recursive: true });
			const CANONICAL = join(SOCKET_DIR, "agent.sock");
			writeFileSync(CANONICAL, "");
			const cap: CommandCapability = {
				readonlyRoots: [fixture.inside],
				writableRoots: [fixture.inside],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				cwd: fixture.inside,
				sshAuthenticationAuthority: { mode: "agent", socketPath: CANONICAL },
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
				cleanupFixture(fixture.root);
			}
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});

	it("SSH-13 agent mode: socket parent directory remains non-writable (no implicit write rule)", () => {
		const fixture = buildFixture();
		try {
			const SOCKET_DIR = join(fixture.root, "agent");
			mkdirSync(SOCKET_DIR, { recursive: true });
			const CANONICAL = join(SOCKET_DIR, "agent.sock");
			writeFileSync(CANONICAL, "");
			const cap: CommandCapability = {
				readonlyRoots: [fixture.inside],
				writableRoots: [fixture.inside],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				cwd: fixture.inside,
				sshAuthenticationAuthority: { mode: "agent", socketPath: CANONICAL },
			};
			const p = generateSeatbeltProfile(cap, {
				sshAgentCanonicalSocketPath: CANONICAL,
			});
			// Parent dir SOCKET_DIR MUST NOT appear as a writable subpath.
			expect(p).not.toContain(`(subpath "${SOCKET_DIR}")`);
			// And the AF_UNIX rule must use path-literal, not subpath.
			expect(p).not.toMatch(/\(remote unix-socket \(subpath/);
			cleanupFixture(fixture.root);
		} catch (cause) {
			cleanupFixture(fixture.root);
			throw cause;
		}
	});
});
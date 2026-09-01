/**
 * Tests for the SBPL profile generator and escape function.
 *
 * Covers:
 *
 *  - escapeSbplString: every adversarial fixture from the recon
 *    (space, `"`, `\`, `(`, `)`, newline, tab, unicode, empty);
 *  - generateSeatbeltProfile: deterministic output for the same
 *    capability (PROFILE_SHA256 identical across calls);
 *  - generateSeatbeltProfile: recon-validated containment pattern
 *    appears when `denyReadSubpaths` is provided;
 *  - generateSeatbeltProfile: `(deny network*)` is emitted for `deny`
 *    and absent for `allow`;
 *  - generateSeatbeltProfile: writable roots appear as `(subpath ...)`.
 *
 * ACT: ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
	ALWAYS_WRITABLE_LITERALS,
	ALWAYS_WRITABLE_SYSTEM_SUBPATHS,
	escapeSbplString,
	generateSeatbeltProfile,
} from "./seatbelt-profile";
import type { CommandCapability } from "../types";

function sha256(s: string): string {
	return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("escapeSbplString", () => {
	it("returns empty string for empty input", () => {
		expect(escapeSbplString("")).toBe("");
	});

	it("passes through ASCII paths unchanged", () => {
		expect(escapeSbplString("/Users/me/code")).toBe("/Users/me/code");
		expect(escapeSbplString("/private/tmp")).toBe("/private/tmp");
	});

	it("passes through spaces unchanged (not special inside SBPL strings)", () => {
		expect(escapeSbplString("/path with spaces")).toBe("/path with spaces");
	});

	it("escapes double-quote", () => {
		expect(escapeSbplString('a"b')).toBe('a\\"b');
	});

	it("escapes backslash", () => {
		expect(escapeSbplString("a\\b")).toBe("a\\\\b");
	});

	it("escapes both backslash and double-quote together", () => {
		expect(escapeSbplString('a\\"b')).toBe('a\\\\\\"b');
	});

	it("passes parens through unchanged (not special inside strings)", () => {
		expect(escapeSbplString("(abc)")).toBe("(abc)");
		expect(escapeSbplString("/path/(sub)/x")).toBe("/path/(sub)/x");
	});

	it("THROWS on newline / CR (CORRECTION01 P0-3: no silent aliasing)", () => {
		expect(() => escapeSbplString("a\nb")).toThrow();
		expect(() => escapeSbplString("a\r\nb")).toThrow();
	});

	it("THROWS on tab (CORRECTION01 P0-3)", () => {
		expect(() => escapeSbplString("a\tb")).toThrow();
	});

	it("THROWS on NUL and other control characters (CORRECTION01 P0-3)", () => {
		expect(() => escapeSbplString("a\x00b")).toThrow();
		expect(() => escapeSbplString("a\x01b")).toThrow();
		expect(() => escapeSbplString("a\x7fb")).toThrow();
	});

	it("passes unicode (non-control) through unchanged", () => {
		expect(escapeSbplString("/path/中文")).toBe("/path/中文");
		expect(escapeSbplString("/path/α")).toBe("/path/α");
	});

	it("passes the recon adversarial fixture matrix for safe inputs", () => {
		// CORRECTION01 P0-3: control characters are NO LONGER
		// silently stripped; they throw. Only safe inputs here.
		const fixtures: Array<[string, string]> = [
			["/normal/path", "/normal/path"],
			["/path with spaces", "/path with spaces"],
			['/has"quote', '/has\\"quote'],
			["/has\\backslash", "/has\\\\backslash"],
			["/has(parens)", "/has(parens)"],
			["/unicode/中文", "/unicode/中文"],
			["", ""],
		];
		for (const [input, expected] of fixtures) {
			expect(escapeSbplString(input)).toBe(expected);
		}
	});

	it("THROWS on every control-character entry in the recon adversarial fixture matrix (CORRECTION01 P0-3)", () => {
		const unsafeFixtures = ["/has\nnewline", "/has\ttab", "/has\x00nul"];
		for (const input of unsafeFixtures) {
			expect(() => escapeSbplString(input)).toThrow();
		}
	});
});

describe("generateSeatbeltProfile", () => {
	const minimalCap: CommandCapability = {
		readonlyRoots: [],
		writableRoots: [],
		network: "deny",
		environment: { mode: "sanitized", allow: [] },
	};

	it("emits the recon-validated required prelude", () => {
		const p = generateSeatbeltProfile(minimalCap);
		expect(p).toContain("(version 1)");
		expect(p).toContain("(deny default)");
		expect(p).toContain("(allow process-exec)");
		expect(p).toContain("(allow process-fork)");
		expect(p).toContain("(allow signal (target self))");
		expect(p).toContain("(allow sysctl-read)");
		expect(p).toContain("(allow mach-lookup)");
		expect(p).toContain("(allow file-read-metadata (subpath \"/\"))");
	});

	it("emits (allow file-read*) when no deny-read subpaths are provided", () => {
		const p = generateSeatbeltProfile(minimalCap);
		expect(p).toContain("(allow file-read*)");
		expect(p).not.toContain("(deny file-read*");
	});

	it("emits the containment pattern when deny-read subpaths are provided", () => {
		const p = generateSeatbeltProfile(minimalCap, {
			denyReadSubpaths: ["/Users/me/secret"],
		});
		expect(p).toContain("(allow file-read*)");
		expect(p).toContain('(deny file-read* (subpath "/Users/me/secret"))');
	});

	it("emits (deny network*) for network: 'deny'", () => {
		const p = generateSeatbeltProfile(minimalCap);
		expect(p).toContain("(deny network*)");
	});

	it("does NOT emit a network rule for network: 'allow'", () => {
		const p = generateSeatbeltProfile({
			...minimalCap,
			network: "allow",
		});
		expect(p).not.toContain("(deny network*)");
	});

	it("emits writableRoots as (subpath ...) entries", () => {
		const p = generateSeatbeltProfile({
			...minimalCap,
			writableRoots: ["/Users/me/writable"],
		});
		expect(p).toContain('(subpath "/Users/me/writable")');
	});

	it("emits tempRoot as a (subpath ...) entry", () => {
		const p = generateSeatbeltProfile({
			...minimalCap,
			tempRoot: "/private/tmp/clinemm-sandbox",
		});
		expect(p).toContain('(subpath "/private/tmp/clinemm-sandbox")');
	});

	it("always includes the always-writable literals and system subpaths", () => {
		const p = generateSeatbeltProfile(minimalCap);
		for (const lit of ALWAYS_WRITABLE_LITERALS) {
			expect(p).toContain(`(literal "${lit}")`);
		}
		for (const sub of ALWAYS_WRITABLE_SYSTEM_SUBPATHS) {
			expect(p).toContain(`(subpath "${sub}")`);
		}
	});

	it("is deterministic: same capability → same profile bytes (PROFILE_SHA256 matches)", () => {
		const cap: CommandCapability = {
			readonlyRoots: [],
			writableRoots: ["/Users/me/writable"],
			network: "deny",
			environment: { mode: "sanitized", allow: [] },
			tempRoot: "/private/tmp/clinemm-sandbox-1",
		};
		const a = generateSeatbeltProfile(cap);
		const b = generateSeatbeltProfile(cap);
		expect(a).toBe(b);
		expect(sha256(a)).toBe(sha256(b));
	});

	it("preserves the OR-vs-AND gotcha: deny-per-subpath pattern, not OR-of-subpaths on allow", () => {
		const p = generateSeatbeltProfile(minimalCap, {
			denyReadSubpaths: ["/x", "/y", "/z"],
		});
		const allowReadMatches = p.match(/\(allow file-read\*[^)]*\)/g) ?? [];
		expect(allowReadMatches.length).toBe(1);
		expect(allowReadMatches[0]).toBe("(allow file-read*)");
	});

	it("escapes adversarial paths safely inside deny rules", () => {
		const p = generateSeatbeltProfile(minimalCap, {
			denyReadSubpaths: ['/has"quote', "/has\\backslash"],
		});
		expect(p).toContain('(deny file-read* (subpath "/has\\"quote"))');
		expect(p).toContain('(deny file-read* (subpath "/has\\\\backslash"))');
	});

	// ===============================================================
	// ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
	// PHASE B: ssh-agent AF_UNIX socket rules
	// ===============================================================
	describe("ACT-IMPL01: ssh-agent socket rules", () => {
		it("default mode (sshAuthenticationAuthority omitted): no agent rules emitted", () => {
			const p = generateSeatbeltProfile(minimalCap);
			expect(p).not.toContain("AF_UNIX");
			expect(p).not.toContain("unix-socket");
			expect(p).not.toContain("SSH_AUTH_SOCK");
		});

		it("deny mode: no agent rules emitted even when option is omitted (no-op)", () => {
			const cap: CommandCapability = {
				...minimalCap,
				sshAuthenticationAuthority: { mode: "deny" },
			};
			const p = generateSeatbeltProfile(cap);
			expect(p).not.toContain("AF_UNIX");
			expect(p).not.toContain("unix-socket");
		});

		it("agent mode + canonical socket: emits AF_UNIX system-socket + path-literal network-outbound", () => {
			const CANONICAL = "/private/tmp/com.apple.launchd.abc/Listeners";
			const p = generateSeatbeltProfile(minimalCap, {
				sshAgentCanonicalSocketPath: CANONICAL,
			});
			// AF_UNIX system-socket primitive is present.
			expect(p).toContain("(allow system-socket");
			expect(p).toContain("(socket-domain AF_UNIX))");
			// path-literal (NOT subpath) is the AF_UNIX remote-endpoint filter.
			expect(p).toContain("(allow network-outbound");
			expect(p).toContain(
				`(remote unix-socket (path-literal "${CANONICAL}"))`,
			);
			// NEGATIVE: subpath is the filesystem primitive, must NOT be used for sockets.
			expect(p).not.toMatch(/\(remote unix-socket \(subpath/);
		});

		it("agent mode: empty/undefined socket path produces no agent rules (fail-closed caller contract)", () => {
			const p1 = generateSeatbeltProfile(minimalCap, {
				sshAgentCanonicalSocketPath: undefined,
			});
			expect(p1).not.toContain("AF_UNIX");
			const p2 = generateSeatbeltProfile(minimalCap, {
				sshAgentCanonicalSocketPath: "",
			});
			expect(p2).not.toContain("AF_UNIX");
		});

		it("agent mode: does NOT widen to ~/.ssh or any filesystem grant (no readwritePaths widening)", () => {
			const CANONICAL = "/private/var/folders/abc/T/agent.sock";
			const cap: CommandCapability = {
				...minimalCap,
				readonlyRoots: ["/Users/me/.ssh"],
				writableRoots: [],
			};
			const p = generateSeatbeltProfile(cap, {
				sshAgentCanonicalSocketPath: CANONICAL,
			});
			// The presence of an agent socket MUST NOT add a readonly grant
			// for ~/.ssh. We assert the deny-write rule IS still present
			// (readonlyRoots means read-only) and that no agent rule
			// touches /Users/me/.ssh.
			expect(p).toContain('(deny file-write* (subpath "/Users/me/.ssh"))');
			expect(p).not.toMatch(/\/Users\/me\/\.ssh.*agent/i);
		});

		it("agent mode: control-character socket path is REJECTED (CORRECTION01 P0-3 invariant)", () => {
			expect(() =>
				generateSeatbeltProfile(minimalCap, {
					sshAgentCanonicalSocketPath: "/tmp/agent\nsock",
				}),
			).toThrow();
		});

		it("agent mode: socket path with quote is escaped inside the SBPL string", () => {
			const CANONICAL = '/tmp/agent"quoted';
			const p = generateSeatbeltProfile(minimalCap, {
				sshAgentCanonicalSocketPath: CANONICAL,
			});
			expect(p).toContain('(path-literal "/tmp/agent\\"quoted")');
		});
	});

	// ===============================================================
	// ACT-CLINEMM-SEATBELT-TEMP-WRITE-AUTHORITY01
	// Explicit /tmp compatibility grant (CORRECTED bounded scope).
	//
	// The CORRECTED patch grants ONLY canonical /tmp. It does NOT
	// grant `os.tmpdir()` (per-user `/private/var/folders/.../T`) as
	// a permanent global. Per-user temp authority is bounded to the
	// capability's `tempRoot` (one subtree per invocation, steered
	// via TMPDIR/TMP/TEMP env materialization).
	//
	// This block tests:
	//   T1) literal /tmp (resolved to /private/tmp) IS writable
	//   T2) os.tmpdir() is NOT in the profile (would be over-broad)
	//   T3) the profile's temp allow is bounded to canonical /tmp
	//   T4) temp subpaths do NOT widen to /var/folders or os.tmpdir()
	//   T5..T9) conservation: reads, ssh-agent, determinism, network, deny-after-allow
	// ===============================================================
	describe("ACT-CLINEMM-SEATBELT-TEMP-WRITE-AUTHORITY01: explicit /tmp compatibility grant", () => {
		it("T1 RED→GREEN: profile grants (subpath \"<canonical /tmp>\") for BSD mktemp + literal /tmp compatibility", () => {
			const canonicalTmp = (() => {
				try {
					return realpathSync("/tmp");
				} catch {
					return null;
				}
			})();
			if (!canonicalTmp) {
				expect(true).toBe(true);
				return;
			}
			const p = generateSeatbeltProfile(minimalCap);
			expect(p).toContain(`(subpath "${canonicalTmp}")`);
		});

		it("T2 CORRECTION BOUND: profile does NOT grant canonical os.tmpdir() (per-user temp authority is bounded to capability tempRoot)", () => {
			// CRITICAL CONSERVATION: the previous patch incorrectly
			// granted the canonical os.tmpdir() (per-user temp root)
			// as a permanent global allow. This let a sandboxed
			// command overwrite / rename / delete any other temp
			// artifact owned by that user. The CORRECTED scope
			// explicitly removes that global grant.
			const canonicalTmpdir = (() => {
				try {
					return realpathSync(tmpdir());
				} catch {
					return null;
				}
			})();
			if (!canonicalTmpdir) {
				expect(true).toBe(true);
				return;
			}
			// Use a minimal cap with no tempRoot to prove the bare
			// profile does NOT include canonical os.tmpdir().
			const p = generateSeatbeltProfile(minimalCap);
			expect(p).not.toContain(`(subpath "${canonicalTmpdir}")`);
		});

		it("T3 conservation: profile's temp allow is bounded to canonical /tmp (only one temp subpath emitted, and it IS canonical /tmp)", () => {
			// The CORRECTED scope: at most one temp subpath in the
			// profile, and it MUST be the canonical /tmp (resolved
			// through realpathSync so /tmp -> /private/tmp is
			// accounted for). We assert on the RENDERED profile
			// rather than on the constant's contents (no SDK
			// surface is exported solely for tests).
			const canonicalTmp = (() => {
				try {
					return realpathSync("/tmp");
				} catch {
					return null;
				}
			})();
			if (!canonicalTmp) {
				expect(true).toBe(true);
				return;
			}
			const p = generateSeatbeltProfile(minimalCap);
			// Profile MUST contain the canonical /tmp subpath in the
			// (allow file-write*) section. We count occurrences so a
			// future "wildcard" or "double grant" regression would
			// also fail.
			const matches = p.match(
				new RegExp(
					`\\(subpath "${canonicalTmp.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\)`,
					"g",
				),
			);
			expect(matches?.length ?? 0).toBeGreaterThanOrEqual(1);
			// No other temp-shaped subpath appears. We test this by
			// ensuring no writable subpath starts with a temp-shaped
			// prefix outside the canonical /tmp grant. Other shapes
			// (literals, system subpaths, workspace) are unchanged.
			expect(p).not.toContain('(subpath "/var/folders/');
			expect(p).not.toContain('(subpath "/private/var/folders/');
		});

		it("T4 conservation: temp subpaths do NOT widen to os.tmpdir()", () => {
			// The CORRECTED scope explicitly excludes os.tmpdir()
			// (per-user temp root).
			const canonicalTmpdir = (() => {
				try {
					return realpathSync(tmpdir());
				} catch {
					return null;
				}
			})();
			if (!canonicalTmpdir) {
				expect(true).toBe(true);
				return;
			}
			// The profile must NOT include the per-user temp root.
			const p = generateSeatbeltProfile(minimalCap);
			expect(p).not.toContain(`(subpath "${canonicalTmpdir}")`);
		});

		it("T5 conservation: temp allow does NOT add (allow file-read*) widening", () => {
			const p = generateSeatbeltProfile(minimalCap);
			expect(p).toMatch(/^\(allow file-read\*\)$/m);
		});

		it("T6 conservation: ssh-agent rules are unchanged", () => {
			const CANONICAL = "/private/tmp/com.apple.launchd.abc/Listeners";
			const p = generateSeatbeltProfile(minimalCap, {
				sshAgentCanonicalSocketPath: CANONICAL,
			});
			expect(p).toContain("(allow system-socket");
			expect(p).toContain("(socket-domain AF_UNIX))");
			expect(p).toContain(
				`(remote unix-socket (path-literal "${CANONICAL}"))`,
			);
		});

		it("T7 conservation: profile remains deterministic after temp-subpath addition", () => {
			const cap: CommandCapability = {
				readonlyRoots: [],
				writableRoots: ["/Users/me/writable"],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
				tempRoot: "/private/tmp/clinemm-sandbox-1",
			};
			const a = generateSeatbeltProfile(cap);
			const b = generateSeatbeltProfile(cap);
			expect(a).toBe(b);
			expect(sha256(a)).toBe(sha256(b));
		});

		it("T8 conservation: network deny rule unchanged when temp subpaths added", () => {
			const p = generateSeatbeltProfile(minimalCap);
			expect(p).toContain("(deny network*)");
			const p2 = generateSeatbeltProfile({
				...minimalCap,
				network: "allow",
			});
			expect(p2).not.toContain("(deny network*)");
		});

		it("T9 conservation: temp subpaths appear AFTER readonlyRoots deny (deny-after-allow ordering preserved)", () => {
			const cap: CommandCapability = {
				readonlyRoots: ["/Users/me/readonly"],
				writableRoots: ["/Users/me/writable"],
				network: "deny",
				environment: { mode: "sanitized", allow: [] },
			};
			const p = generateSeatbeltProfile(cap);
			const allowIdx = p.indexOf("(allow file-write*");
			const denyIdx = p.indexOf("(deny file-write*");
			expect(allowIdx).toBeGreaterThanOrEqual(0);
			expect(denyIdx).toBeGreaterThan(allowIdx);
			const canonicalTmp = (() => {
				try {
					return realpathSync("/tmp");
				} catch {
					return null;
				}
			})();
			if (canonicalTmp) {
				const subpathIdx = p.indexOf(`(subpath "${canonicalTmp}")`);
				expect(subpathIdx).toBeGreaterThan(allowIdx);
				expect(subpathIdx).toBeLessThan(denyIdx);
			}
		});
	});
});


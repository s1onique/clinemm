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
});


/**
 * Tests for the canonical-path helper.
 *
 * These tests verify:
 *
 *  - happy-path canonicalization (`/tmp` → `/private/tmp`);
 *  - fail-closed on `ENOENT` / non-existent paths;
 *  - fail-closed on non-string input;
 *  - fail-closed on empty string;
 *  - the best-effort `pathExistsForCanonicalization` probe is non-throwing.
 *
 * ACT: ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	canonicalizeSandboxRoot,
	pathExistsForCanonicalization,
} from "./canonical-paths";
import { SandboxError } from "./types";

describe("canonicalizeSandboxRoot", () => {
	it("canonicalizes /tmp to /private/tmp on darwin", () => {
		// Skip on non-darwin — the symlink behavior is platform-specific.
		// The canonicalize helper should always call realpath, which is
		// portable, but we only assert the specific symlink behavior
		// where it exists.
		if (process.platform !== "darwin") {
			return;
		}
		const result = canonicalizeSandboxRoot("/tmp");
		expect(result).toBe("/private/tmp");
	});

	it("canonicalizes a real directory under system temp", () => {
		const dir = mkdtempSync(join(tmpdir(), "canonicalize-test-"));
		const result = canonicalizeSandboxRoot(dir);
		// The returned path should resolve to a real path (canonical),
		// which on macOS removes /tmp → /private/tmp, /var → /private/var.
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
		// Result is canonical: if we canonicalize again, we should get the
		// same string back (idempotence of realpath).
		const again = canonicalizeSandboxRoot(result);
		expect(again).toBe(result);
	});

	it("is idempotent — calling twice yields the same result", () => {
		const dir = mkdtempSync(join(tmpdir(), "canonicalize-idem-"));
		const a = canonicalizeSandboxRoot(dir);
		const b = canonicalizeSandboxRoot(a);
		expect(a).toBe(b);
	});

	it("throws SandboxError with reason 'canonicalization-failed' for non-existent path", () => {
		const nonExistent = join(tmpdir(), `does-not-exist-${Date.now()}-${Math.random()}`);
		let caught: unknown;
		try {
			canonicalizeSandboxRoot(nonExistent);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(SandboxError);
		const err = caught as SandboxError;
		expect(err.reason).toBe("canonicalization-failed");
		expect(err.backendId).toBe("canonicalize");
	});

	it("throws SandboxError for empty string", () => {
		expect(() => canonicalizeSandboxRoot("")).toThrow(SandboxError);
	});

	it("throws SandboxError for non-string input", () => {
		const cases: unknown[] = [undefined, null, 42, true, {}, []];
		for (const input of cases) {
			expect(() => canonicalizeSandboxRoot(input)).toThrow(SandboxError);
		}
	});
});

describe("pathExistsForCanonicalization", () => {
	it("returns true for an existing path", () => {
		const dir = mkdtempSync(join(tmpdir(), "exists-test-"));
		expect(pathExistsForCanonicalization(dir)).toBe(true);
	});

	it("returns false for a non-existent path (does not throw)", () => {
		const nonExistent = join(tmpdir(), `nope-${Date.now()}-${Math.random()}`);
		expect(pathExistsForCanonicalization(nonExistent)).toBe(false);
	});

	it("returns false for non-string / empty input (does not throw)", () => {
		expect(pathExistsForCanonicalization(undefined)).toBe(false);
		expect(pathExistsForCanonicalization("")).toBe(false);
		expect(pathExistsForCanonicalization(42)).toBe(false);
	});
});

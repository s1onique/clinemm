/**
 * ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
 *
 * Unit tests for the per-R0-source path operand extractor
 * `extractR0PathOperands`. The dispatcher must produce the
 * EXACT operand list the policy authority gate expects.
 *
 * For `head -n 30 FILE`:
 *   - generic extractor returns `["30", "FILE"]` (wrong: 30 is
 *     a count argument, not a path)
 *   - per-source extractor returns `["FILE"]` (correct: the
 *     authority gate sees only the FILE operand)
 *
 * For `cat README.md package.json`:
 *   - both extractors return `["README.md", "package.json"]`
 *     (correct: cat has no option arguments)
 *
 * For `ls /tmp`:
 *   - per-source extractor falls back to generic (ls has no
 *     command-specific operand extraction)
 */

import { describe, expect, it } from "vitest";
import { extractPathOperands, extractR0PathOperands } from "./path-authority";

describe("ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01 -- extractR0PathOperands", () => {
	describe("cat", () => {
		it("returns both operands for multi-file cat", () => {
			expect(
				extractR0PathOperands("cat README.md package.json", "host_safe_cat"),
			).toEqual(["README.md", "package.json"]);
		});
		it("returns single operand for cat FILE", () => {
			expect(
				extractR0PathOperands("cat README.md", "host_safe_cat"),
			).toEqual(["README.md"]);
		});
		it("handles cat -- FILE", () => {
			expect(
				extractR0PathOperands("cat -- README.md", "host_safe_cat"),
			).toEqual(["README.md"]);
		});
		it("matches generic for cat (no option arg concerns)", () => {
			const cmd = "cat README.md package.json";
			expect(extractR0PathOperands(cmd, "host_safe_cat")).toEqual(
				extractPathOperands(cmd),
			);
		});
	});

	describe("head (path-bearing)", () => {
		it("returns [FILE] for head FILE (skips no options)", () => {
			expect(
				extractR0PathOperands("head README.md", "host_safe_head_path"),
			).toEqual(["README.md"]);
		});
		it("returns [FILE] for head -N FILE (no value to skip)", () => {
			expect(
				extractR0PathOperands("head -30 README.md", "host_safe_head_path"),
			).toEqual(["README.md"]);
		});
		it("returns [FILE] for head -n N FILE (skips -n and value)", () => {
			// CRITICAL: generic extractor returns ["30", "README.md"]
			expect(extractPathOperands("head -n 30 README.md")).toEqual([
				"30",
				"README.md",
			]);
			// Per-source extractor returns ["README.md"] only.
			expect(
				extractR0PathOperands("head -n 30 README.md", "host_safe_head_path"),
			).toEqual(["README.md"]);
		});
		it("returns [FILE] for head -- FILE", () => {
			expect(
				extractR0PathOperands("head -- README.md", "host_safe_head_path"),
			).toEqual(["README.md"]);
		});
		it("returns [FILE] for head -n N -- FILE", () => {
			expect(
				extractR0PathOperands(
					"head -n 30 -- README.md",
					"host_safe_head_path",
				),
			).toEqual(["README.md"]);
		});
	});

	describe("tail (path-bearing)", () => {
		it("returns [FILE] for tail FILE", () => {
			expect(
				extractR0PathOperands("tail README.md", "host_safe_tail_path"),
			).toEqual(["README.md"]);
		});
		it("returns [FILE] for tail -N FILE", () => {
			expect(
				extractR0PathOperands("tail -20 README.md", "host_safe_tail_path"),
			).toEqual(["README.md"]);
		});
		it("returns [FILE] for tail -n N FILE (skips -n and value)", () => {
			expect(extractPathOperands("tail -n 20 README.md")).toEqual([
				"20",
				"README.md",
			]);
			expect(
				extractR0PathOperands("tail -n 20 README.md", "host_safe_tail_path"),
			).toEqual(["README.md"]);
		});
	});

	describe("generic fallback (ls, find)", () => {
		it("falls back to generic for ls", () => {
			const cmd = "ls /tmp /var";
			expect(extractR0PathOperands(cmd, "host_safe_ls")).toEqual(
				extractPathOperands(cmd),
			);
		});
		it("falls back to generic for find", () => {
			const cmd = "find /etc -name foo";
			expect(extractR0PathOperands(cmd, "host_safe_find")).toEqual(
				extractPathOperands(cmd),
			);
		});
		it("falls back to generic for unknown source", () => {
			const cmd = "git status";
			expect(extractR0PathOperands(cmd, "host_safe_git_status")).toEqual(
				extractPathOperands(cmd),
			);
		});
	});
});

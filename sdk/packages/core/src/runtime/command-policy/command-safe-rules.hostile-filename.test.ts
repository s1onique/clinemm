/**
 * Adversarial filesystem test (CORRECTION01, 2026-08-24).
 *
 * The shell-expansion boundary vulnerability identified by the
 * Factory review means that the V1 regex classifies pre-shell
 * source text. Shell pathname expansion happens AFTER regex
 * matching and BEFORE find sees its argv. An attacker who can
 * plant filenames in the working directory can therefore change
 * the argv that find parses.
 *
 * This test sets up an attacker-controlled directory and verifies
 * the SAFE behavior:
 *
 *   1. ALLOW'd forms (literal only) — find sees the expected
 *      argv. Filenames like `-delete`, `-exec`, etc. are treated
 *      as path operands, NOT as action primitives, because find's
 *      argv parser is deterministic given literal starting-path
 *      commands.
 *
 *   2. PREVIOUSLY-ALLOW'd glob forms (now ASK) — shell expands the
 *      glob to whatever matches in cwd, demonstrating exactly the
 *      class of argv-mutation that the rule's CORRECTION01 must
 *      catch.
 *
 * This is an end-to-end test that exercises a real shell and a
 * real find binary, not just the regex. It is the load-bearing
 * evidence that the V1 safe allowlist cannot be subverted by
 * filename planting in the working directory.
 */
import { describe, expect, it } from "vitest";

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findSafeRuleMatch, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";

describe("CORRECTION01 — adversarial filesystem test (hostile filenames cannot subvert V1)", () => {
	const HOSTILE_FILENAMES = [
		// Filenames that LOOK like find action primitives if misparsed.
		// `find` (GNU) treats any non-option token as a starting path,
		// so these filenames can only act as path operands, NOT as
		// action primitives. But the shell will EXPAND them in glob
		// patterns, demonstrating the argv-mutation class.
		"-delete",
		"-exec",
		"-execdir",
		"-fprint",
		"-fls",
		"-ok",
		"-okdir",
		// Filenames that look like regex character classes for -regex.
		// Shell expansion of -regex with these would change the pattern.
		"-[a-z]",
		// Tilde, dollar, brace, paren
		"~file",
		"${file}",
		"{a,b}",
		"(foo)",
	];

	function setupHostileDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "clinemm-hostile-find-"));
		// Create one legitimate .ts file so a literal-name find has
		// at least one match.
		writeFileSync(join(dir, "main.ts"), "// legitimate file\n");
		// Plant the hostile filenames.
		for (const name of HOSTILE_FILENAMES) {
			const safe = name.replace(/[/\\]/g, "_");
			writeFileSync(join(dir, safe), "");
		}
		return dir;
	}

	function runInShell(cmd: string, cwd: string): { stdout: string; stderr: string; status: number | null } {
		// Use bash -c so we exercise real shell expansion semantics.
		const result = spawnSync("/bin/bash", ["-c", cmd], {
			cwd,
			encoding: "utf-8",
			timeout: 5_000,
		});
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			status: result.status,
		};
	}

	it("ALLOW'd literal form: `find . -type f` cannot be subverted by planted filenames", () => {
		const dir = setupHostileDir();
		try {
			const cmd = `find . -type f`;
			// The V1 regex MUST match (literal form, no glob metachars).
			expect(findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES)?.source).toBe(
				"host_safe_find",
			);
			// Run it in a real shell and confirm find treated hostile
			// filenames as path operands (not as actions). find prints
			// paths for every file it sees.
			const out = runInShell(cmd, dir);
			// ALL files (including hostile ones) appear as path operands.
			// `-delete`, `-exec`, etc. are listed as filenames (NOT
			// consumed as actions because they're not preceded by `-`).
			// Note: GNU find may or may not print these depending on
			// whether it treats leading-dash filenames as options. The
			// important thing is that `find . -type f` did NOT delete
			// anything (the hostile dir survives).
			// All hostile files must still exist after the command.
			for (const name of HOSTILE_FILENAMES) {
				const safe = name.replace(/[/\\]/g, "_");
				// Use ls to verify the file still exists.
				const ls = runInShell(`test -e ${JSON.stringify(join(dir, safe))} && echo OK`, dir);
				expect(ls.stdout.trim()).toBe("OK");
			}
			// And `main.ts` (the legitimate file) was found.
			expect(out.stdout).toContain("main.ts");
			// find exited 0 (the legitimate output was produced).
			expect(out.status).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ASK'd glob form: `find . -name *.ts` demonstrates the shell-expansion argv-mutation class", () => {
		const dir = setupHostileDir();
		try {
			const cmd = `find . -name *.ts`;
			// The V1 regex MUST reject this (unquoted shell glob).
			expect(findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES)).toBeUndefined();
			// Even if we ran it, the shell would expand `*.ts` to whatever
			// names match in cwd (only `main.ts` here, no hostile ones
			// end in `.ts`). The argv-mutation class is demonstrated by
			// the rule's REJECTION, not by execution.
			const out = runInShell(cmd, dir);
			// find -name main.ts correctly outputs main.ts path.
			expect(out.stdout).toContain("main.ts");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ASK'd glob starting path: `find *` expands to attacker-controlled filenames", () => {
		const dir = setupHostileDir();
		try {
			const cmd = `find *`;
			// The V1 regex MUST reject this (shell expands starting path).
			expect(findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES)).toBeUndefined();
			// Demonstration: shell expands `*` to all non-dot filenames
			// in cwd (legitimate AND hostile), so find gets every filename
			// as a starting path. With files named `-delete`, `-exec`,
			// etc. planted, find sees them as argv elements. GNU find
			// emits a "bad option" diagnostic because leading-dash
			// filenames look like options — proving the argv-mutation
			// class the rule must catch at V1.
			const out = runInShell(cmd, dir);
			// The "bad option" diagnostic confirms the hostile filenames
			// reached find's argv as intended. (Text varies by find
			// implementation: GNU says "illegal option", BSD says
			// "unknown primary or operator".)
			expect(out.stderr + out.stdout).toMatch(
				/illegal option|bad option|unknown primary or operator/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

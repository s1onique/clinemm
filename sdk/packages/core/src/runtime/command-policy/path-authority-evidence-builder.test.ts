/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
 * REALPATH_WORKSPACE_CONFINEMENT
 *
 * Unit tests for the host-side path authority evidence
 * builder. These tests exercise `safeRealpathSync` and
 * `buildPathAuthorityEvidence` against real filesystem
 * fixtures built with `os.tmpdir`. The builder is the ONLY
 * sanctioned place in the policy stack where `fs.realpathSync`
 * is called.
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildPathAuthorityEvidence, safeRealpathSync } from "./path-authority-evidence-builder"

let TMP_ROOT: string
let PROJECT_DIR: string
let OUTSIDE_DIR: string

beforeAll(() => {
	TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-evidence-builder-"))
	PROJECT_DIR = join(TMP_ROOT, "project")
	OUTSIDE_DIR = join(TMP_ROOT, "outside")
	mkdirSync(PROJECT_DIR, { recursive: true })
	mkdirSync(OUTSIDE_DIR, { recursive: true })
	writeFileSync(join(PROJECT_DIR, "file.txt"), "x")
	writeFileSync(join(OUTSIDE_DIR, "file.txt"), "y")
	symlinkSync(OUTSIDE_DIR, join(PROJECT_DIR, "escape-link"), "dir")
})

afterAll(() => {
	if (TMP_ROOT && existsSync(TMP_ROOT)) {
		rmSync(TMP_ROOT, { recursive: true, force: true })
	}
})

describe("safeRealpathSync", () => {
	it("returns resolved canonical pathname for a real file", () => {
		const r = safeRealpathSync(join(PROJECT_DIR, "file.txt"), PROJECT_DIR)
		expect(r.resolvedRealPath).toBe(
			realpathSync(join(PROJECT_DIR, "file.txt")),
		)
		if (r.resolvedRealPath !== null) {
			expect(r.reason).toBe("resolved-and-contained")
		}
	})

	it("returns null with ENOENT reason when the path does not exist", () => {
		const r = safeRealpathSync(
			join(PROJECT_DIR, "does-not-exist"),
			PROJECT_DIR,
		)
		expect(r.resolvedRealPath).toBeNull()
		if (r.resolvedRealPath === null) {
			expect(r.reason).toBe("realpath-failed-enoent")
		}
	})

	it("returns null with other reason for tilde-prefixed operands", () => {
		const r = safeRealpathSync("~/.ssh", PROJECT_DIR)
		expect(r.resolvedRealPath).toBeNull()
	})

	it("returns null when relative operand has no cwd", () => {
		const r = safeRealpathSync("foo", null)
		expect(r.resolvedRealPath).toBeNull()
	})

	it("resolves symlinks to their canonical target", () => {
		const r = safeRealpathSync(
			join(PROJECT_DIR, "escape-link"),
			PROJECT_DIR,
		)
		// The symlink target is OUTSIDE_DIR, so realpath
		// follows it and returns the outside path.
		expect(r.resolvedRealPath).toBe(realpathSync(OUTSIDE_DIR))
	})
})

describe("buildPathAuthorityEvidence", () => {
	it("builds evidence for `ls` of a real file inside the workspace", () => {
		const r = buildPathAuthorityEvidence({
			workspaceRoots: [PROJECT_DIR],
			cwd: PROJECT_DIR,
			command: { command: `ls ${join(PROJECT_DIR, "file.txt")}` },
		})
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.evidence.operands).toHaveLength(1)
			expect(r.evidence.operands[0]?.resolvedRealPath).toBe(
				realpathSync(join(PROJECT_DIR, "file.txt")),
			)
			expect(r.evidence.operands[0]?.contained).toBe(true)
		}
	})

	it("marks symlink-escape operands as not-contained", () => {
		const r = buildPathAuthorityEvidence({
			workspaceRoots: [PROJECT_DIR],
			cwd: PROJECT_DIR,
			command: { command: `find ${join(PROJECT_DIR, "escape-link")}` },
		})
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.evidence.operands[0]?.resolvedRealPath).toBe(
				realpathSync(OUTSIDE_DIR),
			)
			expect(r.evidence.operands[0]?.contained).toBe(false)
			expect(r.evidence.operands[0]?.reason).toBe(
				"resolved-but-outside-roots",
			)
		}
	})

	it("returns ok=false when a workspace root does not exist", () => {
		const r = buildPathAuthorityEvidence({
			workspaceRoots: [join(TMP_ROOT, "no-such-root")],
			cwd: PROJECT_DIR,
			command: { command: "ls" },
		})
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(r.reason).toBe("no-workspace-roots")
		}
	})

	it("returns ok=true with empty operands for commands without path operands", () => {
		const r = buildPathAuthorityEvidence({
			workspaceRoots: [PROJECT_DIR],
			cwd: PROJECT_DIR,
			command: { command: "pwd" },
		})
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.evidence.operands).toEqual([])
		}
	})

	it("returns ok=true with multi-root containment (cross-workspace read)", () => {
		// Both PROJECT_DIR and OUTSIDE_DIR are workspace
		// roots; the symlink escape is a legitimate
		// cross-workspace read.
		const r = buildPathAuthorityEvidence({
			workspaceRoots: [PROJECT_DIR, OUTSIDE_DIR],
			cwd: PROJECT_DIR,
			command: { command: `find ${join(PROJECT_DIR, "escape-link")}` },
		})
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.evidence.operands[0]?.contained).toBe(true)
		}
	})
})

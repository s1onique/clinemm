/**
 * R1 — async edit-target classifier test (PHASE 2 / REVIEW CYCLE).
 *
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 PHASE 2.
 *
 * Required deterministic cases (phase0-reconfirmation.md §3):
 *
 *   - normal in-workspace target       => INSIDE
 *   - absolute outside                 => OUTSIDE
 *   - existing symlink -> outside      => OUTSIDE  (realpath resolves the escape)
 *   - classification / realpath failure => UNAVAILABLE
 *
 * The classifier is the ONLY async component in the composition. It runs
 * `fs.realpathSync` on both the workspace root and the requested path, then
 * tests containment on canonical strings. This is what closes the V1
 * symlink-escape attack.
 *
 * Filesystem geometry is constructed via `mkdtempSync` + `realpathSync` +
 * `writeFileSync` (not faked). After each test the temporary roots are
 * removed.
 */

import * as fs from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { classifyEditTarget } from "../editor-path-authority"

let workspaceRoot: string
let insideVictim: string
let outsideDir: string
let outsideVictim: string
let symlinkOutsideTarget: string

beforeAll(() => {
	workspaceRoot = fs.realpathSync(process.cwd())
	// The test process is run from the repo root; we use a real subdir for
	// the INSIDE victim (not the repo root, so we don't interfere with
	// anything else) and an /tmp mkdtemp for the OUTSIDE victim.
	const insideDir = fs.mkdtempSync(path.join(workspaceRoot, ".factory", "tmp", "r1-inside-"))
	outsideDir = fs.mkdtempSync(path.join(tmpdir(), "r1-outside-"))
	// Drop a normal inside file (INSIDE case).
	insideVictim = path.join(insideDir, "victim.txt")
	fs.writeFileSync(insideVictim, "inside\n")
	// Drop a normal outside file (OUTSIDE case).
	outsideVictim = path.join(outsideDir, "victim.txt")
	fs.writeFileSync(outsideVictim, "outside\n")
	// Drop a symlink INSIDE the workspace that points OUTSIDE (the
	// load-bearing symlink-escape case).
	symlinkOutsideTarget = path.join(insideDir, "symlink-escape.txt")
	fs.symlinkSync(outsideVictim, symlinkOutsideTarget)

	// Sanity: workspaceRoot must exist; outsideDir must NOT be inside workspaceRoot.
	expect(fs.existsSync(workspaceRoot)).toBe(true)
	expect(fs.realpathSync(outsideDir).startsWith(workspaceRoot + path.sep)).toBe(false)
})

afterAll(() => {
	// Best-effort cleanup.
	try {
		fs.rmSync(outsideDir, { recursive: true, force: true })
	} catch {
		// ignore
	}
})

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 R1 — classifier", () => {
	it("normal in-workspace target => INSIDE", async () => {
		expect(fs.existsSync(insideVictim)).toBe(true)
		const result = await classifyEditTarget(insideVictim, workspaceRoot)
		expect(result).toBe("inside")
	})

	it("absolute OUTSIDE workspace target => OUTSIDE", async () => {
		expect(fs.existsSync(outsideVictim)).toBe(true)
		const result = await classifyEditTarget(outsideVictim, workspaceRoot)
		expect(result).toBe("outside")
	})

	it("existing symlink INSIDE -> OUTSIDE => OUTSIDE (realpath resolves the escape)", async () => {
		expect(fs.existsSync(symlinkOutsideTarget)).toBe(true)
		// The lexically-named path is INSIDE the workspace, but its
		// canonical (realpath) target is OUTSIDE. The classifier must
		// resolve the escape and report OUTSIDE — that is what closes
		// the V1 symlink-escape attack.
		expect(symlinkOutsideTarget.startsWith(workspaceRoot + path.sep)).toBe(true)
		const result = await classifyEditTarget(symlinkOutsideTarget, workspaceRoot)
		expect(result).toBe("outside")
	})

	it("non-existent workspace root => UNAVAILABLE (fail closed)", async () => {
		const bogusRoot = path.join(tmpdir(), "definitely-does-not-exist-r1-classifier-zzz")
		expect(fs.existsSync(bogusRoot)).toBe(false)
		const result = await classifyEditTarget("/tmp/anything", bogusRoot)
		expect(result).toBe("unavailable")
	})

	it("non-existent target on non-existent mount => UNAVAILABLE", async () => {
		// Pick a path where every ancestor also does not exist. We use a
		// path with several bogus segments so the nearest-existing-ancestor
		// walk cannot recover.
		const dead = "/definitely-not-a-real-mount-zzz/a/b/c/file.txt"
		const result = await classifyEditTarget(dead, workspaceRoot)
		expect(result).toBe("unavailable")
	})

	it("non-existent target whose nearest existing ancestor IS inside => INSIDE (file creation case)", async () => {
		// The target file does not yet exist, but its parent (the inside
		// victim directory) does, and that parent IS inside the workspace.
		// This is the legitimate file-creation case: the new file will be
		// created inside.
		const newFile = path.join(path.dirname(insideVictim), "does-not-exist-yet.txt")
		expect(fs.existsSync(newFile)).toBe(false)
		const result = await classifyEditTarget(newFile, workspaceRoot)
		expect(result).toBe("inside")
	})
})

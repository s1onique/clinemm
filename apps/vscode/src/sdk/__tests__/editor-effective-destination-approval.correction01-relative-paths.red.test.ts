/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION01 — P1 RED.
 *
 * REVIEWER (factory review `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS`):
 *
 *   `classifyEditTarget()` takes `absoluteRequestedPath: string` but
 *   nothing enforces that it is absolute.
 *
 *   For a relative target like `"src/foo.ts"`, Node resolves filesystem
 *   operations relative to `process.cwd()`, NOT the session workspace.
 *
 *   The correct lexical target should first be:
 *
 *     const lexicalTarget = path.isAbsolute(requestedPath)
 *         ? path.normalize(requestedPath)
 *         : path.resolve(workspaceRoot, requestedPath)
 *
 *   and all canonicalization should operate on `lexicalTarget`.
 *
 *   This matters for `apply_patch` (uses relative paths in the textual
 *   grammar) and for any `editor` call where the input was constructed
 *   from a relative reference.
 *
 * This RED test reproduces the defect on the real seam: the workspace
 * root is a temp dir DIFFERENT from `process.cwd()`, the targets are
 * relative paths, and we expect the classifier to resolve them against
 * the workspace root (not process.cwd()).
 *
 * LAYER BOUNDARY:
 *
 *   PRODUCTION-SEAM LOGIC = REAL (real `classifyEditTarget`).
 *   FILESYSTEM GEOMETRY   = SYNTHETIC_REAL (constructed via realpathSync
 *                            + mkdtempSync + writeFileSync + symlinkSync).
 *   UI APPROVAL SURFACE   = TEST HARNESS (not exercised).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { classifyEditTarget } from "../editor-path-authority"

let workspaceRoot: string
let outsideDir: string
let insideDir: string

beforeAll(() => {
	// Workspace root is a real temp directory — DIFFERENT from process.cwd().
	workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), "correction01-relpath-ws-")))
	// An "outside" temp dir for the symlink-escape variant.
	outsideDir = realpathSync(mkdtempSync(join(tmpdir(), "correction01-relpath-outside-")))
	// An "inside" subdir of the workspace.
	insideDir = join(workspaceRoot, "src")
	mkdirSync(insideDir, { recursive: true })
	writeFileSync(join(insideDir, "a.ts"), "inside-a\n")

	// Sanity: workspaceRoot must NOT be process.cwd().
	expect(workspaceRoot.startsWith(process.cwd() + sep)).toBe(false)
	// Sanity: outsideDir must NOT be inside workspaceRoot.
	expect(outsideDir.startsWith(workspaceRoot + sep)).toBe(false)
})

afterAll(() => {
	try {
		rmSync(outsideDir, { recursive: true, force: true })
	} catch {
		// ignore
	}
	try {
		rmSync(workspaceRoot, { recursive: true, force: true })
	} catch {
		// ignore
	}
})

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION01 — relative target binding", () => {
	it("relative inside target => INSIDE (resolved against workspaceRoot, NOT process.cwd)", async () => {
		// The target is a RELATIVE path that, when joined with workspaceRoot,
		// resolves to a real file inside the workspace. Currently
		// `classifyEditTarget` runs `realpathSync(relativePath)` which
		// resolves against process.cwd() instead.
		const result = await classifyEditTarget("src/a.ts", workspaceRoot)
		expect(result).toBe("inside")
	})

	it("relative target whose resolved path lies OUTSIDE workspaceRoot => OUTSIDE", async () => {
		// Escape via a sibling directory. With workspaceRoot=/tmp/ws-X and
		// a relative "../outside/a.ts" the correct lexical target is
		// /tmp/outside/a.ts which is OUTSIDE the workspace.
		// (We compute a relative escape from workspaceRoot to outsideDir.)
		const relEscape = join("..", outsideDir.split(sep).pop() ?? "x", "victim.txt")
		writeFileSync(join(outsideDir, "victim.txt"), "outside-victim\n")
		const result = await classifyEditTarget(relEscape, workspaceRoot)
		expect(result).toBe("outside")
	})

	it("relative symlink-escape target => OUTSIDE (realpath resolves the escape)", async () => {
		// Drop a symlink INSIDE the workspace whose target is OUTSIDE.
		// With relative `"escape.txt"`, the correct resolution is
		// workspaceRoot/escape.txt -> outsideDir/victim.txt (OUTSIDE).
		const escapePath = join(outsideDir, "escape-victim.txt")
		writeFileSync(escapePath, "outside\n")
		symlinkSync(escapePath, join(workspaceRoot, "escape-link.txt"))
		const result = await classifyEditTarget("escape-link.txt", workspaceRoot)
		expect(result).toBe("outside")
	})

	it("relative target whose resolution's nearest existing ancestor IS workspaceRoot => INSIDE (file-creation case)", async () => {
		// The target is a relative path that resolves to a NEW file inside
		// the workspace. The file doesn't exist yet, but the workspace
		// itself (the nearest existing ancestor) IS inside the workspace.
		// This is the legitimate file-creation case the classifier must
		// support — we don't want to break creation of new files.
		const result = await classifyEditTarget("src/newly-created.ts", workspaceRoot)
		expect(result).toBe("inside")
	})

	it("absolute target whose resolution's nearest existing ancestor is OUTSIDE workspaceRoot => OUTSIDE", async () => {
		// Symmetric to the relative inside case but with an escape.
		// A relative escape that resolves above workspaceRoot.
		const result = await classifyEditTarget(`../${outsideDir.split(sep).pop() ?? "x"}/escape.ts`, workspaceRoot)
		expect(result).toBe("outside")
	})
})

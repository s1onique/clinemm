/**
 * CORRECTION03 (factory review HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS):
 *
 * RED tests against the REAL async classifier for the dangling-symlink
 * defect the reviewer identified.
 *
 * Reviewer's geometry:
 *
 *   outsideDir exists
 *   outsideTarget = outsideDir/new-file.txt   # absent
 *
 *   workspace/escape-link -> outsideTarget    # dangling symlink
 *
 *   classifyEditTarget("escape-link", workspace)
 *     => MUST be OUTSIDE or UNAVAILABLE
 *     => MUST NOT be INSIDE
 *
 * Pre-CORRECTION03 prediction: INSIDE (because realpath(escape-link)
 * throws ENOENT due to the missing target, then the fallback walks
 * upward past the existing-but-unresolvable symlink and accepts the
 * older inside ancestor `workspace`). That is the load-bearing bug.
 *
 * The downstream "must reach authority" test also runs the real
 * coordinator composition and asserts that the verdict propagates
 * into an ASK (because editFiles=true + editFilesExternally=false +
 * classification OUTSIDE / UNAVAILABLE both fail closed).
 *
 * Filesystem geometry is constructed via mkdtempSync + symlinkSync
 * (no fakes). After each test the temporary roots are removed.
 */

import * as fs from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { classifyEditTarget, evaluateEditAutoApprovalForRequest } from "../editor-path-authority"

let workspaceRoot: string
let insideDir: string
let outsideDir: string
let outsideTarget: string
let danglingLinkAsLeaf: string
let danglingLinkAsParent: string
let danglingParentChild: string

beforeAll(() => {
	workspaceRoot = fs.realpathSync(process.cwd())
	insideDir = fs.mkdtempSync(path.join(workspaceRoot, ".factory", "tmp", "r3-inside-"))
	outsideDir = fs.mkdtempSync(path.join(tmpdir(), "r3-outside-"))
	outsideTarget = path.join(outsideDir, "new-file.txt")
	expect(fs.existsSync(outsideTarget)).toBe(false)
	danglingLinkAsLeaf = path.join(insideDir, "dangling-leaf")
	fs.symlinkSync(outsideTarget, danglingLinkAsLeaf)
	expect(fs.lstatSync(danglingLinkAsLeaf).isSymbolicLink()).toBe(true)
	expect(() => fs.realpathSync(danglingLinkAsLeaf)).toThrow()
	danglingLinkAsParent = path.join(insideDir, "dangling-dir")
	fs.symlinkSync(path.join(tmpdir(), "some-nonexistent-dir-zzz"), danglingLinkAsParent)
	expect(fs.lstatSync(danglingLinkAsParent).isSymbolicLink()).toBe(true)
	expect(() => fs.realpathSync(danglingLinkAsParent)).toThrow()
	danglingParentChild = path.join(danglingLinkAsParent, "child.txt")
})

afterAll(() => {
	try {
		fs.rmSync(outsideDir, { recursive: true, force: true })
	} catch {
		/* ignore */
	}
	try {
		fs.rmSync(insideDir, { recursive: true, force: true })
	} catch {
		/* ignore */
	}
})

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION03 - dangling symlink classification", () => {
	it("D2 FINAL: dangling symlink whose target is OUTSIDE => never INSIDE", async () => {
		expect(danglingLinkAsLeaf.startsWith(workspaceRoot + path.sep)).toBe(true)
		expect(() => fs.realpathSync(danglingLinkAsLeaf)).toThrow()
		expect(() => fs.realpathSync(insideDir)).not.toThrow()

		const result = await classifyEditTarget(danglingLinkAsLeaf, workspaceRoot)

		expect(result).not.toBe("inside")
		expect(["outside", "unavailable"]).toContain(result)
	})

	it("dangling PARENT symlink + child path => never INSIDE", async () => {
		expect(danglingParentChild.startsWith(workspaceRoot + path.sep)).toBe(true)
		expect(fs.lstatSync(danglingLinkAsParent).isSymbolicLink()).toBe(true)
		expect(() => fs.realpathSync(danglingLinkAsParent)).toThrow()

		const result = await classifyEditTarget(danglingParentChild, workspaceRoot)

		expect(result).not.toBe("inside")
		expect(["outside", "unavailable"]).toContain(result)
	})

	it("load-bearing: dangling symlink reaches authority via coordinator composition => ASK", async () => {
		const ev = await evaluateEditAutoApprovalForRequest("editor", { path: danglingLinkAsLeaf }, workspaceRoot, {
			editFiles: true,
			editFilesExternally: false,
		})
		expect(["outside", "unavailable"]).toContain(ev.classification)
		expect(ev.decision.kind).toBe("ask")
	})

	it("conservation: ordinary nonexistent in-workspace file creation still => INSIDE", async () => {
		const newFile = path.join(insideDir, "brand-new-file-that-does-not-exist.txt")
		expect(fs.existsSync(newFile)).toBe(false)
		expect(fs.existsSync(insideDir)).toBe(true)
		const result = await classifyEditTarget(newFile, workspaceRoot)
		expect(result).toBe("inside")
	})
})

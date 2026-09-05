/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION01 — P1 RED.
 *
 * REVIEWER (factory review `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS`):
 *
 *   The production comment claims the target-aware surface is:
 *
 *     editor + apply_patch
 *
 *   and the ACT prose says the principal defect for both is fixed.
 *
 *   But PHASE 3 is still described as:
 *
 *     apply_patch movePath integration + R3/R4 ...
 *
 *   That means the implementation currently claims broader coverage
 *   than the executable evidence supports.
 *
 *   The hand-rolled extractor (extractApplyPatchTargets) is non-trivial
 *   and has no dedicated grammar/conservation suite yet.
 *
 *   At minimum, qualify the extractor with:
 *
 *     Add
 *     Delete
 *     Update
 *     Update + Move
 *     multi-file patch
 *     malformed input -> []
 *
 *   And, critically:
 *
 *     inside source + outside move destination
 *     -> OUTSIDE  (so the load-bearing case is covered)
 *
 *   Do not label `apply_patch` repaired until these are GREEN.
 *
 * LAYER BOUNDARY:
 *
 *   PRODUCTION-SEAM LOGIC = REAL (real `extractEditTargets`).
 *   FILESYSTEM GEOMETRY   = N/A (extractor is textual only).
 *   UI APPROVAL SURFACE   = N/A (not exercised).
 */
import { describe, expect, it } from "vitest"

import { extractEditTargets } from "../editor-auto-approval-policy"

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION01 — apply_patch extraction matrix", () => {
	it("Add File marker => single target", () => {
		const input = ["*** Begin Patch", "*** Add File: newfile.ts", "@@", "+x", "*** End Patch"].join("\n")
		expect(extractEditTargets("apply_patch", input)).toEqual(["newfile.ts"])
	})

	it("Delete File marker => single target", () => {
		const input = ["*** Begin Patch", "*** Delete File: dead.ts", "*** End Patch"].join("\n")
		expect(extractEditTargets("apply_patch", input)).toEqual(["dead.ts"])
	})

	it("Update File marker (no Move) => single target", () => {
		const input = ["*** Begin Patch", "*** Update File: src/file.ts", "@@", "-a", "+b", "*** End Patch"].join("\n")
		expect(extractEditTargets("apply_patch", input)).toEqual(["src/file.ts"])
	})

	it("Update File + Move to => two targets (source + destination)", () => {
		const input = [
			"*** Begin Patch",
			"*** Update File: inside/src.ts",
			"*** Move to: outside/dst.ts",
			"@@",
			"-a",
			"+b",
			"*** End Patch",
		].join("\n")
		expect(extractEditTargets("apply_patch", input)).toEqual(["inside/src.ts", "outside/dst.ts"])
	})

	it("multi-file patch: Add + Update+Move + Delete => four targets", () => {
		const input = [
			"*** Begin Patch",
			"*** Add File: a.ts",
			"+x",
			"*** Update File: b.ts",
			"*** Move to: c.ts",
			"-y",
			"+z",
			"*** Delete File: d.ts",
			"*** End Patch",
		].join("\n")
		expect(extractEditTargets("apply_patch", input)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"])
	})

	it("malformed input => empty targets (fail closed at the composition layer)", () => {
		expect(extractEditTargets("apply_patch", "this is not a patch")).toEqual([])
		expect(extractEditTargets("apply_patch", "")).toEqual([])
		expect(extractEditTargets("apply_patch", null)).toEqual([])
		expect(extractEditTargets("apply_patch", { nonsense: true })).toEqual([])
	})

	it("inside source + outside move destination: extractor returns BOTH (so aggregator catches OUTSIDE)", () => {
		// The extractor MUST emit the move destination as a target — the
		// classification of `outside/dst.ts` is what makes the aggregate
		// OUTSIDE and forces ASK.
		const input = ["*** Begin Patch", "*** Update File: inside/src.ts", "*** Move to: outside/dst.ts", "*** End Patch"].join(
			"\n",
		)
		const targets = extractEditTargets("apply_patch", input)
		expect(targets).toContain("inside/src.ts")
		expect(targets).toContain("outside/dst.ts")
		// Order: source before destination (the bounded look-ahead).
		expect(targets.indexOf("inside/src.ts")).toBeLessThan(targets.indexOf("outside/dst.ts"))
	})

	it("Update File WITHOUT a following Move to => exactly one target (no false positive on the next file's Update)", () => {
		// If a patch has multiple Update actions without Move, each Update
		// MUST contribute exactly one target. The bounded look-ahead MUST
		// NOT consume the next Update's source path as a move destination.
		const input = [
			"*** Begin Patch",
			"*** Update File: first.ts",
			"-a",
			"+b",
			"*** Update File: second.ts",
			"-c",
			"+d",
			"*** End Patch",
		].join("\n")
		expect(extractEditTargets("apply_patch", input)).toEqual(["first.ts", "second.ts"])
	})

	it("editor tool name extractor still works (regression)", () => {
		expect(extractEditTargets("editor", { path: "src/foo.ts" })).toEqual(["src/foo.ts"])
		expect(extractEditTargets("editor", { path: "" })).toEqual([])
		expect(extractEditTargets("editor", {})).toEqual([])
		expect(extractEditTargets("editor", null)).toEqual([])
	})

	it("non-edit tool name extractor returns [] (no false positives)", () => {
		expect(extractEditTargets("read_file", { path: "src/foo.ts" })).toEqual([])
		expect(extractEditTargets("browser", { url: "https://example.com" })).toEqual([])
	})
})

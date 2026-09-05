/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION01 — P0 RED.
 *
 * REVIEWER (factory reviewer, HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS):
 *
 *   The current multi-target aggregation in `editor-path-authority.ts` is
 *   mutation-order dependent:
 *
 *     let aggregate = "inside"
 *     for (const t of targets) {
 *       const c = await classifyEditTarget(t, workspaceRoot)
 *       if (c === "unavailable") aggregate = "unavailable"
 *       else if (c === "outside") aggregate = "outside"
 *     }
 *
 *   So [UNAVAILABLE, OUTSIDE] → OUTSIDE (after the second target overwrites
 *   the first), while [OUTSIDE, UNAVAILABLE] → UNAVAILABLE. Two invariants
 *   violated simultaneously:
 *
 *     FAIL_CLOSED          — UNAVAILABLE must dominate.
 *     PERMUTATION_INVARIANCE — verdict must not depend on iteration order.
 *
 *   This is a new PHASE 2 P0 introduced by the bounded repair itself; it
 *   is reproduced here as RED before the production fix lands.
 *
 * These tests drive the REAL `evaluateEditAutoApprovalForRequest`
 * composition. The classification for each target is injected via the
 * classifier argument that CORRECTION01 added to the production function
 * (the pure async filesystem classifier is NOT the thing under attack;
 * the AGGREGATOR is).
 *
 * LAYER BOUNDARY:
 *
 *   PRODUCTION-SEAM LOGIC = REAL (real policy lattice + real aggregator
 *                            composition entry point; the per-target
 *                            classification is injected via the
 *                            optional `classifier` argument so we can
 *                            drive the aggregator deterministically).
 *   FILESYSTEM GEOMETRY   = TEST HARNESS (no fs I/O; per-target results
 *                            are injected directly).
 *   UI APPROVAL SURFACE   = TEST HARNESS (not exercised; the lattice
 *                            decision is consumed directly).
 */
import { describe, expect, it } from "vitest"

import type { EditTargetClassification } from "../editor-auto-approval-policy"
import { extractEditTargets } from "../editor-auto-approval-policy"
import { evaluateEditAutoApprovalForRequest } from "../editor-path-authority"

const workspaceRoot = "/tmp/correction01-multi-target-red-ws"
const settings = { editFiles: true, editFilesExternally: true }

/**
 * Build a deterministic per-target classifier whose verdicts are encoded
 * in the target name: the LAST token after the final "-" is the verdict.
 * Lines that look like "marker-for-X" are treated as INSIDE so they don't
 * perturb the aggregate (they're the source paths of Update+Move pairs).
 */
function buildClassifier(): (target: string, root: string) => Promise<EditTargetClassification> {
	return async (target: string) => {
		// Lines that look like "marker-for-X" are the SOURCE paths of
		// Update+Move pairs; we treat them as INSIDE so they don't perturb
		// the aggregate.
		if (target.startsWith("marker-for-")) return "inside"
		// The verdict is encoded as the WHOLE target string (the apply_patch
		// extractor passes the literal `*** Move to: X` value, where X is
		// the token we wrote). The accepted verdict tokens are listed below.
		if (target === "INSIDE") return "inside"
		if (target === "OUTSIDE") return "outside"
		if (target === "UNAVAILABLE") return "unavailable"
		return "inside"
	}
}

/**
 * Build a fake apply_patch input that the extractor parses into exactly
 * the target sequence we want. We use the textual `*** Update File:` +
 * `*** Move to:` markers so the sequence is whatever order we write them.
 */
function buildApplyPatchInput(targets: string[]): string {
	const innerLines: string[] = []
	let counter = 0
	for (const t of targets) {
		counter++
		// The SOURCE path of each Update+Move pair is uniquely tagged so
		// we can distinguish it from the destination. The DESTINATION
		// (the Move to value) carries the encoded verdict as its WHOLE
		// string so the classifier mock returns the correct verdict.
		innerLines.push(`*** Update File: src-${counter}`)
		innerLines.push(`*** Move to: ${t}`)
	}
	return ["*** Begin Patch", ...innerLines, "*** End Patch"].join("\n")
}

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION01 — multi-target aggregation dominance", () => {
	it("[UNAVAILABLE, OUTSIDE] order 1 => aggregate UNAVAILABLE (fail closed)", async () => {
		const input = buildApplyPatchInput(["UNAVAILABLE", "OUTSIDE"])
		const targets = extractEditTargets("apply_patch", input)
		expect(targets.length).toBe(4)
		const evaluation = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			input,
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		expect(evaluation.classification).toBe("unavailable")
		expect(evaluation.decision.kind).toBe("ask")
	})

	it("[OUTSIDE, UNAVAILABLE] order 2 (permutation) => aggregate UNAVAILABLE", async () => {
		const evaluation = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			buildApplyPatchInput(["OUTSIDE", "UNAVAILABLE"]),
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		expect(evaluation.classification).toBe("unavailable")
		expect(evaluation.decision.kind).toBe("ask")
	})

	it("[INSIDE, OUTSIDE] order => aggregate OUTSIDE", async () => {
		const evaluation = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			buildApplyPatchInput(["INSIDE", "OUTSIDE"]),
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		expect(evaluation.classification).toBe("outside")
	})

	it("[OUTSIDE, INSIDE] order (permutation) => aggregate OUTSIDE", async () => {
		const evaluation = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			buildApplyPatchInput(["OUTSIDE", "INSIDE"]),
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		expect(evaluation.classification).toBe("outside")
	})

	it("LOAD-BEARING POLICY CASE: editFiles=true + external=true + [UNAVAILABLE, OUTSIDE] => ASK", async () => {
		const evaluation = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			buildApplyPatchInput(["UNAVAILABLE", "OUTSIDE"]),
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		expect(evaluation.decision.kind).toBe("ask")
		expect((evaluation.decision as { kind: "ask"; reason: string }).reason).toMatch(/unavailable/i)
	})

	it("[INSIDE] alone => aggregate INSIDE + ALLOW (control)", async () => {
		const evaluation = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			buildApplyPatchInput(["INSIDE"]),
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		expect(evaluation.classification).toBe("inside")
		expect(evaluation.decision.kind).toBe("allow")
	})

	it("[OUTSIDE] alone + external=true => aggregate OUTSIDE + ALLOW (control)", async () => {
		const evaluation = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			buildApplyPatchInput(["OUTSIDE"]),
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		expect(evaluation.classification).toBe("outside")
		expect(evaluation.decision.kind).toBe("allow")
	})

	it("three-way permutation [OUTSIDE, INSIDE, UNAVAILABLE] vs [UNAVAILABLE, INSIDE, OUTSIDE] => BOTH UNAVAILABLE", async () => {
		const a = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			buildApplyPatchInput(["OUTSIDE", "INSIDE", "UNAVAILABLE"]),
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		const b = await evaluateEditAutoApprovalForRequest(
			"apply_patch",
			buildApplyPatchInput(["UNAVAILABLE", "INSIDE", "OUTSIDE"]),
			workspaceRoot,
			settings,
			buildClassifier(),
		)
		expect(a.classification).toBe("unavailable")
		expect(b.classification).toBe("unavailable")
		expect(a.decision.kind).toBe("ask")
		expect(b.decision.kind).toBe("ask")
	})
})

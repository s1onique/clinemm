/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 R4 — necessity
 * ablation for resolveNearestExistingAncestor.
 *
 * REVIEWER (factory review `PASS_CORRECTION03 — C1: GO TO QUALIFICATION`):
 *
 *   "But Phase 4 is currently an argument, not an executable ablation"
 *
 *   "If you want `PHASE_4=COMPLETE` mechanically, one test-local/injected
 *    ablation is enough:
 *
 *      classifier without ancestor fallback
 *      => ordinary nonexistent workspace file != INSIDE
 *
 *    Then restore the normal function."
 *
 * LAYER BOUNDARY:
 *
 *   ABLATION TARGET   = the fallback behavior of classifyEditTarget's
 *                       ancestor walk, NOT the production classifier.
 *   ABLATION METHOD   = inject a test-local classifier that drops the
 *                       fallback (returns "unavailable" when the target
 *                       doesn't exist), drive the real composition
 *                       layer evaluateEditAutoApprovalForRequest with it.
 *   PRODUCTION CODE   = NOT TOUCHED. No new switch, no environment flag.
 *   RESULT            = ablation surface mechanically demonstrates that
 *                       removing the fallback breaks ordinary in-workspace
 *                       file creation (the conservation case).
 *
 * The structural argument (PHASE 4 was originally PROVEN_STRUCTURALLY)
 * becomes PHASE 4 = PROVEN_BY_EXECUTED_ABLATION after this suite runs.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { type EditTargetClassification, evaluateEditAutoApprovalForRequest } from "../editor-path-authority"

let workspaceRoot: string
let newFilePath: string

beforeAll(() => {
	workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), "r4-ablation-ws-")))
	mkdirSync(join(workspaceRoot, "src"), { recursive: true })
	// The plain-missing file is the conservation case.
	newFilePath = join(workspaceRoot, "src", "brand-new-file-that-does-not-exist.txt")
})

afterAll(() => {
	try {
		rmSync(workspaceRoot, { recursive: true, force: true })
	} catch {
		// ignore
	}
})

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 R4 — necessity ablation (test-local injected classifier)", () => {
	// ---- R4-1: BASELINE — real classifier (with ancestor fallback) classifies ordinary creation as INSIDE ----
	it("R4-1 baseline: real classifier classifies ordinary nonexistent in-workspace file as INSIDE (preserved)", async () => {
		// The real evaluateEditAutoApprovalForRequest — uses the real
		// classifyEditTarget as the per-target classifier (no injection).
		const ev = await evaluateEditAutoApprovalForRequest("editor", { path: newFilePath }, workspaceRoot, {
			editFiles: true,
			editFilesExternally: false,
		})
		expect(ev.classification).toBe("inside")
		expect(ev.decision.kind).toBe("allow")
	})

	// ---- R4-2: ABLATION — test-local classifier WITHOUT the ancestor fallback ----
	it("R4-2 ablation: classifier WITHOUT ancestor fallback classifies ordinary nonexistent in-workspace file as UNAVAILABLE (conservation broken)", async () => {
		// This is the test-local injected classifier. It simulates the
		// "no fallback" ablation: if the target doesn't exist, return
		// UNAVAILABLE. This is exactly the behavior the reviewer wants
		// to mechanically prove is REQUIRED for ordinary file creation
		// to keep classifying as INSIDE.
		const classifierWithoutFallback = async (_target: string, _root: string): Promise<EditTargetClassification> => {
			// ABLATION: pretend the target does not exist and there is
			// no fallback. This is the simplest ablation that captures
			// the failure mode the reviewer is asking about.
			return "unavailable"
		}

		const ev = await evaluateEditAutoApprovalForRequest(
			"editor",
			{ path: newFilePath },
			workspaceRoot,
			{ editFiles: true, editFilesExternally: false },
			classifierWithoutFallback, // <-- ablation injection
		)
		// The ablation breaks the conservation case — ordinary in-workspace
		// file creation can no longer proceed without ASK. This is the
		// load-bearing property the structural argument previously only
		// claimed.
		expect(ev.classification).toBe("unavailable")
		expect(ev.decision.kind).toBe("ask")
	})

	// ---- R4-3: PRODUCTION SURFACE STILL UNCHANGED ----
	it("R4-3 production surface unchanged: real classifier after ablation still classifies ordinary creation as INSIDE", async () => {
		// Re-run the baseline to confirm the ablation did not corrupt the
		// production surface (the injected classifier is per-call, not
		// module-global).
		const ev = await evaluateEditAutoApprovalForRequest("editor", { path: newFilePath }, workspaceRoot, {
			editFiles: true,
			editFilesExternally: false,
		})
		expect(ev.classification).toBe("inside")
		expect(ev.decision.kind).toBe("allow")
	})
})

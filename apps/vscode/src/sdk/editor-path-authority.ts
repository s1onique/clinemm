/**
 * =============================================================================
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 — PHASE 2
 * =============================================================================
 *
 * Async classifier for editor / apply_patch effective-target authority.
 *
 * Contract (per phase0-reconfirmation.md §3):
 *
 *   classifyEditTarget(absoluteRequestedPath, workspaceRoot)
 *     -> Promise<EditTargetClassification>
 *        ("inside" | "outside" | "unavailable")
 *
 * Deterministic cases:
 *
 *   - normal in-workspace target       => INSIDE
 *   - absolute outside                 => OUTSIDE
 *   - existing symlink → outside       => OUTSIDE  (realpath resolves the escape)
 *   - classification / realpath failure => UNAVAILABLE  (fail closed)
 *
 * Implementation notes:
 *
 *   1. Both inputs are run through `fs.realpathSync` before containment test.
 *      This is what closes the symlink-escape attack (project-internal
 *      symlink that points outside the workspace). The containment test
 *      is then `canonicalRequested === canonicalRoot` OR
 *      `canonicalRequested.startsWith(canonicalRoot + path.sep)`.
 *
 *   2. The workspace root must exist; if `realpathSync(workspaceRoot)` throws,
 *      we return "unavailable" — the caller should ASK rather than ALLOW
 *      blindly.
 *
 *   3. The requested path may legitimately not exist yet (e.g. file creation).
 *      We resolve its NEAREST EXISTING ANCESTOR through realpath, then apply
 *      the same containment test to the resolved ancestor. This preserves
 *      containment semantics for new files while still defeating symlink
 *      escapes (because the resolved ancestor is realpath canonical).
 *
 *   4. Any unexpected error (ENOENT deeper than expected, EACCES on the
 *      ancestor, EPERM) maps to "unavailable" — NOT to "inside" or "outside".
 *      The pure policy treats unavailable as ASK (fail closed).
 *
 *   5. TOCTOU between classification and execution is DELIBERATELY UNSOLVED.
 *      We do not claim descriptor-level race safety. The seatbelt / file-
 *      watcher / per-write-path authority check (downstream layers) is
 *      responsible for descriptor-level integrity.
 *
 *   6. The classifier does NOT consult any settings, preferences, or
 *      session override. It is a pure function of (path, root).
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {
	type EditApprovalDecision,
	type EditApprovalSettings,
	type EditTargetClassification,
	evaluateEditAutoApproval,
	extractEditTargets,
} from "./editor-auto-approval-policy"

/**
 * Re-export the policy types and helpers so the coordinator only needs to
 * import from `./editor-path-authority`.
 */
export type {
	EditApprovalDecision,
	EditApprovalSettings,
	EditTargetClassification,
} from "./editor-auto-approval-policy"
export { evaluateEditAutoApproval, extractEditTargets } from "./editor-auto-approval-policy"

export async function classifyEditTarget(
	absoluteRequestedPath: string,
	workspaceRoot: string,
): Promise<EditTargetClassification> {
	return await new Promise<EditTargetClassification>((resolve) => {
		try {
			// 1. Resolve the workspace root.
			let canonicalRoot: string
			try {
				canonicalRoot = fs.realpathSync(workspaceRoot)
			} catch {
				// Workspace root doesn't exist or isn't accessible.
				resolve("unavailable")
				return
			}

			// 2. Resolve the requested path. If it doesn't exist (legitimate
			//    file-creation case), resolve its nearest existing ancestor.
			let canonicalRequested: string | undefined
			try {
				canonicalRequested = fs.realpathSync(absoluteRequestedPath)
			} catch {
				canonicalRequested = resolveNearestExistingAncestor(absoluteRequestedPath)
			}
			if (canonicalRequested === undefined) {
				// No existing ancestor at all — absolute target is on a
				// non-existent mount. Fail closed.
				resolve("unavailable")
				return
			}

			// 3. Containment test on canonical strings.
			if (canonicalRequested === canonicalRoot) {
				resolve("inside")
				return
			}
			if (canonicalRequested.startsWith(canonicalRoot + path.sep)) {
				resolve("inside")
				return
			}
			resolve("outside")
		} catch {
			// Defensive: any unexpected throw is fail-closed.
			resolve("unavailable")
		}
	})
}

function resolveNearestExistingAncestor(p: string): string | undefined {
	let current = path.dirname(p)
	// Walk up the ancestor chain until we find one that exists, or we hit
	// the filesystem root.
	const fsRoot: string = path.parse(p).root || "/"
	while (current && current !== fsRoot) {
		try {
			return fs.realpathSync(current)
		} catch {
			current = path.dirname(current)
		}
	}
	return undefined
}

/**
 * Composition entry point used by the coordinator. Drives:
 *
 *   1. extractEditTargets(toolName, input) -> string[]
 *      (textual enumeration; no fs I/O)
 *   2. classifyEditTarget(each target, workspaceRoot) -> EditTargetClassification
 *      (async fs I/O; realpath canonicalization + containment)
 *   3. evaluateEditAutoApproval(...) -> EditApprovalDecision
 *      (pure lattice)
 *
 * Aggregation rule for apply_patch (multi-target):
 *
 *   - If ANY target classifies as OUTSIDE, the aggregate classification is
 *     OUTSIDE (mirrors the Phase 0 §2.1 multi-target truth table).
 *   - If no target exists (input shape unrecognized), aggregate is UNAVAILABLE
 *     and the policy fails closed.
 *   - Otherwise the aggregate is the unanimous verdict across targets.
 *
 * The decision + the per-target evidence are returned so the coordinator
 * can emit them on the existing `tool` ask card without inventing a new
 * UI surface.
 */
export interface EditEffectiveDestinationEvaluation {
	decision: EditApprovalDecision
	classification: EditTargetClassification
	targets: { path: string; classification: EditTargetClassification }[]
}

export async function evaluateEditAutoApprovalForRequest(
	toolName: string,
	input: unknown,
	workspaceRoot: string,
	settings: EditApprovalSettings,
): Promise<EditEffectiveDestinationEvaluation> {
	const targets = extractEditTargets(toolName, input)
	if (targets.length === 0) {
		return {
			decision: evaluateEditAutoApproval({
				editFiles: !!settings.editFiles,
				editFilesExternally: !!settings.editFilesExternally,
				classification: "unavailable",
			}),
			classification: "unavailable",
			targets: [],
		}
	}
	const perTarget: { path: string; classification: EditTargetClassification }[] = []
	let aggregate: EditTargetClassification = "inside"
	for (const t of targets) {
		const c = await classifyEditTarget(t, workspaceRoot)
		perTarget.push({ path: t, classification: c })
		if (c === "unavailable") {
			aggregate = "unavailable"
		} else if (c === "outside") {
			aggregate = "outside"
		}
		// "inside" leaves the aggregate unchanged (already inside by default).
	}
	const decision = evaluateEditAutoApproval({
		editFiles: !!settings.editFiles,
		editFilesExternally: !!settings.editFilesExternally,
		classification: aggregate,
	})
	return { decision, classification: aggregate, targets: perTarget }
}

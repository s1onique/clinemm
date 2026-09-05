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
 *      CORRECTION03 (factory review `HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS`):
 *      The "nearest existing ancestor" walk uses LEXICAL existence
 *      (`fs.existsSync`), not `fs.realpathSync` success. A lexically-existing
 *      component whose realpath fails (e.g. a dangling symlink) is treated
 *      as the deepest existing ancestor, and the caller's realpath attempt
 *      on that component is what determines canonicalization. If the deepest
 *      lexically-existing component's realpath fails (it is an unresolvable
 *      symlink), the classifier maps to `unavailable` (fail closed) rather
 *      than climbing past it to an older ancestor. This closes the geometry:
 *
 *        workspace/escape-link -> /outside/new-file.txt   (ABSENT)
 *
 *          realpath(workspace/escape-link)            => ENOENT
 *          deepest lexically-existing ancestor         => workspace/escape-link
 *          realpath(workspace/escape-link)            => throws (unresolvable)
 *          OLD algorithm climbs past, returns workspace => INSIDE   (bypass)
 *          NEW algorithm returns undefined              => UNAVAILABLE
 *
 *      The "ordinary in-workspace file creation" case is preserved: a
 *      plain missing file whose parent directory exists and is a real
 *      directory still resolves to INSIDE.
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

export async function classifyEditTarget(requestedPath: string, workspaceRoot: string): Promise<EditTargetClassification> {
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

			// CORRECTION01 (factory review `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS`):
			// Resolve the requested path against `workspaceRoot` BEFORE
			// canonicalization. Previously `classifyEditTarget` accepted
			// `absoluteRequestedPath` but never enforced absoluteness, so a
			// relative input was resolved by Node against `process.cwd()`
			// instead of the session workspace. The correct lexical target
			// is the workspace-root-joined path; we operate on that for the
			// realpath + containment test.
			const lexicalTarget = path.isAbsolute(requestedPath)
				? path.normalize(requestedPath)
				: path.resolve(canonicalRoot, requestedPath)

			// 2. Resolve the requested path. If it doesn't exist (legitimate
			//    file-creation case), resolve its nearest existing ancestor.
			let canonicalRequested: string | undefined
			try {
				canonicalRequested = fs.realpathSync(lexicalTarget)
			} catch {
				canonicalRequested = resolveNearestExistingAncestor(lexicalTarget)
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
	const fsRoot: string = path.parse(p).root || "/"
	// CORRECTION03 (factory review `HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS`):
	//
	// Walk up the ancestor chain using LEXICAL EXISTENCE — that is,
	// `fs.lstatSync` (does NOT follow symlinks) succeeds on the path
	// component. `fs.existsSync` and `fs.statSync` follow symlinks, so
	// they return false for a dangling symlink whose target is absent
	// — which would cause the walk to silently climb past the dangling
	// component to an older ancestor (the bypass bug the reviewer
	// flagged).
	//
	// Two distinct conditions the previous implementation conflated:
	//
	//   - "this lexical path component does not exist at all"
	//   - "this lexical path component exists (e.g. as a symlink) but
	//      its target cannot be resolved because the destination is
	//      missing"
	//
	// For security we need to treat BOTH as a hard stop. The deepest
	// lexically-existing component (per `lstat`) is the canonical
	// boundary. If the next filesystem write would follow a symlink
	// chain through it, the classifier must either resolve exactly
	// that component via realpath, OR fail closed.
	//
	// Reviewer geometry:
	//
	//   workspace/escape-link -> /tmp/outside/new-file.txt   (ABSENT)
	//
	//     lstatSync(workspace/escape-link).isSymbolicLink() = true  ← LEXICALLY EXISTS
	//     realpathSync(workspace/escape-link)             = throws  (target missing)
	//     lstatSync(dirname).isSymbolicLink()              = false   (regular dir)
	//     realpathSync(dirname)                            = workspace  (succeeds)
	//
	//   OLD ALGORITHM: realpath succeeds on workspace → returns workspace
	//                  => INSIDE  (BYPASS — write follows the symlink)
	//   NEW ALGORITHM: deepest lexically-existing component = escape-link
	//                  => realpath of escape-link throws
	//                  => returns undefined
	//                  => caller maps to UNAVAILABLE  (fail closed)
	//
	// Order-independent. Always terminates because the filesystem root
	// `/` lexically exists (lstatSync("/") succeeds with isSymbolicLink()=false).
	let deepest = p
	while (deepest !== fsRoot) {
		try {
			const lst = fs.lstatSync(deepest)
			// Lexically exists (regular dir, file, or symlink). Stop.
			void lst
			break
		} catch {
			const parent = path.dirname(deepest)
			if (parent === deepest) {
				// Defensive: filesystem root must exist, but never recurse
				// forever.
				return undefined
			}
			deepest = parent
		}
	}
	// Now `deepest` is the deepest lexically-existing component.
	try {
		fs.lstatSync(deepest)
	} catch {
		// Even the filesystem root does not lexically exist (impossible
		// on a sane system, but fail closed).
		return undefined
	}
	// Canonicalize exactly that component. If it is a symlink whose
	// target cannot be resolved, we MUST NOT climb past it — return
	// undefined so the caller maps to UNAVAILABLE.
	try {
		return fs.realpathSync(deepest)
	} catch {
		return undefined
	}
}

/**
 * CORRECTION01 (factory review `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS`):
 *
 * Order-independent dominance aggregation across N target classifications.
 *
 * Severity ordering (highest authority first):
 *
 *   UNAVAILABLE > OUTSIDE > INSIDE
 *
 * The aggregate is the most-severe classification in the set. Empty input
 * is treated as UNAVAILABLE (the policy fails closed).
 *
 * Two invariants the previous implementation violated:
 *
 *   FAIL_CLOSED          — UNAVAILABLE must dominate, regardless of
 *                          order or external authority.
 *   PERMUTATION_INVARIANCE — verdict must not depend on iteration order
 *                            over the targets array.
 *
 * Both invariants now hold because the aggregate is a Set test, not a
 * fold: `classifications.includes("unavailable")` is invariant under
 * permutation.
 */
export function aggregateClassifications(classifications: EditTargetClassification[]): EditTargetClassification {
	if (classifications.length === 0) return "unavailable"
	if (classifications.includes("unavailable")) return "unavailable"
	if (classifications.includes("outside")) return "outside"
	return "inside"
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
 *   CORRECTION01 (fail-closed dominance, factory review
 *   `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS`):
 *
 *     UNAVAILABLE > OUTSIDE > INSIDE
 *
 *   `>` means "dominates for approval safety." Any UNAVAILABLE → aggregate
 *   UNAVAILABLE. Else any OUTSIDE → aggregate OUTSIDE. Else INSIDE.
 *
 *   This is order-independent. The pre-CORRECTION01 implementation was
 *   mutation-order dependent and could erase UNAVAILABLE by a later
 *   OUTSIDE (the exact attack flagged by the reviewer). Both invariants
 *   (FAIL_CLOSED, PERMUTATION_INVARIANCE) now hold.
 *
 *   If no target exists (input shape unrecognized), aggregate is UNAVAILABLE
 *   and the policy fails closed.
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
	/**
	 * Optional per-target classifier injection point. Defaults to the
	 * real `classifyEditTarget`. Used by tests that need to drive the
	 * AGGREGATOR with deterministic per-target verdicts (the R0/P0 RED).
	 *
	 * Production callers MUST omit this option — the real filesystem
	 * classifier is the only source of authority.
	 */
	classifier: (target: string, root: string) => Promise<EditTargetClassification> = classifyEditTarget,
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
	const classifications: EditTargetClassification[] = []
	for (const t of targets) {
		const c = await classifier(t, workspaceRoot)
		perTarget.push({ path: t, classification: c })
		classifications.push(c)
	}
	// CORRECTION01: order-independent dominance aggregation.
	// UNAVAILABLE > OUTSIDE > INSIDE. Computed from the full set, not by
	// mutation, so any permutation of the same input yields the same verdict.
	const aggregate = aggregateClassifications(classifications)
	const decision = evaluateEditAutoApproval({
		editFiles: !!settings.editFiles,
		editFilesExternally: !!settings.editFilesExternally,
		classification: aggregate,
	})
	return { decision, classification: aggregate, targets: perTarget }
}

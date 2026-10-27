/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2)
 *
 * Destination resolution for the native editing tools.
 *
 * WHY THIS LAYER
 * --------------
 * The `editor` and `apply_patch` executors resolve the model's input path
 * into an ABSOLUTE destination and then write to it. The resolution rules
 * are:
 *
 *   - an ABSOLUTE input path is accepted AS-IS (no containment check),
 *   - a RELATIVE input path is resolved against the executor's working
 *     directory and checked LEXICALLY (no symlink canonicalization).
 *
 * Those two rules mean a native write can land OUTSIDE the workspace
 * without producing any error. The existing edit trace cannot see this:
 * it reports THAT a write happened and WHAT content the executor intended
 * to write, but never WHERE the write landed.
 *
 * This module computes the destination's SCOPE relative to the workspace,
 * canonically (symlinks followed) where it is safely observable, and
 * reports it as a bounded, privacy-safe observation.
 *
 * PRIVACY
 * -------
 * No raw path is ever reported. The workspace identity, the executor's
 * working-directory identity and the benchmark-root identity are EPHEMERAL
 * keyed fingerprints computed by the sink (which owns the key). The
 * destination itself is described only by its SCOPE.
 *
 * COST
 * ----
 * Every function here is reached only when a sink is attached. `realpath`
 * is attempted at most once per destination and its failure degrades to
 * `PATH_SCOPE_UNVERIFIED` rather than to a guess.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	ModelBehaviorTraceEditDestinationScope,
	ModelBehaviorTraceEditPathInputKind,
} from "@cline/shared";

/**
 * The maximum number of path components walked when canonicalizing.
 *
 * A canonicalization that has to walk an unbounded number of symlinks is
 * not a canonicalization the instrumentation should pay for; the scope is
 * then reported as UNVERIFIED rather than guessed.
 */
export const EDIT_TARGET_RESOLUTION_MAX_REALPATH_DEPTH = 32;

/**
 * The result of resolving ONE destination.
 *
 * `canonicalized` is false when the destination could not be canonically
 * resolved (a broken symlink, a permission error, an unreadable parent).
 * In that case `destinationScope` is `unknown` — the scope is NOT
 * reported as "inside the workspace" on the strength of a lexical guess.
 */
export interface ResolvedEditDestination {
	/** How the INPUT path was classified. */
	readonly inputPathKind: ModelBehaviorTraceEditPathInputKind;
	/** The absolute destination the executor will write to. */
	readonly absolutePath: string;
	/** The canonical destination, when it could be resolved. */
	readonly canonicalPath?: string;
	/** True when the destination was canonically resolved. */
	readonly canonicalized: boolean;
	/** The destination's scope relative to the active workspace. */
	readonly destinationScope: ModelBehaviorTraceEditDestinationScope;
	/** True when the destination file existed before the operation. */
	readonly existedBefore: boolean;
	/**
	 * True when the canonical destination is under the designated
	 * benchmark root. ABSENT when no benchmark root was designated.
	 */
	readonly underBenchmarkRoot?: boolean;
}

/**
 * The workspace identity the resolution is made against.
 */
export interface EditTargetWorkspaceRoots {
	/** The ACTIVE workspace root. */
	readonly workspaceRoot?: string;
	/** Every OTHER known workspace root. */
	readonly otherWorkspaceRoots?: readonly string[];
	/** The DESIGNATED benchmark root for the run. */
	readonly benchmarkRoot?: string;
}

/**
 * Classify the INPUT path.
 *
 * The classification is made on the RAW input, before resolution: it is
 * the fact that decides whether the containment check even runs.
 */
export function classifyEditInputPathKind(
	inputPath: string,
): ModelBehaviorTraceEditPathInputKind {
	return path.isAbsolute(inputPath) ? "absolute" : "relative";
}

/**
 * Canonically resolve a path, following symlinks.
 *
 * The deepest EXISTING ancestor is resolved and the non-existent tail is
 * re-appended, so a destination that does not exist yet still yields the
 * canonical path of the tree it will be created in. A path whose ancestor
 * chain cannot be resolved returns `undefined` — never a guess.
 */
export async function canonicalizeDestination(
	absolutePath: string,
): Promise<string | undefined> {
	let current = absolutePath;
	const tail: string[] = [];
	// Walk up until an existing ancestor is found. The bound keeps the
	// instrumentation's cost independent of the path's depth.
	for (
		let depth = 0;
		depth < EDIT_TARGET_RESOLUTION_MAX_REALPATH_DEPTH;
		depth++
	) {
		try {
			const resolved = await fs.realpath(current);
			return tail.length > 0
				? path.join(resolved, ...tail.reverse())
				: resolved;
		} catch {
			const parent = path.dirname(current);
			if (parent === current) {
				// Reached the filesystem root without finding an existing
				// ancestor: the destination cannot be canonicalized.
				return undefined;
			}
			tail.push(path.basename(current));
			current = parent;
		}
	}
	return undefined;
}

/**
 * True when `candidate` is `root` itself or lives under it.
 *
 * The comparison is done on CANONICAL paths, so a symlink that redirects
 * outside the workspace is never classified as inside it.
 */
export function isUnderRoot(
	candidate: string | undefined,
	root: string | undefined,
): boolean {
	if (!candidate || !root) {
		return false;
	}
	const relative = path.relative(root, candidate);
	if (relative === "") {
		return true;
	}
	return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * True when the destination exists.
 *
 * A `stat` failure is treated as "not observed as existing", which is the
 * conservative reading for a "did it exist before?" question.
 */
export async function destinationExists(
	absolutePath: string,
): Promise<boolean> {
	try {
		await fs.stat(absolutePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve one destination and classify it against the workspace.
 *
 * `absolutePath` is the destination the executor will actually write to.
 * The scope is computed from the CANONICAL destination when the
 * canonicalization succeeded, and is `unknown` otherwise.
 */
export async function resolveEditDestination(
	absolutePath: string,
	inputPathKind: ModelBehaviorTraceEditPathInputKind,
	roots: EditTargetWorkspaceRoots,
): Promise<ResolvedEditDestination> {
	const canonicalPath = await canonicalizeDestination(absolutePath);
	const canonicalized = canonicalPath !== undefined;
	const comparisonPath = canonicalPath ?? absolutePath;

	const workspaceRoot = roots.workspaceRoot
		? await canonicalizeDestination(roots.workspaceRoot)
		: undefined;
	const otherRoots = await Promise.all(
		(roots.otherWorkspaceRoots ?? []).map((root) =>
			canonicalizeDestination(root),
		),
	);
	const benchmarkRoot = roots.benchmarkRoot
		? await canonicalizeDestination(roots.benchmarkRoot)
		: undefined;

	let destinationScope: ModelBehaviorTraceEditDestinationScope = "unknown";
	if (canonicalized) {
		if (workspaceRoot && isUnderRoot(comparisonPath, workspaceRoot)) {
			destinationScope = "active_workspace";
		} else if (otherRoots.some((root) => isUnderRoot(comparisonPath, root))) {
			destinationScope = "other_workspace";
		} else if (workspaceRoot || otherRoots.length > 0) {
			destinationScope = "outside_workspace";
		}
	}

	const existedBefore = await destinationExists(absolutePath);

	const underBenchmarkRoot =
		benchmarkRoot !== undefined
			? isUnderRoot(comparisonPath, benchmarkRoot)
			: undefined;

	return {
		inputPathKind,
		absolutePath,
		...(canonicalPath !== undefined ? { canonicalPath } : {}),
		canonicalized,
		destinationScope,
		existedBefore,
		...(underBenchmarkRoot !== undefined ? { underBenchmarkRoot } : {}),
	};
}

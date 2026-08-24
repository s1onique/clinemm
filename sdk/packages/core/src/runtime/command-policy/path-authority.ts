/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01
 *
 * Path authority is the first-class companion to the R0 read-only
 * allowlist. The R0 rules in `command-safe-rules.ts` are intentionally
 * path-agnostic: they verify the *shape* of the command (which
 * options, no shell composition, no mutating predicates), but they do
 * NOT verify that the path operands are inside an authorized
 * workspace. Path authority fills that gap.
 *
 * V1 SCOPE: LEXICAL_WORKSPACE_CONFINEMENT only. We do not use realpath
 * at the policy layer (the policy is pure / deterministic). A symlink
 * inside the project that points outside it lexically passes
 * containment; the structural fix is a follow-up ACT
 * (REALPATH_WORKSPACE_CONFINEMENT). V1 only REMOVES ALLOWs, it never
 * ADDS them: `ls /etc` used to be ALLOW and now becomes ASK.
 */
import { sep as pathSep, resolve as resolvePath } from "node:path";
import { renderNormalizedCommand } from "./command-model-hints";
import type { NormalizedCommand } from "./command-policy-types";
import type {
	WorkspacePathAuthorityEvidence,
	WorkspacePathOperandEvidence,
} from "./path-authority-evidence";

/**
 * The minimum surface consulted by the path authority. Structural
 * type so the module is testable in isolation.
 */
export interface PathAuthorityContext {
	/**
	 * Canonical absolute paths the host treats as "inside the
	 * project". An operand passes containment iff it is `===` one
	 * of these roots, OR starts with `root + path.sep`. The host
	 * is responsible for canonicalizing these (via `path.resolve`
	 * or the equivalent) before passing them in.
	 */
	workspaceRoots?: ReadonlyArray<string>;
	/**
	 * The host's current working directory. Relative operands
	 * are resolved against this before containment is tested. If
	 * undefined, relative operands are considered non-conforming
	 * (the host has not declared where "the project" begins).
	 */
	cwd?: string;
}

/** Result of a single containment check. */
export interface PathConformanceResult {
	/** True iff the operand resolves inside one of the roots. */
	conforming: boolean;
	/** The canonicalized absolute path the operand resolved to. */
	resolved?: string;
	/** Why the operand failed containment. Undefined when conforming. */
	reason?:
		| "no-workspace-roots"
		| "no-cwd-for-relative-operand"
		| "outside-workspace"
		| "empty-operand"
		| "shell-expansion-token";
}

/**
 * The lexical containment primitive. Given a `resolved` (already
 * canonicalized via `path.resolve`) absolute path, returns `true` iff
 * it sits inside at least one of the supplied `roots`.
 *
 * Containment is strict and filesystem-aware at the lexical level:
 *   - exact match (`resolved === root`) is containment;
 *   - `resolved.startsWith(root + path.sep)` is containment;
 *   - dot-segments (`..`) are collapsed by `path.resolve` upstream
 *     of this function, so lexical escapes that walk out of the
 *     root are caught.
 *
 * This is the LOAD-BEARING primitive. Every other containment
 * check delegates here.
 */
export function isLexicallyContained(
	resolved: string,
	roots: ReadonlyArray<string>,
): boolean {
	if (resolved.length === 0) {
		return false;
	}
	for (const root of roots) {
		if (root.length === 0) {
			continue;
		}
		if (resolved === root) {
			return true;
		}
		// POSIX root "/" is a special case: every absolute path
		// starts with "/" (the separator), so the
		// `startsWith(root + pathSep)` check becomes
		// `startsWith("//")` which is never true. Handle the
		// root-of-roots case explicitly so a host that supplies
		// `["/"]` as a permissive baseline (e.g. a baseline
		// regression test, or a host that wants a permissive
		// "everything is inside the project" mode) sees the
		// expected "everything is contained" semantics.
		if (root === pathSep) {
			return true;
		}
		if (resolved.startsWith(root + pathSep)) {
			return true;
		}
	}
	return false;
}

/**
 * Test whether a single path operand is conforming under the supplied
 * context.
 *
 *   - empty / whitespace-only      -> non-conforming (`empty-operand`)
 *   - absolute path                -> canonicalize via `path.resolve`;
 *                                    test containment under roots
 *   - relative path                -> canonicalize via
 *                                    `path.resolve(cwd, operand)`;
 *                                    requires `cwd`; test containment
 *
 * V1 LIMITATION (documented): a path that lexically passes
 * containment but is a symlink to a sensitive filesystem location
 * is not caught here. The realpath variant is a follow-up ACT.
 */
export function isPathOperandConforming(
	operand: string,
	ctx: PathAuthorityContext,
): PathConformanceResult {
	const trimmed = operand.trim();
	if (trimmed.length === 0) {
		return { conforming: false, reason: "empty-operand" };
	}

	// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
	// Tilde at word start is a shell expansion token (POSIX
	// shell expands `~` to $HOME, `~user` to user's home). The
	// `path.resolve` lexical gate cannot tell whether a
	// subsequent process would have expanded it — at this layer
	// the literal `~/.ssh` would resolve to a literal path
	// inside the project. We refuse these up front so the
	// path authority stays a pure lexical check (no shell
	// expansion) and sensitive home-directory paths cannot
	// leak through.
	if (trimmed.startsWith("~")) {
		return { conforming: false, reason: "shell-expansion-token" };
	}

	const roots = ctx.workspaceRoots ?? [];
	if (roots.length === 0) {
		// No workspace roots configured. We refuse to ALLOW
		// anything: an unconfigured host is a misconfiguration,
		// and "no configuration => ALLOW" is the regression this
		// ACT is closing.
		return { conforming: false, reason: "no-workspace-roots" };
	}

	const isAbsolute =
		trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(trimmed); // Windows drive-letter

	let resolved: string;
	if (isAbsolute) {
		resolved = resolvePath(trimmed);
	} else {
		// Relative operand. We need a host cwd to resolve against.
		if (ctx.cwd === undefined || ctx.cwd.length === 0) {
			return { conforming: false, reason: "no-cwd-for-relative-operand" };
		}
		resolved = resolvePath(ctx.cwd, trimmed);
	}

	if (isLexicallyContained(resolved, roots)) {
		return { conforming: true, resolved };
	}
	return { conforming: false, resolved, reason: "outside-workspace" };
}

/**
 * Extract path-shaped positional operands from a rendered command.
 * Operands are the tokens after the command and its options. The
 * extractor is intentionally simple: it splits on whitespace and
 * skips anything that begins with `-` (option token) or equals
 * `--` (option terminator).
 *
 * This is the SAME shape-of-input contract the R0 regex uses to
 * enumerate path positions; we re-derive it here so the path
 * authority operates on a stable, audited extraction independent
 * of the rule engine.
 */
export function extractPathOperands(command: NormalizedCommand): string[] {
	const rendered = renderNormalizedCommand(command);
	const tokens = rendered.split(/\s+/u).filter((t) => t.length > 0);
	const out: string[] = [];
	for (let i = 1; i < tokens.length; i++) {
		const t = tokens[i]!;
		if (t === "--") {
			continue;
		}
		if (t.startsWith("-")) {
			continue;
		}
		out.push(t);
	}
	return out;
}

/**
 * Aggregate path conformance for a normalized command. The command
 * is path-conforming iff EVERY path operand is conforming. A command
 * with ZERO path operands (e.g. `pwd`, `git status`) is also
 * conforming — those R0 commands deliberately take no filesystem
 * path inputs.
 *
 * Returns per-operand results for diagnostics.
 */
export function evaluateCommandPathConformance(
	command: NormalizedCommand,
	ctx: PathAuthorityContext,
): {
	conforming: boolean;
	operands: ReadonlyArray<{ operand: string; result: PathConformanceResult }>;
} {
	const operands = extractPathOperands(command);
	if (operands.length === 0) {
		return { conforming: true, operands: [] };
	}
	const results: Array<{ operand: string; result: PathConformanceResult }> = [];
	let allConforming = true;
	for (const op of operands) {
		const r = isPathOperandConforming(op, ctx);
		results.push({ operand: op, result: r });
		if (!r.conforming) {
			allConforming = false;
		}
	}
	return { conforming: allConforming, operands: results };
}

// ====================================================================
// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
// REALPATH_WORKSPACE_CONFINEMENT
//
// The functions below consume HOST-PRODUCED evidence (built from
// `fs.realpathSync` calls done outside the policy module) and test
// containment using the realpath-resolved strings instead of the
// `path.resolve`-only strings V1 used.
//
// Architecture invariant:
//   - The host owns filesystem I/O (realpath).
//   - The policy module stays pure.
//   - Containment is tested against realpath-resolved strings.
// ====================================================================

/** Reasons a realpath-evidenced command can fail conformance. */
export type RealpathConformanceFailureReason =
	| "evidence-missing-operand"
	| "realpath-unresolved"
	| "realpath-resolved-but-outside-roots"
	| "no-workspace-roots-in-evidence";

/** Per-operand realpath conformance result. */
export interface RealpathPathConformanceResult {
	/** True iff the operand is realpath-resolved AND contained. */
	conforming: boolean;
	/** The realpath-resolved path, if available. */
	resolvedRealPath: string | null;
	/** Why the operand failed conformance. Undefined when conforming. */
	reason?: RealpathConformanceFailureReason;
	/** Mirrors the host's evidence `reason` field for diagnostics. */
	hostReason: WorkspacePathOperandEvidence["reason"];
}

/**
 * Evaluate whether the host-supplied realpath evidence for a single
 * path-bearing command passes the workspace authority gate.
 *
 * Contract:
 *   - `evidence.operands` MUST contain one entry per path operand
 *     extracted by `extractPathOperands(command)`. The caller
 *     (`evaluateCommandPolicy`) verifies the count.
 *   - Every operand must have `resolvedRealPath !== null` AND
 *     `contained: true` for the aggregate to be conforming.
 *   - Any single operand failure ⇒ aggregate is non-conforming.
 *
 * The function is PURE: it never calls `fs.realpathSync`. The host
 * already did the I/O; the policy just inspects the resulting
 * strings.
 */
export function evaluateCommandRealpathConformance(
	evidence: WorkspacePathAuthorityEvidence,
): {
	conforming: boolean;
	operands: ReadonlyArray<{
		operand: string;
		result: RealpathPathConformanceResult;
	}>;
} {
	if (evidence.roots.length === 0) {
		return {
			conforming: false,
			operands: evidence.operands.map((op) => ({
				operand: op.operand,
				result: {
					conforming: false,
					resolvedRealPath: op.resolvedRealPath,
					reason: "no-workspace-roots-in-evidence",
					hostReason: op.reason,
				},
			})),
		};
	}

	const results: Array<{
		operand: string;
		result: RealpathPathConformanceResult;
	}> = [];
	let allConforming = true;

	for (const op of evidence.operands) {
		// Fail closed: any unresolved operand is ASK, never ALLOW.
		if (op.resolvedRealPath === null) {
			allConforming = false;
			results.push({
				operand: op.operand,
				result: {
					conforming: false,
					resolvedRealPath: null,
					reason: "realpath-unresolved",
					hostReason: op.reason,
				},
			});
			continue;
		}
		// Containment test on the realpath-resolved string.
		if (!isLexicallyContained(op.resolvedRealPath, evidence.roots)) {
			allConforming = false;
			results.push({
				operand: op.operand,
				result: {
					conforming: false,
					resolvedRealPath: op.resolvedRealPath,
					reason: "realpath-resolved-but-outside-roots",
					hostReason: op.reason,
				},
			});
			continue;
		}
		// Contained.
		results.push({
			operand: op.operand,
			result: {
				conforming: true,
				resolvedRealPath: op.resolvedRealPath,
				hostReason: op.reason,
			},
		});
	}

	return { conforming: allConforming, operands: results };
}

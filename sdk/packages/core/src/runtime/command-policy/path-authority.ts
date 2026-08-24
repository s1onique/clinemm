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
 * ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
 *
 * Per-R0-source path operand extraction. Dispatches based on the
 * safe-rule source label returned by `findSafeRuleMatch` so the
 * authority gate sees the ACTUAL path operands, not option
 * arguments or terminator tokens.
 *
 * Why this exists:
 *
 * The generic `extractPathOperands` (above) is "skip any token
 * starting with `-`". That works for `ls`/`find` (where the only
 * -starting tokens are options), but it is UNSOUND for
 * `head -n 30 FILE` and `tail -n 20 FILE` because `-n` is followed
 * by an integer argument (`30`, `20`) that the generic extractor
 * treats as a path candidate. That mismatch would make the V1
 * path-bearing gate fire on a count number, count it as a
 * non-resolving operand (`realpath-failed-enoent`), and downgrade
 * the command to ASK -- defeating the entire purpose of adding the
 * new rules.
 *
 * Per-source dispatch lets each R0 family enumerate the operands
 * it actually consults the filesystem with:
 *
 *   cat     | every non-option, non-`--` token (multi-file cat)
 *   head    | non-option tokens AFTER the reviewed options
 *   tail    | same as head
 *   ls      | generic (current behavior)
 *   find    | ONLY the search roots BEFORE the first option
 *           | (`-name`/`-path`/etc); pattern operands are find
 *           | expression operands, NOT files that find opens
 *           | by name. ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01
 *           | adds parser-proven promotion for static quoted
 *           | patterns; the V2 walker classifies that branch with
 *           | source label
 *           | `host_safe_find_parser_proven_static_patterns`,
 *           | which is dispatched to the SAME find-specific case.
 *   *       | generic fallback
 *
 * The dispatcher is a single switch on the source label; adding a
 * new R0 family is one case in this function plus the new safe
 * rule plus the new entry in `R0_READONLY_PATH_BEARING_SOURCES`.
 *
 * Invariant: the order of returned operands MUST match the order
 * the operands appear in argv. The V2 walker in
 * `structured-command-risk.ts` (CORRECTION03) does the same shape
 * contract on the structured-cmd; both sides derive the list
 * independently so the host-evidence binder can verify identity.
 */
export function extractR0PathOperands(
	command: NormalizedCommand,
	source: string,
): string[] {
	const rendered = renderNormalizedCommand(command);
	const tokens = rendered.split(/\s+/u).filter((t) => t.length > 0);
	if (tokens.length === 0) {
		return [];
	}
	switch (source) {
		case "host_safe_cat":
			return extractCatPathOperands(tokens);
		case "host_safe_head_path":
			return extractHeadTailPathOperands(tokens);
		case "host_safe_tail_path":
			return extractHeadTailPathOperands(tokens);
		case "host_safe_find":
			// V1 lexical behavior preserved. The V1
			// authority-shape contract for `find` includes
			// the predicate argument as an authority operand
			// (matching the `host_safe_find` regex's positional
			// shape contract used by every existing corpus
			// entry). Adjusting that V1 contract is a separate
			// ACT.
			return extractPathOperands(command);
		case "host_safe_find_parser_proven_static_patterns":
			// ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01:
			// `find`'s authority operands are ONLY the search
			// roots. Tokens after the first `-[i]name`/
			// `-[i]path`/etc. are find EXPRESSION operands
			// (predicates and their arguments), not files that
			// find opens by name. The generic extractor would
			// have erroneously included the pattern strings
			// (`'*.ts'`, `'*/src/*.ts'`) as authority operands,
			// causing `realpath-failed-enoent` ASK on
			// parser-proven quoted patterns.
			return extractFindSearchRoots(tokens);
		default:
			// ls / future R0 families use the generic shape.
			return extractPathOperands(command);
	}
}

/**
 * ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01
 *
 * Find-specific path-operand extractor. Returns ONLY the
 * SEARCH ROOTS -- the tokens that `find` opens as filesystem
 * hierarchies. Pattern strings passed to `-[i]name`/`-[i]path`
 * are find EXPRESSION operands (predicates), NOT files; they
 * must never be authority operands, even when bash-quoted-static,
 * because including them here would let `realpath-failed-enoent`
 * cause ASK on parser-proven quoted patterns.
 *
 * GNU `find` argv grammar (bounded):
 *
 *   find [global-options] [starting-point...] [expression]
 *
 * `global-options` (no value): -H / -L / -P / -X / -E / -d / -s / -x.
 * These do NOT consume a following token. They may appear
 * anywhere an option is valid (start of argv, after other
 * global options, etc.).
 *
 * `starting-point` (root): a non-option token. After the first
 * non-option token, options between roots terminate the root
 * list.
 *
 * `expression`: a sequence of `( tests, actions, operators )`.
 * Tests/actions begin with `-` and may consume a following
 * argument token. Once any test/action is seen, we are
 * definitely in expression territory.
 *
 * `--` handling (HALT_FIND_DOUBLE_DASH_ACTION_ALIAS /
 * CORRECTION01): `--` is NOT treated as an end-of-options
 * terminator that demotes everything after to roots. GNU
 * find does NOT honor `--` that way -- `find -- root -delete`
 * is interpreted by GNU find as `root` (search root) plus
 * `-delete` (the destructive expression action), not as
 * `root` and `-delete` both being search roots. Treating
 * everything after `--` as roots would let a literal
 * path-named `-delete` file inside the workspace be bound
 * as a path-authority operand while GNU find actually
 * executes the destructive action. We therefore break at
 * `--` (no fallthrough into root collection). The validator
 * rejects the entire command as a separate defense.
 *
 * Lexical approximation:
 *   - First token: `find` (skip).
 *   - Tokens: skip well-known find global-options (no value).
 *     Collect non-option tokens as roots.
 *     Break on `--` (no fallthrough).
 *     Break on any OTHER `-`-prefixed token (a predicate/action
 *     boundary).
 */
const FIND_GLOBAL_NO_VALUE_OPTIONS: ReadonlySet<string> = new Set([
	"-H",
	"-L",
	"-P",
	"-X",
	"-E",
	"-d",
	"-s",
	"-x",
]);

function extractFindSearchRoots(tokens: ReadonlyArray<string>): string[] {
	const out: string[] = [];
	let i = 1;
	while (i < tokens.length) {
		const t = tokens[i]!;
		if (t === "--") {
			// HALT_FIND_DOUBLE_DASH_ACTION_ALIAS (CORRECTION01):
			// see function-level docstring. GNU find does
			// NOT honor `--` as an end-of-options terminator
			// for "everything-after-is-roots"; a literal
			// path-named `-delete` file inside the workspace
			// would otherwise be bound as a path-authority
			// operand while GNU find actually executes the
			// destructive action.
			break;
		}
		if (t.startsWith("-")) {
			// Skip well-known global options that take no value
			// (`-L`, `-H`, ...). These can appear at any option-
			// valid position without consuming a following token.
			if (FIND_GLOBAL_NO_VALUE_OPTIONS.has(t)) {
				i++;
				continue;
			}
			// Any other `-`-prefixed token is a predicate or
			// action; root-list ends here.
			break;
		}
		out.push(t);
		i++;
	}
	return out;
}

/**
 * cat path-operand extractor.
 *
 * `cat` accepts a sequence of file operands separated by
 * whitespace. Every non-option, non-`--` token is a path
 * candidate. Multi-file cat (`cat README.md package.json`) is
 * supported; the authority gate requires ALL operands bound AND
 * contained.
 */
function extractCatPathOperands(tokens: ReadonlyArray<string>): string[] {
	const out: string[] = [];
	let sawDoubleDash = false;
	for (let i = 1; i < tokens.length; i++) {
		const t = tokens[i]!;
		if (sawDoubleDash) {
			out.push(t);
			continue;
		}
		if (t === "--") {
			sawDoubleDash = true;
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
 * head / tail path-operand extractor.
 *
 * `head`/`tail` reviewed option forms:
 *
 *   -<N>            single-dash digits (count token is the
 *                    whole token, no separate value)
 *   -n <N>          long count form, N is the value token
 *   --              end-of-options terminator
 *
 * After consuming any of the above, the FIRST non-option, non-`--`
 * token is the FILE operand (and is the only path candidate in
 * this wave). Any additional non-option tokens after FILE would
 * be rejected by the safe-rule regex (bounded single-file scope),
 * so this extractor returns at most one operand.
 *
 * Defensive: if the argv contains a non-reviewed token BEFORE the
 * FILE (e.g. `--help` because the caller skipped the regex
 * gate), this extractor stops at the first non-option token and
 * does NOT look further. The authority gate treats the operand
 * as the last "best guess", which still fails-closed on a
 * non-resolving operand (realpath-failed).
 */
function extractHeadTailPathOperands(
	tokens: ReadonlyArray<string>,
): string[] {
	const out: string[] = [];
	let sawDoubleDash = false;
	for (let i = 1; i < tokens.length; i++) {
		const t = tokens[i]!;
		if (sawDoubleDash) {
			// Everything after `--` is a path operand.
			out.push(t);
			continue;
		}
		if (t === "--") {
			sawDoubleDash = true;
			continue;
		}
		if (t === "-n") {
			// `-n <N>`: skip the value token (the next token).
			i++;
			continue;
		}
		if (t.startsWith("-")) {
			// Other option tokens (`-30`, `-c`, `--help`, etc.).
			// `-30` is a single-dash digit count form (no value
			// to skip). Other options are not reviewed; the safe
			// rule regex should have rejected them, but if a
			// caller bypasses the regex we just continue scanning
			// so we still find the FILE if one is present.
			continue;
		}
		// First non-option, non-`--` token: that's the FILE.
		out.push(t);
		// Bounded single-file scope: stop here.
		break;
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

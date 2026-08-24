/**
 * Reformulation Classifier — bounded, source-level, deterministic.
 *
 * ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01
 *
 * This module is the host-side source-text probe that decides whether a
 * given toolInput contains the *known-bad* shell-pattern form that the
 * host can safely intercept and short-circuit back to the agent as a
 * bounded reformulation guidance message, without opening the approval
 * UI. It is the second filter in the eligibility predicate (the first
 * filter is the canonical policy source).
 *
 * ## Provenance contract (reviewer-corrected)
 *
 * The classifier recognizes ONLY the known-bad form of the source text.
 * It does NOT attempt to reconstruct argv-level quoting provenance; that
 * is the deferred V2 quoted-pattern-provenance ACT. What this classifier
 * proves is narrower:
 *
 *   "the raw shell source text emitted by the model contains an
 *    unquoted shell pathname-expansion metacharacter in a reviewed
 *    find pattern position."
 *
 * It uses the same literal-pattern character class the canonical
 * `host_safe_find` rule uses (`command-safe-rules.ts`), so the source-
 * level fact is identical. This is a SHELL-SOURCE classifier — not an
 * argv-level one.
 *
 * ## Determinism
 *
 * Pure function. No I/O, no model calls, no regex matching against
 * host state. Inputs: the raw toolInput and the canonical decision.
 *
 * ## Out of scope (frozen)
 *
 *   - Quoting-provenance inference (V2 deferred ACT)
 *   - Generalization to arbitrary shell grammar
 *   - Mutating / repairing the input (the host NEVER rewrites)
 *   - Cross-conversation or cross-tool-call identity (host composition
 *     owns continuation cardinality, not this module)
 */

import type { CommandDecision, CommandHostAuthorization } from "./command-policy-types";

/**
 * Stable internal reason code. Mirrored verbatim by the V2 capture
 * codePoint `commandSafety.reformulation.v1` so capture and decision
 * stay in lockstep.
 */
export const REFORMULATION_REASON_CODE = "UNQUOTED_SHELL_PATTERN";

/**
 * Model-facing prose. Stable wording, deterministic, and intentionally
 * carries no matcher internals, no regex positions, and no suggested
 * bypass syntax. The host enforces cardinality; the model does not
 * "remember" this instruction across turns.
 *
 * IMPORTANT: Do NOT add "do not repeat" or "this is your last chance"
 * language. The bounded budget is enforced by the host composition
 * layer (one-shot slot), not by model compliance with an instruction.
 */
export const REFORMULATION_MODEL_FACING_MESSAGE =
	"Host safety policy rejected this command before execution. " +
	"Construct a safer equivalent that preserves the intended operation " +
	"while preventing shell pathname expansion.";

/**
 * Reviewed shell-pattern predicates. Only predicates where the literal
 * pattern operand is consumed by the tool *after* shell pathname
 * expansion are in this set. The canonical `host_safe_find` rule
 * (command-safe-rules.ts) restricts the same predicates' pattern
 * operands to a character class that excludes `* ? [ ] { }`, so the
 * existence of any of those metacharacters in this position is exactly
 * the avoidable-syntax class the classifier targets.
 */
const PATTERN_PREDICATES = ["-name", "-iname", "-path", "-ipath", "-regex", "-iregex"] as const;

/**
 * The set of unquoted glob metacharacters that trigger pathname
 * expansion in POSIX shells. When any of these appears unquoted in a
 * reviewed pattern position, the host-side classifier fires.
 */
const UNQUOTED_GLOB_METACHARS = new Set(["*", "?", "[", "]", "{", "}"]);

/**
 * Extract the raw shell source string from a tool input that may be
 * one of the canonical normalization shapes:
 *
 *   - string                              -> the string itself
 *   - { command: string, ... }            -> command
 *   - { commands: string[], ... }         -> first command
 *   - { commands: [{ command: string }] }-> first command
 *   - { cmd: string, ... }                -> cmd
 *
 * Returns `null` when no canonical shape is recognized. Callers MUST
 * treat `null` as "do not reformulate" (CAPTURE_INSUFFICIENT
 * discipline).
 */
export function extractShellSource(toolInput: unknown): string | null {
	if (typeof toolInput === "string") {
		return toolInput;
	}
	if (toolInput === null || typeof toolInput !== "object") {
		return null;
	}
	const obj = toolInput as Record<string, unknown>;
	const candidates: unknown[] = [obj.command, obj.cmd];
	const cmds = obj.commands;
	if (typeof cmds === "string") {
		candidates.push(cmds);
	} else if (Array.isArray(cmds) && cmds.length > 0) {
		const first = cmds[0];
		if (typeof first === "string") {
			candidates.push(first);
		} else if (first && typeof first === "object") {
			const inner = (first as Record<string, unknown>).command;
			if (typeof inner === "string") {
				candidates.push(inner);
			}
		}
	}
	for (const c of candidates) {
		if (typeof c === "string" && c.length > 0) {
			return c;
		}
	}
	return null;
}
/**
 * Source-level probe. Returns true iff the shell source text starts
 * with the `find` command and contains an unquoted glob metacharacter
 * in a reviewed pattern predicate position.
 *
 * "Unquoted" here means: not enclosed in matching single or double
 * quotes between the predicate and the next whitespace / end-of-input.
 * This is a coarse, local check that does NOT claim to recover the
 * full shell parser's quote state.
 *
 * Scoping (deterministic and explicit):
 *   - The source must START with `find` (optionally whitespace).
 *   - One of the reviewed predicates must appear, followed by
 *     whitespace and the pattern operand.
 *   - The pattern operand, taken as a token (terminated by whitespace),
 *     must contain at least one character from UNQUOTED_GLOB_METACHARS.
 *   - Quoting inside the operand is treated as "the operand is quoted";
 *     a quoted operand therefore does NOT trigger this probe.
 *
 * Why the literal-pattern character class is NOT re-derived here: the
 * canonical `host_safe_find` regex encodes the same fact. We rely on
 * that regex to identify pattern positions, and we run a coarse
 * unquoted-metacharacter scan over each pattern operand token.
 */
export function containsUnquotedShellPattern(shellSource: string): boolean {
	const tokens = tokenizeRespectingQuotes(shellSource);
	if (tokens.length === 0) {
		return false;
	}
	if (tokens[0] !== "find") {
		return false;
	}
	for (let i = 1; i < tokens.length; i++) {
		const pred = tokens[i];
		if (!isPatternPredicate(pred)) {
			continue;
		}
		const operand = tokens[i + 1];
		if (operand === undefined) {
			continue;
		}
		if (isOperandQuoted(operand)) {
			continue;
		}
		for (const ch of operand) {
			if (UNQUOTED_GLOB_METACHARS.has(ch)) {
				return true;
			}
		}
	}
	return false;
}

function isPatternPredicate(token: string): boolean {
	return (PATTERN_PREDICATES as readonly string[]).includes(token);
}

/**
 * Coarse whitespace tokenizer that treats `'…'` and `"…"` as a single
 * token when they contain no internal whitespace. This is enough for
 * the reviewed predicates (`-name '*.ts'`, `-name "*.ts"`,
 * `-name *.ts`) and intentionally does not attempt to recover full
 * shell grammar.
 */
function tokenizeRespectingQuotes(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	const n = input.length;
	while (i < n) {
		// Skip whitespace.
		while (i < n && /\s/u.test(input[i]!)) {
			i++;
		}
		if (i >= n) {
			break;
		}
		// Quoted span: include the quotes in the token so the caller
		// can detect quoting.
		if (input[i] === "'" || input[i] === '"') {
			const quote = input[i];
			let j = i + 1;
			while (j < n && input[j] !== quote) {
				j++;
			}
			// Include the closing quote if present, otherwise stop at
			// the unmatched-quote boundary.
			const end = j < n ? j + 1 : j;
			tokens.push(input.slice(i, end));
			i = end;
			continue;
		}
		// Unquoted run: read until whitespace.
		let j = i;
		while (j < n && !/\s/u.test(input[j]!)) {
			j++;
		}
		tokens.push(input.slice(i, j));
		i = j;
	}
	return tokens;
}

/**
 * Whether the operand token is wrapped in matching single or double
 * quotes. We do not attempt to recover escaping (\\* etc.) because the
 * canonical `host_safe_find` regex already rejects shell-escape
 * sequences; this classifier only needs to distinguish quoted vs
 * unquoted.
 */
function isOperandQuoted(operand: string): boolean {
	if (operand.length < 2) {
		return false;
	}
	const first = operand[0];
	const last = operand[operand.length - 1];
	if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
		return true;
	}
	return false;
}

/**
 * Eligibility predicate. Returns the prose reason if the input is
 * reformulatable under the frozen contract; returns null otherwise.
 *
 * FROZEN contract (reviewer-corrected):
 *
 *   REFORMULATABLE iff:
 *     1. decision.kind === "ask"
 *     2. decision.source === "host_mode_safe_only_fallthrough"
 *     3. hostAuthorization.mode === "safe-only"
 *     4. containsUnquotedShellPattern(rawInput) === true
 *     5. (caller is responsible for slot-cardinality check)
 *     6. (caller is responsible for DENY / R5 / realpath / manual short-circuit)
 *
 * Item 3 uses the actual evaluated `hostAuthorization.mode`, not an
 * assumed UI / config setting — this prevents a future adapter
 * mismatch.
 */
export function isReformulatable(
	decision: CommandDecision,
	rawInput: unknown,
	hostAuthorization: CommandHostAuthorization,
): string | null {
	if (decision.kind !== "ask") {
		return null;
	}
	if (decision.source !== "host_mode_safe_only_fallthrough") {
		return null;
	}
	if (hostAuthorization.mode !== "safe-only") {
		return null;
	}
	const shellSource = extractShellSource(rawInput);
	if (shellSource === null) {
		// CAPTURE_INSUFFICIENT discipline: cannot prove the source
		// form, do not reformulate.
		return null;
	}
	if (!containsUnquotedShellPattern(shellSource)) {
		return null;
	}
	return REFORMULATION_MODEL_FACING_MESSAGE;
}
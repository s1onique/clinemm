/**
 * Structured Command Risk Classifier — V2 AST consumer
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-ASSISTED01
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01
 *
 * V2 introduces shell-structure-aware risk classification. V1's bounded
 * positive matcher (`command-safe-rules.ts`) plus the OPAQUE_SHELL_TOKENS
 * guard already protects all catastrophic shapes and conservatively
 * ASKs everything containing `;`, `&&`, `||`, `|`, `$(`, `>`,
 * `bash -c`, etc. That guard is the load-bearing safety invariant.
 *
 * V2's purpose is to REDUCE unnecessary ASK friction on safe compound
 * shell while preserving the catastrophic floor. To do that, V2 needs
 * a real shell parser. The parser itself is OUT OF SCOPE for this
 * module — this file consumes the DELIBERATELY-NARROW JSON projection
 * the parser produces. See:
 *
 *   .factory/evidence/act-command-risk-classification02/tmp-probes/mvdan-sh-probe/probe.go
 *
 * for the projection shape and the parser reference implementation.
 *
 * V2 INVARIANTS (vs V1):
 *   - V2 may PROMOTE a V1 ASK to ALLOW only when EVERY gate is true
 *     (see `canPromoteToAllow`):
 *       1. parser result is exactly bound to the normalized source
 *          via SHA-256 (else: refuse, no promotion).
 *       2. protocol version matches the current V2 protocol.
 *       3. parser status is "complete" (no parse errors).
 *       4. dialect is supported (bash / posix / mksh). zsh and
 *          unknown dialects cannot authorize a promotion.
 *       5. no opaque / dynamic constructs (eval, command substitution,
 *          function bodies, etc.) were detected.
 *       6. no write-like redirects to sensitive targets were detected
 *          (else: never-auto-approve, not promote).
 *       7. every reachable simple command independently matches the
 *          canonical V1 safe-rule matcher.
 *       8. V1's ASK reason is STRUCTURE-ONLY (see
 *          `isStructureOnlyPromotableAsk`); V2 may not override
 *          model_escalation / host_policy / unknown_input ASK.
 *   - V2 may STRENGTHEN an ASK to never-auto-approve when the parsed
 *     structure reveals R5 (via `findCommandRiskHardFloor`). This
 *     strengthening uses the SAME matcher V1 uses; V2 does not
 *     duplicate the rule set.
 *   - V2 MUST NEVER promote a V1 never-auto-approve to ALLOW.
 *   - V2 MUST NEVER promote a V1 DENY to ASK/ALLOW.
 *   - V2 must NOT replace V1; V2 is layered AFTER V1's hard floor.
 *   - V2 MUST NOT consult a parser result that lacks a matching
 *     `sourceSha256` — that is treated as "untrusted input" and
 *     reduces to V1-only behavior.
 *
 * V2 FAILURE CONTRACT (matches ACT §18):
 *   - Parser unavailable / timeout / parse-failed: return
 *     `STRUCTURED_CONFIDENCE=OPAQUE` and let V1's verdict stand.
 *   - Unknown AST node type: same.
 *   - Never: parser failure → ALLOW.
 *
 * AGGREGATION LATTICE (ACT §10):
 *   - "sequence" / "and" / "or" / "pipe" / "subshell":
 *       risk = max(children)
 *   - "wrapper" (bash -c '...', sh -c '...'):
 *       bounded literal R5 scan of the inner string. NO recursive
 *       parser invocation. WRAPPER SAFE-PROMOTION = NOT IMPLEMENTED.
 *   - "command_substitution" or "opaque_construct":
 *       ASK minimum (do not auto-allow)
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - It does not run a shell parser (that's the helper binary).
 *   - It does not interpret shell semantics (no expansion, no eval).
 *   - It does not write to the filesystem.
 *   - It does not duplicate the V1 R5 hard floor — it calls
 *     `findCommandRiskHardFloor` from `command-risk.ts`.
 *   - It does not duplicate the V1 safe-rule matcher — it calls
 *     `findSafeRuleMatch` from `command-safe-rules.ts`.
 *   - It does not promote V1 ASK from non-shell-structure sources.
 */

import { createHash } from "node:crypto";
import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { StructuredCommandInput } from "../../extensions/tools/schemas";
import { renderNormalizedCommand } from "./command-model-hints";
import { findCommandRiskHardFloor } from "./command-risk";
import {
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	findSafeRuleMatch,
	isOpaqueShellRendered,
} from "./command-safe-rules";
import { isR0PathBearingRuleSource } from "./command-policy";

/* ---------------------------------------------------------------------- *
 * Narrow projection types (match the Go probe's JSON shape)              *
 * ---------------------------------------------------------------------- *
 *
 * This is an INTERNAL VERSIONED PROTOCOL between the parser helper and
 * this classifier. Do not export the full shape as a public API; treat
 * it as a private schema. Bumping the version requires a deliberate
 * protocol change with a parser-version pin.
 *
 * PROTOCOL VERSION 2 (CORRECTION01):
 *   Adds `sourceSha256` (hex-encoded SHA-256 of the EXACT joined
 *   normalized source string the parser was asked to parse).
 *   The classifier recomputes the digest from `toolInput` and
 *   requires equality before any promotion/strengthening based on
 *   structured analysis.
 *
 *   Protocol v1 (the original V2 protocol) did not bind parser
 *   output to source; v1 results are accepted only to produce a
 *   "skipped" verdict that preserves V1 behavior.
 */

/**
 * The wire protocol version. Bumped from 3 to 4 in
 * ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01 to add per-
 * redirect `fd` and `pathProvenance` provenance (additive fields; v3
 * callers ignore them). v2 callers continue to receive v3/v4 responses
 * and the classifier handles them with the same inject-unknown fallback
 * the v3 path already uses.
 */
export const STRUCTURED_PROTO_VERSION = 4 as const;

/**
 * The set of protocol versions a `ParsedShell` may carry at runtime.
 * v2 is a legacy-frozen oracle; v3 adds argProvenance; v4 adds redirect
 * fd/pathProvenance. The classifier accepts all three; the runtime
 * pre-processes v2 responses to inject "unknown" provenance so v3/v4
 * branches fail closed.
 */
export type SupportedProtocolVersion = 2 | 3 | 4;

/**
 * Per-command shell-kind label.
 * - "bash"   : Bash dialect (default for VSCode terminal on Linux).
 *              The mvdan/sh v3.12.0 helper has stable bash support.
 * - "posix"  : POSIX shell (for `sh -c`). Stable in mvdan/sh v3.12.0.
 * - "mksh"   : MirBSD Korn shell. Stable in mvdan/sh v3.12.0.
 * - "zsh"    : NOT supported by the pinned v3.12.0 helper (zsh
 *              parsing was introduced in mvdan/sh v3.13.0).
 *              V2 treats zsh as "no promotion": the classifier may
 *              still produce a conservative ASK verdict but may not
 *              promote ASK -> ALLOW.
 * - "unknown": dialect could not be determined. Same as zsh:
 *              conservative ASK only, no promotion.
 */
export type ShellDialect = "bash" | "posix" | "mksh" | "zsh" | "unknown";

/** Dialects that the pinned parser version can authoritatively parse. */
const PROMOTION_CAPABLE_DIALECTS: ReadonlySet<ShellDialect> = new Set([
	"bash",
	"posix",
	"mksh",
]);

/** Result of a single parse attempt. */
export interface ParsedShell {
	readonly protocolVersion: SupportedProtocolVersion;
	readonly dialect: ShellDialect;
	/**
	 * SHA-256 of the exact joined normalized source string the
	 * parser was asked to parse, hex-encoded. REQUIRED for protocol
	 * version 2. The classifier independently recomputes the digest
	 * from `toolInput` and refuses to base promotion/strengthening
	 * on parser evidence when this field is missing or mismatched.
	 */
	readonly sourceSha256: string;
	/** "complete" = parser accepted the input. "failed" = parser rejected. */
	readonly parseStatus: "complete" | "failed";
	/**
	 * Command-substitution ( $(...) or `...` ) was found ANYWHERE
	 * in the input. The classifier cannot statically resolve the
	 * inner command without symbolic execution, so any input with
	 * command substitution is treated as OPAQUE even if the outer
	 * structure parses cleanly.
	 */
	readonly hasCommandSubstitution: boolean;
	/** AST projection; null when parseStatus is "failed". */
	readonly program: StructuredProgram | null;
	/** Parser-reported errors (when parseStatus is "failed"). */
	readonly errors: ReadonlyArray<string>;
}

export interface StructuredProgram {
	readonly stmts: ReadonlyArray<StructuredStmt>;
}

export type StructuredStmt =
	| { readonly kind: "cmd"; readonly cmd: StructuredCmd }
	| {
			readonly kind: "and";
			readonly left: StructuredStmt;
			readonly rhs: StructuredStmt;
	  }
	| {
			readonly kind: "or";
			readonly left: StructuredStmt;
			readonly rhs: StructuredStmt;
	  }
	| {
			readonly kind: "pipe";
			readonly left: StructuredStmt;
			readonly rhs: StructuredStmt;
	  }
	| { readonly kind: "subshell"; readonly inner: StructuredStmt }
	| { readonly kind: "opaque" };

export interface StructuredCmd {
	readonly name: string;
	readonly args: ReadonlyArray<string>;
	/**
	 * Per-arg shell-staticness provenance from the Go helper's
	 * classification of the ORIGINAL mvdan/sh AST. Invariant:
	 * `argProvenance.length === args.length` whenever this field is
	 * present. ABSENT on protocol v2 responses; present on v3
	 * responses.
	 *
	 * The classifier NEVER derives provenance from the projected
	 * `args` strings. If this field is missing (e.g. an old v2 helper
	 * somehow appears), the classifier must fail closed: the parser-
	 * proven promotion branch does NOT activate.
	 */
	readonly argProvenance?: ReadonlyArray<"static" | "dynamic" | "unknown">;
	readonly assigns: ReadonlyArray<{
		readonly name: string;
		readonly value: string;
	}>;
	readonly redirects: ReadonlyArray<{
		readonly op: string;
		readonly path: string;
		/**
		 * Parser-proven explicit file descriptor for this redirect.
		 *
		 * `null` when the source omitted the fd prefix (e.g. `>foo`
		 * means stdout / implicit fd 1; `>>foo` likewise). For the
		 * forms `1>...`, `2>...`, `2>>...`, the helper emits the
		 * numeric fd parsed from the original AST.
		 *
		 * ABSENT on legacy v2/v3 helper responses. The classifier
		 * treats absent `fd` (or `pathProvenance: "unknown"`) as
		 * non-neutral: redirects missing either field carry their
		 * full conservative weight.
		 *
		 * ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01.
		 */
		readonly fd?: number | null;
		/**
		 * Parser-proven staticness of the redirect TARGET word.
		 * "static" iff the target is provably a fixed string of
		 * literal bytes from the ORIGINAL mvdan/sh AST. "dynamic"
		 * if the target contains shell expansion. "unknown" if the
		 * classifier could not establish a positive answer.
		 *
		 * ABSENT on legacy v2/v3 helper responses. Same fail-closed
		 * semantics as `fd`: absent / unknown -> non-neutral.
		 */
		readonly pathProvenance?: "static" | "dynamic" | "unknown";
	}>;
	readonly isWrapper: boolean;
	readonly wrapperOf: ShellDialect | "";
	readonly inner: string;
}

export type StructuredRisk =
	| "auto-approve-eligible"
	| "ask"
	| "never-auto-approve";

/**
 * Structured analysis verdict.
 *
 * `promoteToAllow` indicates that V2 has structural evidence that
 * every reachable branch is auto-approve eligible, so V2 may promote
 * V1's conservative ASK to ALLOW.
 *
 * `downgradeToNeverAutoApprove` indicates V2 has structural evidence
 * that an R5-shaped inner command exists, so V2 may strengthen the
 * disposition to `never-auto-approve` even when V1 said ASK.
 *
 * `pathBearingOperands` (CORRECTION03): the list of every reachable
 * R0 read-only path-bearing leaf in the structured program. Each
 * entry is `{ source, operands }` where `source` is the
 * `findSafeRuleMatch` source string for that leaf (e.g.
 * `"host_safe_ls"`) and `operands` is the list of path operands
 * extracted from the leaf's argv (skipping options and `--`).
 *
 * Why this is the binding key: when V2 sees a parser-proven leaf
 * inside a composition (e.g. `ls <path> | head -30`), the V1 R0
 * path-authority gate does NOT fire because V1 sees the pipe as
 * one opaque shape. The V2 promotion gate therefore must perform
 * the operand-by-operand evidence binding itself: every operand
 * here must have a matching entry in the host's
 * `pathAuthorityEvidence.operands` whose `operand` field equals
 * this operand verbatim AND whose `contained: true` AND whose
 * `resolvedRealPath !== null`. Any missing/mismatched/uncontained
 * operand fails closed (refuse promotion). This closes
 * HALT_PIPELINE_PATH_EVIDENCE_NOT_BOUND_TO_OPERAND: the
 * pre-CORRECTION03 gate fired on mere presence of any evidence
 * object; CORRECTION03 fires on per-operand identity + canonical
 * containment. CORRECTION02 introduced the walker; CORRECTION03
 * turns the walker's output into the binding key.
 *
 * Empty when no R0 path-bearing leaf exists in the program.
 */
export interface StructuredAnalysis {
	readonly parseConfidence: "complete" | "partial" | "failed" | "skipped";
	readonly perStatement: ReadonlyArray<StructuredStmtRisk>;
	readonly aggregate: StructuredRisk;
	readonly promoteToAllow: boolean;
	readonly downgradeToNeverAutoApprove: boolean;
	readonly pathBearingOperands: ReadonlyArray<{
		readonly source: string;
		readonly operands: ReadonlyArray<string>;
	}>;
	readonly reasons: ReadonlyArray<string>;
}

export interface StructuredStmtRisk {
	readonly statementIndex: number;
	readonly kind: StructuredStmt["kind"];
	readonly risk: StructuredRisk;
	readonly source: string;
}

/* ---------------------------------------------------------------------- *
 * Source binding (CORRECTION01)                                            *
 * ---------------------------------------------------------------------- */

/**
 * Compute the SHA-256 hex digest of a UTF-8 string. Used to bind the
 * parser result to the exact normalized command source.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01: this is the
 * ONLY mechanism by which a `ParsedShell.sourceSha256` is matched
 * against `toolInput`. The computation is exposed so test fixtures
 * can fabricate matching `ParsedShell` values.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
 * Replaced the previous `globalThis.require("crypto")` fallback with
 * the canonical `@cline/core` cross-runtime hash primitive
 * (`node:crypto` ESM import). This is the same pattern used by every
 * other SHA-256 / HMAC consumer in the SDK (see
 * `extensions/config/runtime-commands.ts`,
 * `extensions/mcp/oauth.ts`, `services/plugin-install.ts`,
 * `hub/discovery/index.ts`, `logging/early-logger.ts`,
 * `cron/store/sqlite-cron-store.ts`, etc.). The previous fallback
 * relied on `globalThis.require` being a function, which is not
 * guaranteed in the bundled VS Code extension host (pure ESM, no
 * CommonJS require on globalThis) — meaning V2 promotion would have
 * thrown at runtime in production the moment a parser result was
 * supplied. The new implementation works under:
 *   - Bun (via node:crypto builtin)
 *   - Node.js (via node:crypto builtin)
 *   - Bundled VS Code extension host (Node runtime, ESM)
 *   - Bundled CLI (Bun-built ESM, runs on Node)
 */
export function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

/**
 * Reasons explicitly allowed by V2 for promotion. Any V1 ASK from a
 * reason OUTSIDE this set MUST NOT be promoted by V2.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01: V2 only
 * overrides V1 ASK caused by shell-structure opacity. The admissible
 * reasons are:
 *   - `host_mode_safe_only_fallthrough` — V1's safe-only mode did
 *     not match a positive rule, but only because the command is
 *     compound (multi-cmd / pipes / and-or). V2 may promote when
 *     the AST shows every reachable branch IS safe.
 *   - `risk_opaque_composition` — V1's belt-and-braces guard forced
 *     ASK on an opaque rendering. V2 may promote when the AST shows
 *     the underlying branches are safe.
 *
 * V2 MUST NOT override ASK from:
 *   - `risk_unknown_input`
 *   - `risk_parse_failed`
 *   - `risk_hard_floor`
 *   - `host_mode_manual` (mode === "ask" yields ASK by design; V2
 *      cannot override a user-asked mode)
 *   - any explicit-deny / model-escalation source
 *
 * Adding new entries here MUST be tied to a corpus case + review.
 */
const STRUCTURE_ONLY_PROMOTABLE_REASONS: ReadonlySet<string> = new Set([
	"host_mode_safe_only_fallthrough",
	"risk_opaque_composition",
]);

/**
 * Determine whether a V1 ASK may be overridden by V2 structured
 * promotion. The single admissibility criterion is that the ASK
 * reason is in `STRUCTURE_ONLY_PROMOTABLE_REASONS`. Even if V1 said
 * ASK for any other reason, V2 cannot promote.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01: this is
 * the load-bearing authority gate. The caller in `command-risk.ts`
 * passes the V1 verdict's `source` (or, when V1 yields ASK from a
 * compound verdict, the most-specific ASK reason in
 * `RiskDecision.reasons`).
 */
export function isStructureOnlyPromotableAsk(
	reason: string | undefined,
): boolean {
	if (reason === undefined) {
		return false;
	}
	return STRUCTURE_ONLY_PROMOTABLE_REASONS.has(reason);
}

/**
 * Sensitive redirect targets that must NEVER receive a write-like
 * redirect without explicit user review. Used by `classifyRedirect`
 * to escalate ASK → never-auto-approve.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01: this is a
 * WRITE-POLICY list, distinct from V1's R5 hard floor (which is a
 * literal-substring rule set on the rendered surface). The two are
 * NOT redundant: V1 catches `cat ~/.ssh/id_rsa`; V2's redirect
 * analyzer catches `pwd > ~/.ssh/authorized_keys` that V1 cannot
 * see because it does not reason about AST.
 */
const SENSITIVE_WRITE_TARGETS: ReadonlyArray<{
	readonly pattern: RegExp;
	readonly family: string;
}> = [
	// SSH material: any write into the .ssh directory is treated as
	// a key-overwrite attempt.
	{ family: "redirect-sensitive-write-ssh", pattern: /^~\/\.ssh\//u },
	{ family: "redirect-sensitive-write-ssh", pattern: /^\/?\.ssh\//u },
	// AWS / GCloud / kube / docker / netrc credentials and config
	{ family: "redirect-sensitive-write-credentials", pattern: /^~\/\.aws\//u },
	{
		family: "redirect-sensitive-write-credentials",
		pattern: /^~\/\.gcloud\//u,
	},
	{ family: "redirect-sensitive-write-credentials", pattern: /^~\/\.kube\//u },
	{
		family: "redirect-sensitive-write-credentials",
		pattern: /^~\/\.docker\//u,
	},
	{ family: "redirect-sensitive-write-credentials", pattern: /^~\/\.netrc$/u },
	{ family: "redirect-sensitive-write-credentials", pattern: /^\/?\.aws\//u },
	{ family: "redirect-sensitive-write-credentials", pattern: /^\/?\.kube\//u },
	// System-file writes
	{ family: "redirect-sensitive-write-system", pattern: /^\/etc\//u },
	{ family: "redirect-sensitive-write-system", pattern: /^\/boot\//u },
	{ family: "redirect-sensitive-write-system", pattern: /^\/var\//u },
];

/**
 * Authority-neutral stderr-discard predicate.
 *
 * ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01.
 *
 * Returns true iff the redirect is parser-proven to be:
 *
 *   - explicit file descriptor 2 (`2>...`)
 *   - truncate-write operator (`>`, not `>>`, not `>&`)
 *   - target is the literal bytes "/dev/null"
 *   - target provenance is "static" (parser-proven no expansion)
 *
 * When all four hold the redirect contributes ZERO authority. The
 * command's risk classification is identical to a sibling without the
 * redirect: `rm -rf "$HOME" 2>/dev/null` is R5-mutating; `ls -la 2>/dev/null`
 * is safe-read; `git status 2>/dev/null` is safe-read.
 *
 * FAIL-CLOSED contract (any one disqualifies -> not neutral):
 *
 *   - `fd` absent (legacy v2/v3 helper response) -> not neutral
 *   - `fd !== 2` -> not neutral (stdout, fd=1, fd=0, anything else)
 *   - `op !== ">"` -> not neutral (append, dup, here-string)
 *   - `path !== "/dev/null"` -> not neutral
 *   - `pathProvenance` absent -> not neutral
 *   - `pathProvenance !== "static"` -> not neutral
 *   - `pathProvenance === "dynamic"` -> not neutral (must be parser-proven static)
 *   - `pathProvenance === "unknown"` -> not neutral
 *
 * The narrow 2>/dev/null contract is the ONLY shape this predicate
 * blesses. `>/dev/null`, `1>/dev/null`, `2>>/dev/null`, `2>errors.txt`,
 * `2>"$NULL_PATH"`, `2>&1`, `&>/dev/null`, `>&/dev/null` are all NOT
 * neutral.
 */
export function isAuthorityNeutralStderrDiscard(redirect: {
	readonly op: string;
	readonly path: string;
	readonly fd?: number | null;
	readonly pathProvenance?: "static" | "dynamic" | "unknown";
}): boolean {
	if (redirect.fd !== 2) return false;
	if (redirect.op !== ">") return false;
	if (redirect.path !== "/dev/null") return false;
	if (redirect.pathProvenance !== "static") return false;
	return true;
}

/**
 * Classify a single AST redirect. Returns null when the redirect is
 * safe to ignore, or `{ family }` when V2 must escalate.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01:
 *   - READ redirects (`<`, `<<`) are ignored.
 *   - WRITE redirects (`>`, `>>`, `>|`, etc.) to a sensitive target
 *     escalate to never-auto-approve.
 *   - WRITE redirects to a NON-sensitive target stay at ASK minimum.
 *     We do not yet have a bounded write-target allowlist, so we
 *     cannot promote.
 *   - Unknown operators fall back to ASK minimum (conservative).
 *
 * ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01: callers MUST
 * filter out authority-neutral stderr-discard redirects via
 * `isAuthorityNeutralStderrDiscard` BEFORE invoking this function. The
 * classifier does not check neutrality itself -- partitioning is the
 * caller's responsibility so the policy is local to the call site.
 */
export function classifyRedirect(redirect: {
	readonly op: string;
	readonly path: string;
	readonly fd?: number | null;
	readonly pathProvenance?: "static" | "dynamic" | "unknown";
}): { readonly family: string } | null {
	const op = redirect.op.trim();
	if (op === "<" || op === "<<") {
		return null;
	}
	const isWrite = op.includes(">");
	if (!isWrite) {
		// Process substitution <( ), >( ), or anything else:
		// opaque to V2. Conservative ASK minimum.
		return { family: "redirect-opaque-op" };
	}
	const path = redirect.path;
	for (const target of SENSITIVE_WRITE_TARGETS) {
		if (target.pattern.test(path)) {
			return { family: target.family };
		}
	}
	// Non-sensitive write redirect: still ASK minimum. The
	// previously-buggy V2 promoted this; the corrected V2 does not.
	return { family: "redirect-non-sensitive-write" };
}

/**
 * Verify the parser result is bound to the exact normalized source.
 * Returns null on success (the digest matched) or a reason string on
 * failure (which becomes the V2 verdict reason).
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01: this is the
 * load-bearing binding gate. Without it, an attacker can supply a
 * benign AST for a dangerous toolInput and V2 would promote the
 * dangerous input to ALLOW.
 */
function verifySourceBinding(
	toolInput: unknown,
	parserResult: ParsedShell,
): string | null {
	const expected = sha256Hex(joinRunCommandsForParse(toolInput).joined);
	if (parserResult.sourceSha256 !== expected) {
		return `source digest mismatch (expected ${expected}, got ${parserResult.sourceSha256})`;
	}
	return null;
}

/* ---------------------------------------------------------------------- *
 * Public entry point                                                      *
 * ---------------------------------------------------------------------- */

/**
 * Perform structural analysis of a run_commands input given a parser
 * result. The classifier is PURE: it does not run a parser and does
 * not read the filesystem. Production callers (CLI / VSCode host
 * adapters) MUST call this from inside `evaluateCommandRisk` after
 * V1's hard floor has run.
 *
 * CORRECTION01: when `parserResult.sourceSha256` does not match
 * the SHA-256 of `joinRunCommandsForParse(toolInput).joined`, V2
 * returns a "binding failed" verdict that does NOT promote or
 * strengthen. The caller falls back to V1.
 *
 * When `parserResult` is `null` (parser unavailable / failed /
 * unsupported protocol / unknown dialect / unsupported dialect),
 * the function returns a "skipped" verdict that preserves V1's
 * behavior unchanged.
 */
export function evaluateStructuredCommandRisk(args: {
	readonly toolInput: unknown;
	readonly parserResult: ParsedShell | null;
}): StructuredAnalysis {
	const { toolInput, parserResult } = args;

	// 1. No parser: V2 is a no-op. Preserve V1 behavior.
	if (parserResult === null) {
		return {
			parseConfidence: "skipped",
			perStatement: [],
			aggregate: "ask",
			promoteToAllow: false,
			downgradeToNeverAutoApprove: false,
			pathBearingOperands: [],
			reasons: ["structured analysis skipped (no parser result provided)"],
		};
	}

	// 2. Protocol version gate. Accepts BOTH v2 (legacy) and v3
	//    (current). v3 is required for the parser-proven positive
	//    provenance branch (`host_safe_echo_parser_proven`); v2
	//    falls through to the existing structure-caused-ASK path
	//    (because the runtime injects argProvenance=["unknown"]* for
	//    v2 responses, fail-closed). Future versions (>=4) skip
	//    entirely.
	if (parserResult.protocolVersion !== STRUCTURED_PROTO_VERSION && parserResult.protocolVersion !== 2) {
		return {
			parseConfidence: "skipped",
			perStatement: [],
			aggregate: "ask",
			promoteToAllow: false,
			downgradeToNeverAutoApprove: false,
			pathBearingOperands: [],
			reasons: [
				`structured analysis skipped (protocol version ${parserResult.protocolVersion} != ${STRUCTURED_PROTO_VERSION} and != 2)`,
			],
		};
	}

	// 3. Parse failure: V2 is a no-op. Preserve V1 behavior.
	if (
		parserResult.parseStatus !== "complete" ||
		parserResult.program === null
	) {
		return {
			parseConfidence: "failed",
			perStatement: [],
			aggregate: "ask",
			promoteToAllow: false,
			downgradeToNeverAutoApprove: false,
			pathBearingOperands: [],
			reasons: [
				"structured analysis skipped (parser reported parse failure)",
				...parserResult.errors,
			],
		};
	}

	// 4. Source binding. CORRECTION01 P0 #2 — refuse to consume a
	//    parser result that does not prove it parsed the exact
	//    command we're classifying.
	const bindingFailure = verifySourceBinding(toolInput, parserResult);
	if (bindingFailure !== null) {
		return {
			parseConfidence: "skipped",
			perStatement: [],
			aggregate: "ask",
			promoteToAllow: false,
			downgradeToNeverAutoApprove: false,
			pathBearingOperands: [],
			reasons: [`structured analysis skipped (${bindingFailure})`],
		};
	}

	// 5. Command substitution present anywhere: V2 cannot statically
	//    resolve the inner command. Stay conservative (ASK minimum).
	if (parserResult.hasCommandSubstitution) {
		return {
			parseConfidence: "partial",
			perStatement: [],
			aggregate: "ask",
			promoteToAllow: false,
			downgradeToNeverAutoApprove: false,
			pathBearingOperands: [],
			reasons: ["structured analysis opaque (command substitution present)"],
		};
	}

	// 6. Dialect gate. CORRECTION01: only bash/posix/mksh are
	//    promotion-capable. zsh and unknown dialects may still
	//    produce a conservative ASK verdict but must not authorize
	//    promotion. The aggregate analysis still runs so we can
	//    surface ASK reasons and detect R5 inner commands, but the
	//    caller must zero `promoteToAllow` regardless.
	const dialectCapable = PROMOTION_CAPABLE_DIALECTS.has(parserResult.dialect);

	// 7. Per-statement classification with structural max-aggregation.
	const perStmt = parserResult.program.stmts.map((stmt, idx) =>
		classifyStmt(stmt, idx, parserResult.dialect, parserResult.protocolVersion),
	);

	const aggregate = maxRisk(perStmt.map((s) => s.risk));

	// CORRECTION03: walk the structured program AST and collect
	// every reachable R0 read-only path-bearing leaf's source +
	// extracted path operands. The result is the binding key the
	// V2 promotion gate in `command-risk.ts` uses to validate the
	// host's `pathAuthorityEvidence` operand-by-operand against
	// the structured-program operands (not merely against an
	// evidence object presence check, which CORRECTION02 left as
	// the residual HALT_PIPELINE_PATH_EVIDENCE_NOT_BOUND_TO_OPERAND).
	const pathBearingOperands = collectPathBearingOperands(
		parserResult.program,
		parserResult.dialect,
		parserResult.protocolVersion,
	);

	// 8. Compute promotion / strengthening signals. Promotion is
	//    restricted by `dialectCapable` AND by the aggregate being
	//    auto-approve-eligible. The caller in `command-risk.ts`
	//    adds the ASK-source admissibility check
	//    (`isStructureOnlyPromotableAsk`) AND, when
	//    `pathBearingOperands` is non-empty, requires
	//    `hostAuthorization.pathAuthorityEvidence` whose entries
	//    bind to these operands verbatim AND whose containment +
	//    resolution status authorize each operand (CORRECTION03).
	const promote = dialectCapable && aggregate === "auto-approve-eligible";
	const downgrade = aggregate === "never-auto-approve";

	const reasons: string[] = [];
	if (!dialectCapable) {
		reasons.push(
			`structured analysis dialect ${parserResult.dialect} not promotion-capable`,
		);
	}
	if (pathBearingOperands.length > 0) {
		const leafCount = pathBearingOperands.length;
		const operandCount = pathBearingOperands.reduce(
			(acc, e) => acc + e.operands.length,
			0,
		);
		reasons.push(
			`structured analysis extracted ${operandCount} R0 path-bearing operand(s) across ${leafCount} leaf(s) (CORRECTION03 operand-binding gate required for promotion)`,
		);
	}
	reasons.push(...summarizeReasons(perStmt, aggregate));

	return {
		parseConfidence: "complete",
		perStatement: perStmt,
		aggregate,
		promoteToAllow: promote,
		downgradeToNeverAutoApprove: downgrade,
		pathBearingOperands,
		reasons,
	};
}

/* ---------------------------------------------------------------------- *
 * Per-statement classification                                             *
 * ---------------------------------------------------------------------- */

function classifyStmt(
	stmt: StructuredStmt,
	index: number,
	dialect: ShellDialect,
	protocolVersion: number,
): StructuredStmtRisk {
	switch (stmt.kind) {
		case "and":
		case "or":
		case "pipe": {
			const left = classifyStmt(stmt.left, index, dialect, protocolVersion);
			const right = classifyStmt(stmt.rhs, index, dialect, protocolVersion);
			return {
				statementIndex: index,
				kind: stmt.kind,
				risk: maxRisk([left.risk, right.risk]),
				source: `aggregated-${stmt.kind}`,
			};
		}
		case "subshell": {
			const inner = classifyStmt(stmt.inner, index, dialect, protocolVersion);
			return {
				statementIndex: index,
				kind: "subshell",
				risk: inner.risk,
				source: `subshell:${inner.source}`,
			};
		}
		case "opaque": {
			return {
				statementIndex: index,
				kind: "opaque",
				risk: "ask",
				source: "opaque-construct",
			};
		}
		case "cmd": {
			return classifyCmd(stmt.cmd, index, dialect, protocolVersion);
		}
	}
}

/**
 * ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01:
 * Per-command argv-shape validator for the stdin-only reader
 * extension of the V2 parser-proven allowlist.
 *
 * Returns true iff:
 *   - cmd.name is in the stdin-only allowlist (currently `head`
 *     and `tail`),
 *   - every arg is in the reviewed option set,
 *   - the command has zero path operands (i.e. reads from
 *     stdin), and
 *   - the inner per-command validator approves the argv shape.
 *
 * Returns false otherwise (fail-closed).
 *
 * The fail-closed invariants for the OUTER dispatch (protocol
 * version, redirect absence, argProvenance) are enforced by the
 * caller (`classifyCmd`); this function only validates per-command
 * grammar.
 *
 * Architectural note (per reviewer P0): static shell syntax is
 * NOT filesystem authority. Path-bearing readers (`head FILE`,
 * `cat FILE`, `tail FILE`, `sort FILE`, `uniq FILE`, `wc FILE`)
 * are NOT promoted here; they require canonical R0 path-authority
 * integration (separate ACT). This validator strictly enforces
 * zero path operands, so any `head some-file` form is rejected
 * here.
 */
function isParserProvenStdinOnlyReader(cmd: StructuredCmd): boolean {
	if (cmd.name === "head") {
		return isParserProvenStdinOnlyHead(cmd.args);
	}
	if (cmd.name === "tail") {
		return isParserProvenStdinOnlyTail(cmd.args);
	}
	return false;
}

/**
 * `head` stdin-only argv validator.
 *
 * Reviewed forms (ALL parser-proven `static` by caller's gate):
 *   - `head`              (no args, stdin only)
 *   - `head -<N>`         (N is a non-negative integer; e.g. `head -30`)
 *   - `head -n <N>`       (e.g. `head -n 30`)
 *   - `head --`           (stdin only, explicit end-of-options)
 *   - `head -- <...>`     (NOT reviewed; we reject any args after `--`)
 *   - `head -n <N> --`    (stdin only, explicit end-of-options with count)
 *
 * Explicitly REJECTED (conservation):
 *   - `head -c <N>`       reads BYTES (binary content); not in
 *                         stdin-only profile
 *   - `head -v`, `-q`     verbose/quiet flags; not reviewed
 *   - `head --help`, `--version`
 *                         not reviewed
 *   - `head FILE`         path-bearing; requires canonical
 *                         R0 path-authority (separate ACT)
 *   - any unknown option
 *
 * Any non-option arg before `--` is a path operand; we reject
 * unconditionally so the validator stays simple and the policy
 * is local.
 */
function isParserProvenStdinOnlyHead(args: ReadonlyArray<string>): boolean {
	let i = 0;
	while (i < args.length) {
		const a = args[i]!;
		if (a === "--") {
			// End-of-options: any remaining args would be path
			// operands, which we reject.
			if (i + 1 < args.length) return false;
			return true;
		}
		if (a === "-c") {
			// -c reads BYTES; explicitly out of stdin-only profile.
			return false;
		}
		if (a === "-n") {
			// -n <N>: consume the value.
			if (i + 1 >= args.length) return false;
			const v = args[i + 1]!;
			if (!/^\d+$/.test(v)) return false;
			i += 2;
			continue;
		}
		if (a.startsWith("-")) {
			// Single short option of the form `-<digits>` (e.g. `-30`).
			if (/^-\d+$/.test(a)) {
				i++;
				continue;
			}
			// Any other short or long option (including -v, -q,
			// --help, --version, -c with arg baked in like
			// `-c100` not reviewed) is rejected.
			return false;
		}
		// Bare arg before `--` is a path operand -- reject.
		return false;
	}
	return true;
}

/**
 * `tail` stdin-only argv validator.
 *
 * Mirrors `head`'s contract: stdin-only, no path operands,
 * reviewed options only.
 *
 * Reviewed forms:
 *   - `tail`, `tail -<N>`, `tail -n <N>`, `tail --`,
 *     `tail -n <N> --`
 *
 * Explicitly REJECTED (conservation):
 *   - `tail -c <N>`       byte-counted read; out of profile
 *   - `tail -f`, `-F`     follow mode (interactive; out of profile)
 *   - `tail FILE`         path-bearing; separate ACT
 *   - any unknown option
 */
function isParserProvenStdinOnlyTail(args: ReadonlyArray<string>): boolean {
	let i = 0;
	while (i < args.length) {
		const a = args[i]!;
		if (a === "--") {
			if (i + 1 < args.length) return false;
			return true;
		}
		if (a === "-c") return false;
		if (a === "-f" || a === "-F") return false;
		if (a === "-n") {
			if (i + 1 >= args.length) return false;
			const v = args[i + 1]!;
			if (!/^\d+$/.test(v)) return false;
			i += 2;
			continue;
		}
		if (a.startsWith("-")) {
			if (/^-\d+$/.test(a)) {
				i++;
				continue;
			}
			return false;
		}
		return false;
	}
	return true;
}

/**
 * ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01:
 * The set of V2 source labels that carry parser-proven positive
 * provenance. When at least one perStatement has a source label
 * in this set, the V1 -> V2 promotion gate in
 * `command-risk.ts` may consider promoting a V1 ASK to ALLOW.
 *
 * This set is the SINGLE source of truth for which source labels
 * participate in the parser-proven promotion contract. Adding a
 * new parser-proven family MUST add its source label here AND
 * update the promotion gate to recognize it (the gate imports
 * this constant via `isParserProvenSource`).
 *
 * Architectural note: the V2 promotion gate is intentionally
 * conservative -- it requires EVERY perStatement to be parser-
 * proven safe (via `promoteToAllow`), but the gate's secondary
 * check that the V2 output is source-bound to `toolInput` is
 * enforced upstream by the V2 evaluator itself.
 */
export const PARSER_PROVEN_SOURCE_LABELS: ReadonlySet<string> = new Set([
	// Existing echo parser-proven branch
	// (ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01).
	"host_safe_echo_parser_proven",
	// stdin-only reader extensions
	// (ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01).
	"host_safe_head_parser_proven_stdin_only",
	"host_safe_tail_parser_proven_stdin_only",
]);

/**
 * Returns true iff the source label is parser-proven positive
 * provenance. See {@link PARSER_PROVEN_SOURCE_LABELS}.
 */
export function isParserProvenSource(source: string): boolean {
	return PARSER_PROVEN_SOURCE_LABELS.has(source);
}

function classifyCmd(
	cmd: StructuredCmd,
	index: number,
	_dialect: ShellDialect,
	protocolVersion: number,
): StructuredStmtRisk {
	// CORRECTION01 STEP 7: redirects participate in risk. Walk
	// every redirect FIRST; a sensitive write redirect escalates to
	// never-auto-approve even if the command itself would be safe.
	//
	// ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01: a
	// parser-proven authority-neutral stderr-discard (explicit `2>`
	// + `>` + literal `/dev/null` + parser-proven static target)
	// contributes ZERO authority. We skip those redirects entirely;
	// the base command's risk is unchanged.
	for (const redirect of cmd.redirects) {
		if (isAuthorityNeutralStderrDiscard(redirect)) {
			continue;
		}
		const r = classifyRedirect(redirect);
		if (r !== null) {
			// Sensitive-write / opaque-op cases take precedence.
			if (
				r.family === "redirect-sensitive-write-ssh" ||
				r.family === "redirect-sensitive-write-credentials" ||
				r.family === "redirect-sensitive-write-system"
			) {
				return {
					statementIndex: index,
					kind: "cmd",
					risk: "never-auto-approve",
					source: `risk:v2:${r.family}`,
				};
			}
			// Non-sensitive write or opaque-op: ASK minimum. The
			// previously-buggy V2 promoted this branch; the
			// corrected V2 stops at ASK until a bounded
			// non-sensitive write allowlist is reviewed.
			return {
				statementIndex: index,
				kind: "cmd",
				risk: "ask",
				source: `risk:v2:${r.family}`,
			};
		}
	}

	// Wrappers (bash -c '...', sh -c '...', mksh -c '...', zsh -c '...').
	// CORRECTION01: NO recursive parser invocation. The inner script
	// is bounded-literal-scanned via the canonical V1 hard-floor
	// matcher; safe wrapper promotion is NOT IMPLEMENTED.
	if (cmd.isWrapper) {
		const inner = cmd.inner;
		const innerFloor = findCommandRiskHardFloor(inner);
		if (innerFloor !== null) {
			return {
				statementIndex: index,
				kind: "cmd",
				risk: innerFloor.hard ? "never-auto-approve" : "ask",
				source: `wrapper:${cmd.name}:inner-${innerFloor.family}`,
			};
		}
		return {
			statementIndex: index,
			kind: "cmd",
			risk: "ask",
			source: `wrapper:${cmd.name}:inner-not-classified`,
		};
	}

	if (cmd.name === "cd") {
		return {
			statementIndex: index,
			kind: "cmd",
			risk: "ask",
			source: "cd-not-auto-approve-eligible",
		};
	}

	if (cmd.name === "eval") {
		return {
			statementIndex: index,
			kind: "cmd",
			risk: "ask",
			source: "eval-opaque",
		};
	}

	// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01.
	//
	// Parser-proven positive provenance branch. Activates ONLY when
	// the parser helper speaks protocol v3 or newer (i.e. the
	// authoritative `argProvenance` array is present). When that
	// gate is open:
	//
	//   cmd.name === "echo"
	//   AND no redirects
	//   AND every argProvenance === "static"
	//     -> auto-approve-eligible
	//
	// Fail-closed requirements (any one disqualifies):
	//   - protocolVersion < 3 (v2 or older)
	//   - argProvenance is missing (defensive; the validator also
	//     rejects missing-argProvenance on v3 responses, but the
	//     classifier must not crash if it sees a future variant)
	//   - argProvenance has length mismatch with args (defensive;
	//     validator already rejects this on v3)
	//   - any argProvenance entry is "dynamic" or "unknown"
	//   - any redirect present
	//
	// Source label: `host_safe_echo_parser_proven`. Reviewer
	// explicitly named this label so the V2 trace distinguishes
	// it from the (removed) `host_safe_echo_parsed_argv` label
	// and from V1's `host_safe_echo` regex label.
	//
	// Scope guard: this branch does NOT fold quoted-`find` work;
	// it does NOT change expansion authority; it does NOT touch
	// any other V2 source label. V1's `host_safe_echo` regex
	// still matches the simple `echo ---BRANCH---` forms via
	// the canonical `findSafeRuleMatch` below.
	// Fail-closed under v2: the runtime injects ["unknown"]* for v2
	// responses (see parser-helper/runtime.ts `injectUnknownProvenance`),
	// so `every(p => p === "static")` is false under v2 and the branch
	// never activates. The `protocolVersion >= 3` check is an
	// additional belt for direct callers of `classifyCmd` that bypass
	// the runtime's injection.
	//
	// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01:
	// the parser-proven promotion branch is generalized from
	// echo-only to a per-command dispatch. Each new leaf family
	// carries its own argv-shape validator and source label.
	//
	// ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01: the
	// protocol version check remains `>= 3` so the same promotion
	// contract applies to v4 helper responses (which additively
	// carry redirect fd/pathProvenance). All branches continue to
	// require zero redirects (`cmd.redirects.length === 0`); a
	// neutral 2>/dev/null on a parser-proven command therefore
	// routes through V1's host_safe_* regex, not this branch --
	// intentional.
	//
	// Architecture (per reviewer correction):
	//   - Static shell syntax != filesystem authority. Path-bearing
	//     readers (`head FILE`, `cat FILE`, ...) are NOT promoted
	//     here; they require canonical R0 path-authority
	//     integration (separate ACT).
	//   - Only stdin-only readers (zero path operands) qualify.
	//   - Each command has a per-command argv-shape validator.
	//   - Fail-closed invariants are uniform across all branches.
	if (
		protocolVersion >= 3 &&
		cmd.redirects.length === 0 &&
		cmd.argProvenance !== undefined &&
		cmd.argProvenance.length === cmd.args.length &&
		cmd.argProvenance.every((p) => p === "static")
	) {
		// Existing echo branch -- unchanged.
		if (cmd.name === "echo") {
			return {
				statementIndex: index,
				kind: "cmd",
				risk: "auto-approve-eligible",
				source: "host_safe_echo_parser_proven",
			};
		}
		// stdin-only reader extensions -- new in
		// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01.
		if (isParserProvenStdinOnlyReader(cmd)) {
			return {
				statementIndex: index,
				kind: "cmd",
				risk: "auto-approve-eligible",
				source: `host_safe_${cmd.name}_parser_proven_stdin_only`,
			};
		}
	}

	const rendered = renderArgv(cmd);
	if (rendered === "") {
		return {
			statementIndex: index,
			kind: "cmd",
			risk: "ask",
			source: "empty",
		};
	}
	if (isOpaqueShellRendered(rendered)) {
		return {
			statementIndex: index,
			kind: "cmd",
			risk: "ask",
			source: "rendered-opaque",
		};
	}

	// CORRECTION01 STEP 9: delegate to canonical V1 hard-floor
	// matcher (not a duplicated regex array).
	const floorMatch = findCommandRiskHardFloor(rendered);
	if (floorMatch) {
		return {
			statementIndex: index,
			kind: "cmd",
			risk: floorMatch.hard ? "never-auto-approve" : "ask",
			source: `risk:hard-floor:${floorMatch.family}`,
		};
	}

	// CORRECTION01 STEP 9: delegate to canonical V1 safe-rule
	// matcher (not a duplicated regex array). `findSafeRuleMatch`
	// returns `{ source }` for any explicit positive match, or
	// `undefined` when no rule matches.
	const safeMatch = findSafeRuleMatch(
		{ command: cmd.name, args: Array.from(cmd.args) },
		DEFAULT_COMMAND_HOST_ALLOW_RULES,
	);
	if (safeMatch !== undefined) {
		return {
			statementIndex: index,
			kind: "cmd",
			risk: "auto-approve-eligible",
			source: safeMatch.source,
		};
	}
	return {
		statementIndex: index,
		kind: "cmd",
		risk: "ask",
		source: "no-rule-match",
	};
}

function renderArgv(cmd: StructuredCmd): string {
	if (cmd.name === "") return "";
	if (cmd.args.length === 0) return cmd.name;
	return `${cmd.name} ${cmd.args.join(" ")}`;
}

/**
 * CORRECTION03: walk the structured program AST and collect every
 * reachable R0 read-only path-bearing leaf's source + extracted
 * path operands. The list is the binding key the V2 promotion
 * gate in `command-risk.ts` uses to validate the host's
 * `pathAuthorityEvidence` operand-by-operand.
 *
 * Why a list and not a boolean:
 *   CORRECTION02 used a `containsPathBearingLeaf: boolean` flag,
 *   which caused the V2 gate to fire on mere *presence* of any
 *   evidence object. That left a residual
 *   HALT_PIPELINE_PATH_EVIDENCE_NOT_BOUND_TO_OPERAND bypass:
 *   `ls /etc/passwd | head -30` plus an unrelated valid evidence
 *   record satisfied the presence test and unlocked promotion.
 *   CORRECTION03 replaces the boolean with the per-leaf operand
 *   list. The V2 gate now refuses promotion when ANY operand in
 *   this list is missing a matching `evidence.operands[i]` entry
 *   whose `operand` field equals the operand verbatim AND whose
 *   `contained: true` AND whose `resolvedRealPath !== null`.
 *
 * Path operand extraction follows the same shape-of-input
 * contract as V1's `extractPathOperands(NormalizedCommand)`
 * (skip options, skip `--`); we re-derive it here so the V2
 * walker operates on the structured-cmd shape without forcing
 * the structured walker to fabricate a `NormalizedCommand`.
 */
function collectPathBearingOperands(
	program: StructuredProgram,
	dialect: ShellDialect,
	protocolVersion: number,
): ReadonlyArray<{ source: string; operands: ReadonlyArray<string> }> {
	const out: Array<{ source: string; operands: ReadonlyArray<string> }> = [];
	for (const stmt of program.stmts) {
		collectFromStmt(stmt, dialect, protocolVersion, out);
	}
	return out;
}

function collectFromStmt(
	stmt: StructuredStmt,
	dialect: ShellDialect,
	protocolVersion: number,
	out: Array<{ source: string; operands: ReadonlyArray<string> }>,
): void {
	switch (stmt.kind) {
		case "cmd": {
			// Classify the leaf via the per-cmd dispatcher and only
			// record it when the leaf's source is in the R0
			// path-bearing set. We do NOT inspect the rendered argv;
			// the source string is the canonical positive match from
			// V1's `findSafeRuleMatch`.
			const leaf = classifyCmd(stmt.cmd, 0, dialect, protocolVersion);
			if (isR0PathBearingRuleSource(leaf.source)) {
				const operands = extractPathOperandsFromStructured(stmt.cmd);
				out.push({ source: leaf.source, operands });
			}
			return;
		}
		case "and":
		case "or":
		case "pipe":
			collectFromStmt(stmt.left, dialect, protocolVersion, out);
			collectFromStmt(stmt.rhs, dialect, protocolVersion, out);
			return;
		case "subshell":
			collectFromStmt(stmt.inner, dialect, protocolVersion, out);
			return;
		case "opaque":
			return;
		default:
			return;
	}
}

/**
 * Extract path operands from a structured cmd argv. Mirrors V1's
 * `extractPathOperands(NormalizedCommand)` shape contract: skip
 * any token beginning with `-` (option) or equal to `--`
 * (option terminator); the remainder are path-position
 * candidates. Used by the CORRECTION03 walker to build the
 * binding key the V2 promotion gate validates against
 * `pathAuthorityEvidence.operands[]`.
 *
 * IMPORTANT: this is the SHAPE contract, not the lexical
 * containment contract. The host already supplied a
 * canonicalized `resolvedRealPath` for each operand in the
 * evidence; we only need to enumerate the operand positions
 * here. Containment + resolution are V1's job.
 */
function extractPathOperandsFromStructured(cmd: StructuredCmd): ReadonlyArray<string> {
	const out: string[] = [];
	let sawDoubleDash = false;
	for (const a of cmd.args) {
		if (sawDoubleDash) {
			out.push(a);
			continue;
		}
		if (a === "--") {
			sawDoubleDash = true;
			continue;
		}
		if (a.startsWith("-")) {
			continue;
		}
		out.push(a);
	}
	return out;
}

function maxRisk(risks: ReadonlyArray<StructuredRisk>): StructuredRisk {
	const order: StructuredRisk[] = [
		"auto-approve-eligible",
		"ask",
		"never-auto-approve",
	];
	let max: StructuredRisk = "auto-approve-eligible";
	for (const r of risks) {
		if (order.indexOf(r) > order.indexOf(max)) {
			max = r;
		}
	}
	return max;
}

function summarizeReasons(
	perStmt: ReadonlyArray<StructuredStmtRisk>,
	aggregate: StructuredRisk,
): ReadonlyArray<string> {
	const reasons: string[] = [];
	if (aggregate === "never-auto-approve") {
		// Walk all statements to find the deepest R5 source (an
		// aggregated-and stmt's source is just "aggregated-and";
		// the actual R5 family is on a child leaf). For an
		// aggregated node we synthesize a leaf walk.
		const r5Leaves = collectR5LeafSources(perStmt);
		for (const leaf of r5Leaves) {
			reasons.push(`structured-max-risk:never-auto-approve:${leaf}`);
		}
		if (r5Leaves.length === 0) {
			reasons.push("structured-max-risk:never-auto-approve:aggregated");
		}
	}
	if (aggregate === "auto-approve-eligible") {
		reasons.push("structured-max-risk:auto-approve-eligible:all-branches-safe");
	}
	return reasons;
}

/**
 * Walk perStmt and find the deepest R5-shaped source string for any
 * stmt whose risk is never-auto-approve. The aggregated-and source
 * string is replaced with the leaf's specific family name so the
 * operator sees which R5 family drove the verdict.
 */
function collectR5LeafSources(
	perStmt: ReadonlyArray<StructuredStmtRisk>,
): ReadonlyArray<string> {
	const out: string[] = [];
	for (const s of perStmt) {
		if (s.risk === "never-auto-approve") {
			if (
				s.source.startsWith("aggregated-") ||
				s.source.startsWith("subshell:")
			) {
				// The leaf detail is not directly recoverable from the
				// stmt record (we don't carry child sources). The leaf
				// surfaces via a synthetic "aggregated" string instead.
				out.push("aggregated-r5-child");
			} else {
				out.push(s.source);
			}
		}
	}
	return out;
}

/* ---------------------------------------------------------------------- *
 * V1 helper re-use (CORRECTION01)                                         *
 * ---------------------------------------------------------------------- *
 *
 * The structured classifier does NOT define its own R5 hard-floor or
 * safe-rule regex sets. Both are imported from the canonical V1
 * implementation:
 *
 *   - R5 hard floor: `findCommandRiskHardFloor` from `./command-risk`
 *   - safe rules:   `findSafeRuleMatch` from `./command-safe-rules`
 *
 * Keeping a single source of truth prevents the policy drift that the
 * original V2 had: the V1 list and the V2 copy of `rm ~/\.(ssh|...)`
 * had already diverged (V1 includes `gcloud`; V2 includes `docker`+
 * `netrc`). With canonical imports, both surfaces always use the
 * same matcher.
 */

export function joinRunCommandsForParse(input: unknown): {
	joined: string;
	hadMultiple: boolean;
} {
	let normalized: ReadonlyArray<string | StructuredCommandInput> = [];
	try {
		normalized = normalizeRunCommandsInput(input);
	} catch {
		return { joined: "", hadMultiple: false };
	}
	if (normalized.length === 0) {
		return { joined: "", hadMultiple: false };
	}
	if (normalized.length === 1) {
		const first = normalized[0]!;
		return { joined: renderNormalizedCommand(first), hadMultiple: false };
	}
	const rendered = normalized
		.map((cmd) => renderNormalizedCommand(cmd))
		.filter((s) => s.trim().length > 0)
		.join(" ; ");
	return { joined: rendered, hadMultiple: normalized.length > 1 };
}

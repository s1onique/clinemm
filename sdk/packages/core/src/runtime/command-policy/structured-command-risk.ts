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

export const STRUCTURED_PROTO_VERSION = 2 as const;

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
	readonly protocolVersion: typeof STRUCTURED_PROTO_VERSION;
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
	readonly assigns: ReadonlyArray<{
		readonly name: string;
		readonly value: string;
	}>;
	readonly redirects: ReadonlyArray<{
		readonly op: string;
		readonly path: string;
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
 */
export interface StructuredAnalysis {
	readonly parseConfidence: "complete" | "partial" | "failed" | "skipped";
	readonly perStatement: ReadonlyArray<StructuredStmtRisk>;
	readonly aggregate: StructuredRisk;
	readonly promoteToAllow: boolean;
	readonly downgradeToNeverAutoApprove: boolean;
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
 */
export function classifyRedirect(redirect: {
	readonly op: string;
	readonly path: string;
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
			reasons: ["structured analysis skipped (no parser result provided)"],
		};
	}

	// 2. Protocol version mismatch. Production callers must pin to
	//    `STRUCTURED_PROTO_VERSION` (currently 2). Older parser
	//    helpers are not eligible to authorize promotion.
	if (parserResult.protocolVersion !== STRUCTURED_PROTO_VERSION) {
		return {
			parseConfidence: "skipped",
			perStatement: [],
			aggregate: "ask",
			promoteToAllow: false,
			downgradeToNeverAutoApprove: false,
			reasons: [
				`structured analysis skipped (protocol version ${parserResult.protocolVersion} != ${STRUCTURED_PROTO_VERSION})`,
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
		classifyStmt(stmt, idx, parserResult.dialect),
	);

	const aggregate = maxRisk(perStmt.map((s) => s.risk));

	// 8. Compute promotion / strengthening signals. Promotion is
	//    restricted by `dialectCapable` AND by the aggregate being
	//    auto-approve-eligible. The caller in `command-risk.ts`
	//    adds the ASK-source admissibility check
	//    (`isStructureOnlyPromotableAsk`).
	const promote = dialectCapable && aggregate === "auto-approve-eligible";
	const downgrade = aggregate === "never-auto-approve";

	const reasons: string[] = [];
	if (!dialectCapable) {
		reasons.push(
			`structured analysis dialect ${parserResult.dialect} not promotion-capable`,
		);
	}
	reasons.push(...summarizeReasons(perStmt, aggregate));

	return {
		parseConfidence: "complete",
		perStatement: perStmt,
		aggregate,
		promoteToAllow: promote,
		downgradeToNeverAutoApprove: downgrade,
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
): StructuredStmtRisk {
	switch (stmt.kind) {
		case "and":
		case "or":
		case "pipe": {
			const left = classifyStmt(stmt.left, index, dialect);
			const right = classifyStmt(stmt.rhs, index, dialect);
			return {
				statementIndex: index,
				kind: stmt.kind,
				risk: maxRisk([left.risk, right.risk]),
				source: `aggregated-${stmt.kind}`,
			};
		}
		case "subshell": {
			const inner = classifyStmt(stmt.inner, index, dialect);
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
			return classifyCmd(stmt.cmd, index, dialect);
		}
	}
}

function classifyCmd(
	cmd: StructuredCmd,
	index: number,
	_dialect: ShellDialect,
): StructuredStmtRisk {
	// CORRECTION01 STEP 7: redirects participate in risk. Walk
	// every redirect FIRST; a sensitive write redirect escalates to
	// never-auto-approve even if the command itself would be safe.
	for (const redirect of cmd.redirects) {
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

	// ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION02
	// CONTAINMENT (HALT_GO_SOURCE_UNAVAILABLE).
	//
	// The previous V2 `host_safe_echo_parsed_argv` branch was
	// removed. It had two related defects:
	//
	//   1. authority-too-broad: a single-command parsed-argv ALLOW
	//      could be promoted to ALLOW in a compound via V2's
	//      structure-only promotion gate. In particular:
	//        - `echo '---BRANCH---' && echo *`
	//        - `echo '---BRANCH---' && echo {a,b}`
	//      were returning ALLOW. The unquoted glob/brace in the
	//      trailing leaf is an active shell expansion that should
	//      never auto-promote from V2.
	//
	//   2. authority-too-narrow: 16 quoted-literal forms like
	//      `echo '*'`, `echo '{a,b}'`, `echo '<(/bin/rm -rf $HOME)'`
	//      were returning ASK because the V1 regex's quoted class
	//      intentionally excludes several punctuation characters
	//      (`{`, `}`, `*`, `?`, `[`, `]`, `<`, `>`, `(`, `)`,
	//      `$`, `\``) even when they appear inside quotes. The V2
	//      parsed-argv branch was the only path that ALLOWed them.
	//
	// The principled repair is positive parser-proven per-WordPart
	// provenance (`shellStatic`), computed INSIDE the Go helper from
	// the original mvdan/sh AST + quote context. The Go source is
	// not in this checkout, so CORRECTION02 cannot ship that fix
	// yet (see ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01).
	//
	// Containment removes the unsafe V2 promotion entirely. echo
	// authority now falls through to V1's `host_safe_echo` source-
	// text regex + R5 hard floor, which is sound (it accepts the
	// single-command quoted-hyphen forms). The 16 MUST ALLOW false-
	// ASKs become true ASKs by design -- a temporary precision
	// regression the user has authorised in exchange for closing
	// the 2 MUST ASK authority-broadening bypasses.
	//
	// When CORRECTION02 lands, echo authority will be:
	//
	//     V2 echo ALLOW  iff  simple echo
	//                    && no redirects
	//                    && every arg shellStatic === true
	//
	// with `shellStatic` derived from the parser helper's
	// per-WordPart classification, not from any host-side
	// punctuation blacklist.

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

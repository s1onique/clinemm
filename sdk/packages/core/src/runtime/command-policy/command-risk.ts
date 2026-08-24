/**
 * Command Risk Classifier — V1 bounded production slice
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01
 *
 * Builds on the existing canonical command policy
 * (`./command-policy`) and the bounded positive matcher
 * (`./command-safe-rules`). This module adds:
 *
 *   1. An R5 catastrophic hard floor. Even in `mode: "all"` (CLI
 *      --auto-approve / YOLO), commands whose argv shape positively
 *      matches one of the R5 catastrophic families cannot obtain
 *      ALLOW. They are forced to `ask` with disposition
 *      `never-auto-approve`. The floor is a DOWNGRADE-only layer;
 *      it can ASK things that would otherwise ALLOW, but it never
 *      WEAKENS an existing ASK or DENY.
 *
 *   2. A richer return type (`RiskDecision`) carrying not just the
 *      lattice verdict but also `reasons`, `operations`, `targets`,
 *      and `parseConfidence`. This is the contract Group B of the
 *      frozen corpus pins.
 *
 *   3. A single entry point `evaluateCommandRisk` that the CLI host
 *      adapter (or any future host) can use to obtain a risk
 *      decision WITHOUT having to compose the floor themselves.
 *
 * V1 SCOPE — DELIBERATELY BOUNDED:
 *   - R5 hard floor is argv-shape positive matching only.
 *   - R0 read-only utility expansion lives in
 *     `command-safe-rules.ts` (new host_safe_git_* rules).
 *   - Wrapper / composition / variable-substitution / command-
 *     substitution / heredoc / source / eval / alias / function
 *     interpretation are OUT OF SCOPE for V1. They fail closed
 *     (ASK) via the existing `OPAQUE_SHELL_TOKENS` guard.
 *   - No new shell parser is introduced. The corpus is provably
 *     solvable with the existing in-repo bounded positive matcher.
 *
 * See:
 *   - ./command-risk-corpus.ts               (frozen contract data)
 *   - ./command-risk-corpus.baseline.test.ts (Group A: today-behaviour)
 *   - ./command-risk-corpus.v1-contract.test.ts (Group B: V1 contract)
 *   - ./.factory/evidence/act-command-risk-classification01/01-decision-record.md
 */

import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { StructuredCommandInput } from "../../extensions/tools/schemas";
import { renderNormalizedCommand } from "./command-model-hints";
import {
	type CommandHostAuthorization,
	evaluateCommandPolicy,
} from "./command-policy";
import { isOpaqueShellRendered } from "./command-safe-rules";
import type { WorkspacePathAuthorityEvidence } from "./path-authority-evidence";
import {
	evaluateStructuredCommandRisk,
	isParserProvenSource,
	isStructureOnlyPromotableAsk,
} from "./structured-command-risk";

/**
 * The structured risk verdict returned by `evaluateCommandRisk`.
 *
 * Mapping to the canonical lattice (allow < ask < deny):
 *   - "allow"                <=> ALLOW
 *   - "ask"                  <=> ASK
 *   - "deny"                 <=> DENY
 *
 * `disposition` is the human-facing product semantics:
 *   - "auto-approve-eligible"   OK to run without asking
 *   - "ask"                     Must be presented to the operator
 *   - "never-auto-approve"      Even a YOLO/--auto-approve mode
 *                               MUST surface this. The hard floor.
 */
export type RiskDecision = {
	decision: "allow" | "ask" | "deny";
	disposition: "auto-approve-eligible" | "ask" | "never-auto-approve";
	/** Human-readable reasons, in priority order. */
	reasons: string[];
	/** Normalized operation tokens (e.g. "rm -rf", "git diff"). */
	operations: string[];
	/** Normalized target tokens (e.g. "$HOME", "..", "/"). */
	targets: string[];
	/** How confidently we classified this command. */
	parseConfidence: "complete" | "partial" | "failed";
	/** Source of the verdict (telemetry). */
	source: string;
};

export interface EvaluateCommandRiskInput {
	/** Tool input shape (string | structured | array). */
	toolInput: unknown;
	/** Host authorization (mode + rules). */
	hostAuthorization: CommandHostAuthorization;
}

/**
 * Trusted-internal input shape that ADDITIONALLY carries a parser result.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
 * This type is DELIBERATELY NOT EXPORTED from `@cline/core` index.
 * The V2 parser result is a HOST-OWNED CAPABILITY — only the trusted
 * host adapter (CLI `cliEvaluateCommandToolApprovalWith`, VSCode
 * `evaluateCommandToolApproval`) is allowed to construct it. External
 * callers must use `evaluateCommandRisk(...)` (no parserResult field),
 * which is V1-only by construction and provably safe: even if an
 * attacker controls `toolInput`, they cannot inject a fake safe AST
 * because the public surface does not accept one.
 *
 * The internal entry point `evaluateCommandRiskWithParser(...)` is
 * exported only through `./command-risk-internal` so the trusted
 * host adapters can import it explicitly while the public surface
 * stays narrow.
 */
export interface EvaluateCommandRiskInternalInput
	extends EvaluateCommandRiskInput {
	/**
	 * V2 parser result. MUST come from a trusted host-owned parser
	 * capability. Untrusted callers have no path to supply this.
	 */
	readonly parserResult?:
		| import("./structured-command-risk").ParsedShell
		| null;
}

/* ---------------------------------------------------------------------- *
 * R5 catastrophic hard floor                                              *
 * ---------------------------------------------------------------------- *
 *                                                                        *
 * Each rule is a positive argv-shape match. The list is DELIBERATELY    *
 * finite: it covers the catastrophic cases the corpus documents and     *
 * nothing else. Adding a new family requires an explicit corpus case    *
 * and a review note.                                                     *
 *                                                                        *
 * Match priority: a command is rejected if ANY rule matches. Multi-     *
 * command inputs are evaluated per-command; if any command matches,     *
 * the aggregate verdict is `ask` + `never-auto-approve`.                *
 *                                                                        *
 * All rules are anchored on the RENDERED surface (so we can use the     *
 * same renderer the existing safe-rule engine uses). They are           *
 * written to be conservatively literal: $HOME / ~ / tilde-prefixed      *
 * paths are matched by literal token presence rather than shell         *
 * expansion.                                                             *
 */

interface HardFloorMatch {
	family:
		| "home-destruction"
		| "root-destruction"
		| "parent-destruction"
		| "sensitive-home-deletion"
		| "sensitive-home-read"
		| "system-file-write";
	/** Whether this family produces a never-auto-approve disposition. */
	hard: boolean;
	pattern: RegExp;
	description: string;
}

/**
 * Exported R5 hard-floor rule shape. ACT-CLINEMM-COMMAND-RISK-
 * CLASSIFICATION02-CORRECTION01: the family union is part of the
 * reason-text contract; new families MUST be reviewed before they
 * appear in telemetry.
 */
export type CommandRiskHardFloorFamily = HardFloorMatch["family"];

/**
 * Canonical V1 R5 catastrophic hard floor rule set.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01:
 * Exported so downstream classifiers (e.g. the V2 structured classifier
 * in `structured-command-risk.ts`) consume this SINGLE source of truth
 * rather than maintain a duplicated copy. Mutation here MUST go
 * through a corpus case + a review note.
 *
 * The fields are FROZEN by ACT §10: family names are part of the
 * telemetry reason contract (`risk:hard-floor:<family>`).
 */
export const R5_HARD_FLOOR_RULES: ReadonlyArray<HardFloorMatch> = [
	// HOME destruction
	//
	// The patterns are SUBSTRING matches, not anchored. This is
	// deliberate: a wrapper like `(cd / && rm -rf "$HOME")` puts
	// the catastrophic inner command after `&& `, and the
	// closing `"` of `"$HOME"` may be followed by `)`, `|`, `&`,
	// etc. that an end-of-token class would reject. The inner
	// command is the load-bearing signal; the wrapper context is
	// already handled by the existing `OPAQUE_SHELL_TOKENS` guard
	// forcing ASK. The floor is the final downgrade to
	// `never-auto-approve`.
	//
	// False-positive risk: `echo "rm -rf \"$HOME\""` would match
	// even though it is non-destructive. The cost is a more
	// cautious disposition label on a single non-destructive
	// command, which is acceptable for a safety boundary.
	{
		family: "home-destruction",
		hard: true,
		pattern: /rm\s+(?:-[\w]+\s+)*(?:"\$HOME"|~|\$HOME)/u,
		description: "destructive removal of $HOME or ~",
	},
	{
		family: "home-destruction",
		hard: true,
		pattern: /rm\s+(?:-[\w]+\s+)*(?:"\$HOME"|~|\$HOME)\s*\/\s*\S+/u,
		description: "destructive removal under $HOME or ~",
	},
	{
		family: "home-destruction",
		hard: true,
		pattern: /find\s+(?:"\$HOME"|~|\$HOME)[^|;&]*-delete/u,
		description: "find -delete under $HOME or ~",
	},
	{
		family: "home-destruction",
		hard: true,
		pattern: /find\s+(?:"\$HOME"|~|\$HOME)[^|;&]*-exec\s+rm/u,
		description: "find -exec rm under $HOME or ~",
	},
	// Filesystem root
	{
		family: "root-destruction",
		hard: true,
		pattern: /rm\s+(?:-[\w]+\s+)*\/\s*(?:$|\s|\.)/u,
		description: "destructive removal of /",
	},
	// External mounts (very conservative: only literal /Volumes/...)
	{
		family: "root-destruction",
		hard: true,
		pattern: /rm\s+(?:-[\w]+\s+)*\/Volumes\//u,
		description: "destructive removal under /Volumes",
	},
	// Workspace parent
	{
		family: "parent-destruction",
		hard: true,
		pattern: /rm\s+(?:-[\w]+\s+)*\.\.(?:\s|$|\/)/u,
		description: "destructive removal of .. or ../...",
	},
	// Sensitive home deletions
	{
		family: "sensitive-home-deletion",
		hard: true,
		pattern: /rm\s+(?:-[\w]+\s+)*~\/\.(?:ssh|gnupg|aws|gcloud|config|kube)/u,
		description: "destructive removal of sensitive home dotfile directory",
	},
	// Sensitive home reads (leak, not destruction; ASK with reason)
	{
		family: "sensitive-home-read",
		hard: false,
		pattern: /cat\s+~\/\.ssh\//u,
		description: "reads SSH material from home",
	},
	// System-file writes (tee, redirect, etc.) targeting /etc
	// These are catastrophic even though they don't use `rm`; the
	// blast radius is system configuration.
	{
		family: "system-file-write",
		hard: true,
		pattern: /(?:tee|>>?)\s+\/etc\//u,
		description: "writes/redirects to /etc/ system files",
	},
	{
		family: "system-file-write",
		hard: true,
		pattern: /\|\s*(?:sudo\s+)?tee\b[^|;&]*(?:\/etc\/|\/boot\/|\/var\/)/u,
		description: "piped tee to /etc/, /boot/, /var/",
	},
];

/**
 * Canonical V1 R5 catastrophic hard-floor matcher.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01:
 * Exposed for downstream classifiers (V2 structured classifier,
 * future R5 audit tooling) so they consume the SINGLE V1 source
 * of truth. The match contract is identical to the in-function
 * loop in `evaluateCommandRisk` — every rule is a SUBSTRING match
 * (not anchored), the same way V1 scans each rendered command.
 *
 * Returns:
 *   - the FIRST rule that matches (priority: declaration order),
 *     or null when no rule matches.
 *   - rules are returned as `{ family, hard }` (the canonical
 *     family name + whether it forces never-auto-approve).
 *
 * The pattern field is intentionally not returned — downstream
 * code must not depend on the regex source.
 */
export function findCommandRiskHardFloor(rendered: string): {
	readonly family: CommandRiskHardFloorFamily;
	readonly hard: boolean;
} | null {
	for (const rule of R5_HARD_FLOOR_RULES) {
		if (rule.pattern.test(rendered)) {
			return { family: rule.family, hard: rule.hard };
		}
	}
	return null;
}

/* ---------------------------------------------------------------------- *
 * Main entry point                                                        *
 * ---------------------------------------------------------------------- */

/**
 * Public V1-only entry point.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01-CORRECTION01:
 * The public `evaluateCommandRisk` MUST be V1-only by construction at
 * RUNTIME, not just at the TypeScript type layer. This function
 * deliberately reconstructs a fresh internal input with only the two
 * documented public fields and `parserResult` explicitly set to
 * `undefined`, so any caller-supplied `parserResult` (e.g. via a
 * TypeScript `as any` escape hatch or a plain JS object) is
 * PROVABLY ignored at runtime.
 *
 * Provenance barrier (runtime): the public wrapper strips all
 * excess runtime properties by reconstructing the input object
 * before delegating. No JavaScript caller can reach the V2-aware
 * evaluator through this entry point.
 */
export function evaluateCommandRisk(
	input: EvaluateCommandRiskInput,
): RiskDecision {
	return evaluateCommandRiskWithParser({
		toolInput: input.toolInput,
		hostAuthorization: input.hostAuthorization,
		// CRITICAL: do NOT spread `input`. Any other runtime property
		// on the caller's object (e.g. parserResult, parserResultAlias)
		// is dropped at this boundary. V2 is unreachable from the
		// public surface.
		parserResult: undefined,
	});
}

/**
 * Trusted-internal entry point that accepts an OPTIONAL V2 parser result.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
 * This function is the ONLY place in `@cline/core` that consults a
 * parser result. It is exported via the narrow `./command-risk-internal`
 * module so trusted host adapters (CLI / VSCode) can opt in to V2,
 * but the PUBLIC `@cline/core` entry point does NOT re-export it.
 *
 * CORRECTION01 (HALT_PROVENANCE_GAP): the public `evaluateCommandRisk`
 * no longer forwards its input object directly to this function. It
 * reconstructs a fresh internal input with `parserResult: undefined`,
 * making the public boundary V1-only by construction at runtime.
 * Untrusted callers cannot reach this function through the public
 * surface even if they bypass TypeScript types.
 *
 * Authority / Provenance contract:
 *   - `parserResult` MUST be constructed by a trusted host-owned
 *     capability (e.g. `MvdanShHelper.invoke()` from
 *     `./parser-helper/runtime`). It MUST NOT be accepted from any
 *     untrusted caller.
 *   - SHA-256 binding (`sourceSha256`) provides integrity correlation
 *     between the AST and the source bytes; it does NOT provide
 *     authentication. Authentication comes from "this AST was
 *     constructed by code we trust, in our process, from a pinned
 *     helper binary we vetted."
 */
export function evaluateCommandRiskWithParser(
	input: EvaluateCommandRiskInternalInput,
): RiskDecision {
	// 1. Canonical policy composition. This is the source of truth
	//    for the ALLOW/ASK/DENY lattice. We never weaken its verdict.
	const policy = evaluateCommandPolicy({
		toolInput: input.toolInput,
		hostAuthorization: input.hostAuthorization,
	});

	// 2. Normalize for the per-command floor scan. If normalization
	//    fails, we already have a "failed" parseConfidence; the policy
	//    has already produced an `unknown_input` ASK.
	let normalized: ReadonlyArray<string | StructuredCommandInput> = [];
	try {
		normalized = normalizeRunCommandsInput(input.toolInput);
	} catch {
		// ignore: handled below
	}
	const parseConfidence: RiskDecision["parseConfidence"] =
		normalized.length === 0
			? "failed"
			: policy.decision.source === "unknown_input"
				? "partial"
				: "complete";

	// 3. Render and scan each command for R5 hard floor matches.
	//    Any match forces the aggregate to ASK + never-auto-approve.
	const floorMatches: HardFloorMatch[] = [];
	const operations: string[] = [];
	const targets: string[] = [];
	for (const cmd of normalized) {
		const rendered = renderNormalizedCommand(cmd).trim();
		if (rendered.length === 0) {
			continue;
		}
		const tokens = rendered.split(/\s+/u);
		operations.push(tokens[0] ?? "");
		// The hard floor checks BOTH the rendered surface (for
		// $HOME/tilde/parent) AND a conservative subset of tokens
		// for path-like content. The R5 corpus cases are all caught
		// by the rendered-surface match; the token list is for
		// targets reporting.
		for (const tok of tokens) {
			if (
				tok === ".." ||
				tok === "/" ||
				tok === "$HOME" ||
				tok === '"$HOME"' ||
				tok === "~" ||
				tok.startsWith("/Volumes/") ||
				tok.startsWith("~/")
			) {
				if (!targets.includes(tok)) {
					targets.push(tok);
				}
			}
		}
		for (const rule of R5_HARD_FLOOR_RULES) {
			if (rule.pattern.test(rendered)) {
				floorMatches.push(rule);
			}
		}
	}

	// 4. Opaque shell token check. Even if the floor doesn't match
	//    positively, an unresolvable composition (bash -c, $(), backtick,
	//    >, <, etc.) cannot be safely allowed. If the canonical
	//    policy already said ALLOW in this case (e.g. mode: "all" with
	//    no rule match), the floor DOES downgrade it to ASK. If the
	//    canonical policy already said ASK/DENY, the floor is a no-op.
	const opaqueCommands: string[] = [];
	for (const cmd of normalized) {
		const rendered = renderNormalizedCommand(cmd).trim();
		if (rendered.length === 0) continue;
		if (isOpaqueShellRendered(rendered)) {
			opaqueCommands.push(rendered);
		}
	}

	// 5. Compose final verdict. The floor is DOWNGRADE-only.
	const reasons: string[] = [];
	let finalDecision: RiskDecision["decision"] = policy.decision.kind;
	let finalDisposition: RiskDecision["disposition"];
	let finalSource: string = policy.decision.source;

	if (finalDecision === "allow") {
		finalDisposition = "auto-approve-eligible";
	} else if (finalDecision === "deny") {
		finalDisposition = "never-auto-approve";
	} else {
		finalDisposition = "ask";
	}

	// 5a. Hard floor R5 matches. Force ASK + (when the family is
	//     `hard: true`) never-auto-approve regardless of the
	//     canonical policy verdict. The reason text names the
	//     family.
	//
	//     Cases:
	//       - canonical said ALLOW  -> downgrade to ASK.
	//         If any matching family is `hard: true`, set
	//         disposition to `never-auto-approve`. Otherwise the
	//         disposition stays `ask` (e.g. sensitive-home-read is
	//         a leak, not a destruction).
	//       - canonical said ASK    -> keep ASK; promote the
	//         disposition to `never-auto-approve` ONLY if a hard
	//         family matched. The reason text always names the
	//         families so the operator understands the source.
	if (floorMatches.length > 0) {
		const anyHard = floorMatches.some((m) => m.hard);
		if (finalDecision === "allow") {
			finalDecision = "ask";
			finalSource = "risk_hard_floor";
			reasons.push(policy.decision.reason);
		}
		if (anyHard) {
			finalDisposition = "never-auto-approve";
		}
		const families = new Set(floorMatches.map((m) => m.family));
		for (const fam of families) {
			reasons.push(`risk:hard-floor:${fam}`);
		}
	}

	// 5b. Opaque shell token. If the canonical policy already
	//     returned ASK, this is redundant. If it returned ALLOW
	//     (mode: "all" + a non-rule-matched but non-opaque command),
	//     this would also be redundant. The interesting case is
	//     an opaque token in a multi-command input where the
	//     aggregate verdict is allow: e.g. "pwd; rm -rf $HOME"
	//     gets per-command ASK from the existing policy because
	//     rm -rf $HOME doesn't match any safe rule. But
	//     "pwd; bash -c 'rm -rf $HOME'" similarly degrades. The
	//     opaque check is the belt-and-braces guard.
	if (opaqueCommands.length > 0 && finalDecision === "allow") {
		// Conservative: if any command is opaque, we cannot reason
		// about composition. The existing safe-rule engine already
		// forces ASK for opaque renderings, so this branch should
		// be unreachable in practice (it would mean the policy
		// granted ALLOW on an opaque rendering, which is a
		// regression). Surface it as a safety check.
		finalDecision = "ask";
		finalDisposition = "ask";
		finalSource = "risk_opaque_composition";
		reasons.push(
			`opaque shell composition detected in ${opaqueCommands.length} command(s)`,
		);
	}

	// 5c. Empty / unparseable input.
	if (parseConfidence === "failed") {
		finalDecision = "ask";
		finalDisposition = "ask";
		finalSource = "risk_parse_failed";
		reasons.push("command could not be parsed");
	}

	// 5d. V2 structured analysis (ACT-CLINEMM-COMMAND-RISK-
	//     CLASSIFICATION02-PARSER-ASSISTED01 + CORRECTION01).
	//     Layered ON TOP of V1:
	//
	//     - May PROMOTE V1 ASK -> ALLOW only when ALL gates hold:
	//         (a) v2.promoteToAllow is set (the V2 classifier has
	//             structurally classified every reachable branch as
	//             auto-approve eligible);
	//         (b) the V1 ASK is STRUCTURE-ONLY
	//             (isStructureOnlyPromotableAsk(finalSource));
	//         (c) the V1 ASK was specifically caused by an opaque
	//             shell composition token in the rendered input
	//             (`opaqueCommands.length > 0`). Without this gate,
	//             `unknown_command --opt` (no opaque token, just an
	//             unknown binary) would be promotable when the AST
	//             arbitrarily claims the inner is `pwd`;
	//         (d) finalDisposition is not already never-auto-approve
	//             (V2 may NEVER promote a hard-floor disposition
	//             back to ALLOW).
	//     - May STRENGTHEN V1 ASK -> never-auto-approve when:
	//         (a) parser result is bound to source (parseConfidence
	//             === "complete" in v2);
	//         (b) v2.downgradeToNeverAutoApprove is set;
	//         (c) the V1 disposition is ASK or ALLOW (V2 never
	//             weakens a DENY or never-auto-approve).
	//     - NEVER weakens V1's verdict.
	if (input.parserResult !== undefined) {
		const v2 = evaluateStructuredCommandRisk({
			toolInput: input.toolInput,
			parserResult: input.parserResult,
		});
		const v2SourceBound = v2.parseConfidence === "complete";
		// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01.
		// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01.
		// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01-CORRECTION01
		// (reviewer disposition HALT_PARSER_PROVEN_PROMOTION_BYPASSES_PATH_AUTHORITY).
		// Parser-proven positive provenance: when V2's per-stmt
		// classification reports a parser-proven source label
		// (every arg of the leaf is `static` per the Go helper's AST
		// classification), V2 can promote a V1 ASK to ALLOW ONLY
		// when the V1 ASK was caused by shell/source-text
		// conservatism (NOT by host filesystem authority). This is
		// the principal Phase 2 win.
		//
		// The single source of truth for which source labels
		// qualify is `PARSER_PROVEN_SOURCE_LABELS` in
		// structured-command-risk.ts. Adding a new parser-proven
		// family (e.g. git log positional refs in a future ACT)
		// is a one-line edit to that set plus a one-line edit
		// to the V2 dispatcher.
		//
		// Gates (must all hold):
		//   (a) at least one perStatement has a parser-proven source
		//       label (positive proof, not string-blacklist);
		//   (b) v2 source is bound to source (parseConfidence === "complete");
		//   (c) V1 disposition is not already never-auto-approve (V2
		//       may NEVER promote a hard-floor disposition back to ALLOW);
		//   (d) the V1 ASK reason is a STRUCTURE-ONLY reason (V2 may
		//       NOT override host authority). Concretely: V1 source
		//       labels like `host_workspace_realpath_authority`,
		//       `host_workspace_path_authority`, `host_mode_manual`,
		//       and any model-escalation/deny source MUST remain
		//       ASK when V2 sees a parser-proven leaf. Static shell
		//       syntax is NOT filesystem authority.
		//   (e) parser helper protocol version is 3+ -- enforced at the
		//       per-stmt layer; under v2 the runtime injects
		//       ["unknown"]* which prevents the parser-proven branch
		//       from activating in the first place.
		const hasParserProvenLeaf = v2.perStatement.some((s) =>
			isParserProvenSource(s.source),
		);
		// CORRECTION03: bind the structured-program R0 path-bearing
		// operands to the host's canonical path-authority evidence.
		// The CORRECTION02 `containsPathBearingLeaf` boolean was a
		// mere presence check and left a residual
		// HALT_PIPELINE_PATH_EVIDENCE_NOT_BOUND_TO_OPERAND bypass:
		// an unrelated valid evidence record (e.g. one whose operands
		// belong to a different command) satisfied the presence test
		// and unlocked promotion. CORRECTION03 closes this by
		// requiring per-operand identity + canonical containment
		// binding (delegated to V1's
		// `evaluateCommandRealpathConformance`).
		const pathBearingEvidenceBound = pathBearingOperandsBound(
			v2.pathBearingOperands,
			input.hostAuthorization.pathAuthorityEvidence,
		);
		const pathBearingEvidenceMissing = v2.pathBearingOperands.length > 0 &&
			input.hostAuthorization.pathAuthorityEvidence === undefined;
		const isParserProvenPromotion =
			hasParserProvenLeaf &&
			v2SourceBound &&
			finalDisposition !== "never-auto-approve" &&
			// CORRECTION01 reviewer fix:
			// refuse to override authority-bearing V1 ASK reasons.
			// isStructureOnlyPromotableAsk encapsulates the positive
			// version of this rule: only `host_mode_safe_only_fallthrough`
			// and `risk_opaque_composition` are eligible for promotion.
			// This single condition gates BOTH the parser-proven branch
			// (above) and the structure-caused-ASK branch (below)
			// against authority-bypass. Adding new authority-bearing
			// ASK sources later has no effect here as long as they
			// remain outside `STRUCTURE_ONLY_PROMOTABLE_REASONS`.
			isStructureOnlyPromotableAsk(finalSource) &&
			// CORRECTION03 path-authority binding gate:
			// refuse to promote when the structured program contains
			// any R0 path-bearing operand AND the host's evidence is
			// either missing OR not bound to those operands. The
			// binding contract is defined in `pathBearingOperandsBound`
			// below: per-operand identity + per-operand canonical
			// containment (delegated to V1's
			// `evaluateCommandRealpathConformance`). When evidence IS
			// bound AND conforming, the per-command ALLOW contract is
			// honored. Pre-CORRECTION03 this gate fired on mere
			// presence (`pathBearingLeafRequiresEvidence`), which
			// allowed capability aliasing: an unrelated valid
			// evidence record satisfied the presence check. The
			// `pathBearingEvidenceMissing` signal is surfaced as a
			// reason so the operator sees the binding failure.
			!pathBearingEvidenceMissing &&
			pathBearingEvidenceBound &&
			v2.promoteToAllow;
		if (isParserProvenPromotion) {
			finalDecision = "allow";
			finalDisposition = "auto-approve-eligible";
			finalSource = "risk_v2_structured_promotion";
			reasons.push(...v2.reasons);
		}
		// Existing structure-caused-ASK promotion (CORRECTION01). Unchanged
		// in Phase 2; the parser-proven path does NOT take this branch
		// because its finalSource has already been overwritten above.
		//
		// CORRECTION03: same operand-binding gate as
		// `isParserProvenPromotion` applies. Without this gate, the
		// v2StructureCausedAsk branch would still ALLOW a pipe
		// `ls <path> | head -30` (no evidence) whenever the V1
		// verdict for the pipe was an opaque-shell composition ASK
		// (i.e. `risk_opaque_composition`). The hasParserProvenLeaf
		// guard was insufficient because the `head` leaf is parser-
		// proven even when its sibling `ls` is path-bearing.
		const v2StructureCausedAsk =
			v2.promoteToAllow &&
			finalDecision === "ask" &&
			finalDisposition !== "never-auto-approve" &&
			isStructureOnlyPromotableAsk(finalSource) &&
			!pathBearingEvidenceMissing &&
			pathBearingEvidenceBound &&
			opaqueCommands.length > 0;
		if (v2StructureCausedAsk) {
			// Load-bearing monotonicity invariant: V2 may NEVER
			// promote a V1 never-auto-approve disposition back to
			// ALLOW, even if the parser fixture claims the input is
			// safe. The `disposition !== "never-auto-approve"`
			// guard above enforces this.
			finalDecision = "allow";
			finalDisposition = "auto-approve-eligible";
			finalSource = "risk_v2_structured_promotion";
			reasons.push(...v2.reasons);
		} else if (v2.downgradeToNeverAutoApprove && v2SourceBound) {
			// V2 may strengthen ASK or ALLOW (ALLOW→ASK+never-auto-approve,
			// matching V1's R5 floor pattern), BUT only when the
			// parser result is bound to source. An unbound AST
			// cannot be trusted to surface R5.
			if (finalDecision === "ask") {
				finalDisposition = "never-auto-approve";
			} else if (finalDecision === "allow") {
				finalDecision = "ask";
				finalDisposition = "never-auto-approve";
				finalSource = "risk_v2_structured_strengthen";
			}
			reasons.push(...v2.reasons);
		}
	}

	if (reasons.length === 0) {
		reasons.push(policy.decision.reason);
	}

	return {
		decision: finalDecision,
		disposition: finalDisposition,
		reasons,
		operations,
		targets,
		parseConfidence,
		source: finalSource,
	};
}

/* ---------------------------------------------------------------------- *
 * CORRECTION03: R0 path-bearing operand/evidence binding                *
 * ---------------------------------------------------------------------- *
 *
 * Bind structured-program R0 leaf operands to the host's
 * canonical `WorkspacePathAuthorityEvidence`. The contract:
 *
 *   For every entry `e` in `pathBearingOperands`:
 *     1. Every operand in `e.operands` MUST have a matching
 *        entry in `evidence.operands[*]` whose `operand` field
 *        equals the operand VERBATIM (operand identity). The
 *        match is by IDENTITY, not by index: the host may have
 *        supplied evidence for operands that the structured
 *        program does not actually use (the host is authorized
 *        to over-supply). The structured program MUST NOT use
 *        any operand the host did not authorize.
 *
 *   Identity is the same rule V1's per-command path gate uses
 *   (`command-policy.ts` lines 333-345) -- verbatim string
 *   equality with the extracted operand. This rejects evidence
 *   records forged for a different command.
 *
 *     2. The matching entry MUST have `contained: true` AND
 *        `resolvedRealPath !== null` (resolution + containment
 *        authorized). Resolution failures (`resolvedRealPath:
 *        null`) fail closed per the evidence contract.
 *
 *   The host MAY supply evidence for operands the structured
 *   program does not use; the binder ignores those (the host
 *   is authorized to over-supply). The structured program MUST
 *   NOT consume an operand the host did not authorize (this is
 *   the load-bearing identity check).
 *
 * This closes HALT_PIPELINE_PATH_EVIDENCE_NOT_BOUND_TO_OPERAND:
 * the pre-CORRECTION03 gate fired on mere *presence* of any
 * evidence object (capability aliasing); CORRECTION03 fires on
 * per-operand identity + canonical containment + canonical
 * resolution.
 */
export function pathBearingOperandsBound(
	pathBearingOperands: ReadonlyArray<{
		readonly source: string;
		readonly operands: ReadonlyArray<string>;
	}>,
	evidence: WorkspacePathAuthorityEvidence | undefined,
): boolean {
	if (pathBearingOperands.length === 0) {
		return true;
	}
	if (evidence === undefined) {
		return false;
	}
	// Build a lookup by operand identity. Host evidence entries
	// are assumed to be unique by `.operand` (the host builds one
	// entry per extracted path operand in V1's
	// `extractPathOperands` flow). If the host supplied duplicate
	// entries for the same operand, we use the FIRST one.
	const byOperand = new Map<string, (typeof evidence.operands)[number]>();
	for (const e of evidence.operands) {
		if (!byOperand.has(e.operand)) {
			byOperand.set(e.operand, e);
		}
	}
	// Iterate every structured R0 operand and require an
	// identity-bound evidence entry whose resolution +
	// containment authorize it.
	for (const leaf of pathBearingOperands) {
		for (const operand of leaf.operands) {
			const ev = byOperand.get(operand);
			if (ev === undefined) {
				return false;
			}
			// Fail-closed: unresolved operand (null realpath)
			// is never ALLOW-able.
			if (ev.resolvedRealPath === null) {
				return false;
			}
			if (ev.contained !== true) {
				return false;
			}
		}
	}
	return true;
}

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

import { renderNormalizedCommand } from "./command-model-hints";
import {
	evaluateCommandPolicy,
	type CommandHostAuthorization,
} from "./command-policy";
import { isOpaqueShellRendered } from "./command-safe-rules";
import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { StructuredCommandInput } from "../../extensions/tools/schemas";

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
	/**
	 * Optional: HOME directory used to resolve `~` / `$HOME` in the
	 * hard floor. If omitted, the floor is a pure literal/pattern
	 * match — the corpus cases are all literal so the floor still
	 * matches.
	 */
	homeDirectory?: string;
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

const R5_HARD_FLOOR_RULES: ReadonlyArray<HardFloorMatch> = [
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

/* ---------------------------------------------------------------------- *
 * Main entry point                                                        *
 * ---------------------------------------------------------------------- */

export function evaluateCommandRisk(
	input: EvaluateCommandRiskInput,
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

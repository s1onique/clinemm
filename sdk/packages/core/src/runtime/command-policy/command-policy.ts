/**
 * Command Approval Policy Composition
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION04
 *
 * The canonical `evaluateCommandPolicy()` entry point. Hosts translate
 * their user-facing settings into `CommandHostAuthorization` (mode +
 * optional explicit allow/deny rules) and call this function. The result
 * carries:
 *
 *   - decision.kind     allow / ask / deny   (lattice verdict)
 *   - decision.source   provenance for telemetry
 *   - decision.reason   human-readable explanation
 *   - commands[i]       per-command EvaluatedCommand carrying the
 *                       matched-rule source and (for safe-only ALLOW)
 *                       the safe execution profile the executor MUST
 *                       apply at execution time.
 *
 * Composition rule (monotonic authority lattice):
 *   decision = host_base.max_restrictive(model_escalation)
 *
 * Execution constraints are independent:
 *   - per-command profiles travel with the EvaluatedCommand;
 *   - model escalation raises the lattice verdict but does NOT
 *     erase the per-command profile (a user-approved ASK still runs
 *     hardened).
 *
 * Steps:
 *   1. Normalize the input via the canonical SDK normalizer.
 *      Failure => ASK (source: unknown_input).
 *   2. Per-command host base resolution: each normalized command
 *      yields its own kind/source/profile (CORRECTION04).
 *   3. Aggregate the lattice verdict across all commands.
 *   4. Apply model hint escalation ONLY.
 *      - model_escalation=true  => at least ASK
 *      - model_escalation=false => no weakening
 *      - missing/malformed      => no weakening
 */

import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { StructuredCommandInput } from "../../extensions/tools/schemas";
import {
	parseCommandModelHints,
	renderNormalizedCommand,
} from "./command-model-hints";
import type {
	CommandDecision,
	CommandDecisionKind,
	CommandDecisionSource,
	CommandHostAuthorization,
	EvaluateCommandPolicyResult,
	EvaluatedCommand,
	NormalizationResult,
	NormalizedCommand,
} from "./command-policy-types";
import { findSafeRuleMatch } from "./command-safe-rules";
import {
	evaluateCommandRealpathConformance,
	extractR0PathOperands,
} from "./path-authority";
import {
	getSafeExecutionProfileForSource,
	type SafeExecutionProfile,
} from "./safe-execution-profile";

export interface EvaluateCommandPolicyInput {
	toolInput: unknown;
	hostAuthorization: CommandHostAuthorization;
}

/**
 * Compose the final command decision.
 *
 * This function is the single authoritative entry point used by VS Code
 * and CLI. Any host that wishes to gate `run_commands` / `execute_command`
 * tools MUST route through here.
 */
export function evaluateCommandPolicy(
	input: EvaluateCommandPolicyInput,
): EvaluateCommandPolicyResult {
	// 1. Normalize input via the canonical SDK normalizer.
	const normalization = normalizeForPolicy(input.toolInput);
	if (!normalization.ok) {
		const decision: CommandDecision = {
			kind: "ask",
			reason: `unable to parse command: ${normalization.reason}`,
			source: "unknown_input",
		};
		return {
			decision,
			commands: [],
			modelHints: parseCommandModelHints(input.toolInput),
		};
	}

	// 2. Per-command host base resolution (CORRECTION04): each command
	//    is evaluated independently. Each entry carries its own
	//    matched-rule source AND its own safe execution profile.
	const perCommand = resolvePerCommand(
		normalization.commands,
		input.hostAuthorization,
	);

	// 3. Aggregate the lattice verdict across all commands.
	const aggregateKind = aggregateLattice(perCommand);

	// 4. Model hint aggregation.
	const modelHints = parseCommandModelHints(input.toolInput);

	// 5. Compose monotonically: model escalation raises the lattice
	//    verdict but does NOT erase per-command profiles. The profiles
	//    remain attached to the per-command entries so a user-approved
	//    ASK still runs hardened (defense in depth).
	let finalKind = aggregateKind;
	let finalReason = aggregateReason(perCommand);
	let finalSource = aggregateSource(perCommand, input.hostAuthorization);

	if (modelHints.effectiveEscalation && finalKind === "allow") {
		finalKind = "ask";
		finalReason = `${aggregateReason} (model requested approval)`;
		finalSource = "model_escalation";
	}

	// 6. Convenience pointer for single-command ALLOW verdicts: expose
	//    the matched safe rule source on the aggregate decision for
	//    back-compat callers. For multi-command inputs this is undefined
	//    and callers MUST consult `commands[i].matchedRuleSource`.
	const singleMatchedSource =
		perCommand.length === 1 ? perCommand[0]?.matchedRuleSource : undefined;

	// 7. Materialize per-command EvaluatedCommand[].
	const evaluatedCommands: EvaluatedCommand[] = perCommand.map((ev) => ({
		index: ev.index,
		normalized: ev.normalized,
		matchedRuleSource: ev.matchedRuleSource,
		safeExecutionProfile: ev.safeExecutionProfile,
	}));

	return {
		decision: {
			kind: finalKind,
			reason: finalReason,
			source: finalSource,
			matchedRuleSource: singleMatchedSource,
		},
		commands: evaluatedCommands,
		modelHints,
	};
}

/**
 * Normalize raw tool input through the canonical SDK normalizer and
 * collapse its return shape into a `NormalizationResult` (the policy only
 * cares about "did we get commands?").
 */
function normalizeForPolicy(input: unknown): NormalizationResult {
	if (input == null) {
		return { ok: false, reason: "input is null/undefined" };
	}

	let normalized: ReadonlyArray<string | StructuredCommandInput>;
	try {
		normalized = normalizeRunCommandsInput(input);
	} catch {
		return { ok: false, reason: "canonical normalizer rejected input" };
	}

	if (normalized.length === 0) {
		return { ok: false, reason: "empty command list" };
	}

	const out: NormalizedCommand[] = [];
	for (const element of normalized) {
		if (typeof element === "string") {
			if (element.length === 0) {
				return { ok: false, reason: "empty command element" };
			}
			out.push(element);
			continue;
		}
		if (
			element &&
			typeof element === "object" &&
			typeof (element as StructuredCommandInput).command === "string" &&
			(element as StructuredCommandInput).command.length > 0
		) {
			out.push(element as StructuredCommandInput);
			continue;
		}
		return { ok: false, reason: "unparseable command element" };
	}

	return { ok: true, commands: out };
}

/**
 * Per-command host evaluation record (internal to the policy module).
 * The EvaluatedCommand exposed to callers is the public projection of
 * this record.
 */
interface PerCommandEvaluation {
	index: number;
	normalized: NormalizedCommand;
	kind: CommandDecisionKind;
	source: CommandDecisionSource;
	matchedRuleSource?: string;
	reason: string;
	safeExecutionProfile?: SafeExecutionProfile;
}

/**
 * Resolve each normalized command independently against the host
 * authorization. This is the per-command host base evaluation (CORRECTION04);
 * aggregate decisions live in `evaluateCommandPolicy`.
 *
 * Per-command precedence (highest restrictiveness wins per command):
 *   1. explicit deny rules  -> DENY  (host_hard_deny)
 *   2. explicit allow rules  -> ALLOW (host_mode_safe_only_rule, plus
 *                                the safe execution profile from the
 *                                matched rule's source)
 *   3. "all" mode            -> ALLOW (host_mode_all, no overlay)
 *   4. "safe-only" mode      -> ALLOW if a rule matches else ASK
 *                                (safe_only_rule / safe_only_fallthrough)
 *   5. "manual" mode         -> ASK   (host_mode_manual)
 */
function resolvePerCommand(
	commands: ReadonlyArray<NormalizedCommand>,
	auth: CommandHostAuthorization,
): PerCommandEvaluation[] {
	return commands.map((normalized, index) => {
		const evaluated = evaluateOne(normalized, auth);
		return { index, normalized, ...evaluated };
	});
}

function evaluateOne(
	command: NormalizedCommand,
	auth: CommandHostAuthorization,
): Omit<PerCommandEvaluation, "index" | "normalized"> {
	// 1. Explicit deny rules win absolutely.
	if (auth.explicitDenyRules && auth.explicitDenyRules.length > 0) {
		const rendered = renderNormalizedCommand(command);
		for (const rule of auth.explicitDenyRules) {
			if (rule.pattern.test(rendered)) {
				return {
					kind: "deny",
					source: "host_hard_deny",
					reason: `host deny rule matched: ${rule.source}`,
				};
			}
		}
	}

	const allowRules = auth.explicitAllowRules ?? [];

	// 2. Explicit allow rules (safe-only rule set).
	if (allowRules.length > 0) {
		const match = findSafeRuleMatch(command, allowRules);
		if (match) {
			// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
			// The R0 rule matched the command's argv shape (e.g.
			// "ls with reviewed options" / "find with stdout-only
			// actions"). Before we grant ALLOW, the workspace
			// path authority must confirm that every path operand
			// resolves inside an authorized workspace root.
			//
			// This is a STRICT SUBSET gate: it only removes
			// ALLOWs, never adds them. A command that was ASK
			// before this ACT remains ASK. A command that was
			// ALLOW with a path outside the workspace root
			// becomes ASK with the
			// `host_workspace_path_authority` source.
			//
			// The path authority is consulted only when the host
			// has supplied `workspaceRoots`. A host that does not
			// supply roots is treated as "no configuration", and
			// path-bearing commands fall through to ASK — this
			// closes the regression where a missing
			// `workspaceRoots` field was effectively equivalent
			// to "any path is allowed".
			//
			// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
			// REALPATH_WORKSPACE_CONFINEMENT (CORRECTION02):
			//
			// Production ALLOW eligibility for an R0 path-bearing
			// rule REQUIRES host-supplied realpath evidence. There
			// is NO V1 lexical fallback in the production ALLOW
			// path: when `pathAuthorityEvidence` is missing /
			// failed / operand-mismatched, the command falls
			// through to ASK with `host_workspace_realpath_authority`.
			//
			// CORRECTION01 had a regression here: when evidence
			// construction failed (`buildPathAuthorityEvidence`
			// returned `ok:false`), the host code DID NOT pass
			// evidence to the policy, and the policy fell back to
			// the V1 lexical gate. V1 lexical ALLOWs the symlink
			// escape the reviewer identified. CORRECTION02 closes
			// this by requiring evidence as a precondition for
			// ALLOW, regardless of whether the V1 lexical check
			// would have passed.
			//
			// The V1 lexical primitives (`isLexicallyContained`,
			// `evaluateCommandPathConformance`) remain in the SDK
			// for unit-testing and diagnostics, but they are no
			// longer part of the canonical command policy's
			// production ALLOW path.
			//
			// Operand identity binding (CORRECTION02): the
			// evidence's `operands[i].operand` MUST equal the
			// extracted `expectedOperands[i]` verbatim. This
			// closes the "evidence-for-different-command" attack
			// where an attacker reuses a single-operand ALLOW
			// evidence record for a different single-operand
			// command.
			if (isR0ReadonlyRuleSource(match.source)) {
				const evidence = auth.pathAuthorityEvidence;
				// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01:
				// dispatch per-safe-rule-source so commands like
				// `head -n 30 FILE` produce an `expectedOperands`
				// list of `[FILE]` (not `[30, FILE]`). The
				// generic `extractPathOperands` returns
				// `[30, FILE]` which would fail operand identity
				// binding on evidence `[FILE]` and force ASK.
				const expectedOperands = extractR0PathOperands(
					command,
					match.source,
				);
				if (evidence === undefined) {
					return {
						kind: "ask",
						source: "host_workspace_realpath_authority",
						reason: "workspace realpath authority: host did not supply pathAuthorityEvidence; R0 path-bearing commands cannot be ALLOW'd without realpath evidence (CORRECTION02)",
					};
				}
				// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01:
				// V1 authority-context binding (the V2 binder
				// does the same check; V1 must not be a
				// weaker gate). The evidence's `roots` set
				// MUST equal the current authorization's
				// `workspaceRoots` by canonical-form set-
				// equality; otherwise an evidence record from
				// a broader scope would unlock ALLOW under a
				// narrower current authority (capability
				// reuse across root sets, the exact
				// CORRECTION04 attack on the pipe path).
				if (
					auth.workspaceRoots === undefined ||
					auth.workspaceRoots.length !== evidence.roots.length
				) {
					return {
						kind: "ask",
						source: "host_workspace_realpath_authority",
						reason: "workspace realpath authority: host authority workspaceRoots do not match evidence.roots; R0 path-bearing commands cannot be ALLOW'd with mismatched authority scope (CORRECTION04 invariant)",
					};
				}
				for (let i = 0; i < auth.workspaceRoots.length; i++) {
					if (auth.workspaceRoots[i] !== evidence.roots[i]) {
						return {
							kind: "ask",
							source: "host_workspace_realpath_authority",
							reason: `workspace realpath authority: host authority roots[${i}] ("${auth.workspaceRoots[i]}") does not match evidence.roots[${i}] ("${evidence.roots[i]}"); stale evidence scope rejected (CORRECTION04 invariant)`,
						};
					}
				}
				// cwd binding: the evidence's `cwd` must equal
				// the current authorization's `cwd` exactly
				// (host-side canonicalization in
				// `buildPathAuthorityEvidence` ensures both
				// are realpath strings).
				if (auth.cwd !== evidence.cwd) {
					return {
						kind: "ask",
						source: "host_workspace_realpath_authority",
						reason: `workspace realpath authority: host authority cwd ("${auth.cwd ?? "<undefined>"}") does not match evidence.cwd ("${evidence.cwd ?? "<null>"}"); stale cwd rejected (CORRECTION04 invariant)`,
					};
				}
				if (evidence.operands.length !== expectedOperands.length) {
					return {
						kind: "ask",
						source: "host_workspace_realpath_authority",
						reason: `workspace realpath authority: host evidence operand count (${evidence.operands.length}) does not match command operand count (${expectedOperands.length})`,
					};
				}
				// Operand identity binding: each evidence operand
				// must exactly equal the command's extracted
				// operand at the same index.
				for (let i = 0; i < expectedOperands.length; i++) {
					const expected = expectedOperands[i]!;
					const actual = evidence.operands[i]?.operand;
					if (actual !== expected) {
						return {
							kind: "ask",
							source: "host_workspace_realpath_authority",
							reason: `workspace realpath authority: host evidence operand[${i}] ("${actual ?? "<missing>"}") does not match command operand ("${expected}")`,
						};
					}
				}
				const conformance = evaluateCommandRealpathConformance(evidence);
				if (!conformance.conforming) {
					const nonconforming = conformance.operands.find(
						(o) => !o.result.conforming,
					);
					const reason = nonconforming
						? `workspace realpath authority: operand "${nonconforming.operand}" resolves to "${nonconforming.result.resolvedRealPath ?? "unresolved"}" outside configured workspace roots (${nonconforming.result.reason ?? "unknown"}, hostReason=${nonconforming.result.hostReason})`
						: `workspace realpath authority: at least one path operand is outside configured workspace roots`;
					return {
						kind: "ask",
						source: "host_workspace_realpath_authority",
						reason,
					};
				}
			}
			const profile = getSafeExecutionProfileForSource(match.source);
			return {
				kind: "allow",
				source: "host_mode_safe_only_rule",
				reason: `host-proven safe (${match.source})`,
				matchedRuleSource: match.source,
				safeExecutionProfile: profile,
			};
		}
	}

	// 3. Mode-based resolution.
	switch (auth.mode) {
		case "all":
			return {
				kind: "allow",
				source: "host_mode_all",
				reason: "user enabled execute-all-commands mode",
			};
		case "safe-only":
			return {
				kind: "ask",
				source: "host_mode_safe_only_fallthrough",
				reason: "safe-only mode did not match any host safe rule",
			};
		case "manual":
		default:
			return {
				kind: "ask",
				source: "host_mode_manual",
				reason: "manual mode requires approval",
			};
	}
}

function aggregateLattice(
	perCommand: PerCommandEvaluation[],
): CommandDecisionKind {
	let anyAsk = false;
	let anyDeny = false;
	let anyAllow = false;
	for (const ev of perCommand) {
		if (ev.kind === "deny") {
			anyDeny = true;
		} else if (ev.kind === "ask") {
			anyAsk = true;
		} else {
			anyAllow = true;
		}
	}
	if (anyDeny) {
		return "deny";
	}
	if (anyAsk) {
		return "ask";
	}
	return anyAllow ? "allow" : "ask";
}

function aggregateReason(perCommand: PerCommandEvaluation[]): string {
	if (perCommand.length === 1) {
		return perCommand[0]?.reason ?? "policy result";
	}
	const allowed: string[] = [];
	const asked: string[] = [];
	const denied: string[] = [];
	perCommand.forEach((ev, idx) => {
		const label = `[${idx}] ${ev.matchedRuleSource ?? ev.source}`;
		if (ev.kind === "allow") {
			allowed.push(label);
		} else if (ev.kind === "ask") {
			asked.push(label);
		} else {
			denied.push(label);
		}
	});
	const parts: string[] = [];
	if (allowed.length > 0) {
		parts.push(`auto-allow: ${allowed.join(", ")}`);
	}
	if (asked.length > 0) {
		parts.push(`needs-approval: ${asked.join(", ")}`);
	}
	if (denied.length > 0) {
		parts.push(`denied: ${denied.join(", ")}`);
	}
	return parts.join("; ");
}

function aggregateSource(
	perCommand: PerCommandEvaluation[],
	auth: CommandHostAuthorization,
): CommandDecisionSource {
	if (perCommand.length === 1) {
		return perCommand[0]!.source;
	}
	let anyDeny = false;
	let anyManual = false;
	let anySafeOnlyFallthrough = false;
	let anySafeOnlyRule = false;
	let anyAll = false;
	let anyWorkspacePathAuthority = false;
	let anyWorkspaceRealpathAuthority = false;
	for (const ev of perCommand) {
		if (ev.kind === "deny") {
			anyDeny = true;
		} else if (ev.source === "host_mode_manual") {
			anyManual = true;
		} else if (ev.source === "host_mode_safe_only_fallthrough") {
			anySafeOnlyFallthrough = true;
		} else if (ev.source === "host_mode_safe_only_rule") {
			anySafeOnlyRule = true;
		} else if (ev.source === "host_mode_all") {
			anyAll = true;
		} else if (ev.source === "host_workspace_path_authority") {
			anyWorkspacePathAuthority = true;
		} else if (ev.source === "host_workspace_realpath_authority") {
			anyWorkspaceRealpathAuthority = true;
		}
	}
	if (anyDeny) {
		return "host_hard_deny";
	}
	if (anyManual) {
		return "host_mode_manual";
	}
	// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	// REALPATH_WORKSPACE_CONFINEMENT:
	// Realpath authority is the most specific path authority
	// downgrade reason, so it takes precedence in the
	// multi-command aggregate (over the V1 lexical-only
	// `host_workspace_path_authority` source and over the generic
	// safe-only fallthrough).
	if (anyWorkspaceRealpathAuthority) {
		return "host_workspace_realpath_authority";
	}
	// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
	// A workspace path authority downgrade is a more specific
	// reason for ASK than the generic safe-only fallthrough, so
	// it takes precedence in the multi-command aggregate.
	if (anyWorkspacePathAuthority) {
		return "host_workspace_path_authority";
	}
	if (anySafeOnlyFallthrough) {
		return "host_mode_safe_only_fallthrough";
	}
	if (anySafeOnlyRule) {
		return "host_mode_safe_only_rule";
	}
	if (anyAll || auth.mode === "all") {
		return "host_mode_all";
	}
	return "host_mode_manual";
}

/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01
 * ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
 *
 * Set of safe-rule sources that are R0 read-only and therefore
 * subject to the workspace path authority gate. The R0 family
 * today is:
 *   - `host_safe_ls`            (parent ACT)
 *   - `host_safe_find`          (parent ACT)
 *   - `host_safe_cat`           (READER ACT)
 *   - `host_safe_head_path`     (READER ACT; stdin-only head
 *                                is a separate V2 path)
 *   - `host_safe_tail_path`     (READER ACT; stdin-only tail
 *                                is a separate V2 path)
 *
 * pwd/git_* are NOT included because they either take no path
 * operands (pwd, git status, git log, git diff, git rev-parse)
 * or operate on an in-tree repository rooted at the host cwd by
 * design (git show/rev-list/branch).
 *
 * Adding a new R0 family that takes path operands MUST also
 * add its source here so the path gate fires for it.
 */
const R0_READONLY_PATH_BEARING_SOURCES: ReadonlySet<string> = new Set([
	"host_safe_ls",
	"host_safe_find",
	"host_safe_cat",
	"host_safe_head_path",
	"host_safe_tail_path",
]);

function isR0ReadonlyRuleSource(source: string): boolean {
	return R0_READONLY_PATH_BEARING_SOURCES.has(source);
}

/**
 * CORRECTION02: export the predicate so the V2 structured
 * classifier (`structured-command-risk.ts`) can also recognize
 * path-bearing leaves in pipe/and/or composition. Before this
 * export, only V1's per-command resolution could consult the
 * R0 set; the V2 aggregator returned `aggregated-pipe` /
 * `aggregated-and` / `aggregated-or`, hiding the constituent
 * leaves. A pipe `ls <path> | head -30` was therefore ALLOW-able
 * via parser-proven promotion of the `head` leaf even when no
 * path-authority evidence existed for the `ls` operand, because
 * V1 sees the pipe as one opaque shape and emits
 * `host_mode_safe_only_fallthrough` (which IS in the promotable
 * set), and V2 sees a parser-proven `head` leaf.
 *
 * This is the surgical seam that closes the new positive-V2-
 * capability bypass without changing V1's pipe handling.
 */
export function isR0PathBearingRuleSource(source: string): boolean {
	return R0_READONLY_PATH_BEARING_SOURCES.has(source);
}

export { buildCommandExecutionPlan } from "./command-execution-plan";
export {
	type CommandModelHint,
	type CommandModelHints,
	parseCommandModelHints,
	renderNormalizedCommand,
} from "./command-model-hints";
export {
	type CommandDecision,
	type CommandDecisionKind,
	type CommandDecisionSource,
	type CommandHostAllowRule,
	type CommandHostAuthorization,
	type CommandHostMode,
	commandHostAuthorization,
	type EvaluateCommandPolicyResult,
	type EvaluatedCommand,
	isMoreRestrictive,
	maxRestrictive,
	type NormalizationResult,
	type NormalizedCommand,
	type NormalizedCommands,
	type NormalizedFailure,
} from "./command-policy-types";
export {
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	findSafeRuleMatch,
	isOpaqueShellRendered,
	OPAQUE_SHELL_TOKENS,
} from "./command-safe-rules";

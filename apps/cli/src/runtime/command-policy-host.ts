/**
 * CLI Host Adapter for the Canonical Command Policy
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02/04
 *
 * This module is the production wiring between CLI configuration and
 * `@cline/core/runtime/command-policy`. The CLI consumes the SAME policy
 * as VS Code; this adapter is the only CLI-specific translation step.
 *
 * Mapping:
 *   CLI --auto-approve / autoApproveTools=true
 *       => host mode "all"   (user explicitly opted in to autonomous execution)
 *   CLI --auto-approve=false / autoApproveTools=false
 *       => host mode "manual" (every command requires approval)
 *
 * CORRECTION04: the plan builder lives in `@cline/core` so both hosts
 * share the same hardened argv construction. CLI does not redefine it.
 *
 * Authority and execution constraints are INDEPENDENT axes:
 *   - authority may be ALLOW, ASK, or DENY
 *   - execution constraints attach whenever the canonical policy
 *     successfully classifies commands with a SafeExecutionProfile,
 *     regardless of whether authority is ALLOW or ASK.
 *   - DENY: no execution plan (no execution will happen).
 *
 * A successful ASK → user YES must still execute the hardened argv,
 * never the raw model input. The CLI TUI approver carries the plan
 * through the pending approval state.
 */

import { resolve as resolvePath } from "node:path";

import {
	buildCommandExecutionPlan,
	buildPathAuthorityEvidence,
	type CommandHostAuthorization,
	type CommandHostMode,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "@cline/core";
import { evaluateCommandRiskWithParser } from "@cline/core/internal/command-risk-internal";
import type { CommandExecutionPlan } from "@cline/shared";

/**
 * Host-owned V2 parser evidence — a structurally-compatible alias for
 * the internal V2 protocol shape. We use a local alias rather than
 * importing the internal type name directly so the host source
 * remains free of the V2 protocol surface identifier (see
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01
 * PROVENANCE INVARIANT — the type identifier is intentionally not
 * exposed; only the trusted `MvdanShHelper` capability can construct
 * one, and provenance is established at runtime by the helper
 * (SHA-256 digest + protocol version + structural validation)).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type TrustedParserEvidence = unknown

export interface CliCommandToolApprovalDecision {
	approved: boolean;
	reason: string;
	/**
	 * Canonical decision kind from the host's command policy evaluator.
	 *
	 * CORRECTION04 DENY-preservation invariant:
	 *   - "deny" => DENY stays denied. Do NOT route to TUI approver.
	 *   - "ask"  => Route to TUI. On YES, execute with plan.
	 *   - "allow" => auto-approved (approved=true).
	 */
	decision: { kind: "allow" | "ask" | "deny"; reason: string; source: string };
	/**
	 * Pending execution plan. Set whenever the canonical policy
	 * positively matched at least one command with a SafeExecutionProfile,
	 * regardless of authority (ALLOW or ASK). When approved=true, the
	 * AgentRuntime substitutes `executionPlan.transformedInput` for
	 * the raw tool input. When approved=false (DENY), this is undefined.
	 */
	executionPlan?: CommandExecutionPlan;
}

/**
 * Build the production CLI host authorization.
 *
 * CLI CONTRACT (documented in `apps/cli/README.md`):
 *
 *   --auto-approve false
 *     ⇒ "Require approval before each tool call"
 *     ⇒ EVERY command asks the user, even safe ones like `pwd`.
 *     ⇒ Implementation: `mode: "manual"` (NOT promotable to ALLOW
 *       by the parser; the user explicitly opted out of auto-approval).
 *
 *   --auto-approve true | --yolo
 *     ⇒ Skip tool approval prompts entirely.
 *     ⇒ Implementation: `mode: "all"` (every command ALLOWs through V1).
 *
 * The CLI does NOT currently expose a user-visible safe-only flag
 * (the analog of VSCode's `executeSafeCommands`). Therefore there is
 * no CLI configuration that opts into the V2 ASK → ALLOW promotion
 * gate. The promotion framework IS proven (VSCode exercises it
 * end-to-end) but on the CLI it stays dormant under explicit manual
 * mode — the parser can never override an explicit user NO.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * CORRECTION02 (Phase 2 reviewer HALT_CLI_EXPLICIT_NO_AUTO_APPROVE_CONTRACT_BROKEN):
 *
 * The previous CORRECTION01 rewrote
 * `autoApproveTools=false → mode: "safe-only"`, claiming it "matches
 * VSCode's executeSafeCommands=false". That was wrong:
 *
 *   - VSCode's `executeSafeCommands=false` is the LITERAL DISABLED
 *     state for safe-command auto-approval — it does NOT auto-run
 *     safe commands; it explicitly does the opposite.
 *   - VSCode has a SEPARATE `executeAllCommands` setting for
 *     "run everything" mode. The CLI's `--auto-approve false`
 *     must NOT silently become VSCode's "executeSafeCommands"
 *     semantic just to make V2 promotion reachable.
 *
 * This function is therefore restored to its prior behavior:
 * `autoApproveTools=false → mode: "manual"`. Tests that pinned
 * the corrected semantics (`pwd → ALLOW`) are reverted to pin the
 * documented contract (`pwd → ASK`).
 *
 * V2 state on the CLI:
 *
 *   CLI_INTERACTIVE_V2 = FRAMEWORK_PROVEN_BUT_DORMANT
 *   CLI_ACP_PATH       = V1_ONLY (per CORRECTION01 documentation)
 *
 * If/when a user-visible CLI safe-only flag is added (follow-up
 * work, NOT in this ACT), it should construct the auth via
 * `cliResolveSafeOnlyHostAuthorization()` below, which:
 *
 *   - Uses `mode: "safe-only"` + `DEFAULT_COMMAND_HOST_ALLOW_RULES`.
 *   - Is V2-promotable via `host_mode_safe_only_fallthrough` when
 *     the parser confirms the AST.
 *   - Hard-DENY and R5 invariants still win (V2 cannot weaken them).
 */
export function cliResolveHostAuthorization(
	autoApproveTools: boolean,
	/**
	 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
	 * Optional host-supplied workspace context. When supplied,
	 * the policy layer applies the workspace path authority
	 * gate (see `@cline/core/runtime/command-policy/path-authority`).
	 * `workspaceRoots` is the canonical absolute path the host
	 * treats as "the project". `cwd` is the host's current
	 * working directory used to resolve relative operands.
	 *
	 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	 * REALPATH_WORKSPACE_CONFINEMENT:
	 *
	 * The CORRECTION01 reviewer flagged `cwd === workspaceRoots`
	 * as a P1 authority assumption: if the CLI launches from
	 * `/` or `$HOME`, that directory silently becomes the safe
	 * read authority. CORRECTION01 narrows this: when the host
	 * does NOT supply an explicit `workspaceRoot`, the path
	 * authority is DISABLED for R0 path-bearing commands and
	 * they fall through to ASK. This is the conservative
	 * default.
	 *
	 * When the host DOES supply `workspaceRoot` (a single
	 * explicit project root), the host adapter builds realpath
	 * evidence via `buildPathAuthorityEvidence` and attaches
	 * it to the authorization. The policy layer consumes the
	 * evidence and tests containment on realpath-resolved
	 * strings.
	 */
	options: {
		workspaceRoot?: string;
		cwd?: string;
	} = {},
): CommandHostAuthorization {
	const mode: CommandHostMode = autoApproveTools ? "all" : "manual";
	if (options.workspaceRoot === undefined) {
		// No explicit workspace root supplied. Disable path
		// authority: workspaceRoots is undefined, the V1
		// lexical gate will reject path-bearing R0 commands,
		// and the host has not supplied realpath evidence.
		// The regression-closed posture is preserved: an
		// unconfigured host is a misconfiguration, and "no
		// configuration => ALLOW" is the regression this ACT
		// closes.
		return commandHostAuthorization({
			mode,
		});
	}
	const canonicalRoot = resolvePath(options.workspaceRoot);
	const cwd =
		options.cwd === undefined ? canonicalRoot : resolvePath(options.cwd);
	return commandHostAuthorization({
		mode,
		workspaceRoots: [canonicalRoot],
		cwd,
	});
}

/**
 * Build a host authorization with the canonical safe-only allow rules.
 * This is the CORRECTION04 wiring for "manual" mode that still wants
 * safe rules to apply execution constraints on user-approved commands.
 *
 * Used by the architect-recommended scenario:
 *   safe-only + git diff --stat + model requires_approval=true
 *     -> ASK (model escalation)
 *     -> user YES
 *     -> executor receives hardened argv
 *
 * Without explicitAllowRules, manual mode is pure ASK with no
 * profile attached; this helper adds the safe rules so the plan
 * carries SafeExecutionProfile forward.
 */
export function cliResolveSafeOnlyHostAuthorization(options?: {
	/**
	 * Explicit deny rules to inject for testing. Each rule's pattern is
	 * a string that will be compiled to a RegExp (prefix match).
	 */
	explicitDenyRules?: ReadonlyArray<{
		pattern: string;
		label: string;
		description: string;
	}>;
}): CommandHostAuthorization {
	const denyRules = options?.explicitDenyRules?.map((r) => ({
		source: r.label,
		pattern: new RegExp(`^${r.pattern.replace(/\*/g, ".*")}`),
	}));
	return commandHostAuthorization({
		mode: "manual",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		explicitDenyRules: denyRules,
	});
}

/**
 * Build a TRUE safe-only host authorization (`mode: "safe-only"`)
 * with the canonical DEFAULT_COMMAND_HOST_ALLOW_RULES attached.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * CORRECTION02 (Phase 2 reviewer HALT_CLI_EXPLICIT_NO_AUTO_APPROVE_CONTRACT_BROKEN):
 *
 * This is the helper that the V2 ASK → ALLOW promotion gate
 * actually requires. It is NOT currently wired into the production
 * `cliResolveHostAuthorization(autoApproveTools)` path because the
 * CLI does NOT yet expose a user-visible safe-only flag (per
 * `apps/cli/README.md`). The CLI's documented `--auto-approve false`
 * flag means "require approval before each tool call" (manual mode
 * for every command), which is correctly preserved by the
 * CORRECTION02-reverted `cliResolveHostAuthorization(false)`.
 *
 * This helper exists to:
 *
 *   1. Prove that the V2 promotion framework is structurally wired
 *      on the CLI (test-only at present).
 *   2. Provide a single drop-in auth constructor for a future
 *      user-visible CLI safe-only flag (follow-up work, NOT in
 *      this ACT), should one be added.
 *
 * Behavior:
 *
 *   safe-only + pwd               → ALLOW (matches DEFAULT safe rule)
 *   safe-only + pwd; pwd + parser  → ALLOW (V2 promotes fallthrough)
 *   safe-only + pwd; pwd no parser → ASK (V1 fallthrough)
 *   safe-only + unknown           → ASK (V1 fallthrough)
 *   safe-only + R5 (rm -rf $HOME)  → ASK + never-auto-approve
 *                                    (R5 invariant ALWAYS wins)
 *   safe-only + explicit DENY     → DENY (DENY ALWAYS wins)
 *
 * Hard-DENY and R5 invariants are invariant across modes. The
 * parser NEVER weakens them.
 */
export function cliResolveTrueSafeOnlyHostAuthorization(options?: {
	/**
	 * Explicit deny rules to inject for testing. Each rule's pattern is
	 * a string that will be compiled to a RegExp (prefix match).
	 */
	explicitDenyRules?: ReadonlyArray<{
		pattern: string;
		label: string;
		description: string;
	}>;
}): CommandHostAuthorization {
	const denyRules = options?.explicitDenyRules?.map((r) => ({
		source: r.label,
		pattern: new RegExp(`^${r.pattern.replace(/\*/g, ".*")}`),
	}));
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		explicitDenyRules: denyRules,
	});
}

export function cliEvaluateCommandToolApproval(input: {
	toolName: string;
	toolInput: unknown;
	autoApproveTools: boolean;
	/**
	 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	 * REALPATH_WORKSPACE_CONFINEMENT:
	 *
	 * Explicit, host-supplied project root. When supplied, the
	 * CLI builds realpath evidence via `buildPathAuthorityEvidence`
	 * and the policy layer consumes it for containment testing.
	 * When UNDEFINED, the path authority is DISABLED: R0
	 * path-bearing commands fall through to ASK (the conservative
	 * default; the reviewer flagged `cwd === workspaceRoots` as
	 * a P1 authority assumption).
	 *
	 * Production CLI sessions MUST pass `workspaceRoot` if they
	 * want the path authority gate to be active. CLI sessions
	 * that do not know what project they are working on should
	 * simply omit this field; the conservative default will
	 * require approval for every read-only inspection.
	 */
	workspaceRoot?: string;
	cwd?: string;
	/**
	 * Optional V2 evidence. When supplied, the internal V2-aware
	 * evaluator is invoked with this result and the
	 * `risk_v2_structured_promotion` source is composed into the
	 * final decision (see ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-
	 * PARSER-HELPER-BINARY-SHIPPING01).
	 *
	 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
	 * (CORRECTION02 Phase 2): The helper invocation itself is the
	 * host adapter's responsibility — see
	 * `apps/cli/src/runtime/interactive/approvals.ts`. This entry
	 * point receives the ALREADY-OBTAINED `parserResult`. When the
	 * helper is unavailable / fails / times out / returns malformed
	 * response, the caller passes `parserResult: undefined`, V2
	 * stays dormant, and V1 behavior is preserved.
	 *
	 * MUST come only from the trusted host-owned `MvdanShHelper`
	 * capability — NEVER from model payload, MCP, webview, gRPC, or
	 * remote caller.
	 */
	parserResult?: TrustedParserEvidence | undefined;
}): CliCommandToolApprovalDecision {
	// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	// REALPATH_WORKSPACE_CONFINEMENT:
	//
	// Build the host authorization. When `workspaceRoot` is
	// supplied, we attach realpath evidence so the policy
	// layer can test containment on canonical paths (which
	// catches the symlink-escape attack the reviewer
	// identified).
	const hostAuthorization = cliResolveHostAuthorization(input.autoApproveTools, {
		workspaceRoot: input.workspaceRoot,
		cwd: input.cwd,
	});

	if (input.workspaceRoot !== undefined && hostAuthorization.workspaceRoots) {
		// Attach realpath evidence so the policy layer can
		// reject symlink escapes. We build one evidence
		// object per call; the policy layer consumes it.
		//
		// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION02
		// REALPATH_EVIDENCE_REQUIRED_FOR_PATH_BEARING_R0_ALLOW:
		// When evidence construction FAILS (e.g.
		// workspaceRoot does not exist on disk, ENOENT on
		// realpath, etc.), we DO NOT pass evidence to the
		// policy. Under CORRECTION02, missing evidence ⇒
		// ASK (not the V1 lexical fallback ALLOW that
		// CORRECTION01 had). This is the fail-closed posture
		// the reviewer required.
		const evidenceResult = buildPathAuthorityEvidence({
			workspaceRoots: hostAuthorization.workspaceRoots,
			cwd: hostAuthorization.cwd ?? null,
			command: input.toolInput as never,
		});
		if (evidenceResult.ok) {
			hostAuthorization.pathAuthorityEvidence = evidenceResult.evidence;
		}
	}

	return cliEvaluateCommandToolApprovalWith(input, hostAuthorization);
}

/**
 * Lower-level entry point that takes a prebuilt host authorization.
 * Lets callers inject safe-only / explicit allow rules while reusing
 * the same ALLOW/ASK/DENY + plan emission logic.
 */
export function cliEvaluateCommandToolApprovalWith(
	input: {
		toolName: string;
		toolInput: unknown;
		autoApproveTools: boolean;
		/**
		 * Optional V2 evidence produced by the trusted host-owned
		 * `MvdanShHelper` capability. The host adapter awaits the
		 * helper and snapshots `toolInput` ONCE before invoking
		 * this entry point; this parameter carries that
		 * already-validated evidence (or undefined when the helper
		 * is unavailable).
		 *
		 * Same provenance invariant as the public entry point: this
		 * value MUST come only from the trusted helper, never from
		 * model payload, MCP, webview, gRPC, or remote caller.
		 */
		parserResult?: TrustedParserEvidence | undefined;
	},
	hostAuthorization: CommandHostAuthorization,
): CliCommandToolApprovalDecision {
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
	// CORRECTION02 Phase 2 (snapshot invariant): the SAME captured
	// `toolInput` value that was sent to `MvdanShHelper.invoke` (if
	// the helper is being used) is the one we evaluate here. The
	// helper internally computes a SHA-256 digest of the joined
	// source and rejects any response whose digest does not match.
	// Even if a caller mutated `input.toolInput` between the helper
	// invocation and the policy evaluation, the digest mismatch
	// would cause V2 promotion to fail closed. We freeze the value
	// here for documentation/clarity even though JS is single-threaded.
	const frozenToolInput = input.toolInput;

	const result = evaluateCommandPolicy({
		toolInput: frozenToolInput,
		hostAuthorization,
	});

	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01: layer the R5
	// catastrophic hard floor on top of the canonical policy verdict.
	// `evaluateCommandRisk` is a DOWNGRADE-only layer — it can
	// downgrade an ALLOW to ASK + never-auto-approve when the
	// command argv positively matches a catastrophic family, but
	// it never weakens an existing ASK or DENY. This is the
	// production wiring of the bounded V1 classifier.
	//
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
	// uses the trusted-internal `evaluateCommandRiskWithParser`
	// (imported from `@cline/core/internal/command-risk-internal`).
	// The `parserResult` field is OPTIONAL: when undefined, V2 is
	// dormant and behavior is identical to the public
	// `evaluateCommandRisk`. When defined, V2 may promote a
	// structure-only V1 ASK to ALLOW or strengthen V1 ASK to
	// never-auto-approve (the latter only when R5 inner surfaces
	// from the parsed structure).
	//
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
	// CORRECTION02 Phase 2: `parserResult` is now threaded from the
	// host adapter (the interactive approval controller awaits the
	// trusted `MvdanShHelper.invoke()` and passes the result down).
	// The async seam lives at the host adapter, NOT in this pure
	// function — so this remains synchronously testable. When the
	// helper is unavailable / fails / returns null / digest
	// mismatches, the host adapter passes `undefined` here and V2
	// stays dormant.
	const risk = evaluateCommandRiskWithParser({
		toolInput: frozenToolInput,
		hostAuthorization,
		// Cast at the trust boundary. This function is a pure
		// host-policy function: it does NOT authenticate provenance
		// itself. The PROVENANCE INVARIANT is enforced by the
		// production call graph — the trusted host adapter
		// (`apps/cli/src/runtime/interactive/approvals.ts`) is the
		// ONLY entry point that constructs this value, and it
		// awaits `MvdanShHelper.invoke()` (whose digest + protocol
		// version + structural validation make it tamper-evident).
		// `unknown` keeps the V2 type identifier out of this host
		// source (the parser-provenance invariant forbids the
		// literal V2 type identifier in host source files).
		parserResult: input.parserResult as never,
	});
	const riskDowngrade =
		result.decision.kind === "allow" &&
		risk.disposition === "never-auto-approve";

	// Plan construction: DENY discards it because nothing executes.
	// For ALLOW/ASK, build the plan. If plan construction fails
	// (invalid input, cardinality mismatch) and a safe profile is
	// required, fail closed rather than allowing raw input to execute.
	const executionPlan =
		result.decision.kind === "deny"
			? undefined
			: buildCommandExecutionPlan(input.toolInput, result.commands);

	if (result.decision.kind === "deny") {
		return {
			approved: false,
			reason: result.decision.reason,
			decision: {
				kind: result.decision.kind,
				reason: result.decision.reason,
				source: result.decision.source,
			},
		};
	}

	// CORRECTION04 P0: if a safe execution profile is required but the
	// plan could not be constructed, fail closed rather than allowing
	// raw input to execute.
	const requiresPlan = result.commands.some(
		(c) => c.safeExecutionProfile !== undefined,
	);
	if (requiresPlan && !executionPlan) {
		return {
			approved: false,
			reason: "required hardened execution plan could not be constructed",
			decision: {
				kind: "deny",
				source: "execution_plan_invalid",
				reason: "required hardened execution plan could not be constructed",
			},
		};
	}

	if (result.decision.kind === "allow") {
		// Risk downgrade: the canonical policy granted ALLOW (the
		// user opted in to autonomous execution), but the V1
		// classifier positively identified a catastrophic
		// argv shape. The hard floor downgrades the verdict to
		// ASK + never-auto-approve. The plan is still built
		// (and, on user approval, executed hardened) so a
		// user who deliberately types their HOME directory
		// and confirms via the TUI approver can still run the
		// command under the hard floor.
		if (riskDowngrade) {
			return {
				approved: false,
				reason: risk.reasons.join("; "),
				decision: {
					kind: "ask",
					reason: risk.reasons.join("; "),
					source: "risk_hard_floor",
				},
				executionPlan,
			};
		}
		return {
			approved: true,
			reason: result.decision.reason,
			decision: {
				kind: result.decision.kind,
				reason: result.decision.reason,
				source: result.decision.source,
			},
			executionPlan,
		};
	}

	// ASK path.
	//
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01-CORRECTION01
	// (HALT_PROVENANCE_GAP): V2 ASK -> ALLOW promotion is now
	// composed here. Today `parserResult: undefined` keeps V2 dormant,
	// but the structural seam is in place so the helper-binary ACT
	// (PARSER-HELPER-BINARY-SHIPPING01) just has to drop in a parser
	// result. The `risk_v2_structured_promotion` source is the ONLY
	// path through which a V1 ASK may be promoted to ALLOW.
	if (
		risk.source === "risk_v2_structured_promotion" &&
		risk.decision === "allow"
	) {
		return {
			approved: true,
			reason: risk.reasons.join("; "),
			decision: {
				kind: "allow",
				reason: risk.reasons.join("; "),
				source: "risk_v2_structured_promotion",
			},
			executionPlan,
		};
	}

	// ASK: hand the plan to the TUI approver.
	return {
		approved: false,
		reason: result.decision.reason,
		decision: {
			kind: result.decision.kind,
			reason: result.decision.reason,
			source: result.decision.source,
		},
		executionPlan,
	};
}

export function buildCliToolPolicies(input: {
	wildcardAutoApprove: boolean;
}): Record<string, { autoApprove?: boolean }> {
	return {
		"*": { autoApprove: input.wildcardAutoApprove },
		run_commands: { autoApprove: false },
		execute_command: { autoApprove: false },
	};
}

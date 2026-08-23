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

import {
	buildCommandExecutionPlan,
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

export function cliResolveHostAuthorization(
	autoApproveTools: boolean,
): CommandHostAuthorization {
	const mode: CommandHostMode = autoApproveTools ? "all" : "manual";
	return commandHostAuthorization({ mode });
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

export function cliEvaluateCommandToolApproval(input: {
	toolName: string;
	toolInput: unknown;
	autoApproveTools: boolean;
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
	const hostAuthorization = cliResolveHostAuthorization(input.autoApproveTools);
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
		// Cast at the trust boundary. The caller has already
		// validated that this value came from `MvdanShHelper.invoke()`
		// (see `apps/cli/src/runtime/interactive/approvals.ts`); the
		// helper enforces SHA-256 digest + protocol version +
		// structural validation. `unknown` keeps the V2 type
		// identifier out of this host source (PROVENANCE INVARIANT).
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

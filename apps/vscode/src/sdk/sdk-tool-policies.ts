import {
	buildCommandExecutionPlan,
	type CommandDecision,
	type CommandHostAuthorization,
	type CommandHostMode,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	type EvaluatedCommand,
	evaluateCommandPolicy,
	evaluateCommandRisk,
} from "@cline/core"
import type { CommandExecutionPlan } from "@cline/shared"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { McpHub } from "@/services/mcp/McpHub"
import type { SessionAutoApprovalOverride } from "./session-auto-approval"

/**
 * Build SDK `toolPolicies` for tools governed by Cline's auto-approval UI.
 *
 * The SDK defaults unlisted tools to auto-approved. For tools controlled by
 * AutoApproveBar/MCP per-tool settings, force the SDK to call
 * `requestToolApproval`; the approval callback then evaluates the latest
 * settings and either silently approves or shows the approval UI. This keeps
 * active sessions in sync when the user toggles auto-approval mid-task.
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02:
 * The command policy lives in `@cline/core/runtime/command-policy`. This
 * module adapts the VS Code `AutoApprovalSettings` shape into the canonical
 * `CommandHostAuthorization` form and routes command-tool decisions through
 * the same `evaluateCommandPolicy()` used by the CLI.
 *
 * CRITICAL: Command tools are subject to host command policy evaluation.
 * The `requires_approval` model hint is advisory only - it can escalate
 * but never downgrade host authority.
 */
export function buildToolPolicies(
	_settings: AutoApprovalSettings,
	mcpHub?: McpHub,
): Record<string, { enabled?: boolean; autoApprove?: boolean }> {
	const policies: Record<string, { enabled?: boolean; autoApprove?: boolean }> = {}

	const set = (tools: string[]) => {
		for (const tool of tools) {
			policies[tool] = { autoApprove: false }
		}
	}

	set(["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"])
	set(["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"])
	set(["run_commands", "execute_command", "cancel_command"])
	set(["fetch_web_content", "web_fetch", "web_search"])

	if (mcpHub) {
		for (const server of mcpHub.getServers()) {
			for (const tool of server.tools ?? []) {
				const sdkName = `${server.name}__${tool.name}`
				policies[sdkName] = { autoApprove: false }
			}
		}
	}

	return policies
}

export function isReadTool(toolName: string): boolean {
	return ["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"].includes(
		toolName,
	)
}

export function isEditTool(toolName: string): boolean {
	return ["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"].includes(toolName)
}

export function isCommandTool(toolName: string): boolean {
	return toolName === "run_commands" || toolName === "execute_command" || toolName === "cancel_command"
}

function isBrowserTool(toolName: string): boolean {
	return toolName === "fetch_web_content" || toolName === "web_fetch" || toolName === "web_search"
}

function parseMcpToolName(toolName: string): { serverName: string; toolName: string } | undefined {
	const separatorIndex = toolName.indexOf("__")
	if (separatorIndex <= 0) return undefined
	const serverName = toolName.substring(0, separatorIndex)
	const mcpToolName = toolName.substring(separatorIndex + 2)
	if (!mcpToolName) return undefined
	return { serverName, toolName: mcpToolName }
}

/**
 * Evaluate the current UI auto-approval settings for a single SDK tool name.
 * Used both when building initial SDK policies and as a live guard in the
 * approval callback, so changes from the AutoApproveBar are respected even if
 * an SDK session was created before the toggle changed.
 *
 * For command tools, this returns the host "mode" — NOT a boolean. The
 * caller is responsible for passing that mode into the command policy.
 */
export function getCommandHostAuthorization(
	toolName: string,
	settings: AutoApprovalSettings,
	_mcpHub?: McpHub,
): CommandHostAuthorization {
	if (isCommandTool(toolName)) {
		// `cancel_command` is mutating (terminates a process tree) but
		// has no command-shaped input. It must follow the user's
		// executeSafeCommands setting too: cancel is part of the
		// command-execution authority boundary, so the same safe-only
		// rules apply (the user must have opted in to auto-approve
		// command execution for cancel to be auto-approved as well).
		// In `manual` mode, cancel_command goes through the normal
		// ASK path and surfaces as an unparseable command for the
		// canonical policy, which the host treats as a confirmation
		// prompt. The executeSafeCommands toggle is therefore the
		// authoritative gate: off -> ASK; on -> ALLOW.
		if (settings.actions.executeSafeCommands) {
			return commandHostAuthorization({
				mode: "safe-only",
				explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			})
		}
		return commandHostAuthorization({ mode: "manual" })
	}
	// For non-command tools, the auto-approve toggle is a
	// simple boolean. We only return the authorization mode when
	// the tool is a command tool; callers should not use this
	// function for non-command tools.
	return commandHostAuthorization({ mode: "manual" })
}

/**
 * Evaluate whether a specific command tool call should be auto-approved.
 *
 * This function applies the complete command policy:
 * 1. Host command authorization (derived from user settings)
 * 2. Model `requires_approval` hint (as advisory escalation only)
 *
 * The model hint CANNOT downgrade host authority. If the host classifies
 * a command as requiring approval (ASK) or dangerous, the model cannot
 * override this by setting `requires_approval=false`.
 *
 * @returns Object containing:
 *   - approved: whether the command can execute without explicit user approval
 *   - decision: the full CommandDecision with reason and source
 */
export function evaluateCommandToolApproval(
	toolInput: unknown,
	hostAuthorization: CommandHostAuthorization,
): { approved: boolean; decision: CommandDecision } {
	// Always enforce dangerous classification for host safety
	const result = evaluateCommandPolicy({
		toolInput,
		hostAuthorization,
	})

	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01-CORRECTION01:
	// Layer the R5 catastrophic hard floor on top of the canonical
	// policy verdict. `evaluateCommandRisk` is a DOWNGRADE-only
	// layer — it can downgrade an ALLOW to ASK when the command
	// argv positively matches a catastrophic family, but it never
	// weakens an existing ASK or DENY. The hard floor is
	// identical to the CLI's. The motivating ClineMM incident
	// surface is VSCodium (i.e. this host), not CLI, so this
	// wiring is the load-bearing safety invariant.
	if (
		result.decision.kind === "allow" &&
		evaluateCommandRisk({
			toolInput,
			hostAuthorization,
		}).disposition === "never-auto-approve"
	) {
		return {
			approved: false,
			decision: {
				kind: "ask",
				reason: "R5 catastrophic hard floor: never auto-approve",
				source: "risk_hard_floor",
			},
		}
	}

	return {
		approved: result.decision.kind === "allow",
		decision: result.decision,
	}
}

/**
 * Validate that an input looks like a `cancel_command` invocation.
 *
 * Shape: `{ jobId: string, ... }`. Anything else is rejected with a
 * DENY (the model cannot elicit mutation through a malformed input).
 *
 * ACT-CLINEMM-TRUSTED-BOUNDED-COMMAND-EXECUTION01-CORRECTION02:
 * `cancel_command` is a job-control capability, not a shell command.
 * It MUST NOT be routed through the canonical run_commands normalizer,
 * because the canonical normalizer returns ASK on unparseable input
 * regardless of host mode — including mode `all`. That would prevent
 * even YOLO sessions from cancelling their own jobs.
 */
export function isCancelCommandInput(input: unknown): boolean {
	if (input === null || typeof input !== "object") return false
	const record = input as Record<string, unknown>
	return typeof record.jobId === "string" && record.jobId.length > 0
}

/**
 * Evaluate the authority decision for a `cancel_command` invocation.
 *
 * This is the dedicated job-control authority path. It does NOT route
 * through `evaluateCommandPolicy` because cancel_command has no
 * command-shaped input — it has a jobId. The matrix is:
 *
 *   - explicit hard host DENY rule (when/if cancellation is denied at
 *     the host level)         → DENY (host_hard_deny)
 *   - malformed input          → DENY (unknown_input)
 *   - host mode `manual`       → ASK  (host_mode_manual)
 *   - host mode `safe-only`    → ALLOW (host_mode_safe_only_rule)
 *   - host mode `all`          → ALLOW (host_mode_all)
 *
 * Model escalation via `requires_approval` is intentionally ignored:
 * cancel_command has no command field for the model to evaluate, and
 * a model advisory hint cannot override the user's explicit authority.
 *
 * The result is observable: the same authority matrix that protects
 * `run_commands` (manual=ASK, safe-only=ALLOW, all=ALLOW) without
 * false-ASK for unparseable input.
 */
export function evaluateCancelCommandToolApproval(
	toolInput: unknown,
	hostAuthorization: CommandHostAuthorization,
): { approved: boolean; decision: CommandDecision } {
	// Input shape check first — malformed input is a hard DENY.
	if (!isCancelCommandInput(toolInput)) {
		return {
			approved: false,
			decision: {
				kind: "deny",
				reason: "cancel_command input must be a non-empty object with a string jobId",
				source: "unknown_input",
			},
		}
	}
	// Hard host DENY. The current production deny rules are empty
	// (no production deny source), but the branch is here so future
	// hard-deny sources compose without re-architecting this function.
	// The exact same explicitDenyRules pattern runs in the canonical
	// shell-command policy; the only difference is which calls those
	// rules are evaluated against.
	const denyRules = hostAuthorization.explicitDenyRules ?? []
	if (denyRules.length > 0) {
		const probeInput = JSON.stringify(toolInput)
		for (const rule of denyRules) {
			if (rule.pattern.test(probeInput)) {
				return {
					approved: false,
					decision: {
						kind: "deny",
						reason: `cancel denied by host rule ${rule.source}`,
						source: "host_hard_deny",
					},
				}
			}
		}
	}
	// Authority matrix by host mode.
	const mode: CommandHostMode = hostAuthorization.mode
	if (mode === "all") {
		return {
			approved: true,
			decision: {
				kind: "allow",
				reason: "host mode allows all command controls",
				source: "host_mode_all",
			},
		}
	}
	if (mode === "safe-only") {
		return {
			approved: true,
			decision: {
				kind: "allow",
				reason: "host mode safe-only permits cancelling a host-owned job",
				source: "host_mode_safe_only_rule",
			},
		}
	}
	// manual mode (default): every cancel requires user confirmation.
	return {
		approved: false,
		decision: {
			kind: "ask",
			reason: "host mode manual requires user confirmation to cancel a command",
			source: "host_mode_manual",
		},
	}
}

/**
 * CORRECTION04: Evaluate a command tool call AND return the per-command
 * hardened execution plan. The plan is attached to the approval result so
 * the SDK AgentRuntime can substitute the hardened argv at the execution
 * boundary. Mirrors `cliEvaluateCommandToolApproval` in
 * `@cline/cli/runtime/command-policy-host.ts`.
 *
 * Authority and execution constraints are INDEPENDENT axes:
 *   - authority may be ALLOW, ASK, or DENY
 *   - execution constraints attach whenever the canonical policy
 *     successfully classifies commands, regardless of whether
 *     authority is ALLOW or ASK.
 *   - DENY: no execution plan (no execution will happen).
 *
 * A successful ASK -> user YES must still execute the hardened argv,
 * never the raw model input. The host coordinator (VS Code) carries
 * the plan through the pending approval state.
 */
/**
 * Optional seam for testing: override the execution plan builder.
 * Allows tests to simulate planner failure without mocking internals.
 */
export interface EvaluateCommandToolApprovalWithPlanOptions {
	/**
	 * Inject a custom execution plan builder. When provided, the adapter
	 * calls this instead of `buildCommandExecutionPlan`. Return `undefined`
	 * to simulate a planner failure (e.g., cardinality mismatch).
	 */
	buildExecutionPlanOverride?: (toolInput: unknown, commands: readonly EvaluatedCommand[]) => CommandExecutionPlan | undefined
}

export function evaluateCommandToolApprovalWithPlan(
	toolInput: unknown,
	hostAuthorization: CommandHostAuthorization,
	options?: EvaluateCommandToolApprovalWithPlanOptions,
): {
	approved: boolean
	decision: CommandDecision
	executionPlan?: CommandExecutionPlan
} {
	const result = evaluateCommandPolicy({
		toolInput,
		hostAuthorization,
	})
	// Plan construction: DENY discards it because nothing executes.
	// For ALLOW/ASK, build the plan. If plan construction fails
	// (invalid input, cardinality mismatch) and a safe profile is
	// required, fail closed — do not let raw input execute.
	const planBuilder = options?.buildExecutionPlanOverride ?? buildCommandExecutionPlan
	const executionPlan = result.decision.kind === "deny" ? undefined : planBuilder(toolInput, result.commands)
	if (result.decision.kind === "deny") {
		return { approved: false, decision: result.decision }
	}
	// CORRECTION04 P0: if a safe execution profile is required but the
	// plan could not be constructed, fail closed rather than allowing
	// raw input to execute. This is an internal invariant violation —
	// the classifier matched a rule but the planner could not produce
	// a hardened argv.
	const requiresPlan = result.commands.some((c) => c.safeExecutionProfile !== undefined)
	if (requiresPlan && !executionPlan) {
		return {
			approved: false,
			decision: {
				kind: "deny",
				source: "execution_plan_invalid",
				reason: "required hardened execution plan could not be constructed",
			},
		}
	}
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01-CORRECTION01:
	// Layer the R5 catastrophic hard floor on top of the canonical
	// policy verdict. `evaluateCommandRisk` is a DOWNGRADE-only
	// layer — it can downgrade an ALLOW to ASK when the command
	// argv positively matches a catastrophic family, but it never
	// weakens an existing ASK or DENY. The hard floor is
	// identical to the CLI's. The motivating ClineMM incident
	// surface is VSCodium (i.e. this host), not CLI, so this
	// wiring is the load-bearing safety invariant. The execution
	// plan is preserved so a user-approved ASK still runs
	// hardened.
	if (result.decision.kind === "allow") {
		const risk = evaluateCommandRisk({
			toolInput,
			hostAuthorization,
		})
		if (risk.disposition === "never-auto-approve") {
			return {
				approved: false,
				decision: {
					kind: "ask",
					reason: "R5 catastrophic hard floor: never auto-approve",
					source: "risk_hard_floor",
				},
				executionPlan,
			}
		}
	}
	// ALLOW or ASK.
	return {
		approved: result.decision.kind === "allow",
		decision: result.decision,
		executionPlan,
	}
}

/**
 * Build a CommandExecutionPlan from an evaluated decision. The plan
 * carries the per-command hardened argv the executor must use, plus
 * provenance (matched rule source, profile source) for each command.
 * Kept for backwards compatibility with existing UI logic.
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION01:
 * This function MUST NOT be used for command tools. Command tools
 * require the typed `CommandHostAuthorization` flow via
 * `getCommandHostAuthorization` + `evaluateCommandToolApproval`.
 */
export function isToolAutoApproved(
	toolName: string,
	settings: AutoApprovalSettings,
	mcpHub?: McpHub,
	override: SessionAutoApprovalOverride = "none",
): boolean {
	if (isReadTool(toolName)) {
		return !!settings.actions.readFiles
	}
	if (isEditTool(toolName)) {
		return !!settings.actions.editFiles
	}
	if (isCommandTool(toolName)) {
		// Do NOT infer a boolean here. Use getCommandHostAuthorization
		// to get the typed host mode and pass through the policy.
		return !!settings.actions.executeSafeCommands
	}
	if (isBrowserTool(toolName)) {
		return !!settings.actions.useBrowser
	}

	const mcpTool = parseMcpToolName(toolName)
	if (mcpTool) {
		if (!mcpHub) {
			return false
		}
		const server = mcpHub.getServers().find((entry) => entry.name === mcpTool.serverName)
		const tool = server?.tools?.find((entry) => entry.name === mcpTool.toolName)
		// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03:
		// "ALL — this task" must project into ordinary MCP tool execution.
		// When the session override is active, lift the global `useMcp`
		// gate (resolveEffectiveAutoApproval already projects it true;
		// we keep this structural so a future caller that forgets to
		// pre-project cannot reintroduce ASK here) AND lift the
		// per-server/per-tool `autoApprove` flag. The tool still has to
		// exist on a known server — unknown server/tool pairs fall
		// through to false (the closest thing to a hard-DENY for MCP
		// today, and it must NOT be widened by the override).
		if (override === "all") {
			return !!tool
		}
		if (!settings.actions.useMcp) {
			return false
		}
		return !!tool?.autoApprove
	}

	return false
}

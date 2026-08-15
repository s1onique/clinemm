import {
	buildCommandExecutionPlan,
	type CommandDecision,
	type CommandHostAuthorization,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	type EvaluatedCommand,
	evaluateCommandPolicy,
} from "@cline/core"
import type { CommandExecutionPlan } from "@cline/shared"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { McpHub } from "@/services/mcp/McpHub"

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
	set(["run_commands", "execute_command"])
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
	return toolName === "run_commands" || toolName === "execute_command"
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
		// Host has at most a binary "execute_safe_commands" toggle.
		// The corrected architecture treats this as "safe-only" mode.
		// In safe-only mode the host ALLOWS only commands that match a
		// constrained, positive rule (see DEFAULT_COMMAND_HOST_ALLOW_RULES).
		// It does NOT auto-approve by executable name.
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

	return {
		approved: result.decision.kind === "allow",
		decision: result.decision,
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
export function isToolAutoApproved(toolName: string, settings: AutoApprovalSettings, mcpHub?: McpHub): boolean {
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
		if (!settings.actions.useMcp || !mcpHub) {
			return false
		}
		const server = mcpHub.getServers().find((entry) => entry.name === mcpTool.serverName)
		const tool = server?.tools?.find((entry) => entry.name === mcpTool.toolName)
		return !!tool?.autoApprove
	}

	return false
}

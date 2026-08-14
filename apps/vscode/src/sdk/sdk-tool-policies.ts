import {
	type CommandDecision,
	type CommandHostAuthorization,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "@cline/core"
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
	mcpHub?: McpHub,
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
 * Legacy boolean auto-approve check for non-command tools.
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

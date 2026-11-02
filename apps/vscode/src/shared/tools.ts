import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { FunctionDeclaration as GoogleTool } from "@google/genai"
import { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"

type ClineTool = OpenAITool | AnthropicTool | GoogleTool

// Define available tool ids
export enum ClineDefaultTool {
	ASK = "ask_followup_question",
	ATTEMPT = "attempt_completion",
	BASH = "execute_command",
	FILE_EDIT = "replace_in_file",
	FILE_READ = "read_file",
	FILE_NEW = "write_to_file",
	SEARCH = "search_files",
	LIST_FILES = "list_files",
	LIST_CODE_DEF = "list_code_definition_names",
	BROWSER = "browser_action",
	MCP_USE = "use_mcp_tool",
	MCP_ACCESS = "access_mcp_resource",
	MCP_DOCS = "load_mcp_documentation",
	NEW_TASK = "new_task",
	PLAN_MODE = "plan_mode_respond",
	ACT_MODE = "act_mode_respond",
	WEB_FETCH = "web_fetch",
	WEB_SEARCH = "web_search",
	CONDENSE = "condense",
	SUMMARIZE_TASK = "summarize_task",
	REPORT_BUG = "report_bug",
	NEW_RULE = "new_rule",
	APPLY_PATCH = "apply_patch",
	USE_SKILL = "use_skill",
	USE_SUBAGENTS = "use_subagents",
}

/**
 * ACT-CLINEMM-FOCUS-CHAIN: the fork's focus-chain tool. Upstream removed
 * the focus-chain surface; the fork's subagent loader still references it,
 * so the enum member is preserved.
 */
export enum ClineFocusChainTool {
	TODO = "focus_chain",
}

/**
 * Per-namespace registry of dynamically-registered tool-use names.
 *
 * The fork's subagent loader registers the names of the tools it surfaces
 * at runtime, so the shared tool-name registry must accept them dynamically
 * rather than only the statically-enumerated members above.
 */
const dynamicToolUseNamesByNamespace = new Map<string, Set<string>>()

export function setDynamicToolUseNames(namespace: string, names: string[]): void {
	dynamicToolUseNamesByNamespace.set(namespace, new Set(names.map((name) => name.trim()).filter(Boolean)))
}

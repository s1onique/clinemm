import { createMcpTools } from "@cline/core"
import type { AgentTool, AgentToolContext } from "@cline/shared"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import type { McpHub } from "@/services/mcp/McpHub"
import { resolveMcpServerTimeoutMs } from "@/services/mcp/timeout"
import { Logger } from "@/shared/services/Logger"
import type { CommandJobState } from "./command-job-manager"
import { CommandJobManager, DEFAULT_EXECUTION_DEADLINE_MS, DEFAULT_WAIT_BUDGET_MS } from "./command-job-manager"
import { createCancelCommandTool, createCommandStatusTool } from "./command-status-tool"
import type { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import { createVscodeRunCommandsTool, VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS } from "./vscode-run-commands-tool"

interface McpToolDescriptor {
	name: string
	description?: string
	inputSchema: Record<string, unknown>
}

export class McpHubToolProvider {
	constructor(private readonly mcpHub: McpHub) {}

	async listTools(serverName: string): Promise<readonly McpToolDescriptor[]> {
		const servers = this.mcpHub.getServers()
		const server = servers.find((entry) => entry.name === serverName)
		if (!server) {
			Logger.warn(`[McpHubToolProvider] Server not found: ${serverName}`)
			return []
		}

		return (server.tools ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description ?? undefined,
			inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
				type: "object",
				properties: {},
			},
		}))
	}

	async callTool(request: {
		serverName: string
		toolName: string
		arguments?: Record<string, unknown>
		context?: AgentToolContext
	}): Promise<unknown> {
		const ulid = `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		return this.mcpHub.callTool(request.serverName, request.toolName, request.arguments ?? {}, ulid, request.context?.signal)
	}
}

export interface VscodeExtraToolsOptions {
	cwd?: string
	/**
	 * Lazy factory for the VscodeTerminalManager.
	 * When provided, the custom `run_commands` tool replaces the SDK's
	 * built-in version with foreground/background terminal support.
	 */
	getTerminalManager?: () => VscodeTerminalManager
	/** Current VS Code terminal execution mode, captured when the session tools are built. */
	vscodeTerminalExecutionMode?: "vscodeTerminal" | "backgroundExec"
	/** Registry of in-flight foreground executions for "Proceed While Running". */
	foregroundCommands?: SdkForegroundCommandCoordinator
	/**
	 * Host-owned command-job manager. Required for `backgroundExec` mode —
	 * it owns execution lifetime, exposes a stable job id, and powers the
	 * `command_status` follow-up tool. The runtime builder reuses the
	 * manager across session rebuilds (rebuilding the tool set does not
	 * invalidate in-flight jobs).
	 */
	commandJobManager?: CommandJobManager
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: lifecycle callback for the
	 * background execution path. The host (SdkController) wires this to
	 * `updateBackgroundCommandState` so the webview's TaskHeader and
	 * Cancel button can arbitrate the in-flight background command.
	 *
	 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
	 * (correction01 / Factory
	 * HALT_MULTI_JOB_START_SIGNAL_DROPPED): the runner now fires
	 * the start signal PER RUNNING job (no longer gated on aggregate
	 * 0->1 cardinality) AND threads the per-job terminal reason on
	 * the terminal callback. Both signatures are forwarded as-is so
	 * the controller can keep its per-job projection map and
	 * reason-pill rendering in sync.
	 */
	onBackgroundStateChange?: (
		running: boolean,
		jobId: string | undefined,
		terminalState?: Exclude<CommandJobState, "running">,
	) => void
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01:
	 * opt-in notify-on-terminal coordinator (pass-through to the
	 * run_commands tool). When omitted, the tool falls back to
	 * the pre-ACT fire-and-forget path with zero state delta.
	 */
	backgroundNotifyCoordinator?: import("./background-notify-coordinator").BackgroundNotifyCoordinator
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01:
	 * resolve the active owner (sessionId, taskId) at marker
	 * registration time. Returns undefined when no active
	 * owner is available (the coordinator treats this as
	 * owner_absent and discards).
	 */
	resolveActiveOwner?: () => { sessionId: string; taskId: string | undefined } | undefined
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
	 *
	 * Per-turn ownership-recording hook consulted at the same
	 * seam as `resolveActiveOwner` / `backgroundNotifyCoordinator`
	 * above. The host (production: `SdkController`) wires this to
	 * `MessageTranslatorState.recordLaunchedBackgroundJob(jobId)`
	 * so the C10 completion-result filter can narrow the
	 * over-broad `activeNotifyCount > 0` aggregate predicate to
	 * per-job ownership.
	 *
	 * OPTIONAL: when omitted, the tool falls back to the
	 * fire-and-forget path with zero state delta (mirroring the
	 * `backgroundNotifyCoordinator` optional wiring).
	 */
	recordLaunchedBackgroundJob?: (jobId: string) => void
}

export async function createVscodeExtraTools(mcpHub: McpHub, options?: VscodeExtraToolsOptions): Promise<AgentTool[]> {
	const provider = new McpHubToolProvider(mcpHub)
	const mcpTools = await Promise.all(
		mcpHub.getServers().map(async (server) => {
			try {
				return await createMcpTools({
					serverName: server.name,
					provider,
					// Keep the tool wrapper timeout in agreement with the MCP
					// request timeout: both derive from the server's config.
					timeoutMs: resolveMcpServerTimeoutMs(server.config),
				})
			} catch (error) {
				Logger.warn(
					`[VscodeRuntimeTools] Failed to load tools from MCP server "${server.name}": ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
				return []
			}
		}),
	)

	// No completion tool is exposed: the agent simply ends its turn with a text
	// response, and the turn-end inference in message-translator.ts styles that
	// final text as the completion feedback row.
	const tools: AgentTool[] = [...mcpTools.flat()]

	// Add the custom run_commands tool when a terminal manager is available.
	// This replaces the SDK's built-in run_commands, which is suppressed via
	// tool executor capabilities in VscodeSessionHost.
	if (options?.getTerminalManager) {
		const executionMode = options.vscodeTerminalExecutionMode ?? "vscodeTerminal"
		tools.push(
			createVscodeRunCommandsTool({
				cwd: options.cwd ?? process.cwd(),
				getTerminalManager: options.getTerminalManager,
				bashTimeoutMs: executionMode === "vscodeTerminal" ? VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS : undefined,
				vscodeTerminalExecutionMode: executionMode,
				foregroundCommands: options.foregroundCommands,
				commandJobManager: options.commandJobManager,
				backgroundWaitBudgetMs: DEFAULT_WAIT_BUDGET_MS,
				backgroundExecutionDeadlineMs: DEFAULT_EXECUTION_DEADLINE_MS,
				// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: pass-through to the
				// run_commands tool so the background state callback fires
				// when the tool returns RUNNING / reaches a terminal state.
				onBackgroundStateChange: options.onBackgroundStateChange,
				// ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01:
				// pass-through of the bounded opt-in coordinator + the
				// active-owner resolver. When the host does not supply
				// them, the tool defaults to fire-and-forget.
				backgroundNotifyCoordinator: options.backgroundNotifyCoordinator,
				resolveActiveOwner: options.resolveActiveOwner,
				// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
				// pass-through of the per-turn ownership-recording hook.
				// The hook is consulted at the same seam as the marker
				// registration above (the C9 -> marker seam at
				// `vscode-run-commands-tool.ts:768-816`).
				recordLaunchedBackgroundJob: options.recordLaunchedBackgroundJob,
			}),
		)
		// Expose the follow-up API only for the background path —
		// foreground commands use the existing "Proceed While Running"
		// button and don't need a separate status tool.
		if (executionMode === "backgroundExec" && options.commandJobManager) {
			// Observation only — auto-approved; safe to expose.
			// ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
			// thread the BackgroundNotifyCoordinator + active-owner
			// resolver through to `command_status` so terminal-state
			// observation drains the notify marker (Path B resolution
			// source — the canonical fix for TQ3_RESULT_OBSERVATION_NOT_CONNECTED).
			tools.push(
				createCommandStatusTool(options.commandJobManager, {
					backgroundNotifyCoordinator: options.backgroundNotifyCoordinator,
					resolveActiveOwner: options.resolveActiveOwner,
				}),
			)
			// Mutating — registered through the command-policy adapter
			// in sdk-tool-policies.ts so ALLOW/ASK/DENY applies.
			tools.push(createCancelCommandTool(options.commandJobManager))
		}
		Logger.log(
			`[VscodeRuntimeTools] Added custom run_commands tool (mode=${executionMode}, timeoutMs=${executionMode === "vscodeTerminal" ? VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS : "supervised"})`,
		)
	}

	Logger.log(`[VscodeRuntimeTools] Prepared ${tools.length} VSCode extra tools`)
	return tools
}

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
	// ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 Stage 5.
	// Captured at construction so every listTools/callTool routed
	// through the same provider reaches the per-session child owned
	// by this id, instead of falling through to the static
	// `connections` array.
	constructor(
		private readonly mcpHub: McpHub,
		private readonly sessionId?: string,
	) {}

	async listTools(serverName: string): Promise<readonly McpToolDescriptor[]> {
		// ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 Stage 5.
		// Discover seam. When `sessionId` is set, route through
		// `ensureSessionConnection` so the per-session child is
		// spawned (lazily) and its `listTools()` result is the source
		// of truth for this provider. Falls back to the cached
		// `server.tools` on the static connection when no session
		// context is supplied (A2A-14 STARTUP DEFER path).
		if (this.sessionId !== undefined) {
			const conn = await this.mcpHub.ensureSessionConnection(serverName, { sessionId: this.sessionId })
			if (!conn) {
				return []
			}
			const tools = await conn.client?.listTools?.().catch(() => undefined)
			if (tools && Array.isArray((tools as { tools?: unknown[] }).tools)) {
				return (tools as { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }).tools.map(
					(tool) => ({
						name: tool.name,
						description: tool.description ?? undefined,
						inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
							type: "object",
							properties: {},
						},
					}),
				)
			}
			// Per-session child exists but listTools returned no
			// tools (or threw) — fall through to the cached snapshot.
		}
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
		// ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 Stage 5.
		// Acquire seam. Pass the constructor-captured `sessionId` (if
		// any) through to `mcpHub.callTool`, which routes through
		// `ensureSessionConnection` to lazily spawn / reuse the
		// per-session child. When no session id was captured at
		// provider construction time, the legacy static path
		// runs unchanged.
		return this.mcpHub.callTool(
			request.serverName,
			request.toolName,
			request.arguments ?? {},
			ulid,
			request.context?.signal,
			this.sessionId,
		)
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
		/**
		 * ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01
		 * (RCNC02-05/06): the monotonicity evidence. The bounded
		 * fix's `onRunningObserved(jobId, evidence)` callback
		 * passes `{ isLiveInManager: true }` when the manager
		 * snapshot's state is "running" (the job is alive in
		 * `manager.active`). The host's
		 * `updateBackgroundCommandState` uses this evidence to
		 * authorize the bounded fix's load-bearing
		 * reconciliation path: a `running` write that overwrites
		 * a terminal projection is permitted ONLY when the
		 * evidence confirms the manager says the job is alive.
		 * A direct invocation without evidence (e.g. a stale-
		 * by-causal-ordering test seam) is refused — a genuine
		 * terminal publication is not silently revoked. See
		 * `vscode-run-commands-tool.ts:onBackgroundStateChange`
		 * for the full contract.
		 */
		evidence?: { isLiveInManager?: boolean },
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
	/**
	 * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 Stage 5.
	 *
	 * Session identity owned by the host (production:
	 * `SdkController` populates this from `startInput.config.sessionId`
	 * which `sdk-task-start-coordinator.ts:148` set via
	 * `createSessionId()`). When set, the McpHubToolProvider routes
	 * every `listTools` / `callTool` through `McpHub.ensureSessionConnection`
	 * which lazily spawns a per-session child using
	 * `resolveMcpServerEnv(template.env, process.env, { sessionId })`.
	 *
	 * When omitted, the provider falls back to the unchanged static
	 * `mcpHub.getServers()` path.
	 */
	sessionId?: string
}

export async function createVscodeExtraTools(mcpHub: McpHub, options?: VscodeExtraToolsOptions): Promise<AgentTool[]> {
	const provider = new McpHubToolProvider(mcpHub, options?.sessionId)
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
		// ACT-CLINEMM-BACKGROUND-COMPLETION-CONSUMER-AVAILABILITY01:
		// Expose `command_status` and `cancel_command` whenever a
		// `commandJobManager` is provided. The original gate
		// `executionMode === "backgroundExec"` was a stale filter: the
		// BCB01 finalization prompt (background-notify-coordinator.ts:289-294)
		// unconditionally instructs the model to call `command_status`
		// for held jobIds, but held observations persist across rebuilds
		// (mode changes) and across session boundaries — so the model
		// can hold observations even in the default `vscodeTerminal` mode.
		// Without the tool, the model falls back to `run_commands`, which
		// cannot consume the BCB observation; submit_and_exit re-holds
		// and a self-amplifying continuation loop emerges.
		//
		// `commandJobManager` is the source of truth for whether
		// background jobs exist. When it is present, the model must
		// have a real consumer for the corresponding terminal observations.
		//
		// `command_status` is observation-only (no command-policy gating).
		// `cancel_command` is mutating and remains gated through the
		// command-policy adapter in sdk-tool-policies.ts.
		if (options.commandJobManager) {
			// Observation only — auto-approved; safe to expose.
			// ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
			// thread the BackgroundNotifyCoordinator + active-owner
			// resolver through to `command_status` so terminal-state
			// observation drains the notify marker (Path B resolution
			// source — the canonical fix for TQ3_RESULT_OBSERVATION_NOT_CONNECTED).
			//
			// ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01:
			// thread the host's `onBackgroundStateChange` callback into
			// the `command_status` tool's `onRunningObserved` seam. A
			// nonterminal `command_status` observation
			// (manager snapshot `state === "running"`) reconciles the
			// per-job projection map from any stale terminal value
			// (e.g. a one-shot `command_job_containment_failed` emit
			// that fired while the job was actually still alive) back
			// to `"running"`. This is the bounded fix for the live
			// P0 where a `Run failed` chat row pill coexists with a
			// `{ status: "running", ... }` `command_status` tool
			// result. The host's `updateBackgroundCommandState(true,
			// jobId)` is idempotent; a no-op when the projection is
			// already `running`.
			//
			// ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01
			// (RCNC02-05/06 — terminal monotonicity): the
			// `onRunningObserved(jobId, evidence)` callback forwards
			// the manager's liveness evidence through to the host.
			// The host's `updateBackgroundCommandState` requires
			// `evidence.isLiveInManager === true` to authorize a
			// `running` write that overwrites a terminal projection
			// (the bounded fix's load-bearing reconciliation
			// path). A direct invocation without evidence (e.g. a
			// stale-by-causal-ordering test seam) is refused —
			// a genuine terminal publication is not silently
			// revoked.
			tools.push(
				createCommandStatusTool(options.commandJobManager, {
					backgroundNotifyCoordinator: options.backgroundNotifyCoordinator,
					resolveActiveOwner: options.resolveActiveOwner,
					onRunningObserved: options.onBackgroundStateChange
						? (jobId, evidence) => {
								// ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01
								// (RCNC02-07 — currentness): re-validate the
								// manager's liveness at the moment of the
								// callback invocation. The
								// `command_status` tool's snapshot may have
								// been taken at time T1 (the
								// `isLiveInManager: true` evidence is a
								// point-in-time Boolean); a deferred
								// running snapshot — captured at T1, but
								// released AFTER the runner's terminal
								// listener has published the terminal
								// reason — would otherwise silently revoke
								// the terminal projection. The narrow,
								// synchronous `manager.isJobActive(jobId)`
								// check closes the observation/publication
								// correlation boundary at the runtime-builder
								// closure. A stale snapshot is rejected because
								// `isJobActive(jobId) === false` at the
								// moment of the callback. The bounded fix
								// only fires when the manager confirms the
								// job is alive at both observation AND
								// publication times.
								// biome-ignore lint/suspicious/noExplicitAny: closure is constructed inside `if (options.commandJobManager)`
								const manager = options.commandJobManager as NonNullable<typeof options.commandJobManager>
								const currentEvidence = {
									...evidence,
									isLiveInManager: (evidence?.isLiveInManager ?? false) && manager.isJobActive(jobId),
								}
								if (!currentEvidence.isLiveInManager) {
									// Stale snapshot — refuse the write.
									// The terminal projection (if any) is
									// preserved.
									return
								}
								options.onBackgroundStateChange?.(true, jobId, undefined, currentEvidence)
							}
						: undefined,
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

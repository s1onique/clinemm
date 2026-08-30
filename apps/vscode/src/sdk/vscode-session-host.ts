// VscodeSessionHost — wraps ClineCore with VSCode-specific customizations
//
// Uses ClineCore.create() so the SDK owns session input normalization,
// lifecycle bootstrapping, and host selection while the VSCode extension
// still provides its custom McpHub-backed runtime builder.

import {
	type ApplyPatchExecutor,
	ClineCore,
	type ClineCoreListHistoryOptions,
	type ClineCoreStartInput,
	type CompareCheckpointInput,
	type CompareCheckpointResult,
	type CoreSessionEvent,
	type EditorExecutor,
	type HookEventPayload,
	type ITelemetryService,
	type PendingPromptMutationResult,
	type PendingPromptsDeleteInput,
	type PendingPromptsListInput,
	type PendingPromptsUpdateInput,
	type PreparedRemoteConfigCoreIntegration,
	type RestoreInput,
	type RestoreResult,
	type SendSessionInput,
	type SessionAccumulatedUsage,
	type SessionCompactionState,
	type SessionHistoryRecord,
	type SessionPendingPrompt,
	type SessionRecord,
	type StartSessionInput,
	type StartSessionResult,
	type ToolExecutors,
} from "@cline/core"
import {
	type AgentRuntimeEvent,
	type AgentRuntimeRecoverySnapshot,
	type AgentRuntimeStateSnapshot,
	type AgentToolContext,
	RUNTIME_CONFIG_EXTENSION_KINDS,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolPolicy,
} from "@cline/shared"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { getDistinctId } from "@/services/logging/distinctId"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import { CommandJobManager } from "./command-job-manager"
import { subscribeRuntimeEventsThroughProxy } from "./runtime-events-proxy"
import { resolveActiveWorkspaceRootsForSandbox } from "./sandbox-policy"
import type { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import type { SdkSessionHost } from "./session-host"
import { createVscodeExtraTools } from "./vscode-runtime-builder"
import { createVscodeSubmitExecutor } from "./vscode-submit-executor"
import { getEffectiveTerminalExecutionMode } from "./vscode-terminal-execution-mode"

export interface VscodeSessionHostOptions {
	mcpHub: McpHub
	/**
	 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
	 * Setting-driven capability snapshot source. When provided, the
	 * production `buildExperimentalReconCapability` is invoked with
	 * these overrides; when omitted, the legacy env-only path runs.
	 * The SdkController supply a closure that reads the persisted
	 * state keys `clinemmSafeYoloAllowNetwork` and
	 * `clinemmSafeYoloAllowSshAgent` from the StateManager, so the
	 * Settings UI is the runtime source of truth for capability
	 * selection. Conservation: a user who has never touched the UI
	 * sees exactly the pre-ACT runtime selection (deny / deny).
	 */
	safeYoloCapabilitySource?: () => {
		readonly network: boolean | undefined
		readonly sshAgent: boolean | undefined
	}
	requestToolApproval?: (request: {
		agentId: string
		conversationId: string
		iteration: number
		toolCallId: string
		toolName: string
		input: unknown
		policy: { enabled: boolean; autoApprove: boolean }
	}) => Promise<{ approved: boolean; reason?: string }>
	/** Executor for the SDK's built-in ask_question tool (equivalent to classic ask_followup_question). */
	askQuestion?: (question: string, options: string[], context: AgentToolContext) => Promise<string>
	/**
	 * Custom `editor` tool executor (diff-view edit pipeline). Fully replaces the SDK's
	 * default disk-writing executor.
	 */
	editorExecutor?: EditorExecutor
	/**
	 * Custom `apply_patch` tool executor (reverts the approval-time diff preview before
	 * delegating to the SDK's default patch application).
	 */
	applyPatchExecutor?: ApplyPatchExecutor
	/**
	 * Custom `read_files` executor (resolves relative paths against the workspace root
	 * instead of the extension host's process.cwd(), which is usually "/").
	 */
	readFileExecutor?: ToolExecutors["readFile"]
	/** Per-tool approval policies derived from the user's auto-approval settings. */
	toolPolicies?: Record<string, ToolPolicy>
	/** Shared SDK telemetry service owned by SdkController. */
	telemetry?: ITelemetryService
	/** Resolves once the applicable remote config is ready for a new SDK session. */
	beforeStartSession?: () => Promise<void>
	/** Returns the latest prepared remote-config integration, if remote config is active. */
	getRemoteConfigIntegration?: () => PreparedRemoteConfigCoreIntegration | undefined
	/**
	 * Lazy factory for the VscodeTerminalManager.
	 * When provided, the SDK's built-in `run_commands` is suppressed and replaced
	 * with a custom tool that supports foreground/background terminal execution.
	 */
	getTerminalManager?: () => VscodeTerminalManager
	/** Registry of in-flight foreground executions for "Proceed While Running". */
	foregroundCommands?: SdkForegroundCommandCoordinator
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: lifecycle callback for the
	 * background run_commands path. The host (SdkController) wires this to
	 * `updateBackgroundCommandState` so the webview's TaskHeader and
	 * Cancel button can arbitrate the in-flight background command. The
	 * host owns the projection; the session host is a pass-through.
	 */
	onBackgroundStateChange?: (running: boolean, jobId: string | undefined) => void
	/**
	 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
	 * Custom `submit_and_exit` executor. When supplied, the host provides
	 * its own submit executor (typically created via `createVscodeSubmitExecutor`
	 * from `./vscode-submit-executor`, which is the canonical PASSIVE
	 * implementation). When omitted, the SDK's runtime cannot register
	 * `submit_and_exit` even if `enableSubmitAndExit` is true on the
	 * session config, because the runtime requires an executor for the
	 * tool registration predicate at definitions.ts:1148.
	 *
	 * The host opts in to completion authority by providing this executor
	 * AND by having `buildSessionConfig` set `enableSubmitAndExit: true`
	 * on `CoreSessionConfig`. The runtime registers the tool iff both
	 * signals are present.
	 */
	submitExecutor?: ToolExecutors["submit"]
}

/**
 * Host-only shape returned by `VscodeSessionHost.readHostFacts`. Lives
 * here, NOT in `@cline/core` -- keeping the temporary diagnostic out of
 * the shared execution contract.
 */
export interface HostOwnershipHostFacts {
	readonly lastInteractiveTurnFinishReason?: import("@cline/shared").AgentFinishReason
	readonly sessionStatus?: string
	readonly pendingPromptCount?: number
	readonly drainingPendingPrompts?: boolean
	readonly agentCanStartRun?: boolean
}

export class VscodeSessionHost implements SdkSessionHost {
	readonly runtimeAddress: string | undefined
	private readonly inner: ClineCore
	/**
	 * Host-owned command-job manager. Created once per VscodeSessionHost
	 * instance and reused across session rebuilds (so an in-flight job
	 * is still observable after the tool set is rebuilt for a mode
	 * change). Disposed when this host is disposed — see dispose().
	 */
	private readonly commandJobManager: CommandJobManager

	private readonly prepareStartSessionInput?: (input: ClineCoreStartInput) => Promise<ClineCoreStartInput>

	private constructor(
		inner: ClineCore,
		commandJobManager: CommandJobManager,
		prepareStartSessionInput?: (input: ClineCoreStartInput) => Promise<ClineCoreStartInput>,
	) {
		this.inner = inner
		this.commandJobManager = commandJobManager
		this.runtimeAddress = inner.runtimeAddress
		this.prepareStartSessionInput = prepareStartSessionInput
	}
	updateSessionModel?(sessionId: string, modelId: string): Promise<void> {
		return this.inner.updateSessionModel(sessionId, modelId)
	}

	static async create(options: VscodeSessionHostOptions): Promise<VscodeSessionHost> {
		// Build tool executor capabilities from options — only include keys that are provided.
		// When a terminal manager is available, suppress the SDK's built-in run_commands
		// tool by setting bash to undefined. Our custom run_commands (provided via
		// extraTools) replaces it with foreground/background terminal support.
		const commandJobManager = new CommandJobManager({
			// ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01: thread the active
			// workspace roots from the hostbridge into the Seatbelt
			// writableRoots. The safety filter rejects $HOME, HOME's
			// parent, and "/" so a user who opens a too-broad folder
			// does NOT silently grant write authority over personal
			// data. The empty-window back-compat path (no open folder)
			// passes through with [] which yields the prior
			// "everything writable except /dev/null = nothing"
			// contract — no silent widening on the empty-window edge.
			experimentalSandboxWorkspaceRoots: await resolveActiveWorkspaceRootsForSandbox(),
			// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
			// when the host wires a state-driven snapshot source, the
			// production runtime capability selects from persisted
			// Settings values. When the host does not (test paths), the
			// builder's env-only fallback runs unchanged.
			safeYoloCapabilitySource: options.safeYoloCapabilitySource,
		})
		const toolExecutors: Partial<ToolExecutors> = {}
		if (options.askQuestion) {
			toolExecutors.askQuestion = options.askQuestion
		}
		if (options.editorExecutor) {
			toolExecutors.editor = options.editorExecutor
		}
		if (options.applyPatchExecutor) {
			toolExecutors.applyPatch = options.applyPatchExecutor
		}
		if (options.readFileExecutor) {
			toolExecutors.readFile = options.readFileExecutor
		}
		if (options.getTerminalManager) {
			// Setting bash to undefined suppresses the SDK's createShellTool():
			// createDefaultTools() checks `enableBash && executors.bash` — falsy
			// bash means no built-in run_commands tool is created.
			;(toolExecutors as Record<string, unknown>).bash = undefined
		}
		// ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
		// Always populate `submit` so the runtime can register
		// `submit_and_exit` iff `CoreSessionConfig.enableSubmitAndExit`
		// is true on the session config (set by `buildSessionConfig`).
		// The default is the canonical PASSIVE `createVscodeSubmitExecutor`,
		// which only acknowledges the submitted summary and never mutates
		// task state, emits messages, or posts to the webview. The runtime
		// gates `submit_and_exit` registration on `enableSubmitAndExit`
		// at `definitions.ts:1148`, so an unused submit executor is
		// harmless when the capability is OFF.
		toolExecutors.submit = options.submitExecutor ?? createVscodeSubmitExecutor()

		// Single funnel for session-start preparation: waits on the remote-config
		// readiness/policy gate, applies the remote-config integration, and adds
		// the VSCode extra tools. Used by ClineCore's prepare hook for normal
		// starts AND by restore() for checkpoint-restore replacement sessions,
		// which ClineCore starts without running the prepare hook.
		const prepareStartSessionInput = async (input: ClineCoreStartInput): Promise<ClineCoreStartInput> => {
			await options.beforeStartSession?.()
			// Read only after the readiness gate: it may have atomically replaced
			// the integration that must be captured by this session.
			const remoteConfigIntegration = options.getRemoteConfigIntegration?.()
			const inputWithRemoteConfig = remoteConfigIntegration
				? await remoteConfigIntegration.applyToStartSessionInput(input)
				: input
			const requestedTerminalExecutionMode = StateManager.get().getGlobalStateKey("vscodeTerminalExecutionMode")
			const extraTools = await createVscodeExtraTools(options.mcpHub, {
				cwd: inputWithRemoteConfig.config.cwd,
				getTerminalManager: options.getTerminalManager,
				vscodeTerminalExecutionMode: getEffectiveTerminalExecutionMode(requestedTerminalExecutionMode),
				foregroundCommands: options.foregroundCommands,
				// ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01 (F27 SHARED_HOST_SAFE_YOLO_SOURCE_BINDING):
				// thread commandJobManager (which carries safeYoloCapabilitySource via line 193/209)
				// into the createVscodeExtraTools call so the runtime receives the source binding.
				// Without this, the source binding is silently dropped between VscodeSessionHost.create
				// and the run_commands tool — exactly the silent break the recon ACT predicted.
				commandJobManager,
				// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: pass-through to the
				// run_commands tool so the background state callback fires
				// when the tool returns RUNNING / reaches a terminal state.
				onBackgroundStateChange: options.onBackgroundStateChange,
			})
			return {
				...inputWithRemoteConfig,
				source: inputWithRemoteConfig.source ?? "vscode",
				// The extension runs file hooks through its own hooks adapter
				// (status chips, hooksEnabled setting, HookFactory discovery).
				// Exclude the SDK core's file-hook extension or every hook
				// would execute twice per event.
				localRuntime: {
					...(inputWithRemoteConfig.localRuntime ?? {}),
					configExtensions: (
						inputWithRemoteConfig.localRuntime?.configExtensions ?? RUNTIME_CONFIG_EXTENSION_KINDS
					).filter((kind) => kind !== "hooks"),
				},
				config: {
					...inputWithRemoteConfig.config,
					telemetry: inputWithRemoteConfig.config.telemetry ?? options.telemetry,
					extraTools: [...(inputWithRemoteConfig.config.extraTools ?? []), ...extraTools],
				},
			}
		}

		const inner = await ClineCore.create({
			backendMode: "local",
			capabilities: {
				requestToolApproval: options.requestToolApproval as
					| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
					| undefined,
				toolExecutors: Object.keys(toolExecutors).length > 0 ? toolExecutors : undefined,
			},
			toolPolicies: options.toolPolicies,
			telemetry: options.telemetry,
			distinctId: getDistinctId() || undefined,
			prepare: async () => ({
				// ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01 (F27): the named
				// `prepareStartSessionInput` lambda at line 247 threads
				// `commandJobManager` (which carries `safeYoloCapabilitySource`)
				// into `createVscodeExtraTools`. Use it directly instead of
				// an inline duplicate that risks losing the source binding.
				applyToStartSessionInput: prepareStartSessionInput,
			}),
		})

		Logger.log("[VscodeSessionHost] Initialized with ClineCore + VSCode extra tools")
		if (options.getTerminalManager) {
			Logger.log("[VscodeSessionHost] SDK run_commands suppressed; using custom foreground/background terminal tool")
		}
		// ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01 (F27): constructor now takes
		// (inner, commandJobManager, prepareStartSessionInput?) so both
		// fields are persisted on the host instance.
		return new VscodeSessionHost(inner, commandJobManager, prepareStartSessionInput)
	}

	async start(input: StartSessionInput): Promise<StartSessionResult>
	async start(input: ClineCoreStartInput): Promise<StartSessionResult>
	async start(input: StartSessionInput | ClineCoreStartInput): Promise<StartSessionResult> {
		return this.inner.start(input as ClineCoreStartInput)
	}

	async send(input: SendSessionInput) {
		Logger.log(`[VscodeSessionHost] send() called: sessionId=${input.sessionId}, prompt=${input.prompt?.substring(0, 50)}`)
		try {
			const result = await this.inner.send(input)
			Logger.log(
				`[VscodeSessionHost] send() completed: text=${result?.text?.substring(0, 100)}, inputTokens=${result?.usage?.inputTokens}`,
			)
			return result
		} catch (error) {
			Logger.error("[VscodeSessionHost] send() error:", error)
			throw error
		}
	}

	async getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined> {
		return (await this.inner.getAccumulatedUsage(sessionId))?.usage
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		try {
			return await this.inner.abort(sessionId, reason)
		} catch (error) {
			// AbortError is expected when cancelling a running task —
			// AbortController.abort() fires synchronously and may cause
			// listeners to throw. Suppress it here so callers don't
			// need to handle it.
			if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))) {
				Logger.debug(`[VscodeSessionHost] AbortError during abort (expected): ${sessionId}`)
				return
			}
			throw error
		}
	}

	async stop(sessionId: string): Promise<void> {
		return this.inner.stop(sessionId)
	}

	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: cancel every still-running
	 * background command owned by this session. The webview's Cancel
	 * button routes through this so the in-flight `run_commands` job
	 * is terminated before the rest of the task. Returns the number of
	 * jobs that were actually cancelled (skips already-terminal jobs).
	 */
	/**
	 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01:
	 * Host-specific internal accessor that reads six raw host-ownership
	 * facts from the underlying `ClineCore` session state. Returns
	 * `undefined` when:
	 *   * `sessionId` is missing,
	 *   * the underlying core has no active session for that id,
	 *   * the host does not implement this method (Hub/Remote omit it
	 *     by design -- same absence semantic as `cancelBackgroundCommand`).
	 *
	 * Read-only: never mutates runtime/session state, never inserts
	 * state-post events, never schedules timers.
	 *
	 * NOT on the `SdkSessionHost` interface -- host-only extension to
	 * keep the temporary diagnostic out of the shared execution contract.
	 * See `apps/vscode/src/sdk/host-ownership-capture/index.ts` for the
	 * caller.
	 */
	/**
	 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION02:
	 * Host-specific internal accessor that reads six raw host-ownership
	 * facts from the underlying `ClineCore` via its internal
	 * `captureHostOwnershipFacts(sessionId)` class method.
	 *
	 * NOT on the `SdkSessionHost` interface -- host-only extension
	 * following the precedent of `cancelBackgroundCommand`. The
	 * diagnostic consumer reaches the method through duck-typing on
	 * the concrete `VscodeSessionHost` class.
	 *
	 * SYNCHRONOUS by design (CORRECTION02). The capture path must not
	 * cross an `await` boundary between the snapshot identity stamp
	 * and the host-facts read; this method returns the raw facts (or
	 * `undefined`) directly. The underlying
	 * `ClineCore.captureHostOwnershipFacts(sessionId)` is itself
	 * synchronous, so the chain stays synchronous end-to-end.
	 *
	 * Read-only. Returns `undefined` when `sessionId` is missing, the
	 * session is not active, or the underlying host omits the method
	 * (Hub/Remote). Never mutates runtime/session state.
	 */
	readHostFacts(sessionId: string | undefined): HostOwnershipHostFacts | undefined {
		if (!sessionId) return undefined
		return this.inner.captureHostOwnershipFacts(sessionId) ?? undefined
	}

	async cancelBackgroundCommand(): Promise<number> {
		const activeIds = this.commandJobManager.getActiveJobIds()
		if (activeIds.length === 0) {
			return 0
		}
		const results = await Promise.all(activeIds.map((jobId) => this.commandJobManager.cancel({ jobId })))
		const cancelled = results.filter((r): r is { ok: true; state: "cancelled" } => r.ok && r.state === "cancelled").length
		Logger.log(
			`[VscodeSessionHost] cancelBackgroundCommand: cancelled ${cancelled}/${activeIds.length} active background command(s)`,
		)
		return cancelled
	}

	async dispose(reason?: string): Promise<void> {
		try {
			await this.commandJobManager.dispose()
		} catch (error) {
			Logger.warn(
				`[VscodeSessionHost] commandJobManager.dispose failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
		return this.inner.dispose(reason)
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		return this.inner.get(sessionId)
	}

	async list(limit?: number, options: Omit<ClineCoreListHistoryOptions, "limit"> = {}): Promise<SessionHistoryRecord[]> {
		return this.inner.list(limit, options)
	}

	async listHistory(options: ClineCoreListHistoryOptions = {}): Promise<SessionHistoryRecord[]> {
		return this.inner.listHistory(options)
	}

	async delete(sessionId: string): Promise<boolean> {
		return this.inner.delete(sessionId)
	}

	async readMessages(sessionId: string) {
		return this.inner.readMessages(sessionId)
	}

	async readLiveMessages(sessionId: string) {
		return this.inner.readLiveMessages(sessionId)
	}

	async updateSessionCompactionState(sessionId: string, state: SessionCompactionState): Promise<{ updated: boolean }> {
		return this.inner.updateSessionCompactionState(sessionId, state)
	}

	async restore(input: RestoreInput): Promise<RestoreResult> {
		// ClineCore.restore starts the checkpoint-restore replacement session
		// WITHOUT running the prepare hook, which would bypass the remote-config
		// session gate and integration. Run the same preparation here.
		if (input.start && this.prepareStartSessionInput) {
			input = { ...input, start: await this.prepareStartSessionInput(input.start) }
		}
		return this.inner.restore(input)
	}

	async compareCheckpoint(input: CompareCheckpointInput): Promise<CompareCheckpointResult> {
		return this.inner.compareCheckpoint(input)
	}

	async update(
		sessionId: string,
		updates: {
			prompt?: string | null
			metadata?: Record<string, unknown> | null
			title?: string | null
		},
	): Promise<{ updated: boolean }> {
		return this.inner.update(sessionId, updates)
	}

	async handleHookEvent(payload: HookEventPayload): Promise<void> {
		return this.inner.ingestHookEvent(payload)
	}

	pendingPrompts(action: "list", input: PendingPromptsListInput): Promise<SessionPendingPrompt[]>
	pendingPrompts(action: "update", input: PendingPromptsUpdateInput): Promise<PendingPromptMutationResult>
	pendingPrompts(action: "delete", input: PendingPromptsDeleteInput): Promise<PendingPromptMutationResult>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pendingPrompts(action: any, input: any): any {
		switch (action) {
			case "list":
				return this.inner.pendingPrompts.list(input)
			case "update":
				return this.inner.pendingPrompts.update(input)
			case "delete":
				return this.inner.pendingPrompts.delete(input)
			default:
				throw new Error(`Unsupported pending prompt action: ${String(action)}`)
		}
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		return this.inner.subscribe(listener)
	}

	/**
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: forward canonical
	 * recovery-state transitions to host-side telemetry consumers (the
	 * `TaskTelemetryTracker`). Observation-only: nothing on the
	 * recovery-policy path reads this stream.
	 */
	subscribeRecoveryStateChange(listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void): () => void {
		const inner = this.inner as ClineCore & {
			subscribeRecoveryStateChange?: (
				listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void,
			) => () => void
		}
		if (!inner.subscribeRecoveryStateChange) {
			return () => {}
		}
		return inner.subscribeRecoveryStateChange(listener)
	}

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
	 * forward canonical `AgentRuntimeEvent`s to host-side observation
	 * consumers (the TaskState shadow boundary). No state, no
	 * buffering, no reinterpretation. Mirrors the recovery proxy above.
	 */
	subscribeRuntimeEvents(listener: (sessionId: string, event: AgentRuntimeEvent) => void): () => void {
		const inner = this.inner as ClineCore & {
			subscribeRuntimeEvents?: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => () => void
		}
		return subscribeRuntimeEventsThroughProxy(inner, listener)
	}
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-F1-CANONICAL-RUNTIME-EVENT-SEAM01-ELM-02F-CORRECTION01:
	 * Returns the canonical `AgentRuntimeStateSnapshot` of the
	 * currently active `AgentRuntime` instance for `sessionId`, if
	 * any. Proxies to `ClineCore.getActiveRuntimeSnapshot(sessionId)`,
	 * which in turn reaches the canonical `AgentRuntime.snapshot()`
	 * via `LocalRuntimeHost.getActiveRuntimeSnapshot(sessionId)`
	 * (when the underlying host is `LocalRuntimeHost`). The proxy
	 * returns `undefined` when the host does not implement
	 * `getActiveRuntimeSnapshot?` — production code MUST use `?.()`
	 * so the method-absent and returns-undefined cases collapse to
	 * a single legacy-mirror fallback.
	 */
	runtimeSnapshot(sessionId: string | undefined): AgentRuntimeStateSnapshot | undefined {
		return this.inner.getActiveRuntimeSnapshot(sessionId)
	}
}

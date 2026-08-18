// Replaces classic src/core/controller/index.ts (see origin/main)
//
// The SDK-backed Controller. It provides the same interface as the classic
// Controller but delegates session lifecycle (initTask, askResponse,
// cancelTask, …) to the Cline SDK (@cline/core) and bridges SDK events to
// the webview's gRPC streams.

import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
	type CompareCheckpointResult,
	createRestoredCheckpointMetadata,
	createUserInstructionConfigService,
	ensureChatWorkspace,
	getProviderAuthStorageId,
	type PreparedRemoteConfigCoreIntegration,
	readSessionCheckpointHistory,
	resolveDefaultMcpSettingsPath,
	type SessionHistoryRecord,
	setTelemetryOptOutGlobally,
	type UserInstructionConfigService,
} from "@cline/core"
import { formatDisplayUserInput, type RemoteConfig, type RemoteConfigBundle } from "@cline/shared"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { ApiConfiguration } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import { mentionRegexGlobal } from "@shared/context-mentions"
import type { ClineApiReqInfo, ClineMessage, ExtensionState, TurnPhase } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { DeleteAllTaskHistoryCount, type GetTaskHistoryRequest, TaskHistoryArray, TaskResponse } from "@shared/proto/cline/task"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { ClineCheckpointRestore } from "@shared/WebviewMessage"
import { parseMentions } from "@/core/mentions"
import { ensureMcpServersDirectoryExists } from "@/core/storage/disk"
import { refreshSdkRemoteConfig } from "@/core/storage/remote-config/sdk-refresh"
import { clearRemoteConfig } from "@/core/storage/remote-config/utils"
import { StateManager } from "@/core/storage/StateManager"
import { WorkspaceRootManager } from "@/core/workspace/WorkspaceRootManager"
import { HostProvider } from "@/hosts/host-provider"
import { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { ExtensionRegistryInfo } from "@/registry"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { UrlContentFetcher } from "@/services/browser/UrlContentFetcher"
import { ClineError } from "@/services/error/ClineError"
import { McpHub } from "@/services/mcp/McpHub"
import { telemetryService } from "@/services/telemetry"
import type { ClineExtensionContext } from "@/shared/cline"
import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { isClineManagedProvider } from "@/shared/utils/cline"
import { arePathsEqual, getDesktopDir } from "@/utils/path"
import { ClineAccountService } from "./account-service"
import { AuthService, LogoutReason } from "./auth-service"
import { BUILTIN_SLASH_COMMANDS } from "./builtin-slash-commands"
import { CanonicalRuntimeShadowSubscription } from "./canonical-event-subscription"
import { buildStartSessionInput, createHistoryItemFromSession } from "./cline-session-factory"
import { MessageTranslatorState, reshapeErrorForWebview } from "./message-translator"
import { createProviderCatalog } from "./model-catalog/catalog"
import type { Disposable, ProviderCatalog, ProviderConfigChange, ProviderConfigStore } from "./model-catalog/contracts"
import { parseProviderId } from "./model-catalog/provider-id"
import { createProviderConfigStore } from "./model-catalog/store"
import {
	buildExtensionSnapshotFromState,
	isPostTerminalAuthorityDiagnosticEnabled,
	recordPostTerminalAuthoritySnapshot,
} from "./post-terminal-authority-diagnostic-builder"
import {
	PROVIDER_FAILURE_ERROR_TYPE,
	PROVIDER_FAILURE_PHASE,
	type ProviderFailureTelemetry,
	ProviderFailureTelemetryTurnGate,
} from "./provider-failure-telemetry"
import {
	findVisibleCheckpointUserMessageByRun,
	getCheckpointRunCountForMessage,
	isVisibleCheckpointUserMessage,
} from "./sdk-checkpoints"
import { SdkCompactionCoordinator } from "./sdk-compaction-coordinator"
import { SdkDiffEditCoordinator } from "./sdk-diff-edit-coordinator"
import { SdkFollowupCoordinator } from "./sdk-followup-coordinator"
import { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMcpCoordinator } from "./sdk-mcp-coordinator"
import { SdkMessageCoordinator, type SessionEventListener } from "./sdk-message-coordinator"
import { SdkModeCoordinator } from "./sdk-mode-coordinator"
import { SdkProviderChangeCoordinator } from "./sdk-provider-change-coordinator"
import { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import { SdkSessionEventCoordinator } from "./sdk-session-event-coordinator"
import { SdkSessionHistoryLoader } from "./sdk-session-history-loader"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import { SdkTaskControlCoordinator } from "./sdk-task-control-coordinator"
import { SdkTaskHistory, sessionHistoryRecordToHistoryItem } from "./sdk-task-history"
import { SdkTaskStartCoordinator } from "./sdk-task-start-coordinator"
import { createVscodeSdkTelemetryHandle, type VscodeSdkTelemetryHandle } from "./sdk-telemetry"
import { SdkTerminalExecutionModeCoordinator } from "./sdk-terminal-execution-mode-coordinator"
import {
	evaluateCancelCommandToolApproval,
	evaluateCommandToolApprovalWithPlan,
	getCommandHostAuthorization,
	isCommandTool,
	isToolAutoApproved,
} from "./sdk-tool-policies"
import {
	extractSdkUserText,
	findSdkUserMessageIndexByOrdinal,
	getSdkCheckpointRunCountForMessageIndex,
	isSyntheticSdkUserMessage,
	type SdkUserMessage,
} from "./sdk-user-message-mapping"
import {
	resolveEffectiveAutoApproval,
	resolveSessionHostAuthorization,
	type SessionAutoApprovalOverride,
	SessionAutoApprovalStore,
	stripRequiresApproval,
} from "./session-auto-approval"
import { buildDisabledWorkflowNames, expandSlashCommands } from "./slash-command-expansion"
import { StatePostDebouncer } from "./state-post-debouncer"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import { selectTaskShadowArbiterSnapshot, selectThinkingPresentation } from "./task-state-shadow-arbiter-mapper"
import {
	emitHostRecovery,
	emitSameTaskContinued,
	emitTaskCancelled,
	emitTaskRequested,
	emitTaskReset,
} from "./task-state-shadow-host-msgs"
import { createTaskShadowHostWiring, type TaskShadowHostWiringWithSink } from "./task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "./task-state-shadow-recorder"
import { TaskTelemetryTracker } from "./task-telemetry-tracker"
import { syncTelemetrySettingFromSharedGlobalSettings } from "./telemetry-settings-sync"
import { TurnStateTracker } from "./turn-state-tracker"
import { createWorkspaceFileReadExecutor } from "./vscode-file-read-executor"
import { VscodeSessionHost } from "./vscode-session-host"
import type { VscodeTerminalExecutionMode } from "./vscode-terminal-execution-mode"
import { WebviewGrpcBridge } from "./webview-grpc-bridge"
import { resolveWorkspaceManagerPaths, resolveWorkspaceRootPath } from "./workspace-root"

/**
 * Log a stub warning and return undefined.
 */
function stubWarn(name: string): void {
	Logger.warn(`[SdkController] STUB: ${name} not yet implemented`)
}

function metadataNumber(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): number | undefined {
	const value = metadata?.[key]
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function usesClineAccountAuth(providerId: string): boolean {
	return getProviderAuthStorageId(providerId) === "cline"
}

function metadataBoolean(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): boolean | undefined {
	const value = metadata?.[key]
	return typeof value === "boolean" ? value : undefined
}

function metadataString(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): string | undefined {
	const value = metadata?.[key]
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function dateStringToTimestamp(value: string | null | undefined): number {
	if (!value) {
		return 0
	}
	const timestamp = Date.parse(value)
	return Number.isFinite(timestamp) ? timestamp : 0
}

function historyItemToTaskResponse(item: HistoryItem): TaskResponse {
	return TaskResponse.create({
		id: item.id,
		task: formatDisplayUserInput(item.task),
		ts: item.ts,
		isFavorited: item.isFavorited ?? false,
		size: item.size ?? 0,
		totalCost: item.totalCost ?? 0,
		tokensIn: item.tokensIn ?? 0,
		tokensOut: item.tokensOut ?? 0,
		cacheWrites: item.cacheWrites ?? 0,
		cacheReads: item.cacheReads ?? 0,
		isLegacy: item.isLegacy ?? false,
	})
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class Controller {
	// SDK session state and the coordinators that drive it.
	private messageTranslatorState: MessageTranslatorState
	private turnStateTracker!: TurnStateTracker
	private messages: SdkMessageCoordinator
	private sessions: SdkSessionLifecycle
	private sessionRebuilds: SdkSessionRebuildScheduler
	private interactions: SdkInteractionCoordinator
	private diffEdits: SdkDiffEditCoordinator
	private sessionConfigBuilder: SdkSessionConfigBuilder
	private taskHistory: SdkTaskHistory
	private mode: SdkModeCoordinator
	private mcpTools: SdkMcpCoordinator
	private terminalExecutionMode: SdkTerminalExecutionModeCoordinator

	// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01:
	// Live shadow wiring — observation-only. The wiring is instantiated
	// in the constructor and disposed in `dispose()`. It subscribes to
	// the existing `SdkSessionLifecycle.onSessionEvent` hook, samples
	// `TurnStateTracker.currentPhase` synchronously, and feeds the
	// recorder with the classified differential records. The host-only
	// emit helpers in `task-state-shadow-host-msgs.ts` push
	// `task_requested` / `task_reset` / `task_cancelled` /
	// `same_task_continued` TaskMsgs into the shadow through this sink.
	// EFFECT_EXECUTION_ENABLED is FALSE.
	private taskStateShadowWiring: TaskShadowHostWiringWithSink | undefined
	private providerChanges: SdkProviderChangeCoordinator
	private followups: SdkFollowupCoordinator
	private taskControl: SdkTaskControlCoordinator
	private taskStart: SdkTaskStartCoordinator
	private compaction: SdkCompactionCoordinator
	// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: host-owned task telemetry
	// accumulator (elapsed / tool / recovery counters). Survives webview
	// remount; resets only on a NEW task identity.
	private taskTelemetry: TaskTelemetryTracker
	private taskTelemetryRecoveryUnsub: (() => void) | undefined
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03:
	 * Owner of the canonical `AgentRuntimeEvent` subscription on the
	 * VS Code shadow boundary. The owner is the single source of
	 * truth for the unsubscribe handle; the controller does not
	 * store a raw `unsubscribe` callback. Created once per
	 * controller; attached on each new task; disposed in `dispose()`.
	 */
	private readonly taskStateRuntimeEventsSubscription: CanonicalRuntimeShadowSubscription
	private taskTelemetryPhaseUnsub: (() => void) | undefined
	// ACT-CLINEMM-SESSION-AUTONOMY01:
	// Single owner of the active-session auto-approval override ("none" | "all").
	// NOT persisted; cleared by the task-clear choke-point (and by new-task init).
	private sessionAutoApproval = new SessionAutoApprovalStore()
	private sessionEvents: SdkSessionEventCoordinator
	private sessionHistory: SdkSessionHistoryLoader
	private readonly sdkTelemetry: VscodeSdkTelemetryHandle
	private readonly providerFailureTelemetryTurnGate = new ProviderFailureTelemetryTurnGate()
	private readonly providerConfigStore: ProviderConfigStore
	private readonly providerCatalog: ProviderCatalog
	private readonly providerConfigStoreSubscription: Disposable
	private providerConfigStatePostScheduled = false

	// Debounces/coalesces postStateToWebview() calls — see StatePostDebouncer.
	private static readonly STATE_POST_DEBOUNCE_MS = 50
	private readonly statePostDebouncer: StatePostDebouncer

	// Bridges SDK events to the webview's gRPC streams.
	private grpcBridge: WebviewGrpcBridge

	// Presents the Task interface that gRPC handlers expect, delegating to the
	// active SDK session.
	task?: TaskProxy

	mcpHub: McpHub
	accountService: ClineAccountService
	authService: AuthService
	ocaAuthService: OcaAuthService
	readonly stateManager: StateManager

	// Lazy terminal manager for foreground (VS Code terminal) command execution.
	// Created on first use; shared across all sessions in this Controller's lifetime.
	// Only used in the `vscodeTerminal` execution mode — `backgroundExec` and the
	// standalone (JetBrains/CLI) host run commands through the SDK's built-in tool.
	private _terminalManager?: VscodeTerminalManager

	// Registry of in-flight foreground (VS Code terminal) command executions.
	// Owned here — not by the session — so it survives session rebuilds, which
	// recreate the tool set. Drives the "Proceed While Running" button.
	private readonly foregroundCommands = new SdkForegroundCommandCoordinator({
		onRunningChanged: () => {
			void this.postStateToWebview()
		},
	})

	// Private state kept for stub compatibility
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string
	private pendingClineAuthRetryPrompt?: string
	checkpointRestoreInput?: ExtensionState["checkpointRestoreInput"]

	// Timer for periodic remote config fetching (enterprise policy enforcement)
	private remoteConfigTimer?: NodeJS.Timeout
	private remoteConfigCoreIntegration?: PreparedRemoteConfigCoreIntegration

	// Watches user-instruction files (workflows/skills/rules), including those
	// materialized by remote config under `.cline/remote-config/`. Used to expand
	// `/workflow` and `/skill` slash commands into their instruction bodies before
	// the prompt reaches the model — the same mechanism the CLI uses in
	// `buildUserInputMessage`. The agent loop never auto-expands commands, so this
	// host-side expansion is required. Created lazily (memoized as a promise to be
	// race-free under concurrent first sends) and rebuilt if the workspace root
	// changes.
	private userInstructionService?: Promise<UserInstructionConfigService>
	private userInstructionServiceRoot?: string
	private isDisposed = false

	// Synchronous snapshot of getWorkspaceRoot()'s latest result, for the message
	// translator (which runs synchronously and relativizes the tool paths shown in
	// the chat view). Warmed in the constructor and refreshed on every call.
	private lastKnownWorkspaceRoot?: string

	get remoteConfig(): RemoteConfig | undefined {
		return this.remoteConfigCoreIntegration?.prepared.bundle?.remoteConfig
	}

	get remoteConfigBundle(): RemoteConfigBundle | undefined {
		return this.remoteConfigCoreIntegration?.prepared.bundle
	}

	constructor(readonly context: ClineExtensionContext) {
		// StateManager must be initialized before creating the Controller
		this.stateManager = StateManager.get()
		syncTelemetrySettingFromSharedGlobalSettings(this.stateManager)
		this.sdkTelemetry = createVscodeSdkTelemetryHandle()
		this.statePostDebouncer = new StatePostDebouncer({
			debounceMs: Controller.STATE_POST_DEBOUNCE_MS,
			flush: () => this.flushStateToWebview(),
		})
		this.providerConfigStore = createProviderConfigStore()
		this.providerCatalog = createProviderCatalog(this.providerConfigStore)
		this.providerConfigStoreSubscription = this.providerConfigStore.subscribe((event) => {
			this.handleProviderConfigChange(event)
		})

		// IMPORTANT: Use ~/.cline/data/settings/ for the settings directory,
		// NOT ensureSettingsDirectoryExists() which returns the VSCode extension
		// storage path (HostProvider.globalStorageFsPath/settings/). The MCP
		// settings file lives at ~/.cline/data/settings/cline_mcp_settings.json
		// (shared across VSCode, CLI, and JetBrains clients).
		this.mcpHub = new McpHub(
			() => ensureMcpServersDirectoryExists(),
			async () => {
				const settingsDir = path.dirname(resolveDefaultMcpSettingsPath())
				await fs.mkdir(settingsDir, { recursive: true })
				return settingsDir
			},
			ExtensionRegistryInfo.version,
			telemetryService,
		)

		// Initialize SDK-backed auth and account services.
		this.authService = AuthService.getInstance(this, this.sdkTelemetry.telemetry)
		this.ocaAuthService = OcaAuthService.initialize(this)
		this.accountService = ClineAccountService.getInstance()

		// Initialize message translator state. The mode getter styles the inferred turn-final
		// completion row (plan → yellow plan box, act → green completion box).
		this.messageTranslatorState = new MessageTranslatorState(
			undefined,
			() => this.getActiveProviderId(),
			() => (this.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"),
			() => this.lastKnownWorkspaceRoot,
			// Model backing the active turn — lets error reshaping recognize
			// retired cline-free/ models (the error payload itself never names one).
			// The task shim is preferred over session-start metadata: a mid-task
			// model-only switch updates the running session's model in place
			// (updateActiveSessionModel) and refreshes the shim, but never touches
			// startConfig/manifest, which would otherwise report the stale model.
			// The shim starts as "unknown" (filtered out by getTaskModelId), so
			// fresh sessions still resolve through their start metadata.
			() => this.getTaskModelId() ?? this.getSessionModelId(),
		)
		// Warm the synchronous workspace-root snapshot used for display-path
		// relativization (getWorkspaceRoot never rejects — it falls back internally).
		void this.getWorkspaceRoot()
		// Authoritative UI-mode tracker, sharing the one id/seq/epoch authority.
		this.turnStateTracker = new TurnStateTracker(this.messageTranslatorState.getMinter())
		// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
		// Canonical terminal-phase observer: every transition the
		// turn-state tracker publishes is forwarded to the telemetry
		// tracker's `observeTurnPhase`, which freezes the elapsed clock
		// exactly once on `error` / `resumable` / `completed`. This is
		// the single canonical seam — sprinkling `endTask()` calls
		// through SdkController risks forgetting one terminal path.
		//
		// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION03:
		// DEFENSE-IN-DEPTH observer wrap. TurnStateTracker.set()
		// isolates listener throws internally (they cannot veto the
		// authoritative phase transition), but we ALSO wrap this
		// subscriber so any future bug in observeTurnPhase or any
		// caller-side hook added here stays contained. Telemetry must
		// remain removable without affecting task execution.
		this.taskTelemetryPhaseUnsub = this.turnStateTracker.subscribe((phase, anchorTs) => {
			try {
				this.taskTelemetry.observeTurnPhase(phase, anchorTs)
			} catch (error) {
				Logger.error("[SdkController] TaskTelemetryTracker.observer threw; isolated.", error)
			}
		})
		// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: cumulative task telemetry
		// (elapsed / tool / recovery counters). Lives across the controller
		// lifetime so webview reconnect / React remount does not reset.
		this.taskTelemetry = new TaskTelemetryTracker()
		this.messages = new SdkMessageCoordinator({
			getTask: () => this.task,
			// Stamp seq/epoch on every message flowing to the webview from the shared authority.
			getMinter: () => this.messageTranslatorState.getMinter(),
		})
		this.sessionHistory = new SdkSessionHistoryLoader()
		this.sessionConfigBuilder = new SdkSessionConfigBuilder({
			stateManager: this.stateManager,
			emitHookMessage: (msg) => this.messages.emitHookMessage(msg),
			onConsecutiveMistakeLimitReached: (context) => this.interactions.handleConsecutiveMistakeLimitReached(context),
		})
		this.diffEdits = new SdkDiffEditCoordinator({
			getCwd: () => this.getWorkspaceRoot(),
			isBackgroundEditEnabled: () => !!this.stateManager.getGlobalSettingsKey("backgroundEditEnabled"),
		})
		this.interactions = new SdkInteractionCoordinator({
			messages: this.messages,
			getSessionId: () => this.sessions.getActiveSession()?.sessionId ?? "",
			postStateToWebview: () => this.postStateToWebview(),
			// Share the single id/seq/epoch authority so interaction-minted ids (tool-approval
			// asks, ask_question, user_feedback) never collide with translator-minted ids.
			getMinter: () => this.messageTranslatorState.getMinter(),
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
			// Open the diff editor preview before the approval buttons render.
			onToolApprovalAsk: (request) => this.diffEdits.openForApproval(request.toolCallId, request.toolName, request.input),
			recordApprovedToolMessage: (toolCallId, messageTs) =>
				this.messageTranslatorState.recordApprovedToolMessageTs(toolCallId, messageTs),
			recordDeniedToolApproval: (toolCallId, toolName, reason) => {
				this.messageTranslatorState.recordDeniedToolApproval(toolCallId, toolName, reason)
				// A denied edit's executor never runs, so close its diff preview here. Covers
				// manual Reject and clearPending (task cancel/abort) in one place.
				void this.diffEdits.discardPreview(toolCallId)
			},
			// ACT-CLINEMM-UPSTREAM-SETTINGS-AUTHORITY-PARITY01:
			// Non-command tools (read/edit/browser/mcp) consult the live user
			// settings via isToolAutoApproved, matching upstream's
			// shouldAutoApproveTool wiring (v4.1.10). Command tools continue
			// to route through the canonical policy lattice via
			// evaluateCommandToolApproval below.
			//
			// ACT-CLINEMM-SESSION-AUTONOMY01:
			// The non-command path now reads the EFFECTIVE settings
			// (persisted + ephemeral session override). The override only
			// projects ordinary categories — it never bypasses hard DENY,
			// and it never mutates the persisted object.
			shouldAutoApproveTool: (request) => {
				if (isCommandTool(request.toolName)) {
					// Command tools go through evaluateCommandToolApproval
					// (canonical policy lattice) below; this hook is the
					// non-command fast path.
					return false
				}
				const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
				const persisted = autoApprovalSettings ?? DEFAULT_AUTO_APPROVAL_SETTINGS
				const sessionId = this.sessions.getActiveSession()?.sessionId
				const override = this.sessionAutoApproval.getOverride(sessionId)
				const effective = resolveEffectiveAutoApproval(persisted, override)
				// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03: project the
				// override into the MCP branch of isToolAutoApproved so a
				// task-scoped "ALL" lifts the per-tool autoApprove gate for
				// ordinary MCP tools (e.g. figma-desktop__get_metadata). The
				// global useMcp toggle is already projected true via
				// `effective`; the override now closes the per-tool gap.
				return isToolAutoApproved(request.toolName, effective, this.mcpHub, override)
			},
			// CORRECTION04 TOCTOU fix: read settings ONCE and produce one
			// atomic evaluation that carries both authority and execution constraints.
			// This eliminates the race between shouldAutoApproveTool (authority)
			// and buildCommandExecutionPlan (constraints) across the approval UI.
			evaluateCommandToolApproval: (request) => {
				const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
				// For command tools: atomic single-pass evaluation via canonical policy.
				if (!isCommandTool(request.toolName)) {
					return undefined // Non-command tools use coordinator's standard ToolPolicy path.
				}
				const persisted = autoApprovalSettings ?? DEFAULT_AUTO_APPROVAL_SETTINGS
				const sessionId = this.sessions.getActiveSession()?.sessionId
				const override = this.sessionAutoApproval.getOverride(sessionId)
				// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01:
				// When the ephemeral session override is "all", project the
				// host authorization to { mode: "all", explicitAllowRules }.
				// Option B: skip human approval but retain hardened envelopes
				// whenever a command has a known safe execution profile. Only
				// unmatched commands fall through to bare host_mode_all. This
				// also makes execution_plan_invalid reachable on planner failure.
				// Hard DENY at step 1 still wins.
				// Model escalation (requires_approval=true) is suppressed via
				// stripRequiresApproval so the user's explicit session authority
				// is not silently downgraded by an advisory model hint.
				let hostAuthorization = getCommandHostAuthorization(request.toolName, persisted, this.mcpHub)
				let toolInput = request.input
				if (override === "all") {
					// Compose over the base auth we just computed; this preserves
					// explicitDenyRules (CORRECTION02 fix — see resolveSessionHostAuthorization).
					const sessionHostAuth = resolveSessionHostAuthorization(hostAuthorization, override)
					if (sessionHostAuth) {
						hostAuthorization = sessionHostAuth
					}
					toolInput = stripRequiresApproval(request.input)
				}
				// CORRECTION02: cancel_command is a job-control capability,
				// not a shell command. It must NOT funnel through the
				// canonical command-policy normalizer (which would return
				// ASK on unparseable input regardless of host mode, even
				// mode `all`). Dispatch to the dedicated job-control
				// authority function, which respects the same host mode
				// matrix as run_commands but evaluates the jobId input
				// shape directly.
				if (request.toolName === "cancel_command") {
					const cancelResult = evaluateCancelCommandToolApproval(toolInput, hostAuthorization)
					return {
						approved: cancelResult.approved,
						decision: cancelResult.decision,
						// cancel_command has no execution plan — it is a
						// control signal, not a shell command.
						executionPlan: undefined,
					}
				}
				const result = evaluateCommandToolApprovalWithPlan(toolInput, hostAuthorization)
				return {
					approved: result.approved,
					decision: result.decision,
					executionPlan: result.executionPlan,
				}
			},
			getCwd: () => this.lastKnownWorkspaceRoot,
		})
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01:
		// Instantiate the live shadow wiring BEFORE `new SdkSessionLifecycle`
		// because the wiring wraps `onSessionEvent` by mutating the
		// session-options object. The lifecycle reads `options.onSessionEvent`
		// lazily inside `ensureSharedHostSubscription`, so wrapping here
		// takes effect at the first event.
		this.taskStateRuntimeEventsSubscription = new CanonicalRuntimeShadowSubscription()
		this.taskStateShadowWiring = createTaskShadowHostWiring({
			// Pass a self-reference so the wiring can reach back through
			// `this.sessions` after the lifecycle is constructed. The
			// wiring calls `lifecycle.getActiveSession()` only lazily
			// (inside `observeLegacyEvent`), so the closure is safe.
			lifecycle: {
				getActiveSession: () => this.sessions?.getActiveSession(),
				setRunning: (flag) => this.sessions?.setRunning(flag),
			},
			sessionOptions: {
				mcpHub: this.mcpHub,
				telemetry: this.sdkTelemetry.telemetry,
				requestToolApproval: (request) => this.interactions.handleRequestToolApproval(request),
				askQuestion: (question, options, context) => this.interactions.handleAskQuestion(question, options, context),
				editorExecutor: (input, cwd, context) => this.diffEdits.executeEditorTool(input, cwd, context),
				applyPatchExecutor: (input, cwd, context) => this.diffEdits.executeApplyPatchTool(input, cwd, context),
				readFileExecutor: createWorkspaceFileReadExecutor(() => this.getWorkspaceRoot()),
				onSessionEvent: (event) => {
					this.sessionEvents.handleSessionEvent(event).catch((err) => {
						Logger.error("[SdkController] Failed to handle session event:", err)
					})
				},
				onSendComplete: () => undefined,
				onSendError: () => undefined,
			},
			getLegacyPhase: () => this.turnStateTracker.currentPhase,
			getArbiterSnapshot: () => {
				// ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-F1-CANONICAL-RUNTIME-EVENT-SEAM01-ELM-02F-CORRECTION01:
				// Canonical arbiter source. The legacy mirror that
				// derived `execution` from `turnStateTracker.currentPhase`
				// is preserved as the FALLBACK only.
				//
				// Source selection (CONTRACT_2 — `?.()` only):
				//   * `this.sessions?.getActiveSession()?.sdkHost`
				//     may be absent (no active session) — no-op
				//   * `.runtimeSnapshot?.()` may be absent on
				//     Hub/Remote hosts — same path as returns-undefined
				//   * the function call may return `undefined` even
				//     when present (Local active but no
				//     `AgentRuntime` instance yet, or between runs)
				//
				// All three converge to the legacy fallback
				// (CANONICAL_MAPPER_ACCEPTS_TURN_PHASE = false, §3.2).
				//
				// The legacy phase is read ONLY in the fallback
				// branch. The canonical mapper reads ONLY from the
				// snapshot — by construction, T2_LEGACY_INDEPENDENCE
				// holds. T8_NECESSITY holds because the canonical
				// mapper is a real `AgentRuntime.snapshot()`
				// projection (not a constant/dead function).
				//
				// ACT-CLINEMM-ELM-ARCHITECTURE01-E7-LOCAL-BACKEND-ACTIVATION01-CORRECTION01 R1:
				// The selection expression is delegated to
				// `selectTaskShadowArbiterSnapshot` so the E7-PRE1
				// integration witness and the production
				// `SdkController.getArbiterSnapshot` closure share
				// the SAME selection function. There is no
				// test-side re-implementation of the selection.
				const sdkHost = this.sessions?.getActiveSession()?.sdkHost
				const sessionId = this.sessions?.getActiveSession()?.sessionId
				const canonicalSnapshot = sdkHost?.runtimeSnapshot?.(sessionId)
				return selectTaskShadowArbiterSnapshot({
					canonicalSnapshot,
					currentLegacyPhase: this.turnStateTracker.currentPhase,
				})
			},
			getRuntimeStatus: () => "running",
			now: () => Date.now(),
			onInvariantViolation: (record) => {
				Logger.error(`[SdkController] TaskStateShadow invariant violation: ${JSON.stringify(record)}`)
			},
		})
		this.sessions = new SdkSessionLifecycle({
			mcpHub: this.mcpHub,
			telemetry: this.sdkTelemetry.telemetry,
			requestToolApproval: (request) => this.interactions.handleRequestToolApproval(request),
			askQuestion: (question, options, context) => this.interactions.handleAskQuestion(question, options, context),
			editorExecutor: (input, cwd, context) => this.diffEdits.executeEditorTool(input, cwd, context),
			applyPatchExecutor: (input, cwd, context) => this.diffEdits.executeApplyPatchTool(input, cwd, context),
			// The SDK's built-in reader resolves relative paths against the extension
			// host's process.cwd() (usually "/"); resolve them against the workspace instead.
			readFileExecutor: createWorkspaceFileReadExecutor(() => this.getWorkspaceRoot()),
			onSessionEvent: (event) => {
				this.sessionEvents.handleSessionEvent(event).catch((err) => {
					Logger.error("[SdkController] Failed to handle session event:", err)
				})
			},
			// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: feed canonical
			// `tool-started` events (post chat-translation: `content_start(tool)`)
			// into the cumulative tool-call counter. The runtime emits one
			// `tool-started` per tool invocation that reached the executor;
			// control-plane DENY/REJECT/UNKNOWN_TOOL never emit this event,
			// so the counter naturally excludes them.
			onToolStarted: () => {
				this.taskTelemetry.recordToolStarted()
			},
			onDidBecomeIdle: () => this.handleSessionBecameIdle(),
			getRemoteConfigIntegration: () => this.remoteConfigCoreIntegration,
			foregroundCommands: this.foregroundCommands,
			getTerminalManager: () => {
				// Guarded by getEffectiveTerminalExecutionMode() at the read sites
				// (vscode-session-host.ts, sdk-terminal-execution-mode-coordinator.ts):
				// this factory itself is only invoked when a caller has already
				// resolved to "vscodeTerminal" mode on a real VS Code host, but
				// VscodeTerminalManager's constructor still assumes
				// vscode.window.onDidStartTerminalShellExecution exists, which the
				// standalone (JetBrains/CLI) stub does not provide.
				if (!this._terminalManager) {
					this._terminalManager = new VscodeTerminalManager()
					this.applyTerminalSettings(this._terminalManager)
					Logger.log("[SdkController] Created VscodeTerminalManager for foreground terminal execution")
				}
				return this._terminalManager
			},
			onSendStart: () => {
				this.beginProviderFailureTelemetryTurn()
			},
			// this.mode is assigned later in this constructor; the closure only
			// runs at send time, long after construction completes.
			consumeModeSwitchNotice: (sessionId) => this.mode.consumeModeSwitchNotice(sessionId),
			// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION02: consume the user-armed
			// pre-arm at the authoritative session-id allocation site.
			consumePendingOverride: (sessionId) => this.sessionAutoApproval.consumePendingOverride(sessionId),
			onSendComplete: async () => {
				// Normal flows close their diff sessions inline; anything left here is orphaned.
				void this.diffEdits.discardAllPreviews("turn complete")

				this.postStateToWebview().catch((err) => {
					Logger.error("[SdkController] Failed to post state after turn:", err)
				})
			},
			onSendError: async (error, sessionId) => {
				// A turn failed — the UI shows error recovery (Retry / Sign In / Add Credits).
				void this.diffEdits.discardAllPreviews("turn error")
				this.turnStateTracker.set("error")
				const errorMessage = error instanceof Error ? error.message : String(error)
				const providerId = this.getSessionProviderId(sessionId) ?? this.getActiveProviderId()
				const isClineAuthError =
					isClineManagedProvider(providerId) &&
					(errorMessage.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
						errorMessage.toLowerCase().includes("missing api key") ||
						errorMessage.toLowerCase().includes("unauthorized"))

				if (isClineAuthError) {
					this.captureProviderFailure({
						sessionId,
						error,
						providerId,
						errorType: PROVIDER_FAILURE_ERROR_TYPE.AUTH,
						failurePhase: PROVIDER_FAILURE_PHASE.PREFLIGHT,
					})
					this.emitClineAuthError()
				} else if (isClineManagedProvider(providerId) && this.isClineBalanceError(errorMessage)) {
					this.captureProviderFailure({
						sessionId,
						error,
						providerId,
						errorType: PROVIDER_FAILURE_ERROR_TYPE.BALANCE,
						failurePhase: PROVIDER_FAILURE_PHASE.PREFLIGHT,
					})
					this.emitClineBalanceError(errorMessage)
				} else {
					this.captureProviderFailure({
						sessionId,
						error,
						providerId,
						errorType: PROVIDER_FAILURE_ERROR_TYPE.SEND_ERROR,
						failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
					})
					this.messages.emitSessionEvents(
						[
							{
								ts: Date.now(),
								type: "say",
								say: "error",
								text: `Agent error: ${errorMessage}`,
								partial: false,
							},
						],
						{ type: "status", payload: { sessionId, status: "error" } },
					)
				}
				this.postStateToWebview().catch(() => {})
			},
		})
		this.sessionRebuilds = new SdkSessionRebuildScheduler({ sessions: this.sessions })
		this.taskHistory = new SdkTaskHistory({
			mcpHub: this.mcpHub,
			sessions: this.sessions,
			legacyExtensionStorageDir: this.context.globalStorageUri.fsPath,
			telemetry: telemetryService,
			// History rendering mints ids from the shared authority so regenerated history ids
			// never overlap live-session ids.
			getMinter: () => this.messageTranslatorState.getMinter(),
		})
		this.mode = new SdkModeCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			interactions: this.interactions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getTask: () => this.task,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: async (sdkHost, sessionId) =>
				(await this.sessionHistory.loadInitialMessages(sdkHost, sessionId)) ?? [],
			buildStartSessionInput,
			emitClineAuthError: () => this.emitClineAuthErrorWithTelemetry(),
			resetMessageTranslator: () => this.resetMessageTranslatorAndFence(),
			postStateToWebview: () => this.postStateToWebview(),
			getTurnPhase: () => this.turnStateTracker.currentPhase,
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			rebuilds: this.sessionRebuilds,
			onAutoContinueStarting: () => {
				this.turnStateTracker.set("streaming")
				this.messageTranslatorState.clearTurnOutcome()
			},
			onAutoContinueFailed: () => {
				this.turnStateTracker.set("error")
			},
		})
		this.mcpTools = new SdkMcpCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: async (sdkHost, sessionId) =>
				(await this.sessionHistory.loadInitialMessages(sdkHost, sessionId)) ?? [],
			buildStartSessionInput,
			postStateToWebview: () => this.postStateToWebview(),
			rebuilds: this.sessionRebuilds,
		})
		this.terminalExecutionMode = new SdkTerminalExecutionModeCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: async (sdkHost, sessionId) =>
				(await this.sessionHistory.loadInitialMessages(sdkHost, sessionId)) ?? [],
			buildStartSessionInput,
			postStateToWebview: () => this.postStateToWebview(),
			rebuilds: this.sessionRebuilds,
		})
		this.providerChanges = new SdkProviderChangeCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getTask: () => this.task,
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: async (sdkHost, sessionId) =>
				(await this.sessionHistory.loadInitialMessages(sdkHost, sessionId)) ?? [],
			buildStartSessionInput,
			postStateToWebview: () => this.postStateToWebview(),
			rebuilds: this.sessionRebuilds,
		})
		this.followups = new SdkFollowupCoordinator({
			stateManager: this.stateManager,
			interactions: this.interactions,
			sessions: this.sessions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			sessionConfigBuilder: this.sessionConfigBuilder,
			waitForPendingRebuilds: async () => {
				await this.mode.waitForPendingRebuild()
				await this.sessionRebuilds.waitUntilSettled()
			},
			runExclusive: (operation) => this.sessionRebuilds.runExclusive(operation),
			getTask: () => this.task,
			createTempSessionHost: () => VscodeSessionHost.create({ mcpHub: this.mcpHub }),
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			loadInitialMessages: (sessionHost, taskId) => this.sessionHistory.loadInitialMessages(sessionHost, taskId),
			buildStartSessionInput,
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			isClineManagedProviderActive: () => this.isClineManagedProviderActive(),
			emitClineAuthError: () => this.emitClineAuthErrorWithTelemetry(),
			resetMessageTranslator: () => this.resetMessageTranslatorAndFence(),
			postStateToWebview: () => this.postStateToWebview(),
			onResumeFailed: () => {
				this.turnStateTracker.set("error")
			},
			onFollowUpAbandoned: () => {
				// Settle the streaming phase askResponse pre-set, unless a turn
				// (for example on the newly displayed task) has actually started.
				if (this.turnStateTracker.currentPhase === "streaming" && !this.sessions.getActiveSession()?.isRunning) {
					this.turnStateTracker.set("idle")
				}
			},
		})
		this.taskControl = new SdkTaskControlCoordinator({
			sessions: this.sessions,
			interactions: this.interactions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			getTask: () => this.task,
			setTask: (task) => {
				this.task = task
			},
			onAskResponse: (text, images, files) => this.askResponse(text, images, files),
			resetMessageTranslator: () => this.resetMessageTranslatorAndFence(),
			// Bump the epoch synchronously before abort so straggler events from the cancelled
			// turn carry the old epoch and are dropped by the webview. The resumable phase is set
			// in SdkController.cancelTask before this runs.
			raiseCancelFence: () => {
				this.messageTranslatorState.clearApprovedToolMessageTs()
				this.messageTranslatorState.getMinter().bumpEpoch()
			},
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.taskStart = new SdkTaskStartCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			sessionConfigBuilder: this.sessionConfigBuilder,
			buildStartSessionInput,
			createHistoryItemFromSession,
			clearTask: async () => {
				this.pendingClineAuthRetryPrompt = undefined
				await this.taskControl.clearTask()
			},
			setTask: (task) => {
				this.task = task
			},
			onAskResponse: (text, images, files) => this.askResponse(text, images, files),
			onCancelTask: () => this.cancelTask(),
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			createTempSessionHost: () => VscodeSessionHost.create({ mcpHub: this.mcpHub }),
			loadInitialMessages: (reader, taskId) => this.sessionHistory.loadInitialMessages(reader, taskId),
			resolveContextMentions: (text) => this.resolveContextMentions(text),
			isClineManagedProviderActive: () => this.isClineManagedProviderActive(),
			emitClineAuthError: (task) => this.emitClineAuthErrorWithTelemetry(task),
			// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION02: the canonical
			// new-task → streaming writer is `SdkTaskStartCoordinator`,
			// which calls this callback at the lifecycle boundary (after
			// the inner `clearTask()` ran and after `startNewSession`
			// resolves). We inject it here so the coordinator writes
			// through this controller's shared `turnStateTracker` — no
			// other site in this controller writes "streaming" for the
			// new-task or resume lifecycle.
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
			captureProviderApiError: (event) => this.captureProviderFailure(event),
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.compaction = new SdkCompactionCoordinator({
			stateManager: this.stateManager,
			sessions: this.sessions,
			rebuilds: this.sessionRebuilds,
			messages: this.messages,
			taskHistory: this.taskHistory,
			sessionConfigBuilder: this.sessionConfigBuilder,
			getDisplayedTaskId: () => this.task?.taskId,
			createTempSessionHost: () => VscodeSessionHost.create({ mcpHub: this.mcpHub }),
			loadInitialMessages: (reader, taskId) => this.sessionHistory.loadInitialMessages(reader, taskId),
			getWorkspaceRoot: () => this.getWorkspaceRoot(),
			postStateToWebview: () => this.postStateToWebview(),
		})
		this.sessionEvents = new SdkSessionEventCoordinator({
			messageTranslatorState: this.messageTranslatorState,
			sessions: this.sessions,
			messages: this.messages,
			taskHistory: this.taskHistory,
			stateManager: this.stateManager,
			getTask: () => this.task,
			postStateToWebview: () => this.postStateToWebview(),
			setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(phase, anchorTs),
			getTurnPhase: () => this.turnStateTracker.currentPhase,
			captureProviderApiError: (event) => this.captureProviderFailure(event),
			beginProviderFailureTelemetryTurn: () => this.beginProviderFailureTelemetryTurn(),
		})
		// Subscribe to MCP tool list changes so we can restart the SDK session
		// when servers are added/removed/reconnected. The SDK's DefaultSessionBuilder
		// does not support dynamic MCP tools, so we must restart the session.
		this.mcpHub.setToolListChangeCallback(() => this.mcpTools.handleToolListChanged())

		// Initialize gRPC bridge
		this.grpcBridge = new WebviewGrpcBridge(this.messageTranslatorState)

		// Wire the bridge to the controller's getStateToPostToWebview()
		// so state updates include messages, currentTaskItem, and task history
		this.grpcBridge.setGetStateFn(() => this.getStateToPostToWebview())

		// Register the bridge as a session event listener
		this.onSessionEvent(this.grpcBridge.createListener())

		// Restore auth state from secrets on startup, then start the remote
		// config polling timer (enterprise policy enforcement). The timer must
		// start after auth is restored so remote config can identify the user's
		// organization and apply org-level policies.
		this.authService
			.restoreRefreshTokenAndRetrieveAuthInfo()
			.then(() => {
				this.startRemoteConfigTimer()
			})
			.catch((err) => {
				Logger.error("[SdkController] Failed to restore auth state:", err)
			})

		Logger.log("[SdkController] Initialized with SDK adapter layer + gRPC bridge + auth services")
	}

	getProviderConfigStore(): ProviderConfigStore {
		return this.providerConfigStore
	}

	getProviderCatalog(): ProviderCatalog {
		return this.providerCatalog
	}

	invalidateProviderListings(): void {
		this.providerCatalog.invalidateProviderListings()
	}

	private handleProviderConfigChange(event: ProviderConfigChange): void {
		this.scheduleProviderConfigStatePost()

		if (event.kind === "selection" && this.isSelectionForActiveModeProvider(event)) {
			this.sessions
				?.updateActiveSessionModel(event.selection.modelId)
				.catch((error) => Logger.error("[SdkController] Failed to update active session model:", error))
		}
	}

	handleApiConfigurationChanged(previous: ApiConfiguration, next: ApiConfiguration): void {
		this.providerChanges.handleApiConfigurationChanged(previous, next)
	}

	handleTerminalExecutionModeChanged(previous: VscodeTerminalExecutionMode, next: VscodeTerminalExecutionMode): void {
		this.terminalExecutionMode.handleTerminalExecutionModeChanged(previous, next)
	}

	private handleSessionBecameIdle(): void {
		this.sessionRebuilds?.sessionBecameIdle()
	}

	private isSelectionForActiveModeProvider(event: Extract<ProviderConfigChange, { kind: "selection" }>): boolean {
		try {
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode = modeValue === "plan" ? "plan" : "act"
			if (event.mode !== mode) {
				return false
			}

			const apiConfig = this.stateManager.getApiConfiguration()
			const activeProvider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
			if (activeProvider === undefined) {
				return false
			}
			// Normalize both sides so stale SDK spellings in cached state
			// (e.g. `openai-compatible`) still match the parse-normalized
			// event id and model-only commits keep the lightweight
			// in-session update path.
			return toLegacyApiProvider(activeProvider) === toLegacyApiProvider(event.providerId.toString())
		} catch {
			return false
		}
	}

	private scheduleProviderConfigStatePost(): void {
		if (this.providerConfigStatePostScheduled) {
			return
		}

		this.providerConfigStatePostScheduled = true
		queueMicrotask(() => {
			this.providerConfigStatePostScheduled = false
			this.postStateToWebview().catch((error) => {
				Logger.error("[SdkController] Failed to post state after provider config change:", error)
			})
		})
	}

	/**
	 * Starts the periodic remote config fetching timer. Fetches immediately
	 * and then every hour, to enforce enterprise policy (provider lockdown,
	 * MCP server management, OpenTelemetry, etc.).
	 */
	private startRemoteConfigTimer(): void {
		// Initial fetch
		this.refreshRemoteConfig().catch((err) => Logger.error("[SdkController] Initial remote config refresh failed:", err))
		// Set up 1-hour interval
		this.remoteConfigTimer = setInterval(() => {
			this.refreshRemoteConfig().catch((err) => Logger.error("[SdkController] Remote config timer failed:", err))
		}, 3600000) // 1 hour
	}

	private async refreshRemoteConfig(): Promise<void> {
		await refreshSdkRemoteConfig(this, {
			workspacePath: await this.getRemoteConfigWorkspacePath(),
		})
		// Remote config may have materialized new workflows/skills/rules under
		// `.cline/remote-config/`. Refresh the watcher so slash-command expansion
		// sees them without waiting on filesystem events.
		await this.refreshUserInstructionWatchers()
	}

	async setRemoteConfigCoreIntegration(integration: PreparedRemoteConfigCoreIntegration | undefined): Promise<void> {
		const previous = this.remoteConfigCoreIntegration
		this.remoteConfigCoreIntegration = integration
		if (previous && previous !== integration) {
			try {
				await previous.dispose()
			} catch (error) {
				Logger.error("[SdkController] Failed to dispose previous remote config integration:", error)
			}
		}
	}

	async invalidateUserInstructionService(): Promise<void> {
		const userInstructionServicePromise = this.userInstructionService
		this.userInstructionService = undefined
		this.userInstructionServiceRoot = undefined
		if (userInstructionServicePromise) {
			await userInstructionServicePromise.then((service) => service.stop()).catch(() => {})
		}
	}

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7-LOCAL-BACKEND-ACTIVATION01:
	 *
	 * Local-consumer advisory accessor. Returns the LAST canonical
	 * `ArbiterSnapshot` the shadow wiring recorded via its
	 * coordinator — i.e. the canonical projection the wiring just
	 * observed for the active task identity, or `undefined` when
	 * no observation has happened yet (no active task, the wiring
	 * was disabled by env flag, etc.).
	 *
	 * This is the E7-T2 LOCAL_CONSUMER_CUTOVER seam. The Local
	 * consumer (any Local-only diagnostic / assertion / future
	 * authority decision) reads the qualified backend through this
	 * accessor. Hub/Remote hosts do not have a
	 * `taskStateShadowWiring` — production code uses `?.()` so the
	 * absence state collapses to the legacy observation path.
	 *
	 * EFFECT_EXECUTION_ENABLED remains `false` — this accessor is
	 * read-only and advisory; it does NOT mutate Task / control
	 * state. E9 owns the effect-execution cutover.
	 */
	getLocalShadowProjection(): ArbiterSnapshot | undefined {
		return this.taskStateShadowWiring?.getLastObservedArbiter()
	}

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7-LOCAL-BACKEND-ACTIVATION01:
	 *
	 * Local-consumer advisory accessor. Returns the LAST
	 * shadow-side `TurnPhase` projection the wiring recorded, or
	 * `undefined`. Non-mutating; same `?.()` collapse contract as
	 * `getLocalShadowProjection()`.
	 */
	getLocalShadowPhase(): TurnPhase | undefined {
		return this.taskStateShadowWiring?.getLastObservedShadowPhase()
	}

	async dispose(): Promise<void> {
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01: dispose the
		// live shadow wiring first so no further events are observed.
		this.taskStateShadowWiring?.dispose()
		this.taskStateShadowWiring = undefined
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03:
		// delegate to the subscription owner, which disposes the
		// active listener (if any). The controller does NOT store
		// a raw unsubscribe callback anywhere.
		this.taskStateRuntimeEventsSubscription.dispose()
		this.providerConfigStoreSubscription.dispose()
		// Clear the remote config timer to prevent stale fetches
		if (this.remoteConfigTimer) {
			clearInterval(this.remoteConfigTimer)
			this.remoteConfigTimer = undefined
		}
		await this.setRemoteConfigCoreIntegration(undefined)
		this.isDisposed = true
		// Tear down the debounced state-post machinery before downstream resources
		// are disposed below — see StatePostDebouncer.dispose().
		await this.statePostDebouncer.dispose()
		await this.invalidateUserInstructionService()
		this.messages.cancelPendingSave()
		// Clear MCP tool list change callback before disposing McpHub
		this.mcpHub?.clearToolListChangeCallback()
		await this.diffEdits.discardAllPreviews("controller dispose")
		await this.clearTask()
		await this.sessions.dispose("SdkController.dispose")
		await this.taskHistory.dispose()
		this.mcpHub?.dispose?.()
		this.messages.dispose()
		await this.sdkTelemetry.dispose()
		Logger.log("[SdkController] Disposed")
	}

	// ---- Slash command + context mention resolution ----

	/**
	 * Lazily create (or rebuild on workspace-root change) the user-instruction
	 * watcher. Pointed at the workspace root so it discovers both local config
	 * (`.clinerules/workflows`, `.cline/workflows`, …) and remote-config files
	 * materialized under `<root>/.cline/remote-config/{workflows,skills,rules}`.
	 *
	 * `workspaceRoot` is resolved by the caller so the memoization check below runs
	 * synchronously on entry — there is no `await` before the assignment, so
	 * concurrent callers cannot create two competing watchers.
	 */
	private ensureUserInstructionService(workspaceRoot: string): Promise<UserInstructionConfigService> {
		// dispose() may have run during an awaited gap in the caller. Don't
		// resurrect a watcher the dispose path will never stop again.
		if (this.isDisposed) {
			return Promise.reject(new Error("Controller disposed"))
		}
		if (this.userInstructionService && this.userInstructionServiceRoot === workspaceRoot) {
			return this.userInstructionService
		}
		// Workspace root changed: stop the previous watcher once it settles.
		const previous = this.userInstructionService
		if (previous) {
			previous.then((service) => service.stop()).catch(() => {})
		}
		this.userInstructionServiceRoot = workspaceRoot
		this.userInstructionService = (async () => {
			const service = createUserInstructionConfigService({
				workflows: { workspacePath: workspaceRoot },
				skills: {
					workspacePath: workspaceRoot,
					includePluginSkills: true,
					cwd: workspaceRoot,
				},
				rules: { workspacePath: workspaceRoot },
			})
			// start() runs the initial scan; await so the snapshot is populated
			// before the first resolveRuntimeSlashCommand call.
			await service.start().catch((error) => {
				Logger.warn("[SdkController] Failed to start user instruction watcher:", error)
			})
			return service
		})()
		return this.userInstructionService
	}

	/**
	 * Expand a `/workflow` or `/skill` slash command into its instruction body.
	 * Serves the same purpose as the CLI's `buildUserInputMessage`, but is more
	 * permissive than the SDK's leading-only resolver: it accepts the legacy
	 * `/my-workflow.md` spelling the webview autocomplete inserts, matches
	 * commands mid-message (anything the chat input highlights as a command),
	 * and honors the user's workflow enable/disable toggles. Returns the input
	 * unchanged if no known command matches or expansion fails.
	 */
	private async resolveSlashCommands(text: string): Promise<string> {
		if (this.isDisposed) {
			return text
		}
		try {
			const workspaceRoot = await this.getWorkspaceRoot()
			const service = await this.ensureUserInstructionService(workspaceRoot)
			const remoteWorkflows = this.stateManager.getRemoteConfigSettings()?.remoteGlobalWorkflows ?? []
			const workflowRecords = service.listRecords("workflow").map((record) => ({
				id: record.id,
				name: record.item.name,
				filePath: record.filePath,
			}))
			const disabledWorkflowNames = buildDisabledWorkflowNames({
				records: workflowRecords,
				globalToggles: this.stateManager.getGlobalSettingsKey("globalWorkflowToggles"),
				workspaceToggles: this.stateManager.getWorkspaceStateKey("workflowToggles"),
				remoteToggles: this.stateManager.getGlobalStateKey("remoteWorkflowToggles"),
				remoteAlwaysEnabledNames: remoteWorkflows.filter((workflow) => workflow.alwaysEnabled).map((w) => w.name),
			})
			return expandSlashCommands(text, [...service.listRuntimeCommands(), ...BUILTIN_SLASH_COMMANDS], {
				disabledWorkflowNames,
				workflowRecords,
			})
		} catch (error) {
			Logger.warn("[SdkController] Slash command resolution failed, using raw text:", error)
			return text
		}
	}

	/**
	 * Refresh the user-instruction watcher after remote config is (re)materialized
	 * so newly written workflows/skills/rules are picked up immediately rather than
	 * waiting on filesystem watch events.
	 */
	private async refreshUserInstructionWatchers(): Promise<void> {
		const servicePromise = this.userInstructionService
		if (!servicePromise) {
			return
		}
		try {
			const service = await servicePromise
			await Promise.all([service.refreshType("workflow"), service.refreshType("skill"), service.refreshType("rule")])
		} catch (error) {
			Logger.warn("[SdkController] Failed to refresh user instruction watchers:", error)
		}
	}

	/**
	 * Expand slash commands, then resolve `@` context mentions in user text
	 * before sending to the SDK.
	 *
	 * `parseMentions()` inlines file content (`@/path`), URL content
	 * (`@https://...`), diagnostics (`@problems`), git state (`@git-changes`),
	 * and commit info (`@hash`) into the prompt text. We do this here because
	 * the SDK's own mention enricher only handles simple `@path` file mentions
	 * and does not understand the webview's `@/path` format or special
	 * mentions, so the LLM would otherwise never see the referenced content.
	 */
	private async resolveContextMentions(text: string): Promise<string> {
		const withCommands = await this.resolveSlashCommands(text)

		// Quick check: skip mention parsing if there are no @ mentions
		if (!mentionRegexGlobal.test(withCommands)) {
			return withCommands
		}
		// Reset lastIndex since RegExp.test() advances it for global regexes
		mentionRegexGlobal.lastIndex = 0

		try {
			const cwd = await this.getWorkspaceRoot()
			const urlContentFetcher = new UrlContentFetcher()
			const workspaceManager = await this.ensureWorkspaceManager()
			const resolved = await parseMentions(withCommands, cwd, urlContentFetcher, undefined, workspaceManager)
			Logger.log(`[SdkController] Resolved context mentions (${withCommands.length} → ${resolved.length} chars)`)
			return resolved
		} catch (error) {
			Logger.error("[SdkController] Failed to resolve context mentions, using raw text:", error)
			return withCommands
		}
	}

	// ---- Workspace root resolution ----

	/**
	 * Get the user's workspace root directory.
	 *
	 * In VSCode this resolves to `vscode.workspace.workspaceFolders[0]` via
	 * `HostProvider.workspace.getWorkspacePaths()`. If no workspace folder is
	 * open, it falls back to the SDK's shared chat workspace (see
	 * getNoWorkspaceFallback).
	 * This avoids using the VS Code extension host's `process.cwd()` (often `/`),
	 * which produces invalid SDK workspace metadata with an empty hint.
	 */
	private async getWorkspaceRoot(): Promise<string> {
		try {
			const { paths } = await HostProvider.workspace.getWorkspacePaths({})
			const workspaceRoot = paths?.find((workspacePath) => workspacePath.trim().length > 0)
			if (workspaceRoot) {
				this.lastKnownWorkspaceRoot = workspaceRoot
				return workspaceRoot
			}
		} catch (error) {
			Logger.warn("[SdkController] Failed to get workspace paths, using the no-workspace fallback:", error)
		}
		this.lastKnownWorkspaceRoot = await this.getNoWorkspaceFallback()
		return this.lastKnownWorkspaceRoot
	}

	private noWorkspaceFallbackPromise?: Promise<string>

	/**
	 * Directory used when no workspace folder is open: the SDK's shared chat
	 * workspace (`~/.cline/data/workspaces/chat`, seeded with an AGENTS.md
	 * etiquette file), matching how the desktop app and CLI host sessions
	 * started without a project. Desktop is only a last resort when the chat
	 * workspace cannot be created. Memoized so repeated no-workspace calls
	 * don't re-touch the filesystem.
	 */
	private getNoWorkspaceFallback(): Promise<string> {
		this.noWorkspaceFallbackPromise ??= (async () => {
			try {
				return await ensureChatWorkspace()
			} catch (error) {
				Logger.warn("[SdkController] Failed to prepare the chat workspace, falling back to Desktop:", error)
				// Don't memoize the degraded result; retry the chat workspace next time.
				this.noWorkspaceFallbackPromise = undefined
				return getDesktopDir()
			}
		})()
		return this.noWorkspaceFallbackPromise
	}

	private async getRemoteConfigWorkspacePath(): Promise<string | undefined> {
		try {
			const { paths } = await HostProvider.workspace.getWorkspacePaths({})
			if (!paths.length) {
				return undefined
			}
			return resolveWorkspaceRootPath(paths, paths[0])
		} catch (error) {
			Logger.warn("[SdkController] Failed to get workspace paths for remote config, using global fallback:", error)
			return undefined
		}
	}

	// ---- Session event subscription ----

	/**
	 * Subscribe to session events translated to ClineMessages.
	 * Returns an unsubscribe function.
	 */
	onSessionEvent(listener: SessionEventListener): () => void {
		return this.messages.onSessionEvent(listener)
	}

	/**
	 * Get the active API provider for the current mode.
	 */
	private getActiveProviderId(): string | undefined {
		try {
			const apiConfig = this.stateManager.getApiConfiguration()
			const modeValue = this.stateManager.getGlobalSettingsKey("mode")
			const mode = modeValue === "plan" ? "plan" : "act"
			return mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		} catch {
			return undefined
		}
	}

	private getTaskModelId(): string | undefined {
		const modelId = this.task?.api?.getModel?.().id?.trim()
		return modelId && modelId !== "unknown" ? modelId : undefined
	}

	private getSessionProviderId(sessionId?: string): string | undefined {
		const activeSession = this.sessions.getActiveSession()
		if (sessionId && activeSession?.sessionId !== sessionId) {
			return undefined
		}
		const providerId =
			activeSession?.startResult?.manifest?.provider?.trim() || activeSession?.startConfig?.providerId?.trim()
		return providerId && providerId !== "unknown" ? providerId : undefined
	}

	private getSessionModelId(sessionId?: string): string | undefined {
		const activeSession = this.sessions.getActiveSession()
		if (sessionId && activeSession?.sessionId !== sessionId) {
			return undefined
		}
		const modelId = activeSession?.startResult?.manifest?.model?.trim() || activeSession?.startConfig?.modelId?.trim()
		return modelId && modelId !== "unknown" ? modelId : undefined
	}

	private beginProviderFailureTelemetryTurn(): void {
		this.providerFailureTelemetryTurnGate.beginTurn()
	}

	/**
	 * Check if the active API provider uses Cline account auth for the current mode.
	 */
	private isClineManagedProviderActive(): boolean {
		return isClineManagedProvider(this.getActiveProviderId())
	}

	private captureProviderFailure(event: ProviderFailureTelemetry): void {
		const ulid = event.sessionId ?? this.task?.taskId ?? this.sessions.getActiveSession()?.sessionId
		if (!ulid) {
			return
		}
		if (
			event.failurePhase === PROVIDER_FAILURE_PHASE.STREAMING &&
			!this.providerFailureTelemetryTurnGate.shouldCaptureStreamingFailure()
		) {
			return
		}

		const provider = event.providerId ?? this.getSessionProviderId(event.sessionId) ?? "unknown"
		const model = event.modelId ?? this.getSessionModelId(event.sessionId) ?? this.getTaskModelId() ?? "unknown"
		const clineError = ClineError.transform(event.error, model, provider)

		telemetryService.captureProviderApiError({
			ulid,
			model,
			provider,
			errorMessage: clineError.message || String(event.error),
			errorStatus: clineError.status,
			requestId: clineError.requestId,
			errorType: event.errorType,
			failurePhase: event.failurePhase,
			// Every event here is a failure the user actually saw: transient
			// errors are retried inside the provider layer before any event
			// reaches this adapter, and recoverable in-run notices are filtered
			// out upstream. The legacy extension applies the same
			// surfaced-failures-only rule at its emission sites, so the A/B
			// cohorts compare directly with no query-side filtering.
		})
	}

	private emitClineAuthErrorWithTelemetry(task?: string, sessionId?: string): void {
		this.emitClineAuthError(task)
		this.captureProviderFailure({
			sessionId: sessionId ?? this.task?.taskId,
			error: CLINE_ACCOUNT_AUTH_ERROR_MESSAGE,
			providerId: this.getActiveProviderId(),
			errorType: PROVIDER_FAILURE_ERROR_TYPE.AUTH,
			failurePhase: PROVIDER_FAILURE_PHASE.PREFLIGHT,
		})
	}

	/**
	 * Emit a proper auth error for the 'cline' provider when the user is not
	 * logged in. The message sequence drives ErrorRow to render the
	 * "Sign in to Cline" button.
	 *
	 * Message sequence:
	 *   1. say:'task'           – the user's message text
	 *   2. say:'api_req_started' – opens the API request row
	 *   3. ask:'api_req_failed'  – ClineError JSON → ErrorRow renders auth UI
	 */
	private emitClineAuthError(task?: string): void {
		const ts = Date.now()
		this.pendingClineAuthRetryPrompt = task

		if (!this.task) {
			this.task = createTaskProxy(
				`auth-error-${ts}`,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)
		}

		const clineError = new ClineError(
			{ message: CLINE_ACCOUNT_AUTH_ERROR_MESSAGE, status: 401 },
			undefined, // modelId
			"cline",
		)
		const serializedError = clineError.serialize()

		const failedAskTs = ts + 2
		const messages: ClineMessage[] = [
			{
				ts,
				type: "say",
				say: "task",
				text: task ?? "",
				partial: false,
			},
			{
				ts: ts + 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					streamingFailedMessage: serializedError,
				} satisfies ClineApiReqInfo),
				partial: false,
			},
			{
				ts: failedAskTs,
				type: "ask",
				ask: "api_req_failed",
				text: serializedError,
				partial: false,
			},
		]

		this.turnStateTracker.set("error", failedAskTs)

		this.messages.appendAndEmit(messages, {
			type: "status",
			payload: {
				sessionId: this.sessions.getActiveSession()?.sessionId ?? "",
				status: "error",
			},
		})

		this.postStateToWebview().catch(() => {})
	}

	/**
	 * Check if an error message indicates an insufficient credits / balance error
	 * by reshaping it into ClineError format and inspecting the result.
	 */
	private isClineBalanceError(errorMessage: string): boolean {
		try {
			const shaped = JSON.parse(reshapeErrorForWebview({ message: errorMessage }))
			return shaped.code === "insufficient_credits"
		} catch {
			return false
		}
	}

	/**
	 * Emit a balance error for the 'cline' provider when the user has insufficient
	 * credits. Produces the same message sequence as emitClineAuthError so the
	 * webview renders the "Buy Credits" button via CreditLimitError.
	 *
	 * Message sequence:
	 *   1. say:'api_req_started' – streamingFailedMessage holds the ClineError JSON
	 *   2. ask:'api_req_failed'  – ClineError JSON → ErrorRow renders balance UI
	 */
	private emitClineBalanceError(rawErrorMessage: string): void {
		const ts = Date.now()

		// reshapeErrorForWebview extracts structured fields from the SDK error
		// message (which may be plain text or embedded JSON) and produces the
		// ClineError-serialized JSON that the webview's ErrorRow expects.
		const serializedError = reshapeErrorForWebview({
			message: rawErrorMessage,
		})

		const failedAskTs = ts + 1
		const messages: ClineMessage[] = [
			{
				ts,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					streamingFailedMessage: serializedError,
				} satisfies ClineApiReqInfo),
				partial: false,
			},
			{
				ts: failedAskTs,
				type: "ask",
				ask: "api_req_failed",
				text: serializedError,
				partial: false,
			},
		]

		this.turnStateTracker.set("error", failedAskTs)

		this.messages.appendAndEmit(messages, {
			type: "status",
			payload: {
				sessionId: this.sessions.getActiveSession()?.sessionId ?? "",
				status: "error",
			},
		})

		this.postStateToWebview().catch(() => {})
	}

	// ---- Task lifecycle ----

	async initTask(
		prompt?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
	): Promise<string | undefined> {
		// Fire-and-forget: ensure we have the latest remote config (enterprise
		// policies like allowedMCPServers, provider lockdown, etc.) without
		// blocking the UI.
		this.refreshRemoteConfig().catch((err) => Logger.error("[SdkController] Remote config refresh before task failed:", err))
		// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION02: clear the previous
		// turn's completion signal so this turn's phase is computed fresh.
		// The canonical "streaming" transition is asserted by
		// `SdkTaskStartCoordinator` at the lifecycle boundary (after the
		// inner `clearTask()` ran, and after `startNewSession` resolves).
		// We deliberately do NOT call `turnStateTracker.set("streaming")`
		// here — a previous design tried to defend against the inner
		// `clearTask()` clobbering the streaming set by re-asserting it
		// after `taskStart.initTask` returned, but that produced TWO
		// writers at the same logical transition (`startNewSession` would
		// assert streaming, then this controller would assert it again).
		// That violates the canonical-authority invariant: ONE writer,
		// ONE lifecycle transition, downstream observation. The
		// coordinator is the owner; the controller only injects the
		// shared tracker via the `setTurnPhase` callback in its
		// constructor options.
		this.messageTranslatorState.clearTurnOutcome()
		const sessionId = await this.taskStart.initTask(prompt, images, files, historyItem, taskSettings)
		// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: start (or re-start) the
		// host-owned task-telemetry window for the new task identity, and
		// (re-)subscribe to canonical recovery-state transitions for the
		// newly-active session.
		if (sessionId) {
			// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: stamp the new task's
			// start epoch from the canonical `HistoryItem.ts` slot written
			// by `createHistoryItemFromSession` (also the persisted
			// wall-clock that survives resume). Falls back to `Date.now()`
			// if the history item is not yet present (the very first frame
			// before the history write completes).
			const historyItem = this.stateManager.getGlobalStateKey("taskHistory")?.find((item) => item.id === sessionId)
			const persistedTs = historyItem?.ts
			this.taskTelemetry.startTask(
				sessionId,
				typeof persistedTs === "number" && Number.isFinite(persistedTs) ? persistedTs : undefined,
			)
			this.attachRecoveryTelemetrySubscription(sessionId)
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
			// also attach the canonical runtime-event seam so the shadow
			// comparator receives real `execution-state-changed` and
			// `recovery-state-changed` events. Idempotent on re-init.
			this.attachCanonicalRuntimeEventSubscription(sessionId)
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01:
			// Reset the shadow recorder for the new task identity and push
			// `task_requested(taskId)` into the shadow. The reset clears
			// the previous session's classifications / counts; the task
			// message seeds `TaskModel.identity.taskId`. Both are
			// observation-only (no legacy writes).
			if (this.taskStateShadowWiring) {
				this.taskStateShadowWiring.resetForNewTask()
				emitTaskRequested(
					{
						coordinator: this.taskStateShadowWiring.coordinator,
						now: this.taskStateShadowWiring.now,
					},
					sessionId,
				)
			}
		}
		return sessionId
	}

	/**
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: subscribe to canonical
	 * recovery-state transitions for the active session and feed them
	 * into the `TaskTelemetryTracker`. Idempotent: re-calling detaches
	 * the previous subscription before attaching a new one (covers the
	 * new-task case where `initTask` is invoked again).
	 *
	 * Observation-only: nothing on the recovery-policy path reads from
	 * the telemetry counter.
	 */
	private attachRecoveryTelemetrySubscription(sessionId: string): void {
		this.taskTelemetryRecoveryUnsub?.()
		this.taskTelemetryRecoveryUnsub = undefined
		const sdkHost = this.sessions.getActiveSession()?.sdkHost
		if (!sdkHost?.subscribeRecoveryStateChange) {
			return
		}
		this.taskTelemetryRecoveryUnsub = sdkHost.subscribeRecoveryStateChange((evtSessionId, recovery) => {
			if (evtSessionId && evtSessionId !== sessionId) {
				// Stale session — ignore.
				return
			}
			this.taskTelemetry.observeRecovery(recovery)
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01:
			// Mirror the recovery-state change into the shadow as a
			// HOST_RECOVERY observation. The canonical recovery
			// event is delivered separately via
			// `attachCanonicalRuntimeEventSubscription` through
			// `observeCanonicalRuntimeEvent` (RUNTIME_CANONICAL
			// origin). The host projection is DIAGNOSTIC_ONLY
			// under canonicalAvailable=true (Policy A) — canonical
			// recovery owns the actual shadow mutation. Going
			// through `emitHostRecovery` (the production ingress)
			// ensures HOST_RECOVERY never double-mutates the
			// shadow against canonical recovery.
			const shadow = this.taskStateShadowWiring
			if (shadow) {
				// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.3-W10:
				// Mirror the recovery-state change into the shadow
				// as a HOST_RECOVERY observation via the
				// production ingress `emitHostRecovery`. The
				// canonical recovery-state-changed event is
				// delivered separately through
				// `attachCanonicalRuntimeEventSubscription` via
				// `observeCanonicalRuntimeEvent` —
				// RUNTIME_CANONICAL origin, APPLYs under the
				// canonical path. The host projection is
				// DIAGNOSTIC_ONLY under canonicalAvailable=true
				// (Policy A) — canonical recovery owns the
				// actual shadow mutation. Going through
				// `emitHostRecovery` ensures HOST_RECOVERY
				// never double-mutates the shadow against
				// canonical recovery. R8 carry-forward closed.
				emitHostRecovery({ coordinator: shadow.coordinator, now: shadow.now }, sessionId, recovery, true, Date.now())
			}
		})
	}

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
	 * subscribe to canonical `AgentRuntimeEvent`s for the active session
	 * and deliver them read-only to the TaskState shadow comparator.
	 *
	 * Idempotent on re-init (covers the new-task case where
	 * `initTask` is invoked again): the previous unsubscribe is
	 * invoked before a new subscription is attached.
	 *
	 * Observation-only: nothing on the recovery-policy, task-control,
	 * or tool-execution path reads from this stream. The shadow
	 * comparator receives the canonical event verbatim; existing
	 * C2.1/C2.2 work decides whether and how to dedupe against the
	 * host-computed recovery projection (see
	 * `attachRecoveryTelemetrySubscription`).
	 */
	private attachCanonicalRuntimeEventSubscription(sessionId: string): void {
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03:
		// delegate the full subscribe cycle (dispose previous, attach
		// new) to the production-grade owner. The controller does
		// NOT manage an unsubscribe callback directly. The owner is
		// the single source of truth for the canonical subscription
		// state, exercised by both the controller and the lifecycle
		// qualification test.
		const sdkHost = this.sessions.getActiveSession()?.sdkHost
		this.taskStateRuntimeEventsSubscription.attach(sdkHost, this.taskStateShadowWiring, sessionId)
	}

	async reinitExistingTaskFromId(taskId: string): Promise<void> {
		// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION02: the canonical
		// "streaming" transition for the resume path is asserted by
		// `SdkTaskStartCoordinator.reinitExistingTaskFromId` AFTER the
		// inner `clearTask()` ran and AFTER `startNewSession` resolves.
		// We deliberately do NOT call `turnStateTracker.set("streaming")`
		// here — that would produce two writers at the same logical
		// transition (this controller + the coordinator). The coordinator
		// is the sole writer; the controller only injects the shared
		// tracker via the `setTurnPhase` callback in its constructor
		// options.
		this.messageTranslatorState.clearTurnOutcome()
		await this.taskStart.reinitExistingTaskFromId(taskId)
	}

	async cancelTask(): Promise<void> {
		// Fence first: mark resumable before aborting so any straggler events from the aborted
		// turn land on the wrong side of the UI mode. (Full fence-before-abort epoch bump lands
		// in S6; this sets the authoritative phase now.)
		this.turnStateTracker.set("resumable")
		// ACT-CLINEMM-SESSION-AUTONOMY01 + CORRECTION02: cancellation of the
		// currently-running task destroys only the bound override. A pre-armed
		// intent for the next task SURVIVES this cancellation — the user may have
		// explicitly armed a follow-up task before cancelling the current one.
		// Cancellation of the current task means "stop this one", not "abort my
		// plans for the next one".
		this.sessionAutoApproval.clearActiveOverride()
		// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: freeze the elapsed clock at
		// the moment of cancellation so the header shows the task duration
		// at interruption, not a perpetually-ticking value.
		this.taskTelemetry.endTask()
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01:
		// Emit `task_cancelled` into the shadow so the host-initiated
		// cancellation path is observed. The shadow's reducer transitions
		// the lifecycle to `cancelled`, which projects to `resumable`
		// (matching the legacy `turnStateTracker.set("resumable")` above).
		if (this.taskStateShadowWiring) {
			emitTaskCancelled(
				{ coordinator: this.taskStateShadowWiring.coordinator, now: this.taskStateShadowWiring.now },
				this.turnStateTracker.currentPhase,
			)
		}
		await this.taskControl.cancelTask()
	}

	async cancelBackgroundCommand(): Promise<void> {
		stubWarn("cancelBackgroundCommand")
	}

	/**
	 * "Proceed While Running": detach every in-flight foreground terminal
	 * command. Each pending run_commands call returns its partial output plus
	 * the log file path the remaining output is redirected to, and the agent
	 * turn continues while the commands keep running in their terminals.
	 */
	async proceedWhileRunningCommand(): Promise<void> {
		const detached = this.foregroundCommands.proceedWhileRunning()
		if (detached === 0) {
			Logger.warn("[SdkController] proceedWhileRunningCommand: No foreground command is running")
		}
	}

	async cancelQueuedPrompt(promptId: string): Promise<void> {
		const trimmedPromptId = promptId.trim()
		if (!trimmedPromptId) {
			Logger.warn("[SdkController] cancelQueuedPrompt: Missing prompt id")
			return
		}

		const activeSession = this.sessions.getActiveSession()
		if (!activeSession) {
			Logger.warn("[SdkController] cancelQueuedPrompt: No active session")
			return
		}

		const result = await activeSession.sdkHost.pendingPrompts("delete", {
			sessionId: activeSession.sessionId,
			promptId: trimmedPromptId,
		})
		if (!result.removed) {
			Logger.warn(`[SdkController] cancelQueuedPrompt: Prompt not found: ${trimmedPromptId}`)
		}
		await this.postStateToWebview()
	}

	/**
	 * Manually compact (condense) the active task's conversation. Triggered by
	 * the compact button and the `/compact` (alias `/smol`) slash command.
	 * Mirrors the CLI's `/compact` local command: runs an SDK manual compaction
	 * and persists the compaction sidecar so the model's working context is
	 * reduced on the next turn and later resumes.
	 */
	async compactTask(): Promise<void> {
		await this.compaction.compactTask()
	}

	async clearTask(): Promise<void> {
		this.pendingClineAuthRetryPrompt = undefined
		// No active task — UI returns to idle (input enabled, no buttons/thinking).
		this.turnStateTracker.set("idle")
		// ACT-CLINEMM-SESSION-AUTONOMY01 + CORRECTION02: clearTask is the
		// universal choke-point that covers (a) the user clicking "New Task",
		// (b) initTask calling clearTask() before starting a new session,
		// (c) any controller-driven reset. It destroys ONLY the bound override;
		// a pre-armed intent for the next task SURVIVES clearTask (it is
		// consumed later by consumePendingOverride at the new session-id
		// allocation site). This is the property the user expects when they
		// arm a follow-up task before clearing the current one.
		this.sessionAutoApproval.clearActiveOverride()
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01:
		// Emit `task_reset` into the shadow so the host-initiated reset
		// path is observed. The shadow's reducer transitions the lifecycle
		// back to `idle`. Observation-only.
		if (this.taskStateShadowWiring) {
			emitTaskReset(
				{ coordinator: this.taskStateShadowWiring.coordinator, now: this.taskStateShadowWiring.now },
				this.turnStateTracker.currentPhase,
			)
		}
		await this.taskControl.clearTask()
		await this.postStateToWebview()
	}

	/**
	 * ACT-CLINEMM-SESSION-AUTONOMY01: Activate or deactivate the
	 * session-scoped auto-approval override for the current task.
	 *
	 * The override is bound to the active SDK session id. Activating it
	 * ("all") projects ordinary AutoApprove categories enabled AND routes
	 * commands through the canonical policy lattice in `"all"` host mode.
	 * Hard DENY / execution_plan_invalid still DENY (the override does
	 * not bypass the policy).
	 *
	 * The override is EPHEMERAL — it never touches global settings and is
	 * destroyed by clearTask/cancelTask. Activating without an active
	 * session is a no-op (the toggle will be inert until a task starts).
	 */
	async setSessionAutoApprovalOverride(override: SessionAutoApprovalOverride): Promise<void> {
		const sessionId = this.sessions.getActiveSession()?.sessionId
		this.sessionAutoApproval.setOverride(sessionId, override)
		await this.postStateToWebview()
	}

	async handleTaskCreation(prompt: string): Promise<void> {
		await this.initTask(prompt)
	}

	/**
	 * Send a follow-up message to the active session.
	 * This is the "askResponse" equivalent — continues the conversation.
	 *
	 * Like initTask(), this is fire-and-forget: core.send() blocks until
	 * the agent turn completes, but events stream in real-time via the
	 * subscription. We do NOT await the send — the gRPC handler needs to
	 * return immediately so the webview stays responsive.
	 */
	async askResponse(prompt?: string, images?: string[], files?: string[]): Promise<void> {
		if (this.pendingClineAuthRetryPrompt !== undefined && this.task?.taskState?.askResponse === "yesButtonClicked") {
			const retryPrompt = this.pendingClineAuthRetryPrompt
			this.pendingClineAuthRetryPrompt = undefined
			await this.initTask(retryPrompt, images, files)
			return
		}

		const turnStateBefore = this.turnStateTracker.get()

		// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01:
		// Emit `same_task_continued` into the shadow when the previous turn
		// was already terminal (the user is continuing the SAME visible task
		// after a completed / awaiting_followup / resumable / error phase).
		// This is the only accepted exit from `resumable` in the shadow's
		// lifecycle. Observation-only.
		if (
			this.taskStateShadowWiring &&
			(turnStateBefore.phase === "completed" ||
				turnStateBefore.phase === "error" ||
				turnStateBefore.phase === "resumable" ||
				turnStateBefore.phase === "awaiting_followup")
		) {
			emitSameTaskContinued(
				{ coordinator: this.taskStateShadowWiring.coordinator, now: this.taskStateShadowWiring.now },
				turnStateBefore.phase,
			)
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.2-CORRECTION04 R2:
			// Fence the canonical run-epoch terminal gate so that
			// any canonical run-finished/run-failed arriving for the
			// retired run identity (run-A) BEFORE the next accepted
			// canonical run-started (run-B) is SUPPRESSED. Until
			// run-B announces itself, the resumed task's lifecycle
			// stays "running" and cannot be poisoned by a late
			// terminal from run-A.
			this.taskStateShadowWiring.fenceCanonicalRunForContinuation()
		}
		// Answering an ask / continuing after completion / resuming a cancelled task all kick off a
		// new agent turn — move the authoritative phase to "streaming" so the footer shows
		// Thinking + Cancel (and not the stale resumable/completed/awaiting_followup buttons or the
		// scroll-arrow default). Mirrors initTask(). The webview gates turnState by seq, and the
		// session-event coordinator will set the terminal phase (completed/awaiting_followup/error)
		// when this turn ends.
		this.turnStateTracker.set("streaming")
		// Clear the previous turn's completion signal so this new turn's phase is computed fresh.
		this.messageTranslatorState.clearTurnOutcome()
		// The webview only learns the phase through a full state post. Without one here it would
		// keep the stale terminal phase (and hide the thinking indicator) until the first session
		// event of the new turn posts state — a visible delay after every follow-up/approval.
		this.postStateToWebview().catch((error) => {
			Logger.error("[SdkController] Failed to post state after askResponse phase change:", error)
		})
		await this.followups.askResponse(prompt, images, files, this.task?.taskState?.askResponse, turnStateBefore.phase)
	}

	async editMessageAndRegenerate(input: {
		messageTs: number
		text: string
		images?: string[]
		files?: string[]
		restoreWorkspace?: boolean
	}): Promise<void> {
		const editedText = input.text.trim()
		if (!editedText && (input.images?.length ?? 0) === 0 && (input.files?.length ?? 0) === 0) {
			throw new Error("Edited message cannot be empty")
		}

		const activeSession = this.sessions.getActiveSession()
		const currentTask = this.task
		if (!currentTask) {
			throw new Error("No active task to edit")
		}

		const clineMessages = currentTask.messageStateHandler.getClineMessages()
		const targetIndex = clineMessages.findIndex((message) => message.ts === input.messageTs)
		if (targetIndex === -1) {
			throw new Error("Message to edit was not found")
		}
		const targetMessage = clineMessages[targetIndex]
		if (targetMessage.type !== "say" || (targetMessage.say !== "task" && targetMessage.say !== "user_feedback")) {
			throw new Error("Only user messages can be edited")
		}

		const userOrdinal = clineMessages
			.slice(0, targetIndex + 1)
			.filter((message) => message.type === "say" && (message.say === "task" || message.say === "user_feedback")).length
		const canRestoreWorkspace = getCheckpointRunCountForMessage(clineMessages, targetIndex) !== undefined
		const sourceSessionId = activeSession?.sessionId ?? currentTask.taskId
		let sdkMessages: SdkUserMessage[]
		let tempHost: VscodeSessionHost | undefined
		let sessionHost = activeSession?.sdkHost
		if (!sessionHost) {
			tempHost = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
			sessionHost = tempHost
		}
		try {
			sdkMessages = (await sessionHost.readMessages(sourceSessionId)) as SdkUserMessage[]
			const sdkTargetIndex = findSdkUserMessageIndexByOrdinal(sdkMessages, userOrdinal)
			if (sdkTargetIndex === -1) {
				throw new Error("Could not map edited message to persisted conversation history")
			}
			const checkpointRunCount = getSdkCheckpointRunCountForMessageIndex(sdkMessages, sdkTargetIndex)

			const initialMessages = sdkMessages.slice(0, sdkTargetIndex) as Parameters<
				VscodeSessionHost["start"]
			>[0]["initialMessages"]
			const firstUserMessage = sdkMessages.find(
				(message) => message.role === "user" && !!extractSdkUserText(message) && !isSyntheticSdkUserMessage(message),
			)
			const historyTitle =
				userOrdinal === 1
					? editedText
					: extractSdkUserText(firstUserMessage ?? {}) || clineMessages[0]?.text || editedText
			const fallbackCwd = await this.getWorkspaceRoot()
			const [sessionRecord, historyItem] = await Promise.all([
				sessionHost.get(sourceSessionId).catch(() => undefined),
				this.taskHistory.findHistoryItem(currentTask.taskId).catch(() => undefined),
			])
			const cwd =
				sessionRecord?.cwd?.trim() ||
				sessionRecord?.workspaceRoot?.trim() ||
				historyItem?.cwdOnTaskInitialization?.trim() ||
				fallbackCwd
			const mode = this.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
			const config = await this.sessionConfigBuilder.build({ cwd, mode, prompt: historyTitle })
			if (usesClineAccountAuth(config.providerId) && !config.apiKey) {
				this.emitClineAuthErrorWithTelemetry(editedText)
				return
			}

			const resolvedPrompt = await this.resolveContextMentions(editedText)
			const startInput = {
				...buildStartSessionInput(config, { prompt: historyTitle, cwd, mode }),
				initialMessages,
				sessionMetadata: {
					title: historyTitle,
					modelId: config.modelId,
					...(checkpointRunCount
						? { checkpoint: createRestoredCheckpointMetadata(sessionRecord, checkpointRunCount) }
						: {}),
				},
			}

			if (input.restoreWorkspace) {
				if (activeSession?.isRunning) {
					throw new Error("Wait for the current run to finish before restoring workspace changes")
				}
				if (!canRestoreWorkspace || checkpointRunCount === undefined) {
					throw new Error("Workspace restore is only available for messages that started an agent run")
				}
				await sessionHost.restore({
					sessionId: sourceSessionId,
					checkpointRunCount,
					cwd,
					restore: {
						messages: false,
						workspace: true,
						omitCheckpointMessageFromSession: true,
					},
				})
			}

			// The edit supersedes the old session — settle any pending tool
			// approval / ask_question exactly like cancelTask does. Without this,
			// the old run stays suspended forever on a promise nothing can
			// resolve, and the stale parked resolver intercepts later responses.
			this.interactions.clearPending("Superseded by an edited message")

			const { startResult, sdkHost } = await this.sessions.startNewSession(startInput)

			this.turnStateTracker.set("streaming")
			this.messageTranslatorState.clearTurnOutcome()
			this.resetMessageTranslatorAndFence()

			const task = createTaskProxy(
				startResult.sessionId,
				(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
				() => this.cancelTask(),
			)
			this.task = task

			const newHistoryItem = createHistoryItemFromSession(startResult.sessionId, historyTitle, config.modelId, cwd)
			await this.taskHistory.updateTaskHistoryItem(newHistoryItem)

			const visibleMessages = clineMessages.slice(0, targetIndex)
			if (visibleMessages.length > 0) {
				task.messageStateHandler.addMessages(visibleMessages)
			}
			task.messageStateHandler.addMessages([
				{
					ts: Date.now(),
					type: "say",
					say: userOrdinal === 1 ? "task" : "user_feedback",
					text: editedText,
					images: input.images,
					files: input.files,
					partial: false,
				},
			])
			await this.postStateToWebview()

			this.sessions.fireAndForgetSend(sdkHost, startResult.sessionId, resolvedPrompt, input.images, input.files)
		} finally {
			await tempHost?.dispose("editMessageAndRegenerate")
		}
	}

	async restoreCheckpoint(input: { checkpointRunCount: number; restoreType: ClineCheckpointRestore }): Promise<void> {
		const restoreMessages = input.restoreType === "task" || input.restoreType === "taskAndWorkspace"
		const restoreWorkspace = input.restoreType === "workspace" || input.restoreType === "taskAndWorkspace"
		const checkpointRunCount = Number(input.checkpointRunCount)
		if (!Number.isInteger(checkpointRunCount) || checkpointRunCount < 1) {
			throw new Error("checkpointRunCount must be a positive integer")
		}

		const activeSession = this.sessions.getActiveSession()
		const currentTask = this.task
		if (!activeSession || !currentTask) {
			throw new Error("No active task to restore")
		}
		if (activeSession.isRunning) {
			await this.cancelTask()
		}

		const currentMessages = currentTask.messageStateHandler.getClineMessages()
		const target = restoreMessages ? findVisibleCheckpointUserMessageByRun(currentMessages, checkpointRunCount) : undefined
		if (restoreMessages && !target) {
			throw new Error(`Could not find user message for checkpoint run ${checkpointRunCount}`)
		}

		const cwd = await this.getWorkspaceRoot()
		const mode = this.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
		const firstUserMessage = currentMessages.find(isVisibleCheckpointUserMessage)
		const restoredText = target?.message.text ?? ""
		const historyTitle = checkpointRunCount === 1 ? restoredText : firstUserMessage?.text || restoredText
		const config = restoreMessages ? await this.sessionConfigBuilder.build({ cwd, mode, prompt: historyTitle }) : undefined
		if (config && usesClineAccountAuth(config.providerId) && !config.apiKey) {
			this.emitClineAuthErrorWithTelemetry(restoredText)
			return
		}

		const startInput = config
			? {
					...buildStartSessionInput(config, { prompt: historyTitle, cwd, mode }),
					sessionMetadata: {
						title: historyTitle,
						modelId: config.modelId,
					},
				}
			: undefined

		const restored = await this.sessions.restoreActiveSession({
			sessionId: activeSession.sessionId,
			checkpointRunCount,
			cwd,
			restore: {
				messages: restoreMessages,
				workspace: restoreWorkspace,
				omitCheckpointMessageFromSession: true,
			},
			...(startInput ? { start: startInput } : {}),
		})

		if (!restoreMessages) {
			await this.postStateToWebview()
			return
		}

		if (!restored.sessionId || !restored.startResult || !target) {
			throw new Error("Checkpoint restore did not return a new session")
		}

		this.turnStateTracker.set("idle")
		this.messageTranslatorState.clearTurnOutcome()
		this.resetMessageTranslatorAndFence()

		const task = createTaskProxy(
			restored.sessionId,
			(text?: string, images?: string[], files?: string[]) => this.askResponse(text, images, files),
			() => this.cancelTask(),
		)
		this.task = task

		const newHistoryItem = createHistoryItemFromSession(restored.sessionId, historyTitle, config?.modelId ?? "", cwd)
		await this.taskHistory.updateTaskHistoryItem(newHistoryItem)

		const visibleMessages = currentMessages.slice(0, target.index)
		if (visibleMessages.length > 0) {
			this.messages.replaceMessages(visibleMessages)
		}

		this.checkpointRestoreInput = {
			text: restoredText,
			images: target.message.images ?? [],
			files: target.message.files ?? [],
			sessionId: restored.sessionId,
		}
		await this.postStateToWebview()
	}

	/**
	 * Diffs the latest checkpoint — snapshotted when the user's last message
	 * started a run — against the current working tree. Returns undefined when
	 * no checkpoint exists (e.g. the workspace is not a git repository).
	 * Throws when there is no task at all.
	 */
	private async computeLatestCheckpointChanges(): Promise<CompareCheckpointResult["diffs"] | undefined> {
		const activeSession = this.sessions.getActiveSession()
		const sessionId = activeSession?.sessionId ?? this.task?.taskId
		if (!sessionId) {
			throw new Error("No active task to show changes for")
		}
		// After a window reload the latest task is shown from history without a
		// live session, so fall back to a temporary host for the comparison.
		let tempHost: VscodeSessionHost | undefined
		let sessionHost = activeSession?.sdkHost
		if (!sessionHost) {
			tempHost = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
			sessionHost = tempHost
		}
		try {
			if (!sessionHost.compareCheckpoint) {
				throw new Error("This session host does not support checkpoint comparison")
			}

			const sessionRecord = await sessionHost.get(sessionId)
			const latestCheckpoint = readSessionCheckpointHistory(sessionRecord).reduce(
				(latest, entry) => (!latest || entry.runCount > latest.runCount ? entry : latest),
				undefined as ReturnType<typeof readSessionCheckpointHistory>[number] | undefined,
			)
			if (!latestCheckpoint) {
				return undefined
			}

			const cwd = sessionRecord?.cwd?.trim() || sessionRecord?.workspaceRoot?.trim() || (await this.getWorkspaceRoot())
			const { diffs } = await sessionHost.compareCheckpoint({
				sessionId,
				checkpointRunCount: latestCheckpoint.runCount,
				cwd,
			})
			return diffs
		} finally {
			await tempHost?.dispose("viewLatestCheckpointChanges")
		}
	}

	/**
	 * Gates the "View Changes" button on the completion row: the number of
	 * files changed since the latest checkpoint, or 0 when nothing can be
	 * compared (no task, no checkpoint, comparison failure).
	 */
	async getLatestCheckpointChangesCount(): Promise<number> {
		try {
			return (await this.computeLatestCheckpointChanges())?.length ?? 0
		} catch (error) {
			Logger.debug(`[SdkController] Failed to count latest checkpoint changes: ${error}`)
			return 0
		}
	}

	/**
	 * "View Changes" on the completion row: opens a multi-file diff of
	 * everything that changed between the latest checkpoint — snapshotted when
	 * the user's last message started this run — and the current working tree.
	 */
	async viewLatestCheckpointChanges(): Promise<void> {
		const diffs = await this.computeLatestCheckpointChanges()
		if (diffs === undefined) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "No checkpoint was taken for this task. Checkpoints require the workspace to be a git repository.",
			})
			return
		}
		if (diffs.length === 0) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "No file changes found since your last message.",
			})
			return
		}

		await HostProvider.diff.openMultiFileDiff({
			title: "Changes since your last message",
			diffs: diffs.map((diff) => ({
				filePath: diff.filePath,
				leftContent: diff.leftContent,
				rightContent: diff.rightContent,
			})),
		})
	}

	/**
	 * Show a task from history by loading its messages.
	 * This does NOT start inference — it just loads the task for viewing.
	 *
	 * IMPORTANT: We do NOT call clearTask() here because clearTask() sets
	 * this.task = undefined and may trigger async operations (session stop/dispose)
	 * that race with the new task proxy creation. If any of those async operations
	 * trigger postStateToWebview() while this.task is undefined, the webview
	 * receives a state with no currentTaskItem/clineMessages and flashes back
	 * to the welcome screen (S6-6/S6-23 fix).
	 *
	 * Instead, we:
	 * 1. Silently tear down the active session (unsubscribe + stop in background)
	 * 2. Create the new task proxy with loaded messages BEFORE any state push
	 * 3. Only then push state to the webview
	 *
	 * Delegates straight to the coordinator (including the history lookup) so
	 * the "latest selection wins" generation is allocated synchronously at the
	 * moment of the request — awaiting the lookup here first would let a
	 * stalled older request grab a NEWER generation than a later selection and
	 * replace it.
	 */
	async showTaskWithId(taskId: string): Promise<TaskResponse> {
		const historyItem = await this.taskControl.showTaskWithId(taskId)
		if (!historyItem) {
			throw new Error(`Task not found in history: ${taskId}`)
		}
		return historyItemToTaskResponse(historyItem)
	}

	// ---- Mode switching ----

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		return this.mode.togglePlanActMode(modeToSwitchTo, chatContent)
	}

	// ---- Telemetry ----

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		setTelemetryOptOutGlobally(telemetrySetting === "disabled", { telemetry: this.sdkTelemetry.telemetry })
		// Mirror to StateManager for existing VS Code services during the transition.
		this.stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		await this.postStateToWebview()
	}

	// ---- Auth callbacks ----

	async handleSignOut(): Promise<void> {
		const sessionProviderId = this.getSessionProviderId() ?? this.getActiveProviderId()
		await this.taskControl.cancelClineTaskOnSignOut(isClineManagedProvider(sessionProviderId))
		await this.authService.handleDeauth(LogoutReason.USER_INITIATED)
		clearRemoteConfig()
		await this.setRemoteConfigCoreIntegration(undefined)
		await this.postStateToWebview()
	}

	async handleOcaSignOut(): Promise<void> {
		await this.ocaAuthService.handleDeauth(LogoutReason.USER_INITIATED)
		await this.postStateToWebview()
	}

	async handleAuthCallback(customToken: string, provider: string | null = null): Promise<void> {
		await this.authService.handleAuthCallback(customToken, provider ?? "cline")
		// Fetch remote config immediately after login so enterprise policies
		// (provider lockdown, MCP servers, OTel, etc.) are applied right away.
		await this.refreshRemoteConfig()
		await this.postStateToWebview()
	}

	async handleOcaAuthCallback(code: string, state: string): Promise<void> {
		await this.ocaAuthService.handleAuthCallback(code, state)
		await this.postStateToWebview()
	}

	// ---- Provider auth callbacks ----

	private persistProviderApiKeyFromState(provider: string): void {
		const providerId = parseProviderId(provider)
		const apiKey = this.providerConfigStore.read(providerId).apiKey

		if (!apiKey) {
			Logger.warn(`[SdkController] No API key found after ${provider} auth callback`)
			return
		}

		this.providerConfigStore.write(providerId, { apiKey })
	}

	async handleOpenRouterCallback(code: string): Promise<void> {
		await this.authService.handleOpenRouterCallback(code)
		this.persistProviderApiKeyFromState("openrouter")
		await this.postStateToWebview()
	}

	async handleRequestyCallback(code: string): Promise<void> {
		await this.authService.handleRequestyCallback(code)
		this.persistProviderApiKeyFromState("requesty")
		await this.postStateToWebview()
	}

	async handleHicapCallback(code: string): Promise<void> {
		await this.authService.handleHicapCallback(code)
		this.persistProviderApiKeyFromState("hicap")
		await this.postStateToWebview()
	}

	async getTaskHistory(request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
		const { favoritesOnly, currentWorkspaceOnly, searchQuery, sortBy } = request
		const limit = request.limit > 0 ? Math.min(request.limit, 100) : 50
		const offset = request.offset > 0 ? request.offset : 0
		const workspacePath = currentWorkspaceOnly ? await this.getWorkspaceRoot() : undefined
		const sessionHistory = await this.taskHistory.listHistory({
			hydrate: false,
			limit: limit + 1,
			offset,
		})

		let filteredTasks = sessionHistory.filter((item) => {
			const ts = dateStringToTimestamp(item.updatedAt ?? item.endedAt ?? item.startedAt)
			const task = metadataString(item.metadata, "title") ?? item.prompt ?? ""

			if (!ts || !task) {
				return false
			}

			const isFavorited =
				metadataBoolean(item.metadata, "isFavorited") ?? metadataBoolean(item.metadata, "is_favorited") ?? false
			if (favoritesOnly && !isFavorited) {
				return false
			}

			if (currentWorkspaceOnly && workspacePath) {
				const sessionWorkspacePath = item.cwd ?? item.workspaceRoot
				if (!sessionWorkspacePath || !arePathsEqual(sessionWorkspacePath, workspacePath)) {
					return false
				}
			}

			return true
		})

		if (searchQuery) {
			const query = searchQuery.toLowerCase()
			filteredTasks = filteredTasks.filter((item) => {
				const task = metadataString(item.metadata, "title") ?? item.prompt ?? ""
				return task.toLowerCase().includes(query)
			})
		}

		filteredTasks.sort((a, b) => {
			switch (sortBy) {
				case "oldest":
					return (
						dateStringToTimestamp(a.updatedAt ?? a.endedAt ?? a.startedAt) -
						dateStringToTimestamp(b.updatedAt ?? b.endedAt ?? b.startedAt)
					)
				case "mostExpensive":
					return (metadataNumber(b.metadata, "totalCost") ?? 0) - (metadataNumber(a.metadata, "totalCost") ?? 0)
				case "mostTokens":
					return (
						(metadataNumber(b.metadata, "tokensIn") ?? 0) +
						(metadataNumber(b.metadata, "tokensOut") ?? 0) +
						(metadataNumber(b.metadata, "cacheWrites") ?? 0) +
						(metadataNumber(b.metadata, "cacheReads") ?? 0) -
						((metadataNumber(a.metadata, "tokensIn") ?? 0) +
							(metadataNumber(a.metadata, "tokensOut") ?? 0) +
							(metadataNumber(a.metadata, "cacheWrites") ?? 0) +
							(metadataNumber(a.metadata, "cacheReads") ?? 0))
					)
				default:
					return (
						dateStringToTimestamp(b.updatedAt ?? b.endedAt ?? b.startedAt) -
						dateStringToTimestamp(a.updatedAt ?? a.endedAt ?? a.startedAt)
					)
			}
		})

		const hasMore = sessionHistory.length > limit
		const tasks = filteredTasks.slice(0, limit).map((item) => {
			const metadata = item.metadata
			return {
				id: item.sessionId,
				task: formatDisplayUserInput(metadataString(metadata, "title") ?? item.prompt ?? ""),
				ts: dateStringToTimestamp(item.updatedAt ?? item.endedAt ?? item.startedAt),
				isFavorited: metadataBoolean(metadata, "isFavorited") ?? metadataBoolean(metadata, "is_favorited") ?? false,
				size: metadataNumber(metadata, "size") ?? 0,
				totalCost: metadataNumber(metadata, "totalCost") ?? 0,
				tokensIn: metadataNumber(metadata, "tokensIn") ?? 0,
				tokensOut: metadataNumber(metadata, "tokensOut") ?? 0,
				cacheWrites: metadataNumber(metadata, "cacheWrites") ?? 0,
				cacheReads: metadataNumber(metadata, "cacheReads") ?? 0,
				modelId: item.model || metadataString(metadata, "modelId") || "",
				isLegacy:
					metadataBoolean(metadata, "legacyTask") === true ||
					metadataBoolean(metadata, "migratedFromLegacyTask") === true,
			}
		})

		if (offset === 0 && !favoritesOnly && this.task?.taskId && !tasks.some((task) => task.id === this.task?.taskId)) {
			const taskMessage = this.task.messageStateHandler
				.getClineMessages()
				.find((message) => message.type === "say" && message.say === "task" && message.text)
			const matchesSearch = !searchQuery || taskMessage?.text?.toLowerCase().includes(searchQuery.toLowerCase())
			if (taskMessage?.text && matchesSearch) {
				tasks.unshift({
					id: this.task.taskId,
					task: formatDisplayUserInput(taskMessage.text),
					ts: taskMessage.ts || Date.now(),
					isFavorited: false,
					size: 0,
					totalCost: 0,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					modelId: this.task.api?.getModel?.().id ?? "",
					isLegacy: false,
				})
			}
		}

		return TaskHistoryArray.create({ tasks: tasks.slice(0, limit), hasMore })
	}

	async exportTaskWithId(id: string): Promise<void> {
		const taskDirPath = await this.taskHistory.getTaskDirPath(id)
		if (!taskDirPath) {
			throw new Error(`Task not found in history: ${id}`)
		}

		await fs.access(taskDirPath)
		Logger.log(`[EXPORT] Opening task directory: ${taskDirPath}`)
		const open = (await import("open")).default
		await open(taskDirPath)
	}

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		return this.taskHistory.deleteTaskFromState(id)
	}

	async deleteAllTaskHistory(): Promise<DeleteAllTaskHistoryCount> {
		await this.clearTask()

		const taskHistory = await this.taskHistory.listHistory({ hydrate: false })
		const totalTasks = taskHistory.length

		const userChoice = (
			await HostProvider.window.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.WARNING,
					message: "What would you like to delete?",
					options: {
						modal: true,
						items: ["Delete All Except Favorites", "Delete Everything"],
					},
				}),
			)
		).selectedOption

		if (userChoice === undefined) {
			return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
		}

		if (userChoice === "Delete All Except Favorites") {
			const hasFavoritedTasks = taskHistory.some(
				(task) =>
					metadataBoolean(task.metadata, "isFavorited") ?? metadataBoolean(task.metadata, "is_favorited") ?? false,
			)

			if (hasFavoritedTasks) {
				const tasksDeleted = await this.taskHistory.deleteAllTaskHistory({
					preserveFavorites: true,
				})
				await this.postStateToWebview()
				return DeleteAllTaskHistoryCount.create({ tasksDeleted })
			}

			const answer = (
				await HostProvider.window.showMessage({
					type: ShowMessageType.WARNING,
					message: "No favorited tasks found. Would you like to delete all tasks anyway?",
					options: {
						modal: true,
						items: ["Delete All Tasks"],
					},
				})
			).selectedOption

			if (answer === undefined) {
				return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
			}
		}

		const tasksDeleted = await this.taskHistory.deleteAllTaskHistory()
		await this.postStateToWebview()
		return DeleteAllTaskHistoryCount.create({
			tasksDeleted: tasksDeleted || totalTasks,
		})
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		return this.taskHistory.updateTaskHistory(item)
	}

	async toggleTaskFavorite(taskId: string, isFavorited: boolean): Promise<void> {
		const historyItem = await this.taskHistory.findHistoryItem(taskId)
		if (!historyItem) {
			Logger.log(`[toggleTaskFavorite] Task not found in history: ${taskId}`)
			return
		}

		await this.taskHistory.updateTaskHistory({
			...historyItem,
			isFavorited,
		})
		await this.postStateToWebview()
	}

	// ---- Background command state ----

	updateBackgroundCommandState(running: boolean, taskId?: string): void {
		this.backgroundCommandRunning = running
		this.backgroundCommandTaskId = taskId
	}

	// ---- State management ----

	/**
	 * Request a webview state update.
	 *
	 * Callers fire this very frequently (notably the session event coordinator,
	 * once per streamed message/turn boundary), and each rebuild walks the full
	 * task history. StatePostDebouncer coalesces bursts into a single trailing
	 * rebuild to avoid hammering the extension host. The returned promise
	 * resolves once a snapshot reflecting this request has been shipped, or
	 * rejects if that rebuild failed.
	 */
	postStateToWebview(): Promise<void> {
		if (this.isDisposed) {
			return Promise.resolve()
		}
		return this.statePostDebouncer.post()
	}

	/** Build the current ExtensionState and push it to the webview immediately. */
	private async flushStateToWebview(): Promise<void> {
		// Import dynamically to avoid circular deps
		const { sendStateUpdate } = await import("@core/controller/state/subscribeToState")
		const state = await this.getStateToPostToWebview()
		await sendStateUpdate(state)
	}

	/**
	 * Reset the message translator's streaming state AND bump the conversation/replica fence
	 * (epoch). Called at every conversation boundary (task start/clear, history open, reinit,
	 * mode rebuild, new-session follow-up). Bumping the epoch BEFORE the new state is pushed
	 * means any straggler message/state from the previous task or render carries an older epoch
	 * and is dropped by the webview. Order matters: bump synchronously here, before any await.
	 */
	resetMessageTranslatorAndFence(): void {
		this.messageTranslatorState.reset()
		this.messageTranslatorState.getMinter().bumpEpoch()
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// Build the base ExtensionState from StateManager, then layer the SDK's
		// task history on top.
		try {
			syncTelemetrySettingFromSharedGlobalSettings(this.stateManager)
			const { getStateToPostToWebview: buildBaseState } = await import("@core/controller/state/getStateToPostToWebview")
			const state = await buildBaseState({
				task: this.task,
				stateManager: this.stateManager,
				mcpHub: this.mcpHub,
				backgroundCommandRunning: this.backgroundCommandRunning,
				backgroundCommandTaskId: this.backgroundCommandTaskId,
				foregroundCommandRunning: this.foregroundCommands.isRunning,
				// Without this the webview always receives workspaceRoots: [] on the
				// SDK path (classic Controller exposes a public workspaceManager;
				// SdkController builds one lazily). The task-header working-directory
				// badge and anything else keyed on workspaceRoots depend on it.
				workspaceManager: await this.ensureWorkspaceManager(),
			})
			const sdkTaskHistory = (await this.taskHistory.listHistory({ limit: 100, hydrate: false }))
				.map(sessionHistoryRecordToHistoryItem)
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
			const legacyTaskHistory = state.taskHistory ?? []
			const mergedTaskHistoryById = new Map<string, HistoryItem>()

			// Keep the SDK records authoritative for migrated/new tasks, but append
			// legacy persisted history so pre-migration tasks still appear in the UI.
			for (const item of legacyTaskHistory) {
				mergedTaskHistoryById.set(item.id, item)
			}
			for (const item of sdkTaskHistory) {
				mergedTaskHistoryById.set(item.id, item)
			}

			// A just-started task may not be visible in SDK persisted history yet (the
			// history adapter can lag behind the active in-memory TaskProxy). Classic
			// state included the current task immediately, and the testing platform
			// asserts that taskHistory reflects newTask before the model turn completes.
			if (this.task?.taskId && !mergedTaskHistoryById.has(this.task.taskId)) {
				const taskMessage = this.task.messageStateHandler
					.getClineMessages()
					.find((message) => message.type === "say" && message.say === "task" && message.text)
				if (taskMessage?.text) {
					mergedTaskHistoryById.set(this.task.taskId, {
						id: this.task.taskId,
						ts: taskMessage.ts || Date.now(),
						task: taskMessage.text,
						tokensIn: 0,
						tokensOut: 0,
						cacheWrites: 0,
						cacheReads: 0,
						totalCost: 0,
						modelId: this.task.api?.getModel?.().id,
						cwdOnTaskInitialization: await this.getWorkspaceRoot(),
					})
				}
			}

			const processedTaskHistory = Array.from(mergedTaskHistoryById.values())
				.filter((item) => item.ts && item.task)
				.sort((a, b) => b.ts - a.ts)
				.slice(0, 100)

			let queuedPrompts: ExtensionState["queuedPrompts"] = []
			const activeSession = this.sessions.getActiveSession()
			if (activeSession) {
				try {
					queuedPrompts = await activeSession.sdkHost.pendingPrompts("list", { sessionId: activeSession.sessionId })
				} catch (error) {
					Logger.error("[SdkController] Failed to list pending prompts for webview state:", error)
				}
			}

			// Stamp the snapshot with the current epoch and a fresh monotonic version, sampled
			// from the SAME counter that stamps messages. This lets the webview ignore stale
			// out-of-order state pushes and fence traffic from a previous task/render. Sampled
			// synchronously here (no await between sampling and return).
			const minter = this.messageTranslatorState.getMinter()
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1:
			// Capture the just-built snapshot for the post-terminal authority diagnostic.
			// The capture is OPT-IN: when isPostTerminalAuthorityDiagnosticEnabled("extension")
			// is false (the default in production), the if-branch is skipped and the production
			// path semantics are byte-for-byte unchanged.
			const snapshot = {
				...state,
				currentTaskItem: this.task?.taskId
					? processedTaskHistory.find((item) => item.id === this.task?.taskId)
					: undefined,
				taskHistory: processedTaskHistory,
				turnState: this.turnStateTracker.get(),
				// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A + CORRECTION02 +
				// ACT-CLINEMM-DOGFOOD-CORRECTION04: project the host-owned
				// task telemetry (elapsed / toolCalls /
				// recoveryBudgetFailures) to the webview. When the tracker
				// has no active task, the field is undefined and the
				// TaskHeader renders em-dash rather than fabricating values
				// from chat prose. CORRECTION01 collapsed the three-counter
				// additive recovery metric to a single canonical authority
				// (episodeFailures). CORRECTION02 renamed the wire field to
				// recoveryBudgetFailures to reflect the underlying
				// bounded-recovery semantics (the counter only grows while
				// the recovery second stage is idle).
				//
				// C04 root cause: getStateToPostToWebview() projected
				// `turnState` but omitted `taskTelemetry`, so the webview
				// always received `undefined` for the telemetry strip even
				// though the tracker was alive and accumulating. Fix is the
				// single line below — the tracker's `get()` is the
				// canonical projection (it already returns the strip-or-
				// undefined shape the wire field expects).
				taskTelemetry: this.taskTelemetry.get(),
				// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01:
				//
				// The webview-facing Thinking/presentation projection. LOCAL
				// qualified path uses the canonical TaskState shadow
				// (`getLocalShadowProjection()`); the legacy fallback uses
				// `TurnStateTracker.phase === "streaming"` (Hub/Remote hosts
				// and Local sessions with no canonical snapshot yet — both
				// collapse per CONTRACT_2 in `task-state-shadow-arbiter-mapper.ts`).
				//
				// The three webview Thinking consumers actually migrated by E7.1
				// (ChatRow `case "reasoning"`, RequestStartRow inline shimmer,
				// useThinkingLoaderRow loader row — threaded via MessagesArea)
				// consume this field instead of `turnState.phase` directly.
				//
				// The TaskHeader state label
				// (`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`)
				// is explicitly NOT migrated by E7.1 — its `taskHeaderStateLabel`
				// helper consumes the full multi-phase `turnState.phase` vocabulary
				// ("Working" / "Approval" / "Complete" / "Error" / "Paused" /
				// "Waiting"). The TaskHeader is left for an E7.1-2 slice.
				//
				// The legacy `turnState` field is retained for non-thinking
				// presentation concepts (button set, composer lockout, follow-up
				// routing) that E7.1 explicitly does not migrate.
				thinkingPresentation: selectThinkingPresentation({
					canonicalShadow: this.getLocalShadowProjection(),
					currentLegacyPhase: this.turnStateTracker.currentPhase,
					seq: this.turnStateTracker.get().seq,
				}),
				// ACT-CLINEMM-SESSION-AUTONOMY01 + CORRECTION01:
				// ephemeral session override state. The store is the host-owned
				// authority; this is a read-only mirror for the webview.
				// Both legacy keys (sessionAutoApproval + sessionAutonomy) carry
				// the bound-state payload; a third key carries the armed intent
				// for the UI to render "Armed for next task".
				...(() => {
					const snap = this.sessionAutoApproval.snapshot()
					return {
						sessionAutoApproval: { override: snap.override, sessionId: snap.sessionId },
						sessionAutonomy: { override: snap.override, sessionId: snap.sessionId },
						sessionAutoApprovalArmed: snap.armed,
					}
				})(),
			}
			if (isPostTerminalAuthorityDiagnosticEnabled("extension")) {
				recordPostTerminalAuthoritySnapshot(
					buildExtensionSnapshotFromState({
						state: {
							stateVersion: snapshot.stateVersion,
							epoch: snapshot.epoch,
							taskId: snapshot.currentTaskItem?.id,
							sessionId: undefined,
							turnState: snapshot.turnState,
							thinkingPresentation: snapshot.thinkingPresentation,
							taskTelemetry: snapshot.taskTelemetry,
						},
						shadow: this.getLocalShadowProjection(),
					}),
				)
			}
			return snapshot
		} catch (error) {
			Logger.error("[SdkController] Failed to get state for webview:", error)
			throw error
		}
	}

	// ---- Terminal settings ----

	/**
	 * Apply the user's terminal settings from StateManager to a terminal manager.
	 * Called once when the lazy terminal manager is first created, and can be
	 * called again when settings change at runtime.
	 */
	applyTerminalSettings(terminalManager: VscodeTerminalManager): void {
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		if (shellIntegrationTimeout !== undefined) {
			terminalManager.setShellIntegrationTimeout(Number(shellIntegrationTimeout))
		}

		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		if (terminalReuseEnabled !== undefined) {
			terminalManager.setTerminalReuseEnabled(!!terminalReuseEnabled)
		}

		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		if (defaultTerminalProfile !== undefined && defaultTerminalProfile !== "") {
			terminalManager.setDefaultTerminalProfile(String(defaultTerminalProfile))
		}

		Logger.log(
			`[SdkController] Applied terminal settings: profile=${defaultTerminalProfile ?? "default"}, ` +
				`timeout=${shellIntegrationTimeout ?? 4000}, reuse=${terminalReuseEnabled ?? true}`,
		)
	}

	/**
	 * Get the terminal manager instance (if created).
	 * Used by updateSettings handlers to apply runtime changes.
	 */
	get terminalManager(): VscodeTerminalManager | undefined {
		return this._terminalManager
	}

	// ---- Workspace (kept from classic) ----

	private _workspaceManager?: WorkspaceRootManager
	private _workspaceManagerPathsKey?: string

	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		try {
			const { paths } = await HostProvider.workspace.getWorkspacePaths({})
			// When no workspace folder is open, fall back to the active session's
			// working directory (if known) or the shared chat workspace, the same
			// root getWorkspaceRoot() gives sessions. The legacy Controller always
			// seeded its manager with a fallback root (setupWorkspaceManager →
			// getCwd(getDesktopDir())), so @-mention file search kept working in
			// an empty window; returning undefined here instead made searchFiles
			// emit task.mention_failed (workspace_unavailable) with zero results.
			const validPaths = resolveWorkspaceManagerPaths(
				paths,
				this.lastKnownWorkspaceRoot ?? (await this.getNoWorkspaceFallback()),
			)
			if (validPaths.length === 0) {
				return undefined
			}
			// Rebuild only when the set of workspace folders changes
			const pathsKey = JSON.stringify(validPaths)
			if (!this._workspaceManager || this._workspaceManagerPathsKey !== pathsKey) {
				this._workspaceManager = await WorkspaceRootManager.fromPaths(validPaths)
				this._workspaceManagerPathsKey = pathsKey
			}
			return this._workspaceManager
		} catch (error) {
			Logger.warn("[SdkController] Failed to build workspace manager:", error)
			return undefined
		}
	}
}

// Extracted from classic src/core/controller/index.ts (see origin/main)
//
// Standalone function to build ExtensionState from a Controller instance.
// This allows the SdkController to reuse the classic state-building logic
// without inheriting the entire classic Controller implementation.

import { isModelToolEnabledGlobally, readCompactionStrategyGlobally } from "@cline/core"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import type { ExtensionState, Platform } from "@shared/ExtensionMessage"
import { ClineEnv } from "@/config"
import { ExtensionRegistryInfo } from "@/registry"
// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
// (twenty-sixth-pass): optional Q1..Q4 W-carrier trace observer.
// Default OFF. See apps/vscode/src/sdk/w-carrier-trace-runtime.ts.
import { recordWCarrierTrace, type WCarrierTraceContext } from "@/sdk/w-carrier-trace-runtime"
import type { WorkingContextHostCaptureState } from "@/sdk/working-context-host-capture"
import { BannerService } from "@/services/banner/BannerService"
import { featureFlagsService } from "@/services/feature-flags"
import { getDistinctId } from "@/services/logging/distinctId"
import { getExtensionVariant } from "@/services/telemetry/rollout-metadata"
import { getLatestAnnouncementId } from "@/utils/announcements"
import { getClineOnboardingModels } from "../models/getClineOnboardingModels"
import { projectWorkingContextStateFromCarrier } from "./working-context-state-projection"

/**
 * Builds the ExtensionState object to push to the webview.
 * Extracted from the classic Controller.getStateToPostToWebview().
 */
export async function getStateToPostToWebview(controller: {
	task?: any
	stateManager: any
	mcpHub?: any
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01:
	 * Per-job lifecycle projection keyed by CommandJob jobId.
	 * Forwarded to the wire as `backgroundCommandJobStates`.
	 */
	backgroundCommandJobStates?: Record<
		string,
		"running" | "exited" | "cancelled" | "deadline_exceeded" | "spawn_failed" | "containment_failed" | "terminal"
	>
	foregroundCommandRunning?: boolean
	workspaceManager?: any
	checkpointRestoreInput?: ExtensionState["checkpointRestoreInput"]
	isRemoteConfigAvailable?: boolean
	currentRemoteConfigRevision?: number
	// ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01 / CORRECTION06:
	// Production `modelProfilesOwner` (SINGLE composition authority for
	// profile + instance + stateManager). The projection at lines 192-241
	// reads `controller.modelProfilesOwner?.profilesStore.list()` to
	// produce the webview-safe `ModelProfileSummary[]` payload.
	// MUST be threaded in by SdkController.getStateToPostToWebview;
	// when undefined, the projection falls through to the empty default
	// (live-found P0 HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED).
	modelProfilesOwner?: {
		profilesStore: {
			list(): Record<string, unknown>
			read(profileId: string): unknown
		}
		instancesStore: {
			read(instanceId: string): unknown
			list(): Record<string, unknown>
		}
		// Optional helpers used by the projection for active/default binding.
		getCurrentTaskHistoryItem?: () => unknown
	}
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (nineteenth-pass): Boundary 3 -> 4 carrier for the
	// authoritative current working-context estimate (W).
	// The SdkController owns an instance of
	// WorkingContextHostCapture (apps/vscode/src/sdk/
	// working-context-host-capture.ts) and threads it here.
	// If the controller does not yet own a capture (legacy
	// / classic), the field defaults to `undefined` (the
	// numer on the TaskHeader bar falls back to P — see
	// UNDEFINED_W_STALE_REUSE = FORBIDDEN in the ACT).
	workingContextHostCapture?: WorkingContextHostCaptureState
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-sixth-pass): optional trace context for the
	// Q4 state_publish row. When the diagnostic is enabled
	// AND this field is provided by the caller, the
	// producer emits one trace record per call. The
	// carrier assignment semantics are unchanged; the
	// trace is a pure side-channel. See
	// apps/vscode/src/sdk/w-carrier-trace-runtime.ts.
	wCarrierTrace?: WCarrierTraceContext
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-sixth-pass): active session id, captured at
	// the same boundary as Q4 so each trace row is
	// cross-referenceable with the Q1..Q3 carrier_observe
	// rows. Optional; only present when the diagnostic
	// is enabled.
	sessionIdForTrace?: string | undefined
}): Promise<ExtensionState> {
	const stateManager = controller.stateManager

	// Get API configuration from cache for immediate access
	const onboardingModels = getClineOnboardingModels()
	const apiConfiguration = stateManager.getApiConfiguration()
	const lastShownAnnouncementId = stateManager.getGlobalStateKey("lastShownAnnouncementId")
	const taskHistory = stateManager.getGlobalStateKey("taskHistory")
	const autoApprovalSettings = stateManager.getGlobalSettingsKey("autoApprovalSettings")
	const browserSettings = stateManager.getGlobalSettingsKey("browserSettings")
	const preferredLanguage = stateManager.getGlobalSettingsKey("preferredLanguage")
	const mode = stateManager.getGlobalSettingsKey("mode")
	const useAutoCondense = stateManager.getGlobalSettingsKey("useAutoCondense")
	const compactionStrategy = readCompactionStrategyGlobally()
	const userContextCeiling = stateManager.getGlobalSettingsKey("userContextCeiling")
	const webSearchEnabled = isModelToolEnabledGlobally("web_search")
	const subagentsEnabled = stateManager.getGlobalSettingsKey("subagentsEnabled")
	// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
	// Persisted Settings values that bind to the sandbox capability
	// selectors in apps/vscode/src/sdk/sandbox-policy.ts.
	const clinemmSafeYoloAllowNetwork = stateManager.getGlobalStateKey("clinemmSafeYoloAllowNetwork")
	const clinemmSafeYoloAllowSshAgent = stateManager.getGlobalStateKey("clinemmSafeYoloAllowSshAgent")
	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01:
	// User-enabled, expiring exception to R0 workspace path authority.
	// The host filters expired entries at policy evaluation time; the
	// UI shows the raw persisted list so the user can see and remove
	// expired entries.
	const clinemmTemporaryExternalPathAuthorities = stateManager.getGlobalStateKey("clinemmTemporaryExternalPathAuthorities")
	const userInfo = stateManager.getGlobalStateKey("userInfo")
	const mcpMarketplaceEnabled = stateManager.getGlobalStateKey("mcpMarketplaceEnabled")
	const mcpDisplayMode = stateManager.getGlobalStateKey("mcpDisplayMode")
	const telemetrySetting = stateManager.getGlobalSettingsKey("telemetrySetting")
	const planActSeparateModelsSetting = stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
	const enableCheckpointsSetting = stateManager.getGlobalSettingsKey("enableCheckpointsSetting")
	const globalClineRulesToggles = stateManager.getGlobalStateKey("globalClineRulesToggles")
	const globalWorkflowToggles = stateManager.getGlobalStateKey("globalWorkflowToggles")
	const globalSkillsToggles = stateManager.getGlobalStateKey("globalSkillsToggles")
	const localSkillsToggles = stateManager.getWorkspaceStateKey("localSkillsToggles")
	const remoteRulesToggles = stateManager.getGlobalStateKey("remoteRulesToggles")
	const remoteWorkflowToggles = stateManager.getGlobalStateKey("remoteWorkflowToggles")
	const shellIntegrationTimeout = stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
	const terminalReuseEnabled = stateManager.getGlobalStateKey("terminalReuseEnabled")
	const vscodeTerminalExecutionMode = stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
	const defaultTerminalProfile = stateManager.getGlobalSettingsKey("defaultTerminalProfile")
	const isNewUser = stateManager.getGlobalStateKey("isNewUser")
	const welcomeViewCompleted = !!stateManager.getGlobalStateKey("welcomeViewCompleted")

	const mcpResponsesCollapsed = stateManager.getGlobalStateKey("mcpResponsesCollapsed")
	const favoritedModelIds = stateManager.getGlobalStateKey("favoritedModelIds")
	const lastDismissedInfoBannerVersion = stateManager.getGlobalStateKey("lastDismissedInfoBannerVersion") || 0
	const lastDismissedModelBannerVersion = stateManager.getGlobalStateKey("lastDismissedModelBannerVersion") || 0
	const lastDismissedCliBannerVersion = stateManager.getGlobalStateKey("lastDismissedCliBannerVersion") || 0
	const dismissedBanners = stateManager.getGlobalStateKey("dismissedBanners")
	const showFeatureTips = stateManager.getGlobalSettingsKey("showFeatureTips")

	const localClineRulesToggles = stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const localWindsurfRulesToggles = stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
	const localCursorRulesToggles = stateManager.getWorkspaceStateKey("localCursorRulesToggles")
	const localAgentsRulesToggles = stateManager.getWorkspaceStateKey("localAgentsRulesToggles")
	const workflowToggles = stateManager.getWorkspaceStateKey("workflowToggles")

	const currentTaskItem = controller.task?.taskId
		? (taskHistory || []).find((item: any) => item.id === controller.task?.taskId)
		: undefined
	const clineMessages = [...(controller.task?.messageStateHandler?.getClineMessages?.() || [])]
	const checkpointRestoreInput = controller.checkpointRestoreInput

	const processedTaskHistory = (taskHistory || [])
		.filter((item: any) => item.ts && item.task)
		.sort((a: any, b: any) => b.ts - a.ts)
		.slice(0, 100)

	const latestAnnouncementId = getLatestAnnouncementId()
	const shouldShowAnnouncement = lastShownAnnouncementId !== latestAnnouncementId
	const platform = process.platform as Platform
	const distinctId = getDistinctId()
	const version = ExtensionRegistryInfo.version
	const clineConfig = ClineEnv.config()
	const environment = clineConfig.environment
	const banners = BannerService.get().getActiveBanners() ?? []
	const welcomeBanners = BannerService.get().getWelcomeBanners() ?? []

	// Check OpenAI Codex authentication status
	let openAiCodexIsAuthenticated = false
	try {
		const { openAiCodexOAuthManager } = await import("@/integrations/openai-codex/oauth")
		openAiCodexIsAuthenticated = await openAiCodexOAuthManager.isAuthenticated()
	} catch {
		// Codex OAuth not available
	}

	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (nineteenth-pass): delegate the W-transport step to
	// the pure projection helper
	// (./working-context-state-projection.ts). The helper
	// is the single source of truth for the transport
	// contract: read the carrier verbatim, NO
	// recompute, NO estimator imports. UNDEFINED_W_STALE_
	// REUSE = FORBIDDEN is enforced by the carrier's
	// assignment semantics, not by this producer.
	const { currentWorkingContextEstimate } = projectWorkingContextStateFromCarrier(controller.workingContextHostCapture)
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-sixth-pass): emit one Q4 state_publish trace
	// record AFTER the projection is computed and BEFORE the
	// payload is returned. The trace is a pure side-channel;
	// the producer's output is unchanged. Default OFF: the
	// `isWCarrierTraceEnabled` check inside `recordWCarrierTrace`
	// short-circuits when the diagnostic is disabled. See
	// apps/vscode/src/sdk/w-carrier-trace-runtime.ts.
	if (controller.wCarrierTrace) {
		recordWCarrierTrace(controller.wCarrierTrace, {
			t: Date.now(),
			kind: "state_publish",
			sessionId: controller.sessionIdForTrace,
			publishedW: currentWorkingContextEstimate,
		})
	}

	// ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01 / CORRECTION06:
	// Project ModelProfiles + active/default binding onto
	// ExtensionState. The webview consumes these via the
	// `modelProfiles`, `defaultModelProfileId`, `activeModelProfileId`
	// fields. The projection is computed ONLY when the controller
	// owns a `modelProfilesOwner` — otherwise the webview sees
	// `undefined` and falls back to its local defaults.
	//
	// CORRECTION06 (live-found P0
	// HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED): the
	// owner is now part of the formal controller parameter type
	// (line 48 above), so SdkController.getStateToPostToWebview
	// MUST thread it through. The `modelProfilesOwner` field is
	// read here directly without the previous unsafe `as { ... }`
	// cast — the cast was hiding a wiring defect where the
	// inline-object call site omitted the owner and the projection
	// silently fell through to the empty default.
	let modelProfilesProjection: {
		modelProfiles: ExtensionState["modelProfiles"]
		defaultModelProfileId: ExtensionState["defaultModelProfileId"]
		activeModelProfileId: ExtensionState["activeModelProfileId"]
	} = {
		modelProfiles: [],
		defaultModelProfileId: null,
		activeModelProfileId: null,
	}
	const modelProfilesOwner = controller.modelProfilesOwner
	if (modelProfilesOwner && typeof modelProfilesOwner.profilesStore?.list === "function") {
		try {
			const defaultProfileId = (
				controller.stateManager as {
					getGlobalStateKey(key: "defaultModelProfileId"): string | undefined
				}
			).getGlobalStateKey("defaultModelProfileId")
			const taskHistoryItem = (controller.task as { taskId?: string } | undefined)?.taskId
				? modelProfilesOwner.getCurrentTaskHistoryItem?.()
				: undefined
			const projection = (await import("@/sdk/profile-store/owner")).projectExtensionStateModelProfiles({
				profilesStore: modelProfilesOwner.profilesStore as never,
				instancesStore: modelProfilesOwner.instancesStore as never,
				defaultProfileId,
				historyItem: taskHistoryItem as never,
			})
			modelProfilesProjection = projection
		} catch {
			// Defensive: a projection failure MUST NOT take down the
			// entire state push. Fall back to empty projection.
		}
	}
	return {
		version,
		extensionVariant: getExtensionVariant(),
		apiConfiguration,
		currentTaskItem,
		clineMessages,
		checkpointRestoreInput,
		currentWorkingContextEstimate,
		autoApprovalSettings,
		browserSettings,
		preferredLanguage,
		mode,
		useAutoCondense,
		// ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01:
		// Webview-facing ModelProfile projection.
		modelProfiles: modelProfilesProjection.modelProfiles,
		defaultModelProfileId: modelProfilesProjection.defaultModelProfileId,
		activeModelProfileId: modelProfilesProjection.activeModelProfileId,
		compactionStrategy,
		userContextCeiling,
		webSearchEnabled,
		subagentsEnabled,
		userInfo,
		mcpMarketplaceEnabled,
		mcpDisplayMode,
		telemetrySetting,
		planActSeparateModelsSetting,
		enableCheckpointsSetting: enableCheckpointsSetting ?? true,
		platform,
		environment,
		distinctId,
		globalClineRulesToggles: globalClineRulesToggles || {},
		localClineRulesToggles: localClineRulesToggles || {},
		localWindsurfRulesToggles: localWindsurfRulesToggles || {},
		localCursorRulesToggles: localCursorRulesToggles || {},
		localAgentsRulesToggles: localAgentsRulesToggles || {},
		localWorkflowToggles: workflowToggles || {},
		globalWorkflowToggles: globalWorkflowToggles || {},
		globalSkillsToggles: globalSkillsToggles || {},
		localSkillsToggles: localSkillsToggles || {},
		remoteRulesToggles,
		remoteWorkflowToggles,
		shellIntegrationTimeout,
		terminalReuseEnabled,
		vscodeTerminalExecutionMode,
		defaultTerminalProfile,
		isNewUser,
		welcomeViewCompleted,
		onboardingModels,
		mcpResponsesCollapsed,
		taskHistory: processedTaskHistory,
		shouldShowAnnouncement,
		favoritedModelIds,
		backgroundCommandRunning: controller.backgroundCommandRunning ?? false,
		backgroundCommandTaskId: controller.backgroundCommandTaskId,
		// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01:
		// Per-job lifecycle projection. Empty object when the host has
		// never published any job (the webview treats both absent and
		// empty as "no projection", and consults the historical flag).
		backgroundCommandJobStates: controller.backgroundCommandJobStates ?? {},
		foregroundCommandRunning: controller.foregroundCommandRunning ?? false,
		workspaceRoots: controller.workspaceManager?.getRoots?.() ?? [],
		primaryRootIndex: controller.workspaceManager?.getPrimaryIndex?.() ?? 0,
		isMultiRootWorkspace: (controller.workspaceManager?.getRoots?.()?.length ?? 0) > 1,
		multiRootSetting: {
			user: stateManager.getGlobalStateKey("multiRootEnabled"),
			featureFlag: true,
		},
		worktreesEnabled: {
			user: stateManager.getGlobalSettingsKey("worktreesEnabled"),
			featureFlag: featureFlagsService.getWorktreesEnabled(),
		},
		hooksEnabled: getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled")),
		lastDismissedInfoBannerVersion,
		lastDismissedModelBannerVersion,
		remoteConfigSettings: stateManager.getRemoteConfigSettings?.(),
		remoteConfigRevision: controller.currentRemoteConfigRevision ?? 0,
		lastDismissedCliBannerVersion,
		dismissedBanners,
		backgroundEditEnabled: stateManager.getGlobalSettingsKey("backgroundEditEnabled"),
		optOutOfRemoteConfig: stateManager.getGlobalSettingsKey("optOutOfRemoteConfig"),
		remoteConfigAvailable: controller.isRemoteConfigAvailable ?? false,
		showFeatureTips,
		// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
		// Project the sandbox-capability toggles to the webview so the
		// new "Sandbox & Capabilities" tab can render authoritative state.
		clinemmSafeYoloAllowNetwork,
		clinemmSafeYoloAllowSshAgent,
		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01
		clinemmTemporaryExternalPathAuthorities,
		banners,
		welcomeBanners,
		openAiCodexIsAuthenticated,
	} as ExtensionState
}

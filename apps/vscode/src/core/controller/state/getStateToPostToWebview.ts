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
	foregroundCommandRunning?: boolean
	workspaceManager?: any
	checkpointRestoreInput?: ExtensionState["checkpointRestoreInput"]
	isRemoteConfigAvailable?: boolean
	currentRemoteConfigRevision?: number
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
		banners,
		welcomeBanners,
		openAiCodexIsAuthenticated,
	} as ExtensionState
}

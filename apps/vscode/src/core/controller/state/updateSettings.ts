import { setCompactionStrategyGlobally, setModelToolEnabledGlobally } from "@cline/core"
import { Empty } from "@shared/proto/cline/common"
import { PlanActMode, McpDisplayMode as ProtoMcpDisplayMode, UpdateSettingsRequest } from "@shared/proto/cline/state"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { ClineEnv } from "@/config"
import { McpDisplayMode } from "@/shared/McpDisplayMode"
import { Logger } from "@/shared/services/Logger"
import { telemetryService } from "../../../services/telemetry"
import { BrowserSettings as SharedBrowserSettings } from "../../../shared/BrowserSettings"
import { Controller } from ".."
import { accountLogoutClicked } from "../account/accountLogoutClicked"
import { normalizeProviderSwitchModel } from "../models/providerSwitchNormalization"
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "../models/taskApiModel"

/**
 * Updates multiple extension settings in a single request
 * @param controller The controller instance
 * @param request The request containing the settings to update
 * @returns An empty response
 */
export async function updateSettings(controller: Controller, request: UpdateSettingsRequest): Promise<Empty> {
	try {
		if (request.clineEnv !== undefined && request.clineEnv !== "") {
			ClineEnv.setEnvironment(request.clineEnv)
			await accountLogoutClicked(controller, Empty.create())
		}

		if (request.apiConfiguration) {
			const protoApiConfiguration = request.apiConfiguration

			const convertedApiConfigurationFromProto = {
				...protoApiConfiguration,
				// Convert proto ApiProvider enums to native string types
				planModeApiProvider: protoApiConfiguration.planModeApiProvider
					? convertProtoToApiProvider(protoApiConfiguration.planModeApiProvider)
					: undefined,
				actModeApiProvider: protoApiConfiguration.actModeApiProvider
					? convertProtoToApiProvider(protoApiConfiguration.actModeApiProvider)
					: undefined,
				planModeReasoningEffort: protoApiConfiguration.planModeReasoningEffort as OpenaiReasoningEffort | undefined,
				actModeReasoningEffort: protoApiConfiguration.actModeReasoningEffort as OpenaiReasoningEffort | undefined,
			}

			const previousApiConfiguration = controller.stateManager.getApiConfiguration()
			const normalizedApiConfiguration = normalizeProviderSwitchModel(
				controller.getProviderConfigStore(),
				previousApiConfiguration,
				convertedApiConfigurationFromProto,
			)

			controller.stateManager.setApiConfiguration(normalizedApiConfiguration)

			if (controller.task) {
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
				const modelId = resolveActiveModelIdFromApiConfiguration(normalizedApiConfiguration, currentMode)
				controller.task.api = createTaskApiModelShim(modelId)
			}
			controller.handleApiConfigurationChanged(previousApiConfiguration, normalizedApiConfiguration)
		}

		// Update telemetry setting
		if (request.telemetrySetting) {
			await controller.updateTelemetrySetting(request.telemetrySetting as TelemetrySetting)
		}

		// Update plan/act separate models setting
		if (request.planActSeparateModelsSetting !== undefined) {
			controller.stateManager.setGlobalState("planActSeparateModelsSetting", request.planActSeparateModelsSetting)
		}

		// Update checkpoints setting
		if (request.enableCheckpointsSetting !== undefined) {
			controller.stateManager.setGlobalState("enableCheckpointsSetting", request.enableCheckpointsSetting)
		}

		// Update MCP responses collapsed setting
		if (request.mcpResponsesCollapsed !== undefined) {
			controller.stateManager.setGlobalState("mcpResponsesCollapsed", request.mcpResponsesCollapsed)
		}

		// Update MCP display mode setting
		if (request.mcpDisplayMode !== undefined) {
			// Convert proto enum to string type
			let displayMode: McpDisplayMode
			switch (request.mcpDisplayMode) {
				case ProtoMcpDisplayMode.RICH:
					displayMode = "rich"
					break
				case ProtoMcpDisplayMode.PLAIN:
					displayMode = "plain"
					break
				case ProtoMcpDisplayMode.MARKDOWN:
					displayMode = "markdown"
					break
				default:
					throw new Error(`Invalid MCP display mode value: ${request.mcpDisplayMode}`)
			}
			controller.stateManager.setGlobalState("mcpDisplayMode", displayMode)
		}

		if (request.mode !== undefined) {
			const mode = request.mode === PlanActMode.PLAN ? "plan" : "act"
			controller.stateManager.setGlobalState("mode", mode)
		}

		if (request.preferredLanguage !== undefined) {
			controller.stateManager.setGlobalState("preferredLanguage", request.preferredLanguage)
		}

		// Update terminal timeout setting
		if (request.shellIntegrationTimeout !== undefined) {
			controller.stateManager.setGlobalState("shellIntegrationTimeout", Number(request.shellIntegrationTimeout))
			controller.terminalManager?.setShellIntegrationTimeout(Number(request.shellIntegrationTimeout))
		}

		// Update terminal reuse setting
		if (request.terminalReuseEnabled !== undefined) {
			controller.stateManager.setGlobalState("terminalReuseEnabled", request.terminalReuseEnabled)
			controller.terminalManager?.setTerminalReuseEnabled(!!request.terminalReuseEnabled)
		}

		if (request.vscodeTerminalExecutionMode !== undefined && request.vscodeTerminalExecutionMode !== "") {
			const previousMode = controller.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
			const nextMode = request.vscodeTerminalExecutionMode === "backgroundExec" ? "backgroundExec" : "vscodeTerminal"
			controller.stateManager.setGlobalState("vscodeTerminalExecutionMode", nextMode)
			controller.handleTerminalExecutionModeChanged(previousMode, nextMode)
		}

		if (request.hooksEnabled !== undefined) {
			const wasEnabled = controller.stateManager.getGlobalSettingsKey("hooksEnabled") ?? true
			const isEnabled = !!request.hooksEnabled
			controller.stateManager.setGlobalState("hooksEnabled", isEnabled)
			if (controller.task && wasEnabled !== isEnabled) {
				telemetryService.captureFeatureToggle(controller.task.ulid, "hooks", isEnabled, controller.task.api.getModel().id)
			}
		}
		// Update worktrees setting
		if (request.worktreesEnabled !== undefined) {
			controller.stateManager.setGlobalState("worktreesEnabled", request.worktreesEnabled)
		}

		// Update subagents setting
		if (request.subagentsEnabled !== undefined) {
			const wasEnabled = controller.stateManager.getGlobalSettingsKey("subagentsEnabled") ?? false
			const isEnabled = !!request.subagentsEnabled
			controller.stateManager.setGlobalState("subagentsEnabled", isEnabled)

			// Capture telemetry when setting changes
			if (wasEnabled !== isEnabled) {
				telemetryService.captureSubagentToggle(isEnabled)
			}
		}

		// Update auto-condense setting
		if (request.useAutoCondense !== undefined) {
			if (controller.task) {
				telemetryService.captureAutoCondenseToggle(
					controller.task.ulid,
					request.useAutoCondense,
					controller.task.api.getModel().id,
				)
			}
			controller.stateManager.setGlobalState("useAutoCondense", request.useAutoCondense)
		}

		// Update web search setting (stored in the SDK global settings file; applied when the next session is built)
		if (request.webSearchEnabled !== undefined) {
			setModelToolEnabledGlobally("web_search", !!request.webSearchEnabled)
		}

		if (request.compactionStrategy !== undefined) {
			const strategy = request.compactionStrategy
			if (strategy !== "basic" && strategy !== "agentic") {
				throw new Error(`Invalid compaction strategy value: ${strategy}`)
			}
			setCompactionStrategyGlobally(strategy)
		}

		// ACT-CLINEMM-USER-CONTEXT-CEILING01 / CORRECTION01: persist the user-
		// controlled operating context ceiling. This handler is the single
		// persistence authority. The wire contract is two fields that share a
		// mutually exclusive contract:
		//   - request.userContextCeiling: a positive integer → persist it.
		//     Absent/undefined → leave disk untouched.
		//   - request.clearUserContextCeiling: explicitly true → clear disk
		//     (Auto). Anything else (false / undefined) → leave disk untouched.
		// The two fields are required because proto3 cannot distinguish
		// "field absent" from "field set to undefined" through the existing
		// single-value field — `UpdateSettingsRequest.create()` always
		// initializes every field to `undefined`, so the existing
		// `request.userContextCeiling !== undefined` check is the only way
		// the value pathway can detect "explicitly set". The clear pathway
		// is a sibling boolean so an explicit Auto intent cannot be confused
		// with an absent field.
		//
		// CORRECTION01 P1: a request that carries BOTH a value and
		// clear=true is a contradictory command that explicitly says "set
		// to 512000" and "delete the persisted key" in the same atomic
		// transaction. The proto comments say "may carry one or neither;
		// carrying both is invalid", and the handler enforces it. Silently
		// picking one would be an avoidable ambiguity in a public
		// wire contract; a typed rejection lets the caller surface the
		// contradiction and preserves the on-disk value (no partial
		// mutation).
		if (request.clearUserContextCeiling === true && request.userContextCeiling !== undefined) {
			throw new Error("Cannot set and clear user context ceiling in the same request")
		}
		if (request.clearUserContextCeiling === true) {
			controller.stateManager.setGlobalState("userContextCeiling", undefined)
		} else if (request.userContextCeiling !== undefined) {
			const ceiling = request.userContextCeiling
			if (typeof ceiling !== "number" || !Number.isFinite(ceiling) || !Number.isInteger(ceiling) || ceiling <= 0) {
				throw new Error(`Invalid user context ceiling value: ${ceiling}`)
			}
			controller.stateManager.setGlobalState("userContextCeiling", ceiling)
		}

		// Update browser settings
		if (request.browserSettings !== undefined) {
			// Get current browser settings to preserve fields not in the request
			const currentSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")

			// Convert from protobuf format to shared format, merging with existing settings
			const newBrowserSettings: SharedBrowserSettings = {
				...currentSettings, // Start with existing settings (and defaults)
				viewport: {
					// Apply updates from request
					width: request.browserSettings.viewport?.width || currentSettings.viewport.width,
					height: request.browserSettings.viewport?.height || currentSettings.viewport.height,
				},
				// Explicitly handle optional boolean and string fields from the request
				remoteBrowserEnabled:
					request.browserSettings.remoteBrowserEnabled === undefined
						? currentSettings.remoteBrowserEnabled
						: request.browserSettings.remoteBrowserEnabled,
				remoteBrowserHost:
					request.browserSettings.remoteBrowserHost === undefined
						? currentSettings.remoteBrowserHost
						: request.browserSettings.remoteBrowserHost,
				chromeExecutablePath:
					// If chromeExecutablePath is explicitly in the request (even as ""), use it.
					// Otherwise, fall back to mergedWithDefaults.
					"chromeExecutablePath" in request.browserSettings
						? request.browserSettings.chromeExecutablePath
						: currentSettings.chromeExecutablePath,
				disableToolUse:
					request.browserSettings.disableToolUse === undefined
						? currentSettings.disableToolUse
						: request.browserSettings.disableToolUse,
				customArgs:
					"customArgs" in request.browserSettings ? request.browserSettings.customArgs : currentSettings.customArgs,
			}

			// Update global state with new settings
			controller.stateManager.setGlobalState("browserSettings", newBrowserSettings)
		}

		// Update default terminal profile
		if (request.defaultTerminalProfile !== undefined) {
			controller.stateManager.setGlobalState("defaultTerminalProfile", request.defaultTerminalProfile)
			// Update the live terminal manager so new terminals use the new profile.
			// Existing terminals are left open — they're keyed by effective shell
			// and reused when compatible, or skipped when not. No session rebuild
			// is needed: the run_commands tool re-reads the profile each time a
			// model request is built, so the description and execution both pick
			// up the new shell at the next request boundary.
			controller.terminalManager?.setDefaultTerminalProfile(request.defaultTerminalProfile)
		}

		if (request.backgroundEditEnabled !== undefined) {
			controller.stateManager.setGlobalState("backgroundEditEnabled", !!request.backgroundEditEnabled)
		}

		if (request.multiRootEnabled !== undefined) {
			controller.stateManager.setGlobalState("multiRootEnabled", !!request.multiRootEnabled)
		}

		if (request.optOutOfRemoteConfig !== undefined) {
			const hadOptedOut = !!controller.stateManager.getGlobalSettingsKey("optOutOfRemoteConfig")
			const isOptingOut = !!request.optOutOfRemoteConfig

			// Update first so the authoritative refresh evaluates the new preference.
			controller.stateManager.setGlobalState("optOutOfRemoteConfig", isOptingOut)
			if (isOptingOut !== hadOptedOut) {
				// force: never coalesce onto an in-flight refresh that already
				// evaluated the pre-change opt-out preference.
				await controller.refreshRemoteConfig({ force: true })
			}
		}

		if (request.showFeatureTips !== undefined) {
			controller.stateManager.setGlobalState("showFeatureTips", request.showFeatureTips)
		}

		// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
		// ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01:
		// Persisted Settings values that bind to the sandbox capability
		// selectors in apps/vscode/src/sdk/sandbox-policy.ts.
		// `request.X !== undefined` discriminates the explicit user
		// toggle (true/false) from absence; the write below is the
		// ONLY authoritative source of an opinion for these two fields.
		// After the LIVE-REGRESSION01 repair, absence stays undefined
		// through hydration so the env path remains authoritative for
		// users who have never touched the toggle.
		if (request.clinemmSafeYoloAllowNetwork !== undefined) {
			controller.stateManager.setGlobalState("clinemmSafeYoloAllowNetwork", !!request.clinemmSafeYoloAllowNetwork)
		}
		if (request.clinemmSafeYoloAllowSshAgent !== undefined) {
			controller.stateManager.setGlobalState("clinemmSafeYoloAllowSshAgent", !!request.clinemmSafeYoloAllowSshAgent)
		}

		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01:
		// Wire format: serialized JSON array of
		//   { path: string, expiresAt: string } entries.
		// The host validator (`validateTemporaryExternalPathAuthorities`)
		// runs the 24h ceiling check + the absolute-path + non-root
		// check BEFORE persistence. Rejections are surfaced to the
		// user / CLI operator as a typed error.
		if (request.clinemmTemporaryExternalPathAuthorities !== undefined) {
			const { validateTemporaryExternalPathAuthorities } = await import("@shared/storage/temporaryExternalPathAuthorities")
			// The wire shape arrives as a serialized JSON string;
			// parse it before validating.
			let parsed: unknown
			try {
				parsed = JSON.parse(request.clinemmTemporaryExternalPathAuthorities)
			} catch (err) {
				Logger.error("[updateSettings] failed to parse clinemmTemporaryExternalPathAuthorities wire payload:", err)
				throw new Error("clinemmTemporaryExternalPathAuthorities wire payload is not valid JSON")
			}
			const result = validateTemporaryExternalPathAuthorities(parsed)
			if (result.errors.length > 0) {
				throw new Error(
					`clinemmTemporaryExternalPathAuthorities rejected: ${result.errors
						.map((e) => `[index ${e.index}] ${e.reason}: ${e.message}`)
						.join("; ")}`,
				)
			}
			controller.stateManager.setGlobalState("clinemmTemporaryExternalPathAuthorities", [...result.valid])
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		Logger.error("Failed to update settings:", error)
		throw error
	}
}

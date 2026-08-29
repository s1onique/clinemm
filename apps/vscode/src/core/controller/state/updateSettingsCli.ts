import { Empty } from "@shared/proto/cline/common"
import { PlanActMode, UpdateSettingsRequestCli } from "@shared/proto/cline/state"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import type { Settings } from "@shared/storage/state-keys"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { ClineEnv } from "@/config"
import { Logger } from "@/shared/services/Logger"
import { Mode } from "@/shared/storage/types"
import { telemetryService } from "../../../services/telemetry"
import { Controller } from ".."
import { accountLogoutClicked } from "../account/accountLogoutClicked"
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "../models/taskApiModel"
import { normalizeOpenaiReasoningEffort } from "./reasoningEffort"

/**
 * Updates multiple extension settings in a single request
 * @param controller The controller instance
 * @param request The request containing the settings to update
 * @returns An empty response
 */
export async function updateSettingsCli(controller: Controller, request: UpdateSettingsRequestCli): Promise<Empty> {
	const convertPlanActMode = (mode: PlanActMode): Mode => {
		return mode === PlanActMode.PLAN ? "plan" : "act"
	}

	if (request.environment !== undefined) {
		ClineEnv.setEnvironment(request.environment)
		await accountLogoutClicked(controller, Empty.create())
	}

	if (request.settings) {
		// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01 P1 (FACTORY):
		// the wire contract is mutually exclusive: a single request may
		// carry `user_context_ceiling` OR `clear_user_context_ceiling`,
		// never both. Carrying both is a contradictory command that we
		// reject with a typed error. The guard here runs BEFORE any
		// destructuring, batch write, or dedicated handler so that a
		// rejected request is atomic: no `setGlobalStateBatch`,
		// no `setGlobalState`, no telemetry-side mutation. If the
		// guard lived further down (e.g. inside the dedicated handler
		// AFTER the batch write), an unrelated setting in the same
		// request could be partially mutated before the throw, which
		// would violate the atomicity contract documented in the
		// comments and tested by `updateSettingsCli.test.ts`.
		if (request.settings.clearUserContextCeiling === true && request.settings.userContextCeiling !== undefined) {
			throw new Error("Cannot set and clear user context ceiling in the same request")
		}

		// Extract all special case fields that need dedicated handlers
		// These should NOT be included in the batch update
		const {
			// Fields requiring conversion
			autoApprovalSettings,
			planModeReasoningEffort,
			actModeReasoningEffort,
			mode,
			planModeApiProvider,
			actModeApiProvider,
			// Fields requiring special logic (telemetry, merging, etc.)
			telemetrySetting,
			useAutoCondense,
			worktreesEnabled,
			subagentsEnabled,
			browserSettings,
			defaultTerminalProfile,
			// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
			// Persisted Settings values that bind to the sandbox capability
			// selectors in apps/vscode/src/sdk/sandbox-policy.ts. Both
			// fields default to false in state-keys.ts and the resolver
			// treats absent / false as "no opt-in" → pre-ACT runtime.
			clinemmSafeYoloAllowNetwork,
			clinemmSafeYoloAllowSshAgent,
			// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01: extract
			// the ceiling fields so they don't fall into `simpleSettings`
			// and get persisted via `setGlobalStateBatch` as part of
			// the generic batch flow. The dedicated handler below reads
			// these extracted locals and writes them through the
			// dedicated `setGlobalState` path. The contradiction
			// guard above (which runs BEFORE this destructuring) has
			// already ensured that the two fields cannot both be present
			// in a single request.
			userContextCeiling,
			clearUserContextCeiling,
			...simpleSettings
		} = request.settings

		// Batch update for simple pass-through fields
		const filteredSettings: Partial<Settings> = Object.fromEntries(
			Object.entries(simpleSettings).filter(([key, value]) => key !== "openaiReasoningEffort" && value !== undefined),
		)

		controller.stateManager.setGlobalStateBatch(filteredSettings)

		Logger.log("autoApprovalSettings", controller.stateManager.getGlobalSettingsKey("autoApprovalSettings"))

		// Handle fields requiring type conversion from generated protobuf types to application types
		if (autoApprovalSettings) {
			// Merge with current settings to preserve unspecified fields
			const currentAutoApprovalSettings = controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
			const mergedSettings = {
				...currentAutoApprovalSettings,
				...(autoApprovalSettings.version !== undefined && { version: autoApprovalSettings.version }),
				...(autoApprovalSettings.enableNotifications !== undefined && {
					enableNotifications: autoApprovalSettings.enableNotifications,
				}),
				actions: {
					...currentAutoApprovalSettings.actions,
					...(autoApprovalSettings.actions
						? Object.fromEntries(Object.entries(autoApprovalSettings.actions).filter(([_, v]) => v !== undefined))
						: {}),
				},
			}

			controller.stateManager.setGlobalState("autoApprovalSettings", mergedSettings)
		}

		if (planModeReasoningEffort !== undefined) {
			const converted = normalizeOpenaiReasoningEffort(planModeReasoningEffort)
			controller.stateManager.setGlobalState("planModeReasoningEffort", converted)
		}

		if (actModeReasoningEffort !== undefined) {
			const converted = normalizeOpenaiReasoningEffort(actModeReasoningEffort)
			controller.stateManager.setGlobalState("actModeReasoningEffort", converted)
		}

		if (mode !== undefined) {
			const converted = convertPlanActMode(mode)
			controller.stateManager.setGlobalState("mode", converted)
		}

		if (planModeApiProvider !== undefined) {
			const converted = convertProtoToApiProvider(planModeApiProvider)
			controller.stateManager.setGlobalState("planModeApiProvider", converted)
		}

		if (actModeApiProvider !== undefined) {
			const converted = convertProtoToApiProvider(actModeApiProvider)
			controller.stateManager.setGlobalState("actModeApiProvider", converted)
		}

		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			const modelId = resolveActiveModelIdFromApiConfiguration(controller.stateManager.getApiConfiguration(), currentMode)
			controller.task.api = createTaskApiModelShim(modelId)
		}

		// Update telemetry setting
		if (telemetrySetting) {
			await controller.updateTelemetrySetting(telemetrySetting as TelemetrySetting)
		}

		// Update auto-condense setting (requires telemetry)
		if (useAutoCondense !== undefined) {
			if (controller.task) {
				telemetryService.captureAutoCondenseToggle(
					controller.task.ulid,
					useAutoCondense,
					controller.task.api.getModel().id,
				)
			}
			controller.stateManager.setGlobalState("useAutoCondense", useAutoCondense)
		}

		// ACT-CLINEMM-USER-CONTEXT-CEILING01 / CORRECTION01: validate and
		// persist the CLI-supplied ceiling. Mirrors `updateSettings.ts`
		// with the same two-field wire contract and the same
		// mutually-exclusive invariant:
		//   - request.settings.userContextCeiling: positive integer
		//     → persist. Absent/undefined → leave disk untouched.
		//   - request.settings.clearUserContextCeiling: explicitly true
		//     → clear disk (Auto). Anything else → leave disk untouched.
		// The sibling-boolean clear pathway is required because proto3
		// single-value fields cannot distinguish "explicitly set to
		// undefined" from "absent" (the create() helper initializes every
		// field to undefined). The SDK policy resolver sanitizes the value
		// at consumption time, but we reject clearly invalid inputs at the
		// persistence seam so they cannot reach disk and silently become
		// model metadata in a future build.
		//
		// CORRECTION01 P1: the atomicity-of-rejection invariant is enforced
		// at the TOP of the `if (request.settings)` block (see above).
		// This duplicated guard is a defensive safety net: if the early
		// guard is ever removed or refactored, the dedicated handler
		// still refuses to persist a contradictory state. The early guard
		// is what guarantees no unrelated setting in the same request can
		// be partially mutated before the throw; this one is unlocked by
		// that earlier throw and is therefore unreachable in normal flow.
		if (request.settings.clearUserContextCeiling === true && request.settings.userContextCeiling !== undefined) {
			throw new Error("Cannot set and clear user context ceiling in the same request")
		}
		if (request.settings.clearUserContextCeiling === true) {
			controller.stateManager.setGlobalState("userContextCeiling", undefined)
		} else if (request.settings.userContextCeiling !== undefined) {
			const userContextCeiling = request.settings.userContextCeiling
			if (
				typeof userContextCeiling !== "number" ||
				!Number.isFinite(userContextCeiling) ||
				!Number.isInteger(userContextCeiling) ||
				userContextCeiling <= 0
			) {
				throw new Error(`Invalid user context ceiling value: ${userContextCeiling}`)
			}
			controller.stateManager.setGlobalState("userContextCeiling", userContextCeiling)
		}

		// Update worktrees setting
		if (worktreesEnabled !== undefined) {
			controller.stateManager.setGlobalState("worktreesEnabled", worktreesEnabled)
		}

		// Update subagents setting (requires telemetry on state change)
		if (subagentsEnabled !== undefined) {
			const wasEnabled = controller.stateManager.getGlobalSettingsKey("subagentsEnabled") ?? false
			const isEnabled = !!subagentsEnabled
			controller.stateManager.setGlobalState("subagentsEnabled", isEnabled)

			if (wasEnabled !== isEnabled) {
				telemetryService.captureSubagentToggle(isEnabled)
			}
		}

		// Update browser settings (requires careful merging to avoid protobuf defaults)
		if (browserSettings !== undefined) {
			const currentSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")

			const newBrowserSettings = {
				...currentSettings,
				viewport: {
					width: browserSettings.viewport?.width || currentSettings.viewport.width,
					height: browserSettings.viewport?.height || currentSettings.viewport.height,
				},
				...(browserSettings.remoteBrowserEnabled !== undefined && {
					remoteBrowserEnabled: browserSettings.remoteBrowserEnabled,
				}),
				...(browserSettings.remoteBrowserHost !== undefined && {
					remoteBrowserHost: browserSettings.remoteBrowserHost,
				}),
				...(browserSettings.chromeExecutablePath !== undefined && {
					chromeExecutablePath: browserSettings.chromeExecutablePath,
				}),
				...(browserSettings.disableToolUse !== undefined && {
					disableToolUse: browserSettings.disableToolUse,
				}),
				...(browserSettings.customArgs !== undefined && {
					customArgs: browserSettings.customArgs,
				}),
			}

			controller.stateManager.setGlobalState("browserSettings", newBrowserSettings)
		}

		// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
		// Persisted Settings values for the sandbox capability toggles.
		// The CLI parity path uses the same single-boolean contract
		// (true -> enable, false -> disable, undefined -> leave disk
		// untouched) so the webview toggle and the CLI / ACP toggle
		// round-trip through the same authoritative key. Setting the
		// value to false explicitly is honoured and survives reload
		// (mirrors the precedent for worktreesEnabled / subagentsEnabled).
		if (clinemmSafeYoloAllowNetwork !== undefined) {
			controller.stateManager.setGlobalState(
				"clinemmSafeYoloAllowNetwork",
				!!clinemmSafeYoloAllowNetwork,
			)
		}
		if (clinemmSafeYoloAllowSshAgent !== undefined) {
			controller.stateManager.setGlobalState(
				"clinemmSafeYoloAllowSshAgent",
				!!clinemmSafeYoloAllowSshAgent,
			)
		}

		// Update default terminal profile
		if (defaultTerminalProfile !== undefined && defaultTerminalProfile !== "") {
			controller.stateManager.setGlobalState("defaultTerminalProfile", defaultTerminalProfile)
			// Update the live terminal manager so new terminals use the new profile.
			// Existing terminals are left open — they're keyed by effective shell
			// and reused when compatible, or skipped when not. No session rebuild
			// is needed: the run_commands tool re-reads the profile each time a
			// model request is built, so the description and execution both pick
			// up the new shell at the next request boundary.
			controller.terminalManager?.setDefaultTerminalProfile(defaultTerminalProfile)
		}
	}

	// Handle secrets updates
	if (request.secrets) {
		const filteredSecrets = Object.fromEntries(Object.entries(request.secrets).filter(([_, value]) => value !== undefined))

		controller.stateManager.setSecretsBatch(filteredSecrets)
	}

	// Post updated state to webview
	await controller.postStateToWebview()

	return Empty.create()
}

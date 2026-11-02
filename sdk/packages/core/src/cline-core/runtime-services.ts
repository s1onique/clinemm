import type {
	McpAppsRuntimeService,
	PendingPromptsRuntimeService,
	PendingPromptsServiceApi,
	RuntimeHost,
	SessionConnectionRuntimeService,
	SessionModelRuntimeService,
	SessionUsageRuntimeService,
} from "../runtime/host/runtime-host";
import type {
	PluginCommandsApi,
	PluginCommandsRuntimeService,
} from "../services/plugin-command-api";
import {
	type ClineCoreSettingsApi,
	type CoreSettingsListInput,
	type CoreSettingsMutationResult,
	type CoreSettingsSnapshot,
	type CoreSettingsToggleInput,
	createCoreSettingsService,
} from "../settings";

type RuntimeHostWithSettings = RuntimeHost & {
	listSettings?: (
		input?: CoreSettingsListInput,
	) => Promise<CoreSettingsSnapshot>;
	toggleSetting?: (
		input: CoreSettingsToggleInput,
	) => Promise<CoreSettingsMutationResult>;
};

export type RuntimeHostServiceExtensions = RuntimeHost &
	Partial<
		PendingPromptsRuntimeService &
			SessionUsageRuntimeService &
			SessionConnectionRuntimeService &
			SessionModelRuntimeService &
			McpAppsRuntimeService
	>;

export function createClineCoreSettingsApi(
	host: RuntimeHost,
): ClineCoreSettingsApi {
	return {
		async list(input) {
			const settingsHost = host as RuntimeHostWithSettings;
			if (settingsHost.listSettings) {
				return await settingsHost.listSettings(input);
			}
			return await createCoreSettingsService().list(input);
		},
		async toggle(input) {
			const settingsHost = host as RuntimeHostWithSettings;
			if (settingsHost.toggleSetting) {
				return await settingsHost.toggleSetting(input);
			}
			return await createCoreSettingsService().toggle(input);
		},
	};
}

export function createClineCorePendingPromptsApi(
	host: RuntimeHost,
): PendingPromptsServiceApi {
	function getService(): PendingPromptsServiceApi {
		const service = (host as RuntimeHostServiceExtensions).pendingPrompts;
		if (!service) {
			throw new Error("Pending prompt service is not available.");
		}
		return service;
	}
	return {
		steerFirst(input) {
			return getService().steerFirst(input);
		},
		list(input) {
			return getService().list(input);
		},
		update(input) {
			return getService().update(input);
		},
		delete(input) {
			return getService().delete(input);
		},
		// ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01:
		// Forward the synchronous `count` accessor to the underlying
		// host's pending-prompt service. This is the AUTHORITATIVE
		// transport-neutral read used by the Q5 composition seam (e.g.
		// SdkController.getPendingPromptCount →
		// SdkSessionEventCoordinator's `getPendingPromptCount` option).
		// Per the upstream architecture rule (ARCHITECTURE.md lines
		// 454-460), pending-prompt query/mutation semantics belong at
		// this service boundary, NOT on the `RuntimeHost` primitive.
		count(sessionId) {
			return getService().count(sessionId);
		},
	};
}

export function createClineCorePluginCommandsApi(
	host: RuntimeHost,
): PluginCommandsApi {
	const service = () => {
		const api = (host as RuntimeHost & Partial<PluginCommandsRuntimeService>)
			.pluginCommands;
		if (!api)
			throw new Error("Plugin commands are unavailable on this runtime");
		return api;
	};
	return {
		list: (target) => service().list(target),
		run: (input) => service().run(input),
	};
}

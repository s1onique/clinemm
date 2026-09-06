import type { CoreSessionConfig } from "@cline/core"
import type { ApiConfiguration } from "@shared/api"
import type { StateManager } from "@/core/storage/StateManager"
import { buildSessionConfig, type SessionConfigInput } from "./cline-session-factory"
import { buildAgentHooks, type HookMessageEmitter } from "./hooks-adapter"

export interface SdkSessionConfigBuilderOptions {
	stateManager: StateManager
	emitHookMessage: HookMessageEmitter
	onConsecutiveMistakeLimitReached?: CoreSessionConfig["onConsecutiveMistakeLimitReached"]
}

/**
 * Unlike the CLI interactive runtime, plan-mode sessions do NOT expose a
 * switch_to_act_mode tool: matching the legacy extension, the model cannot
 * switch modes itself and must ask the user to flip the Plan/Act toggle. The
 * plan-mode system prompt (planModeSwitchTool: false in the session factory)
 * carries the matching instructions.
 */
export class SdkSessionConfigBuilder {
	constructor(private readonly options: SdkSessionConfigBuilderOptions) {}

	async build(input: SessionConfigInput): Promise<Awaited<ReturnType<typeof buildSessionConfig>>> {
		const config = await buildSessionConfig(input)
		if (this.options.onConsecutiveMistakeLimitReached) {
			config.onConsecutiveMistakeLimitReached = this.options.onConsecutiveMistakeLimitReached
		}

		config.hooks = buildAgentHooks(this.options.stateManager, this.options.emitHookMessage, input.cwd)

		// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01 (R2 GREEN
		// contract, ninth reviewer reopen):
		//
		// When the caller passes an explicit
		// `providerConfigurationInstance`, project it onto the resolved
		// config so that `applyProviderConfigurationInstance(A, B)` is
		// actually load-bearing on `next` (B): the reconstructed
		// session's identity / connection fields reflect B, regardless
		// of whatever the StateManager currently holds.
		//
		// This is the bounded minimum probe ahead of the Foundation's
		// durable persistence layer. The five identity-bearing fields
		// (providerId, modelId, apiKey, baseUrl, headers) are exactly
		// the ones R2 STRATEGY_B_CONTRACT_GUARD asserts on the new
		// active session's in-memory ActiveSession.config — see
		// `provider-instance-identity-r2-strategy-b.piif01.test.ts`.
		if (input.providerConfigurationInstance) {
			applyProviderConfigurationInstanceToConfig(config, input.providerConfigurationInstance, input.mode)
		}

		return config
	}
}

/**
 * Project the provider-identity fields of an explicit
 * `ApiConfiguration` instance onto an already-resolved
 * `CoreSessionConfig`.
 *
 * TEMP_API_CONFIGURATION_PROJECTOR = OPENAI_ONLY_PROBE
 *   This projector only overlays five fields
 *   (providerId, modelId, apiKey, baseUrl, headers) extracted from
 *   legacy OpenAI-shaped fields (`openAiApiKey`, `openAiBaseUrl`,
 *   `openAiHeaders`). It is NOT the generic provider-instance
 *   projection required by the product case (local-litellm,
 *   corporate-litellm, lab-litellm, etc.) — `ApiConfiguration` is
 *   only useful as a temporary carrier here because the
 *   explicit-instance seam has to ship before the persisted
 *   `ProviderConfigurationInstance` representation lands. Once that
 *   representation exists, this projector will be REPLACED by the
 *   frozen typed projector, not expanded.
 *
 * Mode discriminator:
 *   The instance carries both plan and act selections
 *   (`planModeApiProvider` / `actModeApiProvider`). The mode
 *   parameter selects which one drives the projection. When
 *   `mode === "plan"`, the plan fields are projected (only the plan
 *   field of the instance; act fields are NOT also projected). This
 *   prevents a single `ApiConfiguration` from projecting an
 *   act-selected model into a plan session (defect surfaced by the
 *   ninth reviewer and the R2p3 mode discriminator test).
 *
 *   When `mode` is undefined, the projector uses the act fields,
 *   which matches the default mode of the SDK session factory.
 *
 * This is intentionally a side-effect mutation of `config` (rather
 * than a re-resolution through `resolveApiKey` /
 * `resolveModelId` / `resolveBaseUrl` from the StateManager) because:
 *
 *   1. The fields on the explicit instance are the canonical values
 *      for B; we must NOT round-trip through StateManager (which
 *      still holds A).
 *   2. This is the bounded minimum probe ahead of the Foundation's
 *      durable persistence layer. The full
 *      `projectInstanceToLiveConfig` will replace this once the
 *      persisted definition store is wired.
 *
 * Undefined fields on the instance are NOT applied (so that the
 * underlying StateManager-resolved value is preserved if the caller
 * only wants to override a subset — e.g. just the modelId).
 *
 * KNOWN LIMITATION (clearing semantics, R2p2):
 *   Because `ApiConfiguration` does not distinguish "field absent"
 *   from "field present and undefined", a caller that wants to
 *   *clear* a field on the resolved config cannot do so through
 *   this projector. The persisted `ProviderConfigurationInstance`
 *   representation must include an explicit clearing form
 *   (e.g. `{ headers: null }`) before this constraint is relaxed.
 */
function applyProviderConfigurationInstanceToConfig(
	config: CoreSessionConfig,
	instance: ApiConfiguration,
	mode: "plan" | "act" | undefined,
): void {
	const instAny = instance as Record<string, unknown>
	const cfgAny = config as unknown as Record<string, unknown>

	const setIfDefined = <K extends string>(key: K, value: unknown): void => {
		if (value !== undefined) {
			cfgAny[key] = value
		}
	}

	// Identity: providerId + modelId — select the field that matches
	// the requested mode. Do NOT project the other mode's field onto
	// the config (it would silently override a planned act session
	// with the act selection even when the caller asked for plan).
	if (mode === "plan") {
		if (instAny.planModeApiProvider !== undefined) {
			setIfDefined("providerId", instAny.planModeApiProvider)
		}
		if (instAny.planModeApiModelId !== undefined) {
			setIfDefined("modelId", instAny.planModeApiModelId)
		}
	} else {
		// mode === "act" or undefined: act is the default for SDK
		// session lifecycle (mode defaults to "act" in
		// buildSessionConfig). Fall back to plan when act is
		// absent, so a plan-only `ApiConfiguration` still projects
		// cleanly.
		if (instAny.actModeApiProvider !== undefined) {
			setIfDefined("providerId", instAny.actModeApiProvider)
		} else if (instAny.planModeApiProvider !== undefined) {
			setIfDefined("providerId", instAny.planModeApiProvider)
		}
		if (instAny.actModeApiModelId !== undefined) {
			setIfDefined("modelId", instAny.actModeApiModelId)
		} else if (instAny.planModeApiModelId !== undefined) {
			setIfDefined("modelId", instAny.planModeApiModelId)
		}
	}

	// Connection: apiKey + baseUrl + headers (OpenAI-compatible
	// shape). These are mode-independent in `ApiConfiguration`; the
	// provider settings UI keeps a single credential per provider.
	if (instAny.openAiApiKey !== undefined) {
		setIfDefined("apiKey", instAny.openAiApiKey)
	}
	if (instAny.openAiBaseUrl !== undefined) {
		setIfDefined("baseUrl", instAny.openAiBaseUrl)
	}
	if (instAny.openAiHeaders !== undefined) {
		const parsed = parseOpenAiHeaders(instAny.openAiHeaders)
		if (parsed !== undefined) {
			setIfDefined("headers", parsed)
		}
	}
}

function parseOpenAiHeaders(raw: unknown): Record<string, string> | undefined {
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const out: Record<string, string> = {}
				for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
					if (typeof v === "string") {
						out[k] = v
					}
				}
				return out
			}
		} catch {
			return undefined
		}
		return undefined
	}
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const out: Record<string, string> = {}
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof v === "string") {
				out[k] = v
			}
		}
		return out
	}
	return undefined
}

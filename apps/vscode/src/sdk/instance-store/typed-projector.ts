/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R5
 *
 * Typed projector: replace the OPENAI_ONLY_PROBE with a per-provider
 * projection that handles arbitrary `ProviderConfigurationInstance`
 * records (not just OpenAI-shaped ones).
 *
 * Recon freeze (commit 191dd639b, evidence 06 sections 5-6):
 *
 *   RUNTIME_STRATEGY = B (full session reconstruction on
 *                        instanceId change; updateSessionModel
 *                        fast path preserved for same instance)
 *
 *   R1_FIXTURE_PRIMARY = providerId/modelId identical instances
 *                        A and B with diverging baseUrl,
 *                        credential, headers
 *
 *   R1_IN_FLIGHT_SAFETY = rebuild deferred while isRunning
 *
 * The typed projector is responsible for the "B" step of Strategy B:
 * given an already-resolved `CoreSessionConfig` baseline (A) and a
 * `ProviderConfigurationInstance` (B), produce the projected config
 * whose provider-relevant fields all match B -- including:
 *
 *   - identity:    providerId, modelId
 *   - connection:  apiKey, baseUrl, headers (with EXPLICIT null
 *                  clearing semantics -- null is honored, NOT
 *                  collapsed to "undefined == preserve baseline")
 *   - structured:  region, apiLine, providerSpecificConfig
 *
 * The OPENAI_ONLY_PROBE limitation (see sdk-session-config-builder.ts
 * header for context) is lifted here: the typed projector knows
 * about the provider-specific subset the legacy `ApiConfiguration`
 * could not carry.
 */

import type { CoreSessionConfig } from "@cline/core"
import type { ProviderConfigurationInstance, ProviderConnection } from "./contracts"

/**
 * The shape this projector applies onto the resolved
 * `CoreSessionConfig`. Mirrors the core runtime contract:
 *
 *   - identity: providerId / modelId
 *   - connection: apiKey / baseUrl / headers
 *   - structured: region / apiLine / providerSpecificConfig
 *
 * `null` is the EXPLICIT CLEARING form for any optional field.
 * `undefined` (the field is absent) means "do not touch the baseline".
 * This is the inverse of the legacy `setIfDefined` semantics.
 */
type Settable =
	| "providerId"
	| "modelId"
	| "apiKey"
	| "baseUrl"
	| "headers"
	| "region"
	| "apiLine"

/**
 * Apply the typed provider-instance projection onto an already-
 * resolved `CoreSessionConfig` baseline.
 *
 *   - Honors `null` as the explicit clearing form on every optional
 *     Settable field. This is the R5 RED witness fix: the OPENAI_ONLY_PROBE
 *     collapsed null to "preserve baseline" (silent bleed), which
 *     violated the recon §3 "two same-providerId instances must
 *     not bleed" invariant.
 *   - Honors `undefined` (field absent) as "do not touch the
 *     baseline" -- a partial-instance update path is still supported.
 *   - Honors `connection.providerSpecificConfig` as a typed
 *     per-provider extras bag. The runtime decides how to consume
 *     it; this projector passes it through unchanged.
 */
export function applyTypedProviderInstanceToConfig(
	config: CoreSessionConfig,
	instance: ProviderConfigurationInstance,
): void {
	const cfgAny = config as unknown as Record<string, unknown>
	const conn = instance.connection ?? ({} as ProviderConnection)

	// Identity fields: providerId / modelId. The instance carries
	// a single canonical selection per providerId; the typed
	// projector does NOT carry the legacy act/plan dual-mode
	// discrimination (the OPENAI_ONLY_PROBE kept that for back-compat
	// with ApiConfiguration, but the typed instance has ONE
	// selection -- the session mode is governed by the caller,
	// not by per-instance fields).
	setOrClear(cfgAny, "providerId", instance.providerId)
	setOrClear(cfgAny, "modelId", conn.modelId)

	// Connection fields: the per-provider projection depends on
	// the providerId. The runtime `SdkProviderConfigBuilder`
	// already knows how to consume apiKey/baseUrl/headers/region/
	// apiLine/providerSpecificConfig on `CoreSessionConfig`; this
	// projector just routes the typed connection onto those slots
	// with explicit clearing semantics.
	const isOpenAiCompatible = isOpenAiCompatibleProvider(instance.providerId)

	if (isOpenAiCompatible) {
		setOrClear(cfgAny, "apiKey", conn.apiKeyRef?.name)
		setOrClear(cfgAny, "baseUrl", conn.baseUrl)
		setOrClear(cfgAny, "headers", conn.headers)
	} else {
		// For non-OpenAI providers (anthropic, claudecode, aws*,
		// gcp, oca, sap, ollama, etc.), the apiKey value lives in
		// the per-provider ProviderSettings.apiKey slot, NOT in
		// the legacy openAiApiKey. We surface the resolved key
		// name (under secrets.json) as a hint the runtime can
		// resolve at startup; the actual physical secret is
		// resolved by StateManager.getInstanceSecret at apply
		// time.
		setOrClear(cfgAny, "apiKey", conn.apiKeyRef?.name)
		if (conn.baseUrl !== undefined) {
			setOrClear(cfgAny, "baseUrl", conn.baseUrl)
		}
		if (conn.headers !== undefined) {
			setOrClear(cfgAny, "headers", conn.headers)
		}
	}

	// Structured fields: region, apiLine, providerSpecificConfig.
	// These are provider-shape-specific (AWS region / Qwen
	// apiLine / SAP tenant) so we set them only when explicitly
	// provided; `null` clears.
	setOrClear(cfgAny, "region", conn.region)
	setOrClear(cfgAny, "apiLine", conn.apiLine)
	if (conn.providerSpecificConfig !== undefined) {
		cfgAny["providerSpecificConfig"] = conn.providerSpecificConfig
	}
}

/**
 * Apply a typed value to the config with EXPLICIT CLEARING:
 *   - `null` => set the slot to `null` (clear; do NOT inherit baseline)
 *   - non-nullish => set the slot to the value
 *   - `undefined` => do NOT touch the slot (preserve baseline)
 *
 * This is the R5 discriminator the recon phase froze. The legacy
 * `setIfDefined` collapsed "absent" and "null" into "preserve
 * baseline", which silently leaked A's connection material into B
 * when B's instance had an explicit clearing intent.
 */
function setOrClear(target: Record<string, unknown>, key: string, value: unknown): void {
	if (value === undefined) return
	target[key] = value === null ? null : value
}

/**
 * Whether the providerId is the OpenAI-compatible family. This
 * subset uses `apiKey`/`baseUrl`/`headers` directly on the config;
 * the rest of the providers route through ProviderSettings and
 * their own typed projection tables.
 *
 * The list mirrors the recon §3 "provider-specific field" matrix;
 * a future provider joins by adding to the list AND a typed
 * projection branch (no schema_version bump required for additive
 * changes).
 */
const OPENAI_COMPATIBLE_PROVIDER_IDS = new Set<string>([
	"openai",
	"openai-compatible",
	"openai-native",
	"openai-codex",
	"openrouter",
	"requesty",
	"together",
	"fireworks",
	"deepseek",
	"mistral",
	"vercel-ai-gateway",
	"groq",
	"cerebras",
	"sambanova",
	"nebius",
	"baseten",
	"huggingface",
	"nousresearch",
	"minimax",
	"hicap",
	"ollama",
	"lmstudio",
	"litellm",
	"asksage",
	"dify",
	"aihubmix",
	"oca",
	"wandb",
])

function isOpenAiCompatibleProvider(providerId: string): boolean {
	return OPENAI_COMPATIBLE_PROVIDER_IDS.has(providerId)
}

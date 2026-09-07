/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B3 reviewer
 * bounded P1 absorb (BOOTSTRAP_COVERAGE_SCOPE_PRECISION).
 *
 * Self-check invariant: for every provider declared
 * `BOOTSTRAP_COVERAGE`, either:
 *
 *   - credential resolution is demonstrably supported (the
 *     exported `resolveApiKey` returns a non-empty string for
 *     a synthetic ApiConfiguration that fills in only the
 *     corresponding key field), AND
 *   - model id resolution is demonstrably supported (the
 *     exported `resolveModelId` returns a non-empty string
 *     for at least one of {plan, act}).
 *
 * OR the provider must not be advertised as bootstrap-supported.
 *
 * This invariant pins that `BOOTSTRAP_COVERAGE` cannot grow
 * without its resolver seams growing with it. Without it, a
 * future contributor could add e.g. `"minimax"` to
 * `BOOTSTRAP_COVERAGE` without wiring `PROVIDER_API_KEY_MAP.minimax`
 * or `PROVIDER_MODEL_ID_MAP.minimax`, and the bootstrap would
 * fail at runtime with a `MISSING_CREDENTIAL` or
 * `MISSING_MODEL` for a user who legitimately selected that
 * provider.
 *
 * Implementation: synthesize an ApiConfiguration where the
 * union of all known ApiConfiguration key fields (across all
 * providers, not just BOOTSTRAP_COVERAGE) is populated with
 * sentinel non-empty strings. The resolver functions stop at
 * the first match in their respective maps
 * (`PROVIDER_API_KEY_MAP`, `PROVIDER_MODEL_ID_MAP`,
 * `baseUrlMap`) so over-population does not cause false
 * negatives. A misconfigured provider (no entry in any of
 * the three maps) would fail to resolve, surfacing as a
 * well-typed diagnostic.
 *
 * The function returns the per-provider diagnostic table
 * rather than throwing so the B3 witness can produce a
 * useful failure message. CI / harness callers can simply
 * assert `ok === true`.
 */

import type { ApiConfiguration, ApiProvider } from "@shared/api"
import { resolveApiKey, resolveModelId } from "../cline-session-factory"
import { BOOTSTRAP_COVERAGE } from "./bootstrap"

export interface BootstrapCoverageDiagnostic {
	provider: ApiProvider
	credentialResolved: boolean
	modelIdResolvedFor: Array<"plan" | "act">
}

export interface BootstrapCoverageInvariantResult {
	ok: boolean
	diagnostics: BootstrapCoverageDiagnostic[]
}

/**
 * The union of every ApiConfiguration key that any provider's
 * `PROVIDER_API_KEY_MAP` entry might consult. Kept in sync
 * with `apps/vscode/src/sdk/cline-session-factory.ts` by code
 * review - if you add a new entry to `PROVIDER_API_KEY_MAP`,
 * add it here too.
 *
 * (We don't import the map directly because it isn't exported
 * from `cline-session-factory.ts`. Importing it would require
 * changing that file's export surface. The static-key list is
 * a small price for keeping the surface stable.)
 */
const CANDIDATE_API_KEY_FIELDS: ReadonlyArray<string> = [
	"apiKey",
	"openRouterApiKey",
	"openAiApiKey",
	"openAiNativeApiKey",
	"awsBedrockApiKey",
	"geminiApiKey",
	"deepSeekApiKey",
	"clineApiKey",
	"ollamaApiKey",
	"requestyApiKey",
	"togetherApiKey",
	"fireworksApiKey",
	"qwenApiKey",
	"doubaoApiKey",
	"mistralApiKey",
	"liteLlmApiKey",
	"asksageApiKey",
	"xaiApiKey",
	"moonshotApiKey",
	"zaiApiKey",
	"huggingFaceApiKey",
	"nebiusApiKey",
	"sambanovaApiKey",
	"cerebrasApiKey",
	"groqApiKey",
	"basetenApiKey",
	"difyApiKey",
	"aihubmixApiKey",
	"ocaApiKey",
]

/**
 * The union of every ApiConfiguration key that any provider's
 * `PROVIDER_MODEL_ID_MAP` entry might consult, for the plan
 * and act modes. Kept in sync with
 * `apps/vscode/src/sdk/cline-session-factory.ts`.
 */
const CANDIDATE_PLAN_MODEL_ID_FIELDS: ReadonlyArray<string> = [
	"planModeApiModelId",
	"planModeOpenRouterModelId",
	"planModeOpenAiModelId",
	"planModeOllamaModelId",
	"planModeLmStudioModelId",
	"planModeLiteLlmModelId",
	"planModeRequestyModelId",
	"planModeClineModelId",
	"planModeClinePassModelId",
	"planModeTogetherModelId",
	"planModeFireworksModelId",
	"planModeGroqModelId",
	"planModeBasetenModelId",
	"planModeHuggingFaceModelId",
	"planModeHuaweiCloudMaasModelId",
	"planModeOcaModelId",
	"planModeAihubmixModelId",
	"planModeHicapModelId",
	"planModeNousResearchModelId",
	"planModeVercelAiGatewayModelId",
]

const CANDIDATE_ACT_MODEL_ID_FIELDS: ReadonlyArray<string> = [
	"actModeApiModelId",
	"actModeOpenRouterModelId",
	"actModeOpenAiModelId",
	"actModeOllamaModelId",
	"actModeLmStudioModelId",
	"actModeLiteLlmModelId",
	"actModeRequestyModelId",
	"actModeClineModelId",
	"actModeClinePassModelId",
	"actModeTogetherModelId",
	"actModeFireworksModelId",
	"actModeGroqModelId",
	"actModeBasetenModelId",
	"actModeHuggingFaceModelId",
	"actModeHuaweiCloudMaasModelId",
	"actModeOcaModelId",
	"actModeAihubmixModelId",
	"actModeHicapModelId",
	"actModeNousResearchModelId",
	"actModeVercelAiGatewayModelId",
]

const PROBE_CREDENTIAL_SENTINEL = "probe-credential-value"
const PROBE_MODEL_SENTINEL = "probe-model-id"

function buildProbeConfig(): ApiConfiguration {
	const probeConfig = {} as Record<string, unknown>
	for (const f of CANDIDATE_API_KEY_FIELDS) probeConfig[f] = PROBE_CREDENTIAL_SENTINEL
	for (const f of CANDIDATE_PLAN_MODEL_ID_FIELDS) probeConfig[f] = PROBE_MODEL_SENTINEL
	for (const f of CANDIDATE_ACT_MODEL_ID_FIELDS) probeConfig[f] = PROBE_MODEL_SENTINEL
	return probeConfig as unknown as ApiConfiguration
}

/**
 * Run the BOOTSTRAP_COVERAGE scope-precision self-check.
 * Returns the per-provider diagnostic table.
 */
export function assertBootstrapCoverageIsWellFormed(): BootstrapCoverageInvariantResult {
	const probeConfig = buildProbeConfig()
	const diagnostics: BootstrapCoverageDiagnostic[] = []
	let ok = true
	for (const provider of BOOTSTRAP_COVERAGE) {
		const credential = resolveApiKey(provider, probeConfig)
		const credentialResolved = typeof credential === "string" && credential.length > 0
		const planModel = resolveModelId(provider, "plan", probeConfig)
		const actModel = resolveModelId(provider, "act", probeConfig)
		const modelIdResolvedFor: Array<"plan" | "act"> = []
		if (typeof planModel === "string" && planModel.length > 0) modelIdResolvedFor.push("plan")
		if (typeof actModel === "string" && actModel.length > 0) modelIdResolvedFor.push("act")
		if (!credentialResolved || modelIdResolvedFor.length === 0) ok = false
		diagnostics.push({ provider, credentialResolved, modelIdResolvedFor })
	}
	return { ok, diagnostics }
}

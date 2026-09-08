/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B3 reviewer
 * bounded P1 absorb (BOOTSTRAP_COVERAGE_SCOPE_PRECISION).
 *
 * Self-check invariant: for every provider declared
 * `BOOTSTRAP_COVERAGE`, either:
 *
 *   - credential resolution is demonstrably supported: the
 *     exported `resolveApiKey` returns a non-empty string for
 *     a synthetic ApiConfiguration populated ONLY with that
 *     provider's intended credential field
 *     (`PROVIDER_API_KEY_MAP[provider]`), AND
 *   - model id resolution is demonstrably supported: the
 *     exported `resolveModelId` returns a non-empty string
 *     for at least one of {plan, act} when the synthetic
 *     ApiConfiguration is populated ONLY with that provider's
 *     intended model field
 *     (`PROVIDER_MODEL_ID_MAP[provider]`).
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
 * Why "isolated probe" instead of "maximally populated probe":
 *   The previous implementation populated every known
 *   credential field with the same sentinel. That made a
 *   generic fallback (e.g. `resolveApiKey` returning
 *   `config.apiKey` for any provider) produce false GREENs
 *   for under-wired providers. The reviewer is right that
 *   the invariant is stronger if the probe contains ONLY the
 *   intended field — then the resolver must actually consult
 *   the per-provider wiring.
 *
 * The function returns the per-provider diagnostic table
 * rather than throwing so the B3 witness can produce a
 * useful failure message. CI / harness callers can simply
 * assert `ok === true`.
 */

import type { ApiConfiguration, ApiProvider } from "@shared/api"
import {
	PROVIDER_API_KEY_MAP,
	PROVIDER_MODEL_ID_MAP,
	resolveApiKey,
	resolveApiLine,
	resolveModelId,
} from "../cline-session-factory"
import { BOOTSTRAP_COVERAGE } from "./bootstrap"

export interface BootstrapCoverageDiagnostic {
	provider: ApiProvider
	/** True iff the provider has an entry in `PROVIDER_API_KEY_MAP`. */
	hasIntendedCredentialField: boolean
	/** True iff `resolveApiKey` returned the sentinel for the isolated probe. */
	credentialResolved: boolean
	/** True iff the provider has an entry in `PROVIDER_MODEL_ID_MAP`. */
	hasIntendedModelField: boolean
	/** Which of plan/act resolved the sentinel for the isolated probe. */
	modelIdResolvedFor: Array<"plan" | "act">
	/**
	 * CORRECTION09 (HALT_MINIMAX_APILINE_NOT_CAPTURED):
	 * For providers whose `resolveApiLine` returns a non-empty string
	 * on the isolated probe (qwen, moonshot, zai, minimax), the
	 * bootstrap MUST capture that line onto `connection.apiLine`.
	 * Without this invariant, a future contributor could add a new
	 * provider to `BOOTSTRAP_COVERAGE` that has an apiLine field
	 * but the bootstrap would silently lose it -- re-introducing
	 * the ambient-collapse authority the Foundation eliminated.
	 *
	 * Providers without an apiLine field (anthropic, ollama, ...)
	 * have `apiLineRequired === false` and the bootstrap captures
	 * `connection.apiLine = undefined`. This is by design: the
	 * V1 contract tolerates "absent" fields as "preserve-default"
	 * at the typed-projector boundary.
	 */
	apiLineRequired: boolean
	apiLineResolved: boolean
}

export interface BootstrapCoverageInvariantResult {
	ok: boolean
	diagnostics: BootstrapCoverageDiagnostic[]
}

const PROBE_CREDENTIAL_SENTINEL = "probe-credential-value"
const PROBE_MODEL_SENTINEL = "probe-model-id"
const PROBE_APILINE_SENTINEL = "international"

/**
 * Per-provider `<provider>ApiLine` legacy-config field mapping.
 * The full mapping (with the providers.json fallback) lives at
 * `cline-session-factory.ts:810` inside `resolveApiLine`. Here we
 * pin the LEGACY-field name so the isolated probe can pre-set the
 * sentinel without depending on the SDK's ProviderSettingsManager
 * (which may not be initialized in the bun test runtime).
 *
 * Adding a new provider with an apiLine field to
 * `BOOTSTRAP_COVERAGE` requires an entry here AND a wired
 * `resolveApiLine` branch -- the probe enforces both.
 */
const PROVIDER_APILINE_FIELD: Record<string, keyof ApiConfiguration> = {
	qwen: "qwenApiLine",
	moonshot: "moonshotApiLine",
	zai: "zaiApiLine",
	minimax: "minimaxApiLine",
}

/**
 * Build an isolated ApiConfiguration containing ONLY the
 * intended credential field + intended plan/act model
 * fields + (if applicable) the intended apiLine field for
 * the given provider, each populated with the corresponding
 * sentinel. Everything else is absent.
 *
 * This is the structural load-bearing piece of the
 * invariant: if the resolver is wired generically (e.g. it
 * returns `config.apiKey` for every provider), then for a
 * provider whose intended credential field is e.g.
 * `qwenApiKey`, the isolated probe will NOT have `apiKey`
 * set, the resolver will return undefined, and the invariant
 * will correctly report the provider as under-wired.
 *
 * For the apiLine probe (CORRECTION09): the probe sets the
 * per-provider `<provider>ApiLine` field (e.g. `qwenApiLine`,
 * `minimaxApiLine`) to the sentinel whenever the provider has
 * an entry in `PROVIDER_APILINE_FIELD`. That way:
 *   - providers with an apiLine field (qwen/moonshot/zai/minimax):
 *     apiLine probe sentinel set; resolveApiLine must return
 *     the sentinel; otherwise ok=false.
 *   - providers without an apiLine field (anthropic/ollama/...):
 *     apiLine probe sentinel NOT set; resolveApiLine returns
 *     undefined; apiLineRequired=false; no contribution to ok.
 */
function buildIsolatedProbe(provider: ApiProvider): ApiConfiguration {
	const probeConfig = {} as Record<string, unknown>
	const credentialField = PROVIDER_API_KEY_MAP[provider]
	if (credentialField) probeConfig[credentialField] = PROBE_CREDENTIAL_SENTINEL
	const modelFields = PROVIDER_MODEL_ID_MAP[provider]
	if (modelFields) {
		probeConfig[modelFields.plan] = PROBE_MODEL_SENTINEL
		probeConfig[modelFields.act] = PROBE_MODEL_SENTINEL
	}
	// CORRECTION09: probe the apiLine path so that adding a
	// provider with an apiLine field to BOOTSTRAP_COVERAGE
	// requires the resolver seam to be wired. The mapping
	// is owned by PROVIDER_APILINE_FIELD (above) so the
	// probe is decoupled from the SDK's ProviderSettingsManager
	// initialization state -- the bun test runtime may not
	// have an active providers.json, but the legacy-config
	// field name is what `captureConnection` reads from.
	const apiLineField = PROVIDER_APILINE_FIELD[provider]
	if (apiLineField) probeConfig[apiLineField] = PROBE_APILINE_SENTINEL
	return probeConfig as unknown as ApiConfiguration
}

/**
 * Run the BOOTSTRAP_COVERAGE scope-precision self-check.
 * Returns the per-provider diagnostic table.
 */
export function assertBootstrapCoverageIsWellFormed(): BootstrapCoverageInvariantResult {
	const diagnostics: BootstrapCoverageDiagnostic[] = []
	let ok = true
	for (const provider of BOOTSTRAP_COVERAGE) {
		const credentialField = PROVIDER_API_KEY_MAP[provider]
		const modelFields = PROVIDER_MODEL_ID_MAP[provider]
		const probeConfig = buildIsolatedProbe(provider)

		const credential = resolveApiKey(provider, probeConfig)
		const credentialResolved = typeof credential === "string" && credential.length > 0

		const planModel = resolveModelId(provider, "plan", probeConfig)
		const actModel = resolveModelId(provider, "act", probeConfig)
		const modelIdResolvedFor: Array<"plan" | "act"> = []
		if (typeof planModel === "string" && planModel.length > 0) modelIdResolvedFor.push("plan")
		if (typeof actModel === "string" && actModel.length > 0) modelIdResolvedFor.push("act")

		// CORRECTION09 (apiLine probe): the probe sets the
		// apiLine field on the synthetic config; resolveApiLine
		// must return the EXACT PROBE_APILINE_SENTINEL for the
		// invariant to be ok. CRITICAL: apiLineRequired must
		// come from PROVIDER_APILINE_FIELD (the authority that
		// declares "this provider OWNS an apiLine legacy field"),
		// NOT from whether resolveApiLine happened to return a
		// non-empty string. The previous implementation
		// (`apiLineRequired = apiLineResolved`) made the guard
		// tautological: a regression that returned undefined for
		// minimax would set apiLineRequired=false and still
		// pass. Reviewer-flagged P1 BOOTSTRAP_APILINE_COVERAGE_INVARIANT_TAUTOLOGICAL.
		const apiLine = resolveApiLine(provider, probeConfig)
		const apiLineRequired = Boolean(PROVIDER_APILINE_FIELD[provider])
		const apiLineResolved = apiLine === PROBE_APILINE_SENTINEL

		const hasIntendedCredentialField = Boolean(credentialField)
		const hasIntendedModelField = Boolean(modelFields)
		if (
			!hasIntendedCredentialField ||
			!hasIntendedModelField ||
			!credentialResolved ||
			modelIdResolvedFor.length === 0 ||
			(apiLineRequired && !apiLineResolved)
		) {
			ok = false
		}
		diagnostics.push({
			provider,
			hasIntendedCredentialField,
			credentialResolved,
			hasIntendedModelField,
			modelIdResolvedFor,
			apiLineRequired,
			apiLineResolved,
		})
	}
	return { ok, diagnostics }
}

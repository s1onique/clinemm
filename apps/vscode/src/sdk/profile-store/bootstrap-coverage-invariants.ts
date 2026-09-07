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
import { PROVIDER_API_KEY_MAP, PROVIDER_MODEL_ID_MAP, resolveApiKey, resolveModelId } from "../cline-session-factory"
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
}

export interface BootstrapCoverageInvariantResult {
	ok: boolean
	diagnostics: BootstrapCoverageDiagnostic[]
}

const PROBE_CREDENTIAL_SENTINEL = "probe-credential-value"
const PROBE_MODEL_SENTINEL = "probe-model-id"

/**
 * Build an isolated ApiConfiguration containing ONLY the
 * intended credential field + intended plan/act model
 * fields for the given provider, each populated with the
 * corresponding sentinel. Everything else is absent.
 *
 * This is the structural load-bearing piece of the
 * invariant: if the resolver is wired generically (e.g. it
 * returns `config.apiKey` for every provider), then for a
 * provider whose intended credential field is e.g.
 * `qwenApiKey`, the isolated probe will NOT have `apiKey`
 * set, the resolver will return undefined, and the invariant
 * will correctly report the provider as under-wired.
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

		const hasIntendedCredentialField = Boolean(credentialField)
		const hasIntendedModelField = Boolean(modelFields)
		if (!hasIntendedCredentialField || !hasIntendedModelField || !credentialResolved || modelIdResolvedFor.length === 0) {
			ok = false
		}
		diagnostics.push({
			provider,
			hasIntendedCredentialField,
			credentialResolved,
			hasIntendedModelField,
			modelIdResolvedFor,
		})
	}
	return { ok, diagnostics }
}

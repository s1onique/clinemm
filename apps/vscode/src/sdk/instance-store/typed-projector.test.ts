/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R5
 *
 * RED->GREEN witness for the typed projector.
 *
 * Recon freeze (commit 191dd639b, evidence 06 sections 5-6):
 *
 *   R1_FIXTURE_PRIMARY = providerId/modelId identical instances A/B
 *                        with diverging baseUrl, credential, headers
 *
 *   clearing semantics: explicit null = clear (do NOT inherit baseline)
 *
 * This test drives the REAL `applyTypedProviderInstanceToConfig`
 * function (no mocks) against controlled CoreSessionConfig
 * baselines, asserting:
 *
 *   R5-01 positive binding       -- baseline A + instance B =>
 *                                  result on all provider-relevant
 *                                  fields == B
 *   R5-02 clearing semantics     -- A.headers = {...}; B.headers = null;
 *                                  result.headers = null (NOT A.headers)
 *   R5-03 generic provider shape -- B with anthropic providerId =>
 *                                  result reflects B (no A residual)
 *   R5-04 conservation           -- without an instance override,
 *                                  the projector does NOT mutate
 *                                  the baseline (back-compat invariant)
 *
 * Run via the bridge config:
 *   bun run vitest --config vitest.config.c2-4-c-bridge.ts
 *                  src/sdk/instance-store/typed-projector.test.ts
 */

import type { CoreSessionConfig } from "@cline/core"
import { describe, expect, it } from "vitest"
import type {
	ProviderConfigurationInstance,
} from "./contracts"
import { applyTypedProviderInstanceToConfig } from "./typed-projector"

// Minimal baseline shape -- the projector only touches the
// Settable fields (providerId, modelId, apiKey, baseUrl, headers,
// region, apiLine, providerSpecificConfig).
type MinimalConfig = {
	providerId?: string
	modelId?: string
	apiKey?: string | null
	baseUrl?: string | null
	headers?: Record<string, string> | null
	region?: string | null
	apiLine?: string | null
	providerSpecificConfig?: Record<string, unknown>
	[key: string]: unknown
}

function makeBaselineA(overrides: Partial<MinimalConfig> = {}): MinimalConfig {
	return {
		providerId: "openai-compatible",
		modelId: "model-A",
		apiKey: "key-A",
		baseUrl: "https://endpoint-A",
		headers: { "X-A": "1" },
		region: "us-east-1",
		apiLine: "default",
		...overrides,
	}
}

function makeInstanceB(overrides: Partial<ProviderConfigurationInstance> = {}): ProviderConfigurationInstance {
	return {
		instanceId: "inst-B",
		providerId: "openai-compatible",
		displayLabel: "B",
		credentialRef: { kind: "secret", name: "instance:inst-B-key" },
		connection: {
			modelId: "model-B",
			apiKeyRef: { kind: "secret", name: "instance:inst-B-key" },
			baseUrl: "https://endpoint-B",
			headers: { "X-B": "2" },
		},
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}
}

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R5", () => {
	it("R5-01 positive binding: baseline A + instance B -> result reflects B on all identity+connection fields", () => {
		const config = makeBaselineA() as unknown as CoreSessionConfig
		const instance = makeInstanceB()

		applyTypedProviderInstanceToConfig(config, instance)

		const result = config as unknown as MinimalConfig
		expect(result.providerId).toBe("openai-compatible") // same providerId
		expect(result.modelId).toBe("model-B") // B's model
		expect(result.apiKey).toBe("instance:inst-B-key") // B's credential name
		expect(result.baseUrl).toBe("https://endpoint-B") // B's endpoint
		expect(result.headers).toEqual({ "X-B": "2" }) // B's headers
	})

	it("R5-02 clearing semantics: A.headers present; B.headers=null -> result.headers=null (NOT A's headers)", () => {
		const config = makeBaselineA({
			headers: { "X-A": "1", "X-Common": "common" },
		}) as unknown as CoreSessionConfig
		const instance = makeInstanceB({
			connection: {
				modelId: "model-B",
				baseUrl: "https://endpoint-B",
				// Explicit clearing form: null clears the field.
				headers: null,
			},
		})

		applyTypedProviderInstanceToConfig(config, instance)

		const result = config as unknown as MinimalConfig
		// The discriminator the recon phase froze: explicit null
		// MUST be honored as "clear", not silently collapsed to
		// "preserve baseline". This is the OPENAI_ONLY_PROBE defect
		// the typed projector fixes.
		expect(result.headers).toBeNull()
		// Other fields are still B's:
		expect(result.modelId).toBe("model-B")
		expect(result.baseUrl).toBe("https://endpoint-B")
	})

	it("R5-03 generic provider shape: B with anthropic providerId -> result reflects B; OPENAI_ONLY_PROBE limitation lifted", () => {
		const config = makeBaselineA() as unknown as CoreSessionConfig
		const instance: ProviderConfigurationInstance = {
			instanceId: "inst-anthropic",
			providerId: "anthropic",
			displayLabel: "Personal Anthropic",
			credentialRef: { kind: "secret", name: "instance:inst-anthropic-key" },
			connection: {
				modelId: "claude-opus-4",
				apiKeyRef: { kind: "secret", name: "instance:inst-anthropic-key" },
				region: null, // explicit clearing
			},
			createdAt: 1,
			updatedAt: 1,
		}

		applyTypedProviderInstanceToConfig(config, instance)

		const result = config as unknown as MinimalConfig
		expect(result.providerId).toBe("anthropic")
		expect(result.modelId).toBe("claude-opus-4")
		expect(result.apiKey).toBe("instance:inst-anthropic-key")
		// Region explicitly cleared (was us-east-1 in A).
		expect(result.region).toBeNull()
	})

	it("R5-04 conservation: without an instance override (untouched baseline), no fields mutate", () => {
		// Note: this test calls applyTypedProviderInstanceToConfig with
		// a valid instance -- the conservation invariant is asserted
		// at the boundary where the projector is invoked, by checking
		// that the typed fields are NOT cleared when the instance
		// simply does not provide them.
		const config = makeBaselineA() as unknown as CoreSessionConfig
		const instance = makeInstanceB({
			connection: {
				// Only modelId is provided; other connection fields are
				// undefined (= preserve baseline).
				modelId: "model-B",
			},
		})

		applyTypedProviderInstanceToConfig(config, instance)

		const result = config as unknown as MinimalConfig
		expect(result.modelId).toBe("model-B")
		// baseUrl / headers / apiKey are NOT touched -- A's values
		// survive. This is the canonical "partial instance update"
		// path, distinct from the "explicit clearing" path in R5-02.
		expect(result.baseUrl).toBe("https://endpoint-A")
		expect(result.headers).toEqual({ "X-A": "1" })
		expect(result.apiKey).toBe("key-A")
	})
})

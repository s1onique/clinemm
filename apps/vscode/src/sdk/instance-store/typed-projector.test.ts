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
 *   R5-01 positive binding         -- baseline A + instance B =>
 *                                    result on all provider-relevant
 *                                    fields == B
 *   R5-02 clearing semantics       -- A.headers = {...}; B.headers = null;
 *                                    result.headers = null (NOT A.headers)
 *   R5-03 generic provider shape   -- B with anthropic providerId =>
 *                                    result reflects B (no A residual)
 *   R5-04 conservation             -- partial instance update
 *                                    preserves A's absent fields
 *   R5-05 credential inversion     -- apiKey must equal the
 *                                    RESOLVED secret value, not the
 *                                    reference name. Twelfth reviewer
 *                                    HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED
 *                                    witness.
 *   R5-06 no-credential clearing   -- resolvedApiKey=undefined must
 *                                    write `null` to apiKey (explicit
 *                                    clear), not "" and not the
 *                                    reference name.
 *
 * Run via the bridge config:
 *   bun run vitest --config vitest.config.c2-4-c-bridge.ts
 *                  src/sdk/instance-store/typed-projector.test.ts
 */
import type { CoreSessionConfig } from "@cline/core"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import { describe, expect, it } from "vitest"
import type { ProviderConfigurationInstance } from "./contracts"
import { applyTypedProviderInstanceToConfig } from "./typed-projector"

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
		apiKey: "secret-A-value",
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
		credentialRef: { kind: "secret", name: "instance:inst-B-key" as InstanceSecretName },
		connection: {
			modelId: "model-B",
			baseUrl: "https://endpoint-B",
			headers: { "X-B": "2" },
		},
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}
}

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R5", () => {
	it("R5-01 positive binding: A + B + resolvedApiKey=secret-B -> result reflects B (apiKey is RESOLVED, NOT the reference name)", () => {
		const config = makeBaselineA() as unknown as CoreSessionConfig
		const instance = makeInstanceB()
		applyTypedProviderInstanceToConfig(config, instance, "secret-B-value")
		const result = config as unknown as MinimalConfig
		expect(result.providerId).toBe("openai-compatible")
		expect(result.modelId).toBe("model-B")
		// TWELFTH REVIEWER FIX: apiKey is the RESOLVED secret value,
		// not the credential reference name.
		expect(result.apiKey).toBe("secret-B-value")
		expect(result.apiKey).not.toBe("instance:inst-B-key")
		expect(result.baseUrl).toBe("https://endpoint-B")
		expect(result.headers).toEqual({ "X-B": "2" })
	})

	it("R5-02 clearing semantics: A.headers present; B.headers=null -> result.headers=null (NOT A's headers)", () => {
		const config = makeBaselineA({
			headers: { "X-A": "1", "X-Common": "common" },
		}) as unknown as CoreSessionConfig
		const instance = makeInstanceB({
			connection: {
				modelId: "model-B",
				baseUrl: "https://endpoint-B",
				headers: null,
			},
		})
		applyTypedProviderInstanceToConfig(config, instance, "secret-B-value")
		const result = config as unknown as MinimalConfig
		expect(result.headers).toBeNull()
		expect(result.modelId).toBe("model-B")
		expect(result.baseUrl).toBe("https://endpoint-B")
	})

	it("R5-03 generic provider shape: B with anthropic providerId -> result reflects B; OPENAI_ONLY_PROBE limitation lifted", () => {
		const config = makeBaselineA() as unknown as CoreSessionConfig
		const instance: ProviderConfigurationInstance = {
			instanceId: "inst-anthropic",
			providerId: "anthropic",
			displayLabel: "Personal Anthropic",
			credentialRef: { kind: "secret", name: "instance:inst-anthropic-key" as InstanceSecretName },
			connection: {
				modelId: "claude-opus-4",
				region: null,
			},
			createdAt: 1,
			updatedAt: 1,
		}
		applyTypedProviderInstanceToConfig(config, instance, "sk-ant-resolved-physical-secret")
		const result = config as unknown as MinimalConfig
		expect(result.providerId).toBe("anthropic")
		expect(result.modelId).toBe("claude-opus-4")
		expect(result.apiKey).toBe("sk-ant-resolved-physical-secret")
		expect(result.apiKey).not.toBe("instance:inst-anthropic-key")
		expect(result.region).toBeNull()
	})

	it("R5-04 conservation: partial instance update preserves A's absent fields", () => {
		const config = makeBaselineA() as unknown as CoreSessionConfig
		const instance = makeInstanceB({
			connection: {
				modelId: "model-B",
			},
		})
		applyTypedProviderInstanceToConfig(config, instance, undefined)
		const result = config as unknown as MinimalConfig
		expect(result.modelId).toBe("model-B")
		// baseUrl / headers NOT touched -- A's values survive.
		expect(result.baseUrl).toBe("https://endpoint-A")
		expect(result.headers).toEqual({ "X-A": "1" })
		// apiKey is set to null because resolvedApiKey was undefined.
		// This is NOT a "preserve baseline" leak.
		expect(result.apiKey).toBeNull()
		expect(result.apiKey).not.toBe("secret-A-value")
	})

	it("R5-05 credential inversion: cfg.apiKey MUST equal resolved secret, NEVER the reference name", () => {
		const config = makeBaselineA({ apiKey: "secret-A-value" }) as unknown as CoreSessionConfig
		const instance = makeInstanceB()
		expect(instance.credentialRef.name).toBe("instance:inst-B-key")
		applyTypedProviderInstanceToConfig(config, instance, "secret-B-value")
		const result = config as unknown as MinimalConfig
		expect(result.apiKey).toBe("secret-B-value")
		expect(result.apiKey).not.toBe("instance:inst-B-key")
		expect(result.apiKey).not.toBe("secret-A-value")
		expect(result.apiKey?.startsWith("instance:")).toBe(false)
	})

	it("R5-06 no-credential clearing: resolvedApiKey=undefined writes null (NOT empty string, NOT reference name)", () => {
		const config = makeBaselineA({ apiKey: "secret-A-value" }) as unknown as CoreSessionConfig
		const instance = makeInstanceB()
		applyTypedProviderInstanceToConfig(config, instance, undefined)
		const result = config as unknown as MinimalConfig
		expect(result.apiKey).toBeNull()
		expect(result.apiKey).not.toBe("")
		expect(result.apiKey).not.toBe("instance:inst-B-key")
		expect(result.apiKey).not.toBe("secret-A-value")
	})
})

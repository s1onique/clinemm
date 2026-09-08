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
 *   R5-06 missing-secret fails closed -- resolvedApiKey=undefined
 *                                    must THROW
 *                                    MissingProviderInstanceCredentialError
 *                                    (NOT silently write null to apiKey).
 *                                    Thirteenth reviewer
 *                                    HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN
 *                                    witness.
 *   R5-07 empty-string secret fails closed -- resolvedApiKey=""
 *                                    throws (treated as missing;
 *                                    same error class as undefined).
 *   R5-08 legacy-alias normalization -- instance.providerId="openai"
 *                                    (legacy extension spelling) is
 *                                    normalized to the SDK canonical
 *                                    "openai-compatible" before being
 *                                    written to CoreSessionConfig.providerId.
 *                                    Mirrors the legacy non-profile
 *                                    path at cline-session-factory.ts:1053
 *                                    (toSdkProviderId). Live first-run
 *                                    dogfood (post-CORRECTION06) failed
 *                                    with "Unknown or disabled provider
 *                                    'openai'" because the bootstrap
 *                                    captured the legacy spelling verbatim
 *                                    and the typed projector passed it
 *                                    through unchanged.
 *   R5-09 canonical idempotence    -- instance.providerId="openai-compatible"
 *                                    (already canonical) is unchanged
 *                                    on output. toSdkProviderId is
 *                                    idempotent on canonical ids, so
 *                                    existing canonical writers pass
 *                                    through unchanged.
 *   R5-10 legacy nousResearch     -- instance.providerId="nousresearch"
 *                                    is normalized to "nousResearch"
 *                                    (the SDK canonical). The other
 *                                    alias in the EXTENSION_TO_SDK_PROVIDER_ID
 *                                    table.
 *
 * Run via the bridge config:
 *   bun run vitest --config vitest.config.c2-4-c-bridge.ts
 *                  src/sdk/instance-store/typed-projector.test.ts
 */
import type { CoreSessionConfig } from "@cline/core"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import { describe, expect, it } from "vitest"
import { MissingProviderInstanceCredentialError, type ProviderConfigurationInstance } from "./contracts"
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

	it("R5-04 conservation: partial instance update preserves A's absent fields, but missing credential fails closed", () => {
		const config = makeBaselineA() as unknown as CoreSessionConfig
		const instance = makeInstanceB({
			connection: {
				modelId: "model-B",
			},
		})
		// Per thirteenth reviewer HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN:
		// the runtime guard rejects undefined / empty / null BEFORE
		// any projection happens. baseUrl / headers / apiKey are
		// left untouched because the call THROWS, not because
		// "undefined == preserve baseline" (that was the wrong
		// invariant the previous R5-06 test pinned).
		expect(() => applyTypedProviderInstanceToConfig(config, instance, undefined as unknown as string)).toThrow(
			MissingProviderInstanceCredentialError,
		)
		const result = config as unknown as MinimalConfig
		// baseUrl / headers / apiKey NOT touched -- the call threw
		// before reaching setOrClear.
		expect(result.baseUrl).toBe("https://endpoint-A")
		expect(result.headers).toEqual({ "X-A": "1" })
		expect(result.apiKey).toBe("secret-A-value")
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

	it("R5-06 missing-secret fails closed: resolvedApiKey=undefined THROWS MissingProviderInstanceCredentialError (NOT silently apiKey=null)", () => {
		const config = makeBaselineA({ apiKey: "secret-A-value" }) as unknown as CoreSessionConfig
		const instance = makeInstanceB()
		// The previous version of this test froze the WRONG invariant
		// (resolvedApiKey=undefined => apiKey=null, reconstruction
		// proceeds). The thirteenth reviewer's
		// HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN closed that
		// invariant: because credentialRef is MANDATORY for every
		// typed ProviderConfigurationInstance, a missing physical
		// secret means the durable instance is broken. Reconstruction
		// MUST NOT silently proceed with apiKey=null.
		expect(() => applyTypedProviderInstanceToConfig(config, instance, undefined as unknown as string)).toThrow(
			MissingProviderInstanceCredentialError,
		)
		const result = config as unknown as MinimalConfig
		// The throw happens before any setOrClear, so apiKey /
		// baseUrl / headers are LEFT UNTOUCHED -- not nulled out,
		// not cleared. (The reconstruction that called us aborts
		// via the rejected Promise; the active session remains
		// unchanged.)
		expect(result.apiKey).toBe("secret-A-value")
		expect(result.apiKey).not.toBeNull()
		expect(result.apiKey).not.toBe("")
		expect(result.apiKey).not.toBe("instance:inst-B-key")
	})

	it("R5-07 empty-string secret fails closed: resolvedApiKey='' is treated as missing", () => {
		// An empty string is not a valid credential -- refuse to
		// project it onto the apiKey slot. Same error class as
		// undefined; same fail-closed semantics.
		const config = makeBaselineA({ apiKey: "secret-A-value" }) as unknown as CoreSessionConfig
		const instance = makeInstanceB()
		expect(() => applyTypedProviderInstanceToConfig(config, instance, "")).toThrow(
			MissingProviderInstanceCredentialError,
		)
	})

	// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION07
	// (HALT_MODEL_PROFILE_PROVIDER_ID_NOT_CANONICAL):
	//
	// The bootstrap captures `config.actModeApiProvider` (legacy
	// spelling "openai") into `instance.providerId` verbatim. The
	// SDK registry only knows the canonical "openai-compatible".
	// Without normalization at the projector boundary, the legacy
	// spelling escapes to the SDK gateway which rejects the request
	// with "Unknown or disabled provider 'openai'". This is the
	// exact error observed live after CORRECTION06.
	it("R5-08 legacy-alias normalization: instance.providerId='openai' (legacy extension spelling) is normalized to 'openai-compatible' on cfg.providerId", () => {
		const config = makeBaselineA({ providerId: undefined }) as unknown as CoreSessionConfig
		const instance = makeInstanceB({
			providerId: "openai", // legacy extension spelling (the bootstrap's raw capture)
		})
		applyTypedProviderInstanceToConfig(config, instance, "secret-B-value")
		const result = config as unknown as MinimalConfig
		// CRITICAL: the runtime cfg.providerId MUST be the SDK canonical.
		// Without normalization this is "openai" and the gateway fails
		// with "Unknown or disabled provider 'openai'".
		expect(result.providerId).toBe("openai-compatible")
		// RED guard: explicit anti-regression that the legacy spelling
		// does NOT survive into the runtime config.
		expect(result.providerId).not.toBe("openai")
	})

	it("R5-09 canonical idempotence: instance.providerId='openai-compatible' (already canonical) is unchanged on cfg.providerId", () => {
		const config = makeBaselineA({ providerId: undefined }) as unknown as CoreSessionConfig
		const instance = makeInstanceB({
			providerId: "openai-compatible", // already canonical (test fixture default)
		})
		applyTypedProviderInstanceToConfig(config, instance, "secret-B-value")
		const result = config as unknown as MinimalConfig
		// toSdkProviderId is idempotent on canonical ids, so existing
		// canonical writers (and the typed-projector test fixtures)
		// pass through unchanged.
		expect(result.providerId).toBe("openai-compatible")
	})

	it("R5-10 legacy nousResearch: instance.providerId='nousresearch' is normalized to 'nousResearch' (SDK canonical)", () => {
		const config = makeBaselineA({ providerId: undefined }) as unknown as CoreSessionConfig
		const instance = makeInstanceB({
			providerId: "nousresearch", // legacy lowercase spelling (matches KNOWN_API_PROVIDERS)
		})
		applyTypedProviderInstanceToConfig(config, instance, "secret-B-value")
		const result = config as unknown as MinimalConfig
		// The other alias in the EXTENSION_TO_SDK_PROVIDER_ID table.
		expect(result.providerId).toBe("nousResearch")
	})
})

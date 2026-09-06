/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R5
 *
 * RED -> GREEN witness for the thirteenth reviewer halt
 * `HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN` (on commit fa61ff5be).
 *
 * Production seams driven (this file):
 *
 *   SdkSessionConfigBuilder.build            = REAL_PRODUCTION_SEAM
 *   MissingProviderInstanceCredentialError   = REAL_PRODUCTION_SEAM
 *   applyTypedProviderInstanceToConfig       = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed:
 *
 *   buildSessionConfig (= baseline A)        = SYNTHETIC
 *   buildAgentHooks   (= no-op)              = SYNTHETIC
 */

import type { CoreSessionConfig } from "@cline/core"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import { describe, expect, it, vi } from "vitest"
import { MissingProviderInstanceCredentialError, type ProviderConfigurationInstance } from "../instance-store/contracts"
import { SdkSessionConfigBuilder } from "../sdk-session-config-builder"


const mocks = vi.hoisted(() => ({
	buildSessionConfig: vi.fn(),
	buildAgentHooks: vi.fn(() => ({}) as unknown as CoreSessionConfig["hooks"]),
}))

vi.mock("../cline-session-factory", () => ({
	buildSessionConfig: mocks.buildSessionConfig,
}))

vi.mock("../hooks-adapter", () => ({
	buildAgentHooks: mocks.buildAgentHooks,
}))

interface MinimalCoreSessionConfig {
	providerId?: string
	modelId?: string
	apiKey?: string | null
	baseUrl?: string | null
	headers?: Record<string, string> | null
}

function makeInstance(overrides: Partial<ProviderConfigurationInstance> = {}): ProviderConfigurationInstance {
	return {
		instanceId: "inst-broken",
		providerId: "openai-compatible",
		displayLabel: "broken",
		credentialRef: { kind: "secret", name: "instance:inst-broken-key" as InstanceSecretName },
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

function makeBuilder(getInstanceSecretImpl: (name: InstanceSecretName) => string | undefined) {
	return new SdkSessionConfigBuilder({
		stateManager: {
			getInstanceSecret: vi.fn(getInstanceSecretImpl),
		} as never,
		emitHookMessage: vi.fn(),
	})
}

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R5", () => {
	it("PIIF01_R5_MISSING_CREDENTIAL_BUILDER_REJECTS: builder rejects with MissingProviderInstanceCredentialError when getInstanceSecret returns undefined", async () => {
		const baselineA: MinimalCoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "key-A",
			baseUrl: "https://endpoint-A",
			headers: { "X-A": "1" },
		}
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineA)
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineA)

		const instance = makeInstance()
		const builder = makeBuilder(() => undefined)

		await expect(
			builder.build({
				cwd: "/workspace",
				mode: "act",
				providerConfigurationInstanceTyped: instance,
			}),
		).rejects.toBeInstanceOf(MissingProviderInstanceCredentialError)

		await expect(
			builder.build({
				cwd: "/workspace",
				mode: "act",
				providerConfigurationInstanceTyped: instance,
			}),
		).rejects.toMatchObject({
			instanceId: "inst-broken",
			credentialRefName: "instance:inst-broken-key",
			name: "MissingProviderInstanceCredentialError",
		})
	})

	it("PIIF01_R5_EMPTY_CREDENTIAL_BUILDER_REJECTS: builder rejects when getInstanceSecret returns empty string", async () => {
		const baselineA: MinimalCoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
		}
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineA)

		const instance = makeInstance()
		const builder = makeBuilder(() => "")

		await expect(
			builder.build({
				cwd: "/workspace",
				mode: "act",
				providerConfigurationInstanceTyped: instance,
			}),
		).rejects.toBeInstanceOf(MissingProviderInstanceCredentialError)
	})

	it("PIIF01_R5_RESOLVED_CREDENTIAL_BUILDER_PROJECTS: when getInstanceSecret returns a non-empty string, builder projects that exact value to cfg.apiKey", async () => {
		const baselineA: MinimalCoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "key-A",
			baseUrl: "https://endpoint-A",
			headers: { "X-A": "1" },
		}
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineA)

		const instance = makeInstance()
		const builder = makeBuilder(() => "secret-broken-value")

		const result = (await builder.build({
			cwd: "/workspace",
			mode: "act",
			providerConfigurationInstanceTyped: instance,
		})) as unknown as MinimalCoreSessionConfig

		expect(result.apiKey).toBe("secret-broken-value")
		expect(result.apiKey).not.toBe("instance:inst-broken-key")
		expect(result.apiKey).not.toBeNull()
		expect(result.apiKey).not.toBe("")
		expect(result.baseUrl).toBe("https://endpoint-B")
		expect(result.headers).toEqual({ "X-B": "2" })
		expect(result.modelId).toBe("model-B")
	})

	it("PIIF01_R5_REJECTION_ABORTS_BEFORE_PROJECTION: the typed projector does not mutate the baseline when the credential is missing", async () => {
		const baselineA: MinimalCoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "key-A",
			baseUrl: "https://endpoint-A",
			headers: { "X-A": "1" },
		}
		const baselineRef = baselineA
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineRef)

		const instance = makeInstance()
		const builder = makeBuilder(() => undefined)

		await expect(
			builder.build({
				cwd: "/workspace",
				mode: "act",
				providerConfigurationInstanceTyped: instance,
			}),
		).rejects.toBeInstanceOf(MissingProviderInstanceCredentialError)

		expect(baselineRef.apiKey).toBe("key-A")
		expect(baselineRef.baseUrl).toBe("https://endpoint-A")
		expect(baselineRef.headers).toEqual({ "X-A": "1" })
		expect(baselineRef.modelId).toBe("model-A")
		expect(baselineRef.providerId).toBe("openai-compatible")
	})
})


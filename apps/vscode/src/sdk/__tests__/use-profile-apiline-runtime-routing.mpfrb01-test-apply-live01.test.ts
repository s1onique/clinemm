/**
 * ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01
 *
 * Live-Found P0 RED witness for the discriminator:
 * "Use profile B -> request succeeds with B's apiLine; Set default B -> request succeeds"
 *
 * Causal hypothesis (live observation from L-C08-2):
 *
 *   The typed projector `applyTypedProviderInstanceToConfig` claims to
 *   carry the V1 connection tuple (providerId / modelId / apiKey / baseUrl
 *   / headers / region / apiLine / providerSpecificConfig) onto the
 *   resolved `CoreSessionConfig`. But it writes ONLY the top-level
 *   fields (`cfg.providerId`, `cfg.modelId`, `cfg.apiLine`, ...) — it
 *   does NOT update the nested `config.providerConfig.apiLine` block.
 *
 *   `config.providerConfig` is the gateway-facing config the
 *   `@cline/core` runtime reads for regional routing. The
 *   `buildGatewayProviderOptions` factory at
 *   `sdk/packages/core/src/services/llms/handler-factory.ts:35-43`
 *   reads `apiLine` from `config.providerConfig.apiLine`, NOT from
 *   the top-level `config.apiLine`. So the typed projector's
 *   `cfg.apiLine` write is unreachable at runtime.
 *
 *   The legacy `buildSessionConfig` pre-populates
 *   `config.providerConfig` from the LEGACY global state via
 *   `resolveApiLine(providerId, apiConfig)` at
 *   `apps/vscode/src/sdk/cline-session-factory.ts:810-848`. For
 *   qwen/moonshot/zai/MiniMax this returns whatever the
 *   `<provider>ApiLine` field in `apiConfig` says.
 *
 * RED contract (this file):
 *
 *   Driving the REAL `applyTypedProviderInstanceToConfig` against a
 *   hand-built `CoreSessionConfig` baseline that already has a
 *   `providerConfig` block with a stale `apiLine`, applying a typed
 *   instance with a DIFFERENT `connection.apiLine` MUST leave
 *   `config.providerConfig.apiLine` matching the typed instance's
 *   `connection.apiLine`. The runtime reads from `providerConfig`,
 *   so anything else is a stale-value leak.
 *
 *   This is the GREEN invariant the fix must satisfy. Under the
 *   current code this assertion FAILS (RED) — the typed projector
 *   does not touch `config.providerConfig.apiLine`.
 */

import type { CoreSessionConfig } from "@cline/core"
import { describe, expect, it } from "vitest"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import type { ProviderConfigurationInstance } from "../instance-store/contracts"
import { applyTypedProviderInstanceToConfig } from "../instance-store/typed-projector"

/**
 * A minimal CoreSessionConfig baseline that mimics what
 * `buildSessionConfig` returns after running with legacy state
 * `actModeApiProvider = "openai-compatible"`, `apiLine = "china"`.
 * The legacy `providerConfig` block already carries the stale
 * ambient values.
 */
function buildLegacyBaseline(legacyApiLine: string | undefined): CoreSessionConfig {
	const providerConfig: Record<string, unknown> = {
		providerId: "openai-compatible",
		modelId: "model-A",
		apiKey: "legacy-key-A",
		baseUrl: "https://endpoint-A",
		...(legacyApiLine !== undefined ? { apiLine: legacyApiLine } : {}),
	}
	return {
		providerId: "openai-compatible",
		modelId: "model-A",
		apiKey: "legacy-key-A",
		baseUrl: "https://endpoint-A",
		...(legacyApiLine !== undefined ? { apiLine: legacyApiLine } : {}),
		providerConfig: providerConfig as unknown as CoreSessionConfig["providerConfig"],
	} as unknown as CoreSessionConfig
}

/**
 * Build a MiniMax-flavored typed instance whose connection carries a
 * profile-bound `apiLine = "international"`. This is the shape the
 * bootstrap emits for MiniMax profiles captured against a MiniMax +
 * international apiLine selection.
 */
function makeMinimaxInstance(apiLine: "china" | "international"): ProviderConfigurationInstance {
	return {
		instanceId: "inst-minimax-m3",
		providerId: "minimax",
		displayLabel: "minimax-m3",
		credentialRef: { kind: "secret", name: "instance:inst-minimax-m3-key" as InstanceSecretName },
		connection: {
			modelId: "MiniMax-M3",
			baseUrl: "https://api.minimaxi.com/v1",
			apiLine,
		},
		createdAt: 1,
		updatedAt: 1,
	}
}

describe("ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01 / typed-projection providerConfig carrier", () => {
	it("MPULA01_RED: applying a typed instance with connection.apiLine='international' MUST override the legacy config.providerConfig.apiLine='china' on the resolved config", () => {
		// Legacy global state: user has ambient apiLine = "china".
		const config = buildLegacyBaseline("china")

		// Typed instance bound to a profile with apiLine = "international"
		// (e.g. captured at bootstrap time when the user's selection was
		// "international" but the ambient has since drifted to "china").
		const instance = makeMinimaxInstance("international")

		applyTypedProviderInstanceToConfig(config, instance, "sk-minimax-physical-secret")

		const cfg = config as unknown as {
			providerId?: string
			modelId?: string
			apiKey?: string
			baseUrl?: string
			apiLine?: string
			providerConfig?: { providerId?: string; apiLine?: string; modelId?: string; apiKey?: string; baseUrl?: string }
		}

		// Top-level fields DO get projected — that part is GREEN today.
		expect(cfg.providerId).toBe("minimax")
		expect(cfg.modelId).toBe("MiniMax-M3")
		expect(cfg.apiKey).toBe("sk-minimax-physical-secret")
		expect(cfg.apiLine).toBe("international")

		// The runtime reads `providerConfig.apiLine` for regional
		// routing via `buildGatewayProviderOptions` at
		// sdk/packages/core/src/services/llms/handler-factory.ts:40.
		// It does NOT consult the top-level `config.apiLine`.
		//
		// This is the GREEN invariant the fix must satisfy. Under the
		// current typed-projector behavior, `providerConfig.apiLine`
		// remains the stale LEGACY value ("china"), causing the SDK
		// gateway to route the request to the wrong regional endpoint
		// and the upstream returns 405 Method Not Allowed.
		expect(cfg.providerConfig?.apiLine).toBe("international")
		expect(cfg.providerConfig?.apiLine).toBe("international")
	})

	it("MPULA02_CONSERVATION_CLEARING: applying a typed instance with connection.apiLine=null MUST clear the legacy config.providerConfig.apiLine (R5 explicit clearing semantics)", () => {
		const config = buildLegacyBaseline("international")
		const instance: ProviderConfigurationInstance = {
			...makeMinimaxInstance("china"),
			connection: {
				modelId: "MiniMax-M3",
				baseUrl: "https://api.minimaxi.com/v1",
				apiLine: null,
			},
		}
		applyTypedProviderInstanceToConfig(config, instance, "sk-minimax-physical-secret")
		const cfg = config as unknown as { apiLine?: string | null; providerConfig?: { apiLine?: string | null } }
		expect(cfg.apiLine).toBeNull()
		expect(cfg.providerConfig?.apiLine).toBeNull()
	})

	it("MPULA03_CONSERVATION_PARTIAL: applying a typed instance WITHOUT a connection.apiLine MUST preserve the legacy config.providerConfig.apiLine (R5 partial-instance contract)", () => {
		const config = buildLegacyBaseline("international")
		const instance: ProviderConfigurationInstance = {
			instanceId: "inst-minimax-m3",
			providerId: "minimax",
			displayLabel: "minimax-m3",
			credentialRef: { kind: "secret", name: "instance:inst-minimax-m3-key" as InstanceSecretName },
			connection: {
				modelId: "MiniMax-M3",
				baseUrl: "https://api.minimaxi.com/v1",
				// apiLine intentionally omitted
			},
			createdAt: 1,
			updatedAt: 1,
		}
		applyTypedProviderInstanceToConfig(config, instance, "sk-minimax-physical-secret")
		const cfg = config as unknown as { apiLine?: string | null; providerConfig?: { apiLine?: string | null } }
		// Both top-level and providerConfig preserve the legacy "international".
		expect(cfg.apiLine).toBe("international")
		expect(cfg.providerConfig?.apiLine).toBe("international")
	})

	it("MPULA04_CONSERVATION_PROVIDER_ID: applying a typed instance MUST update config.providerConfig.providerId so createAgentModelFromConfig's baseProviderConfig match succeeds", () => {
		const providerConfig: Record<string, unknown> = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "legacy-key-A",
			baseUrl: "https://endpoint-A",
			apiLine: "china",
		}
		const config = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "legacy-key-A",
			baseUrl: "https://endpoint-A",
			providerConfig,
		} as unknown as CoreSessionConfig

		const instance = makeMinimaxInstance("international")
		applyTypedProviderInstanceToConfig(config, instance, "sk-minimax-physical-secret")

		const cfg = config as unknown as {
			providerId?: string
			providerConfig?: { providerId?: string; apiLine?: string }
		}
		// Top-level providerId IS updated by the typed projector (GREEN).
		expect(cfg.providerId).toBe("minimax")
		// providerConfig.providerId MUST also be updated. Otherwise
		// createAgentModelFromConfig at
		// sdk/packages/core/src/services/llms/handler-factory.ts:203-204
		// sees `pc?.providerId !== config.providerId`, sets
		// baseProviderConfig = undefined, and the merged normalizedProviderConfig
		// loses the legacy apiLine/baseUrl entirely.
		expect(cfg.providerConfig?.providerId).toBe("minimax")
		expect(cfg.providerConfig?.apiLine).toBe("international")
	})

	it("MPULA05_USE_MUST_NOT_BECOME_SET_DEFAULT: applying profile B via typed apply MUST update config.providerConfig to B's values, not retain A's legacy values", () => {
		// Conservation: Use must not secretly become Set-as-default.
		// Set-as-default writes defaultModelProfileId only; the next task
		// rebuilds the config from the bound profile's typed instance.
		// Use rebuilds the active session from the bound profile's typed
		// instance directly. Both paths converge on the same final config,
		// and that final config must reflect the BOUND profile's values,
		// not the previous legacy state.
		const providerConfig: Record<string, unknown> = {
			providerId: "minimax",
			modelId: "model-A",
			apiKey: "legacy-key-A",
			baseUrl: "https://endpoint-A",
			apiLine: "china",
		}
		const config = {
			providerId: "minimax",
			modelId: "model-A",
			apiKey: "legacy-key-A",
			baseUrl: "https://endpoint-A",
			providerConfig,
		} as unknown as CoreSessionConfig

		// Apply profile B (different apiLine + different modelId).
		const instanceB: ProviderConfigurationInstance = {
			instanceId: "inst-B",
			providerId: "minimax",
			displayLabel: "B",
			credentialRef: { kind: "secret", name: "instance:inst-B-key" as InstanceSecretName },
			connection: {
				modelId: "model-B",
				baseUrl: "https://endpoint-B",
				apiLine: "international",
			},
			createdAt: 1,
			updatedAt: 1,
		}
		applyTypedProviderInstanceToConfig(config, instanceB, "sk-B-physical-secret")

		const cfg = config as unknown as {
			providerId?: string
			modelId?: string
			apiLine?: string
			providerConfig?: { providerId?: string; modelId?: string; apiLine?: string; apiKey?: string; baseUrl?: string }
		}

		// Top-level — already green today.
		expect(cfg.providerId).toBe("minimax")
		expect(cfg.modelId).toBe("model-B")
		expect(cfg.apiLine).toBe("international")
		// providerConfig — also B (the typed instance's values), not A (the legacy).
		expect(cfg.providerConfig?.providerId).toBe("minimax")
		expect(cfg.providerConfig?.modelId).toBe("model-B")
		expect(cfg.providerConfig?.apiLine).toBe("international")
	})
})

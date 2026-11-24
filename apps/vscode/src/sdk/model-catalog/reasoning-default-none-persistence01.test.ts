/**
 * ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01.
 *
 * C2/C4 — the PERSISTENCE round-trip for the three distinct user-visible
 * reasoning selections.
 *
 * ============================================================================
 * THE DEFECT THIS PINS
 * ============================================================================
 *
 * The provider-config store collapsed the explicit `"none"` effort into
 * `undefined`:
 *
 *     merged.effort = reasoningPatch.effort === "none" ? undefined : reasoningPatch.effort
 *
 * That destroyed the ONLY evidence of an explicit user selection. After the
 * collapse the persisted configuration could not tell:
 *
 *   - `{ enabled: false, effort: "none" }` — the user EXPLICITLY chose None;
 *   - `{ enabled: false }`                — reasoning was disabled for some
 *                                           other reason.
 *
 * Both looked identical downstream, so the production boundary could never
 * reject an unsupported explicit None on a model that mandates reasoning,
 * and the user's explicit selection was silently replaced by the model's
 * mandatory default.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The REAL provider-config store is driven with the REAL reasoning patches
 * the settings UI writes:
 *
 *   - an EXPLICIT `None` SURVIVES persistence and reload;
 *   - selecting `Default` REMOVES the explicit override;
 *   - `Default` does NOT manufacture explicit-None provenance;
 *   - a POSITIVE effort survives persistence unchanged;
 *   - the round trips Default -> None -> Default and Default -> Low -> None.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseProviderId } from "./provider-id"

const mocks = vi.hoisted(() => {
	let providerSettingsById: Record<string, Record<string, unknown>> = {}
	const saveProviderSettings = vi.fn(
		(settings: Record<string, unknown>, _options?: { setLastUsed?: boolean; tokenSource?: string }) => {
			const provider = settings.provider
			if (typeof provider !== "string") {
				throw new Error("provider is required")
			}
			providerSettingsById[provider] = { ...settings }
			return { version: 1, providers: {} }
		},
	)

	return {
		reset(): void {
			providerSettingsById = {}
			saveProviderSettings.mockClear()
		},
		setProviderSettings(value: Record<string, Record<string, unknown>>): void {
			providerSettingsById = { ...value }
		},
		getSavedProviderSettings(providerId: string): Record<string, unknown> | undefined {
			return providerSettingsById[providerId]
		},
		getStateManager() {
			return {
				getApiConfiguration: () => ({}),
				getGlobalSettingsKey: () => undefined,
				setSecret: () => {},
				setGlobalState: () => {},
				setGlobalStateBatch: () => {},
			}
		},
		getProviderSettingsManager() {
			return {
				getProviderSettings: (providerId: string) => providerSettingsById[providerId],
				saveProviderSettings,
			}
		},
	}
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: mocks.getStateManager },
}))

vi.mock("../provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@cline/core", () => ({
	isPrivateModelCatalogProvider: () => false,
	syncStoredProviderRegistration: vi.fn(),
	readModelsFileSync: vi.fn(() => ({ version: 1, providers: {} })),
	resolveModelsRegistryPath: vi.fn(() => "/tmp/models.json"),
	writeModelsFileSync: vi.fn(),
}))

vi.mock("@cline/llms", () => ({
	getGeneratedModelsForProvider: vi.fn(() => ({})),
	MODEL_COLLECTIONS_BY_PROVIDER_ID: {},
}))

/**
 * The persisted reasoning record for a provider, read back from the store's
 * backing provider-settings record.
 */
function persistedReasoning(providerId: string): Record<string, unknown> | undefined {
	const settings = mocks.getSavedProviderSettings(providerId)
	const reasoning = settings?.reasoning
	return reasoning && typeof reasoning === "object" ? (reasoning as Record<string, unknown>) : undefined
}

describe("ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01 — persistence", () => {
	beforeEach(() => {
		mocks.reset()
		vi.clearAllMocks()
		vi.resetModules()
	})

	it("C2.4: an EXPLICIT `None` SURVIVES persistence and reload", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai-compatible")

		store.write(providerId, { reasoning: { enabled: false, effort: "none" } })

		// The persisted record KEEPS the explicit selection: it is the only
		// evidence that the user chose it.
		expect(persistedReasoning("openai-compatible")).toEqual({
			enabled: false,
			effort: "none",
		})
	})

	it("C2.5: selecting `Default` REMOVES the explicit override", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai-compatible")

		// The user first chooses an explicit effort...
		store.write(providerId, { reasoning: { enabled: true, effort: "low" } })
		expect(persistedReasoning("openai-compatible")).toEqual({ enabled: true, effort: "low" })

		// ...then chooses `Default`: the explicit override is REMOVED, so the
		// model keeps its own default.
		store.write(providerId, { reasoning: { effort: "default" } })
		expect(persistedReasoning("openai-compatible")).toEqual({})
	})

	it("C2.6: `Default` does NOT manufacture explicit-None provenance", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai-compatible")

		store.write(providerId, { reasoning: { effort: "default" } })

		// There is no `effort` and no `enabled`: the persisted configuration
		// carries no evidence of a user selection at all.
		const reasoning = persistedReasoning("openai-compatible")
		expect(reasoning?.effort).toBeUndefined()
		expect(reasoning?.enabled).toBeUndefined()
	})

	it("C2.7: a POSITIVE effort survives persistence unchanged", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai-compatible")

		store.write(providerId, { reasoning: { enabled: true, effort: "low" } })

		expect(persistedReasoning("openai-compatible")).toEqual({ enabled: true, effort: "low" })
	})

	it("C4.1: the Default -> None -> Default round trip ends in the ABSENT state", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai-compatible")

		store.write(providerId, { reasoning: { effort: "default" } })
		expect(persistedReasoning("openai-compatible")).toEqual({})

		store.write(providerId, { reasoning: { enabled: false, effort: "none" } })
		expect(persistedReasoning("openai-compatible")).toEqual({ enabled: false, effort: "none" })

		store.write(providerId, { reasoning: { effort: "default" } })
		expect(persistedReasoning("openai-compatible")).toEqual({})
	})

	it("C4.2: the Default -> Low -> None round trip keeps each selection distinct", async () => {
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai-compatible")

		store.write(providerId, { reasoning: { effort: "default" } })
		expect(persistedReasoning("openai-compatible")).toEqual({})

		store.write(providerId, { reasoning: { enabled: true, effort: "low" } })
		expect(persistedReasoning("openai-compatible")).toEqual({ enabled: true, effort: "low" })

		store.write(providerId, { reasoning: { enabled: false, effort: "none" } })
		expect(persistedReasoning("openai-compatible")).toEqual({ enabled: false, effort: "none" })
	})

	it("C4.3: a LEGACY configuration (an explicit `None`) is unchanged until explicitly edited", async () => {
		// A configuration written by an older version carries the explicit
		// `None`. It must keep behaving exactly as before until the user
		// edits it.
		mocks.setProviderSettings({
			"openai-compatible": {
				provider: "openai-compatible",
				reasoning: { enabled: false, effort: "none" },
			},
		})
		const { createProviderConfigStore } = await import("./store")
		const store = createProviderConfigStore()
		const providerId = parseProviderId("openai-compatible")

		// An unrelated write leaves the reasoning record alone.
		store.write(providerId, { baseUrl: "https://endpoint.example/v1" })

		expect(persistedReasoning("openai-compatible")).toEqual({ enabled: false, effort: "none" })
	})
})

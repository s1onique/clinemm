/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION07
 *
 * LIVE-FOUND P0 RED -> GREEN witness (HALT_MODEL_PROFILE_PROVIDER_ID_NOT_CANONICAL).
 * The bootstrap captures the legacy extension spelling "openai" from the
 * user's `actModeApiProvider`, persists it into the durable
 * `ProviderConfigurationInstance.providerId`, and the typed projector is
 * the single authority that normalizes that legacy id to the SDK canonical
 * "openai-compatible" before the runtime SDK gateway receives the
 * `CoreSessionConfig.providerId`.
 *
 * Without normalization, the SDK gateway rejects the request with:
 *
 *   Unknown or disabled provider "openai".
 *
 * (Exact error observed live in the first-run dogfood after CORRECTION06:
 * the user configured a MiniMax-M3 OpenAI-compatible endpoint, applied
 * the freshly-created profile, and the SDK gateway refused the request
 * before any provider-specific logic could run.)
 *
 * CAUSAL CHAIN (six provider-ID boundaries):
 *
 *   CURRENT_API_PROVIDER               = "openai"            (legacy)
 *     v bootstrap.ts:682 (config.actModeApiProvider)
 *   BOOTSTRAPPED_INSTANCE_PROVIDER_ID  = "openai"            (legacy, persisted)
 *     v bootstrap.ts:798 (instance.providerId)
 *   PROFILE_INSTANCE_PROVIDER_ID       = "openai"            (legacy, profile
 *                                                                references the
 *                                                                instance unchanged)
 *     v typed-projector.ts:186 (the fix point)
 *   SESSION_CONFIG_PROVIDER_ID         = "openai-compatible" (canonical, after fix)
 *     v CoreSessionConfig.providerId
 *   FINAL_GATEWAY_LOOKUP_PROVIDER_ID   = "openai-compatible" (canonical, accepted)
 *
 * RED ACTUAL (before fix):
 *   SESSION_CONFIG_PROVIDER_ID         = "openai"            (legacy, rejected)
 *   FINAL_GATEWAY_LOOKUP_PROVIDER_ID   = "openai"            (registry throws)
 *
 * GREEN EXPECTED (after fix):
 *   SESSION_CONFIG_PROVIDER_ID         = "openai-compatible" (canonical)
 *   FINAL_GATEWAY_LOOKUP_PROVIDER_ID   = "openai-compatible" (registry resolves)
 *
 * CONSERVATION PIN (this test also asserts):
 *   anthropic      -> anthropic      (no change)
 *   minimax        -> minimax        (no change)
 *   openrouter     -> openrouter     (no change)
 *   openai-native  -> openai-native  (no change)
 *   custom IDs     -> unchanged      (no change)
 *
 *   CRITICAL: a first-party OpenAI configuration is NOT the same thing as
 *   OpenAI-Compatible. The SDK distinguishes them:
 *     OpenAI Compatible = "openai-compatible"
 *     OpenAI native     = "openai-native"
 *   The fix ONLY normalizes the legacy "openai" alias; it does NOT touch
 *   "openai-native" or any other provider containing the substring "openai".
 *
 * Run via:
 *   cd apps/vscode && TMPDIR=/tmp bun test \
 *     src/sdk/__tests__/bootstrap-openai-canonical-id-projection.mpfrb01-correction07.test.ts
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { CoreSessionConfig } from "@cline/core"
import { InstancesStore } from "../instance-store/instances-store"
import { applyTypedProviderInstanceToConfig } from "../instance-store/typed-projector"
import { toSdkProviderId } from "../model-catalog/sdk-provider-id"
import {
	type BootstrapModelProfileDeps,
	bootstrapModelProfileFromCurrentConfiguration,
} from "../profile-store/bootstrap"
import { ProfilesStore } from "../profile-store/profiles-store"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDataDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mpfrb01-c07-canonical-"))
}

function makeInstancesStore(dataDir: string): InstancesStore {
	return new InstancesStore({ filePath: path.join(dataDir, "instances.json") })
}

function makeProfilesStore(dataDir: string): ProfilesStore {
	return new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
}

/**
 * The "current" ApiConfiguration for a user who has configured an
 * OpenAI-compatible provider (e.g. MiniMax-M3 on a LiteLLM endpoint) with
 * a literal physical API key. This is the exact shape from the live
 * first-run dogfood after CORRECTION06.
 */
function makeCurrentOpenAiCompatibleConfig(): Record<string, unknown> {
	return {
		actModeApiProvider: "openai",
		// OpenAI-Compatible stores its model id in the per-provider
		// `actModeOpenAiModelId` slot (PROVIDER_MODEL_ID_MAP at
		// cline-session-factory.ts:471), NOT the generic
		// `actModeApiModelId`. The bootstrap-resolved model is what
		// gets persisted to `connection.modelId` of the durable
		// instance.
		actModeOpenAiModelId: "MiniMax-M3",
		openAiApiKey: "sk-litellm-physical-key-XXXXXXXXXXXXX",
		openAiBaseUrl: "https://litellm.example.com/v1",
		// openAiHeaders is canonically ABSENT after CORRECTION05; the
		// bootstrap path treats absent and empty ({}) as equivalent.
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION07 canonical-id projection", () => {
	let dataDir: string

	beforeEach(() => {
		dataDir = tmpDataDir()
	})

	afterEach(() => {
		try {
			fs.rmSync(dataDir, { recursive: true, force: true })
		} catch {
			// best-effort cleanup
		}
	})

	// -------------------------------------------------------------------------
	// RED -> GREEN witness for the live user's exact geometry.
	// -------------------------------------------------------------------------

	it("MPFRB01_C07_OPENAI_LIVE_GEOMETRY: bootstrap('openai') + typed-projector => cfg.providerId='openai-compatible' (canonical)", async () => {
		const config = makeCurrentOpenAiCompatibleConfig()
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: () => {},
			flushInstanceSecrets: async () => {},
			instancesStore,
			profilesStore,
			getCurrentTaskHistoryItem: () => undefined,
			writeTaskHistoryItem: undefined,
			postStateToWebview: undefined,
			now: () => 1700000000000,
			generateId: (() => {
				let n = 0
				return () => {
					n++
					return `deterministic-${n}`
				}
			})(),
		}

		// -- Step 1: bootstrap from a legacy 'openai' config. The
		// bootstrap captures the legacy spelling verbatim per the
		// existing bootstrap contract.
		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "My first")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")
		const instanceId = result.instanceId

		// -- Step 2: the durable instance carries the legacy
		// spelling. This pins the existing bootstrap contract:
		// the instance is a faithful capture of the user's legacy
		// configuration; it is the PROJECTION that canonicalizes,
		// not the bootstrap.
		const persisted = instancesStore.read(instanceId)
		expect(persisted).toBeDefined()
		expect(persisted?.providerId).toBe("openai")
		expect(persisted?.connection.modelId).toBe("MiniMax-M3")
		expect(persisted?.connection.baseUrl).toBe("https://litellm.example.com/v1")

		// -- Step 3: drive the typed projector on the persisted
		// instance (the production path that previously failed
		// live). The fix is at typed-projector.ts:186.
		const baseline: CoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "secret-A-value",
		} as unknown as CoreSessionConfig

		applyTypedProviderInstanceToConfig(
			baseline,
			persisted!,
			"sk-litellm-physical-key-XXXXXXXXXXXXX",
		)

		// -- RED guard (before fix): cfg.providerId was the legacy
		// "openai" and the SDK gateway rejected the request with
		// "Unknown or disabled provider 'openai'".
		//
		// -- GREEN guard (after fix): cfg.providerId is the SDK
		// canonical "openai-compatible" and the gateway resolves.
		expect((baseline as unknown as { providerId: string }).providerId).toBe("openai-compatible")
		// Explicit anti-regression: the legacy spelling MUST NOT
		// survive into the runtime config.
		expect((baseline as unknown as { providerId: string }).providerId).not.toBe("openai")

		// -- Connection fields are still projected (the fix is
		// orthogonal to modelId / apiKey / baseUrl).
		expect((baseline as unknown as { modelId: string }).modelId).toBe("MiniMax-M3")
		expect((baseline as unknown as { apiKey: string }).apiKey).toBe(
			"sk-litellm-physical-key-XXXXXXXXXXXXX",
		)
		expect((baseline as unknown as { baseUrl: string }).baseUrl).toBe("https://litellm.example.com/v1")
	})

	// -------------------------------------------------------------------------
	// CONSERVATION PIN: every other provider (anthropic, openrouter,
	// openai-native, custom) must continue to pass through the projector
	// with their spelling intact. The fix MUST be a pure alias fold,
	// not a global rewrite.
	// -------------------------------------------------------------------------

	describe("MPFRB01_C07_CONSERVATION: provider-id normalization is a pure alias fold", () => {
		const cases: ReadonlyArray<{
			readonly label: string
			readonly input: string
			readonly expected: string
		}> = [
			// The fix point: legacy openai alias.
			{ label: "openai (legacy OpenAI-Compatible alias)", input: "openai", expected: "openai-compatible" },

			// Conservation: every other extension spelling is unchanged.
			{ label: "anthropic", input: "anthropic", expected: "anthropic" },
			{ label: "openrouter", input: "openrouter", expected: "openrouter" },
			{ label: "openai-native (CRITICAL: distinct from openai-compatible)", input: "openai-native", expected: "openai-native" },
			{ label: "minimax", input: "minimax", expected: "minimax" },
			{ label: "ollama", input: "ollama", expected: "ollama" },
			{ label: "cline", input: "cline", expected: "cline" },
			{ label: "vscode-lm", input: "vscode-lm", expected: "vscode-lm" },

			// Already canonical: idempotent pass-through.
			{ label: "openai-compatible (already canonical, idempotent)", input: "openai-compatible", expected: "openai-compatible" },

			// The other legacy alias: nousresearch -> nousResearch.
			{ label: "nousresearch (legacy lowercase)", input: "nousresearch", expected: "nousResearch" },
			{ label: "nousResearch (already canonical, idempotent)", input: "nousResearch", expected: "nousResearch" },

			// Custom / user-defined provider ids pass through unchanged.
			{ label: "custom-corp-proxy (user-defined)", input: "custom-corp-proxy", expected: "custom-corp-proxy" },
		]

		for (const { label, input, expected } of cases) {
			it(`MPFRB01_C07_CONSERVATION_CASE: ${label} -> ${expected}`, () => {
				// Direct test of toSdkProviderId (the single authority).
				// This is a structural corroboration: the projector calls
				// toSdkProviderId(instance.providerId); if the helper
				// already folds correctly, the projector projection is
				// provably correct for every input.
				expect(toSdkProviderId(input)).toBe(expected)
			})
		}
	})

	// -------------------------------------------------------------------------
	// CONSERVATION PIN (instanceStore-level): the existing bootstrap
	// contract — instances store the legacy spelling — is preserved.
	// This test pins the durable instance contract so a future
	// "let's just normalize at the bootstrap" refactor does not silently
	// rewrite instance.providerId on disk.
	// -------------------------------------------------------------------------

	it("MPFRB01_C07_INSTANCE_DURABLE_CONTRACT: bootstrap persists instance.providerId as the legacy 'openai' (NOT 'openai-compatible')", async () => {
		const config = makeCurrentOpenAiCompatibleConfig()
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: () => {},
			flushInstanceSecrets: async () => {},
			instancesStore,
			profilesStore,
			getCurrentTaskHistoryItem: () => undefined,
			writeTaskHistoryItem: undefined,
			postStateToWebview: undefined,
			now: () => 1700000000000,
			generateId: (() => {
				let n = 0
				return () => {
					n++
					return `deterministic-${n}`
				}
			})(),
		}

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "My first")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")

		// CRITICAL: the durable instance keeps the legacy spelling.
		// This is the existing bootstrap contract. The canonical
		// spelling is produced at the PROJECTION boundary, not at
		// the bootstrap.
		const persisted = instancesStore.read(result.instanceId)
		expect(persisted).toBeDefined()
		expect(persisted?.providerId).toBe("openai")

		// And the typed projector turns that into the canonical
		// runtime spelling. Together: durable "openai" + projection
		// "openai-compatible" is the correct chain.
		const baseline: CoreSessionConfig = {} as unknown as CoreSessionConfig
		applyTypedProviderInstanceToConfig(
			baseline,
			persisted!,
			"sk-litellm-physical-key-XXXXXXXXXXXXX",
		)
		expect((baseline as unknown as { providerId: string }).providerId).toBe("openai-compatible")
	})
})

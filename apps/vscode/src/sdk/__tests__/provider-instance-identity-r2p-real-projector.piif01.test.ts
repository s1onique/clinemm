/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R2P / PIIF01 -
 * Real `SdkSessionConfigBuilder` projection discriminator.
 *
 * The tenth reviewer (on commit 353245457) raised
 * HALT_R2_REAL_PROJECTION_NOT_PROVEN: the existing R2 test
 * `provider-instance-identity-r2-strategy-b.piif01.test.ts`
 * mechanically proved that `applyProviderConfigurationInstance` (a)
 * threads `next` through to a builder argument and (b) the rebuilt
 * session carries whatever the builder returns. But the
 * `sessionConfigBuilder` it injected was a HAND-WRITTEN test stub
 * that re-implemented the projection logic; the production
 * `SdkSessionConfigBuilder.build` -> `applyProviderConfigurationInstance
 * ToConfig` chain was never executed by the test. So the GREEN did
 * not actually bind to the production projector.
 *
 * This file closes that halt by driving the REAL production chain
 * (per the reviewer's R2p1 stipulation, "The test may stub the
 * underlying `buildSessionConfig()` result to A if necessary; the
 * important thing is that the **real production projector**
 * performs A->B.").
 *
 * What is exercised here (ninety-eighth pass):
 *
 *   - REAL production `SdkSessionConfigBuilder.build`
 *   - REAL production `applyProviderConfigurationInstanceToConfig`
 *     (the projector that overlays the instance on the resolved
 *     config) - only `vi.mock`\'d collaborators are the underlying
 *     `buildSessionConfig` (returns a controlled baseline A) and
 *     `buildAgentHooks` (returns undefined so the test does not
 *     need a real StateManager for hook discovery).
 *
 * What is NOT exercised here:
 *
 *   - The full SdkProviderChangeCoordinator wiring
 *     (covered by the existing R2 file at
 *     `provider-instance-identity-r2-strategy-b.piif01.test.ts`).
 *   - The LocalRuntimeHost -> ActiveSession.config capture
 *     (also covered there).
 *   - The SdkSessionLifecycle.replaceActiveSession (stubbed).
 *
 * PRODUCTION SEAMS DRIVEN (this file):
 *
 *   SdkSessionConfigBuilder.build                  = REAL_PRODUCTION_SEAM
 *   applyProviderConfigurationInstanceToConfig    = REAL_PRODUCTION_SEAM
 *
 * COLLABORATORS STUBBED:
 *
 *   buildSessionConfig (= baseline A)              = SYNTHETIC
 *   buildAgentHooks   (= no-op)                    = SYNTHETIC
 *
 * This file does NOT import from `@cline/shared` or
 * `@cline/shared/storage` (uses inline MinimalCoreSessionConfig
 * interface). It uses `process.env` for nothing; all paths are
 * relative to the source. So the tsconfig.c2-4-c-bridge `paths`
 * mapping for `@cline/shared*` is NOT required.
 *
 * ACT-OWNED TS DIAGNOSTICS (per eighth reviewer\'s reopen
 * condition #3): zero. Bridge baseline `[]`.
 */

import type { CoreSessionConfig } from "@cline/core"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { describe, expect, it, vi } from "vitest"
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

// Minimal baseline that matches the contract
// `applyProviderConfigurationInstanceToConfig` reads/writes:
// `providerId`, `modelId`, `apiKey`, `baseUrl`, `headers`. Other
// `CoreSessionConfig` fields are intentionally left out because the
// projector does not touch them and the tests only assert on the
// five R2 identity-bearing fields.
interface MinimalCoreSessionConfig {
	providerId?: string
	modelId?: string
	apiKey?: string
	baseUrl?: string
	headers?: Record<string, string>
}

function makeBuilder() {
	return new SdkSessionConfigBuilder({
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => undefined),
		} as never,
		emitHookMessage: vi.fn(),
	})
}

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R2P / PIIF01", () => {
	// R2p1: real positive binding. Baseline A carries
	// providerId/openai-compatible, modelId/model-A, apiKey/key-A,
	// baseUrl/https://endpoint-A, headers={"X-A":"1"}. Instance B
	// carries the same five fields with different values. After
	// `SdkSessionConfigBuilder.build({ ..., providerConfigurationInstance: B })`,
	// the returned config carries B on all five fields.
	it("PIIF01_R2P1_REAL_BUILDER_POSITIVE_BINDING: real SdkSessionConfigBuilder projects A->B on all five identity-bearing fields", async () => {
		const baselineA: MinimalCoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "key-A",
			baseUrl: "https://endpoint-A",
			headers: { "X-A": "1" },
		}
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineA)

		const instanceB: ApiConfiguration = {
			actModeApiProvider: "openai" as never,
			actModeApiModelId: "model-B",
			openAiApiKey: "key-B",
			openAiBaseUrl: "https://endpoint-B",
			openAiHeaders: JSON.stringify({ "X-B": "2", "X-Tenant": "b" }),
		} as unknown as ApiConfiguration

		const builder = makeBuilder()
		const result = (await builder.build({
			cwd: "/workspace",
			mode: "act",
			providerConfigurationInstance: instanceB,
		})) as unknown as MinimalCoreSessionConfig

		expect(result.providerId).toBe("openai")
		expect(result.modelId).toBe("model-B")
		expect(result.apiKey).toBe("key-B")
		expect(result.baseUrl).toBe("https://endpoint-B")
		expect(result.headers).toEqual({ "X-B": "2", "X-Tenant": "b" })
	})

	// R2p2: clearing semantics (KNOWN LIMITATION). Baseline A
	// carries headers={"X-A":"old"} and apiKey="key-A". Instance B
	// carries a NEW model/provider but does NOT set
	// openAiHeaders / openAiApiKey (because `ApiConfiguration` does
	// not distinguish "field absent" from "field present and
	// undefined", the only honest form is to omit the field
	// entirely). The current projector therefore preserves A\'s
	// headers and apiKey. This is the OPENAI_ONLY_PROBE limitation
	// the reviewer surfaced; the test pins the behavior so that the
	// replacement by the frozen `ProviderConfigurationInstance`
	// projector is observable.
	it("PIIF01_R2P2_CLEARING_SEMANTICS: when the instance omits openAiHeaders / openAiApiKey, baseline A's headers / apiKey are preserved (KNOWN LIMITATION of OPENAI_ONLY_PROBE)", async () => {
		const baselineA: MinimalCoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "key-A",
			baseUrl: "https://endpoint-A",
			headers: { "X-A": "old", "X-Tenant": "tenant-a" },
		}
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineA)

		const instanceB: ApiConfiguration = {
			actModeApiProvider: "openai" as never,
			actModeApiModelId: "model-B",
			// No openAiApiKey - the caller did not set it.
			// No openAiBaseUrl - keep baseline\'s.
			// No openAiHeaders - keep baseline\'s.
		} as unknown as ApiConfiguration

		const builder = makeBuilder()
		const result = (await builder.build({
			cwd: "/workspace",
			mode: "act",
			providerConfigurationInstance: instanceB,
		})) as unknown as MinimalCoreSessionConfig

		// Identity fields DO get overridden:
		expect(result.providerId).toBe("openai")
		expect(result.modelId).toBe("model-B")
		// Connection fields PRESERVE baseline A - this is the
		// OPENAI_ONLY_PROBE clearing-semantics limitation. Once the
		// frozen `ProviderConfigurationInstance` representation
		// exists with an explicit clearing form
		// (e.g. `headers: null`), this assertion flips.
		expect(result.apiKey).toBe("key-A")
		expect(result.baseUrl).toBe("https://endpoint-A")
		expect(result.headers).toEqual({ "X-A": "old", "X-Tenant": "tenant-a" })
	})

	// R2p3: mode discriminator. Instance carries plan=X, act=Y.
	// When the builder is invoked with `mode: "plan"`, the
	// resulting providerId / modelId must come from the PLAN
	// selection (not the act selection). Conversely, with
	// `mode: "act"`, the result must come from the ACT selection.
	it("PIIF01_R2P3_MODE_DISCRIMINATOR: when mode=plan, real builder projects the plan fields; when mode=act, real builder projects the act fields", async () => {
		const instanceWithBothModes: ApiConfiguration = {
			planModeApiProvider: "anthropic" as never,
			planModeApiModelId: "plan-X",
			actModeApiProvider: "openai" as never,
			actModeApiModelId: "act-Y",
			openAiApiKey: "key-shared",
		} as unknown as ApiConfiguration

		// Case A: mode = "plan" => providerId = anthropic,
		//         modelId = plan-X (act-Y must NOT leak through).
		mocks.buildSessionConfig.mockResolvedValueOnce({
			providerId: "openai-compatible",
			modelId: "baseline-model",
		})
		const builder = makeBuilder()
		const planResult = (await builder.build({
			cwd: "/workspace",
			mode: "plan" as Mode,
			providerConfigurationInstance: instanceWithBothModes,
		})) as unknown as MinimalCoreSessionConfig

		expect(planResult.providerId).toBe("anthropic")
		expect(planResult.modelId).toBe("plan-X")
		// apiKey (shared, mode-independent) is still projected.
		expect(planResult.apiKey).toBe("key-shared")

		// Case B: mode = "act" => providerId = openai,
		//         modelId = act-Y (plan-X must NOT leak through).
		mocks.buildSessionConfig.mockResolvedValueOnce({
			providerId: "openai-compatible",
			modelId: "baseline-model",
		})
		const actResult = (await builder.build({
			cwd: "/workspace",
			mode: "act" as Mode,
			providerConfigurationInstance: instanceWithBothModes,
		})) as unknown as MinimalCoreSessionConfig

		expect(actResult.providerId).toBe("openai")
		expect(actResult.modelId).toBe("act-Y")
	})

	// R2p4: generic-provider boundary. The instance is for a
	// NON-OpenAI provider (anthropic) and carries NO openAi*
	// fields. The current projector sets providerId="anthropic"
	// (because actModeApiProvider is set) but does NOT set
	// apiKey / baseUrl / headers (no source). The baseline\'s
	// apiKey / baseUrl / headers remain. This pins the projector
	// as OPENAI_ONLY_PROBE - the Foundation does NOT need a
	// generic provider mapper at this seam; the persisted
	// `ProviderConfigurationInstance` representation must bring
	// its own typed projector (claudeCode, aws*, gcp*, sapAiCore,
	// ollama, etc. each need their own credential shape).
	it("PIIF01_R2P4_GENERIC_PROVIDER_BOUNDARY: instance with anthropic + no openAi* fields projects providerId but not connection (OPENAI_ONLY_PROBE)", async () => {
		const baselineA: MinimalCoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "key-A",
			baseUrl: "https://endpoint-A",
			headers: { "X-A": "1" },
		}
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineA)

		const instanceAnthropicNoOpenai: ApiConfiguration = {
			actModeApiProvider: "anthropic" as never,
			actModeApiModelId: "claude-opus-4",
			// No openAiApiKey, openAiBaseUrl, openAiHeaders.
			// A generic anthropic ApiConfiguration would carry
			// `apiKey` directly; the current OPENAI_ONLY_PROBE
			// ignores that field entirely.
		} as unknown as ApiConfiguration

		const builder = makeBuilder()
		const result = (await builder.build({
			cwd: "/workspace",
			mode: "act",
			providerConfigurationInstance: instanceAnthropicNoOpenai,
		})) as unknown as MinimalCoreSessionConfig

		// Identity fields DO get overridden.
		expect(result.providerId).toBe("anthropic")
		expect(result.modelId).toBe("claude-opus-4")
		// Connection fields DO NOT - openAi* fields are absent and
		// the projector only reads openAi*. The OPENAI_ONLY_PROBE
		// cannot carry anthropic\'s credential shape. Once the
		// frozen `ProviderConfigurationInstance` representation
		// exists, this is replaced.
		expect(result.apiKey).toBe("key-A")
		expect(result.baseUrl).toBe("https://endpoint-A")
		expect(result.headers).toEqual({ "X-A": "1" })
	})

	// Conservation: when the caller does NOT pass an instance
	// override, the projector must NOT touch the baseline. This
	// pins the back-compat invariant for the other 12 call sites
	// of SdkSessionConfigBuilder.build.
	it("PIIF01_R2P_CONSERVATION_NO_OVERRIDE: real builder without providerConfigurationInstance returns the baseline unchanged", async () => {
		const baselineA: MinimalCoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "model-A",
			apiKey: "key-A",
			baseUrl: "https://endpoint-A",
			headers: { "X-A": "1" },
		}
		mocks.buildSessionConfig.mockResolvedValueOnce(baselineA)

		const builder = makeBuilder()
		const result = (await builder.build({
			cwd: "/workspace",
			mode: "act",
		})) as unknown as MinimalCoreSessionConfig

		expect(result.providerId).toBe("openai-compatible")
		expect(result.modelId).toBe("model-A")
		expect(result.apiKey).toBe("key-A")
		expect(result.baseUrl).toBe("https://endpoint-A")
		expect(result.headers).toEqual({ "X-A": "1" })
	})
})

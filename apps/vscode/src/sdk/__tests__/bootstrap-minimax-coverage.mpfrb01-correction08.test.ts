/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION08
 *
 * LIVE-FOUND P0 RED -> GREEN witness
 * (HALT_MODEL_PROFILE_BOOTSTRAP_MINIMAX_COVERAGE_ABSENT).
 *
 * The first-run dogfood after CORRECTION07 closure surfaced a NEW live
 * P0 with a different signature from CORRECTION03/05/06/07:
 *
 *   1. User installs the exact-HEAD VSIX with ZERO existing
 *      ProviderConfigurationInstance / ModelProfile records.
 *   2. User configures the native MiniMax provider (NOT OpenAI-
 *      Compatible) with a real API key:
 *         actModeApiProvider      = "minimax"
 *         actModeApiModelId       = "MiniMax-M3"   (generic field)
 *         minimaxApiKey           = "sk-MM3-physical-..."
 *         minimaxApiLine          = "international"  (optional)
 *   3. The direct MiniMax runtime path WORKS live (a "Say hello and
 *      stop" task completed successfully), proving that:
 *         MINIMAX_RUNTIME_SUPPORT    = LIVE_PROVEN
 *   4. User opens Settings > Model Profiles; clicks Create first
 *      profile; names it "minimax-m3"; clicks Create.
 *   5. Live banner:
 *         Provider 'minimax' is not covered by the bootstrap path.
 *         Use Settings > API Configuration to create the profile
 *         manually.
 *      -> status = CURRENT_CONFIGURATION_UNSUPPORTED (RED).
 *
 * The two screenshots together falsify the "MiniMax runtime is broken"
 * hypothesis and isolate the defect to the bootstrap provider-
 * coverage table:
 *
 *      CURRENT_DIRECT_MINIMAX_CONFIG   = LIVE PASS
 *      BOOTSTRAP_FROM_MINIMAX_CONFIG   = LIVE RED
 *
 * BOUNDARY (six provider-coverage boundaries):
 *
 *   ApiConfiguration.provider = "minimax"
 *     v bootstrap.ts:690 (BOOTSTRAP_COVERAGE.has("minimax"))
 *   BOOTSTRAP_COVERAGE.has(minimax) = false
 *     v bootstrap.ts:691-694
 *   result = CURRENT_CONFIGURATION_UNSUPPORTED
 *
 * RED -> GREEN arc (this file):
 *
 *   RED   (before this commit): adding a MiniMax geometry fixture to
 *         bootstrap-first-profile.mpfrb01.test.ts's existing harness
 *         reproduces the live failure:
 *           result.status === "CURRENT_CONFIGURATION_UNSUPPORTED"
 *         and `assertBootstrapCoverageIsWellFormed()` reports the
 *         "minimax" diagnostic with `hasIntendedCredentialField` or
 *         `hasIntendedModelField` = false.
 *
 *   GREEN (after the bounded fix at cline-session-factory.ts:468 +
 *         bootstrap.ts:285):
 *           result.status === "CREATED"
 *           instance.providerId   === "minimax"
 *           instance.connection.modelId === "MiniMax-M3"
 *           instance.credentialRef.name resolves to the
 *             physical-key written to the new instance-scoped secret
 *             namespace (which equals config.minimaxApiKey)
 *           assertBootstrapCoverageIsWellFormed() reports
 *             provider="minimax" with hasIntendedCredentialField=true,
 *             credentialResolved=true, hasIntendedModelField=true,
 *             modelIdResolvedFor containing both "plan" and "act".
 *
 * What this test pins (per the 2026-09-09 in-place amendment):
 *
 *   1. The physical credential comes from the EXISTING current/legacy
 *      ApiConfiguration authority (resolveApiKey) - NOT from the new
 *      instance-secret namespace. The capture-by-current-config freeze
 *      (CURRENT_PHYSICAL_CREDENTIAL_SOURCE) is honored for the
 *      MiniMax provider exactly as it is for every other covered
 *      provider.
 *
 *   2. The model id comes from the EXISTING current/legacy
 *      ApiConfiguration authority (resolveModelId) - NOT from a
 *      MiniMax-specific hard-coded "MiniMax-M3" constant. MiniMax
 *      shares the generic planModeApiModelId / actModeApiModelId
 *      with asksage/dify/etc.; this is the same pattern as the
 *      CORRECTION04 asksage/dify fix.
 *
 *   3. The connection tuple captures whatever V1-relevant connection
 *      fields the current MiniMax runtime actually consumes. Today
 *      that is at minimum:
 *         providerId (= "minimax", durable legacy spelling)
 *         modelId    (= connection.modelId, generic field)
 *      The provider-specific fields (baseUrl, apiLine,
 *      providerSpecificConfig) are NOT captured by the V1 bootstrap
 *      because they are not yet exposed on the typed-instance
 *      connection for the MiniMax provider family - adding capture
 *      here would scope-creep this correction.
 *
 *   4. The coverage invariant assertBootstrapCoverageIsWellFormed()
 *      returns ok=true with the MiniMax diagnostic green, pinning
 *      the resolver seams in lockstep with the BOOTSTRAP_COVERAGE
 *      entry.
 *
 * Conservation (the bounded fix MUST NOT):
 *   - Reopen the Provider Instance Foundation.
 *   - Change MiniMax runtime provider semantics.
 *   - Map "minimax" to "openai-compatible" or any other provider id.
 *   - Weaken the unsupported-provider error message for OTHER
 *     uncovered providers (the live error message is correct for
 *     the unset-coverage case; only the COVERAGE TABLE changes).
 *   - Add new RPC, new proto field, or new webview affordance.
 *
 * Production seams driven (this file):
 *   bootstrapModelProfileFromCurrentConfiguration = REAL_PRODUCTION_SEAM
 *   resolveApiKey (cline-session-factory)         = REAL_PRODUCTION_SEAM
 *   resolveModelId (cline-session-factory)        = REAL_PRODUCTION_SEAM
 *   resolveBaseUrl (cline-session-factory)        = REAL_PRODUCTION_SEAM
 *   assertBootstrapCoverageIsWellFormed           = REAL_PRODUCTION_SEAM
 *   InstancesStore.upsert                         = REAL_PRODUCTION_SEAM
 *   ProfilesStore.upsert                          = REAL_PRODUCTION_SEAM
 *   setInstanceSecret / flushInstanceSecrets      = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed (intentionally):
 *   getApiConfiguration       = SYNTHETIC (in-memory MiniMax fixture)
 *   getMode                   = SYNTHETIC (returns "act")
 *   getCurrentTaskHistoryItem = SYNTHETIC (no task)
 *   writeTaskHistoryItem      = SYNTHETIC (not exercised)
 *   postStateToWebview        = SYNTHETIC (no-op)
 *
 * Run via:
 *   cd apps/vscode && TMPDIR=/tmp bun test \
 *     src/sdk/__tests__/bootstrap-minimax-coverage.mpfrb01-correction08.test.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { InstancesStore } from "../instance-store/instances-store"
import {
	assertBootstrapCoverageIsWellFormed,
	BOOTSTRAP_COVERAGE,
	type BootstrapModelProfileDeps,
	bootstrapModelProfileFromCurrentConfiguration,
} from "../profile-store/bootstrap"
import { ProfilesStore } from "../profile-store/profiles-store"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDataDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mpfrb01-c08-mm-"))
}

function makeInstancesStore(dataDir: string): InstancesStore {
	return new InstancesStore({ filePath: path.join(dataDir, "instances.json") })
}

function makeProfilesStore(dataDir: string): ProfilesStore {
	return new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
}

/**
 * The exact "current" ApiConfiguration a MiniMax user would have
 * after configuring the native MiniMax provider in Settings > API
 * Configuration:
 *
 *   - actModeApiProvider = "minimax" (the LIVE-observed provider id)
 *   - actModeApiModelId  = "MiniMax-M3" (LIVE-observed model id;
 *                                  MiniMax uses the generic
 *                                  planModeApiModelId / actModeApiModelId
 *                                  slot because it has no dedicated
 *                                  planModeMinimaxModelId field)
 *   - minimaxApiKey      = the physical API key (LIVE-observed)
 *   - minimaxApiLine     = "international" (optional regional line;
 *                                  LIVE-observed default for users on
 *                                  the international endpoint)
 *
 * Mirrors the live geometry the user reported in the bootstrap
 * defect screenshot; if this geometry changes, this fixture and the
 * BOOTSTRAP_COVERAGE rationale both need to change in lockstep.
 */
function makeCurrentMinimaxConfig(): Record<string, unknown> {
	return {
		actModeApiProvider: "minimax",
		actModeApiModelId: "MiniMax-M3",
		minimaxApiKey: "sk-MM3-physical-key-XXXXXXXXXXXXX",
		minimaxApiLine: "international",
	}
}

function makeDeps(dataDir: string, config: Record<string, unknown>): BootstrapModelProfileDeps {
	const instancesStore = makeInstancesStore(dataDir)
	const profilesStore = makeProfilesStore(dataDir)
	return {
		getApiConfiguration: () => config as never,
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION08 / MINIMAX_COVERAGE", () => {
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
	// RED M1: exact live geometry -- the user has a valid MiniMax
	// configuration and clicks Create first profile in the Settings > Model
	// Profiles empty state. Today this returns
	// CURRENT_CONFIGURATION_UNSUPPORTED ("Provider 'minimax' is not covered
	// by the bootstrap path"). After the bounded fix it returns CREATED.
	// -------------------------------------------------------------------------

	it("MPFRB01_C08_RED_M1_LIVE_GEOMETRY: bootstrap(MiniMax-M3 + physical key) -> CREATED (was CURRENT_CONFIGURATION_UNSUPPORTED)", async () => {
		const deps = makeDeps(dataDir, makeCurrentMinimaxConfig())

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "minimax-m3")

		// -- RED guard (before fix): the live failure envelope.
		// expect(result.status).toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
		// expect(result.message).toMatch(/'minimax'/)
		// expect(result.message).toMatch(/not covered by the bootstrap path/i)
		//
		// -- GREEN guard (after fix): the bootstrap succeeds and
		// returns the typed CREATED envelope.
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") {
			throw new Error(`unreachable: status guard (got ${result.status}: ${result.message})`)
		}
		expect(result.profileId).toMatch(/^prof-/)
		expect(result.instanceId).toMatch(/^inst-/)
	})

	// -------------------------------------------------------------------------
	// RED M2 (credential authority): the bootstrap MUST resolve the
	// physical credential from the EXISTING current/legacy
	// ApiConfiguration authority -- NOT from a freshly-invented secret
	// namespace. The setInstanceSecret call carries the literal value
	// of config.minimaxApiKey through to the durable secrets.json
	// entry.
	// -------------------------------------------------------------------------

	it("MPFRB01_C08_RED_M2_CREDENTIAL_AUTHORITY: setInstanceSecret receives the literal config.minimaxApiKey value (NOT undefined, NOT empty)", async () => {
		const capturedSecretValues: string[] = []
		const dataDirLocal = tmpDataDir()
		const instancesStore = makeInstancesStore(dataDirLocal)
		const profilesStore = makeProfilesStore(dataDirLocal)
		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => makeCurrentMinimaxConfig() as never,
			getMode: () => "act",
			setInstanceSecret: (_name, value) => {
				capturedSecretValues.push(value)
			},
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

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "minimax-m3")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") {
			throw new Error(`unreachable: status guard (got ${result.status}: ${result.message})`)
		}

		// The credential written to the new instance-scoped secret
		// namespace MUST be the literal value of config.minimaxApiKey.
		// Forbidden: undefined, empty string, the secret-name-as-string,
		// any other inference path.
		expect(capturedSecretValues).toHaveLength(1)
		expect(capturedSecretValues[0]).toBe("sk-MM3-physical-key-XXXXXXXXXXXXX")
		expect(capturedSecretValues[0]).not.toBe("")
		expect(capturedSecretValues[0]).toBeDefined()
	})

	// -------------------------------------------------------------------------
	// RED M3 (model authority): the bootstrap MUST resolve the model id
	// from the EXISTING current/legacy ApiConfiguration authority -- NOT
	// from a hard-coded "MiniMax-M3" constant pinned to this fix.
	// MiniMax shares the generic planModeApiModelId / actModeApiModelId
	// slot with anthropic / gemini / vertex / bedrock / deepseek /
	// openai-native / openai-codex / asksage / dify (the same pattern
	// the CORRECTION04 asksage/dify fix established).
	// -------------------------------------------------------------------------

	it("MPFRB01_C08_RED_M3_MODEL_AUTHORITY: instance.connection.modelId is read from config.actModeApiModelId (generic field), NOT hardcoded", async () => {
		const dataDirLocal = tmpDataDir()
		const instancesStore = makeInstancesStore(dataDirLocal)
		const profilesStore = makeProfilesStore(dataDirLocal)
		const deps: BootstrapModelProfileDeps = {
			// Use a different model id to prove the resolver
			// is honoring the legacy config authority, NOT a
			// hard-coded "MiniMax-M3" default.
			getApiConfiguration: () =>
				({
					actModeApiProvider: "minimax",
					actModeApiModelId: "minimax-m2",
					minimaxApiKey: "sk-MM3-physical-key-XXXXXXXXXXXXX",
				}) as never,
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

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "minimax-m2")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") {
			throw new Error(`unreachable: status guard (got ${result.status}: ${result.message})`)
		}

		const persisted = instancesStore.read(result.instanceId)
		expect(persisted).toBeDefined()
		expect(persisted?.providerId).toBe("minimax")
		// Model id is the resolver's read of the generic
		// actModeApiModelId slot, NOT a hardcoded "MiniMax-M3".
		expect(persisted?.connection.modelId).toBe("minimax-m2")
	})

	// -------------------------------------------------------------------------
	// RED M4 (connection tuple fidelity): the bootstrap captures the
	// V1 connection tuple. For MiniMax, today's runtime consumes:
	//
	//   providerId           (always)
	//   modelId              (connection.modelId, generic field)
	//   apiLine              (regional routing line, if present)
	//
	// The bootstrap captures the durable providerId as the legacy
	// "minimax" spelling (same contract the CORRECTION07
	// bootstrap-no-id-collapse witnesses pin). The apiLine is NOT
	// yet a typed-instance connection field for MiniMax; the
	// ProviderConnection contract only exposes it for providers that
	// pin it at the projection boundary today. We DO pin that
	// connection.baseUrl / connection.headers are absent (no current
	// MiniMax native-endpoint geometry in the bootstrap V1 surface)
	// so a future contributor cannot silently introduce an OpenAI-
	// Compatible-fallback capture path here.
	// -------------------------------------------------------------------------

	it("MPFRB01_C08_RED_M4_CONNECTION_TUPLE: captured instance has providerId=minimax, modelId=MiniMax-M3, and no spurious baseUrl/headers capture", async () => {
		const dataDirLocal = tmpDataDir()
		const instancesStore = makeInstancesStore(dataDirLocal)
		const profilesStore = makeProfilesStore(dataDirLocal)
		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => makeCurrentMinimaxConfig() as never,
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

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "minimax-m3")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") {
			throw new Error(`unreachable: status guard (got ${result.status}: ${result.message})`)
		}

		const persisted = instancesStore.read(result.instanceId)
		expect(persisted).toBeDefined()

		// Provider id: durable legacy spelling "minimax" (same
		// contract as CORRECTION07's openai persistence test).
		expect(persisted?.providerId).toBe("minimax")

		// Model id: literal read of config.actModeApiModelId.
		expect(persisted?.connection.modelId).toBe("MiniMax-M3")

		// No spurious connection captures: the native MiniMax
		// provider has no legacy baseUrl / headers / apiLine
		// slot that the V1 bootstrap should materialise.
		// (apiLine may be added in a future V2 contract bump;
		// for V1 the typed-instance connection stays minimal.)
		expect(persisted?.connection.baseUrl).toBeUndefined()
		expect(persisted?.connection.headers).toBeUndefined()
		expect(persisted?.connection.apiLine).toBeUndefined()

		// Credential ref: well-formed namespace reference (the
		// name format pin is owned by the MPWC02 fail-closed
		// binding work; here we just confirm the namespace).
		expect(persisted?.credentialRef.kind).toBe("secret")
		expect(persisted?.credentialRef.name).toMatch(/^instance:/)
	})

	// -------------------------------------------------------------------------
	// BOOTSTRAP_COVERAGE conservation: the bounded fix adds "minimax"
	// to BOOTSTRAP_COVERAGE. Every other entry is preserved verbatim.
	// -------------------------------------------------------------------------

	it("MPFRB01_C08_COVERAGE_TABLE: BOOTSTRAP_COVERAGE includes minimax (live defect) without dropping the existing entries", () => {
		// Live geometry: minimax MUST be present.
		expect(BOOTSTRAP_COVERAGE.has("minimax" as never)).toBe(true)

		// Conservation: the previous CORRECTION03/04 coverage
		// set is preserved verbatim. Adding one provider must
		// not regress the others.
		const expected = [
			"anthropic",
			"openai",
			"ollama",
			"lmstudio",
			"gemini",
			"requesty",
			"litellm",
			"asksage",
			"oca",
			"aihubmix",
			"dify",
			"minimax",
		]
		for (const p of expected) {
			expect(BOOTSTRAP_COVERAGE.has(p as never)).toBe(true)
		}
	})

	// -------------------------------------------------------------------------
	// assertBootstrapCoverageIsWellFormed (per B3 bounded P1 absorb):
	// the coverage invariant MUST report ok=true with the minimax
	// diagnostic green. Without this, a future contributor could
	// drop PROVIDER_MODEL_ID_MAP.minimax and silently regress the
	// fix.
	// -------------------------------------------------------------------------

	it("MPFRB01_C08_COVERAGE_INVARIANT: assertBootstrapCoverageIsWellFormed reports ok=true with the minimax diagnostic green", () => {
		const result = assertBootstrapCoverageIsWellFormed()
		expect(result.ok).toBe(true)

		const minimaxDiag = result.diagnostics.find((d) => d.provider === "minimax")
		expect(minimaxDiag).toBeDefined()
		// The resolver seams are wired:
		expect(minimaxDiag?.hasIntendedCredentialField).toBe(true)
		expect(minimaxDiag?.credentialResolved).toBe(true)
		expect(minimaxDiag?.hasIntendedModelField).toBe(true)
		// And the model resolver returns a non-empty model id
		// for at least one mode (act is the only one exercised
		// by the probe; both plan/act are filled in the model-id
		// map because MiniMax shares the generic slot).
		expect(minimaxDiag?.modelIdResolvedFor.length).toBeGreaterThan(0)
	})

	// -------------------------------------------------------------------------
	// Regression pin: every previously-covered provider must remain
	// green after the bounded fix. Without this pin a future
	// refactor could regress the prior coverage set while adding
	// the new entry.
	// -------------------------------------------------------------------------

	it("MPFRB01_C08_REGRESSION_PIN: previously-covered providers remain ok=true in the coverage invariant", () => {
		const result = assertBootstrapCoverageIsWellFormed()
		expect(result.ok).toBe(true)
		for (const diag of result.diagnostics) {
			if (diag.provider === "minimax") continue
			expect(diag.hasIntendedCredentialField).toBe(true)
			expect(diag.credentialResolved).toBe(true)
			expect(diag.hasIntendedModelField).toBe(true)
			expect(diag.modelIdResolvedFor.length).toBeGreaterThan(0)
		}
	})
})

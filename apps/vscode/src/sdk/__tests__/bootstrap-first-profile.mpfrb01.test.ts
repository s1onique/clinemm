/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B1
 *
 * MP-B1 RED -> GREEN witness: a user with ZERO existing ModelProfile
 * records and ZERO existing ProviderConfigurationInstance records, but
 * with a valid legacy/current `ApiConfiguration`, can materialize
 * their FIRST profile via the new
 * `bootstrapModelProfileFromCurrentConfiguration` primitive.
 *
 * What this test proves (per the 2026-09-07 in-place amendment):
 *
 *   1. The physical credential is resolved from the EXISTING
 *      current/legacy `ApiConfiguration` authority (the
 *      `apiKey` field on the per-provider slot) - NOT from
 *      `getInstanceSecret(NEW_NAME)` (the namespace does not
 *      yet exist for a first-run user).
 *   2. A fresh opaque `instanceId` is generated.
 *   3. The canonical `InstanceSecretName` is derived via
 *      `nameFor(instanceId)` and matches the required pattern.
 *   4. `setInstanceSecret(name, physical-key-B)` is called and
 *      reads back the literal physical key (NOT the reference
 *      name, NOT empty).
 *   5. `InstancesStore.upsert` persists an instance C whose
 *      `credentialRef.name === name` and whose connection
 *      tuple matches the source config (providerId, modelId).
 *   6. `ProfilesStore.upsert` persists a profile P that
 *      references the new instanceId.
 *   7. The returned `BootstrapModelProfileResult` is
 *      `{ status: "CREATED", profileId, instanceId }`.
 *
 * Conservation:
 *   - Does NOT call `providerId`-equality matching anywhere.
 *   - Does NOT call `getInstanceSecret(NEW_NAME)`.
 *   - Does NOT mutate the existing `saveCurrentAsModelProfile`
 *     semantics (frozen by `BOOTSTRAP_RPC` freeze).
 *
 * Production seams driven (this file):
 *
 *   bootstrapModelProfileFromCurrentConfiguration = REAL_PRODUCTION_SEAM
 *   resolveApiKey (cline-session-factory)         = REAL_PRODUCTION_SEAM
 *   resolveModelId (cline-session-factory)        = REAL_PRODUCTION_SEAM
 *   resolveBaseUrl (cline-session-factory)        = REAL_PRODUCTION_SEAM
 *   InstancesStore.upsert                         = REAL_PRODUCTION_SEAM
 *   ProfilesStore.upsert                          = REAL_PRODUCTION_SEAM
 *   setInstanceSecret                             = REAL_PRODUCTION_SEAM
 *   writeActiveProfileIdToHistoryItem             = REAL_PRODUCTION_SEAM
 *   nameFor (instance-secret helper)              = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed (intentionally):
 *
 *   getApiConfiguration                = SYNTHETIC (in-memory)
 *   getMode                            = SYNTHETIC (returns "act")
 *   getCurrentTaskHistoryItem          = SYNTHETIC (no task)
 *   writeTaskHistoryItem               = SYNTHETIC (not exercised)
 *   postStateToWebview                 = SYNTHETIC (no-op)
 */


import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	bootstrapModelProfileFromCurrentConfiguration,
	type BootstrapModelProfileDeps,
} from "../profile-store/bootstrap"
import { InstancesStore } from "../instance-store/instances-store"
import { ProfilesStore } from "../profile-store/profiles-store"
import {
	INSTANCE_SECRET_NAME_PATTERN,
	nameFor,
	type InstanceSecretName,
} from "@/shared/storage/instance-secret"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDataDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mpfrb01-b1-"))
}

function makeInstancesStore(dataDir: string): InstancesStore {
	return new InstancesStore({ filePath: path.join(dataDir, "instances.json") })
}

function makeProfilesStore(dataDir: string): ProfilesStore {
	return new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
}

/**
 * The "current" ApiConfiguration for a user who has configured Anthropic
 * with a literal physical API key. This is the SOURCE OF TRUTH for the
 * credential the bootstrap primitive must read from.
 *
 * The providerId field is `anthropic` so the test exercises the
 * `anthropicBaseUrl` and `anthropicApiKey` slot in `ApiConfiguration`.
 * modelId is `claude-sonnet-4-6` to mimic a freshly-configured user.
 */
function makeCurrentAnthropicConfig(): Record<string, unknown> {
	return {
		actModeApiProvider: "anthropic",
		actModeApiModelId: "claude-sonnet-4-6",
		// Anthropic uses the generic `apiKey` field per
		// PROVIDER_API_KEY_MAP in cline-session-factory.ts:409.
		apiKey: "sk-ant-physical-key-B-XXXXXXXXXXXX",
		// No anthropicBaseUrl - the user is using the default endpoint.
		// resolveBaseUrl should return undefined and captureConnection
		// should leave `connection.baseUrl` absent.
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B1 first-profile causal chain", () => {
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

	it("MPFRB01_B1_HAPPY_PATH: bootstrap creates the exact instance + secret + profile from the legacy config", async () => {
		const config = makeCurrentAnthropicConfig()
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)
		const secretsWritten = new Map<string, string>()

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: (name, value) => {
				secretsWritten.set(name as string, value)
			},
			instancesStore,
			profilesStore,
			getCurrentTaskHistoryItem: () => undefined,
			writeTaskHistoryItem: undefined,
			postStateToWebview: undefined,
			// Deterministic ids so the assertions are stable.
			now: () => 1700000000000,
			generateId: (() => {
				let n = 0
				return () => {
					n++
					return `deterministic-${n}`
				}
			})(),
		}

		// -- Sanity: zero instances, zero profiles at start
		expect(Object.keys(instancesStore.list())).toHaveLength(0)
		expect(Object.keys(profilesStore.list())).toHaveLength(0)

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "My first")

		// -- Step 7: result is CREATED with profileId + instanceId
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")
		expect(result.profileId).toBe("prof-deterministic-2") // profile is the 2nd generated id (instance was 1st)
		expect(result.instanceId).toBe("inst-deterministic-1")

		// -- Step 1+4: physical credential was resolved from the
		// CURRENT/LEGACY `ApiConfiguration.anthropicApiKey` field
		// and written to the NEW instance-scoped namespace
		const expectedSecretName = nameFor(result.instanceId) as InstanceSecretName
		expect(secretsWritten.has(expectedSecretName)).toBe(true)
		expect(secretsWritten.get(expectedSecretName)).toBe(
			"sk-ant-physical-key-B-XXXXXXXXXXXX",
		)
		// The stored secret MUST be the literal physical key, not
		// the reference name and not empty.
		expect(secretsWritten.get(expectedSecretName)).not.toBe(expectedSecretName)
		expect(secretsWritten.get(expectedSecretName)).not.toBe("")
		expect(secretsWritten.get(expectedSecretName)).not.toMatch(/^instance:/)

		// -- Step 3+5: the secret name matches INSTANCE_SECRET_NAME_PATTERN
		expect(INSTANCE_SECRET_NAME_PATTERN.test(expectedSecretName)).toBe(true)
		expect(expectedSecretName).toBe(`instance:${result.instanceId}`)

		// -- Step 5: an instance was persisted with the matching
		// credentialRef and connection tuple
		const instances = instancesStore.list()
		expect(Object.keys(instances)).toHaveLength(1)
		const persistedInstance = instances[result.instanceId]
		expect(persistedInstance).toBeDefined()
		expect(persistedInstance.instanceId).toBe(result.instanceId)
		expect(persistedInstance.providerId).toBe("anthropic")
		expect(persistedInstance.credentialRef).toEqual({
			kind: "secret",
			name: expectedSecretName,
		})
		expect(persistedInstance.connection.modelId).toBe("claude-sonnet-4-6")
		// baseUrl was absent on the source config, so it should
		// remain absent on the captured connection (NOT null).
		expect(persistedInstance.connection.baseUrl).toBeUndefined()
		expect(persistedInstance.createdAt).toBe(1700000000000)
		expect(persistedInstance.updatedAt).toBe(1700000000000)

		// -- Step 6: a profile was persisted referencing the new id
		const profiles = profilesStore.list()
		expect(Object.keys(profiles)).toHaveLength(1)
		const persistedProfile = profiles[result.profileId]
		expect(persistedProfile).toBeDefined()
		expect(persistedProfile.profileId).toBe(result.profileId)
		expect(persistedProfile.name).toBe("My first")
		expect(persistedProfile.providerInstanceId).toBe(result.instanceId)
		expect(persistedProfile.modelId).toBe("claude-sonnet-4-6")
	})

	it("MPFRB01_B1_NO_CURRENT_TASK: bootstrap returns CREATED, not CREATED_BINDING_FAILED, when there is no current task", async () => {
		// Per the reviewer's "closely related precision" correction:
		// not having a current task is NOT a warning. It is a clean
		// CREATED with no binding step.
		const config = makeCurrentAnthropicConfig()
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: () => {},
			instancesStore,
			profilesStore,
			getCurrentTaskHistoryItem: () => undefined, // no task
			writeTaskHistoryItem: undefined,
			postStateToWebview: undefined,
		}

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "My first")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")
		expect(result.profileId).toMatch(/^prof-/)
		expect(result.instanceId).toMatch(/^inst-/)
	})

	it("MPFRB01_B1_NO_CURRENT_CONFIGURATION: bootstrap returns typed failure when active mode's provider is unset", async () => {
		const config = { actModeApiProvider: undefined, actModeApiModelId: undefined }
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: () => {},
			instancesStore,
			profilesStore,
		}

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "My first")
		expect(result.status).toBe("NO_CURRENT_CONFIGURATION")
		if (result.status !== "NO_CURRENT_CONFIGURATION") throw new Error("unreachable")
		expect(result.message).toMatch(/No provider configured for act mode/)

		// -- Conservation: zero instances, zero profiles on disk
		expect(Object.keys(instancesStore.list())).toHaveLength(0)
		expect(Object.keys(profilesStore.list())).toHaveLength(0)
	})

	it("MPFRB01_B1_MISSING_CREDENTIAL: bootstrap returns typed failure when resolveApiKey returns undefined", async () => {
		// User configured Anthropic but did NOT provide an API key.
		// This is the load-bearing case: the bootstrap MUST NOT
		// silently coerce to an empty/invalid credential.
		const config = {
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
			// Anthropic uses the generic `apiKey` field per
			// PROVIDER_API_KEY_MAP. Intentionally empty.
			apiKey: "",
		}
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: () => {},
			instancesStore,
			profilesStore,
		}

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "My first")
		expect(result.status).toBe("MISSING_CREDENTIAL")
		if (result.status !== "MISSING_CREDENTIAL") throw new Error("unreachable")
		expect(result.message).toMatch(/No API key is configured for 'anthropic'/)

		// -- Conservation: zero instances, zero profiles on disk
		expect(Object.keys(instancesStore.list())).toHaveLength(0)
		expect(Object.keys(profilesStore.list())).toHaveLength(0)
	})

	it("MPFRB01_B1_CURRENT_CONFIGURATION_UNSUPPORTED: bootstrap refuses providers outside BOOTSTRAP_COVERAGE", async () => {
		// `together` is in the ApiProvider union but is NOT in
		// BOOTSTRAP_COVERAGE - bootstrap should refuse rather than
		// silently guess at credential resolution.
		const config = {
			actModeApiProvider: "together",
			actModeApiModelId: "some-model",
			togetherApiKey: "tk-XXXXXX",
		}
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: () => {},
			instancesStore,
			profilesStore,
		}

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "My first")
		expect(result.status).toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
		if (result.status !== "CURRENT_CONFIGURATION_UNSUPPORTED") throw new Error("unreachable")
		expect(result.message).toMatch(/Provider 'together' is not covered/)
	})

	it("MPFRB01_B1_BOUNDARY: bootstrap does NOT use providerId-equality matching when an existing unrelated instance has the same providerId", async () => {
		// Regression guard for the B2 invariant: even when an
		// instance with the SAME providerId already exists, the
		// bootstrap primitive MUST NOT short-circuit on
		// `Object.values(instances).find(i => i.providerId === X)`.
		// It MUST create a fresh instance with a fresh id.
		const config = makeCurrentAnthropicConfig()
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		// Pre-existing unrelated same-providerId instance.
		instancesStore.upsert({
			instanceId: "inst-pre-existing-A",
			providerId: "anthropic",
			displayLabel: "Preexisting A",
			credentialRef: { kind: "secret", name: "instance:inst-pre-existing-A" as InstanceSecretName },
			connection: { modelId: "claude-haiku-old" },
			createdAt: 1,
			updatedAt: 1,
		})

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: () => {},
			instancesStore,
			profilesStore,
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
		if (result.status !== "CREATED") throw new Error("unreachable")

		// -- A NEW instance was created; the pre-existing one was
		// not selected, mutated, or aliased
		const instances = instancesStore.list()
		expect(Object.keys(instances).sort()).toEqual(["inst-deterministic-1", "inst-pre-existing-A"])
		expect(result.instanceId).toBe("inst-deterministic-1")
		expect(result.instanceId).not.toBe("inst-pre-existing-A")
		expect(instances["inst-pre-existing-A"].connection.modelId).toBe("claude-haiku-old")
		expect(instances["inst-deterministic-1"].connection.modelId).toBe("claude-sonnet-4-6")
	})
})

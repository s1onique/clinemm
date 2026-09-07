/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B2
 *
 * MP-B2 RED -> GREEN witness (the strongest invariant): when two
 * ProviderConfigurationInstance records with the SAME providerId
 * already exist (and the current ApiConfiguration is NOT bound to
 * either), a bootstrap creates a THIRD instance that matches the
 * current config exactly. It does NOT pick A or B.
 *
 * Why this is the load-bearing invariant:
 *   The MPWC01 C3 fix correctly removed the unsafe
 *   `Object.values(instances).find(i => i.providerId === X)`
 *   short-circuit in `saveCurrentAsModelProfile`. The B2 witness
 *   asserts that the new `bootstrapModelProfileFromCurrentConfiguration`
 *   path does NOT reintroduce that identity-collapse bug under a
 *   different name. The current path MUST always materialize a
 *   fresh opaque `instanceId` and never reuse a stored instance by
 *   providerId equality.
 *
 * What this test proves:
 *
 *   1. Two pre-existing instances with providerId="openai" (the
 *      legacy spelling; the SDK "openai-compatible" id is folded
 *      to "openai" by toLegacyApiProvider) are seeded (A and B)
 *      with different baseUrl/headers/credential.
 *   2. The current ApiConfiguration specifies a THIRD distinct
 *      provider instance (C) with a different baseUrl/headers.
 *   3. The bootstrap primitive is invoked.
 *   4. The primitive creates an instance C whose instanceId is
 *      distinct from A and B.
 *   5. C's connection tuple matches the current config exactly.
 *   6. C's credentialRef resolves to the CURRENT config's
 *      credential, NOT to A's or B's credential.
 *   7. A and B are untouched (no aliasing, no field mutation).
 *
 * Conservation:
 *   - ProviderId-equality matching MUST NOT appear anywhere in the
 *     bootstrap path (verified by inspection of the source after the
 *     GREEN pass).
 *   - The new instanceId is opaque; the bootstrap never reuses a
 *     stored instanceId even if all other fields match.
 *
 * Production seams driven (this file):
 *
 *   bootstrapModelProfileFromCurrentConfiguration = REAL_PRODUCTION_SEAM
 *   resolveApiKey (cline-session-factory)         = REAL_PRODUCTION_SEAM
 *   resolveModelId (cline-session-factory)        = REAL_PRODUCTION_SEAM
 *   resolveBaseUrl (cline-session-factory)        = REAL_PRODUCTION_SEAM
 *   InstancesStore.upsert                         = REAL_PRODUCTION_SEAM
 *   ProfilesStore.upsert                          = REAL_PRODUCTION_SEAM
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
import { nameFor, type InstanceSecretName } from "@/shared/storage/instance-secret"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tmpDataDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mpfrb01-b2-"))
}

function makeInstancesStore(dataDir: string): InstancesStore {
	return new InstancesStore({ filePath: path.join(dataDir, "instances.json") })
}

function makeProfilesStore(dataDir: string): ProfilesStore {
	return new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
}

interface PreExistingInstance {
	instanceId: string
	baseUrl: string
	headers: Record<string, string>
	apiKey: string
}

function seedPreExistingInstance(
	instancesStore: InstancesStore,
	spec: PreExistingInstance,
): void {
	instancesStore.upsert({
		instanceId: spec.instanceId,
		providerId: "openai-compatible",
		displayLabel: spec.instanceId,
		credentialRef: {
			kind: "secret",
			name: nameFor(spec.instanceId),
		},
		connection: {
			modelId: `model-${spec.instanceId}`,
			baseUrl: spec.baseUrl,
			headers: spec.headers,
		},
		createdAt: 1,
		updatedAt: 1,
	})
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B2 no-providerId-collapse", () => {
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

	it("MPFRB01_B2_THIRD_INSTANCE: bootstrap creates a THIRD instance that matches the current config exactly when two same-providerId instances already exist", async () => {
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)
		const secretsWritten = new Map<string, string>()

		// -- Seed two same-providerId instances (A and B). They
		// are deliberately distinct: different baseUrl, different
		// headers, different credentials. A naive providerId match
		// would pick whichever one `Object.values(instances).find`
		// happens to return first - the bug we're guarding against.
		seedPreExistingInstance(instancesStore, {
			instanceId: "inst-A",
			baseUrl: "https://endpoint-A.example/v1",
			headers: { "X-A": "1" },
			apiKey: "physical-key-A",
		})
		seedPreExistingInstance(instancesStore, {
			instanceId: "inst-B",
			baseUrl: "https://endpoint-B.example/v1",
			headers: { "X-B": "2" },
			apiKey: "physical-key-B",
		})

		// -- The CURRENT unbound configuration is a THIRD distinct
		// instance (C). The user has not bound any profile; the
		// current ApiConfiguration just happens to share the
		// `openai` providerId with both A and B.
		const currentConfig = {
			actModeApiProvider: "openai",
			// openai uses the dedicated actModeOpenAiModelId field per
			// PROVIDER_MODEL_ID_MAP (cline-session-factory.ts:464).
			actModeOpenAiModelId: "model-C",
			openAiApiKey: "physical-key-C-XXXXXXXXXXXX",
			openAiBaseUrl: "https://endpoint-C.example/v1",
		}

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => currentConfig as unknown as ReturnType<BootstrapModelProfileDeps["getApiConfiguration"]>,
			getMode: () => "act",
			setInstanceSecret: (name, value) => {
				secretsWritten.set(name as string, value)
			},
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

		// -- Step 1: result is CREATED, not a typed failure
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")

		// -- Step 2: the new instanceId is DISTINCT from A and B
		expect(result.instanceId).not.toBe("inst-A")
		expect(result.instanceId).not.toBe("inst-B")
		expect(result.instanceId).toMatch(/^inst-deterministic-/)

		// -- Step 3: a THIRD instance now exists (A, B, and the
		// new one - three in total)
		const instances = instancesStore.list()
		expect(Object.keys(instances).sort()).toEqual([
			"inst-A",
			"inst-B",
			"inst-deterministic-1",
		])

		// -- Step 4: A and B are UNTOUCHED (no aliasing, no field
		// mutation). This is the regression guard for the B2
		// invariant: the bootstrap MUST NOT reuse or mutate a
		// stored instance by providerId equality.
		expect(instances["inst-A"].connection.baseUrl).toBe("https://endpoint-A.example/v1")
		expect(instances["inst-A"].connection.headers).toEqual({ "X-A": "1" })
		expect(instances["inst-A"].connection.modelId).toBe("model-inst-A")
		expect(instances["inst-B"].connection.baseUrl).toBe("https://endpoint-B.example/v1")
		expect(instances["inst-B"].connection.headers).toEqual({ "X-B": "2" })
		expect(instances["inst-B"].connection.modelId).toBe("model-inst-B")

		// -- Step 5: the new instance matches the CURRENT config
		// exactly (providerId, modelId, baseUrl)
		const instC = instances["inst-deterministic-1"]
		expect(instC.providerId).toBe("openai")
		expect(instC.connection.modelId).toBe("model-C")
		expect(instC.connection.baseUrl).toBe("https://endpoint-C.example/v1")

		// -- Step 6: the credentialRef resolves to the CURRENT
		// config's credential (physical-key-C), NOT to A's or B's
		// credential (physical-key-A or physical-key-B).
		const expectedSecretName = nameFor("inst-deterministic-1") as InstanceSecretName
		expect(instC.credentialRef).toEqual({
			kind: "secret",
			name: expectedSecretName,
		})
		expect(secretsWritten.get(expectedSecretName)).toBe(
			"physical-key-C-XXXXXXXXXXXX",
		)
		expect(secretsWritten.get(expectedSecretName)).not.toBe("physical-key-A")
		expect(secretsWritten.get(expectedSecretName)).not.toBe("physical-key-B")

		// -- Step 7: A's and B's instance-secret names are
		// untouched (no aliasing, no cross-write).
		expect(secretsWritten.get(nameFor("inst-A") as InstanceSecretName)).toBeUndefined()
		expect(secretsWritten.get(nameFor("inst-B") as InstanceSecretName)).toBeUndefined()
	})
})

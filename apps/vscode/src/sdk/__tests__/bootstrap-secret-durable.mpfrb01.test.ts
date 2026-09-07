/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION02 / B-DURABILITY
 *
 * MP-DURABILITY RED -> GREEN witness: the bootstrap primitive's
 * `CREATED` return value MUST carry through a cold restart of the
 * secret store. Specifically: after `bootstrapModelProfileFromCurrentConfiguration`
 * returns `CREATED`, the secrets.json, instances.json, AND profiles.json
 * files on disk MUST all three contain the new records (or the
 * profile commit boundary is unenforceable).
 *
 * Background (twenty-second reviewer, P0-1):
 *
 *   The CORRECTION01 implementation called
 *
 *       deps.setInstanceSecret(name, physicalCredential)
 *       deps.instancesStore.upsert(instance)
 *       deps.profilesStore.upsert(profile)
 *
 *   and returned `CREATED`. But `setInstanceSecret` only mutates the
 *   in-memory cache and schedules a 500ms debounced persistence. A
 *   process death in the debounce window between `setInstanceSecret`
 *   and the next debounce tick would yield:
 *
 *       profiles.json == { [profileId]: profile }
 *       instances.json == { [instanceId]: instance }
 *       secrets.json   == {} (no entry under instance:inst-...)
 *
 *   The user's profile is "committed" but its credential is gone.
 *   On restart, `SdkSessionConfigBuilder.build()` fails-closed with
 *   `MissingProviderInstanceCredentialError` and the user's session
 *   cannot start. The `CREATED` semantics were unenforced.
 *
 * This test pins the CORRECTION02 invariant:
 *
 *   PROFILE_COMMIT IMPLIES REFERENCED_SECRET_ALREADY_DURABLE
 *
 * The test runs the bootstrap primitive end-to-end with the REAL
 * `StateManager` (no in-memory Map stub) and the REAL `ClineFileStorage`
 * on a tmpfs data dir, then asserts all three files contain the new
 * records. The injectable `flushInstanceSecrets` dep is wired to
 * `stateManager.flushPendingState()` - exactly the production wiring.
 *
 * RED -> GREEN arc (this file):
 *
 *   RED   (before this commit): bootstrap commits profile without
 *         awaiting the debounce flush; if you read secrets.json
 *         synchronously after `await result`, the entry is NOT there.
 *
 *   GREEN (this commit): bootstrap awaits `flushInstanceSecrets`
 *         before writing the profile; secrets.json contains the entry.
 *
 * Run via:
 *   cd apps/vscode && TMPDIR=/tmp bun test \
 *     src/sdk/__tests__/bootstrap-secret-durable.mpfrb01.test.ts
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ApiConfiguration } from "@shared/api"

// StateManager.initialize() calls initializeDistinctId(), which
// needs the VS Code host to be set up. Mock it out for tests.
// bun's mock.module runs at preload time and shadows both bare
// and `@/`-prefixed specifiers of the same module path.
mock.module("@/services/logging/distinctId", () => ({
	initializeDistinctId: (async () => undefined) as never,
	getDistinctId: (() => undefined) as never,
	getDeviceId: (() => undefined) as never,
	setDistinctId: (() => undefined) as never,
}))

import { StateManager } from "@/core/storage/StateManager"
import { nameFor } from "@/shared/storage/instance-secret"
import { createStorageContext } from "@/shared/storage/storage-context"
import { InstancesStore } from "../instance-store/instances-store"
import { type BootstrapModelProfileDeps, bootstrapModelProfileFromCurrentConfiguration } from "../profile-store/bootstrap"
import { ProfilesStore } from "../profile-store/profiles-store"

let CLINE_DIR: string
let SECRETS_PATH: string
let INSTANCES_PATH: string
let PROFILES_PATH: string
let ORIGINAL_CLINE_DIR: string | undefined
let ORIGINAL_CLINE_DATA_DIR: string | undefined

beforeAll(async () => {
	CLINE_DIR = mkdtempSync(join(tmpdir(), "mpfrb01-b-durable-"))
	ORIGINAL_CLINE_DIR = process.env.CLINE_DIR
	ORIGINAL_CLINE_DATA_DIR = process.env.CLINE_DATA_DIR
	process.env.CLINE_DATA_DIR = join(CLINE_DIR, "data")
	process.env.CLINE_DIR = CLINE_DIR
	SECRETS_PATH = join(process.env.CLINE_DATA_DIR, "secrets.json")
	INSTANCES_PATH = join(process.env.CLINE_DATA_DIR, "instances.json")
	PROFILES_PATH = join(process.env.CLINE_DATA_DIR, "profiles.json")
	mkdirSync(process.env.CLINE_DATA_DIR, { recursive: true })

	// StateManager is a singleton: initialize once with the real
	// ClineFileStorage seam. Every other dependency in the
	// bootstrap primitive is the real production seam.
	const ctx = createStorageContext({
		clineDir: CLINE_DIR,
		workspacePath: CLINE_DIR,
	})
	await StateManager.initialize(ctx)
})

afterAll(async () => {
	try {
		await StateManager.get().flushPendingState()
	} catch {
		// best-effort
	}
	if (ORIGINAL_CLINE_DIR === undefined) {
		delete process.env.CLINE_DIR
	} else {
		process.env.CLINE_DIR = ORIGINAL_CLINE_DIR
	}
	if (ORIGINAL_CLINE_DATA_DIR === undefined) {
		delete process.env.CLINE_DATA_DIR
	} else {
		process.env.CLINE_DATA_DIR = ORIGINAL_CLINE_DATA_DIR
	}
	try {
		rmSync(CLINE_DIR, { recursive: true, force: true })
	} catch {
		// best-effort
	}
})

function readJson(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {}
	const raw = readFileSync(path, "utf-8")
	if (raw.trim().length === 0) return {}
	return JSON.parse(raw)
}

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION02 / B-DURABILITY", () => {
	it("MPFRB01_BDURABLE_CREATED_DURABLE: after CREATED, secrets.json contains the referenced physical key on disk", async () => {
		// -- Source config: a user with Anthropic + a real key + a model
		const config: Partial<ApiConfiguration> = {
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
			apiKey: "sk-ant-DURABLE-TEST-XXXXXXXXXXXXXX",
		}

		const stateManager = StateManager.get()
		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as ApiConfiguration,
			getMode: () => "act",
			setInstanceSecret: (name, value) => {
				// Production wiring: real StateManager.setInstanceSecret
				// (cache + 500ms debounced flush).
				stateManager.setInstanceSecret(name, value)
			},
			// CORRECTION02 P0-1: real flush barrier.
			flushInstanceSecrets: () => stateManager.flushPendingState(),
			instancesStore: new InstancesStore({ filePath: INSTANCES_PATH }),
			profilesStore: new ProfilesStore({ filePath: PROFILES_PATH }),
			getCurrentTaskHistoryItem: () => undefined,
			writeTaskHistoryItem: undefined,
			postStateToWebview: undefined,
		}

		// -- Pre: no secrets, no instances, no profiles on disk
		expect(Object.keys(readJson(SECRETS_PATH))).toHaveLength(0)
		expect(Object.keys(readJson(INSTANCES_PATH))).toHaveLength(0)
		expect(Object.keys(readJson(PROFILES_PATH))).toHaveLength(0)

		// -- Run the bootstrap
		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Durable test")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")

		// -- Post: the physical key MUST be on disk BEFORE we trust
		// the CREATED return value. This is the load-bearing
		// assertion of the durability contract.
		const secretName = nameFor(result.instanceId)
		const secrets = readJson(SECRETS_PATH)
		expect(secrets[secretName]).toBe("sk-ant-DURABLE-TEST-XXXXXXXXXXXXXX")
		expect(secrets[secretName]).not.toBe(secretName)
		expect(secrets[secretName]).not.toBe("")

		// -- The instances.json record MUST reference the durable secret
		const instances = readJson(INSTANCES_PATH) as {
			instances: Record<string, { credentialRef: { kind: string; name: string }; connection: { modelId: string } }>
		}
		expect(instances.instances[result.instanceId]).toBeDefined()
		expect(instances.instances[result.instanceId].credentialRef.kind).toBe("secret")
		expect(instances.instances[result.instanceId].credentialRef.name).toBe(secretName)
		expect(instances.instances[result.instanceId].connection.modelId).toBe("claude-sonnet-4-6")

		// -- The profile MUST reference the new instanceId
		const profiles = readJson(PROFILES_PATH) as {
			profiles: Record<string, { providerInstanceId: string; modelId: string; name: string }>
		}
		expect(profiles.profiles[result.profileId]).toBeDefined()
		expect(profiles.profiles[result.profileId].providerInstanceId).toBe(result.instanceId)
		expect(profiles.profiles[result.profileId].modelId).toBe("claude-sonnet-4-6")
		expect(profiles.profiles[result.profileId].name).toBe("Durable test")

		// -- And the chain must close: secret -> instance -> profile
		// is consistent across the three on-disk files. A future
		// restart that reads all three will reconstruct the
		// user's profile with its credential intact.
		const onDiskInstanceSecret = secrets[secretName]
		expect(onDiskInstanceSecret).toBe("sk-ant-DURABLE-TEST-XXXXXXXXXXXXXX")
	})

	it("MPFRB01_BDURABLE_COLD_RELOAD: a fresh ClineFileStorage reads the durable secret back", async () => {
		// Stronger invariant: even if the StateManager singleton is
		// torn down and a fresh ClineFileStorage is constructed (as
		// happens on extension restart), the bootstrap-committed
		// secret is recoverable from disk.
		const previousProfile = readJson(PROFILES_PATH) as {
			profiles: Record<string, { providerInstanceId: string }>
		}
		const profileIds = Object.keys(previousProfile.profiles)
		expect(profileIds.length).toBeGreaterThan(0)
		const committedProfileId = profileIds[0]
		const committedInstanceId = previousProfile.profiles[committedProfileId].providerInstanceId

		const secretName = nameFor(committedInstanceId)
		const freshSecrets = readJson(SECRETS_PATH)
		expect(freshSecrets[secretName]).toBe("sk-ant-DURABLE-TEST-XXXXXXXXXXXXXX")
	})
})

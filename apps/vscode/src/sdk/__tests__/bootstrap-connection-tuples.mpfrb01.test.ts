/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION02 / B-CONNECTION
 *
 * MP-CONNECTION RED -> GREEN witness (twenty-second reviewer P0-2).
 *
 * The bootstrap primitive MUST capture the EXACT V1 connection tuple
 * from the source ApiConfiguration. For the `openai` (OpenAI-
 * Compatible) provider, the bootstrap MUST capture
 * `config.openAiHeaders` (which the legacy config stores as a JSON-
 * encoded string) and emit it on `connection.headers` as a
 * `Record<string, string>` when the source has headers.
 *
 * Losing headers would silently re-introduce the MPWC01 C3
 * identity-collapse bug for OpenAI-Compatible users pointing at the
 * same baseUrl with different custom headers.
 *
 * Run via:
 *   cd apps/vscode && TMPDIR=/tmp bun test \
 *     src/sdk/__tests__/bootstrap-connection-tuples.mpfrb01.test.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { InstancesStore } from "../instance-store/instances-store"
import { type BootstrapModelProfileDeps, bootstrapModelProfileFromCurrentConfiguration } from "../profile-store/bootstrap"
import { ProfilesStore } from "../profile-store/profiles-store"

function tmpDataDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mpfrb01-b-conn-"))
}

function makeInstancesStore(dataDir: string): InstancesStore {
	return new InstancesStore({ filePath: path.join(dataDir, "instances.json") })
}

function makeProfilesStore(dataDir: string): ProfilesStore {
	return new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
}

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION02 / B-CONNECTION", () => {
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

	it("MPFRB01_BCONN_WITH_HEADERS: OpenAI config with JSON-encoded headers -> connection.headers preserves the parsed record", async () => {
		const headers = {
			"X-Tenant": "tenant-C",
			"X-Region": "eu-west-1",
			"Authorization-extra": "Bearer service-account-token",
		}
		const config = {
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "model-C",
			openAiApiKey: "physical-key-C",
			openAiBaseUrl: "https://gateway.example.invalid/v1",
			openAiHeaders: JSON.stringify(headers),
		}
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as never,
			getMode: () => "act",
			setInstanceSecret: () => {},
			flushInstanceSecrets: async () => {},
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
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")

		const instances = instancesStore.list()
		const persisted = instances[result.instanceId]
		expect(persisted).toBeDefined()

		expect(persisted.connection.headers).toBeDefined()
		expect(persisted.connection.headers).toEqual(headers)
		for (const [k, v] of Object.entries(headers)) {
			expect((persisted.connection.headers as Record<string, string>)[k]).toBe(v)
		}
	})

	it("MPFRB01_BCONN_NO_HEADERS: OpenAI config with NO openAiHeaders -> connection.headers is absent", async () => {
		const config = {
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "model-C",
			openAiApiKey: "physical-key-C",
			openAiBaseUrl: "https://gateway.example.invalid/v1",
		}
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as never,
			getMode: () => "act",
			setInstanceSecret: () => {},
			flushInstanceSecrets: async () => {},
			instancesStore,
			profilesStore,
		}

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Headerless")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")

		const persisted = instancesStore.list()[result.instanceId]
		expect(persisted.connection.headers).toBeUndefined()
		expect("headers" in persisted.connection).toBe(false)
	})

	it("MPFRB01_BCONN_ANTHROPIC_HAS_NO_HEADERS: Anthropic config -> connection.headers absent", async () => {
		const config = {
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
			apiKey: "sk-ant-XXXX",
		}
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as never,
			getMode: () => "act",
			setInstanceSecret: () => {},
			flushInstanceSecrets: async () => {},
			instancesStore,
			profilesStore,
		}

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Anthropic")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")

		const persisted = instancesStore.list()[result.instanceId]
		expect(persisted.connection.headers).toBeUndefined()
		expect("headers" in persisted.connection).toBe(false)
	})

	it("MPFRB01_BCONN_OBJECT_FORM_HEADERS: openAiHeaders as a plain object -> same captured record", async () => {
		const headers = {
			"X-Tenant": "tenant-D",
			"X-Region": "us-east-1",
		}
		const config = {
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "model-D",
			openAiApiKey: "physical-key-D",
			openAiBaseUrl: "https://gateway.example.invalid/v1",
			openAiHeaders: headers,
		}
		const instancesStore = makeInstancesStore(dataDir)
		const profilesStore = makeProfilesStore(dataDir)

		const deps: BootstrapModelProfileDeps = {
			getApiConfiguration: () => config as never,
			getMode: () => "act",
			setInstanceSecret: () => {},
			flushInstanceSecrets: async () => {},
			instancesStore,
			profilesStore,
		}

		const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Object form")
		expect(result.status).toBe("CREATED")
		if (result.status !== "CREATED") throw new Error("unreachable: status guard")

		const persisted = instancesStore.list()[result.instanceId]
		expect(persisted.connection.headers).toEqual(headers)
	})
})

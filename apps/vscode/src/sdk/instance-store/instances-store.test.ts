/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R3
 *
 * RED->GREEN witness for the instances.json definition store.
 *
 * The recon phase (evidence 06 sections 2 + 2b) froze:
 *
 *   instances.json
 *     version
 *     instances: Record<instanceId, ProviderConfigurationInstance>
 *
 *   NO: activeInstanceId, profile pointer, global default.
 *
 * R3 asserts that the durable store actually preserves identity
 * across create / read / close / reopen, and fails CLOSED on
 * corruption rather than silently defaulting to another instance.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	emptyInstancesFile,
	type ProviderConfigurationInstance,
} from "./contracts"
import { InstancesStore } from "./instances-store"

let tmpDir: string
let storePath: string

function makeInstance(
	instanceId: string,
	providerId: string,
	displayLabel: string,
	overrides: Partial<ProviderConfigurationInstance> = {},
): ProviderConfigurationInstance {
	const now = Date.now()
	return {
		instanceId,
		providerId,
		displayLabel,
		credentialRef: { kind: "secret", name: `instance:${instanceId}-key` },
		connection: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	}
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "piif01-instances-store-"))
	storePath = join(tmpDir, "instances.json")
})

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true })
	} catch {
		// best-effort
	}
})

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R3", () => {
	it("R3-01 creates A and B; reads back A==A and B==B (no cross-contamination)", () => {
		const store = new InstancesStore({ filePath: storePath })

		const A = makeInstance("inst-A", "openai-compatible", "Personal Anthropic", {
			connection: { baseUrl: "https://endpoint-A", modelId: "model-A" },
		})
		const B = makeInstance("inst-B", "openai-compatible", "Corporate OpenAI", {
			connection: { baseUrl: "https://endpoint-B", modelId: "model-B" },
		})

		store.upsert(A)
		store.upsert(B)

		const readA = store.read("inst-A")
		const readB = store.read("inst-B")
		expect(readA).toEqual(A)
		expect(readB).toEqual(B)

		// list() returns both, keyed by instanceId
		const list = store.list()
		expect(Object.keys(list).sort()).toEqual(["inst-A", "inst-B"])
		expect(list["inst-A"]).toEqual(A)
		expect(list["inst-B"]).toEqual(B)
	})

	it("R3-02 restart (close + reopen): A and B survive intact, no drift", () => {
		const store1 = new InstancesStore({ filePath: storePath })
		const A = makeInstance("inst-A", "anthropic", "Personal Anthropic", {
			connection: { baseUrl: "https://endpoint-A", modelId: "claude-opus-4" },
		})
		const B = makeInstance("inst-B", "anthropic", "Work Anthropic", {
			connection: { baseUrl: "https://endpoint-B", modelId: "claude-sonnet-4" },
		})
		store1.upsert(A)
		store1.upsert(B)

		// Reopen: brand-new InstancesStore against the same file.
		const store2 = new InstancesStore({ filePath: storePath })
		expect(store2.read("inst-A")).toEqual(A)
		expect(store2.read("inst-B")).toEqual(B)
	})

	it("R3-03 missing file on disk => store starts empty, no error", () => {
		const store = new InstancesStore({ filePath: storePath })
		expect(store.list()).toEqual({})
		expect(store.read("nonexistent")).toBeUndefined()
	})

	it("R3-04 corrupt file fails CLOSED (no silent default pick)", () => {
		// Write garbage that doesn't match the schema.
		writeFileSync(storePath, "{ not valid json", "utf-8")

		// The store MUST throw rather than silently returning an
		// empty file or fabricating an instance -- this is the
		// fail-closed invariant the recon phase froze.
		expect(() => new InstancesStore({ filePath: storePath })).toThrow()
	})

	it("R3-05 rename displayLabel does NOT change identity or secret key", () => {
		const store = new InstancesStore({ filePath: storePath })
		const A = makeInstance("inst-A", "anthropic", "Original Label")
		store.upsert(A)

		// Rename label; instanceId and credentialRef.name MUST stay.
		const renamed = { ...A, displayLabel: "Renamed Label", updatedAt: A.updatedAt + 1 }
		store.upsert(renamed)

		const read = store.read("inst-A")
		expect(read?.displayLabel).toBe("Renamed Label")
		expect(read?.credentialRef.name).toBe("instance:inst-A-key")
		expect(read?.instanceId).toBe("inst-A")
	})

	it("R3-06 delete: removed instance is no longer readable", () => {
		const store = new InstancesStore({ filePath: storePath })
		store.upsert(makeInstance("inst-A", "openai", "A"))
		store.upsert(makeInstance("inst-B", "openai", "B"))
		expect(store.read("inst-A")).toBeDefined()

		store.delete("inst-A")

		expect(store.read("inst-A")).toBeUndefined()
		// B is unaffected.
		expect(store.read("inst-B")).toBeDefined()
	})

	it("R3-07 fresh file matches emptyInstancesFile() exactly", () => {
		// Drives the constructor on a fresh path and confirms the
		// initial in-memory state equals the schema's empty seed.
		const store = new InstancesStore({ filePath: storePath })
		expect(store.snapshot()).toEqual(emptyInstancesFile())
	})
})

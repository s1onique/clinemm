/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4 (durable)
 *
 * Durable roundtrip witness for `StateManager` instance-secret
 * accessors.
 *
 * Per the twelfth reviewer
 * (HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED, follow-on P1):
 * the prior R4 suite exercised the schema (parseInstanceSecretName,
 * nameFor, pattern) but did NOT exercise the real `StateManager`
 * durable layer. The credential-resolution chain
 * `credentialRef.name` -> `stateManager.getInstanceSecret(...)`
 * must roundtrip:
 *
 *     setInstanceSecret(name, value)
 *       -> flushPendingState
 *         -> on-disk secrets.json contains the entry under the
 *            namespaced key (instance:inst-B), NOT under any
 *            generic alias
 *
 * Plus the symmetric DELETE case (setInstanceSecret(name, undefined))
 * and the isolation case (two instance secrets do not cross-talk).
 *
 * Run via the bridge config:
 *   bun run vitest --config vitest.config.c2-4-c-bridge.ts
 *                  src/core/storage/__tests__/state-manager-instance-secret-durable.test.ts
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// StateManager.initialize() calls initializeDistinctId(), which
// needs the VS Code host to be set up. Mock it out for tests.
vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
	getDistinctId: vi.fn(() => undefined),
	getDeviceId: vi.fn(() => undefined),
	setDistinctId: vi.fn(),
}))

import { StateManager } from "@/core/storage/StateManager"
import { nameFor } from "@/shared/storage/instance-secret"
import { createStorageContext } from "@/shared/storage/storage-context"

let CLINE_DIR: string
let SECRETS_PATH: string
let ORIGINAL_CLINE_DIR: string | undefined
let ORIGINAL_CLINE_DATA_DIR: string | undefined

beforeAll(async () => {
	CLINE_DIR = mkdtempSync(join(tmpdir(), "piif01-r4-durable-"))
	ORIGINAL_CLINE_DIR = process.env.CLINE_DIR
	ORIGINAL_CLINE_DATA_DIR = process.env.CLINE_DATA_DIR
	process.env.CLINE_DATA_DIR = join(CLINE_DIR, "data")
	process.env.CLINE_DIR = CLINE_DIR
	SECRETS_PATH = join(process.env.CLINE_DATA_DIR, "secrets.json")
	mkdirSync(process.env.CLINE_DATA_DIR, { recursive: true })

	// StateManager is a singleton: initialize once. The durability
	// invariant is exercised via direct on-disk reads of
	// secrets.json, not by tearing the singleton down.
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

function readSecretsJson(): Record<string, unknown> {
	if (!existsSync(SECRETS_PATH)) return {}
	const raw = readFileSync(SECRETS_PATH, "utf-8")
	if (raw.trim().length === 0) return {}
	return JSON.parse(raw)
}

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4 (durable)", () => {
	it("R4-D01: setInstanceSecret -> flush -> secrets.json contains the entry under the namespaced key only", async () => {
		const name = nameFor("inst-B")
		const value = "secret-B-value"
		StateManager.get().setInstanceSecret(name, value)
		await StateManager.get().flushPendingState()
		const onDisk = readSecretsJson()
		expect(onDisk["instance:inst-B"]).toBe(value)
		expect(onDisk["openAiApiKey"]).toBeUndefined()
		expect(onDisk["apiKey"]).toBeUndefined()
		expect(StateManager.get().getInstanceSecret(name)).toBe(value)
		// cleanup
		StateManager.get().setInstanceSecret(name, undefined)
		await StateManager.get().flushPendingState()
	})

	it("R4-D02: setInstanceSecret(name, undefined) -> flush -> secrets.json removes the entry", async () => {
		const name = nameFor("inst-X")
		StateManager.get().setInstanceSecret(name, "temp-value")
		await StateManager.get().flushPendingState()
		expect(readSecretsJson()["instance:inst-X"]).toBe("temp-value")
		expect(StateManager.get().getInstanceSecret(name)).toBe("temp-value")
		StateManager.get().setInstanceSecret(name, undefined)
		await StateManager.get().flushPendingState()
		expect(readSecretsJson()["instance:inst-X"]).toBeUndefined()
		expect(StateManager.get().getInstanceSecret(name)).toBeUndefined()
	})

	it("R4-D03: getInstanceSecret returns undefined for an instance id that was never written", () => {
		const never = nameFor("never-written")
		expect(StateManager.get().getInstanceSecret(never)).toBeUndefined()
	})

	it("R4-D04: two instances with diverging secrets are isolated (no cross-talk on disk)", async () => {
		StateManager.get().setInstanceSecret(nameFor("inst-A"), "secret-A-value")
		StateManager.get().setInstanceSecret(nameFor("inst-B"), "secret-B-value")
		await StateManager.get().flushPendingState()
		const onDisk = readSecretsJson()
		expect(onDisk["instance:inst-A"]).toBe("secret-A-value")
		expect(onDisk["instance:inst-B"]).toBe("secret-B-value")
		expect(StateManager.get().getInstanceSecret(nameFor("inst-A"))).toBe("secret-A-value")
		expect(StateManager.get().getInstanceSecret(nameFor("inst-B"))).toBe("secret-B-value")
		// cleanup
		StateManager.get().setInstanceSecret(nameFor("inst-A"), undefined)
		StateManager.get().setInstanceSecret(nameFor("inst-B"), undefined)
		await StateManager.get().flushPendingState()
	})

	it("R4-D05: credential-resolution chain inversion -- getInstanceSecret returns the RESOLVED secret, not the reference name", async () => {
		const name = nameFor("inst-WorkAnthropic")
		const physicalSecret = "sk-ant-api03-XXXXXXXXXXXXXXX"
		StateManager.get().setInstanceSecret(name, physicalSecret)
		await StateManager.get().flushPendingState()
		const resolved = StateManager.get().getInstanceSecret(name)
		expect(resolved).toBe(physicalSecret)
		expect(resolved).not.toBe("instance:inst-WorkAnthropic")
		expect(resolved).not.toBe(name)
		// cleanup
		StateManager.get().setInstanceSecret(name, undefined)
		await StateManager.get().flushPendingState()
	})
})

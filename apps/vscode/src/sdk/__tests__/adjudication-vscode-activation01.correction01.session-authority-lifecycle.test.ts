/**
 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01
 *
 * SESSION-AUTHORITY LIFECYCLE correction to the VS Code activation producer.
 *
 * THE TWO P0s THIS FILE CLOSES
 * ----------------------------
 *
 * P0-1 — A PENDING CONTRACT CAN ATTACH TO THE WRONG SESSION.
 *
 *   The producer used to resolve the contract as
 *
 *       getBound(input.sessionId) ?? peekArmed()
 *
 *   `input.sessionId` is present for a RESUME or a REBUILD; a NEW task
 *   receives its session id LATER. So a contract that the operator armed
 *   for the NEXT task — and that has not been consumed yet — could be
 *   attached to an UNRELATED session that merely happened to be resumed or
 *   rebuilt while the arm was pending. That violates the contract's central
 *   invariant: a TASK-SCOPED authorization must NEVER be inherited by an
 *   unrelated session.
 *
 *   The fix: a SUPPLIED session id may use ONLY its OWN bound contract.
 *   Pending intent is considered ONLY on the authorized new-task path.
 *
 * P0-2 — A RESTORED SESSION DID NOT RESTORE THE ACTIVATION CONTRACT.
 *
 *   `AdjudicationTaskContractStore` is in-memory, so a recreated extension
 *   host lost the session-bound vocabulary even when the evidence-handle
 *   secret survived in `secrets.json`. The structural restoration test
 *   recreated the evidence registry, but not the extension host and its
 *   authorization store — so the report's restoration claim was stronger
 *   than the production configuration path established.
 *
 *   The fix: the authorized vocabulary is restored from TRUSTED, HOST-OWNED
 *   PERSISTED state (the same file-backed secret store that already holds
 *   the per-session evidence secret), and the producer uses RESTORE secret
 *   semantics for an EXISTING session so a lost historical identity is never
 *   replaced by a fresh persistent secret.
 *
 * WHAT IS REAL HERE
 * -----------------
 *
 *   - the REAL VS Code configuration producer
 *     (`apps/vscode/src/sdk/cline-session-factory.ts :: buildSessionConfig`);
 *   - the REAL host adapters
 *     (`adjudication-task-contract.ts`, `adjudication-session-secret.ts`);
 *   - a REAL, recreated host process boundary: the store singleton is
 *     RESET (`resetAdjudicationTaskContractStore()`) between the two hosts,
 *     exactly as an extension-host restart does.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * Every finding, number, path and phrase in this file is SYNTHETIC.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	AdjudicationTaskContractStore,
	getAdjudicationTaskContractStore,
	resetAdjudicationTaskContractStore,
} from "../adjudication-task-contract"
import { buildSessionConfig } from "../cline-session-factory"

/**
 * The trusted, host-owned secret store standing in for the extension's
 * file-backed `secrets.json` (mode 0o600) behind `StateManager`.
 *
 * It is a REAL key/value store with the REAL `getSecretKey` / `setSecret`
 * contract, so the persistence behaviour of the host adapters is exercised
 * for real. It survives the "host restart" below, exactly as the on-disk
 * file does.
 */
const secretStore = new Map<string, string>()

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getFilePath: vi.fn(() => ""),
		getLastUsedProviderSettings: vi.fn(() => undefined),
		getProviderSettings: vi.fn(() => undefined),
		saveProviderSettings: vi.fn(),
	}

	return {
		getDistinctId: vi.fn(() => "test-distinct-id"),
		getProviderSettingsManager: vi.fn(() => providerSettingsManager),
		providerSettingsManager,
		stateManager: {
			getApiConfiguration: vi.fn(() => ({
				actModeApiProvider: "anthropic",
				actModeApiModelId: "claude-sonnet-4-6",
				apiKey: "test-key",
			})),
			getGlobalSettingsKey: vi.fn((key: string): boolean | undefined => {
				if (key === "subagentsEnabled" || key === "useAutoCondense") {
					return false
				}
				return undefined
			}),
			setGlobalStateBatch: vi.fn(),
			setGlobalState: vi.fn(),
			getSecretKey: vi.fn((key: string): string | undefined => secretStore.get(key)),
			setSecret: vi.fn((key: string, value: string) => {
				secretStore.set(key, value)
			}),
		},
	}
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => mocks.stateManager,
	},
}))

vi.mock("@/services/logging/distinctId", () => ({
	getDistinctId: mocks.getDistinctId,
}))

vi.mock("../provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string
const previousGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH
const previousDataDir = process.env.CLINE_DATA_DIR

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adjudication-correction01-"))
	process.env.CLINE_DATA_DIR = tempDir
	process.env.CLINE_GLOBAL_SETTINGS_PATH = path.join(tempDir, "global-settings.json")
	vi.clearAllMocks()
	// The trusted store stands in for the on-disk `secrets.json`. It
	// survives an extension-host restart, so it is cleared only BETWEEN
	// tests — never between the two hosts inside one test.
	secretStore.clear()
	// The adjudication contract store is a PROCESS-WIDE singleton. Reset it
	// so a test can never inherit a contract armed by another test.
	resetAdjudicationTaskContractStore()
	mocks.stateManager.getApiConfiguration.mockReturnValue({
		actModeApiProvider: "anthropic",
		actModeApiModelId: "claude-sonnet-4-6",
		apiKey: "test-key",
	})
	mocks.stateManager.getGlobalSettingsKey.mockImplementation((key: string) => {
		if (key === "subagentsEnabled" || key === "useAutoCondense") {
			return false
		}
		return undefined
	})
	mocks.providerSettingsManager.getFilePath.mockReturnValue(path.join(tempDir, "settings", "providers.json"))
	mocks.providerSettingsManager.getLastUsedProviderSettings.mockReturnValue(undefined)
	mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
	mocks.getProviderSettingsManager.mockImplementation(() => mocks.providerSettingsManager)
})

afterEach(() => {
	process.env.CLINE_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath
	process.env.CLINE_DATA_DIR = previousDataDir
	fs.rmSync(tempDir, { recursive: true, force: true })
	resetAdjudicationTaskContractStore()
})

/**
 * The synthetic, explicitly-approved task-scoped vocabulary.
 *
 * This is a TEST FIXTURE, not a permanent global vocabulary. A real Round C
 * activation requires an explicitly authorized contract defining R1-R10 and
 * their allowable qualifications; nothing here guesses at those.
 */
const AUTHORIZED_VOCABULARY = {
	findingIds: ["S1"],
	decisions: ["supported", "narrowed", "refuted", "unresolved"],
	qualificationCodes: ["manual_enforcement_only"],
	remainingQuestions: {
		"S1.automated_enforcement": "S1",
	},
	allowedDecisionsByFinding: {
		S1: ["narrowed", "unresolved"],
	},
} as const

/**
 * The trusted secret-store key that holds the per-session evidence secret.
 */
const SECRET_STORAGE_KEY = "adjudicationSessionSecrets"

/**
 * Read the persisted per-session secret blob.
 */
function readPersistedSecrets(): Record<string, string> {
	return JSON.parse(secretStore.get(SECRET_STORAGE_KEY) ?? "{}") as Record<string, string>
}

describe("ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01 — session authority lifecycle", () => {
	describe("GATE 1 — session isolation: a pending arm never attaches to an unrelated session", () => {
		it("does NOT attach a pending (unconsumed) arm to an unrelated EXISTING session", async () => {
			const store = getAdjudicationTaskContractStore()

			// 1. The operator arms a contract for the NEXT task.
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })

			// 2. An EXISTING, UNRELATED session B is resumed or rebuilt.
			//    The producer is given that session's id.
			const config = await buildSessionConfig({
				cwd: path.join(tempDir, "workspace"),
				sessionId: "unrelated-existing-session-B",
			})

			// The unrelated session must observe NO adjudication contract.
			expect(config.adjudication).toBeUndefined()
			expect(config.adjudication?.enabled).toBeUndefined()
			expect(config.adjudication?.vocabulary).toBeUndefined()

			// The pending arm must SURVIVE the unrelated resume: the
			// authorization is still owed to the next task, it was not
			// silently consumed by an unrelated session.
			expect(store.hasArmed()).toBe(true)
		})

		it("does NOT attach a pending arm to an unrelated session even when the store has a DIFFERENT bound session", async () => {
			const store = getAdjudicationTaskContractStore()

			// Session A holds the bound contract.
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			store.consumeForSession("session-A")

			// The operator arms the NEXT task's contract (pending).
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })

			// An unrelated session B is resumed.
			const config = await buildSessionConfig({
				cwd: path.join(tempDir, "workspace"),
				sessionId: "unrelated-existing-session-B",
			})

			expect(config.adjudication).toBeUndefined()
			// The pending arm is still owed to the next task.
			expect(store.hasArmed()).toBe(true)
		})

		it("keeps the contract on the authorized NEW-TASK path", async () => {
			const store = getAdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })

			// A NEW task has NO session id yet: the producer may observe the
			// pending authorization.
			const config = await buildSessionConfig({
				cwd: path.join(tempDir, "workspace"),
			})

			expect(config.adjudication).toBeDefined()
			expect(config.adjudication?.enabled).toBe(true)
			expect(config.adjudication?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)
		})

		it("keeps the contract on its OWN bound session (resume/rebuild of the authorized session)", async () => {
			const store = getAdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			store.consumeForSession("session-A")

			const config = await buildSessionConfig({
				cwd: path.join(tempDir, "workspace"),
				sessionId: "session-A",
			})

			expect(config.adjudication).toBeDefined()
			expect(config.adjudication?.enabled).toBe(true)
			expect(config.adjudication?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)
		})

		it("keeps the arm discipline: an arm is consumed EXACTLY ONCE, at the allocation point", async () => {
			const store = new AdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })

			const bound = store.consumeForSession("session-A")
			expect(bound).toBeDefined()
			expect(store.hasArmed()).toBe(false)

			// A second allocation cannot consume a second arm.
			expect(store.consumeForSession("session-B")).toBeUndefined()
			expect(store.getBound("session-B")).toBeUndefined()
		})
	})

	describe("GATE 2 — authorization restoration: a recreated host restores the ORIGINAL session's contract", () => {
		it("restores the authorized vocabulary for the original session after a full host recreation", async () => {
			const workspaceRoot = path.join(tempDir, "workspace")

			// HOST A: the operator arms the contract, and the task starts.
			// The production NEW-TASK path builds the config WITHOUT a
			// session id (the id is allocated afterwards), and the
			// allocation point consumes the arm for that id.
			const hostAStore = getAdjudicationTaskContractStore()
			hostAStore.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			const hostAConfig = await buildSessionConfig({ cwd: workspaceRoot })
			expect(hostAConfig.adjudication).toBeDefined()
			expect(hostAConfig.adjudication?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)

			// The authoritative allocation point binds the contract to the
			// session id and persists it.
			hostAStore.consumeForSession("session-A")

			// HOST B: the extension host is recreated. The in-memory store is
			// gone (a fresh singleton), exactly as after a restart.
			resetAdjudicationTaskContractStore()
			const hostBStore = getAdjudicationTaskContractStore()
			expect(hostBStore.hasArmed()).toBe(false)
			expect(hostBStore.getBound("session-A")).toBeUndefined()

			// HOST B rebuilds the SAME session — WITHOUT re-arming.
			const hostBConfig = await buildSessionConfig({
				cwd: workspaceRoot,
				sessionId: "session-A",
			})

			// The continuity feature must be ENABLED for the ORIGINAL
			// session, with the ORIGINAL authorized vocabulary.
			expect(hostBConfig.adjudication).toBeDefined()
			expect(hostBConfig.adjudication?.enabled).toBe(true)
			expect(hostBConfig.adjudication?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)
		})

		it("does NOT restore a contract for a session that was never authorized", async () => {
			const workspaceRoot = path.join(tempDir, "workspace")

			// HOST A authorizes session A only.
			const hostAStore = getAdjudicationTaskContractStore()
			hostAStore.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			hostAStore.consumeForSession("session-A")

			// HOST B: recreated host.
			resetAdjudicationTaskContractStore()

			// An unrelated session must NOT inherit the restored contract.
			const config = await buildSessionConfig({
				cwd: workspaceRoot,
				sessionId: "unrelated-existing-session-B",
			})
			expect(config.adjudication).toBeUndefined()
		})

		it("does NOT restore a contract when the host's persisted authorization state is absent", async () => {
			// A fresh host with NO persisted authorization state at all.
			resetAdjudicationTaskContractStore()
			const config = await buildSessionConfig({
				cwd: path.join(tempDir, "workspace"),
				sessionId: "session-A",
			})
			expect(config.adjudication).toBeUndefined()
		})
	})

	describe("GATE 3 — secret restoration: RESTORE semantics for an existing session", () => {
		it("does NOT mint a replacement PERSISTENT secret for an existing session whose secret is missing", async () => {
			const workspaceRoot = path.join(tempDir, "workspace")
			const sessionId = "session-with-lost-secret"

			// HOST A: the session is authorized and its secret is persisted.
			// The production NEW-TASK path uses START semantics, so the
			// secret is minted and persisted when the SDK's session start
			// calls the provider.
			const hostAStore = getAdjudicationTaskContractStore()
			hostAStore.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			const hostAConfig = await buildSessionConfig({ cwd: workspaceRoot })
			expect(hostAConfig.adjudication).toBeDefined()
			hostAStore.consumeForSession(sessionId)

			const originalSecret = await hostAConfig.adjudication?.secretProvider?.(sessionId)
			expect(originalSecret).toBeDefined()
			expect(readPersistedSecrets()[sessionId]).toBe(originalSecret)

			// The secret is LOST (e.g. the secrets file was rotated or the
			// session's slot was removed), but the authorization survives.
			secretStore.set(SECRET_STORAGE_KEY, JSON.stringify({}))

			// HOST B: the recreated host rebuilds the SAME session.
			resetAdjudicationTaskContractStore()
			const hostBConfig = await buildSessionConfig({
				cwd: workspaceRoot,
				sessionId,
			})
			expect(hostBConfig.adjudication).toBeDefined()

			// The producer's secret provider must use RESTORE semantics: it
			// must NOT persist a REPLACEMENT secret for the lost historical
			// identity. Minting one would make the session's historical
			// evidence handles resolve to nothing while LOOKING restorable.
			const provider = hostBConfig.adjudication?.secretProvider
			expect(provider).toBeDefined()
			const restored = await provider?.(sessionId)
			expect(restored).toBeDefined()
			expect(restored).not.toBe(originalSecret)

			expect(readPersistedSecrets()[sessionId]).toBeUndefined()
		})

		it("keeps the SAME secret for an existing session whose secret SURVIVED (a real rebuild)", async () => {
			const workspaceRoot = path.join(tempDir, "workspace")
			const sessionId = "session-with-surviving-secret"

			const hostAStore = getAdjudicationTaskContractStore()
			hostAStore.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			const hostAConfig = await buildSessionConfig({ cwd: workspaceRoot })
			expect(hostAConfig.adjudication).toBeDefined()
			hostAStore.consumeForSession(sessionId)

			const originalSecret = await hostAConfig.adjudication?.secretProvider?.(sessionId)
			expect(originalSecret).toBeDefined()
			expect(readPersistedSecrets()[sessionId]).toBe(originalSecret)

			// HOST B: the recreated host rebuilds the SAME session.
			resetAdjudicationTaskContractStore()
			const hostBConfig = await buildSessionConfig({
				cwd: workspaceRoot,
				sessionId,
			})
			const provider = hostBConfig.adjudication?.secretProvider
			const restored = await provider?.(sessionId)
			// The SAME session re-derives the SAME evidence identity.
			expect(restored).toBe(originalSecret)
		})

		it("persists a NEW session's secret on the new-task path (START semantics)", async () => {
			const store = getAdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })

			const config = await buildSessionConfig({
				cwd: path.join(tempDir, "workspace"),
			})
			expect(config.adjudication).toBeDefined()

			const provider = config.adjudication?.secretProvider
			const secret = await provider?.("brand-new-session")
			expect(secret).toBeDefined()

			expect(readPersistedSecrets()["brand-new-session"]).toBe(secret)
		})
	})

	describe("GATE 4 — the store's own authority discipline", () => {
		it("getBoundOrPersisted NEVER consults the armed slot", async () => {
			const store = new AdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })

			// An EXISTING session id resolves to NOTHING while the arm is
			// pending: the arm is intent for the NEXT task, not for this
			// session.
			expect(store.getBoundOrPersisted("unrelated-existing-session-B")).toBeUndefined()
			// The arm survives the lookup.
			expect(store.hasArmed()).toBe(true)
		})

		it("getBoundOrPersisted resolves the session's OWN persisted vocabulary", async () => {
			const store = new AdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			store.consumeForSession("session-A")

			// In-memory.
			expect(store.getBoundOrPersisted("session-A")?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)
			// A DIFFERENT session resolves to nothing.
			expect(store.getBoundOrPersisted("session-B")).toBeUndefined()
			// No session id at all resolves to nothing.
			expect(store.getBoundOrPersisted(undefined)).toBeUndefined()
		})

		it("clearBound retires the PERSISTED vocabulary of the retired session", async () => {
			const store = new AdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			store.consumeForSession("session-A")

			// The vocabulary is persisted for the bound session.
			expect(store.getBoundOrPersisted("session-A")).toBeDefined()

			// The task-clear choke-point retires the current task.
			store.clearBound()

			// The in-memory binding is gone.
			expect(store.getBound("session-A")).toBeUndefined()
			// The PERSISTED record is retired too: a later host restart must
			// not resurrect an authorization for an abandoned task.
			expect(store.getBoundOrPersisted("session-A")).toBeUndefined()
		})

		it("clearBound does NOT erase the ARMED contract for the next task", async () => {
			const store = new AdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })
			store.consumeForSession("session-A")

			// The operator arms the NEXT task's contract.
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })

			store.clearBound()

			// The next task's authorization survives the current task's
			// retirement.
			expect(store.hasArmed()).toBe(true)
			expect(store.peekArmed()?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)
		})
	})
})

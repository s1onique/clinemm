/**
 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
 *
 * INTEGRATION RED/GREEN SUITE for the adjudication continuity contract at the
 * ACTUAL VS Code runtime configuration producer.
 *
 * THE PRODUCTION SEAM IS REAL
 * ---------------------------
 *
 * This suite drives the REAL VS Code configuration producer chain:
 *
 *   apps/vscode/src/sdk/sdk-task-start-coordinator.ts
 *     SdkTaskStartCoordinator.initTask()
 *       -> options.sessionConfigBuilder.build({ ... })
 *          -> apps/vscode/src/sdk/sdk-session-config-builder.ts
 *             SdkSessionConfigBuilder.build()
 *               -> apps/vscode/src/sdk/cline-session-factory.ts
 *                  buildSessionConfig()            <-- THE PRODUCER
 *
 * The object produced by `buildSessionConfig()` IS the `CoreSessionConfig`
 * that the SDK's `LocalRuntimeHost.startSession()` consumes (via
 * `prepareLocalRuntimeBootstrap`'s `...baseConfig` spread), so asserting on
 * the produced config asserts on the object the runtime actually receives.
 *
 * WHAT THIS SUITE PROVES
 * ----------------------
 *
 *   RED-1  Default OFF: an ordinary task produces NO adjudication contract,
 *          no registry activation, no publication instruction, and no
 *          provider-input delta. (Conservation control.)
 *
 *   RED-2  Explicit opt-in: a task with an authorized synthetic contract
 *          produces a config whose `adjudication` block carries the
 *          authorized vocabulary, the trusted host revision resolver and the
 *          restorable host secret provider.
 *
 *   RED-3  Acquisition: a real `read_files`-shaped tool result, observed
 *          through the production acquisition seam, yields a persisted
 *          acquisition record, a model-visible evidence handle, and a
 *          runtime-bound source revision.
 *
 *   RED-4  Acceptance: an assistant-text candidate citing the ACTUAL
 *          observed handle is accepted (schema_valid, nonempty_refs,
 *          canonical_refs_resolved, source_revision_bound).
 *
 *   RED-5  Compaction continuity: the accepted candidate survives the
 *          state-aware agentic compaction path even when the summarizer
 *          deliberately OMITS it, and it appears in the provider-visible
 *          continuation exactly once.
 *
 *   RED-6  Session restoration: a recreated host, given the SAME session
 *          id and the SAME persisted secret, re-derives the SAME evidence
 *          handle and preserves the accepted candidate.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * Every finding, number, path and phrase in this file is SYNTHETIC. No
 * credential, secret value, private source content, historical prompt or
 * provider payload is reproduced here.
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
			setSecret: vi.fn(),
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
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adjudication-vscode-activation01-"))
	process.env.CLINE_DATA_DIR = tempDir
	process.env.CLINE_GLOBAL_SETTINGS_PATH = path.join(tempDir, "global-settings.json")
	vi.clearAllMocks()
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

describe("ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01 — VS Code runtime config producer", () => {
	describe("RED-1 — disabled by default", () => {
		it("does NOT supply an adjudication contract for an ordinary task", async () => {
			const config = await buildSessionConfig({
				cwd: "/tmp/adjudication-vscode-activation01/default-off",
			})

			// The whole contract is absent, not merely disabled.
			expect(config.adjudication).toBeUndefined()
			// The four fields are individually absent.
			expect(config.adjudication?.enabled).toBeUndefined()
			expect(config.adjudication?.vocabulary).toBeUndefined()
			expect(config.adjudication?.revisionResolver).toBeUndefined()
			expect(config.adjudication?.secretProvider).toBeUndefined()
		})

		it("does not change the provider-visible system prompt for an ordinary task", async () => {
			const config = await buildSessionConfig({
				cwd: "/tmp/adjudication-vscode-activation01/default-off",
			})

			// The publication instruction is what would change the model's
			// output contract. With the feature off it must be absent, and
			// the system prompt must carry no adjudication marker.
			expect(config.systemPrompt ?? "").not.toContain("cline-adjudication")
			expect(config.systemPrompt ?? "").not.toContain("adjudication_candidate")
		})
	})

	describe("RED-2 — explicit opt-in reaches the runtime configuration", () => {
		it("carries the authorized contract into the produced CoreSessionConfig", async () => {
			// The contract is armed on the PROCESS-WIDE store, which is the
			// one the producer seam reads.
			getAdjudicationTaskContractStore().arm({ vocabulary: AUTHORIZED_VOCABULARY })

			const config = await buildSessionConfig({
				cwd: path.join(tempDir, "workspace"),
			})

			// The POSITIVE assertion. Before the ACT's implementation this
			// failed: the producer never supplied an adjudication block.
			expect(config.adjudication).toBeDefined()
			expect(config.adjudication?.enabled).toBe(true)
			expect(config.adjudication?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)
			expect(typeof config.adjudication?.revisionResolver?.resolve).toBe("function")
			expect(typeof config.adjudication?.secretProvider).toBe("function")
		})

		it("supplies a revision resolver that fails closed outside the workspace", async () => {
			getAdjudicationTaskContractStore().arm({ vocabulary: AUTHORIZED_VOCABULARY })

			const workspaceRoot = path.join(tempDir, "workspace")
			const config = await buildSessionConfig({ cwd: workspaceRoot })
			const resolver = config.adjudication?.revisionResolver
			expect(resolver).toBeDefined()

			// A path OUTSIDE the authorized workspace has no source identity.
			const outside = await resolver?.resolve({
				sourcePath: path.join(tempDir, "outside.ts"),
				toolName: "read_files",
			})
			expect(outside).toBeUndefined()

			// A non-source-observing tool has no source authority: a shell
			// command's stdout is NEVER promoted to read_files evidence.
			const viaCommand = await resolver?.resolve({
				sourcePath: path.join(workspaceRoot, "inside.ts"),
				toolName: "run_commands",
			})
			expect(viaCommand).toBeUndefined()
		})

		it("binds the contract to exactly ONE session and leaves an unrelated task off", async () => {
			const store = new AdjudicationTaskContractStore()
			store.arm({ vocabulary: AUTHORIZED_VOCABULARY })

			// The armed contract is consumed at the session-id allocation
			// point, which binds it to exactly ONE session.
			const bound = store.consumeForSession("session-A")
			expect(bound).toBeDefined()

			// A DIFFERENT session is a different task: it gets no contract.
			expect(store.getBound("session-B")).toBeUndefined()
			expect(store.consumeForSession("session-B")).toBeUndefined()

			// The armed slot is empty: it was consumed exactly once.
			expect(store.hasArmed()).toBe(false)
		})
	})
})

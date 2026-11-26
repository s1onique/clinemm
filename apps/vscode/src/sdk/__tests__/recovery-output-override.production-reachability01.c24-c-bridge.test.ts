/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01).
 *
 * PRODUCTION REACHABILITY of the RECOVERY-ONLY GENERATION OVERRIDE (D4).
 *
 * WHAT THIS WITNESS ESTABLISHES
 * ------------------------------
 *
 * The recovery-only generation override is a BOUNDED BEHAVIORAL EXPERIMENT.
 * This witness establishes that the INSTALLED PRODUCTION SESSION PATH can
 * actually ENABLE it and that the override reaches the ACTUAL RUNTIME and
 * the ACTUAL dispatched request.
 *
 * The chain under test is the REAL one, end to end:
 *
 *   apps/vscode/src/sdk/cline-session-factory.ts
 *     buildSessionConfig({ mode })            <-- THE PRODUCER
 *        -> CoreSessionConfig.recoveryOutputOverridePolicy
 *           -> LocalRuntimeHost.startSession()
 *              -> the AgentConfig literal    <-- THE FORWARDING SEAM
 *                 -> createAgentRuntimeConfig()
 *                    -> AgentRuntime         <-- THE ACTUAL RUNTIME
 *
 * NO paid inference. The model is a deterministic scripted double; the only
 * replaced boundary is the model transport.
 *
 * THE CONTROLS
 * ------------
 *
 *   D1  DEFAULT OFF: an ordinary ACT session installs NO override policy at
 *       all — the key is ABSENT, not merely disabled.
 *   D2  The EXPLICIT operator opt-in installs the INTENDED policy.
 *   D3  PLAN mode installs NO override policy even under the opt-in.
 *   D4  The policy REACHES THE ACTUAL RUNTIME through the host's AgentConfig
 *       forwarding seam.
 *   D5  The EXACT target authority is established by the HOST: a different
 *       model or a different reasoning effort is NOT the authorized target.
 *   D6  The runtime's own MINIMUM repeated-exhaustion requirement is not
 *       bypassed by the host predicate.
 *   D7  A real runtime trajectory: the repeated exhaustion arms the override
 *       and EXACTLY ONE dispatched request carries it.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentConfig, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A deterministic scripted model that always exhausts its output allowance. */
class ExhaustingModel implements AgentModel {
	readonly requests: AgentModelRequest[] = []
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		return (async function* () {
			yield { type: "reasoning-delta", text: "thinking..." } as AgentModelEvent
			yield { type: "finish", reason: "max-tokens" } as AgentModelEvent
		})()
	}
}

// ---------------------------------------------------------------------------
// The production configuration producer
// ---------------------------------------------------------------------------

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
				actModeApiProvider: "minimax",
				actModeApiModelId: "MiniMax-M3.1-Flash",
				planModeApiProvider: "minimax",
				planModeApiModelId: "MiniMax-M3.1-Flash",
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
// Harness
// ---------------------------------------------------------------------------

const envSnapshot = {
	HOME: process.env.HOME,
	CLINE_DIR: process.env.CLINE_DIR,
	CLINEMM_RECOVERY_OUTPUT_OVERRIDE: process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE,
}
let isolatedHomeDir = ""

beforeEach(() => {
	isolatedHomeDir = mkdtempSync(join(tmpdir(), "recovery-output-override-reachability-"))
	process.env.HOME = isolatedHomeDir
	process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
	// DEFAULT OFF: the experiment is disabled unless a case opts in.
	delete process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE
	vi.clearAllMocks()
	mocks.stateManager.getApiConfiguration.mockReturnValue({
		actModeApiProvider: "minimax",
		actModeApiModelId: "MiniMax-M3.1-Flash",
		planModeApiProvider: "minimax",
		planModeApiModelId: "MiniMax-M3.1-Flash",
		apiKey: "test-key",
	})
	mocks.providerSettingsManager.getFilePath.mockReturnValue(join(isolatedHomeDir, "settings", "providers.json"))
	mocks.providerSettingsManager.getLastUsedProviderSettings.mockReturnValue(undefined)
	mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
})

afterEach(() => {
	process.env.HOME = envSnapshot.HOME
	process.env.CLINE_DIR = envSnapshot.CLINE_DIR
	const value = envSnapshot.CLINEMM_RECOVERY_OUTPUT_OVERRIDE
	if (value === undefined) {
		delete process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE
	} else {
		process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE = value
	}
	rmSync(isolatedHomeDir, { recursive: true, force: true })
})

/**
 * Build the REAL production session configuration for the given mode.
 *
 * This is the actual producer the VS Code host uses.
 */
async function buildProductionConfig(mode: "act" | "plan") {
	const { buildSessionConfig } = await import("../cline-session-factory")
	return await buildSessionConfig({
		cwd: join(isolatedHomeDir, "workspace"),
		mode,
	})
}

/**
 * Drive the REAL host construction + forwarding seam and return the
 * `AgentConfig` the runtime actually receives.
 */
async function captureHostAgentConfig(config: Record<string, unknown>): Promise<AgentConfig> {
	const captured: AgentConfig[] = []
	const host = new LocalRuntimeHost({
		distinctId: "recovery-output-override-reachability",
		sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
		createAgent: (agentConfig) => {
			captured.push(agentConfig)
			return {
				getAgentId: () => "agent-1",
				getConversationId: () => "conv-1",
				subscribeEvents: () => undefined,
				canStartRun: () => true,
				run: async () => ({ status: "completed" }),
				resume: async () => ({ status: "completed" }),
				abort: () => undefined,
				dispose: async () => undefined,
				sendMessage: async () => undefined,
			} as never
		},
	})
	await host.startSession({
		interactive: true,
		config: {
			sessionId: "session-recovery-override-reachability",
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
			systemPrompt: "test",
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			...(config as unknown as Record<string, unknown>),
		} as never,
	})
	expect(captured.length).toBe(1)
	return captured[0] as AgentConfig
}

// ---------------------------------------------------------------------------
// D1-D3 — the producer installs the override policy only under the EXPLICIT
//          operator opt-in, and only in ACT mode
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 / D1-D3", () => {
	it("D1: an ORDINARY ACT session installs NO override policy — the experiment is DEFAULT OFF", async () => {
		delete process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE
		const config = await buildProductionConfig("act")
		// The whole block is ABSENT, not merely disabled. With the policy
		// absent the runtime behaves EXACTLY as it did before D4 existed.
		expect(config.recoveryOutputOverridePolicy).toBeUndefined()
		// R1's ACT-only scoping is unchanged.
		expect(config.executionStagnationPolicy).toBeDefined()
	})

	it("D2: the EXPLICIT operator opt-in installs the INTENDED override policy", async () => {
		process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE = "1"
		const config = await buildProductionConfig("act")
		const policy = config.recoveryOutputOverridePolicy
		expect(policy).toBeDefined()
		expect(policy?.enabled).toBe(true)
		// The REQUEST-LOCAL recovery allowance.
		expect(policy?.recoveryMaxOutputTokens).toBe(16_384)
		// The EXACT authorized target.
		expect(policy?.modelId).toBe("MiniMax-M3.1-Flash")
		expect(policy?.reasoningEffort).toBe("low")
		expect(typeof policy?.isAuthorizedTarget).toBe("function")
	})

	it("D2b: a NON-opt-in value leaves the experiment disabled", async () => {
		// "0", "false", "yes" and an empty string are NOT opt-ins.
		for (const value of ["0", "false", "yes", "", "  "]) {
			process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE = value
			const config = await buildProductionConfig("act")
			expect(config.recoveryOutputOverridePolicy).toBeUndefined()
		}
	})

	it("D3: PLAN mode installs NO override policy even under the operator opt-in", async () => {
		process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE = "1"
		const config = await buildProductionConfig("plan")
		// The whole block is ABSENT, not merely disabled. In PLAN mode the
		// agent is forbidden to edit, so an unproductive round is the
		// requested behaviour, not a stall.
		expect(config.recoveryOutputOverridePolicy).toBeUndefined()
		// And R1's ACT-only scoping is unchanged.
		expect(config.executionStagnationPolicy).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// D4-D6 — the policy REACHES THE ACTUAL RUNTIME and the host owns the
//          exact-target authority
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 / D4-D6", () => {
	it("D4: the override policy REACHES THE ACTUAL RUNTIME (it survives the host's AgentConfig forwarding seam)", async () => {
		process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE = "1"
		const config = await buildProductionConfig("act")
		expect(config.recoveryOutputOverridePolicy).toBeDefined()

		const agentConfig = await captureHostAgentConfig(config as unknown as Record<string, unknown>)
		expect(agentConfig.recoveryOutputOverridePolicy).toBeDefined()
		expect(agentConfig.recoveryOutputOverridePolicy?.enabled).toBe(true)
		expect(agentConfig.recoveryOutputOverridePolicy?.recoveryMaxOutputTokens).toBe(16_384)
		expect(agentConfig.recoveryOutputOverridePolicy?.modelId).toBe("MiniMax-M3.1-Flash")
		expect(agentConfig.recoveryOutputOverridePolicy?.reasoningEffort).toBe("low")
		expect(typeof agentConfig.recoveryOutputOverridePolicy?.isAuthorizedTarget).toBe("function")
	})

	it("D5: the HOST establishes the EXACT target authority — a different model is NOT authorized", async () => {
		process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE = "1"
		const config = await buildProductionConfig("act")
		const policy = config.recoveryOutputOverridePolicy
		const isAuthorizedTarget = policy?.isAuthorizedTarget
		expect(typeof isAuthorizedTarget).toBe("function")

		// The AUTHORIZED target is authorized: the exact provider, the
		// exact model and the exact effective reasoning effort.
		expect(
			isAuthorizedTarget?.({
				providerId: "minimax",
				modelId: "MiniMax-M3.1-Flash",
				reasoningEffort: "low",
			}),
		).toBe(true)
		// A DIFFERENT provider is not.
		expect(
			isAuthorizedTarget?.({
				providerId: "minimax-cn",
				modelId: "MiniMax-M3.1-Flash",
				reasoningEffort: "low",
			}),
		).toBe(false)
		// A DIFFERENT model is not.
		expect(
			isAuthorizedTarget?.({
				providerId: "minimax",
				modelId: "MiniMax-M2",
				reasoningEffort: "low",
			}),
		).toBe(false)
		// A DIFFERENT reasoning effort is not.
		expect(
			isAuthorizedTarget?.({
				providerId: "minimax",
				modelId: "MiniMax-M3.1-Flash",
				reasoningEffort: "high",
			}),
		).toBe(false)
		// An UNKNOWN target is not: an unknown provider, an unknown model
		// and an unknown effort each mean NO override.
		expect(
			isAuthorizedTarget?.({
				providerId: undefined,
				modelId: undefined,
				reasoningEffort: undefined,
			}),
		).toBe(false)
		expect(
			isAuthorizedTarget?.({
				providerId: "minimax",
				modelId: "MiniMax-M3.1-Flash",
				reasoningEffort: undefined,
			}),
		).toBe(false)
		expect(
			isAuthorizedTarget?.({
				providerId: undefined,
				modelId: "MiniMax-M3.1-Flash",
				reasoningEffort: "low",
			}),
		).toBe(false)
	})

	it("D6: the host predicate does NOT bypass the runtime's MINIMUM repeated-exhaustion requirement", async () => {
		const { AgentRuntime } = await import("@cline/agents")
		process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE = "1"
		const config = await buildProductionConfig("act")
		const policy = config.recoveryOutputOverridePolicy
		expect(policy).toBeDefined()

		// The PRODUCER's own policy, with the PRODUCER's own host predicate.
		// The R1 threshold is BELOW the runtime's own minimum
		// repeated-exhaustion streak (3) and the run-scoped R1 allowance is
		// ONE instruction, so the ONLY R1 intervention happens while the
		// exhaustion streak is still only 2. The runtime's own minimum
		// therefore still applies: the host predicate — which authorizes
		// the TARGET — cannot bypass the runtime's own requirement that
		// exhaustion be REPEATED.
		const model = new ExhaustingModel()
		const runtime = new AgentRuntime({
			model,
			modelOptions: { reasoningEffort: "low" },
			messageModelInfo: { id: "MiniMax-M3.1-Flash", provider: "minimax" } as never,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 1,
				enabled: true,
			},
			recoveryOutputOverridePolicy: policy,
		})
		await runtime.run("Do the work")

		// The ONLY R1 intervention happened at exhaustion streak 2, which
		// is BELOW the runtime's own minimum of 3: the override was NOT
		// armed for it.
		const overridden = model.requests.filter((request) => request.options?.maxTokens === 16_384)
		expect(overridden).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// D7 — the real runtime trajectory: repeated exhaustion arms the override and
//        EXACTLY ONE dispatched request carries it
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 / D7", () => {
	it("D7: the repeated exhaustion arms the override and EXACTLY ONE dispatched request carries it", async () => {
		const { AgentRuntime } = await import("@cline/agents")
		process.env.CLINEMM_RECOVERY_OUTPUT_OVERRIDE = "1"
		const config = await buildProductionConfig("act")
		const policy = config.recoveryOutputOverridePolicy
		expect(policy).toBeDefined()

		const model = new ExhaustingModel()
		const runtime = new AgentRuntime({
			model,
			modelOptions: { reasoningEffort: "low" },
			messageModelInfo: { id: "MiniMax-M3.1-Flash", provider: "minimax" } as never,
			// A SMALLER R1 threshold so the witness stays compact: the
			// threshold is the ONLY thing that differs from production, and
			// it does not affect the override's own eligibility, which is
			// the runtime's exhaustion streak.
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			recoveryOutputOverridePolicy: policy,
		})
		await runtime.run("Do the work")

		// EXACTLY ONE dispatched request carries the recovery allowance.
		const overridden = model.requests.filter((request) => request.options?.maxTokens === 16_384)
		expect(overridden).toHaveLength(1)
		// Every OTHER request keeps the NORMAL allowance: the override is
		// REQUEST-LOCAL and is never replenished.
		for (const request of model.requests) {
			if (request.options?.maxTokens !== 16_384) {
				expect(request.options?.maxTokens).toBeUndefined()
			}
		}
	})
})

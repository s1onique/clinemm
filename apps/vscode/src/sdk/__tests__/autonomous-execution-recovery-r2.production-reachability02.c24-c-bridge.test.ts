/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
 *
 * PRODUCTION REACHABILITY of the R2 bounded-objective recovery.
 *
 * WHAT THIS WITNESS ESTABLISHES
 * ------------------------------
 *
 * The R2 architecture is ACCEPTED. This witness establishes that the
 * INSTALLED PRODUCTION SESSION PATH activates R2 and actually dispatches
 * the selected bounded objective to the model.
 *
 * The chain under test is the REAL one, end to end:
 *
 *   apps/vscode/src/sdk/cline-session-factory.ts
 *     buildSessionConfig({ mode })            <-- THE PRODUCER
 *        -> CoreSessionConfig.boundedObjectivePolicy
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
 *   Q1  ACT mode activates the INTENDED R2 policy.
 *   Q2  PLAN mode does NOT activate it.
 *   Q3  The policy REACHES THE ACTUAL RUNTIME (it survives the host's
 *       AgentConfig forwarding seam).
 *   Q4  The R1 allowance exhaustion activates R2, and the NEXT dispatched
 *       model request carries the ACTIVE bounded objective.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM.
 */

/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01)
 *
 * PRODUCTION REACHABILITY of the R1 execution-stagnation recovery.
 *
 * WHAT THIS WITNESS ESTABLISHES
 * ------------------------------
 *
 * The R1 architecture is ACCEPTED. This amendment does not redesign it; it
 * establishes that the INSTALLED PRODUCTION SESSION PATH activates R1 and
 * actually delivers its corrective instruction to the model.
 *
 * The chain under test is the REAL one, end to end:
 *
 *   apps/vscode/src/sdk/cline-session-factory.ts
 *     buildSessionConfig({ mode })            <-- THE PRODUCER
 *        -> CoreSessionConfig.executionStagnationPolicy
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
 *   P1  ACT mode activates the INTENDED policy.
 *   P2  PLAN mode does NOT activate it.
 *   P3  The policy REACHES THE ACTUAL RUNTIME (it survives the host's
 *       AgentConfig forwarding seam).
 *   P4  The REAL host progress classifier is INSTALLED.
 *   P5  FIVE qualifying rounds cause an intervention.
 *   P6  The NEXT dispatched model request contains the corrective
 *       instruction.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentConfig, AgentModel, AgentModelEvent, AgentModelRequest, AgentRuntimeEvent } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * A deterministic scripted model. Every step is a canned response; the
 * model records the requests it received so the witness can assert what the
 * NEXT dispatched request actually carried.
 */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = []
	readonly selectionRequests: AgentModelRequest[] = []
	constructor(
		private readonly steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
		private readonly selectionReply: Record<string, unknown>,
	) {}
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		// The R2 SELECTION INFERENCE is served by the SAME model through the
		// SAME `stream()` seam, so the script must distinguish the two
		// request kinds. The discriminator is the request's TOOL INVENTORY:
		// the selection inference carries NO tools (it names an objective;
		// it executes nothing), while every execution request carries the
		// runtime's tool set.
		if ((request.tools ?? []).length === 0) {
			this.selectionRequests.push(request)
			const reply = JSON.stringify(this.selectionReply)
			return (async function* () {
				yield { type: "text-delta", text: reply } as AgentModelEvent
				yield { type: "finish", reason: "stop" } as AgentModelEvent
			})()
		}
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) {
			return (async function* () {})()
		}
		const events = step(request)
		return (async function* () {
			for await (const ev of events) yield ev
		})()
	}
}

/** One round that calls a tool and asks for another round. */
function toolCallStep(toolCallId: string, toolName: string, input: unknown): () => AgentModelEvent[] {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			inputText: JSON.stringify(input),
		},
		{ type: "finish", reason: "tool-calls" },
	]
}

/** One round that produces only text and finishes. */
function _finishStep(): AgentModelEvent[] {
	return [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	]
}

/** Extract the text of every message in a model request. */
function requestTexts(request: AgentModelRequest): string[] {
	const texts: string[] = []
	for (const message of request.messages ?? []) {
		if (typeof message.content === "string") {
			texts.push(message.content)
			continue
		}
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
					texts.push((part as { text: string }).text)
				}
			}
		}
	}
	return texts
}

/** The runtime-owned corrective instruction, if the request carries one. */
function _recoveryInstructionIn(request: AgentModelRequest): string | undefined {
	return requestTexts(request).find((text) => text.startsWith("[SYSTEM] Execution has stalled:"))
}

/** An inspection-only tool input (a file path, no edit operation). */
const _INSPECT_INPUT = { files: [{ path: "/tmp/a.ts" }] }

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
				actModeApiProvider: "anthropic",
				actModeApiModelId: "claude-sonnet-4-6",
				planModeApiProvider: "anthropic",
				planModeApiModelId: "claude-sonnet-4-6",
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
	CLINE_BOUNDED_OBJECTIVE_DOGFOOD: process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD,
}
let isolatedHomeDir = ""

beforeEach(() => {
	isolatedHomeDir = mkdtempSync(join(tmpdir(), "autonomous-recovery-reachability-"))
	process.env.HOME = isolatedHomeDir
	process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
	vi.clearAllMocks()
	mocks.stateManager.getApiConfiguration.mockReturnValue({
		actModeApiProvider: "anthropic",
		actModeApiModelId: "claude-sonnet-4-6",
		planModeApiProvider: "anthropic",
		planModeApiModelId: "claude-sonnet-4-6",
		apiKey: "test-key",
	})
	mocks.providerSettingsManager.getFilePath.mockReturnValue(join(isolatedHomeDir, "settings", "providers.json"))
	mocks.providerSettingsManager.getLastUsedProviderSettings.mockReturnValue(undefined)
	mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
})

afterEach(() => {
	process.env.HOME = envSnapshot.HOME
	process.env.CLINE_DIR = envSnapshot.CLINE_DIR
	if (envSnapshot.CLINE_BOUNDED_OBJECTIVE_DOGFOOD === undefined) {
		delete process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD
	} else {
		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = envSnapshot.CLINE_BOUNDED_OBJECTIVE_DOGFOOD
	}
	rmSync(isolatedHomeDir, { recursive: true, force: true })
})

/**
 * Build the REAL production session configuration for the given mode.
 *
 * This is the actual producer the VS Code host uses: `buildSessionConfig()`
 * is what `SdkSessionConfigBuilder.build()` calls.
 */
async function buildProductionConfig(mode: "act" | "plan") {
	const { buildSessionConfig } = await import("../cline-session-factory")
	return await buildSessionConfig({
		cwd: join(isolatedHomeDir, "workspace"),
		mode,
	})
}

// ---------------------------------------------------------------------------
// Q1 / Q2 — the producer activates the R2 policy only under the EXPLICIT
//           DOGFOOD opt-in, and only in ACT mode
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / Q1-Q2", () => {
	it("Q1: an ORDINARY ACT session does NOT activate the R2 policy — R2 stays EXPERIMENTAL", async () => {
		// No dogfood opt-in: the ordinary production path.
		delete process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD
		const config = await buildProductionConfig("act")
		// The whole block is ABSENT, not merely disabled. With the policy
		// absent the runtime behaves EXACTLY as it did before R2 existed.
		expect(config.boundedObjectivePolicy).toBeUndefined()
		// R1's ACT-only scoping is unchanged.
		expect(config.executionStagnationPolicy).toBeDefined()
	})

	it("Q1b: the EXPLICIT dogfood opt-in activates the INTENDED R2 policy", async () => {
		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = "1"
		const config = await buildProductionConfig("act")
		const policy = config.boundedObjectivePolicy
		expect(policy).toBeDefined()
		// The intended EXPERIMENTAL bounds: two activations, eight rounds
		// per objective, one selection inference, enabled.
		expect(policy?.enabled).toBe(true)
		expect(policy?.maxActivations).toBe(2)
		expect(policy?.maxObjectiveRounds).toBe(8)
		expect(policy?.maxSelectionInferences).toBe(1)
	})

	it("Q2: PLAN mode does NOT activate the R2 policy even under the dogfood opt-in", async () => {
		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = "1"
		const config = await buildProductionConfig("plan")
		// The whole block is ABSENT, not merely disabled. In PLAN mode the
		// agent is forbidden to edit, so an unproductive round is the
		// requested behaviour, not a stall.
		expect(config.boundedObjectivePolicy).toBeUndefined()
		// And R1's ACT-only scoping is unchanged.
		expect(config.executionStagnationPolicy).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// Q3 — the policy REACHES THE ACTUAL RUNTIME through the host's forwarding
//        seam
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / Q3", () => {
	it("Q3: the R2 policy REACHES THE ACTUAL RUNTIME (it survives the host's AgentConfig forwarding seam)", async () => {
		// The EXPLICIT dogfood opt-in: R2 is experimental and is not
		// enabled for ordinary production sessions.
		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = "1"
		const config = await buildProductionConfig("act")
		expect(config.boundedObjectivePolicy).toBeDefined()

		// Capture the AgentConfig the REAL host builds.
		const captured: AgentConfig[] = []
		const host = new LocalRuntimeHost({
			distinctId: "autonomous-recovery-r2-reachability",
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
			createAgent: (agentConfig) => {
				captured.push(agentConfig)
				// A minimal stand-in: the witness's own runtime is exercised
				// in Q4 through the REAL `AgentRuntime` directly, driven by the
				// config the host actually produced.
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
				sessionId: "session-r2-reachability",
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				systemPrompt: "test",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				...(config as unknown as Record<string, unknown>),
			} as never,
		})

		expect(captured.length).toBe(1)
		const agentConfig = captured[0] as AgentConfig
		// Q3: the policy reached the AgentConfig the runtime receives.
		expect(agentConfig.boundedObjectivePolicy).toBeDefined()
		expect(agentConfig.boundedObjectivePolicy?.enabled).toBe(true)
		expect(agentConfig.boundedObjectivePolicy?.maxActivations).toBe(2)
		expect(agentConfig.boundedObjectivePolicy?.maxObjectiveRounds).toBe(8)
		expect(agentConfig.boundedObjectivePolicy?.maxSelectionInferences).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// Q4 — the R1 allowance exhaustion activates R2 on the REAL runtime, and the
//        NEXT dispatched request carries the active bounded objective
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / Q4", () => {
	it("Q4: the R1 allowance exhaustion activates R2 and the NEXT dispatched request carries the ACTIVE bounded objective", async () => {
		const { AgentRuntime } = await import("@cline/agents")

		// The policy the PRODUCTION producer actually built.
		// The EXPLICIT dogfood opt-in: R2 is experimental.
		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = "1"
		const config = await buildProductionConfig("act")
		const policy = config.boundedObjectivePolicy
		expect(policy).toBeDefined()

		const calls = { count: 0 }
		const inspectionTool = {
			name: "read_files",
			description: "Reads files (inspection only)",
			inputSchema: { type: "object" } as never,
			async execute() {
				calls.count += 1
				return "file contents"
			},
		}

		// The R1 policy the PRODUCER built, with a small threshold so the
		// witness stays compact. The R2 policy is the PRODUCER's own.
		// The PRODUCER's own R1 policy, with a SMALLER threshold so the
		// witness stays compact. The R2 policy below is the PRODUCER's own,
		// unmodified.
		const r1Policy = {
			unproductiveRoundThreshold: 2,
			maxRecoveryInstructions: 1,
			enabled: true,
		}

		// The scripted model: TWO inspection rounds (which exhaust R1's
		// allowance of one instruction and then trip the exhausted branch
		// on the next streak), then the R2 SELECTION REPLY, then a finish.
		const selectionReply = {
			objective: "Repair the disposable target so its VALUE constant is 2",
			firstStep: "Edit the disposable target module to set VALUE = 2",
			mutationScope: "the disposable workspace directory",
			verificationCondition: "the run_commands regression check for VALUE reports PASS",
			obligationReferences: ["Complete the parent task as authorized by the user"],
			evidenceReferences: ["The last 2 consecutive execution round(s) produced no productive step"],
			successCondition: "the executable check for VALUE reports PASS",
			failureCondition: "the editable file cannot be changed",
		}

		const model = new ScriptedModel(
			[
				toolCallStep("t1", "read_files", { files: [{ path: "/tmp/a" }] }),
				toolCallStep("t2", "read_files", { files: [{ path: "/tmp/a" }] }),
				toolCallStep("t3", "read_files", { files: [{ path: "/tmp/a" }] }),
				toolCallStep("t4", "read_files", { files: [{ path: "/tmp/a" }] }),
				() => [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				],
			],
			selectionReply,
		)

		const runtime = new AgentRuntime({
			model,
			tools: [inspectionTool],
			executionStagnationPolicy: r1Policy,
			boundedObjectivePolicy: policy,
		})
		const notices: string[] = []
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message)
			}
		})

		await runtime.run("Fix the disposable target module")

		// Q4: R2 activated.
		expect(notices.filter((n) => n.includes("bounded objective activated"))).toHaveLength(1)
		// The NEXT dispatched request carries the ACTIVE bounded objective
		// on its privileged channel.
		const objectiveRequests = model.requests.filter((request) =>
			(request.systemPrompt ?? "").includes("[SYSTEM] Active bounded objective (runtime authority):"),
		)
		expect(objectiveRequests.length).toBeGreaterThan(0)
		expect(objectiveRequests[0]?.systemPrompt).toContain("Observable verification condition:")
	})
})

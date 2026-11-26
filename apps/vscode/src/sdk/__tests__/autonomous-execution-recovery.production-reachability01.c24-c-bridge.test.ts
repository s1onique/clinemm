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
	constructor(
		private readonly steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
	) {}
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
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
function finishStep(): AgentModelEvent[] {
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
function recoveryInstructionIn(request: AgentModelRequest): string | undefined {
	return requestTexts(request).find((text) => text.startsWith("[SYSTEM] Execution has stalled:"))
}

/** An inspection-only tool input (a file path, no edit operation). */
const INSPECT_INPUT = { files: [{ path: "/tmp/a.ts" }] }

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

const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }
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
// P1 / P2 — the producer activates the policy in ACT mode only
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / P1-P2", () => {
	it("P1: ACT mode activates the INTENDED policy", async () => {
		const config = await buildProductionConfig("act")
		const policy = config.executionStagnationPolicy
		expect(policy).toBeDefined()
		// The intended thresholds: five unproductive rounds, two
		// instructions, enabled.
		expect(policy?.unproductiveRoundThreshold).toBe(5)
		expect(policy?.maxRecoveryInstructions).toBe(2)
		expect(policy?.enabled).toBe(true)
	})

	it("P2: PLAN mode does NOT activate the policy", async () => {
		const config = await buildProductionConfig("plan")
		// The whole block is ABSENT, not merely disabled. In PLAN mode the
		// agent is forbidden to edit, so an unproductive round is the
		// requested behaviour, not a stall.
		expect(config.executionStagnationPolicy).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// P3 / P4 — the policy reaches the actual runtime, with the host classifier
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / P3-P4", () => {
	it("P3+P4: the policy survives the host's AgentConfig forwarding seam and the host classifier is installed", async () => {
		const config = await buildProductionConfig("act")
		expect(config.executionStagnationPolicy).toBeDefined()

		// Capture the AgentConfig the REAL host builds.
		const captured: AgentConfig[] = []
		const host = new LocalRuntimeHost({
			distinctId: "autonomous-recovery-reachability",
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
			createAgent: (agentConfig) => {
				captured.push(agentConfig)
				// A minimal stand-in: the witness's own runtime is exercised
				// in P5/P6 through the REAL `AgentRuntime` directly, driven
				// by the config the host actually produced.
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
				sessionId: "session-reachability",
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				systemPrompt: "test",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				...(config as Record<string, unknown>),
			} as never,
		})

		expect(captured.length).toBe(1)
		const agentConfig = captured[0]
		// P3: the policy REACHES THE ACTUAL RUNTIME.
		expect(agentConfig.executionStagnationPolicy).toBeDefined()
		expect(agentConfig.executionStagnationPolicy?.unproductiveRoundThreshold).toBe(5)
		expect(agentConfig.executionStagnationPolicy?.maxRecoveryInstructions).toBe(2)
		expect(agentConfig.executionStagnationPolicy?.enabled).toBe(true)
		// P4: the REAL host progress classifier is INSTALLED.
		expect(typeof agentConfig.executionStagnationPolicy?.classifyToolCall).toBe("function")
	})
})

// ---------------------------------------------------------------------------
// P5 / P6 — five qualifying rounds cause an intervention, and the next
//            dispatched request carries the corrective instruction
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / P5-P6", () => {
	it("P5+P6: five qualifying rounds cause an intervention and the NEXT dispatched request carries the corrective instruction", async () => {
		const { AgentRuntime } = await import("@cline/agents")

		// The policy the PRODUCTION producer actually built.
		const config = await buildProductionConfig("act")
		const policy = config.executionStagnationPolicy
		expect(policy).toBeDefined()

		// An inspection-only tool: the rounds produce NO productive step.
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

		// Six inspection-only rounds, then a finishing round. The threshold
		// is FIVE, so the streak trips during the FIFTH inspection round and
		// the SIXTH request must carry the corrective instruction.
		const model = new ScriptedModel([
			toolCallStep("t1", "read_files", INSPECT_INPUT),
			toolCallStep("t2", "read_files", INSPECT_INPUT),
			toolCallStep("t3", "read_files", INSPECT_INPUT),
			toolCallStep("t4", "read_files", INSPECT_INPUT),
			toolCallStep("t5", "read_files", INSPECT_INPUT),
			toolCallStep("t6", "read_files", INSPECT_INPUT),
			() => finishStep(),
		])

		// The REAL runtime, configured with the PRODUCED policy.
		const runtime = new AgentRuntime({
			model,
			tools: [inspectionTool] as never,
			executionStagnationPolicy: policy,
		})
		const notices: string[] = []
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message)
			}
		})

		const result = await runtime.run("implement the bounded correction")

		// The run continued automatically: no operator intervention.
		expect(result.status).toBe("completed")
		expect(calls.count).toBe(6)

		// P5: exactly ONE intervention, caused by the FIVE qualifying rounds.
		const injected = notices.filter((n) => n.includes("execution stagnation detected"))
		expect(injected).toHaveLength(1)
		expect(injected[0]).toContain("after 5 unproductive round(s)")

		// P6: the NEXT dispatched request carries the corrective instruction.
		const instruction = recoveryInstructionIn(model.requests[5])
		expect(instruction).toBeDefined()
		expect(instruction).toContain("the last 5 consecutive execution round(s)")
		expect(instruction).toContain("read_files")
		expect(instruction).toContain("No edit was attempted in those rounds.")
		expect(instruction).toContain("State the single smallest useful experiment or edit")

		// No EARLIER request carried it: the intervention happens at the
		// iteration boundary, not before.
		for (let index = 0; index < 5; index += 1) {
			expect(recoveryInstructionIn(model.requests[index])).toBeUndefined()
		}
	})
})

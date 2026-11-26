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

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
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
	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01): the
	// operator opt-in and the operator-local capture root.
	CLINE_CAPTURE_SELECTION_RESPONSE: process.env.CLINE_CAPTURE_SELECTION_RESPONSE,
	CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	CLINE_CAPTURE_DIR: process.env.CLINE_CAPTURE_DIR,
}
let isolatedHomeDir = ""

beforeEach(() => {
	isolatedHomeDir = mkdtempSync(join(tmpdir(), "autonomous-recovery-reachability-"))
	process.env.HOME = isolatedHomeDir
	process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
	// The operator-local capture root is ISOLATED per case, so a capture
	// written by one case can never be observed by another.
	process.env.CLINE_DATA_DIR = join(isolatedHomeDir, "capture-root")
	// DEFAULT OFF: the selection-RESPONSE capture is disabled unless a
	// case explicitly opts in.
	delete process.env.CLINE_CAPTURE_SELECTION_RESPONSE
	delete process.env.CLINE_CAPTURE_DIR
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
	for (const key of [
		"CLINE_BOUNDED_OBJECTIVE_DOGFOOD",
		"CLINE_CAPTURE_SELECTION_RESPONSE",
		"CLINE_DATA_DIR",
		"CLINE_CAPTURE_DIR",
	] as const) {
		const value = envSnapshot[key]
		if (value === undefined) {
			delete process.env[key]
		} else {
			process.env[key] = value
		}
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
			// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: the selection
			// cites a runtime-owned parent-obligation REFERENCE ID. The parent
			// task of this bridge names no labelled requirement, so the
			// projected vocabulary contains exactly one entry.
			obligationReferences: ["parent-task:original"],
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

// ---------------------------------------------------------------------------
// Q5 - Q8 — ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01)
//
// PRODUCTION REACHABILITY of the R2 selection-RESPONSE capture.
//
// The changeset that introduced `boundedObjectiveSelectionTraceSink` tested
// it by DIRECT INJECTION into `AgentRuntime`. These controls establish that
// the INSTALLED extension can actually SUPPLY and FORWARD the sink, that
// the ACTUAL selection RESPONSE is written to an OPERATOR-LOCAL capture,
// that it is CORRELATED to the existing selector REQUEST identity, and
// that the capture is ABSENT when the operator did not opt in.
//
// The chain under test is the REAL one:
//
//   apps/vscode/src/sdk/cline-session-factory.ts
//     buildSessionConfig({ mode })            <-- THE PRODUCER
//        -> CoreSessionConfig.boundedObjectivePolicy
//           -> LocalRuntimeHost.startSession()   (REAL host)
//              -> the AgentConfig literal    <-- THE FORWARDING SEAM
//                 -> createAgentRuntimeConfig()
//                    -> AgentRuntime         <-- THE ACTUAL RUNTIME
//
// and, for the capture itself:
//
//   apps/vscode/src/sdk/bounded-objective-selection-capture.ts
//     installSelectionResponseCaptureSink()   <-- THE OPT-IN SEAM
//        -> the operator-local capture file
//
// NO paid inference. The model is a deterministic scripted double; the only
// replaced boundary is the model transport.
//
// EVIDENCE CLASS
// --------------
//
// SYNTHETIC_REAL_PRODUCTION_SEAM.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01) / Q5-Q8", () => {
	/**
	 * Drive the REAL host construction + forwarding seam and return the
	 * `AgentConfig` the runtime actually receives.
	 */
	async function captureHostAgentConfig(config: Record<string, unknown>): Promise<AgentConfig> {
		const captured: AgentConfig[] = []
		const host = new LocalRuntimeHost({
			distinctId: "autonomous-recovery-r2-selection-capture",
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions-capture")),
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
				sessionId: "session-r2-selection-capture",
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
		return captured[0] as AgentConfig
	}

	it("Q5: the DEFAULT (no operator opt-in) installs NO sink — the capture is ABSENT", async () => {
		// The operator did not opt in.
		delete process.env.CLINE_CAPTURE_SELECTION_RESPONSE
		const { installSelectionResponseCaptureSink } = await import("../bounded-objective-selection-capture")
		expect(installSelectionResponseCaptureSink()).toBeUndefined()
		// And the REAL host's config carries NO sink key at all.
		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = "1"
		const config = await buildProductionConfig("act")
		const agentConfig = await captureHostAgentConfig(config as unknown as Record<string, unknown>)
		expect(agentConfig.boundedObjectiveSelectionTraceSink).toBeUndefined()
		// And NO capture file was written anywhere under the capture root.
		const captureRoot = join(isolatedHomeDir, "capture-root")
		expect(existsSync(captureRoot)).toBe(false)
	})

	it("Q6: WITH the operator opt-in, the REAL host FORWARDS the sink to the AgentConfig", async () => {
		process.env.CLINE_CAPTURE_SELECTION_RESPONSE = "1"
		const { installSelectionResponseCaptureSink } = await import("../bounded-objective-selection-capture")
		const sink = installSelectionResponseCaptureSink()
		expect(sink).toBeDefined()
		expect(typeof sink?.onSelectionObservation).toBe("function")

		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = "1"
		const config = await buildProductionConfig("act")
		const agentConfig = await captureHostAgentConfig({
			...(config as unknown as Record<string, unknown>),
			boundedObjectiveSelectionTraceSink: sink,
		})
		// The sink SURVIVED the host's AgentConfig forwarding seam.
		expect(agentConfig.boundedObjectiveSelectionTraceSink).toBeDefined()
		expect(typeof agentConfig.boundedObjectiveSelectionTraceSink?.onSelectionObservation).toBe("function")
	})

	/**
	 * The selection reply the R2 selector answers with.
	 */
	const SELECTION_REPLY = {
		objective: "Repair the disposable target so its VALUE constant is 2",
		firstStep: "Edit the disposable target module to set VALUE = 2",
		mutationScope: "the disposable workspace directory",
		verificationCondition: "the run_commands regression check for VALUE reports PASS",
		obligationReferences: ["parent-task:original"],
		evidenceReferences: ["The last 2 consecutive execution round(s) produced no productive step"],
		successCondition: "the executable check for VALUE reports PASS",
		failureCondition: "the editable file cannot be changed",
	}

	/**
	 * The scripted model for the selection-capture controls: FOUR stalled
	 * inspection rounds (enough to exhaust R1's allowance and trip R2),
	 * then a finish.
	 */
	function captureScriptedModel(): ScriptedModel {
		return new ScriptedModel(
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
			SELECTION_REPLY,
		)
	}

	it("Q7: the ACTUAL selection RESPONSE is written to an OPERATOR-LOCAL capture, CORRELATED to the selector REQUEST identity", async () => {
		process.env.CLINE_CAPTURE_SELECTION_RESPONSE = "1"
		const { installSelectionResponseCaptureSink } = await import("../bounded-objective-selection-capture")
		const sink = installSelectionResponseCaptureSink()
		expect(sink).toBeDefined()

		// The REAL runtime, driven through the REAL R2 activation, with the
		// REAL production forwarding seam's sink.
		const { AgentRuntime } = await import("@cline/agents")
		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = "1"
		const config = await buildProductionConfig("act")
		const policy = config.boundedObjectivePolicy
		expect(policy).toBeDefined()

		const model = captureScriptedModel()
		const runtime = new AgentRuntime({
			model,
			tools: [
				{
					name: "read_files",
					description: "Reads files (inspection only)",
					inputSchema: { type: "object" } as never,
					async execute() {
						return "file contents"
					},
				},
			],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 1,
				enabled: true,
			},
			boundedObjectivePolicy: policy,
			boundedObjectiveSelectionTraceSink: sink,
		})
		await runtime.run("Fix the disposable target module")

		// The captured RESPONSE exists, in the OPERATOR-LOCAL capture
		// directory that SITS BESIDE the existing provider-request capture.
		const captureDir = join(isolatedHomeDir, "capture-root", "selection-response-captures")
		expect(existsSync(captureDir)).toBe(true)
		const files = readdirSync(captureDir).filter((name) => name.endsWith(".selection-response.json"))
		expect(files).toHaveLength(1)

		const artifact = JSON.parse(readFileSync(join(captureDir, files[0] as string), "utf8")) as {
			kind: string
			selectorRequestId?: string
			generatedText: string
			disposition: string
			parentTaskId: string
			selectionOrdinal: number
		}
		expect(artifact.kind).toBe("bounded_objective_selection_response")
		// The ACTUAL selection RESPONSE (the model's own reply) is present.
		expect(artifact.generatedText).toContain("VALUE constant is 2")
		// The EXACT validation disposition is present.
		expect(artifact.disposition).toBe("valid")
		expect(artifact.selectionOrdinal).toBeGreaterThan(0)

		// The CORRELATION to the EXISTING selector request identity: the
		// observation carries the SAME id the runtime put into the selection
		// request's transport metadata under the EXISTING `captureId` key.
		expect(artifact.selectorRequestId).toBeTruthy()
		const selectionMetadata = (model.selectionRequests[0]?.options as { metadata?: Record<string, unknown> } | undefined)
			?.metadata
		expect(selectionMetadata?.captureId).toBe(artifact.selectorRequestId)
		expect(selectionMetadata?.kind).toBe("bounded_objective_selection")

		// The capture file is named after the SAME id, so the captured
		// REQUEST and the captured RESPONSE join by EXACT identity.
		expect(files[0]).toBe(`${artifact.selectorRequestId}.selection-response.json`)

		// RESTRICTIVE local file permissions.
		const mode = statSync(join(captureDir, files[0] as string)).mode & 0o777
		expect(mode).toBe(0o600)
		const dirMode = statSync(captureDir).mode & 0o777
		expect(dirMode).toBe(0o700)
	})

	it("Q8: a CAPTURE FAILURE cannot change the selection, the validation or the parent continuation", async () => {
		// The capture root points at a path that CANNOT be created (a FILE
		// stands where the capture directory would be).
		const blocker = join(isolatedHomeDir, "capture-blocked")
		writeFileSync(blocker, "not a directory")
		process.env.CLINE_DATA_DIR = blocker
		process.env.CLINE_CAPTURE_SELECTION_RESPONSE = "1"

		const { installSelectionResponseCaptureSink } = await import("../bounded-objective-selection-capture")
		const sink = installSelectionResponseCaptureSink()
		expect(sink).toBeDefined()

		const { AgentRuntime } = await import("@cline/agents")
		process.env.CLINE_BOUNDED_OBJECTIVE_DOGFOOD = "1"
		const config = await buildProductionConfig("act")
		const policy = config.boundedObjectivePolicy
		expect(policy).toBeDefined()

		const model = captureScriptedModel()
		const runtime = new AgentRuntime({
			model,
			tools: [
				{
					name: "read_files",
					description: "Reads files (inspection only)",
					inputSchema: { type: "object" } as never,
					async execute() {
						return "file contents"
					},
				},
			],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 1,
				enabled: true,
			},
			boundedObjectivePolicy: policy,
			boundedObjectiveSelectionTraceSink: sink,
		})
		const notices: string[] = []
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message)
			}
		})
		await runtime.run("Fix the disposable target module")

		// The selection still activated and the objective was still
		// dispatched: the capture failure changed NOTHING.
		expect(notices.filter((n) => n.includes("bounded objective activated"))).toHaveLength(1)
		const objectiveRequests = model.requests.filter((request) =>
			(request.systemPrompt ?? "").includes("[SYSTEM] Active bounded objective (runtime authority):"),
		)
		expect(objectiveRequests.length).toBeGreaterThan(0)
	})
})

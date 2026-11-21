/**
 * ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01
 *
 * The REAL `AgentRuntime` provider-ready path.
 *
 * This suite drives the actual runtime — not a helper — so the
 * checkpoint is observed at the seam the provider actually sees:
 *
 *   REAL AgentRuntime.run
 *     -> REAL turn loop (assistant turn -> tool calls -> tool results)
 *       -> REAL `turn-finished` event (toolCallCount > 0)
 *         -> REAL `beforeModel` hook (the production hook bag)
 *           -> the provider-bound request
 *
 * The scripted model captures EVERY provider request, so the checkpoint
 * delivery is measured on the provider-visible projection.
 */

import { AgentRuntime } from "@cline/agents"
import type { AgentModel, AgentModelRequest, AgentTool } from "@cline/shared"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { HostProvider } from "@/hosts/host-provider"
import { __resetPrimeInjectionStateForTests } from "../hooks-adapter"
import { SdkSessionConfigBuilder } from "../sdk-session-config-builder"

const mocks = vi.hoisted(() => ({
	buildSessionConfig: vi.fn(),
}))

vi.mock("../cline-session-factory", () => ({
	buildSessionConfig: mocks.buildSessionConfig,
}))

const CHECKPOINT_TEXT = "CHECKPOINT: summarise the work so far before continuing."

const echoTool: AgentTool<{ text: string }, { echoed: string }> = {
	name: "echo",
	description: "Echo input text",
	inputSchema: { type: "object" },
	async execute(input) {
		return { echoed: input.text }
	},
}

/**
 * A scripted model that issues ONE tool call per turn for the first
 * `toolTurns` turns, then finishes.
 */
function makeScriptedModel(toolTurns: number): { model: AgentModel; requests: AgentModelRequest[] } {
	const requests: AgentModelRequest[] = []
	let turn = 0
	const model: AgentModel = {
		stream: async function* (request) {
			requests.push(request)
			turn += 1
			if (turn <= toolTurns) {
				yield {
					type: "tool-call-delta",
					toolCallId: `call-${turn}`,
					toolName: "echo",
					inputText: JSON.stringify({ text: `turn-${turn}` }),
				}
				yield { type: "finish", reason: "tool-calls" }
				return
			}
			yield { type: "text-delta", text: "done" }
			yield { type: "finish", reason: "stop" }
		},
	}
	return { model, requests }
}

/** The text of every message in a provider request. */
function requestTexts(request: AgentModelRequest): string[] {
	return request.messages.flatMap((m) => m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text))
}

function checkpointCountIn(request: AgentModelRequest): number {
	return requestTexts(request).filter((t) => t === CHECKPOINT_TEXT).length
}

async function buildRealHooks(settings: Record<string, unknown>, sessionId: string) {
	mocks.buildSessionConfig.mockImplementation(async () => ({ sessionId }) as never)
	const builder = new SdkSessionConfigBuilder({
		stateManager: {
			getGlobalSettingsKey: vi.fn((key: string) => settings[key]),
			getInstanceSecret: vi.fn(() => undefined),
		} as never,
		emitHookMessage: vi.fn(),
	})
	const config = (await builder.build({ cwd: "/tmp" } as never)) as { hooks: Record<string, unknown> }
	return config.hooks
}

describe("ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01 — real AgentRuntime", () => {
	// The REAL runtime emits telemetry through the host's telemetry service.
	// A minimal HostProvider keeps those emissions inside the test instead
	// of surfacing as unhandled rejections.
	beforeAll(() => {
		HostProvider.initialize(
			() => ({}) as never,
			() => ({}) as never,
			() => ({}) as never,
			{
				workspaceClient: {} as never,
				envClient: {
					getTelemetrySettings: async () => ({ isEnabled: false }),
					subscribeToTelemetrySettings: () => ({ unsubscribe: () => {} }),
					getEnvironmentDetails: async () => ({}),
					getHostVersion: async () => ({
						version: "test-host-version",
						clineVersion: "test-cline-version",
						platform: process.platform,
						clineType: "cline",
					}),
				} as never,
				windowClient: {} as never,
				diffClient: {} as never,
			} as never,
			() => {},
			async () => "",
			async () => "",
			"/tmp/mock-extension",
			"/tmp/mock-global-storage",
		)
	})

	beforeEach(() => {
		mocks.buildSessionConfig.mockReset()
		__resetPrimeInjectionStateForTests()
	})

	it("RT1: the REAL runtime delivers the checkpoint exactly once, in the request after the fourth completed tool-using turn", async () => {
		const hooks = await buildRealHooks(
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: true,
				beforeModelCheckpointText: CHECKPOINT_TEXT,
				beforeModelCheckpointInterval: 4,
			},
			"runtime-session",
		)
		const { model, requests } = makeScriptedModel(6)
		const runtime = new AgentRuntime({ model, tools: [echoTool], hooks: hooks as never })

		const result = await runtime.run("please work")

		expect(result.status).toBe("completed")
		expect(requests.length).toBeGreaterThanOrEqual(6)

		// The FIRST FOUR provider requests (the ones that follow turns
		// 1..4) must NOT carry the checkpoint: the milestone is only
		// reached AFTER the fourth completed tool-using turn.
		for (const request of requests.slice(0, 4)) {
			expect(checkpointCountIn(request)).toBe(0)
		}

		// The request that follows the FOURTH completed tool-using turn
		// carries the checkpoint EXACTLY ONCE.
		expect(checkpointCountIn(requests[4])).toBe(1)
		expect(requestTexts(requests[4])).toContain(CHECKPOINT_TEXT)

		// The next request (after the fifth tool-using turn) does NOT
		// repeat the checkpoint: the next milestone is 8.
		expect(checkpointCountIn(requests[5])).toBe(0)
	})

	it("RT2: with the feature disabled the REAL runtime's provider requests are unchanged", async () => {
		const hooks = await buildRealHooks(
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: false,
				beforeModelCheckpointText: CHECKPOINT_TEXT,
				beforeModelCheckpointInterval: 4,
			},
			"runtime-session-disabled",
		)
		const { model, requests } = makeScriptedModel(6)
		const runtime = new AgentRuntime({ model, tools: [echoTool], hooks: hooks as never })

		await runtime.run("please work")

		for (const request of requests) {
			expect(checkpointCountIn(request)).toBe(0)
		}
	})

	it("RT3: the REAL runtime's final request-budget guard still rejects an over-budget request", async () => {
		const hooks = await buildRealHooks(
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: true,
				beforeModelCheckpointText: CHECKPOINT_TEXT,
				beforeModelCheckpointInterval: 4,
			},
			"runtime-session-budget",
		)
		const { model, requests } = makeScriptedModel(1)
		// The host publishes a tiny ceiling through the `prepareTurn` seam.
		// The runtime enforces it against the FINAL provider request —
		// AFTER every `beforeModel` hook — so the guard stays
		// authoritative even when a hook rewrites the messages.
		const runtime = new AgentRuntime({
			model,
			tools: [echoTool],
			hooks: hooks as never,
			prepareTurn: async (ctx) => ({ messages: ctx.messages, maxRequestTokens: 1 }) as never,
		})

		const result = await runtime.run("please work")

		// The guard fails CLOSED: the run is reported as failed with the
		// budget error, and NO provider request was ever dispatched.
		expect(result.status).toBe("failed")
		expect(result.error).toMatchObject({
			name: "TaskContractBudgetError",
			maxRequestTokens: 1,
		})
		expect(requests).toHaveLength(0)
	})
})

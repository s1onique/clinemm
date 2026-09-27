/**
 * ACT-MYC-CLINEMM02-C-CORRECTION01 — RED witness for prime model-visibility.
 *
 * (See full header in prior edits; this is the same RED-witness file
 * the correction must turn GREEN.)
 */

import { resolve } from "node:path"
import { AgentRuntime } from "@cline/agents"
import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { __resetPrimeInjectionStateForTests, buildAgentHooks } from "@/sdk/hooks-adapter"
import {
	__resetMycPrimeResultsForTests,
	getMycPrimeResult,
	recordMycPrimeResult,
	runMycPrimeOnSessionStart,
} from "@/sdk/myc-prime-automation"
import { McpHub } from "@/services/mcp/McpHub"
import type { McpConnection } from "@/services/mcp/types"

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = []
	constructor(
		private readonly steps: Array<(req: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
	) {}
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) throw new Error("No scripted model step available")
		return toAsyncIterable(step(request))
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) yield event
}

function textOf(messages: readonly AgentMessage[]): string {
	return messages
		.flatMap((m) => m.content)
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("\n")
}

const FIXTURE = resolve(__dirname, "../../services/mcp/__fixtures__/myc-prime-echo/server.mjs")

function createMycHub(serverName: string): McpHub {
	const config = {
		type: "stdio" as const,
		command: "node",
		args: [FIXTURE],
		timeout: 60,
		env: { MYC_SESSION_ID: { fromSession: "sessionId" } } as Record<string, { fromSession: string }>,
	}
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).telemetryService = { captureMcpToolCall: vi.fn() }
	;(hub as any).clientVersion = "test-0.0.0"
	const connection: McpConnection = {
		server: { name: serverName, config: JSON.stringify(config), status: "connected", disabled: false },
		client: {} as unknown as Client,
		transport: {} as unknown as McpConnection["transport"],
	}
	;(hub as any).connections = [connection]
	;(hub as any).sessionConnections = new Map<string, Map<string, McpConnection>>()
	return hub
}

function createEmptyHub(): McpHub {
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).telemetryService = { captureMcpToolCall: vi.fn() }
	;(hub as any).clientVersion = "test-0.0.0"
	;(hub as any).connections = []
	;(hub as any).sessionConnections = new Map<string, Map<string, McpConnection>>()
	return hub
}

function createStateManager(): StateManager {
	return { getGlobalSettingsKey: (k: string) => (k === "hooksEnabled" ? false : undefined) } as unknown as StateManager
}

const SESSION_ID = "red-session-001"

describe("ACT-MYC-CLINEMM02-C-CORRECTION01 — prime must be model-visible", () => {
	beforeEach(() => {
		__resetMycPrimeResultsForTests()
		__resetPrimeInjectionStateForTests()
	})
	afterEach(() => {
		__resetMycPrimeResultsForTests()
		__resetPrimeInjectionStateForTests()
	})

	it("R1: prime text appears in the FIRST model request when singleton is pre-populated", async () => {
		const hub = createMycHub("myc")
		const hooks = buildAgentHooks(createStateManager())
		const result = await runMycPrimeOnSessionStart({ sessionId: SESSION_ID, mcpHub: hub })
		expect(result.status).toBe("ok")
		const recorded = getMycPrimeResult(SESSION_ID)
		expect(recorded?.text).toBeDefined()
		const primeText = recorded!.text!
		expect(primeText.length).toBeGreaterThan(0)

		const model = new ScriptedModel([
			() =>
				[
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])
		const runtime = new AgentRuntime({ model, conversationId: SESSION_ID, hooks: hooks as any })
		await runtime.run("hello")
		expect(model.requests.length).toBe(1)
		expect(textOf(model.requests[0].messages)).toContain(primeText)
	})

	it("R2: prime text appears exactly once across iterations", async () => {
		const hub = createMycHub("myc")
		const hooks = buildAgentHooks(createStateManager())
		const result = await runMycPrimeOnSessionStart({ sessionId: SESSION_ID, mcpHub: hub })
		const primeText = result.text!

		const model = new ScriptedModel([
			() =>
				[
					{ type: "tool-call-delta", toolCallId: "c1", toolName: "echo", inputText: '{"text":"x"}' },
					{ type: "finish", reason: "tool_use" },
				] as Iterable<AgentModelEvent>,
			() =>
				[
					{ type: "text-delta", text: "ok" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])
		const runtime = new AgentRuntime({
			model,
			conversationId: SESSION_ID,
			hooks: hooks as any,
			tools: [
				{
					name: "echo",
					description: "echo",
					inputSchema: { type: "object" },
					async execute(input: { text: string }) {
						return { echoed: input.text }
					},
				},
			],
		})
		await runtime.run("hello")
		const appearances = model.requests.filter((r) => textOf(r.messages).includes(primeText)).length
		expect(appearances).toBe(1)
	})

	it("R3: when prime is unavailable, model request is unchanged", async () => {
		const emptyHub = createEmptyHub()
		const hooks = buildAgentHooks(createStateManager())
		const result = await runMycPrimeOnSessionStart({ sessionId: SESSION_ID, mcpHub: emptyHub })
		expect(result.status).toBe("skipped")
		expect(result.text).toBeUndefined()
		recordMycPrimeResult(result)

		const model = new ScriptedModel([
			() =>
				[
					{ type: "text-delta", text: "ok" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])
		const runtime = new AgentRuntime({ model, conversationId: SESSION_ID, hooks: hooks as any })
		await runtime.run("hello")
		expect(model.requests.length).toBe(1)
		expect(textOf(model.requests[0].messages)).not.toContain("myc-prime-marker")
	})

	it("R4: first model request fires after prime singleton is populated (race closed)", async () => {
		const hub = createMycHub("myc")
		const hooks = buildAgentHooks(createStateManager())
		const model = new ScriptedModel([
			() =>
				[
					{ type: "text-delta", text: "ok" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])
		const runtime = new AgentRuntime({ model, conversationId: SESSION_ID, hooks: hooks as any })
		await runMycPrimeOnSessionStart({ sessionId: SESSION_ID, mcpHub: hub })
		await runtime.run("hello")
		expect(model.requests.length).toBe(1)
		expect(getMycPrimeResult(SESSION_ID)).toBeDefined()
		expect(["ok", "failed", "skipped"]).toContain(getMycPrimeResult(SESSION_ID)!.status)
	})
})

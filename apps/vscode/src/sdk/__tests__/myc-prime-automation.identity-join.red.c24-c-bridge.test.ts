/**
 * ACT-MYC-CLINEMM02-C-CORRECTION02 — RED witness for the identity-join bug.
 *
 * The previous correction (CORRECTION01) made the prime text model-visible
 * via a `beforeModel` hook. The hook looked up the recorded prime by
 * `ctx.snapshot.conversationId` -- the agent's conversation id, generated
 * by `ConversationStore` (`conv_<ts>_<rand>`).
 *
 * But `runMycPrimeOnSessionStart` records the prime keyed by
 * `startResult.sessionId` -- the HOST session id (CoreSessionConfig.sessionId),
 * which is a DIFFERENT identity layer. In production these two ids never
 * coincide.
 *
 * The CORRECTION01 tests artificially made them equal
 * (`conversationId: SESSION_ID`) -- a synthetic identity equivalence that
 * doesn't reflect production. This file is the production-shaped RED:
 *
 *   hostSessionId   = "host-session-red-001"
 *   conversationId  = "conv_<generated-by-store>"
 *
 *   prime is recorded under hostSessionId.
 *   beforeModel hook looks up under conversationId.
 *   => MISS => prime not injected into first model request.
 *
 * This file is expected to FAIL RED on the prior CORRECTION01 code, and
 * PASS GREEN after the CORRECTION02 production fix threads the canonical
 * host sessionId through to the beforeModel hook context.
 */

import { resolve } from "node:path"
import { AgentRuntime } from "@cline/agents"
import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { __resetPrimeInjectionStateForTests, buildAgentHooks } from "@/sdk/hooks-adapter"
import { __resetMycPrimeResultsForTests, getMycPrimeResult, runMycPrimeOnSessionStart } from "@/sdk/myc-prime-automation"
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

function createStateManager(): StateManager {
	return { getGlobalSettingsKey: (k: string) => (k === "hooksEnabled" ? false : undefined) } as unknown as StateManager
}

// PRODUCTION-SHAPED: host sessionId and agent conversationId are DIFFERENT.
// In real production:
//   - hostSessionId   = startResult.sessionId (host-owned, persistent, routed
//                       via CoreSessionConfig.sessionId)
//   - conversationId  = agent runtime's ConversationStore id (generated
//                       `conv_<ts>_<rand>`, used for transcript correlation)
// The CORRECTION01 hook used `ctx.snapshot.conversationId` to look up the
// prime -- which is keyed by hostSessionId. Result: lookup MISS in production.
const HOST_SESSION_ID = "host-session-red-001"
const AGENT_CONVERSATION_ID = "conv_20260101_xxxxxxxx"

describe("ACT-MYC-CLINEMM02-C-CORRECTION02 -- production-shaped identity-join RED", () => {
	beforeEach(() => {
		__resetMycPrimeResultsForTests()
		__resetPrimeInjectionStateForTests()
	})
	afterEach(() => {
		__resetMycPrimeResultsForTests()
		__resetPrimeInjectionStateForTests()
	})

	it("RED-R5: prime stored under HOST_SESSION_ID is NOT found by beforeModel when runtime uses AGENT_CONVERSATION_ID", async () => {
		// Arrange: prime recorded under host sessionId (real production flow:
		// SdkSessionLifecycle.startNewSession calls runMycPrimeOnSessionStart
		// with sessionId = startResult.sessionId = CoreSessionConfig.sessionId).
		const hub = createMycHub("myc")
		const hooks = buildAgentHooks(createStateManager())
		const result = await runMycPrimeOnSessionStart({ sessionId: HOST_SESSION_ID, mcpHub: hub })
		expect(result.status).toBe("ok")
		const primeText = result.text!
		expect(primeText.length).toBeGreaterThan(0)

		// Sanity: prime IS recorded under HOST_SESSION_ID.
		const recorded = getMycPrimeResult(HOST_SESSION_ID)
		expect(recorded?.text).toBe(primeText)

		// Sanity: there is NO recording under AGENT_CONVERSATION_ID --
		// in production the two ids never coincide.
		expect(getMycPrimeResult(AGENT_CONVERSATION_ID)).toBeUndefined()

		// Act: runtime constructed with the agent's conversationId (different
		// identity layer) -- exactly mirroring what SessionRuntimeOrchestrator
		// does in production.
		const model = new ScriptedModel([
			() =>
				[
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])
		const runtime = new AgentRuntime({
			model,
			// PRODUCTION-SHAPED: the host sessionId and the agent
			// conversationId are DIFFERENT identity layers. In production
			// `CoreSessionConfig.sessionId` populates
			// `AgentRuntimeConfig.sessionId` (the host-owned id) and a
			// separate `AgentRuntimeConfig.conversationId` (the agent
			// transcript id, often auto-generated as `conv_<ts>_<rand>`
			// by `ConversationStore`).
			sessionId: HOST_SESSION_ID,
			conversationId: AGENT_CONVERSATION_ID,
			hooks: hooks as any,
		})
		await runtime.run("hello")

		// Assert: under CORRECTION01 (the broken code), the first model
		// request's messages DO NOT contain the prime text -- because the
		// hook looked up `ctx.snapshot.conversationId` and got AGENT_CONVERSATION_ID,
		// but the prime is stored under HOST_SESSION_ID. The lookup misses.
		expect(model.requests.length).toBe(1)
		const firstRequestText = textOf(model.requests[0].messages)
		// RED proof: after the CORRECTION02 fix threads host sessionId into
		// the beforeModel context, the lookup WILL find the prime and this
		// assertion will hold (GREEN).
		expect(firstRequestText).toContain(primeText)
	})

	it("RED-R6: prime must be injected even when conversationId is auto-generated (no synthetic id equality)", async () => {
		// Arrange: same as R5 but conversationId is a synthetic string of the
		// form ConversationStore would generate -- confirms the failure mode is
		// the LOOKUP KEY, not the id format.
		const hub = createMycHub("myc")
		const hooks = buildAgentHooks(createStateManager())
		const result = await runMycPrimeOnSessionStart({ sessionId: HOST_SESSION_ID, mcpHub: hub })
		const primeText = result.text!

		const model = new ScriptedModel([
			() =>
				[
					{ type: "text-delta", text: "ok" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])
		const runtime = new AgentRuntime({
			model,
			sessionId: HOST_SESSION_ID,
			conversationId: "conv_99999999_zzzzzzz",
			hooks: hooks as any,
		})
		await runtime.run("hello")
		expect(model.requests.length).toBe(1)
		expect(textOf(model.requests[0].messages)).toContain(primeText)
	})
})

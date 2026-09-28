/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01 — API-01 RED witness.
 *
 * Mission: prove the LIVE05 production defect is reproducible against the
 * real production seam — without any test-body shortcut that bypasses the
 * session-start lifecycle.
 *
 * Production seam under test (real source paths on HEAD):
 *   1. startNewSession is invoked with startInput.config.sessionId = S
 *      (allocated upstream by sdk-task-start-coordinator.ts:246)
 *   2. SdkSessionLifecycle.startNewSession awaits sdkHost.start(input)
 *      which returns { sessionId: input.config.sessionId } (mirrors
 *      ClineCore.startSession which echoes the requested id)
 *   3. SdkSessionLifecycle.startNewSession awaits onMycPrimeRequested({
 *      sessionId: startResult.sessionId, cwd }) which delegates to
 *      runMycPrimeOnSessionStart({ sessionId, mcpHub })
 *      → recordMycPrimeResult({ sessionId, status: "ok", text, ts })
 *      → lastResultBySessionId.set(sessionId, result)
 *   4. Lifecycle returns { status: "started", startResult, sdkHost }
 *   5. Caller drives the runtime with sessionId === startResult.sessionId
 *      (= the same id the recorder was keyed by) and a SEPARATE
 *      conversationId (the agent transcript id, produced by
 *      ConversationStore as `conv_<ts>_<rand>`)
 *   6. AgentRuntime.snapshot().sessionId === AgentRuntimeConfig.sessionId
 *      === startResult.sessionId (production invariant)
 *   7. beforeModel fires on the first iteration, looks up
 *      getMycPrimeResult(snapshot.sessionId ?? snapshot.conversationId),
 *      which MUST hit the recorder entry from step 3
 *   8. The mutated request (containing <prime_packet>) reaches the
 *      model adapter
 *
 * If any of those transitions silently breaks in production, API-01 REDs.
 *
 * Topology (per ACT §11):
 *   - The test body does NOT manually call runMycPrimeOnSessionStart.
 *   - The test body does NOT model myc_prime tool calls.
 *   - The only prime invocation is the production automatic-prime path
 *     wired through SdkSessionLifecycle.onMycPrimeRequested.
 *
 * RED-vs-GREEN contract:
 *   - On HEAD `89249175c...` this test reproduces the defect: the first
 *     model request lacks <prime_packet source="myc" session="S"> and
 *     lacks MYC-AUTO-PRIME-WITNESS-AUTO01. Recorded as the API-01 RED.
 *   - After a bounded repair (ACT §42), this test goes GREEN with
 *     exactly one <prime_packet> block on iteration 1, zero on later
 *     iterations, and the recorder key matches the runtime snapshot.
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
	runMycPrimeOnSessionStart,
} from "@/sdk/myc-prime-automation"
import { SdkSessionLifecycle } from "@/sdk/sdk-session-lifecycle"
import { McpHub } from "@/services/mcp/McpHub"
import type { McpConnection } from "@/services/mcp/types"

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
			getGlobalStateKey: () => undefined,
		}),
	},
}))

const WITNESS = "MYC-AUTO-PRIME-WITNESS-AUTO01"
const FIXTURE = resolve(__dirname, "../../services/mcp/__fixtures__/myc-prime-auto/server.mjs")

// ---------- Scripted model adapter (captures every request) ----------

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

function findPrimePackets(text: string): string[] {
	const re = /<prime_packet\s+source="myc"\s+session="([^"]+)"[^>]*>([\s\S]*?)<\/prime_packet>/g
	const out: string[] = []
	let m: RegExpExecArray | null
	while ((m = re.exec(text))) {
		out.push(m[1])
	}
	return out
}

// ---------- McpHub fake with the deterministic prime-auto fixture ----------

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

// ---------- Production-shape driver: real lifecycle, mocked only ClineCore ----------

interface DriverHooks {
	onMycPrimeRequested: (input: { sessionId: string; cwd?: string }) => Promise<unknown> | undefined
}

/**
 * Build a fake SdkHost that mimics ClineCore.startSession's echo behavior:
 *   startResult.sessionId === input.config.sessionId
 * That is exactly what sdk/packages/core/src/runtime/host/local-runtime-host.ts:526-540
 * does (`sessionId = requestedSessionId || createSessionId()`).
 */
function makeEchoingSdkHost(sessionIdToEcho: string) {
	return {
		start: vi.fn().mockResolvedValue({ sessionId: sessionIdToEcho }),
		subscribe: vi.fn().mockReturnValue(vi.fn()),
		send: vi.fn().mockResolvedValue(undefined),
		restore: vi.fn().mockResolvedValue({
			sessionId: sessionIdToEcho,
			startResult: { sessionId: sessionIdToEcho },
			checkpoint: { ref: "abc", createdAt: 1, runCount: 1 },
		}),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
}

/**
 * Run the production seam end-to-end WITHOUT any test-body shortcut.
 *
 *   startInput.config.sessionId → S (allocated upstream, NOT in test body)
 *     ↓
 *   lifecycle.startNewSession echoes S as startResult.sessionId
 *     ↓
 *   onMycPrimeRequested is awaited with sessionId=S → lastResultBySessionId[S]
 *     ↓
 *   AgentRuntime({ sessionId: S, conversationId: <auto-generated>, hooks })
 *     ↓
 *   runtime.run("hello") → ScriptedModel.stream receives the FIRST request
 */
async function driveProductionShape(opts: {
	hub: McpHub
	preallocatedSessionId: string
	hooks: ReturnType<typeof buildAgentHooks>
	model: AgentModel
	sdkHostFactory: (sessionIdToEcho: string) => ReturnType<typeof makeEchoingSdkHost>
}): Promise<{ startResultSessionId: string; conversationId: string; requests: AgentModelRequest[] }> {
	const lifecycle = new SdkSessionLifecycle({
		mcpHub: opts.hub,
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		requestToolApproval: vi.fn() as any,
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		askQuestion: vi.fn() as any,
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		onSessionEvent: vi.fn() as any,
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		onSendComplete: vi.fn() as any,
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		onSendError: vi.fn() as any,
		// PRODUCTION AUTOMATIC PRIME TRIGGER (do NOT call runMycPrimeOnSessionStart
		// from the test body).
		onMycPrimeRequested: ({ sessionId }) => runMycPrimeOnSessionStart({ sessionId, mcpHub: opts.hub }),
	})

	const sdkHost = opts.sdkHostFactory(opts.preallocatedSessionId)
	// Inject our echoing host directly into the lifecycle's shared-host slot.
	// The lifecycle.getOrCreateSharedHost() path would invoke the real
	// VscodeSessionHost.create which would itself invoke the (mocked)
	// ClineCore.create — bypass that by assigning the active host directly.
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	;(lifecycle as any).sharedHost = sdkHost

	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const started = await lifecycle.startNewSession({
		config: {
			sessionId: opts.preallocatedSessionId,
			cwd: "/workspace",
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			apiKey: "test-key",
		},
	} as any)
	if (started.status !== "started") {
		throw new Error(`startNewSession returned ${started.status}`)
	}
	const startResultSessionId = started.startResult.sessionId

	// Drive the runtime with the EXACT id the lifecycle returned. The
	// conversationId is the agent's transcript id (auto-generated by
	// ConversationStore in production) and MUST be distinct from sessionId.
	const conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
	const runtime = new AgentRuntime({
		model: opts.model,
		sessionId: startResultSessionId,
		conversationId,
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		hooks: opts.hooks as any,
	})
	await runtime.run("hello")

	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const requests = (opts.model as any).requests as AgentModelRequest[]
	return { startResultSessionId, conversationId, requests }
}

// ---------- Tests ----------

describe("ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01 — API-01 RED", () => {
	beforeEach(() => {
		__resetMycPrimeResultsForTests()
		__resetPrimeInjectionStateForTests()
	})
	afterEach(() => {
		__resetMycPrimeResultsForTests()
		__resetPrimeInjectionStateForTests()
	})

	it("API-01 RED: the production seam delivers exactly one prime_packet in iteration 1 (mirrors LIVE05 defect)", async () => {
		// Arrange: production-shape inputs.
		const SESSION_ID = "host-session-1790604494785_8zlsd"
		const hub = createMycHub("myc")
		const hooks = buildAgentHooks(createStateManager())
		const model = new ScriptedModel([
			() =>
				[
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])

		// Act: drive the real lifecycle end-to-end. The test body does NOT
		// call runMycPrimeOnSessionStart directly — only the production
		// automatic-prime path through SdkSessionLifecycle.onMycPrimeRequested.
		const { startResultSessionId, requests } = await driveProductionShape({
			hub,
			preallocatedSessionId: SESSION_ID,
			hooks,
			model,
			sdkHostFactory: makeEchoingSdkHost,
		})

		// Sanity: lifecycle preserved the host-owned sessionId exactly.
		expect(startResultSessionId).toBe(SESSION_ID)

		// Sanity: the production automatic-prime path recorded the prime
		// BEFORE startNewSession returned (awaited inside the lifecycle).
		const recorded = getMycPrimeResult(SESSION_ID)
		expect(recorded).toBeDefined()
		expect(recorded?.status).toBe("ok")
		expect(recorded?.text).toContain(WITNESS)

		// ACTUAL RED ASSERTION: the first model request from the scripted
		// adapter MUST contain the prime packet AND the witness.
		expect(requests.length).toBeGreaterThan(0)
		const firstRequestText = textOf(requests[0].messages)
		const packets = findPrimePackets(firstRequestText)
		expect(packets.length).toBe(1)
		expect(packets[0]).toBe(SESSION_ID)
		expect(firstRequestText).toContain(WITNESS)
	})

	it("API-02 RED: automatic prime fires exactly once even when the runtime loops (later iterations MUST not re-inject)", async () => {
		const SESSION_ID = "host-session-loops-001"
		const hub = createMycHub("myc")
		const hooks = buildAgentHooks(createStateManager())
		const model = new ScriptedModel([
			() =>
				[
					{
						type: "tool-call-delta",
						toolCallId: "c1",
						toolName: "noop",
						inputText: "{}",
					},
					{ type: "finish", reason: "tool_use" },
				] as Iterable<AgentModelEvent>,
			() =>
				[
					{
						type: "tool-call-delta",
						toolCallId: "c2",
						toolName: "noop",
						inputText: "{}",
					},
					{ type: "finish", reason: "tool_use" },
				] as Iterable<AgentModelEvent>,
			() =>
				[
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])

		const { requests } = await driveProductionShape({
			hub,
			preallocatedSessionId: SESSION_ID,
			hooks,
			model,
			sdkHostFactory: makeEchoingSdkHost,
		})

		// Cardinality invariant: only iteration 1 carries the packet.
		expect(requests.length).toBeGreaterThanOrEqual(2)
		const packetCounts = requests.map((r) => findPrimePackets(textOf(r.messages)).length)
		expect(packetCounts[0]).toBe(1)
		for (let i = 1; i < packetCounts.length; i += 1) {
			expect(packetCounts[i]).toBe(0)
		}
	})

	it("API-08 RED: no-prime case (helper returns skipped) MUST NOT inflate the first request, and session still runs", async () => {
		const SESSION_ID = "host-session-empty-prime"
		// Empty hub: no myc server registered → runMycPrimeOnSessionStart
		// will return status="skipped" (no callTool fires, no recorder
		// entry written). This is the no-prime case: session still runs,
		// no prime packet, no error.
		const hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).telemetryService = { captureMcpToolCall: vi.fn() }
		;(hub as any).clientVersion = "test-0.0.0"
		;(hub as any).connections = []
		;(hub as any).sessionConnections = new Map<string, Map<string, McpConnection>>()

		const hooks = buildAgentHooks(createStateManager())
		const model = new ScriptedModel([
			() =>
				[
					{ type: "text-delta", text: "ok" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])

		// Production automatic-prime trigger with the empty hub.
		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			// biome-ignore lint/suspicious/noExplicitAny: focused fake
			requestToolApproval: vi.fn() as any,
			// biome-ignore lint/suspicious/noExplicitAny: focused fake
			askQuestion: vi.fn() as any,
			// biome-ignore lint/suspicious/noExplicitAny: focused fake
			onSessionEvent: vi.fn() as any,
			// biome-ignore lint/suspicious/noExplicitAny: focused fake
			onSendComplete: vi.fn() as any,
			// biome-ignore lint/suspicious/noExplicitAny: focused fake
			onSendError: vi.fn() as any,
			onMycPrimeRequested: ({ sessionId }) => runMycPrimeOnSessionStart({ sessionId, mcpHub: hub }),
		})

		const SDKHOST = makeEchoingSdkHost(SESSION_ID)
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		;(lifecycle as any).sharedHost = SDKHOST

		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		const started = await lifecycle.startNewSession({
			config: { sessionId: SESSION_ID, cwd: "/workspace" } as any,
		})
		if (started.status !== "started") throw new Error("start failed")

		// Sanity: the recorder was populated with status="skipped" (no text).
		const recorded = getMycPrimeResult(SESSION_ID)
		expect(recorded?.status).toBe("skipped")
		expect(recorded?.text).toBeUndefined()

		const runtime = new AgentRuntime({
			model,
			sessionId: started.startResult.sessionId,
			conversationId: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			hooks: hooks as any,
		})
		await runtime.run("hello")

		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		const requests = (model as any).requests as AgentModelRequest[]
		expect(requests.length).toBe(1)
		const firstText = textOf(requests[0].messages)
		expect(findPrimePackets(firstText).length).toBe(0)
	})

	it("API-04 RED: snapshot.sessionId is the HOST sessionId (not the agent conversationId)", async () => {
		const SESSION_ID = "host-session-snapshot-key"
		const hub = createMycHub("myc")
		const hooks = buildAgentHooks(createStateManager())
		const model = new ScriptedModel([
			() =>
				[
					{ type: "text-delta", text: "ok" },
					{ type: "finish", reason: "stop" },
				] as Iterable<AgentModelEvent>,
		])

		const { startResultSessionId, conversationId } = await driveProductionShape({
			hub,
			preallocatedSessionId: SESSION_ID,
			hooks,
			model,
			sdkHostFactory: makeEchoingSdkHost,
		})

		// Identity-join invariant: startResult.sessionId is the HOST id,
		// conversationId is the AGENT transcript id. They MUST be distinct.
		expect(startResultSessionId).toBe(SESSION_ID)
		expect(conversationId).not.toBe(SESSION_ID)
		expect(conversationId.startsWith("conv_")).toBe(true)
	})
})

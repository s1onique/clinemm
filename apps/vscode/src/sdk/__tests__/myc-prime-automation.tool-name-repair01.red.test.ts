/**
 * ACT-MYC-CLINEMM03-AUTOMATIC-PRIME-TOOL-NAME-REPAIR01 — tool-name
 * mismatch RED reproduction.
 *
 * Mission: prove the LIVE-dump causal chain.
 *
 *   1. RED-A: the production automatic prime path invokes
 *      `callTool(serverName, "prime", ...)`. The real published
 *      myc MCP server exports `myc_prime`. The stubbed client in
 *      this test advertises `myc_prime` and throws
 *      `McpError(InvalidParams, "unknown tool 'prime'")` —
 *      bit-identical to the LIVE dump `-32602: unknown tool
 *      'prime'`. The acquisition MUST record
 *      `phase=tool_call, failureClass=unknown_tool` (the new
 *      discriminator class added in this ACT). WITHOUT the repair,
 *      the discriminator would return `client_request_failed` and
 *      the live cause would be hidden.
 *
 *   2. RED-B (ABLATION): the legacy `"prime"` literal is restored
 *      at the McpHub boundary, which RE-EXPOSES the LIVE-dump
 *      shape (`unknown tool 'prime'`,
 *      `failureClass=unknown_tool`). This pins the discriminator's
 *      specificity for the canonical MCP error shape.
 *
 *   3. GREEN: the production path is repaired (`"prime"` →
 *      `"myc_prime"`), reaches the stubbed client with the right
 *      tool name, and the prime result is recorded
 *      (`status="ok"`, `toolFound=true`, `textPresent=true`).
 *
 *   4. DIAGNOSTIC OFF: the unknown_tool observation is silent when
 *      the diag is disabled (off-path bit-identical).
 *
 * Topology (per ACT §5):
 *   - The test body does NOT manually call `runMycPrimeOnSessionStart`.
 *   - The test body does NOT manually call the `myc_prime` tool.
 *   - The only prime invocation is the production automatic-prime
 *     path wired through `SdkSessionLifecycle.onMycPrimeRequested`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
import "should"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import sinon from "sinon"
import { __resetMycPrimeResultsForTests, getMycPrimeResult, runMycPrimeOnSessionStart } from "@/sdk/myc-prime-automation"
import { __resetMycPrimeLiveDiagForTests, getMycPrimeLiveDiag, setMycPrimeLiveDiagEnabled } from "@/sdk/myc-prime-live-diag"
import { SdkSessionLifecycle } from "@/sdk/sdk-session-lifecycle"
import type { SdkSessionHost } from "@/sdk/session-host"
import { McpHub } from "@/services/mcp/McpHub"
import type { McpConnection } from "@/services/mcp/types"

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
		}),
	},
}))

function createMycHubWithAdvertingClient(options: {
	clientRequest: (req: { method: string; params?: unknown }) => Promise<unknown>
}): McpHub {
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).telemetryService = { captureMcpToolCall: sinon.stub() }
	;(hub as any).clientVersion = "test-0.0.0"
	const connection: McpConnection = {
		server: { name: "myc", config: "{}", status: "connected", disabled: false },
		client: {} as unknown as Client,
		transport: {} as unknown as McpConnection["transport"],
	}
	;(hub as any).connections = [connection]
	;(hub as any).sessionConnections = new Map<string, Map<string, McpConnection>>()
	;(hub as any).ensureSessionConnection = async () =>
		({
			server: { name: "myc", config: "{}", status: "connected", disabled: false },
			client: {
				request: options.clientRequest,
			},
			transport: {} as unknown as McpConnection["transport"],
		}) as unknown as McpConnection
	return hub
}

function makeFakeSdkHost(sessionIdToReturn: string): SdkSessionHost {
	return {
		start: async () => ({ sessionId: sessionIdToReturn }),
		stop: async () => {},
		subscribe: () => () => {},
		pendingPrompts: async () => [],
	} as unknown as SdkSessionHost
}

async function waitForPrimeResult(sessionId: string, timeoutMs = 2000): Promise<void> {
	const start = Date.now()
	while (!getMycPrimeResult(sessionId) && Date.now() - start < timeoutMs) {
		await new Promise((r) => setTimeout(r, 25))
	}
}

const REJECT_IF_NOT_MYC_PRIME = async (req: { method: string; params?: unknown }): Promise<unknown> => {
	if (req.method === "tools/call") {
		const name = (req.params as { name?: string } | undefined)?.name
		if (name !== "myc_prime") {
			// Bit-identical to LIVE dump: `-32602: unknown tool 'prime'`.
			throw new McpError(ErrorCode.InvalidParams, `unknown tool '${name}'`)
		}
		return {
			content: [{ type: "text", text: '{"session":"green"}' }],
		}
	}
	return {}
}

function buildLifecycleWithHub(sessionId: string, hub: McpHub): SdkSessionLifecycle {
	const lifecycle = new SdkSessionLifecycle({
		mcpHub: hub,
		requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
		askQuestion: sinon.stub().resolves({}) as never,
		onSessionEvent: sinon.stub(),
		onSendComplete: sinon.stub(),
		onSendError: sinon.stub(),
		onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
	})
	;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
	;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))
	return lifecycle
}

async function startNewSessionAt(lifecycle: SdkSessionLifecycle, sessionId: string): Promise<{ status: string }> {
	return lifecycle.startNewSession({
		config: {
			sessionId,
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			cwd: "/workspace",
		},
	} as never) as Promise<{ status: string }>
}

describe("ACT-MYC-CLINEMM03-AUTOMATIC-PRIME-TOOL-NAME-REPAIR01 — tool-name mismatch RED reproduction", () => {
	beforeEach(() => {
		__resetMycPrimeResultsForTests()
		__resetMycPrimeLiveDiagForTests()
		setMycPrimeLiveDiagEnabled(true)
	})

	afterEach(() => {
		__resetMycPrimeResultsForTests()
		__resetMycPrimeLiveDiagForTests()
		setMycPrimeLiveDiagEnabled(false)
	})

	it("RED-A: when the production path uses 'prime' (legacy) and the server exports 'myc_prime', the discriminator pins failureClass=unknown_tool", async () => {
		// The production repair has already landed (callTool now uses
		// `myc_prime`). To assert the discriminator catches the legacy
		// shape end-to-end, this test FORCES the legacy name at the
		// McpHub boundary (an ablation-style override). This is the
		// RED-A witness for the LIVE dump shape
		// (`MCP error -32602: unknown tool 'prime'`).
		const sessionId = `apmcp-tn-redA-${Date.now()}`
		const calls: Array<{ method: string; params?: unknown }> = []
		const hub = createMycHubWithAdvertingClient({
			clientRequest: async (req) => {
				calls.push(req)
				return REJECT_IF_NOT_MYC_PRIME(req)
			},
		})
		// Force the legacy `"prime"` literal at the callTool boundary.
		const originalCallTool = hub.callTool.bind(hub)
		;(hub as any).callTool = async (
			serverName: string,
			_toolName: string,
			toolArguments: Record<string, unknown> | undefined,
			ulid: string,
			signal?: AbortSignal,
			sessionIdArg?: string,
		) => {
			return originalCallTool(serverName, "prime", toolArguments, ulid, signal, sessionIdArg)
		}

		const lifecycle = buildLifecycleWithHub(sessionId, hub)
		const result = await startNewSessionAt(lifecycle, sessionId)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("tool_call")
		// The new discriminator class — distinct from `client_request_failed`.
		expect(entry?.acquisition.failureClass).toBe("unknown_tool")
		expect(entry?.acquisition.toolFound).toBe(false)
		// Diagnostic captures the original MCP error verbatim. The
		// SDK's McpError constructor prefixes with `MCP error <code>: `,
		// so the literal substring appears AFTER the prefix.
		expect(entry?.acquisition.error).toContain("MCP error -32602: unknown tool 'prime'")

		// Confirm exactly one tools/call was issued (no retry path).
		const toolCalls = calls.filter((c) => c.method === "tools/call")
		expect(toolCalls).toHaveLength(1)
		// The legacy tool name reaches the wire.
		expect((toolCalls[0].params as { name?: string } | undefined)?.name).toBe("prime")
	})

	it("RED-B (ABLATION): restoring the legacy 'prime' literal RE-EXPOSES the LIVE-dump shape", async () => {
		const sessionId = `apmcp-tn-redB-${Date.now()}`
		const calls: Array<{ method: string; params?: unknown }> = []
		const hub = createMycHubWithAdvertingClient({
			clientRequest: async (req) => {
				calls.push(req)
				return REJECT_IF_NOT_MYC_PRIME(req)
			},
		})
		// Override callTool to translate the production tool name
		// BACK to the legacy `"prime"` literal — this is the
		// ablation that proves the discriminator catches the
		// legacy shape end-to-end.
		const originalCallTool = hub.callTool.bind(hub)
		;(hub as any).callTool = async (
			serverName: string,
			_toolName: string,
			toolArguments: Record<string, unknown> | undefined,
			ulid: string,
			signal?: AbortSignal,
			sessionIdArg?: string,
		) => {
			return originalCallTool(serverName, "prime", toolArguments, ulid, signal, sessionIdArg)
		}

		const lifecycle = buildLifecycleWithHub(sessionId, hub)
		const result = await startNewSessionAt(lifecycle, sessionId)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("tool_call")
		expect(entry?.acquisition.failureClass).toBe("unknown_tool")
		expect(entry?.acquisition.error).toContain("MCP error -32602: unknown tool 'prime'")

		// Sanity: only ONE tools/call issued.
		const toolCalls = calls.filter((c) => c.method === "tools/call")
		expect(toolCalls).toHaveLength(1)
	})

	it("GREEN: production path uses 'myc_prime' against a server that advertises 'myc_prime' → acquisition succeeds and recordedPrimeFound=true", async () => {
		const sessionId = `apmcp-tn-green-${Date.now()}`
		const calls: Array<{ method: string; params?: unknown }> = []
		const hub = createMycHubWithAdvertingClient({
			clientRequest: async (req) => {
				calls.push(req)
				return REJECT_IF_NOT_MYC_PRIME(req)
			},
		})

		const lifecycle = buildLifecycleWithHub(sessionId, hub)
		const result = await startNewSessionAt(lifecycle, sessionId)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("ok")
		expect(entry?.acquisition.phase).toBe("tool_call")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("spawned")
		expect(entry?.acquisition.toolFound).toBe(true)
		expect(entry?.acquisition.failureClass).toBeUndefined()
		expect(entry?.acquisition.textPresent).toBe(true)
		expect(entry?.acquisition.textBytes).toBeGreaterThan(0)

		// Production repair: confirm exactly ONE tools/call was
		// issued, with the new tool name `myc_prime`.
		const toolCalls = calls.filter((c) => c.method === "tools/call")
		expect(toolCalls).toHaveLength(1)
		expect((toolCalls[0].params as { name?: string } | undefined)?.name).toBe("myc_prime")

		// The recorder MUST have stored an ok result keyed by sessionId.
		const recorded = getMycPrimeResult(sessionId)
		expect(recorded?.status).toBe("ok")
		expect(recorded?.text).toBe('{"session":"green"}')
	})

	it("DIAGNOSTIC OFF: the unknown_tool observation is silent (off-path bit-identical)", async () => {
		setMycPrimeLiveDiagEnabled(false)
		const sessionId = `apmcp-tn-off-${Date.now()}`
		const hub = createMycHubWithAdvertingClient({
			clientRequest: async (req) => REJECT_IF_NOT_MYC_PRIME(req),
		})
		// Force the legacy `"prime"` literal so the silent path
		// actually exercises a failure shape.
		const originalCallTool = hub.callTool.bind(hub)
		;(hub as any).callTool = async (
			serverName: string,
			_toolName: string,
			toolArguments: Record<string, unknown> | undefined,
			ulid: string,
			signal?: AbortSignal,
			sessionIdArg?: string,
		) => {
			return originalCallTool(serverName, "prime", toolArguments, ulid, signal, sessionIdArg)
		}

		const lifecycle = buildLifecycleWithHub(sessionId, hub)
		const result = await startNewSessionAt(lifecycle, sessionId)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		// Diagnostic off → no entry written, but the recorder still
		// holds the failed result.
		expect(getMycPrimeLiveDiag(sessionId)).toBeUndefined()
		const recorded = getMycPrimeResult(sessionId)
		expect(recorded?.status).toBe("failed")
		expect(recorded?.error).toContain("MCP error -32602: unknown tool 'prime'")
	})
})

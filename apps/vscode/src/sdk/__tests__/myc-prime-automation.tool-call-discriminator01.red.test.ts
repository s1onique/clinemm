/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01 — typed
 * tool-call failure discriminator RED reproduction.
 *
 * Mission: prove the live diagnostic can distinguish the FOUR distinct
 * typed MCP failure modes that currently collapse into a single
 * `(phase=tool_call, failureClass=client_request_failed)` pair:
 *
 *   APMCP-07: McpError(code=RequestTimeout)            → tool_timeout
 *   APMCP-08: McpError(code=MethodNotFound)            → method_not_found
 *   APMCP-09: response.isError=true (handler-level)    → tool_returned_error
 *   APMCP-10: client.request throws a generic Error     → client_request_failed (catch-all, back-compat with AF-RED-05)
 *
 * Each test below targets ONE of the four hypotheses from
 * `.factory/acts/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01.md`
 * §6 / §17. The discriminator asserts the unique (phase, failureClass)
 * pair that identifies the typed failure.
 *
 * RED-vs-GREEN contract:
 *   - GREEN on `766f47ff6` ONLY when the discriminator is expanded
 *     (this fix). Without the fix, every test below fails because
 *     all four typed failures collapse to `failureClass=client_request_failed`.
 *   - APMCP-11 is the GREEN regression — the diagnostic MUST remain
 *     bit-identical for the happy path. status=ok, phase=tool_call,
 *     sessionConnectionStatus=spawned, toolFound=true.
 *   - APMCP-12 is the diagnostic-OFF invariant — every observation
 *     must be silent (off-path bit-identical).
 *
 * Topology (per ACT §5):
 *   - The test body does NOT manually call `runMycPrimeOnSessionStart`.
 *   - The test body does NOT manually call `myc_prime`.
 *   - The only prime invocation is the production automatic-prime path
 *     wired through `SdkSessionLifecycle.onMycPrimeRequested`.
 *
 * Conservation: the test does NOT modify McpHub, SdkSessionLifecycle,
 * hooks-adapter, or the production call chain. It only injects a
 * controllable typed-error shape at the McpHub boundary and asserts
 * the recorded diagnostic discriminator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
import { resolve } from "node:path"
import sinon from "sinon"
import "should"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import { __resetMycPrimeResultsForTests, getMycPrimeResult, runMycPrimeOnSessionStart } from "@/sdk/myc-prime-automation"
import {
	__getAllMycPrimeLiveDiagForTests,
	__resetMycPrimeLiveDiagForTests,
	getMycPrimeLiveDiag,
	setMycPrimeLiveDiagEnabled,
} from "@/sdk/myc-prime-live-diag"
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

const FIXTURE = resolve(__dirname, "../../services/mcp/__fixtures__/myc-prime-echo/server.mjs")

function createMycHub(options: { serverName?: string; disabled?: boolean; transportType?: "stdio" | "sse" } = {}): McpHub {
	const serverName = options.serverName ?? "myc"
	const transportType = options.transportType ?? "stdio"
	const config = {
		type: transportType,
		command: "node",
		args: [FIXTURE],
		timeout: 60,
		env: { MYC_SESSION_ID: { fromSession: "sessionId" } } as Record<string, { fromSession: string }>,
		...(options.disabled ? { disabled: true } : {}),
	}
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).telemetryService = { captureMcpToolCall: sinon.stub() }
	;(hub as any).clientVersion = "test-0.0.0"
	const connection: McpConnection = {
		server: {
			name: serverName,
			config: JSON.stringify(config),
			status: options.disabled ? "disconnected" : "connected",
			disabled: !!options.disabled,
		},
		client: {} as unknown as Client,
		transport: {} as unknown as McpConnection["transport"],
	}
	;(hub as any).connections = [connection]
	;(hub as any).sessionConnections = new Map<string, Map<string, McpConnection>>()
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

describe("ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01 — typed tool-call discriminator RED reproduction", () => {
	beforeEach(() => {
		__resetMycPrimeResultsForTests()
		__resetMycPrimeLiveDiagForTests()
		setMycPrimeLiveDiagEnabled(true)
	})

	afterEach(async () => {
		__resetMycPrimeResultsForTests()
		__resetMycPrimeLiveDiagForTests()
		setMycPrimeLiveDiagEnabled(false)
	})

	it("APMCP-07: McpError(code=RequestTimeout) → discriminator pins tool_call + tool_timeout (H4 sub-mode)", async () => {
		// The MCP server's tools/call times out (e.g. server hangs).
		// The SDK throws an McpError with code=RequestTimeout. The
		// augmented error preserves error.code === ErrorCode.RequestTimeout.
		const sessionId = `apmcp-07-${Date.now()}`
		const hub = createMycHub()
		;(hub as any).ensureSessionConnection = async () => {
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						throw new McpError(ErrorCode.RequestTimeout, "Request timed out")
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

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

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("tool_call")
		// After the repair: failureClass must distinguish timeout from generic
		// client_request_failed.
		expect(entry?.acquisition.failureClass).toBe("tool_timeout")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("unavailable")
		expect(entry?.acquisition.toolFound).toBe(false)
	})

	it("APMCP-08: McpError(code=MethodNotFound) → discriminator pins tool_call + method_not_found (H6 sub-mode)", async () => {
		// The MCP server's tools/call returns MethodNotFound (the tool
		// does not exist on the server, or the server's tool registry
		// changed between tools/list and tools/call).
		const sessionId = `apmcp-08-${Date.now()}`
		const hub = createMycHub()
		;(hub as any).ensureSessionConnection = async () => {
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						throw new McpError(ErrorCode.MethodNotFound, "Tool 'prime' not found")
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

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

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("tool_call")
		expect(entry?.acquisition.failureClass).toBe("method_not_found")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("unavailable")
		expect(entry?.acquisition.toolFound).toBe(false)
	})
	it("APMCP-09: response.isError=true → discriminator pins tool_call + tool_returned_error (H8 discriminator)", async () => {
		// The MCP server's tools/call completed successfully at the
		// JSON-RPC layer, but the tool handler returned an error
		// response (isError=true). This is a completed MCP response,
		// not a transport failure — must NOT be classified as
		// client_request_failed.
		const sessionId = `apmcp-09-${Date.now()}`
		const hub = createMycHub()
		;(hub as any).ensureSessionConnection = async () => {
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						return {
							isError: true,
							content: [{ type: "text", text: "internal error" }],
						}
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

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

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("tool_call")
		expect(entry?.acquisition.failureClass).toBe("tool_returned_error")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("unavailable")
	})

	it("APMCP-10: generic non-typed error → discriminator pins tool_call + client_request_failed (catch-all back-compat)", async () => {
		// The MCP client.request throws a plain Error (no MCP error code).
		// This is the catch-all path; it remains `client_request_failed`
		// to preserve the prior ACT's AF-RED-05 discriminator.
		const sessionId = `apmcp-10-${Date.now()}`
		const hub = createMycHub()
		;(hub as any).ensureSessionConnection = async () => {
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						throw new Error("transient pipe glitch")
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

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

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("tool_call")
		expect(entry?.acquisition.failureClass).toBe("client_request_failed")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("unavailable")
		expect(entry?.acquisition.toolFound).toBe(false)
	})
	it("APMCP-11: GREEN regression — happy path remains bit-identical after the typed-tool-call discriminator expansion", async () => {
		const sessionId = `apmcp-11-${Date.now()}`
		const hub = createMycHub()

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

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("ok")
		expect(entry?.acquisition.phase).toBe("tool_call")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("spawned")
		expect(entry?.acquisition.toolFound).toBe(true)
		expect(entry?.acquisition.failureClass).toBeUndefined()
		expect(entry?.acquisition.textBytes).toBeGreaterThan(0)
	})

	it("APMCP-12: diagnostic OFF — every typed failure observation is silent (off-path bit-identical)", async () => {
		setMycPrimeLiveDiagEnabled(false)
		const sessionId = `apmcp-12-${Date.now()}`
		const hub = createMycHub()
		;(hub as any).ensureSessionConnection = async () => {
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						throw new McpError(ErrorCode.RequestTimeout, "Request timed out")
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

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

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		expect(getMycPrimeLiveDiag(sessionId)).toBeUndefined()
		expect(__getAllMycPrimeLiveDiagForTests().length).toBe(0)

		const recorded = getMycPrimeResult(sessionId)
		expect(recorded?.status).toBe("failed")
	})
})

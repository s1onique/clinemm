/**
 * ACT-MYC-CLINEMM02-C — Lifecycle trigger test.
 *
 * Proves that when `SdkSessionLifecycle.startNewSession` installs a
 * fresh `activeSession`, the production `onMycPrimeRequested` callback
 * is fired with the canonical session id. This is the lifecycle-owner
 * test that complements `myc-prime-automation.lifecycle01.test.ts`
 * (which exercises the helper in isolation against the real
 * `myc-prime-echo` fixture).
 *
 * Drives the REAL `SdkSessionLifecycle` with a fake `SdkSessionHost`
 * (matching the pattern in
 * `__tests__/task-control-liveness.tcl-reach02.test.ts`). The
 * `onMycPrimeRequested` callback is wired to the production
 * `runMycPrimeOnSessionStart` helper backed by a real `McpHub` whose
 * session-bound `MYC_SESSION_ID: { fromSession: "sessionId" }`
 * template spawns the real `myc-prime-echo` fixture.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
import { resolve } from "node:path"
import "should"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import sinon from "sinon"
import { __resetMycPrimeResultsForTests, getMycPrimeResult, runMycPrimeOnSessionStart } from "@/sdk/myc-prime-automation"
import { SdkSessionLifecycle } from "@/sdk/sdk-session-lifecycle"
import type { SdkSessionHost } from "@/sdk/session-host"
import { McpHub } from "@/services/mcp/McpHub"
import type { McpConnection } from "@/services/mcp/types"

// ACT-MYC-CLINEMM02-C: the real lifecycle reads
// `StateManager.get().getGlobalSettingsKey("autoApprovalSettings")`
// inside `startNewSession` to build tool policies. The harness runs
// OUTSIDE the VS Code extension host, so we mock StateManager to
// return undefined (=> no tool policies are built) — exactly the
// production default when no settings are persisted yet.
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
		}),
	},
}))

const FIXTURE = resolve(__dirname, "../../services/mcp/__fixtures__/myc-prime-echo/server.mjs")

/**
 * Wait for `getMycPrimeResult(sessionId)` to be recorded. The helper
 * runs in fire-and-forget mode, so the test waits up to `timeoutMs`
 * for the singleton to populate.
 */
async function waitForPrimeResult(sessionId: string, timeoutMs = 2000): Promise<void> {
	const start = Date.now()
	while (!getMycPrimeResult(sessionId) && Date.now() - start < timeoutMs) {
		await new Promise((r) => setTimeout(r, 25))
	}
}

function createMycHub(): McpHub {
	const config = {
		type: "stdio" as const,
		command: "node",
		args: [FIXTURE],
		timeout: 60,
		env: { MYC_SESSION_ID: { fromSession: "sessionId" } } as Record<string, { fromSession: string }>,
	}
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).telemetryService = { captureMcpToolCall: sinon.stub() }
	;(hub as any).clientVersion = "test-0.0.0"
	const connection: McpConnection = {
		server: {
			name: "myc",
			config: JSON.stringify(config),
			status: "connected",
			disabled: false,
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
		start: async () => ({
			sessionId: sessionIdToReturn,
		}),
		stop: async () => {},
		subscribe: () => () => {},
		pendingPrompts: async () => [],
	} as unknown as SdkSessionHost
}

describe("SdkSessionLifecycle.startNewSession fires onMycPrimeRequested (production seam)", () => {
	beforeEach(() => {
		__resetMycPrimeResultsForTests()
	})

	afterEach(async () => {
		__resetMycPrimeResultsForTests()
	})

	it("T1: startNewSession → onMycPrimeRequested fires with the canonical session id", async () => {
		const sessionId = `lifecycle02-T1-${Date.now()}`
		const hub = createMycHub()
		const host = makeFakeSdkHost(sessionId)

		const calls: Array<{ sessionId: string; cwd?: string }> = []
		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			telemetry: undefined,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: (input) => {
				calls.push(input)
				void runMycPrimeOnSessionStart({
					sessionId: input.sessionId,
					cwd: input.cwd,
					mcpHub: hub,
				})
			},
		})

		;(lifecycle as any).sharedHost = host
		;(lifecycle as any).sharedHostPromise = Promise.resolve(host)

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace/clinemm",
			},
		} as never)

		expect(result.status).toBe("started")
		// Give the fire-and-forget prime a moment to settle.
		await waitForPrimeResult(sessionId)

		expect(calls.length).toBe(1)
		expect(calls[0].sessionId).toBe(sessionId)
		expect(calls[0].cwd).toBe("/workspace/clinemm")

		const recorded = getMycPrimeResult(sessionId)
		expect(recorded?.status).toBe("ok")

		const parsed = JSON.parse(recorded!.text!)
		expect(parsed.pid).not.toBe(process.pid)
		expect(parsed.session).toBe(sessionId)
	})

	it("T2: a SECOND distinct session fires prime AGAIN (no cardinality bleed)", async () => {
		const sessionA = `lifecycle02-T2-A-${Date.now()}`
		const sessionB = `lifecycle02-T2-B-${Date.now()}-b`
		const hub = createMycHub()
		const hostA = makeFakeSdkHost(sessionA)
		const hostB = makeFakeSdkHost(sessionB)

		const calls: string[] = []
		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			telemetry: undefined,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: (input) => {
				calls.push(input.sessionId)
				void runMycPrimeOnSessionStart({
					sessionId: input.sessionId,
					cwd: input.cwd,
					mcpHub: hub,
				})
			},
		})

		;(lifecycle as any).sharedHost = hostA
		;(lifecycle as any).sharedHostPromise = Promise.resolve(hostA)
		await lifecycle.startNewSession({
			config: { sessionId: sessionA, providerId: "anthropic", modelId: "claude-sonnet-4", cwd: "/workspace/A" },
		} as never)

		;(lifecycle as any).sharedHost = hostB
		;(lifecycle as any).sharedHostPromise = Promise.resolve(hostB)
		await lifecycle.startNewSession({
			config: { sessionId: sessionB, providerId: "anthropic", modelId: "claude-sonnet-4", cwd: "/workspace/B" },
		} as never)

		await Promise.all([waitForPrimeResult(sessionA), waitForPrimeResult(sessionB)])

		expect(calls.length).toBe(2)
		expect(calls[0]).toBe(sessionA)
		expect(calls[1]).toBe(sessionB)

		expect(getMycPrimeResult(sessionA)?.status).toBe("ok")
		expect(getMycPrimeResult(sessionB)?.status).toBe("ok")
	})

	it("T3: the trigger is OPT-IN — omitting onMycPrimeRequested leaves the lifecycle unchanged", async () => {
		const sessionId = `lifecycle02-T3-${Date.now()}`
		const hub = createMycHub()
		const host = makeFakeSdkHost(sessionId)

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			telemetry: undefined,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
		})

		;(lifecycle as any).sharedHost = host
		;(lifecycle as any).sharedHostPromise = Promise.resolve(host)

		const result = await lifecycle.startNewSession({
			config: { sessionId, providerId: "anthropic", modelId: "claude-sonnet-4", cwd: "/workspace" },
		} as never)

		expect(result.status).toBe("started")
		expect(getMycPrimeResult(sessionId)).toBeUndefined()
	})

	it("T4: when the helper throws on the FIRST call, the lifecycle still returns started", async () => {
		const sessionId = `lifecycle02-T4-${Date.now()}`
		const hub = createMycHub()
		const host = makeFakeSdkHost(sessionId)

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			telemetry: undefined,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid, cwd }) => {
				void runMycPrimeOnSessionStart({
					sessionId: sid,
					cwd,
					mcpHub: hub,
					serverName: "definitely-not-a-real-server",
				})
			},
		})

		;(lifecycle as any).sharedHost = host
		;(lifecycle as any).sharedHostPromise = Promise.resolve(host)

		const result = await lifecycle.startNewSession({
			config: { sessionId, providerId: "anthropic", modelId: "claude-sonnet-4", cwd: "/workspace" },
		} as never)

		expect(result.status).toBe("started")

		await waitForPrimeResult(sessionId)
		const recorded = getMycPrimeResult(sessionId)
		expect(recorded?.status).toBe("failed")
	})
})

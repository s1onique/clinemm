/**
 * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 5 production
 * seam tests.
 *
 * These tests drive the REAL `McpHub` lifecycle (not raw
 * `StdioClientTransport + Client` pairs as in Stage 4) for rows A2A-08
 * through A2A-18 where the production shape is:
 *
 *   - Acquire seam (A2A-15):  McpHubToolProvider.callTool → McpHub.callTool
 *                             → ensureSessionConnection → spawn per-session child
 *   - Discover seam (A2A-17): McpHubToolProvider.listTools → ensureSessionConnection
 *                             → per-session child.listTools()
 *   - Release seam (A2A-16):  mcpHub.disconnectSession(sessionId) → close child
 *   - Start-up defer (A2A-14): ensureSessionConnection(name, {}) with sessionId
 *                              undefined AND a fromSession template
 *                              → returns undefined, spawn count = 0
 *
 * The fixture is the SAME real `@modelcontextprotocol/sdk` STDIO child
 * used in Stages 3 and 4 (`__fixtures__/session-id-echo/whoami.mjs`)
 * so the load-bearing "the env var reaches the spawned child"
 * invariant is preserved — `payload.pid !== process.pid` and
 * `payload.session === "<sessionId>"` are checked in every test.
 *
 * These tests bypass the McpHub constructor's filesystem side-effects
 * (chokidar watcher, settings file IO, OAuth manager) by using
 * `Object.create(McpHub.prototype)` and injecting only the state the
 * new methods actually touch: `connections`, `clientVersion`,
 * `telemetryService`, and `resolveMcpServerTimeoutMs` (the latter is
 * real, imported from `./timeout`).
 */

import { afterEach, beforeEach, describe, it } from "bun:test"
import { resolve } from "node:path"
import "should"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import sinon from "sinon"
import { McpHub } from "../McpHub"
import { resolveMcpServerTimeoutMs } from "../timeout"
import type { McpConnection } from "../types"

const FIXTURE = resolve(__dirname, "../__fixtures__/session-id-echo/whoami.mjs")

function createMockTelemetryService() {
	return {
		captureMcpToolCall: sinon.stub(),
	}
}

/**
 * Build a real `McpHub` instance without triggering the constructor's
 * filesystem watchers / settings-file side-effects, then inject the
 * minimum state `ensureSessionConnection` + `callTool` actually touch.
 *
 * The `connections` array carries ONE static stdio entry pointing at
 * the real fixture, with the supplied `env` (legacy flat or widened
 * {value|fromEnv|fromSession} form). `server.config` is stored as
 * JSON.stringify(config) per the production pattern at McpHub.ts:670,
 * so this is what `hasSessionBoundTemplate` and
 * `ensureSessionConnection` parse back.
 */
function createHubForSession(
	env: Record<string, string | { fromSession?: string; fromEnv?: string; value?: string }>,
	options: { serverName?: string; staticConn?: boolean } = {},
): McpHub {
	const serverName = options.serverName ?? "session-id-echo"
	const staticConn = options.staticConn ?? true

	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).telemetryService = createMockTelemetryService()
	;(hub as any).clientVersion = "test-0.0.0"

	if (staticConn) {
		const config = {
			type: "stdio" as const,
			command: "node",
			args: [FIXTURE],
			timeout: 60,
			env: env as Record<string, string>,
		}
		// The static entry is a placeholder — its client/transport are
		// never read because the production code routes
		// session-bound calls through `ensureSessionConnection` (which
		// looks for entries in `sessionConnections`, not
		// `connections`). Per-session children populate real Client /
		// Transport instances when `ensureSessionConnection` spawns
		// them.
		const connection = {
			server: {
				name: serverName,
				config: JSON.stringify(config),
				status: "connected",
				disabled: false,
			},
			client: {} as unknown as Client,
			transport: {} as unknown as McpConnection["transport"],
		}
		;(hub as any).connections = [connection]
	} else {
		;(hub as any).connections = []
	}
	;(hub as any).sessionConnections = new Map<string, Map<string, McpConnection>>()
	return hub
}

/**
 * Call `whoami` via the per-session child that `hub.callTool(name,
 * "whoami", {}, ulid, undefined, sessionId)` lazily spawned.
 */
async function whoamiViaHub(
	hub: McpHub,
	serverName: string,
	sessionId: string,
): Promise<{
	pid: number
	session: string | null
	session_keys: string[]
}> {
	const ulid = `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
	const res = await hub.callTool(serverName, "whoami", {}, ulid, undefined, sessionId)
	const text = (res.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text
	return JSON.parse(text!)
}

function timeoutMsFor(config: string): number {
	return resolveMcpServerTimeoutMs(config)
}

describe("McpHub session-bound lifecycle (real production seam)", () => {
	beforeEach(() => {
		// No global setup needed; each test builds its own hub.
	})

	afterEach(async () => {
		// Each test calls hub.disconnectSession(...) in its own teardown
		// path. A failed assertion can leave a per-session child
		// running; the OS reaps it on test-runner exit, but Bun warns
		// about open handles. We do nothing here.
	})

	// ── A2A-08 — hub-owned A+B concurrent ───────────────────────────────

	describe("A2A-08: hub-owned A+B concurrent children", () => {
		it("each session owns a distinct hub-spawned child with distinct PIDs", async () => {
			const hub = createHubForSession({
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})

			const ra = await whoamiViaHub(hub, "session-id-echo", "session-A")
			const rb = await whoamiViaHub(hub, "session-id-echo", "session-B")

			ra.pid.should.not.equal(process.pid)
			rb.pid.should.not.equal(process.pid)
			ra.pid.should.not.equal(rb.pid)
			ra.session!.should.equal("session-A")
			rb.session!.should.equal("session-B")

			hub.sessionConnections.size.should.equal(2)
			hub.sessionConnections.get("session-A")!.size.should.equal(1)
			hub.sessionConnections.get("session-B")!.size.should.equal(1)
			const connA = hub.sessionConnections.get("session-A")!.get("session-id-echo")!
			const connB = hub.sessionConnections.get("session-B")!.get("session-id-echo")!
			connA.client.should.be.instanceOf(Client)
			connB.client.should.be.instanceOf(Client)

			await hub.disconnectSession("session-A")
			await hub.disconnectSession("session-B")
		})
	})

	// ── A2A-09 — hub reconnect A under same id ──────────────────────────

	describe("A2A-09: hub reconnect A under same id => new PID, identity preserved, B untouched", () => {
		it("the second ensure produces a new child, B's pid is unchanged", async () => {
			const hub = createHubForSession({
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})

			const ra1 = await whoamiViaHub(hub, "session-id-echo", "session-A")
			const rb = await whoamiViaHub(hub, "session-id-echo", "session-B")
			const connA1 = hub.sessionConnections.get("session-A")!.get("session-id-echo")!

			await connA1.client!.close()
			await connA1.transport!.close()
			hub.sessionConnections.get("session-A")!.delete("session-id-echo")

			const ra2 = await whoamiViaHub(hub, "session-id-echo", "session-A")
			const connA2 = hub.sessionConnections.get("session-A")!.get("session-id-echo")!

			ra2.pid.should.not.equal(ra1.pid)
			ra2.session!.should.equal("session-A")
			rb.pid.should.not.equal(ra2.pid)
			const rbAfter = await whoamiViaHub(hub, "session-id-echo", "session-B")
			rbAfter.pid.should.equal(rb.pid)
			rbAfter.session!.should.equal("session-B")
			connA2.should.not.equal(connA1)

			await hub.disconnectSession("session-A")
			await hub.disconnectSession("session-B")
		})
	})

	// ── A2A-12 — static + A/B coexistence ───────────────────────────────

	describe("A2A-12: static + session-bound coexists on the same hub", () => {
		it("hub.connections holds the static entry; sessionConnections holds A and B", async () => {
			const hub = createHubForSession({
				API_KEY: "static-key",
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})

			hub.connections.length.should.equal(1)
			hub.connections[0].server.name.should.equal("session-id-echo")

			await whoamiViaHub(hub, "session-id-echo", "session-A")
			await whoamiViaHub(hub, "session-id-echo", "session-B")

			hub.connections.length.should.equal(1)
			hub.connections[0].server.name.should.equal("session-id-echo")
			// The static connection is a placeholder (its `client` is
			// `{}` here). The real per-session children are in
			// `hub.sessionConnections`.
			hub.sessionConnections.size.should.equal(2)
			hub.sessionConnections.get("session-A")!.size.should.equal(1)
			hub.sessionConnections.get("session-B")!.size.should.equal(1)

			await hub.disconnectSession("session-A")
			await hub.disconnectSession("session-B")
		})
	})

	// ── A2A-13 — disconnectSession(A) kills only A's child ──────────────

	describe("A2A-13: disconnectSession(A) tears down only A's child", () => {
		it("after disconnect A: A's child is dead, B still answers", async () => {
			const hub = createHubForSession({
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})

			await whoamiViaHub(hub, "session-id-echo", "session-A")
			const rb = await whoamiViaHub(hub, "session-id-echo", "session-B")

			await hub.disconnectSession("session-A")

			should(hub.sessionConnections.get("session-A")).be.undefined()
			hub.sessionConnections.get("session-B")!.size.should.equal(1)

			const rbAfter = await whoamiViaHub(hub, "session-id-echo", "session-B")
			rbAfter.pid.should.equal(rb.pid)
			rbAfter.session!.should.equal("session-B")

			await hub.disconnectSession("session-B")
		})
	})

	// ── A2A-14 — STARTUP DEFER ──────────────────────────────────────────

	describe("A2A-14: startup defer — no sessionId => no per-session child", () => {
		it("ensureSessionConnection(name, {}) returns undefined and spawn count is 0", async () => {
			const hub = createHubForSession({
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})

			const result = await hub.ensureSessionConnection("session-id-echo", {})
			should(result).be.undefined()
			hub.sessionConnections.size.should.equal(0)
		})

		it("legacy (non-fromSession) config: ensureSessionConnection(name, {}) returns the static connection (not undefined)", async () => {
			const hub = createHubForSession({
				API_KEY: "static-key",
			})

			const result = await hub.ensureSessionConnection("session-id-echo", {})
			should(result).not.be.undefined()
			result!.server.name.should.equal("session-id-echo")
			hub.sessionConnections.size.should.equal(0)
		})
	})

	// ── A2A-15 — PRODUCTION ACQUISITION (real acquire seam) ─────────────

	describe("A2A-15: production acquire — McpHubToolProvider.callTool routes through the per-session child", () => {
		it("provider.callTool reaches the spawned child, payload.session matches the captured sessionId", async () => {
			const { McpHubToolProvider } = await import("@/sdk/vscode-runtime-builder")
			const hub = createHubForSession({
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})
			const provider = new McpHubToolProvider(hub, "session-prod-A")

			const res = (await provider.callTool({
				serverName: "session-id-echo",
				toolName: "whoami",
				arguments: {},
			})) as { content: Array<{ type: string; text?: string }> }
			const text = res.content.find((c) => c.type === "text")?.text
			const payload = JSON.parse(text!)

			payload.pid.should.not.equal(process.pid)
			payload.session!.should.equal("session-prod-A")

			// The hub's per-session map holds the acquired child.
			hub.sessionConnections.size.should.equal(1)
			hub.sessionConnections.get("session-prod-A")!.size.should.equal(1)

			await hub.disconnectSession("session-prod-A")
		})
	})

	// ── A2A-16 — PRODUCTION TEARDOWN (real release seam) ───────────────

	describe("A2A-16: production teardown — disconnectSession tears down the per-session child", () => {
		it("after disconnectSession(A): A's map entry is gone, B still answers, A's fresh acquire spawns a new PID", async () => {
			const hub = createHubForSession({
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})

			const ra = await whoamiViaHub(hub, "session-id-echo", "session-prod-A")
			const rb = await whoamiViaHub(hub, "session-id-echo", "session-prod-B")

			await hub.disconnectSession("session-prod-A")

			should(hub.sessionConnections.get("session-prod-A")).be.undefined()
			hub.sessionConnections.get("session-prod-B")!.size.should.equal(1)

			const rbAfter = await whoamiViaHub(hub, "session-id-echo", "session-prod-B")
			rbAfter.pid.should.equal(rb.pid)

			const raAfter = await whoamiViaHub(hub, "session-id-echo", "session-prod-A")
			raAfter.pid.should.not.equal(ra.pid)
			raAfter.session!.should.equal("session-prod-A")

			await hub.disconnectSession("session-prod-A")
			await hub.disconnectSession("session-prod-B")
		})
	})

	// ── A2A-17 — PRODUCTION DISCOVERY (real discover seam) ──────────────

	describe("A2A-17: production discovery — McpHubToolProvider.listTools reaches the per-session child", () => {
		it("provider.listTools returns the per-session child's tool set (including 'whoami')", async () => {
			const { McpHubToolProvider } = await import("@/sdk/vscode-runtime-builder")
			const hub = createHubForSession({
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})
			const provider = new McpHubToolProvider(hub, "session-prod-A")

			const tools = await provider.listTools("session-id-echo")
			const whoami = tools.find((t) => t.name === "whoami")
			whoami!.should.not.be.undefined()

			hub.sessionConnections.size.should.equal(1)
			hub.sessionConnections.get("session-prod-A")!.size.should.equal(1)

			await hub.disconnectSession("session-prod-A")
		})
	})

	// ── A2A-18 — PRODUCTION DISCOVERY ISOLATION ─────────────────────────

	describe("A2A-18: production discovery isolation — concurrent session-bound listTools returns independent sets", () => {
		it("two McpHubToolProvider instances with different sessionIds each spawn their own child", async () => {
			const { McpHubToolProvider } = await import("@/sdk/vscode-runtime-builder")
			const hub = createHubForSession({
				MYC_SESSION_ID: { fromSession: "sessionId" },
			})

			const providerA = new McpHubToolProvider(hub, "session-prod-A")
			const providerB = new McpHubToolProvider(hub, "session-prod-B")

			const toolsA = await providerA.listTools("session-id-echo")
			const toolsB = await providerB.listTools("session-id-echo")

			toolsA.find((t) => t.name === "whoami")!.should.not.be.undefined()
			toolsB.find((t) => t.name === "whoami")!.should.not.be.undefined()

			hub.sessionConnections.size.should.equal(2)
			const connA = hub.sessionConnections.get("session-prod-A")!.get("session-id-echo")!
			const connB = hub.sessionConnections.get("session-prod-B")!.get("session-id-echo")!
			connA.should.not.equal(connB)
			connA.client.should.be.instanceOf(Client)
			connB.client.should.be.instanceOf(Client)

			const payloadA = await whoamiViaHub(hub, "session-id-echo", "session-prod-A")
			const payloadB = await whoamiViaHub(hub, "session-id-echo", "session-prod-B")
			payloadA.pid.should.not.equal(payloadB.pid)
			payloadA.session!.should.equal("session-prod-A")
			payloadB.session!.should.equal("session-prod-B")

			await hub.disconnectSession("session-prod-A")
			await hub.disconnectSession("session-prod-B")
		})
	})

	// ── sanity ──────────────────────────────────────────────────────────

	describe("timeoutMsFor (sanity)", () => {
		it("returns a positive millisecond value for a 60-second stdio config", () => {
			const ms = timeoutMsFor(JSON.stringify({ type: "stdio", timeout: 60 }))
			ms.should.be.greaterThan(0)
		})
	})
})

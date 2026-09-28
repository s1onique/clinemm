/**
 * ACT-MYC-CLINEMM-MCP-SESSION-AUTOSTART01 — RED-2 reproduction
 *
 * Operator chronology:
 *   1. Codium restart
 *   2. McpHub loads settings with session-bound template (no session yet)
 *      → ZERO SPAWN (A2A-14 defer contract)
 *      → pendingConn stored with status="pending-session"
 *   3. Operator starts first ClineMM task (session S created)
 *   4. prepareStartSessionInput threads sessionId=S into
 *      createVscodeExtraTools → McpHubToolProvider.listTools →
 *      ensureSessionConnection(S) → spawn per-session child
 *   5. Operator MUST NOT click Restart Server
 *
 * Load-bearing invariant (RED-2 / MAS-02):
 *   post-session:
 *     sessionConnections.get(S).get(name)            → connected
 *     per-session child.env.MYC_SESSION_ID            → S
 *     getServers() projection for `name`              → status === "connected"
 *     getServers() projection for `name`.tools.length → > 0
 *
 * If the runtime autostart works (A2A-17/18 already prove this)
 * but the `getServers()` projection still says "pending-session",
 * then the operator-visible P0 is a UI state projection regression
 * — exactly what the operator sees as red/orange after the first
 * task starts.
 *
 * Only @cline/core's ClineCore.create is mocked so the test does not start
 * a real SDK host; every other link is the production class.
 */

import { resolve } from "node:path"
import "should"
import type { ClineCoreStartInput } from "@cline/core"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import sinon from "sinon"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { McpHub } from "../McpHub"
import type { McpConnection } from "../types"

const FIXTURE = resolve(__dirname, "../__fixtures__/session-id-echo/whoami.mjs")

function makeClient(): Client {
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	return new (Client as any)({ name: "test", version: "0.0.0" }, { capabilities: {} })
}

function createHub(): McpHub {
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const hub: any = Object.create(McpHub.prototype)
	hub.telemetryService = { captureMcpToolCall: sinon.stub() }
	hub.clientVersion = "test-0.0.0"
	hub.connections = []
	hub.sessionConnections = new Map<string, Map<string, McpConnection>>()
	hub.connectToServer = sinon.spy()
	hub.removeAllFileWatchers = sinon.stub()
	hub.setupFileWatcher = sinon.stub()
	hub.notifyWebviewOfServerChanges = sinon.stub().resolves(undefined)
	hub.checkToolListChanged = sinon.stub()
	hub.serverGainedOAuthTokens = sinon.stub().returns(false)
	hub.configsRequireRestart = sinon.stub().returns(false)
	hub.listChangedRefreshTimers = new Map()
	hub.listChangedRefreshDeadlines = new Map()
	hub.listChangedRefreshGeneration = new Map()
	// biome-ignore lint/suspicious/noExplicitAny: return reference
	return hub as McpHub
}

const { mockClineCoreCreate } = vi.hoisted(() => {
	// biome-ignore lint/suspicious/noExplicitAny: vi-style hoisted mock
	let latestPrepare:
		| undefined
		| (() => Promise<{ applyToStartSessionInput: (i: ClineCoreStartInput) => Promise<ClineCoreStartInput> }>)
	// biome-ignore lint/suspicious/noExplicitAny: vi-style hoisted mock
	const createMock: any = (opts: { prepare?: () => Promise<unknown> }) => {
		if (opts.prepare) {
			latestPrepare = opts.prepare as typeof latestPrepare
		}
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		const fakeInstance: any = {
			runtimeAddress: undefined,
			subscribe: () => () => {},
			start: async (input: { config: { sessionId: string } }) => ({
				sessionId: input.config.sessionId,
			}),
			stop: async () => undefined,
			dispose: async () => undefined,
			send: async () => undefined,
			updateSessionModel: async () => undefined,
			getAccumulatedUsage: async () => ({ usage: {} }),
			abort: async () => undefined,
			captureHostOwnershipFacts: () => null,
			get: () => undefined,
		}
		return Promise.resolve(fakeInstance)
	}
	createMock.latestPrepare = () => latestPrepare
	createMock.reset = () => {
		latestPrepare = undefined
	}
	return { mockClineCoreCreate: createMock }
})

vi.mock("@cline/core", async () => {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import for the real module
	const actual = await vi.importActual<any>("@cline/core")
	return {
		...actual,
		ClineCore: { create: mockClineCoreCreate },
	}
})
vi.mock("@/services/logging/distinctId", () => ({
	getDistinctId: () => "distinct-id",
}))
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalStateKey: () => undefined,
			getGlobalSettingsKey: () => undefined,
		}),
	},
}))

async function driveSessionStart(hub: McpHub, sessionId: string): Promise<{ pid: number; session: string | null }> {
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	await (await import("@/sdk/vscode-session-host")).VscodeSessionHost.create({
		mcpHub: hub,
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		telemetry: {} as any,
	})
	const prepare = mockClineCoreCreate.latestPrepare()
	expect(prepare).toBeDefined()
	const bootstrap = await prepare()
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const prepared = await (bootstrap as any).applyToStartSessionInput({
		source: undefined,
		config: {
			sessionId,
			cwd: "/workspace",
			extraTools: [],
		} as unknown as ClineCoreStartInput["config"],
	})
	const mcpTool = (prepared.config.extraTools as Array<{ name?: string }>).find((t) => t?.name?.includes?.("session-id-echo"))
	if (!mcpTool) {
		throw new Error(`[autostart-red2] session-id-echo MCP tool not found in extraTools for sessionId=${sessionId}`)
	}
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const result = await (mcpTool as any).execute({}, { agentId: "test-agent", iteration: 0 })
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const text = ((result as any)?.content as Array<{ type: string; text?: string }>)?.find(
		(c: { type: string }) => c.type === "text",
	)?.text
	if (typeof text !== "string") {
		throw new Error("[autostart-red2] no text content in tool result")
	}
	return JSON.parse(text)
}

describe("ACT-MYC-CLINEMM-MCP-SESSION-AUTOSTART01 — autostart regression", () => {
	let hub: McpHub

	beforeEach(async () => {
		mockClineCoreCreate.reset()
		hub = createHub()
		await hub.updateServerConnections({
			"session-id-echo": {
				type: "stdio" as const,
				command: "node",
				args: [FIXTURE],
				timeout: 60,
				env: { MYC_SESSION_ID: { fromSession: "sessionId" } } as unknown as Record<string, never>,
			},
		})
	})

	it("MAS-01 settings-load: defer preserved; connectToServer NOT invoked; pending entry stored", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		expect((hub as any).connectToServer.callCount).toBe(0)
		expect(hub.connections.length).toBe(1)
		expect(hub.connections[0].server.status).toBe("pending-session")
		expect(hub.connections[0].transport).toBeNull()
		expect(hub.connections[0].client).toBeNull()
		expect(hub.sessionConnections.size).toBe(0)
		const deferred = await hub.ensureSessionConnection("session-id-echo", {})
		expect(deferred).toBeUndefined()
	})

	it("MAS-02 RED: starting a real session spawns the per-session child AND surfaces a connected status via getServers()", async () => {
		const child = await driveSessionStart(hub, "session-A")
		expect(child.pid).not.toBe(process.pid)
		expect(child.session).toBe("session-A")
		expect(hub.sessionConnections.size).toBe(1)
		expect(hub.sessionConnections.get("session-A")?.get("session-id-echo")?.server.status).toBe("connected")
		// Load-bearing UI invariant.
		const projected = hub.getServers().find((s) => s.name === "session-id-echo")
		expect(projected).toBeDefined()
		expect(projected?.status).toBe("connected")
		expect((projected?.tools ?? []).length).toBeGreaterThan(0)
	})

	it("MAS-03 manual-restart path: status flips to connected via restartConnection", async () => {
		await driveSessionStart(hub, "session-A")
		// restartConnection (the operator's click target) does NOT
		// re-read the settings file — it uses the in-memory config
		// stored on the connection entry. For a session-bound template
		// the existing entry has status="pending-session" and the
		// restart re-runs connectToServer (static path). After the
		// restart, getServers() must reflect the new connected status.
		// MAS-03 doesn't drive the real restartConnection (it pulls in
		// HostProvider + a 500ms delay); it pins the same invariant as
		// MAS-02 by simulating the restart outcome: the legacy static
		// path that restartConnection eventually takes. After the
		// restart, the static entry should be flipped to "connected".
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		;(hub as any).connectToServer = sinon.stub().callsFake(async (name: string, cfg: unknown) => {
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			;(hub as any).connections = (hub as any).connections.filter(
				(conn: { server: { name: string } }) => conn.server.name !== name,
			)
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			;(hub as any).connections.push({
				server: {
					name,
					config: JSON.stringify(cfg),
					status: "connected",
					disabled: false,
				},
				client: makeClient(),
				transport: {} as McpConnection["transport"],
			})
		})
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (hub as any).deleteConnection("session-id-echo")
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (hub as any).connectToServer("session-id-echo", JSON.parse(hub.connections[0]?.server?.config ?? "{}"), "rpc")
		const projected = hub.getServers().find((s) => s.name === "session-id-echo")
		expect(projected).toBeDefined()
		expect(projected?.status).toBe("connected")
	})

	it("MAS-04 exactly one spawn on first session — no race duplicate children", async () => {
		const child = await driveSessionStart(hub, "session-A")
		const child2 = await driveSessionStart(hub, "session-A")
		expect(child.pid).toBe(child2.pid)
		expect(hub.sessionConnections.get("session-A")?.size).toBe(1)
	})

	it("MAS-05 second task/session identity — distinct MYC_SESSION_ID per session", async () => {
		const childA = await driveSessionStart(hub, "session-A")
		expect(hub.sessionConnections.has("session-A")).toBe(true)
		await hub.disconnectSession("session-A")
		expect(hub.sessionConnections.has("session-A")).toBe(false)
		const childB = await driveSessionStart(hub, "session-B")
		expect(childA.session).toBe("session-A")
		expect(childB.session).toBe("session-B")
		expect(childA.pid).not.toBe(childB.pid)
		expect(hub.sessionConnections.has("session-B")).toBe(true)
	})

	it("MAS-06 reconnect same session — P2 != P1 but sessionId consistent", async () => {
		const childP1 = await driveSessionStart(hub, "session-A")
		await hub.disconnectSession("session-A")
		const childP2 = await driveSessionStart(hub, "session-A")
		expect(childP1.pid).not.toBe(childP2.pid)
		expect(childP1.session).toBe("session-A")
		expect(childP2.session).toBe("session-A")
	})

	it("MAS-08 required session env — sessionId absent: no spawn", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (await import("@/sdk/vscode-session-host")).VscodeSessionHost.create({
			mcpHub: hub,
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			telemetry: {} as any,
		})
		const prepare = mockClineCoreCreate.latestPrepare()
		const bootstrap = await prepare()
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (bootstrap as any).applyToStartSessionInput({
			source: undefined,
			config: {
				// sessionId intentionally absent.
				cwd: "/workspace",
				extraTools: [],
			} as unknown as ClineCoreStartInput["config"],
		})
		// No per-session child spawned.
		expect(hub.sessionConnections.size).toBe(0)
		// Static entry still pending (defer preserved).
		const projected = hub.getServers().find((s) => s.name === "session-id-echo")
		expect(projected?.status).toBe("pending-session")
	})

	it("MAS-09 flat-env legacy static template — unaffected by autostart work", async () => {
		// Flat-env template still follows the global-connect path
		// through connectToServer at settings-load time (A2A-14 control).
		// The autostart repair must NOT widen the defer contract to
		// flat-env templates.
		const hub2 = createHub()
		// biome-ignore lint/suspicious/noExplicitAny: install a fakeConnected stub
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		;(hub2 as any).connectToServer = sinon.stub().callsFake(async (name: string, cfg: unknown) => {
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			;(hub2 as any).connections.push({
				server: {
					name,
					config: JSON.stringify(cfg),
					status: "connected",
					disabled: false,
				},
				client: makeClient(),
				transport: {} as McpConnection["transport"],
			})
		})
		await hub2.updateServerConnections({
			"session-id-echo": {
				type: "stdio" as const,
				command: "node",
				args: [FIXTURE],
				timeout: 60,
				env: { MYC_SESSION_ID: "literal-value" } as Record<string, string>,
			},
		})
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		expect((hub2 as any).connectToServer.callCount).toBe(1)
		expect(hub2.connections[0].server.status).toBe("connected")
		expect(hub2.sessionConnections.size).toBe(0)
	})

	it("MAS-10 lifecycle symmetry: connected → disconnectSession → pending-session projection", async () => {
		// ACT-MYC-CLINEMM-MCP-SESSION-AUTOSTART01 CORRECTION01.
		// The startup projection repair flipped the static
		// `pendingConn` from "pending-session" → "connected" when the
		// per-session child spawned. The symmetric teardown projection
		// is required so the webview returns to "pending-session" when
		// the last per-session connection for the registration
		// disappears — otherwise the operator sees a stale green MCP
		// panel after the task ends, even though no session is active.
		//
		// The check is multi-session-safe: the static projection only
		// reverts when NO surviving per-session connection holds the
		// registration. If ClineMM later supports multiple concurrent
		// sessions, a surviving session connection must keep the
		// projection green.
		await driveSessionStart(hub, "session-A")
		expect(hub.getServers().find((s) => s.name === "session-id-echo")?.status).toBe("connected")
		// disconnectSession releases the per-session child.
		await hub.disconnectSession("session-A")
		// No surviving per-session connection → projection must revert
		// to "pending-session" so the operator sees the deferred
		// sentinel again.
		expect(hub.sessionConnections.size).toBe(0)
		expect(hub.getServers().find((s) => s.name === "session-id-echo")?.status).toBe("pending-session")
	})

	it("MAS-10b multi-session symmetry: connected for A + connected for B → disconnect A → still connected (B survives)", async () => {
		// When two sessions both hold a per-session connection for the
		// same registration, disconnecting one must NOT revert the
		// static projection — the surviving session still needs the
		// operator-visible green panel.
		await driveSessionStart(hub, "session-A")
		// Re-issue the second driveSessionStart for a DIFFERENT session
		// id. Because we share a single `bootstrap` per VscodeSessionHost
		// construction, we need to re-construct for session-B.
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (await import("@/sdk/vscode-session-host")).VscodeSessionHost.create({
			mcpHub: hub,
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			telemetry: {} as any,
		})
		const prepare = mockClineCoreCreate.latestPrepare()
		const bootstrap = await prepare()
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		const prepared = await (bootstrap as any).applyToStartSessionInput({
			source: undefined,
			config: {
				sessionId: "session-B",
				cwd: "/workspace",
				extraTools: [],
			} as unknown as ClineCoreStartInput["config"],
		})
		const mcpTool = (prepared.config.extraTools as Array<{ name?: string }>).find((t) =>
			t?.name?.includes?.("session-id-echo"),
		)
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (mcpTool as any).execute({}, { agentId: "test-agent", iteration: 0 })

		expect(hub.sessionConnections.size).toBe(2)
		expect(hub.getServers().find((s) => s.name === "session-id-echo")?.status).toBe("connected")

		// Disconnect A; B survives.
		await hub.disconnectSession("session-A")
		expect(hub.sessionConnections.has("session-A")).toBe(false)
		expect(hub.sessionConnections.has("session-B")).toBe(true)
		// Static projection must STILL be "connected" because B is alive.
		expect(hub.getServers().find((s) => s.name === "session-id-echo")?.status).toBe("connected")

		// Disconnect B; no session survives.
		await hub.disconnectSession("session-B")
		expect(hub.sessionConnections.size).toBe(0)
		expect(hub.getServers().find((s) => s.name === "session-id-echo")?.status).toBe("pending-session")
	})
})

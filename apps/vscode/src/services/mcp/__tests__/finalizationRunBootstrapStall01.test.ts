/**
 * ACT-CLINEMM-FINALIZATION-RUN-BOOTSTRAP-STALL01 — RED reproduction.
 *
 * See ACT §9 for the FRBS-01 invariant:
 *   run_turn_started #2 = 1
 *   agent_turn_done   #2 = 0
 *   bootstrap trace identifies one final: ENTER without EXIT.
 *
 * The bootstrap trace is exercised via the production seam:
 *   run_turn_started #2
 *   → VscodeSessionHost.create
 *   → prepareStartSessionInput
 *   → createVscodeExtraTools → createMcpTools → provider.listTools
 *   → McpHub.ensureSessionConnection
 *   → client.connect(transport, { timeout })
 *   → Promise.allSettled([listTools, listResources, listResourceTemplates, listPrompts])
 *
 * Only @cline/core's ClineCore.create is mocked (mirrors the AUTOSTART01 test).
 * The MCP stdio child is a real Node ESM process controlled by FRBS_STALL_KIND.
 */

import { resolve } from "node:path"
import "should"
import sinon from "sinon"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { McpHub } from "../McpHub"
import type { McpConnection } from "../types"
import { configureHubWith, driveSessionStartWithTimeout, type MockClineCoreCreate } from "./_frbsHarness"

const FIXTURE = resolve(__dirname, "../__fixtures__/frbs-stallable/server.mjs")

const { mockClineCoreCreate } = vi.hoisted((): { mockClineCoreCreate: MockClineCoreCreate } => {
	let latestPrepare:
		| undefined
		| (() => Promise<{
				applyToStartSessionInput: (i: unknown) => Promise<unknown>
		  }>)
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
	return { mockClineCoreCreate: createMock as MockClineCoreCreate }
})

vi.mock("@cline/core", async () => {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import for the real module
	const actual = await vi.importActual<any>("@cline/core")
	return {
		...actual,
		ClineCore: { create: mockClineCoreCreate },
	}
})

// biome-ignore lint/suspicious/noExplicitAny: focused test seam
function createHub(): McpHub {
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
	return hub as McpHub
}

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

describe("ACT-CLINEMM-FINALIZATION-RUN-BOOTSTRAP-STALL01 — bootstrap boundedness", () => {
	let hub: McpHub

	beforeEach(async () => {
		mockClineCoreCreate.reset()
		hub = createHub()
	})

	it("FRBS-02 responsive: bootstrap completes within the bound", async () => {
		await configureHubWith(hub, FIXTURE, "none")
		const child = await driveSessionStartWithTimeout(mockClineCoreCreate, hub, "session-A")
		expect(child.pid).not.toBe(process.pid)
		expect(child.session).toBe("session-A")
		expect(hub.sessionConnections.get("session-A")?.get("frbs-stallable")?.server.status).toBe("connected")
	})

	it("FRBS-05 listResources stalls: bootstrap MUST complete within the bound (RED before fix)", async () => {
		await configureHubWith(hub, FIXTURE, "listResources")
		const child = await driveSessionStartWithTimeout(mockClineCoreCreate, hub, "session-A")
		expect(child.pid).not.toBe(process.pid)
		expect(child.session).toBe("session-A")
		expect(hub.sessionConnections.get("session-A")?.get("frbs-stallable")?.server.status).toBe("connected")
	})

	it("FRBS-07 second run: a second driveSessionStart after the first MUST also complete within the bound", async () => {
		await configureHubWith(hub, FIXTURE, "listResources")
		const first = await driveSessionStartWithTimeout(mockClineCoreCreate, hub, "session-A")
		expect(first.session).toBe("session-A")

		await hub.disconnectSession("session-A")
		expect(hub.sessionConnections.size).toBe(0)

		const second = await driveSessionStartWithTimeout(mockClineCoreCreate, hub, "session-A")
		expect(second.session).toBe("session-A")
		expect(hub.sessionConnections.get("session-A")?.get("frbs-stallable")?.server.status).toBe("connected")
	})

	it("FRBS-08 responsive baseline still flips the static projection to connected", async () => {
		await configureHubWith(hub, FIXTURE, "none")
		await driveSessionStartWithTimeout(mockClineCoreCreate, hub, "session-A")
		const projected = hub.getServers().find((s) => s.name === "frbs-stallable")
		expect(projected?.status).toBe("connected")
	})
})

/**
 * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 5 HALT correction.
 * Production-shape tests.
 *
 * The Stage 5 commit (12ff01021) wired the seam-level plumbing
 * (McpHub.ensureSessionConnection / disconnectSession,
 *  McpHubToolProvider(sessionId?), createVscodeExtraTools({sessionId}),
 *  sdk-session-lifecycle.trackSessionStop) and proved each leg with direct
 * construction in sessionIdEcho.mcpHub.test.ts. The halt correctly observes
 * that this proves the seams work but does NOT prove the production caller
 * reaches them. This file drives the production call chains end-to-end:
 *
 *   A2A-14 (settings-load):  McpHub.updateServerConnections(...) →
 *                            ensureSessionConnection(name, {}) → undefined
 *   A2A-16 (lifecycle):      SdkSessionLifecycle.endActiveSession(...) →
 *                            trackSessionStop → mcpHub.disconnectSession
 *   A2A-17/18 (discovery):   VscodeSessionHost.create(...) → prepare bootstrap
 *                            → applyToStartSessionInput({config: {sessionId}})
 *                            → createVscodeExtraTools(hub, {sessionId, ...})
 *                            → McpHubToolProvider(hub, "session-A")
 *                            → produced tool.execute() reaches child A
 *
 * Only @cline/core's ClineCore.create is mocked (so the test does not start
 * a real SDK host); every other link is the production class.
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

// =========================================================================
// Test helpers
// =========================================================================

function makeClient(): Client {
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	return new (Client as any)({ name: "test", version: "0.0.0" }, { capabilities: {} })
}

/**
 * Real McpHub instance bypassing the constructor filesystem side-effects.
 * Injects only the state the new methods touch, plus stubs for the
 * private side-effect methods that updateServerConnections reaches into.
 */
function createHub(
	env: Record<string, string | { fromSession?: string }>,
	opts: { connectToServer?: "spy" | "fakeConnected" } = {},
): McpHub {
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const hub: any = Object.create(McpHub.prototype)
	hub.telemetryService = { captureMcpToolCall: sinon.stub() }
	hub.clientVersion = "test-0.0.0"
	hub.connections = []
	hub.sessionConnections = new Map<string, Map<string, McpConnection>>()
	// ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 Stage 5 HALT correction:
	// connectToServer is the legacy global-connect method that constructs
	// the StdioClientTransport and spawns the child process. We want to
	// record invocations without doing the real work. A plain sinon.spy()
	// works: the production updateServerConnections now short-circuits
	// to a pending-session entry whenever the template contains a
	// `{fromSession: ...}` entry, BEFORE reaching the spy. The assertion
	// `connectToServer.callCount === 0` therefore proves the defer
	// contract — the production method can no longer be sneaking past
	// the defer gate and spawning a child invisibly.
	//
	// For the legacy-flat-env control case we install a sinon.stub that
	// mimics the connected-entry shape (so the second A2A-14 case still
	// observes the connected transport).
	if (opts.connectToServer === "fakeConnected") {
		hub.connectToServer = sinon.stub().callsFake(async (name: string, cfg: unknown) => {
			hub.connections.push({
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
	} else {
		hub.connectToServer = sinon.spy()
	}
	hub.removeAllFileWatchers = sinon.stub()
	hub.setupFileWatcher = sinon.stub()
	hub.notifyWebviewOfServerChanges = sinon.stub().resolves(undefined)
	hub.checkToolListChanged = sinon.stub()
	hub.serverGainedOAuthTokens = sinon.stub().returns(false)
	hub.configsRequireRestart = sinon.stub().returns(false)
	// biome-ignore lint/suspicious/noExplicitAny: return reference
	return hub as McpHub
}

/**
 * ACT-MYC-CLINEMM02-A-CORRECTION01:
 * Drive the FULL production session-start seam — `bootstrap.applyToStartSessionInput`
 * (the lambda the real `VscodeSessionHost` passes to `ClineCore.create`) is the
 * canonical entry that threads `input.config.sessionId` into
 * `createVscodeExtraTools({sessionId})`. The MCP tool built by that path
 * carries the real production `McpHubToolProvider` (constructed with the
 * real sessionId) and `tool.execute()` is the real production entry that
 * reaches `McpHub.ensureSessionConnection` → spawn per-session child.
 *
 * This helper is the load-bearing bridge between A2A-17/18 (which use it for
 * the discovery seam) and A2A-16 (which uses it for the lifecycle teardown
 * case). It explicitly replaces the prior pattern of `new McpHubToolProvider(hub, sid)`
 * for ALL production-shape tests in this file.
 */
async function whoamiViaProductionToolFor(
	bootstrap: { applyToStartSessionInput: (i: ClineCoreStartInput) => Promise<ClineCoreStartInput> },
	sessionId: string,
): Promise<{ pid: number; session: string | null }> {
	// Re-run the real `prepareStartSessionInput` lambda with the given sessionId.
	// The lambda extracts `input.config.sessionId?.trim()` (production code at
	// vscode-session-host.ts:380) and threads it into createVscodeExtraTools,
	// which constructs the real McpHubToolProvider with that sessionId.
	const prepared = await bootstrap.applyToStartSessionInput({
		source: undefined,
		config: {
			sessionId,
			cwd: "/workspace",
			extraTools: [],
		} as unknown as ClineCoreStartInput["config"],
	})
	const mcpTool = (prepared.config.extraTools as Array<{ name?: string }>).find((t) => t?.name?.includes?.("session-id-echo"))
	if (!mcpTool) {
		throw new Error(
			`[production-seam] session-id-echo MCP tool not found in extraTools for sessionId=${sessionId}; extraTools=${JSON.stringify(
				(prepared.config.extraTools as Array<{ name?: string }>).map((t) => t?.name),
			)}`,
		)
	}
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const result = await (mcpTool as any).execute({}, { agentId: "test-agent", iteration: 0 })
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const text = ((result as any)?.content as Array<{ type: string; text?: string }>)?.find(
		(c: { type: string }) => c.type === "text",
	)?.text
	return JSON.parse(text!)
}

// =========================================================================
// A2A-14 — settings-load path: drive real updateServerConnections
// =========================================================================

describe("A2A-14: McpHub.updateServerConnections (settings-load path) defers per-session spawns", () => {
	it("session-bound template: connectToServer NOT invoked; pending entry stored; no spawned child", async () => {
		const hub = createHub({ MYC_SESSION_ID: { fromSession: "sessionId" } })

		// Drive the production settings-load entry. updateServerConnections is
		// the real method — it walks the same code path as initializeMcpServers
		// (McpHub.ts:391) and toggleServerDisabledRPC (McpHub.ts:2126).
		await hub.updateServerConnections({
			"session-id-echo": {
				type: "stdio" as const,
				command: "node",
				args: [FIXTURE],
				timeout: 60,
				env: { MYC_SESSION_ID: { fromSession: "sessionId" } } as unknown as Parameters<
					McpHub["callTool"]
				>[3] extends infer _
					? Record<string, never>
					: never,
			},
		})

		// ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 Stage 5 HALT correction:
		// A2A-14 STARTUP DEFER contract:
		//   (1) connectToServer was NOT invoked. The legacy global-connect path
		//       that constructs StdioClientTransport and spawns the child was
		//       deferred.
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		expect((hub as any).connectToServer.callCount).toBe(0)
		//   (2) A configured-but-pending entry was stored in `connections` so
		//       that subsequent ensureSessionConnection(name, {sessionId})
		//       can lazily spawn per-session children.
		expect(hub.connections.length).toBe(1)
		expect(hub.connections[0].server.name).toBe("session-id-echo")
		expect(hub.connections[0].server.status).toBe("pending-session")
		expect(hub.connections[0].server.disabled).toBe(false)
		expect(hub.connections[0].transport).toBeNull()
		expect(hub.connections[0].client).toBeNull()

		//   (3) No session-bound spawn before a session exists. STARTUP DEFER.
		const deferred = await hub.ensureSessionConnection("session-id-echo", {})
		expect(deferred).toBeUndefined()

		//   (4) Crucially: the per-session map is still empty.
		expect(hub.sessionConnections.size).toBe(0)
	})

	it("flat-env template (legacy control): connectToServer IS invoked; static entry stored; ensureSessionConnection returns it", async () => {
		const hub = createHub({ MYC_SESSION_ID: "literal-value" }, { connectToServer: "fakeConnected" })
		await hub.updateServerConnections({
			"session-id-echo": {
				type: "stdio" as const,
				command: "node",
				args: [FIXTURE],
				timeout: 60,
				env: { MYC_SESSION_ID: "literal-value" } as Record<string, string>,
			},
		})

		// Static control: the flat-env legacy path still eagerly follows the
		// global connection route via connectToServer.
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		expect((hub as any).connectToServer.callCount).toBe(1)
		expect(hub.connections.length).toBe(1)
		expect(hub.connections[0].server.name).toBe("session-id-echo")
		expect(hub.connections[0].server.status).toBe("connected")
		expect(hub.connections[0].transport).toBeDefined()

		const fallback = await hub.ensureSessionConnection("session-id-echo", {})
		expect(fallback).toBeDefined()
		expect(fallback).toBe(hub.connections[0])
		expect(hub.sessionConnections.size).toBe(0)
	})
})

// =========================================================================
// A2A-17/18 — production-shape host discovery (mock ClineCore.create only)
// =========================================================================

// Hoisted capture for the `prepare` callback the host passes to ClineCore,
// AND the latest fake ClineCore instance returned for A2A-16 stop-call
// inspection. (vi.mock factories run before module-level let/const, so this
// MUST be created with vi.hoisted.)
const { mockClineCoreCreate, latestPrepareRef, latestInstanceRef } = vi.hoisted(() => {
	// biome-ignore lint/suspicious/noExplicitAny: vi-style hoisted mock
	let latestPrepare:
		| undefined
		| (() => Promise<{ applyToStartSessionInput: (i: ClineCoreStartInput) => Promise<ClineCoreStartInput> }>)
	// biome-ignore lint/suspicious/noExplicitAny: vi-style hoisted mock
	let latestInstance: any
	// biome-ignore lint/suspicious/noExplicitAny: vi-style hoisted mock
	const createMock: any = (opts: { prepare?: () => Promise<unknown> }) => {
		if (opts.prepare) {
			latestPrepare = opts.prepare as typeof latestPrepare
		}
		// The real VscodeSessionHost constructor (line 257-264) reads
		// `inner.runtimeAddress`, `inner.subscribe`, `inner.start`,
		// `inner.stop`, `inner.dispose`, `inner.updateSessionModel`,
		// `inner.send`, `inner.getAccumulatedUsage`, `inner.abort`,
		// `inner.captureHostOwnershipFacts`, `inner.get`, etc.
		// Every method we don't drive here is stubbed to a no-op so the
		// REAL host construction completes without throwing.
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
		latestInstance = fakeInstance
		return Promise.resolve(fakeInstance)
	}
	createMock.latestPrepare = () => latestPrepare
	createMock.latestInstance = () => latestInstance
	createMock.reset = () => {
		latestPrepare = undefined
		latestInstance = undefined
	}
	return {
		mockClineCoreCreate: createMock,
		latestPrepareRef: (fn: typeof latestPrepare) => {
			latestPrepare = fn
		},
		latestInstanceRef: (inst: unknown) => {
			latestInstance = inst
		},
	}
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

describe("A2A-17/18: prepareStartSessionInput forwards sessionId into McpHubToolProvider; produced tools reach the per-session child", () => {
	let hub: McpHub

	beforeEach(async () => {
		mockClineCoreCreate.reset()

		hub = createHub({ MYC_SESSION_ID: { fromSession: "sessionId" } })
		await hub.updateServerConnections({
			"session-id-echo": {
				type: "stdio" as const,
				command: "node",
				args: [FIXTURE],
				timeout: 60,
				env: { MYC_SESSION_ID: { fromSession: "sessionId" } } as unknown as Parameters<
					McpHub["callTool"]
				>[3] extends infer _
					? Record<string, never>
					: never,
			},
		})
	})

	it("A2A-17: a session input with sessionId=A produces a tool whose execute() reaches child A with payload.session === A", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (await import("@/sdk/vscode-session-host")).VscodeSessionHost.create({
			mcpHub: hub,
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			telemetry: {} as any,
		})
		const prepare = mockClineCoreCreate.latestPrepare()
		expect(prepare).toBeDefined()
		const bootstrap = await prepare()

		// Drive the production seam end-to-end:
		//   bootstrap.applyToStartSessionInput({sessionId: "session-A"})
		//     → prepareStartSessionInput lambda
		//     → input.config.sessionId?.trim() captured at
		//       vscode-session-host.ts:380
		//     → createVscodeExtraTools({sessionId: "session-A"}) at
		//       vscode-session-host.ts:413
		//     → McpHubToolProvider(hub, "session-A")
		//     → produced tool.execute()
		//     → mcpHub.callTool → ensureSessionConnection → spawn per-session child
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		const parsed = (await whoamiViaProductionToolFor(
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			bootstrap as any,
			"session-A",
		)) as { pid: number; session: string | null }
		expect(parsed.pid).not.toBe(process.pid)
		expect(parsed.session).toBe("session-A")
	})

	it("A2A-18: two different sessionIds in two consecutive applies produce two distinct per-session children with distinct PIDs", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (await import("@/sdk/vscode-session-host")).VscodeSessionHost.create({
			mcpHub: hub,
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			telemetry: {} as any,
		})
		const prepare = mockClineCoreCreate.latestPrepare()
		expect(prepare).toBeDefined()
		const bootstrap = await prepare()

		// Drive both sessionIds through the production seam. NO direct
		// McpHubToolProvider construction.
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		const parsedA = (await whoamiViaProductionToolFor(
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			bootstrap as any,
			"session-A",
		)) as { pid: number; session: string | null }
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		const parsedB = (await whoamiViaProductionToolFor(
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			bootstrap as any,
			"session-B",
		)) as { pid: number; session: string | null }

		expect(parsedA.session).toBe("session-A")
		expect(parsedB.session).toBe("session-B")
		expect(parsedA.pid).not.toBe(parsedB.pid)
		expect(parsedA.pid).not.toBe(process.pid)
		expect(parsedB.pid).not.toBe(process.pid)

		expect(hub.sessionConnections.size).toBe(2)
		expect(hub.sessionConnections.get("session-A")?.size).toBe(1)
		expect(hub.sessionConnections.get("session-B")?.size).toBe(1)
	})

	it("host start seam with no sessionId still produces tools, but no per-session children are spawned", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		await (await import("@/sdk/vscode-session-host")).VscodeSessionHost.create({
			mcpHub: hub,
			// biome-ignore lint/suspicious/noExplicitAny: focused test seam
			telemetry: {} as any,
		})
		const prepare = mockClineCoreCreate.latestPrepare()
		const bootstrap = await prepare!()
		await bootstrap.applyToStartSessionInput({
			source: undefined,
			config: { cwd: "/workspace", extraTools: [] } as unknown as ClineCoreStartInput["config"],
		})

		// Without a sessionId in the input config, the host's
		// `prepareStartSessionInput` falls through to `sessionId:
		// undefined`. McpHubToolProvider constructed without a sessionId
		// uses the legacy static `mcpHub.getServers()` path — no
		// per-session children are spawned.
		expect(hub.sessionConnections.size).toBe(0)
	})
})

// =========================================================================
// A2A-16 — production-shape lifecycle teardown
// =========================================================================
//
// We drive the REAL SdkSessionLifecycle.startNewSession → endActiveSession.
// SdkSessionLifecycle.startNewSession reaches VscodeSessionHost.create
// internally, which calls ClineCore.create. The ClineCore mock above
// already returns a complete fake ClineCore instance — so A2A-16 can
// exercise the REAL startNewSession flow without further mocking.
//
// The captured fake ClineCore instance is exposed via
// fakeClineCore.latestInstance() so the test can read `stop` calls.

import { SdkSessionLifecycle } from "@/sdk/sdk-session-lifecycle"

describe("A2A-16: SdkSessionLifecycle.endActiveSession tears down the per-session MCP child via trackSessionStop", () => {
	function makeLifecycle(hub: McpHub) {
		return new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: (async () => ({ approved: true })) as never,
			askQuestion: (async () => undefined) as never,
			onSessionEvent: () => {},
			onSendComplete: () => {},
			onSendError: () => {},
		})
	}

	async function installStaticConfig(hub: McpHub) {
		await hub.updateServerConnections({
			"session-id-echo": {
				type: "stdio" as const,
				command: "node",
				args: [FIXTURE],
				timeout: 60,
				env: { MYC_SESSION_ID: { fromSession: "sessionId" } } as unknown as Parameters<
					McpHub["callTool"]
				>[3] extends infer _
					? Record<string, never>
					: never,
			},
		})
	}

	it("endActiveSession awaits McpHub.disconnectSession for the active session id", async () => {
		const hub = createHub({ MYC_SESSION_ID: { fromSession: "sessionId" } })
		await installStaticConfig(hub)
		const disconnectSpy = sinon.spy(hub, "disconnectSession")
		mockClineCoreCreate.reset()

		const lifecycle = makeLifecycle(hub)

		// (1) Install activeSession via the production startNewSession entry.
		//     This goes through the REAL VscodeSessionHost.create → REAL
		//     ClineCore.create (mocked) → returns a fake ClineCore with
		//     a subscribe-able inner. The lifecycle captures it as
		//     `this.sharedHost` and the start result lands in `activeSession`.
		const startResult = await lifecycle.startNewSession({
			config: { sessionId: "session-A", cwd: "/workspace" } as unknown as ClineCoreStartInput["config"],
		})
		expect(startResult.status).toBe("started")
		expect(startResult.startResult.sessionId).toBe("session-A")
		const fakeInner = mockClineCoreCreate.latestInstance()
		// Wrap stop in a sinon spy so we can assert it was called.
		const stopSpy = sinon.spy()
		fakeInner.stop = stopSpy

		// (2) Drive the production-shape acquire through the REAL
		//     prepareStartSessionInput lambda (production seam) — NOT a
		//     direct `new McpHubToolProvider(hub, "session-A")` construction.
		//     The bootstrap was installed by ClineCore.create during
		//     lifecycle.startNewSession; re-applying it for "session-A"
		//     produces a tool whose execute() reaches the per-session child.
		const prepare = mockClineCoreCreate.latestPrepare()
		expect(prepare).toBeDefined()
		const bootstrap = await prepare()
		const beforeTeardown = await whoamiViaProductionToolFor(bootstrap, "session-A")
		expect(beforeTeardown.session).toBe("session-A")
		expect(hub.sessionConnections.get("session-A")?.size).toBe(1)

		// (3) Drive the production release seam — narrowest externally
		//     callable entry that reaches trackSessionStop →
		//     Promise.all([sdkHost.stop, mcpHub.disconnectSession]).
		const disposed = await lifecycle.endActiveSession("test-teardown", { awaitStop: true, timeoutMs: 5000 })
		expect(disposed).toBeDefined()
		expect(disposed?.sessionId).toBe("session-A")

		// (4) The McpHub's disconnectSession AND the fake ClineCore's stop
		//     must have been called for the production sessionId (the
		//     production Promise.all pair).
		expect(disconnectSpy.calledWith("session-A")).toBe(true)
		expect(stopSpy.calledWith("session-A")).toBe(true)
		expect(hub.sessionConnections.get("session-A")).toBeUndefined()
	})

	it("endActiveSession leaves a coexisting B child untouched", async () => {
		const hub = createHub({ MYC_SESSION_ID: { fromSession: "sessionId" } })
		await installStaticConfig(hub)
		mockClineCoreCreate.reset()

		const lifecycle = makeLifecycle(hub)

		await lifecycle.startNewSession({
			config: { sessionId: "session-A", cwd: "/workspace" } as unknown as ClineCoreStartInput["config"],
		})
		const fakeInner = mockClineCoreCreate.latestInstance()
		const stopSpy = sinon.spy()
		fakeInner.stop = stopSpy

		// (2) Drive BOTH A and B through the production tool seam — the
		//     real `bootstrap.applyToStartSessionInput({config:{sessionId:X}})`
		//     lambda threads the sessionId into createVscodeExtraTools →
		//     McpHubToolProvider(sessionId). NO direct McpHubToolProvider
		//     construction.
		const prepare = mockClineCoreCreate.latestPrepare()
		expect(prepare).toBeDefined()
		const bootstrap = await prepare()

		const seenA = await whoamiViaProductionToolFor(bootstrap, "session-A")
		const seenB = await whoamiViaProductionToolFor(bootstrap, "session-B")

		expect(seenA.session).toBe("session-A")
		expect(seenB.session).toBe("session-B")
		expect(seenA.pid).not.toBe(seenB.pid)
		expect(seenA.pid).not.toBe(process.pid)
		expect(seenB.pid).not.toBe(process.pid)
		expect(hub.sessionConnections.size).toBe(2)

		// Tear down A only — A is the active session; B is a coexisting
		// per-session child whose ownership is NOT bound to the lifecycle
		// (production invariant: only the active session's lifecycle owns
		// the release).
		await lifecycle.endActiveSession("teardown-A", { awaitStop: true, timeoutMs: 5000 })

		expect(hub.sessionConnections.get("session-A")).toBeUndefined()
		expect(hub.sessionConnections.get("session-B")?.size).toBe(1)

		// sdkHost.stop was called for A (the active session).
		expect(stopSpy.calledWith("session-A")).toBe(true)
	})

	it("reconnect: after endActiveSession, the production tool spawns a new child for the same sessionId", async () => {
		const hub = createHub({ MYC_SESSION_ID: { fromSession: "sessionId" } })
		await installStaticConfig(hub)
		mockClineCoreCreate.reset()

		const lifecycle = makeLifecycle(hub)

		await lifecycle.startNewSession({
			config: { sessionId: "session-A", cwd: "/workspace" } as unknown as ClineCoreStartInput["config"],
		})

		const prepare = mockClineCoreCreate.latestPrepare()
		expect(prepare).toBeDefined()
		const bootstrap = await prepare()
		const before = await whoamiViaProductionToolFor(bootstrap, "session-A")

		await lifecycle.endActiveSession("teardown-A", { awaitStop: true, timeoutMs: 5000 })

		// Re-claim with the same sessionId (matches A2A-09 row but driven
		// through the production lifecycle + production tool seam).
		await lifecycle.startNewSession({
			config: { sessionId: "session-A", cwd: "/workspace" } as unknown as ClineCoreStartInput["config"],
		})

		const prepare2 = mockClineCoreCreate.latestPrepare()
		expect(prepare2).toBeDefined()
		const bootstrap2 = await prepare2()
		const after = await whoamiViaProductionToolFor(bootstrap2, "session-A")

		expect(after.pid).not.toBe(before.pid)
		expect(after.pid).not.toBe(process.pid)
		expect(after.session).toBe("session-A")

		await lifecycle.endActiveSession("reconnect-cleanup", { awaitStop: true, timeoutMs: 5000 })
	})
})

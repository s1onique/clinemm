/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-C-CORRECTION01
 *
 * C2.4-C REAL-Local-transport -> VSCode-authority-boundary bridge
 * qualification (the single test that closes C2.4-C).
 *
 * C2.4-C File 1 (real LocalRuntimeHost transport topology, frozen at
 * da3fb414d) and File 2 (hand-rolled LocalRuntimeHost shim, frozen at
 * da3fb414d) proved two useful halves individually. The reviewer
 * correctly identified that the actual bridge
 *
 *   real LocalRuntimeHost
 *   -> real LocalRuntimeHost.subscribeRuntimeEvents
 *   -> subscribeCanonicalRuntimeEventsToShadow
 *   -> real TaskShadowHostWiring
 *
 * was never exercised end-to-end. This file is that bridge.
 *
 * Run with: `bun run vitest --config vitest.config.c2-4-c-bridge.ts`
 *
 * C-REAL rows:
 *   C-REAL-1  pre-session subscribe -> start session afterward ->
 *             emit canonical event -> old POINT_IN_TIME subscribe
 *             still receives zero events.
 *   C-REAL-2  fresh subscribe after the session has started -> run
 *             canonical sequence -> host delivery count == shadow
 *             observation count exactly.
 *   C-REAL-3  dispose (real uninstall) -> later emit -> shadow delta
 *             is zero.
 *   C-REAL-4  lifecycle reports no active session -> real host
 *             delivers canonical event -> wiring boundary drops it
 *             (BOUNDARY_FAIL_CLOSED).
 *   C-REAL-5  package_pin: the `LocalRuntimeHost` constructor used
 *             here is the production class; the wiring side is the
 *             production `createTaskShadowHostWiring`. The bridge
 *             is end-to-end real on both sides.
 *
 * The agent's `run()` is the production test seam (mirrors
 * `local-runtime-host.c24-c-transport.test.ts:L325`): the host's
 * `subscribeRuntimeEvents` walks `this.sessions` and attaches a
 * wrapper to each agent's `subscribeRuntimeEvents`. Calling
 * `agent.run()` re-emits the scripted events through the agent's
 * listener set, which the host wrapper forwards to the
 * `subscribeCanonicalRuntimeEventsToShadow` listening edge.
 * `runTurn` is the higher-level funnel that ALSO triggers
 * `agent.run()`; for the bridge test the seam is the agent's
 * `run()` directly, exercising the same `subscribeRuntimeEvents`
 * fan-out path that `runTurn` does.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { subscribeCanonicalRuntimeEventsToShadow } from "../canonical-event-subscription"
import type { ActiveSession } from "../cline-session-factory"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"

// =========================================================================
// Event + agent fixtures
// =========================================================================

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function stubRunResult(runId: string) {
	return {
		agentId: "agent_test",
		runId,
		status: "completed" as const,
		iterations: 1,
		outputText: "ok",
		messages: [] as readonly never[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function runStartedEvent(runId: string): AgentRuntimeEvent {
	return { type: "run-started", snapshot: { ...makeSnapshot(), runId } }
}

function runFinishedEvent(runId: string): AgentRuntimeEvent {
	return {
		type: "run-finished",
		snapshot: { ...makeSnapshot(), runId },
		result: stubRunResult(runId),
	}
}

function makeStubAgent(events: AgentRuntimeEvent[]) {
	const listeners = new Set<(event: AgentRuntimeEvent) => void>()
	const baseResult = {
		agentId: "agent_test",
		runId: "run_test",
		status: "completed" as const,
		iterations: 1,
		outputText: "ok",
		messages: [] as readonly never[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
	return {
		agent: {
			run: vi.fn(async () => {
				for (const ev of events) {
					for (const l of listeners) l(ev)
				}
				return baseResult
			}),
			continue: vi.fn(async () => {
				for (const ev of events) {
					for (const l of listeners) l(ev)
				}
				return baseResult
			}),
			abort: vi.fn(),
			subscribe: vi.fn(),
			subscribeEvents: vi.fn(() => () => {}),
			subscribeRuntimeEvents: vi.fn((listener: (event: AgentRuntimeEvent) => void) => {
				listeners.add(listener)
				return () => {
					listeners.delete(listener)
				}
			}),
			subscribeRecoveryStateChange: vi.fn(() => () => {}),
			canStartRun: vi.fn(() => true),
			shutdown: vi.fn(async () => {}),
			getMessages: vi.fn(() => []),
			getAgentId: vi.fn(() => "agent_test"),
			getConversationId: vi.fn(() => "conv_test"),
			getStateSnapshot: vi.fn(() => makeSnapshot()),
		},
	}
}

async function emitEvents(agent: { run: () => Promise<unknown> }) {
	await agent.run()
}

// =========================================================================
// Production wiring deps fixture
// =========================================================================
//
// The wiring's `lifecycle.getActiveSession` is the lifecycle authority
// for the C2.4-B narrow guard. The bridge test simulates a real
// SdkSessionLifecycle by exposing just the methods the wiring reads.

const sessionMap = new Map<string, ActiveSession>()

function makeActiveSession(sessionId: string): ActiveSession {
	// Minimal fixture — `getActiveSession()` only reads `sessionId`
	// at the wiring boundary; the rest of the `ActiveSession`
	// surface is unused by the shadow wiring.
	return {
		sessionId,
		sdkHost: undefined as never,
		unsubscribe: () => undefined,
		isRunning: true,
	} as unknown as ActiveSession
}

function makeWiringDeps() {
	return {
		lifecycle: {
			getActiveSession: () => {
				for (const s of sessionMap.values()) return s
				return undefined
			},
			setRunning: () => undefined,
		},
		sessionOptions: {
			mcpHub: undefined,
			requestToolApproval: undefined,
			askQuestion: undefined,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
		} as never,
		getLegacyPhase: () => "idle" as const,
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		now: () => 1_700_000_000_000,
	}
}

// =========================================================================
// Real host construction
// =========================================================================

function makeRealHost(agent: unknown, isolatedHomeDir: string) {
	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [],
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}
	const sessionsDir = join(isolatedHomeDir, "sessions")
	const host = new LocalRuntimeHost({
		distinctId: "c24-c-correction01",
		sessionService: new FileSessionService(sessionsDir),
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
	})
	return host
}

async function startSessionA(host: LocalRuntimeHost) {
	return await host.startSession({
		config: {
			sessionId: "session-A",
			providerId: "mock-provider",
			modelId: "mock-model",
			systemPrompt: "test",
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
	})
}

// =========================================================================
// Tests
// =========================================================================

describe("C2.4-C-CORRECTION01 - REAL LocalRuntimeHost -> wiring bridge", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		sessionMap.clear()
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "c24-c-bridge-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		// NOTE: omit `setHomeDir`/`setClineDir` because the bridge test
		// runs in `apps/vscode` where @cline/shared/storage aliases to
		// the dist bundle (which does not export those setters). The
		// `LocalRuntimeHost` constructor reads `process.env.HOME` via
		// `node:os.homedir()` plus `process.env.CLINE_DIR` directly,
		// so setting the env vars is sufficient.
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// C-REAL-1: pre-session subscribe -> start session afterward -> emit
	//   -> old POINT_IN_TIME subscribe gets zero events.
	it("C-REAL-1: pre-session subscribe sees zero events; fresh subscribe after startSession sees the canonical sequence", async () => {
		const { agent } = makeStubAgent([runStartedEvent("run-1"), runFinishedEvent("run-1")])
		const host = makeRealHost(agent, isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())

		// NO session yet. Pre-session subscribe is allowed but observes
		// nothing (POINT_IN_TIME).
		const oldUnsub = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "session-A")
		const beforeOld = wiring.recorderCounts()
		await startSessionA(host)
		sessionMap.set("session-A", makeActiveSession("session-A"))
		await emitEvents(agent)
		const afterOld = wiring.recorderCounts()
		expect(afterOld.eventsObserved - beforeOld.eventsObserved).toBe(0)
		oldUnsub()

		// Fresh subscribe after the session started: should see both
		// events fan out through the real host -> helper -> wiring.
		const newUnsub = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "session-A")
		const beforeNew = wiring.recorderCounts()
		await emitEvents(agent)
		const afterNew = wiring.recorderCounts()
		expect(afterNew.eventsObserved - beforeNew.eventsObserved).toBe(2)
		newUnsub()
	})

	// C-REAL-2: fresh subscribe after session start -> host delivery
	//   count == shadow observation count exactly.
	it("C-REAL-2: fresh subscribe after startSession observes exactly the canonical sequence", async () => {
		const events: AgentRuntimeEvent[] = [runStartedEvent("run-2"), runFinishedEvent("run-2")]
		const { agent } = makeStubAgent(events)
		const host = makeRealHost(agent, isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		await startSessionA(host)
		sessionMap.set("session-A", makeActiveSession("session-A"))
		const unsub = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "session-A")
		const before = wiring.recorderCounts()
		await emitEvents(agent)
		const after = wiring.recorderCounts()
		expect(after.eventsObserved - before.eventsObserved).toBe(events.length)
		unsub()
	})

	// C-REAL-3: dispose -> later emit -> shadow delta is zero.
	it("C-REAL-3: disposed subscription receives nothing on subsequent emit", async () => {
		const events: AgentRuntimeEvent[] = [runStartedEvent("run-3"), runFinishedEvent("run-3")]
		const { agent } = makeStubAgent(events)
		const host = makeRealHost(agent, isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		await startSessionA(host)
		sessionMap.set("session-A", makeActiveSession("session-A"))
		const unsub = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "session-A")
		const before = wiring.recorderCounts()
		await emitEvents(agent)
		const after = wiring.recorderCounts()
		expect(after.eventsObserved - before.eventsObserved).toBe(events.length)
		// Dispose.
		unsub()
		const before2 = wiring.recorderCounts()
		await emitEvents(agent)
		const after2 = wiring.recorderCounts()
		expect(after2.eventsObserved - before2.eventsObserved).toBe(0)
	})

	// C-REAL-4: lifecycle reports no active session -> real host
	//   delivers canonical event -> wiring boundary drops it
	//   (BOUNDARY_FAIL_CLOSED).
	it("C-REAL-4: real host + real helper + no active session in lifecycle -> wiring boundary drops", async () => {
		const events: AgentRuntimeEvent[] = [runStartedEvent("run-4"), runFinishedEvent("run-4")]
		const { agent } = makeStubAgent(events)
		const host = makeRealHost(agent, isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		// sessionMap is EMPTY -> lifecycle.getActiveSession() returns undefined.
		await startSessionA(host)
		const unsub = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "session-A")
		const before = wiring.recorderCounts()
		await emitEvents(agent)
		const after = wiring.recorderCounts()
		expect(after.eventsObserved - before.eventsObserved).toBe(0)
		unsub()
	})

	// C-REAL-5: package_pin.
	it("C-REAL-5: bridge instantiates production LocalRuntimeHost + production wiring", async () => {
		const { agent } = makeStubAgent([])
		const host = makeRealHost(agent, isolatedHomeDir)
		expect(host).toBeInstanceOf(LocalRuntimeHost)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		expect(typeof wiring.observeCanonicalRuntimeEvent).toBe("function")
		expect(typeof wiring.recorderCounts).toBe("function")
		expect(typeof subscribeCanonicalRuntimeEventsToShadow).toBe("function")
	})
})

// ===========================================================================
// Acceptance summary (C2.4-C-CORRECTION01, real-Local-to-REAL-wiring bridge)
// ===========================================================================
//
//   REAL_LOCAL_RUNTIME_HOST_OBJECT  = PASS (C-REAL-5: instanceof check)
//   REAL_WIRING_OBJECT              = PASS (C-REAL-5: wiring factory visible)
//   REAL_CANONICAL_PATH             = PASS (C-REAL-1..4: real host called,
//                                         real helper invoked, real
//                                         wiring observed)
//
//   PRE_SESSION_SUBSCRIBE_BLOCKED   = PASS (C-REAL-1: oldUnsub delta = 0)
//   POST_SESSION_FRESH_PIPE         = PASS (C-REAL-1: newUnsub delta = 2;
//                                         C-REAL-2: events.length)
//   DISPOSED_NO_DROP                = PASS (C-REAL-3: post-dispose delta = 0)
//   BOUNDED_FAIL_CLOSED             = PASS (C-REAL-4: real host + real
//                                         helper + no lifecycle session
//                                         -> wiring observed delta = 0)
//
//   PRODUCTION_SEMANTIC_DELTA       = 0  (no production change)
//   REDUCER_SEMANTIC_DELTA          = 0  (no production change in this commit)
//
// This file supersedes the File-2 hand-rolled shim's claim to
// composition. The hand-rolled shim lives on as a `PASS_AS_COMPONENT_TEST`
// control (no longer asserting a real-host bridge).

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-C
 *
 * C2.4-C -- REAL LocalRuntimeHost transport reachability qualification.
 *
 * C2.4-B (commit b24c8c459) proved the post-fix authority boundary
 * is FAIL_CLOSED for the NO_ACTIVE_SESSION case. That is a binding
 * invariant on the *observation* layer. This file proves that the
 * REAL `LocalRuntimeHost.subscribeRuntimeEvents` topology can and
 * does deliver canonical `AgentRuntimeEvent`s to that observation
 * layer through the in-process runtime seam.
 *
 * HARD REQUIREMENT (per the C2.4 plan acceptance gate):
 *   REAL_LOCAL_RUNTIME_HOST_OBJECT = true
 *   TEST_LOCAL_RUNTIME_STANDIN     = false
 *
 * How this test satisfies that:
 *   1. `LocalRuntimeHost` is imported via the SOURCE path
 *      `./local-runtime-host`, NOT the bundled `@cline/core` index.
 *      The same deep-import pattern is used by the E2F F1-CORRECTION01
 *      transport witness at
 *      `local-runtime-host.subscribe-runtime-events.e2f-f1-correction01.test.ts`
 *      and avoids the post-bundle minifier name collisions documented
 *      in the closure-fixup evidence.
 *   2. The host is constructed with the production constructor and
 *      its REAL `subscribeRuntimeEvents` method is invoked. The only
 *      test seam is the `createAgent` option, which the production
 *      class delegates to via
 *      `options.createAgent ?? ((config) => new SessionRuntime(config))`
 *      at `local-runtime-host.ts:262`. The wiring under test is
 *      unchanged.
 *   3. The transport topology (subscribe -> agent.subscribeRuntimeEvents
 *      fan-out -> host delivery) is exactly the production topology;
 *      see `local-runtime-host.ts:1511-1531` for the production
 *      `subscribeRuntimeEvents` implementation.
 *
 * L-rows documented here (C2.4-C acceptance core):
 *   L1  creation of session A
 *   L2-L7 run-started/exec/tool-started/tool-finished/recovery/run-finished
 *   L8  run-failed
 *   L9  session replacement disposes the old subscription
 *   L10 no fan-out duplication (exactly once per emit)
 *   L11 two simultaneous subscribers each receive all events
 *   L12 POINT_IN_TIME empty-sessions no-op
 *
 * Out-of-scope (lives in the VS Code boundary file):
 *   - Hub/Remote fallback provenance (C2.4-D)
 *   - Real C04 capture (C2.5)
 *   - Consumer cutover (E7)
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { FileSessionService } from "../../session/services/file-session-service"
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host"

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

/**
 * Build a stub AgentRuntime that:
 *   - records every call to `subscribeRuntimeEvents` in `subscribeCalls`;
 *   - captures the returned unsubscribe function in `unsubCalls`;
 *   - on `run()`, replays the supplied `events` synchronously to every
 *     registered listener (mirroring the SessionRuntime fan-out path
 *     at `session-runtime-orchestrator.ts:1300-1316`).
 */
function makeStubAgent(events: AgentRuntimeEvent[]) {
	const listeners = new Set<(event: AgentRuntimeEvent) => void>()
	const subscribeCalls = vi.fn()
	const unsubCalls = vi.fn()
	const baseResult = {
		agentId: "agent_test",
		runId: "run_test",
		status: "completed" as const,
		iterations: 1,
		outputText: "ok",
		messages: [],
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
				subscribeCalls()
				listeners.add(listener)
				const unsub = () => {
					unsubCalls()
					listeners.delete(listener)
				}
				return unsub
			}),
			subscribeRecoveryStateChange: vi.fn(() => () => {}),
			canStartRun: vi.fn(() => true),
			shutdown: vi.fn(async () => {}),
			getMessages: vi.fn(() => []),
			getAgentId: vi.fn(() => "agent_test"),
			getConversationId: vi.fn(() => "conv_test"),
		},
		subscribeCalls,
		unsubCalls,
	}
}

function stubToolCall(toolName: string) {
	return {
		type: "tool-call" as const,
		toolCallId: "t1",
		toolName,
		input: {},
	}
}

function stubToolResultMessage() {
	return {
		role: "tool" as const,
		content: [] as never[],
		id: "stub-result-msg",
		createdAt: 0,
	}
}

function stubRunResult(runId: string) {
	return {
		agentId: "agent_test",
		runId,
		status: "completed" as const,
		iterations: 1,
		outputText: "ok",
		messages: [stubToolResultMessage()],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

/** A "run" event sequence mirroring the canonical-event payload. */
function makeRunEvents(runId: string): AgentRuntimeEvent[] {
	const snap = { ...makeSnapshot(), runId }
	return [
		{ type: "run-started", snapshot: snap },
		{
			type: "execution-state-changed",
			snapshot: snap,
			previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		},
		{ type: "tool-started", snapshot: snap, iteration: 0, toolCall: stubToolCall("read_file") },
		{
			type: "tool-finished",
			snapshot: snap,
			iteration: 0,
			toolCall: stubToolCall("read_file"),
			message: stubToolResultMessage(),
		},
		{
			type: "recovery-state-changed",
			snapshot: {
				...snap,
				recovery: {
					state: "recovering",
					tracker: {
						state: "recovering",
						currentRepairAttempts: 0,
						equivalentRepeatCount: 0,
						blockedExactKeys: [],
						blockedFamilies: [],
					},
					secondStage: "idle",
					episodeFailures: 1,
					maxEpisodeFailures: 5,
					circuitNoticeCount: 0,
				},
			},
			previousRecovery: {
				state: "idle",
				tracker: {
					state: "idle",
					currentRepairAttempts: 0,
					equivalentRepeatCount: 0,
					blockedExactKeys: [],
					blockedFamilies: [],
				},
				secondStage: "idle",
				episodeFailures: 0,
				maxEpisodeFailures: 5,
				circuitNoticeCount: 0,
			},
		},
		{ type: "run-finished", snapshot: snap, result: stubRunResult(runId) },
	]
}

function makeRunFailedEvents(runId: string): AgentRuntimeEvent[] {
	const snap = { ...makeSnapshot(), runId }
	return [
		{ type: "run-started", snapshot: snap },
		{ type: "run-failed", snapshot: snap, error: new Error("boom") },
	]
}



describe("C2.4-C - REAL LocalRuntimeHost canonical-runtime-event transport reachability", () => {
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "c24-c-transport-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		setHomeDir(isolatedHomeDir)
		setClineDir(process.env.CLINE_DIR)
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		setHomeDir(envSnapshot.HOME ?? "~")
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"))
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	function makeHostWithAgent(agent: unknown) {
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		}
		const sessionsDir = join(isolatedHomeDir, "sessions")
		const host = new RuntimeHostUnderTest({
			distinctId: "c24-c-test",
			sessionService: new FileSessionService(sessionsDir),
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		})
		return host
	}

	async function startSessionA(host: Awaited<ReturnType<typeof makeHostWithAgent>>) {
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

	// L1 - session creation via the real host
	it("L1: real LocalRuntimeHost.startSession creates a session and registers the agent", async () => {
		const { agent } = makeStubAgent([])
		const host = makeHostWithAgent(agent)
		try {
			const result = await startSessionA(host)
			expect(result.sessionId).toBe("session-A")
			expect(
				typeof (host as unknown as { sessions: Map<string, unknown> }).sessions.get("session-A"),
			).toBe("object")
		} finally {
			await host.dispose()
		}
	})

	// L2..L7 - every state-relevant canonical event type reaches the
	// host listener with the originating sessionId preserved.
	it("L2-L7: real LocalRuntimeHost forwards a complete run event sequence with the originating sessionId and runId", async () => {
		const runId = "run-L2-L7"
		const events = makeRunEvents(runId)
		const { agent } = makeStubAgent(events)
		const host = makeHostWithAgent(agent)
		try {
			await startSessionA(host)
			const received: { sessionId: string; event: AgentRuntimeEvent }[] = []
			const unsub = host.subscribeRuntimeEvents((sessionId, event) => {
				received.push({ sessionId, event })
			})
			await (agent as { run: () => Promise<unknown> }).run()
			expect(received.length).toBe(events.length)
			for (const r of received) {
				expect(r.sessionId).toBe("session-A")
			}
			expect(received.map((r) => r.event.type)).toEqual([
				"run-started",
				"execution-state-changed",
				"tool-started",
				"tool-finished",
				"recovery-state-changed",
				"run-finished",
			])
			for (const r of received) {
				const sn = (r.event as { snapshot: { runId: string } }).snapshot
				expect(sn.runId).toBe(runId)
			}
			unsub()
		} finally {
			await host.dispose()
		}
	})

	// L8 - run-failed reaches the host listener
	it("L8: real LocalRuntimeHost forwards a run-failed sequence", async () => {
		const runId = "run-L8-failed"
		const events = makeRunFailedEvents(runId)
		const { agent } = makeStubAgent(events)
		const host = makeHostWithAgent(agent)
		try {
			await startSessionA(host)
			const received: AgentRuntimeEvent[] = []
			const unsub = host.subscribeRuntimeEvents((sid, event) => {
				if (sid === "session-A") received.push(event)
			})
			await (agent as { run: () => Promise<unknown> }).run()
			expect(received.map((e) => e.type)).toEqual(["run-started", "run-failed"])
			unsub()
		} finally {
			await host.dispose()
		}
	})

	// L9 - session replacement disposes the previous fan-out cleanly
	it("L9: replacing the host listener disposes the previous fan-out (real LocalRuntimeHost)", async () => {
		const events = makeRunEvents("run-L9")
		const { agent, unsubCalls } = makeStubAgent(events)
		const host = makeHostWithAgent(agent)
		try {
			await startSessionA(host)
			const recvA: string[] = []
			const recvB: string[] = []
			const unsubA = host.subscribeRuntimeEvents((sid, ev) => {
				if (sid === "session-A") recvA.push(ev.type)
			})
			await (agent as { run: () => Promise<unknown> }).run()
			expect(recvA.length).toBe(events.length)
			unsubA()
			expect(unsubCalls).toHaveBeenCalledTimes(1)
			const unsubB = host.subscribeRuntimeEvents((sid, ev) => {
				if (sid === "session-A") recvB.push(ev.type)
			})
			await (agent as { run: () => Promise<unknown> }).run()
			expect(recvA.length).toBe(events.length)
			expect(recvB.length).toBe(events.length)
			unsubB()
		} finally {
			await host.dispose()
		}
	})

	// L10 - duplicate canonical observations: host fan-out does not
	// produce N+1 deliveries for N events delivered by the agent.
	it("L10: each agent emit produces exactly one host-listener delivery (no fan-out duplication)", async () => {
		const events = makeRunEvents("run-L10")
		const { agent } = makeStubAgent(events)
		const host = makeHostWithAgent(agent)
		try {
			await startSessionA(host)
			let count = 0
			const unsub = host.subscribeRuntimeEvents((sid) => {
				if (sid === "session-A") count++
			})
			await (agent as { run: () => Promise<unknown> }).run()
			expect(count).toBe(events.length)
			unsub()
		} finally {
			await host.dispose()
		}
	})

	// L11 - two simultaneous subscribers each observe every event with
	// the correct sessionId; unsubscribing one does not affect the other.
	it("L11: two simultaneous subscribers each receive identical events with the originating sessionId", async () => {
		const events = makeRunEvents("run-L11")
		const { agent } = makeStubAgent(events)
		const host = makeHostWithAgent(agent)
		try {
			await startSessionA(host)
			const recvA: AgentRuntimeEvent[] = []
			const recvB: AgentRuntimeEvent[] = []
			const unsubA = host.subscribeRuntimeEvents((sid, ev) => {
				if (sid === "session-A") recvA.push(ev)
			})
			const unsubB = host.subscribeRuntimeEvents((sid, ev) => {
				if (sid === "session-A") recvB.push(ev)
			})
			await (agent as { run: () => Promise<unknown> }).run()
			expect(recvA.length).toBe(events.length)
			expect(recvB.length).toBe(events.length)
			expect(recvA.map((e) => e.type)).toEqual(recvB.map((e) => e.type))
			unsubA()
			await (agent as { run: () => Promise<unknown> }).run()
			expect(recvA.length).toBe(events.length)
			expect(recvB.length).toBe(events.length * 2)
			unsubB()
		} finally {
			await host.dispose()
		}
	})

	// L12 - POINT_IN_TIME contract: subscribing before any session
	// exists returns a no-op unsubscribe and the listener receives
	// zero events for the empty-sessions snapshot.
	it("L12: subscribing to an empty host returns a no-op unsubscribe that delivers zero events", async () => {
		const { agent } = makeStubAgent([])
		const host = makeHostWithAgent(agent)
		try {
			let count = 0
			const unsub = host.subscribeRuntimeEvents(() => {
				count++
			})
			await (agent as { run: () => Promise<unknown> }).run()
			expect(count).toBe(0)
			unsub()
		} finally {
			await host.dispose()
		}
	})
})

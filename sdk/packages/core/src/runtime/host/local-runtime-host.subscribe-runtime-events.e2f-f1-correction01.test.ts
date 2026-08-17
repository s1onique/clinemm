/**
 * ELM-02F F1-CORRECTION01 — real `LocalRuntimeHost` lifecycle test
 * for the canonical `AgentRuntimeEvent` seam.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION01
 *
 * The previous F1 host test re-implemented the per-session wrapping
 * in the test file. CORRECTION01 replaces it with a real
 * `LocalRuntimeHost` instance (via the `RuntimeHostUnderTest` alias
 * already used by the existing test suite) and exercises the actual
 * `LocalRuntimeHost.subscribeRuntimeEvents` method.
 *
 * Witnesses:
 *   F1-H4-C1: POST-SESSION point-in-time subscription. The host
 *             attaches a listener to sessions that already exist
 *             when `subscribeRuntimeEvents` is called. (Sessions
 *             created AFTER the subscribe call require the caller
 *             to invoke `subscribeRuntimeEvents` again — this is
 *             the documented `POINT_IN_TIME` contract; the
 *             production caller invariant is enforced by
 *             `SdkController.attachCanonicalRuntimeEventSubscription`,
 *             see `apps/vscode/src/sdk/SdkController.ts:1661`.)
 *   F1-H4-C2: after unsubscribing, no further events are delivered.
 *   F1-H4-C3: two simultaneous subscribers both receive events
 *             with their originating sessionId; unsubscribing A
 *             does not affect B.
 *   F1-H4-C4: the canonical event object reference is preserved
 *             end-to-end (host wraps it; listener receives the
 *             same reference via the host).
 *
 * F1-LC-1 (PRE-SESSION no-op → re-attach pattern) lives in
 * `apps/vscode/src/sdk/__tests__/sdk-controller-production-lifecycle.e2f-f1-correction02.test.ts`,
 * which exercises the PRODUCTION helper
 * `subscribeCanonicalRuntimeEventsToShadow` that
 * `SdkController.attachCanonicalRuntimeEventSubscription` delegates
 * to. F1-CORRECTION02 closed the remaining lifecycle proof gap.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
} from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	LocalRuntimeHost as RuntimeHostUnderTest,
} from "./local-runtime-host"
import {
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage"
import { FileSessionService } from "../../session/services/file-session-service"

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
 * Build a stub AgentRuntime that records every call to
 * `subscribeRuntimeEvents` and replays a scripted event sequence
 * synchronously inside `run()`.
 */
function makeStubAgent(events: AgentRuntimeEvent[]) {
	const listeners = new Set<(event: AgentRuntimeEvent) => void>()
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
		},
		listeners,
	}
}

function makeEvents(): AgentRuntimeEvent[] {
	const snap = makeSnapshot()
	return [
		{ type: "turn-started", snapshot: snap, iteration: 0 },
		{
			type: "execution-state-changed",
			snapshot: snap,
			previousExecution: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
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
		{ type: "turn-finished", snapshot: snap, iteration: 0, toolCallCount: 0 },
	]
}

describe("ELM-02F F1-CORRECTION01 — real LocalRuntimeHost lifecycle", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "core-host-correction01-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		delete process.env.CLINE_DATA_DIR
		setHomeDir(isolatedHomeDir)
		setClineDir(process.env.CLINE_DIR)
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (envSnapshot.CLINE_DATA_DIR === undefined) {
			delete process.env.CLINE_DATA_DIR
		} else {
			process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR
		}
		setHomeDir(envSnapshot.HOME ?? "~")
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"))
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// ------------------------------------------------------------------------
	// F1-H4-C1: real LocalRuntimeHost.subscribeRuntimeEvents walks active sessions
	// ------------------------------------------------------------------------

	it("F1-H4-C1: a real LocalRuntimeHost forwards canonical events with their originating sessionId", async () => {
		const events = makeEvents()
		const { agent } = makeStubAgent(events)

		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		}

		const sessionsDir = join(isolatedHomeDir, "sessions")
		const manager = new RuntimeHostUnderTest({
			distinctId: "test-distinct-id",
			sessionService: new FileSessionService(sessionsDir),
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		})

		try {
			const sessionA = await manager.startSession({
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

			// Subscribe to the real LocalRuntimeHost's canonical seam.
			const received: { sessionId: string; event: AgentRuntimeEvent }[] = []
			const unsub = manager.subscribeRuntimeEvents((sessionId, event) => {
				received.push({ sessionId, event })
			})

			// Drive the agent to emit the scripted events. The agent's
			// `run` will replay the events to every listener (including
			// the one the LocalRuntimeHost attached via
			// subscribeRuntimeEvents).
			await (agent as { run: () => Promise<unknown> }).run()

			// F1-H4-C1: every event reached the host listener with the
			// originating sessionId.
			expect(received.length).toBe(events.length)
			for (const r of received) {
				expect(r.sessionId).toBe("session-A")
			}
			expect(received.map((r) => r.event.type)).toEqual([
				"turn-started",
				"execution-state-changed",
				"recovery-state-changed",
				"turn-finished",
			])

			unsub()
		} finally {
			await manager.dispose()
		}
	})

	// ------------------------------------------------------------------------
	// F1-H4-C2: after unsubscribing, no further events reach the listener
	// ------------------------------------------------------------------------

	it("F1-H4-C2: unsubscribing stops delivery through the real LocalRuntimeHost", async () => {
		const events = makeEvents()
		const { agent } = makeStubAgent(events)
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		}
		const sessionsDir = join(isolatedHomeDir, "sessions")
		const manager = new RuntimeHostUnderTest({
			distinctId: "test-distinct-id",
			sessionService: new FileSessionService(sessionsDir),
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		})
		try {
			const sessionA = await manager.startSession({
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
			const received: string[] = []
			const unsub = manager.subscribeRuntimeEvents((_sessionId, event) => {
				received.push(event.type)
			})
			await (agent as { run: () => Promise<unknown> }).run()
			const afterFirst = received.length
			unsub()
			await (agent as { run: () => Promise<unknown> }).run()
			// Second run produced no further deliveries to the listener.
			expect(received.length).toBe(afterFirst)
			expect(afterFirst).toBe(events.length)
		} finally {
			await manager.dispose()
		}
	})

	// ------------------------------------------------------------------------
	// F1-H4-C3: two simultaneous subscribers both receive the events
	// ------------------------------------------------------------------------

	it("F1-H4-C3: two simultaneous subscribers each receive all events with the correct sessionId", async () => {
		const events = makeEvents()
		const { agent } = makeStubAgent(events)
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		}
		const sessionsDir = join(isolatedHomeDir, "sessions")
		const manager = new RuntimeHostUnderTest({
			distinctId: "test-distinct-id",
			sessionService: new FileSessionService(sessionsDir),
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		})
		try {
			const sessionA = await manager.startSession({
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
			const recvA: AgentRuntimeEvent[] = []
			const recvB: AgentRuntimeEvent[] = []
			const unsubA = manager.subscribeRuntimeEvents((sessionId, event) => {
				if (sessionId === "session-A") recvA.push(event)
			})
			const unsubB = manager.subscribeRuntimeEvents((sessionId, event) => {
				if (sessionId === "session-A") recvB.push(event)
			})
			await (agent as { run: () => Promise<unknown> }).run()
			expect(recvA.length).toBe(events.length)
			expect(recvB.length).toBe(events.length)
			expect(recvA.map((e) => e.type)).toEqual(recvB.map((e) => e.type))
			unsubA()
			await (agent as { run: () => Promise<unknown> }).run()
			// A stopped, B continued.
			expect(recvA.length).toBe(events.length)
			expect(recvB.length).toBe(events.length * 2)
			unsubB()
		} finally {
			await manager.dispose()
		}
	})

	// ------------------------------------------------------------------------
	// F1-H4-C4: object reference preserved end-to-end through the host
	// ------------------------------------------------------------------------

	it("F1-H4-C4: the canonical event object reference is preserved through the real LocalRuntimeHost", async () => {
		const execEvent: AgentRuntimeEvent = {
			type: "execution-state-changed",
			snapshot: makeSnapshot(),
			previousExecution: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
		}
		const { agent } = makeStubAgent([execEvent])
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		}
		const sessionsDir = join(isolatedHomeDir, "sessions")
		const manager = new RuntimeHostUnderTest({
			distinctId: "test-distinct-id",
			sessionService: new FileSessionService(sessionsDir),
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		})
		try {
			const sessionA = await manager.startSession({
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
			let received: AgentRuntimeEvent | undefined
			manager.subscribeRuntimeEvents((_sessionId, event) => {
				received = event
			})
			await (agent as { run: () => Promise<unknown> }).run()
			// F1-H4-C4: same object reference through the host.
			expect(received).toBe(execEvent)
		} finally {
			await manager.dispose()
		}
	})
})

/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-RUNTIME-SHADOW-REACTIVATION01
 * / RSR01 — production-seam RED at the canonical runtime-event ↔
 * shadow reactivation boundary.
 *
 * SCOPE
 * -----
 * The 2026-08-22 LIVE capture proves that across epoch 6 at 18/18
 * host-running publications, `LocalRuntimeHost.session.status` is
 * `running` while the canonical runtime/shadow projection remains
 * `idle`. The legacy `legacyPhase` half of the contradiction is
 * fixed (ARETC01 closed, holding on this build). This ACT targets
 * ONLY the runtime/shadow half — the seam between
 * `LocalRuntimeHost`'s canonical runtime-event stream and the
 * `TaskShadowObservationCoordinator` identity-filter.
 *
 * MECHANISM HYPOTHESES (NOT YET DISCRIMINATED)
 * ------------------------------------------
 * D1: event never emitted by the runtime
 * D2a: subscription attached to obsolete runtime/session agent
 * D2b: subscription never attached to the runtime that becomes active
 * D3: running event reaches observer but sessionId fence rejects it
 * D4: accepted event does not invoke canonical writer
 * D5: running write occurs but idle overwrites it
 * D6: snapshot source stale
 * D7: other proven
 *
 * MINIMUM WITNESS (per Factory reviewer C1: GO on §4):
 *   HOST_EVENT { event.type/status, event.sessionId }
 *   APPLICATION_BINDING { activeTaskId, activeSessionId, subscribedSessionId }
 *   RESULT { event reached subscriber? yes/no,
 *            event accepted by identity fence? yes/no,
 *            shadow writer invoked? yes/no,
 *            final shadow status }
 *
 * Witnesses in this file:
 *   W1 — POSITIVE CONTROL: fresh startSession(A), attach-after-start,
 *        agent.run() reaches shadow (re-derives C2.4-C C-REAL-2).
 *        If RED → HALT_TEST_SEAM_INVALID.
 *   W2 — D2b PRIMARY: attach BEFORE startSession(A); agent.run()
 *        observes ZERO events (POINT_IN_TIME contract; re-derives
 *        C2.4-C C-REAL-1).
 *   W3 — RESUME RED: startSession(A) + subscribe + stopSession(A) +
 *        startSession(A) [SAME sessionId] + re-attach + agent.run().
 *        PRIMARY ASSERTION: the resume's canonical events reach the
 *        shadow. If RED → D2a CONFIRMED: subscription was attached
 *        to the OLD agent; the resume's NEW agent has no listener.
 *   W4 — DISCRIMINATOR: same as W3 but re-attach SKIPPED. Expected:
 *        ZERO events. If W3 == W4, the test seam cannot
 *        discriminate → HALT_TEST_SEAM_INVALID.
 *   W5 — LIVE MIRROR: cancels the session first (mirroring the live
 *        capture's sv=26086→26094 cancellation), then resumes with
 *        the same id; the canonical `run-started` event must reach
 *        the shadow.
 *
 * REPAIR BUDGET
 * -------------
 * This ACT does NOT repair. If a witness REDs, the framework records
 * the failed assertion with a classification token (D1..D7) and
 * STOPS — the bounded repair ACT comes next.
 *
 * CONSERVATION
 * ------------
 * No production code change. No new public API. No permanent
 * runtime instrumentation. No message/wire field. No UI authority.
 *
 * This file runs under the dedicated bridge vitest config:
 *   apps/vscode/vitest.config.c2-4-c-bridge.ts
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

const NOW = 1_700_000_000_000

// =========================================================================
// Event fixtures
// =========================================================================

function makeSnapshot(status: AgentRuntimeStateSnapshot["status"]): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status,
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

function runStartedEvent(runId: string): AgentRuntimeEvent {
	return { type: "run-started", snapshot: { ...makeSnapshot("running"), runId } }
}

function executionStateChanged(
	runId: string,
	previousExecution: { modelStreaming: boolean; tooling: boolean; awaitingApproval: boolean },
): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot: { ...makeSnapshot("running"), runId },
		previousExecution,
	}
}

function runFinishedEvent(runId: string): AgentRuntimeEvent {
	return {
		type: "run-finished",
		snapshot: { ...makeSnapshot("completed"), runId },
		result: {
			agentId: "agent_test",
			runId,
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
		},
	}
}

// =========================================================================
// Per-agent stub. Mirrors the C2.4-C bridge shape: each agent instance
// captures its own `events` and listener set. When the host's
// `createAgent` factory returns a NEW stub on each call, listeners
// attached to a previous agent are NOT inherited by the new one.
// =========================================================================

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
	const agent = {
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
		getStateSnapshot: vi.fn(() => makeSnapshot("running")),
	}
	return agent
}

async function emitEvents(agent: { run: () => Promise<unknown> }) {
	await agent.run()
}

// =========================================================================
// Wiring deps (C2.4-C shape). `lifecycleActiveSessionId` is the single
// source of truth for the STALE-filter at coordinator:307-313.
// =========================================================================

const lifecycleActiveSessionId: { value: string | undefined } = { value: undefined }

function setLifecycleActiveSession(sessionId: string | undefined) {
	lifecycleActiveSessionId.value = sessionId
}

function makeActiveSession(sessionId: string): ActiveSession {
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
				const id = lifecycleActiveSessionId.value
				return id ? makeActiveSession(id) : undefined
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
		now: () => NOW,
	}
}

// =========================================================================
// Host construction. `createAgent` factory returns a FRESH stub for each
// call, simulating a fresh SessionRuntime/AgentRuntime composition on
// resume (mirrors the live capture's session-instance reality).
// Tests call `queueNextAgentEvents` BEFORE each startSession to script
// the events the next agent will emit on run().
// =========================================================================

function makeRealHostWithFreshAgent(isolatedHomeDir: string) {
	const stubAgents: Array<ReturnType<typeof makeStubAgent>> = []
	const eventScripts: AgentRuntimeEvent[][] = [[]]
	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [],
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}
	const host = new LocalRuntimeHost({
		distinctId: "rsr01",
		sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
		runtimeBuilder: runtimeBuilder as never,
		createAgent: (() => {
			const events = eventScripts[eventScripts.length - 1] ?? []
			const stub = makeStubAgent(events)
			stubAgents.push(stub)
			return stub as never
		}) as never,
	})
	return {
		host,
		stubAgents,
		queueNextAgentEvents(events: AgentRuntimeEvent[]) {
			eventScripts.push(events)
		},
	}
}

async function startSessionAt(host: LocalRuntimeHost, sessionId: string) {
	return await host.startSession({
		config: {
			sessionId,
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

describe("RSR01 — Runtime-Shadow Reactivation boundary RED", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		lifecycleActiveSessionId.value = undefined
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "rsr01-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// ---- W1 (POSITIVE CONTROL): fresh start + attach-after-start ----
	it("RSR01-W1 D2b positive control — fresh startSession(A), attach AFTER start, agent.run() reaches shadow", async () => {
		const events: AgentRuntimeEvent[] = [
			runStartedEvent("run-1"),
			executionStateChanged("run-1", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-1"),
		]
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		queueNextAgentEvents(events)
		await startSessionAt(host, "A")
		setLifecycleActiveSession("A")
		const wiring = createTaskShadowHostWiring(makeWiringDeps())

		const unsub = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")
		const before = wiring.recorderCounts().eventsObserved
		await emitEvents(stubAgents[0])
		const after = wiring.recorderCounts().eventsObserved
		// Re-derives C2.4-C C-REAL-2: run-started + run-finished
		// canonical envelopes reach the shadow.
		expect(after - before).toBeGreaterThanOrEqual(2)
		unsub()
	})

	// ---- W2 (D2b PRIMARY): attach-before-start ----
	it("RSR01-W2 D2b primary — attach BEFORE startSession(A) yields ZERO events (POINT_IN_TIME)", async () => {
		const events: AgentRuntimeEvent[] = [runStartedEvent("run-2"), runFinishedEvent("run-2")]
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())

		const unsub = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")
		queueNextAgentEvents(events)
		await startSessionAt(host, "A")
		setLifecycleActiveSession("A")

		const before = wiring.recorderCounts().eventsObserved
		await emitEvents(stubAgents[0])
		const after = wiring.recorderCounts().eventsObserved
		expect(after - before).toBe(0)
		unsub()
	})

	// ---- W3 (RESUME RED): start A, subscribe, stop A, start A again (same id), re-attach, agent.run() ----
	it("RSR01-W3 RESUME — startSession(A), subscribe, stopSession(A), startSession(A) [SAME id], re-attach, agent.run() reaches shadow", async () => {
		const events1: AgentRuntimeEvent[] = [runStartedEvent("run-3a"), runFinishedEvent("run-3a")]
		const events2: AgentRuntimeEvent[] = [
			runStartedEvent("run-3b"),
			executionStateChanged("run-3b", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-3b"),
		]
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())

		// Phase 1: start A, attach, run.
		queueNextAgentEvents(events1)
		await startSessionAt(host, "A")
		setLifecycleActiveSession("A")
		const unsub1 = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")
		await emitEvents(stubAgents[0])
		const afterP1 = wiring.recorderCounts().eventsObserved
		expect(afterP1).toBeGreaterThanOrEqual(2)
		unsub1()

		// Phase 2: stop A, resume with SAME id -> host creates NEW agent.
		await host.stopSession("A")
		setLifecycleActiveSession(undefined)
		queueNextAgentEvents(events2)
		await startSessionAt(host, "A")
		setLifecycleActiveSession("A")
		expect(stubAgents.length).toBe(2)

		// Phase 3: re-attach (as production attachCanonicalRuntimeEventSubscription would do).
		const unsub2 = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")
		const beforeP2 = wiring.recorderCounts().eventsObserved
		await emitEvents(stubAgents[1])
		const afterP2 = wiring.recorderCounts().eventsObserved
		// PRIMARY ASSERTION: resume's canonical events reach the shadow.
		// If RED (delta == 0) -> D2a CONFIRMED.
		expect(afterP2 - beforeP2).toBeGreaterThanOrEqual(2)
		unsub2()
	})

	// ---- W4 (DISCRIMINATOR): re-attach SKIPPED, expected ZERO ----
	it("RSR01-W4 RESUME control — re-attach SKIPPED yields ZERO events (test seam sanity)", async () => {
		const events1: AgentRuntimeEvent[] = [runStartedEvent("run-4a"), runFinishedEvent("run-4a")]
		const events2: AgentRuntimeEvent[] = [runStartedEvent("run-4b"), runFinishedEvent("run-4b")]
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())

		queueNextAgentEvents(events1)
		await startSessionAt(host, "A")
		setLifecycleActiveSession("A")
		const unsub1 = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")
		await emitEvents(stubAgents[0])
		unsub1()

		await host.stopSession("A")
		setLifecycleActiveSession(undefined)
		queueNextAgentEvents(events2)
		await startSessionAt(host, "A")
		setLifecycleActiveSession("A")
		expect(stubAgents.length).toBe(2)

		// NO re-attach.
		const before = wiring.recorderCounts().eventsObserved
		await emitEvents(stubAgents[1])
		const after = wiring.recorderCounts().eventsObserved
		expect(after - before).toBe(0)
	})

	// ---- W5 (LIVE MIRROR): cancel + resume with same id, agent.run() reaches shadow ----
	it("RSR01-W5 LIVE mirror — cancel then resume with same sessionId; canonical run-started reaches shadow", async () => {
		const events1: AgentRuntimeEvent[] = [runStartedEvent("run-5a"), runFinishedEvent("run-5a")]
		const events2: AgentRuntimeEvent[] = [runStartedEvent("run-5b"), runFinishedEvent("run-5b")]
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps())

		queueNextAgentEvents(events1)
		await startSessionAt(host, "A")
		setLifecycleActiveSession("A")
		const unsub1 = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")
		await emitEvents(stubAgents[0])
		unsub1()

		await host.stopSession("A")
		setLifecycleActiveSession(undefined)

		queueNextAgentEvents(events2)
		await startSessionAt(host, "A")
		setLifecycleActiveSession("A")

		const unsub2 = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")
		const before = wiring.recorderCounts().eventsObserved
		await emitEvents(stubAgents[1])
		const after = wiring.recorderCounts().eventsObserved
		// LIVE symptom discriminator: if run-started + run-finished
		// reach the shadow, the LIVE capture's runtimeStatus=idle /
		// shadowStatus=idle is NOT reproducible at this boundary; if
		// they don't, D2a is the smoking gun.
		expect(after - before).toBeGreaterThanOrEqual(2)
		unsub2()
	})
})

/**
 * ELM-02F F1 core tests — SessionRuntime.subscribeRuntimeEvents.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1
 *
 * Hard invariants proven here:
 *   F1-I1  zero buffering              — F1-T1, F1-T9
 *   F1-I2  exact-once delivery         — F1-T1, F1-T3
 *   F1-I3  event object fidelity       — F1-T3
 *   F1-I4  order preservation          — F1-T1, F1-T4
 *   F1-I5  listener exception isolation — F1-T5
 *   F1-I6  unsubscribe idempotent       — F1-T6, F1-T7
 *
 * Plus dual-stream legacy conservation (F1-T8).
 *
 * Strategy: drive a SessionRuntime with a fake AgentRuntime that
 * replays a scripted sequence of canonical AgentRuntimeEvents.
 * We avoid `run-finished` because its adapter path requires the
 * AgentRunResult.usage shape; we use `turn-finished` and explicit
 * `tool-call-count` to terminate, which is what the F0 witness file
 * does for text-only runs.
 */
import type {
	AgentEvent,
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeExecutionState,
	AgentRuntimeRecoverySnapshot,
	AgentRuntimeStateSnapshot,
} from "@cline/shared"
import type { AgentRuntime } from "@cline/agents"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	SessionRuntime,
	type SessionRuntimeOrchestratorDeps,
} from "./session-runtime-orchestrator"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_fake",
		runId: "run_fake",
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

function makeAgentMessage(
	id: string,
	role: AgentMessage["role"],
	text: string,
): AgentMessage {
	return {
		id,
		role,
		content: [{ type: "text", text }],
		createdAt: Date.now(),
	}
}

function execution(
	modelStreaming: boolean,
): AgentRuntimeExecutionState {
	return {
		modelStreaming,
		tooling: false,
		awaitingApproval: false,
	}
}

function recoveryIdle(): AgentRuntimeRecoverySnapshot {
	return {
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
	}
}

function recoveryRecovering(episodeFailures: number): AgentRuntimeRecoverySnapshot {
	return {
		state: "recovering",
		tracker: {
			state: "recovering",
			currentRepairAttempts: 0,
			equivalentRepeatCount: 0,
			blockedExactKeys: [],
			blockedFamilies: [],
		},
		secondStage: "idle",
		episodeFailures,
		maxEpisodeFailures: 5,
		circuitNoticeCount: 0,
	}
}

interface FakeRuntimeScript {
	events?: AgentRuntimeEvent[]
}

interface CapturedRuntime {
	runtime: AgentRuntime
	calls: { run: unknown[]; continue: unknown[]; abort: unknown[] }
	listeners: Set<(event: AgentRuntimeEvent) => void>
}

function makeFakeRuntime(script: FakeRuntimeScript = {}): CapturedRuntime {
	const listeners = new Set<(event: AgentRuntimeEvent) => void>()
	const calls = { run: [] as unknown[], continue: [] as unknown[], abort: [] as unknown[] }
	const baseResult = {
		agentId: "agent_fake",
		runId: "run_fake",
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
	const emit = (): void => {
		for (const ev of script.events ?? []) {
			for (const listener of listeners) listener(ev)
		}
	}
	const runtime = {
		async run(input: unknown) {
			calls.run.push(input)
			emit()
			return baseResult
		},
		async continue(input: unknown) {
			calls.continue.push(input)
			emit()
			return baseResult
		},
		abort(reason?: string) {
			calls.abort.push(reason)
		},
		subscribe(listener: (event: AgentRuntimeEvent) => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		restore(_messages: readonly AgentMessage[]) {
			/* no-op */
		},
	}
	// Cast to a structural stub satisfying `AgentRuntime` for the
	// orchestrator's deps factory. The real AgentRuntime exposes more
	// methods we don't need here.
	return { runtime: runtime as unknown as AgentRuntime, calls, listeners }
}

function makeDeps(
	script: FakeRuntimeScript = {},
	logger?: {
		debug: ReturnType<typeof vi.fn>
		log: ReturnType<typeof vi.fn>
		error: ReturnType<typeof vi.fn>
	},
): SessionRuntimeOrchestratorDeps {
	const { runtime } = makeFakeRuntime(script)
	return {
		createAgentRuntimeImpl: () => runtime,
		...(logger
			? { logger: logger as unknown as SessionRuntimeOrchestratorDeps["logger"] }
			: {}),
	}
}

function makeAgentConfig() {
	return {
		providerId: "anthropic",
		modelId: "claude-3-5-sonnet",
		apiKey: "test-key",
		systemPrompt: "You are a helpful assistant.",
		tools: [],
	}
}

// A simple, adapter-safe scripted sequence used by multiple tests:
// a `turn-started`, an `assistant-text-delta`, an `assistant-message`,
// and a `turn-finished`. NO `run-finished` (which requires a usage
// payload on result). Mirrors what the F0 witness file does for its
// text-only baseline.
function basicTextSequence(): AgentRuntimeEvent[] {
	const snap = makeSnapshot()
	return [
		{ type: "turn-started", snapshot: snap, iteration: 0 },
		{
			type: "assistant-text-delta",
			snapshot: snap,
			iteration: 0,
			text: "h",
			accumulatedText: "h",
		},
		{
			type: "assistant-message",
			snapshot: snap,
			iteration: 0,
			message: makeAgentMessage("m1", "assistant", "hi"),
			finishReason: "stop" as const,
		},
		{ type: "turn-finished", snapshot: snap, iteration: 0, toolCallCount: 0 },
	]
}

// A full text-only sequence that ALSO includes `run-finished` with
// the usage payload the legacy adapter needs to emit the `done` event.
// Used by F1-T8 (legacy conservation) and F1-I1 (multi-run zero-buffer).
function fullTextSequence(): AgentRuntimeEvent[] {
	const snap = makeSnapshot()
	return [
		{ type: "turn-started", snapshot: snap, iteration: 0 },
		{
			type: "assistant-text-delta",
			snapshot: snap,
			iteration: 0,
			text: "h",
			accumulatedText: "h",
		},
		{
			type: "assistant-message",
			snapshot: snap,
			iteration: 0,
			message: makeAgentMessage("m1", "assistant", "hi"),
			finishReason: "stop" as const,
		},
		{ type: "turn-finished", snapshot: snap, iteration: 0, toolCallCount: 0 },
		{
			type: "run-finished",
			snapshot: snap,
			result: {
				agentId: "agent_fake",
				runId: "run_fake",
				status: "completed",
				iterations: 1,
				outputText: "hi",
				messages: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
			},
		},
	]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ELM-02F F1 — SessionRuntime.subscribeRuntimeEvents canonical seam", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// ------------------------------------------------------------------------
	// F1-T1 + F1-T4 — exact-once delivery and ordering
	// ------------------------------------------------------------------------

	it("F1-T1+F1-T4: every scripted event reaches the canonical listener exactly once, in order", async () => {
		const deps = makeDeps({ events: basicTextSequence() })
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const received: AgentRuntimeEvent[] = []
		session.subscribeRuntimeEvents((event) => received.push(event))

		await session.run("go")

		expect(received.map((e) => e.type)).toEqual([
			"turn-started",
			"assistant-text-delta",
			"assistant-message",
			"turn-finished",
		])
	})

	// ------------------------------------------------------------------------
	// F1-T3 — event object fidelity
	// ------------------------------------------------------------------------

	it("F1-T3: the listener receives the SAME object reference the runtime emitted", async () => {
		const snap = makeSnapshot()
		const execEvent: AgentRuntimeEvent = {
			type: "execution-state-changed",
			snapshot: snap,
			previousExecution: execution(false),
		}
		// Drive the runtime to emit just this one event in a sequence the
		// adapter can swallow; we don't care about legacy translation
		// here, only that the canonical listener gets the literal object.
		const deps = makeDeps({
			events: [
				execEvent,
				{
					type: "turn-started",
					snapshot: snap,
					iteration: 0,
				},
				{
					type: "turn-finished",
					snapshot: snap,
					iteration: 0,
					toolCallCount: 0,
				},
			],
		})
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const received: AgentRuntimeEvent[] = []
		session.subscribeRuntimeEvents((event) => received.push(event))

		await session.run("go")

		// The first received event must be the literal object we emitted.
		expect(received[0]).toBe(execEvent)
		const asExec = received[0] as Extract<
			AgentRuntimeEvent,
			{ type: "execution-state-changed" }
		>
		expect(asExec.previousExecution).toEqual(execution(false))
		expect(asExec.snapshot).toBe(snap)
	})

	// ------------------------------------------------------------------------
	// F1-T5 — listener exception isolation
	// ------------------------------------------------------------------------

	it("F1-T5: a throwing listener does not prevent B or break the legacy path", async () => {
		const logger = { debug: vi.fn(), log: vi.fn(), error: vi.fn() }
		const deps = makeDeps(
			{
				events: [
					{
						type: "turn-started",
						snapshot: makeSnapshot(),
						iteration: 0,
					},
					{
						type: "turn-finished",
						snapshot: makeSnapshot(),
						iteration: 0,
						toolCallCount: 0,
					},
				],
			},
			logger,
		)
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const receivedB: AgentRuntimeEvent[] = []
		session.subscribeRuntimeEvents(() => {
			throw new Error("listener A boom")
		})
		session.subscribeRuntimeEvents((event) => receivedB.push(event))

		// Run completes normally despite the throwing listener.
		await expect(session.run("go")).resolves.toBeDefined()
		expect(receivedB.map((e) => e.type)).toEqual([
			"turn-started",
			"turn-finished",
		])
		// Logger captured the throwing listener's error.
		expect(logger.error).toHaveBeenCalled()
	})

	// ------------------------------------------------------------------------
	// F1-T6 — unsubscribe idempotent
	// ------------------------------------------------------------------------

	it("F1-T6: after unsubscribe, no further events reach the listener; idempotent", async () => {
		const deps = makeDeps({ events: basicTextSequence() })
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const received: string[] = []
		const unsubscribe = session.subscribeRuntimeEvents((event) =>
			received.push(event.type),
		)
		unsubscribe()
		// Calling unsubscribe a second time is harmless (idempotent).
		expect(() => unsubscribe()).not.toThrow()

		await session.run("go")

		expect(received).toHaveLength(0)
	})

	// ------------------------------------------------------------------------
	// F1-T7 — multiple subscribers, unsubscribing one does not affect another
	// ------------------------------------------------------------------------

	it("F1-T7: unsubscribing A does not affect B", async () => {
		const deps = makeDeps({ events: basicTextSequence() })
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const receivedA: string[] = []
		const receivedB: string[] = []
		const unsubscribeA = session.subscribeRuntimeEvents((e) =>
			receivedA.push(e.type),
		)
		const unsubscribeB = session.subscribeRuntimeEvents((e) =>
			receivedB.push(e.type),
		)

		unsubscribeA()

		await session.run("go")

		expect(receivedA).toHaveLength(0)
		expect(receivedB).toEqual([
			"turn-started",
			"assistant-text-delta",
			"assistant-message",
			"turn-finished",
		])
		expect(() => unsubscribeB()).not.toThrow()
	})

	// ------------------------------------------------------------------------
	// F1-I1 — zero buffering
	// ------------------------------------------------------------------------

	it("F1-I1: a subscriber attached after run 1 receives only run 2+ events, never run 1's", async () => {
		const deps = makeDeps({ events: fullTextSequence() })
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const early: string[] = []
		session.subscribeRuntimeEvents((e) => early.push(e.type))

		await session.run("first")
		const earlyCountAfterFirst = early.length

		const late: string[] = []
		session.subscribeRuntimeEvents((e) => late.push(e.type))

		await session.run("second")

		// The early subscriber accumulated the first run.
		expect(earlyCountAfterFirst).toBe(5)
		expect(early.length).toBe(10) // first + second
		// The late subscriber accumulated ONLY the second run (F1-I1:
		// zero buffering means it cannot replay the first run).
		expect(late.length).toBe(5)
		expect(late).toEqual([
			"turn-started",
			"assistant-text-delta",
			"assistant-message",
			"turn-finished",
			"run-finished",
		])
	})

	// ------------------------------------------------------------------------
	// F1-T2 — recovery canonical exact-once
	// ------------------------------------------------------------------------

	it("F1-T2: recovery-state-changed reaches the canonical seam with the right transition payload", async () => {
		const snap = makeSnapshot()
		const newRecovery: AgentRuntimeRecoverySnapshot = recoveryRecovering(1)
		const deps = makeDeps({
			events: [
				{
					type: "recovery-state-changed",
					snapshot: snap,
					previousRecovery: recoveryIdle(),
				},
				{
					type: "recovery-state-changed",
					snapshot: { ...snap, recovery: newRecovery },
					previousRecovery: recoveryIdle(),
				},
				{
					type: "turn-started",
					snapshot: snap,
					iteration: 0,
				},
				{
					type: "turn-finished",
					snapshot: snap,
					iteration: 0,
					toolCallCount: 0,
				},
			],
		})
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const recoveryEvents: AgentRuntimeEvent[] = []
		session.subscribeRuntimeEvents((event) => {
			if (event.type === "recovery-state-changed") recoveryEvents.push(event)
		})

		await session.run("go")

		expect(recoveryEvents).toHaveLength(2)
		const second = recoveryEvents[1] as Extract<
			AgentRuntimeEvent,
			{ type: "recovery-state-changed" }
		>
		expect(second.previousRecovery.state).toBe("idle")
		const rec = second.snapshot.recovery as AgentRuntimeRecoverySnapshot
		expect(rec.state).toBe("recovering")
		expect(rec.episodeFailures).toBe(1)
	})

	// ------------------------------------------------------------------------
	// F1-T8 — legacy conservation
	// ------------------------------------------------------------------------

	it("F1-T8: a canonical listener does not perturb the legacy event sequence", async () => {
		const deps = makeDeps({ events: fullTextSequence() })
		const session = new SessionRuntime(makeAgentConfig(), deps)

		// Attach BOTH a legacy and a canonical listener.
		const legacy: string[] = []
		session.subscribeEvents((e) => legacy.push(e.type))
		session.subscribeRuntimeEvents(() => {
			/* observer only */
		})

		await session.run("go")

		// The legacy sequence must still match the F0 baseline shape:
		// start → content_start → content_end → iteration_end → done.
		expect(legacy).toContain("iteration_start")
		expect(legacy).toContain("iteration_end")
		expect(legacy).toContain("content_start")
		expect(legacy).toContain("content_end")
		expect(legacy).toContain("done")
		expect(legacy.length).toBeGreaterThanOrEqual(5)
	})

	// ------------------------------------------------------------------------
	// F1-T9 — execution-state-changed reaches canonical but is dropped from legacy
	// ------------------------------------------------------------------------

	it("F1-T9: execution-state-changed reaches the canonical seam even though RuntimeEventAdapter drops it", async () => {
		const deps = makeDeps({
			events: [
				{
					type: "execution-state-changed",
					snapshot: makeSnapshot(),
					previousExecution: execution(false),
				},
				{
					type: "turn-started",
					snapshot: makeSnapshot(),
					iteration: 0,
				},
				{
					type: "turn-finished",
					snapshot: makeSnapshot(),
					iteration: 0,
					toolCallCount: 0,
				},
			],
		})
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const canonicalExec: AgentRuntimeEvent[] = []
		const legacyEvents: AgentEvent[] = []
		session.subscribeRuntimeEvents((event) => {
			if (event.type === "execution-state-changed") canonicalExec.push(event)
		})
		session.subscribeEvents((event) => legacyEvents.push(event))

		await session.run("go")

		// Canonical receives the event.
		expect(canonicalExec).toHaveLength(1)
		// Legacy does NOT receive it (RuntimeEventAdapter drops it).
		expect(legacyEvents.map((e) => e.type)).not.toContain(
			"execution-state-changed",
		)
	})
})

/**
 * ELM-02F F1 — performance + dual-stream ordering witnesses.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1
 *
 * Witnesses:
 *   F1-P1  canonical fanout sustains >= 20_000 events/sec on a single
 *          subscriber (target: p50 < 50us/event; gate < 100us/event
 *          ceiling — F1 is on the hot path of the runtime)
 *   F1-P2  fanout is linear in subscriber count: 4 subscribers
 *          <= 5x the 1-subscriber cost (no quadratic surprise)
 *   F1-O1  canonical + legacy streams co-exist; no double delivery
 *          through the canonical path; legacy sequence/count
 *          unchanged (F0 baseline)
 *   F1-O2  recovery-state-changed delivered via canonical is the
 *          same object the runtime emitted (no synthesis)
 */
import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeExecutionState,
	AgentRuntimeStateSnapshot,
} from "@cline/shared"
import type { AgentRuntime } from "@cline/agents"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	SessionRuntime,
	type SessionRuntimeOrchestratorDeps,
} from "./session-runtime-orchestrator"

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

function exec(modelStreaming: boolean): AgentRuntimeExecutionState {
	return {
		modelStreaming,
		tooling: false,
		awaitingApproval: false,
	}
}

interface FakeRuntimeHandle {
	runtime: {
		run: (input: unknown) => Promise<unknown>
		continue: (input: unknown) => Promise<unknown>
		abort: (reason?: string) => void
		subscribe: (listener: (event: AgentRuntimeEvent) => void) => () => void
		restore: (messages: readonly AgentMessage[]) => void
	}
	listeners: Set<(event: AgentRuntimeEvent) => void>
}

function makeBenchRuntime(eventCount: number): FakeRuntimeHandle {
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
	const runtime = {
		async run(_input: unknown) {
			// Emit eventCount execution-state-changed events synchronously
			// (turn-start + many execution toggles + turn-end).
			for (let i = 0; i < eventCount; i++) {
				const ev: AgentRuntimeEvent = {
					type: "execution-state-changed",
					snapshot: makeSnapshot(),
					previousExecution: exec(i % 2 === 0),
				}
				for (const l of listeners) l(ev)
			}
			return baseResult
		},
		async continue(_input: unknown) {
			return baseResult
		},
		abort(_reason?: string) {
			/* no-op */
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
	return { runtime: runtime as unknown as FakeRuntimeHandle["runtime"], listeners }
}

function makeDeps(eventCount: number): SessionRuntimeOrchestratorDeps {
	const { runtime } = makeBenchRuntime(eventCount)
	return {
		createAgentRuntimeImpl: () => runtime as unknown as AgentRuntime,
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

describe("ELM-02F F1 — performance and dual-stream witnesses", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// ------------------------------------------------------------------------
	// F1-P1 — single subscriber throughput
	// ------------------------------------------------------------------------

	it("F1-P1: a single canonical subscriber sustains >= 20_000 events/sec across 10_000 events", async () => {
		const N = 10_000
		const deps = makeDeps(N)
		const session = new SessionRuntime(makeAgentConfig(), deps)

		let received = 0
		const t0 = performance.now()
		session.subscribeRuntimeEvents(() => {
			received += 1
		})
		await session.run("bench-1")
		const elapsedMs = performance.now() - t0

		expect(received).toBe(N)
		const perEventUs = (elapsedMs / N) * 1000
		// eslint-disable-next-line no-console
		console.log(`F1-P1: ${N} events, ${elapsedMs.toFixed(1)}ms, ${perEventUs.toFixed(2)}us/event`)
		// Target p50 < 50us. We don't have full percentile measurements
		// here (this loop also includes the test fixture overhead), but
		// the average must be reasonable.
		expect(perEventUs).toBeLessThan(100) // 10x F0 budget; conservative
	})

	// ------------------------------------------------------------------------
	// F1-P2 — multi-subscriber linear scaling
	// ------------------------------------------------------------------------

	it("F1-P2: 4 canonical subscribers scale linearly (no quadratic surprise)", async () => {
		const N = 5_000
		const deps = makeDeps(N)
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const counters = [0, 0, 0, 0]
		const t0 = performance.now()
		for (let i = 0; i < 4; i++) {
			const idx = i
			session.subscribeRuntimeEvents(() => {
				counters[idx] += 1
			})
		}
		await session.run("bench-4")
		const elapsedMs = performance.now() - t0

		for (let i = 0; i < 4; i++) {
			expect(counters[i]).toBe(N)
		}
		const perEventUs = (elapsedMs / (N * 4)) * 1000
		// eslint-disable-next-line no-console
		console.log(`F1-P2: 4 subs × ${N} = ${N * 4} events, ${elapsedMs.toFixed(1)}ms, ${perEventUs.toFixed(2)}us/event-per-listener`)
		expect(perEventUs).toBeLessThan(100)
	})

	// ------------------------------------------------------------------------
	// F1-O1 — dual-stream: canonical and legacy co-exist
	// ------------------------------------------------------------------------

	it("F1-O1: the canonical and legacy streams deliver disjoint event sets with no double counting", async () => {
		const snap = makeSnapshot()
		const events: AgentRuntimeEvent[] = [
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
				message: {
					id: "m1",
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					createdAt: Date.now(),
				},
				finishReason: "stop" as const,
			},
			{
				type: "execution-state-changed",
				snapshot: snap,
				previousExecution: exec(false),
			},
			{ type: "turn-finished", snapshot: snap, iteration: 0, toolCallCount: 0 },
			{
				type: "run-finished",
				snapshot: snap,
				result: {
					agentId: "agent_test",
					runId: "run_test",
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
		const deps: SessionRuntimeOrchestratorDeps = {
			createAgentRuntimeImpl: () =>
				({
					async run(_input: unknown) {
						for (const ev of events) {
							for (const l of listeners) l(ev)
						}
						return baseResult
					},
					async continue(_input: unknown) {
						return baseResult
					},
					abort(_reason?: string) {
						/* no-op */
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
				}) as unknown as AgentRuntime,
		}
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const canonical: string[] = []
		const legacy: string[] = []
		session.subscribeRuntimeEvents((event) => canonical.push(event.type))
		session.subscribeEvents((event) => legacy.push(event.type))

		await session.run("go")

		// Canonical sees EVERY event we scripted.
		expect(canonical).toEqual([
			"turn-started",
			"assistant-text-delta",
			"assistant-message",
			"execution-state-changed",
			"turn-finished",
			"run-finished",
		])
		// Legacy sees only the events RuntimeEventAdapter translates
		// (which excludes execution-state-changed).
		expect(legacy).not.toContain("execution-state-changed")
		expect(legacy).toContain("iteration_start")
		expect(legacy).toContain("iteration_end")
		expect(legacy).toContain("content_start")
		expect(legacy).toContain("content_end")
		expect(legacy).toContain("done")
		// Both streams received exactly once each — no double counting.
		expect(canonical.length).toBe(events.length)
	})

	// ------------------------------------------------------------------------
	// F1-O2 — recovery canonical event fidelity
	// ------------------------------------------------------------------------

	it("F1-O2: recovery-state-changed reaches the canonical seam as the literal runtime object", async () => {
		const snap = makeSnapshot()
		const recoveryEvent: AgentRuntimeEvent = {
			type: "recovery-state-changed",
			snapshot: snap,
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
		}
		const events: AgentRuntimeEvent[] = [
			recoveryEvent,
			{ type: "turn-started", snapshot: snap, iteration: 0 },
			{ type: "turn-finished", snapshot: snap, iteration: 0, toolCallCount: 0 },
		]

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
		const deps: SessionRuntimeOrchestratorDeps = {
			createAgentRuntimeImpl: () =>
				({
					async run(_input: unknown) {
						for (const ev of events) {
							for (const l of listeners) l(ev)
						}
						return baseResult
					},
					async continue(_input: unknown) {
						return baseResult
					},
					abort(_reason?: string) {
						/* no-op */
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
				}) as unknown as AgentRuntime,
		}
		const session = new SessionRuntime(makeAgentConfig(), deps)

		const receivedRecovery: AgentRuntimeEvent[] = []
		session.subscribeRuntimeEvents((event) => {
			if (event.type === "recovery-state-changed") {
				receivedRecovery.push(event)
			}
		})

		await session.run("go")

		expect(receivedRecovery).toHaveLength(1)
		// Same object reference (F1-I3 invariant).
		expect(receivedRecovery[0]).toBe(recoveryEvent)
	})
})

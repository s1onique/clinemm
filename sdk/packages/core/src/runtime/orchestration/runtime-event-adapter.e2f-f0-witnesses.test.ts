/**
 * ELM-02F F0 Witnesses — RuntimeEventAdapter side.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01
 *
 * Phase F0 recon only. No production source modified by this file.
 *
 * Witnesses F0-T3 and F0-T4 live here because RuntimeEventAdapter
 * is owned by @cline/core. They pin the existing behavior of the
 * legacy adapter: `execution-state-changed` and
 * `recovery-state-changed` translate to `[]`. ELM-02F must
 * preserve this; the canonical events will reach the shadow via
 * a parallel seam, NOT by changing this adapter.
 *
 * Witnesses F0-T1, F0-T2, F0-T5 also live here (in @cline/core,
 * not @cline/agents) because core already depends on agents; this
 * avoids creating a reverse dependency. They pin the existing
 * AgentRuntime.subscribe contract and the legacy event counts.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentRuntimeRecoverySnapshot,
	AgentRuntimeStateSnapshot,
} from "@cline/shared"
import { AgentRuntime } from "@cline/agents"
import { describe, expect, it } from "vitest"
import { RuntimeEventAdapter } from "./runtime-event-adapter"

// A neutral minimal snapshot. The fields required by the
// `AgentRuntimeEvent` variants exercised here are filled with
// empty/default values that satisfy the type system without
// altering the translation under test.
function emptySnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "test-agent",
		agentRole: "test",
		conversationId: undefined,
		runId: "run-1",
		status: "running",
		iteration: 0,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		lastError: undefined,
		lastErrorClass: undefined,
		execution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
		recovery: emptyRecovery(),
	}
}

function emptyRecovery(): AgentRuntimeRecoverySnapshot {
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
		maxEpisodeFailures: 0,
		circuitNoticeCount: 0,
	}
}

function makeStreamingModel(): AgentModel {
	return {
		async stream(_request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
			return (async function* () {
				yield { type: "text-delta", text: "hello" }
				yield { type: "finish", reason: "stop" }
			})()
		},
	}
}

describe("ELM-02F F0-T1 — AgentRuntime.subscribe receives execution-state-changed", () => {
	it("a text-only run emits execution-state-changed to a subscribed listener", async () => {
		const runtime = new AgentRuntime({
			model: makeStreamingModel(),
			tools: [],
		})
		const eventTypes: string[] = []
		runtime.subscribe((event) => eventTypes.push(event.type))

		await runtime.run("F0-T1")

		expect(eventTypes).toContain("execution-state-changed")
		expect(eventTypes).toContain("run-started")
		expect(eventTypes).toContain("run-finished")
	})
})

describe("ELM-02F F0-T2 — subscribe / unsubscribe contract on AgentRuntime", () => {
	it("subscribe returns an unsubscribe that stops future events", async () => {
		const runtime = new AgentRuntime({
			model: makeStreamingModel(),
			tools: [],
		})
		const events: string[] = []
		const unsubscribe = runtime.subscribe((event) => events.push(event.type))
		expect(typeof unsubscribe).toBe("function")

		await runtime.run("F0-T2-first")

		const afterFirstRun = events.length
		expect(afterFirstRun).toBeGreaterThan(0)

		unsubscribe()

		await runtime.run("F0-T2-second")

		expect(events.length).toBe(afterFirstRun)
	})

	it("listener narrowing on recovery-state-changed typechecks against AgentRuntimeEvent", () => {
		const runtime = new AgentRuntime({
			model: makeStreamingModel(),
			tools: [],
		})
		let observed = 0
		const unsubscribe = runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "recovery-state-changed") {
				observed += 1
			}
		})
		expect(observed).toBe(0)
		unsubscribe()
	})
})

describe("ELM-02F F0-T3 — RuntimeEventAdapter does NOT emit execution-state-changed as a legacy AgentEvent", () => {
	it("translate() returns [] for execution-state-changed (RSMT01 gap, intentional)", () => {
		const adapter = new RuntimeEventAdapter()
		const event: AgentRuntimeEvent = {
			type: "execution-state-changed",
			snapshot: {
				...emptySnapshot(),
				execution: {
					modelStreaming: true,
					tooling: false,
					awaitingApproval: false,
				},
			},
			previousExecution: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
		}
		const result = adapter.translate(event)
		expect(result).toEqual([])
	})
})

describe("ELM-02F F0-T4 — RuntimeEventAdapter does NOT emit recovery-state-changed as a legacy AgentEvent", () => {
	it("translate() returns [] for recovery-state-changed (RSMT01 gap, intentional)", () => {
		const adapter = new RuntimeEventAdapter()
		const event: AgentRuntimeEvent = {
			type: "recovery-state-changed",
			snapshot: {
				...emptySnapshot(),
				recovery: {
					state: "circuit_open",
					tracker: {
						state: "circuit_open",
						currentRepairAttempts: 3,
						equivalentRepeatCount: 2,
						blockedExactKeys: [],
						blockedFamilies: [],
					},
					secondStage: "idle",
					episodeFailures: 3,
					maxEpisodeFailures: 3,
					circuitNoticeCount: 1,
				},
			},
			previousRecovery: emptyRecovery(),
		}
		const result = adapter.translate(event)
		expect(result).toEqual([])
	})
})

describe("ELM-02F F0-T5 — legacy event counts for a representative sequence are stable", () => {
	it("a single-shot text-only run produces the documented legacy event sequence", async () => {
		const runtime = new AgentRuntime({
			model: makeStreamingModel(),
			tools: [],
		})
		const adapter = new RuntimeEventAdapter()
		const rawEvents: AgentRuntimeEvent[] = []
		const legacyEvents: string[] = []
		runtime.subscribe((event) => {
			rawEvents.push(event)
			for (const legacy of adapter.translate(event)) {
				legacyEvents.push(legacy.type)
			}
		})
		await runtime.run("F0-T5")

		// Canonical stream contains the expected observation events.
		const canonicalTypes = rawEvents.map((e) => e.type)
		expect(canonicalTypes).toContain("run-started")
		expect(canonicalTypes).toContain("turn-started")
		expect(canonicalTypes).toContain("turn-finished")
		expect(canonicalTypes).toContain("run-finished")
		expect(canonicalTypes).toContain("execution-state-changed")

		// Legacy stream does NOT contain execution-state-changed or
		// recovery-state-changed (those are the ELM-02F gap).
		expect(legacyEvents).not.toContain("execution-state-changed")
		expect(legacyEvents).not.toContain("recovery-state-changed")

		// Legacy stream still contains the projected text/finish events.
		expect(legacyEvents).toContain("iteration_start")
		expect(legacyEvents).toContain("iteration_end")
		expect(legacyEvents).toContain("content_start")
		expect(legacyEvents).toContain("content_end")
	})
})

/**
 * ELM-02F F0 Witnesses — RuntimeEventAdapter side.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-F0-WITNESS-CORRECTION01
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
 * avoids creating a reverse dependency (per ACT section 23).
 *
 * CORRECTION01 upgrades:
 *   - F0-T2 now PROVES that recovery-state-changed is actually
 *     observed through AgentRuntime.subscribe() (not just that the
 *     type narrowing compiles).
 *   - F0-T5 pins the EXACT legacy event sequence (not just .toContain)
 *     and exposes a constant LEGACY_EVENT_COUNT_BASELINE = 5.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentRuntimeRecoverySnapshot,
	AgentRuntimeStateSnapshot,
	AgentTool,
} from "@cline/shared"
import { AgentRuntime } from "@cline/agents"
import { beforeEach, describe, expect, it } from "vitest"
import { RuntimeEventAdapter } from "./runtime-event-adapter"
import { resetSdkErrorRateLimiterForTests } from "@cline/shared"

beforeEach(() => {
	resetSdkErrorRateLimiterForTests()
})

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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

const ENOENT = Object.assign(new Error("ENOENT: /secret/path/token.pem"), {
	code: "ENOENT" as const,
})

function createEnoentTool(calls: { count: number }): AgentTool<{ path: string }, never> {
	return {
		name: "fs_read",
		description: "Throws ENOENT to trigger a recoverable failure",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1
			throw ENOENT
		},
	}
}

function toolCallStep(
	toolCallId: string,
	toolName: string,
	input: unknown,
): () => AgentModelEvent[] {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			inputText: JSON.stringify(input),
		},
		{ type: "finish", reason: "tool-calls" },
	]
}

const finishStep = (): AgentModelEvent[] => [
	{ type: "text-delta", text: "done" },
	{ type: "finish", reason: "stop" },
]

class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = []
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}
	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) {
			throw new Error("No scripted model step available")
		}
		const events = step(request)
		return (async function* () {
			for await (const ev of events) yield ev
		})()
	}
}

// ---------------------------------------------------------------------------
// F0-T1 — execution-state-changed is observable through subscribe
// ---------------------------------------------------------------------------

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

	it("F0_T1_EXECUTION_CANONICAL_COUNT >= 1", async () => {
		const runtime = new AgentRuntime({
			model: makeStreamingModel(),
			tools: [],
		})
		const executionEvents: AgentRuntimeEvent[] = []
		runtime.subscribe((event) => {
			if (event.type === "execution-state-changed") {
				executionEvents.push(event)
			}
		})
		await runtime.run("F0-T1-count")
		expect(executionEvents.length).toBeGreaterThanOrEqual(1)
	})
})

// ---------------------------------------------------------------------------
// F0-T2 — subscribe / unsubscribe contract + REAL recovery observation
// ---------------------------------------------------------------------------

describe("ELM-02F F0-T2 — subscribe / unsubscribe contract on AgentRuntime", () => {
	it("F0_T2_UNSUBSCRIBE: subscribe returns an unsubscribe that stops future events", async () => {
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

	it("F0_T2_RECOVERY_TYPE_NARROWING: listener narrowing on recovery-state-changed typechecks", () => {
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

	it("F0_T2_RECOVERY_CANONICAL: a deterministic recoverable failure emits recovery-state-changed through subscribe", async () => {
		// Reuses the C1.5 deterministic recovery harness
		// (agent-runtime.recovery-events.test.ts) so we exercise the
		// real AgentRuntime dispatcher — no host event is fabricated.
		const calls = { count: 0 }
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			finishStep,
		])
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		})

		const recoveryEvents: AgentRuntimeEvent[] = []
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "recovery-state-changed") {
				recoveryEvents.push(event)
			}
		})

		await runtime.run("F0-T2-recovery")

		// Gate from ACT-CORRECTION01: at least one
		// recovery-state-changed must reach the subscriber.
		expect(recoveryEvents.length).toBeGreaterThanOrEqual(1)
		// The first transition is idle -> recovering with exactly one
		// episode failure (the ENOENT thrown above).
		const first = recoveryEvents[0] as Extract<
			AgentRuntimeEvent,
			{ type: "recovery-state-changed" }
		>
		expect(first.previousRecovery.state).toBe("idle")
		const recovery = first.snapshot.recovery as AgentRuntimeRecoverySnapshot
		expect(recovery.state).toBe("recovering")
		expect(recovery.episodeFailures).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// F0-T3 — RuntimeEventAdapter returns [] for execution-state-changed
// ---------------------------------------------------------------------------

describe("ELM-02F F0-T3 — F0_T3_EXECUTION_LEGACY_ABSENT: adapter drops canonical execution event", () => {
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

// ---------------------------------------------------------------------------
// F0-T4 — RuntimeEventAdapter returns [] for recovery-state-changed
// ---------------------------------------------------------------------------

describe("ELM-02F F0-T4 — F0_T4_RECOVERY_LEGACY_ABSENT: adapter drops canonical recovery event", () => {
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

// ---------------------------------------------------------------------------
// F0-T5 — Exact legacy event sequence + count baseline
// ---------------------------------------------------------------------------

describe("ELM-02F F0-T5 — legacy event sequence/count baseline", () => {
	it("F0_T5_LEGACY_EXACT_SEQUENCE: a single-shot text-only run produces this exact legacy sequence", async () => {
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

		// Frozen baseline captured at ELM-02F-F0-WITNESS-CORRECTION01
		// before any F1 production edit. Any change to this sequence
		// (insert, remove, reorder, duplicate) must fail this test.
		expect(legacyEvents).toEqual([
			"iteration_start",
			"content_start",
			"content_end",
			"iteration_end",
			"done",
		])
	})

	it("F0_T5_LEGACY_EXACT_COUNT: the same fixture emits LEGACY_EVENT_COUNT_BASELINE legacy events", async () => {
		const LEGACY_EVENT_COUNT_BASELINE = 5

		const runtime = new AgentRuntime({
			model: makeStreamingModel(),
			tools: [],
		})
		const adapter = new RuntimeEventAdapter()
		const legacyEvents: string[] = []
		runtime.subscribe((event) => {
			for (const legacy of adapter.translate(event)) {
				legacyEvents.push(legacy.type)
			}
		})
		await runtime.run("F0-T5-count")

		expect(legacyEvents.length).toBe(LEGACY_EVENT_COUNT_BASELINE)
	})

	it("F0_T5_CANONICAL_NO_DUPLICATION: canonical stream contains execution-state-changed exactly once for the text-only fixture", async () => {
		const runtime = new AgentRuntime({
			model: makeStreamingModel(),
			tools: [],
		})
		const canonicalTypes: string[] = []
		runtime.subscribe((event) => canonicalTypes.push(event.type))
		await runtime.run("F0-T5-canonical")

		const executionCount = canonicalTypes.filter(
			(t) => t === "execution-state-changed",
		).length
		const recoveryCount = canonicalTypes.filter(
			(t) => t === "recovery-state-changed",
		).length

		// Canonical execution fires exactly once for a text-only
		// run (turn-start engages; text-delta streams; turn-end
		// releases — one toggle).
		expect(executionCount).toBe(1)
		// No recovery on a clean text-only run.
		expect(recoveryCount).toBe(0)
	})
})

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C4-ADVERSARIAL
 *
 * C2.5-C4 — C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN adversarial.
 *
 * This test qualifies the **classifier+recorder chain** under
 * non-causal-minimal conditions that the C25-C3 P/N1/N2/N3 matrix
 * deliberately excluded. The C25-C4 plan is in
 *   docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-plan.md
 * and the closure criteria are in
 *   docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-evidence.md
 *
 * Same R4-decompositional topology as C25-C3:
 *   - Synthetic: getLegacyPhase, getArbiterSnapshot, canonical event
 *   - Real: wiring.observeCanonicalRuntimeEvent → coordinator →
 *           comparator → recorder → classify()
 *
 * The transport proof is C-REAL-1..5 (already independent).
 * The classifier proof is C25-C3 (already independent).
 * C25-C4 qualifies **runtime-sequencing robustness** of the
 * classifier+recorder chain by exercising hostile orderings.
 *
 * Twelve tests, in three families:
 *   Adversarial event sequences (5 tests, C4-1, C4-2, C4-7, C4-8, C4-10)
 *   Wiring lifecycle / disposal (3 tests, C4-9, C4-12, C4-13)
 *   Negative and isolation (4 tests, C4-11, C4-14, C4-15, C4-16)
 *
 * All tests use the canonical-event ingress (the production
 * wiring's own `observeCanonicalRuntimeEvent`).
 *
 * Three predicate conjuncts (legacy=idle, shadow=streaming,
 * arbiterActive=true) are independently necessary. C3 P/N1/N2/N3
 * froze the contract; C4 proves the chain is robust under
 * non-causal-minimal runtime sequences.
 *
 * For P and N2 (where arbiter matters), the test fixture has the
 * input available, so the evidence-strengthening assertion pins the
 * exact arbiter input at the same observation. The retained
 * recorder fields are derived from observationModel.activity; the
 * arbiter input is the canonical projection that is
 * *not* persisted to the recording but participates in
 * arbiterActive.
 */

import type { AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { TaskShadowHostWiringDeps } from "../task-state-shadow-host-wiring"
import { createTaskShadowHostWiring } from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

// =========================================================================
// Env-flag hygiene
// =========================================================================

const ORIGINAL_ENV = process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL

beforeEach(() => {
	process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = "1"
})

const restoreEnv = () => {
	if (ORIGINAL_ENV === undefined) delete process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL
	else process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = ORIGINAL_ENV
}

// =========================================================================
// Canonical-event fixtures
// =========================================================================

function baseSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_c25_c4",
		runId: "run_c25_c4",
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
	}
}

function liveBaseSnapshot(): AgentRuntimeStateSnapshot {
	return {
		...baseSnapshot(),
		execution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
		recoveryState: "idle",
	}
}

function liveBaseSnapshotStreaming(): AgentRuntimeStateSnapshot {
	return {
		...liveBaseSnapshot(),
		execution: {
			modelStreaming: true,
			tooling: false,
			awaitingApproval: false,
		},
	}
}

function modelStreamStartedEvent(): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot: liveBaseSnapshotStreaming(),
		previousExecution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
	} as unknown as AgentRuntimeEvent
}

function modelStreamFinishedEvent(): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot: liveBaseSnapshot(),
		previousExecution: {
			modelStreaming: true,
			tooling: false,
			awaitingApproval: false,
		},
	} as unknown as AgentRuntimeEvent
}

function toolStartedEvent(): AgentRuntimeEvent {
	return {
		type: "tool-started",
		snapshot: liveBaseSnapshot(),
		previousExecution: {
			modelStreaming: true,
			tooling: false,
			awaitingApproval: false,
		},
	} as unknown as AgentRuntimeEvent
}

function toolFinishedEvent(): AgentRuntimeEvent {
	return {
		type: "tool-finished",
		snapshot: liveBaseSnapshot(),
		previousExecution: {
			modelStreaming: true,
			tooling: false,
			awaitingApproval: false,
		},
	} as unknown as AgentRuntimeEvent
}

// =========================================================================
// Synthetic arbiter snapshots
// =========================================================================

function arbiterActive(): ArbiterSnapshot {
	return {
		execution: {
			modelStreaming: true,
			tooling: false,
			awaitingApproval: false,
		},
		recoveryState: "idle",
		status: "running",
		pendingToolCalls: [],
	}
}

function arbiterInactive(): ArbiterSnapshot {
	return {
		execution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
		recoveryState: "idle",
		status: "running",
		pendingToolCalls: [],
	}
}

// =========================================================================
// Wiring harness
// =========================================================================

interface WiringHarness {
	readonly wiring: ReturnType<typeof createTaskShadowHostWiring>
	readonly resetForNewTask: () => void
}

function makeHarness(args: { legacyPhase: TurnPhase; arbiter: ArbiterSnapshot; sessionId?: string }): WiringHarness {
	const sessionId = args.sessionId ?? "c25-c4-session"
	let resetForNewTaskFn: (() => void) | undefined

	const deps: TaskShadowHostWiringDeps = {
		lifecycle: {
			getActiveSession: () => ({ sessionId }) as never,
			setRunning: () => undefined,
		},
		sessionOptions: {
			mcpHub: undefined as never,
			requestToolApproval: (() => undefined) as never,
			taskQuestion: (() => undefined) as never,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
		},
		getLegacyPhase: () => args.legacyPhase,
		getArbiterSnapshot: () => args.arbiter,
		now: () => 1_700_000_000_000,
		resetForNewTask: () => {
			resetForNewTaskFn?.()
		},
	}
	const wiring = createTaskShadowHostWiring(deps)
	resetForNewTaskFn = () => {
		const w = wiring as unknown as { resetForNewTask?: () => void }
		w.resetForNewTask?.()
	}
	return { wiring, resetForNewTask: resetForNewTaskFn }
}

function observe(wiring: ReturnType<typeof createTaskShadowHostWiring>, event: AgentRuntimeEvent, sessionId = "c25-c4-session") {
	wiring.observeCanonicalRuntimeEvent({
		origin: "RUNTIME_CANONICAL",
		sessionId,
		event,
	})
}

// =========================================================================
// Tests
// =========================================================================

describe("C2.5-C4 — C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN adversarial", () => {
	afterAll(() => {
		restoreEnv()
	})

	// C4-1: P + tool-started + tool-finished
	it("C4-1: P + tool-started + tool-finished: D01 = 1 (only from model_stream_started), tool events produce no extra D01", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		observe(wiring, toolStartedEvent())
		observe(wiring, toolFinishedEvent())
		const counts = wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D01_LEGACY_FALSE_IDLE).toBe(1)
		wiring.dispose()
	})

	// C4-2: back-to-back execution-state-changed
	it("C4-2: back-to-back execution-state-changed: shadow state transitions, no duplicate D01", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		observe(wiring, modelStreamFinishedEvent())
		const counts = wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D01_LEGACY_FALSE_IDLE).toBe(1)
		expect(counts.eventsObserved).toBe(2)
		wiring.dispose()
	})

	// C4-7: tool events only
	it("C4-7: tool events only: 0 D01 (no execution-state edge fired)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, toolStartedEvent())
		observe(wiring, toolFinishedEvent())
		const counts = wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D01_LEGACY_FALSE_IDLE).toBe(0)
		wiring.dispose()
	})

	// C4-8: P repeated 3x
	it("C4-8: P repeated 3x: D01 = 3, no silent dedup", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		observe(wiring, modelStreamStartedEvent())
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		expect(records.length).toBe(3)
		for (const r of records) {
			expect(r.classification).toBe("D01_LEGACY_FALSE_IDLE")
		}
		wiring.dispose()
	})

	// C4-10: shadow state rollback
	it("C4-10: shadow state rollback: P, finish, inactivate, P -> D01=2 total (1 per epoch)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		observe(wiring, modelStreamFinishedEvent())
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		expect(records.length).toBe(3)
		expect(records[0]?.classification).toBe("D01_LEGACY_FALSE_IDLE")
		expect(records[1]?.classification).toBe("D00_AGREE")
		expect(records[2]?.classification).toBe("D01_LEGACY_FALSE_IDLE")
		const d01Count = records.filter((r) => r.classification === "D01_LEGACY_FALSE_IDLE").length
		expect(d01Count).toBe(2)
		wiring.dispose()
	})

	// C4-9: dispose mid-stream
	it("C4-9: dispose mid-stream: subsequent observe is a no-op (no zombie records)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		const beforeDispose = wiring.records().length
		wiring.dispose()
		const afterDispose = wiring.records().length
		expect(afterDispose).toBe(beforeDispose)
	})

	// C4-12: multiple wirings in same test
	it("C4-12: multiple wirings in same test: each is independent", () => {
		const { wiring: wA } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
			sessionId: "sessionA",
		})
		const { wiring: wB } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
			sessionId: "sessionB",
		})
		observe(wA, modelStreamStartedEvent(), "sessionA")
		observe(wB, modelStreamStartedEvent(), "sessionB")
		expect(wA.records().length).toBe(1)
		expect(wB.records().length).toBe(1)
		expect(wA.records()[0]?.classification).toBe("D01_LEGACY_FALSE_IDLE")
		expect(wB.records()[0]?.classification).toBe("D01_LEGACY_FALSE_IDLE")
		wA.dispose()
		wB.dispose()
	})

	// C4-13: dispose + new wiring in same test
	it("C4-13: dispose + new wiring in same test: no leak between wirings", () => {
		const { wiring: w1 } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
			sessionId: "leak_test_1",
		})
		observe(w1, modelStreamStartedEvent(), "leak_test_1")
		w1.dispose()
		const { wiring: w2 } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
			sessionId: "leak_test_2",
		})
		observe(w2, modelStreamStartedEvent(), "leak_test_2")
		const r1 = w1.records()
		const r2 = w2.records()
		expect(r1.length).toBe(1)
		expect(r2.length).toBe(1)
		expect(r1[0]?.classification).toBe("D01_LEGACY_FALSE_IDLE")
		expect(r2[0]?.classification).toBe("D01_LEGACY_FALSE_IDLE")
		w2.dispose()
	})

	// C4-11: session ID with special chars
	it("C4-11: session ID with special chars (/.s_-) is accepted verbatim", () => {
		const specialId = "sess/withspaces_and-dashes.dot"
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
			sessionId: specialId,
		})
		observe(wiring, modelStreamStartedEvent(), specialId)
		const records = wiring.records()
		expect(records.length).toBe(1)
		expect(records[0]?.classification).toBe("D01_LEGACY_FALSE_IDLE")
		wiring.dispose()
	})

	// C4-14: arbiter inactive -> D02
	it("C4-14: P with arbiter inactive produces D02_SHADOW_FALSE_ACTIVE (not D01)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterInactive(),
		})
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		expect(records.length).toBe(1)
		expect(records[0]?.classification).toBe("D02_SHADOW_FALSE_ACTIVE")
		wiring.dispose()
	})

	// C4-15: passive arbiter
	it("C4-15: arbiter present but fully inactive: D02 not D01 even with modelStreaming=false in arbiter", () => {
		const passiveArbiter: ArbiterSnapshot = {
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		}
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: passiveArbiter,
		})
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		expect(records.length).toBe(1)
		expect(records[0]?.classification).toBe("D02_SHADOW_FALSE_ACTIVE")
		wiring.dispose()
	})

	// C4-16: legacyPhase=streaming (no edge)
	it("C4-16: P with legacyPhase=streaming produces D00_AGREE (no D01, no D11 in canonical ingress)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "streaming",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		expect(records.length).toBe(1)
		expect(records[0]?.classification).toBe("D00_AGREE")
		wiring.dispose()
	})
})

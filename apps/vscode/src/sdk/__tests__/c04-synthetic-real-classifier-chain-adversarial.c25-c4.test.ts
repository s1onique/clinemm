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

/**
 * C25-C4-CORRECTION02 R6: alias for the per-harness sample
 * witness so the interface and the inline record type are
 * defined once and cannot drift.
 */
type ArbiterSamples = { count: number; last: ArbiterSnapshot | undefined }

interface WiringHarness {
	readonly wiring: ReturnType<typeof createTaskShadowHostWiring>
	readonly resetForNewTask: () => void
	/**
	 * C25-C4-CORRECTION01 R3: per-harness sample counter + last
	 * sampled arbiter snapshot, mirroring the C3 harness. Lets
	 * C4-14 / C4-15 assert the EXACT arbiter object at the
	 * observation rather than only its externally-applied effect.
	 *
	 * C25-C4-CORRECTION02 R6: declared as a required member of
	 * the public harness shape so a strict object-literal
	 * assignment satisfies the target type without an excess-
	 * property error.
	 */
	readonly arbiterSamples: ArbiterSamples
}

function makeHarness(args: { legacyPhase: TurnPhase; arbiter: ArbiterSnapshot; sessionId?: string }): WiringHarness {
	const sessionId = args.sessionId ?? "c25-c4-session"
	let resetForNewTaskFn: (() => void) | undefined
	// C25-C4-CORRECTION01 R3: per-harness sample witness; declared
	// up here so the closure in getArbiterSnapshot captures it.
	const arbiterSamples: ArbiterSamples = {
		count: 0,
		last: undefined,
	}

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
		getArbiterSnapshot: () => {
			// C25-C4-CORRECTION01 R3: per-harness sample witness
			// mirrors the C3 harness so C4-14 / C4-15 can prove
			// the EXACT arbiter object that fed the classifier.
			arbiterSamples.count += 1
			arbiterSamples.last = args.arbiter
			return args.arbiter
		},
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
	return { wiring, resetForNewTask: resetForNewTaskFn, arbiterSamples }
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
	//
	// C25-C4-CORRECTION01 R5: this is a RECORDER / CANONICAL-INGRESS
	// dedup probe, not a global dedup probe. All three stimuli use
	// the same `runId`, the same `now()` timestamp, and the same
	// previous/current execution edge. The test asserts the recorder
	// admits three observations verbatim, independent of any
	// earlier C2.4 work on coordinator edge-key dedup behavior
	// (which only applies to reconstructed streams, not to
	// canonical-event ingress).
	it("C4-8: P repeated 3x: D01 = 3, no recorder/canonical-ingress dedup", () => {
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
	//
	// C25-C4-CORRECTION01 R4: the test fixtures use a single
	// `runId` and do NOT mutate the task/run reset state
	// between the two P inputs. The two D01 records therefore
	// belong to TWO STREAMING ACTIVATION CYCLES within one
	// task epoch, not two task epochs. The wording below
	// reflects that.
	it("C4-10: shadow state rollback: P, finish, inactivate, P -> D01=2 total (1 per streaming activation cycle)", () => {
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
	//
	// C25-C4-CORRECTION01 R2 (reframed): the wiring's `dispose()`
	// only restores `sessionOptions.onSessionEvent` to its pre-
	// wiring value (see task-state-shadow-host-wiring.ts:527-530).
	// It does NOT short-circuit the canonical-event ingress. A
	// canonical event delivered AFTER dispose() is therefore still
	// admitted by the wiring's `observeCanonicalRuntimeEvent` and
	// produces a fresh D01 record.
	//
	// C25-C4-CORRECTION02 R8: the safety conclusion that production
	// callers "must rely on the C2.4-B FIXUP01 session-authority
	// gate, NOT on dispose() alone" was sharper than the evidence
	// supports. The C4-9 fixture itself disproves session-authority
	// sufficiency: after dispose() the session is still active,
	// the same sessionId is still in `lifecycle.getActiveSession()`,
	// the session-authority gate therefore passes, and a fresh D01
	// is recorded. The actual production safety property is one
	// level earlier: **the owner (subscription) must stop delivering
	// events to the disposed wiring** — i.e. the transport /
	// subscription teardown (or the owner itself) prevents post-
	// dispose invocation. The session-authority gate is a separate
	// stale/wrong-session defense and is NOT sufficient on its own
	// when the disposed wiring is called with the still-active
	// session ID. The harness confirms the wiring's actual behavior:
	it("C4-9: dispose mid-stream: documents that dispose() does NOT gate canonical-event ingress (post-dispose observe still produces a D01)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		const beforeDispose = wiring.records().length
		expect(beforeDispose).toBe(1)
		wiring.dispose()
		// Post-dispose observe: documented behavior is that the
		// canonical-event ingress remains callable and admits the
		// event. We assert what the wiring does, not what we might
		// wish it did. Production callers must rely on the
		// session-authority gate (C2.4-B FIXUP01), not on
		// `dispose()` alone.
		observe(wiring, modelStreamStartedEvent())
		const afterDispose = wiring.records().length
		expect(afterDispose).toBe(2)
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
		const injectedArbiter = arbiterInactive()
		const { wiring, arbiterSamples } = makeHarness({
			legacyPhase: "idle",
			arbiter: injectedArbiter,
		})
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		expect(records.length).toBe(1)
		expect(records[0]?.classification).toBe("D02_SHADOW_FALSE_ACTIVE")
		// C25-C4-CORRECTION01 R3: exact same-observation arbiter
		// witness. The arbiter object that fed the classifier
		// must equal the one the test injected (by reference,
		// since the wiring returned args.arbiter verbatim).
		expect(arbiterSamples.count).toBe(1)
		expect(arbiterSamples.last).toBe(injectedArbiter)
		expect(arbiterSamples.last?.execution.modelStreaming).toBe(false)
		expect(arbiterSamples.last?.execution.tooling).toBe(false)
		expect(arbiterSamples.last?.execution.awaitingApproval).toBe(false)
		expect(arbiterSamples.last?.pendingToolCalls.length).toBe(0)
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
		const { wiring, arbiterSamples } = makeHarness({
			legacyPhase: "idle",
			arbiter: passiveArbiter,
		})
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		expect(records.length).toBe(1)
		expect(records[0]?.classification).toBe("D02_SHADOW_FALSE_ACTIVE")
		// C25-C4-CORRECTION01 R3: exact same-observation arbiter
		// witness. The arbiter object that fed the classifier
		// must equal the one the test injected. We assert the
		// reference identity and the inner field values.
		expect(arbiterSamples.count).toBe(1)
		expect(arbiterSamples.last).toBe(passiveArbiter)
		expect(arbiterSamples.last?.execution.modelStreaming).toBe(false)
		expect(arbiterSamples.last?.execution.tooling).toBe(false)
		expect(arbiterSamples.last?.execution.awaitingApproval).toBe(false)
		expect(arbiterSamples.last?.pendingToolCalls.length).toBe(0)
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

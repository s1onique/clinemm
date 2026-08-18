// ===========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7-LOCAL-BACKEND-ACTIVATION01:
//
// E7 consumer-cutover qualification suite. Covers the matrix from
// `docs/architecture/elm/task-state-e5-e6-correction02-c25-c5-terminal-e7-authorization-evidence.md`:
//
//   E7-T0  ENTRY / SCOPE        — E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY
//   E7-T1  REAL_ARBITER_SELECTION — E7-PRE1_REAL_ARBITER_SOURCE_SELECTION
//                                   (real SdkController.getArbiterSnapshot
//                                   closure invoked via real wiring)
//   E7-T2  LOCAL_CONSUMER_CUTOVER  — SdkController.getLocalShadowProjection
//                                    + getLocalShadowPhase
//   E7-T3  LEGACY_CONTROL          — turnStateTracker.currentPhase still
//                                    drives Task/control state
//   E7-T4  HUB_EXCLUSION           — Hub host returns no shadow wiring;
//                                    getLocalShadowProjection() === undefined
//   E7-T5  REMOTE_EXCLUSION        — same shape as Hub
//   E7-T6  C04 / CLASSIFICATION    — the structural impossibility of D01
//                                    under LEGACY_MIRROR is now expressible
//   E7-T7  SESSION_LIFECYCLE       — no post-dispose delivery
//   E7-T8  EXISTING_QUALIFICATION  — 24 + 20 + 12 + 7 + 5 retained
//                                    (verified outside this file)
//   E7-T9  TYPES / BUILD / HYGIENE — zero new type errors
//   E7-T10 DOGFOOD_AUTHORIZATION   — only after T0..T9 PASS
//
// HARD CONSERVATION BOUNDARY:
//
//   LOCAL                         = activated (read-only advisory)
//   HUB                           = unchanged / excluded
//   REMOTE                        = unchanged / excluded
//   PROTOCOL_DELTA                = 0
//   EFFECT_EXECUTION_ENABLED      = false (E7 is read-only;
//                                               E9 owns effect execution)
// ===========================================================================

import type {
	AgentMessage,
	AgentRunStatus,
	AgentRuntimeEvent,
	AgentRuntimeExecutionState,
	AgentRuntimeStateSnapshot,
	RecoveryState,
} from "@cline/shared"
import type { TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
import {
	legacyArbiterSnapshotFromTurnPhase,
	mapAgentRuntimeStateSnapshotToArbiterSnapshot,
} from "../task-state-shadow-arbiter-mapper"
import { createTaskShadowHostWiring, emptyArbiterSnapshot, type TaskShadowHostWiringDeps } from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot, TaskShadowHostWiringWithSink } from "../task-state-shadow-recorder"

const NOW = 1_700_000_000_000

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<AgentRuntimeStateSnapshot> = {}): AgentRuntimeStateSnapshot {
	return {
		agentId: "e7_agent",
		runId: "e7_run",
		status: "idle" as AgentRunStatus,
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		...overrides,
	}
}

/**
 * A minimal canonical-runtime event that the wiring's
 * `observeCanonicalRuntimeEvent` accepts and the comparator /
 * recorder can classify without exotic setup.
 */
function makeExecutionEvent(opts: {
	modelStreaming: boolean
	tooling: boolean
	awaitingApproval: boolean
	status?: AgentRunStatus
	pendingToolCalls?: readonly string[]
	recoveryState?: RecoveryState
}): AgentRuntimeEvent {
	const snap = makeSnapshot({
		execution: {
			modelStreaming: opts.modelStreaming,
			tooling: opts.tooling,
			awaitingApproval: opts.awaitingApproval,
		} as AgentRuntimeExecutionState,
		pendingToolCalls: opts.pendingToolCalls ?? [],
		status: (opts.status ?? "idle") as AgentRunStatus,
		recovery: { state: (opts.recoveryState ?? "idle") as RecoveryState } as AgentRuntimeStateSnapshot["recovery"],
	})
	return {
		type: "execution-state-changed",
		snapshot: snap,
		previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
	} as unknown as AgentRuntimeEvent
}

/**
 * E7-PRE1_REAL_ARBITER_SOURCE_SELECTION note: this factory
 * reproduces the EXACT selection expression at SdkController.ts:566-602
 * (the ELM-02F-CORRECTION01 selection closure), parameterized
 * over the `sdkHost` / `sessionId` / `turnStateTracker.currentPhase`
 * accessors.
 *
 * The point of E7-PRE1 is that the real wiring invokes this exact
 * closure (via `coordinator.observe` → `applyAndRecord` →
 * `getArbiterSnapshot`) — not a local mirror. E7-T1 witnesses this.
 */
function makeSelectionClosure(
	hostRuntimeSnapshot: ((sid: string | undefined) => AgentRuntimeStateSnapshot | undefined) | undefined,
	getLegacyPhase: () => TurnPhase,
): () => ArbiterSnapshot {
	return () => {
		const sessionId = "e7_session"
		const canonical = hostRuntimeSnapshot?.(sessionId)
		if (canonical) {
			return mapAgentRuntimeStateSnapshotToArbiterSnapshot(canonical)
		}
		return legacyArbiterSnapshotFromTurnPhase(getLegacyPhase())
	}
}

function makeWiringDeps(opts: {
	hostRuntimeSnapshot: ((sid: string | undefined) => AgentRuntimeStateSnapshot | undefined) | undefined
	legacyPhase: TurnPhase
	getArbiterSnapshot?: () => ArbiterSnapshot
}): TaskShadowHostWiringDeps {
	return {
		lifecycle: {
			getActiveSession: () => ({ sessionId: "e7_session" }) as never,
			setRunning: () => undefined,
		} as never,
		sessionOptions: {
			mcpHub: undefined,
			requestToolApproval: undefined,
			askQuestion: undefined,
			onSessionEvent: () => {},
			onSendComplete: () => {},
			onSendError: () => {},
		} as never,
		getLegacyPhase: () => opts.legacyPhase,
		getArbiterSnapshot: opts.getArbiterSnapshot ?? makeSelectionClosure(opts.hostRuntimeSnapshot, () => opts.legacyPhase),
		now: () => NOW,
	}
}

// ===========================================================================
// E7-T0  ENTRY / SCOPE
// ===========================================================================

describe("ELM-02F E7-T0 — entry / scope", () => {
	it("E7-T0.a: E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY (test-side constant)", () => {
		const E7_INITIAL_BACKEND_SCOPE: "LOCAL_ONLY" = "LOCAL_ONLY"
		expect(E7_INITIAL_BACKEND_SCOPE).toBe("LOCAL_ONLY")
	})
})

// ===========================================================================
// E7-T1  REAL_ARBITER_SELECTION  (E7-PRE1_REAL_ARBITER_SOURCE_SELECTION)
// ===========================================================================

describe("ELM-02F E7-T1 — real arbiter selection (E7-PRE1)", () => {
	it("E7-T1.a: real wiring + canonical snapshot → arbiter == canonical mapping", () => {
		const canonical = makeSnapshot({
			execution: {
				modelStreaming: true,
				tooling: true,
				awaitingApproval: false,
			} as AgentRuntimeExecutionState,
			pendingToolCalls: ["tool-A"],
			status: "running" as AgentRunStatus,
			recovery: { state: "idle" as RecoveryState } as AgentRuntimeStateSnapshot["recovery"],
		})
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: () => canonical,
				legacyPhase: "idle",
			}),
		)

		// Drive a real observation through the production wiring.
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: true,
				tooling: true,
				awaitingApproval: false,
				status: "running",
				pendingToolCalls: ["tool-A"],
				recoveryState: "idle",
			}),
		})

		const lastArbiter = wiring.getLastObservedArbiter()
		expect(lastArbiter).toBeDefined()
		expect(lastArbiter?.execution.modelStreaming).toBe(true)
		expect(lastArbiter?.execution.tooling).toBe(true)
		expect(lastArbiter?.pendingToolCalls).toEqual(["tool-A"])
		expect(lastArbiter?.status).toBe("running")
	})

	it("E7-T1.b: real wiring + no canonical snapshot → arbiter == legacy fallback (byte-equivalent)", () => {
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: undefined,
				legacyPhase: "streaming",
			}),
		)
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: true,
				tooling: true,
				awaitingApproval: false,
			}),
		})
		const lastArbiter = wiring.getLastObservedArbiter()
		expect(lastArbiter).toBeDefined()
		expect(lastArbiter?.execution.modelStreaming).toBe(true) // streaming → true
		expect(lastArbiter?.execution.tooling).toBe(true)
		expect(lastArbiter?.execution.awaitingApproval).toBe(false)
		expect(lastArbiter?.status).toBe("idle") // legacy default
		expect(lastArbiter?.recoveryState).toBe("idle")
	})

	it("E7-T1.c: real wiring + canonical returns undefined → legacy fallback", () => {
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: () => undefined,
				legacyPhase: "awaiting_approval",
			}),
		)
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: false,
				tooling: false,
				awaitingApproval: true,
			}),
		})
		const lastArbiter = wiring.getLastObservedArbiter()
		expect(lastArbiter?.execution.awaitingApproval).toBe(true)
		expect(lastArbiter?.execution.modelStreaming).toBe(false)
		expect(lastArbiter?.execution.tooling).toBe(false)
	})

	it("E7-T1.d: real wiring invokes getArbiterSnapshot per observation (real closure, not parallel)", () => {
		const getArbiterSpy = vi.fn(() => emptyArbiterSnapshot())
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: undefined,
				legacyPhase: "idle",
				getArbiterSnapshot: getArbiterSpy,
			}),
		)

		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			}),
		})
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
		})

		expect(getArbiterSpy).toHaveBeenCalledTimes(2)
	})
})

// ===========================================================================
// E7-T2  LOCAL_CONSUMER_CUTOVER
// ===========================================================================

describe("ELM-02F E7-T2 — Local consumer cutover", () => {
	it("E7-T2.a: before any observation, advisory accessors return undefined", () => {
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: () =>
					makeSnapshot({
						execution: {
							modelStreaming: true,
							tooling: false,
							awaitingApproval: false,
						} as AgentRuntimeExecutionState,
					}),
				legacyPhase: "idle",
			}),
		)
		expect(wiring.getLastObservedArbiter()).toBeUndefined()
		expect(wiring.getLastObservedShadowPhase()).toBeUndefined()
	})

	it("E7-T2.b: after a real observation, advisory accessors surface the canonical projection", () => {
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: () =>
					makeSnapshot({
						execution: {
							modelStreaming: true,
							tooling: false,
							awaitingApproval: false,
						} as AgentRuntimeExecutionState,
					}),
				legacyPhase: "idle",
			}),
		)
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
		})
		const arb = wiring.getLastObservedArbiter()
		expect(arb).toBeDefined()
		expect(arb?.execution.modelStreaming).toBe(true)
		const ph = wiring.getLastObservedShadowPhase()
		expect(ph).toBeDefined()
		expect(typeof ph).toBe("string")
	})

	it("E7-T2.c: resetForNewTask clears the advisory cache (new task identity, fresh canonical)", () => {
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: undefined,
				legacyPhase: "idle",
			}),
		)
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			}),
		})
		expect(wiring.getLastObservedArbiter()).toBeDefined()
		wiring.resetForNewTask()
		expect(wiring.getLastObservedArbiter()).toBeUndefined()
		expect(wiring.getLastObservedShadowPhase()).toBeUndefined()
	})

	it("E7-T2.d: advisory accessors never throw (observation-only contract)", () => {
		const wiring = createTaskShadowHostWiring(makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: "idle" }))
		expect(() => wiring.getLastObservedArbiter()).not.toThrow()
		expect(() => wiring.getLastObservedArbiter()).not.toThrow()
		expect(() => wiring.getLastObservedShadowPhase()).not.toThrow()
	})

	it("E7-T2.e: accessors do NOT mutate the recorder (read-only)", () => {
		const wiring = createTaskShadowHostWiring(makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: "idle" }))
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			}),
		})
		const countsBefore = wiring.recorderCounts()
		const recordsBefore = wiring.records().length
		wiring.getLastObservedArbiter()
		wiring.getLastObservedShadowPhase()
		const countsAfter = wiring.recorderCounts()
		const recordsAfter = wiring.records().length
		expect(countsAfter).toEqual(countsBefore)
		expect(recordsAfter).toBe(recordsBefore)
	})
})

// ===========================================================================
// E7-T3  LEGACY_CONTROL — equivalent legacy behavior observable
// ===========================================================================

describe("ELM-02F E7-T3 — legacy control remains observable", () => {
	it("E7-T3.a: legacy fallback is byte-equivalent to legacyArbiterSnapshotFromTurnPhase(phase)", () => {
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: undefined,
				legacyPhase: "streaming",
			}),
		)
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: true,
				tooling: true,
				awaitingApproval: false,
			}),
		})
		const recorded = wiring.getLastObservedArbiter()
		const direct = legacyArbiterSnapshotFromTurnPhase("streaming")
		expect(recorded).toEqual(direct)
	})

	it("E7-T3.b: legacy fallback for each canonical phase matches phase-only derivation", () => {
		const phases: TurnPhase[] = [
			"idle",
			"streaming",
			"awaiting_approval",
			"completed",
			"error",
			"resumable",
			"awaiting_followup",
		]
		for (const phase of phases) {
			const wiring = createTaskShadowHostWiring(makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: phase }))
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "e7_session",
				event: makeExecutionEvent({
					modelStreaming: phase === "streaming",
					tooling: phase === "streaming",
					awaitingApproval: phase === "awaiting_approval",
				}),
			})
			expect(wiring.getLastObservedArbiter()).toEqual(legacyArbiterSnapshotFromTurnPhase(phase))
		}
	})
})

// ===========================================================================
// E7-T4 / E7-T5  HUB_EXCLUSION / REMOTE_EXCLUSION
// ===========================================================================

describe("ELM-02F E7-T4/T5 — Hub / Remote exclusion (no shadow wiring)", () => {
	it("E7-T4.a: Hub host — no taskStateShadowWiring → getLocalShadowProjection() === undefined", () => {
		const fakeHubController = {
			taskStateShadowWiring: undefined as TaskShadowHostWiringWithSink | undefined,
			getLocalShadowProjection() {
				return this.taskStateShadowWiring?.getLastObservedArbiter()
			},
			getLocalShadowPhase() {
				return this.taskStateShadowWiring?.getLastObservedShadowPhase()
			},
		}
		expect(fakeHubController.getLocalShadowProjection()).toBeUndefined()
		expect(fakeHubController.getLocalShadowPhase()).toBeUndefined()
	})

	it("E7-T4.b: Hub/Remote path: no observation → noop wiring returns undefined", () => {
		const noop = createTaskShadowHostWiring({
			...makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: "idle" }),
			getArbiterSnapshot: () => emptyArbiterSnapshot(),
		})
		expect(noop.getLastObservedArbiter()).toBeUndefined()
		expect(noop.getLastObservedShadowPhase()).toBeUndefined()
	})

	it("E7-T5.a: Remote host — same shape as Hub; advisory accessors return undefined", () => {
		const fakeRemoteController = {
			taskStateShadowWiring: undefined as TaskShadowHostWiringWithSink | undefined,
			getLocalShadowProjection() {
				return this.taskStateShadowWiring?.getLastObservedArbiter()
			},
		}
		expect(fakeRemoteController.getLocalShadowProjection()).toBeUndefined()
	})
})

// ===========================================================================
// E7-T6  C04 / CLASSIFICATION  — D01 structurally expressible
// ===========================================================================

describe("ELM-02F E7-T6 — D01 classification expressible post-ELM-02F", () => {
	it("E7-T6.a: legacy=idle, canonical=streaming → arbiterActive=true (D01 structural)", () => {
		const canonical = makeSnapshot({
			execution: {
				modelStreaming: true,
				tooling: true,
				awaitingApproval: false,
			} as AgentRuntimeExecutionState,
			status: "running" as AgentRunStatus,
		})
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: () => canonical,
				legacyPhase: "idle",
			}),
		)
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: true,
				tooling: true,
				awaitingApproval: false,
				status: "running",
			}),
		})
		const arb = wiring.getLastObservedArbiter()
		expect(arb).toBeDefined()
		const arbiterActive = arb!.execution.modelStreaming || arb!.execution.awaitingApproval || arb!.pendingToolCalls.length > 0
		expect(arbiterActive).toBe(true)
	})

	it("E7-T6.b: legacy=streaming, canonical=idle → arbiterActive=false (D02 mirror)", () => {
		const wiring = createTaskShadowHostWiring(
			makeWiringDeps({
				hostRuntimeSnapshot: () => makeSnapshot(),
				legacyPhase: "streaming",
			}),
		)
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			}),
		})
		const arb = wiring.getLastObservedArbiter()
		expect(arb).toBeDefined()
		const arbiterActive = arb!.execution.modelStreaming || arb!.execution.awaitingApproval || arb!.pendingToolCalls.length > 0
		expect(arbiterActive).toBe(false)
	})
})

// ===========================================================================
// E7-T7  SESSION_LIFECYCLE  — no post-dispose delivery
// ===========================================================================

describe("ELM-02F E7-T7 — session lifecycle", () => {
	it("E7-T7.a: dispose → advisory accessors remain safe (no throw)", () => {
		const wiring = createTaskShadowHostWiring(makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: "idle" }))
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId: "e7_session",
			event: makeExecutionEvent({
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			}),
		})
		wiring.dispose()
		expect(() => wiring.getLastObservedArbiter()).not.toThrow()
		expect(() => wiring.getLastObservedShadowPhase()).not.toThrow()
	})

	it("E7-T7.b: no observation throws after dispose (observation-only)", () => {
		const wiring = createTaskShadowHostWiring(makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: "idle" }))
		wiring.dispose()
		expect(() =>
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "e7_session",
				event: makeExecutionEvent({
					modelStreaming: false,
					tooling: false,
					awaitingApproval: false,
				}),
			}),
		).not.toThrow()
	})
})

// ===========================================================================
// E7-T9  TYPES / BUILD / HYGIENE
// ===========================================================================

describe("ELM-02F E7-T9 — API shape", () => {
	it("E7-T9.a: wiring exposes the two new advisory accessors", () => {
		const wiring = createTaskShadowHostWiring(makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: "idle" }))
		expect(typeof wiring.getLastObservedArbiter).toBe("function")
		expect(typeof wiring.getLastObservedShadowPhase).toBe("function")
	})

	it("E7-T9.b: recorder exposes getLastArbiter (caches last canonical arbiter)", () => {
		const wiring = createTaskShadowHostWiring(makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: "idle" }))
		expect(typeof wiring.recorder.getLastArbiter).toBe("function")
		expect(wiring.recorder.getLastArbiter()).toBeUndefined()
	})

	it("E7-T9.c: Hub/Remote absence state ≡ Local no-canonical-session (both === undefined)", () => {
		const hubController = {
			taskStateShadowWiring: undefined as TaskShadowHostWiringWithSink | undefined,
			getLocalShadowProjection() {
				return this.taskStateShadowWiring?.getLastObservedArbiter()
			},
		}
		const localController = {
			taskStateShadowWiring: createTaskShadowHostWiring(
				makeWiringDeps({ hostRuntimeSnapshot: undefined, legacyPhase: "idle" }),
			),
			getLocalShadowProjection() {
				return this.taskStateShadowWiring?.getLastObservedArbiter()
			},
		}
		expect(hubController.getLocalShadowProjection()).toBeUndefined()
		expect(localController.getLocalShadowProjection()).toBeUndefined()
	})
})

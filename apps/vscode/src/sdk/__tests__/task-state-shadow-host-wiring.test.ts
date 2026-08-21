/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 15 — Host-wiring tests.
 *
 * Verifies that the live wiring:
 *   - wraps the existing `SdkSessionLifecycle.onSessionEvent` hook
 *     without replacing it (the user's hook still fires);
 *   - disposes idempotently, restoring the user's hook;
 *   - records divergences for C04 legacy-false-idle shape;
 *   - returns a no-op wiring when the env flag disables it;
 *   - never writes to legacy state.
 */

import type { CoreSessionEvent } from "@cline/core"
import type { AgentEvent } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { SdkSessionLifecycleOptions } from "../sdk-session-lifecycle"
import type { TaskShadowHostWiringDeps } from "../task-state-shadow-host-wiring"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"

const ORIGINAL_ENV = process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL

beforeEach(() => {
	process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = "1"
})

afterEach(() => {
	if (ORIGINAL_ENV === undefined) delete process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL
	else process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = ORIGINAL_ENV
})

function makeDeps(): {
	deps: TaskShadowHostWiringDeps
	hookCalls: { count: number }
	arbiterCounter: { value: number }
} {
	const hookCalls = { count: 0 }
	const arbiterCounter = { value: 0 }
	const sessionOptions: SdkSessionLifecycleOptions = {
		mcpHub: undefined as never,
		requestToolApproval: () => undefined as never,
		askQuestion: () => undefined as never,
		onSessionEvent: () => {
			hookCalls.count += 1
		},
		onSendComplete: () => undefined,
		onSendError: () => undefined,
	}
	const deps: TaskShadowHostWiringDeps = {
		lifecycle: {
			getActiveSession: () => undefined,
			setRunning: () => undefined,
		},
		sessionOptions,
		getLegacyPhase: () => "idle",
		getArbiterSnapshot: () => {
			arbiterCounter.value += 1
			return emptyArbiterSnapshot()
		},
		now: () => 1_700_000_000_000,
	}
	return { deps, hookCalls, arbiterCounter }
}

function legacyAgentEvent<T extends AgentEvent>(event: T, sessionId = "s1"): CoreSessionEvent {
	return { type: "agent_event", payload: { sessionId, event } } as CoreSessionEvent
}

describe("TaskShadowHostWiring — lifecycle", () => {
	it("wraps the existing onSessionEvent and still invokes the user hook", () => {
		const { deps, hookCalls } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		const event = legacyAgentEvent({ type: "iteration_start", iteration: 1 })
		deps.sessionOptions.onSessionEvent(event)
		expect(hookCalls.count).toBe(1)
		wiring.dispose()
	})

	it("dispose restores the original hook", () => {
		const { deps } = makeDeps()
		const original = deps.sessionOptions.onSessionEvent
		const wiring = createTaskShadowHostWiring(deps)
		expect(deps.sessionOptions.onSessionEvent).not.toBe(original)
		wiring.dispose()
		expect(deps.sessionOptions.onSessionEvent).toBe(original)
	})

	it("returns a no-op wiring when the env flag disables it", () => {
		process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = "0"
		const { deps, hookCalls } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		const event = legacyAgentEvent({ type: "iteration_start", iteration: 1 })
		deps.sessionOptions.onSessionEvent(event)
		expect(hookCalls.count).toBe(1)
		wiring.dispose()
	})
})

describe("TaskShadowHostWiring — observation-only", () => {
	it("under LocalRuntimeHost canonicalAvailable=true, the legacy path produces DIAGNOSTIC_ONLY observations (no record, no state mutation)", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring({
			...deps,
			getLegacyPhase: () => "idle",
			getArbiterSnapshot: () => ({
				...emptyArbiterSnapshot(),
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
				status: "running",
			}),
		})
		// Tool-start flips the shadow's `tooling` projection via
		// `activeToolCallIds`. Once that is true, the shadow projects
		// to `streaming`. Under CORRECTION02 Option A, the legacy
		// path is DIAGNOSTIC_ONLY — the reconstructed observation
		// never reaches the shadow or the bounded record buffer.
		const event = legacyAgentEvent({ type: "content_start", contentType: "tool", toolCallId: "tc-1", toolName: "read_file" })
		deps.sessionOptions.onSessionEvent(event)
		const records = wiring.records()
		const counts = wiring.recorderCounts()
		// No bounded record; legacy reconstructed is diagnostic only.
		expect(records.length).toBe(0)
		expect(counts.eventsObserved).toBe(0)
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBeGreaterThanOrEqual(1)
		wiring.dispose()
	})

	it("under LocalRuntimeHost canonicalAvailable=true, a non-divergent iteration_start produces DIAGNOSTIC_ONLY (no record)", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		const event = legacyAgentEvent({ type: "iteration_start", iteration: 1 })
		deps.sessionOptions.onSessionEvent(event)
		const records = wiring.records()
		const counts = wiring.recorderCounts()
		// No bounded record; the legacy path is diagnostic-only.
		expect(records.length).toBe(0)
		expect(counts.eventsObserved).toBe(0)
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBeGreaterThanOrEqual(1)
		wiring.dispose()
	})

	it("propagates user-hook exceptions without absorbing them", () => {
		const { deps } = makeDeps()
		deps.sessionOptions.onSessionEvent = (() => {
			throw new Error("user hook explodes")
		}) as SdkSessionLifecycleOptions["onSessionEvent"]
		const wiring = createTaskShadowHostWiring(deps)
		const event = legacyAgentEvent({ type: "iteration_start", iteration: 1 })
		expect(() => deps.sessionOptions.onSessionEvent(event)).toThrow(/user hook/)
		wiring.dispose()
	})

	it("resetForNewTask clears the recorder state and diagnostic counter", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		const event = legacyAgentEvent({ type: "iteration_start", iteration: 1 })
		deps.sessionOptions.onSessionEvent(event)
		// Under CORRECTION02 Option A, the legacy path increments the
		// diagnostic counter, not eventsObserved.
		expect(wiring.recorderCounts().observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBeGreaterThanOrEqual(1)
		wiring.resetForNewTask()
		expect(wiring.recorderCounts().observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		wiring.dispose()
	})

	it("dependency-boundary: wiring module never imports a writer API", async () => {
		const mod = await import("../task-state-shadow-host-wiring")
		expect(Object.keys(mod).sort()).toContain("createTaskShadowHostWiring")
		expect((mod as unknown as { setTurnPhase?: unknown }).setTurnPhase).toBeUndefined()
		expect((mod as unknown as { postStateToWebview?: unknown }).postStateToWebview).toBeUndefined()
	})
})

/**
 * ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01-CORRECTION01-FIX01:
 *
 * The frozen three-source selector (`selectTaskHeaderPresentation`)
 * depends on the precedence
 *
 *   host-compacting > shadow > legacy absence fallback
 *
 * i.e. when the shadow has never observed anything, the legacy phase
 * must win — not a default-idle projection of `initialTaskModel()`.
 *
 * LAC-ABSENCE01 pins the **presence/absence distinction** that
 * CORRECTION01's canonical delegation would otherwise have collapsed
 * (the canonical projection always returns a phase, including for a
 * brand-new shadow whose `TaskModel` is `initialTaskModel()` which
 * projects to `"idle"`).
 *
 * If this test is RED, the wiring has lost the presence seam and the
 * absence fallback will silently collapse to "idle" — which is
 * exactly the LIVE defect we just closed.
 */
describe("ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01-CORRECTION01-FIX01 / LAC-ABSENCE01 — shadow presence seam", () => {
	it("LAC-ABSENCE01-a: fresh wiring (no observation yet) → getLastObservedShadowPhase() returns undefined (legacy absence fallback wins)", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		// Brand new wiring: no runtime event, no host msg, no canonical
		// subscription call. The shadow has observed nothing.
		expect(wiring.getLastObservedShadowPhase()).toBeUndefined()
		// Presence seam at the comparator level — host concern, not
		// @cline/agents projection.
		expect(wiring.comparator.hasObservedShadowState()).toBe(false)
		wiring.dispose()
	})

	it("LAC-ABSENCE01-b: after a canonical execution-state-changed observation → getLastObservedShadowPhase() returns the canonical streaming phase", () => {
		const { deps } = makeDeps()
		// Wire an active session whose `sessionId` matches the canonical
		// event's sessionId, so the coordinator's stale gate admits the
		// event (F1: STALE on session mismatch → no shadow mutation).
		const sessionId = "session-B"
		const activeSessionRef: { current: { sessionId: string; isRunning: boolean } | undefined } = {
			current: { sessionId, isRunning: true },
		}
		const wiring = createTaskShadowHostWiring({
			...deps,
			lifecycle: {
				...deps.lifecycle,
				getActiveSession: () => activeSessionRef.current as never,
				setRunning: (flag: boolean) => {
					if (activeSessionRef.current) activeSessionRef.current.isRunning = flag
				},
			},
			getRuntimeStatus: () => "running",
			getArbiterSnapshot: () => ({
				...emptyArbiterSnapshot(),
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
				status: "running",
			}),
		})
		// `run-started` only promotes lifecycle to `running`; it does
		// NOT set `activity.modelStreaming = true`. Production drives
		// the shadow to `streaming` via the follow-up
		// `execution-state-changed` event (with previousExecution
		// carrying the false→true flip). Use that event so the
		// canonical projection reflects the streaming phase that
		// LAC01's production RED asserts.
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId,
			event: {
				type: "execution-state-changed",
				snapshot: {
					agentId: "b",
					runId: "run-B",
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
					recovery: {
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
						maxEpisodeFailures: 100,
						circuitNoticeCount: 0,
					},
					execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
				},
				previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			},
		})
		// Presence seam flipped to true after the first observation.
		expect(wiring.comparator.hasObservedShadowState()).toBe(true)
		// Canonical delegation now returns the streaming phase.
		expect(wiring.getLastObservedShadowPhase()).toBe("streaming")
		wiring.dispose()
	})

	it("LAC-ABSENCE01-c: after resetForNewTask → presence seam is cleared (back to absence fallback)", () => {
		const { deps } = makeDeps()
		// Same session/arbiter wiring as LAC-ABSENCE01-b so the canonical
		// event reaches the comparator.
		const sessionId = "session-B"
		const activeSessionRef: { current: { sessionId: string; isRunning: boolean } | undefined } = {
			current: { sessionId, isRunning: true },
		}
		const wiring = createTaskShadowHostWiring({
			...deps,
			lifecycle: {
				...deps.lifecycle,
				getActiveSession: () => activeSessionRef.current as never,
				setRunning: (flag: boolean) => {
					if (activeSessionRef.current) activeSessionRef.current.isRunning = flag
				},
			},
			getRuntimeStatus: () => "running",
			getArbiterSnapshot: () => ({
				...emptyArbiterSnapshot(),
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
				status: "running",
			}),
		})
		// Establish presence via a canonical observation (see LAC-ABSENCE01-b
		// for why we use `execution-state-changed` and not `run-started`).
		wiring.observeCanonicalRuntimeEvent({
			origin: "RUNTIME_CANONICAL",
			sessionId,
			event: {
				type: "execution-state-changed",
				snapshot: {
					agentId: "b",
					runId: "run-B",
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
					recovery: {
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
						maxEpisodeFailures: 100,
						circuitNoticeCount: 0,
					},
					execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
				},
				previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			},
		})
		expect(wiring.getLastObservedShadowPhase()).toBe("streaming")
		// After new-task reset, presence must clear so the next task's
		// legacy phase wins until the new canonical run-started lands.
		wiring.resetForNewTask()
		expect(wiring.comparator.hasObservedShadowState()).toBe(false)
		expect(wiring.getLastObservedShadowPhase()).toBeUndefined()
		wiring.dispose()
	})
})

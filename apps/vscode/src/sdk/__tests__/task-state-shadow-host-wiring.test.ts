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
	it("records C04 legacy-false-idle shape as D01_LEGACY_FALSE_IDLE when arbiter confirms activity", () => {
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
		// to `streaming` and the D01 branch fires when legacy says
		// `idle` but the canonical arbiter confirms activity.
		const event = legacyAgentEvent({ type: "content_start", contentType: "tool", toolCallId: "tc-1", toolName: "read_file" })
		deps.sessionOptions.onSessionEvent(event)
		const records = wiring.records()
		expect(records.length).toBeGreaterThan(0)
		expect(records[0].classification).toBe("D01_LEGACY_FALSE_IDLE")
		expect(records[0].arbitration).toBe("SHADOW_CORRECT")
		wiring.dispose()
	})

	it("records a non-divergent iteration as D00_AGREE when legacy and shadow agree", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		const event = legacyAgentEvent({ type: "iteration_start", iteration: 1 })
		deps.sessionOptions.onSessionEvent(event)
		const records = wiring.records()
		expect(records.length).toBeGreaterThan(0)
		expect(records[0].classification).toBe("D00_AGREE")
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

	it("resetForNewTask clears the recorder state", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		const event = legacyAgentEvent({ type: "iteration_start", iteration: 1 })
		deps.sessionOptions.onSessionEvent(event)
		expect(wiring.recorderCounts().eventsObserved).toBeGreaterThan(0)
		wiring.resetForNewTask()
		expect(wiring.recorderCounts().eventsObserved).toBe(0)
		wiring.dispose()
	})

	it("dependency-boundary: wiring module never imports a writer API", async () => {
		const mod = await import("../task-state-shadow-host-wiring")
		expect(Object.keys(mod).sort()).toContain("createTaskShadowHostWiring")
		expect((mod as unknown as { setTurnPhase?: unknown }).setTurnPhase).toBeUndefined()
		expect((mod as unknown as { postStateToWebview?: unknown }).postStateToWebview).toBeUndefined()
	})
})

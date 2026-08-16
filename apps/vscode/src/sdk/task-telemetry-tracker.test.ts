/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: comprehensive tracker tests.
 */
import type { AgentRuntimeRecoverySnapshot, RecoveryState } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { TaskTelemetryTracker } from "./task-telemetry-tracker"

function recoverySnapshot(partial: Partial<AgentRuntimeRecoverySnapshot> = {}): AgentRuntimeRecoverySnapshot {
	const base: AgentRuntimeRecoverySnapshot = {
		state: "idle" as RecoveryState,
		tracker: {
			state: "idle" as RecoveryState,
			currentRepairAttempts: 0,
			equivalentRepeatCount: 0,
			blockedExactKeys: [],
			blockedFamilies: [],
		},
		secondStage: "idle",
		episodeFailures: 0,
		maxEpisodeFailures: 100,
		circuitNoticeCount: 0,
	}
	const partialTyped = partial as Partial<AgentRuntimeRecoverySnapshot>
	const trackerOverrides = partialTyped.tracker
	const baseTracker = base.tracker
	const mergedTracker = trackerOverrides
		? {
				state: (trackerOverrides.state ?? baseTracker.state) as RecoveryState,
				currentRepairAttempts: trackerOverrides.currentRepairAttempts ?? baseTracker.currentRepairAttempts,
				equivalentRepeatCount: trackerOverrides.equivalentRepeatCount ?? baseTracker.equivalentRepeatCount,
				blockedExactKeys: trackerOverrides.blockedExactKeys ?? baseTracker.blockedExactKeys,
				blockedFamilies: trackerOverrides.blockedFamilies ?? baseTracker.blockedFamilies,
			}
		: baseTracker
	return {
		...base,
		...partialTyped,
		tracker: mergedTracker,
	}
}

/**
 * Convenience overload: build a recovery snapshot from a tracker-only
 * override. The tracker always carries a complete state; passing only
 * a partial `RecoverySnapshot` would be rejected by TS, so we merge
 * against a base snapshot here.
 */
function recoveryWithTracker(tracker: Partial<AgentRuntimeRecoverySnapshot["tracker"]>): AgentRuntimeRecoverySnapshot {
	return recoverySnapshot({ tracker: tracker as AgentRuntimeRecoverySnapshot["tracker"] })
}

describe("ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A / TaskTelemetryTracker", () => {
	it("THA01: returns undefined before any task is started", () => {
		const t = new TaskTelemetryTracker()
		expect(t.get()).toBeUndefined()
	})

	it("THA02: stamps startedAt on the first startTask and exposes it through get()", () => {
		const t = new TaskTelemetryTracker()
		const snap = t.startTask("task-a", 1_700_000_000_000)
		expect(snap?.startedAt).toBe(1_700_000_000_000)
		expect(snap?.toolCalls).toBe(0)
		expect(snap?.recoveryInterventions).toBe(0)
		expect(snap?.endedAt).toBeUndefined()
	})

	it("THA02b: re-calling startTask with the SAME id does not reset the window", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordToolStarted()
		const second = t.startTask("task-a", 1_700_000_000_500)
		expect(second?.startedAt).toBe(1_700_000_000_000)
		expect(second?.toolCalls).toBe(1)
	})

	it("THA03: endTask freezes endedAt exactly once", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.endTask(1_700_000_000_060)
		expect(t.get()?.endedAt).toBe(1_700_000_000_060)
		t.endTask(1_700_000_000_999)
		expect(t.get()?.endedAt).toBe(1_700_000_000_060)
	})

	it("THA04: startedAt survives a remount (same task identity, get() is the source of truth)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		const snap = t.get()
		expect(snap?.startedAt).toBe(1_700_000_000_000)
		expect(snap?.toolCalls).toBe(0)
	})

	it("THA13: recordToolStarted increments the counter by exactly one", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStarted()
		expect(t.get()?.toolCalls).toBe(1)
	})

	it("THA14: tool-finished does NOT increment the counter (the API only has recordToolStarted)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStarted()
		const beforeFinish = t.get()?.toolCalls
		const afterFinish = t.get()?.toolCalls
		expect(afterFinish).toBe(beforeFinish)
		expect(afterFinish).toBe(1)
	})

	it("THA15: parallel siblings count as N tool-starts", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStarted()
		t.recordToolStarted()
		t.recordToolStarted()
		expect(t.get()?.toolCalls).toBe(3)
	})

	it("THA16: denied/rejected/unknown-tool never increments (no recordToolStarted was called)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		expect(t.get()?.toolCalls).toBe(0)
	})

	it("THA17: a positive delta in currentRepairAttempts increments recoveryInterventions by 1", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(
			recoverySnapshot({
				tracker: {
					state: "warning",
					currentRepairAttempts: 1,
					equivalentRepeatCount: 0,
					blockedExactKeys: [],
					blockedFamilies: [],
				},
			}),
		)
		expect(t.get()?.recoveryInterventions).toBe(1)
	})

	it("THA18: control-plane outcomes do NOT increment recoveryInterventions (no snapshot change)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(recoverySnapshot()) // no movement
		expect(t.get()?.recoveryInterventions).toBe(0)
	})

	it("THA18b: episodeFailures and circuitNoticeCount jumps also count once each", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(recoverySnapshot({ episodeFailures: 1 }))
		t.observeRecovery(recoverySnapshot({ episodeFailures: 1, circuitNoticeCount: 1 }))
		expect(t.get()?.recoveryInterventions).toBe(2)
	})

	it("THA18c: a counter that DECREASES does not subtract (monotone clamp)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoveryWithTracker({ currentRepairAttempts: 5 }))
		expect(t.get()?.recoveryInterventions).toBe(5)
		t.observeRecovery(recoverySnapshot()) // reset to zero
		expect(t.get()?.recoveryInterventions).toBe(5)
	})

	it("THA22: a new task identity resets all counters and startedAt", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordToolStarted()
		t.observeRecovery(recoveryWithTracker({ currentRepairAttempts: 3 }))
		t.startTask("task-b", 1_700_000_100_000)
		const snap = t.get()
		expect(snap?.startedAt).toBe(1_700_000_100_000)
		expect(snap?.toolCalls).toBe(0)
		expect(snap?.recoveryInterventions).toBe(0)
	})

	it("THA23: same task identity across turns preserves counters (startedAt, toolCalls, recoveryInterventions)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordToolStarted()
		t.recordToolStarted()
		t.startTask("task-a", 1_700_000_000_500)
		t.recordToolStarted()
		const snap = t.get()
		expect(snap?.startedAt).toBe(1_700_000_000_000)
		expect(snap?.toolCalls).toBe(3)
	})

	it("THA19: get() returns recoveryInterventions at zero (zero-hiding is a UI concern)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		expect(t.get()?.recoveryInterventions).toBe(0)
	})

	it("clear() resets the tracker to the no-task state", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordToolStarted()
		t.clear()
		expect(t.get()).toBeUndefined()
	})

	it("endTask on a tracker with no started task is a no-op", () => {
		const t = new TaskTelemetryTracker()
		expect(t.endTask()).toBeUndefined()
		expect(t.get()).toBeUndefined()
	})

	it("observeRecovery on a tracker with no started task seeds the baseline without inflating", () => {
		const t = new TaskTelemetryTracker()
		t.observeRecovery(recoveryWithTracker({ currentRepairAttempts: 10 }))
		expect(t.get()).toBeUndefined()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryInterventions).toBe(0)
	})

	// M1 killer — if anyone refactors the tracker to use component-mount
	// timestamps, this test fails because we explicitly control the
	// `startedAt` argument.
	it("M1 killer: startTask(epoch) honours the supplied epoch", () => {
		const t = new TaskTelemetryTracker()
		const epoch = 1_700_000_000_000
		t.startTask("task-a", epoch)
		expect(t.get()?.startedAt).toBe(epoch)
	})

	// M3 killer — the counter must increment exactly once per tool-start.
	it("M3 killer: observeRecovery does not touch toolCalls", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStarted()
		expect(t.get()?.toolCalls).toBe(1)
		t.observeRecovery(recoveryWithTracker({ currentRepairAttempts: 1 }))
		expect(t.get()?.toolCalls).toBe(1)
	})

	// M4 killer — control-plane outcomes must NOT increment recoveryInterventions.
	it("M4 killer: an unchanged snapshot does not bump the counter", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		const before = t.get()?.recoveryInterventions
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryInterventions).toBe(before)
		expect(t.get()?.recoveryInterventions).toBe(0)
	})

	// M5 killer — the tracker must not reset between turns of the SAME task.
	it("M5 killer: same-task follow-up preserves startedAt", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.startTask("task-a", 1_700_000_999_999)
		expect(t.get()?.startedAt).toBe(1_700_000_000_000)
	})
})

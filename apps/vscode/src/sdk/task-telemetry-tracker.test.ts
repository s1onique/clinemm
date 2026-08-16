/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: comprehensive tracker tests.
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01: terminal-freeze
 * and single-counter recovery tests added.
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
		expect(snap?.recoveryFailures).toBe(0)
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

	it("THA29: only episodeFailures positive deltas increment recoveryFailures", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(
			recoverySnapshot({
				episodeFailures: 1,
				circuitNoticeCount: 1,
				tracker: {
					state: "warning",
					currentRepairAttempts: 1,
					equivalentRepeatCount: 0,
					blockedExactKeys: [],
					blockedFamilies: [],
				},
			}),
		)
		expect(t.get()?.recoveryFailures).toBe(1)
	})

	it("THA30: a positive delta in currentRepairAttempts alone does NOT count", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(
			recoveryWithTracker({
				state: "warning",
				currentRepairAttempts: 1,
				equivalentRepeatCount: 0,
				blockedExactKeys: [],
				blockedFamilies: [],
			}),
		)
		expect(t.get()?.recoveryFailures).toBe(0)
	})

	it("THA31: a positive delta in circuitNoticeCount alone does NOT count", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(recoverySnapshot({ circuitNoticeCount: 1 }))
		expect(t.get()?.recoveryFailures).toBe(0)
	})

	it("THA32: episode reset (forward-decrease) does not subtract (monotone clamp)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot({ episodeFailures: 5 }))
		expect(t.get()?.recoveryFailures).toBe(5)
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryFailures).toBe(5)
		t.observeRecovery(recoverySnapshot({ episodeFailures: 1 }))
		expect(t.get()?.recoveryFailures).toBe(6)
	})

	it("THA33: control-plane outcomes do NOT increment recoveryFailures (no snapshot change)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryFailures).toBe(0)
	})

	it("THA34: multiple consecutive episodeFailures jumps accumulate", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(recoverySnapshot({ episodeFailures: 1 }))
		t.observeRecovery(recoverySnapshot({ episodeFailures: 2 }))
		t.observeRecovery(recoverySnapshot({ episodeFailures: 5 }))
		expect(t.get()?.recoveryFailures).toBe(5)
	})

	it("THA22: a new task identity resets all counters and startedAt", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordToolStarted()
		t.observeRecovery(recoverySnapshot({ episodeFailures: 3 }))
		t.startTask("task-b", 1_700_000_100_000)
		const snap = t.get()
		expect(snap?.startedAt).toBe(1_700_000_100_000)
		expect(snap?.toolCalls).toBe(0)
		expect(snap?.recoveryFailures).toBe(0)
	})

	it("THA23: same task identity across turns preserves counters (startedAt, toolCalls, recoveryFailures)", () => {
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

	it("THA19: get() returns recoveryFailures at zero (zero-hiding is a UI concern)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		expect(t.get()?.recoveryFailures).toBe(0)
	})

	// CORRECTION01: terminal-phase freeze.

	it("THA24: completed turn phase freezes the elapsed clock at the anchorTs", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.observeTurnPhase("streaming")
		t.observeTurnPhase("completed", 1_700_000_090_000)
		expect(t.get()?.endedAt).toBe(1_700_000_090_000)
	})

	it("THA25: error turn phase freezes the elapsed clock", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.observeTurnPhase("error", 1_700_000_120_000)
		expect(t.get()?.endedAt).toBe(1_700_000_120_000)
	})

	it("THA26: resumable turn phase freezes the elapsed clock", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.observeTurnPhase("resumable", 1_700_000_030_000)
		expect(t.get()?.endedAt).toBe(1_700_000_030_000)
	})

	it("THA27: terminal freeze is idempotent — first terminal call wins", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.observeTurnPhase("error", 1_700_000_010_000)
		t.observeTurnPhase("resumable", 1_700_000_020_000)
		t.observeTurnPhase("completed", 1_700_000_030_000)
		expect(t.get()?.endedAt).toBe(1_700_000_010_000)
	})

	it("THA28: terminal remount does NOT advance the elapsed clock", () => {
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		const terminalAt = 1_700_000_090_000
		t.startTask("task-a", startedAt)
		t.observeTurnPhase("completed", terminalAt)
		const remountAt = terminalAt + 3_600_000
		expect(t.get()?.endedAt).toBe(terminalAt)
		expect(remountAt - startedAt).toBeGreaterThan(3_500_000)
		expect((t.get()?.endedAt ?? 0) - startedAt).toBe(90_000)
	})

	it("THA28b: awaiting_followup does NOT freeze — same task continues", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.observeTurnPhase("streaming")
		t.observeTurnPhase("awaiting_followup", 1_700_000_030_000)
		expect(t.get()?.endedAt).toBeUndefined()
		t.observeTurnPhase("streaming", 1_700_000_045_000)
		expect(t.get()?.endedAt).toBeUndefined()
		t.observeTurnPhase("completed", 1_700_000_090_000)
		expect(t.get()?.endedAt).toBe(1_700_000_090_000)
	})

	it("THA28c: idle and streaming and awaiting_approval are not terminal — no freeze", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.observeTurnPhase("idle")
		t.observeTurnPhase("awaiting_approval")
		t.observeTurnPhase("streaming")
		expect(t.get()?.endedAt).toBeUndefined()
	})

	it("THA28d: observeTurnPhase with no started task is a no-op", () => {
		const t = new TaskTelemetryTracker()
		t.observeTurnPhase("completed", 1_700_000_000_000)
		expect(t.get()).toBeUndefined()
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
		t.observeRecovery(recoverySnapshot({ episodeFailures: 10 }))
		expect(t.get()).toBeUndefined()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryFailures).toBe(0)
	})

	it("M1 killer: startTask(epoch) honours the supplied epoch", () => {
		const t = new TaskTelemetryTracker()
		const epoch = 1_700_000_000_000
		t.startTask("task-a", epoch)
		expect(t.get()?.startedAt).toBe(epoch)
	})

	it("M3 killer: observeRecovery does not touch toolCalls", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStarted()
		expect(t.get()?.toolCalls).toBe(1)
		t.observeRecovery(recoverySnapshot({ episodeFailures: 1 }))
		expect(t.get()?.toolCalls).toBe(1)
	})

	it("M4 killer: an unchanged snapshot does not bump the counter", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		const before = t.get()?.recoveryFailures
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryFailures).toBe(before)
		expect(t.get()?.recoveryFailures).toBe(0)
	})

	it("M5 killer: same-task follow-up preserves startedAt", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.startTask("task-a", 1_700_000_999_999)
		expect(t.get()?.startedAt).toBe(1_700_000_000_000)
	})

	it("M6 killer (terminal remount): endedAt is the canonical timestamp, never remount-relative", () => {
		const t = new TaskTelemetryTracker()
		const start = 1_700_000_000_000
		const terminal = 1_700_000_060_000
		t.startTask("task-a", start)
		t.observeTurnPhase("completed", terminal)
		const snap = t.get()
		expect(snap?.endedAt).toBe(terminal)
		const frozen = snap?.endedAt
		const epoch = snap?.startedAt
		expect(frozen !== undefined && epoch !== undefined ? frozen - epoch : -1).toBe(60_000)
		t.observeTurnPhase("streaming")
		t.observeTurnPhase("completed", terminal + 9_999_999)
		expect(t.get()?.endedAt).toBe(terminal)
	})
})

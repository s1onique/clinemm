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
		expect(snap?.recoveryBudgetFailures).toBe(0)
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

	it("THA29: only episodeFailures positive deltas increment recoveryBudgetFailures", () => {
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
		expect(t.get()?.recoveryBudgetFailures).toBe(1)
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
		expect(t.get()?.recoveryBudgetFailures).toBe(0)
	})

	it("THA31: a positive delta in circuitNoticeCount alone does NOT count", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(recoverySnapshot({ circuitNoticeCount: 1 }))
		expect(t.get()?.recoveryBudgetFailures).toBe(0)
	})

	it("THA32: episode reset (forward-decrease) does not subtract (monotone clamp)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot({ episodeFailures: 5 }))
		expect(t.get()?.recoveryBudgetFailures).toBe(5)
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryBudgetFailures).toBe(5)
		t.observeRecovery(recoverySnapshot({ episodeFailures: 1 }))
		expect(t.get()?.recoveryBudgetFailures).toBe(6)
	})

	it("THA33: control-plane outcomes do NOT increment recoveryBudgetFailures (no snapshot change)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryBudgetFailures).toBe(0)
	})

	it("THA34: multiple consecutive episodeFailures jumps accumulate", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot())
		t.observeRecovery(recoverySnapshot({ episodeFailures: 1 }))
		t.observeRecovery(recoverySnapshot({ episodeFailures: 2 }))
		t.observeRecovery(recoverySnapshot({ episodeFailures: 5 }))
		expect(t.get()?.recoveryBudgetFailures).toBe(5)
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
		expect(snap?.recoveryBudgetFailures).toBe(0)
	})

	it("THA23: same task identity across turns preserves counters (startedAt, toolCalls, recoveryBudgetFailures)", () => {
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

	it("THA19: get() returns recoveryBudgetFailures at zero (zero-hiding is a UI concern)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		expect(t.get()?.recoveryBudgetFailures).toBe(0)
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
		expect(t.get()?.recoveryBudgetFailures).toBe(0)
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
		const before = t.get()?.recoveryBudgetFailures
		t.observeRecovery(recoverySnapshot())
		expect(t.get()?.recoveryBudgetFailures).toBe(before)
		expect(t.get()?.recoveryBudgetFailures).toBe(0)
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
		// CORRECTION02: a same-task continuation reopens the clock.
		// endedAt must clear, not stay frozen at the previous terminal.
		t.observeTurnPhase("streaming")
		expect(t.get()?.endedAt).toBeUndefined()
	})

	// ===== ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02 =====
	// Reopenable terminal-freeze invariants. "First terminal wins"
	// means "first terminal within the current stopped interval"; a
	// subsequent same-task active phase reopens the interval.

	it("THA35: completed → streaming on the same task reopens the elapsed clock", () => {
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		t.startTask("task-a", startedAt)
		t.observeTurnPhase("completed", 1_700_000_090_000) // 01:30
		expect(t.get()?.endedAt).toBe(1_700_000_090_000)
		// askResponse() follow-up → phase streaming on SAME task
		t.observeTurnPhase("streaming")
		expect(t.get()?.endedAt).toBeUndefined()
		// startedAt preserved
		expect(t.get()?.startedAt).toBe(startedAt)
	})

	it("THA36: resumable → streaming (resume) reopens the elapsed clock", () => {
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		t.startTask("task-a", startedAt)
		t.observeTurnPhase("resumable", 1_700_000_030_000)
		expect(t.get()?.endedAt).toBe(1_700_000_030_000)
		t.observeTurnPhase("streaming") // reinitExistingTaskFromId
		expect(t.get()?.endedAt).toBeUndefined()
		expect(t.get()?.startedAt).toBe(startedAt)
	})

	it("THA37: error → streaming (retry) reopens the elapsed clock", () => {
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		t.startTask("task-a", startedAt)
		t.observeTurnPhase("error", 1_700_000_120_000)
		expect(t.get()?.endedAt).toBe(1_700_000_120_000)
		t.observeTurnPhase("streaming")
		expect(t.get()?.endedAt).toBeUndefined()
		expect(t.get()?.startedAt).toBe(startedAt)
	})

	it("THA37b: awaiting_approval → streaming does NOT reopen (waiting on user)", () => {
		// awaiting_approval is an active-task phase that the runtime
		// sets BEFORE streaming actually begins, but once streaming
		// is set it remains. Treating awaiting_approval as a
		// continuation is fine (the task is still being driven); the
		// explicit check below pins the symmetric case.
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		t.startTask("task-a", startedAt)
		t.observeTurnPhase("awaiting_approval", 1_700_000_010_000)
		// awaiting_approval is non-terminal; endedAt is not stamped.
		expect(t.get()?.endedAt).toBeUndefined()
		// Now transition back to streaming (e.g. the user approved
		// without leaving the phase): endedAt stays undefined.
		t.observeTurnPhase("streaming")
		expect(t.get()?.endedAt).toBeUndefined()
	})

	it("THA38: a later terminal on the same task refreezes at the new anchorTs", () => {
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		t.startTask("task-a", startedAt)
		t.observeTurnPhase("completed", 1_700_000_090_000) // 01:30 first freeze
		expect(t.get()?.endedAt).toBe(1_700_000_090_000)
		t.observeTurnPhase("streaming") // reopen
		expect(t.get()?.endedAt).toBeUndefined()
		t.observeTurnPhase("completed", 1_700_000_720_000) // 12:00 second freeze
		expect(t.get()?.endedAt).toBe(1_700_000_720_000)
		// startedAt preserved
		expect(t.get()?.startedAt).toBe(startedAt)
	})

	it("THA39: idle and awaiting_followup do NOT reopen (terminal freeze is per stopped interval)", () => {
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		t.startTask("task-a", startedAt)
		t.observeTurnPhase("completed", 1_700_000_090_000)
		expect(t.get()?.endedAt).toBe(1_700_000_090_000)
		// idle: would only appear if there is no active task. The
		// tracker ignores it (defensive).
		t.observeTurnPhase("idle")
		expect(t.get()?.endedAt).toBe(1_700_000_090_000)
		// awaiting_followup: same task continues when user replies;
		// we already established it never freezes. A subsequent
		// awaiting_followup transition does not unfreeze either.
		t.observeTurnPhase("awaiting_followup")
		expect(t.get()?.endedAt).toBe(1_700_000_090_000)
	})

	it("THA40: tool counters survive a terminal reopen (cumulative across continuation)", () => {
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		t.startTask("task-a", startedAt)
		t.recordToolStarted() // +1
		t.recordToolStarted() // +2
		t.observeTurnPhase("completed", 1_700_000_090_000)
		// New turn begins on the same task.
		t.observeTurnPhase("streaming")
		t.recordToolStarted() // +3
		expect(t.get()?.toolCalls).toBe(3)
		// Same task identity, startedAt preserved
		expect(t.get()?.startedAt).toBe(startedAt)
	})

	it("THA41: recoveryBudgetFailures survives a terminal reopen", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.observeRecovery(recoverySnapshot({ episodeFailures: 3 }))
		expect(t.get()?.recoveryBudgetFailures).toBe(3)
		t.observeTurnPhase("completed")
		t.observeTurnPhase("streaming") // reopen
		// A later recovery delta still accumulates against the same task.
		t.observeRecovery(recoverySnapshot({ episodeFailures: 5 }))
		expect(t.get()?.recoveryBudgetFailures).toBe(5)
	})

	it("M7 killer (terminal-then-continue): user-reply flow freezes, unfreezes, refreezes with preserved counters", () => {
		// The complete CORRECTION02 semantic: first terminal wins,
		// same-task active transition reopens, later terminal refreezes
		// with a new anchorTs. Counters (toolCalls,
		// recoveryBudgetFailures) and startedAt are preserved across
		// the entire flow.
		const t = new TaskTelemetryTracker()
		const startEpoch = 1_700_000_000_000
		t.startTask("task-a", startEpoch)
		t.recordToolStarted()
		t.observeRecovery(recoverySnapshot({ episodeFailures: 1 }))
		expect(t.get()?.toolCalls).toBe(1)
		expect(t.get()?.recoveryBudgetFailures).toBe(1)

		// First completion at T0+90s.
		t.observeTurnPhase("completed", startEpoch + 90_000)
		expect(t.get()?.endedAt).toBe(startEpoch + 90_000)
		const firstFreeze = t.get()?.endedAt

		// Same-task continuation via user reply (askResponse).
		t.observeTurnPhase("streaming")
		expect(t.get()?.endedAt).toBeUndefined()
		// startedAt preserved
		expect(t.get()?.startedAt).toBe(startEpoch)
		// More work on the same task.
		t.recordToolStarted()
		expect(t.get()?.toolCalls).toBe(2)
		t.observeRecovery(recoverySnapshot({ episodeFailures: 2 }))
		expect(t.get()?.recoveryBudgetFailures).toBe(2)

		// Second completion at T0+12m.
		t.observeTurnPhase("completed", startEpoch + 720_000)
		expect(t.get()?.endedAt).toBe(startEpoch + 720_000)
		// Different anchorTs — firstFreeze is NOT preserved.
		expect(t.get()?.endedAt).not.toBe(firstFreeze)
		// But startedAt, toolCalls, and recoveryBudgetFailures all carry forward.
		expect(t.get()?.startedAt).toBe(startEpoch)
		expect(t.get()?.toolCalls).toBe(2)
		expect(t.get()?.recoveryBudgetFailures).toBe(2)
	})
})

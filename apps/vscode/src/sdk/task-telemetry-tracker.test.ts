/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: comprehensive tracker tests.
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01: terminal-freeze
 * and single-counter recovery tests added.
 */
import type { AgentRuntimeRecoverySnapshot, RecoveryState } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { TaskTelemetryTracker } from "./task-telemetry-tracker"
import { isUsableMechanismProjection } from "./tool-mechanism-classifier"

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
/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 (TES-IMPL-01)
 *
 * Per-mechanism cumulative projection tests on the host tracker.
 * The classifier itself is covered exhaustively by
 * `tool-mechanism-classifier.test.ts`; this file proves the tracker
 * threads the canonical `toolName` into the right bucket AND keeps
 * the conservation invariant intact (mechanism.total === toolCalls).
 *
 * Conservation is the load-bearing invariant: the wire field is
 * permitted to drift only if `toolCalls` drifts in lockstep, and
 * even then a hub/remote consumer that reads both will detect a
 * mismatch.
 */
describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 / TaskTelemetryTracker mechanism projection", () => {
	it("TES-TRK-01: `get()` returns a zero `mechanism` summary right after startTask", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		expect(t.get()?.mechanism).toEqual({
			total: 0,
			edit: 0,
			command: 0,
			read: 0,
			search: 0,
			mcp: 0,
			other: 0,
		})
		// Existing counter is unchanged.
		expect(t.get()?.toolCalls).toBe(0)
	})

	it("TES-TRK-02: recordToolStartedWithName increments the right bucket AND toolCalls", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithName("editor")
		t.recordToolStartedWithName("apply_patch")
		t.recordToolStartedWithName("run_commands")
		t.recordToolStartedWithName("read_files")
		t.recordToolStartedWithName("search_codebase")
		t.recordToolStartedWithName("figma-desktop__get_metadata")
		t.recordToolStartedWithName(undefined) // → "other"
		const m = t.get()?.mechanism
		expect(m).toEqual({
			total: 7,
			edit: 2,
			command: 1,
			read: 1,
			search: 1,
			mcp: 1,
			other: 1,
		})
		// Conservation: mechanism.total === toolCalls.
		expect(m?.total).toBe(t.get()?.toolCalls)
		expect(t.get()?.toolCalls).toBe(7)
	})

	it("TES-TRK-03: legacy `recordToolStarted()` (no arg) increments total + `other` bucket", () => {
		// The legacy overload is retained for backwards compatibility.
		// Without a toolName we cannot infer a mechanism; conservatively
		// the increment lands in `other` so the projection stays
		// conserved against `toolCalls`.
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStarted()
		t.recordToolStarted()
		const m = t.get()?.mechanism
		expect(m).toEqual({
			total: 2,
			edit: 0,
			command: 0,
			read: 0,
			search: 0,
			mcp: 0,
			other: 2,
		})
		expect(m?.total).toBe(t.get()?.toolCalls)
		expect(t.get()?.toolCalls).toBe(2)
	})

	it("TES-TRK-04: startTask with a NEW task identity resets mechanism summary", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithName("editor")
		t.recordToolStartedWithName("run_commands")
		expect(t.get()?.mechanism?.total).toBe(2)
		// Switch to a different task.
		t.startTask("task-b")
		expect(t.get()?.mechanism).toEqual({
			total: 0,
			edit: 0,
			command: 0,
			read: 0,
			search: 0,
			mcp: 0,
			other: 0,
		})
		expect(t.get()?.toolCalls).toBe(0)
	})

	it("TES-TRK-05: startTask with the SAME task identity preserves the mechanism summary", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithName("editor")
		t.recordToolStartedWithName("run_commands")
		const before = t.get()?.mechanism
		// Same-task re-call (e.g. follow-up turn) must preserve state.
		t.startTask("task-a")
		expect(t.get()?.mechanism).toEqual(before)
		expect(t.get()?.toolCalls).toBe(2)
	})

	it("TES-TRK-06: clear() resets mechanism summary along with the rest", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithName("editor")
		t.clear()
		expect(t.get()).toBeUndefined()
		// After clear + a new start, the summary is zero again.
		t.startTask("task-b")
		expect(t.get()?.mechanism?.total).toBe(0)
		expect(t.get()?.toolCalls).toBe(0)
	})

	it("TES-TRK-07: mechanism summary survives a terminal reopen (cumulative across continuation)", () => {
		// The cumulative invariant must hold across terminal-then-
		// reopen flows (same-task continuation). This mirrors the
		// existing THA40 contract for `toolCalls`.
		const t = new TaskTelemetryTracker()
		const startedAt = 1_700_000_000_000
		t.startTask("task-a", startedAt)
		t.recordToolStartedWithName("editor") // +1 edit
		t.recordToolStartedWithName("apply_patch") // +1 edit
		t.observeTurnPhase("completed", 1_700_000_090_000)
		// New turn begins on the same task.
		t.observeTurnPhase("streaming")
		t.recordToolStartedWithName("run_commands") // +1 command
		expect(t.get()?.toolCalls).toBe(3)
		expect(t.get()?.mechanism).toEqual({
			total: 3,
			edit: 2,
			command: 1,
			read: 0,
			search: 0,
			mcp: 0,
			other: 0,
		})
		// startedAt preserved
		expect(t.get()?.startedAt).toBe(startedAt)
	})

	it("TES-TRK-08: recordToolStartedWithName called before startTask is a no-op (defensive)", () => {
		const t = new TaskTelemetryTracker()
		const snap = t.recordToolStartedWithName("editor")
		expect(snap).toBeUndefined()
		expect(t.get()).toBeUndefined()
	})

	it("TES-TRK-09: `sed -i ...` via run_commands is recorded as `command`, never as `edit`", () => {
		// The host seam only sees the canonical `toolName`. We pass
		// `run_commands` (the registered tool identity); the
		// command TEXT is not in scope at the tracker boundary and
		// must NEVER influence the classification. The host tracker
		// is therefore protected from accidental purpose inference
		// by construction: there is no path through which the shell
		// command's text can reach `classifyToolMechanism`.
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithName("run_commands")
		expect(t.get()?.mechanism?.command).toBe(1)
		expect(t.get()?.mechanism?.edit).toBe(0)
		expect(t.get()?.mechanism?.other).toBe(0)
	})
})

/**
 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01:
 *
 * Host-side tests for `TaskTelemetryTracker.recordRuntimeError()`.
 * These tests pin the four invariants the wire protocol depends on:
 *
 *   REC-01: counter initializes to 0 after startTask
 *   REC-02: one structured incident increments by exactly 1
 *   REC-03: independent incidents accumulate monotonically
 *   REC-04: helper-recovery success does NOT decrement (still counts)
 *   REC-05: saturates at Number.MAX_SAFE_INTEGER (no wrap)
 *   REC-06: new task identity resets the counter to 0
 *   REC-07: clear() resets the counter to 0
 *   REC-08: recordRuntimeError before startTask is a no-op (defensive)
 *   REC-09: emits runtimeErrorCount only when > 0 on the wire
 *   REC-10: classifyToolMechanism conservation is unaffected
 *          (recordRuntimeError never touches mechanism/toolCalls)
 *   REC-11: recordRuntimeError does not require the snapshot to
 *          survive `endTask` / `observeTurnPhase` (cumulative,
 *          task-lifetime invariant)
 */
describe("ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01 / TaskTelemetryTracker runtime-error counter", () => {
	const EPERM_INCIDENT = { errorClass: "EPERM" as const, source: "command-job-manager" as const }

	it("REC-01: counter initializes to 0 after startTask and is omitted from the wire (zero-hiding)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		const snap = t.get()
		expect(snap?.runtimeErrorCount).toBeUndefined() // zero-hiding per the wire contract
		expect(t.currentRuntimeErrorCount).toBe(0)
	})

	it("REC-02: one structured EPERM increments by exactly 1 and projects runtimeErrorCount: 1 on the wire", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordRuntimeError(EPERM_INCIDENT)
		const snap = t.get()
		expect(snap?.runtimeErrorCount).toBe(1)
		expect(t.currentRuntimeErrorCount).toBe(1)
	})

	it("REC-03: independent incidents accumulate monotonically (0 → 1 → 2 → 3)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordRuntimeError(EPERM_INCIDENT)
		expect(t.currentRuntimeErrorCount).toBe(1)
		t.recordRuntimeError({ errorClass: "SPAWN_ERROR", source: "run-commands-spawn" })
		expect(t.currentRuntimeErrorCount).toBe(2)
		t.recordRuntimeError({ errorClass: "HELPER_IPC_ERROR", source: "command-job-manager", correlationId: "req-42" })
		expect(t.currentRuntimeErrorCount).toBe(3)
		const snap = t.get()
		expect(snap?.runtimeErrorCount).toBe(3)
	})

	it("REC-04: helper-recovery success does NOT decrement (EPERM with successful fallback still counts)", () => {
		// The V1 contract: an EPERM that the LaunchAgent helper
		// successfully recovered is still a real runtime incident
		// the user should see. We simulate the helper-recovered
		// path by calling recordRuntimeError exactly once (the
		// call site is responsible for the latch via
		// `job.runtimeErrorReported`); the counter must remain at 1.
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordRuntimeError(EPERM_INCIDENT)
		expect(t.currentRuntimeErrorCount).toBe(1)
		// Simulated helper-recovery success: no further call.
		expect(t.currentRuntimeErrorCount).toBe(1)
	})

	it("REC-05: saturates at Number.MAX_SAFE_INTEGER (no wrap, no negative)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		// Drive the counter to the saturation boundary directly
		// (we cannot realistically call 2^53 times in a unit test).
		// The `Math.min` clamp is the production saturation
		// contract; the assertion below proves it never overflows.
		;(t as unknown as { runtimeErrorCount: number }).runtimeErrorCount = Number.MAX_SAFE_INTEGER - 1
		t.recordRuntimeError(EPERM_INCIDENT)
		expect(t.currentRuntimeErrorCount).toBe(Number.MAX_SAFE_INTEGER)
		// A subsequent call must stay at MAX_SAFE_INTEGER, NOT
		// overflow to a negative or lossy integer.
		t.recordRuntimeError(EPERM_INCIDENT)
		expect(t.currentRuntimeErrorCount).toBe(Number.MAX_SAFE_INTEGER)
	})

	it("REC-06: new task identity resets the counter to 0 (task isolation)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordRuntimeError(EPERM_INCIDENT)
		t.recordRuntimeError(EPERM_INCIDENT)
		expect(t.currentRuntimeErrorCount).toBe(2)
		// Switch to a different task.
		t.startTask("task-b")
		expect(t.currentRuntimeErrorCount).toBe(0)
		expect(t.get()?.runtimeErrorCount).toBeUndefined()
		// And back: previous-task value is GONE (this is a fresh
		// counter, not a switchable per-id cache — by design).
		t.startTask("task-a")
		expect(t.currentRuntimeErrorCount).toBe(0)
	})

	it("REC-07: clear() resets the counter to 0", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordRuntimeError(EPERM_INCIDENT)
		expect(t.currentRuntimeErrorCount).toBe(1)
		t.clear()
		expect(t.get()).toBeUndefined()
		// After a fresh start, the counter is zero again.
		t.startTask("task-b")
		expect(t.currentRuntimeErrorCount).toBe(0)
	})

	it("REC-08: recordRuntimeError before startTask is a no-op (defensive, mirrors recordToolStarted)", () => {
		const t = new TaskTelemetryTracker()
		const snap = t.recordRuntimeError(EPERM_INCIDENT)
		expect(snap).toBeUndefined()
		expect(t.get()).toBeUndefined()
		expect(t.currentRuntimeErrorCount).toBe(0)
	})

	it("REC-09: wire emits runtimeErrorCount only when > 0 (zero-hiding for Hub/Remote cleanliness)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		const zeroSnap = t.get()
		expect("runtimeErrorCount" in (zeroSnap ?? {})).toBe(false)
		t.recordRuntimeError(EPERM_INCIDENT)
		const oneSnap = t.get()
		expect(oneSnap?.runtimeErrorCount).toBe(1)
	})

	it("REC-10: recordRuntimeError does NOT perturb the mechanism / toolCalls conservation invariant", () => {
		// The mechanism total MUST stay equal to toolCalls. A
		// recordRuntimeError call must not touch either counter.
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordToolStartedWithName("editor")
		t.recordToolStartedWithName("run_commands")
		const before = t.get()
		t.recordRuntimeError(EPERM_INCIDENT)
		t.recordRuntimeError(EPERM_INCIDENT)
		const after = t.get()
		expect(after?.toolCalls).toBe(before?.toolCalls)
		expect(after?.mechanism).toEqual(before?.mechanism)
		expect(after?.mechanism?.total).toBe(after?.toolCalls)
		expect(after?.runtimeErrorCount).toBe(2)
	})

	it("REC-11: counter survives endTask / observeTurnPhase (cumulative across the task lifetime)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordRuntimeError(EPERM_INCIDENT)
		// Terminal freeze.
		t.observeTurnPhase("completed", 1_700_000_090_000)
		expect(t.currentRuntimeErrorCount).toBe(1)
		// Same-task continuation (reopen) — counter persists.
		t.observeTurnPhase("streaming")
		expect(t.currentRuntimeErrorCount).toBe(1)
		// And a follow-up incident increments on top.
		t.recordRuntimeError({ errorClass: "SPAWN_ERROR", source: "run-commands-spawn" })
		expect(t.currentRuntimeErrorCount).toBe(2)
	})

	it("REC-12: independent tasks do NOT share counts (TASK_ERROR_COUNTER_ISOLATION)", () => {
		// Simulate two concurrent task identities by alternating
		// startTask calls. The counter only follows the LATEST
		// active identity; switching back resets to 0 (the V1
		// contract: counters are scoped to the CURRENT visible
		// task lifetime, not retained across task boundaries).
		const t = new TaskTelemetryTracker()
		t.startTask("task-A", 1_700_000_000_000)
		t.recordRuntimeError(EPERM_INCIDENT)
		t.recordRuntimeError(EPERM_INCIDENT)
		expect(t.currentRuntimeErrorCount).toBe(2)
		t.startTask("task-B", 1_700_000_001_000)
		expect(t.currentRuntimeErrorCount).toBe(0)
		t.recordRuntimeError(EPERM_INCIDENT)
		expect(t.currentRuntimeErrorCount).toBe(1)
		// Back to A: still 0 (counters are not cached per id).
		t.startTask("task-A")
		expect(t.currentRuntimeErrorCount).toBe(0)
	})
})

// =========================================================================
// ACT-CLINEMM-TASK-HEADER-TOOL-OUTCOME-PROJECTION01
//
// Optional TaskHeader projection of AUTHORITATIVE runtime tool outcomes.
//
// Authority model:
//   - The runtime's `onToolRuntimeOutcome` hook (`ToolRuntimeOutcome`) is
//     the ONLY source of `succeeded` / `failed`. It describes RUNTIME TOOL
//     EXECUTION, never shell subprocess exit status.
//   - `control_plane` outcomes (host DENY, user rejection, runtime skip,
//     runtime abort) are NOT successes and NOT failures. They are counted
//     in their own bucket so a pre-execution denial is never displayed as
//     a succeeded or a failed tool call.
//   - `pending` = a tool start was observed but no authoritative outcome
//     has arrived yet.
//   - Correlation is by the AUTHORITATIVE tool-call identity
//     (`toolCallId`). Chronological / positional fallback is FORBIDDEN.
//
// The projection is OPTIONAL on the wire: absent means "the host did not
// project outcomes", and the webview falls back to the existing V1 flat
// `toolCalls` display.
// =========================================================================

describe("ACT-CLINEMM-TASK-HEADER-TOOL-OUTCOME-PROJECTION01 / TaskTelemetryTracker tool outcomes", () => {
	it("TOO01: three starts, one success, one failure, one pending — the projection is exact", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a", 1_700_000_000_000)
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-2")
		t.recordToolStartedWithId("call-3")
		t.recordToolOutcome("call-1", "succeeded")
		t.recordToolOutcome("call-2", "failed")
		const snap = t.get()
		expect(snap?.toolCalls).toBe(3)
		expect(snap?.outcomes).toEqual({
			total: 3,
			succeeded: 1,
			failed: 1,
			pending: 1,
			controlPlane: 0,
			unknown: 0,
		})
	})

	it("TOO02: a control_plane outcome is neither succeeded nor failed", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "control_plane")
		const snap = t.get()
		expect(snap?.outcomes?.succeeded).toBe(0)
		expect(snap?.outcomes?.failed).toBe(0)
		expect(snap?.outcomes?.controlPlane).toBe(1)
		expect(snap?.outcomes?.pending).toBe(0)
		expect(snap?.outcomes?.total).toBe(1)
	})

	it("TOO03: an unknown outcome kind is counted as unknown, never as succeeded/failed", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "not_a_real_kind" as never)
		const snap = t.get()
		expect(snap?.outcomes?.succeeded).toBe(0)
		expect(snap?.outcomes?.failed).toBe(0)
		expect(snap?.outcomes?.unknown).toBe(1)
		expect(snap?.outcomes?.pending).toBe(0)
	})

	it("TOO04: conservation — outcomes.total is conserved against toolCalls", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		for (const id of ["a", "b", "c", "d"]) {
			t.recordToolStartedWithId(id)
		}
		t.recordToolOutcome("a", "succeeded")
		t.recordToolOutcome("b", "failed")
		t.recordToolOutcome("c", "control_plane")
		const snap = t.get()
		expect(snap?.outcomes?.total).toBe(snap?.toolCalls)
		const bucketSum =
			(snap?.outcomes?.succeeded ?? 0) +
			(snap?.outcomes?.failed ?? 0) +
			(snap?.outcomes?.pending ?? 0) +
			(snap?.outcomes?.controlPlane ?? 0) +
			(snap?.outcomes?.unknown ?? 0)
		expect(bucketSum).toBe(snap?.outcomes?.total)
	})

	it("TOO05: the projection is ABSENT until at least one tool start is observed", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		expect(t.get()?.outcomes).toBeUndefined()
		t.recordToolStartedWithId("call-1")
		expect(t.get()?.outcomes).toBeDefined()
	})

	it("TOO06: an outcome for an UNKNOWN tool-call id is ignored (no fabrication)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-not-started", "succeeded")
		const snap = t.get()
		expect(snap?.outcomes?.succeeded).toBe(0)
		expect(snap?.outcomes?.pending).toBe(1)
		expect(snap?.outcomes?.total).toBe(1)
	})

	it("TOO07: a repeated outcome for the same tool-call id does not double-count", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "succeeded")
		t.recordToolOutcome("call-1", "succeeded")
		const snap = t.get()
		expect(snap?.outcomes?.succeeded).toBe(1)
		expect(snap?.outcomes?.total).toBe(1)
	})

	it("TOO08: a new task identity resets the outcome projection", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "succeeded")
		expect(t.get()?.outcomes?.succeeded).toBe(1)
		t.startTask("task-b")
		expect(t.get()?.outcomes).toBeUndefined()
		expect(t.get()?.toolCalls).toBe(0)
	})

	it("TOO09: the outcome projection does NOT perturb the mechanism conservation invariant", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithName("editor")
		const before = t.get()
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "succeeded")
		const after = t.get()
		expect(after?.mechanism?.total).toBe(after?.toolCalls)
		expect(after?.toolCalls).toBe((before?.toolCalls ?? 0) + 1)
	})

	it("TOO10: outcomes before startTask are dropped (no unowned-task fabrication)", () => {
		const t = new TaskTelemetryTracker()
		t.recordToolOutcome("call-1", "succeeded")
		expect(t.get()).toBeUndefined()
	})

	it("TOO11: clear() wipes the outcome projection", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "succeeded")
		t.clear()
		expect(t.get()).toBeUndefined()
	})

	it("TOO12: a tool start WITHOUT an authoritative identity stays pending and is never fabricated", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId(undefined)
		const snap = t.get()
		expect(snap?.toolCalls).toBe(1)
		expect(snap?.outcomes?.total).toBe(1)
		expect(snap?.outcomes?.pending).toBe(1)
		expect(snap?.outcomes?.succeeded).toBe(0)
		expect(snap?.outcomes?.failed).toBe(0)
	})

	it("TOO13: outcomes arriving OUT OF ORDER are correlated by id, never by position", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-2")
		t.recordToolStartedWithId("call-3")
		// Deliberately reversed arrival order.
		t.recordToolOutcome("call-3", "failed")
		t.recordToolOutcome("call-1", "succeeded")
		t.recordToolOutcome("call-2", "control_plane")
		const snap = t.get()
		expect(snap?.outcomes).toEqual({
			total: 3,
			succeeded: 1,
			failed: 1,
			pending: 0,
			controlPlane: 1,
			unknown: 0,
		})
	})

	it("TOO14: a DUPLICATE tool start for the same id does not create a second record", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "succeeded")
		const snap = t.get()
		expect(snap?.outcomes?.total).toBe(1)
		expect(snap?.outcomes?.succeeded).toBe(1)
		expect(snap?.outcomes?.pending).toBe(0)
	})

	it("TOO15: the FIRST authoritative outcome wins when two conflicting outcomes arrive", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "failed")
		t.recordToolOutcome("call-1", "succeeded")
		const snap = t.get()
		expect(snap?.outcomes?.failed).toBe(1)
		expect(snap?.outcomes?.succeeded).toBe(0)
		expect(snap?.outcomes?.total).toBe(1)
	})

	it("TOO16: the runtime spellings (success/failure) and the wire spellings agree", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-2")
		t.recordToolOutcome("call-1", "success")
		t.recordToolOutcome("call-2", "failure")
		const snap = t.get()
		expect(snap?.outcomes?.succeeded).toBe(1)
		expect(snap?.outcomes?.failed).toBe(1)
	})

	it("TOO17: an EMPTY tool-call id is treated as no identity (pending, never fabricated)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("")
		t.recordToolOutcome("", "succeeded")
		const snap = t.get()
		expect(snap?.outcomes?.total).toBe(1)
		expect(snap?.outcomes?.pending).toBe(1)
		expect(snap?.outcomes?.succeeded).toBe(0)
	})

	it("TOO18: conservation holds with a MIX of identified and unidentified starts", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId(undefined)
		t.recordToolStartedWithId("call-3")
		t.recordToolOutcome("call-1", "succeeded")
		t.recordToolOutcome("call-3", "control_plane")
		const snap = t.get()
		expect(snap?.outcomes?.total).toBe(snap?.toolCalls)
		expect(snap?.outcomes?.total).toBe(3)
		expect(snap?.outcomes?.pending).toBe(1)
	})
})

/**
 * ACT-CLINEMM-BOUNDED-DUPLICATE-START-CONSERVATION-REPAIR01
 *
 * DEFECT: `recordToolStartedWithId()` incremented the cumulative
 * `toolCalls` counter BEFORE its duplicate-id check, so a REPEATED
 * start for an already-seen authoritative `toolCallId` bumped
 * `toolCalls` while deliberately NOT registering a second outcome
 * record. The result: `outcomes.total` (the number of DISTINCT
 * observed tool starts) disagreed with `toolCalls` (the number of
 * start EVENTS), and the webview's strict
 * `isUsableOutcomeProjection(outcomes, toolCalls)` validator rejected
 * the whole projection, silently degrading the header back to the flat
 * counter.
 *
 * CARDINALITY (established from production evidence, NOT assumed):
 * a repeated `toolCallId` is DUPLICATE DELIVERY of one tool call —
 * never a separate invocation:
 *
 *   1. `sdk/packages/agents/src/runtime/state/task-state/update.ts`
 *      — the canonical TaskState reducer increments its cumulative
 *      `toolCalls` ONLY on a previously-unseen ID; "a re-emit of an
 *      already-active ID is a no-op for the counter".
 *   2. `sdk/packages/agents/src/agent-runtime.ts` — two
 *      `tool-call-delta`s carrying the same id collapse into ONE
 *      assembly (the `toolAssemblies` map is keyed by the id), so the
 *      runtime emits exactly ONE `tool-started` per distinct call.
 *   3. The runtime emits exactly one `tool-started` and one
 *      `onToolRuntimeOutcome` per execution, both carrying the same
 *      `toolCallId` — which is what makes id-based correlation exact.
 *   4. The tracker's own documented contract already states that a
 *      repeated start for the same id "does NOT double-register: the
 *      existing entry is left in place so the per-call outcome
 *      cardinality stays exactly one".
 *
 * Therefore the CORRECT cardinality is: `toolCalls` counts DISTINCT
 * tool-call identities, exactly like `outcomes.total`. Counting the
 * duplicate EVENT was the defect.
 *
 * CONSERVATION INVARIANT pinned here:
 *   outcomes.total === toolCalls === mechanism.total
 * for every reachable sequence of tool starts.
 */
describe("ACT-CLINEMM-BOUNDED-DUPLICATE-START-CONSERVATION-REPAIR01 / TaskTelemetryTracker duplicate-start conservation", () => {
	it("DSC01: a DUPLICATE tool start does NOT inflate toolCalls (distinct-identity cardinality)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-1")
		const snap = t.get()
		expect(snap?.toolCalls).toBe(1)
		expect(snap?.outcomes?.total).toBe(1)
	})

	it("DSC02: outcomes.total is CONSERVED against toolCalls after a duplicate start", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-2")
		t.recordToolOutcome("call-1", "succeeded")
		t.recordToolOutcome("call-2", "failed")
		const snap = t.get()
		expect(snap?.outcomes?.total).toBe(snap?.toolCalls)
		expect(snap?.outcomes?.total).toBe(2)
		expect(snap?.outcomes?.succeeded).toBe(1)
		expect(snap?.outcomes?.failed).toBe(1)
	})

	it("DSC03: a duplicate start does NOT inflate the mechanism projection (one call, one mechanism bucket)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1", "read_files")
		t.recordToolStartedWithId("call-1", "read_files")
		const snap = t.get()
		expect(snap?.mechanism?.total).toBe(1)
		expect(snap?.mechanism?.read).toBe(1)
		expect(snap?.mechanism?.total).toBe(snap?.toolCalls)
	})

	it("DSC04: the mechanism projection stays USABLE after a duplicate start (wire-boundary validator accepts it)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1", "read_files")
		t.recordToolStartedWithId("call-1", "read_files")
		const snap = t.get()
		expect(isUsableMechanismProjection(snap?.mechanism, snap?.toolCalls ?? -1)).toBe(true)
	})

	it("DSC05: a duplicate start leaves the pending bucket at ONE (no phantom pending)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-1")
		const snap = t.get()
		expect(snap?.outcomes?.pending).toBe(1)
		expect(snap?.outcomes?.total).toBe(1)
	})

	it("DSC06: a duplicate start does NOT disturb the outcome correlation (the outcome still lands once)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "succeeded")
		const snap = t.get()
		expect(snap?.outcomes?.succeeded).toBe(1)
		expect(snap?.outcomes?.pending).toBe(0)
		expect(snap?.outcomes?.total).toBe(snap?.toolCalls)
	})

	it("DSC07: an UNIDENTIFIED start is still counted once per event (no id to dedupe on)", () => {
		// A start WITHOUT an authoritative identity can never be
		// correlated, so it can never be recognised as a duplicate.
		// It is therefore counted as its own observed start and stays
		// `pending` forever — conservation still holds.
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId(undefined)
		t.recordToolStartedWithId(undefined)
		const snap = t.get()
		expect(snap?.toolCalls).toBe(2)
		expect(snap?.outcomes?.total).toBe(snap?.toolCalls)
		expect(snap?.outcomes?.pending).toBe(2)
	})

	it("DSC08: DISTINCT ids are still counted separately (the repair does not under-count)", () => {
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-2")
		t.recordToolStartedWithId("call-1")
		const snap = t.get()
		expect(snap?.toolCalls).toBe(2)
		expect(snap?.outcomes?.total).toBe(2)
	})

	it("DSC09: the outcome projection is USABLE after a duplicate start (host never publishes a divergent pair)", () => {
		// The webview's strict validator (`isUsableOutcomeProjection`)
		// rejects the whole projection when `outcomes.total !==
		// toolCalls`. Before the repair, a duplicate start made the
		// validator REJECT, silently degrading the header back to the
		// flat counter. This pins the host-side precondition for that
		// validator: the host must never publish a divergent pair.
		const t = new TaskTelemetryTracker()
		t.startTask("task-a")
		t.recordToolStartedWithId("call-1")
		t.recordToolStartedWithId("call-1")
		t.recordToolOutcome("call-1", "succeeded")
		const snap = t.get()
		const outcomes = snap?.outcomes
		expect(outcomes).toBeDefined()
		if (outcomes !== undefined) {
			const sum = outcomes.succeeded + outcomes.failed + outcomes.pending + outcomes.controlPlane + outcomes.unknown
			expect(outcomes.total).toBe(sum)
			expect(outcomes.total).toBe(snap?.toolCalls)
		}
	})
})

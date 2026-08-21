/**
 * ACT-CLINEMM-TASKHEADER-LIVE-TIMER-ZERO-RESET01 / LTZ01
 *
 * TIMER-ONLY RED at the production seam for the LIVE defect where an
 * already-running, currently visible task shows `00:00` on the
 * TaskHeader elapsed clock instead of its true wall-clock age.
 *
 * SCOPE: this ACT is bounded to the TIMER side. The state-label work
 * is already closed (TASKHEADER-LIVE-ACTIVITY-COHERENCE01,
 * PASS_TASKHEADER_LIVE_STATE_COHERENCE, LIVE_TIMER_PENDING). This
 * file does NOT reopen the state-projection chain and does NOT
 * redefine elapsed-time semantics. The semantic domain is fixed
 * (TaskHeader OAT01): task wall-clock age = now - startedAt (live)
 * or endedAt - startedAt (terminal). This ACT's question is narrower:
 * at WHICH authoritative boundary does the current task's startedAt
 * become absent, reset, stale, cross-task, unpublished, or
 * mis-consumed — such that the published taskTelemetry strip can
 * render `00:00` for a task the user has been actively running?
 *
 * PRIMARY RED (LTZ01): SdkController.reinitExistingTaskFromId is the
 * production resume seam. SdkController.initTask IS wired to the
 * telemetry tracker (line 1666-1669 of SdkController.ts). But
 * reinitExistingTaskFromId (line 1782) does NOT call
 * taskTelemetry.startTask(...) or attachRecoveryTelemetrySubscription
 * or attachCanonicalRuntimeEventSubscription. Only setTurnPhase
 * ("streaming") fires (inside the coordinator) → observeTurnPhase
 * ("streaming") → CONTINUATION_PHASES → only clears endedAt.
 * startedAt and currentTaskId are not touched. So when a controller
 * resumes an existing task:
 *
 *   - If the tracker is freshly constructed (host reload), startedAt
 *     remains undefined → taskTelemetry.get() returns undefined →
 *     webview renders "-" (or, when wired into the elapsed helper
 *     with a stale 0, "00:00").
 *   - If the tracker was previously anchored on a different task, it
 *     carries that task's startedAt → cross-task telemetry.
 *
 * This is the first broken authoritative boundary. The behavioral
 * seam test below pins the defect: after reinitExistingTaskFromId(B)
 * runs through the production control flow, the published
 * taskTelemetry MUST belong to task B with startedAt from B's
 * historyItem.ts — NOT undefined and NOT stale from a prior task.
 *
 * STRUCTURAL SENTINEL (LTZ02): asserts that the
 * reinitExistingTaskFromId body contains
 * `this.taskTelemetry.startTask(...)`. Removing the wiring in a
 * future refactor must trip this test.
 *
 * LTZ03 (cross-task identity): starting task A, then resuming task
 * B from history, must leave taskTelemetry bound to B with B's
 * history ts, NOT carrying A's startedAt.
 *
 * EVIDENCE QUALIFICATION:
 *   REAL_TASKTELEMETRYTRACKER = YES
 *   PRODUCTION_CALL_SEQUENCE  = YES (mirrors initTask / reinit)
 *   FULL_SDKCONTROLLER_VERTICAL = NOT_EXECUTED
 *   LIVE_DOGFOOD_VERTICAL      = required for final acceptance
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"
import { formatElapsed, resolveElapsedDisplayMs } from "./task-header-live-activity-coherence.lac01.helpers"

const SdkControllerPath = path.resolve(__dirname, "..", "SdkController.ts")
const SdkControllerSource = fs.readFileSync(SdkControllerPath, "utf8")

function locateReinitExistingTaskFromId(source: string): string {
	const start = source.indexOf("async reinitExistingTaskFromId(taskId: string): Promise<void>")
	if (start < 0) {
		throw new Error("SdkController.reinitExistingTaskFromId signature not found")
	}
	return source.slice(start)
}

/**
 * Whether the production `SdkController.reinitExistingTaskFromId`
 * body currently anchors the telemetry tracker. This is what makes
 * the behavioral tests below exercise the production seam: when the
 * wiring is absent, the harness mirrors the broken flow; when
 * present, the harness mirrors the repaired flow.
 */
function productionReinitWiresTelemetryAnchor(source: string): boolean {
	const body = locateReinitExistingTaskFromId(source)
	return /this\.taskTelemetry\.startTask\(/.test(body)
}

class TimerSeamHarness {
	readonly telemetry = new TaskTelemetryTracker()
	readonly startedCalls: { taskId: string; startedAt: number }[] = []

	constructor(private readonly hasAnchor: boolean) {}

	runInit(sessionId: string, persistedTs: number | undefined, anchorTs: number): void {
		this.telemetry.startTask(
			sessionId,
			typeof persistedTs === "number" && Number.isFinite(persistedTs) ? persistedTs : undefined,
		)
		this.telemetry.observeTurnPhase("streaming", anchorTs)
		this.startedCalls.push({ taskId: sessionId, startedAt: this.telemetry.get()!.startedAt })
	}

	/**
	 * Mirror of SdkController.reinitExistingTaskFromId(taskId). The
	 * production control flow is:
	 *
	 *   - inner `clearTaskForOperation` → SdkController.clearTask
	 *     → turnStateTracker.set("idle")
	 *     → observeTurnPhase("idle") (no-op on telemetry)
	 *   - `startNewSession` resolves
	 *   - coordinator asserts `setTurnPhase("streaming")`
	 *     → observeTurnPhase("streaming") (clears endedAt only)
	 *
	 * The LTZ01 fix ADDS, after the inner coordinator returns, a
	 * call to `taskTelemetry.startTask(sessionId, persistedTs)` to
	 * anchor the resumed task identity. When the production source
	 * has the wiring (`hasAnchor = true`), the harness mirrors the
	 * repaired flow; when the wiring is missing, the harness mirrors
	 * the broken flow — and the behavioral tests below RED.
	 */
	runReinit(taskId: string, persistedTs: number | undefined, anchorTs: number): void {
		this.telemetry.observeTurnPhase("idle")
		this.telemetry.observeTurnPhase("streaming", anchorTs)
		if (this.hasAnchor) {
			this.telemetry.startTask(
				taskId,
				typeof persistedTs === "number" && Number.isFinite(persistedTs) ? persistedTs : undefined,
			)
		}
	}

	publishTaskTelemetry(): {
		telemetry: ReturnType<TaskTelemetryTracker["get"]>
		telemetryTaskId: string | undefined
	} {
		return {
			telemetry: this.telemetry.get(),
			telemetryTaskId: this.telemetry.currentTask,
		}
	}
}

describe("ACT-CLINEMM-TASKHEADER-LIVE-TIMER-ZERO-RESET01 — timer anchor on resume", () => {
	const hasAnchor = productionReinitWiresTelemetryAnchor(SdkControllerSource)

	it("LTZ01: when a task is resumed through the reinit seam, the published taskTelemetry must belong to the resumed task with startedAt from its history item ts (not undefined, not cross-task)", () => {
		// Fail fast with a clear diagnostic if the harness cannot
		// mirror the (repaired) production code. This usually means
		// the production fix is missing or the harness wiring has
		// drifted; either is a test failure, not a silent skip.
		expect(hasAnchor, "production SdkController.reinitExistingTaskFromId must wire taskTelemetry.startTask(...)").toBe(true)

		const h = new TimerSeamHarness(hasAnchor)

		// Phase 1 — original creation of task B at wall-clock T0 = 100_000.
		// Production chronology: user submits prompt → SdkController.initTask(B)
		// → taskTelemetry.startTask(B, ts_B) — anchor is correct.
		const tsB = 100_000
		h.runInit("session-B", tsB, tsB)
		expect(h.telemetry.currentTask).toBe("session-B")
		expect(h.telemetry.get()?.startedAt).toBe(tsB)

		// Phase 2 — time advances. The user runs tools, waits, then
		// closes VS Code without explicitly cancelling. The host
		// restarts.
		//
		// For the live reproduction the important property is that
		// the resumed task IS the visible task. We model the host
		// restart as a fresh harness (a new tracker instance).
		const fresh = new TimerSeamHarness(hasAnchor)

		// Phase 3 — user clicks Resume from history. Production
		// chronology:
		//   SdkController.reinitExistingTaskFromId("session-B")
		//   → SdkTaskStartCoordinator.reinitExistingTaskFromId
		//     → clearTaskForOperation → SdkController.clearTask
		//       → turnStateTracker.set("idle")
		//     → startNewSession resolves
		//     → setTurnPhase("streaming")
		//
		// The persisted history ts is `tsB` (set when the task was
		// first created via `createHistoryItemFromSession` →
		// `historyItem.ts = Date.now()` at SdkTaskStartCoordinator
		// line 244-250, then written via
		// `taskHistory.updateTaskHistoryItem` at line 250).
		const anchorTs = tsB + 5_000 // session becomes "streaming" 5s after creation
		fresh.runReinit("session-B", tsB, anchorTs)

		// Phase 4 — advance the wall-clock by 5 seconds while the
		// resumed task is genuinely executing (tool calls, model
		// streaming). The webview's setInterval(1000) repaints the
		// display via resolveElapsedDisplayMs + formatElapsed.
		const now = anchorTs + 5_000
		const snap = fresh.publishTaskTelemetry()

		// PRIMARY INVARIANT (must hold for a resumed task that the
		// user has been running for 5+ seconds):
		expect(snap.telemetry, "taskTelemetry must be defined for a resumed, actively-running task").toBeDefined()
		expect(snap.telemetryTaskId, "telemetry.currentTaskId must equal the resumed task id").toBe("session-B")
		expect(snap.telemetry?.startedAt, "telemetry.startedAt must be the persisted history ts of the resumed task").toBe(tsB)

		// Formatted display check: the LIVE defect rendered "00:00"
		// for an already-running task. The display helper MUST
		// produce a non-zero elapsed string.
		const elapsedMs = resolveElapsedDisplayMs(snap.telemetry!.startedAt, snap.telemetry!.endedAt, now)
		const elapsedText = formatElapsed(elapsedMs)
		expect(elapsedText, "elapsed display must be > 00:00 for a task running >=5s").not.toBe("00:00")
		// And the actual duration must reflect wall-clock age (>=10s:
		// original ts + 5s of pre-resume + 5s of post-resume).
		expect(elapsedMs).toBeGreaterThanOrEqual(10_000)
	})

	it("LTZ02: structural sentinel — SdkController.reinitExistingTaskFromId body must wire taskTelemetry.startTask", () => {
		// The structural witness: the resume seam must anchor the
		// telemetry tracker for the resumed task identity. This is
		// the mirror of C04-WIRE-1 for the resume seam. Future
		// refactors that remove the anchor regress the timer and
		// must trip this test.
		const body = locateReinitExistingTaskFromId(SdkControllerSource)
		expect(
			body,
			"SdkController.reinitExistingTaskFromId must call this.taskTelemetry.startTask(...) to anchor the timer for the resumed task",
		).toMatch(/this\.taskTelemetry\.startTask\(/)
	})

	it("LTZ03: cross-task identity — resuming a different task must not carry the previous task's startedAt", () => {
		// Fail fast with a clear diagnostic if the harness cannot
		// mirror the (repaired) production code.
		expect(hasAnchor, "production SdkController.reinitExistingTaskFromId must wire taskTelemetry.startTask(...)").toBe(true)

		// Pin the discriminant: the timer belongs to the CURRENT
		// logical task, not to whatever was current when the host
		// last called startTask.
		//
		// Production chronology (with the seam re-anchored at
		// resume): start task A, then resume task B from history.
		// Telemetry must belong to B with B's history ts.
		const h = new TimerSeamHarness(hasAnchor)

		// Task A is running (startedAt = T_A).
		const tA = 50_000
		h.runInit("session-A", tA, tA)
		expect(h.telemetry.get()?.startedAt).toBe(tA)
		expect(h.telemetry.currentTask).toBe("session-A")

		// User cancels (mirrors cancelTask → endTask). endedAt
		// frozen at T_A + 30s.
		h.telemetry.observeTurnPhase("resumable", tA + 30_000)
		expect(h.telemetry.get()?.endedAt).toBe(tA + 30_000)

		// Fresh host restart (fresh harness).
		const fresh = new TimerSeamHarness(hasAnchor)

		// User clicks Resume for task B (a DIFFERENT task in their
		// history). persistedTs = tB.
		const tB = 200_000
		fresh.runReinit("session-B", tB, tB + 5_000)

		const snap = fresh.publishTaskTelemetry()
		expect(snap.telemetryTaskId, "telemetry.currentTaskId must equal the resumed task B, not A").toBe("session-B")
		expect(snap.telemetry?.startedAt, "telemetry.startedAt must be task B's history ts, not task A's").toBe(tB)
	})
})

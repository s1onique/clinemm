/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01 / R-C2 — Host-only
 * TaskMsg emitter.
 *
 * The host (VSCode) is the source of truth for visible-task lifecycle
 * events that the runtime cannot provide:
 *
 *   - `task_requested(taskId)`   — a new visible task was allocated
 *   - `task_reset`              — the controller reset the visible task
 *   - `task_cancelled`           — the user cancelled the active task
 *   - `same_task_continued`      — a follow-up resumed the same task
 *
 * These TaskMsgs are fed directly into the live TaskStateShadow,
 * bypassing the legacy → runtime reverse translator. They use the
 * same `TaskStateShadow.observeTaskMsg` seam the synthetic tests
 * exercise.
 *
 * The emitter is observation-only. It does NOT write to the legacy
 * `TurnStateTracker`, `TaskTelemetryTracker`, or any host state.
 * EFFECT_EXECUTION_ENABLED is FALSE.
 */
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { TaskShadowComparator } from "./task-state-shadow"
import type { TaskShadowHostWiring } from "./task-state-shadow-host-wiring"

/**
 * Minimal interface the host-only emitter needs from the live
 * comparator. The comparator is the recorder's observation seam;
 * the emitter pushes TaskMsgs through it, which records and
 * arbitrates.
 */
export interface TaskShadowHostMsgSink {
	readonly comparator: TaskShadowComparator
	readonly now: () => number
}

/**
 * Emits `task_requested(taskId)` into the shadow. Called from
 * `SdkController.initTask` after the visible task identity is
 * allocated. The legacy phase is sampled synchronously so the
 * recording is consistent with the R5 contract.
 */
export function emitTaskRequested(sink: TaskShadowHostMsgSink, taskId: string, now = sink.now()): void {
	sink.comparator.observeTaskMsg({ type: "task_requested", taskId, at: now }, "idle", now)
}

/**
 * Emits `task_cancelled` when the host cancels the active task.
 */
export function emitTaskCancelled(sink: TaskShadowHostMsgSink, legacyPhase: TurnPhase, now = sink.now()): void {
	sink.comparator.observeTaskMsg({ type: "task_cancelled", at: now }, legacyPhase, now)
}

/**
 * Emits `task_reset` when the controller clears the visible task.
 */
export function emitTaskReset(sink: TaskShadowHostMsgSink, legacyPhase: TurnPhase, now = sink.now()): void {
	sink.comparator.observeTaskMsg({ type: "task_reset", at: now }, legacyPhase, now)
}

/**
 * Emits `same_task_continued` when a follow-up resumes the same
 * visible task (e.g. user typed a follow-up after a completed task
 * without launching a fresh tab).
 */
export function emitSameTaskContinued(sink: TaskShadowHostMsgSink, legacyPhase: TurnPhase, now = sink.now()): void {
	sink.comparator.observeTaskMsg({ type: "same_task_continued", at: now }, legacyPhase, now)
}

/**
 * Convenience: build a sink from a `TaskShadowHostWiring` instance.
 * The wiring module exposes the comparator + now directly via the
 * `TaskShadowHostWiringWithSink` extended interface.
 */
export function sinkFromWiring(
	wiring: TaskShadowHostWiring & { comparator: TaskShadowComparator; now: () => number },
): TaskShadowHostMsgSink {
	return { comparator: wiring.comparator, now: wiring.now }
}

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
 *
 * Host-only TaskMsg emitter. The host (VSCode) is the source of
 * truth for visible-task lifecycle events that the runtime cannot
 * provide:
 *
 *   - `task_requested(taskId)`   — a new visible task was allocated
 *   - `task_reset`              — the controller reset the visible task
 *   - `task_cancelled`           — the user cancelled the active task
 *   - `same_task_continued`      — a follow-up resumed the same task
 *
 * These TaskMsgs are routed through the unified observation
 * coordinator as `HOST_TASK` origin. The coordinator is the
 * ONLY production writer to the shadow + recorder.
 *
 * The emitter is observation-only. It does NOT write to the legacy
 * `TurnStateTracker`, `TaskTelemetryTracker`, or any host state.
 * EFFECT_EXECUTION_ENABLED is FALSE.
 */
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { TaskShadowCoordinator } from "./task-state-shadow-coordinator"
import type { TaskShadowHostWiring } from "./task-state-shadow-host-wiring"

/**
 * Minimal interface the host-only emitter needs from the unified
 * coordinator. Production callers MUST obtain this from
 * `sinkFromWiring(wiring)` so the wiring owns the coordinator
 * instance.
 */
export interface TaskShadowHostMsgSink {
	readonly coordinator: TaskShadowCoordinator
	readonly now: () => number
}

/**
 * Emits `task_requested(taskId)` through the coordinator. Called
 * from `SdkController.initTask` after the visible task identity is
 * allocated. The timestamp is sampled synchronously so the
 * recording is consistent.
 */
export function emitTaskRequested(sink: TaskShadowHostMsgSink, taskId: string, now = sink.now()): void {
	sink.coordinator.observe({
		kind: "host-task",
		origin: "HOST_TASK",
		taskId,
		msg: { type: "task_requested", taskId, at: now },
	})
}

/**
 * Emits `task_cancelled` through the coordinator when the host
 * cancels the active task.
 */
export function emitTaskCancelled(sink: TaskShadowHostMsgSink, legacyPhase: TurnPhase, now = sink.now()): void {
	sink.coordinator.observe({
		kind: "host-task",
		origin: "HOST_TASK",
		taskId: "unknown",
		msg: { type: "task_cancelled", at: now },
	})
	void legacyPhase
}

/**
 * Emits `task_reset` through the coordinator when the controller
 * clears the visible task.
 */
export function emitTaskReset(sink: TaskShadowHostMsgSink, legacyPhase: TurnPhase, now = sink.now()): void {
	sink.coordinator.observe({
		kind: "host-task",
		origin: "HOST_TASK",
		taskId: "unknown",
		msg: { type: "task_reset", at: now },
	})
	void legacyPhase
}

/**
 * Emits `same_task_continued` through the coordinator when a
 * follow-up resumes the same visible task (e.g. user typed a
 * follow-up after a completed task without launching a fresh tab).
 */
export function emitSameTaskContinued(sink: TaskShadowHostMsgSink, legacyPhase: TurnPhase, now = sink.now()): void {
	sink.coordinator.observe({
		kind: "host-task",
		origin: "HOST_TASK",
		taskId: "unknown",
		msg: { type: "same_task_continued", at: now },
	})
	void legacyPhase
}

/**
 * Convenience: build a sink from a `TaskShadowHostWiring` instance.
 * The wiring exposes the coordinator + now directly via the
 * `TaskShadowHostWiring` interface.
 */
export function sinkFromWiring(wiring: TaskShadowHostWiring & { now: () => number }): TaskShadowHostMsgSink {
	return { coordinator: wiring.coordinator, now: wiring.now }
}

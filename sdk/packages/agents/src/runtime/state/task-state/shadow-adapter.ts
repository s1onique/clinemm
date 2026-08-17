/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 13 + 14 — Shadow adapter.
 *
 * `TaskStateShadow` owns a private `TaskModel` and a queue of
 * `TaskMsg`s. Adapters translate runtime / host events into
 * `TaskMsg`s and feed them through `taskUpdate`. The instance is
 * observation-only: it must never call `TurnStateTracker.set()`,
 * `postStateToWebview()`, or any other authority writer.
 *
 * The shadow produces an `observation` record after every observed
 * event. The observation carries:
 *
 *   - the new `model`,
 *   - the requested `effects` (non-executing during E0–E4),
 *   - the current `projections`,
 *   - any `violations` reported by the invariant library.
 *
 * A host-side differential comparator consumes the projections and
 * compares them against `TurnStateTracker.currentPhase` /
 * `taskTelemetry`. The comparator itself is OUT OF SCOPE for this
 * file (it lives in `apps/vscode/src/sdk/`).
 */
import type { AgentRuntimeEvent, AgentRuntimeRecoverySnapshot } from "@cline/shared";
import type { TaskEffect } from "./effects";
import { checkTaskInvariants, type TaskInvariantViolation } from "./invariants";
import { initialTaskModel, type TaskModel } from "./model";
import type { TaskMsg } from "./msg";
import {
	canCancel,
	canStartNewTask,
	canSubmitFollowup,
	projectControls,
	projectElapsedMs,
	projectTelemetry,
	projectThinking,
	projectTurnState,
	type ShadowTurnPhase,
} from "./selectors";
import { taskUpdate } from "./update";

/**
 * Snapshot produced by the shadow after every observed event. Designed
 * to be privacy-safe (ELM10): no message prose, no raw control keys,
 * no API payloads.
 */
export interface TaskShadowObservation {
	readonly event: TaskMsg["type"] | "noop";
	readonly model: TaskModel;
	readonly effects: readonly TaskEffect[];
	readonly projections: {
		readonly turnPhase: ShadowTurnPhase;
		readonly thinking: boolean;
		readonly elapsedMs: number;
		readonly canCancel: boolean;
		readonly canStartNewTask: boolean;
		readonly canSubmitFollowup: boolean;
		readonly toolCalls: number;
		readonly recoveryBudgetFailures: number;
	};
	readonly violations: readonly TaskInvariantViolation[];
}

/**
 * Adapter seam — translates a `AgentRuntimeEvent` into the `TaskMsg`
 * sequence the shadow understands.
 *
 * One-way only (Phase 13 critical rule):
 *
 *   legacy event → TaskMsg
 *
 * NOT:
 *
 *   TaskModel → mutate legacy runtime
 *
 * If a runtime event has no clean shadow analogue (e.g. assistant text
 * deltas — they are presentation only and never enter the shadow), the
 * adapter returns an empty array; the shadow is unaffected and
 * production carries on.
 */
export function adaptRuntimeEvent(event: AgentRuntimeEvent, now: number): readonly TaskMsg[] {
	const out: TaskMsg[] = [];
	switch (event.type) {
		case "run-started":
			out.push({ type: "session_started", sessionId: event.snapshot.runId ?? "", at: now });
			break;
		case "run-finished":
			out.push({ type: "task_completed", at: now });
			break;
		case "run-failed":
			out.push({ type: "task_failed", classification: "unknown", at: now });
			break;
		case "tool-started":
			out.push({ type: "tool_started", toolCallId: event.toolCall.toolCallId, at: now });
			break;
		case "tool-finished":
			out.push({ type: "tool_finished", toolCallId: event.toolCall.toolCallId, at: now });
			break;
		case "execution-state-changed": {
			const exec = event.snapshot.execution;
			if (exec?.modelStreaming) {
				out.push({ type: "model_stream_started", at: now });
			} else {
				out.push({ type: "model_stream_finished", at: now });
			}
			if (exec?.awaitingApproval) {
				out.push({ type: "approval_requested", at: now });
			} else {
				out.push({ type: "approval_resolved", at: now });
			}
			break;
		}
		case "recovery-state-changed":
			out.push({
				type: "recovery_changed",
				projection: projectRecoverySnapshot(event.snapshot.recovery),
				at: now,
			});
			break;
		// Remaining event kinds are presentation/prose and intentionally
		// produce no TaskMsg: assistant text/reasoning deltas, status notices,
		// usage updates, message-added, turn-started/finished, tool-updated.
		default:
			break;
	}
	return out;
}

function projectRecoverySnapshot(
	recovery: AgentRuntimeRecoverySnapshot | undefined,
): { state: AgentRuntimeRecoverySnapshot["state"]; episodeFailures: number; circuitNoticeCount: number } {
	if (!recovery) {
		return { state: "idle", episodeFailures: 0, circuitNoticeCount: 0 };
	}
	return {
		state: recovery.state,
		episodeFailures: recovery.episodeFailures,
		circuitNoticeCount: recovery.circuitNoticeCount,
	};
}

/**
 * Pure observation. Each `observe` call replays a single message
 * through the reducer and returns the resulting snapshot. The shadow
 * state is held privately; no consumer can read or mutate it
 * directly.
 */
export class TaskStateShadow {
	private model: TaskModel = initialTaskModel();

	/**
	 * For tests only: returns the current model snapshot without
	 * recording an observation. Production code MUST NOT call this.
	 */
	debugSnapshot(): TaskModel {
		return this.model;
	}

	/**
	 * Apply a single `TaskMsg` and return the observation. Pure in
	 * the sense that it does not call any external authority — it
	 * only mutates the private model.
	 */
	observe(msg: TaskMsg, now: number): TaskShadowObservation {
		const [next, effects] = taskUpdate(this.model, msg);
		this.model = next;
		const violations = checkTaskInvariants(next);
		return {
			event: msg.type,
			model: next,
			effects,
			projections: {
				turnPhase: projectTurnState(next),
				thinking: projectThinking(next),
				elapsedMs: projectElapsedMs(next, now),
				canCancel: canCancel(next),
				canStartNewTask: canStartNewTask(next),
				canSubmitFollowup: canSubmitFollowup(next),
				toolCalls: projectTelemetry(next).toolCalls,
				recoveryBudgetFailures: projectTelemetry(next).recoveryBudgetFailures,
			},
			violations,
		};
	}

	/**
	 * Translate a `AgentRuntimeEvent` into `TaskMsg`s and apply each.
	 * Returns the *last* observation; callers that want every step
	 * should call `observe` per `TaskMsg`.
	 */
	observeRuntimeEvent(event: AgentRuntimeEvent, now: number): TaskShadowObservation | undefined {
		const msgs = adaptRuntimeEvent(event, now);
		let last: TaskShadowObservation | undefined;
		for (const m of msgs) {
			last = this.observe(m, now);
		}
		return last ?? this.noop(now);
	}

	/**
	 * Sentinel observation produced when the runtime event had no
	 * shadow analogue. Useful for the differential comparator's
	 * monotonic seq without forcing every consumer to handle
	 * `undefined`.
	 */
	noop(now: number): TaskShadowObservation {
		return {
			event: "noop",
			model: this.model,
			effects: [],
			projections: {
				turnPhase: projectTurnState(this.model),
				thinking: projectThinking(this.model),
				elapsedMs: projectElapsedMs(this.model, now),
				canCancel: canCancel(this.model),
				canStartNewTask: canStartNewTask(this.model),
				canSubmitFollowup: canSubmitFollowup(this.model),
				toolCalls: projectTelemetry(this.model).toolCalls,
				recoveryBudgetFailures: projectTelemetry(this.model).recoveryBudgetFailures,
			},
			violations: checkTaskInvariants(this.model),
		};
	}

	/**
	 * Test-only reset back to `initialTaskModel`.
	 */
	debugReset(): void {
		this.model = initialTaskModel();
	}

	/**
	 * Apply a sequence of `TaskMsg`s and return every observation.
	 * Used by the bounded state-space explorer and by sequence tests.
	 */
	replay(msgs: readonly TaskMsg[], now: number): readonly TaskShadowObservation[] {
		const out: TaskShadowObservation[] = [];
		for (const m of msgs) {
			out.push(this.observe(m, now));
		}
		return out;
	}

	// Re-export for the differential comparator and tests.
	controls() {
		return projectControls(this.model);
	}
}
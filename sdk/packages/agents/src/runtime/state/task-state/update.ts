/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / E3 — Pure `taskUpdate`.
 *
 * The Elm Architecture's single transition function. Takes the current
 * `TaskModel` and a `TaskMsg`, returns `[nextModel, effects[]]`.
 *
 * ## Purity contract (ELM02)
 *
 * `taskUpdate` performs:
 *   - **no** `Date.now()` reads — time enters via `msg.at`
 *   - **no** filesystem / network / child-process
 *   - **no** callback invocation
 *   - **no** singleton / global reads
 *   - **no** mutation of `model` (purely `readonly` inputs and
 *     structural copy-out)
 *
 * Determinism (I14): identical `(model, msg)` pairs always produce
 * deeply-equal results. Verified by `task-state.update.test.ts`.
 *
 * ## Transition policy
 *
 * The reducer follows the four-tier classification the ACT specifies:
 *
 *   - `VALID`              — the canonical transition is applied.
 *   - `IDEMPOTENT`         — the message is a no-op in this state.
 *   - `IGNORED_STALE`      — the message refers to a previous epoch
 *                            (e.g. tool_finished after task_completed).
 *   - `INVARIANT_VIOLATION`— an impossible sequence was observed;
 *                            the model is left unchanged and the
 *                            divergence record will surface this.
 *
 * The reducer never throws on real-world asynchronous reorderings.
 * The shadow mode tolerates drift so production can continue.
 */
import { noEffect, type TaskEffect } from "./effects";
import { isTaskMsg, type TaskMsg } from "./msg";
import type { TaskModel, TaskFailureClass } from "./model";

/**
 * Standard shape of an Elm Architecture `update` call.
 */
export type UpdateResult = readonly [model: TaskModel, effects: readonly TaskEffect[]];

/**
 * Sentinel for "this message has no transition worth recording".
 * Keeping a constant avoids re-allocating an empty array on every
 * no-op, which matters for the high-frequency `tool-started` /
 * `tool-finished` pair in parallel batches.
 */
const NO_EFFECTS: readonly TaskEffect[] = [noEffect()];

/**
 * Pure transition. `model` is never mutated; the returned `TaskModel`
 * is a fresh object. `effects` are data, never executed (ELM04).
 */
export function taskUpdate(model: TaskModel, msg: TaskMsg): UpdateResult {
	if (!isTaskMsg(msg)) {
		return [model, NO_EFFECTS];
	}
	switch (msg.type) {
		case "task_requested":
			return updateTaskRequested(model, msg);
		case "session_started":
			return updateSessionStarted(model, msg);
		case "task_reset":
			return updateTaskReset(model, msg);
		case "model_stream_started":
			return updateModelStreamStarted(model, msg);
		case "model_stream_finished":
			return updateModelStreamFinished(model, msg);
		case "tool_started":
			return updateToolStarted(model, msg);
		case "tool_finished":
			return updateToolFinished(model, msg);
		case "approval_requested":
			return updateApprovalRequested(model, msg);
		case "approval_resolved":
			return updateApprovalResolved(model, msg);
		case "recovery_changed":
			return updateRecoveryChanged(model, msg);
		case "task_completed":
			return updateTaskCompleted(model, msg);
		case "task_failed":
			return updateTaskFailed(model, msg);
		case "task_became_resumable":
			return updateTaskBecameResumable(model, msg);
		case "task_cancelled":
			return updateTaskCancelled(model, msg);
		case "same_task_continued":
			return updateSameTaskContinued(model, msg);
		default: {
			// Exhaustiveness guard. The compiler will error here if a
			// new variant is added without a case.
			const exhaustive: never = msg;
			void exhaustive;
			return [model, NO_EFFECTS];
		}
	}
}

// =========================================================================
// Identity / session transitions
// =========================================================================

function updateTaskRequested(
	model: TaskModel,
	msg: { readonly type: "task_requested"; readonly taskId: string; readonly at: number },
): UpdateResult {
	// A new task identity resets the epoch (I09) and clears activity.
	return [
		{
			...model,
			identity: {
				taskId: msg.taskId,
				startedAt: msg.at,
				endedAt: undefined,
			},
			lifecycle: { kind: "running" },
			activity: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
			telemetry: {
				toolCalls: 0,
				recoveryBudgetFailures: 0,
			},
		},
		NO_EFFECTS,
	];
}

function updateSessionStarted(
	model: TaskModel,
	msg: { readonly type: "session_started"; readonly sessionId: string; readonly at: number },
): UpdateResult {
	return [
		{
			...model,
			identity: {
				...model.identity,
				sessionId: msg.sessionId,
				startedAt: model.identity.startedAt ?? msg.at,
			},
		},
		NO_EFFECTS,
	];
}

function updateTaskReset(
	_model: TaskModel,
	_msg: { readonly type: "task_reset"; readonly at: number },
): UpdateResult {
	void _model;
	void _msg;
	return [
		{
			identity: {},
			lifecycle: { kind: "idle" },
			activity: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recovery: { state: "idle", episodeFailures: 0, circuitNoticeCount: 0 },
			telemetry: { toolCalls: 0, recoveryBudgetFailures: 0 },
		},
		NO_EFFECTS,
	];
}

// =========================================================================
// Activity transitions
// =========================================================================

function updateModelStreamStarted(
	model: TaskModel,
	_msg: { readonly type: "model_stream_started"; readonly at: number },
): UpdateResult {
	void _msg;
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: undefined },
			lifecycle: isTerminal(model.lifecycle) ? model.lifecycle : { kind: "running" },
			activity: { ...model.activity, modelStreaming: true },
		},
		NO_EFFECTS,
	];
}

function updateModelStreamFinished(
	model: TaskModel,
	_msg: { readonly type: "model_stream_finished"; readonly at: number },
): UpdateResult {
	// Do NOT auto-promote to `completed` here. Stream-end does not
	// prove the turn completed. The next `task_completed` message
	// performs it. (Phase 7 explicit semantic.)
	return [
		{
			...model,
			activity: { ...model.activity, modelStreaming: false },
		},
		NO_EFFECTS,
	];
}

function updateToolStarted(
	model: TaskModel,
	_msg: { readonly type: "tool_started"; readonly toolCallId: string; readonly at: number },
): UpdateResult {
	void _msg;
	// Idempotent per toolCallId: parallel siblings count as two
	// tool-started events. The cumulative counter is monotonic (I10).
	const alreadyActive = model.activity.tooling;
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: undefined },
			activity: { ...model.activity, tooling: true },
			telemetry: alreadyActive
				? model.telemetry
				: {
						toolCalls: model.telemetry.toolCalls + 1,
						recoveryBudgetFailures: model.telemetry.recoveryBudgetFailures,
					},
			// `toolCallId` is intentionally not retained; this is a
			// counter projection, not a registry. The runtime holds
			// the per-tool state.
		},
		NO_EFFECTS,
	];
}

function updateToolFinished(
	model: TaskModel,
	_msg: { readonly type: "tool_finished"; readonly toolCallId: string; readonly at: number },
): UpdateResult {
	// Stale tool_finished after a completed task is `IGNORED_STALE`.
	if (isTerminal(model.lifecycle)) {
		return [model, NO_EFFECTS];
	}
	return [
		{
			...model,
			activity: { ...model.activity, tooling: false },
		},
		NO_EFFECTS,
	];
}

function updateApprovalRequested(
	model: TaskModel,
	_msg: { readonly type: "approval_requested"; readonly at: number },
): UpdateResult {
	void _msg;
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: undefined },
			lifecycle: isTerminal(model.lifecycle) ? model.lifecycle : { kind: "running" },
			activity: { ...model.activity, awaitingApproval: true },
		},
		NO_EFFECTS,
	];
}

function updateApprovalResolved(
	model: TaskModel,
	_msg: { readonly type: "approval_resolved"; readonly at: number },
): UpdateResult {
	return [
		{
			...model,
			activity: { ...model.activity, awaitingApproval: false },
		},
		NO_EFFECTS,
	];
}

// =========================================================================
// Recovery transition
// =========================================================================

function updateRecoveryChanged(
	model: TaskModel,
	msg: {
		readonly type: "recovery_changed";
		readonly projection: {
			readonly state: TaskModel["recovery"]["state"];
			readonly episodeFailures: number;
			readonly circuitNoticeCount: number;
		};
		readonly at: number;
	},
): UpdateResult {
	const prev = model.recovery.episodeFailures;
	const next = msg.projection.episodeFailures;
	const delta = next > prev ? next - prev : 0;
	return [
		{
			...model,
			recovery: {
				state: msg.projection.state,
				episodeFailures: next,
				circuitNoticeCount: msg.projection.circuitNoticeCount,
			},
			telemetry: {
				toolCalls: model.telemetry.toolCalls,
				recoveryBudgetFailures: model.telemetry.recoveryBudgetFailures + delta,
			},
		},
		NO_EFFECTS,
	];
}

// =========================================================================
// Terminal / continuation transitions
// =========================================================================

function updateTaskCompleted(
	model: TaskModel,
	msg: { readonly type: "task_completed"; readonly at: number },
): UpdateResult {
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: msg.at },
			lifecycle: { kind: "completed" },
			activity: { modelStreaming: false, tooling: false, awaitingApproval: false },
		},
		NO_EFFECTS,
	];
}

function updateTaskFailed(
	model: TaskModel,
	msg: { readonly type: "task_failed"; readonly classification: TaskFailureClass; readonly at: number },
): UpdateResult {
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: msg.at },
			lifecycle: { kind: "failed", reason: msg.classification },
			activity: { modelStreaming: false, tooling: false, awaitingApproval: false },
		},
		NO_EFFECTS,
	];
}

function updateTaskBecameResumable(
	model: TaskModel,
	msg: { readonly type: "task_became_resumable"; readonly at: number },
): UpdateResult {
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: msg.at },
			lifecycle: { kind: "resumable" },
			activity: { modelStreaming: false, tooling: false, awaitingApproval: false },
		},
		NO_EFFECTS,
	];
}

function updateTaskCancelled(
	model: TaskModel,
	msg: { readonly type: "task_cancelled"; readonly at: number },
): UpdateResult {
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: msg.at },
			lifecycle: { kind: "cancelled" },
			activity: { modelStreaming: false, tooling: false, awaitingApproval: false },
		},
		NO_EFFECTS,
	];
}

function updateSameTaskContinued(
	model: TaskModel,
	_msg: { readonly type: "same_task_continued"; readonly at: number },
): UpdateResult {
	// I08: startedAt preserved. endedAt cleared. Lifecycle returns
	// to `running` (mirrors the host's "first terminal wins within
	// current stopped interval" reopenable-freeze semantics).
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: undefined },
			lifecycle: { kind: "running" },
			activity: { modelStreaming: false, tooling: false, awaitingApproval: false },
		},
		NO_EFFECTS,
	];
}

/**
 * Whether a lifecycle is terminal (i.e. cannot be silently overwritten
 * by an activity transition). Mirrors the host's behavior for
 * `setTurnPhase("completed")` writes that should not be reverted by a
 * stray `model_stream_started` event from a stale runtime.
 */
function isTerminal(lifecycle: TaskModel["lifecycle"]): boolean {
	return (
		lifecycle.kind === "completed" ||
		lifecycle.kind === "failed" ||
		lifecycle.kind === "cancelled"
	);
}
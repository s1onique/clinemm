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
 * ## Transition policy matrix (CORRECTION01, R3)
 *
 * Activity messages (`model_stream_started`, `tool_started`,
 * `approval_requested`) obey one explicit policy. The matrix is
 * the contract; downstream tests and invariants enforce it.
 *
 * ```text
 *                 model_stream_started  tool_started  approval_requested
 *   idle          promote->running      promote->run  promote->running
 *   running       VALID                 VALID          VALID
 *   resumable     IGNORED_STALE         IGNORED_STALE  IGNORED_STALE
 *   completed     IGNORED_STALE         IGNORED_STALE  IGNORED_STALE
 *   failed        IGNORED_STALE         IGNORED_STALE  IGNORED_STALE
 *   cancelled     IGNORED_STALE         IGNORED_STALE  IGNORED_STALE
 * ```
 *
 * The `IGNORED_STALE` policy prevents late async events belonging to
 * a stopped epoch from reactivating the shadow. This is the rule I01
 * ("terminal_no_activity") and I02 ("active_not_idle") enforce, but
 * the policy applies to `resumable` as well: a `resumable` lifecycle
 * is treated as "stopped epoch" for activity purposes. The only way
 * to leave `resumable` for `running` is the explicit
 * `same_task_continued` message, which itself clears activity.
 *
 * ## Tool representation (CORRECTION01, R1)
 *
 * `TaskActivityState.tooling` is replaced by
 * `TaskActivityState.activeToolCallIds: readonly string[]`. The
 * projection `tooling` is `activeToolCallIds.length > 0`.
 *
 * `tool_started(id)` adds the ID if unseen, increments the cumulative
 * `toolCalls` counter only on a previously-unseen ID. `tool_finished(id)`
 * removes only the matching ID. This prevents the false-idle bug
 * observed when one of N parallel tools finishes while siblings remain
 * in flight.
 *
 * ## Effect execution
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
				activeToolCallIds: [],
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
			activity: { modelStreaming: false, activeToolCallIds: [], awaitingApproval: false },
			recovery: { state: "idle", episodeFailures: 0, circuitNoticeCount: 0 },
			telemetry: { toolCalls: 0, recoveryBudgetFailures: 0 },
		},
		NO_EFFECTS,
	];
}

// =========================================================================
// Activity transitions (CORRECTION01: stale-event policy applies to all
// activity messages uniformly; tool calls are tracked by ID, not boolean)
// =========================================================================

function updateModelStreamStarted(
	model: TaskModel,
	_msg: { readonly type: "model_stream_started"; readonly at: number },
): UpdateResult {
	void _msg;
	// CORRECTION01 R3: same stale-event policy as `updateToolStarted`.
	// A stray stream start belonging to a stopped epoch must not
	// reactivate the shadow. `resumable` is treated as stopped epoch.
	if (isStale(model.lifecycle)) {
		return [model, NO_EFFECTS];
	}
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: undefined },
			lifecycle: promoteToRunning(model.lifecycle),
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
	// Stale stream-finished after a stopped epoch is IGNORED_STALE
	// too: don't clobber whatever the shadow has projected.
	if (isStale(model.lifecycle)) {
		return [model, NO_EFFECTS];
	}
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
	msg: { readonly type: "tool_started"; readonly toolCallId: string; readonly at: number },
): UpdateResult {
	void msg;
	// I01 / I02: terminal lifecycle never becomes active again from
	// a stray tool_started. Stale events are IGNORED_STALE.
	// CORRECTION01 R3: `resumable` is also stale for activity.
	if (isStale(model.lifecycle)) {
		return [model, NO_EFFECTS];
	}
	// CORRECTION01 R1: parallel tools are tracked by ID. An unseen ID
	// increments the cumulative toolCalls counter and adds to the set;
	// a re-emit of an already-active ID is a no-op for the counter but
	// also a no-op for the set (deduped).
	const ids = model.activity.activeToolCallIds;
	const alreadyActive = ids.includes(msg.toolCallId);
	const nextIds = alreadyActive ? ids : [...ids, msg.toolCallId];
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: undefined },
			lifecycle: promoteToRunning(model.lifecycle),
			activity: { ...model.activity, activeToolCallIds: nextIds },
			telemetry: alreadyActive
				? model.telemetry
				: {
						toolCalls: model.telemetry.toolCalls + 1,
						recoveryBudgetFailures: model.telemetry.recoveryBudgetFailures,
					},
		},
		NO_EFFECTS,
	];
}

function updateToolFinished(
	model: TaskModel,
	msg: { readonly type: "tool_finished"; readonly toolCallId: string; readonly at: number },
): UpdateResult {
	void msg;
	// Stale tool_finished after a stopped epoch is `IGNORED_STALE`.
	if (isStale(model.lifecycle)) {
		return [model, NO_EFFECTS];
	}
	// CORRECTION01 R1: remove only the matching ID. Other in-flight
	// tools remain active. If the ID is not present (orphan finish),
	// the model is unchanged.
	const ids = model.activity.activeToolCallIds;
	if (!ids.includes(msg.toolCallId)) {
		return [model, NO_EFFECTS];
	}
	const nextIds = ids.filter((id) => id !== msg.toolCallId);
	return [
		{
			...model,
			activity: { ...model.activity, activeToolCallIds: nextIds },
		},
		NO_EFFECTS,
	];
}

function updateApprovalRequested(
	model: TaskModel,
	_msg: { readonly type: "approval_requested"; readonly at: number },
): UpdateResult {
	void _msg;
	// CORRECTION01 R3: same stale-event policy. An approval that
	// belongs to a stopped epoch must not reactivate the shadow.
	if (isStale(model.lifecycle)) {
		return [model, NO_EFFECTS];
	}
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: undefined },
			lifecycle: promoteToRunning(model.lifecycle),
			activity: { ...model.activity, awaitingApproval: true },
		},
		NO_EFFECTS,
	];
}

function updateApprovalResolved(
	model: TaskModel,
	_msg: { readonly type: "approval_resolved"; readonly at: number },
): UpdateResult {
	// Resolving an approval on a stopped epoch is a no-op too.
	if (isStale(model.lifecycle)) {
		return [model, NO_EFFECTS];
	}
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
			activity: { modelStreaming: false, activeToolCallIds: [], awaitingApproval: false },
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
			activity: { modelStreaming: false, activeToolCallIds: [], awaitingApproval: false },
		},
		NO_EFFECTS,
	];
}

function updateTaskBecameResumable(
	model: TaskModel,
	msg: { readonly type: "task_became_resumable"; readonly at: number },
): UpdateResult {
	// CORRECTION01 R3: `resumable` is "stopped epoch" for activity
	// purposes. All activity fields are cleared on entry so the
	// invariants (I07 RESUMABLE_NOT_STREAMING, etc.) hold on entry
	// and the stale guard prevents any future activity message from
	// reactivating the shadow until a `same_task_continued` arrives.
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: msg.at },
			lifecycle: { kind: "resumable" },
			activity: { modelStreaming: false, activeToolCallIds: [], awaitingApproval: false },
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
			activity: { modelStreaming: false, activeToolCallIds: [], awaitingApproval: false },
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
	// Activity starts fresh — no carryover from the previous epoch.
	return [
		{
			...model,
			identity: { ...model.identity, endedAt: undefined },
			lifecycle: { kind: "running" },
			activity: { modelStreaming: false, activeToolCallIds: [], awaitingApproval: false },
		},
		NO_EFFECTS,
	];
}

/**
 * Whether a lifecycle is "stale" for activity purposes (CORRECTION01 R3).
 *
 * True for terminal kinds (completed, failed, cancelled) AND for
 * `resumable`. Activity messages addressed to a stale lifecycle are
 * `IGNORED_STALE` so the shadow is never reactivated by an event that
 * belongs to a stopped epoch. Only `same_task_continued` (or
 * `task_requested` for a brand-new task) can leave a stopped lifecycle
 * behind.
 */
function isStale(lifecycle: TaskModel["lifecycle"]): boolean {
	return (
		lifecycle.kind === "completed" ||
		lifecycle.kind === "failed" ||
		lifecycle.kind === "cancelled" ||
		lifecycle.kind === "resumable"
	);
}

/**
 * Whether a lifecycle is strictly terminal (cannot be un-terminalized).
 * Mirrors the host's behavior for `setTurnPhase("completed")` writes
 * that should not be reverted by a stray `model_stream_started`.
 *
 * `resumable` is *not* terminal — it can be un-terminalized via
 * `same_task_continued`. It is, however, stale for activity messages.
 */
function isTerminal(lifecycle: TaskModel["lifecycle"]): boolean {
	return (
		lifecycle.kind === "completed" ||
		lifecycle.kind === "failed" ||
		lifecycle.kind === "cancelled"
	);
}

/**
 * Promote an idle lifecycle to "running" whenever activity is becoming
 * true. `resumable` and the terminal kinds are left untouched.
 *
 * Note: callers gate activity transitions with `isStale()` first, so
 * `promoteToRunning` is only ever reached for `idle` or `running`.
 * The defensive checks for terminal/resumable/running remain as
 * belt-and-braces guarantees.
 */
function promoteToRunning(lifecycle: TaskModel["lifecycle"]): TaskModel["lifecycle"] {
	if (isTerminal(lifecycle) || lifecycle.kind === "resumable") return lifecycle;
	if (lifecycle.kind === "running") return lifecycle;
	return { kind: "running" };
}
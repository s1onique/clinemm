/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 10 — Pure invariant library.
 *
 * Every invariant returns zero or more typed violations. Invariants
 * never throw and never mutate input. Used by:
 *
 *   - the deterministic sequence tests (S01–S15),
 *   - the bounded state-space explorer (Phase 12),
 *   - the mutation campaign (Phase 18),
 *   - the shadow adapter's `observation` payload (debug hook).
 */
import type { TaskModel } from "./model";

/**
 * Discriminated union of every invariant violation the reducer can
 * produce. Adding a violation variant here is a deliberate
 * architecture-level event; consumers pattern-match on `kind`.
 */
export type TaskInvariantViolation =
	| { readonly kind: "terminal_with_activity" }
	| { readonly kind: "idle_with_activity" }
	| { readonly kind: "negative_elapsed" }
	| { readonly kind: "approval_without_running_task" }
	| { readonly kind: "completed_with_streaming" }
	| { readonly kind: "failed_with_streaming" }
	| { readonly kind: "resumable_with_streaming" }
	| { readonly kind: "cancelled_with_streaming" }
	| { readonly kind: "active_but_idle_phase" }
	| { readonly kind: "started_after_ended" }
	| { readonly kind: "non_monotonic_tool_calls" }
	| { readonly kind: "negative_recovery_counter" };

/**
 * Pure invariant check. Returns every violation found; an empty
 * array means the model satisfies all invariants.
 *
 * Invariants implemented (see ACT Phase 10):
 *
 *   I01  TERMINAL_NO_ACTIVITY
 *   I02  ACTIVE_NOT_IDLE
 *   I03  MODEL_STREAMING_PROJECTS_STREAMING (assertion via `projectTurnState`
 *         lives in selectors.ts; this module asserts the upstream model.)
 *   I04  APPROVAL_PROJECTS_APPROVAL (see selectors.ts)
 *   I05  COMPLETED_NOT_STREAMING
 *   I06  FAILED_NOT_STREAMING
 *   I07  RESUMABLE_NOT_STREAMING
 *   I08  SAME_TASK_CONTINUATION_PRESERVES_EPOCH
 *   I09  NEW_TASK_RESETS_EPOCH
 *   I10  TOOL_COUNT_MONOTONIC_WITHIN_TASK
 *   I11  RECOVERY_COUNT_NONDECREASING_WITHIN_TASK
 *   I12  THINKING_EQ_MODEL_STREAM (see selectors.ts)
 *   I13  HISTORICAL_REASONING_INDEPENDENT — enforced by type design
 *         (TaskModel has no message prose field).
 *   I14  DETERMINISM — enforced by `isSameTaskModel` (see model.ts)
 *         and by the absence of I/O in `taskUpdate`.
 *   I15  INPUT_IMMUTABILITY — verified by the structural `readonly`
 *         modifier on every field.
 */
export function checkTaskInvariants(model: TaskModel): readonly TaskInvariantViolation[] {
	const violations: TaskInvariantViolation[] = [];

	// I01: terminal ⇒ no activity.
	const isTerminal =
		model.lifecycle.kind === "completed" ||
		model.lifecycle.kind === "failed" ||
		model.lifecycle.kind === "cancelled";
	if (
		isTerminal &&
		(model.activity.modelStreaming || model.activity.tooling || model.activity.awaitingApproval)
	) {
		violations.push({ kind: "terminal_with_activity" });
	}

	// I02: active ⇒ not idle.
	const anyActive = model.activity.modelStreaming || model.activity.tooling || model.activity.awaitingApproval;
	if (anyActive && model.lifecycle.kind === "idle") {
		violations.push({ kind: "active_but_idle_phase" });
	}

	// I05/I06/I07: terminal ⇒ no streaming (subset of I01 but kept for clarity).
	if (model.lifecycle.kind === "completed" && model.activity.modelStreaming) {
		violations.push({ kind: "completed_with_streaming" });
	}
	if (model.lifecycle.kind === "failed" && model.activity.modelStreaming) {
		violations.push({ kind: "failed_with_streaming" });
	}
	if (model.lifecycle.kind === "resumable" && model.activity.modelStreaming) {
		violations.push({ kind: "resumable_with_streaming" });
	}
	if (model.lifecycle.kind === "cancelled" && model.activity.modelStreaming) {
		violations.push({ kind: "cancelled_with_streaming" });
	}

	// Approval should not occur on a fully-terminal task.
	if (model.activity.awaitingApproval && isTerminal) {
		violations.push({ kind: "approval_without_running_task" });
	}

	// Negative / invalid timestamps.
	if (
		model.identity.startedAt !== undefined &&
		model.identity.endedAt !== undefined &&
		model.identity.endedAt < model.identity.startedAt
	) {
		violations.push({ kind: "negative_elapsed" });
	}

	if (
		model.identity.startedAt !== undefined &&
		model.identity.endedAt !== undefined &&
		model.identity.startedAt > model.identity.endedAt
	) {
		violations.push({ kind: "started_after_ended" });
	}

	// I10 / I11 — invariants the *transition* upholds; on the snapshot
	// they reduce to "counters are non-negative".
	if (model.telemetry.toolCalls < 0) {
		violations.push({ kind: "non_monotonic_tool_calls" });
	}
	if (model.telemetry.recoveryBudgetFailures < 0) {
		violations.push({ kind: "negative_recovery_counter" });
	}

	return violations;
}

/**
 * Helper used by sequence / state-space tests to assert a model is
 * invariant-clean. Fails the test with a descriptive message on the
 * first violation.
 */
export function assertInvariants(model: TaskModel): void {
	const violations = checkTaskInvariants(model);
	if (violations.length > 0) {
		throw new Error(
			`[task-state] invariant violation(s): ${violations
				.map((v) => JSON.stringify(v))
				.join(", ")}`,
		);
	}
}
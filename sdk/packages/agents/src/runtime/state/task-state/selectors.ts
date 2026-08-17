/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / E4 — Pure projections.
 *
 * Every projection is a deterministic function `TaskModel → T` for
 * some read-only value type. The shadow comparator (Phase 14) and the
 * webview consumer cutover (E7) consume these projections.
 *
 * Projections never mutate input, never read clocks except where
 * the projection explicitly takes `now` as a parameter, and never
 * touch globals (ELM05).
 *
 * NOTE: The webview's `TurnPhase` / `TurnState` types live in the
 * VSCode host (`apps/vscode/src/shared/ExtensionMessage.ts`), NOT in
 * `@cline/shared`. We therefore introduce a SHADOW-LOCAL phase
 * taxonomy that the host-side differential comparator maps onto
 * the legacy `TurnPhase` (Phase 14 — `apps/vscode/src/sdk/...`).
 * Phase 20 (PUBLIC API discipline): `@cline/shared` change = 0.
 */
import { noEffect, type TaskEffect } from "./effects";
import type { TaskModel } from "./model";

/**
 * Shadow-local phase taxonomy. Mirrors the legacy `TurnPhase` so the
 * host-side comparator can compare them directly, but stays
 * `@cline/agents`-internal (Phase 20: no public SDK API expansion).
 */
export type ShadowTurnPhase =
	| "idle"
	| "streaming"
	| "awaiting_approval"
	| "awaiting_followup"
	| "completed"
	| "error"
	| "resumable";

/**
 * Map the shadow lifecycle/activity axes onto the shadow `TurnPhase`
 * taxonomy. Mirrors the precedence table in Phase 9 of the ACT.
 *
 * The `running` lifecycle with NO activity projects to `idle` —
 * the agent has not actually produced any visible work in the
 * current turn. This matches the legacy host's behavior: the
 * `TurnStateTracker.phase` is "idle" until a turn actually streams
 * or runs a tool; `task_requested` alone does not flip the phase
 * to "streaming".
 */
export function projectTurnState(model: TaskModel): ShadowTurnPhase {
	if (model.activity.awaitingApproval) return "awaiting_approval";
	if (model.activity.modelStreaming || isTooling(model)) return "streaming";
	switch (model.lifecycle.kind) {
		case "completed":
			return "completed";
		case "failed":
			return "error";
		case "resumable":
			return "resumable";
		case "cancelled":
			return "resumable";
		case "running":
			// Running lifecycle but no activity ⇒ between turns.
			// Matches the legacy host's "no visible work yet" rule.
			return "idle";
		case "idle":
			return "idle";
		default: {
			const exhaustive: never = model.lifecycle;
			void exhaustive;
			return "idle";
		}
	}
}

/**
 * Pure projection: true iff at least one tool call is currently in flight.
 * CORRECTION01 R1: derived from `activeToolCallIds.length > 0`, not a
 * single boolean field. Parallel tool calls are accurately reflected.
 */
export function isTooling(model: TaskModel): boolean {
	return model.activity.activeToolCallIds.length > 0;
}

/**
 * Combined projection that takes a `TaskModel` plus the host-side
 * `awaitingFollowup` boolean (which lives outside the runtime boundary).
 */
export function projectHostTurnState(
	model: TaskModel,
	hostInteraction: { readonly awaitingFollowup: boolean },
): ShadowTurnPhase {
	if (hostInteraction.awaitingFollowup) return "awaiting_followup";
	return projectTurnState(model);
}

/**
 * Pure boolean projection used by the in-list "Thinking" shimmer.
 * I12 makes the equivalence to `modelStreaming` explicit and named.
 */
export function projectThinking(model: TaskModel): boolean {
	return model.activity.modelStreaming;
}

/**
 * Predicate suite. These mirror the host's "controls enabled" matrix.
 * Pure; tests can assert every transition's effect on the controls.
 */
export interface TaskControlsProjection {
	readonly canCancel: boolean;
	readonly canStartNewTask: boolean;
	readonly canSubmitFollowup: boolean;
}

export function projectControls(model: TaskModel): TaskControlsProjection {
	const inFlight =
		model.lifecycle.kind === "running" ||
		model.activity.modelStreaming ||
		isTooling(model) ||
		model.activity.awaitingApproval;
	const terminal =
		model.lifecycle.kind === "completed" ||
		model.lifecycle.kind === "failed" ||
		model.lifecycle.kind === "cancelled" ||
		model.lifecycle.kind === "resumable";
	return {
		canCancel: inFlight,
		canStartNewTask: terminal,
		canSubmitFollowup: terminal,
	};
}

/**
 * Convenience predicates (ELM05). Each is a thin wrapper over
 * `projectControls` to make call sites self-documenting.
 */
export function canCancel(model: TaskModel): boolean {
	return projectControls(model).canCancel;
}
export function canStartNewTask(model: TaskModel): boolean {
	return projectControls(model).canStartNewTask;
}
export function canSubmitFollowup(model: TaskModel): boolean {
	return projectControls(model).canSubmitFollowup;
}

/**
 * Pure elapsed projection. The ticker remains UI-owned (Phase 9
 * explicitly says so); this only resolves the *value* at one moment
 * of interest.
 */
export function projectElapsedMs(model: TaskModel, now: number): number {
	if (model.identity.startedAt === undefined) return 0;
	const end = model.identity.endedAt ?? now;
	const delta = end - model.identity.startedAt;
	return delta > 0 ? delta : 0;
}

/**
 * Telemetry projection. Deliberately a subset of the cumulative
 * counters already exposed by `TaskTelemetryTracker` — context /
 * token accounting is OUT OF SCOPE (ELM12).
 */
export interface TaskTelemetryProjection {
	readonly toolCalls: number;
	readonly recoveryBudgetFailures: number;
}

export function projectTelemetry(model: TaskModel): TaskTelemetryProjection {
	return {
		toolCalls: model.telemetry.toolCalls,
		recoveryBudgetFailures: model.telemetry.recoveryBudgetFailures,
	};
}

/**
 * Adapter helper for the differential comparator. The comparator
 * derives its own monotonic sequence numbers; this projection
 * intentionally does NOT read the host's `MessageIdMinter` (ELM02).
 */
export interface ShadowTurnRecord {
	readonly phase: ShadowTurnPhase;
	readonly anchorTs: undefined;
}

export function projectTurnStateRecord(model: TaskModel): ShadowTurnRecord {
	return {
		phase: projectTurnState(model),
		anchorTs: undefined,
	};
}

/**
 * Pure helper for the mutation campaign: a fresh effect token used
 * to detect "shadow wrote back into the legacy runtime" attempts.
 * The shadow adapter must NEVER call `TurnStateTracker.set()` or any
 * authority writer; this re-export exists so a test can spy on the
 * export and verify the import graph.
 */
export function shadowOnlyEffect(): TaskEffect {
	return noEffect();
}
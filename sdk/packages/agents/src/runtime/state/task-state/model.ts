/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / E1 — Canonical TaskModel.
 *
 * The Elm Architecture (TEA) `Model` for the visible task. Pure data,
 * `readonly` everywhere, no class semantics, no methods, no I/O.
 *
 * Boundaries (mirroring `runtime/state/execution-state.ts` and
 * `runtime/state/index.ts`):
 *
 *   - Package-internal to `@cline/agents`.
 *   - No cross-package wire contract in E0–E4.
 *   - The host's `TurnStateTracker`, `TaskTelemetryTracker`, and
 *     `AgentRuntime` remain the production authorities; this is
 *     shadow-mode only (ELM07 / ELM08).
 *
 * Composition rules:
 *
 *   - `identity`   — visible task identity & wall-clock anchors.
 *   - `lifecycle`  — orthogonal to activity. Closed tagged union.
 *                    No `streaming` here; that is activity.
 *   - `activity`   — orthogonal booleans for the three axes already
 *                    established by RSMT01 (`modelStreaming`,
 *                    `tooling`, `awaitingApproval`). See
 *                    `runtime/state/execution-state.ts` for the
 *                    precedent. Forced into a single tagged union
 *                    would lose the orthogonal precedence rules;
 *                    the booleans stay.
 *   - `recovery`   — the already-public-safe projection that
 *                    `AgentRuntimeRecoverySnapshot` exposes.
 *                    Used only to fold the cumulative
 *                    `recoveryBudgetFailures` counter on telemetry.
 *                    Raw `controlKey` / `controlFamily` never enter.
 *   - `telemetry`  — the cumulative counters the host already
 *                    tracks (`toolCalls`, `recoveryBudgetFailures`).
 *                    Context/token accounting is OUT OF SCOPE —
 *                    untouched by this ACT (ELM12).
 */
import type { RecoveryState } from "@cline/shared";

/**
 * Visible task identity. Held by the host (TaskId from `HistoryItem`).
 * The runtime/session split is deliberately not modelled here.
 */
export interface TaskIdentityState {
	readonly taskId?: string;
	readonly sessionId?: string;
	/** Wall-clock ms epoch when the visible task was created. */
	readonly startedAt?: number;
	/**
	 * Wall-clock ms epoch when the visible task reached its current
	 * terminal phase, or `undefined` while the task is still active.
	 * Cleared on same-task continuation.
	 */
	readonly endedAt?: number;
}

/**
 * Lifecycle is orthogonal to activity. Closed tagged union so unknown
 * states cannot silently fall through (ELM03).
 */
export type TaskLifecycleState =
	| { readonly kind: "idle" }
	| { readonly kind: "running" }
	| { readonly kind: "completed" }
	| { readonly kind: "failed"; readonly reason?: TaskFailureClass }
	| { readonly kind: "resumable" }
	| { readonly kind: "cancelled" };

/**
 * Coarse classification of a failed lifecycle. Mirrors `ProviderErrorClass`
 * taxonomy already used by `AgentRuntime`; finer classifications belong
 * to the recovery projection.
 */
export type TaskFailureClass =
	| "auth"
	| "rate_limit"
	| "context_overflow"
	| "network"
	| "provider_error"
	| "unknown";

/**
 * Activity is orthogonal to lifecycle. Mirrors the RSMT01 axes
 * established by `AgentRuntimeExecutionState`; the booleans stay
 * distinct because each has its own precedence in the
 * `projectTurnState` projection.
 */
export interface TaskActivityState {
	readonly modelStreaming: boolean;
	/** Derived from the runtime's `pendingToolCalls.length > 0`. */
	readonly tooling: boolean;
	readonly awaitingApproval: boolean;
}

/**
 * Safe projection of the runtime's recovery state. Deliberately narrow:
 * only the fields already public on `AgentRuntimeRecoverySnapshot`'s
 * external surface. No raw `controlKey` / `controlFamily` (ELM10).
 */
export interface TaskRecoveryProjection {
	readonly state: RecoveryState;
	/**
	 * Bounded-recovery episode counter. Same value the host already
	 * folds into `taskTelemetry.recoveryBudgetFailures`. Mirrored
	 * here so the shadow model can reason about the cumulative
	 * delta clamp itself, independently of the host's tracker.
	 */
	readonly episodeFailures: number;
	readonly circuitNoticeCount: number;
}

/**
 * Cumulative task counters the host tracks on the wire. Mirrors
 * `TaskHeaderTelemetryStrip`. Token / context accounting is intentionally
 * absent (ELM12).
 */
export interface TaskTelemetryState {
	readonly toolCalls: number;
	readonly recoveryBudgetFailures: number;
}

/**
 * Canonical shadow TaskModel. Composed exclusively from orthogonal
 * sub-states; no `streaming` here on purpose — streaming is activity.
 */
export interface TaskModel {
	readonly identity: TaskIdentityState;
	readonly lifecycle: TaskLifecycleState;
	readonly activity: TaskActivityState;
	readonly recovery: TaskRecoveryProjection;
	readonly telemetry: TaskTelemetryState;
}

/**
 * Initial model for a brand-new (no task yet) shadow instance.
 * Mirrors the projection the existing host sends over gRPC before any
 * task is started.
 */
export function initialTaskModel(): TaskModel {
	return {
		identity: {},
		lifecycle: { kind: "idle" },
		activity: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
		recovery: {
			state: "idle",
			episodeFailures: 0,
			circuitNoticeCount: 0,
		},
		telemetry: {
			toolCalls: 0,
			recoveryBudgetFailures: 0,
		},
	};
}

/**
 * Structural equality over two `TaskModel`s. Used by deterministic
 * replay tests (I14) and by the differential comparator (Phase 14).
 * Pure; does not touch globals.
 */
export function isSameTaskModel(a: TaskModel, b: TaskModel): boolean {
	if (a.identity.taskId !== b.identity.taskId) return false;
	if (a.identity.sessionId !== b.identity.sessionId) return false;
	if (a.identity.startedAt !== b.identity.startedAt) return false;
	if (a.identity.endedAt !== b.identity.endedAt) return false;
	if (a.lifecycle.kind !== b.lifecycle.kind) return false;
	if (a.lifecycle.kind === "failed" && b.lifecycle.kind === "failed") {
		if (a.lifecycle.reason !== b.lifecycle.reason) return false;
	}
	if (a.activity.modelStreaming !== b.activity.modelStreaming) return false;
	if (a.activity.tooling !== b.activity.tooling) return false;
	if (a.activity.awaitingApproval !== b.activity.awaitingApproval) return false;
	if (a.recovery.state !== b.recovery.state) return false;
	if (a.recovery.episodeFailures !== b.recovery.episodeFailures) return false;
	if (a.recovery.circuitNoticeCount !== b.recovery.circuitNoticeCount) return false;
	if (a.telemetry.toolCalls !== b.telemetry.toolCalls) return false;
	if (a.telemetry.recoveryBudgetFailures !== b.telemetry.recoveryBudgetFailures) return false;
	return true;
}
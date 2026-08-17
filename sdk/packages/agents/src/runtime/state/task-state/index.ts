/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / E0–E4 — Package-internal barrel.
 *
 *   @cline/agents
 *   └─ runtime/state/
 *      ├─ execution-state.ts   (canonical AgentRuntimeExecutionState)
 *      └─ task-state/
 *         ├─ model.ts          (canonical TaskModel — E1)
 *         ├─ msg.ts            (closed TaskMsg algebra — E2)
 *         ├─ update.ts         (pure taskUpdate — E3)
 *         ├─ effects.ts        (TaskEffect algebra, non-executing)
 *         ├─ selectors.ts      (pure projections — E4)
 *         ├─ invariants.ts     (pure invariant library — Phase 10)
 *         └─ index.ts          (this file)
 *
 * SCOPE
 * -----
 * The Elm-Architecture task-state shadow lives next to `execution-state.ts`
 * because it is *general runtime/state* — NOT specific to recovery
 * (recovery lives in `runtime/recovery/`). Mirrors the existing
 * `runtime/state/index.ts` ownership convention.
 *
 * The exports are INTENTIONALLY package-internal. The TaskModel,
 * TaskMsg, TaskEffect, projections, and divergences stay inside
 * `@cline/agents`. The host (VSCode) reaches this module via the
 * shadow adapter only; webview cutover is deferred to E7.
 */
export type {
	TaskIdentityState,
	TaskLifecycleState,
	TaskActivityState,
	TaskRecoveryProjection,
	TaskTelemetryState,
	TaskModel,
	TaskFailureClass,
} from "./model";

export { initialTaskModel, isSameTaskModel } from "./model";

export type { TaskMsg, TaskRecoveryMsgProjection } from "./msg";
export { isTaskMsg, taskMsgType } from "./msg";

export type { TaskEffect } from "./effects";
export { EFFECT_EXECUTION_ENABLED, noEffect } from "./effects";

export type { UpdateResult } from "./update";
export { taskUpdate } from "./update";

export type { ShadowTurnPhase, ShadowTurnRecord, TaskControlsProjection, TaskTelemetryProjection } from "./selectors";
export {
	projectTurnState,
	projectHostTurnState,
	projectThinking,
	projectControls,
	canCancel,
	canStartNewTask,
	canSubmitFollowup,
	projectElapsedMs,
	projectTelemetry,
	projectTurnStateRecord,
	shadowOnlyEffect,
} from "./selectors";

export type { TaskInvariantViolation } from "./invariants";
export { checkTaskInvariants, assertInvariants } from "./invariants";
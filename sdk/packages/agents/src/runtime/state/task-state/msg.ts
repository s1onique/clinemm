/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / E2 — Closed TaskMsg algebra.
 *
 * A `TaskMsg` describes an event that **happened** — never the state
 * we want to project. Encoding projection state (e.g. `set_turn_state`
 * or `set_is_thinking`) is forbidden (ELM03 / ELM11).
 *
 * The algebra is closed: every variant carries an `at` ms epoch so
 * `taskUpdate` never reads `Date.now()`. IDs that need to flow in
 * carry an explicit field.
 *
 * Mapping note: `legacy event → TaskMsg`. The reverse direction
 * (`TaskModel → mutate legacy`) is forbidden in E0–E4 (ELM08).
 */
import type { RecoveryState } from "@cline/shared";
import type { TaskFailureClass } from "./model";

/**
 * Closed discriminated union of every message the shadow `TaskModel`
 * accepts. The compiler will refuse any `taskUpdate` switch that
 * forgets a variant (ELM03).
 */
export type TaskMsg =
	// -- Task identity / new-task requests ----------------------------
	| { readonly type: "task_requested"; readonly taskId: string; readonly at: number }
	| { readonly type: "session_started"; readonly sessionId: string; readonly at: number }
	| { readonly type: "task_reset"; readonly at: number }
	// -- Model-stream lifecycle --------------------------------------
	| { readonly type: "model_stream_started"; readonly at: number }
	| { readonly type: "model_stream_finished"; readonly at: number }
	// -- Tool lifecycle ----------------------------------------------
	| { readonly type: "tool_started"; readonly toolCallId: string; readonly at: number }
	| { readonly type: "tool_finished"; readonly toolCallId: string; readonly at: number }
	// -- Approval lifecycle ------------------------------------------
	| { readonly type: "approval_requested"; readonly at: number }
	| { readonly type: "approval_resolved"; readonly at: number }
	// -- Recovery projection delta ----------------------------------
	| {
			readonly type: "recovery_changed";
			readonly projection: TaskRecoveryMsgProjection;
			readonly at: number;
	  }
	// -- Terminal / continuation -------------------------------------
	| { readonly type: "task_completed"; readonly at: number }
	| { readonly type: "task_failed"; readonly classification: TaskFailureClass; readonly at: number }
	| { readonly type: "task_became_resumable"; readonly at: number }
	| { readonly type: "task_cancelled"; readonly at: number }
	| { readonly type: "same_task_continued"; readonly at: number };

/**
 * Safe projection of `AgentRuntimeRecoverySnapshot` carried on
 * `recovery_changed`. Deliberately narrow: only the fields the
 * shadow model folds into `TaskRecoveryProjection`. No raw
 * `controlKey` / `controlFamily` (ELM10).
 */
export interface TaskRecoveryMsgProjection {
	readonly state: RecoveryState;
	readonly episodeFailures: number;
	readonly circuitNoticeCount: number;
}

/**
 * Type guard — useful for adapter code that needs to defensively
 * narrow unknown payloads before producing a `TaskMsg`.
 */
export function isTaskMsg(value: unknown): value is TaskMsg {
	if (!value || typeof value !== "object") return false;
	const r = value as Record<string, unknown>;
	return typeof r.type === "string" && typeof r.at === "number";
}

/**
 * Human-readable variant label. Used by the divergence evidence path
 * (Phase 15) and by debug logs; never used to switch on a variant
 * (the discriminated union already discriminates).
 */
export function taskMsgType(msg: TaskMsg): string {
	return msg.type;
}
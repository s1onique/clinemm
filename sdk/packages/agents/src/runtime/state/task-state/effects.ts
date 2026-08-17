/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 8 — TaskEffect algebra.
 *
 * Effects are returned by `taskUpdate` as **data**, never executed
 * inside the reducer (ELM04). During E0–E4, `EFFECT_EXECUTION_ENABLED`
 * is `false`; the shadow adapter discards these effects after
 * recording them on the observation surface.
 *
 * The taxonomy mirrors the actions an eventual TEA authority
 * *would* request. None are performed in this ACT.
 */
export type TaskEffect =
	| { readonly type: "none" }
	| { readonly type: "post_state" }
	| { readonly type: "persist_task" }
	| { readonly type: "request_model" }
	| { readonly type: "execute_tool"; readonly toolCallId: string }
	| { readonly type: "request_approval" };

/**
 * Always-`true` during E0–E4. Cutover ACTs flip this when they wire
 * the effect interpreter.
 */
export const EFFECT_EXECUTION_ENABLED = false as const;

/**
 * Sentinel used when a reducer branch has nothing to request. Returning
 * a fresh object every call keeps the effect stream structurally
 * identifiable and easy to deep-equal in tests.
 */
export function noEffect(): TaskEffect {
	return { type: "none" };
}
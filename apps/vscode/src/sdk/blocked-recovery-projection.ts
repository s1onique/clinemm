/**
 * ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01 — BRPU01
 *
 * CORRECTION01: the producer accessor on `SdkSessionEventCoordinator`
 * is now `getCurrentDeferredCompletionBarrier()` (the production read
 * path). The test-only `*ForTesting` alias is kept for existing test
 * sites but is NOT the production read path.
 *
 * Pure read-only projection of the host's current blocked-recovery
 * state for the wire.
 *
 * The BCB barrier in `SdkSessionEventCoordinator` is the single source
 * of truth; this projection NEVER mutates the barrier, NEVER increments
 * `runtimeErrorCount`, and NEVER recomputes the held set. The field is
 * set ONLY when the barrier is present AND its
 * `reason === "observation_unavailable"`.
 *
 * C5.1 invariant: this is a read operation. No diagnostic side
 * effects, no new incident registration, no continuation trigger,
 * no Elm model mutation.
 *
 * The function is exported as a standalone pure helper so that
 * unit tests can exercise the projection logic without instantiating
 * the full SdkController (which requires a vscode ExtensionContext).
 * The SdkController calls this helper with the live BCB barrier
 * (the shape returned by `getCurrentDeferredCompletionBarrier()`).
 */

import type { BlockedRecoveryProjection, BlockedRecoveryReason } from "@shared/ExtensionMessage"

export interface DeferredCompletionBarrierRead {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly epoch: number
	readonly reason?: "stalled_no_progress" | "delivery_rejected" | "observation_unavailable" | undefined
}

/**
 * The single closed-enum reason that projects onto the wire. Other
 * BCB barrier reasons (`stalled_no_progress`, `delivery_rejected`)
 * mean "wait for reevaluation", not "no path forward", and therefore
 * do NOT disable the ordinary Retry affordance.
 */
const PROJECTED_REASON: BlockedRecoveryReason = "observation_unavailable"

/**
 * Project the host's current blocked-recovery state onto the wire.
 *
 * @param barrier The current BCB barrier (or undefined when no marker
 *                is registered). This is a pure input; the function
 *                never mutates it.
 * @returns The wire projection, or undefined when no active recovery
 *          restriction applies.
 */
export function projectBlockedRecovery(
	barrier: DeferredCompletionBarrierRead | undefined,
): BlockedRecoveryProjection | undefined {
	if (!barrier) return undefined
	if (barrier.reason !== PROJECTED_REASON) return undefined
	return {
		reason: PROJECTED_REASON,
		sessionId: barrier.sessionId,
		taskId: barrier.taskId,
		enqueueEpoch: barrier.epoch,
	}
}

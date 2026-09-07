/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (nineteenth-pass) — pure projection helper for the
 * Boundary 3 -> 4 carrier.
 *
 * Extracts the W-transport step out of `getStateToPostToWebview`
 * so the projection can be unit-tested WITHOUT a live
 * extension host (which the bigger producer requires for
 * its banners / endpoint / variant singletons).
 *
 * The transport contract is:
 *   - input: a `WorkingContextHostCaptureState` (anything
 *     that exposes `currentWorkingContextEstimate: number | null`)
 *   - output: a partial ExtensionState containing exactly
 *     the W field, plus optional drop-out semantics when
 *     no carrier is provided.
 *
 * Transport-only: the function does NOT estimate or
 * transform the value. It does NOT call
 * `estimateRequestInputTokens` or `estimateMessageTokens`
 * — those are forbidden by the P3 conservation rule
 * (verified by the production-code probe test).
 *
 * UNDEFINED_W_STALE_REUSE = FORBIDDEN: the projection
 * passes the carrier's value through verbatim (assignment
 * semantics); the carrier (see
 * `apps/vscode/src/sdk/working-context-host-capture.ts`)
 * is responsible for keeping the captured value honest
 * (it uses unconditional assignment, no conditional
 * skip).
 *
 * (twenty-first-pass) — Boundary 5: the carrier's
 * surface type is `number | null`. When the carrier
 * is absent (legacy / classic path), this helper
 * emits `undefined` so the downstream ChatView can
 * distinguish "carrier absent" (fall back to P)
 * from "runtime cleared" (render UNAVAILABLE per
 * reviewer twentieth-pass fallback B).
 */

import type { ExtensionState } from "@shared/ExtensionMessage"
import type { WorkingContextHostCaptureState } from "@/sdk/working-context-host-capture"

/**
 * The subset of ExtensionState this helper is allowed
 * to emit. Production code passes the result back into
 * the bigger ExtensionState projection produced by
 * `getStateToPostToWebview`.
 */
export type WorkingContextProjection = Pick<
	ExtensionState,
	"currentWorkingContextEstimate"
>

/**
 * Project the current working-context estimate (W) from
 * the host-side carrier into a partial ExtensionState
 * payload.
 *
 * Contract:
 *   - When the carrier is absent (legacy / classic path,
 *     or during tests that exercise the producer with
 *     no Boundary 3 -> 4 wiring), the projection emits
 *     `{ currentWorkingContextEstimate: undefined }`.
 *     The downstream ChatView falls back to P per
 *     `UNDEFINED_W_FALLBACK` (decided separately).
 *   - When the carrier is present, the projection
 *     passes the carrier's value through verbatim —
 *     INCLUDING `null`, which the carrier emits when
 *     the runtime published a no-W
 *     `working-context-state-changed` event.
 *   - The value is NEVER recomputed, estimated, or
 *     transformed. No estimator imports.
 *
 * This is a PURE function (no side effects, no module
 * singletons). It is safe to unit-test in isolation.
 */
export function projectWorkingContextStateFromCarrier(
	carrier: WorkingContextHostCaptureState | undefined,
): WorkingContextProjection {
	return {
		currentWorkingContextEstimate: carrier?.currentWorkingContextEstimate,
	}
}

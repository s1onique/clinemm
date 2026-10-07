/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-CORRECTION01-FAILURE-CACHE-SCOPE
 *
 * Production-side TaskHeader presentation authority.
 *
 * The Elm kernel is the SOLE semantic authority for the
 * TaskHeader presentation projection. React renders the projection;
 * TypeScript collects inputs, loads/initializes the Elm kernel, and
 * decodes the Elm result into the existing TS type shape.
 *
 * Failure policy (frozen — bounded sentinel per
 * CORRECTION01-FAILURE-CACHE-SCOPE):
 *   - On `kernel_offline`, `decode_error`, OR a synchronous throw,
 *     return the bounded sentinel
 *     `{ phase: "idle", source: "host", seq: input.seq }`
 *     where `input.seq` is the CURRENT publication seq.
 *   - The previous "hold last successful result" cache was REMOVED.
 *     The cache was module-scoped (no task/session identity in scope),
 *     so it could leak a successful result from one task into the
 *     failure fallback of another task, AND it published a projection
 *     whose `seq` was stale relative to the current input — a direct
 *     violation of the seq-preservation invariant.
 *
 * Why option A (bounded sentinel) was selected over option B
 * (scoped cache + explicit reset at task lifecycle boundary):
 *   - The SdkController publication seam (SdkController.ts:5880)
 *     does NOT have task/session identity in scope; the only inputs
 *     are the legacy tracker phases and seq. There is no clean
 *     boundary to plug a "reset at task boundary" hook.
 *   - The completion-authority precedent (CORRECTION01-REAL-ELM-PROVIDER)
 *     uses a per-session Map keyed on sessionId and maps the absent
 *     case (`lastDecision === null`) to a `failure` decision — NOT
 *     to a held last-good. So there is no proven user-visible
 *     invariant that requires "hold last good" here.
 *   - The bounded sentinel is causally valid (current input.seq is
 *     preserved), cannot bleed state across tasks, and still
 *     satisfies the load-bearing rule
 *     "Elm failure ≠ TS semantic fallback".
 *
 * Dependency injection (test seam): `invokeElmForProduction` lets
 * tests inject a fake Elm provider so RED witnesses can drive
 * deliberate authority decisions without mutating
 * `globalThis.Elm`.
 */

import type { TaskHeaderPresentationProjection, TurnPhase } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { invokeElmKernel, type TaskHeaderElmDecision, type TaskHeaderElmFactsJson } from "./task-header-elm-shadow"

export interface TaskHeaderElmAuthorityInputs {
	readonly canonicalShadowPhase: TurnPhase | undefined
	readonly currentLegacyPhase: TurnPhase
	readonly seq: number
	readonly canonicalShadowObservedTurnSeq: number | undefined
}

// CORRECTION01-FAILURE-CACHE-SCOPE: the previous module-scoped cache
// `_lastSuccessfulPresentation` was REMOVED. It leaked across tasks
// (no task identity in scope here) and published a projection with a
// stale `seq` (seq-preservation invariant). The bounded sentinel
// below takes the CURRENT `input.seq` and never crosses a task
// boundary. Counters are still per-module by design — they are a
// single, monotonically increasing diagnostic record, not state.
let _kernelOfflineCounter = 0
let _decodeErrorCounter = 0

function boundedIdleHostSentinel(seq: number): TaskHeaderPresentationProjection {
	return { phase: "idle", source: "host", seq }
}

/**
 * Production-side authority: drive the Elm kernel and return the
 * TaskHeader presentation projection. On any Elm failure
 * (`kernel_offline`, `decode_error`, or synchronous throw), return
 * the bounded sentinel `{ phase: "idle", source: "host", seq }` using
 * the CURRENT input.seq. No hold-last-good, no TS semantic fallback.
 */
export async function pickTaskHeaderPresentationForPublication(
	inputs: TaskHeaderElmAuthorityInputs,
	options?: {
		readonly invokeElmForProduction?: (facts: TaskHeaderElmFactsJson) => Promise<TaskHeaderElmDecision>
	},
): Promise<TaskHeaderPresentationProjection> {
	const invoke = options?.invokeElmForProduction ?? invokeElmKernel
	const facts: TaskHeaderElmFactsJson = {
		canonicalShadowPhase: inputs.canonicalShadowPhase ?? null,
		currentLegacyPhase: inputs.currentLegacyPhase,
		seq: inputs.seq,
		canonicalShadowObservedTurnSeq: inputs.canonicalShadowObservedTurnSeq ?? null,
	}
	let decision: TaskHeaderElmDecision
	try {
		decision = await invoke(facts)
	} catch (err) {
		// CORRECTION01: bounded sentinel, current input.seq.
		Logger.error(`[task-header-elm-authority] kernel threw: ${err instanceof Error ? err.message : String(err)}`)
		return boundedIdleHostSentinel(inputs.seq)
	}
	if (decision.kind === "presentation") {
		return decision.value
	}
	if (decision.kind === "kernel_offline") {
		_kernelOfflineCounter += 1
		Logger.error(`[task-header-elm-authority] kernel offline (count=${_kernelOfflineCounter})`)
		// CORRECTION01: bounded sentinel, current input.seq.
		return boundedIdleHostSentinel(inputs.seq)
	}
	_decodeErrorCounter += 1
	Logger.error(`[task-header-elm-authority] decode error: ${decision.reason} (count=${_decodeErrorCounter})`)
	// CORRECTION01: bounded sentinel, current input.seq.
	return boundedIdleHostSentinel(inputs.seq)
}

/**
 * Test seam — reset the diagnostic counters.
 *
 * CORRECTION01: the previous cache reset is GONE — there is no
 * module-scoped cache to reset. Only counters remain (they are a
 * single monotonically increasing diagnostic record).
 */
export function resetTaskHeaderElmAuthorityForTests(): void {
	_kernelOfflineCounter = 0
	_decodeErrorCounter = 0
}

export function getTaskHeaderElmAuthorityCounters(): {
	readonly kernelOffline: number
	readonly decodeError: number
} {
	return { kernelOffline: _kernelOfflineCounter, decodeError: _decodeErrorCounter }
}

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
 *
 * Production-side TaskHeader presentation authority.
 *
 * The Elm kernel is the SOLE semantic authority for the
 * TaskHeader presentation projection. React renders the projection;
 * TypeScript collects inputs, loads/initializes the Elm kernel, and
 * decodes the Elm result into the existing TS type shape.
 *
 * Failure policy (frozen — preferred per ACT §C2):
 *   - On `kernel_offline` or `decode_error`, hold the last successful
 *     Elm result (no silent TS selector recomputation). With NO prior
 *     successful result, return the bounded sentinel
 *     `{ phase: "idle", source: "host", seq: input.seq }`.
 *   - On any synchronous throw, also hold the last successful result.
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

let _lastSuccessfulPresentation: TaskHeaderPresentationProjection | null = null
let _kernelOfflineCounter = 0
let _decodeErrorCounter = 0

function boundedIdleHostSentinel(seq: number): TaskHeaderPresentationProjection {
	return { phase: "idle", source: "host", seq }
}

/**
 * Production-side authority: drive the Elm kernel and return the
 * TaskHeader presentation projection. Fail-closed: hold the last
 * successful Elm result; if none, return the bounded sentinel.
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
		Logger.error(`[task-header-elm-authority] kernel threw: ${err instanceof Error ? err.message : String(err)}`)
		return _lastSuccessfulPresentation ?? boundedIdleHostSentinel(inputs.seq)
	}
	if (decision.kind === "presentation") {
		_lastSuccessfulPresentation = decision.value
		return decision.value
	}
	if (decision.kind === "kernel_offline") {
		_kernelOfflineCounter += 1
		Logger.error(`[task-header-elm-authority] kernel offline (count=${_kernelOfflineCounter})`)
		return _lastSuccessfulPresentation ?? boundedIdleHostSentinel(inputs.seq)
	}
	_decodeErrorCounter += 1
	Logger.error(`[task-header-elm-authority] decode error: ${decision.reason} (count=${_decodeErrorCounter})`)
	return _lastSuccessfulPresentation ?? boundedIdleHostSentinel(inputs.seq)
}

/** Test seam — reset the cached last-successful presentation and counters. */
export function resetTaskHeaderElmAuthorityForTests(): void {
	_lastSuccessfulPresentation = null
	_kernelOfflineCounter = 0
	_decodeErrorCounter = 0
}

export function getTaskHeaderElmAuthorityCounters(): {
	readonly kernelOffline: number
	readonly decodeError: number
} {
	return { kernelOffline: _kernelOfflineCounter, decodeError: _decodeErrorCounter }
}

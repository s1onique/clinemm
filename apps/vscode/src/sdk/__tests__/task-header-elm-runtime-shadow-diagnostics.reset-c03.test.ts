/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS
 *
 * Tests for the bounded observation-ring reset semantics.
 *
 * EVIDENCE CLASSIFICATION: SYNTHETIC_REAL.
 *   The reset helper is the SAME `resetTaskHeaderElmRuntimeShadowObservations`
 *   export the extension.ts command handler invokes when the operator
 *   picks "Reset Observations" from the QuickPick menu.
 *
 * Required test coverage (per ACT §C5, §C11):
 *
 *   RST-01:
 *     append observations, assert count > 0, reset,
 *     assert ring = [], summary.evaluations = 0.
 *   RST-02:
 *     reset does NOT touch the runtime-shadow enabled flag.
 *   RST-03:
 *     reset does NOT alter the TS projection returned by
 *     `observeTaskHeaderElmRuntimeShadow`.
 *   RST-04:
 *     reset does NOT alter the Elm adapter/kernel state
 *     (where directly observable via the seam API).
 *   RST-05:
 *     reset on an empty ring is a safe no-op.
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
	applyTaskHeaderElmRuntimeShadowDiagnosticProfile,
} from "../dogfood-diagnostic-profile"
import {
	clearTaskHeaderElmRuntimeShadowObservations,
	getTaskHeaderElmRuntimeShadowObservations,
	invokeElmKernel,
	isTaskHeaderElmRuntimeShadowEnabled,
	observeTaskHeaderElmRuntimeShadow,
	resetTaskHeaderElmRuntimeShadowForTests,
	resetTaskHeaderElmRuntimeShadowObservations,
	setTaskHeaderElmRuntimeShadowEnabled,
	summarizeTaskHeaderElmRuntimeShadowObservations,
	type TaskHeaderElmFactsJson,
} from "../task-header-elm-shadow"

const SAMPLE_FACTS: TaskHeaderElmFactsJson = {
	canonicalShadowPhase: "idle",
	currentLegacyPhase: "idle",
	seq: 1,
	canonicalShadowObservedTurnSeq: 1,
}

const SAMPLE_TS = { phase: "idle" as const, source: "shadow" as const, seq: 1 }

beforeEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
	clearTaskHeaderElmRuntimeShadowObservations()
})

describe("ACT-CLINEMM-...-CORRECTION01 / RST-01..05: resetTaskHeaderElmRuntimeShadowObservations", () => {
	it("RST-01: append observations -> reset -> ring = [], summary.evaluations = 0", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const obs = await observeTaskHeaderElmRuntimeShadow({ ts: SAMPLE_TS, facts: SAMPLE_FACTS })
		expect(obs).toStrictEqual(SAMPLE_TS)
		const before2 = await observeTaskHeaderElmRuntimeShadow({ ts: SAMPLE_TS, facts: SAMPLE_FACTS })
		expect(before2).toStrictEqual(SAMPLE_TS)
		// pre-reset sanity: ring is non-empty
		const pre = getTaskHeaderElmRuntimeShadowObservations()
		expect(pre.length).toBeGreaterThan(0)
		resetTaskHeaderElmRuntimeShadowObservations()
		const post = getTaskHeaderElmRuntimeShadowObservations()
		expect(post.length).toBe(0)
		expect(summarizeTaskHeaderElmRuntimeShadowObservations(post)).toEqual({
			evaluations: 0,
			matches: 0,
			mismatchPhase: 0,
			mismatchSource: 0,
			mismatchSeq: 0,
			kernelOffline: 0,
			decodeErrors: 0,
		})
	})

	it("RST-02: reset does NOT touch the runtime-shadow enabled flag", () => {
		applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, true)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
		resetTaskHeaderElmRuntimeShadowObservations()
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
		// And in public profile: still OFF after reset.
		applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
		resetTaskHeaderElmRuntimeShadowObservations()
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})

	it("RST-03: reset does NOT alter the TS projection returned by observeTaskHeaderElmRuntimeShadow", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const before = await observeTaskHeaderElmRuntimeShadow({ ts: SAMPLE_TS, facts: SAMPLE_FACTS })
		resetTaskHeaderElmRuntimeShadowObservations()
		const after = await observeTaskHeaderElmRuntimeShadow({ ts: SAMPLE_TS, facts: SAMPLE_FACTS })
		expect(after).toStrictEqual(before)
		expect(after).toStrictEqual(SAMPLE_TS)
	})

	it("RST-04: reset does NOT alter the Elm adapter/kernel state (invokeElmKernel still reachable)", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const beforeDecision = await invokeElmKernel(SAMPLE_FACTS)
		resetTaskHeaderElmRuntimeShadowObservations()
		const afterDecision = await invokeElmKernel(SAMPLE_FACTS)
		expect(afterDecision.kind).toBe(beforeDecision.kind)
		if (afterDecision.kind === "presentation" && beforeDecision.kind === "presentation") {
			expect(afterDecision.value).toStrictEqual(beforeDecision.value)
		}
	})

	it("RST-05: reset on an empty ring is a safe no-op (no throw, ring stays empty)", () => {
		expect(() => resetTaskHeaderElmRuntimeShadowObservations()).not.toThrow()
		const post = getTaskHeaderElmRuntimeShadowObservations()
		expect(post.length).toBe(0)
	})
})

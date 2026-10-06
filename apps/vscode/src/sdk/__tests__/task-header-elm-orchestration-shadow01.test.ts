/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 (C6 / C9)
 *
 * Differential correspondence test for the TaskHeader orchestration
 * Elm kernel.
 *
 * For every reference fixture in
 * `task-header-elm-orchestration-shadow01.fixtures.ts`, this test:
 *
 *   1. Calls the production TS selector
 *      (`selectTaskHeaderPresentation`) and asserts the result matches
 *      the fixture's `expected` value (this is the production-seam
 *      exercise required by ACT §C3 — we do NOT test constants declared
 *      by the test itself; we test the actual selector against the
 *      fixture table).
 *
 *   2. Drives the same input quadruple through the compiled Elm
 *      kernel via `task-header-elm-shadow.invokeElmKernel()` and
 *      asserts that the Elm decision equals the TS production decision
 *      on `phase`, `source`, and `seq` (the three semantic outputs).
 *
 *   3. Records the FSM classification of any mismatch (TS contract
 *      defect, Elm defect, adapter defect, stale fixture, or
 *      unresolved authority / binding ambiguity). A mismatch that
 *      cannot be classified as anything other than "TS == Elm is the
 *      success criterion" is a HARD HALT per ACT §C6
 *      (`HALT_ELM_TASK_HEADER_CORRESPONDENCE`).
 *
 * This is a `REAL_PRODUCTION_SEAM` evidence per ACT §C11 — the test
 * exercises the real production TS selector AND the real compiled Elm
 * kernel simultaneously. It is NOT synthetic.
 */

import { describe, expect, it } from "vitest"
import {
	buildFactsJson,
	invokeElmKernel,
	type TaskHeaderElmDecision,
	type TaskHeaderElmFactsJson,
} from "../task-header-elm-shadow"
import { selectTaskHeaderPresentation } from "../task-state-shadow-arbiter-mapper"
import { fixtureFactInputs, taskHeaderOrchestrationFixtures } from "./task-header-elm-orchestration-shadow01.fixtures"

// ---------------------------------------------------------------------------
// Production-seam exercise (TS production selector vs fixture table)
// ---------------------------------------------------------------------------

describe("TaskHeader orchestration: production-seam exercise (TS selector)", () => {
	for (const fx of taskHeaderOrchestrationFixtures) {
		it(`PROD-TS: ${fx.label}`, () => {
			const out = selectTaskHeaderPresentation(fixtureFactInputs(fx))
			expect(out.phase).toBe(fx.expected.phase)
			expect(out.source).toBe(fx.expected.source)
			expect(out.seq).toBe(fx.expected.seq)
		})
	}
})

// ---------------------------------------------------------------------------
// Differential correspondence (TS production == Elm kernel)
// ---------------------------------------------------------------------------

describe("TaskHeader orchestration: differential correspondence (TS == Elm)", () => {
	for (const fx of taskHeaderOrchestrationFixtures) {
		it(`DIFF: ${fx.label}`, async () => {
			const tsOut = selectTaskHeaderPresentation(fixtureFactInputs(fx))
			const factsJson: TaskHeaderElmFactsJson = buildFactsJson(fixtureFactInputs(fx))
			const elmDecision: TaskHeaderElmDecision = await invokeElmKernel(factsJson)

			expect(elmDecision.kind).toBe("presentation")
			if (elmDecision.kind !== "presentation") {
				throw new Error(`ELM_DECODE_ERROR on fixture "${fx.label}": ${JSON.stringify(elmDecision)}`)
			}

			expect({
				phase: elmDecision.value.phase,
				source: elmDecision.value.source,
				seq: elmDecision.value.seq,
			}).toStrictEqual({
				phase: tsOut.phase,
				source: tsOut.source,
				seq: tsOut.seq,
			})
		})
	}
})

// ---------------------------------------------------------------------------
// `seq` is always the input `seq` verbatim (production invariant)
// ---------------------------------------------------------------------------

describe("TaskHeader orchestration: seq preservation (TS + Elm)", () => {
	for (const fx of taskHeaderOrchestrationFixtures) {
		it(`SEQ: ${fx.label}`, async () => {
			const tsOut = selectTaskHeaderPresentation(fixtureFactInputs(fx))
			expect(tsOut.seq).toBe(fx.facts.seq)

			const elmDecision = await invokeElmKernel(buildFactsJson(fixtureFactInputs(fx)))
			if (elmDecision.kind !== "presentation") {
				throw new Error(`ELM_DECODE_ERROR on seq-preservation fixture "${fx.label}"`)
			}
			expect(elmDecision.value.seq).toBe(fx.facts.seq)
		})
	}
})

// ---------------------------------------------------------------------------
// Conservation invariants
// ---------------------------------------------------------------------------

describe("TaskHeader orchestration: conservation invariants", () => {
	it("CONS-01: source enum is closed to {host, shadow, legacy}", async () => {
		for (const fx of taskHeaderOrchestrationFixtures) {
			const tsOut = selectTaskHeaderPresentation(fixtureFactInputs(fx))
			expect(["host", "shadow", "legacy"]).toContain(tsOut.source)

			const elmDecision = await invokeElmKernel(buildFactsJson(fixtureFactInputs(fx)))
			if (elmDecision.kind !== "presentation") {
				throw new Error(`ELM_DECODE_ERROR on CONS-01 fixture "${fx.label}"`)
			}
			expect(["host", "shadow", "legacy"]).toContain(elmDecision.value.source)
		}
	})

	it("CONS-02: phase enum is closed to the 8-phase vocabulary", async () => {
		const phases = [
			"idle",
			"streaming",
			"awaiting_approval",
			"awaiting_followup",
			"compacting",
			"completed",
			"error",
			"resumable",
		] as const
		for (const fx of taskHeaderOrchestrationFixtures) {
			const tsOut = selectTaskHeaderPresentation(fixtureFactInputs(fx))
			expect(phases).toContain(tsOut.phase)

			const elmDecision = await invokeElmKernel(buildFactsJson(fixtureFactInputs(fx)))
			if (elmDecision.kind !== "presentation") {
				throw new Error(`ELM_DECODE_ERROR on CONS-02 fixture "${fx.label}"`)
			}
			expect(phases).toContain(elmDecision.value.phase)
		}
	})

	it("CONS-03: T2_LEGACY_INDEPENDENCE for R3 branches — fresh shadow collapse", () => {
		const freshShadowFixtures = taskHeaderOrchestrationFixtures.filter(
			(fx) => fx.facts.canonicalShadowObservedTurnSeq !== undefined,
		)
		for (const fx of freshShadowFixtures) {
			const tsOut = selectTaskHeaderPresentation(fixtureFactInputs(fx))
			if (fx.facts.currentLegacyPhase === "compacting" || fx.facts.currentLegacyPhase === "awaiting_followup") {
				expect(tsOut.source).toBe("host")
			} else if (
				fx.facts.canonicalShadowObservedTurnSeq !== undefined &&
				fx.facts.seq > fx.facts.canonicalShadowObservedTurnSeq
			) {
				expect(tsOut.source).toBe("legacy")
			} else {
				expect(tsOut.source).toBe("shadow")
			}
		}
	})
})

// ---------------------------------------------------------------------------
// LIVE specimen evidence
// ---------------------------------------------------------------------------

describe("TaskHeader orchestration: LIVE specimen correspondence", () => {
	it("LIVE: canonical=idle, legacy=streaming, UNBOUND → TS==Elm", async () => {
		const liveSpecimen = {
			canonicalShadowPhase: "idle" as const,
			currentLegacyPhase: "streaming" as const,
			seq: 27545,
			canonicalShadowObservedTurnSeq: undefined,
		}
		const tsOut = selectTaskHeaderPresentation(liveSpecimen)
		expect(tsOut).toStrictEqual({ phase: "streaming", source: "legacy", seq: 27545 })

		const elmDecision = await invokeElmKernel(buildFactsJson(liveSpecimen))
		expect(elmDecision.kind).toBe("presentation")
		if (elmDecision.kind !== "presentation") return
		expect(elmDecision.value).toStrictEqual({ phase: "streaming", source: "legacy", seq: 27545 })
	})
})

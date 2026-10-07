/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
 *
 * Elm authority contract test (post-cutover).
 *
 * After the ORCHESTRATION03 authority cutover, the Elm kernel is
 * the SOLE production authority for `taskHeaderPresentation`. The
 * differential correspondence test (TS == Elm) is therefore CLOSED
 * — the purpose of "prove migration correspondence" is satisfied.
 * What remains is direct verification that the Elm kernel produces
 * the contract-correct projection for every reference fixture in
 * `task-header-elm-orchestration-shadow01.fixtures.ts`.
 *
 * The TS selector (`selectTaskHeaderPresentation`) is retained as a
 * REFERENCE helper for invariant fixtures only; it is NOT the
 * production authority. The first describe block exercises it
 * against the same fixture table to document that the TS rule
 * implementations remain consistent with the canonical contract
 * (any drift between the two surfaces as a CONTRACT defect).
 */

import { describe, expect, it } from "vitest"
import { buildFactsJson, invokeElmKernel, type TaskHeaderElmDecision } from "../task-header-elm-shadow"
import { selectTaskHeaderPresentation } from "../task-state-shadow-arbiter-mapper"
import { fixtureFactInputs, taskHeaderOrchestrationFixtures } from "./task-header-elm-orchestration.fixtures"

describe("TaskHeader orchestration: TS reference selector (invariant fixtures only)", () => {
	for (const fx of taskHeaderOrchestrationFixtures) {
		it(`REF-TS: ${fx.label}`, () => {
			const out = selectTaskHeaderPresentation(fixtureFactInputs(fx))
			expect(out.phase).toBe(fx.expected.phase)
			expect(out.source).toBe(fx.expected.source)
			expect(out.seq).toBe(fx.expected.seq)
		})
	}
})

describe("TaskHeader orchestration: Elm authority contract", () => {
	for (const fx of taskHeaderOrchestrationFixtures) {
		it(`ELM-AUTH: ${fx.label}`, async () => {
			const elmDecision: TaskHeaderElmDecision = await invokeElmKernel(buildFactsJson(fixtureFactInputs(fx)))
			expect(elmDecision.kind).toBe("presentation")
			if (elmDecision.kind !== "presentation") {
				throw new Error(`ELM_DECODE_ERROR on fixture "${fx.label}": ${JSON.stringify(elmDecision)}`)
			}
			expect({
				phase: elmDecision.value.phase,
				source: elmDecision.value.source,
				seq: elmDecision.value.seq,
			}).toStrictEqual(fx.expected)
		})
	}
})

describe("TaskHeader orchestration: seq preservation (Elm authority)", () => {
	for (const fx of taskHeaderOrchestrationFixtures) {
		it(`SEQ: ${fx.label}`, async () => {
			const elmDecision = await invokeElmKernel(buildFactsJson(fixtureFactInputs(fx)))
			if (elmDecision.kind !== "presentation") {
				throw new Error(`ELM_DECODE_ERROR on seq-preservation fixture "${fx.label}"`)
			}
			expect(elmDecision.value.seq).toBe(fx.facts.seq)
		})
	}
})

describe("TaskHeader orchestration: conservation invariants", () => {
	it("CONS-01: source enum is closed to {host, shadow, legacy}", async () => {
		for (const fx of taskHeaderOrchestrationFixtures) {
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
			const elmDecision = await invokeElmKernel(buildFactsJson(fixtureFactInputs(fx)))
			if (elmDecision.kind !== "presentation") {
				throw new Error(`ELM_DECODE_ERROR on CONS-02 fixture "${fx.label}"`)
			}
			expect(phases).toContain(elmDecision.value.phase)
		}
	})
})

describe("TaskHeader orchestration: LIVE specimen (Elm authority)", () => {
	it("LIVE: canonical=idle, legacy=streaming, UNBOUND → Elm contract", async () => {
		const liveSpecimen = {
			canonicalShadowPhase: "idle" as const,
			currentLegacyPhase: "streaming" as const,
			seq: 27545,
			canonicalShadowObservedTurnSeq: undefined,
		}
		const elmDecision = await invokeElmKernel(buildFactsJson(liveSpecimen))
		expect(elmDecision.kind).toBe("presentation")
		if (elmDecision.kind !== "presentation") return
		expect(elmDecision.value).toStrictEqual({ phase: "streaming", source: "legacy", seq: 27545 })
	})
})

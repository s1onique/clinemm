/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 (H03) — R5
 *
 * The Chart 02 DOCUMENTATION-SYNCHRONIZATION guard.
 *
 * The Chart 02 diagram must agree with the EXECUTED completion-authority
 * contract:
 *
 *   1. Only the genuine TRANSITION claims carry a Mermaid edge.
 *   2. The GUARD / DECISION / SAFETY-VETO / INVARIANT / INPUT-RULE claims
 *      carry NO edge.
 *   3. A transition claim labels the CORRECT edge (association, not
 *      cardinality).
 *   4. The BCB is modelled as a PREDICATE over INDEPENDENT obligations,
 *      NOT as an ordered chain.
 *   5. The final CONTAINMENT revalidation is VISIBLE between the Elm
 *      authorization and the C10 effect.
 *   6. No edge may enter the committed-completion state except the C10
 *      commit edge.
 *
 * The ADVERSARIAL cases below mutate the diagram and assert the guard
 * REJECTS each mutation — including the SWAPPED-LABEL case, where both
 * identifiers remain present (each exactly once) but are attached to the
 * WRONG edges. A cardinality-only check would let that through.
 *
 * This is a DOCUMENTATION guard. It never asserts behaviour: the behaviour
 * is proven by `completion-authority-contract01.h03.test.ts`.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
	CHART_02_NON_TRANSITION_CLAIM_IDS,
	CHART_02_TRANSITION_CLAIM_IDS,
	CHART_02_VERIFIED_EDGES,
	verifyChart02CompletionAuthority,
} from "../lifecycle-transition-contract-verifier"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..")
const chart02Path = resolve(repoRoot, "docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md")
const chart02 = readFileSync(chart02Path, "utf8")

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 — Chart 02 projection", () => {
	describe("the shipped Chart 02 document", () => {
		it("passes the Chart 02 verification", () => {
			const { errors } = verifyChart02CompletionAuthority({
				markdown: chart02,
				transitionClaimIds: CHART_02_TRANSITION_CLAIM_IDS,
				nonTransitionClaimIds: CHART_02_NON_TRANSITION_CLAIM_IDS,
				expectedEdges: CHART_02_VERIFIED_EDGES,
			})
			expect(errors).toEqual([])
		})

		it("labels every genuine transition claim exactly once", () => {
			const { errors } = verifyChart02CompletionAuthority({ markdown: chart02 })
			expect(errors.filter((e) => e.includes("TRANSITION claim is absent"))).toEqual([])
			expect(errors.filter((e) => e.includes("expected exactly one"))).toEqual([])
		})

		it("gives no edge to the guard / decision / veto / invariant / input-rule claims", () => {
			const { errors } = verifyChart02CompletionAuthority({ markdown: chart02 })
			expect(errors.filter((e) => e.includes("must NOT carry a Chart 02 Mermaid edge"))).toEqual([])
		})
	})

	describe("the adversarial cases", () => {
		it("REJECTS a SWAPPED pair of transition labels (both ids present, wrong edges)", () => {
			// The A-01 and A-04 labels are exchanged. Every id is still
			// present EXACTLY ONCE, so a cardinality-only check passes — the
			// ASSOCIATION check must reject it.
			const swapped = chart02
				.replace(
					"TurnRunning --> C9Captured : A-01 completion tool content_end",
					"TurnRunning --> C9Captured : A-04 completion tool content_end",
				)
				.replace(
					"ContainmentRevalidated --> C10Committed : A-04 no unresolved containment failure",
					"ContainmentRevalidated --> C10Committed : A-01 no unresolved containment failure",
				)
			expect(swapped).not.toBe(chart02)

			const { errors } = verifyChart02CompletionAuthority({ markdown: swapped })
			expect(errors.length).toBeGreaterThan(0)
			// The association mismatch is reported for BOTH claims.
			expect(errors.some((e) => e.startsWith("A-01:") && e.includes("Mermaid edge is"))).toBe(true)
			expect(errors.some((e) => e.startsWith("A-04:") && e.includes("Mermaid edge is"))).toBe(true)
		})

		it("REJECTS a GUARD claim that carries an edge", () => {
			const mutated = chart02.replace(
				"    BcbEvaluated --> ElmConsulted : BCB predicate false",
				"    BcbEvaluated --> ElmConsulted : A-02 BCB predicate false",
			)
			expect(mutated).not.toBe(chart02)

			const { errors } = verifyChart02CompletionAuthority({ markdown: mutated })
			expect(errors.some((e) => e.includes("A-02") && e.includes("must NOT carry"))).toBe(true)
		})

		it("REJECTS a SAFETY-VETO claim that carries an edge", () => {
			const mutated = chart02.replace(
				"    ContainmentRevalidated --> C10Withheld : unresolved containment failure",
				"    ContainmentRevalidated --> C10Withheld : A-04b unresolved containment failure",
			)
			expect(mutated).not.toBe(chart02)

			const { errors } = verifyChart02CompletionAuthority({ markdown: mutated })
			expect(errors.some((e) => e.includes("A-04b") && e.includes("must NOT carry"))).toBe(true)
		})

		it("REJECTS the BCB drawn as an ordered chain of obligation states", () => {
			const mutated = chart02.replace(
				"    BcbEvaluated --> ElmConsulted : BCB predicate false",
				"    state BcbEvaluated {\n        direction TB\n        [*] --> PendingPromptUnknown\n        PendingPromptUnknown --> PendingPromptKnown : getPendingPromptCount().available === true\n    }\n    BcbEvaluated --> ElmConsulted : BCB predicate false",
			)
			expect(mutated).not.toBe(chart02)

			const { errors } = verifyChart02CompletionAuthority({ markdown: mutated })
			expect(
				errors.some((e) => e.includes("PendingPromptUnknown") && e.includes("PREDICATE over INDEPENDENT obligations")),
			).toBe(true)
		})

		it("REJECTS a diagram that hides the final containment revalidation", () => {
			// EVERY occurrence is replaced, so the revalidation state is
			// gone from the diagram entirely.
			const mutated = chart02.replaceAll("ContainmentRevalidated", "ElmAuthorized")
			expect(mutated).not.toBe(chart02)
			expect(mutated).not.toContain("ContainmentRevalidated")

			const { errors } = verifyChart02CompletionAuthority({ markdown: mutated })
			expect(errors.some((e) => e.includes("FINAL containment revalidation") || e.includes("Mermaid edge is"))).toBe(true)
		})

		it("REJECTS an UNAUTHORIZED path into the committed completion", () => {
			// The injected shortcut carries A-01 — a claim whose VERIFIED
			// target is `C9Captured`. An edge from the Elm consult into the
			// committed completion is therefore an unauthorized path.
			const mutated = chart02.replace(
				"    ElmConsulted --> ElmAuthorized : decision = authorize",
				"    ElmConsulted --> ElmAuthorized : decision = authorize\n    ElmConsulted --> C10Committed : A-01 unauthorized shortcut",
			)
			expect(mutated).not.toBe(chart02)

			const { errors } = verifyChart02CompletionAuthority({ markdown: mutated })
			expect(errors.some((e) => e.includes("UNAUTHORIZED path into the committed completion"))).toBe(true)
		})
	})
})

/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 (H03) — R4.
 *
 * The BOUNDED, harness-only correction for the legacy BCB / PCCA / BNCA test
 * suites whose harness omits the now-MANDATORY
 * `getElmCompletionAuthorityDecision` provider.
 *
 * WHY THIS EXISTS.
 *
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY
 * made the Elm completion authority the MANDATORY, fail-closed authority for
 * the C10 commit and DELETED the legacy silent default-Authorize fallback. The
 * coordinator constructor therefore captures
 * `options.getElmCompletionAuthorityDecision` verbatim, and
 * `checkElmCompletionAuthority` calls it inside a `try/catch` that
 * fail-closes (`return false`) when the provider THROWS.
 *
 * The legacy suites below construct `SdkSessionEventCoordinator` WITHOUT that
 * option. `this.getElmCompletionAuthorityDecision` is then `undefined`, the
 * call throws `TypeError: ... is not a function`, the catch fail-closes, and
 * EVERY C10 commit is suppressed. The observable symptom is
 * `expected +0 to be 1` on the completion-commit counter — a harness defect
 * that MASKS the very BCB behaviour each suite was written to prove.
 *
 * WHAT THIS HELPER IS (and IS NOT).
 *
 *   IS:  the LEGITIMATE Elm provider, injected at the ESTABLISHED test
 *        boundary (`SdkSessionEventCoordinatorOptions`), so the production
 *        `checkElmCompletionAuthority` gate is exercised rather than
 *        bypassed.
 *   IS NOT: a permissive GLOBAL default. The decision is still produced by a
 *        real, closed `ElmCompletionAuthorityDecision` value; the helper
 *        never returns `undefined`, never returns a non-closed shape, and
 *        never mutates production Elm authority.
 *
 * WHY `authorize` IS THE CORRECT RESTORATION FOR THESE SUITES.
 *
 * Each of these suites exercises a BCB / wake-authority POLICY scenario: the
 * assertion is about WHETHER THE BARRIER HOLDS, never about the Elm
 * authority's own verdict. The Elm gate is ORTHOGONAL to that policy: a
 * HOLD would suppress the commit for a reason that has nothing to do with
 * the scenario under test, and the suite's own policy assertions (e.g. "the
 * barrier held", "exactly one commit after the drain") would become
 * indistinguishable from "Elm said no".
 *
 * The decision is therefore injected as an explicit, narrow, per-harness
 * ALLOW — the same pattern the already-green sibling suites use
 * (`completion-authority-elm-first-seam01.case01.test.ts`,
 * `containment-failure-c10-authority-repair01.cfc10ar01.test.ts`,
 * `task-terminal-divergence-red01.tdd-red01.test.ts`).
 *
 * The Elm-authority behaviour itself is proven SEPARATELY and against the
 * REAL kernel by `completion-authority-elm-real-provider01.test.ts` and
 * `completion-authority-effect-discriminator01.cae01.test.ts`.
 */

import type { ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"

/**
 * The narrow, explicit ALLOW decision injected by the legacy harnesses.
 *
 * It is a CLOSED `ElmCompletionAuthorityDecision` value of kind
 * `authorize` — the same shape the production Elm runtime emits for a
 * clean, hold-reason-free model.
 */
export const LEGACY_HARNESS_ELM_ALLOW_DECISION: ElmCompletionAuthorityDecision = {
	kind: "authorize",
	reason: "h03-legacy-harness-elm-allow",
}

/**
 * Build the Elm completion-authority provider for a legacy harness.
 *
 * @param decision the decision to return. Defaults to the explicit ALLOW
 *   above; a caller MAY pass a `hold` / `failure` decision to exercise the
 *   Elm gate itself.
 */
export function legacyHarnessElmProvider(
	decision: ElmCompletionAuthorityDecision = LEGACY_HARNESS_ELM_ALLOW_DECISION,
): (sessionId?: string) => ElmCompletionAuthorityDecision {
	return () => decision
}

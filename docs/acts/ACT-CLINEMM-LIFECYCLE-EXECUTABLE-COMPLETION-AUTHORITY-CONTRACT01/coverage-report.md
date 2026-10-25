# ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 — Coverage report

The eight-claim executable coverage for the Chart 02 C9 → BCB → Elm → C10
completion-authority chain.

The machine-readable form is `coverage-report.tsv`; the per-assertion
inventory is `assertion-inventory.tsv`; the evidence, the RED/GREEN
mutation proofs and the baseline comparison are in `evidence-report.md`.

## The eight rows

| claim_id | claim_kind | production_symbol | witness | observed_assertion | evidence_level | result |
|---|---|---|---|---|---|---|
| A-01 | TRANSITION | `sdk-session-event-coordinator.ts#handleSessionEvent` (the `submit_and_exit_seen` capture call) \| `continuation-cardinality-authority.ts#captureContinuationCardinalityAuthorityRecord` | `completion-authority-contract01.h03.test.ts` | ONE uniquely identified C9 record (`submit-<session>-1`); the C10 count is 0 and the phase is not `completed` | REAL_PRODUCTION_SEAM | PASS |
| A-02 | GUARD | `sdk-session-event-coordinator.ts#handleSessionEvent` (the barrier block) \| `#reevaluateDeferredCompletionBarrier` | `completion-authority-contract01.h03.test.ts` | NINE independent-obligation cases, each with every other obligation controlled to false; every one prevents the C10 commit, still captures the C9 attempt, and preserves the deferred-completion marker | REAL_PRODUCTION_SEAM | PASS |
| A-03 | DECISION | `sdk-session-event-coordinator.ts#checkElmCompletionAuthority` | `completion-authority-contract01.h03.test.ts` | AUTHORIZE commits; HOLD and FAILURE each suppress the commit and preserve the deferred authority; a THROWING provider fails closed | INJECTED_DECISION | PASS |
| A-04 | TRANSITION | `sdk-session-event-coordinator.ts#handleSessionEvent` / `#reevaluateDeferredCompletionBarrier` → `setTurnPhase("completed", …)` \| `turn-state-tracker.ts#setWithWriter` | `completion-authority-contract01.h03.test.ts` | the authorized path commits `completed` through the REAL tracker; the C10 record is captured AFTER the effect; the trace orders authority → effect → phase commit | INJECTED_DECISION | PASS |
| A-04b | SAFETY_VETO | `sdk-session-event-coordinator.ts#unresolvedContainmentFailuresForOwner` \| `#unresolvedContainmentFailuresAtCommitBoundary` | `completion-authority-contract01.h03.test.ts` | THREE veto sites — immediate barrier, deferred re-evaluation, and the post-await commit boundary | REAL_PRODUCTION_SEAM | PASS |
| A-05 | GUARD | `sdk-session-event-coordinator.ts#checkElmCompletionAuthority` (the false branch) \| `#promoteCompletionAuthorityMarker` | `completion-authority-contract01.h03.test.ts` | for HOLD and FAILURE the authoritative-marker publication count is 0; the trace records `marker_suppressed` and not `marker_promoted` | INJECTED_DECISION | PASS |
| A-06 | INVARIANT | `sdk-session-event-coordinator.ts` (`this.nextCompletionCommitEventId`) | `completion-authority-contract01.h03.test.ts` | one observed C10 event mints ONE distinct completionId; a held completion mints NONE; and — deliberately NOT broadened — TWO real C10 commits mint TWO distinct completionIds | REAL_PRODUCTION_SEAM | PASS |
| A-07 | INPUT_RULE | `completion-authority-elm-authority-runtime.ts` (`AUTHORITY_STAGES`) \| `continuation-cardinality-authority.ts#captureContinuationCardinalityAuthorityRecord` | `completion-authority-contract01.h03.test.ts` | the post-decision stages are excluded from `AUTHORITY_STAGES` AND the filter is applied, so no C10 outcome can become an authority input | STRUCTURAL | PASS |

## The evidence levels are NOT collapsed

- `REAL_PRODUCTION_SEAM` (4 rows: A-01, A-02, A-04b, A-06) — the
  assertion observes a production-owned artefact directly: the CCARD
  capture ring, the committed `TurnStateTracker` phase, the
  deferred-completion marker, or the owner-scoped containment
  classifier.
- `INJECTED_DECISION` (3 rows: A-03, A-04, A-05) — the Elm VERDICT is
  injected at the established `getElmCompletionAuthorityDecision`
  provider seam, because the claim under test is the effect of the
  verdict, not the verdict itself. The verdict's own behaviour against
  the REAL compiled Elm kernel is proven separately by
  `completion-authority-elm-real-provider01.test.ts` and
  `completion-authority-effect-discriminator01.cae01.test.ts`.
- `STRUCTURAL` (1 row: A-07) — the input filter is a source-level
  allow-list in the authority runtime; the assertion reads the
  production `AUTHORITY_STAGES` set and the applied filter in
  `enqueueElmAuthorityRecord`, and the REAL-kernel consequence is proven
  by `completion-authority-elm-real-provider01.test.ts`
  (`REAL-ELM-CHRONO`).
- `UNVERIFIED` — **0 rows.** Every claim has an executable witness.
- `LIVE_UNOBSERVABLE` — **0 rows for the eight claims.** The claims are
  observable at the production seam; the ACT's closure is therefore
  `PASS_STRUCTURAL_ONLY` (no installed-extension capture was taken in
  this environment).

## Missing boundaries — stated explicitly

- **No installed-extension capture.** The eight claims are proven against
  the production seams inside the extension host's own TypeScript; the
  LIVE runtime (a real session, a real Elm kernel, a real background
  job) was not captured in this environment. That is why the closure is
  `PASS_STRUCTURAL_ONLY` and not `PASS_LIVE`.
- **A-07 is structural at the host boundary.** The filter is proven in
  the runtime module that feeds the Elm kernel; the kernel-side
  consequence is proven by the sibling REAL-kernel suite rather than by
  this ACT's own suite.
- **The BCB matrix exercises the nine obligations the ACT enumerated.**
  It does NOT claim that the production predicate has no other
  conjunct; the reconciler asserts the enumerated set is present in the
  source (`transitions.tsv` A-02 `predicate`).

## Totals

- eligible claims: **8**
- eligible claims with executable evidence (PASS): **8**
- eligible claims that FAILED: **0**
- eligible claims with an explicit gap: **0**

# ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 — Evidence report

**Status:** `PASS_STRUCTURAL_ONLY`
**Reviewed baseline:** `3558e914009b84b0d54f6e549c46802095f44b2b`
**Stage:** H03 — Chart 02, C9 / BCB / Elm / C10
**Scope:** executable conformance for the eight Chart 02 completion-authority
claims. NO production behaviour was changed.

---

## 1. R0 — the actual-source reconnaissance

The eight claims are NOT eight Mermaid arrows. The recon established
that they are **four different kinds of thing**, and each kind is proven
by the mechanism that kind actually uses.

| ID | kind | actual owner | authority input | observable effect | executable witness |
|---|---|---|---|---|---|
| A-01 | TRANSITION | `sdk-session-event-coordinator.ts#handleSessionEvent` → `continuation-cardinality-authority.ts#captureContinuationCardinalityAuthorityRecord` | `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()` | ONE bounded CCARD record with a monotonic coordinator-local `submitId`; NO phase write, NO completion commit, NO `completionId` | `completion-authority-contract01.h03.test.ts` (A-01 ×3) |
| A-02 | GUARD | `sdk-session-event-coordinator.ts#handleSessionEvent` (the barrier block) + `#reevaluateDeferredCompletionBarrier` | EIGHT INDEPENDENT obligations (see §3) | The C10 commit is NOT taken; a `DeferredCompletionBarrier` marker is registered; the obligation can be discharged later and the held completion then commits exactly once | `completion-authority-contract01.h03.test.ts` (A-02 ×13) |
| A-03 | DECISION | `sdk-session-event-coordinator.ts#checkElmCompletionAuthority` | `getElmCompletionAuthorityDecision(sessionId).kind` — a CLOSED three-valued verdict | `authorize` → the C10 commit may proceed; `hold` / `failure` → the commit is SUPPRESSED; a THROWING provider fails closed | `completion-authority-contract01.h03.test.ts` (A-03 ×4) |
| A-04 | TRANSITION | `sdk-session-event-coordinator.ts#handleSessionEvent` / `#reevaluateDeferredCompletionBarrier` → `turn-state-tracker.ts#setWithWriter` | ALL of T-02's conjuncts, INCLUDING the Elm authorize AND no unresolved owner-scoped containment failure at the commit boundary | The committed phase of the REAL tracker, THEN the C10 record (minted AFTER the effect) | `completion-authority-contract01.h03.test.ts` (A-04 ×2) |
| A-04b | SAFETY VETO | `sdk-session-event-coordinator.ts#unresolvedContainmentFailuresForOwner` + `#unresolvedContainmentFailuresAtCommitBoundary` | An OWNED job's terminal classification is `containment_failed` | The C10 commit is suppressed at THREE sites; the deferred marker is preserved / re-registered; NO phase write, NO C10 capture, NO marker promotion | `completion-authority-contract01.h03.test.ts` (A-04b ×3) |
| A-05 | GUARD | `sdk-session-event-coordinator.ts#checkElmCompletionAuthority` (the false branch) + `#promoteCompletionAuthorityMarker` | `checkElmCompletionAuthority(...) === false` | The C10 commit is suppressed; NO authoritative marker is published or retracted | `completion-authority-contract01.h03.test.ts` (A-05 ×2) |
| A-06 | INVARIANT | `sdk-session-event-coordinator.ts` (`this.nextCompletionCommitEventId`) | The C10 capture is the ONLY event-creating seam for `completionId` | One OBSERVED C10 event ⇒ one distinct `completionId`; presentation / reopen / BCB mint none | `completion-authority-contract01.h03.test.ts` (A-06 ×3) |
| A-07 | INPUT RULE | `completion-authority-elm-authority-runtime.ts` (`AUTHORITY_STAGES`) + `continuation-cardinality-authority.ts#captureContinuationCardinalityAuthorityRecord` | The stage is in `AUTHORITY_STAGES` (the post-decision stages are EXCLUDED) | The Elm kernel receives only the factual pre-decision stages; no outcome-to-input feedback loop | `completion-authority-contract01.h03.test.ts` (A-07 ×2) |

**The recon gate result.** A-01 and A-04 are TRANSITIONS (observable
state changes). A-02 and A-05 are GUARDS (they SUPPRESS a write — they
are not transitions). A-03 is a DECISION (a closed three-valued
verdict). A-04b is a SAFETY VETO (it suppresses a write at three sites;
it is NOT a successful completion transition). A-06 is an INVARIANT (a
cardinality / identity property). A-07 is an INPUT RULE (a filter on
what the authority may observe). Only A-01 and A-04 carry a Mermaid
edge; the reconciled diagram and the verifier enforce exactly that.

### 1.1 Inventory of the existing tests that were reused

| Existing suite | Role for this ACT |
|---|---|
| `continuation-cardinality-authority01.ccard01.test.ts` | The C9 / C10 capture seam. Reused as the A-01 / A-06 corroboration. |
| `c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts` | The commit-driven marker promotion (P-06) and the deferred C10 path. Reused as the A-04 / A-05 corroboration. |
| `completion-authority-elm-first-seam01.case01.test.ts` | The Elm seam's AUTHORIZE / HOLD / FAILURE discrimination. Reused as the A-03 corroboration. |
| `completion-authority-elm-real-provider01.test.ts` | The REAL compiled Elm kernel (authorize / hold / failure) and the chronology discipline. Reused as the A-03 / A-07 corroboration. |
| `completion-authority-effect-discriminator01.cae01.test.ts` | The composite deferred-chain witness. Reused as the A-04 corroboration. |
| `containment-failure-c10-authority-repair01.cfc10ar01.test.ts` | The containment veto at the immediate / deferred / commit-boundary sites. Reused as the A-04b corroboration. |
| `long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts` | The BCB conservation scenarios. Reused as the A-02 corroboration. |
| `completion-authority-elm-historical-replay01.test.ts` | The Elm adapter self-invariants. Reused as the A-07 corroboration. |
| `markdown-mermaid-block-verifier.c9c10mm01.test.ts` | The embedded-Mermaid guard for Chart 02. UPDATED (see §5.3). |
| `lifecycle-transition-contract-verifier.correction01.test.ts` | The contract-to-diagram association verifier. EXTENDED (see §5.2). |

---

## 2. R4 — the bounded test-harness correction

### 2.1 The defect

`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY`
made the Elm completion authority the MANDATORY, fail-closed authority
for the C10 commit and DELETED the legacy silent default-Authorize
fallback. The coordinator constructor captures
`options.getElmCompletionAuthorityDecision` verbatim, and
`checkElmCompletionAuthority` calls it inside a `try/catch` that
fail-closes (`return false`) when the provider THROWS.

TWELVE legacy suites constructed `SdkSessionEventCoordinator` WITHOUT
that option. `this.getElmCompletionAuthorityDecision` was therefore
`undefined`, the call threw `TypeError: … is not a function`, the catch
fail-closed, and EVERY C10 commit was suppressed. The observable symptom
was `expected +0 to be 1` on the completion-commit counter — a harness
defect that MASKED the very BCB behaviour each suite was written to
prove.

### 2.2 The correction (harness-only)

One bounded correction, applied at the ESTABLISHED test boundary
(`SdkSessionEventCoordinatorOptions`):

- A shared helper
  `apps/vscode/src/sdk/__tests__/completion-authority-elm-test-provider.h03.ts`
  exports `legacyHarnessElmProvider()`, which returns a CLOSED
  `ElmCompletionAuthorityDecision` of kind `authorize`.
- Each of the twelve legacy harnesses injects it at its coordinator
  options boundary.
- NO production Elm authority was changed. NO permissive GLOBAL default
  was introduced: the decision is a real closed value, the helper never
  returns `undefined`, and the production gate is exercised rather than
  bypassed.

`authorize` is the CORRECT restoration because each of those suites
exercises a BCB / wake-authority POLICY scenario whose assertion is
about WHETHER THE BARRIER HOLDS, never about the Elm verdict. A HOLD
would suppress the commit for a reason unrelated to the scenario, and
the suite's own policy assertions would become indistinguishable from
"Elm said no".

### 2.3 Three further bounded harness corrections (same defect class)

The R4 sweep surfaced three more harness defects of the SAME kind — a
mandatory production seam or an async boundary that the legacy harness
did not model. All are test-only.

**(a) The `liveTools` capability projection (BCB01-C4).** The production
continuation trigger projects the TRUTHFUL capability into the
Continuation Control Elm kernel. With the projection absent the kernel
fail-closes (`observation_unavailable`) and the bounded continuation is
never enqueued — masking the trigger the suite was written to prove. The
sibling `background-completion-barrier01.bcb01.test.ts` harness already
wires the same projection; BCB01-C4 now wires it too.

**(b) The fire-and-forget trigger drain (BCB01-C4).** The production
trigger is `void this.enqueueCompletionContinuationIfHeld(...)` —
deliberately non-blocking. But that helper AWAITS the E3.1 deferred-
completion-barrier Elm consult (and, before it, the Continuation Control
Elm consult), so the callback is invoked several turns later than the
`await reevaluateDeferredCompletionBarrier()` returns. The legacy harness
drained with a SINGLE `setImmediate` turn — sufficient when the trigger
was synchronous, insufficient now that it consults two Elm kernels. A
bounded `drainContinuationTrigger()` helper lets the async trigger
finish. It asserts nothing and changes no production behaviour.

**(c) The Path A wake landing (BCB-INT-02).** The Path A wake ENQUEUE is
a separate async continuation from the terminal commit.
`manager.status(...)` returns when the JOB is terminal, but the wake
lands in the pending-prompt queue one or more turns later. The legacy
harness proceeded immediately, so the wake had not yet landed when the
barrier was evaluated and the barrier (correctly) did NOT hold — a race
in the harness, not a production defect. A bounded wait lets the async
wake land.

**(d) A stale source regex (BCB01-C3).** The BCB-30 test pinned the
trigger guard with a regex that required the `if ( … )` surface form.
Production now binds the SAME predicate to a named `const`
(`eligibleForCoalescedContinuation`) — the INVARIANT is unchanged, only
the surface syntax moved. The regex was corrected to require the two
conjuncts TOGETHER (in either surface form) and to require the named
const to gate the trigger call. The invariant — not the formatting —
remains what is pinned.

### 2.4 The result

| suite | pristine baseline failures | after the bounded correction |
|---|---|---|
| `background-completion-barrier01.bcb01.test.ts` | 13 | **0** |
| `background-completion-barrier01-correction01.bcb01-c.test.ts` | 6 | **0** |
| `background-completion-barrier01-correction02.bcb01-c2.test.ts` | 2 | **0** |
| `background-completion-barrier01-correction03.bcb01-c3.test.ts` | 1 | **0** |
| `background-completion-barrier01-correction04.bcb01-c4.test.ts` | 3 | **0** |
| `long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts` | 10 | **0** |
| `background-notify-completion-authority-c10-framework01.bnca-framework01.test.ts` | 2 | **0** |
| `background-notify-completion-authority-c10-framework-dispatch-failed01.bnca-framework01.test.ts` | 2 | **0** |
| `background-notify-completion-authority-c10-framework-ablation01.bnca-ablation01.test.ts` | 1 | **0** |
| `background-notify-completion-authority-c10-framework-dispatch-failed-ablation01.bnca-ablation01.test.ts` | 3 | **0** |
| `background-notify-completion-authority-c10-red01.bnca-red01.test.ts` | 1 | **0** |
| `post-consumption-completion-authority01.pcca01.test.ts` | 2 | **0** |
| **TOTAL** | **47** | **0** |

The 70 tests in these twelve suites now pass. **No production file was
modified by the R4 correction.**

### 2.5 The discrepancy classification

The R4 brief asks that an individual suite whose intended semantics are
obsolete be CLASSIFIED rather than blindly made green. **None of the
twelve corrected suites had obsolete semantics.** Every one of them
asserts a BCB / wake-authority POLICY that is still current in
production; they were failing only because the harness could not reach
the production effect at all. The one suite whose SEMANTICS did need
re-examination was
`background-completion-barrier01-correction03.bcb01-c3.test.ts` — and the
outcome there was that the INVARIANT was current and only the SOURCE
REGEX was stale (§2.3(d)). No suite's intended policy was rewritten.

A THIRTEENTH suite in the BCB family remains failing:
`background-notify-completion-authority-fire-and-forget-red01.bnca-red01.test.ts`.
It is classified explicitly in `baseline-comparison.md` §4: it does not
construct a coordinator, the Elm provider is not involved, and it asserts
the PRE-repair race that a later ACT repaired. Its intended semantics
are obsolete, so it is CLASSIFIED rather than made green — making it
green would require reverting the BNCA repair or rewriting the RED's
stated intent, both of which are production-semantics changes this ACT
forbids.

---

## 3. R1 — the BCB decision matrix

The BCB is a PREDICATE over INDEPENDENT obligations, not a temporal
chain. The matrix drives each obligation in ISOLATION, with every other
obligation controlled to false.

| # | obligation | the selected condition | the C10 commits? | the deferred authority |
|---|---|---|---|---|
| 1 | pending-prompt authority unavailable | `getPendingPromptCount(...).available !== true` | NO | PRESERVED |
| 2 | pending prompts present | `pendingPromptsKnown > 0` | NO | PRESERVED |
| 3 | active notify-owned work | `activeNotifyCount > 0` | NO | PRESERVED |
| 4 | outstanding per-job wake authority | `hasActiveNotify(jid)` for a LAUNCHED jobId | NO | PRESERVED |
| 5 | owned running background job | `hasRunningBackgroundJobForOwner(sessionId)` | NO | PRESERVED |
| 6 | unconsumed terminal COUNT positive | `getUnconsumedOwnedTerminalResultCount(...) > 0` | NO | PRESERVED |
| 7 | held terminal ID LIST non-empty despite a zero count | `getUnconsumedOwnedTerminalJobIds(...).length > 0` with count 0 | NO | PRESERVED |
| 8 | originating completion suppressed | `wasWakeDelivered(jid)` — the wake-driven turn owns it | NO | PRESERVED |
| 9 | owner-scoped unresolved containment failure | `unresolvedContainmentFailuresForOwner(...)` non-empty | NO | PRESERVED |

**Paired clean controls.**

- CLEAN: with NO obligation, the C10 commits EXACTLY ONCE, the phase is
  `completed`, and exactly one C10 record is captured.
- DISCHARGE: with the owned running background job held, the completion
  is held; discharging the obligation and re-evaluating commits the
  held completion EXACTLY ONCE.
- FOREIGN-OWNER ISOLATION: a FOREIGN owner's containment failure does
  NOT hold the C10 — the completion commits.
- OBSERVATION IS NOT CONTAINMENT: with the terminal observation FULLY
  DRAINED (count 0, no held IDs) and a containment failure still
  unresolved, the completion STAYS held and no C10 is captured. **The
  consumption of the terminal observation alone NEVER releases C10.**

---

## 4. R2 — the causal sequencing

The ACT reuses the EXISTING causal trace
(`apps/vscode/src/sdk/lifecycle-transition-trace.ts` —
`recordLifecycleTransitionTrace` / `validateLifecycleTransitionTrace`).
It does NOT introduce a second tracing subsystem.

The production chain is exercised end to end:
`completion content_end → C9 → BCB evaluation → Elm decision → final
containment revalidation → phase commit → C10 capture → marker promotion`.

| property | how it is proven |
|---|---|
| C9 does NOT imply C10 | A-01: with the BCB holding, the C9 attempt IS captured (1 record, distinct `submitId`) while the C10 count is 0 and the phase is not `completed`. |
| Elm AUTHORIZE is NECESSARY but NOT SUFFICIENT | A-04b: with an owned containment failure published DURING the awaited Elm flush, the authority returns `authorize` and the commit is STILL vetoed. |
| A BCB HOLD does not authorize completion | A-02: all nine obligations hold the C10. |
| Elm HOLD / FAILURE does not authorize completion | A-03, A-05: the commit is suppressed and no authoritative marker is published. |
| The final containment revalidation happens AFTER the awaited Elm flush | A-04b (post-await): the failure is published INSIDE the `flushElmAuthorityForSession` await and is still vetoed at the commit boundary. |
| A successful C10 record cannot precede the actual phase effect | A-04: the C10 capture site is downstream of the `setTurnPhase("completed", …)` effect; the trace orders `effect_requested` → `phase_commit_observed`, and the C10 ring's record exists only after the committed phase. |
| Marker promotion cannot precede C10 | A-05: the marker publication count is 0 whenever the C10 is suppressed; the trace records `marker_suppressed` and NOT `marker_promoted`. |
| A failed publication is not recorded as successful delivery | The production `promoteCompletionAuthorityMarker` wraps the publication in a `try/catch` and does NOT record the promotion when the publication throws; the trace's `marker_promoted` records are emitted INSIDE the `try`, after a successful publication. |

**Effect requests, committed tracker state and webview presentation stay
distinct.** The ACT asserts on the REAL `TurnStateTracker` committed
snapshot (the phase commit boundary), the CCARD capture ring (the
evidence seam), and the marker publication channel (the presentation
seam) as three separate observations. The webview replica is not used
for the Chart 02 claims: the presentation contract belongs to Chart 04
and is proven there.

---

## 5. R3 — the adversarial witnesses

| ID | fault injected | expected detection | witness | result |
|---|---|---|---|---|
| H03-NEG-01 | C9 treated as C10 | premature completion rejected | `completion-authority-contract01.neg.h03.test.ts` | DETECTED |
| H03-NEG-02 | held terminal IDs ignored when the count is zero | false barrier release rejected | `completion-authority-contract01.neg.h03.test.ts` | DETECTED |
| H03-NEG-03 | Elm HOLD treated as AUTHORIZE | completed-phase write rejected | `completion-authority-contract01.neg.h03.test.ts` | DETECTED |
| H03-NEG-04 | owned containment failure appears during the Elm flush | commit-boundary rejection | `completion-authority-contract01.neg.h03.test.ts` | DETECTED |
| H03-NEG-05 | foreign owner's containment failure treated as local | false HOLD rejected | `completion-authority-contract01.neg.h03.test.ts` | DETECTED |
| H03-NEG-06 | completion marker published before the C10 | premature presentation rejected | `completion-authority-contract01.neg.h03.test.ts` | DETECTED |
| H03-NEG-07 | post-decision C10 outcome fed into Elm | feedback rejected | `completion-authority-contract01.neg.h03.test.ts` | DETECTED |
| H03-NEG-08 | stale session/task/epoch releases the deferred completion | stale commit rejected | `completion-authority-contract01.neg.h03.test.ts` | DETECTED |

### 5.1 The two HIGH-RISK causal REDs

Both were demonstrated by mutating the REAL production file, re-running
the H03 suites, and then restoring the file BYTE-FOR-BYTE (`git diff`
over the file was empty afterwards).

**RED #1 — an Elm HOLD returns `true` (the historical silent-TS-fallback
defect).** Mutation in `sdk-session-event-coordinator.ts`
(`checkElmCompletionAuthority`): the `hold` branch was made to
`return true` before its trace records.

| | |
|---|---|
| RED (failed) | **5** — `A-03 (hold)`, `A-05 (hold)`, `A-06 (no minting without a C10)`, `H03-NEG-03`, `H03-NEG-06` |
| GREEN (after restore) | **42 passed** |

**RED #2 — the immediate commit-boundary containment veto is disabled.**
Mutation in `sdk-session-event-coordinator.ts`: the commit-boundary
revalidation's `if (unresolvedContainmentFailuresAtCommit.length > 0)`
was made `if (false && …)`.

| | |
|---|---|
| RED (failed) | **2** — `A-04b (post-await)`, `H03-NEG-04` |
| GREEN (after restore) | **42 passed** |

Both REDs name the property they protect, and both are causal: the
mutated production seam produced the failure, and the restored seam
produced the pass.

### 5.2 The Chart 02 documentation guard (R5)

`apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts` gained
`verifyChart02CompletionAuthority` — a PURE, importable function that
extends the EXISTING strict contract-to-diagram association verifier.
It asserts:

1. Every Chart 02 TRANSITION claim appears on EXACTLY ONE labeled edge.
2. Every GUARD / DECISION / SAFETY-VETO / INVARIANT / INPUT-RULE claim
   carries NO edge.
3. Every TRANSITION claim labels the CORRECT edge (association, not
   cardinality).
4. The BCB is NOT drawn as an ordered chain of obligation states.
5. The final containment revalidation is VISIBLE between the Elm
   authorization and the C10 effect.
6. No edge may enter the committed-completion state except the C10
   commit edge.

`scripts/verify-lifecycle-transition-contract.ts` now runs it and
reports `PASS Chart 02 completion-authority projection`.

### 5.3 The adversarial Chart 02 cases

`completion-authority-contract01.chart02.h03.test.ts` drives six
mutations of the diagram and asserts the guard REJECTS each. The
**swapped-label** case is the load-bearing one: the A-01 and A-04
labels are exchanged, so every identifier remains present EXACTLY ONCE
(a cardinality-only check would pass) while the MEANING of both
transitions is inverted. The ASSOCIATION check rejects it, and reports
the mismatch for BOTH claims.

The other five: a GUARD claim carrying an edge; a SAFETY-VETO claim
carrying an edge; the BCB redrawn as an ordered chain; a diagram that
hides the containment revalidation; an unauthorized path into the
committed completion.

---

## 6. R5 — the reconciled Chart 02

The reconciled diagram is in
`docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md`.

1. **A-02 now carries the verified containment predicate.** The ledger
   row's `predicate` cell lists all EIGHT independent conjuncts,
   including `unresolvedContainmentFailuresForC10.length > 0`. The
   predecessor row listed only four.
2. **The independent BCB conditions are a DECISION/GUARD model, not a
   fictional ordered sequence.** The predecessor drew them as a linear
   chain of five states (`PendingPromptUnknown -> PendingPromptKnown ->
   OutstandingAutonomousWork -> OwnerStillRunning -> HeldObligation ->
   Suppressed`). The reconciled diagram draws ONE `BcbEvaluated` state
   with a note listing the nine independent obligations, and the
   verifier REJECTS any diagram that reintroduces the chain states.
3. **The final containment check is VISIBLE between the Elm
   authorization and the C10 effect.** The `ContainmentRevalidated` state
   sits between `ElmAuthorized` and `C10Committed`.
4. **A-04b is represented as a safety veto, not a successful completion
   transition.** It carries NO Mermaid edge; it is a note on the
   revalidation state, and its veto is the `ContainmentRevalidated -->
   C10Withheld` edge OUT of the revalidation — so the veto is visible
   WITHOUT introducing a second, unauthorized path into the committed
   completion.
5. **Observation consumption is distinguished from process
   containment.** The document states explicitly that consuming a
   terminal observation is NOT resolving a containment failure, and the
   executable witness proves the two are independent facts.
6. **The historical incident descriptions are preserved EXPLICITLY as
   historical.** The `HISTORICAL NOTE` blockquote and the causal-chain
   block are unchanged.
7. **A-06 and A-07 are invariants / input rules, not transition
   edges.** Neither carries an edge, and the verifier rejects a diagram
   that gives them one.

The ledger `docs/architecture/task-lifecycle/transitions.tsv` was updated
in lockstep: the eight rows now carry the `claim_kind` axis
(`TRANSITION` / `GUARD` / `DECISION` / `SAFETY_VETO` / `INVARIANT` /
`INPUT_RULE`), the verified A-02 predicate, the H03 witnesses, and the
evidence level.

**The real Mermaid parser was run** against the reconciled document:

```
PASS docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md:
     mermaid block 1/1 parses (real Mermaid parser)
```

No new diagram framework was introduced.

---

## 7. R10 — the JSON-based baseline comparison

See `baseline-comparison.md` (generated from the Vitest JSON reports).
The headline: **0 new failed identities**, 0 removed failed identities,
46 newly-passing identities (all in the twelve R4-repaired legacy
suites), 51 added identities (the new H03 suites, all passing), and the
248 previously-failing identities unchanged.

---

## 8. Gates

| Gate | Acceptance | Result |
|---|---|---|
| G0 | Eight claims source-bound | PASS — all eight are bound to a production symbol, an observed boundary and an executed witness |
| G1 | Independent BCB predicate matrix exercised | PASS — nine obligations, each isolated, with paired clean / discharge / foreign-owner controls |
| G2 | Elm AUTHORIZE/HOLD/FAILURE behavior conserved | PASS — three verdicts plus the throwing-provider fail-closed path |
| G3 | Immediate and deferred C10 conformance passes | PASS — both commit paths asserted |
| G4 | Containment veto and async revalidation conserved | PASS — three veto sites including the post-await one |
| G5 | C9/C10 identity and ordering invariants pass | PASS — A-01, A-04, A-06 |
| G6 | Marker promotion does not precede C10 | PASS — A-05 |
| G7 | Elm authority input filtering verified | PASS — A-07 |
| G8 | Negative witnesses detect their targeted faults | PASS — eight witnesses, two with demonstrated causal REDs |
| G9 | Chart 02 and ledger synchronized | PASS — the verifier, the ledger and the document agree; the adversarial cases reject every mutation |
| G10 | Existing relevant tests and typecheck pass | PASS — `bunx tsc --noEmit` clean; the 47 legacy failures repaired to 0 |
| G11 | JSON-based baseline has no ACT-owned regression | PASS — see `baseline-comparison.md` |
| G12 | Evidence and artifacts bound to exact source HEAD | PASS — see `artifact-manifest.tsv` |

## 9. Closure

**`PASS_STRUCTURAL_ONLY`.** The production-seam gates pass. No
installed-extension capture was taken in this environment, so the
closure is NOT `PASS_LIVE`.

### The success criterion

No change to C9, BCB, Elm decision handling, containment admission, C10
capture or completion publication can silently invalidate a documented
authority invariant covered by this ACT: the eight claims are bound to
executable witnesses over the real production seams, the eight negative
witnesses detect their targeted faults (two with demonstrated causal
REDs against the production source), the BCB's independent obligations
are each exercised in isolation, and the Chart 02 diagram and the ledger
are guarded against a swapped-label or an unauthorized-path regression by
a verifier that runs against the REAL Mermaid parser.

# 06 — Exit report

ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01

## THE MACHINE-READABLE SUMMARY

```text
SECTION_STRIPPING_RED=REPRODUCED (7 of 11 witnesses failed; canarySurvivesStrip=true)
SECTION_STRIPPING_GREEN=PASS (11 of 11)
ADVERSARIAL_IDEMPOTENCE=PASS (converges byte-identically across three applications)
STALE_EVIDENCE_REVOCATION=PASS (8 of 8; enabled->disabled, admitted->refused, nonempty->empty)

PROJECTOR_STATE_IDENTITY=ESTABLISHED (the production constructor over the boundary prefix; the projector ACCEPTS it)
POST_BOUNDARY_TAIL_CONSERVATION=ESTABLISHED (prefix-derived byte-identical; the tail legitimately differs)

PREDECESSOR_B_CLASSIFICATION=PROMPT_ONLY
PREDECESSOR_C_ABLATION=STRUCTURAL

SELECTOR_BASELINE=S0_SHAPE (critOmitted 5 -> 4; O1/O4/O7 all OMITTED)
PREFERRED_SELECTOR=S2_SUBJECT_DIVERSITY at 2048 estimated tokens (critOmitted 5 -> 3; O7 PARTIALLY_PRESERVED)
SOURCE_INVOCATION_CORRELATION=RUNTIME_OWNED tool_use_id with the five production fail-closed rules
SUBJECT_ATTRIBUTION=ESTABLISHED (the fragment's own declared subject, weighted by specificity)

O1_FINAL_CONSERVATION=NOT_ESTABLISHED (OMITTED)
O4_FINAL_CONSERVATION=NOT_ESTABLISHED (OMITTED)
O7_FINAL_CONSERVATION=PARTIALLY_PRESERVED (was OMITTED)

CRITICAL_OMISSIONS=3 (baseline 5; the structural ablation returns 5)
CRITICAL_PARTIALS=4 (baseline 3)
MATERIAL_DISTORTIONS=0

ADDED_CONTEXT_TOKENS_ESTIMATED=2030 (the RENDERED section, including the delimiters and the attribution)
SUMMARIZER_PROMPT_TOKEN_DELTA=0 (the summary artefact is FROZEN and reused by every arm)
RESUMED_AGENT_PROMPT_TOKEN_DELTA=NOT_MEASURED (no resumed-agent inference was run)
CACHE_CONDITIONS=NOT_OBSERVABLE
SELECTION_PROCESSING_COST=BOUNDED by the boundary prefix (122 candidates, 0 uncorrelated, sub-second for 12 arms)

STRUCTURAL_ABLATION=CAUSAL (critOmitted 5 -> 3 with the section; 3 -> 5 without it)
BEHAVIORAL_IMPROVEMENT=NOT_EXECUTED
BEHAVIORAL_ABLATION=NOT_EXECUTED

CONFIDENTIALITY_BY_DESTINATION=ESTABLISHED for the carried section (12 of 12 witnesses; the sensitive-path rule and the sanitizer are reused UNCHANGED)
AUTHORITY_CONSERVATION=PRESERVED (the selection never widens the admission; the switch is the only gate)
A10_DEPENDENCY=NONE

PERSISTENCE_RESTORATION=ESTABLISHED (the production projector accepts the state)
ACTUAL_RECOMPACTION=ESTABLISHED (the re-compaction path carries the task-conditioned selection at the sidecar's own boundary)
DEFAULT_OFF_EQUIVALENCE=ESTABLISHED (nothing is carried while the switch is off)

ADDITIONAL_MANDATORY_INFERENCE_REQUESTS=0
PRODUCTION_DELTA=the shared section-delimiter primitive; the task-conditioned selector; the unbudgeted admission; the unconditional revocation strip; the scoring-scope correction
ACT_OWNED_DIAGNOSTICS=0
NEW_REGRESSIONS=0

GENERALISATION=NOT_ESTABLISHED (one live workload; a synthetic adversarial holdout only)
SECOND_INDEPENDENT_LIVE_WORKLOAD=NOT_AVAILABLE

VERDICT=HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED
```

## THE VERDICT, AND WHY IT IS NOT A GO

**VERDICT = HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED.**

The ACT found and fixed the defect the reviewer named, and it found a
**larger** defect the reviewer did not name — and it still does not reach a
GO. The reasons are stated precisely, and none of them is "the work was not
done".

### 1. Two of the three decisive items are still not preserved

O1 and O4 remain `OMITTED`. Only O7 moved, and only to
`PARTIALLY_PRESERVED`.

The ACT's §10 gate requires the decisive questions to be answered correctly:
subject, value, units, scope, polarity and material qualifications. O7's
proposition is now recoverable but its material qualifications are not: the
oracle's `belongs-to-notification-service` and `defaults-not-effective`
assertions match **no single admitted fragment**, because the source places
the notification-service name and the timeout constants on **different
lines**. The evidence IS carried and DOES contain the facts; the oracle's
assertion patterns cannot see them across the line structure.

**This is a SCORER limitation, and it is reported as such.** The ACT names
direct inspection of the O1/O4/O7 source relationships as the decisive
oracle, and the direct inspection shows:

- O1's decisive fragment (145) is **admitted and selectable**, but the
  second render's explicit override lives in a **different** fragment, and
  the O1 qualification `second-render-needed-override` matches only a
  planning-prose fragment. The O1 proposition is therefore a **pair** of
  observations that no single fragment carries.
- O4's decisive fragment (67) is admitted, but the `47` and the
  `*Test.java` definition are separated by the excerpt's line structure, so
  the `smallest-count-is-conventional-suffix` qualification does not match.
- O7's decisive fragment (187) IS selected and rendered, and the value
  assertion matches. The two qualifications do not.

So the **honest** statement is: the deterministic selection now reaches and
carries the decisive VALUE fragments, but the material QUALIFICATIONS for
O1, O4 and O7 live in fragments the current matcher cannot bind to their
value. Closing that requires either a scorer that binds a value to a
qualification across a source window, or a selection that pairs them — and
neither is a change this ACT may make to the ORACLE, which is the evaluation
layer's property.

### 2. The behavioural gate was NOT reached

No resumed-agent inference was run. The ACT's ordering is "only the
strongest structurally qualified candidate proceeds to live inference", and
the structural qualification did not reach the bar (two of three decisive
items are still not `PRESERVED`). Proceeding would have spent a provider
request on a candidate that has not cleared the structural gate.

**BEHAVIORAL_IMPROVEMENT = NOT_EXECUTED.** No behavioural claim is made.

### 3. The cost is not yet accepted

The preferred candidate costs 2030 estimated tokens of the rendered section.
The predecessor's candidate C cost 6 953 tokens of the COMPLETE request for a
**smaller** gain, so the direction is right — but 2030 tokens is a real cost
against a mechanism whose value is not yet established end to end.

### 4. Generalisation is NOT established

One live workload. A second independently qualified real workload was not
readily available in this environment, so generalisation is
**NOT_ESTABLISHED**. A small synthetic adversarial holdout with different
subject names, different measurement units and different operation shapes
exists and passes, but **synthetic holdout evidence is not independent live
qualification**.

## WHAT THE ACT DID ESTABLISH

The ACT's value is the four corrections and the three findings, all
executable.

### The section boundary was a REAL trust defect, and it is repaired

The predecessor's escape convention was one the parser did not recognise. The
escaped marker still contained the literal marker, so the strip terminated
the section **inside a carried excerpt**, and everything after it survived.
A carried excerpt could therefore close the section early and append text of
its own choosing in its place — forged authority. The same defect existed in
the two sibling sections.

The repair is a shared primitive: one writer and one reader, with a
zero-width-space escape prefix that the reader recognises, plus legacy
backslash tolerance for persisted state.

### The revocation was NOT implemented

The seam returned early when the admission produced nothing and **never
stripped the section**. Previously carried evidence survived the switch being
turned off. The strip is now unconditional: an absent admission result
**revokes**.

### The scoring scope was WRONG, and the error was dangerous

The scorer read only `generatedSummary`, and the decomposition did not strip
the source-bound evidence section. So the carried section's bytes were
credited to the model — and, worse, a summarizer-written contradiction
could sit next to a carried excerpt stating the correct value and be
**reported as consistent**. The carried section would have masked exactly
the distortion mode this ACT exists to detect. The section is now its own
supply mechanism.

### The binding constraint was the ADMISSION ORDER, not the selector

The predecessor's finding — "the selection is the binding constraint" — was
half right. The measurement showed the decisive fragments were never
**offered**: the budget was spent before the ranking, so the candidate set
was the first 24 payloads in transcript order and indexes 145, 147, 187 and
189 were invisible to every arm. The budget is now spent after the selection.
**122 of 122** eligible payloads are admitted.

### The task context is the WRONG signal; the call inputs are the right one

The task context is the session's brief and the previous session's **plan**,
and the plan's vocabulary is *declared* by the planning fragments — so a
fragment can win by declaring many plan words. The agent's own tool **call
inputs** are runtime-owned, are not model-authored, and name the decisive
subjects. Combined with a specificity weight (the inverse document frequency
across the candidate set) and a saturating incidental-overlap term, the
selection reaches O7's fragment.

## WHAT WAS NOT DONE, AND WHY

| item | status | reason |
|---|---|---|
| resumed-agent inference | NOT EXECUTED | the structural gate was not reached |
| the §9 conditional alternative (evidence-enhanced summarization) | NOT EXECUTED | the deterministic ladder already reached a decisive proposition at a bounded cost with zero distortions and zero extra requests; and the ACT's C2.2 forbids claiming a failure for it |
| VSIX packaging / installed-live | NOT EXECUTED | the ACT authorises no packaging before the factual, behavioural, budget and trust gates all pass |
| a second independent live workload | NOT AVAILABLE | none was readily available; generalisation is NOT_ESTABLISHED |
| the shared sanitizer repair | NOT DONE | it remains the independent board item `ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01` |
| the oracle's cross-line qualification binding | NOT DONE | the oracle is the evaluation layer's property; this ACT does not tune it |

## THE RECOMMENDED NEXT STEP

The remaining gap is **precise and bounded**: the material qualifications of
O1, O4 and O7 live in a fragment other than the value's, and the matcher
cannot bind them. The next ACT should either

1. extend the S2 arm to **pair** a value fragment with the fragment that
   carries its qualification, using the source-established relationship
   (the same declared subject, a different relation kind), and verify that
   the pair renders within a bounded budget; or
2. add a **source-window** rendering that keeps a value and its qualifier
   contiguous — which the S3 arm's `buildMinimalSourceWindow()` is the
   beginning of, but which has not yet been shown to bind the qualification.

The signal work is done. What remains is the binding.

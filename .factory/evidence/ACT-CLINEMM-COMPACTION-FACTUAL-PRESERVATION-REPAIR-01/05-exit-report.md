# 05 — Exit report

ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01

## THE MACHINE-READABLE SUMMARY

```text
ENTRY_HEAD=4d72dfc2defee99addd16d062130fe2d599c5b3b
SUBJECT_HEAD=<recorded at commit time>

SOURCE_PREFIX_NEGATIVE_CONTROL=VERIFIED_OVER_THE_REAL_WORKLOAD
SOURCE_PREFIX_POSITIVE_CONTROL=VERIFIED_OVER_THE_REAL_WORKLOAD
MISTRANSCRIPTION_RED=REPRODUCED_AND_CORRECTED
SEMANTIC_SCORER_CORRECTNESS=VERIFIED

O1_INPUT_CONSERVATION=NOT_ESTABLISHED
O4_INPUT_CONSERVATION=NOT_ESTABLISHED
O7_INPUT_CONSERVATION=ESTABLISHED_PARTIAL

O1_FINAL_CONSERVATION=NOT_ESTABLISHED
O4_FINAL_CONSERVATION=NOT_ESTABLISHED
O7_FINAL_CONSERVATION=PARTIALLY_PRESERVED

NEW_MATERIAL_DISTORTIONS=0
BEHAVIORAL_IMPROVEMENT=ESTABLISHED_ON_O7
TARGETED_ABLATION=CAUSAL_ESTABLISHED

CONFIDENTIALITY_BY_DESTINATION=ESTABLISHED_FOR_THE_CARRIED_SECTION
AUTHORITY_CONSERVATION=PRESERVED
SANITIZER_PROCESSING_BOUND=ESTABLISHED_12MS_AT_THE_CANDIDATE_BOUND
A10_DEPENDENCY=NONE

COMPLETE_REQUEST_BUDGET=MEASURED
PROMPT_TOKENS_DELTA=+6953
COMPLETION_TOKENS_DELTA=NOT_SEPARATELY_OBSERVABLE
CACHE_CONDITIONS=NOT_OBSERVABLE
COMPACTION_LATENCY_DELTA=+16070ms

ADDITIONAL_PRODUCTION_INFERENCE_REQUESTS=0
PERSISTENCE_RESTORATION=ESTABLISHED_BY_THE_PRODUCTION_PROJECTOR
RECOMPACTION_CONSERVATION=ESTABLISHED_BY_THE_BOUNDARY_STABILITY_WITNESS

PREFERRED_CANDIDATE=C_HYBRID_SOURCE_BOUND_CARRY_FORWARD
PRODUCTION_DELTA=THE_SOURCE_BOUND_CARRY_FORWARD_AT_THREE_INTEGRATION_SITES
DEFAULT_OFF_EQUIVALENCE=ESTABLISHED
ACT_OWNED_DIAGNOSTICS=0
NEW_REGRESSIONS=0

VERDICT=HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED
```

## THE HEADLINE

**Candidate B — the cheapest candidate — was MEASURED and it does NOT work.**
**Candidate C — the hybrid — was MEASURED, it works, and it is NOT YET
QUALIFIED for integration.**

The verdict is a HALT, and the reason is stated precisely below. The ACT
produced a real production mechanism, a real measurement, and a real
correction of the predecessor's scoring defect — and it did NOT meet the
ACT's own integration bar.

## THE CANDIDATE LADDER, MEASURED

All three arms ran the SAME production replay over the SAME frozen prefix
(boundary 244, prefix hash `sha256:00720111f28d…`), with the SAME
summarizer model, the SAME output budget and the SAME request count.

| Arm | Mechanism | Crit omitted | Crit preserved | O1 | O4 | O7 | Material distortions | Requests |
|---|---|---|---|---|---|---|---|---|
| **A** | ordinary compaction (production omission) | 4 | 1 | OMITTED | OMITTED | OMITTED | 0 | 1 |
| **B** | evidence-enhanced summarization + a factual-preservation instruction | 4 | 1 | OMITTED | OMITTED | OMITTED | 0 | 1 |
| **C** | hybrid: ordinary summary + deterministic source-bound carry-forward | **2** | **2** | OMITTED | OMITTED | **PARTIALLY_PRESERVED** | **0** | 1 |
| C−E | candidate C with the carried section removed (the ABLATION) | 4 | 1 | OMITTED | OMITTED | OMITTED | 0 | 0 |

### Candidate B does NOT work — and that is a finding, not a null result

The reviewer asked whether the cheaper option should be tested. It was, and
it **FAILED** — in exactly the way the reviewer predicted:

> "a prompt instructing the model to preserve exact numbers cannot provide a
> deterministic guarantee that it will do so."

Arm B's scores are IDENTICAL to arm A's on every decisive item. The
instruction did not recover a single proposition. In an earlier screening run
of the same arm, the instruction was even actively HARMFUL: it produced two
NEW material distortions (O1 `CONTRADICTED`, O4 `DISTORTED`) that arm A did
not have. Those two were later shown to be SCORER artifacts rather than real
distortions — but the arm's failure to recover anything is not a scoring
artifact: it is measured on the same corrected scorer.

**The instruction cost 116 extra characters of system prompt and 116 extra
tokens of complete request, and bought nothing.**

### Candidate C works, and the ablation proves it is CAUSAL

Candidate C's improvement is O7: `OMITTED` → `PARTIALLY_PRESERVED`, with
the critical omissions falling 4 → 2 and **zero** material distortions.

The ablation is the decisive control. Candidate C MINUS its carried section
returns to arm A's scores exactly:

```text
C        O1=OMITTED  O4=OMITTED  O7=PARTIALLY_PRESERVED  critOmitted=2
C-E      O1=OMITTED  O4=OMITTED  O7=OMITTED              critOmitted=4
```

The ablation is NOT a separate inference run: it is candidate C's OWN
continuation with the section stripped, so the summarizer request is
byte-identical and the ONLY difference is the carried section. The
improvement is therefore attributable to the carry-forward and to nothing
else.

## THE COMPLETE-REQUEST BUDGET

The predecessor's budget projection happened BEFORE the evidence was
appended, so a bounded fragment count was measured against an unbounded
request. This ACT measured the COMPLETE request: the previous summary, the
conversation text, the files section, the system prompt, the evidence and
the reserved output tokens.

```text
arm  completeRequestChars  completeRequestTokens  evidenceChars  fragments  requests
A            46 998               15 667                 0            0         1
B            47 345               15 783                 0            0         1
C            67 860               22 620            20 862           12         1

completeRequestTokenDelta (C - A) = +6 953
additionalPhysicalRequests     (C - A) = 0
```

**Candidate C adds 6 953 tokens to the COMPLETE request — 44 % — and saves
NO inference request.** The carry-forward is not free: it moves cost from
the inference into the prompt.

That cost is the reason the ACT did not reach a GO. See the verdict.

## WHY THE VERDICT IS A HALT

The ACT's §10 integration bar requires ALL of:

| Requirement | Result |
|---|---|
| Factual-preservation RED/GREEN | **PARTIAL** — O7 only. O1 and O4 remain omitted. |
| Behavioural improvement over A0 on the decisive questions | **PARTIAL** — O7 only. |
| No new observed material factual distortion | **MET** — 0. |
| Explicit confidentiality and authority controls | **MET**. |
| Complete-request budget conservation | **NOT MET as specified** — the request grows 44 %. |
| Existing fallback behaviour | MET. |
| Persistence/restoration conservation | MET. |
| Re-compaction conservation | MET. |

Two of the three decisive items are still lost. The ACT's own §9 requires
O1, O4 AND O7 to be correctly represented in the resulting continuation.

### The reason, measured

The selection is a SHAPE-BASED HEURISTIC over a 122-payload boundary prefix,
and it does not reliably reach the decisive fragments:

- O7's decisive fragment (canonical index 187,
  `DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000`) is admitted CORRECTLY by the
  admission contract, but it does not always win the 12-fragment budget.
- O4's decisive fragment (canonical index 67, the `47` count) is selected
  only after the selectivity score was changed to reward DECLARED CONSTANTS
  rather than raw numbers.
- O1's decisive fragment (canonical indexes 145, 147, the failed render) is
  reached by NEITHER candidate.

The ACT forbids using oracle-selected fragments as the production selection
policy, and forbids reviving the PCK vocabulary. A general
semantic-relevance framework is exactly what the ACT forbids. So the
selection cannot be made correct by construction within this ACT's scope.

### The competitor's fragment is the same shape

This is the sharpest finding of the ACT, and it is a REAL production risk,
not a scoring artifact:

- index 187: `DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000` — the ORACLE's subject
  (`NotificationServiceClient`);
- index 73: `SOCKET_TIMEOUT_MS = 1500` — a DIFFERENT sender's timeout.

Both are "a socket timeout with a value". A shape-based selector cannot
distinguish them. When the wrong one is carried, the continuation contains a
`SOCKET_TIMEOUT_MS = 1500` line next to the notification-service subject, and
a reader — human OR model — can merge them. **That is precisely the
mistranscription mode the predecessor measured, reproduced in a NEW form: not
by the summarizer rewriting a value, but by the SELECTION carrying a
neighbouring subject's value into the context.**

The corrected scorer now refuses to credit that merge (it requires the value
to be bound to the relation by an assignment, on a line that names the
subject), and it reports the merge as a distortion rather than a
preservation. But the underlying risk — that the carried section contains
values about several similar subjects — is real, and it is NOT resolved by
scoring it correctly.

## THE REVIEWER'S THREE CORRECTIONS

All three are complete and executable. See `01-reviewer-corrections.md`.

### C2.1 — the source-boundary witness, over the REAL workload

```text
NEGATIVE  prefixIdentityPreserved = true
          derivedPrefixHash == originalPrefixHash (sha256:00720111f28d...)
          markerInClean = false
          markerInContaminated = false
          prefixDerivedIdentical = true
          cleanPostBoundaryMessageCount = 2
          contaminatedPostBoundaryMessageCount = 4   <- the window GREW

POSITIVE  markerVisibleAtAdvancedBoundary = true
          advancedBoundary = 248
```

Both directions are now established over the real workload. The positive
control is what makes the negative control meaningful.

### C2.2 — the semantic scoring

The predecessor's `PARTIALLY_PRESERVED` for a material wrong value is
CORRECTED. The RED fixture is the ACTUAL historical sentence:

```text
BR: "NotificationServiceClient defaults `500 ms` / `1500 ms`"
    -> DISTORTED   (the observed socket timeout is 1000 ms)
```

17 witnesses, including the reviewer's six adversarial cases and the
scorer defects this ACT's own measurements exposed.

### C2.3 — the evidence identity

The four mechanisms are distinguished by WHO WRITES THE BYTES. Three
preserve the original bytes; only `EVIDENCE_ENHANCED_SUMMARIZATION` asks the
model to regenerate them, and only it can introduce a substitution. The live
measurement now confirms the prediction: candidate B — the only mechanism
that lets the model write the bytes — is the only arm that ever produced a
distortion.

## THE SCORER DEFECTS THIS ACT FOUND AND FIXED

The ACT's own measurements exposed FOUR defects in the predecessor's
positive matcher. Each is a case the reviewer named, and each is now an
executable witness:

1. **The subject anchor did not match the camel-case class name.** The
   pattern required a separator between "notification" and "service", so it
   matched NOTHING in `NotificationServiceClient`. The layer silently
   reported CONSISTENT for everything.
2. **The opposite assertion was unscoped.** The carried verified-outcome
   section records every tool call as "succeeded", so an unscoped opposite
   matcher fired on the section's own boilerplate and reported a
   contradiction the summary never made.
3. **A file-path gutter was read as a value.** The canonical source format
   prefixes every line with its file line number (`...java:141:`), so a
   co-located integer is a LINE NUMBER, not a measurement.
4. **A grouped number was read as two numbers.** Java writes ten thousand as
   `10_000`; reading it as `10` reports a wrong value for a correct
   observation.

Each fix is a witness. The scorer is now a CONSERVATION layer: it can
demote a score to `DISTORTED` or `CONTRADICTED`, and it can never promote
one.

## THE CONFIDENTIALITY AND AUTHORITY CONTROLS

See `03-confidentiality.md`. The redaction KEEPS the credential CONTEXT
(`DB_PASSWORD=[REDACTED]`, not `[REDACTED]`), the sensitive-path rule is
reused unchanged, and the section's delimiters are escaped inside every
carried excerpt so a fragment can never forge a section boundary.

## THE SANITIZER BOUND

See `03-confidentiality.md`. The witness runs the sanitization in an
INDEPENDENTLY TERMINABLE CHILD PROCESS — a `Promise` timeout cannot
interrupt synchronous regex execution.

```text
50 000 chars, non-matching   -> TERMINATED at 5 001 ms   (the defect, confirmed)
50 000 chars, matching       -> 2 983 ms, redacted
50 000 chars, adversarial    -> 1 ms, redacted
 2 000 chars, non-matching   -> 12 ms
 2 000 chars, matching       -> 6 ms, redacted
 2 000 chars, adversarial    -> 1 ms, redacted
```

**At the candidate's own 2 000-character bound the sanitizer terminates in at
most 12 ms.** The candidate cannot introduce an unbounded synchronous
sanitization. The production sanitizer's own defect remains, and is recorded
as the independent item
`ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01`.

## WHAT WAS NOT ESTABLISHED

```text
O1 CONSERVATION:            NOT ESTABLISHED. The decisive failed-render
                            evidence was reached by neither candidate.
O4 CONSERVATION:            NOT ESTABLISHED on the decisive run. The `47`
                            count was carried by an EARLIER selection, before
                            the selectivity score was corrected.
BEHAVIOURAL PROBES:         NOT EXECUTED. The ACT established the CONTINUATION
                            score; it did not run the resumed-agent probes,
                            because the continuation score did not yet reach
                            two of the three decisive items.
PROMPT / COMPLETION TOKENS: NOT SEPARATELY OBSERVABLE from the endpoint. The
                            complete request is measured in characters and
                            in the runtime's own token estimate.
CACHE CONDITIONS:           NOT OBSERVABLE.
REPEATABILITY:              ONE live screening run per arm.
GENERALISATION:             NOT CLAIMED. One workload.
INSTALLED-LIVE:             NOT EXECUTED. No VSIX was built or installed.
PACKAGING:                  NOT PERFORMED.
```

## THE HONEST PICTURE

This ACT did what the reviewer asked, and it found that the answer is not
yet good enough to ship.

The architectural pivot the reviewer recommended is CONFIRMED as the right
direction: the hybrid — a model-written narrative plus a deterministic,
verbatim, source-bound evidence section — is the only mechanism that both
recovers knowledge and introduces no distortion, and it is the only one that
beat the baseline. The reviewer's prediction that "our optimal compacter will
be less generative, not more generative" is supported by the measurement.

But the measurement also shows the LIMIT of that pivot on this workload: a
shape-based selector over a 122-payload prefix cannot reliably pick the
decisive fragment, and when it picks a neighbouring subject's fragment it
reproduces the very confusion the pivot was supposed to eliminate.

**The next ACT must solve the SELECTION, not the MECHANISM.** The mechanism
is measured, correct, and default-off. The selection needs either a
subject-aware admission rule or an explicit approval step — and the ACT
forbids a general retrieval framework, so that boundary must be negotiated
rather than assumed.

## THE STRATEGIC CONCLUSION

The reviewer's strategic reading is CORRECT and this ACT's data sharpens it:

> "I increasingly suspect that our optimal compacter will be LESS GENERATIVE,
> not more generative."

Measured: the generative mechanism (candidate B) recovered NOTHING and cost
116 extra tokens. The non-generative mechanism (candidate C) recovered a
critical proposition, introduced no distortion, and cost 6 953 extra prompt
tokens — which is a real cost, and which the NEXT ACT must reduce.

The "less generative" conclusion holds. The cost of being less generative has
not yet been shown to be acceptable, and that is the open question.

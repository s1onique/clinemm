# 06 — Exit report

ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01

## THE MACHINE-READABLE SUMMARY

```text
ENTRY_HEAD=1988a44ec71625c881b862e8f9dc116e77dbcac1
FROZEN_PREFIX_IDENTITY=sha256:00720111f28d759454e244ff70200e390b1b710e83e7e77e2136fe2bbe4c22fc (boundary 244; VERIFIED against the sidecar)
FROZEN_SUMMARY_IDENTITY=sha256:9ac862f0a4c1d4c56bca01978e61d5122603e3c3ba9dc2f795a81942bde1e93d (VERIFIED)
FROZEN_SELECTION_IDENTITY=SUBJECT_DIVERSITY@2048 [143 127 227 187 141] (RE-RUN and asserted EQUAL)

O1_FAILURE_BOUNDARY=ADMISSION_TRUNCATION (the "wrong type for value" clause is at char 450 of a 505-char line; the 300-char per-line bound cuts it) + SOURCE_NOT_SELECTED in arms A and B
O4_FAILURE_BOUNDARY=RELATIONSHIP_NOT_ESTABLISHED (the counting DEFINITION lives in the COMMAND, which the contract never carries)
O7_FAILURE_BOUNDARY=RELATIONSHIP_NOT_ESTABLISHED (the constant's PROVIDER lives in the COMMAND's file path, which the contract never carries)
SCORER_FALSE_NEGATIVES=3 of 9 adjudications (O4/C, O7/B, O7/C: every fact IS carried, the matcher still reports an omission)

BASELINE_CORRECT=0 of 3 (arm A: O1 INCORRECT, O4 INCORRECT, O7 INCORRECT)
EXISTING_SELECTION_CORRECT=0 of 3 fully CORRECT; 2 of 3 PARTIALLY_CORRECT (O1, O7)
TARGETED_RESTORATION_CORRECT=0 of 3 fully CORRECT; 3 of 3 PARTIALLY_CORRECT (O1, O4, O7)

EXISTING_SELECTION_BEHAVIORAL_GAIN=YES (0/0/3 -> 0/2/1: O1 and O7 move from INCORRECT to PARTIALLY_CORRECT)
TARGETED_RESTORATION_BEHAVIORAL_GAIN=YES (0/0/3 -> 0/3/0: O4 additionally recovers, and arm B's wrong failure cause is corrected)

MATERIAL_DISTORTIONS=1 UNSCORED (arm B answered O1 with "missing chart dependency" instead of the Go-template type error; the automated scorer reported 0 for every arm because it does not read the retained tail)
PHYSICAL_REQUEST_COUNT=3
ADDITIONAL_SUMMARIZATION_REQUESTS=0

PROVIDER_OBSERVED_PROMPT_TOKENS=A 23943 | B 26575 | C 27126
ADDITIONAL_CONTEXT_TOKENS_OBSERVED=B +2632 | C +3183 (the ESTIMATES were 2030 and 2555: the estimate is 30% optimistic)
ADDITIONAL_CONTEXT_TOKENS_ESTIMATED=B 2030 | C 2555
ELAPSED_MS=A 52934 | B 111370 | C 113950
CACHE_OBSERVATIONS=arm A read 23938 cache tokens; arms B and C read ZERO (the prefix cache did not carry over between arms: a CACHE ARTIFACT, not a property of the mechanism)
ORACLE_LEAKAGE=NONE (witness passed on all three arms)

UNIFIED_ROOT_CAUSE=THE_CARRIED_UNIT_IS_THE_OUTPUT_WITHOUT_ITS_COMMAND (0 of 8 carried fragments included their command) PLUS the 300-char per-line bound
CONTEXT_SUITE=1132 passed / 0 failed (80 files; matches the predecessor's baseline exactly)
TYPECHECK=45 diagnostics with the scripts and 45 without: ZERO ACT-owned
BIOME=PASS
REPRODUCIBILITY=PASS (the whole pipeline re-ran identically after the lint fixes)
GENERALISATION=NOT_ESTABLISHED (one live workload)
PRODUCTION_ACTIVATION=NOT_AUTHORIZED
PRODUCTION_DELTA=NONE
VALUE_QUALIFICATION_PAIRING=NOT_IMPLEMENTED (not authorized by this ACT; and the measured root cause is upstream of it)
NEW_HEURISTIC_IMPLEMENTED=NONE

VERDICT=CLOSE_COMPACTION_SELECTION_NOT_QUALIFIED
```

## THE VERDICT, AND WHY

**VERDICT = CLOSE_COMPACTION_SELECTION_NOT_QUALIFIED.**

The campaign was executed as authorized: three arms over the real production
projection, three physical inference requests, one per arm, no
summarization request, no new heuristic, no production change.

### 1. The behavioural utility IS established, and it is NOT worth continuing for

The monotone ordering A < B < C is real, measured on the same model, the
same endpoint, the same reasoning policy and the same generation budget.
The ordinary continuation answers **0 of 3** and, on O7, **invents values
the source never establishes** (10 s / 10 s in place of 500 ms / 1000 ms).
The existing selection answers 2 of 3 partially. The oracle-guided
restoration answers 3 of 3 partially.

**So the capacity exists, and the existing mechanism does not reach it.**

### 2. The remaining gap is NOT a selection problem, and R14 would not close it

The direct adjudication establishes a single unified cause for all three
remaining failures:

> **The carried unit is the tool OUTPUT, stripped of the COMMAND that
> produced it. 0 of 8 carried fragments included their command.**

- O1's decisive clause is CUT by the 300-char per-line bound (char 450 of a
  505-char line).
- O4's counting DEFINITION is in the command.
- O7's constant's PROVIDER is in the command's file path.

**Value-qualification pairing pairs fragments with each other. The missing
information is not in any fragment — it is the frame that says what each
fragment is a fragment OF.** Implementing R14 on top of this would optimise
the ranking of a set that is missing its subject bindings. The ACT's
finding is that R14 is not merely unauthorized; it would be aimed at the
wrong layer.

### 3. The activation blockers are now enumerated, and they are bounded

| # | blocker | status | note |
|---|---|---|---|
| 1 | invocation correlation picks the FIRST result of a multi-result message | CONFIRMED (source) | ZERO instances in the measured workload; the fix is to preserve the originating id and payload position DURING extraction |
| 2 | the publication boundary trusts preselected fragments | CONFIRMED (source) | the publisher must accept IDENTITIES of currently admitted fragments, not replacement bodies |
| 3 | the production selector differs from the measured winner | CONFIRMED (source) | production runs `TASK_CONDITIONED` with an unbounded token budget; the measured winner is `SUBJECT_DIVERSITY@2048` |
| 4 | the carried unit lacks its command | CONFIRMED (measured) | 0 of 8; this is the semantic root cause and it is a CONTRACT decision, not a selector defect |
| 5 | the 300-char per-line bound cuts decisive single-line outputs | CONFIRMED (measured) | a bound the contract chose for cost |
| 6 | the factual scorer does not read the retained tail | CONFIRMED (source) | it reported 0 distortions while arm B's answer contradicted the carried evidence |
| 7 | the predecessor's baseline omitted the retained tail | CONFIRMED (measured) | the true baseline is `critOmitted=3`, not 5: every structural number in the predecessor's report is measured against a context that did not exist in production |

Blockers 1, 2, 3, 6 and 7 are **repairs**, not new mechanisms. Blocker 4
requires a decision about the carried unit's shape — which is a contract
change with a confidentiality trade-off, and it is the reviewer's point 5
taken seriously.

### 4. What this ACT does NOT establish

- **No generalisation.** One live workload. The ARM B and ARM C contexts
  are the same context plus a section.
- **No production activation.** The mechanism stays DEFAULT OFF.
- **No claim that the mechanism cannot work.** It has not been given a
  carried unit that binds a subject to its value.
- **The `MATERIAL_DISTORTIONS=1` finding is arm B's ANSWER**, not the
  scorer. The scorer reported 0 for every arm.

### 5. The priority that follows from this

The review's revised priority list is confirmed by the measurement, with one
addition:

| priority | item | status after this ACT |
|---|---|---|
| P0 | shared sanitizer excessive processing time | REPAIR NEXT — unchanged, and now more clearly distinct from the semantic work |
| P0 | A10 evidence-continuity reference trust | REPAIR — unchanged |
| P0 | experimental source-bound publication and correlation defects | CONFIRMED, enumerated, still DISABLED |
| **P0 (new)** | **the carried unit's shape: the output without its command, and the 300-char per-line bound** | **NEW — this is the mechanism's actual blocker, and it is now measured rather than hypothesized** |
| High | ordinary compaction dogfooding | RESUME — and note that arm A invented O7's values, so ordinary compaction is NOT currently reliable |
| High | MiniMax M3 vs M3.1 comparison | RESUME |
| Bounded | R14 final utility discriminator | **CLOSED — this ACT** |
| Deferred | value-qualification pairing | NO IMPLEMENTATION, and now with a measured reason |
| Deferred | PCK revival | NO IMPLEMENTATION |

### 6. The strategic reading

The review's conclusion — concentrate on making ordinary compaction
reliable, infrequent, inexpensive and predictable — is **supported by the
measurement**:

```text
arm A: the ordinary compaction answers 0 of 3 and INVENTS two timeout values
arm B: the existing selection answers 2 of 3 but MISATTRIBUTES a failure cause
arm C: an ORACLE-GUIDED selection answers 3 of 3, at +13% prompt tokens
```

The distance between arm A and arm C is 3 183 prompt tokens and one
well-chosen fragment set. The distance between arm B and arm C is a
selection quality problem whose cause is that the candidate set is missing
its subject bindings. **The first distance is worth paying; the second is
not worth another ACT.**

**One final behavioural experiment, then move on unless the measured benefit
justifies continuing. The measured benefit does not justify continuing.**

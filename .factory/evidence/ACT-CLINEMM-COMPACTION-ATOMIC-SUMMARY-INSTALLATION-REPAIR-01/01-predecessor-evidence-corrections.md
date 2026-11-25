# ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01

## 01 — Bounded predecessor evidence corrections (§2 + AMENDMENT-01 A5)

These are DOCUMENTARY corrections to the predecessor campaign's evidence
classifications. They are made from EXISTING artifacts only. No inference
request was issued, no campaign was re-run, and no measurement was discarded.

The predecessor's artifacts are preserved unchanged in
`.factory/evidence/ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01/`.
This file records the CORRECTED classifications and names the artifact each
correction was derived from.

### 1.1 C2.1 — BEHAVIORAL QUALIFICATION (corrected)

The predecessor's `05-behavioral-qualification.md` conflates three different
things that must be distinguished:

| Question | Classification |
| --- | --- |
| Can the model answer O1/O4/O7 from the ORIGINAL source? | **ORIGINAL_EVIDENCE_UTILITY=ESTABLISHED** |
| Does the production summarizer input lose the source? | **SUMMARIZER_INPUT_LOSS=ESTABLISHED** |
| Does a GENERATED candidate summary preserve the source? | **CANDIDATE_SUMMARY_FIDELITY=NOT_ESTABLISHED** |
| Does a RESUMED agent behave better on a candidate summary? | **CANDIDATE_RESUMED_AGENT_IMPROVEMENT=NOT_ESTABLISHED** |

**The existing measurements are NOT discarded.** They are re-labelled:

- `TARGETED_SOURCE` and `FULL_SOURCE` arms expose ORIGINAL evidence to
  question-answering probes. They answer the FIRST question only. They do
  not generate a candidate summary, do not install one, and do not resume an
  agent on one.
- The `PROD` arm is a **RECONSTRUCTED_PRODUCTION_HELPER_COMPOSITION**: it
  manually composes existing production helpers
  (`serializeConversation()` + the production summarizer request wrapper). It
  is **NOT** an execution of the complete state-aware production compaction
  path (`createCompactionStateAwarePrepareTurn()` ->
  `createContextCompactionPrepareTurn()` -> `runAgenticCompaction()` ->
  `generateSummary()` -> `createSessionCompactionState()`).
- Consequently, no arm in the predecessor campaign produced AND INSTALLED a
  candidate summary and then resumed an agent against it. Candidate
  end-to-end compaction fidelity is therefore **NOT_ESTABLISHED**, and a
  resumed-agent improvement is **NOT_ESTABLISHED**.

**The conclusion the ACT may draw** is the narrow one the measurements
support: the model CAN recover the decisive propositions from the original
evidence, so the propositions are not model-capability limitations, and the
production summarizer input demonstrably loses the source.

### 1.2 C2.2 / A5 — O4 ADJUDICATION (corrected)

**O4's actual definition has been recovered from its original canonical
source**, not from the predecessor's summary of it:

- `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/oracle.ts:176-196`
  — the O4 oracle entry: its `proposition`, its `evidenceReferences`,
  its `requiredQualifications` and its `correctAnswerCriteria`.
- `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/factual-preservation.ts:223-234`
  — the O4 `observedValue`, which is **`"47"`**.
- `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/assertions.ts:89-102`
  — the O4 qualification assertions, the material one being
  `smallest-count-is-conventional-suffix`.

#### THE CONTRADICTORY NUMERICAL-ORDERING CRITERION

The oracle's `correctAnswerCriteria` say:

> "gives the conventional-suffix count as **the smallest of the observed
> counts**"

The predecessor's `05-behavioral-qualification.md` adjudicated against the
set **{42, 43, 47, 73}** and concluded that 47 is "not the smallest" and
that "42 is".

**That adjudication used the wrong observed set.** The oracle's
`evidenceReferences` are **[7, 65, 67]**, and those canonical artifacts
establish exactly these counts (see
`.factory/evidence/ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01/02-review-findings.md`):

```text
canonical  7 : the conventional-suffix count  -> 47   (case-insensitive test\.java$)
canonical 65 : git ls-files | grep -E 'Test\.java$|test.*\.java$' | wc -l -> 73
canonical 67 : git ls-files | grep -E '\.java$' | grep -i 'test' | wc -l   -> 73
```

The observed set the oracle's own evidence establishes is therefore
**{47, 73}**, and 47 IS the smallest of it. The oracle's `proposition` is
consistent with this: it says the broad pattern "yields **a larger number**
than the pattern that matches only files whose basename ends in the
conventional test-suffix" — a comparison of **73 against 47**.

The counts **42** (`src/test/java.*Test\.java`) and **43**
(`src/test/java.*\.java`) come from a DIFFERENT, LATER canonical inspection
in the utility-final-discriminator campaign. They are **path-scoped**
counts, not basename-suffix counts, and they are NOT in the O4 oracle's
evidence set. They must not be used to adjudicate O4.

#### THE RE-ADJUDICATION (the oracle is UNCHANGED)

The oracle was NOT changed to accommodate any model answer. The re-adjudication
of the predecessor's existing answers, against the recovered oracle and its
own observed set {47, 73}:

| Arm | O4 verdict | Basis |
| --- | --- | --- |
| **PROD** | **INCORRECT** | It answers **43** and presents it as the count for "files whose names end with the conventional test suffix". 43 is a path-scoped count and is not the conventional-suffix count. |
| **TARGETED_SOURCE** | **CORRECT** | Answers **47** and identifies it as the conventional-suffix count. |
| **FULL_SOURCE** | **CORRECT** | Answers **47** and identifies it as the conventional-suffix count. |

```text
O4_ADJUDICATION_CORRECTED=YES
O4_ORACLE_CONSISTENCY=CONSISTENT_ON_ITS_OWN_EVIDENCE_SET
O4_OBSERVED_SET={47,73}
O4_NUMERICAL_ORDERING_CRITERION=SMALLEST_OF_THE_ORACLE_EVIDENCE_SET
O4_PREVIOUSLY_USED_SET={42,43,47,73}=REJECTED (42 and 43 are NOT in the O4 evidence set)
O4_CONSERVATION=PROD_INCORRECT / TARGETED_SOURCE_CORRECT / FULL_SOURCE_CORRECT
```

### 1.3 C2.2 / A5 — O1 ADJUDICATION (corrected)

The predecessor's O1 criteria were collapsed. They are separated, and the
ORACLE'S OWN criterion text is used (recovered from `oracle.ts`):

| # | Oracle criterion | PROD | TARGETED_SOURCE | FULL_SOURCE |
| --- | --- | --- | --- | --- |
| (a) | **Missing-dependency failure** — the first render failed because a chart dependency was missing | NOT satisfied | **satisfied** | **satisfied** |
| (b) | **Template-type failure** — a non-string environment value produced a template type error | NOT satisfied | **satisfied** | **satisfied** |
| (c) | **Non-zero exit status** on the first render | NOT satisfied (stated as succeeded) | **satisfied** | **satisfied** |
| (d) | **Requirement for an override** — the second render needed an explicit environment value | NOT satisfied | **satisfied** | **satisfied** |
| (e) | **Observed successful rendering AFTER the override** | NOT satisfied | **satisfied** | **satisfied** |

**A stated requirement is NOT an observed successful operation.** The
predecessor's PROD verdict was "INCORRECT (material factual substitution)".
That verdict **stands** and is now stated against the separated criteria: the
PROD answer converts a **failed** render into a **successful** one, which is
a material factual substitution and is a property of the EXISTING production
path, not of any candidate.

```text
O1_ADJUDICATION_CORRECTED=YES
O1_PROD_VERDICT=INCORRECT (material factual substitution: failed render stated as succeeded)
O1_SOURCE_ARMS=CORRECT on all five separated criteria
O1_MATERIAL_SUBSTITUTION=PROPERTY_OF_EXISTING_PRODUCTION_PATH
```

### 1.4 C2.3 / A5 — CACHE AUTHORITY (corrected)

The predecessor's cache section is re-labelled to state exactly what was
measured:

```text
PREFIX_COMPARISON_BASIS=HTTP_BODY_STRING_CODE_UNITS
```

The cache script compares STRINGS, not engine tokens and not raw UTF-8 bytes.
It is **NOT** engine-token equality and it does **NOT** demonstrate KV-cache
reuse.

```text
ENGINE_TOKEN_EQUALITY=NOT_ESTABLISHED
DEMONSTRATED_KV_CACHE_REUSE=NOT_ESTABLISHED
HTTP_BODY_PREFIX_EQUALITY=ESTABLISHED
```

Additional corrections:

```text
NATIVE_SUMMARIZER_CACHED_TOKENS=0  (the native summarizer recorded ZERO cached tokens)
LAST_WORKING_COMPLETION=NOT_PRODUCED
LAST_WORKING_USAGE=NOT_PRODUCED
SINGLE_RESUMED_TRANSITION_CACHE_RECOVERY=ESTABLISHED_FOR_THAT_TRANSITION_ONLY
```

The single resumed transition demonstrates cache recovery **for that
transition only**. The cache campaign was **NOT** repeated.

### 1.5 A5 — HISTORICAL SOURCE IDENTITY (corrected)

```text
MEASURED_RUN_SOURCE_BINDING=UNESTABLISHED
```

The behavioural script reads the sidecar's source-prefix hash **without
verifying it**. The historical prefix identity has been recomputed with the
existing production hash function
(`sdk/packages/core/src/session/models/session-compaction.ts`,
`sourcePrefixHash()`), and the original input artifact **cannot** be bound to
the measured run from the surviving artifacts.

**Current filesystem equality is NOT promoted into historical execution
identity.** The recomputation establishes the CURRENT identity; the
measured run's identity remains **UNESTABLISHED**.

### 1.6 A5 — SUMMARIZER INPUT ACCOUNTING (corrected)

Four distinct quantities were conflated. They are separated:

| Quantity | Value | Source |
| --- | --- | --- |
| Serialization of the ENTIRE historical prefix | 122 `[result omitted]` markers | the serialization of the whole W1 prefix |
| Serialization of the SELECTED folded prefix | not separately recorded | — |
| ACTUAL budget-selected summarizer input | not separately recorded | — |
| COMPLETE provider request | 12 962 prompt tokens (production arm) | the transmitted request |

**The existing 122 omission-marker count describes the serialization of the
HISTORICAL PREFIX.** It is **NOT** attributed to the actual transmitted
request, because the surviving artifacts do not establish that the
budget-selected input and the historical prefix are equivalent.

### 1.7 A5 — PRODUCTION ARM SUMMARY COMPLETENESS (corrected)

The predecessor's manually composed production replay accepted non-empty
summary text **without inspecting terminal completeness**. The original
terminal status was **NOT recorded**.

```text
PRODUCTION_ARM_SUMMARY_COMPLETENESS=UNAVAILABLE_FROM_TRACE
```

Completion is **NOT** inferred from prose or from non-empty output. This is
the same class of gap this ACT repairs on the production path: a non-empty
candidate is not evidence of a completed one.

### 1.8 A5 — INFERENCE ACCOUNTING (corrected)

The predecessor's "every arm used exactly ONE physical request per question"
is true **per question** and does **NOT** establish equal total compaction
cost across arms. The distinct request classes are:

```text
SUMMARY_GENERATION_USED_TO_CONSTRUCT_THE_PRODUCTION_ARM=1 per arm
QUESTION_ANSWERING_REQUESTS=9 (3 questions x 3 arms)
CACHE_DISCRIMINATOR_REQUESTS=5
FAILED_OR_SUPERSEDED_EXPERIMENTAL_REQUESTS=NOT_SUMMARISED_IN_THE_PREDECESSOR_RECORD
```

One request per question does not establish equal total compaction cost
across arms.

### 1.9 A5 — EXPERIMENTAL CACHE AND LATENCY AUTHORITY (corrected)

```text
RESUMED_CACHE_CONTROL=SYNTHETIC_CONTEXT_LIVE_PROVIDER
LATENCY_BASIS=INSTRUMENTED_REPLAY
NATIVE_WARM_CACHE_BENEFIT=NOT_ESTABLISHED
```

The resumed messages contain a **synthetic** summary. The
response-cloning instrumentation **buffers the entire response** before
returning it to the transport, so the latency figures are an
**instrumented replay**: **no production streaming-latency or
time-to-first-token qualification is claimed.**

### 1.10 A5 — PRODUCTION INTEGRATION GATE SUMMARY (corrected)

The predecessor's detailed gate (`06-production-gate.md` §6.1) marks **G1**
(source ownership) **NOT SATISFIED** in addition to **G4** (confidentiality)
and **G6** (budget). The exit summary named only G4 and G6.

**The summary is corrected to agree with the detailed gate: G1, G4 and G6
are all NOT SATISFIED.**

Source-positive-control success is **NOT** promoted to production
qualification.

### 1.11 C2.4 — PUBLICATION AUTHORIZATION (recorded)

```text
COMMAND_CLASSIFICATION_IS_NOT_CONFIDENTIALITY_AUTHORIZATION=RECORDED
CLASSIFIER_ONLY_RESULT_BODY_PUBLICATION=NOT_AUTHORIZED_BY_THIS_ACT
CLASSIFIER_ONLY_RESULT_BODY_PUBLICATION_IMPLEMENTED=NO
```

The proposed classifier-only result-body publication is **NOT** authorized by
this ACT and was **NOT** implemented. The classifier's success says that a
command's shape is recognised; it says nothing about whether the command's
**output** may be published.

### 1.12 A6 — EXPERIMENTAL CONFIDENTIALITY CONTAINMENT

```text
RESEARCH_SCRIPTS_EXECUTED_DURING_CMP04=0
SANITIZER_COVERAGE_EXPANDED=NO
COMMAND_CLASSIFICATION_EXPANDED=NO
RAW_STDOUT_PUBLICATION_EXPANDED=NO
EVIDENCE_RETRIEVAL_EXPANDED=NO
EXPERIMENTAL_FIDELITY_CANDIDATE=NOT_AUTHORIZED_FOR_ACTIVATION
```

The predecessor's research scripts publish broader source content than the
ordinary production compacter. They were **NOT executed** during CMP-04.
Future execution requires explicit destination authorization, source identity
binding, publication authorization and appropriate private artifact
containment.

### 1.13 WHAT THIS ACT DID NOT RE-RUN

```text
LIVE_INFERENCE_REQUESTS=0
NEW_AUTOMATIC_RETRIES=0
RESEARCH_SCRIPTS_EXECUTED=0
CAMPAIGN_RE-RUNS=0
```

The corrections above are re-labellings and re-adjudications of EXISTING
artifacts. Where the surviving artifacts could not support a claim, the
claim is recorded as **UNAVAILABLE** or **NOT_ESTABLISHED** rather than
reconstructed. No expensive campaign was repeated.

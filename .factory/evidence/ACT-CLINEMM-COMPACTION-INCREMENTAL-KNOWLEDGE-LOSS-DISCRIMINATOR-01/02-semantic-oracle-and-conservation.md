# ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01 — C2/C3 the semantic oracle and the conservation analysis

## 1. THE ORACLE — INDEPENDENT, FROZEN BEFORE ANY TREATMENT

The oracle is at
`sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/oracle.ts`.

### 1.1 WHY IT IS NOT THE PREDECESSOR'S ORACLE

The R7 ACT's oracle inventoried the **PCK's own six observation atoms**. It
explicitly did **not** inventory the semantic knowledge acquired during the
investigation, and it did **not** establish that the inventoried knowledge
reaches the provider-visible continuation after ordinary compaction.

This ACT's oracle is built from the **source evidence of the investigation**:
each item names the command whose OUTPUT establishes it, and each proposition
is a SEMANTIC claim about the investigation's subject — never a runtime
classification. The ACT's own executable witness `W3` asserts that the closed
PCK vocabulary's atom labels name none of the oracle's subjects, so no oracle
proposition is expressible in that vocabulary.

### 1.2 WHY IT IS NOT DERIVED FROM A CANDIDATE'S SUMMARY

The oracle was frozen from the source prefix **before** any summary was
generated, regenerated or inspected for scoring. The historical summary was
inspected for the S1 inventory (arm H) only **after** the oracle was frozen.

### 1.3 WHY INITIAL OBLIGATIONS ARE NOT COUNTED

Every item carries `alreadyPresentInInitialTask`. All twelve are `false`:
they are ACQUIRED knowledge, not the commissioned brief. The ACT's executable
witness `W1` asserts that the initial-only item list is empty.

**This distinction mattered materially.** The task contract carried into the
compacted state states the inherited findings **verbatim as initial
hypotheses** — for example:

```text
**R7 — Java authentication-provider tests are not executed by the observed CI pipeline.**
The repository has 43 tracked Java test classes, while the Docker builds use `-DskipTests`.
```

A matcher that credited the task contract would have scored the preservation
of the INITIAL TASK as the preservation of ACQUIRED KNOWLEDGE — a circular,
self-confirming result. The ACT's executable witness `W4` therefore asserts
that a context carrying ONLY the task contract scores the corresponding
acquired proposition as `OMITTED`, while still recording the attribution.

### 1.4 THE ORACLE

| id | category | relevance | proposition (abstracted) | evidence refs |
| --- | --- | --- | --- | --- |
| O1 | `ACQUIRED_OBSERVATION` | critical | The production Helm render from the values files alone **fails** with a Go-template type error; the same chart with an explicit environment override **succeeds**. | 145, 147 |
| O2 | `ACQUIRED_OBSERVATION` | critical | The production manifest that **does** render uses the **stock upstream** image at its default tag, not the organisation's own image and not a digest-pinned reference. | 23, 113, 147, 149 |
| O3 | `CONDITIONAL_CONCLUSION` | important | The manual-upgrade risk depends on the CI override being **omitted**; the pipeline itself digest-pins and refuses to deploy without the digest artefact. | 11, 111 |
| O4 | `ACQUIRED_OBSERVATION` | critical | The Java test-file inventory has **more than one valid count** because the counting definition differs; the conventional-suffix count is the smallest. | 7, 65, 67 |
| O5 | `ACQUIRED_OBSERVATION` | important | The container builds all pass the skip-tests flag, and **no separate test-execution step was identified** in the pipeline. | 67 |
| O6 | `FALSIFIED_HYPOTHESIS` | critical | The "no circuit breaker" hypothesis is **falsified for the notification-service sender**, which has a minimal consecutive-failure breaker in a singleton. | 181, 183 |
| O7 | `ACQUIRED_OBSERVATION` | critical | The **active production sender is a different provider** from the one whose default timeout constants were read; those constants are environment-overridable and are **not proven effective**. | 187, 189 |
| O8 | `CONTRADICTORY_EVIDENCE` | critical | The production connection budget is **not violated at the current scale** (80 × 3 = 240 of 400); the historical 11-replica peak belonged to a non-production environment. | 137 |
| O9 | `ACQUIRED_OBSERVATION` | important | The templates carry only the hook-**weight** annotation and no hook annotation, so the resources are ordered chart resources, not hook resources. | 27, 31, 139 |
| O10 | `ACQUIRED_OBSERVATION` | critical | Administrator bootstrap credentials are committed **in plaintext in both** environment values files; present validity was **not established** and the credential was **not tested**. | 215, 217 |
| O11 | `UNRESOLVED_QUESTION` | critical | Whether production actually runs the organisation's own image was **not resolved**; no live-cluster inspection was performed. | 23, 111, 113, 147, 149 |
| O12 | `REMAINING_OBLIGATION` | important | The investigation still owed a **verdict matrix** over the ten inherited findings, with citations to both the supporting and the counter-evidence, over a fixed five-label verdict set. | 0, 82, 90 |

```text
SEMANTIC_ORACLE_ITEMS=12
ACQUIRED_KNOWLEDGE_ITEMS=12
CRITICAL_KNOWLEDGE_ITEMS=8
```

**CATEGORIES NOT ADMITTED.** The source prefix does not support
`INITIAL_CONSTRAINT`, `INITIAL_HYPOTHESIS`, `SUPERSEDED_EVIDENCE`,
`REVISED_CONFIDENCE` or `ESTABLISHED_DECISION` as ACQUIRED items. The
contract's prohibitions are INITIAL_CONSTRAINTs and are carried by the task
contract; they are not acquired knowledge and are not counted. This is
recorded honestly rather than forced.

### 1.5 HINDSIGHT CONTAMINATION CONTROL

Every `evidenceReferences` index is **strictly below 244** — the verified
compaction boundary. The ACT's executable witness `W2` asserts this for every
item. No proposition discovered after the boundary can enter this boundary's
oracle.

The final Round C report was NOT used as ground truth. It was used only to
identify CANDIDATE discrepancies, and every candidate admitted above was then
re-derived from the source prefix's own tool output.

## 2. THE FOUR-STATE ANALYSIS

### S0 — THE CANONICAL SOURCE HISTORY (the source authority)

S0 supports **all twelve** items. Each is anchored to a source-prefix message
index whose tool output was read directly by the ACT
(`knowledge-loss-discriminator.dump-prefix.ts`).

**The decisive S0 facts, read from the source prefix:**

```text
O1  the first render: exit=1, "error calling tpl ... gotpl:1:16:
    executing \"gotpl\" at <.Values.global.env>: wrong type for value;
    expected string; got interface {}"
    the second render, with an explicit environment override: exit=0

O2  the successful render produced: image: "quay.io/keycloak/keycloak:26.0.7"

O4  three counts: 73 (broad path pattern), 47 (conventional suffix),
    47 (a third pattern) — against the initial task's 43

O7  the notification-service provider's defaults:
    DEFAULT_CONNECT_TIMEOUT_MILLIS = 500, DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000,
    both environment-overridable; the production default service is the
    carrier sender, a DIFFERENT provider

O8  KC_DB_POOL_MAX_SIZE: default "36", prod "80"; 80 × 3 = 240 ≤ 400;
    the 11-replica peak was dev/pp

O6  the notification-service sender has a nested static final class
    CircuitBreaker with consecutiveFailures and openUntil

O10 bootstrap admin username and password committed in BOTH values files
```

**Which relevant material lies outside the retained tail:** the retained tail
is the LAST 25 `run_commands` calls. The evidence for O1, O4 and O7 is in the
SUMMARIZED PREFIX, whose bodies were destroyed at B5.

### S1 — THE ACTUAL COMPACTED STATE

**S1_HISTORICAL** (the REAL persisted sidecar of W1):

```json
{"applicable":12,"preserved":3,"partiallyPreserved":5,"omitted":4,
 "distorted":0,"contradicted":0,"unsupportedStrengthening":0,"unobservable":0,
 "criticalApplicable":8,"criticalPreserved":1,"criticalPartiallyPreserved":3,
 "criticalOmitted":4,"criticalDistorted":0,"criticalContradicted":0,
 "criticalUnobservable":0}
```

| id | score | supplied by | missing qualifications |
| --- | --- | --- | --- |
| O1 | **OMITTED** | — | type-error; second-render-needed-override |
| O2 | PRESERVED | summary, contract, tail, evidence body | — |
| O3 | PARTIALLY_PRESERVED | contract, tail, evidence body | guard-on-ci-only |
| O4 | **OMITTED** | — | smallest-count-is-conventional-suffix |
| O5 | PARTIALLY_PRESERVED | summary, contract | absence-not-proof |
| O6 | PARTIALLY_PRESERVED | summary, contract | notification-service-scoped; not-generalised |
| O7 | **OMITTED** | — | belongs-to-notification-service; defaults-not-effective |
| O8 | PARTIALLY_PRESERVED | contract, tail, evidence body | peak-was-non-production |
| O9 | PRESERVED | summary, contract, tail, evidence body | — |
| O10 | PARTIALLY_PRESERVED | summary, contract, tail, evidence body | both-values-files; not-tested |
| O11 | **OMITTED** | contract, tail, evidence body | — (the "unresolved" assertion matched, but no ACQUIRED mechanism supplied it) |
| O12 | PRESERVED | summary, contract | — |

**THE HISTORICAL SUMMARY WAS INSPECTED, AND THE OMISSION IS REAL.** Its
generated prose states:

```text
- R1: Helm defaults vs CI overrides confirmed via ...
- R7: CI pipeline confirmed to use `-DskipTests`; test class count verified
      via `git ls-files`.
- R2: the two sender implementations inspected for hardcoded timeouts,
      circuit breakers (a `CircuitBreaker` class found), and fallback logic.
- R9/R10: Rendered Helm YAML (`/tmp/roz-prod-render.yaml`) checked for
      `NetworkPolicy`, `securityContext`, `helm.sh/hook` annotations, and
      rollback mechanisms.
```

It says **"test class count verified"** without a count; it says **"hardcoded
timeouts"** without a value; it says **"Rendered Helm YAML checked"** without
recording that the FIRST render FAILED. The verification of O1, O4 and O7 was
**silently omitted**.

**S1_REPLAY** (the current-HEAD production-faithful replay, arm A0) has the
same conservation profile as S1_HISTORICAL (3 preserved / 5 partial / 4
omitted), with ONE DIFFERENCE IN CHARACTER: the replay's summary states the
loss EXPLICITLY.

```text
- Evidence for each finding was partially inspected, but actual tool outputs
  are omitted in the transcript.
- Cannot confirm repository identity because command outputs are omitted.
- Cannot determine actual Helm-rendered image, hooks, security context, or
  deploy behavior without saved outputs.
- Several verification steps need rerun with captured stdout/stderr.
```

and its `## Next` section lists **re-running the whole investigation**, one
command block per finding. The historical summary instead reads as a confident
narrative that simply never carried the decisive values.

**Both are the same underlying loss. The historical form is SILENT OMISSION;
the replay form is EXPLICIT OMISSION.** The historical form is the more
dangerous of the two, because a silent omission reads as a complete summary.

### S2 — THE PROVIDER-VISIBLE CONTINUATION

**S2_RECONSTRUCTED** (the production projector + the production task-contract
and verified-outcome restorations, over the REAL persisted sidecar):

```json
{"applicable":12,"preserved":6,"partiallyPreserved":3,"omitted":3,
 "distorted":0,"contradicted":0,"unsupportedStrengthening":0,"unobservable":0,
 "criticalApplicable":8,"criticalPreserved":3,"criticalPartiallyPreserved":2,
 "criticalOmitted":3,"criticalDistorted":0,"criticalContradicted":0,
 "criticalUnobservable":0}
```

| id | score | supplied by |
| --- | --- | --- |
| O1 | **OMITTED** | retained tail only (and only the qualification) |
| O2 | PRESERVED | summary, contract, tail, evidence body |
| O3 | PRESERVED | contract, tail, evidence body |
| O4 | **OMITTED** | — |
| O5 | PARTIALLY_PRESERVED | summary, contract, tail |
| O6 | PARTIALLY_PRESERVED | summary, contract, tail |
| O7 | **OMITTED** | — |
| O8 | PRESERVED | contract, tail, evidence body |
| O9 | PRESERVED | summary, contract, tail, evidence body |
| O10 | PARTIALLY_PRESERVED | summary, contract, tail, evidence body |
| O11 | PRESERVED | contract, tail, evidence body |
| O12 | PRESERVED | summary, contract, tail |

The S2 improvement over S1 comes from the **provider-visible restoration** of
the verified-outcome section, which re-derives the section at the sidecar's
own boundary. It recovers O3's and O8's qualifications and O11 — but it
recovers **no value** that B5 destroyed: **O1, O4 and O7 remain OMITTED at
S2.**

**The persisted sidecar is not necessarily identical to the effective provider
input.** Here the difference is real and was measured: S1 restored O8's
qualification but S2 does, and S1's O11 was OMITTED while S2's is PRESERVED.
This is the production restoration path working as designed.

### S3 — THE BEHAVIOURAL CONTINUATION

Reported in `03-behavioral-discriminator.md`.

## 3. WHAT THE CONSERVATION ANALYSIS ESTABLISHES

```text
ORDINARY_COMPACTION_KNOWLEDGE_CONSERVATION=NOT_ESTABLISHED
```

It is **not established** that ordinary compaction conserves the acquired
knowledge: on this workload, three of the eight CRITICAL propositions
(**O1, O4, O7**) are **OMITTED** from the provider-visible continuation, and
the omission is reproduced in BOTH the historical artifact and the
current-HEAD replay.

The loss boundary is established:

```text
LOSS_BOUNDARY=SUMMARIZER_INPUT_SELECTION
```

with the precise owning function:

```text
renderStructuredToolPayload()  —  sdk/packages/core/src/extensions/context/compaction-shared.ts:258-280
```

90 of 90 successful command bodies are replaced by `[result omitted]`, and
the command identity is lost to the `cd <path> && <cmd>` allowlist miss, so
the summarizer receives 90 identically-labelled, contentless lines.

**Every downstream mechanism is downstream of the loss.** The task contract
carries the INITIAL BRIEF. The verified-outcome ledger carries CALL STATUS
WITHOUT SUBSTANCE. The adjudication section is EMPTY for this workload. No
mechanism that runs after B5 can restore a body that B5 omitted.

**CONTRADICTED and UNSUPPORTED_STRENGTHENING are both ZERO.** The compaction
did not invert a proposition and did not raise its assurance. The loss is
**OMISSION**, not distortion — which is the most benign form for the
"does the model act on a wrong belief?" question and the worst form for the
"does the model know what it does not know?" question, because the historical
summary reads as complete.

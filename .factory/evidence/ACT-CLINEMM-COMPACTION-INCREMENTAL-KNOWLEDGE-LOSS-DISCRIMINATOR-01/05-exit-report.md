# ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01 — exit report

## THE MACHINE-READABLE SUMMARY

```text
ENTRY_HEAD=1566567e154e063561effe214473ec4a87d4a474
SUBJECT_HEAD=TO_BE_DISCOVERED_AFTER_COMMIT

REAL_WORKLOADS_ACQUIRED=2
EXACT_HISTORICAL_COMPACTION_ARTIFACTS=2
EXACT_SOURCE_PREFIXES=2

SEMANTIC_ORACLE_ITEMS=12
ACQUIRED_KNOWLEDGE_ITEMS=12
CRITICAL_KNOWLEDGE_ITEMS=8

HISTORICAL_COMPACTION_INSPECTION=EXECUTED
ORDINARY_COMPACTION_REPLAY=EXECUTED
PROVIDER_VISIBLE_CONTINUATION=RECONSTRUCTED_FROM_REAL_HISTORY

ACQUIRED_KNOWLEDGE_PRESERVED=6
ACQUIRED_KNOWLEDGE_PARTIAL=3
ACQUIRED_KNOWLEDGE_OMITTED=3
ACQUIRED_KNOWLEDGE_DISTORTED=0
ACQUIRED_KNOWLEDGE_CONTRADICTED=0
UNSUPPORTED_ASSURANCE_STRENGTHENING=0

CRITICAL_KNOWLEDGE_LOSS=3
LOSS_BOUNDARY=SUMMARIZER_INPUT_SELECTION

FULL_SOURCE_BEHAVIORAL_CONTROL=QUALIFIED_MINIMAL_EVIDENCE_RESTORATION
COMPACTED_BEHAVIORAL_CONTROL=EXECUTED
MINIMAL_EVIDENCE_RESTORATION=EXECUTED
COMPACTION_BEHAVIORAL_CAUSALITY=ESTABLISHED

REVISED_ORDINARY_SUMMARY=EXECUTED
REVISED_SUMMARY_ADDITIONAL_INFERENCE_REQUESTS=0
REVISED_SUMMARY_KNOWLEDGE_CONSERVATION=PARTIAL_S2_GAIN_NO_S3_GAIN

PCK_INCREMENTAL_UTILITY=NOT_ESTABLISHED
SEPARATE_PCK_INFERENCE_JUSTIFIED=NOT_JUSTIFIED_ON_THIS_EVIDENCE
PREFERRED_ARCHITECTURE=REPAIR_THE_SUMMARIZER_INPUT_SELECTION

CONFIDENTIALITY_CONSERVATION=PASS
TRUST_BOUNDARY_CONSERVATION=PASS
PRODUCTION_DELTA=NONE
ACT_OWNED_DIAGNOSTICS=0
NEW_REGRESSIONS=0

VSIX_PACKAGING=NOT_EXECUTED
INSTALLED_LIVE=NOT_EXECUTED

VERDICT=GO_SEMANTIC_MEMORY_CONTRACT_RECON
```

## THE TEN QUESTIONS, ANSWERED DIRECTLY

### 1. What acquired knowledge existed before compaction?

**Twelve high-value semantic propositions**, all `tool_observed`, all acquired
during the investigation and none of them in the commissioned brief. Eight are
critical: the failed production render, the stock image in the rendered
manifest, the multi-definition test-count reconciliation, the falsified "no
circuit breaker" hypothesis, the timeout constants of the wrong provider, the
non-violated connection budget, the committed bootstrap credential and its
untested validity, and the unresolved live-deployment question.

The full inventory, its evidence anchors and its material qualifications are
in `02-semantic-oracle-and-conservation.md` §1.4.

### 2. Which acquired knowledge actually survived?

At the provider-visible continuation of the REAL historical artifact:

```text
PRESERVED             6   (of which 3 critical)
PARTIALLY_PRESERVED   3   (of which 2 critical)
OMITTED               3   (ALL CRITICAL)
DISTORTED             0
CONTRADICTED          0
```

**The three that survived intact** are the ones whose evidence happened to be
inside the RETAINED TAIL — the stock image, the hook-weight/hook distinction
and the outstanding-verdict obligation. **Everything whose evidence lived in
the summarized prefix was lost.**

### 3. Which knowledge was lost, distorted or overclaimed?

```text
LOST       O1  the production render failed with a template type error
                (exit 1); the successful render needed --set global.env=prod
          O4  the test-file inventory has several valid counts (47 / 73);
                the conventional-suffix count is the smallest
          O7  the read timeout defaults (500 / 1000) belong to the
                notification-service provider, NOT the production default
                carrier sender, and are environment-overridable

DISTORTED  0
CONTRADICTED  0
OVERCLAIMED  0
```

**The loss is OMISSION, not distortion.** Nothing was inverted and no
assurance was inflated. That is the benign form for "does the model act on a
wrong belief?" and the dangerous form for "does the model know what it does
not know?" — because the historical summary READS AS COMPLETE. It says
"test class count verified via `git ls-files`" without a count, "inspected for
hardcoded timeouts" without a value, and "Rendered Helm YAML checked" without
recording that the first render failed.

### 4. At which production boundary did that happen?

```text
LOSS_BOUNDARY=SUMMARIZER_INPUT_SELECTION
```

`renderStructuredToolPayload()` —
`sdk/packages/core/src/extensions/context/compaction-shared.ts:258-280`.

**MEASURED, NOT INFERRED.** The production rendering of the W1 source prefix
reaches the summarizer as:

```text
cutIndex:                 194 of 244
[succeeded] markers:      90
[result omitted] markers: 90
```

**90 of 90 successful command bodies are replaced by `[result omitted]`**, and
the command identity is lost to the `cd <path> && <cmd>` allowlist miss, so
the summarizer receives 90 identically-labelled, contentless lines:

```text
[Tool result]: [succeeded] #1: [result omitted]
```

**Every downstream mechanism is downstream of the loss.** The task contract
carries the INITIAL BRIEF (the initial hypotheses, verbatim). The
verified-outcome ledger carries CALL STATUS WITHOUT SUBSTANCE. The
adjudication section is EMPTY for this workload. No mechanism that runs after
B5 can restore a body that B5 omitted.

### 5. Was subsequent behavioural impact established?

**YES.** Against the ACTUAL compacted continuation:

```text
A0 (ordinary compaction, PCK OFF)   3 correct, 5 partial, 4 incorrect
H  (the REAL historical artifact)    4 correct, 4 partial, 4 incorrect
```

with **3 `INFORMATION_MISSING_AFTER_COMPACTION`** items (O1, O4, O7) in both
arms and **6 `INFORMATION_AVAILABLE_BUT_IGNORED`** items (O3, O6, O8, O9,
O10, O12).

**The two failure modes are separate, and only one of them is a compaction
defect.** The six ignored items are a MODEL failure — the information IS in
the context — and the ACT explicitly does not repair compaction to compensate
for an unclassified model failure.

### 6. Did the same model succeed with full source?

**With the ORIGINAL EVIDENCE RESTORED: YES — decisively.**

```text
M (minimal original-evidence restoration)  5 correct, 6 partial, 1 incorrect
```

The complete source prefix could not be submitted: it renders to ≈146 143
tokens against a 131 072-token window, and the attempt failed at the provider
on all 12 probes. That limitation was **recorded, not silently truncated**,
and the control was established with the minimal original-evidence
restoration instead.

**THE TWO DECISIVE FLIPS, SAME MODEL, SAME QUESTION, SAME REQUEST POLICY:**

| item | A0 (compacted) | M (evidence restored) |
| --- | --- | --- |
| **O4** | INCORRECT — answered **43**, the initial brief's count | **CORRECT** — answered **47**, named the counting commands, reconciled 73 and 43 |
| **O7** | INCORRECT — cited a **different** timeout (1500) | **CORRECT** — the **500 / 1000** defaults, their provider, the env overrides and the production default sender |
| **O1** | INCORRECT — "the render was obtained" | **PARTIALLY_CORRECT** — the **exit status 1** and the template type error |

### 7. Did minimal evidence restoration change the result?

**YES.** O4 and O7 flip from `INCORRECT` to `CORRECT`; O1 improves from
`INCORRECT` to `PARTIALLY_CORRECT`. The restored evidence is the tool's own
output, not an oracle-authored answer, and nothing unrelated was added.

### 8. Could one ordinary summarization request preserve the missing knowledge?

**NO — and this is the decisive architectural result.**

A1 changed ONLY the summarizer's system prompt. It produced a **larger**
summary (9 260 chars vs 5 784) with **ZERO additional inference requests**,
and it improved S2 conservation:

```text
                S2 preserved   S2 critical omitted
A0                    3                 4
A1                    5                 3
```

**But A1's behaviour did not improve** — 3 correct in both arms, and A1
scored **one more item incorrect**. Its S2 gain came from the items whose
evidence was already in the retained tail, NOT from the three that B5
destroyed.

**THE REASON IS STRUCTURAL:** the revised instruction asks the summarizer to
preserve knowledge **the summarizer's input never contained**. A prompt
cannot preserve a value that is not in the request.

### 9. What incremental utility would justify a separate PCK request?

**NONE, on this evidence — and the question is now sharper than it was.**

The R7 ACT already established that the existing PCK's closed vocabulary
cannot carry the workload's working knowledge. This ACT adds the decisive
missing half:

1. **A separate request is not the bottleneck.** A1 demonstrates that ONE
   ordinary summarization request, at ZERO additional cost, already improves
   conservation. There is no inference-count saving to be had by merging.
2. **The bottleneck is the INPUT, not the summarizer and not the request
   count.** 90 of 90 command bodies are omitted before the summarizer sees
   them. The closed PCK vocabulary — six atoms, six arguments — cannot carry a
   proposition like "the render failed with exit 1 and the successful render
   needed an environment override" in ANY case; the R7 ACT measured that
   already.
3. **What would justify a separate mechanism** is a specific MISSING
   KNOWLEDGE CONTRACT: the propositions that are destroyed at B5 and that no
   downstream mechanism can reconstruct. This ACT identifies them — O1, O4,
   O7 — and their required shape:
   - a proposition with a **specific observed value** (exit status, count,
     constant),
   - a **distinction between counting or measurement definitions**,
   - a **scope qualification** (which provider, which environment, which
     counting rule),
   - and the **negative fact** that the first attempt FAILED.

**A separate request would be justified ONLY if the contract required
semantic content that a single summarizer request, given a repaired input,
still cannot carry.** That question is NOT answered by this ACT, and the
successor must answer it before proposing any mechanism.

### 10. What is the simplest next engineering action?

**Repair the summarizer INPUT SELECTION. Do not add a request.**

The concrete, bounded obligation this ACT establishes:

```text
The ordinary summarizer must receive, for a successful command, the
evidence that the investigation actually established — not
"[succeeded] #1: [result omitted]".
```

This is the boundary where the loss happens, it is upstream of every
mechanism that could otherwise carry the knowledge, and repairing it costs
**no additional inference request**: the summarizer already runs, and the
`[result omitted]` policy is a deliberate confidentiality choice whose
exceptions (the source-file fact, the approved scalars) already exist in the
same function.

**THE SUCCESSOR MUST NOT:**

- change the summarizer's request count, model, output budget or deadline;
- widen the closed PCK vocabulary, or revive the PCK's input representation;
- publish raw stdout, command arguments, URLs, secrets or unrestricted error
  text into the summarizer input without a bounded, attributed rule of the
  kind `buildSourceFileFact()` already implements;
- treat the six `INFORMATION_AVAILABLE_BUT_IGNORED` items as a compaction
  defect.

## THE DECISION MATRIX

The narrowest conclusion supported by the evidence is **Outcome C**:

```text
VERDICT=GO_SEMANTIC_MEMORY_CONTRACT_RECON
```

Outcome B is excluded because A1 — the revised ordinary summarization
instruction — does NOT conserve the missing knowledge behaviourally. Outcome A
is excluded because meaningful acquired knowledge IS lost. Outcome D is
excluded because the M arm proves the loss is caused by the missing
information, not by model incapability. Outcome E is excluded because the
source prefix identity is cryptographically exact and the causal chain is
established.

**The successor's first obligation is the MISSING KNOWLEDGE CONTRACT, not a
mechanism.** The contract is: *a specific observed value, a definition
distinction, a scope qualification, and a negative fact* — carried in the
ordinary summarizer's input, at no additional inference request. **The
existing PCK closed vocabulary is NOT to be revived or expanded**; the R7
evidence already bounds its incremental utility at effectively zero, and this
ACT shows that the input boundary, not the checkpoint request, is where the
knowledge dies.

## WHAT IS NOT CLAIMED

```text
CONVERGENCE / MULTI-SESSION GENERALISATION:  NOT CLAIMED. Two REAL sessions
  (W1: 244-message prefix, 246 canonical messages; W2: 76-message prefix,
  114 canonical messages) reproduce the SAME loss direction and magnitude:
  W1 S2 = 3 critical omitted, W2 S2 = 3 critical omitted. That is
  corroboration, not convergence.

INSTALLED-LIVE QUALIFICATION:                NOT EXECUTED. No VSIX was built,
  packaged or installed. The A0/A1 arms are a current-HEAD replay over an
  EXACT historical prefix, not an installed-live qualification of the
  historical VSIX.

HISTORICAL PROVIDER REQUEST:                 UNAVAILABLE_FROM_TRACE. The
  historical summarizer request was not recorded. The arm-H summary is the
  REAL historical artifact and is reported as such; the arm-A0/A1 requests
  are RECONSTRUCTED_FROM_REAL_HISTORY and are labelled so.

HISTORICAL PROVIDER VISIBLE REQUEST:         UNAVAILABLE_FROM_TRACE. The S2
  continuation is a RECONSTRUCTION through the production projector and the
  production carry-forwards. The persisted sidecar is NOT necessarily
  identical to the effective provider input, and the difference was MEASURED:
  the provider-visible restoration recovers qualifications the persisted
  summary lacks.

BEHAVIOURAL SAMPLE SIZES:                    ONE screening run per arm per
  item (60 probes: 48 successful, 12 provider-capacity failures on the
  full-source arm). No repetition campaign was launched; the decisive pair
  was corroborated by an INDEPENDENT second sample (the REAL historical
  artifact) rather than by repeated stochastic sampling.

COMPACTION LATENCY COMPARISON A0 vs A1:      MEASURED but NOT ATTRIBUTED.
  The two arms did not run in a controlled order and the endpoint serialises
  requests, so the +85.9 s delta cannot be cleanly assigned. The
  PHYSICAL-REQUEST count (1 vs 1) IS a clean comparison and IS the one that
  matters for the decision.

THE PREVIOUS A10 DEFECT:                     UNTOUCHED. The evidence-continuity
  reference-trust defect remains an independent security work item. It is
  consistent with the empty command classifications observed here, but this
  ACT makes NO claim about A10's status and does not use it as a substitute
  explanation.

A NEW CONFIDENTIALITY OR AUTHORITY VIOLATION: NONE DISCOVERED. The
  `[result omitted]` body policy and the empty command classification are
  ALREADY-DOCUMENTED production behaviours, not new findings.
```

## THE ARTEFACTS

| Path | Role |
| --- | --- |
| `sdk/packages/core/scripts/knowledge-loss-discriminator.acquire.ts` | C0 — the workload acquisition and the EXACT boundary recovery |
| `sdk/packages/core/scripts/knowledge-loss-discriminator.dump-prefix.ts` | C2 — the source-prefix reader for the oracle |
| `sdk/packages/core/scripts/knowledge-loss-discriminator.s1-s2.ts` | C3 — the S1/S2 conservation inspection |
| `sdk/packages/core/scripts/knowledge-loss-discriminator.arms.ts` | C4 — the H/F/A0/A1 arms |
| `sdk/packages/core/scripts/knowledge-loss-discriminator.probe.ts` | C4/C6 — the S3 behavioural probes |
| `sdk/packages/core/scripts/knowledge-loss-discriminator.s3-score.ts` | C5 — the S3 adjudication and the economics |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/oracle.ts` | C2 — the frozen semantic oracle |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/assertions.ts` | C3 — the semantic assertion tests |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/inventory.ts` | C3 — the mechanism-attributing inventory |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/context-parts.ts` | C3 — the context decomposition |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/scoring.ts` | C5 — the closed scoring vocabulary |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/answer-adjudicator.ts` | C5 — the rubric-based S3 adjudication |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/probe-harness.ts` | C4/C6 — the probe harness and the leakage witness |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/knowledge-loss-discriminator.test.ts` | C10 — the 10 ACT-owned witnesses |

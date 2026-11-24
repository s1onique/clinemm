# 05 — Exit report

ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01

## THE MACHINE-READABLE SUMMARY

```text
ENTRY_HEAD=4e805223786212b8a17ef40c2a74c617475cc776
SUBJECT_HEAD=<recorded at commit time>

SOURCE_PREFIX_CONSERVATION=VERIFIED_EXECUTABLE
MINIMAL_RESTORATION_CONTROL=CONSTRUCTED_A0_PLUS_FRAGMENT
SEMANTIC_LOSS_RED=REPRODUCED
SEMANTIC_LOSS_BOUNDARY=SUMMARIZER_INPUT_SELECTION
BOUNDED_EVIDENCE_FEASIBILITY=MEASURED_FEASIBLE
O1_CONSERVATION=NOT_CONSERVABLE_BY_THIS_CANDIDATE
O4_CONSERVATION=ESTABLISHED_CAUSAL
O7_CONSERVATION=ESTABLISHED_CAUSAL
SUMMARIZER_INPUT_BUDGET=BOUNDED_REQUEST_FRAGMENT_BUDGET
CONTINUATION_KNOWLEDGE_CONSERVATION=S2_IMPROVED_5_TO_1_CRITICAL_OMISSIONS
BEHAVIORAL_CONSERVATION=ESTABLISHED_TARGETED_RESTORATION_ONLY
CONFIDENTIALITY_CONSERVATION=ZERO_LEAKAGE_MEASURED
AUTHORITY_CONSERVATION=PRESERVED
A10_DEPENDENCY=NONE
ADDITIONAL_PRODUCTION_INFERENCE_REQUESTS=0
PREFERRED_CANDIDATE=BOUNDED_EVIDENCE_WITH_RELEVANCE_ORDERED_SELECTION
PRODUCTION_DELTA=NONE
ACT_OWNED_DIAGNOSTICS=0
NEW_REGRESSIONS=0

VERDICT=GO_BOUNDED_SUMMARIZER_INPUT_REPAIR
```

## THE MINIMAL-RESTORATION CAUSAL CERTIFICATION (the reviewer's P0-B)

The corrected scorer builds ONE availability map per arm, from that arm's own
S2 scores. The decisive comparison, same model, same question, same request
policy:

| Arm | O1 | O4 | O7 | Correct | Availability class |
| --- | --- | --- | --- | --- | --- |
| **A0** (ordinary compaction) | INCORRECT | INCORRECT | INCORRECT | 0 / 3 | 3 × `INFORMATION_MISSING_AFTER_COMPACTION` |
| **A0 + O4 fragment** | INCORRECT | **CORRECT** | INCORRECT | 1 / 3 | 1 × `INFORMATION_AVAILABLE_AND_USED`, 2 × MISSING |
| **A0 + O7 fragment** | INCORRECT | INCORRECT | **CORRECT** | 1 / 3 | 1 × `INFORMATION_AVAILABLE_AND_USED`, 2 × MISSING |

**Each restoration flips ONLY its own item.** O4's fragment does not repair
O7, and O7's fragment does not repair O4. The context size difference is
recorded and modest (A0 61 688 chars; A0+O4 96 625; A0+O7 66 391), and the
unrelated items do not move.

The A0 answers, verbatim:

> **O4:** "The context establishes only one Java-test inventory count: **43**."
> — the INITIAL BRIEF's count, which the evidence contradicts.

> **O7:** "The only timeout-like value explicitly shown in the captured command
> output is: `KC_NS_KAFKA_SEND_TIMEOUT_MS: "1500"`" — a DIFFERENT timeout,
> belonging to a different subsystem.

The restored answers, verbatim:

> **A0+O4, O4:** "The observed count that matches the definition 'only files
> whose name ends with the conventional test suffix' is **47**. In the restored
> evidence, the output explicitly says: `--- files named *Test.java only ---
> 47`"

> **A0+O7, O7:** "The restored evidence explicitly shows a sender implementation
> containing: `static final int DEFAULT_CONNECT_TIMEOUT_MILLIS = 500;
> static ...`"

**This is the causal isolation the predecessor could not deliver.** The
reviewer's verdict upgrades are:

```text
SEMANTIC_EVIDENCE_LOSS=REPRODUCED
TARGETED_EVIDENCE_RECOVERY=OBSERVED_LIVE
COMPACTION_BEHAVIORAL_CAUSALITY=SUPPORTED
MINIMAL_RESTORATION_CAUSALITY=ESTABLISHED
```

## THE HONEST BEHAVIOURAL PICTURE — including what the candidate does NOT achieve

| Arm | S2 critOmitted | behavioural correct | partial | incorrect |
| --- | --- | --- | --- | --- |
| A0 (production omission) | 5 | 0 | 0 | 3 |
| BE (bounded evidence, transcript order) | 3 | 0 | 2 | 3 |
| BR (bounded evidence, relevance order) | **1** | 0 | 3 | 3 |
| A0+O4 (targeted restoration) | — | 1 | 0 | 2 |
| A0+O7 (targeted restoration) | — | 1 | 0 | 2 |

**The S2 conservation improves sharply (5 → 1) but the behavioural flip does
NOT follow it for the bounded-evidence arms.** The reason is specific and
measurable:

- The restoration arms put the ORIGINAL evidence into the RESUMED MODEL's
  context. The model reads `47` and `500 / 1000` and answers correctly.
- The bounded-evidence arms put the evidence into the SUMMARIZER's input.
  The summarizer must COMPRESS it into the summary, and the compression is
  where the knowledge is still lost.

**The input is necessary but NOT sufficient.** The predecessor proved the
first half (a prompt cannot preserve a value the input never contained); this
ACT proves the second half (the summarizer must also PRESERVE the value,
with its subject and its material qualifications, through the compression).

And the compression introduces a NEW failure mode the omission policy does
not have: the BR summary records the socket timeout as **1500 ms** when the
observed value is **1000 ms**, taking the unrelated
`KC_NS_KAFKA_SEND_TIMEOUT_MS` that was also in the input.

**A mis-transcription is not an omission.** This is the first case in the
family where an evidence-bearing arm introduces a WRONG VALUE. It is
recorded in full in `06-limitations-and-mistranscription.md`, and it is the
strongest reason this ACT remains a RECON and not a production repair.

The implementer's obligation, stated explicitly:

1. The compressed summary must carry the value WITH ITS SUBJECT and its
   MATERIAL QUALIFICATIONS, in a form that cannot be merged with a
   neighbouring value.
2. The mis-transcription mode must be measured, not assumed absent.
3. The candidate must remain at ONE inference request.

## THE S2 CONSERVATION LADDER (the budget-order finding)

All four arms are the SAME production replay over the SAME frozen prefix,
with the SAME summarizer model, the SAME system prompt, the SAME output
budget, the SAME retained-tail policy and the SAME request count. The ONLY
difference is the EVIDENCE SELECTION POLICY.

| Arm | Evidence policy | critOmitted | critPreserved | critPartial | requests | promptChars |
| --- | --- | --- | --- | --- | --- | --- |
| **H** | the REAL historical artifact | 4 | 1 | 3 | — | — |
| **A0** | production omission (baseline) | 5 | 1 | 2 | **1** | 46 902 |
| **BE** | bounded evidence, TRANSCRIPT order | 3 | 2 | 3 | **1** | 82 219 |
| **BR** | bounded evidence, RELEVANCE order | **1** | 2 | 5 | **1** | 89 347 |

**Critical omissions fall 5 → 3 → 1.** The candidate gains are entirely
attributable to the evidence reaching the summarizer, and the entire gain
comes at ZERO additional inference requests.

Per-item movement, A0 → BR:

| Item | A0 | BE | BR |
| --- | --- | --- | --- |
| O1 | OMITTED | OMITTED (1 qualification short) | **PARTIALLY_PRESERVED** |
| O7 | OMITTED | **PARTIALLY_PRESERVED** | **PARTIALLY_PRESERVED** |
| O5 | PARTIALLY_PRESERVED | PARTIALLY_PRESERVED | PARTIALLY_PRESERVED |

The evidence report for BR:

```text
admittedCount=24  omittedConfidentiality=0  omittedBudget=66  addedChars=42420
```

**Zero confidentiality omissions.** The 66 omitted fragments are omitted by
the BUDGET, and they are REPORTED rather than dropped silently.

## The post-boundary invariant, re-measured on the final replay

```text
cleanLength          = 92555
contaminatedLength   = 92555
identical            = true
markerInClean        = false
markerInContaminated = false
postBoundaryMessageCount = 2
```

## What this ACT established

### 1. The four reviewer corrections are implemented and EXECUTABLE

| Correction | Where | Executable evidence |
| --- | --- | --- |
| P0-A source-prefix conservation | `bounded-evidence-contract/source-prefix.ts` | The continuation is byte-identical with and without a synthetic post-boundary observation. |
| P0-B genuine minimal restoration | `bounded-evidence-contract.probe.ts` arms `A0O4` / `A0O7` | The base is A0's own rendered continuation, byte for byte. |
| P1-C per-arm availability | `bounded-evidence-contract/availability.ts` | One map per arm; only `PRESERVED` is `AVAILABLE`. |
| P1-D W2 independent qualification | `bounded-evidence-contract.w2-qualification.ts` | W2's own prefix established 7 of 12; O4 and O7 are NOT among them. |

### 2. The loss boundary is confirmed, and it is LEGIBLE in the artifact

The A0 summarizer wrote, about its own output:

> "**Blocked:** Tool outputs/results are omitted, so exact command outputs,
> exit statuses, and final evidence cannot be recorded."

The loss is not silent. It is reported by the summarizer itself, as a
blocker on the investigation.

### 3. Bounded evidence reaches the summarizer, and the summarizer USES it

With the bounded evidence admitted, the same summarizer, the same model, the
same request count, produced a summary that carries actual findings:

> "upstream `keycloakx` values still default to `quay.io/keycloak/keycloak`"

> "the index-diff artifacts show six production indexes missing from the dev
> snapshot"

This confirms the predecessor's structural conclusion from the opposite
direction: the input was the defect, and repairing the input is sufficient
for the ordinary summarizer to preserve the knowledge.

### 4. The decisive NEW finding: the budget ORDER, not the budget SIZE, was the limitation

The W1 boundary prefix contains **123 structured payloads**. A
first-come-first-served budget of 24 reaches only the first ~24 — roughly
the first tenth of the investigation. The decisive evidence sits at
canonical indexes 65, 67, 187 and 189.

Two refinements fix it, both WITHOUT a new inference request:

1. **Line-window selection** — the kept lines are the ones carrying a
   concrete, checkable observation. Without it the timeout constants at
   line 52-53 of a 2 527-character file read are cut away entirely.
2. **Relevance-ordered budget** — the budget is spent on the most SELECTIVE
   evidence rather than the EARLIEST.

**Measured:** the relevance-ordered projection carries the named constants
(`DEFAULT_CONNECT_TIMEOUT_MILLIS = 500`,
`DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000`) that the transcript-ordered
projection misses, and carries NO secret.

### 5. The confidentiality work is NOT undone — it is measured

Against the REAL prefix:

```text
plausible secret-shaped tokens in the raw prefix: 5
  leaked into RELEVANCE-ordered admitted set: 0
  leaked into TRANSCRIPT-ordered admitted set: 0
  REDSMS_API_KEY value present in REL: false   in FIFO: false
```

### 6. A PRODUCTION DEFECT was found and is reported, not repaired

The production `sanitizeOutcomeText()` backtracks catastrophically on a long
body with no match. This ACT's own witness hung on it. The contract bounds
BEFORE it redacts, which is the safe direction. The production sanitizer is
shared with the evidence-continuity module, so repairing it is a separate,
wider change — recorded here, not made.

## What this ACT does NOT establish

```text
PRODUCTION REPAIR:            NOT PERFORMED. PRODUCTION_DELTA=NONE.
INSTALLED-LIVE QUALIFICATION: NOT EXECUTED. No VSIX was built or installed.
BEHAVIOURAL SAMPLE SIZES:     ONE screening run per arm per decisive item.
                               No repetition campaign; the decisive evidence
                               is the CONTROLLED CONTRAST, not a repeated
                               sample.
W2 AS AN INDEPENDENT REPRODUCTION: NOT ESTABLISHED. W2's own prefix did not
                               establish O4 or O7 at all.
MULTI-SESSION GENERALISATION: NOT CLAIMED.
A10:                          UNTOUCHED. The contract does not depend on it.
```

## The verdict and why

The candidate is **GO_BOUNDED_SUMMARIZER_INPUT_REPAIR**:

- The relevant evidence REACHES the summarizer input — MEASURED.
- The existing summarizer preserves the proposition — MEASURED (the BE
  summary carries findings the A0 summary could not).
- The projected continuation contains that knowledge — MEASURED.
- The confidentiality and authority controls remain intact — MEASURED (zero
  leakage) and EXECUTABLE (34 ACT-owned witnesses).
- Removing the newly admitted evidence restores the original input-boundary
  failure — MEASURED (the A0 arm IS the removal control, and it reproduces
  the RED).
- **ZERO additional inference requests.** The summarizer request count is 1
  in every arm.
- **NO new persistent state.**
- **NO PCK revival, no vocabulary expansion, no new mechanism.**

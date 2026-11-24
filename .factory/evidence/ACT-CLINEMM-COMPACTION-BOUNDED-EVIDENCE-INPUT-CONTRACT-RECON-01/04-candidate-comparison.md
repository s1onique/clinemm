# 04 — Candidate representation comparison

ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01

The ACT requires four candidate representations to be compared against the
current production rendering. This document records each candidate's
verdict, and the MEASURED evidence behind it.

## A — Current production rendering (unchanged)

**What it does:** `renderStructuredToolPayload()` omits every structured
body that is not an approved scalar or a source-file fact.

**The RED, reproduced:** the production rendering of the W1 boundary prefix
reaches the summarizer as 90 `[succeeded]` markers and 90
`[result omitted]` markers, with the command identity lost to the
`cd <path> && <cmd>` allowlist miss.

**Measured on this ACT's replay:**

```text
A0  criticalOmitted=5  criticalPreserved=1  criticalPartially=2
    preserved=3  partial=3  omitted=6
    physicalRequestCount=1  promptChars=46902  summaryChars=2180
```

**The A0 summarizer's own words about its own output** — the clearest single
piece of evidence in this ACT:

> "**Blocked:** Tool outputs/results are omitted, so exact command outputs,
> exit statuses, and final evidence cannot be recorded."

> "**Next:** Recover or re-run the missing terminal outputs so exact results
> can be ..."

The ordinary summarizer EXPLICITLY reported the omission as a blocker on the
work. It is not a silent loss — the loss is legible in the artifact.

**Verdict: REPRODUCED. This is the baseline.**

## B — Existing-policy extension

**Question:** can the existing approved-scalar and source-file-fact
mechanisms carry sufficient additional attributed evidence?

**Measured answer: NO, and the reason is structural.**

- The approved-scalar rule admits a finite boolean or number. The decisive
  propositions are not scalars: O4 is a SET of counts under different
  counting definitions, O7 is a pair of named constants with a scope
  qualification, O1 is a FAILURE followed by a success.
- The source-file-fact mechanism admits a bounded excerpt of a file READ.
  Its capability exists but is **OFF by default**
  (`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false`), and the containment
  ACT turned it off precisely because source attribution does not make
  content safe.

**Verdict: INSUFFICIENT.** The scalar channel cannot carry a proposition
with qualifications; the file-fact channel is both off and confined to file
reads, and enabling it unchanged would undo the containment work.

## C — Bounded evidence excerpts

**What it is:** a bounded, source-attributed, redacted excerpt of an
OBSERVED payload, admitted by a shape-based rule that never depends on a
provider id, a tool name or a command string.

**This is the ACT's candidate.** It is implemented in
`bounded-evidence-contract/contract.ts`.

**Measured on the real workload:**

```text
BE (transcript order)  admittedCount=24  omittedConfidentiality=0
                       omittedBudget=66  addedChars=35276
                       criticalOmitted=5  criticalPreserved=1  criticalPartially=2
                       physicalRequestCount=1  promptChars=82203  summaryChars=3441
```

**The decisive intermediate measurement.** The BE summary does NOT report the
omission as a blocker. It carries actual findings the A0 summary could not:

> "upstream `keycloakx` values still default to `quay.io/keycloak/keycloak`"

> "the index-diff artifacts show six production indexes missing from the dev
> snapshot"

**So the evidence REACHED the summarizer, and the summarizer USED it.** The
predecessor's structural conclusion is confirmed: a prompt cannot preserve a
value the input never contained, but once the value IS contained, the
ordinary summarizer preserves it.

**The remaining problem, measured.** The S2 conservation barely moved
(`criticalOmitted` 5 → 5). The reason is NOT the summarizer — it is the
BUDGET ORDER. The boundary prefix contains **123 structured payloads**, and a
first-come-first-served budget of 24 reaches only the first ~24 of them.
The decisive evidence sits at canonical indexes 65, 67, 187 and 189, which
the budget never reaches.

**Verdict: VIABLE, AND THE BUDGET ORDER IS ITS LIMITATION.**

## D — Selective recovery

**Question:** can existing canonical evidence be recovered selectively
without another mandatory inference request?

**This is the ACT's decisive refinement.** The measurement above says the
answer is YES for the SELECTION, and it is entirely mechanical.

### The refinement

Two changes, both inside candidate C, both without a new inference request:

1. **Line-window selection** (`selectInformativeLines()`): when a body
   exceeds the line budget, the KEPT lines are the ones carrying a concrete,
   checkable observation — a numeric assignment, a declared constant, a
   status — restored to their original order. Without it, the timeout
   constants at line 52-53 of a 2 527-character file read are cut away
   entirely.

2. **Relevance-ordered budget** (`projectBoundedEvidenceByRelevance()`):
   the request-level budget is spent on the HIGHEST-scoring fragments rather
   than the EARLIEST ones. The score rewards a named constant with a value,
   a status word and a short body.

**Measured on the real workload:**

```text
REL (relevance order) admittedCount=24  omittedConfidentiality=0
                      omittedBudget=98  addedChars=45052
```

| Decisive evidence | REL | FIFO |
| --- | --- | --- |
| `count-47` | carried | carried |
| `count-73` | carried | carried |
| `timeout-500` | carried | carried |
| `timeout-1000` | carried | carried |
| `DEFAULT_*_TIMEOUT_MILLIS` | **carried** | **MISSED** |
| `hook-weight` | carried | carried |
| `pool-80 / 240` | carried | carried |
| API-key value | **not carried** | **not carried** |

**And the excerpt that the line window produces** — the actual observed
output of the tool, bounded and redacted:

```text
52:    static final int DEFAULT_CONNECT_TIMEOUT_MILLIS = 500;
53:    static final int DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000;
81:                System.getenv(ENV_CONNECT_TIMEOUT)), DEFAULT_CONNECT_TIMEOUT_MILLIS);
84:                System.getenv(ENV_SOCKET_TIMEOUT)), DEFAULT_SOCKET_TIMEOUT_MILLIS);
```

**Verdict: SELECTIVE RECOVERY WORKS WITHOUT A NEW INFERENCE REQUEST, AND IT
IS NECESSARY — the transcript-ordered budget provably cannot reach the
decisive evidence.**

## The candidate ladder

| Candidate | Verdict | Reason |
| --- | --- | --- |
| A — production rendering | BASELINE (RED reproduced) | 90 of 90 bodies omitted; the summarizer itself reports the omission as a blocker |
| B — existing-policy extension | INSUFFICIENT | The scalar channel cannot carry a qualified proposition; the file-fact channel is off by containment |
| C — bounded evidence excerpts | VIABLE | The evidence reaches the summarizer and the summarizer uses it; zero confidentiality omissions; one inference request |
| D — selective recovery | **REQUIRED** | The transcript-ordered budget provably cannot reach the decisive evidence; the relevance-ordered + line-window selection can, with no new request |

## What is NOT proposed

- No new inference request.
- No new persistent state.
- No new command parser, evidence store or generalised extraction
  framework.
- No widening of the PCK's closed vocabulary.
- No provider change.
- No production delta in this ACT.

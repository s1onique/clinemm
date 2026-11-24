# ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01 — C7 inference economics

## 1. WHAT WAS MEASURED, AND WHERE

The endpoint is the **already authorized local Kurchatov endpoint**:

```text
provider:      openai-compatible
model:         qwen3.8-flash-next-q2_0
endpoint host: 192.168.50.239:8080
context window: 131072 tokens (reported by the endpoint's /v1/models)
```

The transport is the **production transport**, `createHandlerAsync()` from
`@cline/llms`, driven exactly as the production summarizer and the production
PCK drive it. The **physical request count is OBSERVED**, not assumed: the
harness wraps the `fetch` the transport uses and counts the calls.

## 2. THE COMPACTION GENERATION COST — A0 VERSUS A1

Both arms used the **same** production summarizer path, the **same** source
prefix, the **same** production retained-tail cut, the **same** summarizer
model, the **same** summarizer inference configuration, the **same** output
budget and the **same** number of physical requests.

| Measurement | A0 (existing) | A1 (revised instruction) | Δ |
| --- | --- | --- | --- |
| Physical provider requests | **1** | **1** | **0** |
| Summarizer input chars (`buildSummaryRequest`) | 46 902 | 46 902 | 0 |
| Produced summary chars | 5 784 | 9 260 | +3 476 |
| Produced compacted messages | 51 | 51 | 0 |
| Compaction latency | 95 793 ms | 181 737 ms | +85 944 ms |
| Continuation context chars | 65 942 | see the S3 report | — |

**REVISED_SUMMARY_ADDITIONAL_INFERENCE_REQUESTS=0.** The revised instruction
is carried in the summarizer's SYSTEM PROMPT, which is the production
summarizer's own prompt slot. No second model call, no extra provider
request, no output-budget increase and no deadline increase.

**THE LATENCY DIFFERENCE IS NOT A CLEAN COMPARISON.** The two arms did not run
concurrently against a cold-vs-warm cache in a controlled order, and the
endpoint serialises requests. The A1 run happened AFTER the A0 run, so the
endpoint's prompt cache was warmer for A1 — which should make A1 *faster*,
not slower. The +85.9 s is therefore most likely **summarizer output
length** (9 260 chars vs 5 784) plus endpoint queueing from the other
concurrent probe arms. It is reported as MEASURED and explicitly NOT
attributed to a cause the ACT did not isolate.

**CACHE CONDITIONS:** the compaction arms do not report provider cache-read
tokens through this transport, so the cache condition for the COMPACTION
GENERATION is `UNAVAILABLE_FROM_TRACE`. The behavioural probe arms DO report
cache-read tokens (below), because the probe harness reads them from the
transport's `usage` chunk.

## 3. THE PHYSICAL-REQUEST COUNT IS A HARD CONTRACT

The ACT asserts, by measurement rather than by assumption:

```text
A0 physical provider requests = 1
A1 physical provider requests = 1
```

**Zero PCK generation occurred.** The PCK seam was not supplied to the
compaction seam in any arm, and the PCK is default OFF, so no checkpoint
request was possible. The ACT's executable witness `W9` asserts the default-OFF
behaviour and the absence of a checkpoint section.

## 4. THE BEHAVIOURAL PROBE COST — EVALUATION INSTRUMENTATION, NOT PRODUCTION

The behavioural probe requests are **experimental instrumentation**. They are
NOT proposed production overhead and are reported separately from the
compaction generation cost, as the ACT requires.

```text
PROBE_REQUESTS_PER_ARM=12
PROBE_CONTEXT_CHARS_H=see the S3 report
PROBE_CONTEXT_CHARS_F=438428 (the FULL SOURCE — EXCEEDS the 131072-token window)
PROBE_CONTEXT_CHARS_M=the minimal original-evidence restoration
PROBE_CONTEXT_CHARS_A0=65942
PROBE_CONTEXT_CHARS_A1=see the S3 report
```

### THE FULL-SOURCE ARM'S CAPACITY LIMITATION — RECORDED, NOT SILENTLY TRUNCATED

The ACT states: *"If the complete source cannot fit, do not silently truncate
it. Record the limitation and qualify the affected comparison."*

The W1 source prefix renders to **438 428 characters ≈ 146 143 tokens**,
against a **131 072-token** window. The full-source arm therefore **cannot be
executed as a full-source request**. Two facts are recorded:

1. The full-source arm's request was ATTEMPTED and **FAILED at the
   provider** with `finish_reason=error` and an empty answer on all 12
   probes. It is reported as `UNSCORABLE`, NOT as a wrong answer.
2. The full-source POSITIVE CONTROL is therefore established by the **M arm** —
   the **minimal evidence restoration** (C6.3) — which restores the **ORIGINAL
   tool-result bodies** that the oracle's own evidence references name
   (~24 313 tokens). It is source-faithful: the evidence is the tool's own
   output, not an oracle-authored answer, and nothing unrelated is added.

The comparison is therefore QUALIFIED as follows:

```text
FULL_SOURCE_BEHAVIORAL_CONTROL=QUALIFIED_MINIMAL_EVIDENCE_RESTORATION
FULL_SOURCE_CAPACITY_LIMITATION=THE_COMPLETE_SOURCE_PREFIX (~146k tokens)
  EXCEEDS THE 131072-token MODEL WINDOW; THE COMPLETE SOURCE WAS NOT
  SILENTLY TRUNCATED AND WAS NOT SUCCESSFULLY SUBMITTED
```

## 5. WHAT A1 COSTS AND WHAT IT BUYS

| | A0 | A1 |
| --- | --- | --- |
| Additional production inference requests | — | **0** |
| Produced summary size | 5 784 chars | 9 260 chars |
| Oracle items PRESERVED | 3 | **5** |
| Oracle items PARTIALLY_PRESERVED | 5 | 4 |
| Oracle items OMITTED | 4 | **3** |
| CRITICAL items OMITTED | 4 | **3** |
| Summarizer physical requests | 1 | 1 |

**A1's larger summary is acceptable if it preserves materially important
knowledge — and it does: +2 preserved, −1 omitted, −1 critical omitted, at
ZERO additional inference requests.** The ACT explicitly warns against
optimising the compression ratio at the expense of task correctness; A1 moves
in the correct direction on correctness at no request cost.

**BUT A1 DOES NOT FIX THE PROBLEM.** O1, O4 and O7 remain OMITTED under A1,
because the revised instruction asks the summarizer to preserve knowledge
that **the summarizer's input never contained**. The instruction cannot
conserve what the input selection destroyed. This is the decisive
architectural observation of the ACT, and it is what separates Outcome B
from Outcome C.

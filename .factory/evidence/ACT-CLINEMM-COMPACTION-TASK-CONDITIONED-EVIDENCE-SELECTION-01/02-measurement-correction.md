# 02 — The measurement correction (C2.2)

ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01

## The predecessor's candidate B is PROMPT_ONLY_PRESERVATION

The predecessor reported arm B as "evidence-enhanced summarization" and
concluded that it "recovered NOTHING the baseline did not have and cost 116
extra tokens".

**That classification is wrong, and this ACT corrects it.**

The predecessor's arm B did **not** supply additional evidence to its
summarizer input. It changed only the **instruction** in the summarizer's
system prompt:

```
FACTUAL_PRESERVATION_INSTRUCTION = [
    PRODUCTION_SUMMARIZER_SYSTEM_PROMPT,
    "",
    "When the conversation contains observed command output, preserve every",
    "subject-value relationship EXACTLY as observed: ...",
].join("\n")
```

The measured `evidenceChars` for arm B was **0** — the same as arm A. The
**evidence did not enter the summarizer's input at all**.

Therefore:

- arm B is **PROMPT_ONLY_PRESERVATION**, not evidence-enhanced
  summarization;
- the predecessor's claim that "evidence-enhanced factual-preservation
  summarization failed" is **NOT** established by that measurement, and this
  ACT does **not** repeat it;
- the honest statement is narrower: **a prompt-only instruction did not
  recover a proposition the baseline had lost.**

The ACT's §9 conditional alternative — genuinely testing evidence-enhanced
factual-preservation summarization — was **NOT** executed. This ACT did not
need it: the deterministic ladder (S0–S3) already reached a decisive
proposition at a bounded cost, with **zero** material distortions and
**zero** additional inference requests.

## The inference accounting is separated

The ACT requires four distinct quantities. They are never conflated:

| Quantity | What it measures | This ACT's value |
|---|---|---|
| **Summarizer request** | the request the summarizer received | **UNCHANGED**. The summary artifact is FROZEN and reused by every arm. |
| **Persisted compacted context** | what the sidecar stores | the summary + the carried section |
| **Resumed-agent request** | what the working agent receives | the persisted context + the retained tail + system prompt + tool definitions |
| **Subsequent request sequence** | the whole continuation | every request after the compaction |

The predecessor's `completeRequestTokens` conflated the evidence size with
the summarizer's prompt size. This ACT does **not** add post-summary
evidence size to the summarizer prompt size, because the evidence never
enters the summarizer prompt.

## Estimated tokens are distinguished from provider-observed tokens

Every token count in this ACT is an **ESTIMATE** from the runtime's own
estimator. The endpoint does not expose a provider-observed prompt-token
count for these runs, so no such number is claimed. The report labels them
`estTokens` / `estimatedTokens` throughout.

## The predecessor's C−E is STRUCTURAL_ABLATION

The predecessor's arm "C_MINUS_SOURCE_BOUND_EVIDENCE_ABLATION" removed the
carried section from candidate C's own continuation. The summarizer request
was byte-identical and the ONLY difference was the section.

That is exactly what this ACT means by a **STRUCTURAL_ABLATION**, and the
predecessor's arm is relabelled accordingly. It is **not** a behavioural
ablation: no resumed-agent inference was run in either arm.

## BEHAVIORAL_IMPROVEMENT is NOT_EXECUTED

This ACT ran **no** resumed-agent inference. The predecessor's §10
behavioural gate was not reached, and no behavioural claim is made.

The reason is the ACT's own ordering: "Only the strongest structurally
qualified candidate proceeds to live inference", and the structural
qualification did not reach the ACT's bar (two of three decisive items are
still not `PRESERVED`). Proceeding to inference would have spent a provider
request on a candidate that has not cleared the structural gate.

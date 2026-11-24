# 06 — Limitations, and the mis-transcription finding

ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01

This document records what the candidate does NOT achieve, and the one
finding that a careless report would have hidden.

## The behavioural result, stated honestly

The S2 conservation improves dramatically:

```text
A0  criticalOmitted = 5
BE  criticalOmitted = 3
BR  criticalOmitted = 1
```

But the BEHAVIOURAL result does not follow it automatically:

| Arm | correct | partiallyCorrect | incorrect | criticalCorrect |
| --- | --- | --- | --- | --- |
| A0 | 0 | 0 | 3 | 0 |
| A0+O4 | 1 | 0 | 2 | 1 |
| A0+O7 | 1 | 0 | 2 | 1 |
| BE | 0 | 2 | 3 | 0 |
| BR | 0 | 3 | 3 | 0 |

**The targeted restoration controls flip their own item. The bounded-evidence
arms do NOT flip O4 or O7.** The two facts are consistent, and the reason is
specific:

- **A0+O4 / A0+O7** put the ORIGINAL evidence directly into the RESUMED
  MODEL's context. The model reads `47` and `500 / 1000` and answers
  correctly.
- **BE / BR** put the evidence into the SUMMARIZER's input. The summarizer
  must then compress it into the summary. **The compression is where the
  knowledge is still lost.**

This is a REAL and important refinement of the predecessor's conclusion.
The predecessor's A1 arm showed that changing the summarizer PROMPT cannot
preserve knowledge the input never contained. This ACT shows the second half:

> The input is necessary but NOT SUFFICIENT. The summarizer must also
> PRESERVE the proposition, with its material qualifications, through the
> compression step.

The ACT's exit gate §8 requires exactly this distinction:

> "3. The actual projected continuation contains that knowledge.
> 4. The resumed model can use it in the corresponding bounded behavioural
> probe."

Gate 3 passes for BE/BR on the S2 measure (5 → 1 critical omissions). Gate 4
does NOT, for O4 and O7.

## THE MIS-TRANSCRIPTION FINDING

The BR summary records the timeout pair as:

> "R2: Phone-notification senders use hardcoded/default connect/socket
> timeouts, e.g. `NotificationServiceClient` defaults `500 ms` / `1500 ms`"

**The socket timeout is 1000 ms, not 1500 ms.** The 1500 ms value is the
UNRELATED `KC_NS_KAFKA_SEND_TIMEOUT_MS` from the Helm values file, which was
also in the summarizer's input.

So the BE/BR arms:

- DID recover the connect timeout (500 ms) — the A0 summary had no timeout
  value at all;
- DID attribute it to the right subject (`NotificationServiceClient`);
- and DID attach the WRONG socket timeout, taking the value from a
  different subsystem that was also present.

**A mis-transcription is a different failure mode from an omission.** The
predecessor measured the loss as OMISSION (nothing inverted, no assurance
inflated). This ACT finds the first case in the family where the
evidence-bearing arm introduces a WRONG VALUE. It is not a contradiction of
the predecessor's measurement — it is a NEW failure mode that only exists
once evidence is present.

### Why this matters for the decision

This is the strongest argument for the ACT's chosen scope: the candidate is
NOT a production repair. Its S2 conservation gain is real and large, but
its behavioural gain is NOT established, and it introduces a new failure
mode (mis-attribution of a value across subjects) that the production
omission policy does not have.

A production implementation would need to address this. The most likely
mechanism — carrying the value TOGETHER WITH ITS SUBJECT AND ITS
QUALIFICATIONS, in a form the summarizer cannot silently merge — is a
design question for the implementer, not for this ACT. This ACT's contract
already carries `source`, `status` and `kind` alongside every fragment,
which is the right primitive; whether it suffices is the implementer's
question.

### What this does NOT invalidate

- The evidence DOES reach the summarizer (measured).
- The summarizer DOES use it (measured: the BE/BR summaries carry findings
  the A0 summary cannot, and the S2 critical omissions fall 5 → 1).
- The confidentiality controls hold (measured: zero leakage).
- The minimal-restoration causality is ESTABLISHED (measured: each
  restoration flips only its own item).
- The post-boundary invariant holds (measured: byte-identical).

## O1 — why it did not flip either

O1's proposition is a NEGATIVE observation (the first render FAILED with a
template type error) followed by a successful render with an override.

- The A0 arm asserted the render was obtained.
- The BE arm correctly said "its exit status was not captured" and correctly
  identified the DO render's missing dependency — a real improvement.
- The BR arm named the stock image and the missing dependency, and was
  scored PARTIALLY_CORRECT.

**O1's negative fact is the one thing a summarizer is most likely to
smooth away.** The A0 summary says "the render was obtained"; the BE summary
says the exit status "was not captured". Neither states the observed
failure.

The bounded evidence contract DOES admit a failed payload as a
`NEGATIVE_OBSERVATION` — and O1's evidence references (145, 147) sit deep in
the prefix. But the candidate's budget and selection did not reach the
specific failed-render payload, so the negative fact was never offered.

## The verdict, and what it means for the successor

```text
O1_CONSERVATION=NOT_CONSERVABLE_BY_THIS_CANDIDATE
O4_CONSERVATION=ESTABLISHED_CAUSAL
O7_CONSERVATION=ESTABLISHED_CAUSAL
BEHAVIORAL_CONSERVATION=ESTABLISHED_TARGETED
```

The targeted restoration is the causal certification and it is complete. The
bounded-evidence candidate is FEASIBLE and its S2 gain is large, but its
BEHAVIOURAL gain is not established, and it introduces a mis-transcription
mode.

**The verdict is therefore `GO_BOUNDED_SUMMARIZER_INPUT_REPAIR` — a GO for
the DIRECTION, with the implementer REQUIRED to close the compression
step**, because the measurement says the compression step, not the input
selection, is now the binding constraint.

The implementer's obligation, stated explicitly:

1. The compressed summary must carry the value WITH ITS SUBJECT and its
   MATERIAL QUALIFICATIONS, in a form that cannot be merged with a
   neighbouring value.
2. The mis-transcription mode must be measured, not assumed absent.
3. The candidate must remain at ONE inference request.

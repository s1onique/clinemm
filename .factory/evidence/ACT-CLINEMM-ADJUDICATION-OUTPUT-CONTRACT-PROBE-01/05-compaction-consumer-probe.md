# 05 — Compaction consumer probe (G4)

Executable source:
`sdk/packages/core/src/extensions/context/compaction.adjudication-output-contract.probe01.test.ts`
(describe blocks `G4.1`, `G4.2`, `G4.3`, `G4`, `G4.4`)

```text
EXECUTION CLASS: REAL_PRODUCTION_SEAM
  (buildBudgetProjection with the REAL agentic_summary policy,
   serializeConversation, buildSummaryRequest and MessageBuilder.buildForApi
   are the REAL production functions)
```

The exercised seam:

```text
Canonical assistant text
    -> buildAgenticSummaryInputBudget()      [M1]
    -> buildBudgetProjection(agentic_summary)
    -> serializeConversation()
    -> buildSummaryRequest()
    -> generateSummary()                     [summarizer injection seam]
    -> Persisted compaction projection
    -> MessageBuilder.buildForApi()
    -> Provider-visible continuation
```

## G4.1 — M1 carrier survival (the central structural discriminator)

**Result: PASS.**

| Control | Expected | Observed |
|---|---|---|
| Explicitly published assistant-`text` envelope | eligible for summarizer input | **SURVIVES M1** — the serialized conversation contains `adjudication_candidate` and `manual_enforcement_only` |
| Thinking-only control | dropped | **DROPPED** — the serialized conversation contains neither |
| Same thinking content under `normal_provider_request` | kept (isolation control) | **KEPT** — the serialized conversation contains `adjudication_candidate` |

The third row is the isolation control: it proves the loss is specific to
the compaction policy's `dropThinkingBlocks` setting, not to the serializer
or to the content itself. This is exactly the predecessor's discriminator
methodology applied to the NEW carrier.

```text
assistant text: eligible for summarizer input
thinking only: dropped
```

**This is the central structural discriminator of the ACT.** The published
candidate survives the exact boundary that destroyed the historical
witnesses, without changing that boundary.

## G4.2 — budget and cutoff

**Result: PASS, with honest accounting.**

| Case | Expected | Observed |
|---|---|---|
| Envelope INSIDE the selected prefix | reaches the summarizer input | reaches it |
| Envelope EXCLUDED from the selected prefix | does not reach it | does not reach it |
| Envelope under REAL budget pressure | reported, never claimed as preserved | the projection FAILS with `budget_unachievable_with_protections`; a tight-but-achievable budget truncates and the outcome is REPORTED, not assumed |
| Envelope after MORE THAN 12 later tool outcomes | not guaranteed to survive | `MAX_CARRIED_OUTCOMES` is still 12; the envelope is NOT part of the outcomer ledger, so it is subject to the SAME budget pressure — there is no separate unbounded channel |

**The probe never claims preservation for a message that never entered the
summarizer input.** The budget-pressure case asserts the FAILED projection
status and its warning code, rather than asserting a preservation that did
not happen.


## G4.3 — summary generation (A: retained, B: omitted)

### A — summarizer RETAINS the candidate

**Result: PASS.**

The summarizer's INPUT (`buildSummaryRequest`) contains:

```text
"adjudication_candidate"
"manual_enforcement_only"
"call_s1_source_read_0001"
```

A controlled summarizer that retains the candidate produces a summary from
which the STRICT parser recovers:

```text
decision              = narrowed
qualification_codes   contains manual_enforcement_only
evidence_tool_use_ids contains call_s1_source_read_0001
```

### B — summarizer OMITS the candidate (mandatory negative control)

**Result: PASS.**

This is the control that distinguishes PUBLICATION FEASIBILITY from
GUARANTEED CONTINUITY.

```text
the envelope DID survive M1           -> conversationText contains it
the summarizer omits it               -> the summary does not contain it
the provider-visible continuation     -> does NOT contain it
```

**A mocked summarizer preserving a candidate does not prove that a live
summarizer will consistently do so.** The measured boundary is therefore:

```text
PUBLICATION into the summarizer input:   GUARANTEED (structural)
PRESENCE in the summarizer input:        GUARANTEED (structural)
PRESENCE in the persisted summary:       NOT GUARANTEED (model-dependent)
PRESENCE in the provider continuation:   NOT GUARANTEED (model-dependent)
```

## G4 — provider-visible continuation

**Result: PASS.** `MessageBuilder.buildForApi()` on the canonical history
carries the envelope into the provider-visible projection.

## G4.4 — subsequent compaction

**Result: PASS, with the remaining failure boundary classified.**

| Property | Observed |
|---|---|
| Does NOT become a system instruction | The provider-visible projection contains ZERO `role: "system"` messages |
| Does NOT duplicate unboundedly | Across a two-compaction sequence the envelope appears a bounded number of times (`<= 2`), not once per compaction without limit |
| Does NOT gain authority | Every accepted envelope stays `MODEL` / `PROVISIONAL` / `NOT_INDEPENDENTLY_ADJUDICATED`; the validator has no path that promotes it |
| Does NOT override newer contradictory evidence | A changed source revision moves the candidate to `STALE` and it cannot keep its authority |
| Does NOT silently lose its qualification | The essential qualification (`manual_enforcement_only`) is required by the validator; an artifact without it is REJECTED, not accepted as a weaker verdict |

### The remaining failure boundary (classified, NOT implemented away)

```text
BOUNDARY: a summarizer may OMIT the candidate from the summary.
CONSEQUENCE: the candidate does not reach the provider-visible continuation.
CLASSIFICATION: L3-class summarizer omission (the same class the
               predecessor's RED isolated for the thinking carrier).
MITIGATION AUTHORIZED HERE: NO.
```

This ACT does NOT implement a new persistence layer, a second carrier, or a
prompt change to force the summarizer to retain the candidate. It MEASURES
the boundary and classifies it. The G4.3-B negative control is the
executable witness that this boundary is real and not theoretical.

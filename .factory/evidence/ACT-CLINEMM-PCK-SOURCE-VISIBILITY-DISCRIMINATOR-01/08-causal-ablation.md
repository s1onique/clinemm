# 08 — Causal ablation and conservation

## The seam that was driven

The REAL production compaction seam, not a re-implementation:

```text
createCompactionStateAwarePrepareTurn
  -> createContextCompactionPrepareTurn({ strategy: "agentic" })
  -> runAgenticCompaction
     -> buildAgenticSummaryInputBudget -> buildBudgetProjection
     -> serializeConversation -> buildSummaryRequest
     -> generateSummary   (mocked at the provider-handler boundary)
  -> applyTaskContractToCompactedMessages
  -> applyVerifiedEvidenceToCompactedMessages
  -> [checkpoint projection]
  -> MessageBuilder.buildForApi   (the provider-visible projection)
```

The summarizer is a deterministic mock at the EXISTING provider-handler
injection boundary (`createHandlerAsync` in `@cline/llms`), and the EXACT
request string it received is **captured from the mock**, never re-derived
from the production code.

### Two seam parameters that had to be set correctly

The ACT found two non-obvious conditions that silently prevent the real
compaction path from running at all. Both are recorded because a future
implementation will hit them:

1. **The summarizer budget is derived from the SAME model limit as the
   compaction.** With `maxInputTokens: 10`, the summarizer receives only
   ~638 tokens while the folded prefix needs ~3 500, so the production path
   legitimately SKIPS the compaction (`budget_unachievable_with_protections`)
   and produces **no summary**. The ACT uses `maxInputTokens: 16 000`,
   which keeps the trigger satisfied and leaves the summarizer a workable
   budget.
2. **`mode: "auto"` requires the real context-window ratio.** The ACT uses
   the production `manual` mode, which is the same path the operator's
   `/compact` uses, so the seam runs the production compaction
   unconditionally.

## The five arms

| Arm | Input | Checkpoint |
|---|---|---|
| **A** | the existing lossy summarizer view | the existing baseline |
| **B** | the selected safe pre-compaction view | the model-generated checkpoint |
| **C** | the same safe view | the controlled synthetic oracle |
| **D** | the same as B | the checkpoint REMOVED |
| **E** | the same as B | the selection rule REVERTED to first-12 |

## The required proof chain

```text
Canonical observation
  -> visible to the selected checkpoint input        [asserted: G2.3, G2.5]
  -> published as a qualified record                 [asserted: G6.2, model-evaluation.test.ts]
  -> accepted without authority promotion            [asserted: G6.2 OVER-CLAIM, G4.1.2]
  -> projected through the REAL compaction           [asserted: G7.1, the real seam]
  -> visible in the provider request                 [asserted: G7.1, buildForApi]
```

Each transition captures the exact relevant input/output identity:

| Transition | The captured identity |
|---|---|
| canonical → checkpoint input | the exact witness token in the view text |
| checkpoint input → published record | the record's kind, assurance, status and qualification count |
| published record → accepted | the BOUNDED assurance, never `runtime_verified` |
| accepted → projected | the projected section's text, containing the observation |
| projected → provider request | the JSON of `MessageBuilder.buildForApi()` |

## The non-vacuity checks (G7.1)

| Check | Result |
|---|---|
| Remove the observed source fact → the visibility assertion fails | **the assertion is a positive `toContain` on the view text**, so removing the fact fails it |
| Replace the source reference with an unrelated valid reference → semantic support is not certified | **asserted** by `trust-provenance.test.ts` G4.1 / G4.1.7 |
| Restore the lossy serializer → exact source visibility fails | **asserted** by `visibility-red.test.ts` G2.3 / G2.5 |
| Remove the checkpoint projection → the continuation loses the checkpoint | **asserted** by `causal-ablation.test.ts` G7.1.2 (ARM D) |
| Restore first-12 selection → the previously discarded records are discarded again | **asserted** by `selection.test.ts` G5.1 / G5.3 |
| Introduce unsupported global-negative wording → the candidate is rejected or demoted | **asserted** by `model-evaluation.test.ts` G6.2 R6 |

**No test in this ACT asserts only that a generated constant equals another
test constant.** Every visibility assertion is anchored on the REAL
canonical history, the REAL frozen captures, or the REAL production seam.

## The conservation checks (G7.2)

| Property | Result | How it is asserted |
|---|---|---|
| Canonical messages unchanged | **PASS** | the caller's canonical history is byte-identical before and after the seam |
| Original user task unchanged | **PASS** | every non-summary message is byte-identical |
| Tool-call/result pairing unchanged | **PASS** | every non-summary message is byte-identical; the view renders pairs as read-only labels and never rewrites them |
| Task contract unchanged | **PASS** | the checkpoint projection is applied AFTER the production carry-forwards and touches only the summary message |
| Verified-outcome carry-forward unchanged | **PASS** | same |
| Existing adjudication carry-forward unchanged | **PASS** | same |
| Stable-prefix behaviour unchanged | **PASS** | the projection adds no message and no new prefix element; the section is attached to the EXISTING summary message |
| No sidecar schema change | **PASS** | the ACT adds no field to `SessionCompactionStateSchema` |
| No new provider tool | **PASS** | the seam is driven with `tools: []`; the checkpoint request carries no tools |
| No new execution command | **PASS** | the generation script runs no repository command; it only reads the operator-local stores and writes the operator-local output |
| No global memory store | **PASS** | the ACT creates no store, no cache and no registry |
| No leaked raw thinking | **PASS** | asserted by `reasoning-boundary.test.ts` G1.3.1 across every distinctive reasoning fragment |
| No default-on instrumentation | **PASS** | no production module was modified at all |
| No live installed-extension mutation | **PASS** | `git diff --stat HEAD` is EMPTY; the live `codium-roz` extension was not touched |
| Projection idempotent | **PASS** | applying it twice leaves exactly ONE section (G7.2.2) |
| The section is strippable | **PASS** | `stripCheckpointSection()` removes the marked block and the heading |

## The five arms, measured

```text
ARM A  the existing lossy summarizer view
       the provider-visible continuation does NOT carry `start --optimized`

ARM B  the selected safe pre-compaction view + the model-generated checkpoint
       the provider-visible continuation DOES carry `start --optimized`
       and the section carries the MODEL-AUTHORED banner

ARM C  the same safe view + the controlled synthetic oracle
       the provider-visible continuation DOES carry `start --optimized`
       (labelled SYNTHETIC; never conflated with a model result)

ARM D  the same as B, with the checkpoint REMOVED
       the provider-visible continuation does NOT carry `start --optimized`

ARM E  the same as B, with the selection rule REVERTED to first-12
       the R4 and R6 records are discarded again (measured in
       selection.test.ts on the historical 20-record output)
```

## The `SYNTHETIC` labelling discipline

The synthetic oracle is labelled `SYNTHETIC` everywhere it appears:

- in `causal-ablation.test.ts` it is named `ORACLE_RECORDS` and the comment
  states it "is written by this ACT, not by a model";
- the causal ablation is proved with the ORACLE, and the REAL model result
  is evaluated separately in `model-evaluation.test.ts`;
- the two are never combined into a single claim.

This ACT does **not** conflate a synthetic oracle projection with a real
model result.

## G7 exit

```text
PASS — the causal chain is proved through the REAL production seam, every
conservation property holds, and every arm is exercised.
```

# semantic-contract.md
ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01
HEAD = 2883deb70 (production-equivalent to 9f994b135; intervening commits are Factory-only)

## Q1 — label promise

The UI calls itself "current context usage" but the producer feeds it "last request input":

| Surface | Text | Claim |
|---------|------|-------|
| `ContextWindow.tsx:175` | `title="Current tokens used in this request"` | "current ... used" |
| `ContextWindow.tsx:199` | `aria-label="Context window usage progress"` | "usage" |
| `ContextWindow.tsx:208` | `title="Maximum context window size for this model"` | denominator |
| `ContextWindowSummary.tsx:145` | `"Context Window"` / `"Used:"` / `"Total:"` / `"Remaining:"` | utilization view |
| `ContextWindowSummary.tsx:129,136` | `"Auto Condense Threshold"` / "When the context window usage exceeds this threshold, the task will be automatically condensed." | forward-looking threshold |
| `ContextWindowSummary.tsx:167` | `"Token Usage"` (billed activity; distinct row) | secondary dimension |

The label/tooltip language is **C2-shaped** ("current", "usage", forward-looking threshold). The producer feeds the bar **P**. The mismatch is the live UX defect.

## Q2 — value chain (P-space only)

```text
modifiedMessages
  → getLastApiReqContextInputTokens            (getApiMetrics.ts:163-186)
        walks messages from end → first api_req_started
        → tokensIn + cacheReads + cacheWrites
        IGNORES say:"compaction" dividers
  → ChatView.lastApiReqContextInputTokens      (ChatView.tsx:121-123)
  → TaskSection → TaskHeader                   (TaskHeader.tsx:300-310)
  → ContextWindow.tokenData                    (ContextWindow.tsx:128-133)
        percentage = lastApiReqContextInputTokens / contextWindow
        used       = lastApiReqContextInputTokens
  → Progress bar + "Current tokens used" title  (ContextWindow.tsx:175,201)
```

After compaction and before the next `api_req_started`, the most recent one is **pre-compaction**; the bar shows `P = 364.9k` while the divider row shows `H_b → H_a = 364.9k → 264.3k`. Two disjoint input sources.


## Q3 — domain tagging

| Tag | Quantity | Domain | Wire source | UI consumer |
|-----|----------|--------|-------------|-------------|
| P | REQUEST_INPUT_TOKENS = `tokensIn + cacheReads + cacheWrites` of last `api_req_started` | provider scale | `api_req_started.text` | `tokenData.used` + `tokenData.percentage` (ContextWindow.tsx:128-133) |
| H_b | COMPACTION_BEFORE_TOKENS | SDK estimator scale (chars/4-class) | `compaction.text.tokensBefore` | CompactionRow.tsx:47 |
| H_a | COMPACTION_AFTER_TOKENS | SDK estimator scale (chars/4-class) | `compaction.text.tokensAfter` | CompactionRow.tsx:47 |
| W_e | WORKING_CONTEXT_ESTIMATE | **NONE PUBLISHED** | — | — |
| M_b | MODEL_INPUT_BUDGET (denominator) | provider scale | `selectedModelInfo.contextWindow` | `tokenData.max` (denominator only) |

H_b and H_a both originate from `compaction.ts:551-555,579-580` via `estimateMessageTokens` walking canonical messages — they are **never** on provider scale. P originates from `getApiMetrics.ts:163-186` walking `api_req_started` events. W_e is **not on the wire**.

## Q4 — W authority and H_a ≡ W_e

```text
W_AUTHORITY  = ABSENT
H_a ≡ W_e    = NOT PROVEN
```

`compaction` say payload carries `{status, mode, tokensBefore?, tokensAfter?, messagesBefore?, messagesAfter?}` — all four numerics are H-space (`estimateMessageTokens` over canonical messages). `getLastApiReqContextInputTokens` does NOT consume the divider; the JSDoc at `getApiMetrics.ts:150-156` explicitly forbids ratio rescaling because the divider scale ≠ provider scale.

Therefore:
- **C2-as-consumer-only = UNACHIEVABLE_AT_CURRENT_WIRE** — there is no W-space field to consume.
- **H_a ≡ W_e = NOT PROVEN**, and the spec forbids inferring equivalence from arithmetic coincidence.
- A producer-side act (publish W_e on the `compaction` payload) is required to unlock C2 or C3 at the consumer.



## Q5 — verdict

```text
HALT_NO_INTENT_FROZEN_FOR_C2_C3
```

- **C1** (provider-observation bar): the data is honest P and the producer code documents why (Strategy-D at cb5b52239 closed the prior cross-scale arithmetic defect). Fixing C1 alone would require changing the labels to "last request input" — that is a **label ACT**, not a recon finding.
- **C2** (current-working-context bar): the contract the labels imply, but it is **UNACHIEVABLE_AT_CURRENT_WIRE** because no W-space authority is published at the post-compaction seam. A consumer-only repair cannot fabricate W_e without violating the cross-domain equivalence prohibition.
- **C3** (multi-source presentation): requires a producer-side act to publish W_e (or equivalent) alongside P/H. The existing `compaction` say message **already mechanically distinguishes H-space from P-space** (distinct message type, separate row in the conversation list, different label language via `CompactionRow.tsx:46-47`), so a new `kind` discriminator on `api_req_started` is **not needed** at the divider level. What C3 needs is a new W-space field, not a new discriminator.

**Decisive matrix**:

| Contract | Compatible with current producer + label? | Repair class |
|----------|-------------------------------------------|--------------|
| C1 | Yes (data is honest P; labels lie) | bounded LABEL ACT |
| C2 | NO — no W authority in wire | producer-side ACT (UNACHIEVABLE_AT_CURRENT_WIRE) |
| C3 | NO — labels exist; W value does not | producer-side ACT (publish W_e) |

## Next action (reviewer disposition)

```text
Option A (preferred): HALT_NO_INTENT_FROZEN
  → product decision ACT
  → "should the bar mean C1 or C2 or C3?"
  → no Factory repair until the product owner names the contract

Option B (bounded C1-only ACT, conservative):
  ACT-CLINEMM-COMPACTION-HEADER-LABEL-REPAIR01
  → only fixes the label/tooltip mismatch
  → bar says "Last request input", which matches the data
  → does NOT claim H_a ≡ W_e
  → does NOT add a kind discriminator
  → keeps Strategy-D consumer untouched

Option C (producer-side, opt-in):
  ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01
  → adds a W-space field to the `compaction` say message
    (e.g. workingContextEstimate: providerScaleTokensAfter)
  → unlocks C2 and C3 at consumer level
  → out of recon scope; requires a producer-side ACT
```

This recon recommends **A** because the defect is genuinely a "what does the product promise?" question that Factory should not pre-decide.

## Conservation

- DEFECT_A_CROSS_SCALE_RATIO_TRANSFER = CLOSED at cb5b52239 (Strategy-D; H_a ≡ P ratio forbidden)
- DEFECT_B_POST_COMPACTION_PUBLICATION = CLOSED at HEAD (trailing postStateToWebview at sdk-compaction-coordinator.ts:380)
- ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01) invariants preserved
- getLastApiReqContextInputTokens / getApiMetrics: 24/24 + G2-G5 GREEN at HEAD
- H_a_TO_W_e_EQUIVALENCE = UNBOUND (carried forward; the recon did NOT prove it)
- NEW_WIRE_KIND = UNBOUND (the existing `compaction` message type already mechanically distinguishes H from P; a `kind` discriminator is NOT needed at the divider level)
- FULL_UI_DOM_RENDER = OPTIONAL (chain is a pure function; `ContextWindow.test.tsx` is the existing extracted-projection oracle at HEAD; no new harness required)


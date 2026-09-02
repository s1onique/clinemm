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
HEADER_BAR_INTENT = CURRENT CONTEXT-WINDOW UTILIZATION (frozen)
C2                 = SELECTED
HALT_NO_INTENT_FROZEN = REJECT
```

The ClineMM UI labels alone are not neutral:

- `ContextWindow.tsx:175` `title="Current tokens used in this request"` — "current", not "last"
- `ContextWindow.tsx:199` `aria-label="Context window usage progress"` — "usage", not "history"
- `ContextWindow.tsx:208` `title="Maximum context window size for this model"` — denominator is model state
- `ContextWindowSummary.tsx:145` `"Context Window"` / `"Used:"` / `"Total:"` / `"Remaining:"` — three-state utilization
- `ContextWindowSummary.tsx:129,136` `"Auto Condense Threshold"` / "When the context window usage exceeds this threshold, the task will be automatically condensed." — forward-looking

The UI presents the number as **context-window state**, not as a historical accounting record. External corroboration:

- upstream CHANGELOG entry (cline/cline) introduced this as a "Context Window progress bar" to help users understand degradation as context increases; Auto Compact is described as summarizing history to free space when approaching the context limit
- upstream user issue (cline/cline#10637) describes the bar "running backwards" as evidence of compaction, and reports starting-context count being implausibly high — both readings assume the bar means *current utilization*, not last request input

Intent is sufficiently frozen to **SELECT C2**: the bar must mean the best authoritative estimate of what would constrain the *next request*, not necessarily the exact provider truth, and not the most-recent historical request.

**Per-contract read**:

- **C1** (provider-observation bar = last `api_req_started`): data is honest P; labels do not match. Reject as the contract.
- **C2** (current-working-context bar): SELECTED. Implementation currently absent at the post-compaction wire (Q4). The header reads from P only because W is not yet published. The intent–implementation gap is what `WORKING-CONTEXT-AUTHORITY-PUBLISH01` is for; the **consumer** does not need to fabricate W_e — the **producer** must publish it.
- **C3** (multi-source presentation with both last-request P and current-estimate W/H alongside explicit labels): a valid label-only reading is `Last provider request: 364.9k` / `Compaction estimate: 364.9k → 264.3k` — that requires **better labels**, not necessarily a new W_e field.

So freeze:

```text
C3_REQUIRES_W               = NOT PROVEN
C3_REQUIRES_PRODUCER_CHANGE = NOT PROVEN
C3_REQUIRES_LABEL_CHANGE    = PROVEN
```

The `compaction` say message **already mechanically distinguishes H-space from P-space** (distinct message type, separate row in the conversation list, different label language via `CompactionRow.tsx:46-47`); a new `kind` discriminator is **not needed** at the divider level.

**Decisive matrix**:

| Contract | Compatible with intent? | Compatible with current producer? | Repair class |
|----------|-------------------------|-----------------------------------|--------------|
| C1 | No (labels do not match last-request semantics) | Yes | bounded LABEL ACT (de-selected) |
| **C2** | **Yes — SELECTED** | **No — W authority absent** | **producer-side ACT (publish W)** |
| C3 | Yes | No for full; yes for label-only | label-only ACT (C3_REQUIRES_PRODUCER_CHANGE = NOT PROVEN) |

## Next ACT

Open:

```text
ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01
```

Primary purpose: establish one authoritative current-working-context estimate at the post-compaction boundary and project it to the context-window header, without treating `COMPACTION_AFTER_TOKENS` as equivalent by assumption.

**Phase 1 — producer recon.** Find the lowest production seam that holds the exact payload that would become the next request:

```text
system prompt
canonical post-compaction messages
tools
request overhead
```

Then ask: can the existing `estimateRequestInputTokens(...)` (or equivalent) produce W from THAT exact post-compaction request shape? If yes, that is promising. But prove `W = estimate of next request input` from identical inputs — not `W = H_a because both happen to use estimators`.

**WIRE_LOCATION = UNDECIDED.** Possible production shapes:

```text
compaction.payload.workingContextEstimate
top-level projected state.currentWorkingContextEstimate
existing task/header projection
producer-side calculation feeding a dedicated presentation field
```

Choose only after recon of where a truthful W can be computed once and published without duplicating estimation logic.

**True RED** (once the producer seam is bound):

```text
Given:  successful compaction, no subsequent api_req_started
Then:  currentWorkingContextEstimate MUST be available to TaskHeader
       immediately, as a finite authoritative W estimate
At HEAD expected RED: actual = missing; expected = finite W
```

**Conservation invariants** for the next ACT:

```text
lastProviderRequestInput P   remains 364.9k
compaction H values         remain untouched
cumulative usage            unchanged
provider billing metrics    unchanged
H_a ≡ W_e                   NOT claimed by arithmetic coincidence
```

**Header GREEN** (after W exists):

```text
before compaction:          header = W_before
after compaction:           header = W_after
before next provider request: header already reflects W_after
```

This directly fixes the observed stale bar without touching Strategy-D or reviving cross-scale ratio arithmetic.

**Do NOT require `W = 264.3k`.** The live divider says `H_a = 264.3k`; the eventual W calculation may produce 263.1k / 267.8k / 264.3k depending on system prompt, tools, overhead, and estimator semantics. The invariant is `header == authoritative W`, not `header == compaction tokensAfter`. That distinction is the entire value of the prior accounting work.

## Conservation

- DEFECT_A_CROSS_SCALE_RATIO_TRANSFER = CLOSED at cb5b52239 (Strategy-D; H_a ≡ P ratio forbidden)
- DEFECT_B_POST_COMPACTION_PUBLICATION = CLOSED at HEAD (trailing postStateToWebview at sdk-compaction-coordinator.ts:380)
- ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01) invariants preserved
- getLastApiReqContextInputTokens / getApiMetrics: 24/24 + G2-G5 GREEN at HEAD
- H_a_TO_W_e_EQUIVALENCE = UNBOUND (carried forward; the recon did NOT prove it)
- NEW_WIRE_KIND = UNBOUND (the existing `compaction` message type already mechanically distinguishes H from P; a `kind` discriminator is NOT needed at the divider level)
- FULL_UI_DOM_RENDER = OPTIONAL (chain is a pure function; `ContextWindow.test.tsx` is the existing extracted-projection oracle at HEAD; no new harness required)
- HEADER_BAR_INTENT = CURRENT CONTEXT-WINDOW UTILIZATION (frozen; ClineMM UI labels + upstream CHANGELOG entry + upstream user issue #10637)
- C2 = SELECTED (intent sufficiently frozen; implementation gap = absence of W authority at the post-compaction wire)
- C3_REQUIRES_W = NOT PROVEN
- C3_REQUIRES_PRODUCER_CHANGE = NOT PROVEN
- C3_REQUIRES_LABEL_CHANGE = PROVEN
- WIRE_LOCATION = UNDECIDED (compaction.payload.workingContextEstimate / top-level projected state.currentWorkingContextEstimate / existing task/header projection / producer-side presentation field — choose after Phase 1 producer recon)
- NEXT_ACT = ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01
- DISPOSITION = PASS_WITH_ONE_P1_FIX (Factory causal reviewer; the prior verdict HALT_NO_INTENT_FROZEN overreached)

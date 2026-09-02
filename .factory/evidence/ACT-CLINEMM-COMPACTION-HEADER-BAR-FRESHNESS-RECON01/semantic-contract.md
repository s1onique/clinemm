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
H_a ≡ W_e    = UNPROVEN
H_a ≡ W_e BY ASSUMPTION = FORBIDDEN (reviewer P1 nomenclature;
                            equivalence may one day be
                            mechanically proven from identical
                            exact inputs + identical estimator,
                            but cannot be taken as a starting
                            assumption)
```

`compaction` say payload carries `{status, mode, tokensBefore?, tokensAfter?, messagesBefore?, messagesAfter?}` — all four numerics are H-space (`estimateMessageTokens` over canonical messages). `getLastApiReqContextInputTokens` does NOT consume the divider; the JSDoc at `getApiMetrics.ts:150-156` explicitly forbids ratio rescaling because the divider scale ≠ provider scale.

Therefore:
- **C2-as-consumer-only = UNACHIEVABLE_AT_CURRENT_WIRE** — there is no W-space field to consume.
- **H_a ≡ W_e = UNPROVEN**, and the spec forbids inferring equivalence from arithmetic coincidence or from provider cache counters (this is the FORBIDDEN-by-assumption side of the I6 invariant; carried forward to ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01).
- A producer-side act (publish W_e on the `compaction` payload, computed from canonical post-compaction request shape — system prompt + messages + tools + deterministic request-envelope overhead only where the existing estimator already includes it — NOT from provider cache counters) is required to unlock C2 or C3 at the consumer.



## Q5 — verdict

```text
UI_PURPOSE                          = context-window utilization guidance / PROVEN
CURRENT_IMPLEMENTATION              = P-space last request input       / PROVEN
C1_INTENT                           = PLAUSIBLE
C2_INTENT                           = PLAUSIBLE
C3_INTENT                           = PLAUSIBLE
C2_SELECTED                         = NO  (intent not proven from source)
C2_SOURCE_INTENT                    = NOT PROVEN
HEADER_BAR_NEXT_REQUEST_SEMANTIC    = NOT PROVEN
W_AUTHORITY                         = ABSENT / PROVEN
H_a ≡ W                             = NOT PROVEN / PRESERVE
PRODUCT_DECISION                    = C2  (made by Factory this turn, NOT a source claim)
W_PRODUCER_ACT                      = AUTHORIZED  (now that PRODUCT_DECISION = C2)
NO_NEW_RECON                        = YES (do not open another Factory recon)
```

The implementation / recon facts remain excellent:

- bar producer = P (last `api_req_started` input)
- H_a = compaction estimator domain
- W = not published
- H_a ≡ W = NOT PROVEN

But the strongest ClineMM literal — `ContextWindow.tsx:175` `title="Current tokens used in this request"` — is **ambiguous**. It can naturally mean "the request whose usage was just observed" (C1) as well as "the hypothetical next request if generated now" (C2). The actual producer has long been the last `api_req_started` → provider-reported request input, so source behavior + wording can consistently describe **current / most-recent request context utilization** — much closer to C1 than the previous disposition acknowledged.

External corroboration cuts **both ways** and does not break the tie:

- upstream user issue #9433 (Context Window bar stays at 0% with `usage: null`): the bar's historical primary authority is **provider-observed request usage** (it collapses when usage is null, and the user expectation there is to *add an estimator fallback*) — strong evidence that P-space is the established authority, NOT that a W-space contract already exists
- upstream user issue #10637 ("bar running backwards as compaction"): user expectation / observation, not numerator semantics
- upstream CHANGELOG entry ("Context Window progress bar" for understanding degradation as context grows): establishes purpose, not whether the numerator is `P = previous/latest actual request input` or `W = estimated next-request working context`

**Per-contract read** (corrected):

- **C1** (last actual request input): PLAUSIBLE intent. Implementation already at HEAD. No source change required — only label/tooltip wording is in scope if C1 is selected. Bar stays at 364.9k until next request.
- **C2** (estimated next-request / current-working-context): PLAUSIBLE intent. Implementation currently absent at the post-compaction wire (Q4). The header reads from P only because W is not yet published. If C2 is selected, the consumer must NOT fabricate W (that would revive the cross-scale arithmetic prohibition); the producer must publish it.
- **C3** (multi-source presentation with explicit semantics): PLAUSIBLE intent. A valid label-only reading is `Last provider request: 364.9k` / `Compaction estimate: 364.9k → 264.3k` — that requires **better labels**, not necessarily a new W_e field.

```text
C3_REQUIRES_W               = NOT PROVEN
C3_REQUIRES_PRODUCER_CHANGE = NOT PROVEN
C3_REQUIRES_LABEL_CHANGE    = PROVEN
```

The `compaction` say message **already mechanically distinguishes H-space from P-space** (distinct message type, separate row in the conversation list, different label language via `CompactionRow.tsx:46-47`); a new `kind` discriminator is **not needed** at the divider level.

**Decisive matrix** (corrected — intent column now reflects plausibility, not selection):

| Contract | Plausibly consistent with intent? | Compatible with current producer? | Repair class |
|----------|-------------------------------------|-----------------------------------|--------------|
| C1 | Yes | Yes | bounded LABEL ACT (no W publishing required) |
| C2 | Yes | No — W authority absent | producer-side ACT (publish W) |
| C3 | Yes | No for full; yes for label-only | label-only ACT (C3_REQUIRES_PRODUCER_CHANGE = NOT PROVEN) |

**Why the previous C2 SELECTED was over-aggressive.** Opening a W-authority ACT adds a new production authority and potentially changes what users see **without first establishing that the product wants the bar to represent W**. That violates the Factory causality rule: we would be implementing the prettier hypothesis.

**Product decision (made this turn).** Factory now names the contract:

```text
PRODUCT_DECISION = C2
```

This is a **product recommendation** by the Factory causal reviewer, not a source-intent fact. The supporting rationale (recorded for audit): a capacity gauge that remains at 364.9k after a compaction that has demonstrably reduced the canonical working set is operationally misleading, even if 364.9k is historically truthful; users care about "how full am I now?", and the upstream #9433 / #10637 threads both support treating provider-observed request usage as the historical primary authority but wanting a forward-looking fallback when it is absent or stale.

Once `PRODUCT_DECISION = C2` is frozen, `W_PRODUCER_ACT = AUTHORIZED` — but **only that** ACT (not a fresh recon) is opened next.

## Next ACT

**Authorization frame (corrected this turn).** A prior disposition (this commit lineage, commit `e71ca399b`) selected C2 from source evidence alone. The Factory causal reviewer has since corrected that disposition: source evidence alone leaves C1/C2/C3 **equally plausible**. The next ACT is **authorized by an explicit product decision** (recorded in Q5 above), not by source intent. Do not re-litigate the decision inside the next ACT — its scope is **only** the producer-seam bind and the WIRE_LOCATION selection.

Open:

```text
ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01
```

Primary purpose: establish one authoritative current-working-context estimate at the post-compaction boundary and project it to the context-window header, without treating `COMPACTION_AFTER_TOKENS` as equivalent by assumption.

**NO_NEW_RECON.** The reviewer explicitly forbids opening another Factory recon before this ACT lands. The PRODUCT_DECISION is made; the next move is engineering.

**Phase 1 — producer recon.** Find the lowest production seam that holds the exact payload that would become the next request:

```text
system prompt
canonical post-compaction messages
tools
request overhead
```

Then ask: can the existing `estimateRequestInputTokens(...)` (or equivalent) produce W from THAT exact post-compaction request shape? If yes, that is promising. But prove `W = estimate of next request input` from identical inputs — not `W = H_a because both happen to use estimators`.

**WIRE_LOCATION = SELECTED.** Phase 1 source bind + GREEN producer-seam publish (commit 2 of ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01) selected:

```text
ContextPipelinePrepareTurnResult.currentWorkingContextEstimate
```

```text
compaction.payload.workingContextEstimate
top-level projected state.currentWorkingContextEstimate
existing task/header projection
producer-side calculation feeding a dedicated presentation field
                                      ^^^^^^^^^^^^^^^^^^^^^^
                                      SELECTED (variant 4 of 4)
```

W is computed at the prepare-turn seam
(`createCompactionStateAwarePrepareTurn` at
`sdk/packages/core/src/extensions/context/compaction.ts:658-728`)
from the FINAL returned request shape (systemPrompt + messages +
tools) via `estimateRequestInputTokens` and published as
`currentWorkingContextEstimate` on the result. The state-aware
wrapper applies W to every result that flows through it; production
call sites all go through the wrapper
(`local-runtime-host.ts:670`).

The upstream `createContextPipelinePrepareTurn` returns the same
`ContextPipelinePrepareTurnResult` shape but is NOT modified; it
is reached THROUGH the state-aware wrapper, which is the
authoritative publish site.

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
- WIRE_LOCATION = SELECTED = ContextPipelinePrepareTurnResult.currentWorkingContextEstimate (variant 4 of 4: producer-side calculation feeding a dedicated presentation field on the prepare-turn result; bound at Phase 1 source bind + GREEN producer-seam publish; prepare-turn seam is the authoritative publish site)
- NEXT_ACT = ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01
- DISPOSITION = PASS_WITH_ONE_P1_FIX (Factory causal reviewer; the prior verdict HALT_NO_INTENT_FROZEN overreached)
- HEADER_BAR_INTENT = AMBIGUOUS (corrected this turn; "current tokens used in this request" is compatible with both C1 ("the request whose usage was just observed") and C2 ("the hypothetical next request if generated now"))
- UI_PURPOSE = context-window utilization guidance / PROVEN
- CURRENT_IMPLEMENTATION = P-space last request input / PROVEN
- C1_INTENT = PLAUSIBLE
- C2_INTENT = PLAUSIBLE
- C3_INTENT = PLAUSIBLE
- C2_SELECTED = NO (source intent not proven)
- C2_SOURCE_INTENT = NOT PROVEN
- HEADER_BAR_NEXT_REQUEST_SEMANTIC = NOT PROVEN
- W_AUTHORITY = ABSENT / PROVEN
- H_a ≡ W = UNPROVEN / PRESERVE
- H_a ≡ W BY ASSUMPTION = FORBIDDEN (reviewer P1 nomenclature; carried to WORKING-CONTEXT-AUTHORITY-PUBLISH01)
- W_INPUTS = system prompt + canonical post-compaction messages + tools + deterministic request-envelope overhead ONLY where the existing estimator already includes it (reviewer P1; carried to WORKING-CONTEXT-AUTHORITY-PUBLISH01)
- PROVIDER_USAGE_BUCKETS = EXCLUDED from W unless the estimator's existing contract mechanically defines them as context-bearing inputs (reviewer P1)
- cacheReads / cacheWrites = MUST NOT be added merely because they exist in API metrics (reviewer P1)
- TASKHEADER_CONTEXTWINDOW = NO CHANGE (until W is RED + GREEN at WORKING-CONTEXT-AUTHORITY-PUBLISH01)
- NEGATIVE_ASSERTION = W_after need not equal H_a (different semantic spaces; carried to WORKING-CONTEXT-AUTHORITY-PUBLISH01)
- CANONICAL_W_ESTIMATOR = estimateRequestInputTokens (bound at Phase 1 source bind — sdk/packages/shared/src/llms/tokens.ts:47, AUTHORITY_CALLSITE at compaction.ts:309; provider-usage non-interference enforced structurally by TokenEstimatedRequest input contract; reviewer P2 satisfied; carried to WORKING-CONTEXT-AUTHORITY-PUBLISH01)
- NEGATIVE_CONTROL_PROVIDER_USAGE = provider usage buckets change (cacheReads / cacheWrites / tokensIn) while canonical request content identical → W MUST NOT change (mandatory Phase 1 control; W1 == W2 mechanically proves no provider-accounting dependence reintroduction; carried to WORKING-CONTEXT-AUTHORITY-PUBLISH01)
- LIVE_264_3K_USAGE = DO NOT use the live 264.3k as a target; screenshot is evidence of UX defect not an oracle for W; test must derive W from canonical request estimator (reviewer P2; carried to WORKING-CONTEXT-AUTHORITY-PUBLISH01)
- PRODUCT_DECISION = C2 (made by Factory this turn — product recommendation by Factory causal reviewer, NOT a source-intent claim)
- W_PRODUCER_ACT = AUTHORIZED (now that PRODUCT_DECISION = C2)
- NO_NEW_RECON = YES (do not open another Factory recon)
- DISPOSITION_v2 = HALT_INTENT_NOT_PROVEN reverted to PRODUCT_DECISION = C2 → GO_W_AUTHORITY (Factory causal reviewer; commit `e71ca399b`'s `C2 = SELECTED` verdict was over-aggressive; source evidence leaves C1/C2/C3 equally plausible)

# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01

> Status: **OPEN / W_PRODUCER_ACT_AUTHORIZED /
> PRODUCT_DECISION_FROZEN / RECON_PRECEDOR_CLOSED /
> NO_NEW_RECON_OPENED**.
>
> Epistemic purpose: **BOUNDED_PRODUCTION_ENGINEERING** —
> bind the producer-side seam that holds the exact next-request
> shape (system prompt + canonical post-compaction messages +
> tools + request overhead), compute a single authoritative W
> estimate from that exact shape, publish W to the context-window
> header. Do NOT claim `H_a ≡ W_e`; do NOT require `W = 264.3k`.
>
> ```text
> ENTRY_HEAD            = <this commit>
> REVIEWER_DISPOSITION  = HALT_INTENT_NOT_PROZEN reverted to
>                         PRODUCT_DECISION = C2 → GO_W_AUTHORITY
>                         (factory causal reviewer, second pass on
>                         commit e71ca399b; the prior disposition
>                         that selected C2 from source evidence
>                         alone was over-aggressive — source
>                         evidence leaves C1/C2/C3 EQUALLY
>                         PLAUSIBLE; the W-authority ACT is
>                         AUTHORIZED by an explicit product
>                         decision, not by source intent)
> UPSTREAM_RECON        = ACT-CLINEMM-COMPACTION-HEADER-BAR-
>                         FRESHNESS-RECON01 (RECON_PASS / DISPOSITION
>                         HALT_INTENT_NOT_PROZEN → PRODUCT_DECISION=C2)
> PREDECESSOR_ACT       = ACT-CLINEMM-COMPACTION-PRESENTATION-
>                         FRESHNESS-EMPIRICAL01 (EMPIRICAL_REPORT = PASS)
> RELATED_RECON         = ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-
>                         TRUTH-RECON01 (closed recon; I1-I7
>                         invariants; H_a ≡ W_e forbidden by I6)
>                         and ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-
>                         CONSUMER-REPAIR01 (DEFECT A CLOSED at
>                         cb5b52239; Strategy-D; cross-scale ratio
>                         arithmetic removed from
>                         getApiMetrics.ts:174-225)
> DEFECTS_BOUND         = DEFECT A (cross-scale ratio transfer):
>                         CLOSED at cb5b52239 (consumer-side Strategy-D)
>                         DEFECT B (post-restore publication):
>                         CLOSED at HEAD (trailing postStateToWebview
>                         at sdk-compaction-coordinator.ts:380)
>                         DEFECT C (header-bar staleness = this ACT's
>                         scope): LIVE / consumer-level witness;
>                         full UI production-seam RED = NOT YET (this
>                         ACT's first task after Phase 1)
> WIRE_LOCATION         = UNDECIDED (Phase 1 producer recon binds it)
> PRODUCT_DECISION      = C2 (the bar represents the best available
>                         estimate of current/next-request
>                         context-window occupancy)
> CONSERVATION          = P (364.9k) unchanged; H values
>                         (264.3k / 364.9k) unchanged; cumulative
>                         usage unchanged; billing metrics
>                         unchanged; Strategy-D consumer untouched
> ```
>
> ACT ID: `ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01`
> Owned by epic: `EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING`
> (see `.factory/epics/context-compaction-token-accounting.md`)
> Evidence dir:
> `.factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01/`
> Entry head: `<this commit>` (current HEAD).
> ## Authorization frame (load-bearing)
>
> The Factory causal reviewer (second pass on commit `e71ca399b`)
> corrected the prior disposition. The corrected framing is:
>
> ```text
> HEADER_BAR_INTENT         = AMBIGUOUS
> UI_PURPOSE                = context-window utilization guidance / PROVEN
> CURRENT_IMPLEMENTATION    = P-space last request input       / PROVEN
> C1_INTENT                 = PLAUSIBLE
> C2_INTENT                 = PLAUSIBLE
> C3_INTENT                 = PLAUSIBLE
> C2_SELECTED               = NO (source intent not proven)
> C2_SOURCE_INTENT          = NOT PROVEN
> HEADER_BAR_NEXT_REQUEST_SEMANTIC = NOT PROVEN
> W_AUTHORITY               = ABSENT / PROVEN
> H_a ≡ W_e                 = NOT PROVEN / PRESERVE
> PRODUCT_DECISION          = C2
> W_PRODUCER_ACT            = AUTHORIZED
> ```
>
> **This ACT is NOT authorized by source intent.** It is authorized
> by an explicit product decision recorded in the upstream recon
> (`ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01` /
> `semantic-contract.md` Q5). If a future reviewer disputes
> `PRODUCT_DECISION = C2`, this ACT's authorization lapses; do NOT
> extend it into a different contract without re-opening the
> upstream recon.
>
> **Do NOT claim `H_a ≡ W_e`.** The upstream recon's I6 invariant
> (`H_a ≡ W_e FORBIDDEN`) applies to this ACT. Compute W from the
> actual next-request shape (system prompt + canonical post-compaction
> messages + tools + request overhead), not from `tokensAfter`.
>
> **NO_NEW_RECON.** The reviewer explicitly forbids opening another
> Factory recon before this ACT lands. The PRODUCT_DECISION is made;
> the next move is engineering.

## Phase 1 — producer seam recon

Goal: find the lowest production seam that holds the exact payload
that would become the next request, and prove W can be computed
from THAT exact post-compaction request shape — not from `tokensAfter`.

Inputs (in priority order — find the seam that holds all four):

```text
1. system prompt
2. canonical post-compaction messages
3. tools
4. request overhead (cache_reads/cache_writes estimation hooks,
   tool result markers, environment markers)
```

Candidate seams (Phase 1 outcome will pick one):

```text
- sdk/packages/core/src/extensions/context/compaction.ts (the
  compactor itself; has systemPrompt + apiMessages + tools + overhead
  at entry; emits tokensBefore/tokensAfter — could emit a
  third payload-side W)
- sdk/packages/core/src/session/models/session-compaction.ts
  (projectSessionCompactionState; the post-compaction projection)
- apps/vscode/src/sdk/sdk-compaction-coordinator.ts (the producer
  side that publishes to webview; trailing postStateToWebview at
  line 380 is the existing post-restore publication seam)
- The next-turn-prep seam (createCompactionStateAwarePrepareTurn at
  sdk/packages/core/src/extensions/context/compaction.ts:672-712)
```

The producer seam is where W is computed **once** and published.
The consumer (TaskHeader / ContextWindow.tsx) must NOT recompute W.

## RED (to author after Phase 1)

```text
Given:  successful compaction, no subsequent api_req_started
Then:  currentWorkingContextEstimate MUST be available to TaskHeader
       immediately, as a finite authoritative W estimate
At HEAD expected RED: actual = missing; expected = finite W
```

GREEN (after the producer seam publishes W):

```text
before compaction:             header = W_before
after compaction:              header = W_after
before next provider request:  header already reflects W_after
invariant: header == authoritative W (NOT header == H_a)
```

## Conservation invariants (mandatory for this ACT)

```text
lastProviderRequestInput P   remains 364.9k
compaction H values         remain untouched
cumulative usage            unchanged
provider billing metrics    unchanged
H_a ≡ W_e                   NOT claimed by arithmetic coincidence
Strategy-D consumer (getApiMetrics.ts:174-225) untouched
```

## WIRE_LOCATION = UNDECIDED

Possible production shapes (chosen only after Phase 1 producer recon):

```text
compaction.payload.workingContextEstimate
top-level projected state.currentWorkingContextEstimate
existing task/header projection
producer-side calculation feeding a dedicated presentation field
```

**Do NOT preselect wire location from source code alone.** The
upstream recon's `C3_REQUIRES_W = NOT PROVEN` and `C3_REQUIRES_
PRODUCER_CHANGE = NOT PROVEN` freezes remain in force — there is
no source contract that mandates a specific wire location. The
Phase 1 recon must justify the wire location from "where can W
be computed once and published without duplicating estimation logic",
not from "where the upstream recon thought it should go".

## Do NOT require `W = 264.3k`

The live divider says `H_a = 264.3k`. The eventual W calculation
may produce `263.1k / 267.8k / 264.3k` depending on system prompt,
tools, request overhead, and estimator semantics. The invariant
is `header == authoritative W`, not `header == compaction tokensAfter`.
That distinction is the entire value of the prior accounting work
(Strategy-D; ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01;
I6 invariant). Cross-scale ratio arithmetic stays FORBIDDEN.

## Stop conditions

- Phase 1 RED authored and pinned before any production edit
- GREEN test pins the producer seam to a single computation site
- Conservation invariants mechanically re-verified at GREEN
  (24/24 getApiMetrics + the working-context-ratio suite must
  stay GREEN)
- WIRE_LOCATION decision documented in entry-freeze.txt with
  justification from Phase 1 recon

## Out of scope (carried forward)

- C1 / C3 contract variants — NOT in this ACT's scope
  (PRODUCT_DECISION = C2 is the gate; if the decision flips,
  this ACT's authorization lapses)
- Any new wire `kind` discriminator — NOT needed at the divider
  level (existing `compaction` message type already mechanically
  distinguishes H from P)
- Full UI DOM render harness — OPTIONAL (chain is a pure function;
  `ContextWindow.test.tsx` is the existing extracted-projection
  oracle at HEAD)
- HALT_INTENT_NOT_PROVEN / C2_SOURCE_INTENT_NOT_PROVEN —
  already adjudicated by the upstream recon's second-pass
  disposition; do NOT re-litigate in this ACT

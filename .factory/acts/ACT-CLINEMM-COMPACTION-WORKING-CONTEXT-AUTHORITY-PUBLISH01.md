# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01

> Status: **OPEN / W_PRODUCER_ACT_AUTHORIZED /
> PRODUCT_DECISION_FROZEN / RECON_PRECEDOR_CLOSED /
> NO_NEW_RECON_OPENED**.
>
> Epistemic purpose: **BOUNDED_PRODUCTION_ENGINEERING** —
> bind the producer-side seam that holds the exact next-request
> shape (system prompt + canonical post-compaction messages +
> tools + deterministic request-envelope overhead only where the
> estimator already includes it), compute a single authoritative W
> estimate from that exact shape, publish W to the context-window
> header. Do NOT claim `H_a ≡ W_e` BY ASSUMPTION; do NOT require
> `W = 264.3k`; do NOT fold provider cache counters into W.
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
>                         invariants; H_a ≡ W_e equivalence-by-
>                         assumption FORBIDDEN by I6;
>                         H_a ≡ W_e remains UNPROVEN)
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
> H_a ≡ W_e                 = UNPROVEN / PRESERVE
> H_a ≡ W_e BY ASSUMPTION   = FORBIDDEN (reviewer P1 nomenclature)
> W_INPUTS                  = system prompt + canonical post-
>                             compaction messages + tools +
>                             deterministic request-envelope
>                             overhead ONLY where the existing
>                             estimator already includes it
> PROVIDER_USAGE_BUCKETS    = EXCLUDED from W unless the
>                             estimator's existing contract
>                             mechanically defines them as
>                             context-bearing inputs
> cacheReads / cacheWrites   = MUST NOT be added merely because
>                             they exist in API metrics
> PRODUCT_DECISION          = C2
> W_PRODUCER_ACT            = AUTHORIZED
> TASKHEADER_CONTEXTWINDOW  = NO CHANGE (until W is RED + GREEN)
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
> **Do NOT claim `H_a ≡ W_e` by assumption.** The upstream recon's
> invariant applies to this ACT as:
>
> ```text
> H_a_TO_W_EQUIVALENCE_BY_ASSUMPTION = FORBIDDEN
> H_a_TO_W_EQUIVALENCE               = UNPROVEN
> ```
>
> What is **forbidden** is *assuming or deriving the equivalence
> without proof*. The equivalence may eventually be true if a
> future implementation proves it from identical exact inputs and
> the identical estimator — but it must not be taken as a starting
> assumption. Compute W from the actual next-request shape (system
> prompt + canonical post-compaction messages + tools + deterministic
> request-envelope/context overhead only where the estimator already
> includes it), not from `tokensAfter` and not from provider
> cache counters.
>
> **NO_NEW_RECON.** The reviewer explicitly forbids opening another
> Factory recon before this ACT lands. The PRODUCT_DECISION is made;
> the next move is engineering.

## Phase 1 — producer seam recon

Goal: find the lowest production seam that holds the exact payload
that would become the next request, and prove W can be computed
from THAT exact post-compaction request shape — not from `tokensAfter`
and not from provider usage / cache accounting.

### What W is

```text
W = estimate(next request context occupancy)

NOT

W = reconstructed provider billing / input accounting
```

This is load-bearing. The prior Strategy-D repair
(`ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01`)
deliberately stopped ratio-transfer between provider accounting and
compaction estimates. If this ACT computes W by starting with exact
request content and then folds provider cache counters back into it,
we recreate the same category defect by another route.

Upstream #9433 is direct corroboration: the current bar's dependence
on provider `usage` is precisely what makes it fail when usage is null,
and the suggested fallback is **internal estimation**. That supports
keeping **estimation authority distinct from provider-reported usage
buckets**.

### W inputs (frozen for Phase 1)

```text
W_INPUTS =
  exactly the content-bearing inputs consumed by the same
  request-input estimator used for context budgeting:

    system prompt
    canonical post-compaction messages
    tools
    deterministic request-envelope / context overhead
      ONLY where that estimator already includes it

PROVIDER_USAGE_BUCKETS =
  EXCLUDED from W unless the estimator's existing contract
  mechanically defines them as context-bearing inputs

cacheReads / cacheWrites =
  MUST NOT be added merely because they exist in API metrics
```

### Seam evaluation table (Phase 1 must fill)

Phase 1 asks: **is there already one production estimator whose
inputs are exactly the canonical post-compaction request content that
would consume context on the next turn?** Start from the existing
estimator rather than inventing W semantics.

```text
| Candidate seam               | Has system prompt | Has canonical post-compaction messages | Has tools | Uses canonical request-context estimator | Suitable W authority? |
| ---------------------------- | ----------------- | -------------------------------------- | --------- | ---------------------------------------- | -------------------- |
| compaction result seam       |                   |                                        |           |                                          |                      |
| prepare-turn seam            |                   |                                        |           |                                          |                      |
| coordinator publication seam |                   |                                        |           |                                          |                      |
```

(The table is intentionally blank — Phase 1 fills it from the
production source. Do NOT preselect a winner from source code
alone.)

Candidate seams to evaluate (Phase 1 outcome will pick one or
document why none suffice):

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

The likely winner is **not necessarily the compactor**. The compactor
knows enough to estimate H, but the next-turn preparation seam may be
closer to the actual payload that will constrain the next API call.
Pick whichever seam satisfies:

```text
same semantic inputs
+
same estimator contract
+
no duplicate token logic
```

The producer seam is where W is computed **once** and published.
The consumer (TaskHeader / ContextWindow.tsx) must NOT recompute W.

## RED (to author after Phase 1)

```text
W_before =
  CANONICAL_W_ESTIMATOR(exact canonical pre-compaction
                        request shape)

W_after =
  CANONICAL_W_ESTIMATOR(exact canonical post-compaction
                        request shape)

after successful compaction:
  projected currentWorkingContextEstimate == W_after

At HEAD expected RED:
  projected W = absent
```

`CANONICAL_W_ESTIMATOR` is bound in Phase 1 from the actual
function used by next-request context-budget logic at the chosen
seam. The RED shape names it as a placeholder so the test is not
allowed to begin with `estimateRequestInputTokens` hard-coded
merely because that function already exists. If Phase 1 binds the
estimator to a different function, the ACT follows the real
authority.

That is a genuine RED once the producer seam is bound.

### Negative assertion (mandatory)

```text
W_after need not equal H_a
```

even when one fixture happens to produce equal numbers. The two
quantities belong to **different semantic spaces** (H = compaction
estimator; W = next-request context-bearing estimate). Any test
that asserts `W_after === H_a` for a fixture is a smell — it would
recreate the cross-scale arithmetic prohibition.

### Authorization step before RED

```text
RED_AUTHORIZED_AFTER:
  (i)   the seam evaluation table is filled
  (ii)  WIRE_LOCATION is selected from the table, not preselected
  (iii) the existing estimator contract that consumes the seam's
        inputs has been confirmed to include system prompt +
        canonical messages + tools (with deterministic request-
        envelope / context overhead only where the estimator
        already includes it)
  (iv)  CANONICAL_W_ESTIMATOR is bound to the actual function
        used by next-request context-budget logic at the chosen
        seam (do NOT hard-code estimateRequestInputTokens before
        this is bound; see CANONICAL_W_ESTIMATOR below)
```

### CANONICAL_W_ESTIMATOR (reviewer P2)

The RED shape currently names `estimateRequestInputTokens` as a
**candidate**, not a hard-coded assumption. Phase 1 must first
establish:

```text
CANONICAL_W_ESTIMATOR =
  <actual function used by next-request context-budget
   logic at the chosen seam>
```

If that turns out to be `estimateRequestInputTokens`, great. If
not, the ACT must follow the real authority rather than adapting
reality to the plan. Do NOT begin the test with any function name
hard-coded merely because it already exists.

### NEGATIVE_CONTROL_PROVIDER_USAGE (mandatory Phase 1 control)

The most valuable control is:

```text
provider usage buckets change
while canonical request content is identical
→ W MUST NOT change
```

Example synthetic variation:

```text
cacheReads
cacheWrites
tokensIn
```

while keeping system prompt / messages / tools identical.
Expected: `W1 == W2`. This mechanically proves this ACT has not
reintroduced provider-accounting dependence. More valuable than
yet another prose invariant.

### LIVE_264_3K_USAGE

Do NOT use the live `264.3k` as a target. The screenshot is
evidence of the UX defect, not an oracle for W. `W_after` is
required to differ from `H_a`; the test should derive W from the
canonical request estimator, not embed a live screenshot number.

## Don't touch the header yet

Until W authority is actually bound and RED, the UI consumer stays
unchanged:

```text
TaskHeader / ContextWindow = NO CHANGE
```

The first production delta should ideally establish W at one
producer / projection seam. Then the smallest second delta switches
the bar numerator from P to W. That separation gives clean
causality:

```text
commit 1:
  authoritative W exists

commit 2:
  header consumes W
```

with executable evidence after each. That is faster to debug than
combining producer semantics and UI consumption in one patch.

## GREEN (commit 1 + commit 2 separated)

```text
commit 1 (producer / projection seam):
  W_before, W_after available at the producer seam
  TaskHeader / ContextWindow   = NO CHANGE
  invariant: header still reads P

commit 2 (consumer switch):
  TaskHeader / ContextWindow   = consumes W
  invariant: header == authoritative W
              (NOT header == H_a)

W_after need not equal H_a  (negative assertion preserved)
```

## Conservation invariants (mandatory for this ACT)

```text
lastProviderRequestInput P   remains 364.9k
compaction H values         remain untouched
cumulative usage            unchanged
provider billing metrics    unchanged
H_a_TO_W_EQUIVALENCE_BY_ASSUMPTION = FORBIDDEN
H_a_TO_W_EQUIVALENCE               = UNPROVEN
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

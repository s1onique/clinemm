# ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01

> Status: **OPEN / RECON_ONLY / BOUNDED_RECON_LANE_AUTHORIZED /
> NO_PRODUCTION_CODE_CHANGE / NO_PROTOCOL_CHANGE_PRESUPPOSED**.
>
> Verdict target: bind the semantic contract of the TaskHeader
> context bar at the REAL render seam immediately after a
> compaction completes and before the next provider request.
>
> Upstream: factory causal reviewer's PASS_WITH_ONE_P1_FIX
> disposition (2026-09-02 18:30:00Z) on commit `9f994b135`
> (`ACT-CLINEMM-COMPACTION-PRESENTATION-FRESHNESS-EMPIRICAL01`).
> Reviewer chose **option α** (narrow header-bar recon) over
> option β (wire-contract `kind` discriminator).
>
> ACT ID: `ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01`
> Owned by epic:
> `EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING`
> (see `.factory/epics/context-compaction-token-accounting.md`)
> Evidence dir:
> `.factory/evidence/ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01/`
> Entry head:
> `9f994b135` (post-empirical HEAD; carries the prior recon's
> repair commit `cb5b52239` and all load-bearing CSR / THCP11
> / getApiMetrics test files).
> Predecessor ACT:
> `ACT-CLINEMM-COMPACTION-PRESENTATION-FRESHNESS-EMPIRICAL01`
> (sanity-check + sanity P1 calibration landed at commit
> `9f994b135`; verdict: EMPIRICAL_REPORT = PASS).
> Downstream ladder (NOT pre-decided): the recon's contract
> verdict decides whether any repair ACT is authorized and
> which option class it must choose.
> Reviewer disposition:
> PASS_WITH_ONE_P1_FIX on the predecessor empirical report;
> P1 carried into this recon — see §4 P1 CALIBRATION.
> WIRE_KIND_CHANGE = NOT_AUTHORIZED_YET (option β deferred
> until recon proves C3 is the intended semantic contract).

## §0 — Frozen conservation (no drift from the prior recon)

The §0 frozen contract from
`ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` is
preserved unchanged:

```text
DEFECT_A_CROSS_SCALE_RATIO_TRANSFER = CLOSED at cb5b52239
DEFECT_B_POST_COMPACTION_PUBLICATION = CLOSED at HEAD
```

And the §0 truth domains + invariants I1-I7 (separated
truth domains, NEVER made additive) are unchanged. This
recon MUST NOT touch the H-space producer, the P-space
consumer, or the compactor entry points.

The empirical-report predecessor (commit `9f994b135`)
documented:

```text
bun:test getApiMetrics.test.ts               24 pass /  0 fail
node v26 vitest restore-publication.test.ts  10 pass /  0 fail
node v26 vitest thcp11.test.ts                 6 pass /  0 fail
bun:test post-compaction-bar.freshness.test.ts  2 pass /  0 fail
  (behaviour witness — NOT a Factory RED; see §4 P1)
```

The empirical P1 carried forward to this recon:

```text
DEFECT_C_BEHAVIOR_WITNESS =
  SYNTHETIC_REAL-ish / consumer-level (getLastApiReqContextInputTokens)
  2/2 PASS at HEAD

FULL_UI_PRODUCTION_SEAM_REPRODUCTION =
  NOT YET
  (does not exercise the actual
   ChatView → ContextWindow/TaskHeader render chain)

P1 = the 2/2 test is a current-behaviour witness,
     NOT a true RED / full UI-seam reproduction
```

Per Factory doctrine "real/live failure → RED reproduction →
repair", this recon MUST author the actual RED only after
the semantic contract is frozen; the predecessor's 2/2
witness is the launching pad, not the oracle.

## §1 — The narrowed question

Defect C is not a token-accounting defect. The two
quantities in play are both truthful in their own domains:

```text
Divider row (apps/vscode/webview-ui/src/components/chat/
  CompactionRow.tsx, fed by ClineCompactionInfo.tokensBefore/
  tokensAfter parsed at apps/vscode/src/sdk/message-translator.ts:1218-1241
  → H-space, compactor estimator scale):
    "Context compacted (manual) · 364.9k → 264.3k tokens"

Header bar (apps/vscode/webview-ui/src/components/chat/
  ContextWindow.tsx, fed by getLastApiReqContextInputTokens
  at apps/vscode/src/shared/getApiMetrics.ts:163-186
  → P-space, disjoint-bucket sum of last api_req_started):
    364.9k

The header bar stays at 364.9k (pre-compaction P-space) for
the entire interval after compaction completes and before
the next api_req_started arrives.
```

The narrowed question is: **what does the header bar
represent immediately after compaction completes and before
the next provider request?**

There are at least three legitimate contracts. The recon
MUST classify which one the product intends and what the
UI must do to honour it:

```text
H_a_TO_W_e_EQUIVALENCE = UNBOUND
  (the previous Factory correction rejected cross-domain
   promotion based on plausible arithmetic; the
   COMPACTION_AFTER_TOKENS H-space value (H_a) is NOT
   proven equivalent to WORKING_CONTEXT_ESTIMATE (W_e)
   simply because they happen to coincide numerically
   in one specimen (264.3k). C2 cannot consume H_a as
   a substitute for W_e unless an executable or
   structural proof establishes the equivalence at the
   post-compaction boundary.)

NEW_WIRE_KIND = UNBOUND
  (a `kind` discriminator is only one possible C3
   implementation; the existing `compaction` say message
   already has a distinct message type plus
   tokensBefore/tokensAfter fields, so the consumer may
   already mechanically distinguish H-space from P-space.
   NEED_FOR_NEW_DISCRIMINATOR = NOT PROVEN.)

C1 — PROVIDER-OBSERVATION BAR
       numerator = last REQUEST_INPUT_TOKENS (P-space)
       after compaction but before next api_req_started,
       P remains old-but-truthful
       defect = wording / expectation only
       fix = presentation (label / title / divider
             semantics), NOT data flow

C2 — CURRENT-WORKING-CONTEXT BAR
       numerator = authoritative WORKING_CONTEXT_ESTIMATE
                   (W-space)
       after compaction, must update IMMEDIATELY from a
       W-space authority
       H_a (tokensAfter) may be a candidate proxy, but
       equivalence H_a ≡ W_e MUST be proven
       (otherwise C2 is exactly the cross-domain promotion
        error the previous Factory correction removed)
       → fix is a UI-side projection that obtains W_e
         from a true W-space authority; if no such
         authority exists at HEAD, C2 is UNACHIEVABLE
         without producer-side work and the recon must
         report that

C3 — MULTI-SOURCE PRESENTATION
       UI intentionally exposes BOTH:
         last provider observation P
         current estimate W / H
       sources require explicit semantic labels /
       discriminators
       wire change is required ONLY IF the existing
       payload cannot represent the distinction (e.g.
       the current `compaction` message shape can or
       cannot carry the semantic labels the UI needs)
       → wire-contract ACT is the right move ONLY when
         Q2-Q4 prove the existing message shape is
         insufficient
```

The recon MUST classify which contract holds BEFORE
any repair opens. The pre-existing category error
treating `H_a == W_e` must not re-enter the
investigation through the C2 back door.

## §2 — Q1-Q5 reconnaissance questions

Q1 — **What does the header label claim?**
     Map every literal text and `title=` attribute on the
     bar (and on its hover-card tooltip) to the producer
     that supplies the value it labels. The bar lives at
     `apps/vscode/webview-ui/src/components/chat/task-header/
     ContextWindow.tsx:175-210`; the tooltip is
     `ContextWindowSummary.tsx`. Capture each
     label-as-displayed and each label-as-promise.

Q2 — **What exact quantity does ChatView feed it?**
     Trace every `useMemo` and `useCallback` in
     `apps/vscode/webview-ui/src/components/chat/ChatView.tsx`
     that participates in the bar's number, the bar's
     percentage, and the bar's tooltip breakdown. Pin
     the producer chain through `TaskSection.tsx` →
     `TaskHeader.tsx` → `ContextWindow.tsx`. The bar's
     number currently comes from
     `getLastApiReqContextInputTokens(modifiedMessages)`
     at `ChatView.tsx:120-123`.

Q3 — **Is that quantity P-space, W-space, or
     presentation-derived?**
     Tag each value in the bar with its truth domain
     per the §0 contract (`REQUEST_INPUT_TOKENS`,
     `SESSION_CUMULATIVE_USAGE`,
     `WORKING_CONTEXT_ESTIMATE`,
     `COMPACTION_BEFORE_TOKENS`,
     `COMPACTION_AFTER_TOKENS`, `MODEL_INPUT_BUDGET`,
     `CONTEXT_UTILIZATION`). The current bar number is
     `REQUEST_INPUT_TOKENS` (P-space, last
     `api_req_started`'s disjoint-bucket sum). The
     divider's before/after pair is
     `COMPACTION_BEFORE_TOKENS` /
     `COMPACTION_AFTER_TOKENS` (H-space, compactor
     estimator scale).

Q4 — **What is available immediately after compaction?**
     Enumerate the projected candidates that the webview
     COULD feed to the bar, given the published state at
     the post-restore publication boundary. The list
     MUST be honest about what is *published* vs what is
     *arithmetically possible* — being numerically equal
     does NOT make two candidates equivalent.

```text
  P   = last provider observation        (e.g. 364.9k;
                                            P-space; truthful)
  W_e = working-context estimate          (??? at HEAD —
                                            is there an
                                            authoritative
                                            W-space number
                                            published at the
                                            post-compaction
                                            seam? If not, C2
                                            is UNACHIEVABLE)
  H_b = compactor's before-tokens          (matches P at trigger
                                            boundary in auto mode,
                                            may differ in manual;
                                            H-space)
  H_a = compactor's after-tokens           (e.g. 264.3k;
                                            H-space,
                                            COMPACTION_AFTER_TOKENS)

  Equivalence:
    H_a == 264.3k in this specimen
    W_e == ??? (unproven)
    H_a ≡ W_e = UNBOUND
    (the previous Factory correction rejected cross-
     domain promotion based on plausible arithmetic;
     C2 may not consume H_a as W_e without
     executable/structural proof)

  Cu  = cumulative session usage           (NOT a context-bar
                                            candidate; sum of
                                            tokensIn + tokensOut
                                            + cacheWrites +
                                            cacheReads across all
                                            api_req_started +
                                            subagent_usage +
                                            deleted_api_reqs)
  M_b = model input budget                 (the denominator;
                                            unchanged by a
                                            successful compaction)
  Ct  = context-window utilization         (numerator / M_b;
                                            a derived view of
                                            whatever numerator the
                                            contract picks)
```

The reviewer directive that nails this:

> The key question is now even narrower: **does that
> bar promise "the last provider-observed request
> size," or "the context we would send if you made
> the next request right now"?** Until that is answered,
> `264.3k` is not automatically the correct bar value.

Q5 — **Is 364.9k wrong, stale, or merely mislabelled?**
     The decisive question. The empirical test demonstrates
     that the bar returns 364.9k after compaction. Per the
     §0 contract this is correct P-space; per the user's
     reasonable read of the header label it is "stale".
     The recon MUST classify which read is correct by
     freezing the intended semantic contract.

## §3 — Adversarial likely-decisive matrix

Drive the real webview projection with the snapshot pair
the factory causal reviewer authored, and let the matrix
surface the only contracts that justify a UI change:

```text
BEFORE compaction:
  latest provider input   P    = 364.9k   (P-space,
                                           last
                                           api_req_started)
  working context estimate W_e  = ???      (no authoritative
                                           W-space number
                                           is published at
                                           this seam at HEAD)
  compactor after-tokens  H_a  = ???      (no compaction yet)
  header bar projection   bar  = ???
                          (frozen semantic contract decides)

AFTER compaction completes, BEFORE next api_req_started:
  latest provider input   P    = 364.9k   (P-space,
                                           unchanged; no new
                                           api_req_started yet)
  working context estimate W_e  = ???      (does an authoritative
                                           W-space number exist at
                                           this seam? If not,
                                           C2 is UNACHIEVABLE)
  compactor after-tokens  H_a  = 264.3k   (H-space,
                                           COMPACTION_AFTER_TOKENS)
  header bar projection   bar  = ???
                          (frozen semantic contract decides)

Equivalence frozen at the ACT level:
  H_a_TO_W_e_EQUIVALENCE = UNBOUND
  (the fact that H_a == 264.3k in this specimen does NOT
   prove H_a ≡ W_e. The previous Factory correction rejected
   cross-domain promotion based on plausible arithmetic;
   the recon must NOT pre-establish the substitution.)

NEW_WIRE_KIND = UNBOUND
  (the existing `compaction` say message already has a
   distinct message type plus tokensBefore/tokensAfter
   fields; whether a new discriminator is required is
   itself a question the recon must answer, not an
   assumption.)
```

Three admissible contracts and what each would render
(the matrix assumes `W_e = ???` is an honest unknown at
the post-compaction seam until Q4 proves otherwise):

```text
Contract   bar BEFORE       bar AFTER          compatibility
C1         P   = 364.9k     P   = 364.9k      ✓ truthful P;
                                                       label fix only
C2         W_e = 364.9k     W_e = ???          ✗ requires an
              (assumed            (UNKNOWN         authoritative
               equal at P          unless          W-space authority
               trigger             proven)         at the seam; if
                                                       none exists at
                                                       HEAD, C2 is
                                                       UNACHIEVABLE
                                                       without
                                                       producer work
C3         multi-source:    multi-source:      ✗ wire change
           (P, label          (P unchanged,         ONLY if the
            "last request",   label "last          existing
            plus W/H row)     request", plus       payload cannot
                            W/H row with           carry the
                            semantic labels)      required labels
```

If the recon proves C1 is the intended contract, the
defect is purely presentation; the fix is a label /
divider semantics change at the UI layer. The recon does
NOT need to author a wire-contract ACT.

If the recon proves C2 is the intended contract, the
fix is a UI-side projection that obtains W_e from a
true W-space authority. The recon MUST verify whether
such an authority exists at HEAD at the post-compaction
seam; if not, C2 is **UNACHIEVABLE without producer-
side work** and the recon must report that explicitly.
The recon MUST NOT inherit H_a as a substitute for W_e
just because both happen to be 264.3k in this specimen.

If the recon proves C3 is the intended contract, the
fix is the wire-contract ACT (option β from the
empirical report). The recon's job is to surface C3
explicitly AND to verify whether the existing
`compaction` message shape already carries enough
information for the UI to render the multi-source
labels — if it does, a `kind` discriminator may be
redundant and the wire change collapses to nothing.

The recon MUST NOT pre-decide which contract holds. It
MUST walk the production render chain (Q2) and either
(a) find the existing comment / doc / title text that
makes one contract explicit (and report it), or (b)
confirm the product has not made a contract decision
in the current code (and report that absence as the
finding).

## §4 — P1 CALIBRATION (carried from predecessor)

The empirical test at
`apps/vscode/src/shared/__tests__/post-compaction-bar.freshness.test.ts`
(temporary; was created and removed during the empirical
turn — see commit `9f994b135`) is:

```ts
const messages = [
  { say: "api_req_started",
    text: JSON.stringify({ tokensIn: 364_900, cacheReads: 0 }) },
  { say: "compaction",
    text: JSON.stringify({
      status: "completed", mode: "manual",
      tokensBefore: 364_900, tokensAfter: 264_300 }) },
]
assert.equal(getLastApiReqContextInputTokens(messages), 364_900)
// passes (GREEN) at HEAD — but the user-perceived behaviour
// is that the bar disagrees with the divider.
```

This is a **current-behaviour witness**, NOT a Factory
RED. It exercises the shared metrics consumer only; it
does NOT exercise the actual
`ChatView → ContextWindow/TaskHeader` render chain.

This recon MUST NOT inherit this witness as its RED. The
witness is correct in the narrow sense (it asserts the
P-space value), but the question is whether that P-space
value is the right thing to display, and that question
cannot be answered by a metric-consumer test.

Recon-classification:

```text
DEFECT_C_BEHAVIOR_WITNESS =
  SYNTHETIC_REAL-ish / consumer-level
  2/2 PASS at HEAD

FULL_UI_PRODUCTION_SEAM_REPRODUCTION =
  NOT YET
  (the recon's deliverable is to author it, once the
   semantic contract is frozen)
```

If the recon's contract verdict is C2 or C3, the RED
must exercise the actual render chain (the webview's
`modifiedMessages` useMemo + the
`tokenData.used` projection in
`ContextWindow.tsx:128-133`) with the post-compaction
messages, and the assertion's expected value comes from
the frozen contract — NOT from "the bar should be
264.3k" (which presumes C2 without evidence).

Per the reviewer's directive:

> Do **not** write `expect(bar).toBe(264300)` until the
> bar is actually proven to represent working context.
> That is exactly how we avoid repeating the earlier
> accounting-domain mistake.

### P1.b — Full DOM render is NOT required

The factory causal reviewer notes:

> If Q1/Q2 show
> ```text
> ChatView: tokenData.used =
>   getLastApiReqContextInputTokens(modifiedMessages)
> ContextWindow: renders tokenData.used
> ```
> then a small extracted projection test at that real
> pure seam may be sufficient. Do not build a
> heavyweight React harness merely because the ACT
> says "full UI production seam."

Freeze:

```text
FULL_UI_DOM_RENDER = OPTIONAL
```

The required evidence is:

```text
actual production projection logic
  +
actual displayed label semantics
```

— NOT necessarily DOM rendering. The recon MUST classify
the seam shape from Q2; if the projection is a pure
function call (no React context), an extracted unit
test of that function with the post-compaction message
fixture is the right evidence, and a heavyweight React
harness is over-engineering. A DOM render harness is
required ONLY IF render-specific behaviour (CSS
percentage, tooltip positioning, conditional rendering
branches) is causal to the contract decision.

## §5 — Entry-freeze / operational action

1. Run Q1-Q5 against the source tree at HEAD `9f994b135`
   (post-empirical HEAD; carries the prior repair).
2. Produce the evidence directory
   `.factory/evidence/ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01/`
   with **one compact evidence file** (not seven):

```text
.factory/evidence/ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01/
  entry-freeze.txt
  semantic-contract.md   ← ONE file, not seven; contains:
    § Q1 header label claim
    § Q2 source chain (render-chain trace)
    § Q3 truth-domain tagging
    § Q4 available authorities
    § Q5 contract verdict (C1 / C2 / C3)
    § decisive-matrix (filled in)
    § downstream recommendation (C1 / C2 / C3 → bounded
      ACT id, OR HALT_NO_INTENT_FROZEN)
```

The factory causal reviewer specifically notes:

> 491 lines plus a plan for seven evidence files for a
> five-question semantic investigation is exactly the
> kind of Factory overhead we've been trying to remove.
> Execute the recon into **one compact evidence file**,
> not seven.

3. The recon's C1/C2/C3 verdict is a single short
   verdict inside `semantic-contract.md`. The reviewer
   disposition decides whether a downstream repair ACT
   opens, and which option class it must pick.
4. **DO NOT** open a wire-contract ACT (`kind`
   discriminator) from this ACT without reviewer
   authorization. NEW_WIRE_KIND = UNBOUND.
   NEED_FOR_NEW_DISCRIMINATOR = NOT PROVEN.
5. **DO NOT** open a presentation-only repair (label
   fix at the UI layer) without reviewer authorization
   and a frozen C1 verdict.
6. **DO NOT** treat `H_a == W_e` as a proven
   equivalence anywhere in the recon's evidence. The
   recon MUST mark `H_a_TO_W_e_EQUIVALENCE = UNBOUND`
   in `semantic-contract.md` and prove or disprove it
   from production code (not from arithmetic).

## §6 — Acceptance criteria

- ACT body committed with `OPEN / RECON_ONLY` status.
- Entry-freeze committed.
- **One** compact `semantic-contract.md` committed (not
  seven evidence files).
- Decisive matrix in that file filled in with the
  C1/C2/C3 verdict.
- `semantic-contract.md` names the chain-of-trust for
  the verdict and a single short recommendation (one
  of: HALT_NO_INTENT_FROZEN / C1 → bounded label ACT /
  C2 → bounded projection ACT / C3 → bounded wire-
  contract ACT). The recommendation is NOT pre-decided.
- `bun run check-types` clean on `apps/vscode`.
- `bun run test:vitest` clean on the `src/sdk/**` and
  `src/shared/**` scopes (the suites that pin defect A
  closure).
- `bun test src/shared/__tests__/getApiMetrics.test.ts`
  continues to be 24/24 GREEN.
- No production code change.
- No PR; this ACT is recon-only and the closure path
  is the verdict, not a code merge.

## §7 — Stop rules + downstream repair ladder

Stop the recon and re-evaluate the disposition when
any of:

- The C1/C2/C3 verdict is confidently established
  from production-chain evidence (a real comment,
  doc, or test pin), and a bounded repair ACT is
  ready to be opened (next ACT, separate file,
  separate review round). The recon CLOSES here.
- The verdict is ambiguous and the production chain
  does not establish an intent. The recon CLOSES with
  `HALT_NO_INTENT_FROZEN` and a future product-decision
  ACT is the next move (not a Factory repair).
- `H_a_TO_W_e_EQUIVALENCE` is the load-bearing
  question. If Q4 finds no authoritative W-space
  source at the post-compaction seam, C2 is
  UNACHIEVABLE without producer-side work and the
  recon CLOSES with `HALT_C2_REQUIRES_PRODUCER_WORK`
  (and the ladder below skips the C2 rung).
- `NEED_FOR_NEW_DISCRIMINATOR` is similarly load-
  bearing for C3. If Q2-Q4 find the existing
  `compaction` message shape already distinguishes
  P from H/W with sufficient label information,
  C3 collapses to a label-only fix and the wire
  rung drops out.
- Threshold-failure behaviour discovered (e.g. the
  percentage projection at `ContextWindow.tsx:128-133`
  divides by zero in some configuration). Reported as
  a finding; future repair ACTs may target the
  behaviour; the recon does NOT pre-decide.

Downstream repair ACT ladder (NOT pre-decided; only
authored after the recon's verdict):

```text
verdict = C1 → ACT-CLINEMM-COMPACTION-HEADER-LABEL-REPAIR01
              (label / title / divider semantics;
               UI-layer only; no data-flow change;
               H_a_TO_W_e_EQUIVALENCE remains UNBOUND
               — the C1 contract explicitly does NOT
               consume H_a as a W_e substitute)

verdict = C2 → ACT-CLINEMM-COMPACTION-HEADER-PROJECTION-REPAIR01
              (webview seam; obtain W_e from a true
               W-space authority at the post-compaction
               seam; C2 is UNACHIEVABLE without such an
               authority, in which case escalate to a
               producer-side ACT — not C3, not C2-on-
               H_a-as-proxy)

verdict = C3 → ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01
              (multi-source presentation; wire change
               is required ONLY IF the existing
               `compaction` message shape cannot carry
               the semantic labels C3 needs — otherwise
               C3 collapses to a label-only fix and the
               wire rung drops out)
```

Whichever ladder rung is opened, `semantic-contract.md`
is the durable record of WHY the contract was chosen;
the next ACT MUST cite it. The next ACT MUST also
re-state `H_a_TO_W_e_EQUIVALENCE` and
`NEED_FOR_NEW_DISCRIMINATOR` and either prove them
(producer-side work, wire-contract work) or carry them
forward as UNBOUND with explicit rationale.

## §8 — Disposition

```text
EMPIRICAL_REPORT         = PASS (predecessor ACT closed)
DEFECT_A                  = CLOSED at cb5b52239
DEFECT_B                  = CLOSED at HEAD
DEFECT_C                  = LIVE / consumer-level behaviour
                             reproduced (NOT yet full
                             UI-seam RED — see §4 P1 +
                             §4 P1.b DOM render optional)
PRODUCTION_CODE_CHANGE    = NONE (recon-only)
WIRE_KIND_CHANGE          = NEW_WIRE_KIND = UNBOUND
                             (NEED_FOR_NEW_DISCRIMINATOR
                             = NOT PROVEN)
H_a_TO_W_e_EQUIVALENCE    = UNBOUND
                             (the previous Factory
                             correction rejected cross-
                             domain promotion based on
                             plausible arithmetic; C2
                             may not consume H_a as W_e
                             without executable/structural
                             proof)
C2_UNACHIEVABILITY_GUARD  = C2 is UNACHIEVABLE without
                             producer-side work if Q4
                             finds no authoritative W-space
                             source at the post-compaction
                             seam
FULL_UI_DOM_RENDER        = OPTIONAL
                             (extracted projection test
                             is sufficient if Q1/Q2 show
                             a pure-seam projection)
NEXT_ACT                  = this ACT
PRIMARY_QUESTION          = does the bar promise "last
                             provider-observed request
                             size" (C1) or "current context
                             we would send if you made the
                             next request right now" (C2)
                             or both with explicit labels
                             (C3)? Until answered, 264.3k
                             is NOT automatically the
                             correct bar value
C1: GO_HEADER_BAR_RECON
```
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
C1 — bar = last provider-observed request input
       364.9k is truthful (post-repair Strategy-D)
       problem is label/UX ambiguity only
       → fix is presentation (label / title / divider
         semantics), NOT data flow

C2 — bar = best estimate of CURRENT WORKING CONTEXT
       364.9k is stale
       UI must consume a working-context estimate (W-space)
       → fix is projection: feed the bar from the
         divider's tokensAfter (with an explicit kind
         discriminator) OR from a separate
         current-working-context field

C3 — bar intentionally changes semantic source after
     compaction
       requires an explicit source/kind discriminator at
       the producer seam so the consumer can mechanically
       distinguish H-space divider value from P-space
       provider observation
       → wire-contract fix (the original option β the
         empirical report deferred)
```

Only **C3** justifies the wire-contract ACT. Until the
recon proves C3 is the intended semantic contract, the
wire-contract ACT is NOT authorized.

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
     the post-restore publication boundary:

```text
  P   = last provider observation        (e.g. 364.9k)
  W_e = working-context estimate          (could be ~264.3k
                                            if the next request
                                            were prepared now)
  H_b = compactor's before-tokens          (matches P at trigger
                                            boundary in auto mode,
                                            may differ in manual)
  H_a = compactor's after-tokens           (e.g. 264.3k)
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
  latest provider input   P   = 364.9k   (P-space)
  working context estimate W_e = 364.9k   (matches P at
                                          trigger boundary)
  compaction row           —    = (none)
  header bar projection   bar  = ???
                          (frozen semantic contract decides)

AFTER compaction:
  latest provider input   P   = 364.9k   (unchanged; no new
                                          request yet)
  working context estimate W_e = 264.3k   (next request would
                                          see the post-compaction
                                          canonical)
  compaction row           —    = 364.9k → 264.3k  (H-space)
  header bar projection   bar  = ???
                          (frozen semantic contract decides)
```

Three admissible contracts and what each would render:

```text
Contract   bar BEFORE          bar AFTER           compatibility
C1         P   = 364.9k        P   = 364.9k        ✓ truthful P;
                                                           label fix only
C2         W_e = 364.9k        W_e = 264.3k        ✗ requires projection
                                                           (consumer reads
                                                            divider value)
C3         kind-aware:         kind-aware:         ✗ requires wire
           P=364.9k            P=364.9k                change (kind
                                  (P unchanged)         discriminator)
           (bar shows P        (bar shows P
            and labels it      and labels it
            "last request")    "last request")
           divider shows       divider shows
            364.9k → 264.3k     364.9k → 264.3k
           (additional         (additional
            context row)        context row)
```

If the recon proves C1 is the intended contract, the
defect is purely presentation; the fix is a label /
divider semantics change at the UI layer. The recon does
NOT need to author a wire-contract ACT.

If the recon proves C2 is the intended contract, the
fix is a projection: the bar must consume a
working-context estimate after compaction. The wire is
already capable of carrying the divider's `tokensAfter`;
what's missing is the consumer logic at the webview
seam to switch from `P` to `W_e` after a successful
compaction. No protocol change is required if the
existing `compaction` say message's `tokensAfter` is
treated as the working-context estimate's authoritative
post-compaction value — but only if the §0 contract
allows `COMPACTION_AFTER_TOKENS` and
`WORKING_CONTEXT_ESTIMATE` to share a single wire field.
The recon MUST investigate whether that sharing is
safe (they are both H-space in the current producer;
see Q3).

If the recon proves C3 is the intended contract, the
fix is the wire-contract ACT (option β from the
empirical report). The recon's job is to surface C3
explicitly; the implementation is a downstream ACT.

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

## §5 — Entry-freeze / operational action

1. Run Q1-Q5 against the source tree at HEAD `9f994b135`
   (post-empirical HEAD; carries the prior repair).
2. Produce the evidence directory
   `.factory/evidence/ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01/`
   with:
   - `entry-freeze.txt` (HEAD freeze + production delta
     = zero + review-round = NO)
   - `q1-header-label-claim.md` (Q1: every literal text +
     title attribute on the bar and its tooltip, with
     the producer that supplies the value it labels)
   - `q2-quantity-feed.md` (Q2: producer chain trace)
   - `q3-truth-domain-tagging.md` (Q3: §0 tag per value)
   - `q4-available-quantities.md` (Q4: P / W_e / H_b /
     H_a / Cu / M_b / Ct enumeration at the post-restore
     publication boundary)
   - `q5-contract-verdict.md` (Q5: C1 / C2 / C3
     classification with evidence)
   - `decisive-matrix.md` (the matrix from §3 with the
     chosen contract filled in)
   - `final-report.md` (compact summary + recommendation)
3. Per the Factory causal reviewer's
   third-review PASS_WITH_ONE_P1_FIX directive: do NOT
   author another 400 lines of Factory scaffolding before
   the decisive matrix is filled. The recon is short;
   the question is the deliverable, not the paperwork.
4. The recon's C1/C2/C3 verdict is a single short
   verdict in `q5-contract-verdict.md`. The reviewer
   disposition decides whether a downstream repair ACT
   opens, and which option class it must pick.
5. **DO NOT** open a wire-contract ACT (`kind`
   discriminator) from this ACT without reviewer
   authorization. WIRE_KIND_CHANGE = NOT_AUTHORIZED_YET.
6. **DO NOT** open a presentation-only repair (label
   fix at the UI layer) without reviewer authorization
   and a frozen C1 verdict.

## §6 — Acceptance criteria

- ACT body committed with `OPEN / RECON_ONLY` status.
- Entry-freeze committed.
- Q1-Q5 evidence committed (short and decisive; not a
  paperwork dump).
- Decisive matrix committed with the C1/C2/C3 verdict
  filled in.
- Final report names the verdict, the chain-of-trust
  for it, and a single short recommendation for the
  next ACT (one of: no repair / C1 presentation fix /
  C2 projection fix / C3 wire-contract fix). The
  recommendation is NOT pre-decided.
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
               UI-layer only; no data-flow change)

verdict = C2 → ACT-CLINEMM-COMPACTION-HEADER-PROJECTION-REPAIR01
              (webview seam; consume divider's tokensAfter
               as the bar's post-compaction numerator;
               gated on §0 contract compatibility between
               COMPACTION_AFTER_TOKENS and
               WORKING_CONTEXT_ESTIMATE — if incompatible,
               escalate to C3)

verdict = C3 → ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01
              (the originally-contemplated wire-contract
               ACT; adds a `kind` discriminator so the
               consumer can mechanically distinguish
               H-space divider value from P-space
               provider observation)
```

Whichever ladder rung is opened, the recon's evidence
dir is the durable record of WHY the contract was
chosen; the next ACT MUST cite it.

## §8 — Disposition

```text
EMPIRICAL_REPORT         = PASS (predecessor ACT closed)
DEFECT_A                  = CLOSED at cb5b52239
DEFECT_B                  = CLOSED at HEAD
DEFECT_C                  = LIVE / consumer-level behaviour
                             reproduced (NOT yet full
                             UI-seam RED — see §4 P1)
PRODUCTION_CODE_CHANGE    = NONE (recon-only)
WIRE_KIND_CHANGE          = NOT_AUTHORIZED_YET
NEXT_ACT                  = this ACT
PRIMARY_QUESTION          = what semantic quantity should
                             the header bar represent
                             immediately after compaction
                             and before next API request?
C1: GO_HEADER_BAR_RECON
```
# EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING

> **Token-accounting truth across the compaction boundary, expressed as separated truth domains.** The frozen contract (see `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` §0) is: each token quantity belongs to a SPECIFIC truth domain (`REQUEST_INPUT_TOKENS`, `REQUEST_OUTPUT_TOKENS`, `SESSION_CUMULATIVE_USAGE`, `WORKING_CONTEXT_ESTIMATE`, `COMPACTION_BEFORE_TOKENS`, `COMPACTION_AFTER_TOKENS`, `MODEL_INPUT_BUDGET`, `CONTEXT_UTILIZATION`). Domains are NOT additive. Invariants I1-I7 forbid additive arithmetic across the billing/context divide. The fresh production symptom (factory causal reviewer, 2026-09-01) is "obviously inconsistent compaction/context accounting"; this recon ACT opens the lane to characterize it.
>
> **R0-A (factory causal reviewer, 2026-09-02 first reordering):** post-compaction TaskHeader rescaling (`apps/vscode/src/shared/getApiMetrics.ts:174-225`) crosses two semantic baselines. The displayed header value is `lastRequestInput × (tokensAfter / tokensBefore)`. R0-A confirmed this arithmetic against the LIVE-symptom input (167.1k × 0.04249 ≈ 7.1k = 7_101). R0-B "three permitted quantities" oracle was HALT_RED_NOT_REPRODUCED (unfounded); R0-C doc-comment-vs-behavior was inconclusive. Both withdrawn.
>
> **R0' first pass (factory causal reviewer, 2026-09-02 SECOND REORDERING):** manual compaction's `apiMessages = canonical` at both entry points (`apps/cli/src/runtime/interactive/compaction.ts:99-100` and `apps/vscode/src/sdk/sdk-compaction.ts:101-102`) — PROVEN_STRUCTURAL asymmetry with the AUTO path (which uses `prepareProviderMessagesForApi`).
>
> **HALT_ROOT_CAUSE_NOT_ISOLATED (factory causal reviewer, 2026-09-02 SECOND REVIEW):** the previous turn's conclusion (manual compaction passes the wrong input) was an epistemic jump. The producer's contract is a TRANSFORMATION on the request object supplied to the compactor (`tokensBefore = estimate(systemPrompt + apiMessages + tools)`); the telemetry docstring (`sdk/packages/core/src/services/telemetry/core-events.ts:773`) establishes a UNIT/SCALE contract only, NOT a payload-identity contract. The manual entry points correctly supply canonical H per the explicit design intent ("intentionally summarizes the full canonical transcript"); they are NOT the defect. The UI consumer (`ContextWindow.tsx:175` "Current tokens used in this request") implicitly assumes the transformation result tracks the active provider context. The semantic content of the request is determined by the caller (manual passes canonical H; auto passes provider-projected W); the producer makes no semantic claim.
>
> **PASS_WITH_ONE_P1_FIX (factory causal reviewer, 2026-09-02 SECOND REVIEW — CALIBRATION):** two P1 overclaims corrected: (a) "S1 proven by telemetry docstring" was overclaimed — the docstring establishes unit/scale only, not payload-identity; (b) "S3 = CURRENT_BEST_CLASSIFICATION / ROOT_CAUSE_ISOLATED = AMBIGUOUS_WIRE_CONTRACT" was overclaimed — S3 is PLAUSIBLE but UNPROVEN; ROOT_CAUSE remains UNKNOWN until the ratio discriminator runs. Repair options NOT pre-ranked; Factory doctrine prefers the smallest bounded fix until evidence proves the wire itself needs new semantics.
>
> **R0' semantic-contract recon (CALIBRATED 2026-09-02 second-review PASS_WITH_ONE_P1_FIX; third-review DISCRIMINATOR CALIBRATION 2026-09-02T03:30:00Z; fourth-review WORKING-CONTEXT-SEAM CALIBRATION 2026-09-02T04:00:00Z; FACTORY FORM REVIEW HARDENING 2026-09-02T06:30:00Z):** the producer is a transformation on the supplied request (no semantic claim); the UI consumer applies a ratio whose transfer to the provider-context shrink for manual mode is exactly the discriminator's question. Defect (if any) is AMBIGUOUS_WIRE_CONTRACT (CASE_S3, candidate) or SEMANTIC_LABEL (CASE_S1) — pending the ratio discriminator. The defect (if confirmed) is in the schema/wire or the UI label, NOT in the compactor entry points. The PRIMARY discriminator: does `manual_ratio = H_after/H_before` track `working_context_ratio = W_after/W_before`, where W is bound to the REAL production turn-preparation seam (NOT `prepareProviderMessagesForApi`, which is a second-stage transformation that does NOT consult the compaction artifact; canonical history is intentionally append-only/full-fidelity per `sdk/ARCHITECTURE.md:497`). Specifically, the seam is `createCompactionStateAwarePrepareTurn` at `sdk/packages/core/src/extensions/context/compaction.ts:672-712`, driving `projectSessionCompactionState` at `sdk/packages/core/src/session/models/session-compaction.ts:161-193` twice against identical canonical state with exactly one manual compaction applied between captures. P observations (`P_after/P_before`) are NOT a valid causal compaction oracle (intervening turns between compaction and next provider request contaminate the comparison); P observations become LIVE_PROVIDER_QUALIFICATION (conservation check only). C1 GO is NOT yet granted; buildForApi compaction-independence must be confirmed before execution. **DISCRIMINATOR EXECUTED + HARDENED 2026-09-02T05:30:00Z + 06:30:00Z:** cross-scale ratio-transfer mismatch REPRODUCED (case 2 realistic, 66.6% relative divergence). `WIRE_CONTRACT_OVERLOADED` demoted to POSSIBLE REPAIR INTERPRETATION (NOT uniquely proven root cause) per the Factory form review; `LIKELY_CAUSE = CROSS_SCALE_RATIO_TRANSFER_ASSUMPTION`; `ROOT_CAUSE = NOT_YET_PROMOTED`; `BROKEN_CONSUMER_SEAM = getApiMetrics.ts:174-225`. RED witness captured mechanically (`expected 0.666... <= 0.10`) and stored in `red-witness.txt`. Committed test file inverts the invariant (`relativeDiff > 0.10`) so default suite is GREEN at HEAD — would RED if defect ever disappears. Reachability mechanically established; prevalence in production telemetry remains DEFERRED per R1-R3 HALT. **2026-09-02 09:00:00Z EMPIRICAL UPDATE:** `ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01` landed at commit `cb5b52239` (Strategy-D applied: cross-scale ratio transfer removed from `getApiMetrics.ts:174-225`; both `getLastApiReqTotalTokens` and `getLastApiReqContextInputTokens` now return genuine disjoint-bucket sums); G2 RED-confirmed at pre-repair HEAD, G3/G4/G5 added; 24/24 getApiMetrics bun:test pass, 97/97 compaction + working-context-ratio tests pass (G1 stays GREEN), 53/53 apps/vscode/src/shared/__tests__/ pass; typecheck clean; ACT CLOSED. DEFECT A (cross-scale arithmetic) is CLOSED at HEAD. DEFECT B (post-restore publication) is also CLOSED at HEAD — `apps/vscode/src/sdk/sdk-compaction-coordinator.ts:365-396` trailing `postStateToWebview()` is unconditional on exit; CSR01-CSR08 + CSR_PROBE_success / CSR_PROBE_failure (10/10 GREEN under node v26 vitest) and THCP11-P1a..P1f (6/6 GREEN) pin the post-restore publication authority. Recommended first repair trial: (d) consumer-side reconciliation.
>
> **Distinct from `task-presentation.md`.** That epic owns the rendering of state to the user. This epic owns whether the working-context estimate, the compaction before/after markers, and the session usage counters tell consistent truth — and whether the producers expose semantic quantities that match what the UI fields appear to claim.
>
> **Distinct from `runtime-task-progression.md`.** That epic owns what happens after a tool finishes (does the agent continue, ask, or stall). This epic owns the **pre-turn arithmetic** that decides whether the next turn even gets sent.
>
> **Why now.** Per factory causal reviewer (2026-09-01): "Fresh LIVE symptom; may affect compaction threshold, context-limit safety and long-session behavior" — that outranks imported upstream radar (e.g. #12939 replace_in_file CPU, #12388 checkpoint run-identity) because it is ours, live, now.
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: DISCRIMINATOR EXECUTED + FORM-REVIEW HARDENED +
  REVIEWER-DISPOSITION PASS_WITH_ONE_P1_FIX + C1: GO. Recon ACT
  is **CLOSED_WITH_RESIDUE** (CASE_A — Cross-scale ratio-
  transfer mismatch REPRODUCED, LIKELY_CAUSE = CROSS_SCALE_RATIO_
  TRANSFER_ASSUMPTION, ROOT_CAUSE = NOT_YET_PROMOTED).
  Q0A-Q0C producer-binding DONE (commit 901287e15); R0-A witness
  test DONE (commit 2916fb9fd); R0' source-recon DONE (commit
  9083ecd56); R0' semantic-contract recon DONE & CALIBRATED;
  working-context-seam-recon DONE (commit be15a56a0); ratio
  discriminator EXECUTED + form-review HARDENED + REVIEWER
  DISPOSITION PASS_WITH_ONE_P1_FIX (commit 51beb1da4); reviewer's
  P1 wording fix applied to committed test (DEFECT-WITNESS
  renamed from RED:; comments rewritten to describe the
  assertion's actual GREEN-at-buggy-HEAD semantics). Discriminator
  result: case 1 (trivial canonical, no truncation engaged) →
  GREEN positive control (ratios bit-identical, S3_RATIO_TRANSFER_
  NOT_REPRODUCED); case 2 (realistic canonical, assistant text >
  200K cap) → DEFECT-WITNESS with 66.6% relative divergence
  (manualRatio 0.000210 vs workingContextRatio 0.000629; the
  committed test PASSES at HEAD because the defect IS
  reproducible, and would RED if defect ever disappears).
  Cross-scale ratio transfer is invalid for working contexts
  large enough to engage buildForApi's truncation budgets.
  BROKEN_CONSUMER_SEAM = `getApiMetrics.ts:174-225` (applies
  compactor H-space ratio to provider-input P-space tokensIn).
  UI_CONSUMER_MATH = INTERNALLY CONSISTENT GIVEN BAD ASSUMPTION.
  WIRE_CONTRACT_OVERLOADED = POSSIBLE REPAIR INTERPRETATION (NOT
  uniquely proven root cause). Reachability mechanically
  established (any canonical history large enough to engage
  buildForApi's 200K assistant-text cap); prevalence in
  production telemetry remains DEFERRED per R1-R3 HALT.
  Reviewer-disposition 2026-09-02 C1: GO to bounded consumer-
  side repair trial. **Downstream repair ACT =
  ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01**
  (REVIEWER-RETITLED from WIRE-CONTRACT-REPAIR01 since wire is
  NOT yet proven defective; OPENED 2026-09-02 06:30:00Z;
  P0-CORRECTED 2026-09-02 08:00:00Z per factory causal
  reviewer's HALT_WRONG_REPAIR_ORACLE — oracle moved from H/W
  seam to consumer seam; STRATEGY_D =
  SELECTED_FOR_IMPLEMENTATION; REPAIR_STATUS = NOT_YET_APPLIED;
  PRODUCTION_DELTA = ZERO at opening commit, APPLIED at the
  implementation commit; first trial = option (d) consumer-side
  reconciliation, no protocol change; options (a)/(b) escalate
  only if (d) cannot satisfy the G2-G6 necessity/ablation
  matrix with existing metadata; FROZEN CONTRACT =
  INCOMPATIBLE_BASELINE → no ratio transfer; NECESSITY CONTROL
  = committed DEFECT-WITNESS stays GREEN after repair;
  REPAIR ORACLE = G2 in getApiMetrics.test.ts at consumer seam).
  R1-R3 territory remains DEFERRED per the reviewer's HALT
  directive. CASE_B MANUAL_PROJECTION RETRACTED.
  ACT-CLINEMM-COMPACTION-INPUT-IDENTITY-REPAIR01 RETRACTED
  (manual entry points are NOT the defect).
- Priority: **P1** (HIGH value production learning; affects compaction threshold, context-limit safety, long-session behavior). May be promoted to P0 if the discriminator reproduces an actual structural defect.
- Current frontier: `ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01` (OPEN; consumer-side reconciliation trial = option (d); P0 HALT_WRONG_REPAIR_ORACLE resolved; P0 HALT_WRONG_RED_CLAIM refined; **NEXT TURN MUST AUTHOR G2 IN getApiMetrics.test.ts AND CONFIRM RED AT CURRENT HEAD BEFORE ANY PRODUCTION MODIFICATION** per Factory doctrine "real/live failure → RED reproduction → repair"). The recon ACT (`ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01`) is `CLOSED_WITH_RESIDUE` and the discriminator/working-context-seam binding is established; repair ACT is the live frontier.
- Blocked by: n/a (the recon's discriminator ran and resolved S3 in the affirmative at the consumer seam; the consumer-side reconciliation trial is authorized under the G1-G6 necessity/ablation matrix).
- Sequenced after this ACT (gated on the discriminator's verdict;
  C1 GO NOT yet granted; buildForApi compaction-independence
  must be confirmed first):
  - If discriminator shows ratio non-invariance (manual_ratio
    materially differs from working_context_ratio at the REAL
    production turn-preparation seam bound to
    createCompactionStateAwarePrepareTurn at
    compaction.ts:672-712) → `CASE_A` with `S3_PROVEN` residue →
    `CLOSED_WITH_RESIDUE`; `ROOT_CAUSE_ISOLATED` at the
    schema/wire; downstream repair ACT =
    `ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01` with
    **options (a) / (b) / (d)** as candidate bounded fixes
    (ranked after discriminator; Factory doctrine prefers smallest).
  - If discriminator shows ratio invariance →
    `S3_RATIO_TRANSFER_NOT_REPRODUCED`. S3 ratio-transfer
    hypothesis is FALSIFIED; this does NOT auto-prove
    S1-LABEL-ONLY. Other accounting defects may remain (R1-R3
    still deferred; UI title still claims S2). Proceed to remaining
    ACT stop conditions; presentation residue remains plausible.
    CLOSED_WITH_RESIDUE only after R1-R3 and remaining stop
    conditions are also evaluated. Downstream repair ACT (only
    after remaining stops) = `ACT-CLINEMM-COMPACTION-WIRE-
    CONTRACT-REPAIR01` with **option (e) label-only** as the
    bounded fix for the presentation residue — but R1-R3 territory
    may surface other accounting defects that need a different
    bounded fix.
  - If H or W cannot be captured deterministically around the
    same compaction event → `CAPTURE_INSUFFICIENT` / `CASE_C`.
  - If `CASE_B` (R1-R3 RED with structural defect, not yet probed) →
    bounded core-arithmetic repair ACT (R1-R3 are DEFERRED until
    the discriminator resolves the S3 question).
- `CASE_B.UI` / `CASE_B.HYBRID` / `CASE_B.MANUAL_PROJECTION` all RETIRED (R0-B oracle unfounded; previous-turn root-cause isolation on manual entry points was incorrect per the second-review HALT; the second-review PASS_WITH_ONE_P1_FIX flagged two overclaims that were calibrated in this commit).

## Contract / durable conclusions

The semantic-contract recon (CALIBRATED) establishes four durable
conclusions:

1. **PRODUCER_CONTRACT = TRANSFORMATION on supplied request.**
   `tokensBefore = estimate(systemPrompt + apiMessages + tools)`
   for the request object supplied to the compaction strategy. The
   telemetry docstring establishes a UNIT/SCALE contract only —
   same units as the trigger and limit — NOT a payload-identity
   contract. The semantic content of the request is determined by
   the caller (manual passes canonical H; auto passes
   provider-projected W). The producer makes no semantic claim.

2. **MANUAL_CALLER_INPUT = canonical full transcript H.** This is
   by explicit design intent ("intentionally summarizes the full
   canonical transcript", apps/cli/src/runtime/interactive/
   compaction.ts:86-88). The two manual entry points (CLI:99-100
   and VSCode SDK bridge:101-102) correctly implement this. They
   are NOT the defect.

3. **AUTO_CALLER_INPUT = provider-projected W.** The orchestrator
   passes `apiMessages = prepareProviderMessagesForApi(canonical)`
   (sdk/packages/core/src/runtime/orchestration/
   session-runtime-orchestrator.ts:1149). This is the SAME pipeline
   as the next provider-bound request.

4. **UI_CONSUMER_ASSUMPTION = IMPLICIT S2 (active provider
   context).** The TaskHeader / shared-metrics layer
   (`getApiMetrics.ts:174-225` + `ContextWindow.tsx:175` "Current
   tokens used in this request") applies the compaction ratio to
   provider-bound `tokensIn`. Whether the manual-mode ratio
   transfers to the provider-context shrink is exactly the
   discriminator's question.

The frozen §0 contract (truth domains + invariants I1-I7) is
unchanged. The durable conclusion about the producer is that
`tokensBefore` is a transformation on the supplied request with no
payload-identity claim; the durable conclusion about the UI is
that its `tokensBefore/tokensAfter` rescaling is an implicit
S2 assumption whose correctness is empirical, not proven.

## Live defect C — post-compaction header-bar staleness (2026-09-02 09:00:00Z)

Even after Strategy-D closes the cross-scale arithmetic defect
and the post-restore publication closes the TaskHeader-phase
defect, ONE live UI symptom remains:

```text
Symptom:    the compaction divider correctly shows
            "Context compacted (manual) · 364.9k → 264.3k tokens",
            but the TaskHeader context bar shows 364.9k (the
            pre-compaction provider observation) — not 264.3k
            — and stays there until the NEXT api_req_started
            lands (i.e. until the next ordinary task-state
            progression).

Root cause: apps/vscode/webview-ui/src/components/chat/ChatView.tsx:120-123
            walks the LAST api_req_started observation via
            apps/vscode/src/shared/getApiMetrics.ts:163-186
            (getLastApiReqContextInputTokens). After a
            successful compaction, no NEW api_req_started has
            arrived yet, so the consumer returns the
            pre-compaction P-space value. The compaction
            divider's tokensAfter (H-space) is rendered by
            CompactionRow.tsx but is NOT fed back into the
            header-bar projection.
            This is a PROJECTION-COHERENCE defect at the
            webview seam. It is NOT a token-accounting
            defect (the §0 frozen contract and I1-I7
            invariants are preserved: the divider and the
            bar both tell truthful values in their own
            domains; the user just reads them as one
            semantic quantity).

Conservation:  Strategy-D (genuine prior observation,
               no fabrication) MUST NOT be reverted. The
               bar should NOT read the divider's H-space
               value and substitute it for the missing
               P-space observation; that would violate
               I1-I3. The honest fix is at the UI / webview
               projection seam, not at the metrics consumer.

Reproduction:  `.factory/evidence/ACT-CLINEMM-COMPACTION-
                PRESENTATION-FRESHNESS-EMPIRICAL01/findings.md`
                §1.3 — 2 bun:test cases GREEN at HEAD,
                demonstrating the live symptom.

Recommended    Factory causal reviewer should consider:
next move:     (α) narrow recon-only ACT to bind the actual
                  projection-coherence boundary;
               (β) wire-contract ACT that adds a `kind`
                  discriminator so the consumer can
                  mechanically distinguish H-space divider
                  from P-space observation (only fix that
                  addresses BOTH defect C AND CASE_S1 label
                  residue in a single bounded change);
               (γ) HOLD until the file-tool workspace-
                  realpath lane binds a real creator
                  (security P0 per disposer's priority
                  ordering).
               Proposed ACT
               ACT-CLINEMM-COMPACTION-PRESENTATION-TRUTH-REPAIR01
               is NOT opened in this turn — opening it
               without re-classifying defect A and defect B
               (both already CLOSED at HEAD) would duplicate
               already-landed work and violate the Factory
               doctrine "real/live failure → RED
               reproduction → repair".

## Current frontier — ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01 (OPEN 2026-09-02 18:30:00Z)

The Factory causal reviewer's PASS_WITH_ONE_P1_FIX
disposition on commit `9f994b135` (the empirical sanity
check) chose option α (narrow recon) over option β
(wire-contract `kind` discriminator) and named the next
ACT explicitly: **`ACT-CLINEMM-COMPACTION-HEADER-BAR-
FRESHNESS-RECON01`**.

The recon is the current live frontier for this epic.
It freezes the semantic contract of the TaskHeader context
bar at the REAL render seam immediately after a compaction
completes and before the next provider request. Its
narrowed question: **what does the header bar represent
immediately after compaction and before the next API
request?**

Three admissible contracts (C1/C2/C3) are classified in
the recon's §3 decisive matrix; the recon's C1/C2/C3
verdict decides which downstream repair ACT opens (if
any). The wire-contract ACT remains NOT_AUTHORIZED_YET
until the recon proves C3 is the intended semantic
contract — adding `kind` before the contract is frozen
would preselect the solution.

The empirical P1 is carried into the recon: the 2/2
behaviour witness exercises only the shared metrics
consumer (`getLastApiReqContextInputTokens`), NOT the
actual `ChatView → ContextWindow/TaskHeader` render
chain. The recon MUST author the real RED only after the
semantic contract is frozen; per the reviewer's directive,
"do not write `expect(bar).toBe(264300)` until the bar
is actually proven to represent working context. That is
exactly how we avoid repeating the earlier
accounting-domain mistake."

Defect A and defect B remain CLOSED at HEAD; the §0 frozen
contract + I1-I7 invariants are preserved unchanged. The
recon MUST NOT touch the H-space producer, the P-space
consumer, or the compactor entry points.

See `.factory/acts/ACT-CLINEMM-COMPACTION-HEADER-BAR-
FRESHNESS-RECON01.md` for the full mission, Q1-Q5
questions, decisive matrix, P1 calibration, downstream
repair ladder, and acceptance criteria. EVIDENCE:
`.factory/evidence/ACT-CLINEMM-COMPACTION-HEADER-BAR-
FRESHNESS-RECON01/entry-freeze.txt`.


## Current frontier update — 2026-09-02 21:00:00Z

**`ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01` is now
CLOSED** with disposition RECON_PASS + DISPOSITION_v2
HALT_INTENT_NOT_PROVEN reverted to PRODUCT_DECISION=C2 →
GO_W_AUTHORITY (factory causal reviewer, second pass on
commit e71ca399b).

**`ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01`
is the new current frontier.** It is authorized by an
explicit PRODUCT_DECISION = C2 (made by Factory this turn,
NOT a source-intent claim), binds the producer seam
(system prompt + canonical post-compaction messages + tools
+ request overhead), computes W from that exact next-request
shape, and publishes W to the context-window header.

Caveats carried into the new ACT:

- HEADER_BAR_INTENT = AMBIGUOUS (source evidence alone
  leaves C1/C2/C3 EQUALLY PLAUSIBLE)
- W_PRODUCER_ACT = AUTHORIZED (gate: PRODUCT_DECISION = C2)
- WIRE_LOCATION = UNDECIDED (Phase 1 producer recon binds
  it; do NOT preselect)
- H_a ≡ W_e NOT claimed (I6 invariant from
  ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01
  still in force)
- W = 264.3k NOT required — invariant is
  header == authoritative W, not header == compaction
  tokensAfter
- NO_NEW_RECON = YES (do not open another Factory recon)
- Strategy-D consumer (getApiMetrics.ts:174-225) untouched

Phase 1 produces RED (currentWorkingContextEstimate MUST be
available to TaskHeader immediately after successful
compaction with no subsequent api_req_started). GREEN:
header = W_before before compaction; header = W_after
after compaction; header already reflects W_after before
next provider request.

See `.factory/acts/ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-
AUTHORITY-PUBLISH01.md` for the full mission, Phase 1
producer-seam recon plan, RED/GREEN shape, conservation
invariants, and stop conditions. EVIDENCE:
`.factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-
AUTHORITY-PUBLISH01/entry-freeze.txt`.

## Current frontier update — 2026-09-02 21:30:00Z (reviewer P1)

Factory causal reviewer second-pass disposition PASS_WITH_ONE_P1_FIX
on commit `fd4b57ae3` (this epic's previous Current frontier update
opened the W-authority ACT). The reviewer's product-decision framing
is **accepted**: PRODUCT_DECISION = C2 stays; SOURCE_INTENT stays
AMBIGUOUS; W_AUTHORITY stays ABSENT / PROVEN. The P1 fix tightens
the Phase-1 contract so:

```text
W = estimate(next request context occupancy)

NOT

W = reconstructed provider billing / input accounting
```

The risk the reviewer flagged: if W is computed by starting with
exact request content and then folding provider cache counters back
into it, we recreate Strategy-D's category defect by another route.
Upstream #9433 is direct corroboration — the current bar's
dependence on provider `usage` is precisely what makes it fail when
usage is null, and the suggested fallback is internal estimation.
That supports keeping **estimation authority distinct from
provider-reported usage buckets**.

### Phase-1 contract freezes (added in this turn)

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

The likely winner is **not necessarily the compactor**. The
compactor knows enough to estimate H, but the next-turn preparation
seam may be closer to the actual payload that will constrain the
next API call. Phase 1 fills a seam evaluation table from production
source; WIRE_LOCATION is selected from the table, not preselected.

### RED shape (mechanical)

```text
W_before =
  estimateRequestInputTokens(exact canonical pre-compaction
                             request shape)

W_after =
  estimateRequestInputTokens(exact canonical post-compaction
                             request shape)

after successful compaction:
  projected currentWorkingContextEstimate == W_after

At HEAD expected RED:
  projected W = absent
```

Negative assertion (mandatory):

```text
W_after need not equal H_a
```

even when one fixture happens to produce equal numbers. Any test
that asserts `W_after === H_a` for a fixture is a smell — it would
recreate the cross-scale arithmetic prohibition.

### Nomenclature tweak

```text
H_a_TO_W_EQUIVALENCE_BY_ASSUMPTION = FORBIDDEN  (doctrine)
H_a_TO_W_EQUIVALENCE               = UNPROVEN   (evidence)
```

What is **forbidden** is assuming or deriving the equivalence
without proof. The equivalence may eventually be true if a future
implementation proves it from identical exact inputs and the
identical estimator — but it must not be taken as a starting
assumption. This prevents a future valid mathematical proof from
conflicting with doctrine.

### Causality split — don't touch the header yet

```text
TaskHeader / ContextWindow = NO CHANGE

commit 1:
  W authority exists at the producer / projection seam
  TaskHeader / ContextWindow = NO CHANGE
  invariant: header still reads P

commit 2:
  TaskHeader / ContextWindow = consumes W
  invariant: header == authoritative W (NOT header == H_a)
```

That separation gives clean causality with executable evidence
after each, faster to debug than combining producer semantics and
UI consumption in one patch.

### Conservation preserved

- DEFECT A (cross-scale ratio transfer): CLOSED at cb5b52239
  (Strategy-D; getApiMetrics.ts:174-225)
- DEFECT B (post-restore publication): CLOSED at HEAD (trailing
  postStateToWebview at sdk-compaction-coordinator.ts:380)
- Strategy-D consumer untouched
- 24/24 getApiMetrics bun:test PASS (re-verified)
- git diff --check clean

PRODUCTION DELTA: ZERO (this turn is text-only P1 fix in the
new ACT's Phase-1 contract; no production code change)
NEW REVIEW ROUND: NO
C1: GO_W_AUTHORITY

## Current frontier update — 2026-09-02 22:00:00Z (reviewer P2 disposition)

Factory causal reviewer second-pass on commit `2c1768563`:
**PASS_WITH_NONBLOCKING_RESIDUE. C1: GO_W_AUTHORITY.** P0/P1 closed.
P2 = bind the actual `CANONICAL_W_ESTIMATOR` before hard-coding
`estimateRequestInputTokens` in the RED; plus a tiny `(i)/(iii)/(iii)`
numbering typo in the new ACT's `entry-freeze.txt`. The reviewer's
product-decision framing stays accepted: `PRODUCT_DECISION = C2`,
`SOURCE_INTENT = AMBIGUOUS`, `W_AUTHORITY = ABSENT / PROVEN`. The
reviewer's `H_a_TO_W_EQUIVALENCE_BY_ASSUMPTION = FORBIDDEN` /
`H_a_TO_W_EQUIVALENCE = UNPROVEN` nomenclature stays accepted.

### P2 — CANONICAL_W_ESTIMATOR placeholder

The RED shape currently names `estimateRequestInputTokens` as a
**candidate**, not a hard-coded assumption. Phase 1 must first
establish:

```text
CANONICAL_W_ESTIMATOR =
  <actual function used by next-request context-budget
   logic at the chosen seam>
```

If that turns out to be `estimateRequestInputTokens`, great. If
not, the ACT follows the real authority rather than adapting
reality to the plan. Do NOT begin the test with any function name
hard-coded merely because it already exists.

### P2 — NEGATIVE_CONTROL_PROVIDER_USAGE (mandatory Phase 1 control)

```text
provider usage buckets change (cacheReads / cacheWrites / tokensIn)
while canonical request content identical
→ W MUST NOT change
```

Example synthetic variation: vary `cacheReads`, `cacheWrites`,
`tokensIn` while keeping system prompt / messages / tools
identical. Expected: `W1 == W2`. This mechanically proves this
ACT has not reintroduced provider-accounting dependence. More
valuable than yet another prose invariant.

### P2 — LIVE_264_3K_USAGE

Do NOT use the live `264.3k` as a target. The screenshot is
evidence of the UX defect, not an oracle for W. `W_after` is
required to differ from `H_a`; the test should derive W from the
canonical request estimator, not embed a live screenshot number.

### P2 — typo fix

`entry-freeze.txt` previously had `(i)/(iii)/(iii)` numbering
typo. Fixed opportunistically in this turn while the file was
in scope for the CANONICAL_W_ESTIMATOR / NEGATIVE_CONTROL
additions. Not a standalone docs commit, per the reviewer
directive.

### Phase 1 is small now

The reviewer explicitly asked for a small Phase 1, not another
Factory evidence essay. Inspect the actual next-request
preparation chain and fill only the seam evaluation table:

```text
| Candidate          | Has system prompt | Canonical post-compaction messages | Tools | Uses actual budget estimator | Can publish W once? |
| compaction seam    |                   |                                    |       |                              |                     |
| prepare-turn seam  |                   |                                    |       |                              |                     |
| VSCode coordinator |                   |                                    |       |                              |                     |
```

The decisive question:

> Where is the first production point after compaction where
> the exact content-bearing next-request shape and the canonical
> context-budget estimator coexist?

The reviewer's hypothesis (not yet bound): the prepare-turn path
is stronger than the VS Code coordinator because the coordinator
is presentation-side and should not learn token-estimation
semantics. But bind source.

### Then author the true missing-W RED

Once the seam is proven:

```text
canonical post-compaction request shape
→ CANONICAL_W_ESTIMATOR
→ W_after
```

RED asserts that the value cannot currently reach the projection
boundary:

```text
after successful compaction
and before a subsequent api_req_started

expected:
  projected currentWorkingContextEstimate = W_after

actual at HEAD:
  projected currentWorkingContextEstimate = absent
```

That is a good RED because the missing thing is now an
authority field, not an arithmetic expectation.

### Commit split remains two-step

```text
Commit 1:
  authoritative W exists and is published
  header still reads P
  Evidence: RED → GREEN for W publication
           provider-accounting non-interference control

Commit 2:
  header switches P → W
  Evidence: header projection RED → GREEN
           existing P/H accounting suites remain GREEN
```

Clean causal isolation.

### Conservation preserved

- DEFECT A (cross-scale ratio transfer): CLOSED at cb5b52239
  (Strategy-D; getApiMetrics.ts:174-225)
- DEFECT B (post-restore publication): CLOSED at HEAD
- Strategy-D consumer untouched
- 24/24 getApiMetrics bun:test PASS (re-verified)
- git diff --check clean

PRODUCTION DELTA: ZERO (this turn is text-only P2 disposition
recording; CANONICAL_W_ESTIMATOR placeholder + NEGATIVE_CONTROL
+ LIVE_264_3K_USAGE + numbering typo fix; no production code
change)
NEW REVIEW ROUND: NO
C1: GO_W_AUTHORITY

Reviewer closing note: "No more Factory planning is needed
here. The next useful result is the filled seam table and a
failing missing-W test."

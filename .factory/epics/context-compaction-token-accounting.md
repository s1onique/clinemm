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
> **R0' semantic-contract recon (CALIBRATED 2026-09-02 second-review PASS_WITH_ONE_P1_FIX; third-review DISCRIMINATOR CALIBRATION 2026-09-02T03:30:00Z; fourth-review WORKING-CONTEXT-SEAM CALIBRATION 2026-09-02T04:00:00Z):** the producer is a transformation on the supplied request (no semantic claim); the UI consumer applies a ratio whose transfer to the provider-context shrink for manual mode is exactly the discriminator's question. Defect (if any) is AMBIGUOUS_WIRE_CONTRACT (CASE_S3, candidate) or SEMANTIC_LABEL (CASE_S1) — pending the ratio discriminator. The defect (if confirmed) is in the schema/wire or the UI label, NOT in the compactor entry points. The PRIMARY discriminator: does `manual_ratio = H_after/H_before` track `working_context_ratio = W_after/W_before`, where W is bound to the REAL production turn-preparation seam (NOT `prepareProviderMessagesForApi`, which is a second-stage transformation that does NOT consult the compaction artifact; canonical history is intentionally append-only/full-fidelity per `sdk/ARCHITECTURE.md:497`). Specifically, the seam is `createCompactionStateAwarePrepareTurn` at `sdk/packages/core/src/extensions/context/compaction.ts:672-712`, driving `projectSessionCompactionState` at `sdk/packages/core/src/session/models/session-compaction.ts:161-193` twice against identical canonical state with exactly one manual compaction applied between captures. P observations (`P_after/P_before`) are NOT a valid causal compaction oracle (intervening turns between compaction and next provider request contaminate the comparison); P observations become LIVE_PROVIDER_QUALIFICATION (conservation check only). C1 GO is NOT yet granted; buildForApi compaction-independence must be confirmed before execution.
>
> **Distinct from `task-presentation.md`.** That epic owns the rendering of state to the user. This epic owns whether the working-context estimate, the compaction before/after markers, and the session usage counters tell consistent truth — and whether the producers expose semantic quantities that match what the UI fields appear to claim.
>
> **Distinct from `runtime-task-progression.md`.** That epic owns what happens after a tool finishes (does the agent continue, ask, or stall). This epic owns the **pre-turn arithmetic** that decides whether the next turn even gets sent.
>
> **Why now.** Per factory causal reviewer (2026-09-01): "Fresh LIVE symptom; may affect compaction threshold, context-limit safety and long-session behavior" — that outranks imported upstream radar (e.g. #12939 replace_in_file CPU, #12388 checkpoint run-identity) because it is ours, live, now.
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: DISCRIMINATOR EXECUTED — recon ACT is **CLOSED_WITH_RESIDUE**
  (CASE_A — S3_PROVEN, ROOT_CAUSE_ISOLATED). Q0A-Q0C producer-binding
  DONE (commit 901287e15); R0-A witness test DONE (commit 2916fb9fd);
  R0' source-recon DONE (commit 9083ecd56); R0' semantic-contract
  recon DONE & CALIBRATED; working-context-seam-recon DONE
  (commit be15a56a0); ratio discriminator EXECUTED (current commit).
  Discriminator result: case 1 (trivial canonical) → ratios
  bit-identical (S3_RATIO_TRANSFER_NOT_REPRODUCED); case 2
  (realistic canonical, assistant text > 200K cap) → S3_REPRODUCED
  with 66.6% relative divergence (manualRatio 0.000210 vs
  workingContextRatio 0.000629). The compactor's input/output scale
  (raw canonical → tiny summary) differs from buildForApi's output
  scale (truncated) when assistant text exceeds the 200K cap. UI
  consumer at getApiMetrics.ts applies the manual compactor's ratio
  to provider-bound tokensIn, predicting ~3× more aggressive shrink
  than the working context actually achieves. ROOT_CAUSE_ISOLATED
  at the wire/schema between producer (core-events.ts:773) and UI
  rescaling consumer (getApiMetrics.ts:174-225). Downstream repair
  ACT = ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01 (NOT opened
  from this ACT). R1-R3 territory remains DEFERRED per the
  reviewer's HALT directive; this S3 verdict does NOT auto-prove
  S1-LABEL-ONLY or eliminate other accounting defects. CASE_B.MANUAL_PROJECTION RETRACTED.
- Priority: **P1** (HIGH value production learning; affects compaction threshold, context-limit safety, long-session behavior). May be promoted to P0 if the discriminator reproduces an actual structural defect.
- Current frontier: `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` — read-only recon; no production change until the discriminator resolves the S3 question.
- Blocked by: n/a (the HOST_REQUIRED ratio discriminator is sequenced after the recon's calibrated findings are written; the reviewer explicitly said NOT to author more Factory scaffolding before the discriminator runs).
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

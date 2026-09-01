# EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING

> **Token-accounting truth across the compaction boundary, expressed as separated truth domains.** The frozen contract (see `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` §0) is: each token quantity belongs to a SPECIFIC truth domain (`REQUEST_INPUT_TOKENS`, `REQUEST_OUTPUT_TOKENS`, `SESSION_CUMULATIVE_USAGE`, `WORKING_CONTEXT_ESTIMATE`, `COMPACTION_BEFORE_TOKENS`, `COMPACTION_AFTER_TOKENS`, `MODEL_INPUT_BUDGET`, `CONTEXT_UTILIZATION`). Domains are NOT additive. Invariants I1-I7 forbid additive arithmetic across the billing/context divide. The fresh production symptom (factory causal reviewer, 2026-09-01) is "obviously inconsistent compaction/context accounting"; this recon ACT opens the lane to characterize it.
>
> **R0-A (factory causal reviewer, 2026-09-02 first reordering):** post-compaction TaskHeader rescaling (`apps/vscode/src/shared/getApiMetrics.ts:174-225`) crosses two semantic baselines. The displayed header value is `lastRequestInput × (tokensAfter / tokensBefore)`. R0-A confirmed this arithmetic against the LIVE-symptom input (167.1k × 0.04249 ≈ 7.1k = 7_101). R0-B "three permitted quantities" oracle was HALT_RED_NOT_REPRODUCED (unfounded); R0-C doc-comment-vs-behavior was inconclusive. Both withdrawn.
>
> **R0' first pass (factory causal reviewer, 2026-09-02 SECOND REORDERING):** manual compaction's `apiMessages = canonical` at both entry points (`apps/cli/src/runtime/interactive/compaction.ts:99-100` and `apps/vscode/src/sdk/sdk-compaction.ts:101-102`) — PROVEN_STRUCTURAL asymmetry with the AUTO path (which uses `prepareProviderMessagesForApi`).
>
> **HALT_ROOT_CAUSE_NOT_ISOLATED (factory causal reviewer, 2026-09-02 SECOND REVIEW):** the previous turn's conclusion (manual compaction passes the wrong input) was an epistemic jump. The producer documents `tokensBefore` as "Full-request token estimates, in the same units as the trigger and limit" (`sdk/packages/core/src/services/telemetry/core-events.ts:773`) — i.e., the S1 contract (MATERIAL_BEING_COMPACTED). The manual entry points correctly implement S1 per the explicit design intent ("intentionally summarizes the full canonical transcript"). The UI consumer (ContextWindow.tsx:175 "Current tokens used in this request") implicitly assumes S2 (ACTIVE_PROVIDER_CONTEXT). Both contracts are valid within their own layer; the defect is the WIRE between them.
>
> **R0' semantic-contract recon (2026-09-02 second review):** defect is AMBIGUOUS_WIRE_CONTRACT (CASE_S3) or SEMANTIC_LABEL_DEFECT (CASE_S1) — NOT a producer defect. Manual entry points RETRACTED as defect location. ROOT_CAUSE_ISOLATED candidate: schema/wire between producer (core-events.ts:773) and UI rescaling consumer (getApiMetrics.ts:174-225 + ContextWindow.tsx:175). Downstream repair ACT = ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01 (named but NOT opened from this ACT). Three repair options named: (a) tag the field, (b) split into two fields, (d) consumer-side reconciliation.
>
> **Distinct from `task-presentation.md`.** That epic owns the rendering of state to the user. This epic owns whether the working-context estimate, the compaction before/after markers, and the session usage counters tell consistent truth — and whether the producers expose semantic quantities that match what the UI fields appear to claim.
>
> **Distinct from `runtime-task-progression.md`.** That epic owns what happens after a tool finishes (does the agent continue, ask, or stall). This epic owns the **pre-turn arithmetic** that decides whether the next turn even gets sent.
>
> **Why now.** Per factory causal reviewer (2026-09-01): "Fresh LIVE symptom; may affect compaction threshold, context-limit safety and long-session behavior" — that outranks imported upstream radar (e.g. #12939 replace_in_file CPU, #12388 checkpoint run-identity) because it is ours, live, now.
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: OPEN — recon ACT is OPEN; Q0A-Q0C producer-binding DONE (commit 901287e15); R0-A witness test DONE (commit 2916fb9fd); R0' source-recon DONE (commit 9083ecd56); R0' semantic-contract recon DONE (this commit). CASE_B.MANUAL_PROJECTION RETRACTED. R0' real-trace specimen HOST_REQUIRED.
- Priority: **P1** (HIGH value production learning; affects compaction threshold, context-limit safety, long-session behavior). May be promoted to P0 if the recon reproduces an actual structural defect.
- Current frontier: `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` — read-only recon; no production change until the recon resolves the question.
- Blocked by: n/a (the HOST_REQUIRED R0' real-trace specimen is sequenced after the recon's semantic-contract findings are written).
- Sequenced after this ACT (gated on its verdict):
  - If `CASE_A` / `CASE_A.UI` (with no S1/S3 residue) → `CLOSED_NOT_REPRODUCED`.
  - If `CASE_A` with `CASE_S1` residue (UI label vs producer contract mismatch) → `CLOSED_WITH_RESIDUE`; downstream repair ACT = `ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01` (option d partial).
  - If `CASE_S3` (wire-contract overloaded) → `ROOT_CAUSE_ISOLATED` at the schema/wire; downstream repair ACT = `ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01` (option a/b/d).
  - If `CASE_B` (R1-R3 RED with structural defect, not yet probed) → bounded core-arithmetic repair ACT.
  - If `CASE_C` / `CASE_D` → see ACT §7 / §8.
- `CASE_B.UI` / `CASE_B.HYBRID` / `CASE_B.MANUAL_PROJECTION` all RETIRED (R0-B oracle unfounded; previous-turn root-cause isolation on manual entry points was incorrect per the second-review HALT).

## Contract / durable conclusions

The semantic-contract recon establishes three durable conclusions
that will land in the recon's classification.md / final-report.md
when the ACT closes:

1. **PRODUCER_CONTRACT = S1.** The producer (compactor) documents
   `tokensBefore` as "Full-request token estimates, in the same
   units as the trigger and limit" — i.e., the size of what was
   supplied to compaction. For manual compaction this is the
   canonical full transcript by design intent; for auto compaction
   this is the provider-bound context (because the orchestrator
   passes `apiMessages = prepareProviderMessagesForApi(canonical)`).

2. **UI_CONSUMER_CONTRACT = S2.** The TaskHeader / shared-metrics
   layer treats `tokensBefore` as "active provider context" — i.e.,
   what the model is currently carrying. This is implicit; the
   docstring at `getApiMetrics.ts:80-93` assumes scale-free ratio,
   and the rendering title at `ContextWindow.tsx:175` says "Current
   tokens used in this request."

3. **WIRE_CONTRACT = S3 (current best classification).** Neither
   side explicitly verifies the producer's scale, so the consumer
   applies a ratio on the canonical scale to a `tokensIn` measured
   on the provider scale. For manual compaction this can produce
   wildly off rescaling values.

The frozen §0 contract (truth domains + invariants I1-I7) is
unchanged. The first durable conclusion is that `tokensBefore` is
overloaded across producer/consumer and needs explicit tagging or
schema-split, NOT a producer change.

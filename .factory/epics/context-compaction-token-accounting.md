# EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING

> **Token-accounting truth across the compaction boundary, expressed as separated truth domains.** The frozen contract (see `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` §0) is: each token quantity belongs to a SPECIFIC truth domain (`REQUEST_INPUT_TOKENS`, `REQUEST_OUTPUT_TOKENS`, `SESSION_CUMULATIVE_USAGE`, `WORKING_CONTEXT_ESTIMATE`, `COMPACTION_BEFORE_TOKENS`, `COMPACTION_AFTER_TOKENS`, `MODEL_INPUT_BUDGET`, `CONTEXT_UTILIZATION`). Domains are NOT additive. Invariants I1-I7 forbid additive arithmetic across the billing/context divide. The fresh production symptom (factory causal reviewer, 2026-09-01) is "obviously inconsistent compaction/context accounting"; this recon ACT opens the lane to characterize it.
>
> **R0-A (factory causal reviewer, 2026-09-02 first reordering):** post-compaction TaskHeader rescaling (`apps/vscode/src/shared/getApiMetrics.ts:174-225`) crosses two semantic baselines. The displayed header value is `lastRequestInput × (tokensAfter / tokensBefore)`. R0-A confirmed this arithmetic against the LIVE-symptom input (167.1k × 0.04249 ≈ 7.1k = 7_101). R0-B "three permitted quantities" oracle was HALT_RED_NOT_REPRODUCED (unfounded); R0-C doc-comment-vs-behavior was inconclusive. Both withdrawn.
>
> **R0' (factory causal reviewer, 2026-09-02 SECOND REORDERING) — NEW P1 candidate:** manual compaction's `apiMessages` is set to the canonical full transcript (`apps/cli/src/runtime/interactive/compaction.ts:99-100` and `apps/vscode/src/sdk/sdk-compaction.ts:101-102`) while the next provider-bound request goes through `buildForApi`. For manual compaction, `tokensBefore` measures the canonical history, not the provider-bound working context the UI labels. AUTO compaction is consistent (uses `prepareProviderMessagesForApi`). The TaskHeader / shared-metrics layer is NOT at fault; the defect lives in the SDK entry points. A live-trace specimen (HOST_REQUIRED) is needed for full three-way equality proof.
>
> **Distinct from `task-presentation.md`.** That epic owns the rendering of state to the user. This epic owns whether the working-context estimate, the compaction before/after markers, and the session usage counters tell consistent truth — and whether the producers expose semantic quantities that match what the UI fields appear to claim.
>
> **Distinct from `runtime-task-progression.md`.** That epic owns what happens after a tool finishes (does the agent continue, ask, or stall). This epic owns the **pre-turn arithmetic** that decides whether the next turn even gets sent.
>
> **Why now.** Per factory causal reviewer (2026-09-01): "Fresh LIVE symptom; may affect compaction threshold, context-limit safety and long-session behavior" — that outranks imported upstream radar (e.g. #12939 replace_in_file CPU, #12388 checkpoint run-identity) because it is ours, live, now.
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: OPEN — recon ACT is OPEN; Q0A-Q0C producer-binding DONE (commit 901287e15); R0-A witness test DONE (commit 2916fb9fd); R0' source-recon DONE (this commit). R0' real-trace specimen HOST_REQUIRED.
- Priority: **P1** (HIGH value production learning; affects compaction threshold, context-limit safety, long-session behavior). May be promoted to P0 if the recon reproduces an actual structural defect.
- Current frontier: `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` — read-only recon; no production change until the recon resolves the question.
- Blocked by: n/a (the HOST_REQUIRED R0' real-trace specimen is sequenced after the recon's source-recon findings are written).
- Sequenced after this ACT (gated on its verdict):
  - If `CASE_A` / `CASE_A.UI` → `CLOSED_NOT_REPRODUCED` (LIVE symptom was label ambiguity or otherwise explained).
  - If `CASE_B` (R1-R3 RED) → bounded core-arithmetic repair ACT.
  - If `CASE_B.MANUAL_PROJECTION` (R0' source-recon MANUAL PATH only, R1-R3 GREEN for AUTO path) → bounded SDK-entry-point repair ACT. Ownership migrates to CLI + VSCode compaction bridges.
  - If `CASE_B.HYBRID` (both RED, retired 2026-09-02) → not applicable; both R0-B and CASE_B.HYBRID are RETIRED.
  - If `CASE_C` / `CASE_D` → see ACT §7 / §8.

## Contract / durable conclusions

(none yet — recon ACT owns the first contract write. The frozen §0 contract
defines the truth-domain taxonomy and invariants I1-I7; first durable
conclusions about the ClineMM production code will land after the recon
classifies the symptom. R0' source-recon bound a candidate
CASE_B.MANUAL_PROJECTION at CLI/VSCode entry points; full
three-way equality E_before ≈ W_before ≈ P_before requires the
real-trace specimen, which is HOST_REQUIRED.)

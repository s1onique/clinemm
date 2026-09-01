# EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING

> **Token-accounting truth across the compaction boundary, expressed as separated truth domains.** The frozen contract (see `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` §0) is: each token quantity belongs to a SPECIFIC truth domain (`REQUEST_INPUT_TOKENS`, `REQUEST_OUTPUT_TOKENS`, `SESSION_CUMULATIVE_USAGE`, `WORKING_CONTEXT_ESTIMATE`, `COMPACTION_BEFORE_TOKENS`, `COMPACTION_AFTER_TOKENS`, `MODEL_INPUT_BUDGET`, `CONTEXT_UTILIZATION`). Domains are NOT additive. Invariants I1-I7 forbid additive arithmetic across the billing/context divide. The fresh production symptom (factory causal reviewer, 2026-09-01) is "obviously inconsistent compaction/context accounting"; this recon ACT opens the lane to characterize it.
>
> **Distinct from `task-presentation.md`.** That epic owns the rendering of state to the user. This epic owns whether the working-context estimate, the compaction before/after markers, and the session usage counters tell consistent truth — and whether the producers expose semantic quantities that match what the UI fields appear to claim.
>
> **Distinct from `runtime-task-progression.md`.** That epic owns what happens after a tool finishes (does the agent continue, ask, or stall). This epic owns the **pre-turn arithmetic** that decides whether the next turn even gets sent.
>
> **Why now.** Per factory causal reviewer (2026-09-01): "Fresh LIVE symptom; may affect compaction threshold, context-limit safety and long-session behavior" — that outranks imported upstream radar (e.g. #12939 replace_in_file CPU, #12388 checkpoint run-identity) because it is ours, live, now.
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: OPEN — recon ACT is OPEN; recon is not yet executed.
- Priority: **P1** (HIGH value production learning; affects compaction threshold, context-limit safety, long-session behavior). May be promoted to P0 if the recon reproduces an actual structural defect.
- Current frontier: `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` — read-only recon; no production change until the recon resolves the question.
- Blocked by: n/a.
- Sequenced after this ACT (gated on its verdict): a bounded repair ACT only if recon proves the symptom is structural, or `CLOSED_NOT_REPRODUCED` (incl. label-only sub-case) if recon exonerates.

## Contract / durable conclusions

(none yet — recon ACT owns the first contract write. The frozen §0 contract
defines the truth-domain taxonomy and invariants I1-I7; first durable
conclusions about the ClineMM production code will land after the recon
classifies the symptom.)

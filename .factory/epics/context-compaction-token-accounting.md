# EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING

> **Token-accounting truth across the compaction boundary** — every token the model is billed for must be accounted for, and the context-window / compaction threshold must be honored against the actual token total, not a stale or derived estimate. The fresh production symptom (factory causal reviewer, 2026-09-01) is "obviously inconsistent compaction/context accounting"; this recon ACT opens the lane to characterize it.
>
> **Distinct from `task-presentation.md`.** That epic owns the rendering of state to the user. This epic owns the **arithmetic** of how many tokens the model saw and where the boundary is enforced.
>
> **Distinct from `runtime-task-progression.md`.** That epic owns what happens after a tool finishes (does the agent continue, ask, or stall). This epic owns the **pre-turn arithmetic** that decides whether the next turn even gets sent.
>
> **Why now.** Per factory causal reviewer (2026-09-01): "Fresh LIVE symptom; may affect compaction threshold, context-limit safety and long-session behavior" — that outranks imported upstream radar (e.g. #12939 replace_in_file CPU, #12388 checkpoint run-identity) because it is ours, live, now.
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: OPEN — recon ACT has not yet been opened.
- Priority: **P1** (HIGH value production learning; affects compaction threshold, context-limit safety, long-session behavior). May be promoted to P0 if the recon reproduces an actual context-window overage.
- Current frontier: `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` — read-only recon; no production change until the recon resolves the question.
- Blocked by: n/a.
- Sequenced after this ACT (gated on its verdict): a bounded repair ACT only if recon proves the symptom is structural, or `CLOSED_NOT_REPRODUCED` if recon exonerates.

## Contract / durable conclusions

(none yet — recon ACT owns the first contract write.)

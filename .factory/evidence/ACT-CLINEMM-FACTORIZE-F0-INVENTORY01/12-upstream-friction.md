# 12 — Upstream Merge Friction

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** compare upstream LOC, fork LOC, and per-file commit counts.
**Evidence label:** HISTORICAL_GIT

---

## Top merge-friction surface

| File | Upstream LOC | Cline-- LOC | Δ | Upstream commits | Fork commits |
|---|---:|---:|---:|---:|---:|
| `apps/vscode/src/sdk/SdkController.ts` | 2,388 | **4,679** | +2,291 (×1.96) | 71 | **160** |
| `apps/vscode/src/sdk/sdk-tool-policies.ts` | 92 | **1,120** | +1,028 (×12.2) | 4 | **28** |
| `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` | 291 | **1,125** | +834 (×3.87) | 11 | 25 |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | 315 | 482 | +167 (×1.53) | (not separately counted) | — |

**`SdkController.ts` has nearly doubled in size** (×1.96) and has been touched in **2.25× more fork commits** than upstream commits.

`sdk-tool-policies.ts` is essentially a fork-invented file (upstream had only 92 LOC, Cline-- has 1,120 LOC). Low merge-friction per se, but high fork-only weight.

## What this means

A future upstream rebase of `SdkController.ts` will require resolving ~160 commits' worth of fork hunks against ~71 upstream commits. Every architectural change the fork makes to this file is a **merge-friction event** with upstream.

The architectural question per ACT §17:

> Can a factorization move Cline-- behavior behind a stable seam and reduce future conflict surface?

The answer is **yes** if the factorization extracts the fork-only behavior into new files that upstream does not touch. Every line moved out of `SdkController.ts` into a new file is one less merge-friction event.

Specifically:

- **Working-context capture** (`WorkingContextHostCapture`): if it is extracted to its own module that takes a callback or event-source from `SdkController`, the `SdkController` becomes smaller and the merge surface is reduced.
- **Session auto-approval override** (`SessionAutoApprovalStore`): already lives in `session-auto-approval.ts`, not in `SdkController.ts`. Good — but the override plumbing still lives in `SdkController` (lines 730, 1432, 1490, 1621, 3180).
- **Path authority / command policy**: lives in `@cline/core`. Already separated from `SdkController`. Good.

## Files with the worst fork/upstream LOC ratio

| File | Upstream | Fork | Ratio |
|---|---:|---:|---:|
| `apps/vscode/src/sdk/sdk-tool-policies.ts` | 92 | 1,120 | ×12.2 |
| `apps/vscode/src/sdk/SdkController.ts` | 2,388 | 4,679 | ×1.96 |
| `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` | 291 | 1,125 | ×3.87 |

`SdkController.ts` is the **only file with high upstream activity AND high fork delta**. The others are fork-invented (low upstream activity). `SdkController.ts` is the real friction.

## Where the fork can reduce future friction

1. **Extract the post-compaction W publication path from `SdkController.ts` into the `WorkingContextHostCapture` module's own publisher.** Today `SdkController.ts` still owns the wiring that connects the canonical runtime-event subscription to `WorkingContextHostCapture.observe()`. Moving the wiring into `working-context-host-capture.ts` would let `SdkController.ts` lose ~50 LOC and one more dependency.
2. **Extract the override plumbing** (`resolveSessionAutoApprovalOverride` callbacks at lines 1432/1490/1621) into `session-auto-approval.ts` as a builder that produces a function. ~30 LOC.
3. **Extract the post-terminal-authority diagnostic** (`PostTerminalAuthorityDiagnosticContext`) entirely — it lives at `apps/vscode/src/sdk/post-terminal-authority-diagnostic-runtime.ts` (119 LOC) and is wired into `SdkController.ts`. Making it a true optional diagnostic plugin would let `SdkController.ts` drop its diagnostic-only code path.

## Net assessment

`SdkController.ts` is the **single biggest merge-friction file** in the fork. Any factorization that reduces its size or pushes fork-only behavior behind smaller, named seams is a direct reduction in upstream merge cost.

The candidate factorization selected in §17 (`WorkingContextHostCapture` canonical-authority consolidation) would also reduce the surface in `SdkController.ts` by:
- Eliminating the `setLatest` workaround if the canonical path is unified
- Removing the dual-event-subscription wiring


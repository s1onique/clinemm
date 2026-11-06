# ACT-CLINEMM-COMPLETED-TASK-COMPACTION-AUTHORITY01 — CLOSE

VERDICT: **PASS_STRUCTURAL_ONLY**

## What was proven

The observed contradiction — a task the UI presents as "✓ Complete" /
"Start New Task" while manual compaction answers "Cannot compact while a
response is in progress." — is caused by a **stale runtime busy flag**, not
by a premature completion, not by a wrong compaction target, and not by a
turn-settlement race.

`SdkSessionEventCoordinator.reevaluateDeferredCompletionBarrier` commits
the terminal `completed` phase — the phase the webview projects as
"✓ Complete" / "Start New Task" — but performs **no running-state
transition**. The immediate commit path performs that transition at the
tail of the turn-complete block (`sdk-session-event-coordinator.ts:5882`),
but the deferred branches `return` before reaching it (`:5457`). The
host-owned BCB continuation is delivered through
`sdkHost.send({ delivery: "queue" })` and NOT through
`fireAndForgetSend`, so that turn has no send-settlement owner that could
mark the session idle either.

The repair performs the SAME lifecycle transition the immediate commit path
already uses, at the deferred commit site:

    apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3015
        this.options.sessions.setRunning(false)

One executable statement. No new state machine, no second canonical
authority, no change to the compaction guard, the barrier predicates, the
Elm authority, the lifecycle's `turnGeneration` fence, or the compaction
mutex.

## Evidence classification of each claim

| Claim | Classification |
|---|---|
| The defect reproduces through the real production classes | REAL_PRODUCTION_SEAM |
| The repair removes the defect (same seam, same sequence) | REAL_PRODUCTION_SEAM |
| The single production line is NECESSARY (ablation) | REAL_PRODUCTION_SEAM |
| A genuinely running turn stays blocked | REAL_PRODUCTION_SEAM |
| A still-HELD deferred completion stays blocked | REAL_PRODUCTION_SEAM |
| The compaction target resolution is correct | INFERRED (unchanged code path; existing suite covers the fencing) |
| The compacted transcript persists across reopen/resume | INFERRED (unchanged code path; existing suite covers the persistence) |
| The original 2026-11-05 screenshot | LIVE (evidence of the REPORTED SYMPTOM only) |
| Installed-extension qualification of the new build | NOT_EXECUTED |
| The 62 remaining full-suite failing files | LIVE (PRE-EXISTING baseline failures — identical set with and without this ACT) |

## Gates (all observed)

    focused RED→GREEN test                 exit 0   6 passed
      RED witness (single line ablated)    exit 1   1 failed / 5 passed
    neighbouring regression suites (15)    exit 0   228 passed
    typecheck (apps/vscode tsc --noEmit)   exit 0   no diagnostics
    biome lint + format (affected files)   exit 0
    build (bun esbuild.mjs)                exit 0
    full vitest sweep — regression delta   only-in-mine = EMPTY (files and tests)

ACT-owned diagnostics end at ZERO.

## Remaining limits (P2, non-blocking)

1. **No installed-extension qualification** was executed (see live.txt).
   An operator-authorised install + a controlled background-command task
   would close the loop. The build artifact and its SHA256 are recorded in
   identity.txt.
2. **The residual "newer user turn starts between the release's authority
   consult and its commit" window** is pre-existing and unchanged by this
   ACT: in that window the release would commit `completed` over a live
   turn, and this ACT does not widen it — the running-state transition is
   performed AFTER the `completed` commit, so both assertions stay
   consistent. If it is ever proven, it belongs to
   `PREMATURE_UI_COMPLETE`, not to this ACT.
3. **The deferred-completion banner row is a historical row** — it is not
   retracted when the completion is later released. It was determined to be
   unrelated to the compaction rejection and was deliberately not changed.
4. **62 pre-existing full-suite failures** remain (identical set with and
   without this ACT). They are unrelated to this defect and were not
   touched.
5. The unrelated worktree modification
   (`.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md`)
   was preserved unstaged, as required.

## Commits

    85b4a6edc  fix(clinemm): correct the deferred-completion running-state
                transition (CTCA01)
                (the RED test and the repair are committed together; the
                 RED/GREEN provenance is preserved by the ablation witness
                 in red.txt)

## Evidence paths

    .factory/evidence/ACT-CLINEMM-COMPLETED-TASK-COMPACTION-AUTHORITY01/
        recon.md       ownership map + the production gap
        red.txt        the RED witness (single-line ablation)
        causality.md   classification, causal chain, necessity/ablation, safety
        green.txt      focused + neighbouring suite results
        identity.txt   source & artifact identity, all gate exit codes
        live.txt       NOT_EXECUTED (installed qualification)
        close.md       this file

# ACT LIVE Specimen Inventory

**Status:** Recon-only. The exact session/task ID for the cited LIVE specimen
was not retained on disk. Values sourced from the ACT prompt; values not
present in the prompt are explicitly marked `UNAVAILABLE_FROM_TRACE`.

## Cited LIVE specimen (per ACT C0 / C3)

```
submit_and_exit_seen = 11
task_completion_committed = 0

continuation_started = 8
stalledNoProgress = 21
blockedOutcomeStalledNoProgress = 11

callback delivered = 2
callback rejected = 0

held terminal observations = 1
observation mechanism = unavailable
runtime control = no continuation mechanism
model still prompted to complete
```

**Session/task:** `UNAVAILABLE_FROM_TRACE`. Predecessor
`ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01` closed a
related LIVE at `session/task = 1791400813202_ddnh3` with the smaller
chronology `submit_and_exit=4, continuation_started=4`.

**Event ordering:** `UNAVAILABLE_FROM_TRACE`. The 2-vs-8 delta between
"callback delivered" and "continuation_started" is consistent with 8
prompts and 2 wake-driven resolutions, but no trace-level ordering is
preserved on disk.

## C7 discriminator reconstruction (per C6 / C7)

Four production paths can re-enter the model:

| Path | Owner | Consults Elm? |
|---|---|---|
| Coalesced continuation (BCB held) | `SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld` | YES (P2) |
| Per-job wake (notify=true) | `BackgroundNotifyCoordinator.dispatchAndTrackWake` | **NO** |
| User message | SdkController direct | n/a |
| Agent turn done re-evaluation | `reevaluateDeferredCompletionBarrier` | n/a |

**The per-job wake path does NOT consult the Continuation Control Elm kernel.**
The wake prompt is `formatTerminalWakePrompt` directly. Each terminal
event for a held jobId fires a fresh wake. If the model has no
observation capability, every wake produces a `submit_and_exit` that
re-holds the BCB, which then attempts a coalesced continuation that the
kernel correctly fail-closes (P2) on subsequent attempts but allows on the
first attempt after each BCB re-registration (Indeterminate → P4).

**Discriminator result (C7):** Variant A — Elm policy is sufficient. The
fix is a host-only correlation at the BCB re-registration site, NOT a
fourth Elm kernel.

## Pre-fix behavior (recon-derived)

The system is working as designed: no fake commits, kernel is correctly the
semantic authority, blocked outcomes are published. The "loop" is the
EXPECTED behavior of a model that has no observation capability against a
held completion obligation. The bounded C11 fix prevents the coalesced
continuation from being re-handed to the model when the model has no
observation capability, publishing a SINGLE typed blocked outcome per
BCB cycle and stopping re-firing until capability is restored.

## Files inspected (per C2 recon)

- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (3242 lines)
- `apps/vscode/src/sdk/SdkController.ts` (6310 lines)
- `apps/vscode/src/sdk/background-notify-coordinator.ts` (1992 lines)
- `apps/vscode/src/sdk/completion-continuation-control-elm.ts` (794 lines)
- `apps/vscode/elm/completion-continuation-control/src/Policy.elm` (281 lines)
- `apps/vscode/elm/completion-continuation-control/src/Domain.elm` (380 lines)

## Untouched invariants (per C12 conservation)

- `lastCompletionContinuationHeldSetSorted` (STALL authority) lifetime
- `lastCompletionContinuationSessionEpoch` (REARM dedupe) lifetime
- `deferredCompletionBarrier` marker identity triple
- `applyBlockedCompletionContinuationOutcome` C4 adversarial guards
- `TaskTelemetryTracker.recordRuntimeError(incident)` sink (MAPPING01)
- `pickContinuationDirectiveForPublication` and the existing Continuation Control Elm kernel
- `Completion Authority` Elm kernel — not in scope

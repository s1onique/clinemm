# ACT-CLINEMM-P0-PREMATURE-HANDOFF-CONTAINMENT-FAILURE01

**Priority:** P0 — lifecycle correctness and subprocess-containment safety
**Status:** CLOSED (structurally) — `PASS_STRUCTURAL_PENDING_LIVE`
**Decision:** `C1_GO_BOUNDED_CAUSAL_REPAIR`
**Primary purpose:** Causal reproduction and bounded repair
**Execution owner:** `codium-clinemm`
**Target:** Existing ClineMM SDK production runtime
**Date:** 2026-10-24

## Verdict

    PASS_STRUCTURAL_PENDING_LIVE

The unsafe containment-to-handoff promotion is REPRODUCED against the real
production seam, ISOLATED to a single load-bearing condition, ABLATED to prove
necessity, and REPAIRED. The repair is proven structurally (9/9 focused tests,
zero regression delta, typecheck, lint). The LIVE qualification of the installed
extension was NOT performed — the dogfood install is blocked by an environment
EPERM — so `CLOSED_CLEAN` is NOT claimed.

## Identity

    ENTRY_HEAD  = 8b901a0c449994fa7f43ec586dcfd4091812b6e3  (branch main)
    SUBJECT_HEAD= 8b901a0c449994fa7f43ec586dcfd4091812b6e3
    FINAL_HEAD  = (recorded at commit time; see the commit message)

    LIVE_INCIDENT_ID = 1792821549321_bwq2x / cmd_mvm0o260jip25i0b
    TASK_ID          = 1792821549321_bwq2x
    SESSION_ID       = 1792821549321_bwq2x
    EPOCH            = 4
    JOB_ID           = cmd_mvm0o260jip25i0b
    MANAGER_INSTANCE = M4
    HOST_INSTANCE    = H4
    JOB_PID          = 40777
    JOB_PGID         = 40777

    ORIGINAL_ABORT_CAUSE = UNAVAILABLE_FROM_TRACE
    CAUSAL_CLASSIFICATION = H2 (unsafe containment-to-handoff promotion), with
                            H4 (original abort is primary) PARTIALLY TRUE for
                            the ABORT's own cause but NOT for the handoff
    PRODUCTION_SEAM       = SdkSessionEventCoordinator.reevaluateDeferredContinuation
                            (sdk-session-event-coordinator.ts) + the
                            Controller.maybeReevaluateDeferredContinuation bridge
    FAILED_POSTCONDITION  = process-group postcondition = `alive` (and
                            `unknown`); the deferred handoff was authorized on
                            ACTIVE-MAP EMPTINESS alone

## What the defect was

The host's deferred user handoff was released by a transition from managed
background-job `running=true` to `running=false`. That transition proves only
that the manager's ACTIVE MAP is empty. It does NOT prove that the subprocess
process group was reaped, because `CommandJobManager.finalize()` removes the
job from the active map on BOTH the clean path AND the containment-failure
path.

    MANAGED_JOB_REMOVED  !=  PROCESS_CONTAINMENT_VERIFIED

The exact terminal reason (`containment_failed`) WAS available at the
publication boundary but was dropped one frame before the decision, so the
decision could not distinguish a clean terminal from a failed containment.

## The bounded repair

One primary production file, one integration file, one closed-union addition:

1. `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (+140)
   - NEW option `getBackgroundCommandJobStates?: () => Record<string, string>`
     — the host's EXISTING per-job terminal projection.
   - NEW conservation rule in `reevaluateDeferredContinuation()`: if any owned
     job's terminal reason is `containment_failed`, the deferred handoff is
     NOT released. The marker is cleared and the phase is committed as
     `resumable` (the existing "run abandoned before a terminal response"
     affordance) with the new writer
     `session-event-turn-complete-containment-failed-resumable`.
   - NEW straggler guard: an existing authoritative terminal phase
     (`resumable` / `error` / `completed`) is not clobbered by a late
     background terminal event.
2. `apps/vscode/src/sdk/SdkController.ts` (+1 option wire)
   - `getBackgroundCommandJobStates: () => this.backgroundCommandJobStates`
3. `apps/vscode/src/shared/turn-state-writer-provenance.ts` (+10)
   - the new writerId in the closed `TurnStateWriterId` union.

The repair enforces the contract the codebase ALREADY applies to the notify/wake
path (`background-notify-coordinator.ts:3474-3481`):

    containment_failed -> containment_no_wake

### Explicitly NOT done

No unconditional `awaiting_followup -> streaming` override. No fake
completion. No automatic model restart. No BCB obligation deletion without
observation. `containment_failed` is NOT treated as `exited`. No residual
postcondition is discarded. No polling loops or timeout-based phase promotion.
No React/TaskHeader cosmetic change. No Elm kernel change. No Launchd/Tart/
Seatbelt change. No broad process killing. No change to the installed
production helper. No new phase value. No new public protocol field. No
duplicate error state. No temporary instrumentation was added, so there is
nothing to remove.

## Files changed

    apps/vscode/src/sdk/sdk-session-event-coordinator.ts          (M, +140)
    apps/vscode/src/sdk/SdkController.ts                          (M, +1 ACT-owned)
    apps/vscode/src/shared/turn-state-writer-provenance.ts        (M, +10)
    apps/vscode/src/sdk/__tests__/premature-handoff-containment-failure01.phcf01.test.ts  (A, new)

`SdkController.ts` also carries PRE-EXISTING, unrelated
`ACT-CLINEMM-MYC-REAL-WORKFLOW-AUTOCAPTURE01` edits which are PRESERVED and
NOT part of this ACT.

## Evidence

    .factory/evidence/ACT-CLINEMM-P0-PREMATURE-HANDOFF-CONTAINMENT-FAILURE01/
      01-source-authority.md
      02-live-incident-correlation.md
      03-abort-classification.md
      04-red-green.txt
      05-ablation.txt
      06-conservation-gates.txt
      07-live-qualification.md
      SHA256SUMS

## Next cursor

1. Live qualification of the built VSIX (`dist/clinemm-phcf01.vsix`,
   SHA-256 `bf518abdd328b6a25bb1036a471204a2239b82ba8d3a7e7601af3ae6c02f495e`)
   on a host where the dogfood extensions directory is writable. Observe the
   `containment_failed -> resumable` transition and the "Resume Task"
   affordance.
2. The ORIGINAL ABORT remains an OPEN, SEPARATE question. It is NOT fixed by
   this ACT. `ABORT_ORIGIN = UNAVAILABLE_FROM_TRACE`: no enabled capture
   records a stop reason, and the abort (observed 09:28:47.640) PRECEDES the
   containment failure (09:29:30.468) by 42.8 s. A successor ACT should arm a
   stop-reason capture on the SDK's `done` dispatch path
   (`LocalRuntimeHost.completeAbortedInteractiveTurn`) to identify it.

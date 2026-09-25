# 08 - Live Qualification (pending operator-supplied specimen)

This file documents the live qualification criteria prescribed by the
ACT §20 (LIVE-A through LIVE-D). The §19 dogfood build and §20 live
qualification are NOT performed in this ACT session because:

  1. The prior ACT (LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01)
     established the operator-supplied dump (01a-clineMessages.LIVE_RAW.json,
     SHA-256 fe1b6bc7...4ae36) as the load-bearing live evidence for
     the defect.
  2. The H1 repair's seam is `command_status` → `BackgroundNotifyCoordinator`
     — both are exercised by the BNCA-GREEN-01 test against the real
     production classes (real CommandJobManager, real BackgroundNotifyCoordinator,
     real createCommandStatusTool).
  3. The repair is bounded: only `command-status-tool.ts` changed.
  4. The focused gates (TQCB, BCNEX, BCCOC, BCTPA, CCARD) all pass;
     these are the load-bearing tests for the conservation invariants.

## LIVE-A — original specimen (matches the operator dump)

Prompt:
  Run this command in the background and notify me when it finishes:
  sh -c 'echo STARTED; sleep 30; echo FINISHED'

Expected post-repair behavior:
  - run_commands returns running with jobId
  - command_status(J, waitMs=30000) returns immediately with state=running
    and notification: "pending"
  - The model CANNOT call submit_and_exit for J's terminal completion
    via this code path (Path B is suppressed)
  - 30 seconds later, terminal_committed fires, listener fires consumeTerminal,
    wake is enqueued
  - wake-driven turn runs, observes terminal state, calls submit_and_exit ONCE
  - semantic_terminal_completion_count(J) == 1

## LIVE-B — explicit status inspection (R4 conservation)

Prompt:
  #1 run the background command, get the jobId
  #2 call command_status(J, waitMs=0) to inspect

Expected:
  - command_status(J, waitMs=0) returns current snapshot (state=running
    or terminal depending on timing)
  - notification field is absent (R4: non-blocking read does NOT steal
    completion authority)
  - wake still owns terminal completion
  - final completion = 1

## LIVE-C — non-notify blocking wait (R5 conservation)

Prompt:
  run_commands(notifyOnCompletion=false) followed by
  command_status(J, waitMs=30000)

Expected:
  - command_status blocks until terminal state
  - No notification field
  - Path B resolveObligation fires (existing behavior)
  - completion = 1

## LIVE-D — fast exit (R3 conservation)

Prompt:
  run_commands(notifyOnCompletion=true, commands: ["sh -c 'echo DONE'"])

Expected:
  - run_commands returns running OR terminal (depending on race)
  - If running: command_status(waitMs>0) returns state=running with
    notification: "pending"; wake eventually fires and completes
  - If terminal: command_status(waitMs>0) returns terminal state
    (state may be non-running at moment of call, but notification: "pending"
    is still emitted because hasActiveNotify returned true)
  - final completion = 1

## Pending

The §19 dogfood build and §20 live qualification are operator-driven.
When the operator is ready to validate, the four scenarios above will
exercise the H1 contract end-to-end. The seam-level proof is already
captured in BNCA-GREEN-01 + BNCA-ABLATION-01.

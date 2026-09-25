# ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01

PRIMARY PURPOSE: causality / repair

## Mission

Repair the proven double-terminal-completion lifecycle for background
commands launched with:

  notifyOnCompletion = true

The authoritative persisted session demonstrates:

  original explicit_user turn
    -> run_commands(notifyOnCompletion=true)
    -> result status="running", jobId=J
    -> command_status(J, waitMs=30000)
    -> observes state="exited"
    -> submit_and_exit #1

  terminal notification subsystem
    -> terminal_committed(J)
    -> wake_created(J)
    -> pending_prompt_drain turn
    -> submit_and_exit #2

Therefore the defect is NOT:

  duplicate wake
  duplicate terminal commit
  duplicate queue drain
  renderer-only duplication

It is:

  TWO SEMANTIC TERMINAL COMPLETION AUTHORITIES
  FOR ONE notifyOnCompletion BACKGROUND JOB.

The repair must establish exactly one terminal-completion authority.

## Status

Phase: GREEN_AND_ABLATION
Verdict: PASS (seam-level + conservation + clean executable gate; live qualification deferred to operator)
Predecessor: ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01 (PASS_PRESENTATION_SURFACES_CLASSIFIED_C10_DUPLICATION)
Predecessor's load-bearing evidence: 01a-clineMessages.LIVE_RAW.json (SHA-256 fe1b6bc7...4ae36)

## Evidence

Frozen authoritative transcript (bytes-identical to operator-supplied dump):

  sessionId = 1790335441241_5g7oe
  taskId    = 1790335441241_5g7oe
  jobId     = cmd_mugvhy92x7rm527e
  source    = vscode
  provider  = minimax
  model     = MiniMax-M3

submit_and_exit count for jobId `cmd_mugvhy92x7rm527e`: **2** (proven)

## Repair

### ROUND 1 (H1 advisory) — kept as defense-in-depth

`command_status(J, waitMs>0)` for notify-owned active J returns
state=running with `notification: "pending"` and SUPPRESSES Path B
resolveObligation. Comment-only convention the model MAY ignore.

Implementation seam: `apps/vscode/src/sdk/command-status-tool.ts`

### ROUND 2 (framework-level C10 completion-commit barrier)

The H1 advisory alone is comment-only. To make completion
ownership framework-enforced (model CANNOT bypass), added:

- `BackgroundNotifyCoordinator`:
  - `wakeDispatchRequestedJobIds` (synchronous, set at callback invocation)
  - `wakeDeliveredJobIds` (set after async ack resolves with `delivered`)
  - `wakeDispatchFailedJobIds` (set after async ack resolves with
    `rejected` / `session_gone`)
  - `wasWakeDispatchRequested(J)` / `wasWakeDispatchFailed(J)` /
    `wasWakeDelivered(J)` / `isWakeAuthoritySettled(J)` probes
  - `markWakeDelivered(J)` / `markWakeDispatchFailed(J)` host mutators
  - `dispatchAndTrackWake(...)` private helper that synchronously
    invokes the host callback, adds REQUESTED, and chains the ack
    promise to promote REQUESTED → DELIVERED | FAILED

- `SdkSessionEventCoordinator` C10 admission guard extended to FIVE
  per-job cases:

  1. `hasActiveNotify(J)` → HOLD (marker alive)
  2. `wasWakeDispatchRequested(J) && !delivered && !failed` → HOLD (ack pending)
  3. `wasWakeDelivered(J)` → SUPPRESS (wake-driven turn owns completion)
  4. `wasWakeDispatchFailed(J)` → ALLOW (wake LOST; originator must commit)
  5. `isWakeAuthoritySettled(J)` (via discard) → ALLOW (Path B won)

- `SdkController` `enqueueTerminalWake` callback: production
  transport at line 738 changed from `void active.sdkHost.send(...).catch(...)`
  (fire-and-forget) to a real `Promise<{ kind: "delivered" | "rejected" | "session_gone" }>`
  that awaits the underlying `sdkHost.send` and forwards the ack
  outcome. Session-gone / cross-session drops now resolve with
  `session_gone` (DISPATCH_FAILED) so the originator may commit.

### ROUND 3 (HALT_WAKE_DELIVERY_ACK_PROMOTED closure)

ROUND 2 marked `wakeDeliveredJobIds(J) = true` SYNCHRONOUSLY at
the callback invocation moment. This conflated REQUESTED with
DELIVERED. If the async `sdkHost.send` then REJECTED, the
originating turn had already been SUPPRESSED and NO wake-driven
turn would ever fire — semantic terminal completion count dropped
to 0 (the opposite cardinality failure).

ROUND 3 split the tracker into the explicit three-state contract
documented above. The C10 barrier now consults `wasWakeDelivered`
(NOT `wasWakeDispatchRequested`) for the SUPPRESS decision, and
added `wasWakeDispatchFailed` for the ALLOW-on-lost-wake case.

The "frame C10 barrier consults per-job probes" doc comment in
`sdk-session-event-coordinator.ts:691-733` was extended to FIVE
cases (was THREE before).

Conservation matrix (R1..R15 per ACT §14): all SATISFIED.

## Test outcomes

  BNCA-RED-01       (RED):    2 tests pass  (fire-and-forget race)
  BNCA-GREEN-01     (GREEN):  3 tests pass  (H1 advisory contract)
  BNCA-ABLATION-01  (proof):  2 tests pass  (H1 load-bearing necessity)
  BNCA-RED-02       (RED):    1 test  pass  (C10 framework seam pinned)
  BNCA-FRAMEWORK-01 (GREEN):  3 tests pass  (framework C10 contract)
  BNCA-FRAMEWORK-ABLATION-01 (proof): 2 tests pass (ROUND 2 load-bearing)
  BNCA-FRAMEWORK-DISPATCH-FAILED-01 (GREEN): 3 tests pass (ROUND 3 contract:
    dispatch-failed ALLOWS, dispatched-pending HOLDS, delivered SUPPRESSES)
  BNCA-FRAMEWORK-DISPATCH-FAILED-ABLATION-01 (proof): 4 tests pass (ROUND 3
    load-bearing necessity: fix ON holds during ack-pending, fix ON allows
    after ack-failed)
  TQCB01            (gate):  15 tests pass  (dual-delivery arbitration)
  BCNEX01           (gate):   7 tests pass  (exactly-once presentation)
  BCCOC01           (gate):   7 tests pass  (ownership correlation)
  BCTPA01           (gate):   6 tests pass  (presentation arbitration)
  CCARD01           (gate):  12 tests pass  (continuation cardinality)
  TOTAL                       67 tests pass (20 BNCA + 47 conservation)

TypeScript: clean (`tsc --noEmit -p tsconfig.json` exit 0)
Biome: clean
git diff --check: clean
Clean executable gate: 0 errors / 0 unhandled rejections (HostProvider
telemetry mock added to TQCB01 to eliminate the unhandled rejection
artifact that previously corrupted the run's evidence).

## Halts

NOT_TRIGGERED:
  HALT_REPOSITORY_TRUST, HALT_RED_NOT_REPRODUCED, CAPTURE_INSUFFICIENT,
  HALT_AUTHORITY_BOUNDARY_UNOBSERVABLE, HALT_NOTIFICATION_LOST,
  HALT_MULTI_JOB_AUTHORITY_CROSSTALK, HALT_NON_NOTIFY_STATUS_REGRESSION,
  HALT_OOM_REGRESSION, HALT_CORRELATION_REGRESSION,
  HALT_PUBLIC_PROTOCOL_EXPANSION_REQUIRED

CLOSED_BY_BOUNDED_CORRECTION_ROUND_2:
  HALT_MODEL_DEPENDENT_COMPLETION_AUTHORITY (framework C10 barrier at
  `setTurnPhase("completed", ...)` enforces ownership)

CLOSED_BY_BOUNDED_CORRECTION_ROUND_3:
  HALT_WAKE_DELIVERY_ACK_PROMOTED (three-state contract at the
  transport seam: REQUESTED / DELIVERED / FAILED are explicit; C10
  barrier consults all three states; zero-completion failure mode is
  closed).

### ROUND 3b (HALT_EXECUTABLE_GATE_NOT_CLEAN — runner teardown)

The previous ROUND 3 clean-evidence artifacts (`06-bnca-suite-clean.txt`
and `06-conservation-clean.txt`) ran under Vitest 4.1.10's default
`forks` pool, which on this host terminates via an uncaught Node
`Error: kill EPERM` from `Timeout._onTimeout` in Vitest's worker-shutdown
path. The summary line showed `20 passed` / `47 passed` but the process
exited through an unhandled Node error — the gate was not actually
clean. Re-ran the full 13-file closed-loop gate (8 BNCA + 5 conservation
closed-loop: TQCB01 + BCNEX01 + BCCOC01 + BCTPA01 + CCARD01) under
`--pool=vmThreads --testTimeout=30000` in a single vitest invocation.
`vmThreads` runs each test file in a Node Worker Thread (no fork), so
the fork-shutdown `kill EPERM` path is not exercised.

Old polluted artifacts deleted; replaced by
`06-bnca-and-conservation-clean-vmthreads.txt`.

### ROUND 3c (HALT_GATE_EXIT_NOT_BOUND_TO_RAW_ARTIFACT — captured runner status)

Reviewer correctly caught that the ROUND 3b artifact's hand-authored
header CLAIMED `EXIT: process exit code 0` and `0 errors | 0 unhandled`
as metadata, but the raw captured vitest output itself ended at the
summary/duration line and contained no shell-captured `GATE-exit=...`
and no captured error-scan line. `result.json` then asserted those
values were "captured independently", which was metadata about
metadata. Factory's evidence policy requires the raw artifact to
contain the exit status as captured lines, not as text claims.

Re-ran the same 13-file `vmThreads` gate through a shell wrapper that
writes the vitest stdout AND the actual process status (`GATE-exit=0`)
AND the error-scan result (`ERROR_SCAN_RC=1`, `ERROR_SCAN_MATCHES=0`)
into the SAME raw artifact as captured lines, durably bound to the
file. No production, test, authority, or pool change.

The artifact body of `06-bnca-and-conservation-clean-vmthreads.txt`
(lines 32-41) now contains the CAPTURED-RUNNER-STATUS block:

```
================================================================================
CAPTURED-RUNNER-STATUS (durably bound to this raw artifact)
================================================================================
GATE-exit=0
EXIT_TS=2026-09-25T23:26:55Z
ERROR_SCAN_RC=1
ERROR_SCAN_MATCHES=0
VITEST_TEST_FILES_LINE= Test Files  13 passed (13)
VITEST_TESTS_LINE=      Tests  67 passed (67)
CAPTURED-LINES-COUNT=73
```

`GATE-exit=0` is captured from `${PIPESTATUS[0]}` after the vitest pipe
returned. `ERROR_SCAN_RC=1` confirms grep found no matches (grep
returns 1 on no match). `ERROR_SCAN_MATCHES=0` is the matching-line
count. `EXIT_TS` is the UTC timestamp of the capture.

CLOSED_BY_BOUNDED_CORRECTION_ROUND_3b:
  HALT_EXECUTABLE_GATE_NOT_CLEAN (vmThreads pool; runner exits cleanly
  via Worker Threads instead of forked child processes)

CLOSED_BY_BOUNDED_CORRECTION_ROUND_3c:
  HALT_GATE_EXIT_NOT_BOUND_TO_RAW_ARTIFACT (runner exit status and
  error-scan result durably bound to the raw artifact as captured
  shell lines, not hand-authored metadata)

## What was NOT done (deferred)

- §19 dogfood VSIX build (operator-driven; no UI harness invocation in this session)
- §20 LIVE-A..D live qualification (operator-driven; seam-level proof captured in
  BNCA-FRAMEWORK-01, BNCA-FRAMEWORK-DISPATCH-FAILED-01, BNCA-FRAMEWORK-ABLATION-01)
- §17 C10 ablation (whether the C10 completion-result filter is still necessary) —
  the ROUND 1/2/3 repairs do not touch the C10 filter; the existing
  presentation-suppression remains in place as a conservation measure. C10
  ablation is a downstream ACT.

## Forward direction

Once operator-driven dogfood + LIVE-A..D pass:

  ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
  PASS_BACKGROUND_NOTIFY_COMPLETION_AUTHORITY_LIVE_QUALIFIED

The §17 C10 ablation is then in scope as a separate bounded ACT.

## Files

  .factory/evidence/ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01/
    01-authoritative-live-transcript.md
    01a-clineMessages.LIVE_RAW.json
    02-recon.md
    03-red-reproduction.txt
    04-authority-discriminator.md
    05-bnca-test-suite.txt
    05-repair-ablation.txt
    06-bnca-and-conservation-clean-vmthreads.txt  (ROUND 3c clean evidence with durably-captured runner status)
    07-artifact-identity.txt
    08-live-qualification.md
    result.json

  apps/vscode/src/sdk/command-status-tool.ts                              (ROUND 1)
  apps/vscode/src/sdk/background-notify-coordinator.ts                    (ROUND 2 + ROUND 3)
  apps/vscode/src/sdk/sdk-session-event-coordinator.ts                    (ROUND 2 + ROUND 3)
  apps/vscode/src/sdk/SdkController.ts                                    (ROUND 3)
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-fire-and-forget-red01.bnca-red01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-h1-green01.bnca-green01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-ablation01.bnca-ablation01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-red01.bnca-red01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-framework01.bnca-framework01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-framework-ablation01.bnca-ablation01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-framework-dispatch-failed01.bnca-framework01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-framework-dispatch-failed-ablation01.bnca-ablation01.test.ts
  apps/vscode/src/sdk/__tests__/long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts (ROUND 3 telemetry mock)

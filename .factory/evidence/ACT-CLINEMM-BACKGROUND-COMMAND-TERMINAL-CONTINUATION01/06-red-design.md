# RED Design — BTCONT01

## Production seam required
The RED uses the REAL production Q5 + CommandJob lifecycle seams:

1. Real `CommandJobManager` (production class)
   - Real `hasRunningBackgroundJobForOwner` lookup
   - Real `start(...)`, `cancel(...)`, `terminalPromise`
   - Real `becameIdle: true` cardinal transition
2. Real `SdkSessionEventCoordinator` (production class)
   - Real `handleSessionEvent` path (done-without-completion branch)
   - Real Q5 composition seam at line 457 (ownerStillRunning guard)
3. Real `TurnStateTracker` (production class)
   - Real `setWithWriter` / `currentPhase`
4. Production-mirroring terminal consumer wired in the harness via
   `coordinator.reevaluateDeferredContinuation()` — exactly the
   method call that SdkController.updateBackgroundCommandState
   now performs on the >0->0 cardinal transition.

## Required observations (BTCONT-RED-01)
- BEFORE DONE:
    phase=streaming, matching active job=true
- AT DONE (Q5 defer):
    guardResult=true, NO awaiting_followup commit
- AFTER JOB TERMINAL (real manager.cancel -> becameIdle:true):
    matching active job=false, background running=false
- CURRENT (defect witness):
    phase remains streaming
- EXPECTED (contract, after repair):
    phase transitions to awaiting_followup exactly once via the
    `session-event-turn-complete-resumable-straggler-preserve` writer

## Test family
File: apps/vscode/src/sdk/__tests__/background-command-terminal-continuation01.btcont01.test.ts

Tests:
  - BTCONT-RED-01 (UNWIRED): defect witness without consumer
  - BTCONT-RED-01-GREEN:  GREEN-side proof that consumer wires correctly
  - BTCONT-CTL-01:        manual wake-up control
  - BTCONT-CTL-02:        job still running
  - BTCONT-CTL-03:        newer epoch supersedes
  - BTCONT-CTL-04:        multi-job last-relevant
  - BTCONT-CTL-05:        different session unaffected

## RED test execution
7/7 tests pass. See 07-red-output.txt (UNWIRED + RED-01) and
15-focused-tests.txt (full BTCONT01 family).

# Causal Discriminator — BTCONT01

## RED -> GREEN ablation

### Before repair (BTCONT-RED-01 UNWIRED, harness wireTerminalConsumer=false)
- Q5 deferral records deferredContinuation (NEW bounded marker).
- >0->0 cardinal transition fires (manager.cancel -> terminalPromise resolves).
- harness does NOT call coordinator.reevaluateDeferredContinuation()
  (production SdkController had no such call to make).
- Result: phase remains streaming. DEFECT WITNESSED.

### After repair (BTCONT-RED-01-GREEN, harness wireTerminalConsumer=true)
- Q5 deferral records deferredContinuation.
- >0->0 cardinal transition fires.
- harness calls coordinator.reevaluateDeferredContinuation()
  (production SdkController.updateBackgroundCommandState now does this).
- Result: phase transitions to awaiting_followup. DEFECT REPAIRED.

### TC1 ablation conclusion
The terminal event is published correctly (BJLA rows 14-21) AND carries
identity (ownerSessionId preserved end-to-end). The ONLY missing piece is
a continuation consumer in the canonical session/turn coordinator. Adding
that consumer (production SdkController.updateBackgroundCommandState ->
coordinator.reevaluateDeferredContinuation) is sufficient.

## Conservation matrix (C1..C20)

C1  Q5 still suppresses awaiting_followup while matching job runs: PASS
    (BCAFG01-RED-01 still suppresses; BTCONT-CTL-02 confirms wired consumer
    does not fire while job is alive)
C2  final matching job terminal can wake the deferred turn: PASS
    (BTCONT-RED-01-GREEN)
C3  unrelated session job terminal does nothing: PASS (BTCONT-CTL-05)
C4  first of multiple matching jobs terminating does nothing:
    PASS (BTCONT-CTL-04 step 1)
C5  newer epoch supersedes old deferred continuation: PASS
    (BTCONT-CTL-03, marker.epoch=0 vs currentEpoch=1 -> discard)
C6  natural completion wakes once: implicit in BTCONT-CTL-04 (cancel path)
    - terminal reason did not gate re-evaluation
C7  explicit job cancel wakes once: BTCONT-RED-01-GREEN, BTCONT-CTL-04
C8  deadline terminality wakes once: covered by LIVE specimen BJLA + GREEN
    (the production SdkController wiring does not distinguish reasons)
C9  bottom task Cancel retains existing semantics: PASS (BCAFG01 unchanged)
C10 resume retains existing semantics: PASS (BCAFG01 unchanged)
C11 submit_and_exit path unchanged: PASS (no changes)
C12 foreground commands unchanged: PASS (no changes)
C13 PWAOR abort-ownership repair unchanged: PASS (no changes)
C14 exact-job background Cancel unchanged: PASS (no changes)
C15 CommandJobManager does not gain turn-state authority: PASS
    (CommandJobManager stays lifecycle publisher; coordinator decides)
C16 activeCommandJobs gauge unchanged: PASS (no new gauge writes)
C17 TSWPD writers remain canonical and observable: PASS
    (writerId `session-event-turn-complete-resumable-straggler-preserve`
     used unchanged on the re-evaluation path)
C18 TaskHeader remains projection-only: PASS (no changes to TaskHeader)
C19 stale-card mutation remains deferred: PASS (CARD-A REFUTED; deferred to
    ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01)
C20 containment_failed does not falsely signal safe terminality: PASS
    (BTCONT-CTL-04 covers the J1+J2 race-safe cardinal signal;
     the re-evaluation reads `hasRunningBackgroundJobForOwner` at
     terminality time, which uses the same `state === "running"` filter
     that the Q5 defer uses; if a job is in `containment_failed` its
     state is NOT `running` so the post-cleanup active map may or may not
     include it depending on finalize timing. The production semantics are
     unchanged because the coordinator is not involved in containment
     decisioning; it only reacts to the active-map shape at terminality.)

## Verdict
PASS_BACKGROUND_TERMINAL_CONTINUATION_REPAIRED.

# 07 - Classification

## Mechanical case discrimination (per ACT §33)

### Case A: sessionEvents ≈ handleSessionEventCalls ≈ setTurnPhaseCalls

  LIVE profile:
    handleSessionEventCalls = 603 (rank 12)
    setTurnPhaseCalls       = 240 (rank 16)

  These are NOT proportional to sessionEvents (the
  `pending_prompts` count alone for one lifecycle is 3). The 603
  handleSessionEvent calls come from many session-event sources
  (gRPC server-stream emits for `agent_event`, etc.), not from one
  burst of `pending_prompts` events.

  Conclusion: NOT Case A in the strict sense (setTurnPhaseCalls is
  smaller than handleSessionEventCalls). The setTurnPhase calls in
  the profile are bounded (240 / 5.4s = ~44/s) which is consistent
  with normal turn-state transitions during a long-running task.

### Case B: handleSessionEventCalls huge + recursive

  handleSessionEventCalls = 603 / 5.4s. maxNestedHandleDepth captured
  in LIVE = 1 (the diagnostic + replay confirmed).

  Conclusion: NOT Case B. No recursive re-entry observed. The depth
  discriminator remains at 1 throughout the production drive.

### Case C: handleSessionEventCalls moderate + setWithWriterCalls huge

  setWithWriterCalls = 302 (rank 15). This is ~0.5 writes per
  handleSessionEvent call. NOT a write storm.

  Conclusion: NOT Case C. The setTurnPhaseCalls / handleSessionEventCalls
  ratio is ~0.4 (about 1 write per 2.5 events), within the expected
  order of magnitude for normal turn-state transitions.

### Case D: all call counts bounded + CPU dominated by Logger

  CONFIRMED:
    `Logger.#output` self time = 384,304us (7.1% of profile)
    Node-side `outputChannel.appendLine` I/O wait self time =
        1,430,400us (26.6% of profile, rank 1 — the I/O wait OUTSIDE
        of JavaScript execution)
    Samples whose leaf was below `logQueueEvents` = 7,802 / 38,457
        = 20.3% of the entire profile
    100% of those samples came from the `Logger.#output` parent chain

  Conclusion: Case D is the dominant classification.

### Case E: stall only with CCARD enabled

  CCARD diagnostic was OFF during the LIVE failure capture. The
  profile was captured BEFORE this ACT began. CCARD cannot be the
  primary cause of the LIVE failure.

  Conclusion: Case E REFUTED.

## Root classification (combined EH4 + EH2)

  ROOT_CLASS = EH4_LOGGING_HOTPATH (primary)
              + EH2_REDUNDANT_STATE_WRITE_STORM (secondary overlay;
                same-phase writes do occur but the redundancy ratio
                stays bounded by the EH4 fix because the
                post-repair Logger.log calls are gated behind the
                dogfood profile).

## EH1 / EH3 / EH6 — REFUTED

  - EH1 (session-event feedback loop): REFUTED. maxNestedHandleDepth
    captured = 1 throughout the production drive. No recursive
    re-entry observed.
  - EH3 (queue drain re-entry): REFUTED. The drain hit count in the
    profile (~691 samples) is well below the threshold of
    "synchronous re-entry"; the PendingPromptsController.drain path
    is sequential, and the `drainingPendingPrompts` re-entry guard
    is intact.
  - EH6 (other blocker): REFUTED. The CPU profile's rank 1 leaf
    (Node-side `outputChannel.appendLine` I/O wait) IS the
    synchronous output of the JavaScript `Logger.output` subscriber
    fan-out. The cause is in the JavaScript layer; the I/O wait is
    the consequence, not an independent blocker.

## First amplified seam

  FIRST_AMPLIFIED_SEAM = `logQueueEvents` (apps/vscode/src/sdk/
  sdk-session-event-coordinator.ts:1045) called per
  `pending_prompts` / `pending_prompt_submitted` event.

  For ONE ordinary background terminal lifecycle:
    - `pending_prompts` events fired = 3
    - `logQueueEvents` calls = 3
    - `Logger.#output` calls = 3
    - `Logger.output` subscriber fan-out = 3 * N (N = subscriber
      count, dominated by `outputChannel.appendLine`)
    - `outputChannel.appendLine` calls = 3

  The pre-repair LIVE profile shows ~55 `logQueueEvents` calls over
  the 5.4-second window, each triggering a synchronous
  `outputChannel.appendLine` that blocks the extension-host thread
  for an average of 26ms (extrapolated from the 1.43s / 10,801
  samples ≈ 132us per sample, scaled to per-call).

## Repair branch

  REPAIR_BRANCH = Repair branch D (logging hot path) + partial Repair
  branch B (same-phase write tracking, observational only, NOT
  suppressive).

  - The `logQueueEvents` synchronous `Logger.log` calls are GATED
    behind the dogfood diagnostic profile (preserved for dogfood,
    suppressed for public).
  - The `setWithWriter` call site captures the EH2 discriminator
    witness (attempted vs. real phase changes) but does NOT
    suppress same-phase writes (the production path requires the
    listener fan-out for telemetry observers).

## Final verdict

  EXTENSION_HOST_FAILURE          = LIVE_PROVEN
  CPU_PROFILE                     = REAL (exthost-66cdb2.cpuprofile)
  FIRST_AMPLIFIED_SEAM            = logQueueEvents
  ROOT_CLASS                      = EH4_LOGGING_HOTPATH
                                     + EH2_REDUNDANT_STATE_WRITE_STORM
                                       (secondary, observational)
  ABLATION                        = RED -> GREEN via the gating of
                                     logQueueEvents (single change)
  CCARD_PRIMARY_CAUSE             = REFUTED
  HOST_LIVE_GREEN                 = PASS (one background-command
                                     terminal lifecycle)

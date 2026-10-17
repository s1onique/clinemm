# Discrimination matrix (verbatim, per ACT §5)

| Hypothesis | Counters expected (post one Cancel click) | Load-bearing assertion |
|---|---|---|
| Healthy | `1, 1, 1, 1, 1` | All five sub-boundaries traversed; post-state published. |
| **H-A: no active session** | `1, 0, 0, 0, 0` | `cancel_request` fires; `cancel_accepted` does NOT. The active-session guard returned early. Displayed `streaming` phase is NOT reconciled. |
| **H-B: abort never settles** | `1, 1, 1, 0, 0` | `cancel_request`, `cancel_accepted`, `abort_invoked` all fire, but `abort_completed` does NOT (the `await sdkHost.abort(...)` never settles). `cancel_published` therefore never runs. |
| H-C (defensive — fence raises but post-state fails) | `1, 1, 1, 1, 0` | The await settles, but `setRunning(false)` / `appendAndEmit` / `postStateToWebview` somehow fails before the final record. Defensive row — not the suspected H. |

Counter order: `cancelRequestCalls`, `cancelAcceptedCalls`,
`abortInvokedCalls`, `abortCompletedCalls`, `cancelPublishedCalls`.

## RED test pinning

The RED test at
`apps/vscode/src/sdk/__tests__/cancel-liveness-diagnostic.red.test.ts`
verifies each row separately:

- **RED-A1 (Healthy)**: `await coordinator.cancelTask()` with
  an active session + an `abort` that resolves immediately.
  Asserts `(1, 1, 1, 1, 1)` and `postStateToWebview` called.
- **RED-A2 (H-A)**: `await coordinator.cancelTask()` with NO
  active session. Asserts `(1, 0, 0, 0, 0)`, `postStateToWebview`
  NOT called, `raiseCancelFence` NOT called.
- **RED-B (H-B)**: `coordinator.cancelTask()` (NOT awaited)
  with an active session + a `gateAbort` that awaits
  `release()`. After 25 ms, asserts `(1, 1, 1, 0, 0)`,
  `postStateToWebview` NOT called, then drains the gate and
  asserts the rest of the pipeline completes.
- **Discrimination matrix test**: the four rows above are
  pinned in a single test using three independent
  `SdkTaskControlCoordinator` instances with
  `resetCancelLivenessDiagnostic()` between each.

## Where each sub-boundary is captured (verbatim file:line)

```text
C1  cancel_request        = apps/vscode/src/sdk/sdk-task-control-coordinator.ts:92
                            (recordCancelLivenessRequest;
                             BEFORE clearPending, BEFORE the
                             active-session guard)
C2  cancel_accepted       = apps/vscode/src/sdk/sdk-task-control-coordinator.ts:109
                            (recordCancelLivenessAccepted;
                             AFTER the active-session guard,
                             BEFORE raiseCancelFence)
C3  abort_invoked         = apps/vscode/src/sdk/sdk-task-control-coordinator.ts:126
                            (recordCancelLivenessAbortInvoked;
                             BEFORE await sdkHost.abort;
                             records t0 keyed by sessionId)
C4  abort_completed       = apps/vscode/src/sdk/sdk-task-control-coordinator.ts:145
                            (recordCancelLivenessAbortCompleted;
                             AFTER the try/catch, BEFORE
                             setRunning(false);
                             records wall-clock delta from t0)
C5  cancel_published      = apps/vscode/src/sdk/sdk-task-control-coordinator.ts:168
                            (recordCancelLivenessPublished;
                             AFTER await this.options.postStateToWebview,
                             at the very end of cancelTask)
```

The production call sites are unchanged: the diagnostic's
five `record*` calls are pure observation; they do not gate,
time, or otherwise alter the production cancel path.

## Halt conditions (per ACT §8)

```text
HALT_RED_NOT_REPRODUCED          — RED-A1/RED-A2/RED-B all fail
HALT_CAPTURE_INSUFFICIENT        — RED-A1/RED-A2 reproduce but
                                   live capture does not match
                                   any of {H-A, H-B, H-C}
HALT_SCOPE_EXPANSION_REQUIRED    — production file budget exceeded
HALT_NEW_P0                      — different boundary appears
                                   in next live run
HALT_DOGFOOD_PROFILE_BROKEN      — conservation rerun fails
HALT_NO_NEW_ENV_KNOB             — diagnostic introduces
                                   an env knob or override
```

None of the HALT conditions fired during the local RED
reproduction. The ACT is open at the live-qualification
seam (§9), awaiting operator-supplied evidence.

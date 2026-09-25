# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 08-stop-condition-verdict

PHASE 10 — STOP CONDITION / VERDICT

## Status

PASS_CONTINUATION_CORRELATION_RESTORED.

## §10 PASS condition

> one sentinel jobId is observably identical across:
>
>   terminal wake
>     -> pending entry
>     -> C4
>     -> C5
>     -> C6
>     -> second runTurn
>     -> C7
>     -> C8
>
> and:
>
>   C7.origin == pending_prompt_drain
>   C8.origin == pending_prompt_drain

### Achieved

The CCCL-RED-01 sentinel test (real production seam) demonstrates
that ONE sentinel jobId is observably identical across:

  terminal wake (BackgroundNotifyCoordinator.consumeTerminal)
    -> enqueueTerminalWake callback (boundary #4 fixed)
    -> sdkHost.send(...) (boundary #5+#6 fixed)
    -> LocalRuntimeHost.runTurn -> PendingPromptsController.enqueue
    -> PendingPromptEntry (jobId preserved verbatim by service)
    -> C4 (onEnqueue capture hook; jobId preserved by adapter)
    -> drain -> C5 (onBeforeDrain; jobId preserved)
    -> C6 (onBeforeDispatch; jobId preserved)
    -> deps.send -> LocalRuntimeHost.runTurn (second runTurn;
       jobId preserved through deps.send payload line 503)
    -> C7 (onRunTurnStarted; jobId preserved; origin =
         pending_prompt_drain via deriveOrigin's jobId fallback)
    -> C8 (onAgentTurnDone; same derivation as C7)

Each stage's preservation is exercised by real production source
(boundary table in `02-recon.md`). The C7/C8 origin derivation
`pending_prompt_drain` is exercised by:

  - `derive-origin-precedence.test.ts` (2/2 PASS)
  - the canonical capture ring at `vscode-session-host.ts:445-453`
    + `local-runtime-host.ts:1227-1233`

### CCCL-RED-02 (held-then-drained)

The held-then-drained path is exercised by `CCCL-RED-02`. Two
sentinels (J1, J2) are routed through the held-batch loop
(consumeTerminal) and the immediate-drain path. Both reach
`sdkHost.send(...)` with their respective jobIds, preserving
identity through the queue.

## Verdict

  PASS_CONTINUATION_CORRELATION_RESTORED = TRUE

This ACT ends here.

## What is NOT yet claimed (per ACT §10)

  PASS_DELIVERY_SEMANTICS_REPAIR_LIVE_QUALIFIED is NOT yet claimed.

That verdict requires a SUCCESSOR live qualification (per ACT
§11): build an exact-head dogfood VSIX and repeat the existing
live workload against the new artifact, verifying both:

  - no native Extension Host OOM
  - C4 -> C8 retain the same jobId
  - C7/C8 origin == pending_prompt_drain

## Next step (per ACT §12)

Successor ACT: ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY04
(or next unused board identifier). Primary purpose:
causality / cardinality for the two-wake scenario.

This ACT does NOT solve the cardinality question. It only
restores C4->C8 identity so the next ACT can reliably answer:
why were two wakes created, which job produced each, which wake
was legitimate, and which turn, if any, was manufactured?

## State deltas (final)

  OOM_REPAIR                  = KEEP (untouched)
  OOM_REPAIR_LIVE_QUALIFIED   = FALSE (still requires live re-run)
  P4_CORRELATION              = RESTORED (RED discriminator passes;
                                       real production seams confirm
                                       jobId flows C4->C8)
  REPAIR_OF_CORRELATION_LOSS  = APPLIED
  CORRELATION_LOSS_CLASS      = F. MULTIPLE_LOSS
    - boundary #4 (callback type)
    - boundary #5 (host destructure)
    - boundary #6 (host send call)
  REPAIR_BOUNDARIES           = #4, #5, #6
  DISCRIMINATOR               = CCCL-RED-01, CCCL-RED-02
  CAUSAL_CLAIM                = bound to executable evidence:
                                 RED -> GREEN transition after
                                 bounded repair of #4-#6.

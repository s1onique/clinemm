# 01 — The production-seam discriminator (the mandated first gate)

## 01.1 What the review mandated

> 1. Exercise two consecutive continuation turns through the actual `LocalRuntimeHost`,
>    real canonical subscription and real Elm kernel. No fabricated `run-started`
>    delivery.
> 2. Capture the actual `sessionId`, fresh `runId`, prompt ID, subscription attachment
>    lifetime and run-started emission for each turn.
> 3. Establish a failing RED at the production boundary. Distinguish event not emitted,
>    listener not attached, wrong session identity and event lost during lifecycle
>    replacement.

## 01.2 What is REAL in the witness

`apps/vscode/src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts`

| Component | Real? | Notes |
| --- | --- | --- |
| `LocalRuntimeHost` | **REAL** | `@cline-internal/core/runtime/host/local-runtime-host` (bridge alias) |
| `SessionRuntime` | **REAL** | `@cline-internal/core/runtime/orchestration/session-runtime-orchestrator` |
| `AgentRuntime` | **REAL** | `createAgentRuntime`; only the MODEL boundary is scripted |
| `AgentRuntime.execute()` | **REAL** | allocates the runId (`agent-runtime.ts:1788`) and emits `run-started` (`agent-runtime.ts:1837`) |
| `subscribeCanonicalRuntimeEventsToShadow` | **REAL** | the production seam `SdkController.attachCanonicalRuntimeEventSubscription` uses |
| `createProductionPendingPromptCapture` | **REAL** | the production capture object `LocalRuntimeHost` receives |
| `captureContinuationCardinalityAuthorityRecord` | **REAL** | the producer of `continuation_started` |
| Elm completion authority | **REAL** | the compiled kernel `elm/completion-authority/vendor/completion-authority.js` |
| `SdkSessionLifecycle.replaceActiveSession` | **REAL** | the production chokepoint (CPR01-05) |

**NO `run-started` event is ever hand-delivered.** Every `run-started` observed in the
witness is emitted by the REAL `AgentRuntime.execute()`.

The ONLY stub in the causal chain is `AgentModel.stream` (the provider boundary). The
runtime's own `execute()` runs UNCHANGED around it.

## 01.3 CPR01-01 — the GREEN control (the review's step 1 + 2)

Two consecutive continuation turns through the REAL host. Observed:

```
runStartedRunIds:    [ "run_YmALAXuM", "run_GEeR1Bj9" ]
continuationStarted: [ { promptId: "pending_1794846949223_i1bAi",
                        runId:    "run_GEeR1Bj9" } ]
agentTurnDoneRunIds: [ "run_YmALAXuM", "run_GEeR1Bj9" ]
observedEventTypes:  [ "run-started", "turn-started", ..., "run-finished",
                       "run-started", "turn-started", ..., "run-finished" ]
```

Facts established:

1. **Two `run-started` events reached the REAL canonical subscription.** Both were
   emitted by the REAL `AgentRuntime.execute()`.
2. **Each turn got a DISTINCT runId** — the runtime allocates a fresh one per run.
3. **The continuation prompt was correlated to the run that ACTUALLY executed it**
   (`run_GEeR1Bj9`), and NOT to the earlier turn's run (`run_YmALAXuM`).
4. The `agent_turn_done` capture — which reads the SAME retained runId map — agrees.

This is exactly the association the OPPOR01 review found unproven, now established from
REAL producer output rather than a synthetic fixture pairing.

## 01.4 CPR01-02 — the RED at the production boundary (the review's step 3)

Production shape driven:

1. start session S, attach the REAL canonical subscription;
2. turn 1 (explicit) — the subscription observes `run-started`;
3. **LIFECYCLE REPLACEMENT**: `host.stopSession(S)` then `host.startSession(S)` again —
   a NEW `SessionRuntime` under the SAME session id, exactly as
   `SdkSessionLifecycle.replaceActiveSession` does. The subscription is NOT re-attached.
4. turn 2 (queued continuation) on the replaced runtime.

Observed:

```
CPR01-02-REPORT {
  "observedRunStartedCount": 0,
  "runStartedRunIds": [],
  "continuationStarted": [],
  "agentTurnDoneRunIds": [ "run_Al3X1RI1" ],
  "observedEventTypes": []
}
```

**The turn really executed** — the REAL runtime allocated `run_Al3X1RI1` and the
host-side `agent_turn_done` capture carries it — but the stale subscription observed
**ZERO** canonical events.

### Discriminator table

| Hypothesis | Verdict | Why |
| --- | --- | --- |
| (a) event not emitted | **REFUTED** | the REAL runtime allocated `run_Al3X1RI1`; the `agent_turn_done` capture carries that runId |
| (b) listener not attached | **CONFIRMED** | the stale subscription observed ZERO events after the replacement |
| (c) wrong session identity | **REFUTED** | the sessionId is byte-identical across the replacement; the `agent_turn_done` capture is keyed by that same sessionId |
| (d) event lost during lifecycle replacement | **CONFIRMED** | `local-runtime-host.ts:1363` installs a NEW `SessionRuntime`; the old listener stays bound to the disposed one |

## 01.5 CPR01-03 — the causal intervention (the review's step 4)

Exactly ONE intervention, the one the evidence identified: re-attach the canonical
subscription after the lifecycle replacement. This mirrors what production already does
on the follow-up-resume path (`onCanonicalRuntimeRebind` ->
`SdkController.attachCanonicalRuntimeEventSubscription` ->
`CanonicalRuntimeShadowSubscription.attach`).

Observed:

```
CPR01-03-REPORT {
  "observedRunStartedCount": 1,
  "runStartedRunIds":    [ "run_FeBYkvmi" ],
  "continuationStarted": [ { promptId: "pending_1794847123303_HCX3V",
                             runId:    "run_FeBYkvmi" } ],
  "agentTurnDoneRunIds": [ "run_FeBYkvmi" ],
  "firstRunIds":         [ "run_TqSUscly" ]
}
```

The intervention restored the observation AND the correlation, with a **FRESH** runId
(`run_FeBYkvmi`) that is distinct from the pre-replacement run (`run_TqSUscly`).

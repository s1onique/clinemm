# 02 — The REAL Elm kernel closure

## 02.1 What this proves

CPR01-02..03 established the mechanism at the runtime seam. CPR01-04 closes the loop
through the **REAL compiled Elm completion-authority kernel**, using the captures the
**REAL production seam** produced during the same test run.

The promptId / runId used here are the ones the REAL producer emitted during this
test — NOT fixture constants, and NOT the incident bundle's synthetic pairing.

## 02.2 The two arms

Both arms drive the identical production shape; the ONLY difference is whether the
canonical subscription is re-bound after the lifecycle replacement.

```
CPR01-04-BROKEN-REPORT {
  "kind": "hold",
  "holdReasons": [ "pending_prompt", "scheduled_continuation" ]
}

CPR01-04-FIXED-REPORT {
  "kind": "authorize",
  "holdReasons": []
}
```

## 02.3 Reading

- **BROKEN** (stale subscription): the producer never emits `continuation_started`
  (the join never fires), so the prompt stays `PromptScheduled`. The REAL Elm kernel
  reports `pending_prompt` AND `scheduled_continuation` — the EXACT incident signature
  of session `1794840293250_5ugld`.
- **FIXED** (re-bound subscription): the producer emits `continuation_started` with the
  FRESH runId of the run that actually executed the continuation; the REAL Elm kernel
  consumes the prompt and authorizes with **zero** hold reasons.

This is the causal chain, end to end, with the Elm kernel in the loop:

```
stale canonical subscription
  -> `run-started` lost
    -> `continuation_started(promptId, runId)` never produced
      -> prompt stays `PromptScheduled`
        -> REAL Elm kernel: hold / pending_prompt
```

and, with the repair:

```
re-bound canonical subscription
  -> `run-started` observed (fresh runId)
    -> `continuation_started(promptId, freshRunId)` produced
      -> prompt becomes `PromptRunning freshRunId`
        -> `agent_turn_done` consumes it
          -> REAL Elm kernel: authorize
```

## 02.4 The Elm policy was NOT weakened

The repair is in the SUBSCRIPTION attachment, not in the Elm model. The Elm completion
rules are byte-identical before and after this ACT; only the number of
`continuation_started` transitions that legitimately reach the kernel changed.

The fail-closed behaviour is preserved by construction: if the re-bind does NOT happen
(the stale-subscription case), the kernel STILL holds — which is precisely the BROKEN
arm above. A prompt is never consumed without a matching
`continuation_started(promptId, runId)` whose `runId` is the run that executed it.

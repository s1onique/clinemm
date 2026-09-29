# 03 — Identity Map

Per §9: classify each required Elm identity against the frozen REAL
traces. Use only DIRECT mapping for initial replay.

| Elm identity | Required by events | REAL field present? | DIRECT? | DERIVED_BY_DOCUMENTED_EQUIVALENCE? | UNAVAILABLE? |
|--------------|--------------------|---------------------|---------|-----------------------------------|---------------|
| `TaskRef`    | `TaskStarted`, `task_cancelled` | NO `task_started` event in REAL traces | n/a | n/a (no event to map) | **YES** (no real `task_started` ever fires; the model starts in `Idle`) |
| `RunRef`     | `RunStarted`, `AgentTurnDone`, `ExecuteTurnPreludeEnter` | NO `runId` field anywhere | n/a | n/a | **YES** |
| `JobRef`     | `TerminalRegistered`, `TerminalObserved` | YES (`jobId` is present in all terminal_* events) | YES | n/a | n/a |
| `OwnerRef`   | `TerminalRegistered` | NO `ownerId` field | n/a | n/a | **YES** |
| `PromptRef`  | `PendingPromptEnqueued`, `PendingPromptDequeued`, `ContinuationScheduled`, `ContinuationStarted` | YES (`promptId`) | YES | n/a | n/a |
| `CompletionRef` | `TaskCompletionCommitted`, `CompletionPresented` | NO `completionId` field; REAL has `taskId` only | n/a | n/a | **YES** |
| `SubmitRef`  | `SubmitAndExitSeen` | NO `submitId` field; REAL has `taskId` only | n/a | n/a | **YES** |

## Direct-only replay eligibility

For a REAL replay to consume an event into the Elm kernel, the event
must decode via `Codec.decodeMsgFromTag` with **all required Elm
identity fields present and DIRECTLY available**.

By this criterion, the following REAL stages cannot be replayed into
the Elm kernel as-is, even with a lossless factual adapter:

- `run_turn_started` (requires `runId`) — **UNAVAILABLE**
- `agent_turn_done` (requires `runId`) — **UNAVAILABLE**
- `terminal_committed` → `terminal_registered` (requires `ownerId`,
  `kind`) — **UNAVAILABLE**
- `submit_and_exit_seen` (requires `submitId`) — **UNAVAILABLE**
- `task_completion_committed` (requires `completionId`) — **UNAVAILABLE**
- `pending_prompt_enqueued/dequeued/continuation_scheduled`
  (requires `promptId`) — **DIRECT** (mappable)
- `notify_consume_enter` / `wake_created` → `terminal_observed`
  (requires `jobId` only) — **DIRECT** (mappable)

## Consequence

The Elm kernel as currently specified requires identities (`RunRef`,
`SubmitRef`, `CompletionRef`, `OwnerRef`) that the frozen REAL trace
schema does NOT carry. The frozen REAL trace schema carries `taskId`,
`sessionId`, `jobId`, `promptId`, `origin`.

This is **INSUFFICIENT_IDENTITY** for 5 of 7 required event types in
the REAL stall trace.

## Provenance-equivalence check

§10 requires that if `prompt_origin` and `run_origin` differ, that be
preserved rather than normalized.

In the stall trace:
- seq 154: `pending_prompt_enqueued` with `origin=pending_prompt_drain`
- seq 155: `agent_turn_done` with `origin=explicit_user` (no runId field)
- seq 156: `pending_prompt_dequeued` with `origin=pending_prompt_drain`
- seq 157: `continuation_scheduled` with `origin=pending_prompt_drain`
- seq 158: `run_turn_started` with `origin=explicit_user`

So in the stall trace, the prompt and run do NOT have mismatched
origins in the visible parts: prompt events are `pending_prompt_drain`,
the latest `run_turn_started` is `explicit_user`. The agent_turn_done
is also `explicit_user`.

**PROMPT_ORIGIN=pending_prompt_drain**
**RUN_ORIGIN=explicit_user** (last `run_turn_started` and its
`agent_turn_done`)

These are different **kinds** (drain vs explicit), but they are
**not a within-event mismatch** — they are the natural expectation:
a continuation launched because a pending-prompt drain produced a
prompt, then the run itself records as `explicit_user` (the user
replies to the agent via the UI, not via the pending-prompt queue).

This is **PROVENANCE_PRESERVED**, not **PROVENANCE_MISMATCH**.

No contradiction in the data; the natural continuation semantic.

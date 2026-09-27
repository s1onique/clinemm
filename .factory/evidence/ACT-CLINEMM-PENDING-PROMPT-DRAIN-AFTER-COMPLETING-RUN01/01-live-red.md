# 01-live-red.md

## LIVE FAILURE=REAL (per ACT §6)

Live capture counters for session `1790544756725_zx4dj`:

| Counter | Value |
|---|---|
| `submit_and_exit_seen` | 1 |
| `pending_prompt_enqueued` | 1 |
| `pending_prompt_dequeued` | 0 |
| `continuation_scheduled` | 0 |
| `task_completion_committed` | 0 |

```
successful submit_and_exit
        ↓
BCB decides authoritative task completion must remain held
        ↓
completion-finalization prompt is enqueued
        ↓
current AgentRuntime turn ends because submit_and_exit completesRun
        ↓
pending queue remains non-empty
        ↓
NO pending_prompt_dequeued
NO continuation_scheduled
NO autonomous next run
NO task_completion_committed
        ↓
UI remains Working / Cancel indefinitely
```

## BOUNDARY_CLASSIFICATION=PENDING_PROMPT_DRAIN_AUTHORITY

The BCB barrier's `enqueueCompletionContinuationIfHeld` callback fires the
continuation enqueue via `sdkHost.send({delivery: "queue"})`. The
`PendingPromptsController.enqueue` succeeds (C4 fires once). The
`scheduleDrain` check at `pending-prompt-service.ts:414` bails on
`!session.agent.canStartRun()` because the originating run is still in
flight. After the run ends, the post-turn drain microtask at
`local-runtime-host.ts:1268` should pick up the prompt — but the live
capture shows it does not.

## Live capture files

None found on the local filesystem. The sessionId `1790544756725_zx4dj` has
no JSONL artifacts referencing it under the standard capture directories
(`/tmp/cline-debug/`, `~/.cline/`, `.factory/captures/`).

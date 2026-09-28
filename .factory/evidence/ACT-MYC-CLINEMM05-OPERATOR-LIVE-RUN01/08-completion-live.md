# 08 — Finalization-Run Completion Live (LIVE-J + LIVE-K, key regression target)

## §19 LIVE-J: finalization-run completion

The key regression target from the previous P0 (LIVE04 RED) is the
transition:

```text
run_turn_started #2
  → agent_turn_done #2
```

If the run creates a completion continuation, require:

```text
submit_and_exit_seen            >= 1          PENDING_OPERATOR_LIVE_RUN
pending_prompt_enqueued         = 1           PENDING_OPERATOR_LIVE_RUN
pending_prompt_dequeued         = 1           PENDING_OPERATOR_LIVE_RUN
continuation_scheduled          = 1           PENDING_OPERATOR_LIVE_RUN
run_turn_started                = 2           PENDING_OPERATOR_LIVE_RUN
agent_turn_done                 = 2           PENDING_OPERATOR_LIVE_RUN
task_completion_committed       = 1           PENDING_OPERATOR_LIVE_RUN
```

If the run hangs between `run_turn_started #2` and `agent_turn_done #2`
exactly as in LIVE04:

```text
HALT_FINALIZATION_RUN_BOOTSTRAP_STALL_REPRODUCED
```

If that halt triggers, the bounded-bootstrap repair (HEAD 89249175c)
was insufficient on the real path. STOP — open a separate repair ACT;
this ACT does NOT fix defects.

## §20 LIVE-K: visible completion conservation

At task end:

```text
VISIBLE_COMPLETION_COUNT     = PENDING_OPERATOR_LIVE_RUN  (target: 1)
WORKING_AFTER_COMPLETION     = PENDING_OPERATOR_LIVE_RUN  (target: false)
CANCEL_AFTER_COMPLETION      = PENDING_OPERATOR_LIVE_RUN  (target: false)
PERSISTENT_YOUR_TURN         = PENDING_OPERATOR_LIVE_RUN  (target: false)
```

Failure:

```text
HALT_COMPLETION_CONSERVATION_REGRESSION
```

## Background

LIVE04 captured:
  run_turn_started=2, agent_turn_done=1, task_completion_committed=0

The continuation subsystem (BCB + PendingPromptsController +
continuation_scheduled) successfully handed the second run off. The
defect lived strictly between `run_turn_started #2` and
`agent_turn_done #2`, inside the second run's bootstrap.

If the bounded-bootstrap repair works live, the second run's
`ensureSessionConnection` completes within the per-server timeout
window, the new myc child is connected, `createVscodeExtraTools`
returns, `prepareStartSessionInput` returns, `ClineCore.startSession`
returns, the agent runs, `agent_turn_done #2` fires, the
BackgroundNotifyCoordinator BCB barrier commits, and
`task_completion_committed=1`.

If the same hang recurs in spite of the repair, the repair is
insufficient and a separate repair ACT must be opened.

## Conservation

The completion-presentation authority (CPA01, the C10 filter +
BCB barrier reaching the same conclusion about authoritative
completion) is preserved on HEAD 89249175c — HEAD 89249175c only
touches `apps/vscode/src/services/mcp/McpHub.ts`. CPA01 was
ACT-CLINEMM-COMPLETION-PRESENTATION-AUTHORITY01, closed earlier
on the same work tree. Not touched.

The BackgroundNotifyCoordinator consumption barrier (BCB01 CORRECTION01,
the wake-prompt → consumption-before-completion rule) is preserved.
Not touched.
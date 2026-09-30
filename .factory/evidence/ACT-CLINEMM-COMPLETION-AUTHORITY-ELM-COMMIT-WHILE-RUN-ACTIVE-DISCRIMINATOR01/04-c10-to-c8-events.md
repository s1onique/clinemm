# §8 — CWRA-03: events between C10 and C8

## Enumerated event sequence (LIVE: 51ms window)

Read from `01-real-live-trace.jsonl` seq 8 (C10) through seq 9 (C8), and from production-source code paths:

| Order | At (epoch ms) | Event | Source | Classification |
|---|---|---|---|---|
| 1 | 1790809536499 | `task_completion_committed` C10 capture | sdk-session-event-coordinator.ts:1431 | **C10 BOUNDARY** |
| 2 | 1790809536499 (same ms) | `setTurnPhase("completed", ..., "session-event-turn-complete-completed")` | sdk-session-event-coordinator.ts:1441 | BOOKKEEPING |
| 3 | ~1790809536500 | `sessions.setRunning(false)` | sdk-session-event-coordinator.ts:1718 | BOOKKEEPING |
| 4 | ~1790809536500 | `taskHistory.updateTaskUsage(...)` (fire-and-forget Promise started) | sdk-session-event-coordinator.ts:1721-1730 | TEARDOWN |
| 5 | ~1790809536500 | `postStateToWebview()` (fire-and-forget Promise started; returns when messages posted) | sdk-session-event-coordinator.ts:1738-1747 | OBSERVATION |
| 6 | ~1790809536500 | `leaveExtensionHostHotloopHandleSessionEvent()` (no-op when diagnostic OFF) | sdk-session-event-coordinator.ts:1754 | UNKNOWN (diagnostic) |
| 7 | ~1790809536500 | `handleSessionEvent` returns; `await eventBridge.dispatchAgentEvent(...)` settles | sdk-session-event-coordinator.ts:1756 | BOOKKEEPING |
| 8 | ~1790809536550 | `executeTurn()` returns to `runTurn` | local-runtime-host.ts:1301 -> 1313 | BOOKKEEPING |
| 9 | 1790809536550 | C8 capture: `onAgentTurnDone({...})` | local-runtime-host.ts:1320-1327 | **C8 BOUNDARY** |

## Classification summary

| Kind | Count | Events |
|---|---|---|
| SEMANTIC | **0** | (none) |
| BOOKKEEPING | 4 | setTurnPhase, setRunning, handleSessionEvent return, executeTurn return |
| TEARDOWN | 1 | taskHistory.updateTaskUsage |
| OBSERVATION | 1 | postStateToWebview |
| UNKNOWN | 1 | leaveExtensionHostHotloopHandleSessionEvent (diagnostic, no-op when OFF) |

**There are NO semantic events between C10 and C8.**

Per §4's frozen definition, "semantic work" includes: new model/tool work, pending prompt creation/drain, continuation scheduling, command/job ownership transition, terminal observation affecting completion, task-state mutation relevant to correctness, another submit/completion authority transition, failure that invalidates completion. None of the 7 events in the C10→C8 interval match any of these categories.

## Evidence: SYNTHETIC_REAL production-shape bridge test

See `apps/vscode/src/sdk/__tests__/completion-authority-commit-while-run-active-discriminator01.c24-c-bridge.test.ts` test `CWRA-01.RED` and `CWRA-04.RED`:

```
✓ CWRA-01.RED: production code emits C10 inside executeTurn teardown and C8 AFTER executeTurn returns (45ms)
✓ CWRA-04.RED: the C10->C8 tail is bounded by the host's post-executeTurn bookkeeping, not by run activity
```

The bridge test asserts:
- C10 capture site = `sdk-session-event-coordinator.ts:1431` (inside `handleSessionEvent`)
- C8 capture site = `local-runtime-host.ts:1321` (after `executeTurn` returns)
- No `executeTurn`, `runTurn`, `agent.run`, `agent.continue`, `enqueuePrompt`, `schedule` keyword appears in the C10→C8 interval — confirming zero semantic activity.

# LIVE Specimen — One Background Job, Two Presentations

## Specimen status

```text
LIVE_INPUT_OBSERVED = LIVE_OBSERVED (operator-run specimen, per ACT §0)
LIVE_REPRODUCTION   = EXECUTABLE / PRODUCTION-SHAPED (test harness)
LIVE_DOGFOOD        = PENDING (deferred — cloud-agent context lacks
                              API-key + dogfood VSIX infra for a fresh
                              30-second natural-exit run)
```

The operator-driven CCARD counts in ACT §0 are the LIVE evidence. The
EXECUTABLE reproduction in this ACT exercises the EXACT production chain
end-to-end through the real `MessageTranslatorState` +
`translateSessionEvent` + `SdkSessionEventCoordinator` path, simulating
the operator's two-turn flow (explicit_user calls attempt_completion
after the background command starts; wake_drain calls attempt_completion
after the wake delivers the result).

## Operator-observed live evidence (frozen from ACT §0)

```text
terminal_committed          = 1
notify_consume_enter        = 1
wake_created                = 1
pending_prompt_enqueued     = 1
pending_prompt_dequeued     = 1
continuation_scheduled      = 1
run_turn_started            = 2 (origins: explicit_user + pending_prompt_drain)
agent_turn_done             = 2 (origins: explicit_user + pending_prompt_drain)
task_completion_committed   = 1
```

User-visible UI (frozen screenshot 01c-live-ui.png):

```text
[ chat row 1: agent text "I'll start the command in the background and notify you when it's done" ]
[ chat row 2: terminal card "Running: sh -c 'echo STARTED; sleep 30; echo FINISHED'" ]
[ chat row 3: completion box "I've started the command in the background. It will take about 30 seconds." ← PRESENTATION A ]
[ chat row 4: terminal card "Completed (exit 0)" ]
[ chat row 5: completion box "The command completed. Output: STARTED\nFINISHED" ← PRESENTATION B ]
```

Two completion boxes visible for one terminal event.

## Reproduction (production-shaped harness)

The BCTPA-RED-01 / BCTPA-ABLATION-01 / BCTPA-GREEN-01 suite at
`apps/vscode/src/sdk/__tests__/background-command-terminal-presentation-arbitration01.bctpa01.test.ts`
drives the real production seam end-to-end via the same harness pattern
as the prior BCNEX01 closure test:

```text
  BackgroundNotifyCoordinator  ←─ registerMarker + consumeTerminal (real)
  CommandJobManager           ←─ finalize (real)
  PendingPromptsController    ←─ enqueue + drain (real, via TestPendingPromptQueue adapter)
  SdkSessionEventCoordinator  ←─ handleSessionEvent (real)
  MessageTranslatorState      ←─ real
  translateSessionEvent       ←─ real (filtered)
  MessageCoordinator          ←─ real
  setTurnPhase + deferredCompletionBarrier ←─ real
```

The test simulates the operator's two-turn flow:
1. **Turn 1 (explicit_user):**
   - Agent calls `attempt_completion` (intermediate, "started")
   - `attemptCompletionSeen` becomes true
   - `terminalResponseCommittedThisTurn` becomes true
   - `outstandingAutonomousWork === true` (active notify marker for the session/task)
   - `deferredCompletionBarrier` HOLDS the phase
2. **Turn 2 (wake_drain):**
   - Wake arrives via `pending_prompt_submitted`
   - Wake echo is filtered by existing BCNEX01 `isSyntheticUserPrompt` predicate (zero user_feedback rows)
   - Agent calls `attempt_completion` (terminal, "completed")
   - `outstandingAutonomousWork === false` (marker consumed)
   - `task_completion_committed` fires; `setTurnPhase("completed", ...)`

## Required pre-repair observation (RED)

For ONE jobId reaching ONE terminal state:

```text
terminal_commit_count(J)  = 1
wake_created_count(J)     = 1
presentation_count(J)     = 2   // RED

  (A) say:"completion_result" text:"started the command" ← emitted by explicit_user turn
  (B) say:"completion_result" text:"command completed"   ← emitted by wake_drain turn
```

The post-fix GREEN must flip this to `presentation_count(J) == 1` (presentation B).

## Conservation matrix (per ACT §12)

| case | scenario | expected |
|------|----------|----------|
| P1 | terminal AFTER originating turn finishes | wake owns presentation; presentations = 1 |
| P2 | terminal WHILE originating turn is still alive (frozen bug shape) | wake_drain owns presentation; explicit_user suppressed; presentations = 1 |
| P3 | two independent background jobs finish | each job → exactly one presentation; no cross-job dedupe |
| P4 | held batch / two terminal jobs | each distinct jobId → exactly one terminal presentation |
| P5 | duplicate terminal observation for same job | one presentation (no duplicate commit) |
| P6 | abort/session disappearance | no stale wake may present into a dead/replaced session |
| P7 | explicit user turn concurrent with terminal wake | unrelated user response NOT suppressed |
| P8 | queued/steer semantics | unchanged |
| P9 | OOM conservation | drain path still omits `delivery` |
| P10 | correlation conservation | same jobId traverses terminal wake → C4 → C8 |

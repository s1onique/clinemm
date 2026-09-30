# §16 — Decision tree: H1 vs H2 vs CAPTURE_INSUFFICIENT

## CWRA composition

### CWRA-01 — C10-before-C8 reproduced?

YES. The LIVE trace `01-real-live-trace.jsonl` shows seq 8 (task_completion_committed) at `at=1790809536499` and seq 9 (agent_turn_done) at `at=1790809536550`. C10 fires 51ms before C8. The bridge test `CWRA-01.RED` confirms the production-source code sites:
- C10: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1431` (inside `handleSessionEvent`'s done branch)
- C8: `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1321` (after `await executeTurn(...)` resolves)

### CWRA-02 — state snapshot at C10

YES (see `03-c10-state.md`). The Elm model at C10 has `activeRun = Just run_h7wXy0mx`. The production `runIdBySessionId` map retains `run_h7wXy0mx`. The phase is NOT yet flipped to "completed" (the flip happens 0ms after C10 in the same handler). The BCB barrier has already passed (`outstandingAutonomousWork === false`).

### CWRA-03 — events between C10 and C8

YES (see `04-c10-to-c8-events.md`). ZERO semantic events. The 7 events in the interval classify as:
- 4 BOOKKEEPING: `setTurnPhase("completed", ...)`, `sessions.setRunning(false)`, `handleSessionEvent` return, `executeTurn` return
- 1 TEARDOWN: `taskHistory.updateTaskUsage` (fire-and-forget)
- 1 OBSERVATION: `postStateToWebview` (fire-and-forget)
- 1 UNKNOWN: `leaveExtensionHostHotloopHandleSessionEvent` (diagnostic-only, no-op when OFF)

### CWRA-04 — delay C8 without changing semantics

YES (see bridge test `CWRA-04.RED`). The structural discriminator asserts that the C10->C8 tail contains NO semantic activity. The tail is bounded by:
1. The synchronous return from `handleSessionEvent`
2. The resolution of the `eventBridge.dispatchAgentEvent` Promise
3. The synchronous emission of `onAgentTurnDone`

There is no `await`-boundary that could host a new model/tool turn, prompt creation, or continuation schedule.

### CWRA-05 — fail after C10, before C8

NOT_APPLICABLE (see `05-post-c10-failure-discriminator.md`). No injectable semantic failure seam in the C10->C8 interval. The only failure modes are:
- Fire-and-forget Promise rejections (logged-and-suppressed)
- Diagnostic-only depth-tracker (no-op when OFF)
- A race where `executeTurn` rejects AFTER C10 but BEFORE C8 (rare host-side race; does NOT invalidate semantic completion; only produces an inconsistent CCARD ring)

### CWRA-06 — counterfactual B = C8 before C10

YES (see `06-counterfactual-replay.json`). Replaying the projection with the agent_turn_done event moved BEFORE task_completion_committed produces:
- `firstDivergenceSeq: null`
- `firstDivergenceKind: null`
- `task: "completion_committed"`, `committedCompletion: "completion-cwad-cf"`
- ZERO violations

This proves the Elm disagreement is specifically about C10/C8 ordering, not some unrelated model defect.

### CWRA-07 — conservation semantics

YES (see `07-existing-contracts.md`). Existing TS tests do NOT assert C10<C8 as an invariant. The Elm kernel has TWO deliberate tests that DO assert C10 AFTER C8 as an invariant:
- `ELM-AUTH-09`: `RunStarted R1 + TaskCompletionCommitted C1 -> TaskCompletionCommittedWhileHeld ActiveRun`
- `ELM-AUTH-15`: `RunStarted R1, AgentTurnDone R1, SubmitAndExitSeen -> AuthorizeTaskCompletion is in the effect set`

### CWRA-08 — completion visibility contract

YES (C10 is the durable commitment). The `task_completion_committed` capture in `apps/vscode/src/sdk/continuation-cardinality-authority.ts` is a public-API durability signal:
- Counter `task_completion_committed` increments (visible via `getContinuationCardinalityAuthorityCounters`)
- Counter is monotonically incremented; NEVER decremented or reset
- Records are persisted to `~/.cline/data/continuation-cardinality-authority.jsonl` (byte-exact REAL capture)
- A single C10 capture per (sessionId, taskId) per turn (gated by BCB barrier)
- The Elm kernel treats `TaskCompletionCommitted` as the durable completion authority transition (sets `model.task = CompletionCommitted` and `model.committedCompletion = Just completionRef`)

This is consistent with **A. durable completion authority committed** (NOT an internal candidate/intent finalized later). The name `task_completion_committed` is accurate.

## Decision

### Required composition for Verdict A (H1_ELM_TOO_STRICT):

```
C10-before-C8 reproduced
+
C10 state contains no unresolved semantic authority
+
C10->C8 interval contains only bookkeeping/teardown
+
no meaningful post-C10 failure can invalidate completion
```

### Status of each required element:

| Element | Status |
|---|---|
| C10-before-C8 reproduced | YES (CWRA-01 + LIVE trace seq 8 -> seq 9) |
| C10 state contains no unresolved semantic authority | YES (CWRA-02: BCB barrier passed, terminal response committed, no held background jobs, no queued prompts) |
| C10->C8 interval contains only bookkeeping/teardown | YES (CWRA-03: 4 BOOKKEEPING + 1 TEARDOWN + 1 OBSERVATION + 1 diagnostic-only; ZERO SEMANTIC) |
| No meaningful post-C10 failure can invalidate completion | YES (CWRA-05: NOT_APPLICABLE; no injectable semantic seam) |

### Counter-evidence for H2 (TS commits too early):

| Element | Status |
|---|---|
| Meaningful run-owned state/work remains after C10 | NO (CWRA-02: BCB passed; outstandingAutonomousWork=false) |
| Post-C10 failure can invalidate semantic completion | NO (CWRA-05: NOT_APPLICABLE) |

## VERDICT

**VERDICT=H1_ELM_TOO_STRICT**

**ROOT_CAUSE:**
The Elm kernel's `computeHoldReasons` function (Authority.elm:439-532) classifies `activeRun /= Nothing` as a completion-blocking hold. This is the `ActiveRun` hold that fires `TaskCompletionCommittedWhileHeld active_run` (Authority.elm:390). The hold treats "an `agent_turn_done` event has not yet been received for the currently-active run" as semantically equivalent to "the run is still semantically active and cannot be committed".

In production, the `agent_turn_done` event fires AFTER `task_completion_committed` by 51ms (observed in LIVE trace) because:
1. The agent's `done` event propagates through the eventBridge -> `SdkSessionEventCoordinator.handleSessionEvent` synchronously, where C9+C10 fire inside the same handler.
2. The host's `onAgentTurnDone` capture fires AFTER `await this.executeTurn(...)` returns — which is AFTER the synchronous C10 capture inside the eventBridge dispatch.

The semantic completion (the agent's `attempt_completion` tool response was committed, the BCB barrier passed, the deferred continuation machinery did not engage) is COMPLETE at C10. C8 is downstream bookkeeping that the Elm kernel mistakenly requires for commit authorization.

**The Elm model is correct in spirit** — completion should require the run to be closed — **but wrong in mechanism** — it requires the agent_turn_done event to have fired, when in production the run is semantically complete at C10 (the attempt_completion tool's `content_end` already committed the terminal response, the BCB barrier passed, and the `setTurnPhase("completed", ...)` write is the authoritative UI commit).

## SUCCESSOR_ACT

**SUCCESSOR_ACT=ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-REPAIR01**

Per §16's "That successor may modify Elm semantics", the successor ACT will repair the Elm model to:
- Distinguish between "run event not yet received" (current `ActiveRun` hold) and "run is semantically active" (the Elm kernel's true invariant).
- Allow `TaskCompletionCommitted` to fire when the BCB barrier has passed AND the `terminalResponseCommittedThisTurn` flag is set (the actual production semantic).
- Preserve the kernel's protective intent via a different mechanism: e.g. require C10 to be the LAST event in the turn sequence (so no subsequent agent event can revive the run).

The successor ACT will operate within the Elm kernel only. No production changes.

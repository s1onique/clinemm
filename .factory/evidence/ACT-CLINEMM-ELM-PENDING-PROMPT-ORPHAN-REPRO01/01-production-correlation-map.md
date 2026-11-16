# 01 — Production Correlation Map

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01`
Labels: `REAL_PRODUCTION_SEAM` (real code inspected), `REAL` (exported incident records)

All file references are to `REPLAY_SUBJECT_HEAD = e0e30879f9e5cf0716242b00dc3cd9447fbaa6e1`,
byte-identical to the installed incident source on every path below.

---

## C1.1 The actual producer of `continuation_started`

**The producer EXISTS. It is NOT an invented event name.**

`apps/vscode/src/sdk/canonical-event-subscription.ts:79-122` — the canonical
runtime-event subscription:

```ts
if (event.type === "run-started") {
    const runId = event.snapshot?.runId
    if (typeof runId === "string" && runId.length > 0) {
        runIdBySessionId.set(sessionId, runId)            // retained runId
        captureContinuationCardinalityAuthorityRecord({
            stage: "run_turn_started", origin: "unknown", sessionId, runId,
        })
        // Join the held continuation prompt with this run, ONLY when a
        // factual prompt is held for THIS session. Consume exactly once.
        const heldPromptId = heldContinuationPromptsBySessionId.get(sessionId)
        if (typeof heldPromptId === "string" && heldPromptId.length > 0) {
            heldContinuationPromptsBySessionId.delete(sessionId)
            captureContinuationCardinalityAuthorityRecord({
                stage: "continuation_started",
                origin: "pending_prompt_drain",
                sessionId,
                promptId: heldPromptId,
                runId,
            })
        }
    }
}
```

### The two halves of the join

| Half | Producer | Location |
|---|---|---|
| **held prompt** (the `promptId` side) | `setHeldContinuationPromptForSession(sessionId, promptId)` — called from `onBeforeDispatch` on `continuation_scheduled` | `continuation-cardinality-authority.session-host-capture.ts:90-99` |
| **run identity** (the `runId` side) | `event.snapshot.runId` of the canonical `run-started` runtime event | `canonical-event-subscription.ts:80` |

**The join is per-session and consumed exactly once.** A held prompt for session
S1 never joins a `run-started` for S2. Once consumed, the held prompt is not
reused for a later run.

### The upstream of the `run-started` event

```
AgentRuntime.execute()                     sdk/packages/agents/src/agent-runtime.ts:1788,1836-1837
  this.state.runId = createUID("run")
  await this.emit({ type: "run-started", snapshot: this.snapshot() })
        |
        v
SessionRuntimeOrchestrator.handleRuntimeEvent -> runtimeEventListeners fanout
        sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:2032-2045
        |
        v
LocalRuntimeHost.subscribeRuntimeEvents     sdk/packages/core/src/runtime/host/local-runtime-host.ts:2352-2373
        (point-in-time fanout over CURRENTLY active sessions)
        |
        v
subscribeCanonicalRuntimeEventsToShadow    apps/vscode/src/sdk/canonical-event-subscription.ts:58-130
        |
        v
captureContinuationCardinalityAuthorityRecord -> enqueueElmAuthorityRecord -> Elm
```

## C1.2 The real production call chain for the Elm authority

```
captureContinuationCardinalityAuthorityRecord(rec)     continuation-cardinality-authority.ts:262-326
  -> enqueueElmAuthorityRecord(rec)                    completion-authority-elm-authority-runtime.ts:276-297
       (AUTHORITY_STAGES filter at :285)
  -> [queue holds the record]
  -> flushElmAuthorityForSession(sessionId)            completion-authority-elm-authority-runtime.ts:306-322
       -> processOneAuthorityRecord                     :324-410
            -> adaptRecord(record)                     completion-authority-elm-replay.ts:93-217
            -> sess.kernel.send(elmMsg)                REAL compiled Elm
            -> decodeElmDecision(lastState.model)      :503-539
  -> getElmAuthorityCompletionDecision(sessionId)      :242-268
```

The coordinator awaits the flush **before** the consult
(`sdk-session-event-coordinator.ts` -> `checkElmCompletionAuthority`).

## C1.3 The adapter contract

`completion-authority-elm-replay.ts:195-213`:

```ts
case "continuation_started": {
    const { promptId, runId } = record
    if (promptId === undefined || promptId === null) {
        return { status: "INSUFFICIENT_IDENTITY", reason: "continuation_started has no promptId ..." }
    }
    if (runId === undefined || runId === null) {
        return { status: "INSUFFICIENT_IDENTITY", reason: "continuation_started has no runId ..." }
    }
    return { status: "DIRECT", elmMsg: { tag: "continuation_started", promptId: String(promptId), runId: String(runId) } }
}
```

| Question | Answer |
|---|---|
| Does the real producer supply BOTH identities? | **YES** — `canonical-event-subscription.ts:114-120` passes `promptId: heldPromptId` and `runId`. |
| Does a valid producer-side prompt->run association exist? | **YES, in principle** — the join is built from two factual, session-scoped facts. |
| Does the record pass `AUTHORITY_STAGES`? | **YES** — `"continuation_started"` is a member (`completion-authority-elm-authority-runtime.ts:96`). |
| Are accepted records delivered exactly once? | **YES** — the queue is `splice`d (`runtime:313`) and `processOneAuthorityRecord` sends one msg per record. |
| Does the adapter discard information needed for prompt consumption? | **NO** — the adapter forwards `promptId` and `runId` verbatim; the Elm `ContinuationStarted` transition consumes both. |

---

## C1.4 The Elm transition contract

`apps/vscode/elm/completion-authority/src/Authority.elm`

| Msg | Handler | Prompt-state effect |
|---|---|---|
| `PendingPromptEnqueued p` | `handlePendingPromptEnqueued` (:276) | `PromptQueued` |
| `PendingPromptDequeued p` | `handlePendingPromptDequeued` (:285) | `PromptQueued` -> `PromptDequeued` |
| `ContinuationScheduled p` | `handleContinuationScheduled` (:316) | `PromptDequeued` -> `PromptScheduled` |
| **`ContinuationStarted p r`** | `handleContinuationStarted` (:347) | **`PromptScheduled` -> `PromptRunning r`** (ONLY source of `PromptRunning`) |
| `AgentTurnDone r` | `handleAgentTurnDone` (:185) | `PromptRunning r` -> `PromptConsumed` — **ONLY when `r` equals the closing run reference** |

### What happens to a `PromptScheduled` record when `AgentTurnDone` arrives without a `ContinuationStarted`

`handleAgentTurnDone` calls `consumePromptForRun closingRef model.prompts`
(`Authority.elm:193`, definition at :692-711):

```elm
consumePromptForRun closingRef promptList =
    List.map
        (\p ->
            let ( ref, state ) = p in
            case state of
                PromptRunning r -> if r == closingRef then ( ref, PromptConsumed ) else p
                _ -> p                                   -- <<< PromptScheduled falls here
        )
        promptList
```

**A `PromptScheduled` prompt is NOT touched by `AgentTurnDone`.** It remains
`PromptScheduled` forever.

`computeHoldReasons` (`Authority.elm:499-592`) then classifies it:

```elm
isPendingOrScheduledPrompt (_, state) =
    case state of
        PromptQueued     -> True
        PromptDequeued   -> True
        PromptScheduled  -> True     -- <<< counts as PendingPrompt
        PromptRunning _  -> True
        PromptConsumed   -> False
```

and additionally:

```elm
isScheduledOrRunning (_, state) =
    case state of
        PromptScheduled -> True      -- <<< counts as ScheduledContinuation
        PromptRunning _ -> True
        _               -> False
```

**Therefore a `PromptScheduled` prompt produces BOTH `PendingPrompt` and
`ScheduledContinuation` holds, and `PendingPrompt` is listed FIRST in the
hold-reason list (`Authority.elm:571-574`).** The recorded incident reason is
`elmReason: "pending_prompt"` — exactly the head of that list.

### The complete state machine, as a diagram

```
                PendingPromptEnqueued(p)
                          |
                          v
                    [PromptQueued]
                          |
                PendingPromptDequeued(p)
                          |
                          v
                   [PromptDequeued]
                          |
                 ContinuationScheduled(p)
                          |
                          v
                   [PromptScheduled]  ---- AgentTurnDone(r) ----> (UNCHANGED, still PromptScheduled)
                          |                                            ^
                          | ContinuationStarted(p, r)                   | (holds forever)
                          v                                            |
                   [PromptRunning r] --------------------------------- +
                          |
                AgentTurnDone(r)  with r == closing run
                          |
                          v
                    [PromptConsumed]   (holds cleared)
```

**The ONLY way out of `PromptScheduled` is `ContinuationStarted`.**
`AgentTurnDone` cannot do it.

## C1.5 Mapping the incident's recorded events onto this machine

From the exported `continuation-events.jsonl` (session `1794840293250_5ugld`),
in recorded order:

| seq | stage | promptId | runId | Elm effect |
|---|---|---|---|---|
| 2 | `task_started` | — | — | `TaskStarted` -> task Active |
| 3 | `run_turn_started` | — | `run_rCw8nsup` | `RunStarted` -> activeRun = `run_rCw8nsup` |
| 41 | `agent_turn_done` | — | `run_rCw8nsup` | `AgentTurnDone` -> activeRun cleared, run done |
| 46 | `pending_prompt_enqueued` | `pending_1794841243556_-tSbr` | — | P1 -> `PromptQueued` |
| 47 | `pending_prompt_dequeued` | P1 | — | P1 -> `PromptDequeued` |
| 48 | `continuation_scheduled` | P1 | — | P1 -> **`PromptScheduled`** |
| 50 | `agent_turn_done` | — | `run_rCw8nsup` | P1 **UNCHANGED** (still `PromptScheduled`) |
| 54 | `pending_prompt_enqueued` | `pending_1794841410962_5gjid` | — | P2 -> `PromptQueued` |
| 56 | `pending_prompt_dequeued` | P2 | — | P2 -> `PromptDequeued` |
| 57 | `continuation_scheduled` | P2 | — | P2 -> **`PromptScheduled`** |
| 59 | `agent_turn_done` | — | `run_rCw8nsup` | P2 **UNCHANGED** (still `PromptScheduled`) |
| 64 | `agent_turn_done` | — | `run_rCw8nsup` | P1, P2 **UNCHANGED** |

**`continuation_started` count in the exported bundle: 0.**
**`run_turn_started` count in the exported bundle for this session: 1**
(seq 3, at `1794840293907`).
**`execute_turn_prelude_enter` count: 5** (seq 1, 42, 49, 58, 60) — i.e. five
turns demonstrably ENTERED `LocalRuntimeHost.executeTurn`.

**Fingerprint:** five turns entered `executeTurn`; only the FIRST produced a
`run_turn_started`; the other four produced `agent_turn_done` carrying the
**same** `run_rCw8nsup`.

## C1.6 Why the retained runId never changed

`recordAgentTurnDone` (`continuation-cardinality-authority.runtime-capture.ts:106-119`):

```ts
const runId = agentTurnDoneReadsRunId ? getRunIdForSession(input.sessionId) : undefined
captureContinuationCardinalityAuthorityRecord({ stage: "agent_turn_done", ..., ...(runId !== undefined ? { runId } : {}) })
```

`getRunIdForSession` (`canonical-event-subscription.ts:229-232`) reads the
`runIdBySessionId` map, which is written **only** inside the `run-started`
branch (`:89`).

**Therefore the identical `run_rCw8nsup` on all five `agent_turn_done` records
is direct evidence that the canonical `run-started` event reached the
subscription only ONCE (for turn 1).** For turns 2-5 the retained map was
never refreshed, so:

1. no `run_turn_started` was emitted (the capture lives inside the same branch),
2. no `continuation_started` was emitted (the join needs the `runId` from that branch),
3. the `agent_turn_done` for those turns carried the STALE first-turn runId.

This is a *single* upstream fact with *three* consequences — not three defects.

## C1.7 Existing corroborating witness (already in the repository)

`src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts`
(PPLC-08) is an existing NECESSITY ablation that drives the REAL
`LocalRuntimeHost` + REAL canonical subscription + REAL Elm kernel and proves:

> with the canonical subscription withheld, the `pending_prompt` hold RETURNS.

PPLC-08 passes at `REPLAY_SUBJECT_HEAD` (verified in `06-executable-receipts.md`).
It independently corroborates the causal role of the `continuation_started`
producer. OPPOR01 adds the *source-bound incident replay* that PPLC-08 lacks.

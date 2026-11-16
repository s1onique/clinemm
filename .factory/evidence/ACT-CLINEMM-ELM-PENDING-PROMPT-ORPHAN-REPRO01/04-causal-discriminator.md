# 04 — Causal Discriminator

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01`
Labels: `REAL`, `REAL_PRODUCTION_SEAM`, `INFERRED` (where marked)

---

## C4.0 The hypothesis under test

> The actual continuation begins, but Elm never receives a valid prompt->run
> association. The prompt therefore remains `PromptScheduled` instead of
> becoming `PromptRunning`, so the later `AgentTurnDone` cannot consume it.

**Verdict: CONFIRMED, with one sharpening.** The prompt->run association is
not merely "never received by Elm" — it is **never CONSTRUCTED**, because the
`runId` half of the join never arrived for the continuation turns. The
producer is healthy (proven reachable); its *input* was absent.

## C4.1 Discriminator matrix

| Hypothesis | Required discriminator | Result | Verdict |
|---|---|---|---|
| **H1** — Missing producer event | Inspect the real producer invocation and its supported call paths | The producer `canonical-event-subscription.ts:114-120` exists and fires on a canonical `run-started`. `OPPOR01-H1-H7` Arm 1 proves it emits `continuation_started` with BOTH identities. **But it fired only ONCE in the incident** — and that once was for the explicit-user turn, before any prompt was held. **The producer did not malfunction; its input (`run-started`) did not arrive for the continuation turns.** | **REFUTED as "producer broken" / CONFIRMED as "producer input missing"** |
| **H2** — Incomplete identity | Record the actual `promptId` and `runId` available at emission time | Both identities were AVAILABLE in the incident: `promptId` from the held-prompt map (`pending_1794841243556_-tSbr`, `pending_1794841410962_5gjid`), `runId` from the retained `runIdBySessionId` (`run_rCw8nsup`). The producer emits BOTH atomically; it cannot emit one without the other. | **REFUTED** |
| **H3** — Adapter rejection | Exercise `adaptRecord` with the actual produced event | `adaptRecord({stage:"continuation_started", promptId, runId})` -> `DIRECT`, `elmMsg = {tag:"continuation_started", promptId, runId}`. The REAL adapter accepts the transition. | **REFUTED** |
| **H4** — Event-ordering defect | Compare the real event order with the Elm transition requirements | The recorded order is `pending_prompt_enqueued` -> `pending_prompt_dequeued` -> `continuation_scheduled` -> (`agent_turn_done`). Elm requires `ContinuationScheduled` -> `ContinuationStarted` -> `AgentTurnDone`. The `ContinuationStarted` step is simply **ABSENT**; there is no reordering, no out-of-order delivery, no duplicate. | **REFUTED** (the transition is absent, not misordered) |
| **H5** — Run identity mismatch | Compare start, continuation and completion run references without rewriting them | The SAME `run_rCw8nsup` appears on the only `run_turn_started` and on all five `agent_turn_done`. There is no *divergent* run identity — there is only ONE identity, never refreshed. The mismatch is not between two runs; it is between a run reference and a prompt that never became `PromptRunning`. | **REFUTED as "two different runIds"; CONFIRMED as "no run identity was ever established for the continuation turns"** |
| **H6** — Legitimate pending prompt | Prove a real obligation remains outstanding after the final turn | Five `agent_turn_done` (last at `15:04:29.117Z`); the final recorded authority consult is at `15:04:29.118Z` — **1 ms later**. The C10 conservation result at that boundary was all-clear (`remainingBlockingJobCount=0`, `unconsumedTerminalCount=0`, `ownerStillRunning=false`, `heldObligation=false`, `outstandingAutonomousWork=false`). No `completed` phase was published. | **REFUTED** |
| **H7** — Recorder truncation | Identify an essential missing historical event that cannot be reconstructed faithfully | The incident session's CCARD sequence is **CONTIGUOUS seq 1..64 with no gaps**, and a cross-session scan shows the recorder retained every seq in the 40..64 window. The bundle IS globally truncated (`evidenceLoss=true`), but **not inside the incident session's CCARD window**. | **REFUTED for the causal window** |

## C4.2 The exact production boundary where the prompt ceases to progress

```
LocalRuntimeHost.executeTurn (REAL, per turn)                        local-runtime-host.ts:2515
  -> executeAgentTurn -> AgentRuntime.execute -> emit run-started     agent-runtime.ts:1836-1837
       |
       |  *** THE BREAK IS HERE ***
       |  For the continuation turns (seq 49, 58, 60) the canonical
       |  `run-started` event did NOT reach the canonical subscription.
       v
SessionRuntimeOrchestrator runtimeEventListeners fanout             session-runtime-orchestrator.ts:2032-2045
  -> LocalRuntimeHost.subscribeRuntimeEvents (point-in-time)         local-runtime-host.ts:2352-2373
  -> subscribeCanonicalRuntimeEventsToShadow                          canonical-event-subscription.ts:58-130
       |
       |  [ runIdBySessionId.set(sessionId, runId)  ]  <- NOT REACHED for turns 2..5
       |  [ run_turn_started capture ]               <- NOT REACHED for turns 2..5
       |  [ continuation_started join ]              <- NOT REACHED for turns 2..5
       v
  ==> PROMPT P1 / P2 REMAIN PromptScheduled  ==>  hold / pending_prompt  ==>  FOREVER
```

**The precise boundary:** the canonical `run-started` runtime event does not
reach `subscribeCanonicalRuntimeEventsToShadow` for the continuation turns.

**The causal chain, end to end:**

1. The canonical `run-started` event fails to reach the subscription for the
   continuation turns.
2. Therefore `runIdBySessionId` is never refreshed -> the retained runId stays
   `run_rCw8nsup` (the first turn's).
3. Therefore no `run_turn_started` is emitted for those turns.
4. Therefore the held-prompt join never fires -> no `continuation_started`.
5. Therefore P1 and P2 remain `PromptScheduled`.
6. Therefore `AgentTurnDone` cannot consume them (it only consumes
   `PromptRunning r`).
7. Therefore `computeHoldReasons` reports `PendingPrompt` -> the completion is
   held on `pending_prompt` indefinitely.

**Steps 2-7 are all consequences of step 1.** There is one root boundary, not
seven defects.

## C4.3 Why the `run-started` event can be absent while the turn still ran

The recorded chronology proves the turns ran to completion
(`execute_turn_prelude_enter` then `agent_turn_done`, five times). The
`run-started` event is emitted by `AgentRuntime.execute` at
`agent-runtime.ts:1837`, **AFTER** `callBeforeRunHooks()` (:1836). So a turn
can enter `executeTurn` and later produce an `agent_turn_done` while the
`run-started` event itself never reached the extension-host subscription.

The mechanism by which the host-side subscription can miss the event is
**point-in-time subscription scope**: `LocalRuntimeHost.subscribeRuntimeEvents`
(`local-runtime-host.ts:2352-2373`) fans out over `this.sessions.values()` —
the sessions that are **currently active** — and the
`LOCAL_RUNTIME_SUBSCRIPTION_MODEL = POINT_IN_TIME` contract
(`canonical-event-subscription.ts:20-39`) requires the caller to re-attach the
subscription after every `startSession` / `reinit` / `setActiveSession`. If the
subscription is not (re-)attached for the session that actually ran the
continuation, the listener observes nothing for that session — while the
session-host capture callbacks (`onExecuteTurnPreludeEnter`, `onAgentTurnDone`),
which are wired through the `pendingPromptCapture` object handed to the host at
construction time, still fire normally.

**That asymmetry is exactly what the incident shows:** the per-turn captures
(`execute_turn_prelude_enter`, `agent_turn_done`) fired five times, while the
subscription-driven captures (`run_turn_started`, `continuation_started`) fired
once. This is `INFERRED` from the capture asymmetry; the exact reason the
subscription was not attached for those turns is **not** established by the
exported bundle (the bundle records no subscription-lifecycle event).

**This is the residual unknown, stated precisely:**

> The exported bundle establishes that the canonical subscription did not
> observe a `run-started` for the continuation turns. It does **not** establish
> WHY (subscription never attached for that session vs. attached but the event
> was not emitted vs. attached to a different session).

The successor ACT must begin from the reproduced RED and establish that at the
subscription-attach boundary. **This ACT does not implement the repair.**

## C4.4 A competing explanation that is explicitly NOT used

The `agent_turn_done` records carry `run_rCw8nsup` — the same runId as the
`run_turn_started`. Per the ACT brief, the repeated run ID has real on-disk
provenance and **must not** be assumed erroneous. This ACT does **not** claim
the runId was wrong; it claims the runId was **never refreshed**, which is a
different and observationally distinct claim: a *wrong* runId would imply a
second run existed; a *stale* runId implies no second `run-started` was
observed at all. The recorded evidence (exactly ONE `run_turn_started` in the
whole session, five `execute_turn_prelude_enter`) supports the latter.

# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01

> Status: **OPEN / OPENING / NO_PRODUCTION_DELTA** —
> producer-side causal classification for the bare-done-with-no-
> terminal-commit defect captured at `ACT-CLINEMM-RUNTIME-TASK-
> PROGRESSION-RECON01`'s `OWN01` RED.
>
> Predecessor: `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` reached
> `CAPTURE_INSUFFICIENT` for the positive successor phase at its
> `OWN02-OWN03-RECON` boundary (see
> `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/
> OWN02-OWN03-RECON/recon-report.md`). The reviewer correction
> 2026-08-29 redirected: the high-leverage seam is the producer side,
> not the presentation/translation side. **This ACT opens the
> producer-side recon first.**
>
> ```text
> ENTRY_HEAD = f106bc63d0c3c5ab3683c39b8592cb821b4d32f6
>              (HEAD the OWN01 RED repro'd against; also HEAD at the
>               end of the ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-
>               IMPLEMENTATION01 C2 cherry-pick cascade)
> TRIAGE_HEAD = f106bc63d (same; no production delta in the
>               intervening cycle)
> ```
>
> Scope discipline (THIS ACT):
>
> - **NO production code change.**
> - **NO new `TurnPhase` value.**
> - **NO `MessageTranslator.finishReason` propagation yet.**
> - **NO UI change.**
> - **NO new RED against a hypothetical `awaiting_continuation`.**
> - READ-ONLY recon of producer code paths + bounded executable
>   probes against the real runtime seam IF existing test
>   infrastructure permits.

## 0. Entry conditions

- branch = main
- HEAD = `f106bc63d0c3c5ab3683c39b8592cb821b4d32f6`
- worktree clean (excluding `.factory/evidence/` which is gitignored)
- protected stashes untouched: `stash@{0} = c2-green-and-c2-p1-delta`
- foreign editor-capture residue: preserved

Recorded in:
`.factory/evidence/ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01/entry-freeze.txt`

## 1. Freeze the live observed state (DO NOT pre-classify)

From the OWNO1 RED PTAD specimen (live, captured 2026-08-29):

```text
LIVE:
  runtimeStatus=completed
  attemptCompletionSeen=false
  terminalResponseCommittedThisTurn=false
  errorSeen=false
  recoveryBudgetFailures=0
  toolCalls=222

LIVE_REASON:
  UNAVAILABLE_FROM_TRACE
  (PTAD did NOT capture AgentDoneEvent.reason; the MessageTranslator
   discards event.reason at apps/vscode/src/sdk/message-translator.ts
   :2119)

STRUCTURAL:
  current host/adapter maps AgentRunStatus to only:
    completed | aborted | error
  max_iterations and mistake_limit are dead enum values at the
  production-emission boundary

INFERRED:
  live AgentDoneEvent.reason was probably "completed" (the only
  reachable non-error/non-abort value in the live collapse table)

FORBIDDEN:
  INFERRED must NOT be promoted to LIVE.
```

The defect candidate: **the runtime may be classifying an unfinished
autonomous turn as `completed`** when it should be classified as
`max_iterations` (or some new non-semantic-completion class). If so,
**inventing a downstream `awaiting_continuation` phase would
compensate for a producer contract violation.**

## 2. Inventory every `status === "completed"` producer

Inspect actual current source for **every** code path that can produce
`AgentRunResult.status === "completed"` and **every** code path that
can emit `AgentDoneEvent.reason === "completed"`.

For each producer record:

```text
PRODUCER_ID
SOURCE_LOCATION        (file:line)
TRIGGERING_CONDITION
COMPLETION_TOOL_REQUIRED  (yes/no)
MODEL_STOP_REQUIRED      (yes/no)
MAX_ITERATION_INTERACTION
MISTAKE_LIMIT_INTERACTION
HOOK_STOP_INTERACTION
TERMINAL_CONTENT_COMMITTED  (yes/no — does a completion_result row get
                              emitted to the user?)
INTENDED_SEMANTIC_MEANING
```

Known candidate producers to inventory (NOT exhaustive — find more):

- `sdk/packages/agents/src/agent-runtime.ts:1371` — `finishRun("completed", …)` after no-toolCalls path
- `sdk/packages/agents/src/agent-runtime.ts:1402` — `finishRun("completed", …)` after terminal completion tool content_end
- `sdk/packages/agents/src/agent-runtime.ts:1313-1336` (cited by inline comment at `message-translator.ts:1926+`) — session-termination fallback
- `sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts:124-135` — `statusToLegacyFinishReason` collapse
- `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1570+` — `deriveFinishReason` collapse
- `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1496-1498` — `buildLegacyResult` finishReason assignment

Use `.factory/evidence/ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01/producer-inventory.md`
for the full table.

## 3. Completion-authority classification

Classify each producer as exactly one of:

```text
SEMANTIC_COMPLETION    — user task is semantically complete; no further
                         autonomous work is implied; user-owned phase
                         transition is correct.
MODEL_STOP_ONLY        — model emitted "stop" with no completion tool
                         and no terminal commit. Runtime classifies
                         this as completed but the user task may have
                         remaining autonomous work.
LOOP_EXHAUSTION        — agent loop reached maxIterations without
                         declaring completion. Should NOT be classified
                         as "completed" (the runtime currently THROWS
                         and surfaces as "error"; the reviewer asks
                         whether this should instead be a distinct
                         class).
TOOL_COMPLETION        — a non-completion tool (or completion tool
                         misuse) caused the run to terminate with a
                         successful-looking status.
HOST_FALLBACK          — the session-termination fallback at
                         agent-runtime.ts:1313-1336 fires when no
                         `completesRun` tool is registered (the
                         runtime echoes the last assistant text into
                         done.text regardless of canonical completion).
                         Should NOT necessarily be "completed".
UNKNOWN                — could not classify from source alone.
```

Then answer (this is the load-bearing classification):

```text
Is status=completed intended to mean:
  A) semantic task completion
  B) successful runtime termination (regardless of semantic meaning)
  C) both depending on producer

If C:
  prove whether the API currently loses that distinction.
```

## 4. Trace the `maxIterations` path concretely

Inspect:

- `maxIterations` loop condition at `agent-runtime.ts:1303-1306`
- `maxIterations`-exceeded throw at `agent-runtime.ts:1417-1419`
- catch block at `agent-runtime.ts:1420-1482`
- `AgentRunStatus` assignment at `agent-runtime.ts:1439` (`status = "failed"` because not aborted)
- `runResult.status === "failed"` propagation through `local-runtime-host.ts`
- `AgentDoneEvent.reason` emission via `runtime-event-adapter.ts:124-135` (`statusToLegacyFinishReason("failed") === "error"`)
- `MessageTranslator` discard at `apps/vscode/src/sdk/message-translator.ts:2119` and the partial `setErrorSeen` at `:1915`
- `SdkSessionEventCoordinator` branch at `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:119-122` (`wasErrorSeen()` → `error` phase)

Determine EXACT behavior, end-to-end, when `maxIterations` is reached:

```text
max iterations reached
  → throws Error("Agent runtime exceeded maxIterations (N)")
  → caught at agent-runtime.ts:1420
  → status = "failed"
  → runResult returned
  → local-runtime-host.executeAgentTurn sees status="failed"
  → local-runtime-host.executeTurn calls completeInteractiveTurn(
    session, result.finishReason)
  → BUT: result.finishReason comes from buildLegacyResult at
         session-runtime-orchestrator.ts:1496, which uses
         deriveFinishReason("failed") = "error"
  → session.lastInteractiveTurnFinishReason = "error"
  → runtime-event-adapter emits AgentDoneEvent { reason: "error" }
  → MessageTranslator sets state.setErrorSeen() (line 1915)
  → SdkSessionEventCoordinator routes to "error" phase

DOES THIS PATH ALSO EMIT AgentErrorEvent?
  (look for type:"error" events alongside type:"done" for the
   same iteration)
```

Record the concrete chain in
`.factory/evidence/ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01/max-iterations-path.md`.

## 5. Inspect the fallback-completion path

The session-termination fallback at `agent-runtime.ts:1313-1336` (per
the inline comment at `message-translator.ts:1926+`) fires when no
`completesRun` tool is registered. The runtime echoes the last
assistant text into `done.text` regardless of canonical completion.

Answer:

```text
What exact model/runtime state reaches this fallback?
Why is finishRun("completed") correct there?
Can it occur without:
  completion tool
  terminal response
  user-yield authority?

If yes:
  create a RED or structural witness proving that class.
```

This is the **key discriminator** between
`PRODUCER_SEMANTICS_BUG` (the runtime is wrong to emit completed here)
and `PRESENTATION_PHASE_GAP` (the runtime is right but the coord has
no phase slot).

## 6. Continuation contract — every caller classified

Inspect production use of:

- `agent.run(undefined)` and `agent.run(prompt)`
- `agent.continue()` and `agent.continue(prompt, …)`
- `session.agent.continue(...)` at host layer
- internal continuation in
  `session-runtime-orchestrator.ts:840-853` (retry orchestration)
- `tool-call continuation` after `toolMessages` at
  `agent-runtime.ts:1391-1396`
- `pendingPromptsController.drain(sessionId)` at
  `local-runtime-host.ts:1040-1044`
- team auto-continue loop at `local-runtime-host.ts:1804`
  (`while (shouldAutoContinueTeamRuns(...))`)
- hooks (`beforeRun` / `beforeModel` / `afterRun` /
  `ControlledStopError`) at `agent-runtime.ts:1515+`

Classify every continuation caller as:

```text
USER_OWNED         — user-typed follow-up prompt via webview
HOST_OWNED         — autonomous host-side continuation (no user
                     prompt, no hook stop, no user-yield)
INTERNAL_RECOVERY  — bounded-recovery retry / context-overflow retry
TEAM_ONLY          — gated to team runs
OTHER
```

Then answer the load-bearing question:

```text
Does a supported HOST_OWNED autonomous continuation primitive
already exist for the live class (done(reason="completed") with
no completion tool, no terminal commit, no user-yield authority,
autonomous work just stopped)?

YES / NO / UNKNOWN
```

Record in
`.factory/evidence/ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01/continuation-callers.md`.

## 7. NO phase design yet

Do NOT add or propose a concrete new `TurnPhase` value during this
ACT. Only report whether a new phase is **NECESSARY** after
producer and continuation semantics are known.

Final classification (one of):

```text
PRODUCER_SEMANTICS_BUG
  → AgentRuntime incorrectly classifies non-semantic stops as
    "completed"; downstream architecture would compensate for a
    producer contract violation.

HOST_CONTINUATION_BUG
  → Producer is right ("completed" is correctly emitted) but the
    host lacks a HOST_OWNED autonomous continuation primitive for
    the live class.

PRESENTATION_PHASE_GAP
  → Producer and host are both correct, but the existing
    TurnPhase enum has no slot for "runtime stopped without
    yielding to user".

COMPOSED_BUG
  → Multiple of the above. Identify each component.

CAPTURE_INSUFFICIENT
  → Source recon cannot distinguish; require bounded executable
    probe against the REAL production runtime seam.
```

## 8. Executable evidence (preferred)

If existing test infrastructure permits a bounded probe against the
REAL production runtime seam, prefer executable evidence over source
reading alone. Probe candidates:

```text
RFS01:
  completion-tool success → capture AgentRunStatus.status AND
  AgentDoneEvent.reason AND whether errorSeen was set
  EXPECT: status="completed", reason="completed", errorSeen=false

RFS02:
  fallback/no-completion-tool path (requireCompletionTool=false,
  no completion tool invoked) → capture AgentRunStatus.status AND
  AgentDoneEvent.reason AND whether terminalResponseCommitted
  EXPECT: status="completed", reason="completed", no terminal
  commit. (This is the live-class case.)

RFS03:
  maxIterations exhaustion (configure maxIterations=1, run a tool-
  using task) → capture AgentRunStatus.status AND
  AgentDoneEvent.reason AND whether errorSeen was set
  EXPECT: status="failed", reason="error", errorSeen=true

RFS04:
  agent.continue() after RFS01/RFS02 → capture resulting
  AgentRunStatus.status AND AgentDoneEvent.reason
  EXPECT (per upstream semantics): status="completed",
  reason="completed" (continue is for unfinished conversations;
  but per local-runtime-host.ts:1804 team-auto-continue is the
  only host-driven continuation primitive).
```

Do NOT alter production code to make probes possible unless the
alteration is temporary, DEFAULT_OFF instrumentation (per the existing
PTAD substrate pattern in
`apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-runtime.test.ts`).

If no executable seam exists, **STRUCTURAL evidence is acceptable but
label it honestly**. Record probes attempted (with PASS / FAIL /
NOT_FEASIBLE) in
`.factory/evidence/ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01/probe-results.md`.

## 9. Stop rule

No production repair in this ACT. Stop when the causal classification
is determined.

```text
If producer semantics are wrong:
  VERDICT = PRODUCER_SEMANTICS_BUG

If producer semantics are right but continuation ownership is missing:
  VERDICT = HOST_CONTINUATION_BUG

If both are right and only state representation is missing:
  VERDICT = PRESENTATION_PHASE_GAP

If both producer and continuation are right and the bare-done case
  genuinely maps to awaiting_followup (with a documented semantic):
  VERDICT = CAPTURE_INSUFFICIENT (no defect)

If evidence cannot distinguish:
  VERDICT = CAPTURE_INSUFFICIENT (defect suspected)
```

## 10. Final report

```text
ACT_ID = ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
ENTRY_HEAD = f106bc63d0c3c5ab3683c39b8592cb821b4d32f6
FINAL_HEAD  = (TBD at closure)

LIVE_REASON = UNAVAILABLE_FROM_TRACE

COMPLETED_PRODUCERS =
SEMANTIC_COMPLETION_PRODUCERS =
NON_SEMANTIC_COMPLETION_PRODUCERS =

MAX_ITERATIONS_RUNTIME_STATUS = failed
MAX_ITERATIONS_AGENT_DONE_REASON = error
MAX_ITERATIONS_ERROR_EVENT = (yes/no/depends)

FALLBACK_COMPLETION_CLASSIFICATION =
  (SEMANTIC_COMPLETION | MODEL_STOP_ONLY | LOOP_EXHAUSTION |
   TOOL_COMPLETION | HOST_FALLBACK | UNKNOWN)

CONTINUATION_CALLERS =
HOST_OWNED_AUTOCONTINUE_EXISTS = (YES | NO | UNKNOWN)

PRIMARY_CAUSAL_CLASSIFICATION =
  (PRODUCER_SEMANTICS_BUG | HOST_CONTINUATION_BUG |
   PRESENTATION_PHASE_GAP | COMPOSED_BUG | CAPTURE_INSUFFICIENT)

NEW_TURN_PHASE_REQUIRED = (YES | NO | UNKNOWN)
NEXT_REPAIR_SEAM =

OWN01 = RED (preserved from predecessor)
CPL01..CPL05 = PASS (preserved)
CRA02..CRA03 = PASS (preserved)

PRODUCTION_DELTA = NONE
VERDICT =
```

Valid verdicts:

```text
PRODUCER_SEMANTICS_BUG          -> author bounded repair ACT that
                                   fixes the runtime classification
HOST_CONTINUATION_BUG           -> author bounded repair ACT that
                                   adds a HOST_OWNED continuation
                                   primitive (or transfers ownership
                                   of an existing primitive)
PRESENTATION_PHASE_GAP          -> ACT-CLINEMM-TURN-PHASE-BARE-DONE-
                                   SUCCESSOR01 (already authorized at
                                   this point)
COMPOSED_BUG                    -> split into per-component ACTs
CAPTURE_INSUFFICIENT            -> author bounded probe-acquisition
                                   ACT (RFS01..RFS04) or accept that
                                   the live defect remains UNOBSERVED
                                   for the producer-side variant
```

No generic "probably scheduler bug" verdict.

## 11. Scope discipline (THIS ACT)

- NO production code repair
- NO new `TurnPhase` value
- NO `MessageTranslator.finishReason` propagation
- NO UI change
- NO new RED against a hypothetical `awaiting_continuation`
- NO telemetry implementation
- DO read every producer / continuation code path carefully
- DO classify every producer honestly (SEMANTIC_COMPLETION vs other)
- DO try the RFS01..RFS04 probes if feasible
- DO record all evidence durably at
  `.factory/evidence/ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01/`
- DO preserve:
  - OWN01 RED at `apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:780`
  - OWN01-RED evidence at
    `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/OWN01-RED/`
  - OWN02-OWN03-RECON evidence at
    `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/OWN02-OWN03-RECON/`
  - live PTAD evidence at
    `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/live-20260829T134901Z/`
  - `stash@{0} = c2-green-and-c2-p1-delta`
  - foreign editor-capture residue

## 12. Sequencing after this ACT (per reviewer correction 2026-08-29)

```text
1. ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01       <- this ACT
2. ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01       (only if verdict=PRODUCER_SEMANTICS_BUG or COMPOSED_BUG with producer component)
3. ACT-CLINEMM-MESSAGE-TRANSLATOR-FINISH-REASON-PROPAGATION01  (only after #1 + #2 settled)
4. ACT-CLINEMM-TURN-PHASE-BARE-DONE-SUCCESSOR01        (only if verdict=PRESENTATION_PHASE_GAP)
```

The translation-side seam
(`apps/vscode/src/sdk/message-translator.ts:2119` + the partial
`setErrorSeen` downgrade at `:1915`) is correctly identified by
predecessor `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01`'s `OWN02-
OWN03-RECON`, but proposing a fix there before resolving the producer
side risks compensating downstream for a producer contract violation.
Producer-side recon is the load-bearing next step.
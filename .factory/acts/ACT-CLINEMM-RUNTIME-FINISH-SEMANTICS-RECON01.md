# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01

> Status: **CLOSED / VERDICT_AMENDED / NO_PRODUCTION_DELTA** —
> producer-side causal classification for the bare-done-with-no-
> terminal-commit defect captured at `ACT-CLINEMM-RUNTIME-TASK-
> PROGRESSION-RECON01`'s `OWN01` RED. Original recon verdict
> `PRODUCER_SEMANTICS_BUG` was overturned by the post-evidence
> `HALT_LIVE_COMPLETION_POLICY_NOT_BOUND` discriminator acquisition
> (see `live-completion-policy-acquisition.md`); live producer site
> 1371 is confirmed but was operating under the non-defect
> configuration (`completionPolicy.requireCompletionTool = undefined`).
> The live defect re-routes DOWNSTREAM of the producer to the host
> ownership-transition / awaiting_followup seam already under
> investigation at the predecessor ACT's OWN02-OWN03-RECON. This ACT
> is final; no runtime repair ACT is authorized.
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
> PREDECESSOR_RED_SUBJECT_HEAD = f106bc63d0c3c5ab3683c39b8592cb821b4d32f6
>                 (the production/test subject against which the
>                 predecessor ACT's OWN01 RED was reproduced; also
>                 the HEAD at the end of the ACT-CLINEMM-SEATBELT-
>                 SSH-AGENT-AUTHORITY-IMPLEMENTATION01 C2 cherry-pick
>                 cascade; preserved as a reference, NOT the entry
>                 head of THIS ACT)
> ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
>              (the actual repository HEAD immediately before THIS
>               ACT was opened = commit 6ecf546f8
>               "RUNTIME-TASK-PROGRESSION-RECON01 OWN02-OWN03-RECON:
>                bounded fix cycle (reviewer correction 2026-08-29)";
>               the predecessor bounded fix cycle landed at THIS HEAD;
>               the ACT was opened AT 2401faf4a)
> OPEN_HEAD = 2401faf4ac14d6604952f7c840e1b0e45f7992ea
>             (the commit that introduced THIS ACT; informational)
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
- PREDECESSOR_RED_SUBJECT_HEAD = `f106bc63d0c3c5ab3683c39b8592cb821b4d32f6`
  (production/test subject against which the predecessor ACT's `OWN01`
   RED was reproduced; preserved as a reference)
- ENTRY_HEAD = `6ecf546f84b6593904357d198c56aadd89fe2a85`
  (the actual repository HEAD immediately before THIS ACT was opened;
   the predecessor bounded fix cycle landed here)
- OPEN_HEAD = `2401faf4ac14d6604952f7c840e1b0e45f7992ea`
  (the commit that introduced THIS ACT; informational)
- worktree clean at ENTRY_HEAD (excluding `.factory/evidence/` which is
  gitignored; the foreign editor-capture residue was preserved as
  untracked/local-only material per the prior ACT's residue policy)
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
PREDECESSOR_RED_SUBJECT_HEAD = f106bc63d0c3c5ab3683c39b8592cb821b4d32f6
ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
OPEN_HEAD  = 2401faf4ac14d6604952f7c840e1b0e45f7992ea
ENTRY_IDENTITY_FIX_HEAD = 49f7d730aa822a10c277797a8c805db527c2db56
FINAL_HEAD = 247922cfd9a73b39fa1c9e1f4c5e8a3b27d5f1e4 (this commit's parent at the time of authoring; see below)

LIVE_REASON = UNAVAILABLE_FROM_TRACE

COMPLETED_PRODUCERS = 2 (local seam) + 1 (hub seam)
  Local:  agent-runtime.ts:1371 (COMPLETION-REMINDER-EXHAUSTION)
          agent-runtime.ts:1402 (COMPLETION-TOOL-AUTHORITY)
  Hub:    hub-runtime-host.ts:546-548 (HUB-DONE-EVENT-FROM-PAYLOAD default)

SEMANTIC_COMPLETION_PRODUCERS = 1
  agent-runtime.ts:1402 (requires completesRun tool observation)

NON_SEMANTIC_COMPLETION_PRODUCERS = 2
  agent-runtime.ts:1371 (under completionPolicy.requireCompletionTool === true)
  hub-runtime-host.ts:546-548 (default fallback for unknown reason)

MAX_ITERATIONS_RUNTIME_STATUS = "aborted" or "failed" (NEVER "completed")
MAX_ITERATIONS_AGENT_DONE_REASON = "aborted" (NEVER "max_iterations")
MAX_ITERATIONS_ERROR_EVENT = YES (when status === "failed", emits run-failed → AgentErrorEvent)

FALLBACK_COMPLETION_CLASSIFICATION = AMBIGUOUS
  (under requireCompletionTool=true: collapses two distinct meanings into one outcome)
  (under requireCompletionTool=false: RUNTIME_INVOCATION_COMPLETION — natural stop IS canonical done)

CONTINUATION_CALLERS = 7 inventoried (see continuation-callers.md)
  LOCAL_HOST_EXECUTE_AGENT_TURN         USER_OWNED
  SESSION_RUNTIME_ORCHESTRATOR_INTERNAL_RUN TOOL_FLOW
  PENDING_PROMPTS_CONTROLLER_DRAIN      USER_OWNED
  AGENT_RUNTIME_CONSUME_PENDING_USER_MESSAGE HOST_OWNED (NOT WIRED)
  TEAM_ONLY_SPAWN_AGENT_TOOL           TEAM_ONLY
  TEAM_SESSION_COORDINATOR_CAN_AUTO_CONTINUE TEAM_ONLY
  CLI_AGENT_EXAMPLE_RUN_CONTINUE       USER_OWNED

HOST_OWNED_AUTOCONTINUE_EXISTS = NO
  (the API supports one — consumePendingUserMessage at types.ts:944 — but the
   live ClineMM LocalRuntimeHost does NOT wire it. The host uses
   pendingPromptsController.drain instead, which is USER_OWNED.)

PRIMARY_CAUSAL_CLASSIFICATION = NOT_LIVE_CAUSE  (amended post-acquisition;
                                                       see live-completion-policy-acquisition.md)
  Original verdict at close fd8627cb6 was PRODUCER_SEMANTICS_BUG.
  That verdict was OVERCLAIMED — the live configuration
  (completionPolicy.requireCompletionTool = undefined / false) was
  NOT bound at close time. The reviewer halt
  HALT_LIVE_COMPLETION_POLICY_NOT_BOUND was cleared by the
  post-acquisition discriminator capture, which established that the
  live producer at 1371 was operating under the non-defect
  configuration.

  Ruled out (final-assessment.md §1, post-amendment):
    PRODUCER_SEMANTICS_BUG — operating correctly under live config
    HOST_CONTINUATION_BUG  — no wired primitive to fail to invoke
    PRESENTATION_PHASE_GAP — producer semantics were NOT the live defect
    COMPOSED_BUG           — no independent host defect to compose with
    CAPTURE_INSUFFICIENT   — capture WAS sufficient (config IS now bound)

FIRST_BROKEN_BOUNDARY (LIVE) = UNKNOWN (was agent-runtime.ts:1371 at
                                original close; amended to UNKNOWN
                                because 1371 was exonerated)
FIRST_BROKEN_BOUNDARY (STRUCTURAL) = agent-runtime.ts:1371 remains a real
                                latent defect under
                                completionPolicy.requireCompletionTool=true.
                                STRUCTURAL only; not live.

NEW_TURN_PHASE_REQUIRED = UNKNOWN  (cannot evaluate without knowing where the
                                   live defect actually lives; the producer seam
                                   is exonerated, so the question moves to the
                                   host ownership transition / awaiting_followup
                                   / no autonomous continuation seam — out of
                                   scope for THIS recon ACT)

NEXT_REPAIR_SEAM = UNKNOWN  (the previous "ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-
                            REPAIR01" recommendation was based on the overclaimed
                            PRODUCER_SEMANTICS_BUG verdict; under the corrected
                            verdict, the live defect is NOT at 1371 and the
                            next repair seam is OUT OF SCOPE for this ACT.
                            The live defect re-routes DOWNSTREAM to the host
                            ownership-transition / awaiting_followup seam
                            already under investigation at the predecessor
                            ACT's OWN02-OWN03-RECON.)

RFS01 = NOT_EXECUTED         (pre-existing tests cover submit_and_exit)
RFS02 = STRUCTURAL_ONLY      (definitive source walk)
RFS03 = NOT_REPRESENTABLE    (requires real model + tools + completionPolicy)
RFS04 = NOT_REPRESENTABLE    (no HOST_OWNED primitive wired on host)

OWN01 = RED (1 failed | 28 passed of 29)
CPL01..CPL05 = PASS (preserved)
CRA02..CRA03 = PASS (preserved)

PRODUCTION_DELTA = NONE
  (5 production files byte-identical between PREDECESSOR_RED_SUBJECT_HEAD
   and FINAL_HEAD: sdk-session-event-coordinator.ts, message-translator.ts,
   agent-runtime.ts, local-runtime-host.ts, session-runtime-orchestrator.ts)

EVIDENCE_COMMITTED = 7 (this ACT) + 3 (predecessor curated) = 10 files
  producer-inventory.md classification-table.md max-iterations-path.md
  fallback-completion-path.md continuation-callers.md probe-results.md
  final-assessment.md
  + OWN01-RED/red-record.json OWN01-RED/red-file-only-result.txt
  + live-20260829T134901Z/post-terminal-authority-diagnostic-extension.jsonl

VERDICT (ORIGINAL — at close fd8627cb6) = PRODUCER_SEMANTICS_BUG
VERDICT (AMENDED — at HALT_LIVE_COMPLETION_POLICY_NOT_BOUND reopen) = NOT_LIVE_CAUSE
LIVE_PRODUCER_SITE_1371 = PROVEN
LIVE_REQUIRE_COMPLETION_TOOL = FALSE (acquired from ~/.cline + transcript)
STRUCTURAL_BUG_AT_1371 = PROVEN for requireCompletionTool=true (latent; NOT live)
OPERATIONAL_ACTION = RETURN_TO_SSH_LIVE_QUALIFICATION
                     (do NOT open ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01)
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

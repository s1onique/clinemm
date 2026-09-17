# ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-POST-RESULT-CONTINUATION-RECON01 — Final Report

> ACT-ID: `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-POST-RESULT-CONTINUATION-RECON01`
> HEAD: `610091e584b9ed10132a51f18423a19a5046fd0c`
> Verdict: **GREEN — continuation scheduling CONSERVED**
> Status: **CLOSED / GREEN / NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY**
> (CORRECTION01 applied; reviewer P1 fix: semantic-invariant oracle,
> non-strict bookkeeping, reviewer's improved NEXT_CAUSAL_FRONTIER
> phrasing.)

## Verdict

```text
P1_POST_RESULT_CONTINUATION_SCHEDULING = CONSERVED

For the exercised production-shaped schedule:
  RESULT_EXISTS-shaped tool call -> real AgentTool.execute(...) succeeds
  -> tool-result AgentMessage appended into state.messages
  -> message-added + turn-finished AgentRuntimeEvents emitted
  -> while-loop body iterates
  -> a SUBSEQUENT scripted model request receives the tool message
     in its `messages` array — observed via the `findLast(m.role==="tool")`
     assertion (robust to any future valid runtime that injects
     bookkeeping messages after the tool result, e.g. recovery notices
     or hook injections)
  -> continuationObserved flag flipped
  -> second finish: stop
  -> runResult.status === "completed", runResult.outputText === "after-tool"
```

The runtime does NOT silently consume the tool result and produce no
continuation: it re-enters the while-loop body, calls
`generateAssistantMessageWithOverflowRecovery()` again, and the
subsequent model request's transcript carries the tool message.

### CORRECTION01 — semantic-invariant oracle (reviewer P1 fix)

The original GREEN asserted exact bookkeeping
(`model.requests.toHaveLength(2)`,
`turnStartedIterations.toEqual([1, 2])`,
`result.iterations === 2`). Per reviewer P1 those three assertions
collectively freeze implementation bookkeeping; a future valid
runtime that performs an extra internal iteration / recovery /
compaction pass that reuses the `AgentRuntime.execute()` machinery
(cf. upstream #12388) would be falsely RED-flagged.

The corrected GREEN asserts the SEMANTIC invariant:

```text
  continuationObserved       == true   (causal oracle, flipped
                                       by the second scripted step)
  model.requests.length      >= 2     (bookkeeping proxy, non-strict)
  turnStartedIterations      contains 1
                             AND some(n > 1)
  result.status              == "completed"   (explicit terminal outcome)
  result.outputText          == "after-tool"
```

Exact listener cardinalities, exact internal counter values, exact
object identity, exact number of TurnState writes, and
`result.iterations === 2` are all explicitly NOT asserted. The
discriminator is robust to upstream refactors that add internal
continuations / recovery / compaction passes as long as the
semantic invariant holds.

### Composite-evidence classification (per reviewer C1)

```text
AGENT_RUNTIME_INNER_LOOP = REAL_PRODUCTION_SEAM
INPUT / MODEL / TOOL      = SYNTHETIC
COMPOSED_EVIDENCE         = SYNTHETIC_REAL through REAL_PRODUCTION_SEAM
RESULT                    = post-tool AgentRuntime continuation
                            reproduced successfully (NOT LIVE;
                            does not invalidate the upstream VSCode
                            symptom reports in #10537 / #10122,
                            only narrows the search space)
```

Test output (abridged) at
`.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-POST-RESULT-CONTINUATION-RECON01/probe-p1-run-log.txt`:

```text
RUN  v4.1.10 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/agents

 ✓ src/agent-runtime.task-progression-post-result-continuation-recon01.test.ts (1 test) 6ms

Test Files  1 passed (1)
     Tests  1 passed (1)
  Duration  1.77s
```

Directly-related suites, re-run together:

```text
 ✓ src/agent-runtime.task-progression-post-result-continuation-recon01.test.ts (1 test) 6ms
 ✓ src/agent-runtime.execution-state.test.ts (22 tests) 15ms
 ✓ src/agent-runtime.outcome-integration.test.ts (17 tests) 45ms
 ✓ src/agent-runtime.test.ts (64 tests) 55ms

Test Files  4 passed (4)
     Tests  104 passed (104)
```

Typecheck gate (`sdk/packages/agents`):

```text
bunx tsc --noEmit -p tsconfig.json     -> clean
bunx tsc --noEmit -p tsconfig.dev.json -> clean
```

Lint gate:

```text
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
bunx biome check --write
  sdk/packages/agents/src/agent-runtime.task-progression-post-result-continuation-recon01.test.ts
-> no remaining errors after auto-fix (organize-imports + format)

## §3 classification

```text
CLASS = N/A (P1 GREEN, no boundary failure observed at [5])
```

The §3 classifications (B / C / D / E / F / G / H) are for RED
outcomes where a real production-seam boundary failure is reproduced.
P1 GREEN means none of those classifications apply.

What we ruled out by exercising the real production seam:

- **CASE_B** (event received but continuation-decision callback not
  invoked) — N/A; continuation is not event-driven; it lives inside
  the inner loop in `AgentRuntime.execute()`. The session-event
  consumer does not own continuation (see source-seam-map §[3] and
  §[3'] for the inventory).
- **CASE_C** (continuation-decision callback invoked but silently
  chooses no action) — N/A; there is no continuation-decision
  callback in production. The inner loop unconditionally re-enters
  `generateAssistantMessageWithOverflowRecovery()` after a non-
  terminal `turn-finished`.
- **CASE_D** (continuation requested but scheduler/queue drops it) —
  N/A; there is no scheduler/queue.
- **CASE_E** (continuation enters but provider/model invocation never
  starts) — N/A; the second scripted `model.stream()` call was
  observed (the second scripted step returned a tool message
  assertion + `text-delta` + `finish: "stop"`).
- **CASE_F** (provider/model invocation starts and stalls) — N/A;
  the second model invocation returned cleanly with `finish: "stop"`.
- **CASE_G** (runtime progresses correctly; UI/TurnState only
  appears stuck) — Not exercised by this ACT. Out-of-scope for the
  runtime inner-loop seam; this is owned by the projection epic.
- **CASE_H** (explicit waiting/error state is correct) — N/A; the
  inner loop reached `completed` (a terminal state) on its own
  merits, no waiting/error fallback was needed.

## What this ACT established

1. The continuation-scheduling contract is CONSERVED for the
   exercised production-shaped schedule (one tool call, one tool
   execution, one tool result, then continuation into a subsequent
   model invocation, then `finish: "stop"`, then
   `status: "completed"`):
   - `AgentRuntime.execute()` re-enters its `while` loop body after
     `turn-finished` when `toolCalls.length > 0` and no terminal
     finishRun fired.
   - `state.iteration += 1` then `turn-started { iteration: N }` is
     emitted (N > 1).
   - `generateAssistantMessageWithOverflowRecovery()` is called and
     a subsequent model request observes the tool message in its
     `messages` array (asserted via `findLast` on
     `m.role === "tool"` + `toMatchObject({type: "tool-result", toolCallId})`
     inside the second scripted step; this also flips the
     `continuationObserved` causal flag).
   - The runtime reaches `result.status === "completed"` — a
     documented terminal outcome, not a silent stall.
2. The session-event consumer is NOT the owner of continuation
   scheduling (per §3 Q1-Q3 recon): `WebviewGrpcBridge` only pushes
   to webview; `SdkSessionEventCoordinator.handleSessionEvent` only
   drives turn-phase promotion. The runtime's inner while-loop is
   the owner, and it works under the exercised schedule.
3. TurnState is NOT changed during continuation
   (`SdkSessionEventCoordinator.setTurnPhase` is driven by legacy
   `done`/`error`/`session_ended` events, not by AgentRuntime
   continuation). Out-of-scope for runtime-progression.

## §5 verdict — RECON01 disposition

```text
RECON01_STATUS            = CLOSED
RECON01_DISPOSITION       = NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
RECON01_ORACLE            = SEMANTIC_INVARIANT (CORRECTION01; non-strict
                             bookkeeping; continuationObserved causal
                             flag flipped by the second scripted step)
COMPOSED_EVIDENCE         = SYNTHETIC_REAL through REAL_PRODUCTION_SEAM
NEXT_CAUSAL_FRONTIER      = bind a real stuck specimen AFTER
                             AgentRuntime continuation, and determine
                             whether the first divergence is:
                               - provider invocation/response
                               - host/runtime projection
                               - VSCode bridge/state publication
                               - UI projection
                             (NOT a single "first untested boundary";
                             several remaining lanes need to be
                             discriminated by a future operator-driven
                             LIVE capture ACT under the runtime-task-
                             progression epic)
HANDOFF                   = RUNTIME_TASK_PROGRESSION (deferred; the
                             epic owns the broader symptom family;
                             no follow-on probe is pre-authorized here)
REPAIR_AUTHORIZED         = NO (child BOUNDED REPAIR ACT NOT
                                  pre-authorized by this RECON)
PRODUCTION_DELTA          = ZERO
```

## Final disposition (CLOSED — GREEN)

```text
RECON01_STATUS            = CLOSED
RECON01_PURPOSE           = REPRODUCTION_AND_BOUNDARY_CLASSIFICATION
CAUSE                     = UNKNOWN at [5]; the boundary is CONSERVED
ENTRY_SEAM                = POST_SESSION_EVENT (frozen at [3] by RECON02,
                              extended into [5] by this RECON)
UPSTREAM_RADAR            = 2 load-bearing (#10537, #10122)
                             + 2 adjacent (#12827, #13691)
                             + 1 heterogeneous (#13380)
PRODUCTION_DELTA          = ZERO
REPAIR_AUTHORIZED         = NO
VERDICT                   = P1_POST_RESULT_CONTINUATION_SCHEDULING
                             = CONSERVED
                             ([5] CONSERVED at the production seam)
DISPOSITION               = NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
RECON01_ORACLE            = SEMANTIC_INVARIANT (CORRECTION01;
                             continuationObserved causal flag +
                             non-strict bookkeeping; does NOT freeze
                             iteration count)
COMPOSED_EVIDENCE         = SYNTHETIC_REAL through REAL_PRODUCTION_SEAM
NEXT_CAUSAL_FRONTIER      = bind a real stuck specimen AFTER
                             AgentRuntime continuation; discriminate
                             among provider / host-runtime projection /
                             VSCode bridge / UI projection as the
                             first divergence (NOT a single boundary;
                             several lanes)
STOP                      = yes — no follow-on probes authored
                             speculatively
INVENTORY                 = §1 source-seam-map.md AUTHORED;
                             §2 single-probe discriminator executed (GREEN);
                             §3 classification N/A (P1 GREEN);
                             §5 NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
NEXT                      = NOT pre-authorized. If/when the runtime-
                             task-progression epic needs a deeper probe
                             past [5], that ACT lives at this epic and
                             is NOT pre-authorized here.
PARALLEL_OPERATOR_GATE    = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-
                             DISCRIMINATOR01 (operator-gated; NOT
                             blocking RECON01)
NEW_REVIEW_ROUND          = NO (closure ACT)
EVIDENCE                  = sdk/packages/agents/src/agent-runtime.task-
                             progression-post-result-continuation-recon01.
                             test.ts (CORRECTION01: semantic-invariant
                             oracle; findLast tool-message probe;
                             non-strict bookkeeping proxies; vitest;
                             PASSING)
                           + .factory/evidence/.../source-seam-map.md
                           + .factory/evidence/.../probe-p1-run-log.txt
                           + .factory/evidence/.../final-report.md
                           + .factory/evidence/.../entry-freeze.txt
```

```text
ROOT_CAUSE_ISOLATED    → child BOUNDED REPAIR ACT may be authored
                          under its own ACT ID; NOT pre-authorized here
NOT_REPRODUCED         → closes cleanly; recon is the deliverable
CAPTURE_INSUFFICIENT   → closes with a precise follow-on ACT that
                          captures what was missing (e.g. an operator
                          live-recurrence ACT, not a repair ACT)
```

> **Only `ROOT_CAUSE_ISOLATED` authorizes a child repair ACT.**
> `NOT_REPRODUCED` and `CAPTURE_INSUFFICIENT` do NOT.

## Classification metadata

```text
HEAD: 610091e584b9ed10132a51f18423a19a5046fd0c
file: .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-POST-RESULT-CONTINUATION-RECON01/final-report.md
classification author: ACT closure (this turn;
                  CORRECTION01 reviewer P1 fix applied)
evidence type: REAL_PRODUCTION_SEAM (real AgentRuntime + real AgentTool
                + scripted AgentModel at its natural boundary)
composed evidence: SYNTHETIC_REAL through REAL_PRODUCTION_SEAM
oracle: SEMANTIC_INVARIANT (continuationObserved causal flag +
         non-strict bookkeeping; does NOT freeze iteration count)
production source delta: ZERO
repair authorized: NO
```

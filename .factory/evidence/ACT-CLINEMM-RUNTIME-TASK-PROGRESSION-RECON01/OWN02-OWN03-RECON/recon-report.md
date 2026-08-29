# ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 — OWN02/OWN03 RECON

## ACT_ID

`ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01`

## Recon purpose

Locate the exact lossy boundary that discards the authoritative
`AgentDoneEvent.reason` between `AgentRuntime` and
`SdkSessionEventCoordinator`, prove which finish reasons can actually
reach the VS Code adapter in current code, and determine the supported
successor primitive for the bare-done case (the OWN01 RED's missing
positive contract).

## Trust baseline

- Branch: `main`
- HEAD: `f106bc63d0c3c5ab3683c39b8592cb821b4d32f6`
- Stash `@{0}`: `c2-green-and-c2-p1-delta` (preserved, untouched)
- Foreign editor-capture residue: preserved
- OWN01 RED evidence: durably captured at `OWN01-RED/`
- No rebase, no reset, no stash pop performed in this cycle

## Lossy boundary

**Location:** `apps/vscode/src/sdk/message-translator.ts:2119-2121`
(in the `agent_event` case for `type === "done"`)

```ts
// Check for done/error events
if (agentEvent.type === "done") {
    result.turnComplete = true
}
```

`agentEvent.reason: AgentFinishReason` (a `done` event's authoritative
finish reason per `sdk/packages/shared/src/agents/types.ts:239-249`)
is never assigned to anything on `TranslationResult`. The
`TranslationResult` interface at lines 63-83 has no `finishReason`
field, so the type system provides no surface for the coord to read
it from even if it wanted to.

A second lossy point is at lines 1912-1917 specifically for
`reason === "error"`:

```ts
// A turn can terminate with done(reason:"error") without a separate
// "error" event — record the error outcome here too so turn end still
// resolves to the "error" phase (Retry / Start New Task).
if (event.reason === "error") {
    state.setErrorSeen()
}
```

This is **partial preservation**: the translator downgrades
`done(reason="error")` into the boolean `errorSeen` flag. The
underlying `event.reason` is still not propagated as a value.

The third lossy point is in the `agent_event` error case at lines
2124-2130, which sets `turnComplete = true` for non-recoverable errors
but discards `agentEvent.errorClass` (ProviderErrorClass, declared on
`AgentErrorEvent` at `sdk/packages/shared/src/agents/types.ts:251-260`).

## Authoritative semantics table

The runtime layer has TWO separate enums:

**`AgentRunStatus`** (`sdk/packages/shared/src/agent.ts:144-149`) — the
internal runtime-result type:

```text
"idle" | "running" | "completed" | "aborted" | "failed"
```

**`AgentFinishReason`** (`sdk/packages/shared/src/agents/types.ts:589-594`)
— the public-facing type carried on `AgentDoneEvent`:

```text
"completed" | "max_iterations" | "aborted" | "mistake_limit" | "error"
```

Two boundary functions collapse `AgentRunStatus` to `AgentFinishReason`:

1. `statusToLegacyFinishReason` at
   `sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts:124-135`:

   ```ts
   switch (status) {
       case "completed": return "completed"
       case "aborted":   return "aborted"
       case "failed":    return "error"
   }
   ```

2. `deriveFinishReason` at
   `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1570+`:

   ```ts
   switch (runResult.status) {
       case "completed": return "completed"
       case "aborted":   return "aborted"
       case "failed":    return "error"
   }
   ```

**Critical finding**: both functions collapse exactly three values.
**`max_iterations` and `mistake_limit` are dead enum values at the
production-emission boundary.** No code path in the current SDK
runtime produces `AgentDoneEvent.reason === "max_iterations"` or
`AgentDoneEvent.reason === "mistake_limit"`. The runtime catch at
`sdk/packages/agents/src/agent-runtime.ts:1417-1419` throws
`new Error("Agent runtime exceeded maxIterations …")` instead of
calling `finishRun("max_iterations", …)`, which means the host
sees `status: "failed"` for both genuine errors and iteration
exhaustion.

This means the live PTAD specimen's
`attemptCompletionSeen=false && errorSeen=false && terminalResponseCommittedThisTurn=false`
implies (does NOT prove — PTAD did not capture `event.reason`) the
`done` event's `reason` was likely **`"completed"`** because that's
the only reachable non-error/non-abort value in the live collapse
table. The agent ran 222 tool calls, never declared completion, and
the runtime reported the turn as semantically complete via the
session-termination fallback at
`sdk/packages/agents/src/agent-runtime.ts:1313-1336` (cited by the
inline comment at `apps/vscode/src/sdk/message-translator.ts:1926+`).

Live-reason classification (per reviewer correction 20260829):

```text
LIVE:
  runtimeStatus=completed
  errorSeen=false
  attemptCompletionSeen=false
  terminalResponseCommittedThisTurn=false

STRUCTURAL:
  current adapter can emit only:
    completed | aborted | error

INFERRED:
  live AgentDoneEvent.reason was probably "completed"

LIVE_REASON:
  UNAVAILABLE_FROM_TRACE
```

Inferred → live promotion is FORBIDDEN. The producer-side causal
classification that `ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01`
will answer is the load-bearing step.

| `AgentDoneEvent.reason` | PRODUCER (in current code) | MEANING | CURRENT ADAPTER PRESERVES? | CURRENT COORD OUTCOME | REQUIRED OWNERSHIP |
| --- | --- | --- | --- | --- | --- |
| `"completed"` (no terminal commit) | Runtime fallback `finishRun("completed", …)` after iteration/exhaustion | Agent stopped without declaring completion | NO — discarded at `message-translator.ts:2119` | `awaiting_followup` (CPL01) | NOT `awaiting_followup` when no user-yield authority |
| `"completed"` (with terminal commit) | Runtime after completion tool's `content_end` | Task semantically complete | NO — discarded | `completed` (CPL02) | `completed` (conservation) |
| `"aborted"` | `completeAbortedInteractiveTurn` at `local-runtime-host.ts:1916` | Turn was cancelled | NO — discarded | `resumable` (preserves cancel) | `resumable` (conservation) |
| `"error"` | `runResult.status === "failed"` from runtime catch (also `event.error` from a separate `error` event) | Turn failed | PARTIAL — `errorSeen` boolean is set, but the underlying reason string is discarded | `error` (CPL05) | `error` (conservation) |
| `"max_iterations"` | **DEAD** — never emitted; runtime throws instead | n/a in current code | n/a | n/a | n/a |
| `"mistake_limit"` | **DEAD** — never emitted | n/a in current code | n/a | n/a | n/a |

## Successor contract analysis

The live task's PTAD case is `done(reason="completed")` with no
terminal commit. The reviewer's question:

> Determine whether current architecture expects:
>   A. host/session invokes continue()
>   B. runtime remains resumable and caller re-enters run/continue
>   C. another existing coordinator path restarts the autonomous turn
>   D. max_iterations is intentionally terminal to the autonomous run

Per the local-runtime-host analysis (`local-runtime-host.ts:1022-1044`):

- The host invokes `session.agent.run(...)` or `.continue(...)` once
  per interactive turn.
- After a non-error finish, `pendingPromptsController.drain(sessionId)`
  runs (`local-runtime-host.ts:1040-1044`). This drains user-queued
  follow-up prompts — NOT autonomous continuation.
- There is no auto-continue primitive for bare `done(reason="completed")`
  in the interactive path. The team auto-continue loop at
  `local-runtime-host.ts:1804` (`while (shouldAutoContinueTeamRuns(…))`)
  is gated to team runs only.

The existing `TurnPhase` enum (`apps/vscode/src/shared/ExtensionMessage.ts:457-473`):

```text
"idle" | "streaming" | "awaiting_approval" | "awaiting_followup"
  | "compacting" | "completed" | "error" | "resumable"
```

**No phase slot exists for "runtime stopped without yielding to user."**

The reviewer explicitly forbids: "no new state machine, no global
awaiting_followup semantic change, no UI fix, no header-label change,
no synthetic user Continue, no timer/polling, no prompt injection, no
special-case MiniMax."

The forbidden list forecloses every concrete positive successor option:

- `awaiting_followup` — explicitly what OWN01 says is wrong.
- `streaming` — recreate the pre-CPL01 stuck-streaming bug.
- `completed` — violates CRA02-committed (no terminal content was
  committed; completion CONTENT authority contract forbids this).
- `error` — no error happened.
- `resumable` — turn was NOT cancelled.
- `idle` — not the pre-task state; the turn DID run for 222 tool calls.
- **A new phase** — forbidden (new state machine).

**Conclusion: the positive successor phase for the OWN01 case is not
discoverable within the bounded scope of this cycle.** This is
**CAPTURE_INSUFFICIENT** per the reviewer's stop rule.

## RED refinement

The reviewer prescribed OWN02..OWN04:

| Test | Reason | + commit? | + user-yield? | Expected outcome |
| --- | --- | --- | --- | --- |
| OWN02 | `max_iterations` | no | no | NOT `awaiting_followup` |
| OWN03 | `mistake_limit` | no | (genuine mistake advisory) | `awaiting_followup` is valid (conservation) |
| OWN04 | `completed` (semantic) | yes | n/a | `completed` |

**OWN02 is not implementable in current code**: `max_iterations` is a
dead enum value, so the coord can never observe it. A test asserting
"the coord handles `reason === "max_iterations"`" would be a contract
test against non-existent behavior — not a RED.

**OWN03 is similarly unreachable** in current code.

**OWN04 is already covered by CPL02** (the existing conservation test
for `completed` with terminal commit).

Therefore the proper next-cycle deliverables are:

1. **OWN01 stays RED** (already in place at line 780).
2. **The production seam-clear work** (`TranslationResult.finishReason`
   propagation) is a separate bounded ACT that requires successor
   contract resolution first.
3. **CAPTURE_INSUFFICIENT** is reported here for the positive
   successor phase decision.

## RED state

```text
Test Files  1 failed (1)
Tests  1 failed | 28 passed (29)
× OWN01 RED
```

```text
ASSERTION: expected true to be false // Object.is equality
SITE: apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:817
PRODUCTION SEAM: apps/vscode/src/sdk/sdk-session-event-coordinator.ts:172-225
PRODUCTION BRANCH: wasAttemptCompletionSeen() === false
                && wasTerminalResponseCommittedThisTurn() === false
                → setTurnPhase("awaiting_followup", …)
```

Production code is byte-identical to main HEAD `f106bc63d`.
Other 28 tests in the same file (CPL01..CPL05, CRA02..CPL03,
T2-EXT01-A/B/C) all PASS — no regression.

## Production delta this cycle

**None.** Test-only corrections to OWN01's comment block (removing
the unproven `max_iterations` inference and re-labelling it
`LIVE_REASON = UNAVAILABLE_FROM_TRACE`).

## Verdict

`CAPTURE_INSUFFICIENT` for the positive successor phase.

Per reviewer correction 20260829, the high-leverage seam is the
producer side, not the presentation/translation side. The fix order
is:

```text
(1) PRODUCER_SEMANTICS_RECON    ← next ACT (next cycle)
(2) PRODUCER_SEMANTICS_REPAIR   ← only if (1) shows producer bug
(3) TRANSLATION_PROPAGATION     ← only after (1)+(2) settled
(4) TURN_PHASE_DESIGN           ← only if (1) shows presentation gap
```

The translation-side seam (`message-translator.ts:2119` + the partial
`setErrorSeen` downgrade at `:1915`) is now correctly identified, but
proposing a fix there before resolving the producer side risks
compensating downstream for a producer contract violation. The
producer-side recon is the load-bearing next step.

## Open follow-up ACTs (not in this cycle's scope)

Per reviewer correction 20260829: **the high-leverage seam is the
producer side, not the presentation/translation side**. The proposed
follow-up order is now (1) producer-side causal classification FIRST,
then (2) presentation/translation work if and only if the producer
classification does not absorb the defect.

1. **`ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01`** (next ACT,
   recommended first) — Inventory every code path that can produce
   `AgentRunStatus.status === "completed"` and every path that emits
   `AgentDoneEvent.reason === "completed"`. Classify each producer
   as one of: `SEMANTIC_COMPLETION`, `MODEL_STOP_ONLY`,
   `LOOP_EXHAUSTION`, `TOOL_COMPLETION`, `HOST_FALLBACK`,
   `UNKNOWN`. Trace the `maxIterations` throw → catch → `status`
   conversion concretely. Audit every `agent.run(...)` /
   `agent.continue(...)` / `pendingPromptsController.drain(...)`
   caller to determine whether a `HOST_OWNED` autonomous
   continuation primitive already exists for the live class.
   Reach one of: `PRODUCER_SEMANTICS_BUG`, `HOST_CONTINUATION_BUG`,
   `PRESENTATION_PHASE_GAP`, `COMPOSED_BUG`, `CAPTURE_INSUFFICIENT`.
   No production change. No new phase design.

2. **`ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01`** (only if #1
   returns `PRODUCER_SEMANTICS_BUG` or `COMPOSED_BUG` with a
   producer component) — Fix the producer-side misclassification.
   If `AgentRuntime.execute()` should call
   `finishRun("max_iterations", …)` instead of throwing when the
   iteration ceiling is reached, patch that path. If the
   session-termination fallback at
   `agent-runtime.ts:1313-1336` should not emit
   `finishRun("completed")` when no completion authority was
   observed, patch that path.

3. **`ACT-CLINEMM-MESSAGE-TRANSLATOR-FINISH-REASON-PROPAGATION01`**
   (only after #1 + #2 are resolved) — Add `finishReason?: AgentFinishReason`
   to `TranslationResult`, set it from `event.reason` in the `done`
   handler, add `lastAgentFinishReason` getter/setter to
   `MessageTranslatorState`, and have `SdkSessionEventCoordinator`
   consult the reason to route `done(reason="completed")` with no
   terminal commit based on the resolved producer semantics.

4. **`ACT-CLINEMM-TURN-PHASE-BARE-DONE-SUCCESSOR01`** (only if
   `PRESENTATION_PHASE_GAP` is the final classification) — Add a
   new `TurnPhase` value (e.g. `"awaiting_continuation"`) with
   appropriate `turnAllowsFollowup()` semantics, AND/OR extend the
   existing `awaiting_followup` semantics with a discriminator
   (visible-but-not-user-owned variant). This ACT must NOT be
   authorized until #1 has been answered; otherwise we risk
   compensating downstream for a producer contract violation.

## Conservation gates verified

- `git diff --stat HEAD` (test file only, +93 lines after this cycle's
  comment correction): expected.
- `git diff --stat HEAD -- apps/vscode/src/sdk/sdk-session-event-coordinator.ts`: empty.
- `git diff --stat HEAD -- apps/vscode/src/sdk/message-translator.ts`: empty.
- `git diff --stat HEAD -- sdk/packages/core/src/runtime/host/local-runtime-host.ts`: empty.
- OWN01 RED: reproduces.
- All other CPL/CRA/T2-EXT tests: PASS.
- Stash `@{0}` (`c2-green-and-c2-p1-delta`): preserved.
- Foreign editor-capture residue: preserved.

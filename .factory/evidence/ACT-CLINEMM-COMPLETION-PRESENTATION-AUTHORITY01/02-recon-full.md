# 02 — Recon: who emits what?

## Submission tool identity

```text
SUBMIT_TOOL_DEFINITION       = sdk/packages/core/src/extensions/tools/definitions.ts:1076+
SUBMIT_TOOL_RESULT_SEAM      = message-translator.ts:1761-1794 (content_end handler)
AGENT_COMPLETES_RUN_SEAM     = sdk/packages/agents/src/agent-runtime.ts:1313-1327
                                (finishRun("completed", ...) — terminal fallback)
AGENT_RESULT_COMPLETED_SEAM  = sdk/packages/agents/src/agent-runtime.ts:3334-3336
                                (echoes last text into done.text on session-termination fallback)
```

`submit_and_exit` is declared with `lifecycle: { completesRun: true }`
(production contract frozen per ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-
AUTHORITY-IMPLEMENTATION01). Per upstream Cline documentation, a
successful `completesRun=true` tool stops the agent loop on the first
non-error result. ClineMM does NOT change this contract.

## First visible completion producer

```text
TRANSCRIPT_COMPLETION_ROW_PRODUCER = message-translator.ts:1767-1782
                                      (say: "completion_result", partial: false,
                                       isAuthoritativelyCompletedResult: true)
WEBVIEW_COMPLETION_ROW_PRODUCER    = ChatRow.tsx:989-1012
                                      (case "completion_result" branch — green box,
                                       reads isAuthoritativelyCompletedResult)
TASK_HEADER_COMPLETED_PRODUCER     = setTurnPhase("completed", ...)
                                      via sdk-session-event-coordinator.ts
                                      SEAM B (~L1148-1170)
SESSION_COMPLETED_PROJECTION       = postMessageController (the row itself
                                      IS the green-box surface)
```

**FIRST_VISIBLE_COMPLETION_PRODUCER = P5**
(persisted transcript `completion_result` row, emitted at the message
translator's `content_end` handler for the completion tool).

The row is emitted UNCONDITIONALLY at `content_end` of
`submit_and_exit`/`attempt_completion`. The BCB/C10 filter in the
session-event-coordinator consults the resulting `result.messages`
AFTER `translateSessionEvent` runs (see line 1049-1124) and ONLY drops
the row if a predicate fires. The question is whether that predicate
is the right one.## What predicate does the C10 filter consult?

Two branches at `sdk-session-event-coordinator.ts:1049-1124`:

### Narrow branch (when `hasActiveNotify` is wired — production path)

```text
ownedAndOutstanding = any(hasActiveNotify(launchedJobId))
```

Only fires for jobs whose notify marker is STILL alive.

### Over-broad fallback (when `hasActiveNotify` is NOT wired)

```text
outstandingAutonomousWork = pendingPromptAuthorityUnknown
                          || pendingPromptsKnown > 0
                          || activeNotifyCount > 0
```

Only fires for jobs whose notify marker is still alive (same
predicate via the aggregate).

## What predicate does SEAM B (the BCB barrier) consult?

```text
holdBarrier =
    outstandingAutonomousWork                       (notify markers + pending prompts)
 || ownerStillRunningForC10                        (CommandJobManager.hasRunningBackgroundJobForOwner)
 || unconsumedOwnedTerminalResultsForC10 > 0       (notify=false OR drained notify observations)
 || suppressOriginatingCompletion                   (BNCA wake-owned path)
```

The BCB barrier holds on FOUR conditions. The C10 message filter only
checks ONE of them. **That's the gap.**

For the dogfood chronology:
- `pendingPromptsKnown === 0` (no prompts in queue yet at submit #1)
- `activeNotifyCount === 0` (notify=false jobs → no notify markers)
- `hasActiveNotify(jid) === false` (notify=false)
- BUT: `hasRunningBackgroundJobForOwner === true` OR
  `unconsumedOwnedTerminalResultsForC10 > 0`

The BCB barrier correctly HOLDS (so `task_completion_committed === 0`
at submit #1). But the C10 message filter does NOT consult those two
extra conditions, so the `completion_result` row goes through and the
user sees the premature ✓ Completed.## Authoritative completion seam

```text
AUTHORITATIVE_COMPLETION_CHECK       = sdk-session-event-coordinator.ts:1313-1318
                                         (holdBarrier)
AUTHORITATIVE_COMPLETION_WRITE       = sdk-session-event-coordinator.ts:1169-1170
                                         (setTurnPhase("completed", ..., writerId))
AUTHORITATIVE_COMPLETION_EVENT       = captureContinuationCardinalityAuthorityRecord
                                         (stage = "task_completion_committed",
                                          sessionId, taskId)
AUTHORITATIVE_COMPLETION_PERSISTENCE = MessageIdMinter / saved transcript via
                                         SdkMessageCoordinator.appendAndEmit
```

This is the authority seam the webview already keys on for TaskHeader
("Working", "Cancel", "Start New Task", etc.) — it is the SAME turn
phase the BCB/C10 barrier at SEAM B commits to. Reusing this seam is
the minimal-diff repair target.

## Three identities (frozen per ACT §6)

```text
RUN_COMPLETION
  = AgentRuntime stopped because a completesRun tool succeeded

TASK_COMPLETION_AUTHORITY
  = ClineMM BCB/C10 has accepted the task as finally complete

COMPLETION_PRESENTATION
  = user sees authoritative task completion in transcript/UI

Invariant (load-bearing):
  COMPLETION_PRESENTATION ⇒ TASK_COMPLETION_AUTHORITY
  (NOT merely COMPLETION_PRESENTATION ⇒ RUN_COMPLETION)
```

## COMPLETION_PRESENTATION_IDENTITY

```text
COMPLETION_PRESENTATION_IDENTITY = (sessionId, taskId, epoch)
```

Keys for the identity triple, not per-message markers. Per-message
markers (`isAuthoritativelyCompletedResult`) survive phase flips but do
not enforce cardinality across turns (the BCTPA01 lesson). Per-session
is the mechanism the BCB barrier uses to bound its
`deferredCompletionBarrier` marker.

## What's NOT a fix

- Not a new "PresentationCompletionCoordinator"
- Not a new state machine
- Not a hash/diff of answer content
- Not a string-match for "Completed" / "done" / "finished"
- Not a BCB scheduling change (the BCB continuation worked correctly)
- Not a `command_status` consumer change (it worked correctly)
- Not a `submit_and_exit` lifecycle change (`completesRun=true` stays)
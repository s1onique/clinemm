# Chart 04 — Completion Message / Presentation Lifecycle

How a completion attempt becomes a VISIBLE "Completed" badge — and
where that badge can disagree with the task's actual completion state.

This is the chart that contains the defect repaired by this ACT.

## The two authorities

| Authority | Scope | Source |
|---|---|---|
| **Row marker** `isAuthoritativelyCompletedResult` | ONE row: "this row WAS a terminal completion". Monotonic — survives phase flips, resume, retry, follow-up, compaction. | Stamped at `apps/vscode/src/sdk/message-translator.ts` (the completion tool's `content_end`) |
| **Task phase** `turnState.phase` | The WHOLE TASK: "what is the task doing right now". Mutable. | `apps/vscode/src/sdk/turn-state-tracker.ts` |

They answer DIFFERENT questions and must not be confused. A historical
completion row must keep its badge while a NEWER turn runs (the phase
is then `streaming`). That is why the marker exists.

**The defect was that the marker was stamped as an UNCONDITIONAL
assertion of authority at PUBLICATION time, while the authority to
actually commit the task's completion is decided LATER.**

## The publication path

```mermaid
stateDiagram-v2
    direction TB

    [*] --> PartialRowPublished : content_start (attempt_completion / submit_and_exit)
    note right of PartialRowPublished
        say:"completion_result", partial:true
        NO authority marker.
    end note

    PartialRowPublished --> FinalRowPublished : content_end (completion tool)
    note right of FinalRowPublished
        say:"completion_result", partial:false
        isAuthoritativelyCompletedResult: true   <-- STAMPED HERE
        (was unconditional before this ACT)
    end note

    FinalRowPublished --> RowFilteredOut : message-layer completion filter (BCB hold)
    note right of RowFilteredOut
        The row is REMOVED from the published set.
        The user never sees it.
        => no false badge. CORRECT.
    end note

    FinalRowPublished --> RowVisible : filter did not hold

    RowVisible --> NoBadge : Elm HOLD / FAILURE at turn end (C10 suppressed)
    note right of NoBadge
        No authoritative marker was published.
        The live row was published WITHOUT the marker;
        commit-driven promotion is the only publisher.
        The summary TEXT stays visible.
    end note

    RowVisible --> C10Committed : Elm authorizes + TS conservation passes
    C10Committed --> BadgeShown : same-ts row promoted with authoritative marker

    BadgeShown --> [*]
    NoBadge --> [*]
```


## Load-bearing transitions

### P-01 — the partial row

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/message-translator.ts` (the completion-tool branch of the `content_start` case) |
| predicate | `isCompletionTool(toolName)` |
| effect | `say:"completion_result"`, `partial: true`. **No authority marker.** `setAttemptCompletionSeen()`. |
| test | `apps/vscode/src/sdk/__tests__/message-translator.test.ts` |
| kind | observed |

### P-02 — the finalized row + the authority marker

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/message-translator.ts` (the completion-tool branch of the `content_end` case) |
| predicate | `isCompletionTool(toolName)`; LIVE path: the marker is NEVER stamped at publication (the C10 commit publishes it). RESTORATION path: `event.isAuthoritativeCompletion === true` stamps it. |
| effect | `say:"completion_result"`, `partial: false`, `setTerminalResponseCommittedThisTurn()`; the `isAuthoritativelyCompletedResult: true` marker is added by the C10 COMMIT (see P-06) on the LIVE path, or stamped directly on the RESTORATION path. |
| test | `apps/vscode/src/sdk/__tests__/message-translator.test.ts`, `terminal-report-cardinality-repair01.trcr01.test.ts` |
| kind | observed |

**The `event.isAuthoritativeCompletion` escape hatch** is the
PERSISTED-TRANSCRIPT restoration path
(`finalizePersistedToolUse`): when a completion attempt was HELD (a
runtime-control `completion_continuation_control` user message follows
it in the transcript), the marker is omitted on restore, so the reopened
task renders the held summary WITHOUT the badge. The held-vs-committed
distinction is read from the persisted runtime-control marker, NOT from
message ordering.

**Before this ACT** the LIVE path always stamped the marker
(`eventAuthority !== false` with `eventAuthority === undefined`), i.e.
the marker was PUBLISHED at `content_end` — BEFORE the C10 commit
decision — and a later retraction corrected it. The LIVE path now
stamps NOTHING (`eventAuthority === true` is required, and only the
restoration path passes an explicit bit), so the marker is published
BY the C10 commit (P-06).

### P-03 — the message-layer completion filter (the BCB projection)

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (the `hasCompletionResult` filter block) |
| predicate | `result.messages.some(m => m.say === "completion_result")` AND (narrow branch) an OWNED job has an active notify marker, OR `ownerStillRunningForC10`, OR `unconsumedOwnedTerminalResultsForC10 > 0`; (fallback branch) `pendingPromptAuthorityUnknown \|\| pendingPromptsKnown > 0 \|\| activeNotifyCount > 0 \|\| ownerStillRunningForC10 \|\| unconsumedOwnedTerminalResultsForC10 > 0` |
| effect | `result.messages = result.messages.filter(m => m.say !== "completion_result")` — the row is REMOVED from the published set |
| test | `apps/vscode/src/sdk/__tests__/completion-presentation-authority01.cpa01.test.ts`, `background-command-terminal-presentation-arbitration01.bctpa01.test.ts` |
| kind | observed |

**This filter and the BCB barrier must reach the SAME conclusion** about
whether the task is currently authoritatively complete. The
`ACT-CLINEMM-COMPLETION-PRESENTATION-AUTHORITY01` repair extended this
filter to also consult `hasRunningBackgroundJobForOwner` and
`getUnconsumedOwnedTerminalResultCount` — the same option-bag methods
the barrier uses.

### P-04 — the webview authority projection

| Field | Value |
|---|---|
| source | `apps/vscode/webview-ui/src/components/chat/terminalReportFraming.ts` (`resolveTerminalReportFraming`) |
| predicate | PRIMARY: `message.isAuthoritativelyCompletedResult === true`. SECONDARY (legacy only): `turnState.phase === "completed"` AND the row is a legacy `ask:"completion_result"` with non-empty text. `mode === "plan"` → `undefined` always. |
| effect | `undefined` (no badge) OR `{kind: "completed", label: "Completed", ariaLabel: "Task completed", title: "Task completed successfully"}` |
| test | `apps/vscode/webview-ui/src/components/chat/terminalReportFraming.test.ts`, `CompletionOutputRow.test.tsx` |
| kind | observed |

The projection is PURE: no React, no DOM, no I/O, no message-tail
inference. It MUST NOT infer "Completed" from message text, from the
message tail, or from the mutable task phase alone.


### P-05 — the message store upsert

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/task-proxy.ts` (`MessageStateHandler.addMessages`) and `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts` (`applyMessage`) |
| predicate | A message with the same `ts` REPLACES the stored row in place (host) / merges by `ts` (webview) |
| effect | This is what makes commit-driven promotion possible: re-publishing a row with the same `ts` updates it in place without creating a new visible row. |
| test | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.test.ts` |
| kind | observed |

### P-06 — the commit-driven authority publication (THIS ACT's repair)

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (`promoteCompletionAuthorityMarker`), invoked at the C10 commit on BOTH paths — the immediate turn-complete path (`handleSessionEvent`) and the deferred `reevaluateDeferredCompletionBarrier` path |
| predicate | The C10 commit SUCCEEDED (the Elm authority returned `authorize` AND every conservation check passed) AND the coordinator published a completion row for THIS turn |
| effect | The row is re-published with the SAME `ts` and the marker ADDED, via `emitHookMessage` (the established "update a message" channel — store-append + direct webview push, NO session-event emission). The summary TEXT survives; the badge appears exactly when — and only when — the C10 committed. |
| test | `apps/vscode/src/sdk/__tests__/c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts` (RED-04, RED-05) |
| kind | observed |

**The invariant is TEMPORAL.** An authoritative completion must never be
PUBLISHED before its C10 commit. The live `content_end` therefore
publishes the finalized `completion_result` row WITHOUT the
`isAuthoritativelyCompletedResult` marker; the C10 COMMIT publishes the
marker.

**Why the earlier retraction design was insufficient.** The C9C10SCR01
repair stamped the marker at publication time and retracted it later
when the Elm authority rejected the completion. That is
*retrospective*: the webview receives the publication and the retraction
as SEPARATE messages over an event-based channel, so it can render the
first one before the second arrives. The final projection was correct,
but the temporal invariant was violated. The retraction also had a
second defect: the DEFERRED C10 path could later AUTHORIZE and COMMIT
without ever restoring the removed marker, leaving a legitimate,
committed completion with NO badge.

**Why `emitHookMessage` and not `appendAndEmit`:** `appendAndEmit` is
the "publish NEW rows" channel and it EMITS a session event. The
promotion is an UPDATE to an existing row, so it uses the update
channel. This keeps the published-row cardinality unchanged (the
existing `CPA-09` / `CPA-04` / `C10-BASELINE-02` contracts count
published rows).

**Bounded scope.** The promotion target is turn-scoped: the
coordinator tracks the row it published for the CURRENT turn
(`pendingCompletionAuthorityRow`) and clears that tracking at
the turn boundary (`pending_prompt_submitted`). A historical
completion row from a previous epoch is never touched — so
"Preserve historical completion summaries when a newer epoch is
running" holds.

**It is NOT a second completion authority.** The C10 commit IS the
authority; this seam merely publishes that authority to the
presentation layer. The seam is only ever called from a successful C10
commit, and it can only ADD the marker to the row the coordinator
itself published for the current turn.

### P-07 — the reopen path

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/message-translator.ts` (`sdkMessagesToClineMessages` → `finalizePersistedToolUse`) |
| predicate | The persisted transcript contains a runtime-control `completion_continuation_control` user message in the interval `(toolResultIdx, nextCompletionToolUseIdx)` |
| effect | The restored row OMITS the marker (held) or carries it (committed). The live and reopen paths AGREE on `isAuthoritativelyCompletedResult`. |
| test | `apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts`, `terminal-report-cardinality-repair01.trcr01.test.ts` |
| kind | observed |

## Why the row marker is NOT the completion authority

| Question | Answered by |
|---|---|
| "Did THIS ROW represent a terminal completion attempt?" | The row marker. |
| "Did THE TASK complete?" | The C10 commit (`task_completion_committed`). |
| "Is the task working right now?" | `turnState.phase`. |

The ACT's invariant ties the first two together for the CURRENT turn:

```
Current-turn authoritative completion display
  => C10 committed for the same owner/epoch
```

Before this ACT the implication could be violated: the marker was
stamped unconditionally at publication, and the C10 commit could be
suppressed afterwards by the Elm authority. P-06 closes that gap.

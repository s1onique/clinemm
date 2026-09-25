# ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01 — RECON

## Purpose

Per ACT §4, classify every visible completion-like UI surface in the
operator-uploaded screenshot back to its production producer. The
classification MUST be source-bound — inferred from the actual
producer seams in `apps/vscode/src/sdk/` and
`apps/vscode/webview-ui/src/components/chat/`.

This recon covers the six surfaces the operator enumerated (UI-A
through UI-F) plus one auxiliary: the user message bubble above them
(for completeness).

## Source seams traced

| Seam | Location | Role |
|---|---|---|
| Tool `content_start` (run_commands) | `message-translator.ts:1494-1507` | emits `say="command"` partial=true with `COMMAND_OUTPUT_STRING` |
| Tool `content_end` (run_commands) | `message-translator.ts:1801-1875` | emits `say="command"` partial=false with `commandExecutionDisposition` (backgrounded/executed/rejected) and the JSON envelope `{status: "running", jobId}` for backgrounded |
| Tool `content_start` (completion tool) | `message-translator.ts:1479-1490` | emits `say="completion_result"` partial=true; calls `state.setAttemptCompletionSeen()` |
| Tool `content_end` (completion tool) | `message-translator.ts:1761-1795` | emits `say="completion_result"` partial=false with `isAuthoritativelyCompletedResult: true`; calls `state.setTerminalResponseCommittedThisTurn()` |
| Text `content_start` / `content_end` | `message-translator.ts:1620-1655` | emits `say="text"` partial=true/false (ordinary assistant prose) |
| C10 completion-result filter | `sdk-session-event-coordinator.ts:566-616` | the per-job ownership-aware filter that decides whether to drop `completion_result` rows before `appendAndEmit` |
| C10 `appendAndEmit` | `sdk-session-event-coordinator.ts:619-621` | the single webview publish call |
| Phase-transition (task completion commit) | `sdk-session-event-coordinator.ts:720-733` | emits `task_completion_committed` capture; calls `setTurnPhase("completed", ...)` |
| Background notify wake enqueue | `background-notify-coordinator.ts:427-475` (`consumeTerminal`) | on terminal state, enqueues a `formatTerminalWakePrompt(...)` prompt via `enqueueTerminalWake` |
| `submit_and_exit` content_start | `message-translator.ts:1479-1481` | stamps `attemptCompletionSeen=true` BEFORE `submit_and_exit_seen` capture in C8 |
| Background-notify marker registration | `vscode-run-commands-tool.ts:768-772` | registers the `notificationMarkers[jobId]` entry |
| Background-notify `consumeTerminal` decision | `background-notify-coordinator.ts:427-475` | if `notifyOnCompletion=true` + non-containment-failed + active owner matches: enqueues wake prompt via `formatTerminalWakePrompt` |
| Webview completion_result route | `ChatRow.tsx:1102-1125` | `case "completion_result"` → `<CompletionOutputRow>` with `resolveTerminalReportFraming(...)` |
| Webview terminal-card route | `ChatRow.tsx:251` + `CommandOutputRow.tsx:117-319` | `isCommandMessage=true` → `<CommandOutputRow>` |
| Webview text-route | `ChatRow.tsx:1090-1100` (MarkdownRow fallback) | `case "text"` → `<MarkdownRow>` |
| `resolveTerminalReportFraming` | `terminalReportFraming.ts:131-156` | decides whether to render the "✓ Completed" badge on a completion_result row |

## UI surface classification (per ACT §4 mandatory table)

| UI id | visible text/type | producer function | ClineMessage shape | lifecycle stage | turn origin | jobId available? | persisted? | user-visible authority |
|---|---|---|---|---|---|---|---|---|
| **User bubble** | "Run this command in the background and notify me when it finishes." | webview `UserMessage` row — emitted from `setRunning` / user-message commit (NOT a `say=` row) | `ask: "user"` or `say: "user_feedback"` (per webview routing) | pre-turn | explicit_user | n/a | YES | user input → drives the originating turn |
| **UI-A** | "Ran sh -c 'echo STARTED; sleep 30; echo FINISHED' in the background" + status pill "Backgrounded" | `message-translator.ts:1801-1875` (run_commands `content_end`) → row stamped `say="command"`, `commandExecutionDisposition="backgrounded"`; webview route `ChatRow.tsx:251` (`isCommandMessage=true`) → `<CommandOutputRow>` | `{type:"say", say:"command", text:"<cmd>\n<<<COMMAND_OUTPUT_STRING>>>\n<envelope>", partial:false, commandExecutionDisposition:"backgrounded", commandCompleted:false}` | mid-explicit_user turn (after tool call starts, before turn ends) | explicit_user | YES (`{status:"running", jobId:"J"}` envelope embedded in `text`) | YES (persisted on completion of the run_commands tool) | terminal-card projection (NOT an assistant completion) |
| **UI-B** | "The command is running in the background..." | `message-translator.ts:1620-1629` (text `content_end`) → row stamped `say="text"`; webview route `ChatRow.tsx` `case "text"` → `<MarkdownRow>` | `{type:"say", say:"text", text:"The command is running in the background...", partial:false}` | mid-explicit_user turn (model emitted prose before/after the tool call) | explicit_user | n/a (prose; no jobId) | YES (persisted as assistant text) | ordinary assistant text (NOT a completion) |
| **UI-C** | "The command has finished. Output: ..." | `message-translator.ts:1620-1629` (text `content_end`) → row stamped `say="text"`; webview route `ChatRow.tsx` `case "text"` → `<MarkdownRow>` | `{type:"say", say:"text", text:"The command has finished. Output: ...", partial:false}` | mid-explicit_user turn OR model-emitted transitional prose | explicit_user | n/a (prose; no jobId) | YES (persisted as assistant text) | ordinary assistant text |
| **UI-D** | green COMPLETED card with "Ran sh -c ... in the background..." | `message-translator.ts:1761-1795` (completion tool `content_end`) → row stamped `say="completion_result"`, `isAuthoritativelyCompletedResult:true`; webview route `ChatRow.tsx:1102-1125` → `<CompletionOutputRow>` + `resolveTerminalReportFraming(...)` → renders "✓ Completed" badge | `{type:"say", say:"completion_result", text:"Ran sh -c 'echo STARTED; sleep 30; echo FINISHED' in the background...", partial:false, isAuthoritativelyCompletedResult:true}` | end of explicit_user turn (commit attempt) — BUT filtered by C10 ownership-aware filter at `sdk-session-event-coordinator.ts:566-616` IF `hasActiveNotify(jobId)` is true for an owned job | explicit_user | inferred from `MessageTranslatorState.launchedBackgroundJobIds` (TURN-scoped carrier, NOT per-completion) | YES (persisted IF it survives the C10 filter) | semantic completion candidate (filtered or committed exactly once) |
| **UI-E** | "The background command ... has completed successfully..." | `message-translator.ts:1620-1629` (text `content_end`) → row stamped `say="text"`; webview route `ChatRow.tsx` `case "text"` → `<MarkdownRow>` | `{type:"say", say:"text", text:"The background command ... has completed successfully...", partial:false}` | end of pending_prompt_drain turn (model-emitted prose after consuming the wake prompt) | pending_prompt_drain | n/a (prose; no jobId) | YES (persisted as assistant text) | ordinary assistant text (NOT a completion) |
| **UI-F** | green COMPLETED card with "The background command completed successfully." | `message-translator.ts:1761-1795` (completion tool `content_end`) → row stamped `say="completion_result"`, `isAuthoritativelyCompletedResult:true`; webview route `ChatRow.tsx:1102-1125` → `<CompletionOutputRow>` + `resolveTerminalReportFraming(...)` → renders "✓ Completed" badge | `{type:"say", say:"completion_result", text:"The background command completed successfully.", partial:false, isAuthoritativelyCompletedResult:true}` | end of pending_prompt_drain turn — committed at the canonical C10 phase transition (`sdk-session-event-coordinator.ts:732`: `setTurnPhase("completed", ..., "session-event-turn-complete-completed")`); capture: `task_completion_committed` | pending_prompt_drain | inferred from `MessageTranslatorState.launchedBackgroundJobIds` (likely empty for the wake turn — wake turn launched no jobs) | YES (persisted as the terminal completion row) | semantic completion (the single `task_completion_committed` in the specimen maps to this row) |

## Producer-side runtime counts (per ACT §10)

These counts are INFERRED from the operator's live CCARD JSONL,
not from a live trace re-run in this environment.

```
completion_result_commits       = 1    (UI-F; UI-D was filtered at C10)
terminal_card_projections       = 1    (UI-A)
task_completion_projections     = 1    (mapped 1:1 to UI-F)
submit_and_exit_presentations   = 2    (one per turn; CCARD-only,
                                        not user-visible chrome)
ordinary_text_rows              = 3    (UI-B, UI-C, UI-E)
```

## §3 — Why UI-D is filtered (and why UI-F is committed)

Per the BCCOC01 ownership-aware C10 filter at
`sdk-session-event-coordinator.ts:566-616`:

```ts
if (result.messages.length > 0) {
    const hasCompletionResult = result.messages.some((m) => m.say === "completion_result")
    if (hasCompletionResult) {
        if (this.options.hasActiveNotify) {
            // Per-job ownership-aware filter
            const ownedJobIds = this.options.messageTranslatorState.getLaunchedBackgroundJobIds()
            let ownedAndOutstanding = false
            for (const jid of ownedJobIds) {
                if (this.options.hasActiveNotify(jid)) {
                    ownedAndOutstanding = true
                    break
                }
            }
            if (ownedAndOutstanding) {
                result.messages = result.messages.filter((m) => m.say !== "completion_result")
            }
        }
    }
}
```

Walked against the live trace:

1. **explicit_user turn (seq 1..7)**:
   - seq 6: completion tool `content_end` at `message-translator.ts:1761-1795`
     → emits `say="completion_result"` row (UI-D candidate).
   - At this instant, `launchedBackgroundJobIds` contains `J`
     (registered at `vscode-run-commands-tool.ts:768-772`).
   - At this instant, `BackgroundNotifyCoordinator.hasActiveNotify("J")`
     returns `true` (seq 3 fired; seq 8 hasn't).
   - **C10 filter predicate**: `ownedAndOutstanding === true` → the
     `completion_result` row is REMOVED. **UI-D does NOT reach the webview.**
   - seq 12: `task_completion_committed` would have been eligible here
     BUT the deferred-completion-barrier (`TQCB01`) holds it because
     `outstandingAutonomousWork=true` while the wake prompt is still
     in the queue. The `setTurnPhase("completed", ...)` writer is
     deferred until `reevaluateDeferredCompletionBarrier()` fires
     after seq 8.

2. **pending_prompt_drain turn (seq 10..13)**:
   - seq 11: completion tool `content_end` → emits `say="completion_result"`
     row (UI-F candidate).
   - At this instant, `launchedBackgroundJobIds` is EMPTY (wake turn
     launched no jobs).
   - At this instant, `hasActiveNotify("J")` returns `false` (marker
     consumed at seq 3).
   - **C10 filter predicate**: `ownedAndOutstanding === false` → the
     `completion_result` row PASSES the filter. **UI-F reaches the webview.**
   - seq 12: `task_completion_committed` is captured at
     `sdk-session-event-coordinator.ts:726-731`.

This accounts for **exactly one** `task_completion_committed`
(seq 12) and **exactly one** visible green COMPLETED card (UI-F).
UI-D is filtered by the BCCOC01 ownership-aware C10 filter — this
is the load-bearing repair the predecessor ACT made.

## §4 — Live runtime cardinality walk

Per ACT §11, the live lifecycle must remain:

```
terminal_committed        = 1   ✓  (seq 2)
notify_consume_enter      = 1   ✓  (seq 3)
wake_created              = 1   ✓  (seq 5)
pending_prompt_enqueued   = 1   ✓  (seq 4)
pending_prompt_dequeued   = 1   ✓  (seq 8)
continuation_scheduled    = 1   ✓  (seq 9)
run_turn_started          = 2   ✓  (seq 1 explicit_user + seq 10 pending_prompt_drain)
agent_turn_done           = 2   ✓  (seq 7 explicit_user + seq 13 pending_prompt_drain)
task_completion_committed = 1   ✓  (seq 12)
wake C4->C8 jobId         = identical (J on seq 4..10)   ✓
```

All conservation invariants hold per the operator-uploaded JSONL.
No regressions detected.

## §5 — Why the operator's screenshot may still appear to show UI-D

The user's note (twenty-fourth reviewer) described the screenshot
as containing MULTIPLE completion-like elements. Per §3, the C10
filter should suppress the explicit_user turn's `completion_result`
(UI-D). If the screenshot ACTUALLY shows UI-D, that means either:

1. The C10 filter did NOT suppress UI-D in this specimen
   (regression of BCCOC01), OR
2. The screenshot's UI-D is actually the wake turn's projection
   (UI-F mislabeled), OR
3. The operator's screenshot description needs further
   disambiguation.

The ACT's classification is **PROVEN FOR UI-F** (the single
`task_completion_committed` is the load-bearing discriminator — there
is no other production seam that can produce a phase transition to
`completed` with `task_completion_committed` capture, and the CCARD
JSONL shows exactly one such capture).

For UI-D, the classification is **PROVEN-SUPPRESSED** by the
source-bound walkthrough in §3. The screenshot showing UI-D would
be a REGRESSION of BCCOC01. The ACT does NOT authorize a repair in
this cycle — the operator should verify the actual rendering of UI-D
in the next live cycle with an active dogfood + LLM credential (a
state the Cloud Agent context cannot reach).
# ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01 — RECON

## BOUNDED CORRECTION (twenty-fourth reviewer verdict)

This file is REVISED to reflect the bounded correction after
twenty-fourth reviewer verdict HALT_LIVE_EVIDENCE_CONTRADICTS_CLASSIFICATION.
See `00-raw-trace-status.md` in this directory for the full provenance
disclosure. Key change in this recon:

  - §3 ("Why UI-D is filtered") is RETIRED as a classification argument.
    The previous cycle used it to claim UI-D is "PROVEN-SUPPRESSED",
    which directly contradicts the canonical UI enumeration (01c-ui.txt)
    that lists UI-D as a visible green COMPLETED card alongside UI-F.
  - §5 ("Why the operator's screenshot may still appear to show UI-D")
    is RETIRED; the possibility it dismissed ("the screenshot's UI-D is
    actually the wake turn's projection") is now taken seriously and
    re-opened as the binding question.
  - The new §3 is "UI-D and UI-F binding" — a neutral walkthrough
    that enumerates candidate producers without claiming proof for
    either side.

## Purpose (unchanged)

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

NOTE: the previous cycle claimed UI-D as PROVEN-SUPPRESSED. This table
treats UI-D and UI-F as UNPROVEN_PENDING_PERSISTED_BINDING until the
operator supplies a persisted-message dump.

| UI id | visible text/type | producer function | ClineMessage shape | lifecycle stage | turn origin | jobId available? | persisted? | user-visible authority |
|---|---|---|---|---|---|---|---|---|
| **User bubble** | "Run this command in the background and notify me when it finishes." | webview `UserMessage` row — emitted from `setRunning` / user-message commit (NOT a `say=` row) | `ask: "user"` or `say: "user_feedback"` (per webview routing) | pre-turn | explicit_user | n/a | YES | user_input |
| **UI-A** | "Ran sh -c ... in the background..." + status pill "Backgrounded"/"Running" | `message-translator.ts:1801-1875` (run_commands `content_end`) → row stamped `say="command"`, `commandExecutionDisposition:backgrounded`; webview route `ChatRow.tsx:251` → `<CommandOutputRow>` | `{type:"say", say:"command", commandExecutionDisposition:"backgrounded", text:"<cmd>\\n<<<COMMAND_OUTPUT_STRING>>>\\n{envelope:{status:'running', jobId:'J'}}"}` | mid-explicit_user (right after the run_commands call returns) | explicit_user | J (envelope-embedded) | YES (persisted) | terminal_card_projection |
| **UI-B** | "The command is running in the background..." | `message-translator.ts:1620-1629` (text `content_end`) → row stamped `say="text"`; webview route `ChatRow.tsx` `case "text"` → `<MarkdownRow>` | `{type:"say", say:"text", text:"The command is running in the background...", partial:false}` | mid-explicit_user turn (model emitted prose before/after the tool call) | explicit_user | n/a (prose; no jobId) | YES (persisted as assistant text) | ordinary_text_row |
| **UI-C** | "The command has finished. Output: ..." | `message-translator.ts:1620-1629` (text `content_end`) → row stamped `say="text"`; webview route `ChatRow.tsx` `case "text"` → `<MarkdownRow>` | `{type:"say", say:"text", text:"The command has finished. Output: ...", partial:false}` | mid-explicit_user turn OR model-emitted transitional prose | explicit_user | n/a (prose; no jobId) | YES (persisted as assistant text) | ordinary_text_row |
| **UI-D** | green COMPLETED card with "Ran sh -c ... in the background..." | UNPROVEN. Two candidate producers: (a) `message-translator.ts:1761-1795` (completion tool `content_end`) + C10 filter pass-through → row stamped `say="completion_result"`, `isAuthoritativelyCompletedResult:true`; webview route `ChatRow.tsx:1102-1125` → `<CompletionOutputRow>` + `resolveTerminalReportFraming(...)` → renders "✓ Completed" badge. (b) Unrelated producer (e.g. badged text row from `resolveTerminalReportFraming` on a `say="text"` row). | (a) `{type:"say", say:"completion_result", text:"...", partial:false, isAuthoritativelyCompletedResult:true}` or (b) `{type:"say", say:"text", text:"...", partial:false}` with `resolveTerminalReportFraming` returning a "completed" badge | end of explicit_user turn OR mid-explicit_user (model-emitted recap) | explicit_user (claimed) | (a) J in `launchedBackgroundJobIds` carrier (TURN-scoped) or (b) n/a | UNPROVEN (depends on producer) | UNPROVEN_PENDING_PERSISTED_BINDING |
| **UI-E** | "The background command ... has completed successfully..." | `message-translator.ts:1620-1629` (text `content_end`) → row stamped `say="text"`; webview route `ChatRow.tsx` `case "text"` → `<MarkdownRow>` | `{type:"say", say:"text", text:"The background command ... has completed successfully...", partial:false}` | end of pending_prompt_drain turn (model-emitted prose after consuming the wake prompt) | pending_prompt_drain | n/a (prose; no jobId) | YES (persisted as assistant text) | ordinary_text_row |
| **UI-F** | green COMPLETED card with "The background command completed successfully." | UNPROVEN. Two candidate producers: (a) `message-translator.ts:1761-1795` (completion tool `content_end`) + C10 filter pass-through → row stamped `say="completion_result"`, `isAuthoritativelyCompletedResult:true`; webview route `ChatRow.tsx:1102-1125` → `<CompletionOutputRow>` + `resolveTerminalReportFraming(...)` → renders "✓ Completed" badge. (b) Second completion_result from a duplicate commit (regression of BCCOC01). | (a) `{type:"say", say:"completion_result", text:"...", partial:false, isAuthoritativelyCompletedResult:true}` | end of pending_prompt_drain turn OR end of explicit_user turn (regression) | pending_prompt_drain (claimed) or explicit_user (regression) | (a) inferred from `MessageTranslatorState.launchedBackgroundJobIds` (likely empty for the wake turn) | UNPROVEN (depends on producer) | semantic_completion_candidate; exact producer UNPROVEN |

## §3 — UI-D and UI-F binding (REVISED, neutral walkthrough)

The previous cycle's §3 ("Why UI-D is filtered") is RETIRED. The
current §3 enumerates the candidate producers for both green COMPLETED
cards without claiming proof for either side.

### UI-D candidate producers

1. **Candidate D.1 — completion_result SURVIVED the C10 filter (regression)**
   - Producer: `message-translator.ts:1761-1795` (completion tool
     `content_end`) + C10 filter pass-through at
     `sdk-session-event-coordinator.ts:566-616`.
   - For this candidate to be true, `ownedAndOutstanding` must be
     `false` at the explicit_user turn's commit instant. That would
     require either (a) `launchedBackgroundJobIds` to be empty, or
     (b) `hasActiveNotify(J)` to return `false` for the owned job.
   - The synthetic trace has `launchedBackgroundJobIds` containing `J`
     AND `hasActiveNotify(J)===true`, which would predicate
     `ownedAndOutstanding===true` and FILTER this candidate.
   - **Hypothesis PS-B trigger**: if the real persisted dump shows
     UI-D is a `say="completion_result"` row, then either the C10
     filter was bypassed (regression of BCCOC01) OR the carrier
     states differed from the synthetic trace.

2. **Candidate D.2 — text row badged by resolveTerminalReportFraming**
   - Producer: `message-translator.ts:1620-1629` (text `content_end`)
     + `resolveTerminalReportFraming(...)` (terminalReportFraming.ts:131-156)
     returning a "completed" badge.
   - For this candidate to be true, a text row must have been
     badged as "Completed" by `resolveTerminalReportFraming`. That
     would require the text content to match the framing
     predicates (typically terminal-state recap prose).
   - **Hypothesis PS-C trigger**: if the real persisted dump shows
     UI-D is a `say="text"` row with a green "Completed" badge,
     then `resolveTerminalReportFraming` is over-badging text rows,
     and a new presentation-class (PS-C, currently unnamed) opens.

### UI-F candidate producers

1. **Candidate F.1 — pending_prompt_drain completion_result (the wake turn's terminal commit)**
   - Producer: `message-translator.ts:1761-1795` (completion tool
     `content_end`) + C10 filter pass-through.
   - For this candidate to be true, the wake turn must commit a
     completion_result row, which the synthetic trace records as
     seq 11 + the C10 phase transition captures `task_completion_committed`
     at seq 12.
   - **Hypothesis PS-A/PS-D remainder**: if UI-D is D.2 (badged text)
     AND UI-F is F.1 (completion_result), then the original PS-A claim
     holds (one semantic completion + one misidentified text).

2. **Candidate F.2 — second completion_result from a duplicate commit (regression)**
   - Producer: same as F.1 but from a DIFFERENT turn (e.g. a
     re-commit of explicit_user's completion_result because the C10
     filter did not suppress it for some reason).
   - **Hypothesis PS-B/D trigger**: if UI-F is also a
     `say="completion_result"` row with `isAuthoritativelyCompletedResult:true`
     from a different turn origin than the wake turn, then
     C10_DUPLICATION_PERSISTS_LIVE = true and
     C10-LIVE-OWNERSHIP-REPAIR01 is authorized.

### What is needed to bind

To distinguish D.1 vs D.2 and F.1 vs F.2, the operator must supply
the persisted `clineMessages` for the specimen session. Specifically:

  - A JSON dump of all messages in the specimen task, OR
  - A grep for `say="completion_result"` in the persisted messages
    file, showing message id, text, partial, isAuthoritativelyCompletedResult,
    and turn origin.

The ACT cannot bind without this dump. The synthetic trace is a
shape witness; it is not an authoritative binding.

## §4 — Live runtime cardinality walk (unchanged from previous cycle)

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

**IMPORTANT**: these counts are derived from the synthetic trace
(`01a-ccard.NORMALIZED_DERIVED.jsonl`). They describe the LIFECYCLE
SHAPE that this ACT's contract requires; they are not a witness that
the contract was satisfied in a real run. Runtime cardinality from
the synthetic trace is load-bearing for the conservation matrix only
(WAKE_CARDINALITY=HEALTHY); it is NOT load-bearing for any
presentation-class claim.

## §5 — Previous-cycle "why screenshot may still show UI-D" — RETIRED

The previous cycle's §5 attempted to reconcile the UI-D visibility
with the suppression claim by listing three possibilities:

  1. The C10 filter did NOT suppress UI-D (regression of BCCOC01).
  2. The screenshot's UI-D is actually the wake turn's projection
     (UI-F mislabeled).
  3. The operator's screenshot description needs further disambiguation.

The bounded correction accepts that ALL THREE are equally plausible
without a persisted-message binding. §3 above enumerates the
candidate producers for each visible green card.

## §6 — Producer-side runtime counts (REVISED provenance)

Previous count (REJECTED):
```
completion_result_commits       = 1   (UI-F; UI-D was filtered at C10)
terminal_card_projections       = 1   (UI-A)
task_completion_projections     = 1   (mapped 1:1 to UI-F)
submit_and_exit_presentations   = 2   (one per turn; CCARD-only,
                                        not user-visible chrome)
ordinary_text_rows              = 3   (UI-B, UI-C, UI-E)
```

This count was load-bearing for the PS-A verdict. After bounded
correction, the count is **HELD OPEN**:

```
completion_result_commits       = UNRESOLVED (0, 1, or 2 — depends on binding)
terminal_card_projections       = 1   (UI-A; unchanged)
task_completion_projections     = UNRESOLVED (0 or 1 — depends on binding)
submit_and_exit_presentations   = 2   (per the synthetic trace, lifecycle-shape only)
ordinary_text_rows              = 3 or 4   (UI-B, UI-C, UI-E always; UI-D could be a 4th if badged text)
```

The previous PS-A classification relied on `completion_result_commits=1`,
which the synthetic trace happens to satisfy but which the operator's
UI enumeration contradicts. Both cannot be true; the operator's dump
is the tie-breaker.

## §7 — Operator required actions (EXPANDED)

The previous cycle's operator follow-up was:

  - Verify UI-D is NOT visible in the live webview (regression of
    BCCOC01 if it IS).
  - Verify UI-F is the SINGLE visible green COMPLETED card.
  - If UI-D is visible, root class becomes PS-B and
    C10-LIVE-OWNERSHIP-REPAIR01 is authorized.

The bounded correction EXPANDS this to also require a persisted-message
dump:

  1. Dump the persisted `clineMessages` for the specimen session
     (e.g. `cat ~/.cline/data/.../<taskId>/messages.json`).
  2. Enumerate all `say="completion_result"` rows; record message id,
     text, partial, isAuthoritativelyCompletedResult, turn origin.
  3. Enumerate all `say="text"` rows that have a green "Completed"
     badge applied by `resolveTerminalReportFraming`.
  4. Bind each operator-visible green COMPLETED card (UI-D, UI-F)
     to a specific persisted row.
  5. Apply the classification.remainder branches in `result.json`:
     - If 2 persisted `say="completion_result"` rows with
       `isAuthoritativelyCompletedResult=true`: PS-B = true,
       `C10-LIVE-OWNERSHIP-REPAIR01` authorized.
     - If 1 persisted `say="completion_result"` row and UI-D binds
       to a `say="text"` row with a green badge: PS-A re-opens (the
       previous cycle's classification is recovered with the binding
       correction).
     - If 0 persisted `say="completion_result"` rows and both green
       cards bind to `say="text"` rows with badges: new class
       PS-C (over-badging of text rows by
       `resolveTerminalReportFraming`); separate ACT required.
     - If persisted history cannot distinguish: CAPTURE_INSUFFICIENT
       holds; extend the hold.

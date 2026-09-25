# ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01 — RECON

## BOUNDED CORRECTION HISTORY

### Round 1 (twenty-fourth reviewer verdict HALT_LIVE_EVIDENCE_CONTRADICTS_CLASSIFICATION)

This file is REVISED to reflect the bounded correction after
twenty-fourth reviewer verdict. Key change in round 1:

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

### Round 2 (twenty-fifth reviewer verdict HALT_RAW_LIVE_TRACE_NOT_INGESTED)

This file is FURTHER REVISED to reflect the round-2 ingestion of the
raw operator-uploaded live CCARD trace (`01a-ccard.LIVE_RAW.jsonl`,
SHA-256 d7302ae909596a21d48ff491661e5f2652e831b62928fc50db2fb4837dbd24f1).
Key changes in round 2:

  - §4 runtime cardinality: ALL counts are now LIVE (computed from
    01a-ccard.LIVE_RAW.jsonl), not STRUCTURAL (synthetic-trace derived).
  - §3 UI-D candidates: D.1 (completion_result SURVIVED C10) is
    ELIMINATED by the LIVE trace's submit_and_exit_seen pattern
    (BOTH origins=pending_prompt_drain; explicit_user did NOT call
    the completion tool).
  - New candidates D.3 and D.4 added (see §3 below).
  - §6 producer-side runtime counts: PS-B remainder is ELIMINATED
    by the LIVE trace.
  - §7 operator required actions: REVISED with the actual
    taskId=1790335441241_5g7oe for the persisted-message dump.

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

## §3 — UI-D and UI-F binding (REVISED twice; round-2 LIVE narrowing)

Round 1 retired the previous cycle's §3 ("Why UI-D is filtered") and
enumerated candidate producers without claiming proof. Round 2
ingested the LIVE trace, which **eliminates** UI-D's candidate D.1
and **eliminates** UI-F's candidate F.2.

### UI-D candidate producers (round-2 narrowed)

1. **Candidate D.1 — completion_result SURVIVED the C10 filter (regression)**
   - **ELIMINATED_BY_LIVE_TRACE** in round 2.
   - Round 1 reasoning (now retracted): for this candidate to be true,
     `ownedAndOutstanding` must be `false` at the explicit_user turn's
     commit instant. The synthetic trace had `launchedBackgroundJobIds`
     containing `J` AND `hasActiveNotify(J)===true`, which would
     predicate `ownedAndOutstanding===true` and FILTER this candidate.
   - Round 2 LIVE evidence: `01a-ccard.LIVE_RAW.jsonl` shows
     `submit_and_exit_seen=2` with BOTH origins=pending_prompt_drain.
     This proves the explicit_user turn did NOT call the completion
     tool and therefore did NOT emit a `say="completion_result"` row.
     A row that does not exist cannot SURVIVE any filter.
   - **ELIMINATED**. PS-B remainder (which required two
     completion_result rows) is also ELIMINATED.

2. **Candidate D.2 — text row badged by resolveTerminalReportFraming**
   - **REMAINING** (prior candidate after D.1 elimination).
   - Producer: `message-translator.ts:1620-1629` (text `content_end`)
     + `resolveTerminalReportFraming(...)` (terminalReportFraming.ts:131-156)
     returning a "completed" badge.
   - For this candidate to be true, a text row must have been
     badged as "Completed" by `resolveTerminalReportFraming`. The
     text content must match the framing predicates.
   - **Hypothesis PS-C trigger**: if the real persisted dump shows
     UI-D is a `say="text"` row with a green "Completed" badge,
     then `resolveTerminalReportFraming` is over-badging text rows,
     and a new presentation-class (PS-C, currently unnamed) opens.

3. **Candidate D.3 — phantom duplicate of wake turn's completion_result** (NEW in round 2)
   - For this candidate to be true, the wake turn's completion_result
     row (seq 11) must be the only completion_result in the session
     (per the LIVE trace), but UI-D renders this single row TWICE
     (once as the wake turn's terminal projection, once as a duplicate
     from some other webview consumer or state-propagation path).
   - **Hypothesis PS-D trigger**: if the real persisted dump shows
     only ONE `say="completion_result"` row AND UI-D still renders as
     a green COMPLETED card, then a webview-side state-propagation
     defect has caused the same row to render twice.
   - This is a NEW presentation class (PS-D, currently unnamed) that
     the previous cycle could not have identified because the LIVE
     trace was not yet ingested.

4. **Candidate D.4 — terminal_card (UI-A) re-rendered with badge after wake** (NEW in round 2)
   - For this candidate to be true, the original UI-A terminal_card
     (UI-A in the operator's UI enumeration) must get re-rendered
     with a "Completed" badge by the webview after the wake turn
     commits `task_completion_committed` at seq 12.
   - **Hypothesis PS-E trigger**: if the real persisted dump shows
     UI-D is a `say="command"` row (the same shape as UI-A) but with
     updated partial=false and a green "Completed" badge, then the
     renderer is over-badging terminal_card on wake.
   - This is a NEW presentation class (PS-E, currently unnamed).

### UI-F candidate producers (round-2 narrowed)

1. **Candidate F.1 — pending_prompt_drain completion_result (the wake turn's terminal commit)**
   - **REMAINING** (sole plausible candidate after F.2 elimination).
   - Producer: `message-translator.ts:1761-1795` (completion tool
     `content_end`) + C10 filter pass-through.
   - LIVE evidence: `01a-ccard.LIVE_RAW.jsonl` seq 11
     (`submit_and_exit_seen` with origin=pending_prompt_drain) + seq 12
     (`task_completion_committed` with origin=pending_prompt_drain).
   - **Hypothesis PS-A/PS-D remainder**: if UI-D is D.2 (badged text)
     AND UI-F is F.1 (completion_result), then the original PS-A claim
     holds (one semantic completion + one misidentified text).
     If UI-D is D.3 (phantom duplicate of F.1), then PS-D opens.

2. **Candidate F.2 — second completion_result from a duplicate commit (regression)**
   - **ELIMINATED_BY_LIVE_TRACE** in round 2.
   - Round 1 reasoning (now retracted): F.2 required two
     `say="completion_result"` rows in the session, one of which
     came from a non-wake turn. The LIVE trace has exactly one
     `submit_and_exit_seen` with origin=pending_prompt_drain (seq 11)
     — there is only ONE completion_result in the session.
   - **ELIMINATED**.

### What is needed to bind

To distinguish D.2 vs D.3 vs D.4, the operator must supply the
persisted `clineMessages` for the specimen session
`taskId=1790335441241_5g7oe`. Specifically:

  - A JSON dump of all messages in the specimen task, e.g.
    `cat ~/.cline/data/tasks/1790335441241_5g7oe/messages.json`.
  - A grep for `say="completion_result"` in the persisted messages
    file (LIVE trace predicts exactly 1 row, at seq 11).
  - A grep for `say="text"` rows that have a green "Completed"
    badge applied by `resolveTerminalReportFraming`.

The ACT cannot bind without this dump. The LIVE trace constrains
the candidate set but does not eliminate the binding requirement.

## §4 — Live runtime cardinality walk (UPGRADED to LIVE in round 2)

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
wake C4->C8 jobId         = identical (cmd_mugvhy92x7rm527e on seq 4, 5, 8, 9, 10)   ✓
submit_and_exit_seen      = 2   (BOTH origin=pending_prompt_drain; explicit_user
                                did NOT call the completion tool)
```

These counts are now **LIVE**: derived from the operator-uploaded raw
JSONL (`01a-ccard.LIVE_RAW.jsonl`, SHA-256 d7302ae909596a21d48ff491661e5f2652e831b62928fc50db2fb4837dbd24f1).
They are NOT load-bearing for any presentation-class claim;
they are load-bearing for the conservation matrix (WAKE_CARDINALITY=LIVE,
EXECUTION_CARDINALITY=LIVE, RUNTIME_CONSERVATION_REGRESSION=NONE).

**Key insight from LIVE trace**: `submit_and_exit_seen=2` with BOTH
origins=pending_prompt_drain proves that the explicit_user turn did
NOT call the completion tool. This ELIMINATES UI-D's candidate D.1
(see §3 below) and ELIMINATES the PS-B remainder (which required
two completion_result rows).

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

## §7 — Operator required actions (ROUND-2 REVISED with taskId)

The previous cycle's operator follow-up was:

  - Verify UI-D is NOT visible in the live webview (regression of
    BCCOC01 if it IS).
  - Verify UI-F is the SINGLE visible green COMPLETED card.
  - If UI-D is visible, root class becomes PS-B and
    C10-LIVE-OWNERSHIP-REPAIR01 is authorized.

Round 1 expanded this to require a persisted-message dump.
Round 2 adds the actual session identity from the LIVE trace and
ELIMINATES the PS-B possibility.

The bounded correction EXPANDS this to also require a persisted-message
dump:

  1. Dump the persisted `clineMessages` for the specimen session
     `taskId=1790335441241_5g7oe`. Suggested:
     `cat ~/.cline/data/tasks/1790335441241_5g7oe/messages.json`.
  2. Enumerate all `say="completion_result"` rows; record message id,
     text, partial, isAuthoritativelyCompletedResult, turn origin.
     The LIVE trace predicts exactly 1 such row (at seq 11, from
     pending_prompt_drain).
  3. Enumerate all `say="text"` rows that have a green "Completed"
     badge applied by `resolveTerminalReportFraming`.
  4. Bind each operator-visible green COMPLETED card (UI-D, UI-F)
     to a specific persisted row.
  5. Apply the classification.remainder branches in `result.json`:
     - If UI-D binds to a `say="text"` row with a green badge (D.2)
       AND UI-F is the single `say="completion_result"` row (F.1):
       PS-A re-opens (the original cycle's classification is recovered
       with the binding correction).
     - If UI-D is a phantom duplicate of the wake turn's completion_result
       (D.3; one `completion_result` row in the dump, two green cards):
       PS-D remainder (webview-side state propagation defect).
     - If UI-D is a re-rendered `say="command"` row (UI-A shape) with
       a badge (D.4): PS-E remainder (renderer over-badging terminal_card).
     - PS-B is ELIMINATED (only one completion_result exists in the
       session per the LIVE trace).
     - If persisted history cannot distinguish: CAPTURE_INSUFFICIENT
       holds; extend the hold.

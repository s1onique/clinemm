# Completion-Framing LIVE RED Discriminator 01

> Recon-only. No production change. No test change. No board change.
> Companion to the static-thinking `CLOSED_NOT_REPRODUCED` ACT (commit
> `df8d71d4b`). This file documents what we **know** (LIVE), what we
> **infer** (source-grounded prediction), and what the next move is.

## 0. Scope

The user's question: "Is the missing `Completed` badge actually a
framing bug?" Answer: **no, it is not a framing bug. It is a
completion-protocol/liveness symptom.** The framing ACT is correctly
CLOSED; the defect (if any) lives upstream of framing.

## 1. LIVE facts (from the screenshot)

- A final-looking assistant report is visible in the chat surface.
- The `✓ Completed` badge is absent on that final-looking row.
- (No other LIVE facts captured — no live harness capture available
  in this session.)

## 2. Source-grounded predictions (INFERRED_FROM_PRODUCTION_SOURCE)

The following are NOT captured live. They are predictions grounded
in source-code analysis, derived from three ACTs that are all CLOSED:

- `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01` CLOSED at `d993b9802`
  + CORRECTION01 (`68d916cab`, Wed 2026-08-20).
- `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01` closed
  with `077def275` (Wed 2026-08-20).
- `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01-CORRECTION01` closed
  with `0a3f70ae2` + `d521b2df1` (Wed 2026-08-20). This REMOVED
  `takeTurnFinalText()` and the three-tier fallback ladder entirely.

### 2.1 Predicted message shape for the visible final-looking row

| Field                                  | Predicted value         | Why |
|----------------------------------------|-------------------------|-----|
| `message.type`                         | `"say"`                 | The agent's final text was emitted as ordinary assistant text, not via the `attempt_completion` tool. |
| `message.say`                          | `"text"`                | The completion tool path emits `say: "completion_result"` at `message-translator.ts:1640-1655`. A plain assistant body never goes through that path. |
| `message.partial`                      | `false`                 | `content_end(text)` always closes the row with `partial: false`. |
| `message.isAuthoritativelyCompletedResult` | `undefined`         | The marker is stamped ONLY at `message-translator.ts:1640-1655` (the completion tool's `content_end`). No completion tool → no marker. |
| `turnState.phase`                      | `"awaiting_followup"`   | `sdk-session-event-coordinator.ts:132-135` refuses to promote to `"completed"` when `wasTerminalResponseCommittedThisTurn() === false`. Per `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01` liveness correction, a successful run end without a committed terminal response yields to `awaiting_followup` (truthful user-owned incomplete yield). |
| ChatRow branch                         | `case "text"`           | The `case "completion_result":` block at `ChatRow.tsx:989-1012` is only entered for `say: "completion_result"` rows. A `say: "text"` row never enters it. |
| `CompletionOutputRow` reached          | **No**                  | Unreachable from a `say: "text"` row. |
| `resolveTerminalReportFraming` reached | **No**                  | Only called from the `case "completion_result":` branch at `ChatRow.tsx:1001`. |

### 2.2 Predicted causal chain

```text
agent emits plain assistant text (the visible final report)
  → message-translator.ts content_end(text)
    → ClineMessage say:"text" partial=false  (no marker)
  → no attempt_completion tool observed
    → attemptCompletionSeen = false
  → agent runtime hits session-termination fallback
    (per sdk/packages/agents/src/agent-runtime.ts:1313-1327:
     only reachable when no completesRun tool is registered,
     OR team completionGuard returns undefined,
     OR requireCompletionTool !== true)
  → SDK fires done(reason:"completed")
  → message-translator.ts:1905-1975 done handler
    → emits 0 messages
    → no marker stamp
    → terminalResponseCommittedThisTurn stays false
  → sdk-session-event-coordinator.ts:132
    → setTurnPhase("awaiting_followup", ...) — NOT "completed"
  → webview renders the text row as MarkdownRow (ChatRow.tsx case "text")
  → NO completion_result row exists
  → CompletionOutputRow unreachable → no badge
```

This is the predicted chain. None of it is LIVE-observed.

## 3. Classification against the user's A–H taxonomy

| Class | Applies? | Reason |
|-------|----------|--------|
| A. Terminal event not emitted | No | Runtime emits `done(reason:"completed")`; the failure is upstream of the event. |
| B. Terminal event emitted but not translated | No | `done` translates to a phase change + zero messages; that IS the contract. |
| **C. Translated as plain text** | **Yes (intentional)** | The prior `say:"text"` row stays as `say:"text"` because no completion tool was observed. The fallback ladder that would have retagged was REMOVED by `d521b2df1`. |
| **D. Marker not stamped** | **Yes (intentional)** | The marker is stamped ONLY at the completion tool `content_end`. No completion tool → no marker. |
| E. Marker present, wrong render branch | No | Marker absent, so unreachable. |
| F. Helper bad | No | `resolveTerminalReportFraming` is correct; not reached. |
| G. UI bad | No | UI is correct; not reached. |
| H. Capture insufficient | **Yes** | The live message shape (`type`, `say`, `marker`, `phase`) has NOT been captured. Predictions are source-grounded, not observed. |

## 4. Why C + D are intentional, not defects

The comment block at `message-translator.ts:1919-1973` is explicit:

> "The only authority source is the completion tool `content_end`; the
> `done` handler does NOT synthesize a terminal row."

And (`message-translator.ts:1936-1938`):

> "Promoting that text to `completion_result` would relabel
> session-termination-without-completion as canonical completion —
> the same epistemic shape as the original bug, just visually
> relabeled."

The webview-side decision matrix at `terminalReportFraming.ts:28-34`
is equally explicit:

> "What MUST NOT happen: infer 'Completed' from message text (no
> string match). Infer 'Completed' from message tail (no last-message
> inference). Use the mutable `turnState.phase` as the SOLE authority
> for a historical completion row."

The factory reviewer's verdict (`HALT_NONTOOL_TERMINAL_AUTHORITY_NOT_PROVEN`,
referenced at `message-translator.ts:1940`) applies. The widening
that the screenshot motivates would re-introduce the exact bug class
the prior ACTs closed.

## 5. What the previous ACTs proved

### 5.1 SAFETY (proven)

The runtime cannot promote a successful run end to `phase: "completed"`
without a committed terminal response. Tested at
`sdk-session-event-coordinator.test.ts:443-490` (CRA02-coord chain).

### 5.2 LIVENESS (PARTIAL — proven for the previously-known cases)

`COMPLETION-PROTOCOL-LIVENESS01` + CORRECTION01 closed two specific
liveness bugs:

- **CPL01**: `done-without-completion` → was `phase = "streaming"`
  forever (stuck "Working" header). Fixed by `d993b9802` (yield to
  `awaiting_followup`).
- **CPL04**: `done-with-partial-completion` (completion tool
  `content_start` without `content_end`) → same stuck-Working. Fixed
  by `68d916cab` (symmetric `awaiting_followup` yield in the CPL04
  else branch).

### 5.3 LIVENESS (NOT proven — the open question)

When the agent emits a polished final-looking body without invoking
the completion tool at all, the runtime yields to `awaiting_followup`.
The user sees an apparently-complete answer with no `✓ Completed`
badge and the composer stays enabled (liveness-corrected). The
**defect** (if any) is upstream of the runtime: the agent's behavior,
the prompt that encouraged completion-tool usage, or the
`completionPolicy.requireCompletionTool` opt-in.

## 6. The open question (LIVENESS02 hypothesis)

> When the model emits a final-looking answer but no canonical terminal
> response is committed, why did the completion protocol fail to converge?

Two causal directions are plausible:

### 6.1 Agent-prompt / model-behavior direction

The agent chose not to invoke `attempt_completion` / `submit_and_exit`.
This is the live prediction if `message.type = "say"` and
`message.say = "text"`. Possible root causes:

- The system prompt did not make the completion-tool requirement
  sufficiently strong for this particular model/provider combination.
- The provider/model stopped early before issuing the tool call.
- Tool-use protocol was unavailable or suppressed (e.g. degraded
  tool support on the path).
- Agent orchestration accepted a tool-less terminal generation
  (this is actually correct per the architecture; the architecture
  only gates on tool presence when
  `completionPolicy.requireCompletionTool` is true).
- Context compaction / stop condition removed the opportunity.

### 6.2 Runtime/protocol direction

The agent attempted the completion tool but the result was not
committed. This is the live prediction if `attemptCompletionSeen = true`
but `terminalResponseCommittedThisTurn = false`. Possible root causes:

- Completion tool `content_start` observed, `content_end` never
  arrived (CPL04 partial-completion path — already covered by
  CORRECTION01's symmetric yield to `awaiting_followup`).
- Completion tool rejected (e.g. tool approval denied — but that
  would result in `ask: "completion_result"` rather than `say: "text"`,
  and would not produce the screenshot's visible text body).
- Tool result arrived but `message-translator.ts:1640-1655` did not
  fire (very narrow; the seam is single-purpose and tested).

### 6.3 Useful discriminator

The most useful single field is `attemptCompletionSeen`. It splits
the world into the two directions above. Other useful fields:

```text
MODEL_FINISH_REASON
LAST_AGENT_CONTENT_KIND
LAST_TOOL_REQUESTED
ATTEMPT_COMPLETION_STARTED
ATTEMPT_COMPLETION_COMPLETED
TERMINAL_RESPONSE_COMMITTED
DONE_REASON
TURN_PHASE
VISIBLE_LAST_MESSAGE_TYPE
VISIBLE_LAST_MESSAGE_SUBTYPE
IS_AUTHORITATIVELY_COMPLETED_RESULT
```

All of these are accessible from `MessageTranslatorState`
(`attemptCompletionSeen`, `terminalResponseCommittedThisTurn`),
the runtime-host session object, and the visible chat transcript.

## 7. Available ACT paths

### 7.1 Option A — DO NOT REOPEN. Capture LIVE next time.

If we accept that framing is correctly closed and the defect is
upstream, the cheapest move is to wait for the next live screenshot
to capture the discriminator fields in §6.3, then decide whether
LIVENESS02 is warranted.

### 7.2 Option B — `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02` (NEW ACT)

A new ACT that opens with the exact question from §6 and produces:

- **Phase 0**: capture the screenshot's row shape via live harness.
- **Phase 1**: classify A–H from §3 with LIVE data.
- **Phase 2** (only if §6.1 or §6.2 positive): propose a bounded
  repair.

`LIVENESS02` is the right name if LIVENESS01's bounded claim was
purely safety/fail-closed (which is what the existing commits
suggest). Prefer this over a CORRECTION01 because LIVENESS01 is
genuinely CLOSED on its bounded scope.

### 7.3 Option C — `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01-CORRECTION01` (extension)

Only correct if LIVENESS01's scope was wider than safety. The
existing commits (`d993b9802`, `68d916cab`) frame LIVENESS01 as
liveness (yield to `awaiting_followup` instead of stuck
`"streaming"`), not just safety. So this name may be defensible
if the ACT extends LIVENESS01's liveness scope to also cover
"polished text body without tool call" → converge. But this is
the **same defect class LIVENESS01's commits explicitly avoided**
(by NOT promoting text → completion_result). So this option
would conflict with the previous verdict and should only be
chosen if a NEW rationale emerges.

### 7.4 Option D — `ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION02` (NOT recommended)

The previous ACT chain (`message-translator.ts:1919-1973`,
`terminalReportFraming.ts:28-34`) explicitly forbids the
"stamp any visible final-looking row" fix. This option would
**regress** CORRECTION01's bounded correctness and re-introduce
the bug class the previous ACTs closed. Recommended against.

## 8. Recommendation (factory reviewer disposition)

**Option A** for now. If a second live occurrence is reported
without a completion tool being invoked, escalate to **Option B**
(`COMPLETION-PROTOCOL-LIVENESS02`) with a Phase-0 capture before
any production change.

**Open ACT re-ordering after this discriminator**:

1. `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02` — **DEFER**.
   Reopen trigger: live capture of `attemptCompletionSeen` AND at
   least `terminalResponseCommittedThisTurn`, `turnState.phase`,
   and `visibleLastMessage.type/subtype`. Anything less is
   `CAPTURE_INSUFFICIENT` and the ACT must NOT be opened.

2. `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` — **NEXT**.
   The canonical projection table for TaskHeader should enumerate
   every canonical runtime phase/owner state (streaming,
   awaiting_approval, awaiting_followup, completed, resumable,
   compacting, error, idle, unknown) and does NOT need to assume
   the screenshot's particular phase. Production work proceeds
   independently of LIVENESS02's reopen trigger.

3. `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` — **AFTER 2**.

Note (factory reviewer correction): the prior draft of this
discriminator proposed the ordering `LIVENESS02 → TASKHEADER →
TIMING` and advised against starting 2 or 3 until LIVENESS02's
Phase-0 capture resolved the screenshot's state. That ordering
was unnecessarily serial. TaskHeader canonical projection
addresses a different question — "what does the header project for
each canonical state?" — and is robust regardless of which
particular state this screenshot was in. The LIVENESS02 trigger
list above is the correct gating condition.

## 9. Board-hygiene note (separate concern)

The post-sharding board rebuild at `5c6c7796b` (Tue 2026-08-25)
preserved four ACT IDs in the board index
(`.factory/epic-board.md:98-102`) but did NOT add narrative rows
for any of them in `.factory/epics/task-presentation.md` or
`.factory/epics/closed-foundation.md`:

- `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01`
- `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01-CORRECTION01`
- `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01`
- `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01-CORRECTION01`

The detail for these four ACTs lives only in commit messages
(`077def275`, `0a3f70ae2`, `d521b2df1`, `d3a0a5b06`, `d993b9802`,
`68d916cab`, `05c80aa84`, `185be1e4f`) and inline code comments
(`message-translator.ts:1919-1973`, `terminalReportFraming.ts:1-49`,
`sdk-session-event-coordinator.test.ts:443-510`). Future ACTs that
need to read the rationale for the "terminal-content authority is
restricted to the completion tool" rule will not find it in any
`.factory/epics/` row. This is a separate board-hygiene concern;
flagging it here but not addressing it in this ACT.

## 10. Status (factory reviewer disposition)

- **No production change.**
- **No test change.**
- **No board change** (`TERMINAL-REPORT-COMPLETION-FRAMING01` remains
  CLOSED v2 with no new row).
- **No ACT opened.** `COMPLETION-PROTOCOL-LIVENESS02` remains deferred
  until the §8 reopen trigger fires.
  > **Update at `e9e9c39c6` follow-up**: The reopen trigger has now
  > fired for real-world observation purposes (LIVE_OCCURRENCE_2
  > captured at session `1787562381026_jao7c`), but the discriminator
  > fields required by §8 are **NOT externally observable** in the
  > current harness environment. See
  > `docs/architecture/elm/completion-protocol-liveness02-phase0-capture01.md`
  > for the Phase-0 LIVE capture and its `CAPTURE_INSUFFICIENT`
  > classification (committed in the same session as this update).
- **Committed as durable negative knowledge** — this file preserves
  the discriminator and the negative architectural result
  ("don't widen framing to fix the missing badge; the framing ACT
  is correctly closed"). See commit hash (added with the commit).
- **Next production ACT**: `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01`.
- **Board-hygiene gap** (4 ghost rows for LIVENESS01/CRA family): P2,
  batched — NOT addressed in this ACT. Will be folded into the next
  production ACT that touches the completion-protocol family.

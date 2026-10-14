# ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01 — NOT_REPRODUCED (category D — INTENTIONAL_HISTORY) — 2026-10-13

**Status:** CLOSED with verdict **`NOT_REPRODUCED`**, primary causal category **D — INTENTIONAL_HISTORY** (with a "current-terminal presentation missing" UI/UX caveat; no production defect). No production fix recommended.

**Predecessor:** `b24b954db` on `main` (ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01, `PASS_REPAIR_STRUCTURAL_LIVE_PENDING`).

**Live Cline task (specimen):** `1791892624249_io4fp` (started 2026-10-13T11:57:04.686Z; ended 2026-10-13T12:23:01.797Z; status `completed`; exit_code 0).

**Installed extension (live, at ACT execution time):** `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-b24b954db/` (per SEAM12 live-captures `00-installed-extension-identity.txt`).

---

## 1. Exact source and installed identities

| Item | Value |
|---|---|
| Repository HEAD | `b24b954db` (matches expected predecessor) |
| Branch | `main` |
| Working tree | SEAM12 ACT/evidence changes (intact, SHA256SUM-verified) |
| Installed extension directory | `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-b24b954db/` |
| Installed version | `4.1.16-5a1c485cb-b24b954db` |
| Installed at | 2026-10-13 14:36:17 +0300 |
| Live Cline task | `1791892624249_io4fp` |
| Extension host PID (current) | 14116 |
| Provider / model | `minimax` / `MiniMax-M3` |

## 2. Persisted completion-row inventory

**Persisted `messages.json` (OpenAI-style transcript):** 341 messages.

Two `submit_and_exit` tool_use blocks:
- `msg[333]` (assistant, ts 1791893907206, `call_function_xxakngsgiq8s_1`) — first submission.
- `msg[339]` (assistant, ts 1791893920497, `call_function_jyd622908p3h_1`) — second submission (after held observation).

Both produce `tool_result` with content `"submitted (verified=true)"`:
- `msg[334]` (ts 1791893907220) — first `submit_and_exit` tool result.
- `msg[340]` (ts 1791893920510) — second `submit_and_exit` tool result.

Between them: `msg[335]` is the host runtime-control `completion_continuation_control` (ts 1791893907292) with text instructing the agent to **"Do NOT synthesize any `submit_and_exit` completion row before every held observation has been consumed."** `msg[336]` is a `[SYSTEM]` reminder. `msg[337]`-`msg[338]` are the held-observation `command_status` invocation and its tool result (job `cmd_mv6mq5t8qhepcxxm`: state `containment_failed`, signal `SIGTERM`, elapsed `1081302ms`).

**No `completion_result` say/ask is persisted in `messages.json`.** The `completion_result` row is synthesized by the extension's `MessageTranslator` (the SDK `attempt_completion` tool's `content_end` handler) and emitted in-memory to the webview only. It is not part of the durable transcript.

**Live cardinality authority** (`continuation-cardinality-authority.jsonl` — 289 events, all session `1791892624249_io4fp`):
- `submit_and_exit_seen`: **2** (submitId `submit-1791892624249_io4fp-1` at 1791893907228, `submit-1791892624249_io4fp-2` at 1791893920519)
- `task_completion_committed`: **1** (completionId `completion-1791892624249_io4fp-1` at 1791893920558, origin `deferred_continuation`, run `run_X2sJc8rF`)
- `terminal_committed`: 275 (background terminal results)
- `pending_prompt_enqueued`: 1 (at 1791893907248, after first submit_and_exit)
- `continuation_scheduled`: 1
- `continuation_started`: 1 (at 1791893907305, promptId `pending_1791893907248_3FaW_`)
- `agent_turn_done`: 2

**Live turn-state writer provenance** (`turn-state-writer-provenance.jsonl` — 24 entries):
- 1791893907248 `session-event-pending-prompt-submitted` — streaming→streaming, seq 2008 (first `submit_and_exit`; does **NOT** transition to completed).
- 1791893920558 `session-event-turn-complete-completed` — streaming→completed, seq 2037 (second `submit_and_exit`; the **one and only** authoritative completion write).
- 1791894181769 `controller-clear-task` — completed→idle, seq 2039 (reopen begins; old task cleared).
- 1791894181773 `controller-epoch-transition-reseed` — epoch 3, idle, seq 2040.
- 1791894182719 `controller-epoch-transition-reseed` — epoch 4, idle, seq 2043.
- 1791894182818 `task-control-resume-ask` — epoch 4, idle→completed, seq 2044, anchorTs `1791894182817` (synthesized resume ask on reopen).

**Authoritative persisted completion cardinality: 1.** The first `submit_and_exit` correctly produced a `pending_prompt_submitted` (not a `turn_complete_completed`), and the continuation-control runtime authority correctly required the held observation to be consumed before the second `submit_and_exit` could commit. There is **no persisted second `task_completion_committed`** for this session.

## 3. Live vs reopened rendering comparison

**Live (epoch 2) — `post-terminal-authority-diagnostic-webview.jsonl` (this task only):**
- sv 2031 (1791893920522): `messageTail = {ts: 621, type: "say", say: "completion_result", partial: true, seq: 2034, epoch: 2}` — partial completion card streaming.
- sv 2031 (1791893920547): `messageTail = {ts: 621, type: "say", say: "completion_result", seq: 2035}`.
- sv 2036 (1791893920561): `messageTail = {ts: 621, type: "say", say: "completion_result", partial: false, seq: 2035}`.
- sv 2038 (1791893920610): `extension: attemptCompletionSeen = true, terminalResponseCommittedThisTurn = true`.
- sv 2038 (1791893920642): `messageTail = {ts: 621, say: "completion_result", partial: false, seq: 2035}`, `phase = completed`.
- Pre-reopen button config: `{sendingDisabled: true, enableButtons: true, secondaryText: "Cancel", secondaryAction: "cancel"}`.

**Reopen (epoch 3 → 4):**
- sv 2041 (1791894181860): epoch 3, phase=idle (post-clear).
- sv 2042 (1791894181911): epoch 3, phase=idle.
- sv 2045 (1791894182885): epoch 4, `messageTail = {ts: 1791894182817, type: "ask", ask: "resume_completed_task"}`.
- sv 2045 (1791894182895): `buttonConfig = {sendingDisabled: false, enableButtons: true, primaryText: "Start New Task", primaryAction: "new_task"}`, phase=completed.

**Authoritative live-visible report identity:** exactly **one** `completion_result` say (ts=621, seq=2035, epoch=2).

**Authoritative reopen-visible report identity:** exactly **one** `resume_completed_task` ask (ts=1791894182817, epoch=4) — a `new_task` button affordance, not a `completion_result` card.

The two entities are distinct types (`say` vs `ask`), distinct `ts`/`seq`/`epoch`, distinct render paths in `ChatRow.tsx`:
- `say: "completion_result"` → `CompletionOutputRow` (with `terminalReportFraming` `kind: "completed"`).
- `ask: "resume_completed_task"` → `default:` case in `ChatRow.tsx` ask switch → `<InvisibleSpacer />` in the chat row; the visible UI is the action button (Start New Task) from `buttonConfig.ts:171-178`, not a completion card.

There is **no duplicate `completion_result` row** in either the live or reopen render. There is **no persisted second `task_completion_committed`**.

## 4. RED reproduction

**Verdict: `HALT_RED_NOT_REPRODUCED`** for categories A, B, and C.

- **A (TWO_PERSISTED_RESULTS):** live cardinality authority shows `task_completion_committed: 1`; turn-state writer provenance shows exactly one `session-event-turn-complete-completed`; `messages.json` has two `submit_and_exit` tool_use blocks but zero `completion_result` say/ask rows (the `completion_result` is in-memory only, not persisted). **NOT REPRODUCED.**

- **B (REOPEN_SYNTHESIS_DUPLICATE):** reopen synthesizes exactly one `resume_completed_task` ask (anchorTs 1791894182817). No second `completion_result` is synthesized. The `appendFreshResumeMessage` at `sdk-task-control-coordinator.ts:351-370` correctly strips any pre-existing `resume_*` rows and appends a single new `ask: "resume_completed_task"` row. `ChatRow.tsx` renders this as `<InvisibleSpacer />` (no card). **NOT REPRODUCED.**

- **C (WEBVIEW_RENDER_DUPLICATE):** the live webview renders one `completion_result` say (ts=621); the reopen webview renders one `resume_completed_task` ask (ts=1791894182817). No message-identity collision (different `ts`, different `type`, different render path). **NOT REPRODUCED.**

- **D (INTENTIONAL_HISTORY):** the user's "two completion reports after reopen" perception maps to two distinct, intentional UI entities:
  1. The persisted assistant `text` row carrying the model's `submit_and_exit` `summary` (rendered in the chat as plain assistant text — not a `CompletionOutputRow`, because the marker `isAuthoritativelyCompletedResult` is stamped only on the SDK-translator's `content_end` of the `attempt_completion` tool, and the user's `submit_and_exit` tool use is not a terminal completion tool from the SDK translator's perspective).
  2. The synthesized `resume_completed_task` ask row appended by `appendFreshResumeMessage` on reopen, which surfaces as the "Start New Task" button affordance (the existing product contract for completed-task reopen).
  Both are correct, distinct, intended. **CATEGORY D APPLIES.**

- **E (CAPTURE_INSUFFICIENT):** not applicable — capture is complete. Live task writer/BCB JSONLs are full and session-scoped to `1791892624249_io4fp`; persisted `messages.json` and `session.json` are present; reopen was observed (epoch 3→4 transition visible in writer provenance and webview diagnostic).

## 5. Repair eligibility

**No production fix recommended.** Persistence, render, and reopen-synthesis paths are all working as designed and exercised by the existing test gates (208/211 PASS, 3 RED preserved, L2847 intact, BCB repair intact).

The user's perception of "two completion reports" is a **UI/UX framing observation**, not a defect:
- The historical completion is shown as plain assistant text (the model's `summary`), not as a `CompletionOutputRow` (no `isAuthoritativelyCompletedResult` marker on the persisted `submit_and_exit` tool use).
- The reopen's terminal-state is shown only as the `resume_completed_task` action button, not as a "completed" report card.
- If the product wants the historical `submit_and_exit` to render as a `CompletionOutputRow` with a "Completed" badge, that is a **product contract change** (the `terminalReportFraming` projection in `webview-ui/src/components/chat/terminalReportFraming.ts` does NOT infer "Completed" from message text — and the file header explicitly says "What MUST NOT happen: Infer 'Completed' from message text"). Such a change is **out of scope for this ACT** and is a deliberate design choice to avoid the very kind of false-positive terminal identification that the BCB/SEAM08 stack is built to prevent.

**Conservation (§6 of the ACT):** no production code touched; no diagnostic cleanup; L2847 RED baseline preserved; pre-existing 19 BCB01-family + 8 FRSP01 failures unchanged; SEAM12 evidence SHA256SUMS verified; BCB registry repair remains intact.

## 6. SEAM12 reconciliation

The SEAM12 ACT `LIVE_NO_TRIGGER` verdict is **confirmed and corroborated** by this ACT's evidence.

- The `command_status` invocation on `cmd_mv6mq5t8qhepcxxm` observed a job that was **NEVER tracked in the live continuation-cardinality-authority** (0 entries for that `jobId` across all 289 events). The job was a harness-launched `which codium-clinemm` discovery query that was killed by `cancel_command` after the harness's auto-launch SIGSEGV.
- Because the cardinality authority has no `terminal_committed` entry for `cmd_mv6mq5t8qhepcxxm`, the in-task `unconsumedOwnedTerminalResultsForC10` count never became > 0, and the SEAM08 post-await `enqueueCompletionContinuationIfHeld` consult was **never reached** (the consult is gated on that count).
- The runtime-control `completion_continuation_control` message (msg 335) DID reach the agent, and the agent's response (observing the held job and re-issuing `submit_and_exit`) did execute, but this is the **Continuation Control** Elm kernel's authority (a separate kernel consulted at `pickContinuationDirectiveForPublication` BEFORE the SEAM08 consult), **not** SEAM08 evidence. Per the SEAM12 ACT's own §7 caveat: "Do not claim SEAM08 live qualification solely from the `completion_continuation_control` runtime-control message." This ACT explicitly does not make that claim.
- The `DIGEST_CREATED_AT: 2026-10-13T12:23:37Z` in `~/Downloads/digest.txt` is consistent with the live task started_at `2026-10-13T11:57:04.686Z` and is **NOT** future-dated. The `LEAMAS_BUILD_TIME: 2026-09-01T06:21:35Z` is the leamas tool's legitimate build time. The `snapshot_at` future-dated concern flagged by the ACT §7 is **not observed in this evidence**.

The SEAM12 ACT and its evidence files (`.factory/evidence/ACT-CLINEMM-ELM-SEAM12-DCB-LIVE-QUALIFICATION01/live-captures/{00..04} + SHA256SUMS`) are **intact and SHA256-verified** at closure time. No SEAM12 test suite was re-run (per ACT §7: "No repeat of the SEAM12 test suite unless needed by the causal discriminator.").

## 7. Preserved files

- `.factory/acts/ACT-CLINEMM-ELM-SEAM12-DCB-LIVE-QUALIFICATION01.md` — intact (from prior ACT).
- `.factory/evidence/ACT-CLINEMM-ELM-SEAM12-DCB-LIVE-QUALIFICATION01/live-captures/{00..04, SHA256SUMS}` — all SHAs match.
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01/00-closure-evidence.txt` — this ACT's captured data.
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01/SHA256SUMS` — integrity record.

## 8. Verdict

**`NOT_REPRODUCED`** — primary causal category **D — INTENTIONAL_HISTORY** (with a "current-terminal presentation missing" UI/UX caveat, not a defect). No production fix recommended. No SEAM12 test-suite repeat. SEAM12 evidence intact. L2847 RED preserved. BCB repair intact.

**Stop at the first proven causal boundary:** the user-perceived "two completion reports" are the assistant `text` row carrying the `submit_and_exit` summary and the synthesized `resume_completed_task` action button — both are correct, distinct, intended product behavior. No causal boundary beyond this is reachable from the live evidence.

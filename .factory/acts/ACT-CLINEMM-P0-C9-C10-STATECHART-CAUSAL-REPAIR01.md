# ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01

**Priority:** P0
**Verdict:** `PASS_STRUCTURAL_PENDING_LIVE`
**Purpose:** Reproduce and repair the C9/C10 completion-presentation divergence;
source-bound lifecycle statecharts and an incident trace overlay.

## 1. The incident

```
SESSION = 1792824738628_cw4og
EPOCH   = 8
C9      = 2 observed attempts
C10     = 0 observed commits
LEGACY  = streaming
UI      = Working / Cancel
ROW     = finalized completion_result
```

A finalized `completion_result` was presented as authoritative completion
(the green "Completed" badge) while the task remained `streaming`, the
TaskHeader said Working, and no canonical C10 completion commit had
occurred.

## 2. The causal finding

The BCB hold was NOT the leak. Two mechanisms produce the
`C9 > 0 / C10 = 0` signature, and the VISIBLE completion row
discriminates between them:

| Candidate | Fate of the completion row |
|---|---|
| TS-predicate BCB hold | The message-layer completion filter REMOVES the row. The user never sees it. |
| Elm authority HOLD / FAILURE | The row STAYS published with `isAuthoritativelyCompletedResult: true`, and the webview renders the green badge. |

**The confirmed cause is the Elm authority HOLD / FAILURE path.**

The causal chain:

1. The completion tool's `content_end` publishes the finalized
   `completion_result` row and stamps the authority marker
   UNCONDITIONALLY (`message-translator.ts`).
2. At turn end, the C10 barrier's TS predicates pass, but
   `checkElmCompletionAuthority` returns `false` (Elm HOLD or FAILURE —
   there is NO silent TS fallback).
3. The C10 commit is SUPPRESSED: the phase stays `streaming`, the
   TaskHeader says "Working", and the C10 record never fires.
4. The already-published row KEEPS its marker, so the webview renders
   the authoritative "Completed" badge.

**Step 1 vs step 3 is the defect:** the marker asserted authority at
PUBLICATION time, while the authority to commit is decided LATER — and
may never be granted. There was no seam that retracted the marker when
the commit was withheld.

## 3. The bounded repair

**One production file changed:**
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts`.

New seam `retractCompletionAuthorityMarker(event)`. When the C10 commit
is suppressed (Elm HOLD / FAILURE), the coordinator re-publishes the
CURRENT turn's completion row with the SAME `ts` and the authority
marker DROPPED.

Four bounded design points:

1. The retraction target is the row the coordinator ITSELF published
   (`publishedAuthoritativeCompletionRow`, set AFTER the message-layer
   filter ran). The BCB path tracks nothing and retracts nothing, so
   the retraction can never resurrect a filtered row.
2. It uses the UPDATE channel (`emitHookMessage`), not the PUBLISH
   channel (`appendAndEmit`), so the published-row cardinality is
   unchanged (the `CPA-09` / `CPA-04` / `C10-BASELINE-02` contracts).
3. The tracking is turn-scoped and cleared at the turn boundary, so a
   historical completion row from a previous epoch is never touched.
4. It can only REMOVE the authority claim, never add one. It is a
   presentation correction, not a second completion authority.

Files deliberately left pristine: `message-translator.ts` and
`sdk-message-coordinator.ts` (both were part of earlier repair drafts
and were reverted once proved unnecessary).

## 4. Ablation (necessity, by visible state — not a counter)

| Ablation | Result |
|---|---|
| Disable the retraction seam | 7 of 19 tests FAIL — exactly the assertions that depend on the false badge being absent. |
| Disable the translator's marker stamp | 1 of 5 tests FAIL — the GREEN control (a genuine completion loses its badge). The stamp is NOT the defect. |
| Change the Elm decision to AUTHORIZE | The C10 commit count goes 0 -> 1 and the phase becomes `completed`. The Elm HOLD is the cause. |

## 5. Tests

- `apps/vscode/src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01.test.ts`
  — 5 tests: the RED witness (RED-03: Elm HOLD and Elm FAILURE both
  reproduce the false badge) + the GREEN control.
- `apps/vscode/src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01-cons.test.ts`
  — 14 conservation tests covering every required case.

Both drive the REAL production seams (the production message
translator, the production session event coordinator, the production BCB
owner, the production phase writer) and assert the REAL webview
authority projection (`resolveTerminalReportFraming`).

## 6. Regression

163 relevant completion / BCB / Elm / C10 / terminal / background-job /
phase / presentation test files, run before and after the repair with
the identical file list:

```
BASELINE (repair stashed):  32 unique failing tests
AFTER   (repair applied):   30 unique failing tests
NEW FAILURES INTRODUCED BY THE REPAIR:  (none)
```

The 30 remaining failures are PRE-EXISTING: those harnesses do not
inject the required `getElmCompletionAuthorityDecision` option, so the
Elm authority fails closed and the C10 commit is suppressed. That
behaviour is unchanged by this ACT.

Typecheck: clean. Lint: clean.

## 7. Deliverables

- `docs/architecture/task-lifecycle/` — the four source-bound statecharts
  + `transitions.tsv` (the machine-readable transition index).
- `tools/lifecycle-replay/` — the offline trace-to-Mermaid projection
  over the existing JSONL evidence (strict correlation; unknown joins
  stay unknown).
- `.factory/evidence/ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01/`
  — the incident timeline, the Mermaid path, the causal analysis, the
  statechart narrative, the regression suite record.

## 8. Live qualification

See `.factory/evidence/ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01/04-live-dogfood.md`.

## 9. Verdict

`PASS_STRUCTURAL_PENDING_LIVE`.

The defect is causally addressed and the repair is proven necessary and
sufficient by real-seam ablation. Live qualification is pending the
exact-head dogfood run recorded in §8.

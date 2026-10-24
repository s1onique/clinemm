# ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 — Causal analysis

## 1. The reported incident

```
SESSION = 1792824738628_cw4og
EPOCH   = 8
C9      = 2 observed attempts
C10     = 0 observed commits
LEGACY  = streaming
UI      = Working / Cancel
ROW     = finalized completion_result
```

Reported symptom: a finalized `completion_result` is displayed as
authoritative completion while the task remains `streaming`, the
TaskHeader says Working, and no canonical C10 completion commit has
occurred.

## 2. What the counters mean

`C9` (`submit_and_exit_seen`) is an ATTEMPT capture. It fires when the
completion tool's terminal response was committed AND the turn-end path
is promoting phase. It does NOT mean the task completed.

`C10` (`task_completion_committed`) is the canonical COMPLETION commit.
It is the ONLY event-creating seam for `completionId`, and it fires AT
the `setTurnPhase("completed", …)` effect.

So `C9 = 2, C10 = 0` reads: **two completion attempts, neither of which
committed the task's completion.** For a HELD task that is the correct
shape.

## 3. The two candidate causes, and how the row evidence discriminates

The reported "missing terminal observation" is a DISCRIMINATOR, not a
proven final cause. Two mechanisms produce the `C9=2 / C10=0` signature:

| Candidate | What happens to the completion row |
|---|---|
| (A) TS-predicate BCB hold (held terminal observations) | The message-layer completion filter REMOVES the row from the published set. The user NEVER sees it. |
| (B) Elm authority HOLD / FAILURE | The row is NOT filtered. It stays published WITH `isAuthoritativelyCompletedResult: true`, and the webview renders the green "Completed" badge. |

**The LIVE row evidence discriminates: a VISIBLE finalized
`completion_result` excludes (A) and implicates (B).**

Under (A) the row would not be visible at all. Under (B) it is visible
AND carries the authority marker — exactly what the report describes.

## 4. The confirmed causal chain

```
1. content_end (submit_and_exit)
   apps/vscode/src/sdk/message-translator.ts
   -> publishes say:"completion_result", partial=false,
      isAuthoritativelyCompletedResult: true
      (STAMPED UNCONDITIONALLY — `eventAuthority !== false` and the
      live path never sets `eventAuthority`)

2. done event
   apps/vscode/src/sdk/sdk-session-event-coordinator.ts
   -> turn-end promotion branch
   -> BCB hold predicate is false (no outstanding work)
   -> checkElmCompletionAuthority(...) returns false  [Elm HOLD/FAILURE]

3. C10 commit SUPPRESSED
   -> setTurnPhase("completed", ...) NOT called
   -> phase stays "streaming"
   -> TaskHeader projects "Working" (taskHeaderTelemetryHelpers.ts:146)
   -> the C10 capture never fires

4. The published row KEEPS isAuthoritativelyCompletedResult: true
   -> webview resolveTerminalReportFraming() PRIMARY marker path
   -> green "Completed" badge
```

**Step 1 versus step 3 IS the defect.** The marker asserts "this row
IS a terminal completion" at PUBLICATION time; the authority to commit
the task's completion is decided LATER and may never be granted. There
was no seam that retracted the marker when the commit was withheld.

## 5. Phase 4 — causal discriminator and ablation

Each candidate was evaluated independently against the REAL production
seams.

| Candidate | Finding |
|---|---|
| Translator's live default for `isAuthoritativelyCompletedResult` | **PARTICIPANT, not sufficient.** Ablating the stamp removes the leak BUT breaks the GREEN control (a genuine completion loses its badge). The stamp itself is correct; its TIMING was wrong. |
| Message-layer completion filtering | **NOT the cause for the Elm path; CORRECT for the BCB path.** Verified empirically: under the BCB hold, `publishedRows === []` — the row is filtered out entirely. No marker survives, so no false badge. |
| BCB's owner-bound terminal observation count | **NOT the cause.** Under the BCB hold the row never reaches the user. |
| Pending-prompt and continuation eligibility | **NOT the cause.** Same reasoning: the BCB path filters the row. |
| Elm HOLD / AUTHORIZE | **THE CAUSE.** Ablating the Elm decision to AUTHORIZE makes the C10 commit fire (count goes 0 -> 1) and the phase become `completed`. The Elm HOLD is what withholds the commit while leaving the stamped row in place. |
| C10 commit and phase publication | **CORRECT.** The commit is properly withheld; the phase is correctly `streaming`. |

### Necessity ablation (executed, not asserted)

The repair is the retraction seam. Disabling ONLY that seam
(`this.retractCompletionAuthorityMarker(event)` -> no-op) and re-running
the suites:

```
Tests  7 failed | 12 passed (19)
```

The 7 failures are EXACTLY the assertions that depend on the false
badge being absent (the Elm HOLD / FAILURE cases and the cases that
depend on them). Necessity is therefore demonstrated by the PRESENCE or
ABSENCE OF THE INCORRECT VISIBLE STATE — not by a diagnostic counter
increment.

Disabling the translator's marker stamp instead:

```
Tests  1 failed | 4 passed (5)
```

…with the single failure being the GREEN control (a genuine completion
loses its badge). So the stamp is NOT the defect.

## 6. Phase 5 — the bounded repair

**One file changed:** `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`.

The seam: `retractCompletionAuthorityMarker(event)`.

When the Elm authority says HOLD or FAILURE (i.e. the C10 commit is
suppressed), the coordinator re-publishes the CURRENT turn's completion
row with the SAME `ts` and the authority marker DROPPED.

Design points, each bounded:

1. **The retraction target is the row the coordinator itself
   published.** `publishedAuthoritativeCompletionRow` is set at the
   publication seam AFTER the message-layer completion filter has run.
   So the BCB path (row filtered out) tracks nothing and retracts
   nothing — the retraction can never resurrect a row the filter
   deliberately suppressed.

2. **The retraction uses the UPDATE channel, not the PUBLISH channel.**
   `emitHookMessage` (store-append + direct webview push, no session
   event) instead of `appendAndEmit` (publish new rows + session event
   emission). The message store upserts by `ts` and the webview's
   `applyMessage` reducer merges by `ts`, so the row is replaced IN
   PLACE — the published-row cardinality is unchanged, which is what the
   existing `CPA-09` / `CPA-04` / `C10-BASELINE-02` contracts assert.

3. **The retraction is turn-scoped.** The tracking is cleared at the
   turn boundary (`pending_prompt_submitted`). A historical completion
   row from a previous epoch is never touched, so "Preserve historical
   completion summaries when a newer epoch is running" holds.

4. **The retraction can only REMOVE the authority claim, never add
   one.** It is a presentation correction, not a second completion
   authority. The single authority for "the task completed" remains the
   C10 commit.

### Invariants after the repair

| Invariant | How it holds |
|---|---|
| Current-turn authoritative completion display => C10 committed | The marker is retracted whenever the C10 commit is suppressed. |
| C9 attempt != C10 completion | Unchanged: C9 is an attempt capture; C10 is the commit. |
| Terminal response finalized != task completion committed | Unchanged: the row is published at `content_end`; the commit is at turn end. |
| C10 committed => TS conservation passed and Elm authorized | Unchanged: the barrier and the Elm gate both precede the effect. |
| BCB held => no authoritative completion display | Unchanged (the filter removes the row); now ALSO guaranteed by the retraction not firing on a filtered row. |
| Held-attempt summary => content may remain visible without a false Completed badge | The retraction drops only the marker; the summary text survives. |

### What was deliberately NOT changed

- `apps/vscode/src/sdk/message-translator.ts` — reverted to pristine
  after the first repair draft proved it was unnecessary. The
  translator's marker stamp is CORRECT; only its consumer needed to
  learn about the withheld commit.
- `apps/vscode/src/sdk/sdk-message-coordinator.ts` — reverted to
  pristine (the `getMessageByTs` accessor proved unnecessary once the
  coordinator tracked the published row directly).
- No new wire field, no new Elm kernel, no new state owner, no second
  completion authority, no unrelated UI redesign.

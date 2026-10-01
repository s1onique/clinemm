# §24 — Final report

```text
ACT=
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-REPAIR01

ENTRY_HEAD=
6adf921310195a7e8681c24f126004a6238d40ab

SUBJECT_HEAD=
254004a076576fdefb7e9edec7d521d56c2ab498

CLOSURE_HEAD=
5605c5dbcf38c0669a017670db50141dbebe2168

PREDECESSOR_VERDICT=H1_ELM_TOO_STRICT

REAL_SESSION_ID=1790809530345_lrsk9
REAL_TRACE_SHA256=ec77301dd854dffe4d8121643852fd9a33ab7dddac8b2d70c9b0da1d9d0ddccd
REAL_PROJECTION_SHA256=ad5c8b26c89bc6287aa92072823e43451efe6751749328faeb0be4289bc0f12b

ROOT_CAUSE=
The Elm kernel's `computeHoldReasons` returned `ActiveRun` whenever
`model.activeRun /= Nothing`, regardless of whether the production
completion-ready boundary (C9 = `submit_and_exit_seen`) had been
crossed. Production C9 fires only after the BCB barrier clears
(`!outstandingAutonomousWork`); therefore once C9 has fired, the
residual `activeRun` is the bookkeeping artifact of a run whose
`AgentTurnDone` (C8) has not yet been delivered but whose semantic
completion has been declared (C10). Equating `activeRun ≠ Nothing`
with `completion must remain held` conflated "run event not yet
closed" with "completion must remain held".

The original repair (suppression on `model.submitCount >= 1`) was
REJECTED during review (HALT_STALE_SUBMIT_AUTHORIZES_LATER_RUN): the
R11 adversarial sequence proved that a task-level counter persists
across runs, so a stale R1 submit would authorize R2's commit.

OLD_ACTIVE_RUN_HOLD_RULE=
`ActiveRun` is always a `HoldReason` whenever `model.activeRun /= Nothing`.
Used at `Authority.elm` (predecessor).

NEW_ACTIVE_RUN_HOLD_RULE=
`ActiveRun` is a `HoldReason` for ALL non-`TaskCompletionCommitted` queries
UNCHANGED. For `TaskCompletionCommitted` ONLY, `ActiveRun` is suppressed
when `model.commitReadyRun == model.activeRun`. `commitReadyRun` is a
`Maybe RunRef` bound at `SubmitAndExitSeen` to the `activeRun` at that
instant, and invalidated on every event that transitions `activeRun`
(RunStarted, AgentTurnDone, ExecuteTurnPreludeEnter, ContinuationStarted).

This proves: the BCB barrier cleared for THIS run (because submit was
observed while THIS run was active) AND the run-scope binding is
still intact (no RunStarted or AgentTurnDone for this run since the
submit). The residual `activeRun` is the bookkeeping artifact of
a run whose `AgentTurnDone` (C8) has not yet been delivered but whose
semantic completion has been declared (C10).

Implemented as `Authority.completionCommitHoldReasons` (used only by
`handleTaskCompletionCommitted`). All other entry points continue to
use `computeHoldReasons` unmodified.

REFINEMENT_PROVENANCE=
Identified by ACT review (HALT_STALE_SUBMIT_AUTHORIZES_LATER_RUN).
Exposed by ELM-CWRA-R11 added during the review cycle. Fix shape:
run-scoped binding (commitReadyRun) replacing task-level counter
(submitCount).

RED=REPRODUCED (two rounds)
  Round 1 (pre-R11, original repair `submitCount >= 1`):
    ELM-CWRA-R01, R02, R04, R07, R09, R10 RED — pre-repair divergence.
    ELM-CWRA-R03, R05, R06, R08 PASS — conservation.
  Round 2 (post-R11, original repair): R11 RED — exposed the new P0.
  Round 3 (post-R11, refined repair `commitReadyRun == activeRun`):
    ELM-CWRA-R01..R11 all PASS.

GREEN=PASSED
  After applying the run-scope refinement:
  - elm-test: 31/31 PASSED (was 30/30 with original repair)
  - smoke-test: PASS (kernel round-trips correctly; commitReadyRun
    appears and persists through commit, cleared by late AgentTurnDone)
  - historical replay: 20/20 PASSED (no regression in R1/R2/R3/R4)
  - bun run check-types: PASS

ABLATION=PASSED
  Round 1 (original repair ablated): 24/30 PASS, 6/30 FAIL.
  Round 2 (refined repair ablated): 25/31 PASS, 6/31 FAIL — same
    6 RED (R11 still GREEN because the ablation unconditionally
    rejects ActiveRun, which matches R11's expectation).
  Restored refined repair: 31/31 PASS.

REAL_PROJECTION_FIRST_DIVERGENCE=null
  (was: ELM_REJECTS_TS_SEQUENCE at seq=8 in predecessor)

REAL_FULL_TRACE_ELM_REJECTIONS=0
  eventsTotal=9
  firstDivergence=INSUFFICIENT_IDENTITY at execute_turn_prelude_enter (seq 1)
  (known capture limitation; the predecessor explicitly carved this out)
  no ELM_REJECTS_TS_SEQUENCE on any seq.

KNOWN_INSUFFICIENT_IDENTITY=
  seq 1: execute_turn_prelude_enter (no runId in REAL trace)
  seq 4,5,6: terminal_committed ×3 (no runId; owned terminal observation
  intent is captured but the Elm kernel needs the ownerId mapping path
  which the REAL trace cannot carry without schema changes)

OLD_C8_BEFORE_C10_PATH=PASS
  Counterfactual (synthetic) replayed through repaired kernel:
  firstDivergence=null, finalModel=completion_committed.

ADVERSARIAL_CONSERVATION=
  See 08-adversarial-conservation.md. All 24 pre-existing tests GREEN.

ELM_ARTIFACT_SOURCE_HEAD=<SUBJECT_HEAD>
ELM_VENDOR_JS_SHA256=034f70b7b725738b284f3ec94f646b68f9c2def535cc811304c31313902d706e

TS_PRODUCTION_SEMANTICS_CHANGED=false
ELM_AUTHORITY_SEMANTICS_CHANGED=true
QUEUE_SEMANTICS_CHANGED=false
PRESENTATION_SEMANTICS_CHANGED=false
MCP_CODE_CHANGED=false
MYC_CODE_CHANGED=false

MANUFACTURED_IDENTITY_COUNT=0
ORIGIN_REWRITE_COUNT=0

VERDICT=PASS_ELM_COMMIT_WHILE_RUN_ACTIVE_REPAIR_R11_REFINED

ELM_MODEL_CORRESPONDENCE=
SUPPORTED_FOR_REAL_TRACE_1790809530345_lrsk9

READY_FOR_ELM_SHADOW02=true

SUCCESSOR_ACT=
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02
```

## Summary of changes

- `Domain.elm`: added `commitReadyRun : Maybe RunRef` field to
  `Model` (and `emptyModel`); one new field, one new constructor
  site. Total file size: 400 → 401 lines.

- `Codec.elm`: added encoding for `commitReadyRun` in `encodeModel`.
  Total file size: 358 → 359 lines.

- `Authority.elm`: 1 helper added (`completionCommitHoldReasons`);
  the suppression is now `commitReadyRun == activeRun`. Wired
  `commitReadyRun` updates in 5 places:
  1. `SubmitAndExitSeen` — bind to current `activeRun`.
  2. `handleRunStarted` (both branches) — invalidate to `Nothing`.
  3. `handleAgentTurnDone` (all 3 branches) — invalidate to `Nothing`.
  4. `ExecuteTurnPreludeEnter` — invalidate to `Nothing`.
  5. `handleContinuationStarted` (all 3 branches) — invalidate to
     `Nothing`.
  Docstring updated to explain the run-scope invariant and the
  R11-driven refinement.

- `CompletionAuthorityTest.elm`: 11 new tests `ELM-CWRA-R01..R11`
  added under the existing suite. R11 was added during the review
  cycle to expose the temporal-identity P0.

- `vendor/completion-authority.js`: rebuilt from the refined source.
  SHA: `40aeeb28...` → `dcbf85f9...` (initial repair) → `034f70b7...`
  (run-scope refinement).

- `apps/vscode/src/sdk/__tests__/replay-projection-once.mts`: new
  one-off Bun script used to drive §12/§13 replays and dump
  evidence JSON.

- `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-REPAIR01/`:
  evidence package per §21 (12 files + result.json). Added in this
  review cycle: `02b-r11-red.txt`, `03b-r11-green.txt`,
  `04b-ablation-r11-red-raw.txt`. Updated: `04-ablation.md`,
  `09-artifact-binding.txt`, `10-final-report.md`, `result.json`.

- `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json`:
  mechanically regenerated by the existing `export:` test after
  vendor SHA changed. No semantic change.

## Stop condition

The repaired kernel:

- Accepts the factual C10→C8 chronology (REAL projection, 5 events, zero divergence).
- Still rejects genuinely active/unresolved completion (`ELM-CWRA-R03/R05`).
- Rejects stale-submit cross-run authorization (`ELM-CWRA-R11`).
- Passes ablation (revert → 6 RED; restore → GREEN).
- Replays the frozen REAL projection with zero semantic divergence.

**STOP.** Do not wire Elm into production in this ACT. Do not
package a VSIX. Do not dogfood yet.

The next ACT is `ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02`
where TS remains authoritative and Elm observes the same factual
production stream live through a narrow port boundary.

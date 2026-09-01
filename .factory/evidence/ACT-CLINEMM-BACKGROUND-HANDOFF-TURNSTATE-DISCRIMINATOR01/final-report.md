ACT_ID    = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
SECTION   = FINAL REPORT
SUBJECT   = HEAD 71a56613a136fdb29d05f6f8e92c85ed74519ea1 (= origin/main)
DATE      = 2026-09-01

================================================================
0. ONE-SENTENCE ANSWER (CONDITIONAL, NOT A LIVE VERDICT)
================================================================

The LIVE-bound specimen's `turnPhase=idle` write, if its LIVE
writer is one of the two viable contract-correct candidates
(`controller-epoch-transition-reseed` at SdkController.ts:3752 or
`followup-on-follow-up-abandoned` at SdkController.ts:1426) AND
that writer fired under its intended precondition (legitimate
epoch transition or legitimately abandoned follow-up
respectively), would be a UI presentation gap, NOT a writer
defect. Both writer contracts are correct IN ISOLATION; the
"UI presentation gap" claim is CONDITIONAL on the LIVE bind
confirming writer identity AND triggering context.

This ACT has not yet recorded the LIVE bind. The synthetic-real
test added in this cycle proves only the TSWPD discriminator
CAPABILITY against the candidate union. LIVE verdict is
DEFERRED to the operator's TSWPD capture cycle; until then this
report makes no LIVE verdict.

================================================================
1. ENTRY FACTS (FROZEN, FROM entry-freeze.txt)
================================================================

  HEAD                     = 71a56613a136fdb29d05f6f8e92c85ed74519ea1
  ORIGIN_MAIN              = 71a56613a136fdb29d05f6f8e92c85ed74519ea1
  BRANCH                   = main
  WORKTREE_STATUS          = clean
  STASHES                  = none
  INSTALLED_ARTIFACT       = CORRECTION06 lineage
  BOUND_SPECIMEN           = task 1788213818870_vmswf
  CAPTURE                  = REAL + LIVE + SAME_PUBLICATION
  TASKHEADER_PROJECTION    = LIVE-QUALIFIED (CORRECTION06)

================================================================
2. THE COMPLETE IDLE-WRITER SURFACE (FROM writer-inventory.md)
================================================================

Five writers in HEAD produce `phase="idle"`:

  1. task-control-idle-fallback
     sdk-task-control-coordinator.ts:290
     context: showTaskWithId history reopen (no resume ask)

  2. controller-clear-task
     SdkController.ts:2851
     context: User clicks "New Task" / initTask calls clearTask

  3. controller-restore-checkpoint
     SdkController.ts:3220
     context: explicit checkpoint restore

  4. controller-epoch-transition-reseed     [CANDIDATE A]
     SdkController.ts:3752
     context: every epoch transition boundary

  5. followup-on-follow-up-abandoned        [CANDIDATE B]
     SdkController.ts:1426
     context: pre-set streaming phase abandoned

LIVE-specimen narrowing eliminates 1, 2, 3 as structurally
incompatible with "same-task foreground turn mid-execution while
backgroundCommandRunning=true".

================================================================
3. THE FIRST_IDLE_WRITER (synthetic-real discriminator — LIVE deferred)
================================================================

The synthetic-real test at
`apps/vscode/src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts`
proves the TSWPD discriminator CAPABILITY against the two viable
candidates:

  ```
  test("P0-SOURCE: ...")                                                       PASS
  test("BHTD01.1: synthetic-real epoch-reseed path ...")                        PASS
  test("BHTD01.2: synthetic-real followup-on-follow-up-abandoned ...")          PASS
  test("BHTD01.3: synthetic candidate schedule ...")                            PASS
  test("BHTD01.4: three filtered-out writers ...")                              PASS
  test("BHTD01.5: JSONL dump is operator-grade ...")                            PASS

  Tests  6 passed (6)
  ```

Discriminator results (deterministic, runnable, SYNTHETIC):

  SCENARIO A — synthetic epoch-reseed path
    identified writerId = controller-epoch-transition-reseed
    previous.phase      = streaming
    committed.phase     = idle

  SCENARIO B — synthetic followup-abandoned path
    identified writerId = followup-on-follow-up-abandoned
    previous.phase      = streaming
    committed.phase     = idle

**LIVE_FIRST_IDLE_WRITER is UNBOUND.** Per the Factory
reviewer's P0_1 verdict, the synthetic-real test proves the
discriminator works but does NOT bind the LIVE specimen's
actual writer. The LIVE bind requires a one-cycle operator
TSWPD capture on the live recurrence.


================================================================
4. ADJUDICATION (FROM adjudication.md) — LIVE verdict DEFERRED
================================================================

The adjudication section derives CASE_A on **contract semantics**
alone. It does NOT bind the LIVE specimen's actual writer or its
LIVE triggering context. The verdict is therefore expressed as
per-candidate conditionals, not as a LIVE verdict.

  IDLE_WRITER_UNION                 = STRUCTURAL / PROVEN
  CANDIDATES_AFTER_NARROWING        = TWO
  TSWPD_DISCRIMINATOR_CAPABILITY    = PROVEN / SYNTHETIC_REAL
  CANDIDATE_A_WRITE_IDENTITY        = controller-epoch-transition-
                                       reseed (synthetic-real)
  CANDIDATE_B_WRITE_IDENTITY        = followup-on-follow-up-abandoned
                                       (synthetic-real)
  LIVE_FIRST_IDLE_WRITER            = UNBOUND
  ROOT_CAUSE_ISOLATED (LIVE)        = NO
  CLASSIFICATION (LIVE)             = DEFERRED  (→ LIVE_BIND_GATED)

  PER-CANDIDATE CONDITIONAL VERDICTS (contract-only):
    IF writer = controller-epoch-transition-reseed AND it fired
       under a legitimate epoch transition
       → CASE_A / NOT_A_RUNTIME_DEFECT.
    IF writer = followup-on-follow-up-abandoned AND it fired
       under a legitimately abandoned follow-up
       → CASE_A / NOT_A_RUNTIME_DEFECT.

  CROSS-CUTTING (true regardless of which candidate fires):
    PRODUCTION_REPAIR                = NOT_AUTHORIZED
    UX_STATUS_SEMANTICS_CHILD_ACT    = NOT_YET_AUTHORIZED
                                       (gated on the LIVE bind)

The visible contradiction (TaskHeader "Idle" while a background
job is alive) is therefore a UI presentation gap, NOT a writer
defect — but only conditional on the LIVE bind confirming
either candidate's legitimacy at the LIVE moment.

================================================================
5. CONSERVATION MATRIX (PRESERVED)
================================================================

  short foreground command → normal completion       ✓ UNTOUCHED
  non-zero foreground command                       ✓ UNTOUCHED
  background handoff                                ✓ UNTOUCHED
  background job completion                         ✓ UNTOUCHED
  multiple background jobs                          ✓ UNTOUCHED
  task cancellation                                 ✓ UNTOUCHED
  new user message while background job runs        ✓ UNTOUCHED
  history reopen                                    ✓ UNTOUCHED
  task switch                                       ✓ UNTOUCHED
  TaskHeader coherence CORRECTION06                 ✓ UNTOUCHED
  R5 / R0 (Seatbelt sandbox authority)              ✓ UNTOUCHED

No production code change in this ACT. One test added
(synthetic-real, honestly relabeled per Factory reviewer's P0_2):
  - apps/vscode/src/sdk/__tests__/background-handoff-turnstate-
    discriminator.bhtd01-synthetic-real.test.ts (6 tests, all PASS)
  - exercises real TurnStateTracker + real MessageIdMinter +
    real TSWPD singleton ring + source-extracted production
    statements + synthetic orchestration; explicitly NOT a
    real production-seam test.
No test-suite ablation. The conservation matrix is verified by
the fact that the diff for this ACT contains ONLY:
  - .factory/acts/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-
    DISCRIMINATOR01.md (this ACT's design doc)
  - .factory/evidence/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-
    DISCRIMINATOR01/* (this ACT's evidence)
  - apps/vscode/src/sdk/__tests__/background-handoff-turnstate-
    discriminator.bhtd01-synthetic-real.test.ts (synthetic-real
    discriminator test, no production code touched)
  - updates to .factory/epic-board.md (board row update)
  - updates to .factory/acts/ACT-CLINEMM-BACKGROUND-COMMAND-
    TURNSTATE-LIVENESS-RECON01.md (predecessor closure)

NO file under apps/vscode/src/ PRODUCTION CODE is touched.

The only apps/vscode/src/ addition is the synthetic-real test
file at apps/vscode/src/sdk/__tests__/background-handoff-
turnstate-discriminator.bhtd01-synthetic-real.test.ts. It:
  - reads production source (read-only, drift witness)
  - does NOT mutate production source
  - does NOT instantiate production SdkController
  - uses synthetic orchestration
  - exercises the real TurnStateTracker, MessageIdMinter, and
    TSWPD ring

This is honestly classified as SYNTHETIC_REAL, NOT REAL_
PRODUCTION_SEAM, per the Factory reviewer's P0_2 verdict.


================================================================
6. BOARD UPDATE
================================================================

The runtime-task-progression epic board row will be updated
with:

  ACT                                = ACT-CLINEMM-BACKGROUND-
                                       HANDOFF-TURNSTATE-
                                       DISCRIMINATOR01
  FIRST_IDLE_WRITER (LIVE)           = UNBOUND
  FIRST_IDLE_WRITER (synthetic)      = controller-epoch-transition-
                                       reseed OR followup-on-follow-
                                       up-abandoned (synthetic-real
                                       discriminator PASS)
  TSWPD_DISCRIMINATOR_CAPABILITY     = PROVEN
  VERDICT                            = HALT_LIVE_FIRST_IDLE_WRITER_
                                       STILL_UNBOUND
  ROOT_CAUSE_ISOLATED                = NO  (LIVE writer still unbinded)
  CLASSIFICATION                     = DEFERRED (pending operator TSWPD
                                              capture on live recurrence)
  PRODUCTION_REPAIR                  = NOT_AUTHORIZED
  UX_STATUS_SEMANTICS_CHILD_ACT      = NOT YET AUTHORIZED

The predecessor recon ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-
LIVENESS-RECON01 cannot close on this ACT's adjudication; it can
only close after the LIVE bind is recorded by the operator.

================================================================
7. THE OPEN FOLLOW-UP (NOT IN THIS ACT'S SCOPE)
================================================================

A future UX child ACT is NOT YET AUTHORIZED (because the LIVE
bind has not yet been recorded). It will only become authorized
after the LIVE bind proves one of:

  - LIVE writer = controller-epoch-transition-reseed under a
    legitimate epoch boundary → CASE_A / NOT_A_RUNTIME_DEFECT,
    then UX child ACT may be AUTHORIZED to surface active
    background jobs without lying about TurnState.
  - LIVE writer = followup-on-follow-up-abandoned under a
    legitimately abandoned follow-up → CASE_A / NOT_A_RUNTIME_
    DEFECT, then UX child ACT may be AUTHORIZED.

If the LIVE bind reveals a third writer or an illegitimate
guard firing, the UX child ACT is FORBIDDEN until the
progression bug is fixed.

Proposed (still proposed) UX child ACT scope:
  - apps/vscode/webview-ui/src/components/chat/task-header/
    (TaskHeaderTelemetry, buttonConfig, stateLabel)
  - Optional new component that reads backgroundCommandRunning
    independently of turnState.phase.

Strict prohibitions on the (proposed) child ACT:
  - DO NOT mutate TurnState for presentation convenience.
  - DO NOT change TaskHeader == turnState projection coherence
    (CORRECTION06 invariant).
  - DO NOT add a "background exists therefore task active"
    invariant.
  - DO NOT mutate any setWithWriter call.
  - DO NOT mutate updateBackgroundCommandState.
  - DO NOT mutate resetMessageTranslatorAndFence.

These prohibitions are identical to the predecessor ACT's
"Forbidden" list, tightened slightly to make explicit that
the child ACT must not undo the architecture proven by this
ACT.

================================================================
8. FINAL DISPOSITION
================================================================

  IDLE_WRITER_UNION                       = STRUCTURAL / PROVEN
  CANDIDATES_AFTER_NARROWING              = TWO
  TSWPD_DISCRIMINATOR_CAPABILITY          = PROVEN (synthetic-real PASS)
  CANDIDATE_A_WRITE_IDENTITY              = controller-epoch-transition-
                                            reseed (synthetic)
  CANDIDATE_B_WRITE_IDENTITY              = followup-on-follow-up-abandoned
                                            (synthetic)
  LIVE_FIRST_IDLE_WRITER                  = UNBOUND
  ROOT_CAUSE_ISOLATED                     = NO
  CLASSIFICATION                          = DEFERRED
  PRODUCTION_REPAIR                       = NOT_AUTHORIZED
  UX_STATUS_SEMANTICS_ACT                 = NOT YET AUTHORIZED
  FINAL                                   = HALT_LIVE_FIRST_IDLE_WRITER_
                                            STILL_UNBOUND

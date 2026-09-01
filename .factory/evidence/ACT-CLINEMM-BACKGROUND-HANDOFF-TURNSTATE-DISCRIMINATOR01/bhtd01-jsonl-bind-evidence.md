ACT_ID    = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
SECTION   = TSWPD SYNTHETIC-REAL DISCRIMINATOR LOG
SUBJECT   = HEAD 71a56613a136fdb29d05f6f8e92c85ed74519ea1 (= origin/main)
DATE      = 2026-09-01

This file records the SYNTHETIC_REAL evidence produced by
`apps/vscode/src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts`.

Honest classification (per Factory reviewer's P0_2 verdict):

  WHAT THIS EVIDENCE PROVES
    - the TSWPD dump-and-parse chain works end-to-end
    - the JSONL filter for "first record with
      committed.phase == 'idle' && previous.phase != 'idle'"
      correctly identifies the writerId that was stamped by
      each candidate's `setWithWriter("idle", ...)` call
    - the production writer lines (extracted as drift witnesses
      from SdkController.ts at HEAD) are present and runnable
    - the structural narrowing to two candidates holds

  WHAT THIS EVIDENCE DOES NOT PROVE
    - which writer ACTUALLY fired in the LIVE recurrence
    - whether the LIVE writer's guard/precondition was
      legitimately satisfied at the LIVE moment
    - any claim about production control flow (the test harness
      is synthetic, not the SdkController)

The LIVE bind remains UNBOUND until an operator runs the
TSWPD capture cycle on the live recurrence.

================================================================
0. TEST COMMAND + RESULT
================================================================

  $ cd apps/vscode
  $ PATH=/opt/homebrew/bin:$PATH bun x vitest run \
      --config vitest.config.ts \
      src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts

  ✓ ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01 / TSWPD synthetic-real discriminator
    > P0-SOURCE: every candidate idle-writer line exists at HEAD ........... 5ms
  ✓ ... > BHTD01.1: synthetic-real epoch-reseed path identifies writerId=controller-epoch-transition-reseed ... 4ms
  ✓ ... > BHTD01.2: synthetic-real followup-on-follow-up-abandoned path identifies writerId=followup-on-follow-up-abandoned ... 1ms
  ✓ ... > BHTD01.3: synthetic candidate schedule — both writers driven in synthetic orchestration; JSONL binds each deterministically ... 2ms
  ✓ ... > BHTD01.4: three filtered-out writers are structurally incompatible with the LIVE narrowing ... 1ms
  ✓ ... > BHTD01.5: JSONL dump is operator-grade reproducible evidence ... 2ms

  Test Files  1 passed (1)
       Tests  6 passed (6)

================================================================
1. WHAT THE TEST BINDS (per the reviewer's Required Action)
================================================================

Reviewer's protocol (verbatim, condensed):

  1. Enable: cline.debug.toggleTurnStateWriterProvenanceDiagnostic
  2. Reproduce the bounded background handoff.
  3. Dump: cline.debug.dumpTurnStateWriterProvenanceDiagnostic
  4. Filter: first record where committed.phase == "idle"
                              AND previous.phase != "idle"
  5. Bind: FIRST_IDLE_WRITER + seq + previous.phase

The test exercises this exact protocol by:

  Step 1: enableTurnStateWriterProvenanceDiagnostic() — flips the
          singleton diagnostic ring ON.
  Step 2: drive the production writer code against a real
          TurnStateTracker (real MessageIdMinter shimmed for the
          resetMessageTranslatorAndFence body extraction).
  Step 3: dumpExtensionSideTurnStateWriterProvenanceDiagnostic(ctx)
          — writes the JSONL to a project-local temp directory
          (mirrors the production globalStorageUri contract).
  Step 4: read JSONL, parse each line as TurnStateWriterProvenanceRecord,
          find the first record with
          committed.phase == "idle" AND previous.phase != "idle".
  Step 5: assert writerId, previous.phase, committed.phase, seq advance,
          epoch identity.

================================================================
2. BOUND RESULTS
================================================================

SCENARIO A — epoch-reseed path (BHTD01.1 + BHTD01.3 + BHTD01.5):

  ```
  FIRST_IDLE_WRITER                = controller-epoch-transition-reseed
  previous.phase                   = streaming
  previous.seq                     = N     (initial streaming write)
  committed.phase                  = idle
  committed.seq                    = N+1   (advanced by MessageIdMinter)
  committed.anchorTs               = undefined
  previous.anchorTs                = undefined
  capturedAt                       = Date.now()
  epoch                            = MessageIdMinter.epoch
  taskId                           = undefined  (SdkController stamps
                                                this from the active
                                                session id; the test
                                                harness doesn't have
                                                an active session)
  writer contract                  = resetMessageTranslatorAndFence()
                                     (the production body — source-
                                      extracted from SdkController.ts
                                      at HEAD)
  ```

SCENARIO B — followup-on-follow-up-abandoned path
(BHTD01.2 + BHTD01.3 + BHTD01.5):

  ```
  FIRST_IDLE_WRITER                = followup-on-follow-up-abandoned
  previous.phase                   = streaming
  committed.phase                  = idle
  committed.seq                    = N+1   (advanced by MessageIdMinter)
  contract                         = onFollowUpAbandoned callback line
                                     (extracted from SdkController.ts:1426)
  guard verified                   = tracker.currentPhase === "streaming"
                                     (the production guard pre-condition)
  ```

================================================================
3. SOURCE DRIFT WITNESSES (P0-SOURCE test)
================================================================

The P0-SOURCE test pins the exact production lines at HEAD. If
any of them moves, is renamed, or is removed, the test fails to
assert and the ACT's bind claim becomes invalid. As of HEAD
71a56613:

  - SdkController.ts:1426:
    `this.turnStateTracker.setWithWriter("idle", undefined, this.writerIdentity("followup-on-follow-up-abandoned"))`
  - SdkController.ts:2851:
    `this.turnStateTracker.setWithWriter("idle", undefined, this.writerIdentity("controller-clear-task"))`
  - SdkController.ts:3220:
    `this.turnStateTracker.setWithWriter("idle", undefined, this.writerIdentity("controller-restore-checkpoint"))`
  - SdkController.ts:3752:
    `this.turnStateTracker.setWithWriter("idle", undefined, this.writerIdentity("controller-epoch-transition-reseed"))`
  - sdk-task-control-coordinator.ts:290:
    `this.options.setTurnPhase("idle", undefined, "task-control-idle-fallback")`

================================================================
4. STRUCTURAL NARROWING (BHTD01.4)
================================================================

The three writers eliminated as structurally incompatible with a
foreground→background-handoff mid-turn observation:

  - task-control-idle-fallback: lives in showTaskWithId (history
    reopen only; not reachable from a foreground turn mid-execution).
  - controller-clear-task: lives in clearTask (aborts the background
    command via cancelBackgroundCommand; backgroundCommandRunning
    cannot co-exist with a successful clearTask).
  - controller-restore-checkpoint: lives in restoreCheckpoint
    (explicit user action, not a tool-handoff outcome).

================================================================
5. SECOND-ORDER ADJUDICATION (CONTRACT-ONLY — LIVE DEFERRED)
================================================================

Per the reviewer's Required Action, after binding the LIVE
writer we must answer the second-order legitimacy question. This
section answers the *contract* question only; the LIVE
legitimacy question is deferred to the operator.

> If writer = controller-epoch-transition-reseed
>   prove the corresponding epoch transition was expected for that
>   exact turn.

  CONTRACT ANSWER: the production comment at SdkController.ts:
  3734-3747 cites the historical PTAD stale legacySeq=3878 case
  (taskId=1787358662798_o2lwn) as the motivating witness. The
  contract IS to zero the legacy tracker to "idle" before any
  conversation starts. The background job owns its lifetime
  independently. The writer's contract is correct: when a real
  epoch boundary occurs during a foreground turn (e.g., the
  model emits a final token and the followup-coordinator fires,
  or a follow-up resume cycle replaces the active session), the
  legacy tracker resets to idle and the background job remains
  alive under CommandJobManager. Both are intended.

  LIVE LEGITIMACY (DEFERRED): "the epoch transition was expected
  for that exact LIVE turn" requires the operator to observe the
  ACTUAL epoch transition in the LIVE write (via TSWPD capture)
  and confirm it matches a legitimate trigger (model final token,
  followup-coordinator cycle, follow-up resume, etc.). Without
  the LIVE bind, this question is unanswerable.

> If writer = followup-on-follow-up-abandoned
>   prove its guard really described the live situation rather
>   than firing spuriously.

  CONTRACT ANSWER: the production guard at SdkController.ts:1425
  reads:
    if (this.turnStateTracker.currentPhase === "streaming" &&
        !this.sessions.getActiveSession()?.isRunning) {
      this.turnStateTracker.setWithWriter("idle", undefined,
        this.writerIdentity("followup-on-follow-up-abandoned"))
    }
  Both preconditions must be true for the writer to fire:
    (a) tracker is in "streaming" phase (ask-response pre-set a
        streaming phase for an upcoming turn), AND
    (b) no active session is running (the follow-up didn't start
        a real turn).
  The guard is structurally correct for the case it is intended
  to handle.

  LIVE LEGITIMACY (DEFERRED): "the guard really described the
  LIVE situation" requires the operator to observe whether the
  LIVE turn actually abandoned a follow-up (rather than merely
  completing a turn that happened to not start a new session).
  Without the LIVE bind, this question is unanswerable.

================================================================
6. CONCLUSION
================================================================

  TSWPD_DISCRIMINATOR_CAPABILITY  = PROVEN (synthetic-real test)
  CANDIDATE_A_WRITE_IDENTITY      = controller-epoch-transition-reseed
                                     (synthetic-real bind)
  CANDIDATE_B_WRITE_IDENTITY      = followup-on-follow-up-abandoned
                                     (synthetic-real bind)
  LIVE_FIRST_IDLE_WRITER          = UNBOUND
  ROOT_CAUSE_ISOLATED             = NO  (LIVE writer still unbinded)
  CLASSIFICATION                  = DEFERRED (pending operator TSWPD
                                          capture on live recurrence)
  PRODUCTION_REPAIR               = NOT_AUTHORIZED
  UX_STATUS_SEMANTICS_ACT         = NOT YET AUTHORIZED

The case is NOT closed. The LIVE bind requires a one-cycle
operator TSWPD capture (no new test, no new ACT, no new
instrumentation). This ACT supplies the machinery; only the
operator can supply the LIVE bind.

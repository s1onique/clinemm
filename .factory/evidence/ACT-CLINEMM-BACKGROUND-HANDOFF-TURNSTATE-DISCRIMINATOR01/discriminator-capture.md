ACT_ID    = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
SECTION   = PHASE 4 / DISCRIMINATOR CAPTURE
SUBJECT   = HEAD 71a56613a136fdb29d05f6f8e92c85ed74519ea1 (= origin/main)
DATE      = 2026-09-01

THIS FILE RECORDS THE OPERATIONAL CAPTURE PLAN AND THE EXPECTED BINDING.

================================================================
0. PRECONDITION: TSWPD CAPABILITY IS SUFFICIENT
================================================================

Per PHASE 3 (entry freeze) the existing TSWPD / `tswpdEnabled` already exposes
the fields required by PHASE 5:

  writerId           = TurnStateWriterId (closed union)
  taskId             = optional, stamped at the SdkController wrapper
  epoch              = optional, stamped at the SdkController wrapper
  previous.phase     = the phase that was overwritten
  previous.seq       = the seq that was overwritten
  previous.anchorTs  = the anchor ts that was overwritten
  requested.phase    = the phase the writer asked for
  requested.anchorTs = the anchor ts the writer asked for
  committed.phase    = the post-mint phase (== requested.phase)
  committed.seq      = the post-mint seq from MessageIdMinter
  committed.anchorTs = the post-mint anchor ts
  capturedAt         = Date.now() at the mutation site

(See `apps/vscode/src/shared/turn-state-writer-provenance.ts:130-153`
 for the exact record shape, and
 `apps/vscode/src/sdk/turn-state-tracker.ts:105-124` for the call site
 that constructs the record inside `setWithWriter`.)

REQUIRED-FIELD COVERAGE TABLE:
  ┌──────────────────────────────┬──────────────────────────────┐
  │ PHASE 5 REQUIREMENT          │ TSWPD FIELD                  │
  ├──────────────────────────────┼──────────────────────────────┤
  │ taskId                       │ record.taskId                │
  │ epoch                        │ record.epoch                 │
  │ turnState.seq                │ record.committed.seq         │
  │ oldPhase                     │ record.previous.phase        │
  │ newPhase                     │ record.committed.phase       │
  │ writer / reason / event      │ record.writerId              │
  │ timestamp / order identity   │ record.capturedAt            │
  └──────────────────────────────┴──────────────────────────────┘

VERDICT: ALL required fields are present. TSWPD is MECHANICALLY SUFFICIENT.

  DISCRIMINATOR_CAPABILITY_INSUFFICIENT = NO
                              (TSWPD has sufficient fields to
                               bind every idle write to
                               (writerId, taskId, epoch,
                                previous.seq, committed.seq))
  NO_NEW_DISCRIMINATOR_REQUIRED.

Note: DISCRIMINATOR_CAPABILITY_INSUFFICIENT (NO) refers to the
TSWPD field set. It is DISTINCT from the LIVE capture state,
which is reported below as CAPTURE_INSUFFICIENT (LIVE) = YES
(see §3, §5, §6).

================================================================
1. OPERATIONAL CAPTURE COMMAND SURFACE
================================================================

The TSWPD toggle is exposed as a Command Palette command:

    cline.debug.toggleTurnStateWriterProvenanceDiagnostic

The dump is:

    cline.debug.dumpTurnStateWriterProvenanceDiagnostic

(See `apps/vscode/src/registry.ts:47-48` and
 `apps/vscode/src/extension.ts:576-596`.)

The dump writes to:
    <globalStorageUri>/turn-state-writer-provenance.jsonl
(See `apps/vscode/src/sdk/turn-state-writer-provenance-runtime.ts:52,
 129-138`.)

The toggle is OFF by default; the workspace-state key is
    "tswpdEnabled"
(See `apps/vscode/src/sdk/turn-state-writer-provenance-runtime.ts:50`.)


================================================================
2. OPERATIONAL CAPTURE PLAN (per ACT §4)
================================================================

Prerequisite:
  - Dogfood extension built from CORRECTION06 lineage (already
    deployed at the operator's dogfood clone per
    `entry-freeze.txt:INSTALLED_ARTIFACT`).
  - The dogfood instance has the TSWPD toggle command available
    via the command palette.
  - The operator's LIVE-bound reproduction is reproducible by:
    1. Open a task in the dogfood instance.
    2. Type a chat prompt that asks the agent to run a long-running
       command in the background (e.g. "start the dev server with
       `npm run dev` in the background and let me know when it's up").
    3. The model calls run_commands with the command; the SDK
       detects background execution mode (backgroundExec), starts
       the job in CommandJobManager, and the tool returns
       RUNNING(jobId) once the wait budget expires.
    4. The model emits a final text/streaming token (the "I've
       started it in the background" message) and the turn ends
       naturally.

Capture sequence:
  Step 1. Enable TSWPD:
            Execute `cline.debug.toggleTurnStateWriterProvenanceDiagnostic`.
            The workspace-state key `tswpdEnabled` flips to `true`.
            Subsequent TurnStateTracker.setWithWriter calls append
            one provenance record per mutation.
  Step 2. Run the bounded recurrence above.
  Step 3. The dogfood instance produces a stream of
            postStateToWebview publications; observe via the debug
            harness that:
              a. backgroundCommandRunning flips true at some
                 publication N1 (jobId stamped).
              b. foregroundCommandRunning stays false throughout.
              c. turnPhase and taskHeaderPhase progress through:
                 streaming → ... → [first idle here at publication N2]
  Step 4. Dump:
            Execute `cline.debug.dumpTurnStateWriterProvenanceDiagnostic`.
            The bounded ring is flushed to
            <globalStorageUri>/turn-state-writer-provenance.jsonl.
  Step 5. Extract from the JSONL:
            Filter records by `taskId == <operator-task-id>` AND
            `epoch == <captured-epoch>`. Find the first record with
            `committed.phase == "idle"` and
            `previous.phase != "idle"` (skip no-op writes that
            re-assert the same phase).
            That record's writerId is the FIRST_IDLE_WRITER.
            Its capturedAt is the FIRST_IDLE_TIMESTAMP.
            Its committed.seq is the FIRST_IDLE_SEQ.
  Step 6. Cross-check by walking the JSONL forwards from
            `previous.phase == "streaming"` and backwards from
            `committed.phase == "idle"`; the sequence must be
            uninterrupted (i.e., no `setWithWriter` call between
            them that did not appear in the JSONL — TSWPD records
            EVERY call when enabled, so this is a structural
            property).


================================================================
3. EXPECTED BOUND WRITER (SOURCE-TRUTH INFERENCE)
================================================================

Without an on-the-day LIVE TSWPD capture this ACT cannot bind
which of the two viable candidates (epoch-reseed or
followup-abandoned) is the actual writer for task 1788213818870_
vmswf, nor confirm its LIVE triggering context. The
synthetic-real test proves only the TSWPD discriminator CAPABILITY
against both candidates; it does NOT record the LIVE bind.

The source-truth inference is unambiguous on the union and the
projection seam, but the LIVE verdict remains DEFERRED until the
operator captures the LIVE TSWPD JSONL:

  TSWPD-CAPABLE               = YES
  IDLE-WRITERS ENUMERATED     = YES (5 in HEAD, 3 structurally
                                viable, 2 realistically viable)
  UPDATEBACKGROUNDCOMMANDSTATE
    WRITES TURNSTATE          = NO (proven by direct read of
                                SdkController.ts:3686-3698 — no
                                setWithWriter call anywhere in
                                the projection-only seam)
  LIVE_FIRST_IDLE_WRITER      = UNBOUND  (operator TSWPD cycle
                                          required to bind)

The PER-CANDIDATE CONTRACT VERDICT (CASE_A) is robust against
which of the two candidates is the actual writer — IF the
candidate fires under its intended precondition. BOTH
`controller-epoch-transition-reseed` AND
`followup-on-follow-up-abandoned` exist precisely to settle stale
streaming-phase writes when the prior turn has been abandoned or
rebuilt. Neither is a background-job-driven mutation.
The background-job-lifetime is intentionally decoupled from
foreground-turn-lifetime by upstream Cline's design (see
sdk/examples/plugins/background-terminal.ts in the upstream repo,
referenced from the predecessor recon).

However: contract correctness in isolation is NOT a LIVE verdict.
The conditional holds only IF the LIVE writer's triggering
context matches its intended precondition. A LIVE bind that
reveals an illegitimate triggering context (e.g., a spurious
epoch transition or a misfired follow-up-abandoned guard) would
re-open the case as ROOT_CAUSE_ISOLATED. The LIVE verdict is
therefore DEFERRED, not CASE_A.

Therefore:

  IDLE_WRITER_UNION                  = STRUCTURAL / PROVEN
                                       (writer identity narrowing
                                        exhausted all options;
                                        two candidates both
                                        contract-correct)
  CANDIDATES_AFTER_NARROWING         = TWO
  TSWPD_DISCRIMINATOR_CAPABILITY     = PROVEN  (synthetic-real test)
  LIVE_FIRST_IDLE_WRITER             = UNBOUND  (operator cycle required)
  ROOT_CAUSE_ISOLATED (LIVE)         = NO
  CLASSIFICATION (LIVE)              = DEFERRED  (→ LIVE_BIND_GATED)
  PER-CANDIDATE CONTRACT VERDICT     = CONDITIONAL_CASE_A
  PRODUCTION_REPAIR                  = NOT_AUTHORIZED
  UX_STATUS_SEMANTICS_CHILD_ACT      = NOT_YET_AUTHORIZED
  CAPTURE_INSUFFICIENT (LIVE)        = YES  (live writer unbinded;
                                              operator TSWPD capture
                                              cycle is the gate)
  RED_REQUIRED                       = GATED ON LIVE_BIND
                                       (no production repair
                                        regardless of which
                                        candidate fires, but a
                                        repair would be authorized
                                        if the LIVE bind reveals
                                        an illegitimate triggering
                                        context)


================================================================
4. THE TWO BOUND WRITERS — CONTRACT SEMANTICS
================================================================

4.1 controller-epoch-transition-reseed
  CALL SITE: SdkController.ts:3752
    inside resetMessageTranslatorAndFence() (line 3749)

  CALLERS OF resetMessageTranslatorAndFence (verified by grep):
    - SdkController.ts:1318 (SdkModeCoordinator resetMessageTranslator)
    - SdkController.ts:1417 (SdkFollowupCoordinator resetMessageTranslator)
    - SdkController.ts:1468 (SdkTaskControlCoordinator resetMessageTranslator)
    - SdkController.ts:3110 (editMessageAndRegenerate path)
    - SdkController.ts:3222 (restore checkpoint path)
    - SdkController.ts:3749 (the function itself)

  CONTRACT: This writer exists to invalidate the legacy TurnStateTracker
  on every conversation boundary (task start/clear, history open, reinit,
  mode rebuild, new-session follow-up, restore checkpoint, edit-and-
  regenerate). The reseed intentionally writes "idle" with a dedicated
  writer identity so the post-boundary tracker phase agrees with the
  canonical state. The JSDoc at SdkController.ts:3734-3747 makes the
  intent explicit AND cites the historical LIVE contradiction
  (taskId=1787358662798_o2lwn, PTAD stale legacySeq=3878, writerId=
  controller-ask-response, writerEpoch=2, bad_state_epoch=3) as the
  motivating witness.

  WHY THIS IS CONTRACT-CORRECT: the writer's contract IS to zero the
  legacy tracker to "idle" before the next conversation starts. The
  background job owns its lifetime independently of the legacy
  TurnStateTracker. Therefore backgroundCommandRunning=true coexisting
  with turnPhase=idle is INTENTIONAL after an epoch transition; the
  UI is the layer that must surface the background job separately.

4.2 followup-on-follow-up-abandoned
  CALL SITE: SdkController.ts:1426
    inside the onFollowUpAbandoned callback wired to
    SdkFollowupCoordinator

  PRECONDITION GUARD (line 1425):
    if (this.turnStateTracker.currentPhase === "streaming" &&
        !this.sessions.getActiveSession()?.isRunning) {
      this.turnStateTracker.setWithWriter("idle", undefined, ...)
    }

  CONTRACT: This writer exists precisely to settle a pre-set streaming
  phase for a follow-up that started no turn. The JSDoc at lines
  1422-1427 makes the intent explicit ("Settle the streaming phase
  askResponse pre-set, unless a turn has actually started").

  WHY THIS IS CONTRACT-CORRECT: the writer's contract IS to clear a
  stale streaming phase when a follow-up never produced a real turn.
  The background job is unrelated to this path; the coincidence of
  backgroundCommandRunning=true coexisting with this writer firing
  means a follow-up was abandoned while a background job happened
  to be alive. The UI is the layer that must surface the background
  job separately.


================================================================
5. THE LIVE BIND REQUIRES A FRESH OPERATOR TSWPD CYCLE (GATING)
================================================================

The live-bound specimen (task 1788213818870_vmswf) is preserved in
the operator's dogfood clone. The LIVE bind is NOT YET RECORDED;
the operator's TSWPD capture cycle is the gating step for the
LIVE verdict:

  (a) Enable TSWPD on the dogfood clone.
  (b) Trigger a bounded reproduction of the same recurrence that
      produced the original LIVE capture (background handoff via
      run_commands).
  (c) Dump the JSONL.
  (d) Bind the FIRST_IDLE_WRITER by record scan.
  (e) Confirm the LIVE writer's triggering context matches its
      intended precondition.

This ACT's responsibility is to:
  - Enumerate the COMPLETE union of idle-writers (DONE — 5 writers,
    2 viable candidates).
  - Confirm TSWPD is sufficient (DONE — all required fields present).
  - Specify the operational capture protocol (DONE — this file).
  - Prove the TSWPD discriminator CAPABILITY (DONE — synthetic-real
    test PASS for both candidates).
  - Adjudicate the PER-CANDIDATE CONTRACT VERDICT (DONE — both
    candidates map to CASE_A on contract semantics, conditional on
    the LIVE triggering context).

The LIVE verdict is DEFERRED until the operator's TSWPD capture
cycle records the actual LIVE writer and its triggering context.
The fresh capture is not merely vendor-level confirmation — it is
a GATING step for:

  - ROOT_CAUSE_ISOLATED (LIVE) = YES | NO
  - CLASSIFICATION (LIVE) = CASE_A | CASE_B/C/D/E
  - UX_STATUS_SEMANTICS_CHILD_ACT = AUTHORIZED | FORBIDDEN

If the LIVE bind reveals an illegitimate triggering context
(e.g., a spurious epoch transition or a misfired follow-up-
abandoned guard), the case re-opens as ROOT_CAUSE_ISOLATED
under CASE_B/C/D/E and a bounded progression repair ACT becomes
authorized. The fresh capture therefore determines the LIVE
verdict, not just confirms it.

================================================================
6. WITHOUT A FRESH CAPTURE — STATE OF THE ACT
================================================================

Without a fresh operator TSWPD capture, the ACT remains DEFERRED.
The contract-correctness claim and the LIVE verdict are NOT the
same assertion:

  1. The closed union of idle writers is fully enumerated and verified.
  2. updateBackgroundCommandState is structurally forbidden from
     writing TurnState (verified by direct read).
  3. BOTH viable idle-writers are contract-correct on the contract
     semantics: their contracts do not refer to background jobs;
     they exist to settle stale turn-side phase writes; the
     background job is independently supervised.
  4. The visible contradiction is therefore NOT a writer defect
     but a presentation gap — the TaskHeader `Idle` label is the
     visible symptom; the underlying turn-state is intentional
     under its intended precondition.
  5. The UI layer must surface the background job's existence
     separately, NOT by mutating TurnState.

These are the contract-semantic conclusions. They DO NOT
constitute a LIVE verdict because:

  - The LIVE specimen's actual writer is UNBOUND.
  - The LIVE specimen's actual triggering context is UNKNOWN
    (legitimate epoch transition? legitimate abandoned
    follow-up? something else?).
  - Contract correctness in isolation does not imply LIVE
    correctness — the LIVE verdict must also confirm the
    triggering context.

Therefore the LIVE verdict remains DEFERRED. A fresh operator
TSWPD capture is NOT merely desirable — it is REQUIRED to
graduate the per-candidate conditional CASE_A to a LIVE
verdict. Until that cycle runs:

  ROOT_CAUSE_ISOLATED (LIVE)         = NO
  CLASSIFICATION (LIVE)              = DEFERRED
  UX_STATUS_SEMANTICS_CHILD_ACT      = NOT_YET_AUTHORIZED

The fresh capture is the only missing evidence; everything
else in this ACT is already in hand.

================================================================
7. CONSERVATION
================================================================

NO PRODUCTION CODE CHANGE EXPECTED in this ACT or its successors.

If a UX child ACT is opened to surface the background job separately,
the production code it would touch is:

  - apps/vscode/webview-ui/src/components/chat/task-header/*
    (presentation only — TaskHeaderTelemetry, buttonConfig,
     stateLabel)
  - Optionally a new flag on `backgroundCommandRunning` already
    exposed in ExtensionState (no new field needed).

NO `TurnState` mutation. NO `updateBackgroundCommandState` change.
NO `resetMessageTranslatorAndFence` change. NO `setWithWriter` change.
NO `TaskHeader` projection change (CORRECTION06 invariant preserved).





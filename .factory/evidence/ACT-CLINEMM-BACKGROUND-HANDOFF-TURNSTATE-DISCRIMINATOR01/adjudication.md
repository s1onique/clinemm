ACT_ID    = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
SECTION   = PHASE 6 / ADJUDICATION (idle vs awaiting_followup)
SUBJECT   = HEAD 71a56613a136fdb29d05f6f8e92c85ed74519ea1 (= origin/main)
DATE      = 2026-09-01

This file answers ACT §6 Q1..Q8 for both viable idle writers, then
delivers the DECISION per ACT §7.

================================================================
Q1. WHAT DOES THIS WRITER BELIEVE HAS JUST HAPPENED?
================================================================

For BOTH viable writers the answer is identical in structure:
"the prior conversation boundary has been crossed; the legacy
tracker should not carry a stale phase forward into the new
conversation". The specific boundary differs (epoch reseed vs.
follow-up abandonment) but the contract is the same: the writer
is performing a TURN-SIDE RESET, not a background-job-aware
decision.


================================================================
Q2. DOES ITS CONTRACT DEFINE: foreground tool completed? full turn
    completed? follow-up abandoned? model stream ended? task cleared?
    context switched?
================================================================

  controller-epoch-transition-reseed (SdkController.ts:3752)
    - task cleared (initTask path calls clearTask)
    - context switched (history open, mode rebuild, follow-up resume,
      restore checkpoint, edit-and-regenerate all bump the epoch)
    - foreground tool completion: NO (this is not a tool-completion
      writer; the session-event-coordinator handles that via
      session-event-turn-complete-*)
    - full turn completed: NO (that would be session-event-turn-
      complete-completed or session-event-turn-complete-awaiting-
      followup, which write `completed` and `awaiting_followup`,
      respectively)
    - follow-up abandoned: NO (that is followup-on-follow-up-abandoned)

  followup-on-follow-up-abandoned (SdkController.ts:1426)
    - follow-up abandoned: YES (this is the dedicated writer)
    - context switched: indirectly (the displayed task changed
      under the follow-up, so the follow-up cannot continue; the
      writer settles the pre-set streaming phase)
    - foreground tool completion: NO
    - full turn completed: NO
    - task cleared: NO

Neither writer is a "the foreground run_commands RUNNING(jobId)
just returned" writer. Neither references CommandJobManager or
background state. Both are pure turn-side bookkeeping.


================================================================
Q3. AT THIS EXACT POINT, IS THE AGENT AWAITING ANY FUTURE
    CONTINUATION FROM THE BACKGROUND JOB?
================================================================

The two writers do NOT inspect CommandJobManager. Their contracts
make no assertion about whether the background job will continue,
will be cancelled, or will steer the session later.

What the contracts DO say is that the LEGACY TURN PHASE should be
zeroed to `idle` after the conversation boundary. The background
job's lifetime is owned by CommandJobManager independently. A
background job's eventual steer-back-into-the-session is documented
in upstream Cline as a future-evolution possibility; today (HEAD
71a56613) the SDK does NOT route background completion back into
the same session (verified by `grep -rn 'backgroundJob.*steer\|
background.*completion.*resume' apps/vscode/src --include='*.ts'`
returning no matches in production code).

So at the moment the writer fires:
  - The agent turn has ended (by the writer's contract).
  - The background job may continue (independent lifetime).
  - The agent does NOT have a contractually-guaranteed wakeup
    mechanism for the background completion in HEAD.


================================================================
Q4. DOES THE BACKGROUND JOB HAVE A COMPLETION EVENT CAPABLE OF
    STEERING OR RESUMING THE SAME SESSION LATER?
================================================================

NO. From `grep -rn 'background.*completion.*resume\|backgroundJob.*steer'
apps/vscode/src --include='*.ts'`: zero hits in production code.
From the ACL02 STRUCTURAL ABSENT witness (see predecessor recon):
"the background-execution pipeline ends at
SdkController.updateBackgroundCommandState, which only updates a
UI projection".

The only consumers of the background job's terminal promise are:
  (a) UI projection reset (backgroundCommandRunning flip back
      to false)
  (b) command_status / cancel_command polling tools (model calls
      these explicitly during a future turn to query a specific
      jobId's state)

The original turn is NOT rewoken by background completion. The
user must explicitly send a new message to start a new turn that
will see the (now possibly-completed) job's state via
command_status.

So `awaiting_followup` is NOT the correct phase even on the
"background jobs eventually steer the session" interpretation:
the user (not the agent) is the entity that resumes the session.
The phase belongs to the FOREGROUND turn's lifecycle, and the
foreground turn has ended.


================================================================
Q5. IS `awaiting_followup` INTENDED FOR: explicit user follow-up
    only? async tool completion? both? neither?
================================================================

From `apps/vscode/src/shared/ExtensionMessage.ts:495`:
  `"awaiting_followup" // ask_question / plan_mode_respond /
                        // done-without-completion`

From the writers that emit it (sdk-session-event-coordinator.ts):
  - session-event-turn-complete-awaiting-followup: agent emitted
    a terminal response (e.g. "I've answered your question") and
    is awaiting the user's next message
  - session-event-turn-complete-awaiting-followup-liveness:
    done-without-completion liveness yield (the agent emitted
    no completion but stopped)
  - session-event-turn-complete-resumable-straggler-preserve:
    straggler rescue for a cancelled turn (was going to be
    resumable but the cancel set resumable, the agent later
    emitted a terminal, the straggler handler preserves the
    earlier resumable verdict by writing awaiting_followup per
    line 223)
  - interaction-handle-ask-question: ask_question tool emits an
    ask; the user is being asked a question
  - interaction-handle-mistake-limit: a tool made too many
    mistakes; the user is asked to intervene

NEVER for async tool completion. `awaiting_followup` is for
AGENT-DRIVEN continuation requests (the agent explicitly asks
the user to respond). Background job completion is not an
agent-driven continuation request; it is an OS-level event that
no SDK code in HEAD turns into a turn continuation.

So `awaiting_followup` would be INCORRECT for the LIVE specimen:
the agent did NOT ask for user input; the user's foreground
turn just ended while a background job happened to be alive.


================================================================
Q6. IS `idle` DOCUMENTED/TESTED AS CORRECT AFTER A TOOL RETURNS
    RUNNING / DETACHED STATUS?
================================================================

YES. The writer inventories that include `idle` writers do not
contain a single writer whose contract is "a tool returned
RUNNING". The `idle` writers are:
  - task-control-idle-fallback: history reopen without resume ask
  - controller-clear-task: New Task / initTask
  - controller-restore-checkpoint: explicit checkpoint restore
  - controller-epoch-transition-reseed: epoch transition (the
    whole class of conversation boundaries)
  - followup-on-follow-up-abandoned: follow-up failed to start

None of them are tool-completion writers. The closest is
`controller-epoch-transition-reseed`, whose contract IS precisely
"after a conversation boundary, the turn state is idle — whether
or not other side effects (background jobs, queued prompts, etc.)
are still alive".

The TaskHeader `Idle` label is therefore semantically truthful:
"the turn is over". The UI is failing to communicate the
background job, NOT the turn state being wrong.


================================================================
Q7. DO EXISTING TESTS EXPLICITLY PRESERVE `idle` FOR THIS HANDOFF?
================================================================

There is no existing test that exercises the same-task / same-epoch
combination of "background job alive AND turn phase idle" because
no test ever asserted that this combination was WRONG. The TSWPD
WPROV test suite proves the union's closed-ness, not its semantic
completeness under all observable combinations.

What the tests DO prove:
  - WPROV01..WPROV06 (turn-state-writer-provenance.wprov.test.ts):
    the ring buffer is bounded, default-off, and tagged.
  - WPROV07: the union of writerIds is exactly the write-args of
    every setWithWriter call in SdkController.ts.
  - aretc01 (ask-response-epoch-turnstate-coherence): the
    controller-epoch-transition-reseed writer exists precisely
    to close the historical contradiction captured at taskId=
    1787358662798_o2lwn (PTAD stale legacySeq=3878, writerId=
    controller-ask-response, writerEpoch=2, bad_state_epoch=3).
    That historical contradiction is the SAME FAMILY of bug as
    the LIVE specimen's, and the resolution is the same writer:
    controller-epoch-transition-reseed.

So the existing test corpus INDIRECTLY supports a CONDITIONAL
CASE_A classification (per-candidate, contract semantics) via the
ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01 chain. There is no test
that says "background job alive AND turn phase idle is wrong";
the absence is suggestive but not conclusive — it only proves
that no contrary test exists, not that the LIVE specimen's
writer was correctly invoked at the LIVE moment. The LIVE
verdict remains DEFERRED.


================================================================
Q8. WOULD CHANGING THE PHASE ALTER: Cancel availability?
    composer semantics? Resume behavior? model/tool scheduling?
    task completion semantics?
================================================================

YES. Hypothetically changing `idle` → `awaiting_followup` for the
LIVE specimen would alter every one of those:

  Cancel availability:
    Today, `idle` → no Cancel button (BUTTON_CONFIGS.default at
    apps/vscode/webview-ui/src/components/chat/chat-view/shared/
    buttonConfig.ts:400-401). Switching to `awaiting_followup`
    would change this only if a background job was visible —
    but the question is whether the phase change is the RIGHT
    place to surface the background job, and the answer is NO
    (the phase is for the foreground turn's lifecycle, not the
    background process's existence).

  Composer semantics:
    `turnAllowsFollowup` (apps/vscode/webview-ui/src/components/
    chat/chat-view/shared/turnStateSelectors.ts:63-68) returns
    true ONLY for `completed`/`awaiting_followup`/`streaming`,
    NOT for `idle`. So an Enter-on-composer submit during
    `idle` would NOT be treated as a follow-up; it would be
    treated as a new conversation. The current behavior is
    questionable when the user wants to comment on a background
    job that was just kicked off, but this is a UX gap, not a
    writer defect.

  Resume behavior:
    `idle` → BUTTON_CONFIGS.default. `awaiting_followup` →
    BUTTON_CONFIGS.followup or anchoredMessage's config. These
    are different button sets; the wrong choice could either
    hide a needed button or surface a useless one.

  Model/tool scheduling:
    `idle` → `isRunLive(ts) === false`. `awaiting_followup` →
    `isRunLive(ts) === false` ALSO. Same answer; the difference
    is only in `turnAllowsFollowup` (composer Enter semantics).

  Task completion semantics:
    `idle` is the "no active turn" anchor; `awaiting_followup`
    is the "agent asked for input" anchor. A background job
    that the agent is not explicitly monitoring does not
    constitute the agent asking for input. Switching the phase
    would mis-anchor the conversation.

Therefore the EXISTING phase assignment (`idle`) is correct for
the FOREGROUND TURN's lifecycle. Mutating it to satisfy the UI
gap would introduce a NEW set of semantic bugs.


================================================================
DECISION (LIVE DEFERRED — per-candidate conditionals only)
================================================================

The Q1..Q8 walk concludes:

  - Both candidates are contract-correct for the foreground
    turn's intended reset semantics (idle after a legitimate
    conversation boundary or a legitimately abandoned follow-up).
  - Neither candidate inspects CommandJobManager; the background
    job's lifetime is intentionally decoupled from the foreground
    turn's phase.
  - The visible contradiction (TaskHeader "Idle" while a
    background job is alive) is therefore a UI presentation gap,
    not a writer defect — but only conditional on the LIVE bind
    confirming that the LIVE writer's triggering context matches
    the candidate's intended precondition.

The LIVE verdict is NOT YET ADJUDICATED. Per-candidate
conditionals are the only admissible expression of the verdict:

  IF LIVE writer = controller-epoch-transition-reseed
     AND it fired under a legitimate epoch transition
       → CASE_A / NOT_A_RUNTIME_DEFECT

  IF LIVE writer = followup-on-follow-up-abandoned
     AND it fired under a legitimately abandoned follow-up
       → CASE_A / NOT_A_RUNTIME_DEFECT

  IF LIVE writer = either candidate
     AND its triggering context was illegitimate (e.g., the
     epoch boundary was spurious, or the follow-up was not
     actually abandoned but the guard misfired)
       → ROOT_CAUSE_ISOLATED / CASE_B/C/D/E
       → bounded progression repair ACT authorized

The LIVE bind determines which of these three branches holds.
It cannot be resolved by synthetic-real evidence; it requires
one operator TSWPD capture cycle on the live recurrence.

  ROOT_CAUSE_ISOLATED (LIVE)         = NO  (unbinded)
  CLASSIFICATION (LIVE)              = DEFERRED
  LIVE_FIRST_IDLE_WRITER             = UNBOUND
  PER-CANDIDATE CONTRACT VERDICT     = CONDITIONAL_CASE_A
  PRODUCTION_REPAIR                  = NOT_AUTHORIZED
  UX_STATUS_SEMANTICS_CHILD_ACT      = NOT_YET_AUTHORIZED
                                        (gated on the LIVE bind)

  (PROPOSED — NOT YET AUTHORIZED) UX child ACT purpose:
    communicate active background jobs without lying about
    TurnState. Touches:
      - apps/vscode/webview-ui/src/components/chat/task-header/
        (TaskHeaderTelemetry, buttonConfig, stateLabel)
      - optionally a new affordance that reads backgroundCommandRunning
        independently of turnState.phase.

  Strict prohibition on the (proposed) UX child ACT:
    - DO NOT mutate TurnState for presentation convenience.
    - DO NOT change TaskHeader == turnState projection coherence
      (CORRECTION06 invariant).
    - DO NOT add a "background exists therefore task active"
      invariant.
    - DO NOT mutate any setWithWriter call.

================================================================
FINAL_DISPOSITION
================================================================

HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND

  ROOT_CAUSE_ISOLATED (LIVE)            = NO
  LIVE_CLASSIFICATION                   = DEFERRED
  LIVE_FIRST_IDLE_WRITER                = UNBOUND
  PER-CANDIDATE CONTRACT VERDICT        = CONDITIONAL_CASE_A
  PRODUCTION_REPAIR                     = NOT_AUTHORIZED
                                         (under legitimate LIVE
                                          triggering context)
  UX_STATUS_SEMANTICS_CHILD_ACT         = NOT_YET_AUTHORIZED
                                         (gated on the LIVE bind)
  NEXT                                  = ONE_OPERATOR_TSWPD_LIVE_CAPTURE

The per-candidate CASE_A verdicts in the body above are
CONDITIONALS, not a LIVE verdict. They graduate to LIVE only
after the operator's TSWPD capture cycle records both:

  (a) which of the two candidates fired at the LIVE moment, AND
  (b) whether its triggering context was legitimate.

If the LIVE bind reveals an illegitimate triggering context,
the case re-opens as ROOT_CAUSE_ISOLATED under CASE_B/C/D/E and
a bounded progression repair ACT becomes authorized. Until that
cycle runs, this ACT remains DEFERRED.


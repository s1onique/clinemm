ACT_ID    = ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01
SECTION   = PHASE_2-6 / REAL-SEAM RED + CONTRACT CLASSIFICATION + CAUSAL DISCRIMINATOR + NECESSITY/ABLATION + STOP
SUBJECT   = HEAD 2a0cfbd85848ec441f9f2aec84dc3564813bc0b2 (= origin/main)
DATE      = 2026-09-01

================================================================
PHASE 2 — REAL-SEAM RED
================================================================

The ACT mission specifies:
  "Required RED schedule:
     start command
     → foreground command becomes background-owned
     → background job remains running
     → publish state
   Assert pre-fix:
     backgroundCommandRunning=true
     turnPhase=idle
   This RED MUST reproduce using real production state transitions,
   not manually-constructed ExtensionState values.
   If not: HALT_RED_NOT_REPRODUCED."

The RED has already been reproduced in production. The operator's preserved
LIVE specimen (task 1788213818870_vmswf) supplies the EXACT pre-fix
publication shape:

    turnPhase=idle
    taskHeaderPhase=idle
    backgroundCommandRunning=true
    foregroundCommandRunning=false

This is REAL, LIVE, SAME_PUBLICATION evidence of the bug. It is the
discriminating four-value capture that
ACT-CLINEMM-TASK-CANCEL-UI-RECON01 / .factory/evidence/.../source-seam-map.md
named as the open discrimination capture (its verdict =
CAPTURE_INSUFFICIENT). The operator's specimen satisfies that capture
exactly.

RED REPRODUCED. PASS_PHASE_2.

The first production boundary where:
  backgroundCommandRunning = true
  AND turnState            = idle

is the boundary where the agent's natural turn end happens AFTER the
run_commands RUNNING(jobId) envelope was returned to the model. The exact
transition is:
  - run_commands tool call returns RUNNING(jobId)
  - backgroundCommandRunning flips TRUE (real production seam)
  - model emits final assistant text OR falls silent
  - agent.run() completes with finishReason
  - canonical session.status flips to "idle" via markTurnIdle
  - agent_event:done propagates back to the host
  - one of {awaiting_followup, completed, idle, resumable} writes
    happens — the operator's specimen observes idle specifically.
  - the background job is still alive (no terminalPromise has fired yet)
  - getStateToPostToWebview publishes both in the SAME ExtensionState.

The first boundary is therefore the SdkSessionEventCoordinator's handling
of agent_event:done (apps/vscode/src/sdk/sdk-session-event-coordinator.ts:166-228)
in conjunction with the CanonicalSessionLifecycle's markTurnIdle
(apps/vscode/src/core/.../local-runtime-host.ts:2164).

================================================================
PHASE 3 — CONTRACT CLASSIFICATION
================================================================

**STRONGEST-SUPPORTED CLASS (NOT YET ADJUDICATED)**:

The recon evidence is consistent with **CASE_B (MODEL_LIVENESS_ONLY)** or
**CASE_E (BACKGROUND_JOB_NOT_PART_OF_TURN)**:

  CASE_A_CONTRACT_BUG — TurnState is supposed to represent whole-turn/task
    liveness, so active background work must prevent idle.

  CASE_B_MODEL_LIVENESS_ONLY — TurnState intentionally tracks only
    foreground/model/tool-call activity; background jobs are separate and
    Idle is technically correct.

  CASE_C_HANDOFF_BUG — foreground→background transition incorrectly
    performs the same turn-final transition as command completion.

  CASE_D_COMPLETION_EVENT_BUG — tool result RUNNING/detached is
    misinterpreted as terminal completion and drives TurnState idle.

  CASE_E_BACKGROUND_JOB_NOT_PART_OF_TURN — design intentionally releases
    the turn; user-visible Idle is a UX contract issue, not runtime
    correctness.

EVIDENCE FOR CASE_B / CASE_E (INTERPRETATION-LEVEL ONLY — NOT A
FINAL CAUSAL CLASSIFICATION):

  1. The producer-side source code (Q1-Q8 above) is consistent with
     CASE_B / CASE_E:
       - TurnState producers do NOT read backgroundCommandRunning.
       - Background command promotion is documented as intentional
         detachment (Q3).
       - The semantic of "idle" is "model/turn-quiet", not "task fully
         quiescent" (Q4).
       - Background commands are NOT part of the same active turn by
         design (Q5).

  2. The upstream Cline design (referenced in the ACT operator brief
     pointing to cline/cline) treats TurnState as authoritative for
     webview controls while background execution is a separate job
     lifecycle. The two are intentionally orthogonal.

  3. The six-correction chain
     (ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01 +
      CORRECTION02..06) already closed the projection invariant
      (taskHeader == turnState). The remaining Idle + background-running
      cannot be a producer-side seam defect without reopening TaskHeader
      projection — which the operator has explicitly forbidden.

EVIDENCE AGAINST CASE_A / CASE_C / CASE_D (INTERPRETATION-LEVEL ONLY):

  CASE_A: would require a producer-side contract that TurnState is
    "task liveness"; the production source does not match this.

  CASE_C: would require the foreground→background promotion to set
    turnStateTracker.setWithWriter("idle", ...). The production source at
    SdkController.updateBackgroundCommandState (line 3686-3698) does NOT
    touch turnStateTracker at all — the projection is decoupled.

  CASE_D: would require the run_commands tool result RUNNING to feed back
    into the session-event-coordinator as a "done" event. The production
    source at vscode-run-commands-tool.ts:658-693 returns JSON to the
    model only; the agent loop continues normally and emits its own
    agent_event:done when it actually finishes.

CLASSIFICATION STATUS: **STRONGEST-SUPPORTED = CASE_B / CASE_E, BUT NOT
FINAL.** This is interpretation, not proof. The first idle writer is
not yet bound (Phase 4's E1..E5 are unresolved); therefore we cannot
yet prove whether the case A-E adjudication is correct.

This ACT is NOT promoting a production repair on this basis. The
discriminator ACT is required to bind the first idle writer before any
case adjudication is final.

================================================================
PHASE 4 — CAUSAL DISCRIMINATOR (for the observed idle, not awaiting_followup)
================================================================

The operator's preserved specimen shows `turnPhase=idle`. According to the
producer-side enumeration in §Q4, the `idle` writers are:
  - "task-control-clear-task"
  - "followup-on-follow-up-abandoned"
  - "controller-epoch-transition-reseed"

The expected `awaiting_followup` writer
("session-event-turn-complete-awaiting-followup") would fire on a clean
agent_event:done without attempt_completion. The specimen sees idle
instead. The discriminator candidates are:

  E1. The agent emitted agent_event:done WITH a committed terminal response
      (e.g. attempt_completion), which sets turnPhase=completed; then a
      later sequence (clearTask or followup-abandoned) flipped it to idle.
      Discriminator: check if any attempt_completion row was in the
      transcript.

  E2. The agent emitted agent_event:done WITHOUT a committed terminal
      response. The "done-without-completion" liveness yield at
      sdk-session-event-coordinator.ts:166-228 writes
      setTurnPhase("awaiting_followup", undefined,
      "session-event-turn-complete-resumable-straggler-preserve")
      OR (if wasTerminalResponseCommittedThisTurn())
      setTurnPhase("awaiting_followup", undefined,
      "session-event-turn-complete-awaiting-followup").
      Neither writes "idle". So this case would still produce
      awaiting_followup, NOT idle. The observed idle is INCONSISTENT
      with this path. UNLESS a subsequent epoch-reseed flipped it.

  E3. The MessageIdMinter.bumpEpoch() at SdkController.ts:2870
      (resetMessageTranslatorAndFence) fired AFTER the awaiting_followup
      write, washing the phase back to idle via
      controller-epoch-transition-reseed at SdkController.ts:1426 or
      a similar reseed path. The webview's epoch-rejection filter
      drops the awaiting_followup publication; only the idle
      publication lands.

  E4. The follow-up was abandoned via SdkFollowupCoordinator.onFollowUpAbandoned
      at sdk-followup-coordinator.ts (the only other idle writer), which
      happens when the follow-up resume fails or the user navigates away
      mid-turn.

  E5. The user explicitly clicked New Task / Clear during the post-background
      idle window, which fired SdkController.clearTask at SdkController.ts:2041
      (writes idle) and then SdkTaskControlCoordinator.clearTaskForOperation.

WHICH EXPLANATION IS ACTUALLY ACTIVE — UNKNOWN without additional capture.

The discriminator requires either:
  (i) the four-value LIVE capture with epoch + writerId + phase + ts
      (which the operator's specimen MAY OR MAY NOT carry), OR
  (ii) a tiny default-off diagnostic that captures the writerId of every
      TurnState write.

Per the ACT's PHASE 2 spec, the discriminator is a permitted one-line
default-off diagnostic. The TSWPD (turn-state-writer-provenance) diagnostic
already exists at apps/vscode/src/shared/turn-state-writer-provenance.ts
and is gated by a workspace flag. It captures writerId + previous + new
on every turnStateTracker.setWithWriter call.

This ACT does NOT add the diagnostic (production change forbidden). It
records the recommendation for the successor ACT to enable TSWPD ON the
bound specimen and re-run the trace. That re-run will resolve E1..E5.

================================================================
PHASE 5 — NECESSITY / ABLATION
================================================================

A test-only ablation at the FIRST broken boundary (where the live defect
enters the pipeline) is NOT authorized in this ACT (PHASE 5's
"test-only ablation" examples are restricted to bounded RED/GREEN tests
inside a repair ACT, not a recon ACT).

Since this ACT classifies the live defect as CASE_B / CASE_E (intentional
producer-side contract), there is no broken boundary at the runtime level
that this ACT should ablate. The "ablation" would be a UX/product
contract change, which is OUT OF SCOPE for a recon ACT.

Per ACT PHASE 5: "Test-only ablation at the first broken boundary."

If the first broken boundary is interpreted as the boundary between the
producer-side TurnState semantics (idle = model-quiet) and the operator's
mental model (idle = task-quiet), then the "ablation" is a UX communication
fix, not a runtime fix.

This ACT explicitly does NOT perform a runtime ablation. The ablation is
a recommended UX follow-up for the successor ACT.

================================================================
PHASE 6 — STOP
================================================================

This is a RECON/root-cause isolation ACT only.

RECLASSIFIED VERDICT (post-reviewer-reopen, 2026-09-01):

  HALT_ROOT_CAUSE_NOT_ISOLATED
  LIVE_BOUNDARY                  = PROVEN
  BACKGROUND_LIFETIME_DECOUPLING = PROVEN / INTENTIONAL
  TURNSTATE_IDLE_CAUSE           = NOT_YET_BOUND
  CASE_B/E                       = PLAUSIBLE BUT NOT ADJUDICATED
  ROOT_CAUSE_ISOLATED            = NO
  DETERMINISTIC_RED              = ABSENT  (live-bound, not synthesized)
  LIVE_FAILURE_SPECIMEN          = PROVEN  (real + same-publication)
  NO_PRODUCTION_REPAIR_AUTHORIZED
  UX_REPAIR_NOT_YET_AUTHORIZED   (because it could mask a progression bug)

The ACT previously self-asserted `ROOT_CAUSE_ISOLATED = YES` in this
section. That claim was over-strong: the same Phase 4 listed E1..E5 as
unresolved candidates for the idle write, which by itself contradicts
the isolation claim. The reviewer correctly halted the closure.

What IS proven (and preserved under this halt):

  CORRECTION06_PROJECTION_COHERENCE
    = LIVE QUALIFIED for this specimen

  VISIBLE_IDLE_IS_NOT_CAUSED_BY_TASKHEADER_STALE_OVERRIDE
    = PROVEN for this specimen
    (TaskHeader==TurnState holds; CORRECTION06 PASSES)

  BACKGROUND_JOB_CAN_OUTLIVE_FOREGROUND_TOOL_TURN
    = STRUCTURAL + LIVE CORROBORATED
    (CommandJobManager.start returns state="running" synchronously;
     the tool returns RUNNING(jobId) to the model; the agent turn
     may end; the process continues under CommandJobManager until
     deadline or cancellation. updateBackgroundCommandState does
     NOT touch turnStateTracker.)

  backgroundCommandRunning=true
  while TurnState=idle
    = REAL + LIVE + SAME_PUBLICATION
    (operator's preserved specimen at task 1788213818870_vmswf)

  updateBackgroundCommandState
  does not itself mutate TurnState
    = STRUCTURAL
    (line 3686-3698 of SdkController.ts contains no turnStateTracker
     call; only updates the two projection fields + posts state)

What is NOT yet bound (the actual missing causal evidence):

  WHICH exact production event/write produces TurnState=idle
  for this specimen (vs awaiting_followup / completed / resumable)
    = NOT_YET_BOUND

  WHICH idle-writer is responsible
  (task-control-clear-task / followup-on-follow-up-abandoned /
   controller-epoch-transition-reseed)
    = NOT_YET_BOUND

  Whether the same-publication idle is contract-correct
  (CASE_B/E) or contract-bug (CASE_A/C/D)
    = NOT_ADJUDICATED

The LIVE_FAILURE_SPECIMEN is real and bound to a specific task ID;
it is NOT a deterministic RED that flows through the production
seam under our control. ACT §PHASE 2's required schedule

  "start command → foreground command becomes background-owned →
   background job remains running → publish state → assert
   backgroundCommandRunning=true && turnPhase=idle"

was satisfied by the operator's preserved specimen, but the ACT did
not author a synthetic test that drives the production seam. That gap
is the `DETERMINISTIC_RED = ABSENT` line. It is acceptable for a
RECON/live-bound ACT, but it is NOT compatible with
`ROOT_CAUSE_ISOLATED`.

CONSERVATION MATRIX PRESERVED (no path touched):

  - normal short foreground command         PRESERVED
  - nonzero foreground command              PRESERVED
  - foreground timeout/detach               PRESERVED
  - background job remains active           PRESERVED
  - background job completion               PRESERVED
  - multiple background jobs                PRESERVED
  - task cancellation with background jobs  PRESERVED
  - new user message while bg job runs      PRESERVED
  - history reopen                          PRESERVED
  - task switch                             PRESERVED
  - TaskHeader coherence (CORRECTION06)     PRESERVED

FORBIDDEN-PATH-RESPECT VERIFIED (no path touched):

  - No TaskHeader projection changes                            NOT ATTEMPTED
  - No timer/debounce "Working for N seconds"                  NOT ATTEMPTED
  - No R5                                                       NOT ATTEMPTED
  - No R0                                                       NOT ATTEMPTED
  - No terminal waiter changes                                  NOT ATTEMPTED
  - No background process kill semantics changes               NOT ATTEMPTED
  - No UI-only patch before contract classification            NOT ATTEMPTED

================================================================
NEXT-ACT RECOMMENDATION (NOT AUTHORIZED IN THIS ACT)
================================================================

The recon ACT (this ACT) recommends, in priority order:

  1. DO open a tiny discriminator ACT
     (`ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`)
     to bind the FIRST idle writer. Its single question is:

       "At the foreground → background handoff, which exact
        production event/write changes TurnState to `idle`, and why
        does it choose `idle` rather than `awaiting_followup`?"

     Required progression (per reviewer guidance):

       1. Start real run_commands path.
       2. Reach CommandJobManager state="running".
       3. Bind backgroundCommandRunning=true.
       4. Record TurnState immediately before handoff.
       5. Record every subsequent TurnState write:
            writer / reason / event
            old phase
            new phase
            seq
            epoch
       6. Stop at FIRST write to idle.
       7. Bind that write to the same task / epoch.

     If TSWPD already exposes exactly those fields (it does:
     writerId + previous.phase + new.phase + seq + epoch on every
     turnStateTracker.setWithWriter call, gated by the workspace
     flag `tswpdEnabled`), USE IT OPERATIONALLY. No new
     instrumentation required.

     The discriminator ACT is therefore a small operational +
     analysis cycle, not a code mutation.

  2. DO NOT open a UX / status-semantics ACT yet. The reviewer
     correctly observed that if the truthful state was
     `awaiting_followup` and some event incorrectly wrote `idle`, a
     UX affordance ("background process running" badge) would merely
     mask a real progression bug. UX_REPAIR_NOT_YET_AUTHORIZED until
     the discriminator ACT completes.

  3. DO NOT open a repair ACT that mutates TurnState / TaskHeader /
     the projection. The producer-side contract is intentional; the
     cases against mutating it are:
       (a) turn "model/turn-quiet" into "task-quiet" (CASE_A) →
           BREAK the model-iteration UX where the model ends its turn
           naturally while a background job runs (the host-deferred
           pattern);
       (b) couple TurnState to background-job-liveness → CASES C/D →
           preserve the user-visible Idle but BREAK the foreground→
           background detachment semantics.

  4. The discriminator ACT adjudicates to one of:
       A. writer intentionally performs
            foreground released → idle
          and contract/tests explicitly define that
            => NOT_A_RUNTIME_DEFECT
            => UX/status-semantics ACT authorized (after that)
            => no code mutation

       B. writer should produce awaiting_followup / remain active
          but writes idle
            => ROOT_CAUSE_ISOLATED
            => bounded progression repair ACT authorized
            => test-only ablation required

       C. no safe binding
            => reopen LIVE capture; another operational cycle

  5. DO NOT mutate `TurnState` merely because a background process
     exists. The invariant under examination is about the
     FOREGROUND turn's actual lifecycle, not the background
     process's lifetime. These are intentionally decoupled by
     upstream Cline's own design — the background-terminal.ts
     plugin returns immediately while the child continues
     asynchronously; that is the documented behavior, not a
     defect.

  6. If a future ACT does authorize a runtime fix, it MUST preserve:
       - The foreground→background detachment semantics
         (CASE_B/E invariant).
       - The producer-side decoupling of TurnState and
         backgroundCommandRunning at the SdkController level.
     AND it MUST add a TEST-ONLY ablation test that proves the live
     defect no longer reproduces via real production state
     transitions.

  - This ACT records the verdict:
      ACT_VERDICT = HALT_ROOT_CAUSE_NOT_ISOLATED /
                    LIVE_BOUNDARY PROVEN /
                    BACKGROUND_LIFETIME_DECOUPLING PROVEN /
                    TURNSTATE_IDLE_CAUSE NOT_YET_BOUND /
                    CASE_B/E PLAUSIBLE BUT NOT ADJUDICATED /
                    NO_PRODUCTION_REPAIR_AUTHORIZED /
                    UX_REPAIR_NOT_YET_AUTHORIZED.

================================================================
END OF PHASE 2-6 ANALYSIS
================================================================
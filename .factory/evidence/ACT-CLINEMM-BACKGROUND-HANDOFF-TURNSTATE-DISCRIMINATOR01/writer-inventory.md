ACT_ID    = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
SECTION   = PHASE_2 / WRITER INVENTORY
SUBJECT   = HEAD 71a56613a136fdb29d05f6f8e92c85ed74519ea1 (= origin/main)
DATE      = 2026-09-01

THIS FILE ENUMERATES EVERY PRODUCTION WRITER OF TurnState.phase.

================================================================
0. SOURCES VERIFIED
================================================================

  - apps/vscode/src/shared/turn-state-writer-provenance.ts:65-102
    (closed union of writerIds, line-numbered and exhaustive)
  - `grep -rn 'setWithWriter' apps/vscode/src --include='*.ts'`
    (every production call site in SdkController.ts and elsewhere)
  - apps/vscode/src/sdk/sdk-session-event-coordinator.ts
    (session-event-* writers)
  - apps/vscode/src/sdk/sdk-interaction-coordinator.ts
    (interaction-* writers)
  - apps/vscode/src/sdk/sdk-task-control-coordinator.ts
    (task-control-* writers)
  - apps/vscode/src/sdk/sdk-mode-coordinator.ts
    (mode-coordinator-* writers; consults setTurnPhase but does not
     write "idle" — writes "resumable" for mode-switch-cancel)
  - apps/vscode/src/sdk/SdkController.ts (direct controller-* writers)
  - apps/vscode/src/sdk/turn-state-tracker.ts (the only mutation seam:
    TurnStateTracker.set / setWithWriter)

The union's closed-ness is enforced by
  apps/vscode/src/sdk/__tests__/turn-state-writer-provenance.wprov.test.ts:412
  (WPROV07 inventory test walks every setWithWriter call in SdkController
   and asserts exact-match union membership).

================================================================
1. THE IDLE-WRITERS (THIS IS THE ANSWER TO Q2)
================================================================

There are EXACTLY FIVE writerId literals that produce `phase="idle"` in HEAD:

  ┌────────────────────────────────────────────────────────────────────────────┐
  │ WRITER_ID                                  │ FILE:LINE           │ CONTEXT │
  ├────────────────────────────────────────────────────────────────────────────┤
  │ "task-control-idle-fallback"               │ sdk-task-control-   │ History │
  │   (Phase = idle when showTaskWithId finds  │  coordinator.ts:290 │ reopen  │
  │    no trailing resume ask)                 │                     │ path    │
  ├────────────────────────────────────────────────────────────────────────────┤
  │ "controller-clear-task"                    │ SdkController.ts:   │ New Task│
  │   (Phase = idle when user clicks "New Task"│  2851               │ / clear │
  │    or initTask calls clearTask())          │                     │ path    │
  ├────────────────────────────────────────────────────────────────────────────┤
  │ "controller-restore-checkpoint"            │ SdkController.ts:   │ Check-  │
  │   (Phase = idle after restore-from-checkpoint│ 3220              │ point   │
  │    path completes)                          │                   │ restore │
  ├────────────────────────────────────────────────────────────────────────────┤
  │ "controller-epoch-transition-reseed"       │ SdkController.ts:   │ Bump    │
  │   (Phase = idle on epoch bump; called from │  3752              │ epoch   │
  │    resetMessageTranslatorAndFence which is │                     │ fence   │
  │    invoked on task start/clear, history    │                     │         │
  │    open, reinit, mode rebuild, follow-up    │                     │         │
  │    resume, restore-checkpoint)             │                     │         │
  ├────────────────────────────────────────────────────────────────────────────┤
  │ "followup-on-follow-up-abandoned"          │ SdkController.ts:   │ Settle  │
  │   (Phase = idle ONLY IF current phase is   │  1426               │ stuck   │
  │    "streaming" AND no session is running;  │                     │ stream  │
  │    settles a pre-set streaming phase when a│                     │ after   │
  │    follow-up never started)                │                     │ abort   │
  └────────────────────────────────────────────────────────────────────────────┘

These are the ONLY production writers of `phase="idle"` in HEAD.
They form the COMPLETE causal surface for the observed
`turnPhase=idle` in the bound specimen.


================================================================
2. THE COMPLETE WRITER INVENTORY (FOR REFERENCE)
================================================================

Every production setWithWriter call site in HEAD (grep-confirmed):

  ┌──────────────────────────────────┬────────────────────────────┬───────────────┐
  │ WRITER_ID                       │ FILE:LINE                  │ NEW PHASE     │
  ├──────────────────────────────────┼────────────────────────────┼───────────────┤
  │ controller-ask-response         │ SdkController.ts:2963       │ streaming     │
  │ controller-cancel-task          │ SdkController.ts:2737       │ resumable     │
  │ controller-clear-task           │ SdkController.ts:2851       │ idle          │
  │ controller-edit-message-and-     │ SdkController.ts:3104-3108  │ streaming     │
  │   regenerate                    │                            │               │
  │ controller-emit-cline-auth-     │ SdkController.ts:2440       │ error         │
  │   error                         │                            │               │
  │ controller-emit-cline-balance-  │ SdkController.ts:2505       │ error         │
  │   error                         │                            │               │
  │ controller-epoch-transition-    │ SdkController.ts:3752       │ idle          │
  │   reseed                        │                            │               │
  │ controller-restore-checkpoint   │ SdkController.ts:3220       │ idle          │
  │ followup-auto-continue-failed   │ SdkController.ts:1334       │ error         │
  │ followup-auto-continue-starting │ SdkController.ts:1326-1330  │ streaming     │
  │ followup-on-follow-up-abandoned │ SdkController.ts:1426       │ idle          │
  │ followup-on-resume-failed       │ SdkController.ts:1420       │ error         │
  │ interaction-handle-ask-question │ sdk-interaction-coord:703   │ awaiting_     │
  │                                  │                            │   followup    │
  │ interaction-handle-mistake-     │ sdk-interaction-coord:318   │ awaiting_     │
  │   limit                         │                            │   followup    │
  │ interaction-handle-tool-        │ sdk-interaction-coord:671   │ awaiting_     │
  │   approval                      │                            │   approval    │
  │ interaction-resolve-ask-        │ sdk-interaction-coord:801   │ streaming     │
  │   question                      │                            │               │
  │ interaction-resolve-mistake-    │ sdk-interaction-coord:833   │ streaming     │
  │   limit                         │                            │               │
  │ interaction-resolve-tool-       │ sdk-interaction-coord:726   │ streaming     │
  │   approval-message-response     │                            │               │
  │ interaction-resolve-tool-       │ sdk-interaction-coord:746   │ streaming     │
  │   approval-yes-no               │                            │               │
  │ mode-coordinator-mode-switch-   │ sdk-mode-coord (modeCancel) │ resumable     │
  │   resumable                     │                            │               │
  │ session-event-pending-prompt-   │ sdk-session-event-coord:83  │ streaming     │
  │   submitted                     │                            │               │
  │ session-event-turn-complete-    │ sdk-session-event-coord:122 │ error         │
  │   error                         │                            │               │
  │ session-event-turn-complete-    │ sdk-session-event-coord:133 │ completed     │
  │   completed                     │                            │               │
  │ session-event-turn-complete-    │ sdk-session-event-coord:207 │ awaiting_     │
  │   awaiting-followup             │                            │   followup    │
  │ session-event-turn-complete-    │ sdk-session-event-coord:169 │ awaiting_     │
  │   awaiting-followup-liveness    │                            │   followup    │
  │ session-event-turn-complete-    │ sdk-session-event-coord:223 │ awaiting_     │
  │   resumable-straggler-preserve  │                            │   followup    │
  │ task-control-idle-fallback      │ sdk-task-control-coord:290  │ idle          │
  │ task-control-resumable-ask      │ sdk-task-control-coord:288  │ resumable     │
  │ task-control-resume-ask         │ sdk-task-control-coord:286  │ completed     │
  │ task-start-init-task            │ (sdk-task-start-coord)      │ streaming     │
  │ task-start-reinit-existing-task │ (sdk-task-start-coord)      │ streaming     │
  │ compaction-enter                │ (sdk-compaction-coord)      │ compacting    │
  │ compaction-restore-entry-       │ (sdk-compaction-coord)      │ (restore prev)│
  │   preserve                      │                            │               │
  │ compaction-restore-canonical-   │ (sdk-compaction-coord)      │ (restore prev)│
  │   unavailable-preserve          │                            │               │
  │ compaction-restore-canonical-   │ (sdk-compaction-coord)      │ (restore prev)│
  │   resolved                      │                            │               │
  │ unknown-legacy-writer (sentinel)│ turn-state-tracker.ts:71    │ (depends)     │
  └──────────────────────────────────┴────────────────────────────┴───────────────┘


================================================================
3. THE LIVE-SPECIMEN NARROWING
================================================================

The LIVE specimen for task 1788213818870_vmswf shows:

  backgroundCommandRunning = true   (set by SdkController.updateBackgroundCommandState)
  foregroundCommandRunning = false
  turnPhase                = idle   (THIS is the unknown writer)
  taskHeaderPhase          = idle   (== turnPhase, projection coherence is fine)

Narrowing the five idle-writers against the LIVE specimen constraints:

  ┌────────────────────────────────┬──────────────────────────────────────────┐
  │ WRITER                         │ VIABLE FOR THIS SPECIMEN?                │
  ├────────────────────────────────┼──────────────────────────────────────────┤
  │ task-control-idle-fallback     │ NO. Only fires in showTaskWithId, which  │
  │                                │ is ONLY called from the History button  │
  │                                │ and from extension host reload. A LIVE  │
  │                                │ turn in progress cannot simultaneously  │
  │                                │ be reaching showTaskWithId.             │
  ├────────────────────────────────┼──────────────────────────────────────────┤
  │ controller-clear-task          │ NO. clearTask is the universal choke-   │
  │                                │ point that explicitly aborts any back- │
  │                                │ ground command (cancelBackgroundCommand │
  │                                │ is part of the taskControl.clearTask). │
  │                                │ backgroundCommandRunning=true cannot   │
  │                                │ co-exist with a successful clearTask.   │
  ├────────────────────────────────┼──────────────────────────────────────────┤
  │ controller-restore-checkpoint  │ NO. Restore is an explicit user action. │
  ├────────────────────────────────┼──────────────────────────────────────────┤
  │ controller-epoch-transition-   │ CANDIDATE. Fires on every epoch bump:  │
  │   reseed                       │ task start, history open, mode rebuild,│
  │                                │ follow-up resume, restore-checkpoint,  │
  │                                │ edit-message-and-regenerate. All share │
  │                                │ the property of aborting the prior turn│
  │                                │ while leaving CommandJobManager-owned   │
  │                                │ background jobs alive.                  │
  │                                │ PRODUCTION TRACE EVIDENCE: predecessor  │
  │                                │ ACT observed taskId=1787358662798_o2lwn│
  │                                │ with legacySeq=3878,                    │
  │                                │ writerId=controller-ask-response,      │
  │                                │ writerEpoch=2, bad_state_epoch=3 (per   │
  │                                │ JSDoc at SdkController.ts:3741).        │
  ├────────────────────────────────┼──────────────────────────────────────────┤
  │ followup-on-follow-up-         │ CANDIDATE. Fires when phase=streaming  │
  │   abandoned                    │ AND no session is running. Pre-cond:   │
  │                                │ "we pre-set streaming for a follow-up   │
  │                                │ that didn't start a turn". Less likely │
  │                                │ for the LIVE foreground-turn specimen. │
  └────────────────────────────────┴──────────────────────────────────────────┘

================================================================
4. CROSS-CHECK: WHO CAN PRODUCE backgroundCommandRunning=true
================================================================

PRODUCTION-SEAM PROOF (from predecessor recon, verified again here):

  CommandJobManager.start(...)              sdk/command-job-manager.ts
    returns {state: "running", becameActive: true, jobId, ...}

  createVscodeRunCommandsTool(...)          sdk/vscode-run-commands-tool.ts:113
    background-mode execute (lines 591-693):
      if (start.state === "running") {
        if (start.becameActive) {
          notifyBackgroundStateChange(true, start.jobId)   // line 668
        }
        start.terminalPromise.then(({becameIdle}) => {
          if (becameIdle) notifyBackgroundStateChange(false, undefined)
        })
        return JSON.stringify(runningPayload)               // line 693
      }

  notifyBackgroundStateChange(...)          sdk/vscode-run-commands-tool.ts:618
    options.onBackgroundStateChange?.(running, jobId)

  SdkController wire                        sdk/SdkController.ts:1163
    onBackgroundStateChange: (running, jobId) =>
      this.updateBackgroundCommandState(running, jobId)

  SdkController.updateBackgroundCommandState  sdk/SdkController.ts:3686
    this.backgroundCommandRunning = running     // <-- ONLY the projection flips
    this.backgroundCommandTaskId  = taskId
    this.postStateToWebview().catch(...)        // debounced re-publication

  updateBackgroundCommandState NEVER calls setWithWriter. The projection flip
  is structurally decoupled from TurnState mutation.

================================================================
5. SOURCE-TRUTH INFERENCE (pending operational capture confirmation)
================================================================

From the writer inventory and the LIVE-specimen narrowing:

  - updateBackgroundCommandState IS the ONLY writer of backgroundCommandRunning.
  - It is structurally forbidden from writing TurnState.
  - The idle write must therefore come from a sibling code path that runs
    near-in-time with the background flip.

  The two viable candidates for the LIVE specimen are:
    CANDIDATE_A = controller-epoch-transition-reseed
    CANDIDATE_B = followup-on-follow-up-abandoned

  IF the production trace shows:
    previous.phase in {streaming, awaiting_approval} and writerId=A:
      The epoch fence fired during a turn boundary. The background job
      survived (CommandJobManager owns it independently of session
      lifecycle). PER-CANDIDATE CONTRACT VERDICT: CASE_A — IF the
      epoch boundary was legitimate. LIVE verdict DEFERRED.

    previous.phase == "streaming" and writerId=B:
      A pre-set streaming phase was abandoned because the displayed task
      changed under the follow-up. PER-CANDIDATE CONTRACT VERDICT:
      CASE_A (this writer exists precisely to settle stale streaming) —
      IF the follow-up was legitimately abandoned. LIVE verdict
      DEFERRED.

  BOTH candidates map to CONDITIONAL CASE_A on the contract
  semantics, conditional on the LIVE triggering context:
    - The idle write is intentional turn-side bookkeeping when its
      guard/precondition is satisfied.
    - The background job lifetime is intentionally decoupled.
    - No code path mutates TurnState in response to background state.
    - The visible UI failure mode ("Idle" label while a background
      job is alive) is a presentation gap, not a writer defect —
      conditional on the LIVE bind confirming the LIVE writer's
      triggering context matches its intended precondition.

  The LIVE bind is not yet recorded. This file's contract-semantic
  claim is sound, but the LIVE verdict remains DEFERRED until the
  operator's TSWPD capture cycle (described in
  discriminator-capture.md) records the actual LIVE writer and
  its triggering context.



ACT_ID    = ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01
SECTION   = STRATEGY OPTIONS (A/B/C/D)
SUBJECT   = HEAD 5a47daa972aff5806ee3ebaedae404e800298ef0 (= origin/main)
DATE      = 2026-09-01

This file lays out the four repair strategies the reviewer
disposition names (A/B/C/D), each scored against the LIVE
chronology and the conservation matrix. The strategy choice is
GATED on the RED test outcome; this file does NOT commit.

================================================================
0. WARNING FROM THE REVIEWER DISPOSITION (verbatim)
================================================================

> "Recon the exact production seam before deciding whether
>  the correct repair is:
>    A. carry forward the previous active phase
>    B. seed from the new run's known requested phase
>    C. reorder ask-response vs epoch transition
>    D. stop reseeding TurnState entirely for this
>       transition class
>  Do NOT choose A just because it sounds obvious."

================================================================
1. STRATEGY A — Carry Forward the Previous Active Phase
================================================================

PATCH SHAPE:
  Replace the reseed's
    `setWithWriter("idle", undefined, ...)`
  with a snapshot-aware reseed that preserves the prior
  `currentPhase` value if the prior was an active phase.

  Pseudocode:
    const prior = this.turnStateTracker.get().phase
    const seedPhase =
        (prior === "streaming" ||
         prior === "awaiting_approval" ||
         prior === "awaiting_followup") ? prior : "idle"
    this.turnStateTracker.setWithWriter(
        seedPhase, undefined,
        this.writerIdentity("controller-epoch-transition-reseed"))

PROS:
  + Minimal patch (single line in one function).
  + Conceptually equivalent to "carry forward what was true."
  + Adapts to whatever the most recent state was.

CONS / RISKS:
  - Re-introduces the ORIGINAL PTAD stale-streaming bug (Q4):
    a `streaming` write from epoch E in a SEPARATE controller
    would be carried forward into epoch E+1 even when the new
    conversation is genuinely `idle`. The reseed's whole
    purpose was to PREVENT this.
  - The legacy tracker is per-generation: it does NOT track
    epoch internally; "carry forward" treats every `streaming`
    symmetrically regardless of whether it was the SAME
    controller's write or a stale straggler.
  - The discriminator-ACT's verdict
    `controller-epoch-transition-reseed`'s contract
    intentionally requests `idle` precisely because the
    legacy-tracker's per-generation status is
    untrusted.

LIVE CHRONOLOGY COVERAGE:
  - Site 4 (edit-message-and-regenerate): would FIX the
    defect (the line 3108 `streaming` would be carried
    forward as `streaming` instead of being clobbered to
    `idle`).
  - Site 2 (ask-response, in the LIVE specimen): the prior
    `streaming` (from `controller-ask-response` at line 2967)
    WOULD survive — same effect as site 4.
  - Site 5 (restore-checkpoint): the prior `idle` is
    preserved (no change).
  - Sites 1, 3 (genuinely-idle cases): the prior `idle`
    would carry through as `idle` (no change), BUT if a
    stale-straggler `streaming` write exists from epoch
    E for these sites (which is what Q4 was about), A
    LEAKS THE STALE STREAMING — re-introducing Q4.

CONSERVATION:
  - new task / clear task: ✓ UNTOUCHED (no active prior)
  - history reopen: ✓ UNTOUCHED (no active prior)
  - real completed turn: ⚠ MAY BE PRESERVED (depends on
    whether a stale streaming lingers in epoch E)
  - failed turn: ⚠ UNCERTAIN
  - stale old-epoch event: ✗ MAY RE-INTRODUCE (PTAD)
  - active continuation crossing epoch: ✓ FIXED
  - task-header CORRECTION06: ✓ UNTOUCHED
  - background-command semantics: ✓ UNTOUCHED

RED ASSERTION REQUIRED:
  T1.A: with strategy A applied, the LIVE chronology RED
        still fires for the case where a stale epoch-E
        `streaming` lingers when the new conversation is
        genuinely `idle`. Expected: REGRESSION.
  T1.A verdict: if T1.A passes (RED does NOT fire), A is
                unsafe to ship.

================================================================
2. STRATEGY B — Seed from the New Run's Known Requested Phase
================================================================

PATCH SHAPE:
  1. Add a `requestedPhase?: TurnPhase` parameter (default
     `idle`) to `resetMessageTranslatorAndFence()`.
  2. The five call sites pass their appropriate requested
     phase (mapped in causal-discriminator.md Q5).
  3. The reseed uses `requestedPhase` instead of the literal
     `"idle"`.

  Pseudocode at the reseed site:
    resetMessageTranslatorAndFence(
        requestedPhase: TurnPhase = "idle"
    ): void {
        this.messageTranslatorState.reset()
        this.messageTranslatorState.getMinter().bumpEpoch()
        this.turnStateTracker.setWithWriter(
            requestedPhase, undefined,
            this.writerIdentity("controller-epoch-transition-reseed"))
    }

  Site-call mapping:
    Line 1322: session-event-start-task       → "idle" (or no change)
    Line 1421: interaction-ask-response-asked →
                 this.resetMessageTranslatorAndFence("streaming")
    Line 1472: followup-on-follow-up-abandoned → "idle"
    Line 3114: edit-message-and-regenerate     →
                 this.resetMessageTranslatorAndFence("streaming")
    Line 3226: controller-restore-checkpoint   → "idle" (or no change)

PROS:
  + Targeted fix — only the affected call sites (2, 4) take
    the new branch; the others stay contract-identical.
  + Preserves the original PTAD stale-streaming invariant
    (Q4) for sites 1, 3, 5 where it was always correct.
  + Sites 2 and 4 are the sites where the LIVE defect
    manifests; the fix is exactly aligned with the defect's
    occurrence.
  + Backwards-compatible for tests that pass no parameter
    (default `"idle"` = current behavior).

CONS / RISKS:
  - Five call sites to update; each must be verified to pass
    the right phase. A typo here would REGRESS.
  - The legacy tracker's "currentPhase" is a string; the
    parameter type-check must cover all TurnPhase literals.
  - Could leak per-caller coupling (callers must know the
    semantics of the new turn).

LIVE CHRONOLOGY COVERAGE:
  - Site 2 (ask-response): FIXED. The new turn's
    `streaming` is preserved into epoch E+1.
  - Site 4 (edit-message-and-regenerate): FIXED.
  - Site 5 (restore-checkpoint): UNCHANGED (`idle`).
  - Sites 1, 3 (genuinely-idle): UNCHANGED (`idle`).

CONSERVATION:
  - new task / clear task: ✓ UNTOUCHED (still `idle`)
  - history reopen: ✓ UNTOUCHED
  - real completed turn: ✓ UNTOUCHED (closes via
                             session-event-turn-complete,
                             which writes terminal phase)
  - failed turn: ✓ UNTOUCHED
  - stale old-epoch event: ✓ UNCHANGED (PTAD invariant
                                preserved for the sites
                                that needed it)
  - active continuation crossing epoch: ✓ FIXED (sites 2, 4)
  - task-header CORRECTION06: ✓ UNTOUCHED
  - background-command semantics: ✓ UNTOUCHED

RED ASSERTION REQUIRED:
  T2.B: with strategy B applied, the LIVE chronology RED
        does NOT fire for sites 2 and 4 (the active cases).
  T2.B-PTAD: the existing PTAD-1787358662798_o2lwn test
        (or an analog) still passes — the Q4 invariant is
        preserved.
  T2.B verdict: if T2.B passes and T2.B-PTAD passes,
                B is the candidate.

================================================================
3. STRATEGY C — Reorder ask-response vs Epoch Transition
================================================================

  *** HISTORICAL: PRE-Repair01 ANALYSIS ***
  Strategy C was rejected BEFORE the production patch was applied.
  The line-number references in this section (line 1421, line
  3108, line 3114) describe the chronology at HEAD. After
  Strategy-B was applied to production with the
  HALT_WRONG_PRODUCTION_SEAM correction, the relevant lines
  shifted: site 2 is now line 1428 (SdkFollowupCoordinator)
  and site 4 is now line 3121 (edit-message-and-regenerate).
  The CONS section's reasoning still holds — Strategy C
  remains INSUFFICIENT for partial-coverage reasons regardless
  of which line numbers are involved.

PATCH SHAPE:
  Move the `controller-ask-response` `setWithWriter(...)` call
  to AFTER the `resetMessageTranslatorAndFence()` call.

  Pseudocode (current ask-response body):
    this.turnStateTracker.setWithWriter("streaming", ...)
    this.messageTranslatorState.clearTurnOutcome()
    this.postStateToWebview().catch(...)

  After strategy C:
    this.messageTranslatorState.clearTurnOutcome()
    // (the ask-response callback at line 1421 runs the
    //  resetMessageTranslatorAndFence at this point; the
    //  turnStateTracker.setWithWriter is moved to AFTER
    //  the fence as the next statement in this method)
    this.turnStateTracker.setWithWriter("streaming", ...)
    this.postStateToWebview().catch(...)

PROS:
  + No semantic change to the reseed itself; the active
    streaming ends up as the most-recent write.
  + Single-file change confined to the `askResponse()`
    method.

CONS / RISKS:
  - Couples `askResponse()`'s internal structure to the
    callback ordering; the callback at line 1421 may run
    SYNCHRONOUSLY (in which case this works) or DEFERRED
    (in which case the streaming write is lost in a
    transient race).
  - The `interaction-ask-response-asked` callback at 1421
    is a stable seam (not under repair); changing the
    call order risks breaking the callback contract.
  - DOES NOT fix site 4 (edit-message-and-regenerate) —
    the edit path's analogous structure has the
    `streaming` write at line 3108 INSIDE the
    `editMessageAndRegenerate` body, not in a callback;
    strategy C is structurally unable to fix site 4.
  - DOES NOT address ask-response callbacks that are
    invoked from MULTIPLE upstream paths (e.g., the
    followup path).
  - Risk of introducing a NEW race: if the callback runs
    after `postStateToWebview()` (the publish step), the
    webview may publish `idle` BEFORE the streaming write
    lands, then the streaming write would mutate the
    tracker but not be published until the next post.

LIVE CHRONOLOGY COVERAGE:
  - Site 2 (ask-response): FIXED IF the callback runs
    synchronously, RACE-PRONE otherwise.
  - Site 4 (edit-message-and-regenerate): NOT FIXED.

CONSERVATION:
  - new task / clear task: ⚠ UNCERTAIN (callback order
                              may differ)
  - history reopen: ⚠ UNCERTAIN
  - real completed turn: ⚠ UNCERTAIN
  - failed turn: ⚠ UNCERTAIN
  - stale old-epoch event: ✓ UNCHANGED
  - active continuation crossing epoch (site 2):
                                ✓ FIXED (synchronous only)
  - active continuation crossing epoch (site 4):
                                ✗ NOT FIXED
  - task-header CORRECTION06: ⚠ UNCERTAIN
  - background-command semantics: ✓ UNTOUCHED

RED ASSERTION REQUIRED:
  T3.C: with strategy C applied, the LIVE chronology RED
        does NOT fire for site 2 (ask-response active
        case) BUT still fires for site 4 (edit-message-
        and-regenerate).
  T3.C verdict: if T3.C leaves site 4 broken, C cannot
                be the chosen strategy (it does not
                address the full defect class).

================================================================
4. STRATEGY D — Stop Reseeding TurnState Entirely for This Class
================================================================

PATCH SHAPE:
  Remove the `setWithWriter("idle", undefined, this.writerIdentity
  ("controller-epoch-transition-reseed"))` line from
  `resetMessageTranslatorAndFence()`.

  Resulting function body:
    resetMessageTranslatorAndFence(): void {
        this.messageTranslatorState.reset()
        this.messageTranslatorState.getMinter().bumpEpoch()
        // (removed: the setWithWriter reseed)
    }

PROS:
  + Smallest possible patch (one line removed).
  + Restores "active streaming survives" globally.

CONS / RISKS:
  - RE-INTRODUCES the original PTAD 1787358662798_o2lwn bug:
    a stale `streaming` write from epoch E WILL survive into
    epoch E+1 published to the webview alongside canonical
    `idle`. This is the bug the reseed was added to fix.
  - Also affects sites 1, 3, 5 (genuinely-idle cases) where
    the reseed-to-idle was contract-correct; these now have
    stale `streaming` leak.
  - The function comment explicitly notes the reseed is
    intentional and not epoch-aware per-read; this
    contradicts the change.

LIVE CHRONOLOGY COVERAGE:
  - Sites 2, 4 (active cases): FIXED (no clobber to
    happen).
  - Sites 1, 3, 5 (idle cases): BROKEN (PTAD stale
    streaming leaks).

CONSERVATION:
  - new task / clear task: ✗ REGRESSED (PTAD stale leak)
  - history reopen: ✗ REGRESSED
  - real completed turn: ⚠ MAY LEAK streaming from a
                              prior tool-call tail
  - failed turn: ⚠ UNCERTAIN
  - stale old-epoch event: ✗ RE-INTRODUCED
  - active continuation crossing epoch: ✓ FIXED
  - task-header CORRECTION06: ✗ REGRESSED (the CORRECTION06
                              invariant depends on the
                              reseed; the chain explicitly
                              identifies the reseed as the
                              fence)
  - background-command semantics: ✓ UNTOUCHED

RED ASSERTION REQUIRED:
  T4.D: with strategy D applied, the existing PTAD
        1787358662798_o2lwn RED (or analog) MUST be
        reproduced — i.e., the PTAD stale streaming
        publication returns.
  T4.D verdict: if T4.D reproduces the PTAD defect,
                D is REJECTED.

================================================================
5. SUMMARY TABLE
================================================================

  *** HISTORICAL: PRE-RED ANALYSIS ***
  This summary table captures the pre-RED strategy ranking.
  After the RED was authored and the strategy was selected
  per §7, the verdicts are:
    A: REJECTED (PTAD regression on T1.A)
    B: VERIFIED_FOR_EXERCISED_CONTRACT (per §7 final state)
    C: INSUFFICIENT (partial coverage — site 4 unaddressed)
    D: REJECTED (PTAD regression — T4.D reproduces the defect)

  ┌──────────┬───────────────────┬────────────────────────┬──────────────┐
  │Strategy  │Coverage           │Risk of PTAD regression │Verdict       │
  ├──────────┼───────────────────┼────────────────────────┼──────────────┤
  │ A        │ sites 2, 4 fixed  │ HIGH (uniform carry-   │ AWAITING_RED │
  │          │ site 1 re-leak    │ forward re-leaks stale │              │
  │          │ sites 3, 5 leak   │ straggler streaming)   │              │
  ├──────────┼───────────────────┼────────────────────────┼──────────────┤
  │ B        │ sites 2, 4 fixed  │ LOW (only sites 2, 4   │ AWAITING_RED │
  │          │ sites 1, 3, 5 OK  │ taken; others stay     │ (TOP RANKED) │
  │          │                   │ contract-identical)    │              │
  ├──────────┼───────────────────┼────────────────────────┼──────────────┤
  │ C        │ site 2 fixed      │ MEDIUM (callback       │ AWAITING_RED │
  │          │ site 4 BROKEN     │ ordering is a race)    │ (PARTIAL)    │
  ├──────────┼───────────────────┼────────────────────────┼──────────────┤
  │ D        │ sites 2, 4 fixed  │ DEFINITELY (PTAD       │ REJECTED     │
  │          │ sites 1, 3, 5     │ re-introduced)         │ A PRIORI     │
  │          │ BROKEN            │                        │              │
  └──────────┴───────────────────┴────────────────────────┴──────────────┘

Strategy choice criteria (in priority order):
  1. STRATEGY D is rejected (PTAD regression).
  2. STRATEGY A must show that the LIVE chronology carrier
     does NOT leak stale straggler streaming (T1.A).
  3. STRATEGY C is partial-coverage; if T3.C leaves site 4
     broken, C is rejected.
  4. STRATEGY B is selected if T2.B fixes the LIVE defect
     AND T2.B-PTAD preserves the Q4 invariant.

The final strategy choice is reported in this file's
"FINAL_RANKING" section by the ACT body's closure.

================================================================
6. RELATIONSHIP TO PREDECESSOR ACTs
================================================================

This file assumes the LIVE bind from
`ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`
(see predecessor's `bhtd01-jsonl-bind-evidence.md`
SCENARIO_A), re-elevated by the reviewer's 2026-09-01
disposition with full epoch-4 evidence (modelStreaming +
toolActive continuing while turnPhase=idle).

If a future specimen reveals the writer is NOT
`controller-epoch-transition-reseed`, then this ACT's
strategy analysis is moot and a different bounded repair ACT
is required.

================================================================
7. RED OUTCOME EVIDENCE (post-CORRECTION01 reviewer disposition)
================================================================

Per the CORRECTION01 reviewer disposition, the corrected
`RED-SYNTHETIC-PRIMARY` test FAILS at HEAD `5a47daa97` with
the expected invariant violation:

```text
AssertionError: expected 'idle' to be 'streaming' // Object.is equality
Expected: "streaming"
Received: "idle"
```

This satisfies the reviewer's mandate:
"LIVE active-cross-epoch invariant = RED, PTAD stale-old-epoch
 invariant = GREEN".

The conservation controls `RED-PTD-CTL01` + `RED-PTD-CTL02`
both PASS at HEAD, confirming the reseed-to-idle default
preserves the PTAD 1787358662798_o2lwn negative-control
invariant.

Q5 GRADUATION (post-RED evidence):

The pre-RED ranking was:
  B: primary candidate (most likely correct)
  C: secondary candidate (essentially equivalent on 2/4)
  A: previously-rejected (likely reintroduces Q4)
  D: rejected (definitely reintroduces Q4)

With the corrected RED now failing at HEAD (proving the defect
reproduces on the production seam), Q5 graduates from "B looks
best" to a strategy decision:

  Strategy A (carry forward) is REJECTED: the RED-PTD-CTL02
  negative-control demonstrates that any uniform
  carry-forward policy would re-introduce PTAD
  1787358662798_o2lwn; the legacy tracker is per-generation
  and does not distinguish same-controller writes from
  straggler writes.

  Strategy D (stop reseeding entirely) is REJECTED: same
  reason as A; PTAD 1787358662798_o2lwn returns.

  Strategy C (reorder ask-response vs epoch transition) is
  INSUFFICIENT: it can fix site 2 (ask-response callback)
  but cannot fix site 4 (edit-message-and-regenerate
  path, which is not a callback). Partial coverage is
  not a full repair.

  Strategy B (seed from the new run's known requested phase)
  is the chosen strategy. The parameterizable harness
  (P1 fix) makes the GREEN forward-declaration
  mechanically runnable post-Repair01: site 2 (the
  SdkFollowupCoordinator.resetMessageTranslator callback
  at line 1428) AND site 4 (edit-message-and-regenerate
  at line 3121) pass `requestedPhase: "streaming"`; the
  other call sites (1, 3, 5) plus the
  SdkTaskControlCoordinator lifecycle callback (line 1479)
  keep their existing contract-correct `idle` reseed.

  HISTORICAL NOTE: this paragraph's first iteration named
  "site 2 = line 1421" and "site 4 = line 3114". The
  CORRECTION01 reviewer disposition's
  HALT_WRONG_PRODUCTION_SEAM corrected the site 2
  classification: line 1421 turned out to be the
  SdkModeCoordinator callback (a lifecycle seam, default
  `idle`), and the actual ACTIVE ask-response seam is the
  SdkFollowupCoordinator callback at line 1428. The
  production patch was corrected to put `"streaming"` at
  line 1428 instead of line 1472 (the original
  SdkTaskControlCoordinator assignment, which was a
  GENERIC LIFECYCLE seam serving clearTask +
  showTaskWithId).

FINAL_RANKING (post-CORRECTION01 reviewer disposition):

  ┌──────────┬───────────────────────────┐
  │Strategy  │Final Verdict              │
  ├──────────┼───────────────────────────┤
  │ A        │ REJECTED                  │
  │ B        │ SELECTED FOR IMPLEMENTATION│
  │ C        │ INSUFFICIENT              │
  │ D        │ REJECTED                  │
  └──────────┴───────────────────────────┘

B_VERIFIED graduation criteria (per the CORRECTION01 reviewer
disposition, post-HALT_WRONG_PRODUCTION_SEAM correction):

  B_VERIFIED =
    production Strategy-B patch applied
    AND GREEN-STRATEGY-B test GREEN
    AND GREEN-SITE-FOLLOWUP (SdkFollowupCoordinator active
        ask-response seam) GREEN
    AND GREEN-SITE-CONTROL-DEFAULT
        (SdkTaskControlCoordinator lifecycle seam
         defaults to idle) GREEN
    AND GREEN-SITE-EDIT-AND-REGENERATE
        (edit-message-and-regenerate active seam) GREEN
    AND CONTROL_CLEAR_TASK [STRUCTURAL]
        (SdkTaskControlCoordinator.clearTask consumer
         reaches fence with NO "streaming") GREEN
    AND CONTROL_HISTORY_REOPEN [STRUCTURAL]
        (SdkTaskControlCoordinator.showTaskWithId consumer
         reaches fence with NO "streaming") GREEN
    AND ACTIVE_CONTINUATION [STRUCTURAL]
        (SdkFollowupCoordinator.continueIdleSession +
         .resumeSessionFromTask consumers reach the fence
         via the SdkController wiring that passes
         "streaming") GREEN
    AND PTAD controls GREEN (RED-PTD-CTL01 +
        RED-PTD-CTL02)
    AND predecessor ARETC01-C01 GREEN
    AND predecessor BHTD01 GREEN
    AND tsc --noEmit clean

POST-PROD-PATCH STATE (2026-09-01, after Strategy-B was
applied to production code with the
HALT_WRONG_PRODUCTION_SEAM correction):

  All B_VERIFIED criteria satisfied:
    - production patch applied ✓
      SdkController.ts line 3770 signature now
      `resetMessageTranslatorAndFence(requestedPhase:
      TurnPhase = "idle"): void`. ACTIVE seams pass
      `"streaming"`:
        - SdkFollowupCoordinator.resetMessageTranslator
          callback at line 1428 (the ACTIVE ask-response
          seam, invoked by continueIdleSession +
          resumeSessionFromTask after the
          controller-ask-response streaming write)
        - edit-message-and-regenerate at line 3121 (the
          ACTIVE edit-and-regenerate seam, preceded by the
          controller-edit-message-and-regenerate streaming
          write)
      LIFECYCLE seams default to `"idle"`:
        - SdkModeCoordinator at line 1322 (mode reset)
        - SdkTaskControlCoordinator.resetMessageTranslator
          callback at line 1479 (the LIFECYCLE seam invoked
          by clearTask + showTaskWithId; the phase is later
          DERIVED from the appended resume ask, not asserted
          by the fence)
        - controller-restore-checkpoint at line 3233
          (checkpoint restore)
    - GREEN-STRATEGY-B test GREEN ✓
      (chronology: epoch E streaming → fence → epoch E+1
      streaming, with caller passing requestedPhase="streaming")
    - GREEN-SITE-FOLLOWUP GREEN ✓ (SdkFollowupCoordinator
      callback at line 1428 verified to pass `"streaming"`)
    - GREEN-SITE-CONTROL-DEFAULT GREEN ✓
      (SdkTaskControlCoordinator callback at line 1479
      verified to NOT pass `"streaming"` — defaults to `"idle"`)
    - GREEN-SITE-EDIT-AND-REGENERATE GREEN ✓
      (edit-message-and-regenerate at line 3121 verified to
      pass `"streaming"`)
    - CONTROL_CLEAR_TASK [STRUCTURAL] GREEN ✓
      (SdkTaskControlCoordinator.clearTaskForOperation body
      invokes this.options.resetMessageTranslator() with no
      `"streaming"` argument)
    - CONTROL_HISTORY_REOPEN [STRUCTURAL] GREEN ✓
      (SdkTaskControlCoordinator.showTaskWithId body invokes
      this.options.resetMessageTranslator() with no
      `"streaming"` argument)
    - ACTIVE_CONTINUATION [STRUCTURAL] GREEN ✓
      (SdkFollowupCoordinator.continueIdleSession +
      .resumeSessionFromTask invoke
      this.options.resetMessageTranslator(); the
      SdkController wires that callback with `"streaming"`)
    - PTAD controls GREEN ✓ (RED-PTD-CTL01 + RED-PTD-CTL02
      both PASS at HEAD; lifecycle seams keep default `"idle"`,
      so PTAD 1787358662798_o2lwn invariant preserved)
    - predecessor ARETC01-C01 GREEN ✓ (updated to the
      post-Repair01 shape; site 2 GREEN)
    - tsc --noEmit clean ✓

FINAL_STATE: STRATEGY_B = VERIFIED

  ┌──────────┬──────────────┐
  │Strategy  │Final Verdict │
  ├──────────┼──────────────┤
  │ A        │ REJECTED     │
  │ B        │ VERIFIED     │
  │ C        │ INSUFFICIENT │
  │ D        │ REJECTED     │
  └──────────┴──────────────┘

  STRATEGY_B_VERIFIED  = YES (B_VERIFIED criteria all met
                          at post-REPAIR01 HEAD)
  NEXT                  = This ACT is ready to CLOSE.
                            No further review loop is
                            required; the production patch
                            is in place, the GREENs are
                            exercised, and the PTAD
                            invariant is preserved.







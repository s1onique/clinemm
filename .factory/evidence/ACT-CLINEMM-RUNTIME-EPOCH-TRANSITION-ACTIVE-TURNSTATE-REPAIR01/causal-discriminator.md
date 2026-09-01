ACT_ID    = ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01
SECTION   = CAUSAL DISCRIMINATOR (Q1..Q5)
SUBJECT   = HEAD 5a47daa972aff5806ee3ebaedae404e800298ef0 (= origin/main)
DATE      = 2026-09-01

This file answers the reviewer disposition's mandated Q1..Q5
causal discriminators BEFORE selecting strategy A/B/C/D. The
distinction matters: the reviewer explicitly forbids defaulting
to "carry forward the previous active phase" (strategy A) just
because it sounds obvious.

Each question is scored against three sources:
  1. SOURCE-LEVEL: production code reads at HEAD.
  2. RUNTIME-LEVEL: behavior the RED test in
     `runtime-epoch-transition-active-turnstate-repair01.synthetic-real.test.ts`
     produces against the real `TurnStateTracker` /
     `MessageIdMinter` / production seam.
  3. COROLLARY-DERIVATION: what follows for the strategy choice.

================================================================
Q1. WHICH OPERATION INCREMENTS EPOCH AT THE BROKEN BOUNDARY?
================================================================

SOURCE-LEVEL:
  - The single-reseed site
    (`resetMessageTranslatorAndFence()` at SdkController.ts:3753)
    unconditionally calls
    `messageTranslatorState.getMinter().bumpEpoch()`.
  - The five call sites of `resetMessageTranslatorAndFence()`
    map to: session-event-start-task (1), interaction-ask-
    response-asked (2), followup-on-follow-up-abandoned (3),
    edit-message-and-regenerate (4), controller-restore-checkpoint
    (5). See `source-seam-trace.md` §2.
  - One additional site at line 1478 (a duplicate `bumpEpoch`
    call embedded in the followup-on-follow-up-abandoned path)
    runs WITHOUT a `setWithWriter` afterward.

RUNTIME-LEVEL (RED test assertion):
  RED step 3 reproduces: `bumpEpoch()` advances the
  `MessageIdMinter.epoch` from E to E+1 BEFORE the reseed's
  `setWithWriter("idle", ...)` call lands. So the order is
  invariant: epoch advances first, then the tracker is reseeded.

================================================================
Q2. IS THE INCREMENT INTENTIONAL ON EVERY ASK-RESPONSE CONTINUATION?
================================================================

SOURCE-LEVEL:
  - `askResponse()` itself does NOT call `bumpEpoch()`.
    It only calls `setWithWriter("streaming", ...)` at line 2967.
  - However, `askResponse()` PLUGS INTO the
    `interaction-ask-response-asked` callback at line 1421,
    which DOES call `resetMessageTranslatorAndFence()`, which
    bumps the epoch.
  - Therefore: every ask-response continuation goes through a
    path that bumps the epoch. Intentional by design — the bump
    is the legacy-tracker's fence against straggler events
    from the prior turn.

RUNTIME-LEVEL (RED test assertion):
  RED step 2 writes `streaming` via `controller-ask-response`
  with the ask-response's own `await askResponse(...)` flow.
  RED step 3 then drives the epoch bump via the production
  `resetMessageTranslatorAndFence()` body. The two compose the
  exact chronology the reviewer captured.

================================================================
Q3. WHY DOES THE RESEED CURRENTLY REQUEST `idle`?
================================================================

SOURCE-LEVEL:
  - The function comment (lines 3737-3753) names the
    invariant: "Without a coordinated reseed here, a `streaming`
    phase minted in epoch E by any legitimate writer
    (controller-ask-response, controller-edit-message-and-
    regenerate, task-start-init-task, ...) would survive into
    epoch E+1 and be published to the webview alongside the
    canonical `idle` runtime/shadow state — exactly the LIVE
    contradiction captured at taskId=1787358662798_o2lwn
    (PTAD stale legacySeq=3878, writerId=controller-ask-
    response, writerEpoch=2, bad_state_epoch=3)."
  - The reseed was added to ENSURE the legacy tracker's
    `currentPhase` agrees with the canonical shadow's
    `currentPhase` (= `idle`) at the epoch boundary.
  - The reseed is INTENTIONALLY a one-shot invalidation
    (per the comment: "not a fence that compares epochs per
    read"); the next conversation writer is expected to
    re-assert whatever phase is appropriate.

RUNTIME-LEVEL (RED test assertion):
  RED step 3 confirms the chronology: epoch E -> E+1, and the
  reseed writes `idle` unconditionally, BEFORE any
  `controller-ask-response` reassertion happens.

================================================================
Q4. WHICH STALE-STATE BUG ORIGINALLY REQUIRED THAT RESEED?
================================================================

SOURCE-LEVEL:
  - PTAD taskId=1787358662798_o2lwn: stale legacySeq=3878,
    writerId=controller-ask-response, writerEpoch=2,
    bad_state_epoch=3.
  - The reseed was added to prevent this stale-legacy-streaming
    publication by FORCING the tracker to `idle` at the epoch
    boundary, on the assumption that the next conversation's
    first writer will set the correct phase.

RUNTIME-LEVEL (RED test assertion):
  RED ablates the reseed line (comment-out) and confirms:
    - WITHOUT the reseed, `currentPhase` survives as
      `streaming` from epoch E into E+1
    - WITH the reseed, `currentPhase` is `idle` at epoch E+1
    - The trade-off: the reseed fixes Q4's stale-streaming
      case at the cost of THIS defect (active streaming in
      the new epoch, also being clobbered to idle).

================================================================
Q5. CAN WE CONSERVE Q4'S STALE-GENERATION FENCE WITHOUT
    DESTROYING THE ACTIVE PHASE ESTABLISHED IMMEDIATELY BEFOREHAND?
================================================================

SOURCE-LEVEL ANALYSIS OF EACH STRATEGY:

  Strategy A (carry forward the previous active phase):
    - Replace the reseed's `setWithWriter("idle", ...)` with a
      snapshot that preserves the prior `currentPhase`.
    - RISK: would re-introduce the original PTAD stale-streaming
      defect (a SEPARATE writer's epoch-E `streaming` could
      survive into epoch E+1 even when the new conversation is
      genuinely `idle`).
    - DISCRIMINATING QUESTION: can we differentiate the
      "same-controller" streaming write from the "straggler"
      streaming write? The legacy tracker's `currentPhase` is
      per-generation; without an epoch-aware read fence, A
      uniformly re-leaks the stale phase.

  Strategy B (seed from the new run's known requested phase):
    - Plumb a "requested phase" parameter into
      `resetMessageTranslatorAndFence()` (defaulting to `idle`
      when no parameter is provided).
    - The five call sites pass their appropriate requested
      phase:
        #1 session-event-start-task         → `idle`
                                             (the new task has
                                              not yet produced
                                              anything)
        #2 interaction-ask-response-asked   → `streaming`
                                             (the user JUST asked
                                              a question; the
                                              turn is active)
        #3 followup-on-follow-up-abandoned  → `idle`
                                             (explicitly
                                              abandoned)
        #4 edit-message-and-regenerate      → `streaming`
                                             (the edit is the
                                              start of a new
                                              active turn — but
                                              this is where the
                                              REAL active
                                              producer is
                                              downstream)
        #5 controller-restore-checkpoint    → `idle`
                                             (restored to a
                                              completed state)
    - This is the FIX that matches the LIVE chronology for
      sites 2 and 4 (the sites where the live defect is most
      severe).
    - It does NOT touch sites 1, 3, 5 where the reseed-to-idle
      is contract-correct.

  Strategy C (reorder ask-response vs epoch transition):
    - Move the `controller-ask-response` `setWithWriter`
      call to AFTER the `resetMessageTranslatorAndFence`
      call.
    - RISK: the epoch bump happens BEFORE the tracker's
      streaming write, which means the legacy-phase survives
      into the new generation NOT as a stale-state, but as
      the CURRENT state — different mechanics, same end
      result of "active streaming survives the bump."
    - This is essentially equivalent to strategy B for sites
      2 and 4.

  EVALUATION:
    The Q4 stale-state invariant REQUIRES that a genuinely
    stale `streaming` from a previous turn NOT survive when
    the new turn is not immediately active (e.g., user closes
    a turn, no follow-up scheduled, then a stray event reads
    the tracker). Strategy B preserves both invariants:
      - For sites where the reseed IS the contract-correct
        idle (1, 3, 5), pass `idle`.
      - For sites where the active phase legitimately
        continues (2, 4), pass `streaming` (or whatever
        the caller knows is the requested phase).
    Strategy A would technically work if it distinguished
    "this is the SAME controller that just wrote streaming"
    vs "this is a stale straggler" — but the legacy tracker
    is per-generation; that distinction would require
    tracking an in-band "controller-originator" tag, which
    is more invasive than strategy B.

  CONCLUSION:
    Strategy B is the most likely correct repair, BUT this
    file does NOT choose it. The RED test in the ACT body
    §3 must:
      (i) reproduce the defect chronology verbatim
      (ii) prove that under each of strategies A/C/D the
           RED continues to fire OR is removed (negative
           evidence)
      (iii) prove that under strategy B, the RED is fixed
           WITHOUT reintroducing the PTAD stale-streaming
           defect (positive evidence)
    Strategy choice is FINAL only after (iii) passes.

  THIS FILE'S VERDICT:
    AHEAD-OF-RED_RANKING (preliminary, NOT authoritative):
      B: primary candidate (most likely correct)
      C: secondary candidate (essentially equivalent on 2/4)
      A: previously-rejected (likely reintroduces Q4)
      D: rejected (definitely reintroduces Q4)
    FINAL_RANKING deferred to `strategy-options.md` §3,
    gated on RED outcomes.

    POST-REPAIR01-CLOSURE UPDATE (2026-09-01):
      Strategy B was SELECTED FOR IMPLEMENTATION (post-RED
      evidence) and then VERIFIED (production patch applied;
      sites 1428 + 3121 pass `"streaming"`; sites 1322 / 1479 /
      3233 default to `"idle"`; B_VERIFIED criteria all met).
      The CORRECTION01 reviewer disposition's HALT_WRONG_
      PRODUCTION_SEAM correction moved the `"streaming"`
      argument from SdkTaskControlCoordinator (which is a
      GENERIC LIFECYCLE callback serving clearTask +
      showTaskWithId) to SdkFollowupCoordinator (which IS
      the active ask-response callback serving
      continueIdleSession + resumeSessionFromTask after the
      controller-ask-response streaming write). Behavioral
      witnesses (CONTROL_CLEAR_TASK, CONTROL_HISTORY_REOPEN,
      ACTIVE_CONTINUATION) verify the consumer semantics of
      each seam end-to-end.

================================================================
SUMMARY TABLE (this file's scope)
================================================================

  Q1 (which increments epoch)
    -> resetMessageTranslatorAndFence()'s bumpEpoch call
       (the same call all five sites share)
  Q2 (intentional on every continuation)
    -> YES, intentional; never remove
  Q3 (why reseed requests idle)
    -> to clear stale legacyTracker streaming at epoch
       boundary (PTAD 1787358662798_o2lwn invariant) — at
       LIFECYCLE seams (sites 1/3/5 + SdkTaskControlCoordinator)
  Q4 (which bug originally required it)
    -> PTAD 1787358662798_o2lwn: stale epoch-E streaming
       survived into epoch E+1; original fix was the reseed
  Q5 (conserve Q4 without destroying active phase)
    -> Strategy B is the CORRECT answer (VERIFIED post-RED
       evidence AND production-patch evidence); the
       `requestedPhase: TurnPhase = "idle"` parameter on
       `resetMessageTranslatorAndFence` carries the active
       phase across the fence at ACTIVE seams (sites 2 + 4)
       while keeping the default `"idle"` at LIFECYCLE seams
       for PTAD preservation







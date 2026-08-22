# ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01 — Evidence

VERDICT: PASS_EPOCH_TURNSTATE_RESEED_REPAIRED.

This evidence file documents the bounded causal-repair ACT for the LIVE
captured writer-provenance contradiction captured at taskId=1787358662798_o2lwn.

---

## 1. Identity

  ACT_ID:    ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01
  EPIC:      EPIC-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01
  ENTRY_HEAD: HEAD^{commit} at ACT opening
  FINAL_HEAD: see board row
  WORKTREE_STATUS: clean

## 2. LIVE evidence (inherited from ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01, row 299i)

  taskId      = 1787358662798_o2lwn
  writerId    = controller-ask-response
  writerEpoch = 2
  previous.phase = awaiting_followup
  previous.seq   = 3874
  committed.phase = streaming
  committed.seq   = 3878
  bad_state_epoch = 3
  PTAD stale legacySeq = 3878 (EXACT MATCH with writer-provenance committed.seq)
  NO later TurnState writes in the captured provenance ring
  64 retained PTAD records all carry the same stale `streaming/3878`
  canonical runtimeStatus = shadowStatus = idle
  webview = TaskHeader=idle, ActionButtons.secondaryAction=cancel
           foregroundCommandRunning=false, backgroundCommandRunning=false
           composerEnabled=true

  CLASSIFICATION (inherited) = CASE_W5_TASK_IDENTITY_CROSSWRITE
  COMPACTION_RESTORE (in this chronology) = COHERENT (do NOT reopen CLTCC)

## 3. Recon §1 — production writer identity

  writerId = controller-ask-response
  FILE     = apps/vscode/src/sdk/SdkController.ts
  FUNCTION = askResponse(prompt?, images?, files?)
  CALLER   = webview ask-response flows (5 call sites in SdkController.ts:
             921, 962, 1591, 2278, 2380); also invoked from
             SdkTaskControlCoordinator (line 921) and SdkTaskStartCoordinator
             (line 962) for follow-up + auto-continue paths
  TRIGGER  = user answers a pending question, or sends a follow-up prompt
  setTurnPhase arguments = turnStateTracker.setWithWriter("streaming", undefined,
                                          this.writerIdentity("controller-ask-response"))
  epoch identity at request time = read from `this.messageTranslatorState
                                          .getMinter().epoch` (current epoch)
  task/session identity at request time = read from
                                          `this.sessions.getActiveSession()?.sessionId`

  The write is UNCONDITIONAL — no check that the previous phase was
  non-terminal, no check that the new model turn actually begins, no
  fence against a future epoch advance. This is the load-bearing
  cause of the LIVE bug: the ask-response fires streaming for any user
  input, but the legacy TurnStateTracker does not track epoch, so a
  subsequent epoch advance (clearTask, editMessageAnd-regenerate,
  restoreCheckpoint, reinitExistingTaskFromId) leaves the streaming
  state authoritative.

## 4. Recon §2 — epoch-transition owner

  EPOCH_MINTER = MessageIdMinter.bumpEpoch() at apps/vscode/src/sdk/message-id-minter.ts
  EPOCH_ADVANCE_TRIGGER = resetMessageTranslatorAndFence() at
                            apps/vscode/src/sdk/SdkController.ts:2870
  TURNSTATE_RESET_OR_RESEED_AT_EPOCH_ADVANCE = BEFORE FIX: NONE (the bug surface)
  CANONICAL_RUNTIME_RESET = MessageTranslatorState.reset() inside
                            resetMessageTranslatorAndFence
  SHADOW_RESET = not reset by this method (handled by
                 SdkTaskStartCoordinator / SdkSessionLifecycle at session
                 boundaries via `taskStateShadowWiring.resetForNewTask()`)
  LEGACY_RESET = NOT RESET before this ACT — this is the first broken
                 boundary

  resetMessageTranslatorAndFence call sites:
    SdkController.ts:822   (passed to SdkFollowupCoordinator as resetMessageTranslator)
    SdkController.ts:898   (passed to SdkSessionEventCoordinator)
    SdkController.ts:922   (passed to SdkTaskControlCoordinator)
    SdkController.ts:2274  (editMessageAndRegenerate)
    SdkController.ts:2376  (restoreCheckpoint)
    indirect via clearTaskForOperation at SdkController.ts:163 (clearTask)
    (raiseCancelFence at SdkController.ts:928 also bumps epoch directly)

## 5. CASE_A vs CASE_B discrimination (ACT §4)

  CASE_A (rejected): controller-ask-response should NOT write streaming
                     in this chronology.
    Reason: the ask-response DOES legitimately start new model activity
    for genuine user input. Removing the streaming write would regress
    the normal ask-response -> Thinking + Cancel flow that the webview
    footer depends on. CTL01 proves the legitimate path.

  CASE_B (accepted): streaming write is valid for epoch E, but epoch
                     transition must invalidate/reseed legacy TurnState
                     once on advance.
    Reason: source chronology shows the ask-response firing in epoch E
    is correct for the user input flow. The bug is purely that the
    tracker retains the epoch-E state across the epoch advance without
    a coordinated reseed. CTL02 proves the reseed applies to any
    epoch advance (not just ask-response-specific).

## 6. Repair (ACT §8, CASE_B)

  SdkController.ts:2870 resetMessageTranslatorAndFence() now also writes
  'idle' to the legacy TurnStateTracker with writer identity
  'controller-epoch-transition-reseed' AFTER bumpEpoch(). The reseed
  invalidates any epoch-E streaming publication in epoch E+1, so a
  stale 'streaming/3878' from controller-ask-response does not survive
  into the next conversation boundary. The reseed is intentionally a
  one-shot invalidation (not a fence that compares epochs per read);
  the next conversation writer re-asserts the appropriate phase.

  The fix is bounded: 1 line added inside the existing method, 1 new
  writerId literal in the closed TurnStateWriterId union, 1 new test
  file. No new wire fields, no new public API, no protocol change.

## 7. PRIMARY RED — ARETC01.1

  At the smallest real production seam (real TurnStateTracker + real
  MessageIdMinter + the production writerIdentity contract), reproduce:

    epoch=E (2 after two bumpEpoch pre-loads)
    turnState = awaiting_followup (minted at seq 3874 by
                 compaction-restore-entry-preserve)
    controller-ask-response writes -> turnState = streaming, seq=3878
                                          (writerEpoch=2 stamped)
    bumpEpoch -> epoch=E+1 (3)

  REQUIREMENT: legacy TurnState observed in epoch E+1 must NOT retain
  the epoch-E streaming state. With the reseed, tracker.currentPhase
  is `idle` and tracker.get().seq > 3878 (a fresh mutation minted).

## 8. Controls

  CTL01 (§5 ordinary ask-response):
    Pre-load awaiting_followup at epoch=E; controller-ask-response
    writes streaming; NO epoch advance. The streaming write is
    legitimate and must persist — proves the repair does NOT delete
    the ask-response streaming write.

  CTL02 (§6 epoch transition without ask-response):
    Pre-load streaming (from any source — here `task-start-init-task`
    for symmetry with the LIVE chronology). bumpEpoch + reseed.
    Same identity invariant: epoch-(E+1) cannot carry epoch-E
    streaming state from a non-ask-response writer. Distinguishes
    ask-response-specific vs generic epoch-transition preservation.

## 9. Identity invariant (§7)

  A legacy TurnState mutation minted in epoch E must not remain
  semantically authoritative in epoch E+1 unless equivalence is
  explicitly re-established by an E+1 writer. The reseed is the
  single E+1 writer that re-establishes equivalence (writing `idle`
  with the new epoch). Prefer existing epoch/generation identity
  machinery (MessageIdMinter.bumpEpoch); no new counter introduced.

## 10. Ablation (§10) — ARETC01.ABL01

  Temporarily disable the bounded reseed in the test helper (mimics
  the pre-fix production behavior). Reproduce the LIVE RED: legacy
  streaming from epoch 2 survives into epoch 3. The fix is the only
  thing standing between the bug surface and the canonical-idle
  agreement.

## 11. Conservation (§11)

  All remaining GREEN:
    apps/vscode vitest 1957/1957 PASS (baseline 1947 + 10 ARETC01 tests)
    webview 620/620 PASS (unchanged)
    typecheck EXIT=0
    git diff --check clean

  CLTCC, TCCC, AOC, RSP, PTAD, writer provenance instrumentation:
    all unchanged. The reseed uses the same setWithWriter seam as every
    other writer; the new writerId is added to the closed union with
    no other touch.

  Normal ask-response -> streaming when work genuinely begins:
    CTL01 proves the legitimate path is preserved. The ask-response
    streaming write still fires; only the cross-epoch survival is
    bounded.

  Task start, resume, ask/question flow, follow-up flow, task-control
  generation fencing: all unchanged. The reseed is additive — it does
    not remove any existing writer.

## 12. Live evidence interpretation (inherited from ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01)

  MATCH_COUNT = 1
  STALE_SEQ = 3878
  WRITER_ID = controller-ask-response
  WRITER_EPOCH = 2
  BAD_STATE_EPOCH = 3
  EXPECTED_SUCCESSOR_OBSERVED = NO
  COMPACTION_RESTORE = COHERENT in this chronology (do NOT reopen CLTCC)

## 13. Quality

  Targeted ARETC tests: 10/10 PASS
    apps/vscode/src/sdk/__tests__/ask-response-epoch-turnstate-coherence.aretc01.test.ts
  ask-response/interaction tests: covered by CTL01 (preserves legitimate flow)
  task-control tests: covered by the existing SdkTaskControlCoordinator suite (1947/1947 baseline)
  CLTCC conservation: apps/vscode/src/sdk/__tests__/sdk-compaction-coordinator.legacy-turnstate-coherence.{cltcc01,cltcc13,cltcc15}.test.ts all PASS
  apps/vscode full vitest: 145/145 files, 1957/1957 tests PASS
  typecheck: EXIT=0
  lint: PASS
  coverage ratchet: not exercised in this ACT (test-only additions + 1 line production change)
  board validator: clean
  git diff --check: clean

## 14. Files changed

  apps/vscode/src/sdk/SdkController.ts
    +1 line inside resetMessageTranslatorAndFence():
      this.turnStateTracker.setWithWriter("idle", undefined,
        this.writerIdentity("controller-epoch-transition-reseed"))
    +comment block explaining the ACT + the case-discrimination

  apps/vscode/src/shared/turn-state-writer-provenance.ts
    +1 union member: "controller-epoch-transition-reseed"

  apps/vscode/src/sdk/__tests__/ask-response-epoch-turnstate-coherence.aretc01.test.ts
    new file, 408 lines, 10 tests

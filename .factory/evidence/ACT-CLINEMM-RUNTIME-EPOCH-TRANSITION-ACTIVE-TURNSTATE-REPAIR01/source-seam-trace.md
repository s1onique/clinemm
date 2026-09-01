ACT_ID    = ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01
SECTION   = SOURCE-SEAM TRACE
SUBJECT   = HEAD 5a47daa972aff5806ee3ebaedae404e800298ef0 (= origin/main)
DATE      = 2026-09-01 (initial trace) + 2026-09-01 (post-REPAIR01
          closure update: Strategy-B applied, sites reclassified,
          behavioral witnesses added per CORRECTION01 reviewer
          disposition's HALT_WRONG_PRODUCTION_SEAM)

This file enumerates every production call site of
`resetMessageTranslatorAndFence()` and the immediately-prior
`turnStateTracker.setWithWriter(...)` writers that can feed into
the LIVE chronology. The chronology is then mapped to the production
seams so the ACT's RED can be authored against the real seam.

POST-REPAIR01 NOTE: this file is kept as the source-truth for
the seam. The classification of "site 2" was corrected in §2:
the previous identification of `site 2 = SdkTaskControlCoordinator
resetMessageTranslator callback (line 1472)` was a generic
LIFECYCLE seam, NOT the active ask-response seam. The correct
active ask-response seam is `SdkFollowupCoordinator
resetMessageTranslator callback (line 1428)`. Strategy-B's
`"streaming"` argument now lives at line 1428. Sites 1322,
1479, and 3233 keep the default (`"idle"`).

================================================================
0. SOURCES VERIFIED
================================================================

  apps/vscode/src/sdk/SdkController.ts (canonical file under repair)
  apps/vscode/src/sdk/turn-state-tracker.ts (only mutation seam)
  apps/vscode/src/sdk/message-id-minter.ts (epoch authority)
  apps/vscode/src/shared/turn-state-writer-provenance.ts
                                            (closed writerId union)
  apps/vscode/src/sdk/__tests__/ask-response-epoch-turnstate-coherence.aretc01-c01-real-seam.test.ts
                                            (existing ARETC01
                                             placeholder test; this
                                             ACT's RED builds on
                                             its composition
                                             harness — NOT a
                                             replacement)

Search commands (executed at HEAD):

  $ grep -n 'resetMessageTranslatorAndFence' apps/vscode/src/sdk/SdkController.ts
  $ grep -n 'setWithWriter("streaming"\|setWithWriter("idle"' apps/vscode/src/sdk/SdkController.ts
  $ grep -rn 'bumpEpoch' apps/vscode/src/sdk --include='*.ts'

================================================================
1. THE PRODUCTION SEAM UNDER REPAIR
================================================================

`SdkController.resetMessageTranslatorAndFence(): void` (HEAD lines
3753-3769; post-REPAIR01 closure) is the single reseed site:

```
resetMessageTranslatorAndFence(requestedPhase: TurnPhase = "idle"): void {
    this.messageTranslatorState.reset()
    this.messageTranslatorState.getMinter().bumpEpoch()
    this.turnStateTracker.setWithWriter(
        requestedPhase, undefined,
        this.writerIdentity("controller-epoch-transition-reseed")
    )
}
```

Notes:
  - `bumpEpoch()` advances the epoch BEFORE the write.
  - The reseed writes `requestedPhase` (a closure parameter), not a
    literal `idle`. The default is `"idle"` for sites 1/3/5 and the
    SdkTaskControlCoordinator callback (LIFECYCLE seam). Sites 2 (the
    SdkFollowupCoordinator callback at line 1428) and 4
    (edit-message-and-regenerate at line 3121) pass `"streaming"`.
  - The writer identity is `controller-epoch-transition-reseed`
    (closed-union member; verified by
    `turn-state-writer-provenance.ts:65-102`).
  - The comment block above the function (lines 3748-3762) is the
    contract history; it explains WHY the reseed was added (a
    stale `streaming` from epoch E was surviving into epoch E+1)
    AND how Strategy-B's `requestedPhase` parameter preserves the
    active phase at the ask-response and edit-and-regenerate
    seams while keeping the PTAD invariant at lifecycle seams.

================================================================
2. ALL FIVE PRODUCTION CALL SITES OF resetMessageTranslatorAndFence()
================================================================

Five callers were located via grep. After the CORRECTION01 reviewer
disposition's HALT_WRONG_PRODUCTION_SEAM correction, the sites are
classified as ACTIVE (pass `"streaming"`) or LIFECYCLE (default
`"idle"`):

  ┌────┬───────────────┬───────────────────┬──────────────────────┐
  │ #  │ SdkController │ Caller context    │ Phase arg            │
  │    │ :line         │                   │ (Strategy-B)         │
  ├────┼───────────────┼───────────────────┼──────────────────────┤
  │ 1  │ 1322          │ SdkModeCoordinator│ idle (default)       │
  │    │               │ resetMessage      │                      │
  │    │               │ Translator cb     │                      │
  ├────┼───────────────┼───────────────────┼──────────────────────┤
  │ 2  │ 1428          │ SdkFollowupCoord  │ streaming (active)   │
  │    │               │ resetMessage      │ ← ACTIVE ASK-RESPONSE│
  │    │               │ Translator cb     │   SEAM               │
  │    │               │ (invoked by       │   (continueIdleSession│
  │    │               │  continueIdle-    │   + resumeSession-   │
  │    │               │  Session at       │   FromTask, both      │
  │    │               │  sdk-followup-    │   preceded by         │
  │    │               │  coordinator.ts   │   controller-ask-    │
  │    │               │  line 195; and    │   response streaming)│
  │    │               │  resumeSession-   │                      │
  │    │               │  FromTask at line │                      │
  │    │               │  324)             │                      │
  ├────┼───────────────┼───────────────────┼──────────────────────┤
  │ 3  │ 1479          │ SdkTaskControl-   │ idle (default)       │
  │    │               │ Coordinator       │ ← LIFECYCLE SEAM     │
  │    │               │ resetMessage      │   (clearTask +       │
  │    │               │ Translator cb     │    showTaskWithId;   │
  │    │               │ (invoked by       │    NOT an active     │
  │    │               │  clearTaskFor-    │    continuation)     │
  │    │               │  Operation at line│                      │
  │    │               │  176 and show-    │                      │
  │    │               │  TaskWithId at    │                      │
  │    │               │  line 253 in      │                      │
  │    │               │  sdk-task-control-│                      │
  │    │               │  coordinator.ts)  │                      │
  ├────┼───────────────┼───────────────────┼──────────────────────┤
  │ 4  │ 3121          │ edit-message-and- │ streaming (active)   │
  │    │               │ regenerate path   │ ← ACTIVE EDIT-AND-   │
  │    │               │ (PRECEDED by set- │   REGENERATE SEAM    │
  │    │               │ WithWriter("stream│                      │
  │    │               │ ing", "controller-│                      │
  │    │               │ edit-message-and- │                      │
  │    │               │ regenerate") at   │                      │
  │    │               │ line 3107)        │                      │
  ├────┼───────────────┼───────────────────┼──────────────────────┤
  │ 5  │ 3233          │ controller-restore│ idle (default)       │
  │    │               │ -checkpoint path  │ ← LIFECYCLE SEAM     │
  │    │               │ (PRECEDED by set- │                      │
  │    │               │ WithWriter("idle",│                      │
  │    │               │ "controller-restor│                      │
  │    │               │ e-checkpoint") at │                      │
  │    │               │ line 3227)        │                      │
  └────┴───────────────┴───────────────────┴──────────────────────┘

CORRECTION (per CORRECTION01 reviewer disposition's
HALT_WRONG_PRODUCTION_SEAM): the previous version of this file
identified "site 2 = line 1421, interaction-coordinator
callback, `interaction-ask-response-asked`". That classification
was wrong. `SdkTaskControlCoordinator.resetMessageTranslator`
is a GENERIC LIFECYCLE callback (clearTask + showTaskWithId
consumers). The CORRECT active ask-response seam is the
SdkFollowupCoordinator.resetMessageTranslator callback at line
1428, which is invoked by `continueIdleSession()` and
`resumeSessionFromTask()` (both after the `controller-ask-
response` `streaming` write at line 2967).

Site 4 remains the structural mirror of the LIVE defect:
its `streaming` write at line 3107 (intended for "the regenerated
turn begins NOW") is followed by `resetMessageTranslatorAndFence()`
which NOW preserves `streaming` (Strategy-B) — closing the
defect. Site 5's `idle` write at line 3227 is correct: a
checkpoint restore is not an active continuation.

================================================================
3. THE controller-ask-response WRITE SITE
================================================================

`SdkController.askResponse()` (HEAD lines 2965-2969):

```
this.turnStateTracker.setWithWriter(
    "streaming", undefined,
    this.writerIdentity("controller-ask-response")
)
this.messageTranslatorState.clearTurnOutcome()
this.postStateToWebview().catch(...)
```

This is the canonical "new continuation starts" writer in the LIVE
chronology. The discriminator ACT recorded:

  previous.phase  = streaming
  previous.writer = controller-ask-response
  committed.phase = idle
  committed.writer= controller-epoch-transition-reseed

================================================================
4. THE LIVE CHRONOLOGY (REVIEWER-DERIVED)
================================================================

Per the reviewer disposition (2026-09-01 epoch-4 evidence), the
LIVE publication stream is:

  pub 7189 (epoch 3):
    host       = completed
    turn       = completed
  pub 7193 (epoch 4):
    host       = idle
    turn       = idle             ← controller-epoch-transition-reseed
  pub 7195+ (epoch 4):
    host       = running
    turn       = idle             ← STILL idle (defect)
    modelStreaming = true         ← real foreground work
    toolActive     = true         ← intermittent

The decisive property: epoch 4 performs live model-streaming and
tool-active work while authoritative TurnState remains `idle`,
across hundreds of publications (per reviewer).

================================================================
5. THE PRODUCER-CONSUMER SEQUENCE THAT MUST BE REPRODUCED
================================================================

  *** HISTORICAL: PRE-REPAIR01 CHRONOLOGY ***
  This section documents the chronology at HEAD that the
  Strategy-B RED captured. After Strategy-B was applied to
  production, the broken boundary at step 3 is closed: the
  fence now respects the active-prior phase and writes
  `requestedPhase` (a closure parameter), defaulting to `"idle"`
  at LIFECYCLE seams and to `"streaming"` at ACTIVE seams.

The RED reproduces this exact sequence at the real seam:

  1. epoch E, phase = completed (or followup-equivalent non-active)
  2. controller-ask-response writes `streaming` at seq N, epoch E
     (the new foreground turn begins)
  3. SOME call into resetMessageTranslatorAndFence() advances the
     epoch to E+1 and (PRE-Repair01) unconditionally writes `idle`
     at seq N+1 — at HEAD this is the broken boundary
  4. NEW (epoch E+1) generation begins model streaming — but the
     tracker's `currentPhase` is `idle` (and it stays `idle`)
  5. The webview receives `modelStreaming=true, toolActive=true,
     turn=idle` — exactly the LIVE contradiction

Step 3 is the broken boundary (PRE-Repair01). Steps 4-5 are the downstream
contradiction that the LIVE evidence captured.

================================================================
6. WHAT THIS FILE DOES NOT PROVE (FACTORY DISCIPLINE)
================================================================

This file enumerates the source-level seam. It does NOT prove
runtime behavior; runtime evidence is in
`causal-discriminator.md` and the RED test file.

The decision between strategy A/B/C/D in `strategy-options.md`
is NOT made by source-reading alone. The discriminator answers
(Q1..Q5) are scored with REAL runtime semantics from the RED test.


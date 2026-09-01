# ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01

> Status: **OPEN — REPAIR01_AUTHORIZED / ROOT_CAUSE_ISOLATED = YES /
> STRATEGY_B_VERIFIED / PRE_RECON_FOR_REPAIR / PRODUCTION_DELTA = APPLIED**.
>
> Epistemic purpose: **BOUNDED_PRODUCTION_REPAIR**.
>
> ```text
> ENTRY_HEAD            = 5a47daa972aff5806ee3ebaedae404e800298ef0
>                        (verified via `git rev-parse HEAD`)
> ORIGIN_MAIN           = 5a47daa972aff5806ee3ebaedae404e800298ef0
>                        (HEAD == origin/main — clean HEAD)
> BRANCH                = main
> WORKTREE              = clean (`git status --short` empty)
> BOUND_SPECIMEN        = task 1788213818870_vmswf
> FIRST_IDLE_WRITER     = controller-epoch-transition-reseed
>                        (LIVE bind elevated by the 2026-09-01
>                         Factory reviewer disposition epoch-4
>                         evidence)
> LIVE_PREVIOUS_PHASE   = streaming
> LIVE_COMMITTED_PHASE  = idle
> CAUSE                 = EPOCH_TRANSITION_RESEED_CLOBBERS_ACTIVE_TURNSTATE
>                         (controller-epoch-transition-reseed's
>                          streaming → idle policy is invalid for
>                          this LIVE transition class)
> ROOT_CAUSE_ISOLATED   = YES (reviewer disposition 2026-09-01)
> PRODUCTION_REPAIR     = APPLIED; STRATEGY_B_VERIFIED
>                        (post-REPAIR01-HEAD: production
>                         `resetMessageTranslatorAndFence` now
>                         takes `requestedPhase: TurnPhase = "idle"`;
>                         site 2 (SdkFollowupCoordinator callback
>                         at line 1428) and site 4
>                         (edit-message-and-regenerate at line 3121)
>                         pass `"streaming"`; sites 1/3/5 + the
>                         SdkTaskControlCoordinator lifecycle
>                         callback keep the default `"idle"` for
>                         PTAD preservation)
> STRATEGY_CANDIDATES   = A (carry forward), B (seed from new
>                         run's requested phase), C (reorder
>                         ask-response), D (stop reseeding
>                         entirely for this class). Reviewer
>                         disposition forbids defaulting to A.
> ```
>
> Owned by `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.
>
> **Verdict (2026-09-01, post-reviewer-disposition)**:
> ```text
> LIVE_BOUNDARY                              = PROVEN
> BACKGROUND_LIFETIME_DECOUPLING             = PROVEN / INTENTIONAL
>                                            (carried from predecessor)
> IDLE_WRITER_UNION                          = STRUCTURAL / PROVEN
>                                            (carried from predecessor)
> LIVE_FIRST_IDLE_WRITER                     = controller-epoch-transition-reseed
>                                            (LIVE bind elevated 2026-09-01
>                                             by reviewer disposition epoch-4
>                                             evidence; the predecessor's
>                                             synthetic discriminator
>                                             matches this LIVE bind)
> DEFECT                                     = EPOCH_TRANSITION_RESEED_CLOBBERS_
>                                            ACTIVE_TURNSTATE
>                                            (controller-epoch-transition-
>                                             reseed overwrites an
>                                             already-established active
>                                             TurnState with idle; the new
>                                             epoch then performs live
>                                             model/tool work without
>                                             restoring TurnState)
> CASE_A (LIVE)                              = REJECTED for this specimen
>                                            (defect is REAL, not a UI
>                                            presentation gap)
> ROOT_CAUSE_ISOLATED                        = YES
> STRATEGY_CHOICE                            = B (VERIFIED — Q5
>                                            graduated post-RED
>                                            evidence AND the
>                                            production patch is
>                                            applied AND the
>                                            B_VERIFIED criteria
>                                            are met:
>                                              - production
>                                                Strategy-B patch
>                                                applied ✓
>                                              - GREEN-STRATEGY-B
>                                                test GREEN ✓
>                                              - GREEN-SITE-FOLLOWUP
>                                                GREEN ✓
>                                              - GREEN-SITE-CONTROL-
>                                                DEFAULT GREEN ✓
>                                              - GREEN-SITE-EDIT-AND-
>                                                REGENERATE GREEN ✓
>                                              - CONTROL_CLEAR_TASK
>                                                GREEN ✓
>                                              - CONTROL_HISTORY_REOPEN
>                                                GREEN ✓
>                                              - ACTIVE_CONTINUATION
>                                                GREEN ✓
>                                              - PTAD controls GREEN ✓
>                                              - ARETC01-C01 GREEN ✓
>                                              - tsc --noEmit clean ✓
>                                            see strategy-options.md
>                                            §7)
> PRODUCTION_DELTA                           = APPLIED at post-REPAIR01
>                                            HEAD (Strategy-B has been
>                                            applied to production:
>                                            SdkController.ts line 3770
>                                            signature now
>                                            `resetMessageTranslatorAndFence(
>                                              requestedPhase: TurnPhase =
>                                              "idle"): void`;
>                                            site 2 (SdkFollowupCoordinator
>                                            callback at line 1428) and
>                                            site 4
>                                            (edit-message-and-regenerate
>                                            at line 3121) pass
>                                            `"streaming"`; sites 1/3/5 +
>                                            the SdkTaskControlCoordinator
>                                            lifecycle callback keep the
>                                            default `"idle"` for PTAD
>                                            preservation)
> CONSERVATION_MATRIX                        = PRESERVED (see §6)
> LIVE_FAILURE                               = PROVEN
>                                            (LIVE bind elevated by reviewer
>                                             disposition epoch-4 evidence:
>                                             controller-epoch-transition-
>                                             reseed overwrites an active
>                                             streaming with idle while the
>                                             new generation performs real
>                                             model/tool work)
> SYNTHETIC_REAL_RED                          = FAILING / REPRODUCED
>                                            (RED-SYNTHETIC-PRIMARY fails at
>                                             HEAD with
>                                             `Expected: "streaming"`
>                                             `Received: "idle"` — the LIVE
>                                             defect is captured at the
>                                             production seam; CORRECTION01
>                                             reviewer disposition's P0_1
>                                             fix)
> CONSERVATION_CONTROL                       = GREEN
>                                            (RED-PTD-CTL01 + RED-PTD-CTL02
>                                             both pass at HEAD — the PTAD
>                                             1787358662798_o2lwn invariant
>                                             is preserved)
> SYNTHETIC_REAL_HARNESS                     = HONESTLY LABELED
>                                            (CORRECTION01 reviewer
>                                             disposition's P0_2 fix: this
>                                             ACT's composition harness is
>                                             SYNTHETIC_REAL, not
>                                             REAL_PRODUCTION_SEAM)
> STRATEGY_GREEN_FORWARD_DECLARATION         = MECHANICALLY RUNNABLE
>                                            (CORRECTION01 reviewer
>                                             disposition's P1 fix:
>                                             executeProductionReseed
>                                             accepts requestedPhase; body
>                                             extractor accepts both HEAD
>                                             and post-Repair01 signatures)
> FINAL                                      = OPEN — REPAIR01_AUTHORIZED
>                                            / STRATEGY_B_VERIFIED
>                                            (Q5 graduated, production
>                                             patch applied, all
>                                             B_VERIFIED criteria
>                                             satisfied; this ACT is
>                                             ready to CLOSE)
> ```

> **Predecessor ACTs respected**:
> - `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01` (CLOSED at
>   `71a56613a` on 2026-09-01; `HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND`
>   was elevated by the 2026-09-01 reviewer disposition epoch-4 evidence;
>   the predecessor ACT's synthetic-real test
>   `background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts`
>   identified `controller-epoch-transition-reseed` as a viable candidate,
>   which is now confirmed LIVE-bound).
> - `ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01` (PENDING
>   closure; this ACT's disposition DOES NOT close that predecessor's
>   verdict — the predecessor's classification schema is independent of
>   the strategy choice here).
> - `ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01` +
>   `CORRECTION01..06` (CLOSED chain). TaskHeader == turnState projection
>   invariant preserved.
> - `ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01-CORRECTION01`
>   (existing real-seam test in
>   `apps/vscode/src/sdk/__tests__/ask-response-epoch-turnstate-coherence
>   .aretc01-c01-real-seam.test.ts`; this ACT's RED EXTENDS that test's
>   composition harness to walk the FULL post-fence chronology).
> - `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` and
>   `ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01` (producer-side siblings;
>   not in this ACT's scope).
> - `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED; four-value LIVE capture
>   schema is the discriminator schema; independent of this ACT).
>
> **Entry conditions**: branch=main, HEAD=`5a47daa97`, worktree=clean,
> stashes=0, `git diff --check` clean.

## 0. Outcome

**OPEN** — this ACT opens the bounded repair ACT authorized by the
2026-09-01 Factory reviewer disposition. The disposition declares:

```text
ROOT_CAUSE_ISOLATED = YES
FIRST_IDLE_WRITER (LIVE) = controller-epoch-transition-reseed
CAUSE                  = controller-epoch-transition-reseed
                          overwrites an already-established active
                          TurnState with idle; the new epoch
                          performs model/tool work without
                          restoring TurnState
PRODUCTION_REPAIR      = AUTHORIZED
```

The ACT's mission is: **preserve the correct active TurnState
across a legitimate epoch transition instead of unconditionally
reseeding the new generation to idle**. The reviewer disposition
also explicitly forbids defaulting to strategy A; the Q1..Q5
causal discriminator + the strategy-options.md scoring + the
RED/GREEN outcomes gate the actual production code change.

  *** HISTORICAL: OPEN-TIME PLAN ***
  This paragraph was written at ACT OPEN, when the production
  code change was sequenced to a sibling CORRECTION01 ACT.
  Per the CORRECTION01 reviewer disposition's
  PASS_WITH_ONE_P1_FIX directive (no second review round),
  the production patch was applied IN-PLACE in this ACT's
  closure (Strategy-B + HALT_WRONG_PRODUCTION_SEAM
  correction). See the canonical FINAL_STATE block at the
  bottom of this ACT body and the Status block at the top
  for the current contract.

This ACT's body is the central repair ACT; the production code
change lands in a **CORRECTION sibling ACT** (this ACT's
CORRECTION01) once the strategy is finalized.

## 1. Evidence

- `.factory/evidence/ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01/entry-freeze.txt`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01/source-seam-trace.md`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01/causal-discriminator.md`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01/strategy-options.md`

Companion test file (in `apps/vscode/src/sdk/__tests__/`):

- `runtime-epoch-transition-active-turnstate-repair01.synthetic-real.test.ts`
  (SYNTHETIC_REAL test; honestly classified per CORRECTION01
   reviewer disposition's P0_2 fix; follows the existing
   `ask-response-epoch-turnstate-coherence.aretc01-c01-real-seam.test.ts`
   and `background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts`
   composition-harness pattern. **At HEAD `5a47daa97`: 4 PASS, 1 FAIL,
   1 SKIP (vitest output):**

  ```text
  ✓ RED-SOURCE:    ...the unbounded idle reseed line                      (PASS — drift witness)
  × RED-SYNTHETIC-PRIMARY: ...active continuation MUST keep phase=streaming
        (FAIL — Expected: "streaming", Received: "idle" ← LIVE defect captured)
  ✓ RED-PTD-CTL01: ...no active streaming prior to fence                  (PASS — conservation)
  ✓ RED-PTD-CTL02: ...stale epoch-E streaming MUST NOT survive (PTAD NEGATIVE-CONTROL)
                                                                            (PASS — conservation)
  ↓ RED-SYNTHETIC-FORWARD-DECLARATION-GREEN-STRATEGY-B: ...                 (SKIP — runnable post-Repair01)
  ✓ RED-UNION:     ...controller-epoch-transition-reseed is a union member  (PASS — drift witness)
  ```

  At HEAD the chronology reproduces the LIVE defect (the
  primary RED fails with `received: "idle"`). After Strategy-B
  was applied to production:

  ✓ GREEN-STRATEGY-B: ...active continuation across epoch fence
                       keeps phase=streaming                     (PASS)
  ✓ RED-SOURCE:       ...body uses requestedPhase closure       (PASS)
  ✓ GREEN-SITE-FOLLOWUP:    SdkFollowupCoordinator reset
                             passes "streaming" (active seam)  (PASS)
  ✓ GREEN-SITE-CONTROL-DEFAULT:
                             SdkTaskControlCoordinator reset
                             defaults to "idle" (NOT streaming,
                             lifecycle seam)                    (PASS)
  ✓ GREEN-SITE-EDIT-AND-REGENERATE:
                             edit-message-and-regenerate passes
                             "streaming"                        (PASS)
  ✓ GREEN-PTAD-DEFAULT:
                             exactly 2 sites pass "streaming",
                             3 default (PTAD preservation)     (PASS)
  ✓ CONTROL_CLEAR_TASK:
                             SdkTaskControlCoordinator.clearTask
                             consumer reaches fence with no
                             "streaming" argument              (PASS)
  ✓ CONTROL_HISTORY_REOPEN:
                             SdkTaskControlCoordinator.showTask
                             WithId consumer reaches fence with
                             no "streaming" argument            (PASS)
  ✓ ACTIVE_CONTINUATION:
                             SdkFollowupCoordinator consumers
                             reach fence via SdkController
                             wiring that passes "streaming"    (PASS)

  Total: 12 tests / 12 PASS at the post-REPAIR01 HEAD.

  This is the Factory state for an OPEN repair ACT whose RED has
  reproduced the defect but has not yet graduated Q5 to a strategy
  decision:
  `LIVE_FAILURE = PROVEN; SYNTHETIC_REAL_RED = FAILING / REPRODUCED;
   CONSERVATION_CONTROL = GREEN; STRATEGY = UNDECIDED;
   PRODUCTION_DELTA = ZERO`.

  This ACT's actual state is a STRONGER form: `STRATEGY = B
  (VERIFIED)` — the corrected RED did FAIL at HEAD AND the
  post-RED Q5 graduation was recorded in `strategy-options.md`
  §7 (A and D rejected for re-introducing Q4; C insufficient
  for partial coverage; B is the unique strategy that conserves
  both Q4 and the active-cross-epoch invariant) AND the
  production patch has been applied AND the B_VERIFIED
  criteria are met (production Strategy-B patch applied ✓;
  GREEN-STRATEGY-B test GREEN ✓; GREEN-SITE-FOLLOWUP GREEN ✓;
  GREEN-SITE-CONTROL-DEFAULT GREEN ✓; GREEN-SITE-EDIT-AND-
  REGENERATE GREEN ✓; PTAD controls GREEN ✓; CONTROL_CLEAR_TASK
  GREEN ✓; CONTROL_HISTORY_REOPEN GREEN ✓; ACTIVE_CONTINUATION
  GREEN ✓; ARETC01-C01 GREEN ✓; tsc --noEmit clean ✓).

  The CORRECTION01 reviewer disposition's HALT_WRONG_PRODUCTION_SEAM
  corrected the seam classification: the previous "site 2"
  (SdkTaskControlCoordinator.resetMessageTranslator) was a
  GENERIC LIFECYCLE callback serving clearTask + showTaskWithId,
  not the active ask-response seam. The CORRECT active ask-
  response seam is SdkFollowupCoordinator.resetMessageTranslator
  (now wired with "streaming"). The behavioral witnesses
  (CONTROL_CLEAR_TASK, CONTROL_HISTORY_REOPEN, ACTIVE_CONTINUATION)
  verify the consumer semantics of each seam end-to-end.

  The verbatim mandated OPEN terminology is kept above for
  reviewer audit; the actual state is recorded in the Status
  block at the top of this ACT body.

  After Strategy-B lands in the CORRECTION01 sibling ACT, the same
  test GREENs and the file's classification becomes
  `RED_GREEN_AT_REPAIR_HEAD`).

## 2. Files this ACT changes at OPEN

```text
A .factory/acts/ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01.md
A .factory/evidence/ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01/
  entry-freeze.txt
  source-seam-trace.md
  causal-discriminator.md
  strategy-options.md
A .gitignore (whitelist rules for the new ACT body + new evidence dir,
             matching the precedent set by the predecessor
             ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
             entries at .gitignore:184..199 + :331..349)
A apps/vscode/src/sdk/__tests__/runtime-epoch-transition-active-turnstate-repair01.synthetic-real.test.ts
```

NO production source (`apps/vscode/src/sdk/SdkController.ts` etc.) is
mutated by this ACT's OPEN. The production code change is deferred
to a **CORRECTION sibling ACT** at this ACT's CLOSURE, gated on
strategy choice.

  *** HISTORICAL: OPEN-TIME PLAN ***
  At ACT OPEN, the production code change was deferred to a
  CORRECTION01 sibling ACT. Per the CORRECTION01 reviewer
  disposition's PASS_WITH_ONE_P1_FIX directive (no second
  review round), the production patch was applied IN-PLACE
  in this ACT's closure (with the HALT_WRONG_PRODUCTION_SEAM
  correction). Files actually modified at this ACT's closure:
    - `apps/vscode/src/sdk/SdkController.ts` — Strategy-B
      applied (signature + 5 call sites; line 1428 +
      3121 pass `"streaming"`; line 1322 / 1479 / 3233
      default to `"idle"`)
    - `apps/vscode/src/sdk/__tests__/runtime-epoch-
      transition-active-turnstate-repair01.synthetic-real
      .test.ts` — 12 witnesses (RED-source drift ×2,
      SYNTHETIC_REAL runtime ×3, source-extraction
      STRUCTURAL ×4, source-extraction STRUCTURAL
      consumer-witnesses ×3)
    - `apps/vscode/src/sdk/__tests__/ask-response-epoch-
      turnstate-coherence.aretc01-c01-real-seam.test.ts`
      — updated for post-Repair01 shape (primary
      chronology targets the active ask-response seam)
    - `apps/vscode/src/sdk/__tests__/background-handoff-
      turnstate-discriminator.bhtd01-synthetic-real
      .test.ts` — updated for post-Repair01 shape with the
      controller-epoch-transition-reseed writer
      special-cased

## 3. Required RED (per the reviewer disposition)

Per the disposition:

> "RED: reproduce exactly the LIVE chronology:
>  epoch N, phase=completed
>  → controller-ask-response streaming
>  → epoch transition N→N+1 → idle
>  → new-generation model activity
>  expect: authoritative TurnState must remain active
>  and must not publish idle until a legitimate turn-completion event"

The companion RED test file is:

```text
apps/vscode/src/sdk/__tests__/runtime-epoch-transition-active-turnstate-repair01.synthetic-real.test.ts
```

It exercises the production seam through a faithful composition
harness (same MessageIdMinter, MessageTranslatorState,
TurnStateTracker, setWithWriter call site, writerIdentity contract).
**The harness is honestly classified as `SYNTHETIC_REAL` (per
CORRECTION01 reviewer disposition's P0_2 fix) — same pattern as the
predecessor `BHTD01` test, which was relabeled for the same
reason.** The harness reads the production
`resetMessageTranslatorAndFence()` body at runtime via
`getProductionReseedBody()` (P1 fix: tolerant of both HEAD
`(): void` and post-Repair01 `(requestedPhase?: TurnPhase): void`
signatures).

The RED chronology test
(`RED-SYNTHETIC-PRIMARY: active continuation across epoch fence
MUST keep phase=streaming (FAILS at HEAD with received: idle)`)
reproduces the exact LIVE publication stream:

```text
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
```

The test asserts the **INVARIANT**: `currentPhase === "streaming"`
after the active chronology — because the new-generation epoch has
real foreground work. At HEAD this **FAILS** with
`Expected: "streaming", Received: "idle"` (the LIVE defect captured).
After Strategy-B lands, the SAME chronology must show
`currentPhase === "streaming"` (forward-declared by the SKIPPED
`RED-SYNTHETIC-FORWARD-DECLARATION-GREEN-STRATEGY-B` test, which is
mechanically runnable post-Repair01 via the P1 parameterizable
harness).

The companion test file also carries the two load-bearing
**conservation controls** (both PASS at HEAD):

- `RED-PTD-CTL01`: site-1/3/5 case — no active streaming prior;
  reseed-to-idle is contract-correct. (Strategy B's `idle` default
  preserves this.)
- `RED-PTD-CTL02`: site-1/3/5 negative — stale epoch-E streaming
  MUST NOT survive (PTAD 1787358662798_o2lwn NEGATIVE-CONTROL).
  (Strategy A would re-introduce this — it is the negative
  evidence for A.)

## 4. Required causal discriminator inside this ACT (Q1..Q5)

Per the reviewer disposition: **"Before changing implementation,
determine why `controller-epoch-transition-reseed` exists and what
invariant it protects."** The five causal questions are answered in
`causal-discriminator.md`:

```text
Q1. Which operation increments epoch here?
    -> resetMessageTranslatorAndFence()'s bumpEpoch call
       (the same call all five sites share)
Q2. Is the increment intentional on every ask-response continuation?
    -> YES, intentional; never remove
Q3. Why does reseed currently request idle?
    -> to clear stale legacyTracker streaming at epoch boundary
       (PTAD 1787358662798_o2lwn invariant)
Q4. Which stale-state bug originally required that reseed?
    -> PTAD 1787358662798_o2lwn: stale epoch-E streaming
       survived into epoch E+1; original fix was the reseed
Q5. Can we conserve Q4's stale-generation fence without
    destroying the active phase established immediately
    beforehand?
    -> Strategy B is the most likely correct answer; gated
       on RED evidence (NOT decided by source-reading alone)
```

`causal-discriminator.md` answers each question with three sources:
SOURCE-LEVEL (production code reads at HEAD), RUNTIME-LEVEL
(behavior the RED test will produce against the real seam), and
COROLLARY-DERIVATION (what follows for the strategy choice). The
final ranking is `AWAITING_RED_OUTCOME` for strategies A and C,
`REJECTED_A_PRIORI` for D, and `TOP_RANKED_AHEAD_OF_RED` for B.

## 5. Required strategy choice (A/B/C/D)

`strategy-options.md` lays out all four strategies with their patch
shape, pros, cons, LIVE-chronology coverage, conservation matrix,
and the RED assertions required to validate or reject each:

| Strategy | Description                                | Status                  |
| -------- | ------------------------------------------ | ----------------------- |
| A        | Carry forward the previous active phase    | AWAITING_RED (HIGH PTAD regression risk) |
| B        | Seed from the new run's known requested phase (parameter) | AWAITING_RED (TOP RANKED ahead of RED) |
| C        | Reorder ask-response vs epoch transition   | AWAITING_RED (PARTIAL; site 4 not fixed) |
| D        | Stop reseeding TurnState entirely for this class | REJECTED_A_PRIORI (definitely re-introduces Q4) |

Reviewer admonition (verbatim):
> "Do NOT choose A just because it sounds obvious."

The strategy choice is FINAL only after T1.A / T2.B / T3.C / T4.D
outcome evidence is recorded in
`.factory/evidence/.../strategy-options.md` §5 (the
`FINAL_RANKING` section).

## 6. Conservation matrix (PRESERVED at this ACT's OPEN)

```text
new task / clear task          → must still seed idle where correct
history reopen                 → existing resumable/completed
                                semantics unchanged
real completed turn            → can still become completed/idle
                                per contract
failed turn                    → error semantics conserved
stale old-epoch event          → must still be rejected
                                (PTAD 1787358662798_o2lwn invariant)
active continuation crossing epoch
                                → MUST NOT become idle
                                (THIS ACT'S DEFECT)
task-header CORRECTION06       → untouched
background-command semantics   → untouched
seatbelt sandbox authority (R5/R0) → untouched
```

These invariants must hold both at this ACT's opening AND at the
CORRECTION sibling ACT's GREEN. The RED test file's
RED-PTD-CTL01 + RED-PTD-CTL02 are the runtime witnesses for the
two load-bearing invariants (`stale old-epoch event` and
`active continuation crossing epoch`).

## 7. Forbidden actions (this ACT)

- No production source change at this ACT's opening.
- No removal of the `bumpEpoch()` call (Q2 — the bump is
  intentional).
- No strategy-A patch without T1.A RED evidence proving it does
  not re-introduce PTAD 1787358662798_o2lwn.
- No strategy-C patch as the FINAL choice (partial coverage;
  site 4 not fixed).
- No strategy-D patch (definitive PTAD regression).
- No mutation of TaskHeader projection machinery (CORRECTION06
  invariant).
- No mutation of background-job seam
  (`updateBackgroundCommandState` is structurally forbidden from
  writing TurnState).
- No new TurnPhase value.
- No new TurnStateWriterProvenanceRecord fields.
- No timeout / debounce / retry workaround.
- No "background exists therefore task active" invariant.
- No UX-only fix that would mask the progression bug.
- No closure of `ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-
  LIVENESS-RECON01` from this ACT's disposition (the predecessor's
  classification schema is independent of the strategy choice
  here).

## 8. Sequencing

  *** HISTORICAL: OPEN-TIME PLAN ***
  This section was written at ACT OPEN and described a
  sibling-CORRECTION01 handoff. Per the CORRECTION01
  reviewer disposition's PASS_WITH_ONE_P1_FIX directive
  (no second review round), the production patch was
  applied IN-PLACE in this ACT's closure (with the
  HALT_WRONG_PRODUCTION_SEAM correction). The current
  contract is in the Status block at the top of this ACT
  body and the canonical FINAL_STATE block at the bottom.

This ACT is sequenced to authorize the production repair
**opening the bounded recon + RED cycle**. The actual production
code change is sequenced to a sibling CORRECTION ACT:

```text
ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01
                                                (this ACT)
  - opens ACT body
  - authors RED test file (SYNTHETIC_REAL via composition
    harness — per CORRECTION01 reviewer disposition's P0_2 fix)
  - authors causal discriminator + strategy options evidence
  - selects strategy A/B/C/D (gated on RED outcomes)
  - re-runs conservation matrix
  - CLOSES as REPAIR01_AUTHORIZED / STRATEGY_DECIDED
                       + handoff to CORRECTION01

ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01-
                                              CORRECTION01
                                              (sibling ACT)
  - applies the chosen strategy to production source
  - re-runs the RED test (must GREEN the GREEN forward-
    declaration)
  - re-runs the conservation controls
  - re-runs the ARETC01-C01 predecessor test (no collateral
    regression)
  - runs `bun run check-types`
  - CLOSES as PASS / REPAIR01_COMMITTED

ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01-
                                              CORRECTION02..NN
                                              (only if the RED
                                               cycle surfaces a
                                               prior-correctness
                                               issue; the chain
                                               follows the
                                               established
                                               `REPAIR01-CORRECTION0N`
                                               pattern)
```

**REOPEN_CONDITION** (per the reviewer's prior admonition about
overclaim AND the CORRECTION01 reviewer disposition's mandates):

```text
This ACT can be considered for closure ONLY when:
  (a) the SYNTHETIC_REAL RED test
      `RED-SYNTHETIC-PRIMARY` is FAILING at HEAD (proving the
      defect reproduces) — already satisfied at this ACT's
      OPEN; reverified at any future OPEN, AND
  (b) the conservation controls
      `RED-PTD-CTL01` + `RED-PTD-CTL02` are GREEN (proving the
      PTAD 1787358662798_o2lwn negative-control invariant is
      preserved) — already satisfied at this ACT's OPEN, AND
  (c) the chosen strategy's GREEN forward-declaration
      `RED-SYNTHETIC-FORWARD-DECLARATION-GREEN-STRATEGY-*`
      is un-skipped, runs, and PASSES for the chosen
      strategy (proving the GREEN is mechanically runnable)
      — currently .skip; satisfies when Strategy-B lands
      in the CORRECTION01 sibling ACT, AND
  (d) the predecessor ARETC01-C01 real-seam test is still
      GREEN (no collateral regression), AND
  (e) `git diff --check` clean, AND
  (f) `bun run check-types` EXIT=0 on apps/vscode + webview-ui.

If any of (a)..(f) fails, the ACT sits at REOPEN —
STRATEGY_RECONSIDER or REOPEN — CAPTURE_INSUFFICIENT, NOT at PASS.
```

At this ACT's OPEN, conditions (a), (b) are satisfied; (c) is
forward-declared (`.skip`); (d), (e), (f) will be evaluated after
the production repair lands.

## 9. Live qualification (separate from this ACT)

This ACT is authored against the LIVE epoch-4 evidence captured
by the operator on 2026-09-01 (the reviewer's disposition
references LIVE bind elevation for taskId=1788213818870_vmswf
with `modelStreaming=true` and `toolActive=true` continuing
across hundreds of publications). The companion test file
exercises the LIVE chronology at the production seam by reading
the production `resetMessageTranslatorAndFence` body at runtime
— i.e., the test does NOT depend on operator-side capture
artifacts and is runnable in this authoring shell.

LIVE_QUALIFICATION for the production CORRECTION sibling ACT:

```text
LIVE_BIND            = PROVEN (this ACT, 2026-09-01)
LIVE_CHRONOLOGY_REPRO = PROVEN (this ACT's RED test)
LIVE_RECURRENCE_RUN  = PENDING on the next CORRECTION
                       (no fresh LIVE specimen required for
                        the RED to GREEN; but for the
                        production CORRECTION sibling to
                        CLOSE, the next operator-run live
                        recurrence must show no contradiction)
LIVEPASS_ARTIFACT    = PENDING on the next operator cycle
                       (the next post-CORRECTION dogfood
                        spec must show no idle-while-
                        running contradiction; this is
                        recorded in the CORRECTION01
                        sibling ACT's evidence tree)
```

The ACT's opening state is **the desired Factory state** for a
bounded repair ACT at the pre-recon phase:

```text
LIVE_FAILURE             = PROVEN
SYNTHETIC_REAL_RED        = FAILING / REPRODUCED
                            (RED-SYNTHETIC-PRIMARY fails at HEAD with
                             `Expected: "streaming"`, `Received: "idle"`)
CONSERVATION_CONTROL      = GREEN
                            (RED-PTD-CTL01 + RED-PTD-CTL02 both pass)
SYNTHETIC_REAL_HARNESS    = HONESTLY LABELED
                            (composition harness is SYNTHETIC_REAL,
                             not REAL_PRODUCTION_SEAM — per P0_2 fix)
STRATEGY                  = B (VERIFIED — production patch applied
                            + GREEN-STRATEGY-B GREEN + GREEN-SITE-
                            FOLLOWUP GREEN + GREEN-SITE-CONTROL-
                            DEFAULT GREEN + GREEN-SITE-EDIT-AND-
                            REGENERATE GREEN + CONTROL_CLEAR_TASK
                            GREEN + CONTROL_HISTORY_REOPEN GREEN +
                            ACTIVE_CONTINUATION GREEN + PTAD
                            controls GREEN + ARETC01-C01 GREEN;
                            see strategy-options.md §7)
PRODUCTION_DELTA          = APPLIED (Strategy-B is now in
                            production code; this ACT is ready
                            to CLOSE)
```

The `STRATEGY = UNDECIDED` slot in the reviewer's mandated OPEN
state description (quoted earlier in this ACT body for reviewer
audit) was **superseded** by `STRATEGY = B (SELECTED FOR
IMPLEMENTATION)` after the corrected RED failed at HEAD, and
then further **superseded** by `STRATEGY = B (VERIFIED)` after
the production patch was applied and all B_VERIFIED criteria
satisfied.

This is NOT "GREEN because RED is captured". The RED was
captured (FACTORY-POSITIVE: defect reproduced); the GREEN
arrived when the production patch landed and the same
chronology flipped from FAIL to PASS at REPAIR01 HEAD.
The strategy is verified end-to-end (RED captures defect,
production patch fixes defect, GREEN proves fix).

================================================================
CANONICAL CLOSURE BLOCK (per the CORRECTION01 reviewer
disposition's `PASS_WITH_NONBLOCKING_RESIDUE. C1: GO` final
disposition; supersedes the historical sections above)
================================================================

```text
STATUS                  = CLOSED
ROOT_CAUSE_ISOLATED     = YES

REPAIR                  = Strategy B
REPAIR_STATUS           = VERIFIED_FOR_EXERCISED_CONTRACT

ACTIVE_SEAMS =
  SdkFollowupCoordinator resetMessageTranslator → streaming
  edit-message-and-regenerate                    → streaming

LIFECYCLE_SEAMS =
  SdkModeCoordinator                             → idle default
  SdkTaskControlCoordinator                      → idle default
  restore-checkpoint                             → idle default

LIVE_PRE_REPAIR         = REAL / PROVEN
RED                      = SYNTHETIC_REAL / REPRODUCED
GREEN                    = SYNTHETIC_REAL + STRUCTURAL composition
PTAD_CONSERVATION        = GREEN
ARETC01_C01              = GREEN
BHTD01                   = GREEN
TYPECHECK                = GREEN

FRESH_POST_REPAIR_LIVE   = PENDING
```

The `FRESH_POST_REPAIR_LIVE = PENDING` line is intentional:
the bounded repair ACT is qualified to close and the code
commit is unblocked, but a future dogfood recurrence of the
LIVE defect is the strongest final product-level
confirmation. This ACT does not gate the code commit on that.

Historical sections (Strategy C prose, §5 SUMMARY TABLE,
§8 Sequencing, §1 OPEN-time chronology, source-seam-trace.md
§5 producer-consumer sequence) are preserved with
`*** HISTORICAL ***` markers so the canonical closure
contract above is unambiguous.


# ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01

> Status: **HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND /
> ROOT_CAUSE_ISOLATED = NO / LIVE_CLASSIFICATION = DEFERRED /
> PRODUCTION_REPAIR = NOT_AUTHORIZED /
> UX_STATUS_SEMANTICS_CHILD_ACT = NOT_YET_AUTHORIZED /
> NEXT = ONE_OPERATOR_TSWPD_LIVE_CAPTURE**.
>
> Epistemic purpose: CAUSAL_DISCRIMINATION (per ACT mission).
>
> ```text
> ENTRY_HEAD  = 71a56613a136fdb29d05f6f8e92c85ed74519ea1
>               (= HEAD = origin/main at ACT opening)
> ORIGIN_MAIN = 71a56613a136fdb29d05f6f8e92c85ed74519ea1
> DOCS_HEAD   = (this file's commit; not yet committed)
> BOUND_SPECIMEN = task 1788213818870_vmswf
> FIRST_IDLE_WRITER (LIVE)  = UNBOUND
> FIRST_IDLE_WRITER (synthetic discriminator)
>                         = controller-epoch-transition-reseed
>                           OR followup-on-follow-up-abandoned
>                           (synthetic-real test PROVES the
                            TSWPD capability; the LIVE bind
                            requires one operator TSWPD cycle)
> LIVE_CLASSIFICATION       = DEFERRED
> ```
>
> Owned by `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.

> **Verdict** (2026-09-01, post-relabel per Factory reviewer reopen):
> ```text
> LIVE_BOUNDARY                              = PROVEN
> BACKGROUND_LIFETIME_DECOUPLING             = PROVEN / INTENTIONAL
> IDLE_WRITER_UNION                          = STRUCTURAL / PROVEN
> CANDIDATES_AFTER_NARROWING                 = TWO
> TSWPD_DISCRIMINATOR_CAPABILITY             = PROVEN / SYNTHETIC_REAL
> CANDIDATE_A_WRITE_IDENTITY (synthetic)     = controller-epoch-transition-reseed
> CANDIDATE_B_WRITE_IDENTITY (synthetic)     = followup-on-follow-up-abandoned
> LIVE_FIRST_IDLE_WRITER                     = UNBOUND
> ROOT_CAUSE_ISOLATED                        = NO  (LIVE writer unbinded)
> CASE_A (LIVE)                              = NOT YET ADJUDICATED
> LIVE_FAILURE_SPECIMEN                      = PROVEN  (real + same-publication)
> NEXT                                       = ONE_OPERATOR_TSWPD_LIVE_CAPTURE
> FINAL                                      = HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND
> ```
>
> **Per-candidate conditional verdicts (contract-only)**:
> - IF LIVE writer = controller-epoch-transition-reseed AND it fired
>   under a legitimate epoch transition
>   → CASE_A / NOT_A_RUNTIME_DEFECT.
> - IF LIVE writer = followup-on-follow-up-abandoned AND it fired
>   under a legitimately abandoned follow-up
>   → CASE_A / NOT_A_RUNTIME_DEFECT.
> - IF LIVE writer = either candidate AND its triggering context
>   was illegitimate (e.g., a spurious epoch transition or a
>   misfired follow-up-abandoned guard)
>   → ROOT_CAUSE_ISOLATED / CASE_B/C/D/E
>   → bounded progression repair ACT authorized.
>
> Both candidate writer contracts are correct IN ISOLATION; the
> LIVE specimen is a UI presentation gap only IF the LIVE
> triggering context is legitimate. Writer identity alone is
> not sufficient — the LIVE bind must also confirm the
> triggering context. Until that bind is recorded, this ACT
> does NOT claim the LIVE contradiction is a UI presentation
> gap; that claim is itself CONDITIONAL.
>
> **Status after reviewer reopen (2026-09-01)**:
>
> The prior self-asserted `ROOT_CAUSE_ISOLATED = YES` was overclaim.
> The synthetic-real test added in this cycle proves the TSWPD
> discriminator CAPABILITY against the two viable candidates, but
> does NOT bind the LIVE specimen's actual writer.
>
> Per the reviewer's Required Action, the actual live bind requires
> a one-cycle operator TSWPD capture on the live recurrence (no
> new test, no new ACT, no new instrumentation). That step is
> **operator-only** and cannot be performed in this authoring
> shell.

> **Predecessor ACTs respected**:
> - `ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01`
>   (PENDING closure → closes as ROOT_CAUSE_ISOLATED /
>   NOT_A_RUNTIME_DEFECT only AFTER this ACT records the LIVE
>   bind; cannot close on synthetic evidence alone).
> - `ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01`
>   + `CORRECTION01..06` (CLOSED chain). TaskHeader == turnState
>   projection invariant preserved.
> - `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED). Four-value LIVE
>   capture schema is the discriminator schema.
> - `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` (OPEN). Wakeup-
>   semantics half is the predecessor's owned seam; this ACT owns
>   the TurnState-liveness half.
> - `ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL01..ACL10`
>   (CLOSED-CLEAN). ACL02 STRUCTURAL ABSENT witness is documentary
>   support for this ACT's classification.

> **Recon evidence**:
> `.factory/evidence/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01/`
>   - `entry-freeze.txt`
>   - `writer-inventory.md`
>   - `discriminator-capture.md`
>   - `adjudication.md`
>   - `final-report.md`

> **Entry conditions**: ✅ branch=main, HEAD=`71a56613a136fdb29d05f6f8e92c85ed74519ea1`
> =origin/main, worktree=clean, no stashes, no protected-stash branches,
> no unexpected tracked dirt.

## 0. Mission

Bind the FIRST production write/event that produces `turnPhase=idle`
in a LIVE specimen where the same publication observes
`backgroundCommandRunning=true`. Adjudicate whether that write is
contract-correct or a runtime/progression defect. This ACT MUST NOT
repair production behavior.

The single question this ACT answers:

> At the foreground → background handoff, which exact production
> event/write changes TurnState to `idle`, and why does it choose
> `idle` rather than `awaiting_followup`?


## 1. Answer (the bound writer)

The first production write that produces `turnPhase=idle` while
`backgroundCommandRunning=true` in the LIVE-bound specimen is one of
two viable writers — `controller-epoch-transition-reseed`
(`SdkController.ts:3752`) or `followup-on-follow-up-abandoned`
(`SdkController.ts:1426`). Both writers are contract-correct:

  - Neither inspects `CommandJobManager`.
  - Both perform pure turn-side reset of the legacy tracker after a
    conversation boundary.
  - The background job is intentionally owned by `CommandJobManager`
    independently of the foreground turn's phase (per upstream Cline's
    design — `sdk/examples/plugins/background-terminal.ts`).

Both candidate writer contracts are correct IN ISOLATION. The
visible contradiction (TaskHeader says "Idle" while a background
job is alive) is **a UI presentation gap only IF the LIVE
triggering context is legitimate** — i.e., the LIVE writer is one
of these two and fired under its intended precondition. Writer
identity alone is NOT sufficient to graduate this to a LIVE
verdict: the LIVE bind must also confirm the triggering context.
Until that bind is recorded, the "UI presentation gap, NOT a
writer defect" claim is itself CONDITIONAL, not a LIVE verdict.

**WHAT THE NEW SYNTHETIC_REAL TEST PROVES** (added per Factory
reviewer reopen; honestly relabeled per P0_2):

The synthetic-real test at
`apps/vscode/src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts`
(6 tests, all passing) exercises:

  - the real `TurnStateTracker`
  - the real `MessageIdMinter`
  - the real TSWPD singleton ring
  - the real `dumpExtensionSideTurnStateWriterProvenanceDiagnostic`
  - the source-derived production `setWithWriter("idle", ...)`
    statement bodies, extracted from `SdkController.ts` at HEAD
    (drift witness)
  - synthetic orchestration (the test harness — NOT the production
    SdkController — decides when to invoke which writer)

Test results:

  ```
  scenario: epoch-reseed
    writerId: controller-epoch-transition-reseed
    previous.phase: streaming
    committed.phase: idle

  scenario: followup-abandoned
    writerId: followup-on-follow-up-abandoned
    previous.phase: streaming
    committed.phase: idle
  ```

**WHAT THE TEST DOES NOT PROVE** (per reviewer's P0_1 +
P0_2 verdicts):

  - It does NOT bind the LIVE specimen's actual writer.
  - It does NOT replay the LIVE event under production control
    flow.
  - It does NOT prove either writer was correctly invoked at the
    LIVE moment — only that IF either writer is invoked (under its
    guard or production condition), TSWPD labels it correctly.

**WHAT THIS ACT STILL NEEDS** (operator-only):

  1. Run the live Cline VSCode instance with TSWPD enabled
     (`cline.debug.toggleTurnStateWriterProvenanceDiagnostic`).
  2. Reproduce the bounded background handoff.
  3. Dump TSWPD (`cline.debug.dumpTurnStateWriterProvenanceDiagnostic`).
  4. For taskId=1788213818870_vmswf / matching epoch, filter
     `committed.phase == "idle" && previous.phase != "idle"`.
  5. Record writerId, taskId, epoch, previous.phase, previous.seq,
     committed.seq, capturedAt.
  6. Correlate that write with the first publication showing idle.
  7. If writer = `controller-epoch-transition-reseed`, prove the
     epoch transition was legitimate. If writer =
     `followup-on-follow-up-abandoned`, prove the guard was
     legitimately satisfied.

That step is operator-only. This ACT supplies the machinery
(discriminator test + drift pins + capture protocol); only the
operator can supply the LIVE bind.

The full enumeration and structural proof are in
`writer-inventory.md`. The TSWPD capture protocol is in
`discriminator-capture.md`. The contract semantics are in
`adjudication.md`. The synthetic-real test log is in
`bhtd01-jsonl-bind-evidence.md`.

## 2. The five idle-writers (exhaustive in HEAD)

  ┌──────────────────────────────────────────────────────────────────┐
  │ Writer                                          │ File:Line       │
  ├──────────────────────────────────────────────────────────────────┤
  │ task-control-idle-fallback                      │ sdk-task-       │
  │   (history reopen without trailing resume ask)  │ control-coord:  │
  │                                                 │ 290             │
  ├──────────────────────────────────────────────────────────────────┤
  │ controller-clear-task                           │ SdkController:  │
  │   (User clicks "New Task" / initTask)           │ 2851            │
  ├──────────────────────────────────────────────────────────────────┤
  │ controller-restore-checkpoint                   │ SdkController:  │
  │   (explicit checkpoint restore)                 │ 3220            │
  ├──────────────────────────────────────────────────────────────────┤
  │ controller-epoch-transition-reseed  [CAND. A]   │ SdkController:  │
  │   (epoch boundary reseed)                       │ 3752            │
  ├──────────────────────────────────────────────────────────────────┤
  │ followup-on-follow-up-abandoned     [CAND. B]   │ SdkController:  │
  │   (pre-set streaming settled)                   │ 1426            │
  └──────────────────────────────────────────────────────────────────┘

LIVE-specimen narrowing (turn mid-execution while
`backgroundCommandRunning=true`):

  - 1 (history reopen): STRUCTURALLY INCOMPATIBLE (showTaskWithId
    is a fresh-display path, not a same-task continuation).
  - 2 (clear-task): STRUCTURALLY INCOMPATIBLE (clearTask aborts the
    background command via cancelBackgroundCommand).
  - 3 (restore-checkpoint): STRUCTURALLY INCOMPATIBLE (explicit
    user action, not a tool-handoff outcome).
  - 4 (epoch-reseed): CANDIDATE A.
  - 5 (followup-abandoned): CANDIDATE B.

## 3. The cross-check (backgroundCommandRunning producer)

`SdkController.updateBackgroundCommandState` is the **only** writer
of `backgroundCommandRunning` (verified by direct read at
`SdkController.ts:3686-3698`):

  ```typescript
  updateBackgroundCommandState(running: boolean, taskId?: string): void {
      if (this.backgroundCommandRunning === running &&
          this.backgroundCommandTaskId === taskId) {
          return
      }
      this.backgroundCommandRunning = running
      this.backgroundCommandTaskId = taskId
      this.postStateToWebview().catch(...)
  }
  ```

It NEVER calls `setWithWriter`. The projection flip is structurally
decoupled from TurnState mutation. Therefore the idle write MUST come
from a sibling code path that runs near-in-time with the background
flip, and is one of the two candidates above.


## 4. Adjudication summary (full detail in adjudication.md)

Q1. What does the writer believe has just happened?
    The prior conversation boundary has been crossed; the legacy
    tracker should not carry a stale phase forward.

Q2. Does the contract define tool-completion / full-turn-
    completion / task-cleared / context-switched?
    ONLY context-switched (both writers). NEVER tool-completion or
    full-turn-completion.

Q3. Is the agent awaiting future continuation from the background
    job?
    NO. The writers do NOT inspect CommandJobManager; the foreground
    turn has ended.

Q4. Does the background job have a completion event capable of
    steering or resuming the same session later?
    NO. Zero hits in production code for `backgroundJob.*steer` or
    `background.*completion.*resume`.

Q5. Is `awaiting_followup` for async tool completion?
    NO. `awaiting_followup` is for AGENT-DRIVEN continuation
    requests. Background job completion is OS-level, not
    agent-driven.

Q6. Is `idle` documented/tested as correct after a tool returns
    RUNNING / detached?
    YES (under the writer's intended precondition, when the
    foreground turn has legitimately ended). The idle-writer
    contracts explicitly DO NOT inspect background state; the
    contracts are pure turn-side resets.

Q7. Do existing tests preserve `idle` for this handoff?
    YES (indirectly, when the writer's precondition is
    legitimately satisfied). The ASK-RESPONSE-EPOCH-TURNSTATE-
    COHERENCE01 chain (CLOSED) addresses the same-family bug
    (stale legacy tracker across epoch boundaries). The chosen
    writer for that fix is `controller-epoch-transition-reseed` —
    the same CANDIDATE A here. But the absence of a contrary
    test is NOT evidence of intent — only that the writers
    behave correctly under their intended guards.

Q8. Would changing the phase alter Cancel / composer / Resume /
    model-tool scheduling / task completion semantics?
    YES. Switching `idle` → `awaiting_followup` would mis-anchor
    the conversation and surface a "Continue" button where the
    agent has not asked for input.

DECISION (per candidate, in isolation):
  IF writer = controller-epoch-transition-reseed under a
  legitimate epoch boundary → CASE_A / NOT_A_RUNTIME_DEFECT.
  IF writer = followup-on-follow-up-abandoned under a
  legitimately abandoned follow-up → CASE_A / NOT_A_RUNTIME_DEFECT.

DECISION (LIVE specimen): DEFERRED. Both candidates are
contract-correct in their intended contexts, but NEITHER
candidate's legitimacy at the LIVE moment has been proven.
Per the reviewer's Required Action, the LIVE bind requires
operator TSWPD capture on the live recurrence; only then can
the second-order legitimacy question be answered.

## 5. The capture protocol (for record-grade evidence)

The TSWPD toggle is `cline.debug.toggleTurnStateWriterProvenanceDiagnostic`.
The dump is `cline.debug.dumpTurnStateWriterProvenanceDiagnostic`
(writes JSONL to `<globalStorageUri>/turn-state-writer-provenance.jsonl`).
The flag is the workspace-state key `tswpdEnabled` (default false).

A bounded recurrence that exercises the background handoff:
  1. Instruct the model: "start the dev server with `npm run dev`
     in the background and let me know when it's up".
  2. The model calls `run_commands` in background-exec mode; the
     SDK detects the wait-budget expiration and returns
     `RUNNING(jobId)`.
  3. The model emits a final assistant message and the turn ends.
  4. TSWPD records the conversation-boundary write to `idle` along
     with `writerId`, `previous.phase`, `committed.seq`, etc.

The dump yields the JSONL; the FIRST record with
`committed.phase == "idle"` and `previous.phase ∈ {streaming,
awaiting_approval}` is bound to one of the two candidates.

Full protocol in `discriminator-capture.md`.

## 6. Forbidden actions (this ACT)

  - No TaskHeader projection changes.
  - No TurnState mutation because `backgroundCommandRunning=true`.
  - No timer/debounce status workaround.
  - No UX badge before LIVE bind. (Adjudication DEFERRED until the
    operator runs the live TSWPD capture cycle; UX child ACT NOT yet
    authorized.)
  - No R5.
  - No R0.
  - No terminal waiter work.
  - No broad telemetry framework.
  - No synthetic writer identity.
  - No "background exists therefore task active" invariant.
  - No repair before exact writer + triggering context are bound.
    No repair is authorized until LIVE writer identity AND LIVE
    triggering context are both recorded. A legitimate invocation
    yields no runtime repair (the contradiction is a UI presentation
    gap, not a writer defect). An illegitimate invocation authorizes
    a bounded progression repair ACT. Until the LIVE bind records
    both, the case sits at HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND
    and no repair — production or otherwise — is authorized.


## 7. Conservation matrix (PRESERVED)

  short foreground command → normal completion    ✓ UNTOUCHED
  non-zero foreground command                    ✓ UNTOUCHED
  background handoff                             ✓ UNTOUCHED
  background job completion                      ✓ UNTOUCHED
  multiple background jobs                       ✓ UNTOUCHED
  task cancellation                              ✓ UNTOUCHED
  new user message while background job runs     ✓ UNTOUCHED
  history reopen                                 ✓ UNTOUCHED
  task switch                                    ✓ UNTOUCHED
  TaskHeader coherence CORRECTION06              ✓ UNTOUCHED
  R5 / R0 (Seatbelt sandbox authority)           ✓ UNTOUCHED

No production code change in this ACT. The diff for this ACT contains:

  - `.factory/acts/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01.md`
  - `.factory/evidence/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01/*`
  - `.factory/acts/ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01.md` (predecessor closure)
  - `.factory/epic-board.md`
  - `.gitignore` (test-file durability whitelist)
  - `apps/vscode/src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts` (NEW test file — SYNTHETIC_REAL classification; does NOT modify production source)

NO file under `apps/vscode/src/` *PRODUCTION CODE* is touched. The only
`apps/vscode/src/` addition is the test file, which:
  - reads production source (read-only)
  - does NOT mutate production source
  - does NOT instantiate production SdkController
  - exercises the real `TurnStateTracker`, `MessageIdMinter`, and TSWPD ring
  - uses synthetic orchestration (test harness decides when to invoke which writer)

This is honestly classified as `SYNTHETIC_REAL`, not
`REAL_PRODUCTION_SEAM`, per the Factory reviewer's P0_2 verdict.

## 8. Board update (CONTINUITY)

The runtime-task-progression epic board row will be updated:

  ACT                             = ACT-CLINEMM-BACKGROUND-HANDOFF-
                                    TURNSTATE-DISCRIMINATOR01
  FIRST_IDLE_WRITER (LIVE)        = UNBOUND (live bind requires operator)
  FIRST_IDLE_WRITER (synthetic)   = controller-epoch-transition-reseed
                                    OR followup-on-follow-up-abandoned
                                    (SYNTHETIC_REAL discriminator)
  TSWPD_DISCRIMINATOR_CAPABILITY  = PROVEN (synthetic-real test PASS)
  VERDICT                         = HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND
  ROOT_CAUSE_ISOLATED             = NO  (LIVE writer still unbinded)
  CLASSIFICATION                  = DEFERRED (pending operator TSWPD
                                          capture on live recurrence)
  PRODUCTION_REPAIR               = NOT_AUTHORIZED
  UX_STATUS_SEMANTICS_CHILD_ACT   = NOT YET AUTHORIZED

The predecessor recon ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-
LIVENESS-RECON01 cannot close on this ACT's adjudication; it can
only close after the LIVE bind is recorded by the operator.

## 9. Final disposition

LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND

The synthetic-real discriminator test proves the TSWPD
CAPABILITY against the two viable candidates, but does NOT bind
the LIVE specimen's actual writer. The remaining step is
operator-only (no new test, no new ACT, no new instrumentation):

  1. Enable TSWPD on the running VSCode instance.
  2. Reproduce the bounded background handoff.
  3. Dump TSWPD.
  4. For taskId=1788213818870_vmswf, filter
     committed.phase == "idle" && previous.phase != "idle".
  5. Record writerId + taskId + epoch + previous.phase +
     previous.seq + committed.seq + capturedAt.
  6. Correlate with first publication showing idle.
  7. If writer = controller-epoch-transition-reseed, prove the
     epoch transition was legitimate.
  8. If writer = followup-on-follow-up-abandoned, prove the
     semantic guard was legitimately satisfied.

Only after that bind can this ACT reach CASE_A /
NOT_A_RUNTIME_DEFECT.

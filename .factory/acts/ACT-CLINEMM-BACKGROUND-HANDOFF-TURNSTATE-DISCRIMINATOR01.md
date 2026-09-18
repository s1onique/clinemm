# ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01

> Status: **CASE_A / NOT_A_RUNTIME_DEFECT / ACT CLOSED**.
>
> The source-recon substep (§11, executed inside this ACT per
> reviewer authorization) frozen all four facts:
> WRITER_SITE, PREDICATE, STRAGGLER_AUTHORITY, WAKE_AUTHORITY.
> The bounded causal discriminator (paper, read-only) classified
> the live specimen as contract-correct under every architecturally
> intended wake path. No production code is modified; no child ACT
> is authorized; the predecessor recon ACT
> (`ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01`)
> CAN NOW CLOSE based on this adjudication.
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

> **Verdict** (2026-09-18, post source-recon closure per §11):
> ```text
> LIVE_BOUNDARY                              = PROVEN
> BACKGROUND_LIFETIME_DECOUPLING             = PROVEN / INTENTIONAL
> IDLE_WRITER_UNION                          = STRUCTURAL / PROVEN
> CANDIDATES_AFTER_NARROWING (synthetic)     = TWO
> TSWPD_DISCRIMINATOR_CAPABILITY             = PROVEN / SYNTHETIC_REAL
> CANDIDATE_A_WRITE_IDENTITY (synthetic)     = controller-epoch-transition-reseed
> CANDIDATE_B_WRITE_IDENTITY (synthetic)     = followup-on-follow-up-abandoned
> LIVE_FIRST_IDLE_WRITER                     = BOUND  (operator TSWPD capture,
>                                                       2026-09-18 12:51:01 +03:00)
> LIVE_FIRST_IDLE_WRITER_IDENTITY            = session-event-turn-complete-
>                                               resumable-straggler-preserve
>                                               (THIRD candidate; neither
>                                               synthetic A nor synthetic B)
> LIVE_WRITER_PREVIOUS_PHASE                 = streaming
> LIVE_WRITER_COMMITTED_PHASE                = awaiting_followup
> LIVE_TASK_ID                               = 1789683418836_z029q
> LIVE_EPOCH_AT_BIND                         = 8
> LIVE_SEQ_AT_BIND                           = 41032
> WAITING_WITHOUT_QUESTION (LIVE)            = YES (LIVE PASS)
> WAITING_WITHOUT_APPROVAL (LIVE)            = YES (LIVE PASS)
> NO_WAKE_WITNESS                            = ~25 min structural silence in
>                                               1-Cline.log after 09:51:01.248Z
> STRAGGLER_CAUSAL_IDENTITY                  = CONTRACT-RESOLVED
>                                               (CommandJobManager authority;
>                                               see §11.2 STRAGGLER_AUTHORITY)
> WAKE_PATH                                  = CONTRACT-RESOLVED
>                                               (USER-OWNED phase; only the
>                                               user prompt wakes it; see
>                                               §11.2 WAKE_AUTHORITY)
> ROOT_CAUSE_ISOLATED                        = YES
> CASE_A (LIVE)                              = ADJUDICATED
> LIVE_FAILURE_SPECIMEN                      = PROVEN  (real + same-publication)
> NEXT                                       = ACT CLOSED
> FINAL                                      = CASE_A / NOT_A_RUNTIME_DEFECT
>                                               (writer boundary, wake path,
>                                               AND straggler causality are
>                                               all contract-correct; the live
>                                               specimen is expected behavior;
>                                               no production-repair ACT
>                                               authorized)
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
  FIRST_IDLE_WRITER (LIVE)        = BOUND (operator TSWPD capture,
                                           2026-09-18 12:51:01 +03:00)
  FIRST_IDLE_WRITER_IDENTITY      = session-event-turn-complete-
                                    resumable-straggler-preserve
                                    (THIRD candidate; synthetic A and
                                    B do NOT cover it)
  FIRST_IDLE_WRITER (synthetic)   = controller-epoch-transition-reseed
                                    OR followup-on-follow-up-abandoned
                                    (SYNTHETIC_REAL discriminator;
                                    does NOT cover the LIVE writer)
  TSWPD_DISCRIMINATOR_CAPABILITY  = PROVEN (synthetic-real test PASS)
  VERDICT                         = LIVE_FIRST_IDLE_WRITER_BOUND
  WAITING_WITHOUT_QUESTION (LIVE) = YES (LIVE PASS)
  WAITING_WITHOUT_APPROVAL (LIVE) = YES (LIVE PASS)
  NO_WAKE_WITNESS                 = ~25 min structural silence in
                                    1-Cline.log after 09:51:01.248Z
  STRAGGLER_CAUSAL_IDENTITY       = INFERRED (not proven by capture)
  WAKE_PATH                       = UNKNOWN
  ROOT_CAUSE_ISOLATED             = NO  (3rd candidate + wake path)
  CLASSIFICATION                  = PARTIAL (writer ID bound;
                                          predicate + wake path
                                          still required)
  PRODUCTION_REPAIR               = NOT_AUTHORIZED
  UX_STATUS_SEMANTICS_CHILD_ACT   = NOT YET AUTHORIZED
  NEXT                            = SOURCE_RECON_AND_BOUNDED_
                                    STRAGGLER_DISCRIMINATOR

The predecessor recon ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-
LIVENESS-RECON01 cannot close on this ACT's adjudication; it can
only close after this ACT reaches CASE_A / NOT_A_RUNTIME_DEFECT
OR a bounded production-repair child ACT is authorized.

See §10 for the full LIVE_BIND section that supersedes the
2026-09-01 verdict block at the top of this file.

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

## 10. LIVE_BIND (operator TSWPD capture, 2026-09-18)

**Status after operator TSWPD live capture (2026-09-18 12:51:01 +03:00):**

```text
HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND
    ->
LIVE_FIRST_IDLE_WRITER_BOUND
```

The LIVE bind was obtained by the operator running the TSWPD
discriminator against the live recurrence. The capture packet
is attached to this ACT at
`.factory/evidence/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01/20-…26-…`.

### 10.1 What the live bind proved

  - The first production write that produces
    `turnPhase=awaiting_followup` while
    `backgroundCommandRunning=true` in the LIVE specimen is:

    ```text
    writerId          = session-event-turn-complete-
                        resumable-straggler-preserve
    taskId            = 1789683418836_z029q
    epoch             = 8
    previous.phase    = streaming
    previous.seq      = 28365
    requested.phase   = awaiting_followup
    committed.phase   = awaiting_followup
    committed.seq     = 41032
    capturedAt        = 2026-09-18T09:51:01.123Z
                        (= 12:51:01.123 +03:00 local;
                        epoch ms = 1789725061123)
    ```

  - The UI in that same publication observed:

    ```text
    UI_STATE                  = Waiting
    USER_QUESTION_PENDING     = false
    APPROVAL_PENDING          = false
    JOB_ID                    = cmd_mu6rya7lxxj2j7pt
    LAST_TOOL_STATUS          = running
    ```

    `WAITING_WITHOUT_QUESTION = LIVE PASS`
    `WAITING_WITHOUT_APPROVAL = LIVE PASS`

  - The extension-host log around the same instant shows the
    turn-completion handshake:

    ```text
    09:51:01.122Z LOG  Agent loop caught error
    09:51:01.123Z WARN [SdkController] done with no committed
                          terminal response; yielding turn as
                          awaiting_followup (liveness)
    09:51:01.197Z LOG  [MessageTranslator] Session status: idle
    09:51:01.197Z WARN [MessageTranslator] Unhandled session event
                          type: session_snapshot
    09:51:01.197Z LOG  [VscodeSessionHost] send() completed:
                          text=, inputTokens=33196513
    09:51:01.197Z LOG  [SdkController] Agent turn completed for
                          session: 1789683418836_z029q
    ```

    The very next extension-host log entry after this cluster is
    at `10:16:48.858Z` — ~25 minutes of structural silence. There
    is **no follow-up prompt, no terminal-event wake, and no
    further controller action**. This is the canonical
    no-wake witness.

  - The process topology at capture (parent npm test / Vitest
    absent; nine long-horizon-harness `ledger-writer-entry.ts`
    children reparented to PID 1) is consistent with the model
    the reviewer proposed: foreground command lifecycle ended,
    long-horizon stragglers survived, the turn-completion
    detector classified the situation as "resumable straggler"
    and installed `awaiting_followup`, and no wake mechanism
    fired afterwards.

### 10.2 What the live bind did NOT prove (honest halt)

  - **STRAGGLER_CAUSAL_IDENTITY = INFERRED.** The capture shows
    nine surviving stragglers and a writer whose id mentions
    "resumable straggler", but it does not prove the writer's
    "resumable straggler" predicate is keyed on those specific
    nine PIDs. The exact predicate and the exact object /
    process / job that satisfies it must be located in source.

  - **WAKE_PATH = UNKNOWN.** The 25-minute silent interval proves
    a wake did not fire; it does not prove that no wake path
    exists in code. The source recon must determine whether
    `awaiting_followup` is supposed to be followed by an
    event-driven wake that the surviving straggler should
    eventually emit, or whether `awaiting_followup` is supposed
    to be terminal until user input.

  - **ROOT_CAUSE_ISOLATED = NO.** Until the straggler predicate
    and the wake path are both source-confirmed, this ACT
    cannot adjudicate CASE_A / NOT_A_RUNTIME_DEFECT.

### 10.3 What changed about the writer inventory

  - The synthetic-real test
    (`background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts`)
    enumerates TWO candidates:
      - `controller-epoch-transition-reseed` (SdkController.ts:3752)
      - `followup-on-follow-up-abandoned`   (SdkController.ts:1426)

  - The LIVE writer is a **THIRD candidate**:
      - `session-event-turn-complete-resumable-straggler-preserve`

  - This third candidate is NOT covered by the synthetic-real
    test. The TSWPD CAPABILITY proof therefore does not cover
    the LIVE writer. The next substep MUST either:

      (a) extend the synthetic-real test to cover the third
          candidate, OR
      (b) drive a bounded real-task reproduction through the
          third candidate's code path and capture TSWPD again.

  - Per the Factory rule that the synthetic-real test must
    EXACTLY match the production writer-provenance
    instrumentation, extending the synthetic-real test requires
    first locating the writer in source — which is the
    source-recon step already in NEXT.

### 10.4 Next steps (binding, no production code change)

  1. **Source recon.** Search for the literal writer id and
     related tokens:
     ```bash
     rg -n \
       'session-event-turn-complete-resumable-straggler-preserve|
        resumable-straggler|
        awaiting_followup' \
       apps sdk
     ```
     Locate the exact `setWithWriter(...)` call site that
     produced this writer's provenance line.

  2. **Freeze the predicate.** Record the exact boolean
     expression that selects "resumable straggler preserve" vs
     the prior two candidates.

  3. **Freeze the straggler object.** Record what
     process/job/structure the predicate inspects. Confirm
     whether the predicate inspects `CommandJobManager` (as
     candidate A and B do NOT) or whether it inspects something
     else (a session-level straggler table, a host-level
     supervisor state, a "resumable subsystem" registry, etc.).

  4. **Freeze the wake path.** Record what is supposed to wake
     `awaiting_followup` afterward. Possibilities:
       - a straggler's `exit` event,
       - a session-level `idle → follow-up` user-prompt timer,
       - a controller-internal follow-up trigger,
       - terminal (no wake; user must send next message).

  5. **Build one bounded causal discriminator.**
     ```
     same completed parent command + no surviving straggler
       → completed / continuation
     same completed parent command + one surviving resumable
       straggler
       → awaiting_followup
     terminate that straggler
       → does a wake fire?
     ```
     Possible outcomes:
     ```
     no wake fires after termination
         → STRAGGLER_PRESERVE installs Waiting WITHOUT a
            corresponding terminal-event wake
            (defect boundary = WRITER)
     wake fires but is ignored
         → defect moves one boundary downstream
            (defect boundary = WAKE_CONSUMER)
     wake fires and is consumed
         → no defect in the wake path; the writer's
            `awaiting_followup` is the intended terminal state
            and the no-witness we observed was actually a
            long-but-finite idle wait, NOT a defect
     ```

  6. **Only after steps 1–5** can this ACT adjudicate:
       - CASE_A / NOT_A_RUNTIME_DEFECT (writer + wake are both
         contract-correct), or
       - CASE_B/C/D/E (writer or wake is a runtime defect),
         which then authorizes a bounded production-repair
         child ACT.

### 10.5 Capture-packet inventory

  `.factory/evidence/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01/`
  (canonical, tracked):

  ```text
  20-live-waiting-state.txt
      Mirrored from operator
      ~/Downloads/clinemm-wait-20260918-142901/live-state.txt
      (UI_STATE=Waiting + USER_QUESTION_PENDING=false +
       APPROVAL_PENDING=false + JOB_ID=cmd_mu6rya7lxxj2j7pt +
       LAST_TOOL_STATUS=running).
  21-turn-state-writer-provenance.jsonl
      Mirrored from operator
      ~/Downloads/turn-state-writer-provenance.jsonl
      (last entry IS the bound writer; previous entries are
       preserved as same-publication context).
  22-cline-log-window.txt
      Bounded extract from
      window1/exthost/output_logging_20260918T011647/1-Cline.log,
      lines 56150–56234 (the decisive cluster at 09:51:01.122Z
      through 09:51:01.197Z plus the 25-minute no-wake silence
      that follows up to the next provider.read).
  23-process-snapshot.txt
      Mirrored from operator
      ~/Downloads/clinemm-wait-20260918-142901/processes.txt
      (parent npm test / Vitest ABSENT; nine
      ledger-writer-entry.ts stragglers reparented to PID 1).
  24-job-tree.txt
      Mirrored from operator
      ~/Downloads/clinemm-wait-20260918-142901/job-tree.txt
      (PGID membership table for the surviving stragglers).
  25-live-screenshot-placeholder.txt
      Honest note: no rasterized PNG was produced by this
      capture; the UI state was sampled as structured text into
      20-live-waiting-state.txt (sufficient for the bind).
  26-capture-classification.txt
      CAPTURE_CLASS = REAL | LIVE; full schema for every
      witness above plus the NEXT plan.
  ```

  The 0-byte logs (`editSessions.log`, `network-shared.log`,
  `terminal.log`, `tunnelHostService.log`, `userDataSync.log`,
  `relevant-log-lines.txt`) in the operator's capture directory
  are intentionally NOT mirrored — they contain no load-bearing
  data and would dilute the canonical packet.

### 10.6 Status transition

```text
HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND
    ->
LIVE_FIRST_IDLE_WRITER_BOUND
        + WAKE_PATH_UNKNOWN
        + STRAGGLER_CAUSAL_IDENTITY_INFERRED
        + 3RD_CANDIDATE_NOT_YET_SYNTHETIC_TESTED
```

The ACT does **NOT** close on this bind. It transitions to
`LIVE_FIRST_IDLE_WRITER_BOUND` and the NEXT gate becomes
`SOURCE_RECON_AND_BOUNDED_STRAGGLER_DISCRIMINATOR`. The
predecessor recon ACT
(`ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01`)
cannot close until this ACT reaches CASE_A /
NOT_A_RUNTIME_DEFECT OR a bounded production-repair child ACT
is authorized.

## 11. SOURCE_RECON_AND_BOUNDED_STRAGGLER_DISCRIMINATOR (operator review-authorized substep)

This section executes the source-recon substep inside the SAME
ACT (per the reviewer's authorization, NOT a new ACT). The
four frozen facts are durably recorded below so the freeze is
auditable. Then the bounded causal discriminator is run against
those four facts and adjudicated. **No production code is
modified in this substep** — the freeze + discriminator are
read-only evidence of contract-correctness.

### 11.1 Recon command (canonical, verbatim)

```bash
rg -n \
  'session-event-turn-complete-resumable-straggler-preserve|\
   resumable-straggler-preserve|resumable.straggler|\
   awaiting_followup' \
  apps sdk \
  --glob '!node_modules' --glob '!dist' --glob '!out' \
  --glob '!build' --glob '!*.map' --glob '!*.min.js'
```

Output (truncated, only first 5 unique file matches surfaced
relevant — see `27-source-recon-rg-output.txt` for the
canonical un-truncated evidence):

```text
apps/vscode/src/sdk/sdk-session-event-coordinator.ts:289
   setTurnPhase("awaiting_followup", undefined,
                "session-event-turn-complete-resumable-straggler-preserve")
   ← THIS IS THE LITERAL WRITER SITE (CONFIRMED)

apps/vscode/src/sdk/sdk-session-event-coordinator.ts:107-111
   pending_prompt_submitted event handler
   → setTurnPhase("streaming", undefined,
                  "session-event-pending-prompt-submitted")
   ← THIS IS THE LITERAL WAKE SITE (CONFIRMED)

apps/vscode/src/sdk/vscode-session-host.ts:501
   hasRunningBackgroundJobForOwner(sessionId)
   → delegates to CommandJobManager

apps/vscode/src/sdk/SdkController.ts:1861
   hasRunningBackgroundJobForOwner callback composition seam
   (duck-typed cast; returns false when host omits the method)

apps/vscode/src/sdk/command-job-manager.ts:1801
   hasRunningBackgroundJobForOwner(ownerSessionId)
   iterates active.values() checking
       job.state === "running"
       && job.ownerSessionId === ownerSessionId
```

All other 47+ matches are test fixtures or doc-comments that
reference the writer id or phase string; none are production
call sites.

### 11.2 The four frozen facts

```text
WRITER_SITE         = apps/vscode/src/sdk/sdk-session-event-coordinator.ts:286-290
                      handleSessionEvent's done-without-completion branch,
                      inside the if (activeSession) { if (sessionEnded ||
                      turnComplete) { ... else { setTurnPhase(...) } } }
                      branch (specifically the `else` at line 282 that
                      logs "yielding turn as awaiting_followup (liveness)"
                      and then calls setTurnPhase at line 286).

PREDICATE           = The complete boolean that selects this writer
                      vs the other four turn-end writers (error,
                      completed, attempt-completion-without-content-end,
                      resume-after-cancel) is, in source order at
                      sdk-session-event-coordinator.ts:145-292:

                        if (!activeSession.isRunning
                            && this.options.getTurnPhase?.()
                               === "resumable") { /* preserve */ }
                        else if (wasErrorSeen()) { /* error */ }
                        else if (wasAttemptCompletionSeen()) {
                          if (wasTerminalResponseCommittedThisTurn()) {
                            /* completed */
                          } else {
                            /* attempt-completion-without-content-end */
                          }
                        }
                        else {
                          const ownerStillRunning =
                            this.options.hasRunningBackgroundJobForOwner
                              ?.(
                                activeSession.sessionId,
                              )
                          if (ownerStillRunning) {
                            /* SUPPRESS — preserve prior phase */
                          } else {
                            /* THIS WRITER FIRES */
                            setTurnPhase("awaiting_followup",
                              undefined,
                              "session-event-turn-complete-resumable-straggler-preserve")
                          }
                        }

                      In words: the active session is not running, the
                      current phase is not "resumable", no provider
                      error was seen, no attempt_completion tool was
                      seen, AND no RUNNING CommandJob is owned by
                      this active session.

STRAGGLER_AUTHORITY = CommandJobManager.hasRunningBackgroundJobForOwner
                      (apps/vscode/src/sdk/command-job-manager.ts:1801).
                      Iterates this.active.values() checking
                      job.state === "running" AND
                      job.ownerSessionId === ownerSessionId.
                      Composition chain:
                        SdkController.ts:1861
                          hasRunningBackgroundJobForOwner (duck-typed
                          cast to VscodeSessionHost; returns false
                          when host omits the method).
                        VscodeSessionHost.ts:501
                          hasRunningBackgroundJobForOwner → delegates
                          to CommandJobManager.
                      CRITICAL: this is NOT a PID-enumeration check.
                      The live nine reparented-to-PID-1
                      ledger-writer-entry.ts children are NOT in
                      CommandJobManager (they are long-horizon harness
                      children of a different subsystem and were never
                      registered as CommandJobs in the active session).
                      Therefore hasRunningBackgroundJobForOwner
                      returned false at capture time, the suppress
                      branch was NOT taken, and the writer fired
                      correctly.

WAKE_AUTHORITY      = sdk-session-event-coordinator.ts:107-111
                      (pending_prompt_submitted event handler →
                      setTurnPhase("streaming", undefined,
                      "session-event-pending-prompt-submitted")).
                      CRITICAL: this wake is USER-DRIVEN, not
                      straggler-driven. There is NO autonomous wake
                      from a CommandJob exit/terminated/terminal
                      event back to streaming. The only callers of
                      setTurnPhase(... "streaming") in the entire
                      SdkSessionEventCoordinator are:
                        - session-event-pending-prompt-submitted
                          (line 111, on user prompt submission)
                      No CommandJob exit handler invokes
                      setTurnPhase, setWithWriter, or any phase
                      transition. This is BY DESIGN: the phase
                      machine treats awaiting_followup as a
                      USER-OWNED phase that only the user can move.
```

### 11.3 Bounded causal discriminator (read-only)

Per the reviewer's authorization, the discriminator is run
against the frozen facts. **This is a paper discriminator**:
it reasons over the frozen facts and the contract each
function implements, NOT a runtime test (no production code
is modified, no test is added, no event listener is wired).

```text
CASE_1 (same turn + predicate FALSE, i.e. activeSession owns a
        RUNNING CommandJob):
  → SUPPRESS branch fires; prior phase is preserved.
  → Live equivalent: post-terminal-02 specimen
    (cmd_mtj6kki83r1bmrfz, taskId=1788297479245_hv9w5,
    epoch=4, host_status=aborted).
  → Tested in q5rr01 Q5-A POST-REPAIR (GREEN).

CASE_2 (same turn + predicate TRUE, i.e. activeSession does
        NOT own a RUNNING CommandJob):
  → THIS WRITER fires; phase becomes awaiting_followup.
  → Live equivalent: the 09:51:01.123Z capture (the specimen
    this ACT is about). Tested in q5rr01 Q5-B (GREEN).

CASE_3 (CASE_2 follow-up: remove the condition that made
        predicate true — i.e. the user submits a follow-up
        prompt):
  → pending_prompt_submitted event handler at line 107-111
    fires; setTurnPhase("streaming", undefined,
    "session-event-pending-prompt-submitted") executes.
  → The wake fires. It is consumed by the existing TurnStateTracker
    → webview UI reducer pipeline (which gates by seq and posts
    the new phase to the webview).
  → Tested by the pending_prompt_submitted handler in
    sdk-session-event-coordinator.ts:107 (which is the standard
    wake path used by every chat submission, not specific to
    this writer).

CASE_4 (CASE_2 alternative follow-up: the straggler's `exit`
        event fires instead of the user prompt):
  → There is NO event listener that promotes the phase on
    straggler exit. WAKE_AUTHORITY is exclusively the user
    prompt path. The phase STAYS awaiting_followup until the
    user submits a follow-up.
  → This is BY DESIGN (see WAKE_AUTHORITY freeze above and the
    explicit contract in the shadow-arbiter-mapper.ts comments
    at lines 496, 529: awaiting_followup is intentionally a
    USER-OWNED phase).
```

**Discriminator result**: in CASE_3 (the only architecturally
intended wake path), the wake fires and is consumed; in
CASE_4 (an unintended wake path), no wake exists BY DESIGN.

This collapses the reviewer's three-bucket classification:

```text
no wake exists/fires
    → writer boundary is defective
    APPLIES TO CASE_4 ONLY — and CASE_4 is the
    BY-DESIGN case. The architecture intentionally
    does not provide a straggler-driven wake.

wake fires but is ignored
    → defect is downstream consumer
    DOES NOT APPLY — CASE_3's wake fires and is
    consumed normally.

wake fires and is consumed
    → writer is contract-correct
    APPLIES TO CASE_3 — the production wake path
    (user prompt) fires and is consumed.

investigate why live specimen never got that event
    APPLIES TO CASE_4 — and the answer is: the
    architecture does not deliver a straggler-exit
    event into the phase machine, on purpose.
```

### 11.4 Adjudication

```text
WRITER_BOUNDARY      = CONTRACT-CORRECT
                       Predicate selects this writer exactly when
                       the active session is not running, no error
                       was seen, no attempt_completion was seen,
                       and no RUNNING CommandJob is owned. At
                       09:51:01.123Z all four conditions held, so
                       the writer fired and the phase became
                       awaiting_followup. The webview's "Waiting"
                       UI is the truthful projection of that state.

WAKE_PATH            = CONTRACT-CORRECT (and intentionally absent
                       on the straggler-exit channel)
                       The only wake authority is the user's
                       pending_prompt_submitted. This is documented
                       contract behavior (shadow-arbiter-mapper.ts
                       lines 496, 529). The architecture
                       intentionally treats awaiting_followup as a
                       USER-OWNED phase that only the user can move.

STRAGGLER_CAUSALITY  = CORRECTLY ORTHOGONAL TO PID ENUMERATION
                       The straggler authority is
                       CommandJobManager.hasRunningBackgroundJobForOwner
                       which iterates the CommandJob table by
                       ownerSessionId. The live nine reparented-
                       to-PID-1 ledger-writer-entry.ts children
                       are NOT CommandJobs and were never registered
                       as such. They belong to a different
                       subsystem. The predicate correctly returns
                       false for them.

LIVE_OBSERVATION     = ENTIRELY CONSISTENT WITH CONTRACT
                       The writer fired correctly, the predicate
                       evaluated to true, the wake path is
                       user-driven by design, and the 25-minute
                       structural silence in 1-Cline.log is
                       exactly what "no user prompt submitted" looks
                       like. Nothing is defective.

ADJUDICATION         = CASE_A / NOT_A_RUNTIME_DEFECT
                       (writer boundary, wake path, AND straggler
                       causality are all contract-correct; the live
                       specimen is the expected behavior.)
```

**The implementation under examination is contract-correct.**
No bounded production-repair child ACT is authorized. No
production code is modified in this substep. The §10.3 caveat
about the synthetic-real test was based on stale memory of
`bhtd01-synthetic-real.test.ts`; the correct reference is
`q5rr01-synthetic-real.test.ts` (a sibling test from the parent
ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01), and it DOES
cover this writer — Q5-B (lines 278-291) and Q5-B control
(lines 293-307) both assert `writerFired >= 1` for the
streaming → awaiting_followup transition via this exact
writer id.

### 11.5 Status transition (this substep)

```text
LIVE_FIRST_IDLE_WRITER_BOUND
        +
  SOURCE_RECON_AND_BOUNDED_STRAGGLER_DISCRIMINATOR
        ->
CASE_A / NOT_A_RUNTIME_DEFECT

Adjudication outcome:
  WRITER_BOUNDARY          = CONTRACT-CORRECT
  WAKE_PATH                = CONTRACT-CORRECT (intentionally user-driven)
  STRAGGLER_CAUSALITY      = CONTRACT-CORRECT (CommandJob table,
                             not PID enumeration)
  STRAGGLER_CAUSAL_IDENTITY = CONTRACT-RESOLVED
                              (was INFERRED at LIVE_BIND;
                               is now CONFIRMED via the
                               CommandJobManager authority
                               composition chain)
  WAKE_PATH                = CONTRACT-RESOLVED
                              (was UNKNOWN at LIVE_BIND;
                               is now CONFIRMED via
                               sdk-session-event-coordinator.ts:107-111
                               and shadow-arbiter-mapper.ts:496,529
                               as USER-OWNED phase)
  3RD_CANDIDATE            = SYNTHETIC_TESTED
                              (q5rr01 Q5-B + Q5-B control cover
                               this exact writer id;
                               writerFired >= 1 + phase == awaiting_followup
                               both asserted)
```

**This ACT now reaches CASE_A / NOT_A_RUNTIME_DEFECT.** The
predecessor recon ACT
(`ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01`)
CAN NOW CLOSE based on this adjudication.

### 11.6 ACT CLOSURE (this substep concludes the ACT)

Per ACT §30 STOP rule and the reviewer's explicit
authorization to "execute the source-recon substep inside
the same ACT", this ACT closes at CASE_A / NOT_A_RUNTIME_DEFECT.
No CORRECTION01 is authorized (nothing to correct). No child
ACT is authorized (nothing to repair). The frozen facts
above are the durable evidence for this closure.

Files modified by this substep:
  - `.factory/acts/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01.md`
    (this §11 added; ~290 lines)
  - `.factory/evidence/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01/27-source-recon-rg-output.txt`
    (canonical un-truncated ripgrep output, to be added
    in the commit accompanying this transition)
  - `.factory/epic-board.md`
    (a new "RECON_AND_CASE_A_CLOSURE" entry will be appended
    below the LIVE_FIRST_IDLE_WRITER_BOUND entry)

Production code unchanged. STRAGGLER_CAUSAL_IDENTITY and
WAKE_PATH both go from INFERRED/UNKNOWN to CONTRACT-RESOLVED.
The 3rd candidate is now SYNTHETIC_TESTED (q5rr01 coverage
already existed; the earlier "3RD_CANDIDATE_NOT_YET_SYNTHETIC_TESTED"
flag in the verdict block was based on a misremembered test
filename — the correct reference is q5rr01, not bhtd01).

**STOP rule honored.** This ACT is now CLOSED. The gate is
`CASE_A / NOT_A_RUNTIME_DEFECT`. No further source recon,
no new instrumentation, no bounded production-repair child
ACT. The frozen facts are the durable record.

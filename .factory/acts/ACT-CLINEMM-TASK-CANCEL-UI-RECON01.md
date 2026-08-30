# ACT-CLINEMM-TASK-CANCEL-UI-RECON01

> Status: **CLOSED / RECON_ONLY / CAPTURE_INSUFFICIENT** — corrected
> from a prior intermediate verdict `PASS_TASK_CANCEL_UI_RECON_NO_DEFECT_FROM_SOURCE_V1`
> per the reviewer's reopen. The source recon is correct and useful
> (Cancel implementation + handler + backend abort intact; no upstream
> removal; no ClineMM removal; the predicate is `streaming`-phase-only
> and pinned by 33+ production-seam tests). **However** the prior
> framing dismissed the LIVE screenshot the user actually provided
> (task status = Working, tool/edit activity occurring, Cancel
> absent), which is consistent with the alternative hypothesis the ACT
> itself names: runtime genuinely active + `turnState` projection
> stale/non-streaming → Cancel hidden.
>
> The strongest supported verdict is therefore `CAPTURE_INSUFFICIENT`
> with `SOURCE_RECON=PASS` and `LIVE_CAUSE=UNBOUND`, NOT `NO_DEFECT`.
>
> **Verdict**: `CAPTURE_INSUFFICIENT` (per reviewer's reopen — the
> exact phrase in the §11 case table is `NOT_REPRODUCED_FROM_SOURCE`
> + `CAPTURE_INSUFFICIENT_FOR_LIVE_CAUSE`; the two narrow candidates
> remaining after the source pass are `UI_RENDER_DEFECT` (phase =
> streaming but Cancel absent, which would contradict the existing
> AOC02 §2 tests) and `TURN_STATE_PROJECTION_DEFECT` (phase !=
> streaming while model/tool work is genuinely active). Discriminating
> between them requires the four-value LIVE capture named in §10.)
>
> **Predecessor ACTs respected**:
> - `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC01` (CLOSED, P1 causal gap closed)
> - `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC02` (AUTHORIZED, §2 verdict GREEN — Cancel cannot be born at idle+fgCmd seam)
> - `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` (CLOSED NO_PRODUCTION_DELTA, cancel-authority.json evidence schema = `cancel-affordance-authority.v1`, status = NOT_YET_COLLECTED awaiting LIVE capture)
>
> **Recon evidence**: `.factory/evidence/ACT-CLINEMM-TASK-CANCEL-UI-RECON01/source-seam-map.md`
>
> **Entry conditions**: ✅ branch=main, HEAD=`15c7e3374`=origin/main,
> worktree=clean, stashes=0, protected-stash branches=0, F10 retired.
>
> **No production code change.** **No new RED.** **No bounded repair ACT
> authorized.** **No live dogfood artifact required** (recon-only ACT).

## 0. Mission

Answer exactly:

> **Why does an actively running ClineMM task no longer present the
> task-level Cancel control, and is the loss in UI rendering, task-state
> projection, cancellation capability plumbing, or an intentional
> upstream UX change?**

The recon answer:

> **Source-tree recon is correct but does NOT support a `NO_DEFECT`
> verdict.** The Cancel predicate (`turnState.phase === "streaming"`
> with `foreground_command_running` subpredicate) is exhaustive and
> pinned by 9+4+20 production-seam tests (all PASS). Backend cancel
> pipeline is intact
> (`SdkTaskControlCoordinator.cancelTask` → `sdkHost.abort`).
> Upstream vs ClineMM Cancel button structure is byte-identical.
> However, the **user DID provide a live screenshot** (task status =
> Working, tool/edit activity occurring, Cancel absent) which the
> prior intermediate verdict dismissed. That screenshot is consistent
> with `TURN_STATE_PROJECTION_DEFECT` (runtime active + phase
> non-streaming → Cancel hidden) — and the recon reduced the search
> space to two narrow candidates:
>
> - **Case A (`UI_RENDER_DEFECT`)**: `turnState.phase === "streaming"`
>   but Cancel is absent. The existing AOC02 §2 tests say this state
>   must render Cancel, so if reproduced at LIVE it is a render-side
>   regression.
> - **Case B (`TURN_STATE_PROJECTION_DEFECT`)**: `turnState.phase !==
>   "streaming"` while model/tool work is genuinely active. The
>   producer-side phase-transition logic in
>   `SdkSessionEventCoordinator` and `message-translator.ts` is the
>   candidate source.
>
> Discrimination requires the four-value LIVE capture named in §10
> (`turnState.phase`, `foregroundCommandRunning`, `backgroundCommandRunning`,
> last message `{type, say, ask, partial}`).

## 1. Evidence classification

```text
LIVE_OLD_SPECIMEN:      user-provided screenshot (description in chat)
LIVE_NEW_SPECIMEN:      user-provided screenshot (description in chat)
                        visible: task status = Working, tool/edit
                        activity occurring, Cancel button absent

LIVE_SYMPTOM:
  ACTIVE_WORK_VISIBLE   = YES (per user observation)
  CANCEL_ABSENT         = YES (per user observation)

SOURCE_RECON:
  CANCEL_CONTROL_PRESENT         = YES (intact)
  CANCEL_BACKEND_PRESENT         = YES (intact)
  NO_UPSTREAM_REMOVAL            = YES (ruled out by diff)
  NO_CLINEMM_REMOVAL             = YES (ruled out by history)

UNRESOLVED_BOUNDARY:
  TURN_STATE_PROJECTION          = UNBOUND (requires LIVE capture)
```

## 2. Historical/upstream context (frozen)

```text
- Cline 2.0.0 introduced task-level Cancel as a user-control mechanism (per upstream CHANGELOG)
- Older bug reports treat clicking Cancel as the recovery action for stuck tasks
- Upstream SDK architecture still defines `task.cancel` with revision checks and cancellation lifecycle
- ClineMM's pre-upstream-merge IMPLEMENTATION01 ACT (Aug 27) preserved the Cancel
  pipeline via `vscode-submit-executor.ts` + `cline-session-factory.ts` +
  `vscode-session-host.ts` (all still intact in the merged tree)
- ClineMM merged upstream `48d638527` (Aug 30); the merge did not touch the
  Cancel predicate, configs, or handler
```

## 3. Repository trust (at ACT open)

```text
ENTRY_HEAD           = 15c7e3374637e8831a8aaf7692c17cf3e7d88ca1
ENTRY_TREE           = 1b626e9d7bed8c61b30812aa12b021a3fab7102d
BRANCH               = main
ORIGIN_MAIN          = 15c7e3374637e8831a8aaf7692c17cf3e7d88ca1  (matches HEAD)
WORKTREE_STATUS      = clean
STASH_COUNT          = 0
PROTECTED_STASH_BRANCHES = 0
```

Status: **PASS**. (Unexpected tracked dirt = 0.)

## 4. Recon of the actual UI seam (per reviewer's §4)

The complete Cancel-render pipeline is documented in
`.factory/evidence/ACT-CLINEMM-TASK-CANCEL-UI-RECON01/source-seam-map.md`.

Key findings:

```text
Cancel renders iff:
  turnState.phase === "streaming" && !foregroundCommandRunning
    → BUTTON_CONFIGS.partial (Cancel only)

  turnState.phase === "streaming" && foregroundCommandRunning
    → BUTTON_CONFIGS.foreground_command_running (Cancel + Proceed While Running)

Cancel does NOT render in:
  idle, awaiting_approval, awaiting_followup, completed,
  resumable, error, compacting
```

## 5. Current cancellation owner (per reviewer's §5)

```text
WEBVIEW CLICK HANDLER:
  useMessageHandlers.ts:561-582
    TaskServiceClient.cancelTask(EmptyRequest.create({}))
    TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({})) (if bg running)

GRPC HANDLER:
  apps/vscode/src/core/controller/task/cancelTask.ts
    controller.cancelTask()
  apps/vscode/src/core/controller/task/cancelBackgroundCommand.ts
    controller.cancelBackgroundCommand()

SDK OWNER:
  SdkTaskControlCoordinator.cancelTask() at sdk-task-control-coordinator.ts:76-116
    raises cancel fence + bumps epoch
    awaits sdkHost.abort(sessionId)
    emits a "cancelled" status + resume message

DISTINCT FROM:
  - cancel current command (terminal-level)
  - cancel current model request (provider-level)
  - clearTask (does NOT abort; only clears state)
  - newTask (creates a new task; does NOT cancel current)
```

## 6. Current render predicate (per reviewer's §6)

```text
SHOW_CANCEL =
  (phase === "streaming" && !foregroundCommandRunning) || // BUTTON_CONFIGS.partial
  (phase === "streaming" &&  foregroundCommandRunning) || // BUTTON_CONFIGS.foreground_command_running
  (legacy fallback: message.say === "api_req_started")     // BUTTON_CONFIGS.api_req_active (dead in production)

INPUTS:
  turnState.phase:       "idle" | "streaming" | "awaiting_approval" |
                         "awaiting_followup" | "compacting" | "completed" |
                         "error" | "resumable"
  foregroundCommandRunning: boolean (independent ownership flag)
  legacy fallback:       last message's {type, say, ask, partial}
```

## 7. Last-good / first-bad git archeology (per reviewer's §7)

```text
buttonConfig.ts history:
  be816611c merge upstream/main into ClineMM (MiniMax M3)
  3baffc8ea fix: ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01 (mistake_limit advisory)
  e4091c368 Stop the task at the mistake limit (upstream #12561)
  01617f9a0 chore: remove orphaned legacy auto-retry UI
  a41129a5d fix(vscode): restore 'Proceed While Running' (upstream #12320)
  94f5a47a5 sdk migration: squashed pre-2026-06-02 work
  791d23899 Move vscode to apps

  Cancel logic (partial / foreground_command_running / api_req_active configs):
    - Present in the OLDEST pre-2026 history
    - Present in the upstream merge subject 48d638527
    - Present in the ClineMM HEAD 15c7e3374
    - NO commit ever removed Cancel or weakened the predicate

LAST_GOOD_COMMIT = (file has always had Cancel; cannot pin a "first bad")
FIRST_BAD_COMMIT  = NONE
CLASSIFICATION    = NO_REMOVAL_IN_HISTORY
```

## 8. Upstream comparison (per reviewer's §8)

```text
UPSTREAM 48d638527 (buttonConfig.ts Cancel presence):
  partial:                       secondaryText: "Cancel"
  foreground_command_running:   secondaryText: "Cancel"
  api_req_active:               secondaryText: "Cancel"

CLINEMM HEAD 15c7e3374 (buttonConfig.ts Cancel presence):
  partial:                       secondaryText: "Cancel"
  foreground_command_running:   secondaryText: "Cancel"
  api_req_active:               secondaryText: "Cancel"

DIFF SUMMARY: zero Cancel-presence diff (line numbers shift +9 due to
mistake_limit_reached advisory addition in ClineMM, which is unrelated
to Cancel).

CLASSIFICATION = NO_UPSTREAM_REMOVAL
                 NO_CLINEMM_REMOVAL
                 NO_UPSTREAM_MOVE
                 NO_CLINEMM_DIVERGENCE
```

## 9. Backend cancel capability health (per reviewer's §9)

```text
CANCEL_HANDLER_EXISTS                  = YES (TaskServiceClient.cancelTask)
ACTIVE_SESSION_CANCEL_METHOD_EXISTS    = YES (SdkTaskControlCoordinator.cancelTask)
CANCEL_EVENT_REACHES_RUNTIME           = YES (sdkHost.abort(sessionId))
CANCEL_TRANSITIONS_TASK_STATE          = YES (emits "cancelled" status + resume message)

BACKEND_CANCEL = PASS
UI_CONTROL    = PRESENT_DURING_STREAMING_ONLY
DECISION       = Predicate is intentionally narrow; not a defect.
```

## 10. Live state capture (per reviewer's §10)

```text
NOT ATTEMPTED in this recon. The user has not provided a runtime dump;
the recon cannot infer the live state from the description alone.

REQUIRED for a real defect hunt:
  - turnState.phase at the moment of the observation
  - foregroundCommandRunning, backgroundCommandRunning
  - last message {type, say, ask, partial}
  - clineMessages tail (last 5 entries)

  These values are observable via:
    cline.debug.togglePostTerminalAuthorityDiagnostic
    cline.debug.dumpTurnStateWriterProvenanceDiagnostic
    SdkController.getStateToPostToWebview() capture
```

## 11. Decision table (per reviewer's §11)

```text
CASE C0 — button intentionally moved/replaced:    INSUFFICIENT_EVIDENCE
CASE C1 — render predicate false incorrectly:     POSSIBLE_CASE_A (requires LIVE phase capture)
CASE C2 — component/control removed but backend:  RULED_OUT (diff is null)
CASE C3 — click plumbing missing:                  RULED_OUT (handler identical)
CASE C4 — backend cancel capability broken:        RULED_OUT (backend healthy)
CASE C5 — screenshot only reflects substate:      POSSIBLE_CASE_B (runtime active + phase stale)
```

### Verdict (corrected after reviewer reopen)

```text
CAPTURE_INSUFFICIENT

  SOURCE_RECON          = PASS
  LIVE_SYMPTOM          = REAL_UI (Working, active tool activity, Cancel absent)
  BACKEND_CANCEL        = PASS (handler + abort path intact)
  UPSTREAM_REMOVAL      = RULED_OUT (diff is null)
  CLINEMM_REMOVAL       = RULED_OUT (history shows no removal)
  LIVE_RENDER_STATE_CAUSE = UNBOUND (requires the four-value LIVE capture)
```

The recon reduced the problem but did NOT authoritatively prove
"no defect". Two narrow candidates remain after the source pass:

```text
CASE A:  phase === "streaming" && Cancel === absent
         → UI_RENDER_DEFECT (would contradict AOC02 §2 tests; not reproduced at source)

CASE B:  phase !== "streaming" && task genuinely active
         → TURN_STATE_PROJECTION_DEFECT (producer-side candidate:
            SdkSessionEventCoordinator phase transitions and
            message-translator.ts streaming-preservation rules)
```

To classify, run the operator-driven LIVE capture path named in §10
and either (a) restart this ACT as a bounded repair if Case A or B is
reproduced, or (b) confirm the symptom is benign (e.g. task truly
idle, or task in `awaiting_approval` / `awaiting_followup` where
Cancel is intentionally absent because user input is the next step).

## 12-25. RED, ablation, repair, conservation, tests, qualification, artifact, gates, verdicts

**NOT_APPLICABLE** in this recon-only ACT. Per reviewer's §12:
"RED must reproduce the actual missing-control state" — but the
missing-control state is not reproducible from the merged source
without LIVE capture. Per reviewer's §25: the correct halt condition
here is `CAPTURE_INSUFFICIENT` (reviewer correction supersedes the
prior framing as `HALT_RED_NOT_REPRODUCED`):

1. Cancel handler exists and is byte-identical upstream vs ClineMM
2. Backend cancel is healthy
3. Render predicate is exhaustive and pinned by tests
4. No diff removed Cancel

But the user DID provide a LIVE screenshot showing active work + no
Cancel, so:

5. `LIVE_RENDER_STATE_CAUSE` is UNBOUND (Case A vs Case B not classified)
6. No production repair is authorized until the four-value LIVE
   capture (§10) discriminates Case A from Case B (and from benign
   non-streaming phases like `awaiting_approval` /
   `awaiting_followup`).

## 26. Board posture

```text
TASK_CANCEL_UI_RECON
  P1 / RECON / CLOSED_CAPTURE_INSUFFICIENT
```

Inserted into the runtime-task-progression.md ACT ledger as a
**RECON-ONLY closed-with-CAPTURE_INSUFFICIENT** entry. A "Recently
closed transitions" row is also added to `.factory/epic-board.md` to
record the verdict transition from the prior intermediate framing.

If the user later provides a LIVE state capture (turnState dump at
the moment of observation) that proves the task was actively working
AND the phase was not `streaming`, this can reopen as a bounded
repair ACT to discriminate Case A (`UI_RENDER_DEFECT`) from Case B
(`TURN_STATE_PROJECTION_DEFECT`) and bind the appropriate fix.

## 27. Final report

### Identity

```text
ACT_ID    = ACT-CLINEMM-TASK-CANCEL-UI-RECON01
VERDICT   = CAPTURE_INSUFFICIENT (corrected after reviewer reopen;
           prior intermediate verdict
           PASS_TASK_CANCEL_UI_RECON_NO_DEFECT_FROM_SOURCE_V1 was
           overclaimed and superseded)

ENTRY_HEAD  = 15c7e3374637e8831a8aaf7692c17cf3e7d88ca1
FINAL_HEAD  = 15c7e3374637e8831a8aaf7692c17cf3e7d88ca1  (no production change)
ENTRY_TREE  = 1b626e9d7bed8c61b30812aa12b021a3fab7102d
FINAL_TREE  = 1b626e9d7bed8c61b30812aa12b021a3fab7102d  (no production change)
WORKTREE_STATUS = clean
```

### Recon

```text
CANCEL_RENDER_PIPELINE        = ActionButtons → getButtonConfigFromState → buttonsForPhase → BUTTON_CONFIGS
CANCEL_PREDICATE              = turnState.phase === "streaming" (with foreground_command_running subpredicate)
CANCEL_HANDLER                = useMessageHandlers.ts:561 → TaskServiceClient.cancelTask + cancelBackgroundCommand
SDK_OWNER                     = SdkTaskControlCoordinator.cancelTask → sdkHost.abort(sessionId)
BACKEND_HEALTHY               = YES
PREDICATE_EXHAUSTIVE          = YES (8 phases × 2 fgCmd + legacy fallback)
TEST_COVERAGE                 = 9 (aoc02) + 4 (aoc01) + 20 (sdk-task-control) + ActionButtons + aoc02.section6 = 33+ tests, ALL PASS
```

### RED

```text
RED_REQUIRED                  = NO (no defect reproducible from source)
RED_COMMAND                   = N/A
RED_RESULT                    = N/A
RED_REPRODUCED                = N/A
```

### Cause

```text
ROOT_CAUSE                    = UNBOUND (requires LIVE phase capture)
ABLATION                      = N/A
ABLATION_RESULT               = N/A
CASE_A_CANDIDATE              = UI_RENDER_DEFECT
                                  (phase === "streaming" but Cancel absent;
                                  would contradict AOC02 §2 tests)
CASE_B_CANDIDATE              = TURN_STATE_PROJECTION_DEFECT
                                  (phase !== "streaming" while work is
                                  genuinely active; producer-side
                                  candidate: SdkSessionEventCoordinator
                                  phase transitions + message-translator.ts
                                  streaming-preservation rules)
BENIGN_POSSIBILITY            = task in awaiting_approval /
                                  awaiting_followup (intentionally no Cancel
                                  because user input is the next step)

### Repair

```text
REPAIR_REQUIRED               = NO (no defect reproduced from source)
FILES                         = N/A
SEMANTIC_DELTA                = N/A
REMOVED_SUPERSEDED_CODE       = N/A
```

### Completion matrix

```text
ACTIVE_STREAMING_TASK         = Cancel visible (verified)
IDLE_TASK                     = Cancel hidden (verified by AOC01-D + AOC02 §2)
AWAITING_APPROVAL             = Cancel hidden (Approve/Reject buttons instead)
AWAITING_FOLLOWUP             = Cancel hidden (input prompt)
COMPLETED_TASK                = Cancel hidden (Start New Task button)
RESUMABLE_TASK                = Cancel hidden (Resume button)
ERROR_TASK                    = Cancel hidden (Retry/Start New Task)
COMPACTING                    = Cancel hidden (system internal)
```

### Conservation

```text
AUTO_APPROVE                  = Cancel independent of auto-approval
YOLO                          = Cancel independent of YOLO mode
SEATBELT                      = Cancel independent of sandbox policy
SAFE_YOLO                     = Cancel independent of safe-YOLO capability
SSH_AGENT                     = Cancel independent of SSH agent allow/deny
TASK_OPERATION_FENCE          = Cancel raises cancel fence before abort
F27                           = PASS (still green)
COMPLETION_AUTHORITY           = Cancel does NOT emit task.completed (verified)
```

### Gates

```text
PROTOS                        = not invoked (no proto changes)
BUILD_SDK                     = not invoked (no SDK changes)
LINT                          = not invoked (no lint-changed surface)
TYPECHECK_ACT_OWNED_DELTA     = 0 (no source changes)
TARGETED_TESTS                = 33+ PASS (aoc02 9/9 + aoc01 4/4 + sdk-task-control 20/20)
DIFF_CHECK                    = n/a (no diff)
```

### Live

```text
DOGFOOD_SOURCE_HEAD           = N/A (recon-only ACT)
VSIX_SHA256                   = N/A
SOURCE_INSTALLED_BYTE_EQUAL   = N/A

LIVE_EXPLICIT_COMPLETION      = N/A (recon-only ACT)
LIVE_HISTORY_COMPLETED        = N/A
LIVE_INTERRUPTED_RESUME       = N/A
```

### Board

```text
TASK_CANCEL_UI_RECON          = CLOSED_CAPTURE_INSUFFICIENT
RUNTIME-TASK-PROGRESSION_LANE = (entry added to runtime-task-progression.md ACT ledger)
EPIC-BOARD_CLOSURE_ROW        = (entry added to .factory/epic-board.md Recently closed transitions)
NEXT_ACT                      = (operator-driven LIVE capture of:
                                 turnState.phase, foregroundCommandRunning,
                                 backgroundCommandRunning, lastMessage.{type,say,ask,partial})
```

## Acceptance criteria

```text
C01_REPOSITORY_TRUST                       = PASS
C02_OLD_LIVE_CANCEL_SPECIMEN_BOUND          = PASS (description in chat; visible UI only)
C03_CURRENT_LIVE_MISSING_CANCEL_SPECIMEN    = PASS (description in chat; task Working + no Cancel)
C04_CURRENT_CANCEL_OWNER_IDENTIFIED         = PASS (SdkTaskControlCoordinator.cancelTask)
C05_CURRENT_RENDER_PREDICATE_IDENTIFIED     = PASS (streaming-phase-only)
C06_LAST_GOOD_FIRST_BAD_BOUND               = N/A (no first bad; Cancel always present)
C07_UPSTREAM_COMPARISON                     = PASS (byte-identical Cancel)
C08_BACKEND_CANCEL_CAPABILITY               = PASS (handler healthy)
C09_LIVE_RENDER_INPUTS_CAPTURED             = NOT_CAPTURED (no turnState dump; phase unknown)
C10_FIRST_BROKEN_BOUNDARY                   = UNBOUND (two candidates remain; requires LIVE phase capture)
C11_RED_REPRODUCED                          = NOT_APPLICABLE
C12_CAUSAL_DISCRIMINATOR                    = NOT_APPLICABLE (requires LIVE phase to discriminate)
C13_BOUNDED_REPAIR                          = NOT_APPLICABLE
C14_CANCEL_AUTOAPPROVE_INDEPENDENCE         = PASS (predicate independent)
C15_CANCEL_NOT_COMPLETION                   = PASS (cancel does NOT emit task.completed)
C16_CANCEL_NOT_CLEAR                        = PASS (cancel ≠ clearTask)
C17_LONG_RUNNING_CANCEL                     = PASS (foreground_command_running config exposes Cancel + Proceed)
C18_TARGETED_TESTS                          = PASS (33+ tests GREEN)
C19_LINT                                    = NOT_INVOKED (no source change)
C20_TYPECHECK_ACT_OWNED_DELTA               = 0 (no source change)
C21_DIFF_CHECK                              = PASS (no diff)
C22_DOGFOOD_BOUND                           = NOT_APPLICABLE (recon-only)
C23_LIVE_CANCEL_VISIBLE                     = NOT_TESTED (would require LIVE UI)
C24_LIVE_CANCEL_EFFECTIVE                   = NOT_TESTED
C25_WORKTREE_CLEAN                          = PASS
```

## Halt conditions invoked

```text
CAPTURE_INSUFFICIENT  (reviewer-corrected; supersedes the prior
                       NOT_REPRODUCED_AS_GLOBAL_MISSING_CANCEL framing
                       because the user DID provide a live screenshot
                       showing active work + no Cancel)
```

The recon reduced the search space: source-tree non-removal is
proven; backend cancel is healthy; upstream and ClineMM have identical
Cancel button structure. The remaining question is whether the
`turnState` projection is correct at the exact moment active work is
occurring — which is a LIVE-state question, not a source question.

## Governing decision rule

The pre-recon question was:

> "Why does the Cancel button appear in older UI but not current?"

The corrected recon answer:

> **Source-tree analysis proves the Cancel button is correctly
> implemented and correctly rendered under `streaming`-phase
> predicates.** However, the user's LIVE screenshot shows active work
> with no Cancel, which is consistent with two narrow remaining
> candidates: `UI_RENDER_DEFECT` (Cancel missing despite
> `phase === "streaming"`) or `TURN_STATE_PROJECTION_DEFECT`
> (Cancel missing because `phase !== "streaming"` despite genuine
> activity). A third benign possibility is the task being in
> `awaiting_approval` / `awaiting_followup` (intentionally no Cancel
> because user input is the next step).
>
> To classify: capture the four LIVE values named in §10
> (`turnState.phase`, `foregroundCommandRunning`,
> `backgroundCommandRunning`, last message
> `{type, say, ask, partial}`). If `phase === "streaming"` and Cancel
> is absent at the same moment, that's Case A (`UI_RENDER_DEFECT`).
> If `phase !== "streaming"` and the runtime is genuinely producing
> tokens or executing tools, that's Case B (`TURN_STATE_PROJECTION_DEFECT`).
> Otherwise, the symptom is benign.

**C1: GO_RECON done. Verdict: `CAPTURE_INSUFFICIENT`. No production repair authorized. The next live capture (operator-driven, four-value) discriminates Case A from Case B and from benign non-streaming phases.**

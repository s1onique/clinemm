# ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01

> Status: **OPEN / LIVE_RUNNING_STATE_BOUND + LIVE_POST_TERMINAL_CHRONOLOGY_BOUND / AUTHORITY_BIND_DEFERRED**.
> RECON + LIVE FAILURE REPRODUCTION, no production repair.
>
> ```text
> LAUNCH_HEAD = cf40c2b8b07520f9ddc2d798c6dfbb9830df9dea
>               (the commit that introduced this ACT;
>                canonical binding per
>                5b0fbd611aa0410f4391e0dce4f24d422990b7bb
>                "docs(factory): bind runtime-progression launch identity")
> ENTRY_HEAD  = a2417ef19909746ed878cdec5ce801a8f2decf81
>               (the HEAD the recon phase froze its subject against;
>                see .factory/evidence/.../entry-freeze.txt)
> TRIAGE_HEAD = 15f2adaf6c12dfdc79f47327e9ae93c46be52776
>               (HEAD at TRIAGE_BIND 2026-08-28, specimen cmd_mtcjhkhygpteq8v9)
> SPECIMEN_HEAD_2 = 76e07c12f7a67b59c555e24b20a60d454d941082
>               (HEAD at the operator's live capture instant, 2026-09-02,
>                specimen cmd_mtj6kki83r1bmrfz; NOT a TRIAGE_BIND commit)
> TRIAGE_BIND_COMMIT_2 = 8f5b80d4e631d6fbd044af67f1154d4d1642d2f9
>               (the commit that durably bound the new specimen;
>                "triage-bind(factory): ACT-CLINEMM-RUNTIME-TASK-
>                PROGRESSION-RECON01 post-terminal-02 specimen
>                cmd_mtj6kki83r1bmrfz (C1: GO_TRIAGE_BIND)")
> ```
>
> Operational state changed from `OPEN / WAITING_FOR_LIVE_EVIDENCE` to
> `OPEN / LIVE_RUNNING_STATE_BOUND / AWAITING_TERMINAL_DISCRIMINATOR`
> at TRIAGE_BIND on 2026-08-28 (TRIAGE_HEAD `15f2adaf6`): the
> background-command specimen `cmd_mtcjhkhygpteq8v9` was bound into
> `.factory/evidence/.../live-failure.json` as the awaited live failure
> for its **RUNNING-state half** only. The post-terminal chronology
> (terminal status / exit code, `onBackgroundStateChange(false, jobId)`,
> runtime phase after, whether the model emitted a continuation, whether
> the UI remained Waiting) is **UNOBSERVED** for this specimen — the job
> was still RUNNING at capture time, and the recon's six continuation-
> related seams remain UNVERIFIED. The discriminator has NOT yet run.
>
> Operational state further changed at TRIAGE_BIND post-terminal-02 on
> 2026-09-02 (SPECIMEN_HEAD_2 `76e07c12f`; bound at TRIAGE_BIND_COMMIT_2
>  `8f5b80d4e`, specimen `cmd_mtj6kki83r1bmrfz`):
> the background-command specimen `cmd_mtj6kki83r1bmrfz` was bound into
> `.factory/evidence/.../live-failure-post-terminal-02.json` as the
> awaited **post-terminal chronology** for the symptom family. This
> specimen is causally distinct from the prior bound specimen along
> four axes — turnState.phase=`awaiting_followup` (not `idle`),
> backgroundCommandRunning=`false` (not `true`), host_status=`aborted`
> (not `RUNNING`), writerId=`session-event-turn-complete-resumable-
> straggler-preserve` (not UNBOUND). Of the §3b six-event schema, T4
> and T6 are LIVE; T5 is UNAVAILABLE_FROM_TRACE (no TSWPD mechanism for
> non-TurnState emissions; SUPPORTING_NEGATIVE_OBSERVATION recorded); T1..T3
> remain UNAVAILABLE_FROM_TRACE
> for THIS specimen. The §3 discriminator's strongest candidate is
> CASE_A (LOCAL-EXIT AUTHORITY DEFECT — the writer at
> `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:223` was given
> authority to terminate a still-live background operation; the writer
> never reads `CommandJobManager` or `backgroundCommandRunning`),
> but is NOT yet adjudicated. ROOT_CAUSE_ISOLATED remains NO; the next
> bounded discriminator cycle must drive the writer through the real
> call path with a real RUNNING job in `CommandJobManager` and assert
> the writer still fires (RED if the authority defect is real, GREEN
> if a future repair closes the gap).
>
> `red-result.txt` therefore records `CAPTURE_INSUFFICIENT_FOR_CAUSAL_RED`,
> not a violated invariant. Per the C1 GO_WITH_EXISTING_RECON verdict
> (2026-08-28) and the C1 GO_TRIAGE_BIND verdict (2026-09-02), no
> parallel `ACT-CLINEMM-BACKGROUND-COMMAND-LOOP-LIVENESS01` and no
> parallel `ACT-CLINEMM-BACKGROUND-COMMAND-LOCAL-EXIT-TURN-ABORT-
> RECON01` is opened; this ACT owns the symptom. A future narrow
> authority-bind child ACT may be authorized by the next review cycle
> ONLY if the §3 discriminator surfaces a load-bearing seam that the
> umbrella cannot host.
> Owned by `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.

## 0. Entry conditions (per spec)

- branch = main
- HEAD contains `ecc885fa2` + bounded `docs(factory): correct census frontier summaries` correction
- worktree clean
- protected stashes untouched

Recorded in:
`.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/entry-freeze.txt`

## 1. Freeze the user-visible failure (DO NOT pre-classify)

Do NOT begin with source hypotheses. Capture **one real occurrence** of:

```text
task was progressing
  → progress stops
  → no truthful terminal transition
  → user must type "Continue"
```

For that occurrence capture (labels: LIVE / STRUCTURAL / INFERRED / UNAVAILABLE_FROM_TRACE):

- LAST_VISIBLE_ASSISTANT_STATE
- LAST_TOOL_NAME
- LAST_TOOL_OUTCOME
- LAST_TOOL_RESULT_PRESENT
- TASK_RUNTIME_STATE
- TASK_APPLICATION_OWNER
- TASK_PRESENTATION_STATE
- CANCEL_VISIBLE
- CANCEL_ENABLED
- RESUME_VISIBLE
- INPUT_ENABLED
- PENDING_MODEL_REQUEST
- PENDING_TOOL_REQUEST
- QUEUED_USER_MESSAGES
- TIME_SINCE_LAST_PROGRESS

Also record whether typing "Continue":

- starts a fresh model request
- drains an already-queued continuation
- changes owner state
- merely kicks a stuck scheduler
- changes only presentation
- is unknown

If the real symptom cannot be reproduced → `HALT_RED_NOT_REPRODUCED`.
Do NOT repair from upstream reports alone.

## 2. Reconstruct the runtime progression chain

Recon the **actual production path**:

```text
tool/model completion
  → result publication
  → task-state / reducer transition
  → continuation eligibility
  → continuation scheduling
  → next model request
  → presentation
```

Freeze exact source symbols / file / line range for:

- MODEL_RESPONSE_TERMINAL_SEAM
- TOOL_RESULT_TERMINAL_SEAM
- CONTINUATION_DECISION_SEAM
- CONTINUATION_SCHEDULER_SEAM
- TASK_OWNER_SEAM
- CANCEL_AUTHORITY_SEAM
- RESUME_AUTHORITY_SEAM
- USER_FOLLOWUP_SEAM

Do NOT assume they remain where prior Task-Control ACTs found them.
If the seam moved → `HALT_SEAM_MOVED`.

## 3. Failure taxonomy (one of A..H or I)

```text
A  TOOL_NEVER_TERMINATED
B  TOOL_TERMINATED_RESULT_NOT_PUBLISHED
C  RESULT_PUBLISHED_STATE_NOT_ADVANCED
D  STATE_ADVANCED_CONTINUATION_NOT_SCHEDULED
E  CONTINUATION_SCHEDULED_REQUEST_NOT_STARTED
F  REQUEST_STARTED_NO_PROGRESS
G  RUNTIME_ADVANCED_UI_STALE
H  USER_OWNERSHIP_WRONGLY_ACQUIRED
I  UNKNOWN / CAPTURE_INSUFFICIENT
```

Do NOT call chronology causality. If evidence cannot distinguish → `CAPTURE_INSUFFICIENT`.

## 3b. Deterministic terminal-state repro (post-TRIAGE_BIND, 2026-08-28)

The TRIAGE_BIND 2026-08-28 specimen (`cmd_mtcjhkhygpteq8v9`) bound only the
**RUNNING-state half** of the lifecycle. Promotion to
`LIVE_FAILURE_BOUND = PASS` requires the post-terminal chronology bound to
the SAME session/task. This section freezes the exact reproduction
procedure and the exact six-event capture schema so the next capture cycle
is unambiguous and diff-able.

### Command

Use an ordinary `run_commands` invocation that:

1. crosses the 15-second host foreground wait budget;
2. then terminates deterministically shortly after (no network, no
   interactive prompt, no signal-loss race);
3. emits a recognizable exit marker on stdout.

Canonical form:

```bash
python3 - <<'PY'
import time
print("BEGIN " + str(time.time()), flush=True)
time.sleep(20)            # >15s wait budget
print("TERMINAL_MARKER", flush=True)
PY
```

Equivalent (pure shell):

```bash
{ echo BEGIN $(date +%s); sleep 20; echo TERMINAL_MARKER; }
```

### Host capture flag

Enable the post-terminal authority diagnostic BEFORE the command fires.
For VS Code + ClineMM, set in workspace state:

```text
cline.diagnostic.postTerminalAuthority = true
```

(or the equivalent flag surfaced by
`apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-runtime.test.ts`
in the live host you are running against — confirm the exact key with
`ext.evaluate("Object.keys(globalThis)")` in the harness before capture).

### Six-event capture schema

Bind all six events to one log file. Recommended naming:

```text
.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/
  terminal-chronology-<jobId>.json
```

Shape:

```json
{
  "specimen_jobId": "cmd_<your-job>",
  "session_id": "<from PTAD>",
  "task_id":    "<from PTAD>",
  "events": [
    { "t": "T1", "name": "RUNNING_RETURNED", "ts_ms": ..., "jobId": "..." },
    { "t": "T2", "name": "TERMINAL_STATE",   "ts_ms": ..., "exit_code": ..., "stdout_last_200": "..." },
    { "t": "T3", "name": "BACKGROUND_STATE_CHANGE_FALSE", "ts_ms": ..., "jobId": "..." },
    { "t": "T4", "name": "RUNTIME_PHASE_AFTER", "ts_ms": ..., "runtime_phase": "<from PTAD>", "task_phase": "<from PTAD>" },
    { "t": "T5", "name": "CONTINUATION_EMITTED", "ts_ms": ..., "value": "YES|NO", "evidence": "<ptad-msg-id>" },
    { "t": "T6", "name": "UI_STATE_OBSERVED",    "ts_ms": ..., "task_header": "Waiting|...|", "input_enabled": true|false, "human_input_since_T1": false }
  ]
}
```

### Decision tree

| T1 → T6 outcome | `LIVE_FAILURE_BOUND` | §3 boundary candidates |
|---|---|---|
| T5 = **YES** (autonomous continuation observed) | **NO** — screenshot was an intermediate state, not the symptom | (the bug was the screenshot, not a `Continue`-bug; drop the case) |
| T5 = **NO** AND T6 = Waiting, input_enabled, human_input_since_T1 = false | **PASS** | proceed to §3 (most likely `C` / `D` / `E` / `H` — do NOT pre-select) |
| any T-event missing OR `session_id` ≠ the original session bound at T1 | **CAPTURE_INSUFFICIENT** | repeat with PTAD fully enabled |

### Hard constraints

- Zero new ACT may be opened from this capture. The recon owns the symptom.
- The exact six events must be present; partial chronologies are recorded
  as `CAPTURE_INSUFFICIENT`, not promoted.
- `T5 = YES` with no human input since `T1` is a **bug-the-screenshot**
  signal: the symptom was an intermediate state, not a true liveness
  failure. Re-classify as `I = UNKNOWN / CAPTURE_INSUFFICIENT` and stop.
- Do NOT pre-classify §3 boundary before the six events are bound.
- Do NOT touch `apps/`, `sdk/`, `webview-ui/` from this capture.

### Bound post-terminal-02 specimen (TRIAGE_BIND 2026-09-02)

The new background-command specimen `cmd_mtj6kki83r1bmrfz`
(taskId `1788297479245_hv9w5`, epoch 4) was bound at TRIAGE_BIND
post-terminal-02 on 2026-09-02 (SPECIMEN_HEAD_2 `76e07c12f`; bound at TRIAGE_BIND_COMMIT_2 `8f5b80d4e`) into
`.factory/evidence/.../live-failure-post-terminal-02.json`. This
specimen is **the missing post-terminal chronology** for the
existing symptom family and was captured against a real recurrence
on a real live ClineMM instance. Frozen evidence (per the v2 schema
of `live-failure.json`):

```text
LIVE_REMOTE_WORKLOAD_ALIVE    = PROVEN   (install-deps-linux.sh + cpanm child,
                                          192.168.50.31, elapsed ≈13m20s at capture)
LOCAL_JOB_OWNERSHIP           = LOST/ABSENT  (no local command/SSH process for
                                              the jobId at capture; CPU ~0)
BACKGROUND_COMMAND_RUNNING    = false    (SdkController.updateBackgroundCommandState flip)
HOST_STATUS                   = aborted  (LocalRuntimeHost session status)
TURNSTATE                     = awaiting_followup
TASK_HEADER_LABEL             = Waiting
WRITER                        = session-event-turn-complete-resumable-straggler-preserve
WRITER_PRODUCER_SITE          = apps/vscode/src/sdk/sdk-session-event-coordinator.ts:223
WRITER_FALSIFIED_COMMENT      = "the phase is no longer runtime-owned (no work is in flight)"
                                  (verbatim from sdk-session-event-coordinator.ts:210-216)
TSWPD_TRANSITIONS             = idle -> streaming (task-start-init-task)
                                  streaming -> awaiting_followup
                                  (session-event-turn-complete-resumable-straggler-preserve)
T1..T3                        = UNAVAILABLE_FROM_TRACE
T4                            = LIVE
T5                            = UNAVAILABLE_FROM_TRACE
                                  (TSWPD records TurnState writes only;
                                   SUPPORTING_NEGATIVE_OBSERVATION:
                                   no continuation-associated writer
                                   in the TSWPD ring at epoch 4; this
                                   is an honest negative observation,
                                   NOT proof)
T6                            = LIVE
```

Promotion gate: this is **PARTIAL_POST_TERMINAL_CHRONOLOGY_BOUND**
not **LIVE_FAILURE_BOUND = PASS** — the chronology is partial
(T4 + T6 are LIVE, T5 is UNAVAILABLE_FROM_TRACE — no TSWPD
mechanism for non-TurnState emissions; SUPPORTING_NEGATIVE_OBSERVATION
recorded; T1..T3 are absent). The operator MAY retroactively
bind T1..T3 + T5 from the host-side log if available; until then, the
authoritative state is `OPEN / LIVE_RUNNING_STATE_BOUND +
LIVE_POST_TERMINAL_CHRONOLOGY_BOUND / AUTHORITY_BIND_DEFERRED`.

Strongest candidate from this bound specimen (NOT YET ADJUDICATED —
the §3 discriminator still needs to run; per the C1 review
2026-09-02, the analysis must not promote CASE_A from hypothesis
to conclusion without executable proof that the writer's call path
excludes `backgroundCommandRunning`):

```text
CASE_A = LOCAL-EXIT AUTHORITY DEFECT
        the writer at sdk-session-event-coordinator.ts:223 was given
        authority to terminate a still-live background operation
        (LOCAL_TRANSPORT_GONE was treated as BACKGROUND_WORK_COMPLETED)
```

Required discriminator (next bounded cycle):

> Drive the real `SdkSessionEventCoordinator` writer through the
> real call path against a real `TurnStateTracker` and a real
> `CommandJobManager` that has a live RUNNING job. Assert the writer
> still fires. RED if the writer fires (the contract defect is real);
> GREEN if the writer does NOT fire (a guard exists; the specimen
> may have hit a different code path). Mirror the BHTD01
> synthetic-real test pattern at
> `apps/vscode/src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts`.
> Honest label: `SYNTHETIC_REAL`, not `REAL_PRODUCTION_SEAM`.

Discriminator executed (2026-09-02; ACAS01 series; 4/4 PASS at
HEAD `8f5b80d4e`):

```text
ACAS01.1 CURRENT_BEHAVIOR_WITNESS:
  - Drive real SdkSessionEventCoordinator with done event
  - Real TurnStateTracker seeded to streaming
  - Real MessageTranslatorState (so wasAttemptCompletionSeen
    and wasTerminalResponseCommittedThisTurn return false)
  - Real TSWPD ring enabled
  - Assert writerId == session-event-turn-complete-resumable-straggler-preserve
    AND transition == streaming -> awaiting_followup
  RESULT: PASS (under the trivial "no job input" case)
  NOT-A-RED: per the Factory reviewer
  (HALT_WRONG_DISCRIMINATOR, 2026-09-02): "A true RED would
  assert the required invariant and fail:
  `expect(after.phase).not.toBe('awaiting_followup')`. Given
  the current harness lacks job state, you cannot even
  formulate the right RED yet."

ACAS01.2 STRUCTURAL ABSENCE:
  - Read the handleSessionEvent body (lines 101-225) at HEAD
  - Assert the body does NOT contain "CommandJobManager" /
    "backgroundCommandRunning" / "backgroundCommandTaskId"
  RESULT: PASS
  (the writer's call path is provably absent any
   background-job liveness probe — PROVEN_NO via body slice)
  CAVEAT (per Factory reviewer): "It is useful, but it is
  not the discriminator we froze. A structural absence is
  not the same as a behavior witness of a guard against
  authority violation. The two are not equivalent."

ACAS01.3 DRIFT PIN:
  - Assert the source contains the writerId string,
    the comment "The phase is no longer runtime-owned",
    and the comment "(no work is in flight)"
  RESULT: PASS
  (the LIVE-specimen binding is still correct at HEAD)

ACAS01.4 CONTROL (precondition chain):
  - Mark wasAttemptCompletionSeen = true
  - Drive done event
  - Assert writer under test did NOT fire
    (the production code falls through to
     session-event-turn-complete-awaiting-followup-liveness
     at line 169 instead)
  RESULT: PASS
  (the precondition chain is honored)

Frozen at: apps/vscode/src/sdk/__tests__/runtime-task-progression-
          post-terminal-authority-discriminator.acas01-synthetic-real.test.ts
Honest label: SYNTHETIC_REAL (per Factory reviewer's P0_2 verdict
              on the prior BHTD01 recon)
Production delta: ZERO
Stash@{0}: UNTOUCHED

DISCRIMINATOR VERDICT (corrected post-HALT_WRONG_DISCRIMINATOR):
  Per the Factory reviewer (2026-09-02): CASE_A is NOT
  ADJUDICATED. ACAS01 did not exercise the required authority
  input — there is no CommandJobManager in the harness, so
  the structural absence probe and the current-behavior
  witness are not equivalent to running the 3-row owned-job
  matrix.

  The remaining open question is the architecture-level
  decision: at which host-side seam, if any, do
  turn-completion authority and background-job ownership
  authority both currently meet? See "Architecture recon"
  below.

ACAS01 ESTABLISHES (durable findings):
  LIVE_WRITER_BIND                = PROVEN
  BACKGROUND_LIVENESS_AT_WRITER   = STRUCTURALLY ABSENT (PROVEN_NO)
  CURRENT_BEHAVIOR_WITNESS        = PASS under trivial case
                                     (same trivial case the pre-existing
                                      CRA02-coord test already covers)
  PRECONDITION_CHAIN_CONTROL      = PASS

ACAS01 DOES NOT ESTABLISH:
  3-ROW_OWNED_JOB_DISCRIMINATOR   = NOT EXECUTED
  AUTHORITY_INPUT_MISSING         = NOT YET DECIDED (recon in progress)
  CASE_A                          = STRONG_CANDIDATE, NOT ADJUDICATED

ARCHITECTURE RECON (2026-09-02, post-ACAS01 verdict):
  - CommandJobManager lives on VscodeSessionHost
    (apps/vscode/src/sdk/vscode-session-host.ts:190), has NO
    taskId concept (grep -n taskId
    apps/vscode/src/sdk/command-job-manager.ts = empty).
    Row (c) "another task owns RUNNING job" is STRUCTURALLY
    IMPOSSIBLE in the current architecture.

  - SdkController.backgroundCommandRunning (line 784) is a
    real projection of CommandJobManager liveness, set via
    updateBackgroundCommandState(true, jobId) callback
    (line 1168). The field backgroundCommandTaskId
    (line 785) is named taskId but is actually populated
    with jobId per the callback wiring — MISLEADING NAME.
    The projection has no current-task ownership filter.

  - Session event listener chain:
      onSessionEvent(event)         [SdkController.ts:2298]
        → this.sessionEvents.handleSessionEvent(event)
                                     [SdkController.ts:1170]
        → SdkSessionEventCoordinator.handleSessionEvent(event)
                                     [sdk-session-event-coordinator.ts:52]
        → setTurnPhase(...)          [SdkController.ts:1627]
    SdkController has BOTH backgroundCommandRunning AND the
    session event listener but does NOT intervene. There is
    NO host-side composition point where both authority
    inputs currently meet.

  - The done event that triggers turnComplete originates in
    the agent runtime
    (apps/vscode/src/sdk/message-translator.ts:2135 for
    agentEvent.type === "done"). The agent runtime has NO
    view of CommandJobManager. Row (b) "upstream should never
    emit turnComplete while owned background work exists" is
    STRUCTURALLY IMPOSSIBLE to implement at the agent-runtime
    layer in the current architecture.

  - The only host-side seam where both authority inputs
    could in principle meet is SdkController. The
    discriminator must recon to that seam (or to a future
    seam that exposes the task-owned job relationship).
    This recon is in progress under a future bounded cycle;
    this ACT does NOT exercise it.

CORRECTED FACTORY STATE (post-HALT_WRONG_DISCRIMINATOR):

  ACT = ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01
  LIVE_WRITER_BIND = PASS
  P1_T5_CALIBRATION = PASS
  BACKGROUND_LIVENESS_ABSENT_FROM_WRITER = STRUCTURAL / PROVEN
  REAL_RUNNING_JOB_DISCRIMINATOR = NOT EXECUTED
  CASE_A = STRONG_CANDIDATE / NOT ADJUDICATED
  ROOT_CAUSE = NOT YET ISOLATED
  P0 = discriminator did not exercise the required authority input
  REPAIR_AUTHORIZED = NO
  NEXT = find real seam containing BOTH:
           turn-completion authority
           background-job ownership authority
         → execute 3-row owned-job discriminator
         → then classify A/B
  VERDICT = HALT_WRONG_DISCRIMINATOR
```

DO NOT open a parallel ACT to host this discriminator until the
bounded synthetic-real test cycle surfaces a load-bearing seam
that the umbrella cannot host. If the synthetic-real test cycle
succeeds and a real production-seam RED is needed, then — and
only then — a narrow authority-bind child ACT
(`ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-EMITTED-WITHOUT-
WORKLOAD-AUTHORITY-BIND01`) may be authorized by the next
review cycle.

## 4. Causal `Continue` discriminator

Capture state immediately before typing `Continue`, then after.

Classify into one of:

```text
CONTINUE_CREATES_NEW_REQUEST
CONTINUE_DRAINS_EXISTING_CONTINUATION
CONTINUE_RESETS_STALE_OWNER
CONTINUE_RESTARTS_SCHEDULER
CONTINUE_CHANGES_ONLY_PRESENTATION
CONTINUE_EFFECT_UNKNOWN
```

Ablate the human text content (`"Continue"`, `"."`, `"resume"`). If any
arbitrary user turn unblocks the task, the causal primitive is probably
`new-user-turn arrival`, not semantic interpretation of "Continue".
Do NOT over-test; one controlled pair is enough if the failure is rare.

## 5. Cancel-affordance authority (same ACT, same ownership seam)

Invariant under test:

```text
if a genuinely cancellable owner exists:    Cancel must be available
if no cancellable owner exists:            Cancel must NOT claim otherwise
```

Capture both directions:

```text
ACTIVE + CANCELLABLE OWNER + CANCEL ABSENT
IDLE  + NO OWNER          + CANCEL PRESENT
```

For every sampled state record: `runtime_state`, `owner_kind`,
`owner_id/generation if safely observable`, `cancellable`, `cancel_visible`,
`cancel_enabled`.

Outcome vocabulary:

```text
OWNER_CORRECT_UI_WRONG
OWNER_WRONG_UI_CONSISTENT
BOTH_WRONG
INVARIANT_HOLDS
UNOBSERVABLE
```

Do NOT add UI fixes in this ACT.

## 6. Upstream comparison (RADAR only)

Map the locally observed boundary against:

- #10537 terminal-output then Thinking stall
- #12079 command executes then "skipped" then Thinking stall
- #12827 skipped tool call leaves UI indefinitely Thinking
- #10122 stall + abort unavailable (mirrors our Cancel symptom)
- #12396 Resume Task fails after a stall

Promote a radar to IMPORT **only** when ALL three hold:

```text
same production boundary
same violated invariant
same required fix contract
```

Skeletal comparator table at
`.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/upstream-comparison.md`.

## 7. RED test (real production seam)

Once the real failure boundary is known, write the smallest RED through
the **real production seam**. Examples (NOT predetermined):

```text
tool result delivered -> continuation must become schedulable

or

terminal tool outcome -> owner must transition exactly once
                       -> next request must start

or

active owner -> cancellable projection must remain true
```

Required: `RED reproduces exact violated invariant`.
If RED does not reproduce → `HALT_RED_NOT_REPRODUCED`.
Do NOT convert it into a speculative implementation test.

## 8. Evidence artifact

`.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/`:

```text
live-failure.json            captured symptom (TRIAGE_BIND 2026-08-28,
                             specimen cmd_mtcjhkhygpteq8v9) — RUNNING-state half
                             with all fields above
live-failure-post-terminal-02.json  captured symptom (TRIAGE_BIND post-terminal-02,
                             2026-09-02, specimen cmd_mtj6kki83r1bmrfz) —
                             POST-TERMINAL CHRONOLOGY half (T4 + T6 LIVE,
                             T5 UNAVAILABLE_FROM_TRACE,
                             T1..T3 UNAVAILABLE_FROM_TRACE). Falsified
                             contract claim against the writer at
                             sdk-session-event-coordinator.ts:223 documented
                             verbatim. See §3b "Bound post-terminal-02
                             specimen" above.
continue-discriminator.json  before/after pairs for the Continue probe
cancel-authority.json        both directions of the cancel invariant
source-seam-map.md           REAL_PRODUCTION_SEAM table per seam
red-result.txt               RED capture against the real seam
upstream-comparison.md       radar vs import promotion table
terminal-chronology-<jobId>.json   six-event capture (T1..T6) from §3b,
                                   one per deterministic repro; the load-
                                   bearing artifact for promoting
                                   LIVE_FAILURE_BOUND from
                                   RUNNING_STATE_BOUND to PASS. (For the
                                   post-terminal-02 specimen, T4 + T6 are
                                   LIVE in live-failure-post-terminal-02.json;
                                   T5 is UNAVAILABLE_FROM_TRACE; T1..T3
                                   remain to be captured against a
                                   future deterministic repro of the same
                                   symptom on a host with PTAD fully
                                   enabled.)
final-assessment.md          written at closure
```

Each datum labelled LIVE / REAL_PRODUCTION_SEAM / STRUCTURAL / INFERRED / UNAVAILABLE_FROM_TRACE.
No synthetic→live promotion.

## 9. Stop rules

```text
HALT_RED_NOT_REPRODUCED         -> local failure cannot be reproduced
CAPTURE_INSUFFICIENT            -> runtime boundary cannot be discriminated
HALT_SEAM_MOVED                 -> assumed production seam is wrong
HALT_LEADING_HYPOTHESIS_REPAIR  -> implementation starts before classification
HALT_PRESENTATION_SCOPE_CREEP   -> Completed framing / TaskHeader polish sneaks in
```

## 10. Gates at closure

```text
LIVE_FAILURE_REPRODUCED          PASS or NOT_REPRODUCED
BOUNDARY_CLASSIFIED             one of A..H, or CAPTURE_INSUFFICIENT
CONTINUE_EFFECT_CLASSIFIED      PASS
CANCEL_AUTHORITY_CAPTURED       PASS / LIVE_UNOBSERVABLE
RED_PRODUCTION_SEAM             PASS or HALT_RED_NOT_REPRODUCED
PRODUCTION_FILES_CHANGED        = 0
git diff --check                PASS
typecheck                       PASS if test / stub surface touched
targeted tests                  PASS except intentional isolated RED capture
```

## 11. Exit (one of three useful outcomes)

```text
PASS_RECON_CAUSE_DISCRIMINATED   -> author bounded repair ACT
NOT_REPRODUCED                    -> preserve witness, do not repair
CAPTURE_INSUFFICIENT              -> author bounded diagnostic-acquisition ACT
```

No generic "probably scheduler bug" verdict.

## Sequencing after this ACT (per the reviewer)

```text
1. RUNTIME-TASK-PROGRESSION-RECON01        <- this ACT
2. bounded runtime repair                    (only after RED)
3. EDITOR-TOOL-APPROVAL-FRICTION-RECON01
4. TES-IMPL-01
5. TERMINAL-REPORT-COMPLETION-FRAMING
```

The `Completed` framing and TaskHeader work stay OUT of this ACT — they
answer different epistemic questions and combining them now would weaken
the causal chain.

## Scope discipline (THIS ACT)

- NO production repair
- NO TaskHeader / Completed-framing presentation work
- NO telemetry implementation
- NO new epic on the board (only one ACT ledger row added in the
  runtime-task-progression detail file; the board row for the umbrella
  epic exists and is unchanged)
- NO porting or backporting any upstream fix
- NO touching the protected `stash@{0}` (C2 GREEN from the prior ACT)
- DO add the canonical ACT ID in the epic detail file's ACT ledger once,
  then stop. Do NOT reopen, rewrite, or expand the epic.

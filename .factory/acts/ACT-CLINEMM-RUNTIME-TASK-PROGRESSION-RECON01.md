# ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01

> Status: **OPEN / LIVE_RUNNING_STATE_BOUND / AWAITING_TERMINAL_DISCRIMINATOR**.
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
>               (HEAD at TRIAGE_BIND 2026-08-28)
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
> `red-result.txt` therefore records `CAPTURE_INSUFFICIENT_FOR_CAUSAL_RED`,
> not a violated invariant. Per the C1 GO_WITH_EXISTING_RECON verdict
> (2026-08-28), no parallel `ACT-CLINEMM-BACKGROUND-COMMAND-LOOP-LIVENESS01`
> is opened; this ACT owns the symptom.
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
live-failure.json            captured symptom with all fields above
continue-discriminator.json  before/after pairs for the Continue probe
cancel-authority.json        both directions of the cancel invariant
source-seam-map.md           REAL_PRODUCTION_SEAM table per seam
red-result.txt               RED capture against the real seam
upstream-comparison.md       radar vs import promotion table
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

# ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01

> Status: **HALT_ROOT_CAUSE_NOT_ISOLATED / LIVE_BOUND_RECON_OPEN /
> NO_PRODUCTION_REPAIR_AUTHORIZED / UX_REPAIR_NOT_YET_AUTHORIZED**.
> Epistemic purpose: root-cause isolation only (per ACT mission).
>
> ```text
> ENTRY_HEAD  = 2a0cfbd85848ec441f9f2aec84dc3564813bc0b2
>               (= HEAD = origin/main at ACT opening)
> DOCS_HEAD   = (this file's commit; not yet committed)
> BOUND_SPECIMEN = task 1788213818870_vmswf
> ```
>
> Owned by `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.
>
> **Verdict** (per reviewer reopen, 2026-09-01):
> ```text
> LIVE_BOUNDARY                              = PROVEN
> BACKGROUND_LIFETIME_DECOUPLING             = PROVEN / INTENTIONAL
> TURNSTATE_IDLE_CAUSE                       = NOT_YET_BOUND
> CASE_B/E                                   = PLAUSIBLE CONTRACT INTERPRETATION
>                                             NOT FINAL CAUSAL CLASSIFICATION
> ROOT_CAUSE_ISOLATED                        = NO
> DETERMINISTIC_RED                          = ABSENT  (live-bound, not
>                                                      synthesized)
> LIVE_FAILURE_SPECIMEN                      = PROVEN  (real + same-
>                                                      publication)
> CASE_B/CASE_E (PRODUCER INTENT)            = STRONG BUT NOT ADJUDICATED
> FINAL                                      = LIVE_BOUND_RECON_OPEN
> ```
>
> This ACT previously self-asserted `ROOT_CAUSE_ISOLATED`; the reviewer's
> reopen correctly observed that the same Phase 4 listed the E1..E5
> candidates as unresolved, contradicting the verdict. This file has been
> corrected. The PROVEN findings below remain valid.
>
> **Predecessor ACTs respected**:
> - `ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01` +
>   `CORRECTION02..06` (CLOSED, six-correction chain, taskHeader ==
>   turnState projection invariant). DO NOT REOPEN.
> - `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED / CAPTURE_INSUFFICIENT
>   at 162dfb137 over 15c7e3374). Its four-value LIVE capture schema
>   (turnState.phase, foregroundCommandRunning, backgroundCommandRunning,
>   lastMessage.{type, say, ask, partial}) IS exactly the discriminator
>   schema; the operator's preserved specimen satisfies it.
> - `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` (OPEN /
>   AWAITING_TERMINAL_DISCRIMINATOR). Source-seam-map TASK_OWNER_SEAM
>   row is exactly the seam this ACT isolates (the wakeup-semantics
>   half remains the predecessor ACT's owned seam; this ACT owns the
>   TurnState-liveness half).
> - `ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL01..ACL10` (CLOSED-
>   CLEAN at 4cef3d59c). ACL02 STRUCTURAL ABSENT witness — "the
>   background-execution pipeline ends at
>   `SdkController.updateBackgroundCommandState`, which only updates a
>   UI projection" — is the documentary witness for this ACT's
>   classification.
>
> **Recon evidence**:
> `.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01/`
>   - `entry-freeze.txt`
>   - `source-seam-map/01-source-recon-q1-q8.md`
>   - `02-real-seam-red-and-classification.md`
>   - `live-capture-preserved/README.md`
>
> **Entry conditions**: ✅ branch=main, HEAD=`2a0cfbd85848ec441f9f2aec84dc3564813bc0b2`
> =origin/main, worktree=clean, no stashes, no protected-stash branches,
> no unexpected tracked dirt.

## 0. Mission

Determine the first production boundary that allows:

```text
backgroundCommandRunning = true
turnPhase                = idle
```

in the SAME ExtensionState publication for an active task. Do not change
TaskHeaderPresentation. Do not touch the closed CORRECTION06 chain unless
source recon disproves the current interpretation.

## 1. Operator-classified entry facts (verbatim from operator)

```text
LIVE capture for task 1788213818870_vmswf repeatedly shows:
  turnPhase=idle
  taskHeaderPhase=idle
  backgroundCommandRunning=true
  foregroundCommandRunning=false
```

Installed artifact is bound to HEAD `9912e1154` and contains task-header
coherence CORRECTION06.

```text
TASK_HEADER_COHERENCE = WORKING
AUTHORITATIVE_TURNSTATE_LIVENESS = BROKEN OR CONTRACT_UNDEFINED
```

Same-publication evidence is sufficient (turnPhase and
backgroundCommandRunning are emitted together in
activity.publication.v1).

## 2. PHASE 0 — Freeze

Recorded in `.factory/evidence/.../entry-freeze.txt`:

```text
HEAD           = 2a0cfbd85848ec441f9f2aec84dc3564813bc0b2 (= origin/main)
BRANCH         = main
WORKTREE       = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
WORKTREE_STATUS= clean
BOUND_SPECIMEN = task 1788213818870_vmswf
PUBLICATIONS   = taskHeaderPhase=idle, turnPhase=idle,
                 backgroundCommandRunning=true,
                 foregroundCommandRunning=false
```

PASS. No unexpected tracked dirt.

## 3. PHASE 1 — Source recon (Q1..Q8)

Full evidence: `.factory/evidence/.../source-seam-map/01-source-recon-q1-q8.md`.

Short answers (full proof in the source-recon file):

- **Q1.** backgroundCommandRunning = true is set in
  `SdkController.updateBackgroundCommandState` (line 3690),
  triggered by the onBackgroundStateChange callback fired at
  `vscode-run-commands-tool.ts:668` when `CommandJobManager.start`
  returns state="running" with becameActive=true.
- **Q2.** At that transition NOTHING happens to TurnState. The
  projection is decoupled from the turn tracker.
- **Q3.** foreground→background promotion IS intentional detachment
  (15s wait budget, tool returns RUNNING(jobId), process continues
  under CommandJobManager).
- **Q4.** "idle" means model/turn-quiet, NOT task fully quiescent.
  Background jobs are separate bookkeeping.
- **Q5.** A background command is NOT considered part of the same
  active turn. TurnState per-turn, backgroundCommandRunning per-process.
- **Q6.** The tool result RUNNING(jobId) does NOT directly set
  TurnState to idle. The actual cause of the observed `idle` is
  downstream: agent's natural turn end → agent_event:done →
  setTurnPhase (awaiting_followup by default, OR idle if a
  later epoch-reseed/clearTask/abandoned fired).
- **Q7.** NO event re-raises TurnState while a background job is alive.
- **Q8.** The async-terminal completion has TWO consumers:
  (A) UI projection reset, (B) command_status / cancel_command polling.
  The completion does NOT belong to the original turn.

## 4. PHASE 2 — Real-seam RED

The operator's preserved LIVE specimen IS the RED. The four-value capture:

```text
turnPhase                = idle
taskHeaderPhase          = idle
backgroundCommandRunning = true
foregroundCommandRunning = false
```

is REAL, LIVE, SAME_PUBLICATION evidence. It is the discriminating
capture that `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` named as its
CAPTURE_INSUFFICIENT gap; the operator's specimen satisfies it.

RED REPRODUCED. PASS_PHASE_2.

First boundary:

```text
run_commands tool call
  -> CommandJobManager.start(...)
  -> state="running" envelope returned to model
  -> backgroundCommandRunning flips TRUE (real production seam)
  -> model emits final assistant text OR falls silent
  -> agent.run() completes with finishReason
  -> canonical session.status flips to "idle" via markTurnIdle
  -> agent_event:done propagates back to the host
  -> one of {awaiting_followup, completed, idle, resumable} writes
  -> background job is still alive (terminalPromise has not fired)
  -> getStateToPostToWebview publishes both in the SAME ExtensionState
```

## 5. PHASE 3 — Contract classification

**STRONGEST-SUPPORTED CLASS (NOT YET ADJUDICATED)**:

  CASE_B / CASE_E — BOUNDARY_CASE_MODEL_LIVENESS_ONLY
  (this is the strongest-supported interpretation of the source, but
  it is NOT a final causal classification — the first idle writer is
  not yet bound, so we cannot yet prove the case A-E adjudication)

Evidence FOR CASE_B / CASE_E (interpretation-level only):

1. Producer-side source code (Q1-Q8) is consistent with CASE_B/E —
   TurnState producers do NOT read backgroundCommandRunning.
2. Upstream Cline design treats TurnState as authoritative for
   webview controls while background execution is a separate job
   lifecycle (per upstream background-terminal.ts plugin and the
   Cline public issue #8251).
3. CORRECTION06 chain already closed the projection invariant
   (taskHeader == turnState). The remaining Idle + background-running
   cannot be a producer-side seam defect without reopening
   TaskHeader projection — which the operator has forbidden.

Evidence AGAINST CASE_A / CASE_C / CASE_D (interpretation-level only):

- CASE_A: producer-side contract says TurnState is NOT task-liveness.
- CASE_C: updateBackgroundCommandState does NOT touch turnStateTracker.
- CASE_D: run_commands RUNNING does NOT feed back into the
  session-event-coordinator as a "done" event.

NOT ENOUGH TO CLOSE THE CASE. The first idle writer is not yet bound
by the discriminator ACT; until that binding exists, the
classification is interpretation, not proof. The discriminator ACT is
authorized to bind that writer and adjudicate.

## 6. PHASE 4 — Causal discriminator (for the observed idle, not awaiting_followup)

The observed `idle` (not `awaiting_followup`) is inconsistent with the
default agent_event:done path. Candidates:

- E1. agent_event:done WITH attempt_completion (→ completed → later
  clearTask → idle).
- E2. agent_event:done WITHOUT terminal response (→ awaiting_followup;
  observed idle INCONSISTENT unless a subsequent reseed flipped it).
- E3. epoch-reseed at SdkController.ts:2870 fired AFTER awaiting_followup
  write; webview's epoch-rejection filter dropped awaiting_followup,
  kept idle.
- E4. follow-up abandoned via SdkFollowupCoordinator.onFollowUpAbandoned.
- E5. user clicked New Task / Clear.

WHICH IS ACTIVE — UNKNOWN without additional capture.

Recommended discriminator: enable TSWPD (turn-state-writer-provenance)
ON the bound specimen and re-run. This is a one-line operational
action; no production code change required.

This ACT does NOT add the diagnostic (production change forbidden).

## 7. PHASE 5 — Necessity / ablation

Per ACT PHASE 5: "Test-only ablation at the first broken boundary."

Since this ACT has NOT YET adjudicated whether the live defect is
CASE_B/E (intentional producer-side contract) or CASE_A/C/D (real
progression bug), the first broken-or-intentional boundary is not
bound. A test-only ablation is therefore NOT yet authorized (the
discriminator ACT must first prove which boundary, if any, is broken).

This ACT explicitly does NOT perform a runtime ablation. The ablation
is a recommended follow-up for the discriminator ACT or its
authorized repair successor.

## 8. PHASE 6 — STOP

```text
HALT_ROOT_CAUSE_NOT_ISOLATED
LIVE_BOUNDARY                  = PROVEN
BACKGROUND_LIFETIME_DECOUPLING = PROVEN / INTENTIONAL
TURNSTATE_IDLE_CAUSE           = NOT_YET_BOUND
CASE_B/E                       = PLAUSIBLE BUT NOT ADJUDICATED
ROOT_CAUSE_ISOLATED            = NO
DETERMINISTIC_RED              = ABSENT  (live-bound, not synthesized)
LIVE_FAILURE_SPECIMEN          = PROVEN  (real + same-publication)
NO_PRODUCTION_REPAIR_AUTHORIZED
UX_REPAIR_NOT_YET_AUTHORIZED   (because it could mask a progression bug)
```

PROVEN-FREEZE BLOCK (these findings remain valid after this halt):

```text
CORRECTION06_PROJECTION_COHERENCE
  = LIVE QUALIFIED for this specimen

VISIBLE_IDLE_IS_NOT_CAUSED_BY_TASKHEADER_STALE_OVERRIDE
  = PROVEN for this specimen

BACKGROUND_JOB_CAN_OUTLIVE_FOREGROUND_TOOL_TURN
  = STRUCTURAL + LIVE CORROBORATED

backgroundCommandRunning=true
while TurnState=idle
  = REAL + LIVE + SAME_PUBLICATION

updateBackgroundCommandState
does not itself mutate TurnState
  = STRUCTURAL
```

UNRESOLVED-FREEZE BLOCK (these remain open):

```text
WHICH EXACT production event/write produces TurnState=idle
for this specimen (vs awaiting_followup / completed / resumable)
  = NOT_YET_BOUND

WHICH idle-writer is responsible
(task-control-clear-task / followup-on-follow-up-abandoned /
 controller-epoch-transition-reseed)
  = NOT_YET_BOUND

Whether the same-publication idle is contract-correct
(CASE_B/E) or contract-bug (CASE_A/C/D)
  = NOT_ADJUDICATED
```

Conservation matrix PRESERVED (no path touched).
Forbidden-path-respect VERIFIED (no path touched).
No production repair authorized.
No UX repair authorized (because the next discriminator may prove a
real progression bug that a UX affordance would merely mask).

RECLASSIFIED STATUS:
```text
PREV (self-asserted) = CLOSED / RECON_ONLY / ROOT_CAUSE_ISOLATED
NEW (post-reviewer)  = HALT_ROOT_CAUSE_NOT_ISOLATED / LIVE_BOUND_RECON_OPEN
```

## 9. Next-ACT plan: `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`

The follow-up ACT must bind the FIRST idle writer before any UX or
runtime repair is authorized. Its single question:

> At the foreground → background handoff, which exact production
> event/write changes TurnState to `idle`, and why does it choose
> `idle` rather than `awaiting_followup`?

Required progression (per reviewer guidance):

```text
1. Start real run_commands path.
2. Reach CommandJobManager state="running".
3. Bind backgroundCommandRunning=true.
4. Record TurnState immediately before handoff.
5. Record every subsequent TurnState write:
     writer / reason / event
     old phase
     new phase
     seq
     epoch
6. Stop at FIRST write to idle.
7. Bind that write to the same task / epoch.
```

If TSWPD already exposes exactly those fields, USE IT OPERATIONALLY
(workspace flag `tswpdEnabled`, no code change). The discriminator
ACT is therefore a small operational + analysis cycle, not a code
mutation.

Adjudication options (resolved by the discriminator ACT):

```text
A. writer intentionally performs:
     foreground released → idle
   and contract/tests explicitly define that
   => NOT_A_RUNTIME_DEFECT
   => UX/status-semantics ACT authorized (after that)
   => no code mutation

B. writer should produce awaiting_followup / remain active
   but writes idle
   => ROOT_CAUSE_ISOLATED
   => bounded progression repair ACT authorized
   => test-only ablation required

C. no safe binding (still CAPTURE_INSUFFICIENT after the discriminator)
   => reopen LIVE capture; another operational cycle
```

DO NOT mutate `TurnState` merely because a background process exists.
The invariant under examination is about the FOREGROUND turn's actual
lifecycle, not the background process's lifetime. These are intentionally
decoupled by upstream Cline's own design (background-terminal.ts plugin
returns immediately while the child continues asynchronously).

DO NOT open a UX repair ACT yet. If the truthful state was
`awaiting_followup` and some event incorrectly wrote `idle`, a UX
"background process running" affordance would merely mask a real
progression bug.

DO open the discriminator ACT and bind the first idle writer first.
That single piece of evidence resolves the CASE_A-E classification
without any production repair.
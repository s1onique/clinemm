# C2.3-CONT.4 evidence — W11 same-task continuation, W12 brand-new-task epoch transition

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.4

ENTRY_HEAD = ce2a41419
EXIT_HEAD  = <this commit>

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)
```

## 1. Verdict

```
W11_SAME_TASK_CONTINUATION         = PASS
W12.1_CROSS_SESSION_LATE_TERMINAL  = PASS  (R1 session authority)
W12.2_POST_RUN_B_LATE_TERMINAL     = PASS  (identity mismatch)
W12.3_FULL_MODEL_A_COUNTS          = PASS
W12.4_SAME_SESSION_EPOCH_STRESS    = HALT  (defect reproduced)

VERDICT = QUALIFICATION_FOUND_DEFECT_NEW_TASK_EPOCH_OWNERSHIP
CONT_5_AUTHORIZED = false
C2_4_AUTHORIZED  = false
E7_AUTHORIZED    = false
```

CONT.4 must HALT per ACT §52. The W12.4 same-session stress test reproduces
`C23-HARDEN-1` in the stateful new-task path: the run-epoch gate alone
(canonical Run-Id tracker + identity mismatch + R2 continuation fence) does
**not** protect task-B from a stranded terminal arriving AFTER
`task_reset + resetForNewTask + task_requested(task-B)` but BEFORE the
accepted `run-started(B)`.

## 2. W12.4 minimal defect trace

```
task_requested(task-A)
set-active-session = session-17
canonical run-started(session-17, run-93)            # canonicalRunIdRef=run-93
task_reset                                          # HOST_TASK
wiring-reset-for-new-task                           # canonicalRunIdRef=undefined, fence=false
task_requested(task-B)                              # lifecycle=running for B
canonical run-finished(session-17, run-93)          # LATE run-A, pre-B-start
  → gate: fenced=false, active=undef
  → stranded = (false && ...) || (false && ...) = false
  → event APPLYs
  → task_completed record produced (run-93)
  → task-B lifecycle flipped to completed           # DEFECT
canonical run-started(session-17, run-94)
canonical run-finished(session-17, run-94)
  → task_completed record produced (run-94)
  → final lifecycle=completed (last-arrival-wins on terminal-to-terminal,
                                which is the frozen policy)

staleRunTerminalSuppressed = 0
task_completed records    = 2  (one from late run-A probe, one from run-B)
final identity.taskId     = "task-B"
final lifecycle.kind      = "completed"
```

## 3. What passes (the 5 working gates)

| Test                          | What it pins                                  |
|-------------------------------|------------------------------------------------|
| **W11.1** continuation full   | R2 fence catches pre-start late run-A; identity mismatch catches post-start late run-A; run-B applies exactly once. `staleRunTerminalSuppressed === 2`. |
| **W11.2** continuation ckpt   | visibleTaskId stays task-A; lifecycle returns to running after `same_task_continued`; pre-start late run-failed is SUPPRESSED. |
| **W12.1** cross-session       | R1 session authority refuses late session-A event when active=session-B. |
| **W12.2** post-start identity | Identity mismatch catches late run-failed(run-93) when active=run-94. |
| **W12.3** full Model-A counts | Exact record counts and divergence gates for a clean cross-session transition. |

All 5 share the same hard gates:
- `D10_UNKNOWN === 0`
- `invariantViolations === 0`
- `observerErrors === 0`
- `evidenceGaps === 0`
- `fallbackReconstructedApplied === 0`

## 4. Defect analysis

### 4.1 The exposed gap

The current canonical run-epoch terminal ownership gate has three clauses
combined by OR (with two of them guarded by R1 session authority):

```
stranded =
    (fenced && event.runId === retiredRunId)      // R2
 || (activeRunId defined && event.runId !== activeRunId)  // identity
```

After `task_reset + resetForNewTask`:
- `fenced = false` (the continuation fence is cleared by resetForNewTask)
- `activeRunId = undefined` (the canonical run tracker is cleared)
- Both stranded clauses are false
- Event with `event.runId === "run-93"` is APPLYd
- The shadow's lifecycle is `running` (just seeded by `task_requested(B)`)
- `task_completed` APPLYs → task-B lifecycle flips to `completed`

In production, this window is short — between `resetForNewTask()` and the
next `run-started(B)`. In current `SdkController.initTask`, the runtime
subscription is also detached/reattached during initTask, so a stranded
event from the previous run normally cannot arrive in this window. But:

1. The wiring itself does not enforce "no terminals until next
   `run-started(B)` accepted". The gate is permissive.
2. If the runtime subscription were ever torn down lazily, or if the
   controller ever emitted a `task_requested` without first re-attaching
   the subscription, the gate would let a stranded terminal through.
3. Even with a clean subscription, the harness can simulate the window
   directly (as W12.4 does) and prove the gate fails.

### 4.2 Production impact

Today in production: low (subscription is reattached in the same
`initTask` call as `resetForNewTask`, before any new run events arrive).

The defect is a defensive gap, not an active race. The next runtime
subscription re-attach closes the timing window in current code.

### 4.3 Required fix shape

The run-epoch gate needs a third clause for the post-reset, pre-run-start
window:

```
stranded =
    (fenced && event.runId === retiredRunId)
 || (activeRunId defined && event.runId !== activeRunId)
 || (post-reset && event.runId defined && event.runId === retiredRunId)
    // C23-HARDEN-1 carry-forward, closed by C2.3-CONT.4-CORRECTION
```

`post-reset` is a new boolean on the wiring, set true by
`resetForNewTask()` and cleared by the next accepted canonical
`run-started`. While `post-reset` is true and `fence` is false, ANY
terminal canonical event whose `event.runId` is defined is SUPPRESSED.
The cleared `activeRunId` no longer admits a defined-runId terminal
unilaterally.

A simpler shape: while `fence || post-reset` is true, any defined-runId
terminal is SUPPRESSED (OR-not-AND semantics; the same shape as the
current R2 fence).

This is a **narrow, well-bounded fix**. Production semantic delta: +1
boolean state on the wiring, +1 line in the gate predicate. No reducer
changes. No harness changes. No public type changes.

## 5. What is NOT a defect

Per the ACT, the following are not part of CONT.4 and remain out of
scope:

- **TERMINAL_TO_TERMINAL_PRECEDENCE**: completed→failed, failed→completed
  remain last-arrival-wins (frozen policy, board-flagged
  `UNRESOLVED`). W12.4's final lifecycle is `completed` regardless of
  which terminal arrives last; that is correct under the frozen policy.
- **NO_ACTIVE_SESSION_CANONICAL_POLICY**: still C2.4 carry-forward.
- **W06_REAL_DENY_SEMANTICS**: still open, unrelated.
- **Hub/Remote production fallback coverage**: still C2.4+ carry-forward.

## 6. Halt conditions reached

- **H8 (W12 old A terminal before B run-start mutates B)**: REACHED.
  This is the gating halt condition for CONT.4 halt per ACT §51.

No other halt conditions triggered:
- **H7 (old run terminal mutates resumed W11 run)**: not reached
  (W11.1 + W11.2 both pass; R2 fence + identity both working).
- **H1, H2 (production semantic change required)**: yes, but only for
  the narrow fix in §4.3, not for the qualification itself.
- **H15 (test weakened after observing failure)**: NO. W12.4 was
  designed per ACT §29 to fail on the defect; the failure is the
  documented qualification result.
- **H11–H14, H16–H20**: not reached.

## 7. Next ACT (NOT CONT.5)

Per ACT §55: do not produce CONT.5 until the C23-HARDEN-1 defect has
a correction disposition.

The next ACT is a narrow correction ACT:

```
PROPOSED ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.4-CORRECTION

MISSION = close C23-HARDEN-1 by adding the post-reset clause to the
          run-epoch terminal ownership gate.

EXPECTED SEMANTIC DELTA = +1 boolean state on the wiring,
                           +1 line in the gate predicate.
PRODUCTION SEMANTIC DELTA = 5 LOC + 1 setter (mirror of CORRECTION04).

EXPECTED OUTCOME:
  W12.4 PASS
  W11.1, W11.2, W12.1, W12.2, W12.3 unchanged
  All C8 tests unchanged
  All C2.2 / C2.3 baseline unchanged
  C2.0 historical baseline unchanged (CONT.6 disposition)

OUT OF SCOPE:
  Hub/Remote production fallback coverage (C2.4+)
  NO_ACTIVE_SESSION_CANONICAL_POLICY (C2.4)
  TERMINAL_TO_TERMINAL_PRECEDENCE (board UNRESOLVED)
```

After this correction ACT lands and re-qualifies W12.4, CONT.5
(W13-W16) becomes authorized.

## 8. Board update

```
ELM-02F F0/F0-CORR01/F1/F1-CORR01..03 ✅
C2.0 / C2.1 ✅
C2.2 + CORR01 + CORR02 ✅

C2.3
  W01-W04 ✅
  CONT.0 + CORR01 ✅
  F01-F03 ✅
  W05 ✅
  W06 approval primitive ✅
  W06 real deny semantic 🟨
  W07/W08 ✅
  CONT.2-CORR01 ✅
  CONT.2-CORR02 ✅
  CONT.2-CORR03 ✅
  CONT.2-CORR04 ✅
  CONT.3 W09/W10 ✅

  CONT.4 W11/W12
    W11.1 ✅
    W11.2 ✅
    W12.1 ✅
    W12.2 ✅
    W12.3 ✅
    W12.4 🛑 QUALIFICATION_FOUND_DEFECT_NEW_TASK_EPOCH_OWNERSHIP
    C23-HARDEN-1 🛑 REPRODUCED IN STATEFUL NEW-TASK PATH

  CONT.4-CORRECTION (next ACT)  ⛔
  CONT.5 W13-W16 ⛔
  CONT.6 ⛔

  C23-HARDEN-1 carry-forward = now promoted to ACTIVE_DEFECT

C2.4 ⛔
C2.5 ⛔
E7 ⛔
```

## 9. Required W11 final report

```
W11_SAME_TASK_CONTINUATION: PASS

TASK_ID_BEFORE       = "task-A"
TASK_ID_AFTER        = "task-A"
SESSION_BEFORE       = "session-17"
SESSION_AFTER        = "session-18"
RUN_BEFORE           = "run-93"
RUN_AFTER            = "run-94"
CONTINUATION_FENCE_BEHAVIOR = cleared on next accepted run-started;
                              pre-start late run-finished SUPPRESSED;
                              post-start late run-failed SUPPRESSED by identity.

OLD_RUN_TERMINAL_BEFORE_NEW_START_MUTATIONS = 0
OLD_RUN_TERMINAL_AFTER_NEW_START_MUTATIONS  = 0
CURRENT_RUN_TERMINAL_MUTATIONS              = 1

STALE_RUN_TERMINAL_SUPPRESSED = 2

EVENTS_OBSERVED (W11.1)  = 7 (1 HOST_TASK requested + 1 HOST_TASK continued
                              + 1 canonical run-started A
                              + 1 canonical run-finished A (late, SUPPRESSED)
                              + 1 canonical run-started B
                              + 1 canonical run-failed A (late, SUPPRESSED)
                              + 1 canonical run-finished B)
COMPARISONS              = 4 (1 each for the 4 admitted records)
ORIGIN_COUNTS            = HOST_TASK=2, RUNTIME_CANONICAL=4,
                            HOST_RECOVERY=0, RUNTIME_RECONSTRUCTED=0

D00..D11                 = D00_AGREE=4, D10_UNKNOWN=0,
                            others=0

INVARIANT_VIOLATIONS     = 0
D10_UNKNOWN              = 0
OBSERVER_ERRORS          = 0
EVIDENCE_GAPS            = 0

FINAL_LIFECYCLE          = completed
VERDICT                  = PASS
```

## 10. Required W12 final report

```
W12_NEW_TASK_MODEL_A: HALT (W12.4 reproduction)

TASK_A = "task-A"  SESSION_A = "session-17"  RUN_A = "run-93"
TASK_B = "task-B"  SESSION_B = "session-18" (cross-session case)
                    RUN_B     = "run-94"

TASK_RESET_RECORDS   = 0  (cleared by resetForNewTask; recorder
                            is reset between task epochs by design)
TASK_REQUESTED_B_RECORDS = 1

PRE_RUN_B_LIFECYCLE = running

OLD_A_TERMINAL_PRE_RUN_B_MUTATIONS  = 0  (cross-session R1 refuses)
OLD_A_TERMINAL_POST_RUN_B_MUTATIONS = 0  (identity mismatch)

CURRENT_B_TERMINAL_MUTATIONS = 1

CANONICAL_RUN_TRACKER_RESET = yes (cleared by resetForNewTask)
CONTINUATION_FENCE_RESET    = yes (cleared by resetForNewTask)
DEDUP_EPOCH_RESET           = yes (recorder.reset via resetForNewTask)

STALE_RUN_TERMINAL_SUPPRESSED (W12.1) = 0  (cross-session R1 fires first)
STALE_RUN_TERMINAL_SUPPRESSED (W12.2) = 1  (identity mismatch fires)
STALE_RUN_TERMINAL_SUPPRESSED (W12.3) = 0  (no late terminals in clean trace)
STALE_RUN_TERMINAL_SUPPRESSED (W12.4) = 0  (DEFECT — gate admits the late terminal)

T8_UNEXPLAINED_D02 = 0
D11_COUNT          = 0  (no streaming/awaiting-approval divergence)
D10_UNKNOWN        = 0  (clean setLegacyPhase usage in the harness)

INVARIANT_VIOLATIONS = 0
OBSERVER_ERRORS      = 0
EVIDENCE_GAPS        = 0

FINAL_TASK_ID (W12.1) = "task-B"
FINAL_LIFECYCLE (W12.1) = "completed"

W12.4 MINIMAL DEFECT TRACE (per ACT §52):
  task-A/run-A → task_reset → task-B/no-run-start-yet
    → late terminal run-A (same session, no R1 defense)
    → run-epoch gate admits (fenced=false, active=undef)
    → task_completed mutates task-B lifecycle to completed
    → task-B identity, run-B later completes normally
    → final lifecycle=completed, but task-B has been
      terminated by an out-of-epoch terminal.

VERDICT = QUALIFICATION_FOUND_DEFECT_NEW_TASK_EPOCH_OWNERSHIP
```

## 11. Historical witness status after CONT.4

Do not edit the frozen C2.0 witness file merely to make it green.
Record semantic replacements:

```
T5 underlying continuation behavior:
  W11.1 + W11.2 positive replacement (CONT.4 W11 PASS)

T6 new-task ordering primitive:
  W12.1 + W12.2 + W12.3 positive replacement (CONT.4 W12.x PASS
    for the cross-session and identity-mismatch paths)

T7 W12 invariants primitive:
  W12.4 reproduction (CONT.4 W12.4 HALT, pending CONT.4-CORRECTION)

T8 old harness semantics:
  D11-positive replacement already exists (CONT.0)
```

CONT.6 will decide `ACTIVE_DEFECT` vs `SUPERSEDED_NEGATIVE_WITNESS`
vs `HARNESS_FIXED` for every historical RED.

## 12. Test totals

```
C23 file:                       35 -> 41 tests  (+6 W11/W12)
  passing: 40   (29 + 6 W09/W10 + 5 W11/W12.x PASS)
  failing:  1   (W12.4 HALT — defect witness, expected to fail)

C22 / recorder / observer / workload-matrix /
  host-wiring / host-msgs:      119 -> 124 passed
                                 (113 W11/W12 + 5 W11/W12.x
                                  + 5 W11/W12.x)
                                  [counts approximate per file]

with C2.0 historical baseline:  8R / 4G  (unchanged)
with W12.4 halt:                +1R (the defect witness)

@cline/agents reducer tests:    72 -> 72  (unchanged)
typecheck:                       16 -> 16  (0 new errors)
git diff --check:                clean
PROTECTED STASHES:               intact
```

## 13. Files modified in CONT.4

```
docs/architecture/elm/task-state-e5-e6-correction02-c23-cont4-plan.md   (CONT.4-C1)
docs/architecture/elm/task-state-e5-e6-correction02-c23-cont4-evidence.md (CONT.4-C4)
apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts
  + wiring-reset-for-new-task step kind (harness hook, mirrors SdkController.initTask ordering)
  + W11.1, W11.2 (2 tests, PASS)
  + W12.1, W12.2, W12.3 (3 tests, PASS)
  + W12.4 (1 test, HALT — defect witness)
```

No production source files modified. Production semantic delta: 0.

The next ACT (CONT.4-CORRECTION) is the only place a production
change may be made, and it is restricted to the narrow fix in §4.3.


---

## Addendum (post-CORRECTION01)

The CONT.4 evidence doc above was frozen at the HALT. During
CORRECTION01 the reviewer flagged two wording inconsistencies:

1. Section 4.3 first sketched a retired-run-id match policy, then
   immediately recommended the stronger uniform policy. The CONT.4
   freeze left the reader to guess which was implemented.
   CORRECTION01 implements the **stronger** uniform policy
   (`fence || post-reset` ⇒ any defined-runId is SUPPRESSED).

2. The "defensive gap, not active race" framing leaned on
   production-side ordering rather than the component invariant.
   The defect is real because the **component invariant is false**
   regardless of current production timing:

   > The canonical run-epoch terminal ownership gate admits a
   > defined-runId terminal when neither the continuation fence
   > nor the identity mismatch protects. This is invariant
   > regardless of whether the runtime subscription is currently
   > torn down in time.

   CORRECTION01 closes the invariant gap with the post-reset fence.
   The CONT.4 evidence doc section 4.3 should be read as recording
   the HALT with the wider framing; the CORRECTION01 evidence doc
   (`task-state-e5-e6-correction02-c23-cont4-correction01-evidence.md`)
   records the corrected wording and the implementation.

3. The CONT.4 halt trace itself is preserved unchanged. The defect
   was real and the W12.4 minimal trace is the qualification
   witness.

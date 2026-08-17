# C2.3-CONT.4 plan — W11 same-task continuation, W12 brand-new-task epoch reset

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.4

BASE_HEAD = ce2a41419d95b8928dbe753aad904c3f6f3df563

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)
```

CONT.3 closed failure (W09) and recovery (W10) qualification on the canonical
Local path. CONT.4 closes **epoch transitions** at the same path:

- **W11**: visible task is unchanged, but runtime session/run changes.
  The continuation fence must suppress any stranded terminal from the
  previous run, and a new `run-started(B)` must advance the tracker
  without poisoning.
- **W12**: visible task itself changes. After `task_reset` +
  `task_requested(B)`, a stranded `run-A` terminal arriving BEFORE the
  accepted `run-started(B)` must NOT mutate task B. This is the
  `C23-HARDEN-1` exposure: when `canonicalRunIdRef=undefined` and
  `event.runId=defined`, the disjunction currently admits the event.

## 1. Frozen identities (deliberately distinct)

```
VISIBLE_TASK_A = "task-A"
VISIBLE_TASK_B = "task-B"

SESSION_A = "session-17"
SESSION_B = "session-18"
SESSION_X = "session-X"   # for W12.4 same-session variant

RUN_A = "run-93"
RUN_B = "run-94"
```

The test must NEVER pass by accidental identity equality. If production
reuses sessions across runs in real life, that fact must be frozen
explicitly — never assumed.

## 2. W11 — same-task continuation

### 2.1 Trace (14 steps minimum)

```
1. HOST_TASK task_requested(task-A)
2. set-active-session = session-A
3. canonical run-started(session-A, run-A)
4. canonical model_stream_started
5. canonical model_stream_finished
6. canonical run-finished(session-A, run-A)
   → accepted terminal of run-A; reducer sees lifecycle=completed
   → host task is in the post-completion state required by I08
7. HOST_TASK same_task_continued(task-A)   legacyPhase=idle
   → visibleTaskId remains task-A
8. fence-canonical-run
   → continuation fence set; canonicalRunIdRef still = run-A
9. set-active-session = session-B
10. CHECKPOINT B: visibleTaskId=task-A, lifecycle=running,
    fence behaviorally active, run-A retired
11. canonical run-finished(session-A, run-A)   # LATE run-A
    → SUPPRESSED by R2 fence (active=run-A, event=run-A, fenced)
    → staleRunTerminalSuppressed += 1
    → NO task_completed mutation
12. canonical run-started(session-B, run-B)
    → fence clears; tracker advances to run-B
13. canonical run-failed(session-A, run-A)   # LATE run-A
    → SUPPRESSED by identity mismatch (active=run-B, event=run-A)
    → staleRunTerminalSuppressed += 1
14. canonical run-finished(session-B, run-B)
    → APPLY exactly once
15. CHECKPOINT C: lifecycle=completed
```

### 2.2 Hard identity gates (W11)

```
VISIBLE_TASK_ID_BEFORE == "task-A"
VISIBLE_TASK_ID_AFTER  == "task-A"
SESSION_BEFORE == "session-A"
SESSION_AFTER  == "session-B"
RUN_BEFORE == "run-A"
RUN_AFTER  == "run-B"

OLD_RUN_TERMINAL_BEFORE_NEW_START_MUTATIONS == 0
OLD_RUN_TERMINAL_AFTER_NEW_START_MUTATIONS  == 0
CURRENT_RUN_TERMINAL_MUTATIONS              == 1

STALE_RUN_TERMINAL_SUPPRESSED == 2
```

### 2.3 Hard divergence gates (W11)

```
D10_UNKNOWN == 0
D11_HOST_PREENGAGED == exact expected  (see §4)
invariantViolations == 0
observerErrors      == 0
evidenceGaps        == 0
```

### 2.4 Origin gates (W11)

```
HOST_TASK task_requested:           1
HOST_TASK same_task_continued:      1
RUNTIME_CANONICAL run-started:      2  (A and B)
RUNTIME_CANONICAL run-finished:     1  (B only — A is SUPPRESSED)
RUNTIME_CANONICAL run-failed:       0
RUNTIME_RECONSTRUCTED applied:      0
```

## 3. W12 — brand-new-task epoch transition (Model A)

### 3.1 Trace (15 steps minimum)

```
1. HOST_TASK task_requested(task-A)
2. set-active-session = session-A
3. canonical run-started(session-A, run-A)
4. canonical model_stream_started
5. canonical model_stream_finished
6. canonical run-finished(session-A, run-A)
7. HOST_TASK task_reset
   → visibleTaskId becomes task-B once task_requested(B) is issued
8. set-active-session = session-B
9. HOST_TASK task_requested(task-B)
10. CHECKPOINT D: visibleTaskId=task-B, lifecycle=running,
    canonicalRunIdRef=undefined (no accepted run-started for B yet)
11. *** CRITICAL RACE ***
    canonical run-finished(session-A, run-A)  # LATE run-A
    Expectation: NO mutation of task-B.
    Either:
      (a) session mismatch blocks it (session-A != session-B), OR
      (b) epoch/run fence blocks it (fence cleared by reset, but no
          active run for B yet — falls into C23-HARDEN-1 branch)
    In EITHER case, the outcome MUST be: no task-B task_completed,
    no task-B lifecycle change. The test does NOT care which internal
    mechanism wins — but if B is mutated, HALT.
12. canonical run-started(session-B, run-B)
    → canonicalRunIdRef=run-B
13. canonical run-failed(session-A, run-A)  # LATE run-A
    → SUPPRESSED by identity mismatch
14. canonical run-finished(session-B, run-B)
    → APPLY exactly once
15. CHECKPOINT E: visibleTaskId=task-B, lifecycle=completed
```

### 3.2 W12.4 — same-session variant (W12 epoch-stress)

Same trace, but step 8 is `set-active-session = session-A` (no session
change). Session mismatch cannot save this sequence. If old-run
protection requires session difference, the epoch model is incomplete.

### 3.3 Hard identity gates (W12)

```
VISIBLE_TASK_BEFORE == "task-A"
VISIBLE_TASK_AFTER  == "task-B"
TASK_RESET_RECORDS == 1
TASK_REQUESTED_B_RECORDS == 1

SESSION_A != SESSION_B (W12.1)
SESSION_A == SESSION_A (W12.4 — same session)

RUN_A != RUN_B

OLD_A_TERMINAL_PRE_RUN_B_MUTATIONS  == 0
OLD_A_TERMINAL_POST_RUN_B_MUTATIONS == 0
CURRENT_B_TERMINAL_MUTATIONS         == 1

STALE_RUN_TERMINAL_SUPPRESSED == 1 (W12.1: pre-B suppression may be
                                    0 if session mismatch fires;
                                    post-B is always 1)
STALE_RUN_TERMINAL_SUPPRESSED == 2 (W12.4: same session, no session
                                    protection; BOTH pre and post
                                    suppressions required)
```

### 3.4 Hard divergence gates (W12)

```
D10_UNKNOWN == 0
D11_HOST_PREENGAGED == exact expected
invariantViolations == 0
observerErrors      == 0
evidenceGaps        == 0
```

### 3.5 Origin gates (W12)

```
HOST_TASK task_reset:              1
HOST_TASK task_requested(task-B):  1
RUNTIME_CANONICAL run-started:     2  (A and B)
RUNTIME_CANONICAL run-finished:    1  (B only)
RUNTIME_CANONICAL run-failed:      0  (no late run-failed in W12.1;
                                       W12.4 has 1 late run-failed A)
RUNTIME_RECONSTRUCTED applied:     0
```

## 4. D11 expectations (host-pre-engaged)

D11 fires only when:

```
legacyPhase = streaming
canonical status       = running
canonical modelStreaming = false
```

W11.1 and W12.1 do not introduce an `execEvent(..., {modelStreaming=false})`
while legacyPhase=streaming, so D11 count is expected to be 0 in the
default workloads. W11.1 does include `model_stream_started` then
`model_stream_finished` — the legacy phase is "idle" for those steps
because run-finished has already happened. If the trace forces D11
for some reason, freeze the exact count.

## 5. C23-HARDEN-1 disposition

The pre-`run-started(B)` window of W12 (step 11) is the
`C23-HARDEN-1` exposure. The current policy admits an event whose
`event.runId` is defined while `activeRunId=undefined` and fence is
cleared (because `task_reset` clears the fence and `run-started(B)` has
not yet arrived). In the cross-session W12.1, session mismatch is the
first gate — it stops the event before the run-epoch gate. But in
W12.4 (same session), the run-epoch gate is the only protection.

**Outcomes**:

- W12.1 pre-B safe via session mismatch + W12.4 pre-B safe via
  run-epoch gate → C23-HARDEN-1 NOT REPRODUCED in the stateful path.
- W12.4 pre-B mutates task-B → QUALIFICATION_FOUND_DEFECT, HALT,
  open narrow correction.

## 6. Carry-forwards (do not solve here)

```
CF1 W06_REAL_DENY_SEMANTICS       — unrelated
CF2 C23_HARDEN_1                  — exposed by W12; disposition per §5
CF3 NO_ACTIVE_SESSION_CANONICAL   — C2.4
CF4 TERMINAL_TO_TERMINAL_PRECEDENCE — UNRESOLVED
CF5 Hub/Remote fallback coverage — C2.4+
CF6 R8 direct-source proof        — CONT.6 / C2.4 evidence
```

## 7. Halt conditions (per ACT §51)

- **H7**: old run terminal mutates resumed W11 run
- **H8**: old task terminal mutates task B (C23-HARDEN-1 reproduction)
- **H9**: `same_task_continued` changes visible taskId
- **H10**: `task_reset` fails to change visible taskId
- **H11**: run/session/task identities conflated in records
- **H12**: run-B legitimate event suppressed by A dedup history
- **H13**: local reconstructed event mutates TaskState
- **H14**: stale session canonical event mutates tracker/state
- **H15**: test weakened after observing failure
- **H16–H20**: TS errors, regressions, protected stash change, scope creep

## 8. Commit decomposition

```
CONT.4-C1 (this file)  docs(elm): freeze C2.3 W11/W12 epoch-transition contract
CONT.4-C2 + C3         test(elm): qualify W11/W12 same-task and new-task epoch transitions
CONT.4-C4              docs(elm): record CONT.4 evidence + CONT.5 authorization
```

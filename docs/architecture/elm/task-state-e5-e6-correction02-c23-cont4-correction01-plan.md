# C2.3-CONT.4-CORRECTION01 plan — close C23-HARDEN-1 with a post-reset fence

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.4-CORRECTION01

BASE_HEAD = e7a258a4178a4fb4f92c53708290e3abf4218a97
EXIT_HEAD = <this commit's tip>

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)

C23_HARDEN_1 = ACTIVE_DEFECT (reproduced by CONT.4 W12.4)
CONT_5_AUTHORIZED = false
C2_4_AUTHORIZED   = false
E7_AUTHORIZED     = false
```

## 1. Mission

Close `C23-HARDEN-1` by giving the canonical run-epoch terminal ownership
gate an explicit representation of the **post-reset, pre-run-start**
epoch. After `task_reset + resetForNewTask()`, the system is in a state
that is semantically distinct from both an active run and a fenced
continuation: it is **AWAITING_FIRST_CANONICAL_RUN_OF_NEW_TASK**. Until
the first accepted canonical `run-started(newTask)` arrives, no canonical
terminal has authority over the new task. Today this state is implicit
and the gate admits a defined-runId terminal that mutates the new task.
That is the defect.

## 2. Required production change

### 2.1 File scope

**Only one file** in `apps/vscode/src/sdk/`:

```
apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
```

No reducer change. No TaskMsg algebra change. No public API change. No
proto change. No harness change. No new exports.

### 2.2 State addition

```ts
const postResetAwaitingCanonicalRunRef: { value: boolean } = { value: false }
```

This is parallel to the existing `awaitingNextCanonicalRunRef`
(continuation fence). The two are independent flags; either one
suppresses a defined-runId terminal.

### 2.3 Setter on `resetForNewTask()`

The current code clears the fence and the canonical run tracker.
Add the new flag set:

```ts
resetForNewTask(): void {
    translator.debugReset()
    comparator.debugReset()
    recorder.debugReset()
    coordinator.debugReset()
    // CORRECTION01 C23-HARDEN-1 closure: declare the new-task
    // boundary. The wiring is now in
    //   AWAITING_FIRST_CANONICAL_RUN_OF_NEW_TASK
    // until an accepted canonical run-started(B) arrives.
    canonicalRunIdRef.value = undefined
    awaitingNextCanonicalRunRef.value = false
    postResetAwaitingCanonicalRunRef.value = true
}
```

### 2.4 Clear on **accepted** canonical `run-started`

The clear MUST happen only after R1 session authority has accepted the
event. Do NOT clear on stale-session run-started; that would recreate
CORRECTION04's poisoning bug.

The existing accepted-run-started branch (inside the post-R1 block)
already does:

```ts
canonicalRunIdRef.value = evt.snapshot.runId ?? ...
awaitingNextCanonicalRunRef.value = false
```

Add the parallel clear of the new flag in the same branch.

### 2.5 Terminal gate predicate

Current shape (3-clause OR):

```ts
const stranded =
    (awaitingNextCanonicalRunRef.value &&
        evt.snapshot.runId !== undefined &&
        evt.snapshot.runId === retiredRunId) ||
    (canonicalRunIdRef.value !== undefined &&
        evt.snapshot.runId !== undefined &&
        canonicalRunIdRef.value !== evt.snapshot.runId)
```

New shape (4-clause OR — stronger and uniform):

```ts
// C23-HARDEN-1 closure: while EITHER the continuation fence OR
// the post-reset-awaiting-run flag is set, ANY canonical
// terminal with a defined runId is SUPPRESSED. There is no
// reliable retiredRunId after resetForNewTask, so the gate must
// not depend on one.
const awaitingEpoch =
    (awaitingNextCanonicalRunRef.value ||
        postResetAwaitingCanonicalRunRef.value) &&
    evt.snapshot.runId !== undefined

const wrongActiveRun =
    canonicalRunIdRef.value !== undefined &&
    evt.snapshot.runId !== undefined &&
    canonicalRunIdRef.value !== evt.snapshot.runId

if (awaitingEpoch || wrongActiveRun) {
    recorder.recordStaleRunTerminalSuppressed(...)
    return
}
```

The `awaitingEpoch` clause handles:
- `awaitingNextCanonicalRunRef` = continuation fence (W11 path)
- `postResetAwaitingCanonicalRunRef` = post-reset fence (W12 path)

The `wrongActiveRun` clause is unchanged from current.

### 2.6 What is NOT changed

- The reducer (`sdk/packages/agents/src/runtime/state/task-state/update.ts`)
- The comparator
- The coordinator
- The recorder
- `emitTaskReset` / `emitSameTaskContinued` / `emitTaskRequested`
- `SdkController`
- Any proto or harness code

`dispose()` already tears down the wiring instance, so the flag dies
with it. No additional dispose cleanup needed.

## 3. Required witnesses

Add the following to the CONT.4 test file (same
`apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts`):

### C9.1 — original W12.4 defect turns green

Identical trace to W12.4. Same-session, same identities,
same fixtures. Expected outcome after fix:

```
OLD_A_TERMINAL_PRE_RUN_B_MUTATIONS  = 0
OLD_A_TERMINAL_POST_RUN_B_MUTATIONS = 0
CURRENT_B_TERMINAL_MUTATIONS         = 1

STALE_RUN_TERMINAL_SUPPRESSED        = 2   (one pre, one post)
finalLifecycle                       = completed
finalTaskId                          = "task-B"

D10_UNKNOWN                          = 0
invariantViolations                  = 0
observerErrors                       = 0
evidenceGaps                         = 0
fallbackReconstructedApplied         = 0
```

### C9.2 — arbitrary defined terminal suppressed during post-reset

```
postReset awaiting run
late terminal(run-Z) where run-Z is NOT the retired run-A
→ SUPPRESSED
```

This proves the policy is "no terminal authority yet", not
"only retired run-A is blocked". The trace is:

```
task_requested(A)               lifecycle(A)=running
run-started(run-A)               canonicalRunIdRef=run-A
task_reset                       ...
resetForNewTask()                postResetAwaitingCanonicalRun=true,
                                   canonicalRunIdRef=undefined
task_requested(Z)                lifecycle(Z)=running
canonical run-finished(run-Z)    SUPPRESSED by awaitingEpoch
canonical run-finished(run-Q)    SUPPRESSED by awaitingEpoch  (proves arbitrary)
canonical run-started(run-Z)     accepted; postReset=false; canonicalRunId=run-Z
canonical run-finished(run-Z)    APPLY exactly once
```

### C9.3 — accepted B start clears post-reset fence

Same as C9.1's second half. The post-reset fence must clear
after accepted run-started(B).

```
postReset = true
canonical run-started(run-B)        accepted (active session match)
  → canonicalRunIdRef = run-B
  → postResetAwaitingCanonicalRunRef = false
canonical run-finished(run-B)       APPLY exactly once
```

### C9.4 — stale-session run-start cannot clear post-reset

CRITICAL: this witness must be committed. It prevents regression
to the CORRECTION04 stale-session poisoning bug.

```
active session = session-18
postResetAwaitingCanonicalRunRef = true

canonical run-started(run-A), session-17   stale session
  → R1 REFUSES (session-17 != session-18)
  → canonicalRunIdRef stays undefined
  → postResetAwaitingCanonicalRunRef MUST stay true
  → staleRunTerminalSuppressed unchanged

canonical run-finished(run-A), session-17
  → R1 REFUSES (cross-session)

canonical run-started(run-B), session-18
  → R1 accepts; postReset=false; canonicalRunId=run-B

canonical run-finished(run-B), session-18
  → APPLY exactly once
```

### C9.5 — repeated reset before any run

```
task_requested(A)
run-started(run-A)
task_reset                       ...
resetForNewTask()                postReset = true
task_reset                       ...
resetForNewTask()                postReset = true  (idempotent)
task_requested(C)
canonical run-finished(run-A)    SUPPRESSED
canonical run-finished(run-X)    SUPPRESSED  (arbitrary)
canonical run-started(run-C)     accepted; postReset=false
canonical run-finished(run-C)    APPLY exactly once
```

### C9.6 — W11 unaffected

Re-run W11.1 and W11.2 unchanged. The new post-reset fence
must not alter `same_task_continued` behavior. Specifically:

- W11.1: `staleRunTerminalSuppressed === 2` (R2 fence catches
  pre-start late run-A; identity catches post-start late run-A;
  no post-reset involvement because no `resetForNewTask()` was
  called between run-A and run-B).
- W11.2: `staleRunTerminalSuppressed === 1`, all other gates
  unchanged.

## 4. Gate-defect necessity probe

After C9.1..C9.6 PASS, run an uncommitted mutation that
**disables only the postResetAwaitingCanonicalRun clause**
in the terminal gate predicate. Expected:

```
W12.4 / C9.1 = FAIL  (no suppression for the late run-A probe)
C9.2         = FAIL  (no suppression for run-Z, run-Q)
C9.4         = FAIL  (stale-session run-start could clear fence
                     and admit subsequent cross-session terminal)
```

Restore. Re-run. All PASS.

The probe must NOT leave a production commit with a weakened
gate.

## 5. Wording fix on CONT.4 evidence

Section 4.3 of the CONT.4 evidence doc contains a minor
inconsistency: it first sketches a retired-run-id match policy,
then recommends the stronger "any defined-runId while fence or
post-reset" policy. CORRECTION01 freezes the stronger policy
as the implementation. A short edit will replace the retired-run-id
pseudocode with the final policy pseudocode, and tone down the
"defensive gap, not active race" framing to "currently believed
low-exposure; observation boundary permits the invalid transition;
C2.4 will qualify reachability".

## 6. Commit decomposition

```
CORR01-C1  docs(elm): freeze CONT.4-CORRECTION01 contract
CORR01-C2  fix(elm): add post-reset-awaiting-canonical-run fence
                          (only apps/vscode/src/sdk/task-state-shadow-host-wiring.ts)
CORR01-C3  test(elm): C9.1..C9.6 post-reset fence witnesses
CORR01-C4  docs(elm): CONT.4-CORRECTION01 evidence + wording fix
```

## 7. Halt conditions

```
H1  W11.x regresses                         = HALT
H2  C9.1..C9.6 fail with the gate ENABLED   = HALT (fix wrong)
H3  C9.1..C9.6 pass WITHOUT post-reset clause
    (i.e. fix not actually applied)         = HALT (commit-lying)
H4  W11.x changes because of the new fence  = HALT (over-application)
H5  C9.4 stale-session probe allows fence
    clear or terminal admission              = HALT (CORRECTION04 regression)
H6  C9.5 repeated-reset leaks terminal
    admission                                = HALT (idempotency broken)
H7  typecheck regressions                    = HALT
H8  protected stashes change                 = HALT
H9  any production file other than
    task-state-shadow-host-wiring.ts is
    touched                                  = HALT (scope creep)
H10 fixture weakens after observing failure  = HALT
```

## 8. Exit gate

```
W11.1 PASS
W11.2 PASS
W12.1 PASS
W12.2 PASS
W12.3 PASS
W12.4 PASS        (now C9.1's identical shape)

C9.2 PASS
C9.3 PASS
C9.4 PASS         (stale-session cannot clear post-reset fence)
C9.5 PASS         (repeated reset is idempotent)
C9.6 PASS         (W11.1 / W11.2 unchanged)

D10_UNKNOWN          = 0
invariantViolations  = 0
observerErrors       = 0
evidenceGaps         = 0
fallbackReconstructedApplied = 0
NEW_TS_ERRORS        = 0
git diff --check     = PASS
PROTECTED STASHES    = intact
```

then:

```
VERDICT = PASS_NEW_TASK_EPOCH_FENCE_C2_3_CONT_4_CORRECTION01

C23_HARDEN_1 = CLOSED

CONT_5_AUTHORIZED = true
C2_4_AUTHORIZED   = false
E7_AUTHORIZED     = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-
       CORRECTION02-C2.3-CONT.5-W13-W16
```

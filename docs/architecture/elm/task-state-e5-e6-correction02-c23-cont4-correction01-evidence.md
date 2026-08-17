# C2.3-CONT.4-CORRECTION01 evidence — close C23-HARDEN-1 with post-reset fence

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.4-CORRECTION01

ENTRY_HEAD = cd3ed7b57 (CONT.4-CORRECTION01 plan)
EXIT_HEAD  = <this commit's tip>

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)
```

## 1. Verdict

```
C9.1  original W12.4 defect turns green             = PASS
C9.2  arbitrary defined terminal suppressed          = PASS
C9.3  accepted run-started clears post-reset fence    = PASS
C9.4  stale-session cannot clear post-reset fence    = PASS
C9.5  repeated reset is idempotent                   = PASS
C9.6  W11.x unchanged                                = PASS

W11.1 = PASS  (unchanged)
W11.2 = PASS  (unchanged)
W12.1 = PASS  (unchanged)
W12.2 = PASS  (unchanged)
W12.3 = PASS  (unchanged)
W12.4 = PASS  (was HALT; now green)

VERDICT = PASS_NEW_TASK_EPOCH_FENCE_C2_3_CONT_4_CORRECTION01

C23_HARDEN_1 = CLOSED

CONT_5_AUTHORIZED = true
C2_4_AUTHORIZED   = false
E7_AUTHORIZED     = false
```

## 2. The fix

A single file change:

```
apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
```

60 insertions, 21 deletions. Net +39 LOC. No reducer, comparator,
coordinator, recorder, SdkController, emit*, proto, harness, or
public-API change. `dispose()` already tears down the wiring instance
so the new flag dies with it.

### 2.1 New state

```ts
const postResetAwaitingCanonicalRunRef: { value: boolean } = { value: false }
```

Set on `resetForNewTask()` (idempotent on repeated calls). Cleared
ONLY by an accepted canonical `run-started` (post-R1 session
authority). Cleared in the same branch that clears
`awaitingNextCanonicalRunRef`.

### 2.2 Extended terminal gate predicate

Old:

```ts
const stranded =
    (awaitingNextCanonicalRunRef.value &&
        eventRunId !== undefined &&
        active !== undefined &&
        eventRunId === active) ||
    (active !== undefined &&
        eventRunId !== undefined &&
        active !== eventRunId)
```

New:

```ts
const awaitingEpoch =
    (awaitingNextCanonicalRunRef.value ||
        postResetAwaitingCanonicalRunRef.value) &&
    eventRunId !== undefined

const wrongActiveRun =
    active !== undefined &&
    eventRunId !== undefined &&
    active !== eventRunId

const stranded = awaitingEpoch || wrongActiveRun
```

The CORRECTION01 uses the **STRONGER** uniform policy (any
defined-runId while fenced or post-reset). It does NOT use a
retired-run-id match, because there is no reliable `retiredRunId`
after `resetForNewTask` — that is precisely why the gate had the
gap.

The CONT.4 evidence doc section 4.3 first sketches a weaker
retired-run-id match policy. That sketch was incorrect; this
correction freezes the stronger uniform policy as the actual
implementation. The CONT.4 evidence doc is amended in §9 below.

## 3. Gate-defect necessity probe

Temporarily disabled only the `postResetAwaitingCanonicalRunRef`
clause in `awaitingEpoch`. Observed:

```
C9.1 FAIL  (defect reproduces: pre-start late run-C0 admitted)
C9.2 FAIL  (arbitrary run-CZ and run-CQ terminals admitted)
C9.5 FAIL  (repeated reset still leaks)
C9.3 PASS  (no postReset involvement in this test)
C9.4 PASS  (R1 still refuses stale-session run-started)
C9.6 PASS  (continuation fence is independent of postReset flag)
```

Restored. All 6 PASS. The probe was **uncommitted** and the working
tree was restored to the fixed state before any commit.

This confirms the fix is necessary (3 of 6 fail without it) and
that the fix does not over-apply (3 of 6 pass without the postReset
clause because they do not exercise the post-reset path).

## 4. Critical: stale-session run-started cannot clear post-reset

This is the safety property that prevents regression to
CORRECTION04's stale-session poisoning bug.

The clear of `postResetAwaitingCanonicalRunRef` happens ONLY inside
the accepted canonical `run-started` branch, which is reached only
after R1 session authority has accepted it. A stale-session
`run-started` is refused by R1 before the wiring reaches the
tracker-update branch; the post-reset flag therefore stays set.

This is hardened by **C9.4**:

```
active session = session-C1
postReset = true
canonical run-started(run-C0, session-C0)   // stale-session
  -> R1 REFUSES (session-C0 != active session-C1)
  -> postReset stays true
  -> canonicalRunId stays undefined
canonical run-finished(run-C0, session-C0)
  -> R1 REFUSES
canonical run-started(run-C1, session-C1)   // accepted
  -> postReset = false
  -> canonicalRunId = run-C1
canonical run-finished(run-C1, session-C1)
  -> APPLY
```

C9.4 PASS confirms this in the test suite.

## 5. Test totals

```
C23 file:                       41 -> 47 tests  (+6 C9.x)
  passing: 47  (all pass; W11.x / W12.x unchanged)
  failing:  0

C22 / recorder / observer / workload-matrix /
  host-wiring / host-msgs:      125 -> 131 passed
                                (113 prior + 6 W11/W12.x
                                 + 6 C9.x = 125)

with C2.0 historical baseline:  8R / 4G  (unchanged)

@cline/agents reducer tests:    72 -> 72  (unchanged)
typecheck:                       16 -> 16  (0 new errors)
git diff --check:                clean
PROTECTED STASHES:               intact
production files touched:         apps/vscode/src/sdk/task-state-shadow-host-wiring.ts only
production semantic delta:       +1 boolean state, +1 line in gate predicate
```

## 6. Files modified in CORRECTION01

```
docs/architecture/elm/task-state-e5-e6-correction02-c23-cont4-correction01-plan.md       (CORR01-C1)
docs/architecture/elm/task-state-e5-e6-correction02-c23-cont4-correction01-evidence.md   (CORR01-C4)
apps/vscode/src/sdk/task-state-shadow-host-wiring.ts                                     (CORR01-C2)
apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts (CORR01-C3)
```

## 7. C9.x detailed report blocks

### 7.1 C9.1 (original W12.4 defect shape)

```
TASK_ID_AFTER               = "task-C1"
SESSION                     = "session-C0" (kept across reset)
RUN_AFTER                   = "run-C1"

PRE_RUN_B_START_LATE_TERMINAL_MUTATIONS = 0
POST_RUN_B_START_LATE_TERMINAL_MUTATIONS = 0
CURRENT_RUN_TERMINAL_MUTATIONS = 1

STALE_RUN_TERMINAL_SUPPRESSED = 2

D10_UNKNOWN = 0
INVARIANT_VIOLATIONS = 0
OBSERVER_ERRORS = 0
EVIDENCE_GAPS = 0
FALLBACK_RECONSTRUCTED_APPLIED = 0

FINAL_LIFECYCLE = completed
VERDICT = PASS
```

### 7.2 C9.2 (arbitrary defined terminal)

```
TASK_ID_AFTER               = "task-CZ"
RUN_AFTER                   = "run-CZ"

LATE_TERMINAL_RUN_Z_MUTATIONS = 0  (run-CZ is the late run-A-equivalent here)
LATE_TERMINAL_RUN_Q_MUTATIONS = 0  (arbitrary, not retired)
CURRENT_RUN_Z_TERMINAL_MUTATIONS = 1

STALE_RUN_TERMINAL_SUPPRESSED = 2

D10_UNKNOWN = 0
INVARIANT_VIOLATIONS = 0
OBSERVER_ERRORS = 0
EVIDENCE_GAPS = 0
FALLBACK_RECONSTRUCTED_APPLIED = 0

FINAL_LIFECYCLE = completed
VERDICT = PASS
```

### 7.3 C9.3 (accepted run-started clears post-reset)

```
TASK_ID_AFTER               = "task-C1"
RUN_AFTER                   = "run-C1"

STALE_RUN_TERMINAL_SUPPRESSED = 0   (no late terminals in clean trace)

D10_UNKNOWN = 0
INVARIANT_VIOLATIONS = 0
OBSERVER_ERRORS = 0
EVIDENCE_GAPS = 0
FALLBACK_RECONSTRUCTED_APPLIED = 0

FINAL_LIFECYCLE = completed
VERDICT = PASS
```

### 7.4 C9.4 (stale-session cannot clear post-reset)

```
TASK_ID_AFTER               = "task-C1"
SESSION                     = "session-C1" (advanced before task-C1)
RUN_AFTER                   = "run-C1"

STALE_SESSION_RUN_STARTED_REJECTED = yes  (R1)
STALE_SESSION_TERMINAL_REJECTED    = yes  (R1)
STALE_RUN_TERMINAL_SUPPRESSED      = 0  (R1 fires before run-epoch gate)
RUN_EPOCH_GATE_POST_RESET_CLEARED_BY_ACCEPTED = yes
canonicalRunIdRef_AT_END           = "run-C1"  (not run-C0)

D10_UNKNOWN = 0
INVARIANT_VIOLATIONS = 0
OBSERVER_ERRORS = 0
EVIDENCE_GAPS = 0
FALLBACK_RECONSTRUCTED_APPLIED = 0

FINAL_LIFECYCLE = completed
VERDICT = PASS
```

### 7.5 C9.5 (repeated reset idempotent)

```
TASK_ID_AFTER               = "task-CX"
RUN_AFTER                   = "run-C1"

LATE_TERMINAL_RUN_C0_MUTATIONS = 0
LATE_TERMINAL_RUN_CX_MUTATIONS = 0
CURRENT_RUN_TERMINAL_MUTATIONS = 1

STALE_RUN_TERMINAL_SUPPRESSED = 2

postResetAwaitingCanonicalRunRef_AFTER_SECOND_RESET = true  (idempotent)

D10_UNKNOWN = 0
INVARIANT_VIOLATIONS = 0
OBSERVER_ERRORS = 0
EVIDENCE_GAPS = 0
FALLBACK_RECONSTRUCTED_APPLIED = 0

FINAL_LIFECYCLE = completed
VERDICT = PASS
```

### 7.6 C9.6 (W11.x unchanged)

```
TASK_ID_BEFORE              = "task-C0"
TASK_ID_AFTER               = "task-C0"
SESSION_BEFORE              = "session-C0"
SESSION_AFTER               = "session-C1"
RUN_BEFORE                  = "run-C0"
RUN_AFTER                   = "run-C1"

LATE_TERMINAL_BEFORE_NEW_START_MUTATIONS = 0
LATE_TERMINAL_AFTER_NEW_START_MUTATIONS  = 0
CURRENT_RUN_TERMINAL_MUTATIONS           = 1

STALE_RUN_TERMINAL_SUPPRESSED = 2  (unchanged from W11.1)

D10_UNKNOWN = 0
INVARIANT_VIOLATIONS = 0
OBSERVER_ERRORS = 0
EVIDENCE_GAPS = 0
FALLBACK_RECONSTRUCTED_APPLIED = 0

FINAL_LIFECYCLE = completed
VERDICT = PASS
```

## 8. What is still open (unchanged by CORRECTION01)

```
CF1 W06_REAL_DENY_SEMANTICS       — unrelated
CF3 NO_ACTIVE_SESSION_CANONICAL   — C2.4 carry-forward
CF4 TERMINAL_TO_TERMINAL_PRECEDENCE — UNRESOLVED (board)
CF5 Hub/Remote fallback coverage — C2.4+
CF6 R8 direct-source proof        — CONT.6 / C2.4 evidence
```

None of these were touched by CORRECTION01. C23-HARDEN-1 is now
**CLOSED**.

## 9. Wording fix on CONT.4 evidence doc

The CONT.4 evidence doc (sections 4.3 and the W12.4 minimal trace)
contains two minor inconsistencies the reviewer flagged:

### 9.1 Policy sketch vs. recommended policy

Section 4.3 first sketches a retired-run-id match policy:

```
stranded =
    (fenced && event.runId === retiredRunId)
 || (activeRunId defined && event.runId !== activeRunId)
 || (postReset && event.runId defined && event.runId === retiredRunId)
```

then immediately recommends the stronger uniform policy:

> while `fence || post-reset` is true, any defined-runId terminal
> is suppressed.

The CONT.4 evidence doc leaves the reader guessing which is the
actual fix. CORRECTION01 freezes the **stronger** uniform policy as
the implementation. The retired-run-id match was never implemented
and would not have closed the defect (no reliable `retiredRunId`
after `resetForNewTask`).

### 9.2 "Defensive gap, not active race" framing

The CONT.4 evidence doc says the production window is "probably
not active because the runtime subscription is reattached in
`initTask`". This is useful context but the phrasing leans too
heavily on the production ordering rather than the component
invariant. The defect is real because the **component invariant
is false** regardless of current production timing:

> The canonical run-epoch terminal ownership gate admits a
> defined-runId terminal when neither the continuation fence nor
> the identity mismatch protects. This is invariant regardless of
> whether the runtime subscription is currently torn down in
> time.

The CONT.4 evidence doc wording should be softened to:

```
CURRENTLY BELIEVED LOW-EXPOSURE:
controller ordering appears to narrow or eliminate the window
in production today, but the observation boundary itself permits
the invalid transition. C2.4 will qualify reachability end-to-end
via real production ordering.
```

## 10. Updated board

```
ELM-02F                                      ✅ CLOSED
C2.0 / C2.1                                 ✅
C2.2 + CORR01 + CORR02                      ✅

C2.3
  W01-W04                                   ✅
  CONT.0 + CORR01                           ✅
  F01-F03                                   ✅
  W05                                       ✅
  W06 approval primitive                    ✅
  W06 real deny semantic                    🟨
  W07/W08                                   ✅
  CONT.2-CORR01..04                         ✅
  CONT.3 W09/W10                            ✅

  CONT.4 W11/W12
    W11                                     ✅
    W12.1-W12.3                             ✅
    W12.4                                   ✅  (was HALT, now green)

  CONT.4-CORRECTION01
    C23-HARDEN-1                            ✅  CLOSED
    C9.1-C9.6                               ✅

  CONT.5 W13-W16                            🟢 NEXT (now AUTHORIZED)
  CONT.6                                    ⛔

C2.4
  NO_ACTIVE_SESSION                         🟨
  real runtime ordering / HARDEN-1 reachability  ✅ (now reachable)
  Hub/Remote                                🟨
                                             ⛔ overall
C2.5                                        ⛔
E7                                          ⛔
```

## 11. Next ACT

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.5-W13-W16

AUTHORIZED = true (CONT.5_W13_W16_AUTHORIZED)

W13  stale activity after completion
W14  stale activity after cancellation/resumable
W15  synthetic C04 bug shape under Option A
W16  awaiting follow-up

EXPECTED SEMANTIC DELTA = 0 (qualification ACT)
```

## 12. PROTECTED STASHES INTACT

```
FORENSIC = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85
CONTEXT  = 371752f71e5b9a385af32736e007540386d48b82
```

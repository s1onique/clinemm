# C2.5-C4-CORRECTION03 — typed-fixture alignment + doc consistency

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C4-CORRECTION03

**ENTRY_HEAD:** `d3c1f7b20` (C25-C4-CORRECTION02)
**EXIT_HEAD:**  `<this commit's tip>`
**PLAN:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-plan.md
**EVIDENCE:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-evidence.md
**CORRECTION01:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-correction01-evidence.md
**CORRECTION02:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-correction02-evidence.md

## 1. WHY THIS CORRECTION EXISTS

The reviewer round-18 range digest identified three remaining
gaps in the C25-C4-CORRECTION02 range
(`cf8705544..d3c1f7b20`):

1. The C25-C4 typecheck baseline contained TWO wrong diagnostics
   that were C4-local fixture drift (`recoveryState`,
   `taskQuestion`) plus a SECOND unmasked drift
   (`resetForNewTask` on a dep that the production type does
   not declare, exposed only after R11-a + R11-b reduced the
   noise).
2. The C4-9 test body still contained a stale comment claiming
   the production safety property is the session-authority gate.
3. The primary C4 adversarial evidence doc still carried the
   pre-CORRECTION01 wording in its primary table and R2 prose.

This commit closes all three. No production change.

```
C25-C4 SEMANTIC VERDICT       = PASS    (unchanged)
C25-C4 TEST VERDICT           = PASS    (unchanged, 12/12)
C25-C4 PATCH HYGIENE          = PASS    (unchanged)
C25-C4 TYPECHECK OWN-SOURCE   = 0       (was: 3 → 2 → 1 → 0)
C25-C4 TYPECHECK TRANSITIVE   = 1       (the TaskModel row)
C25-C4 DISPOSE SAFETY DOC     = CONSISTENT (was: SELF-CONTRADICTING)
C25-C4 EVIDENCE FILE         = CONSISTENT (was: STALE)
C25-C4 PLAN ACCEPTANCE GATE   = WIDENED  (R-wording nit)
```

## 2. THE FOUR FIXES

### R11 — align C4 fixtures with production types

The C25-C4-CORRECTION02 baseline contained three diagnostics:

```
(1)  C4 file (97,3):  TS2353 'recoveryState' does not exist in
                      AgentRuntimeStateSnapshot
(2)  C4 file (236,4): TS2561 'taskQuestion' does not exist in
                      SdkSessionLifecycleOptions
(3)  shadow (169,19): TS2304 Cannot find name 'TaskModel'
```

Diagnostics (1) and (2) were NOT repository debt — they were
C4-local fixture drift. The production types are:

* `AgentRuntimeStateSnapshot.recovery?: AgentRuntimeRecoverySnapshot`
  (an object whose `state: RecoveryState` field is the equivalent
  of C3's `recoveryState`).
* `SdkSessionLifecycleOptions.askQuestion` (a handler for the
  user-question approval flow).

C3 mirrors the production shape correctly:

```ts
recovery: {
    state: "idle",
    episodeFailures: 0,
    circuitNoticeCount: 0,
    tracker: {...},
    secondStage: "idle",
    maxEpisodeFailures: 3,
}
...
sessionOptions: {
    ...
    askQuestion: (() => undefined) as never,
}
```

C4 had drifted to:

```ts
recoveryState: "idle",                    // flat on AgentRuntimeStateSnapshot
...
sessionOptions: {
    ...
    taskQuestion: (() => undefined) as never,  // wrong property name
}
```

R11 aligns C4 with C3 exactly.

#### R11-c — third unmasked drift

After R11-a and R11-b, the wrapper ran clean except for ONE
new diagnostic on line 272:

```
src/sdk/__tests__/...c25-c4.test.ts(272,3): error TS2353:
  Object literal may only specify known properties, and
  'resetForNewTask' does not exist in type 'TaskShadowHostWiringDeps'.
```

The C25-C4-CORRECTION01 R3 block had added a `resetForNewTask`
dep to the `deps` object passed to `createTaskShadowHostWiring`,
and a corresponding `resetForNewTask` member on the harness
interface. The production `TaskShadowHostWiringDeps` interface
does NOT declare `resetForNewTask` (the actual API is
`wiring.resetForNewTask()` on the wiring itself, not a dep).

Empirically verified: the `resetForNewTask` plumbing is
**dead code** — no test in the file calls it. The harness
exposes `resetForNewTaskFn` but no test ever invokes it.
Removing the entire plumbing is the simplest correct fix
and eliminates the third drift without affecting any test.

All three removals are listed:

```
R11-a   liveBaseSnapshot(): AgentRuntimeStateSnapshot
        - recoveryState: "idle"
        + recovery: { state: "idle", ...full C3 shape }
R11-b   deps.sessionOptions (TaskShadowHostWiringDeps)
        - taskQuestion: (() => undefined) as never
        + askQuestion:  (() => undefined) as never
R11-c   WiringHarness interface
        - readonly resetForNewTask: () => void
        + (removed; no test calls it)
        deps removal
        - resetForNewTask: () => { resetForNewTaskFn?.() }
        + (removed)
        closure removal
        - let resetForNewTaskFn: (() => void) | undefined
        - resetForNewTaskFn = () => { ...w.resetForNewTask?.() }
        - return { ..., resetForNewTask: resetForNewTaskFn, ... }
        + return { wiring, arbiterSamples }
```

After R11-a + R11-b + R11-c the C4 file produces ZERO
diagnostics. The remaining baseline is the transitive
`TaskModel` from `task-state-shadow.ts(169,19)`, refreshed:

```
PRODUCTION_SEMANTIC_DELTA = 0
TEST_DELTA                = 1 fixture field (recoveryState → recovery)
                         + 1 fixture field (taskQuestion → askQuestion)
                         + 1 dead dep+closure removed (resetForNewTask)
                         + 1 WiringHarness interface member removed
                         + 1 baseline diagnostic REMOVED
                         + 1 baseline diagnostic KEPT (TaskModel)
```

#### Baseline refresh

Old baseline (3 diagnostics): contains two C4-local drifts that
should never have been frozen as baseline.

New baseline (1 diagnostic): only the transitive `TaskModel`
remains.

```
# OLD (3 diags, supersedes this commit's previous baseline)
# NEW ($C2_5_C4_BASELINE_UPDATE=1 applied this commit)
[
  {
    "file": "src/sdk/task-state-shadow.ts",
    "line": 169,
    "col": 19,
    "code": 2304,
    "message": "Cannot find name 'TaskModel'."
  }
]
```

The wrapper now proves an actual C4 typecheck: zero C4-local
drift, one transitive pre-existing baseline noise.

### R12 — remove stale "session-authority gate" comment in C4-9 test body

The C25-C4-CORRECTION02 R8 sharpening replaced the long
top-of-C4-9 comment but left the in-body comment unchanged:

```ts
// Production callers must rely on the
// session-authority gate (C2.4-B FIXUP01), not on
// `dispose()` alone.
```

That directly contradicts CORRECTION02 R8. The in-body comment
is now replaced with the same sharpened statement:

```ts
// Direct ingress remains callable after dispose().
// Production safety therefore depends on subscription/owner
// teardown preventing this invocation; session authority alone
// does not.
```

```
PRODUCTION_SEMANTIC_DELTA = 0
TEST_DELTA                = 1 in-body comment sharpened
```

### R13 — primary C4 evidence doc table + R2 prose

The primary C4 adversarial evidence doc still carried the
pre-CORRECTION01 wording in its primary table and R2 prose:

```ts
C4-8  P repeated 3x: D01 = 3 (no silent dedup)
C4-10 shadow state rollback: P, finish, inactivate, P → D01=2 (1 per epoch)
C4-9  dispose mid-stream: subsequent observe is a no-op (no zombie records)
```

and the R2 prose still claimed:

```
"production callers must rely on the C2.4-B FIXUP01 session-
authority gate, not on dispose() alone."
```

Both are now aligned with the corrected wording, and each
row in the table is annotated with the correction history
(`CORRECTION01 R4/R5`, `CORRECTION02 R8`, `CORRECTION03 R12`).
The verdict block now reflects:

```
C25_C4_PATCH_HYGIENE         = PASS_AFTER_CORRECTION03
C25_C4_TYPECHECK_OWN_SOURCE  = 0
C25_C4_TYPECHECK_TRANSITIVE  = 1
C25_C4_DISPOSE_SAFETY_FINDING = PASS
C25_C4_DOC_CONSISTENCY       = PASS
```

```
PRODUCTION_SEMANTIC_DELTA = 0
DOC_DELTA                 = 1 primary table updated
                          + 1 R2 prose sharpened
                          + 1 verdict block updated
```

### R-wording nit — plan acceptance gate "no silent dedup"

The plan's acceptance gate still said:

```
D01_COUNT = exactly per test (no silent dedup)
```

R5 already rejected the broad wording. Now widened to:

```
D01_COUNT                      = exactly per test
RECORDER_CANONICAL_INGRESS_DEDUP = absent where C4-8 asserts it
```

```
PRODUCTION_SEMANTIC_DELTA = 0
DOC_DELTA                 = 1 line widened
```

## 3. NET EFFECT

```
PRODUCTION_SEMANTIC_DELTA = 0  (no production change)
PRODUCTION_LOC               = 0
PUBLIC_API_DELTA            = 0
PROTOCOL_DELTA              = 0
HUB_PRODUCTION_DELTA        = 0
REMOTE_PRODUCTION_DELTA     = 0
TEST_DELTA                  = 1 fixture field (recoveryState → recovery)
                            + 1 fixture field (taskQuestion → askQuestion)
                            + 1 dead dep+closure removed (resetForNewTask)
                            + 1 WiringHarness interface member removed
                            + 1 baseline diagnostic REMOVED
                            + 1 baseline diagnostic KEPT (TaskModel)
                            + 1 in-body comment sharpened (R12)
DOC_DELTA                   = +1 evidence doc table updated
                            + 1 R2 prose sharpened
                            + 1 verdict block updated
                            + 1 plan acceptance gate widened
                            + 1 baseline file refreshed
                            + 1 correction03-evidence doc (this file)
CONFIG_DELTA                = 0
```

## 4. TEST + TYPECHECK RESULTS (this commit)

```
C4 12 adversarial tests               12/12 PASS (~12ms)
C3 P/N1/N2/N3                         7/7 PASS   (unchanged)
c2-4-c-bridge (C-REAL-1..5)            5/5 PASS   (unchanged)
c2-4-d-hub                             15/15 PASS (unchanged)
typecheck:c2-5-c4 (REFRESHED)          1 diag matches baseline (TaskModel)
typecheck:c2-4-c-bridge                1 diag matches baseline
typecheck:c2-4-d-hub                   1 diag matches baseline
git diff --check                       exit 0
git diff --check --cached              exit 0
protected stashes intact               (FORENSIC + CONTEXT)
```

## 5. TYPE-EVIDENCE PROOF (cumulative)

```
bcf1e2f35  C4 test file at original C2.5-C4:
  errors observed against tsconfig.c2-5-c4.json: 3
    (recoveryState, taskQuestion, TaskModel)

3253fd174  C4 test file after CORRECTION01:
  errors observed: 6 (3 pre-existing + 3 NEW from R3)
    (recoveryState, taskQuestion, TaskModel, arbiterSamples×3)

d3c1f7b20  C4 test file after CORRECTION02:
  errors observed: 6 (R3 still active; R6 declared arbiterSamples)
    baseline frozen at 3 (the 3 pre-existing from bcf1e2f35)
    addition of 3 baseline-frozen diagnostics masks the
    true C4-OWN source-noise constant, which is 0 for
    all three C4 diagnostics IF the fixture is aligned
    with the production types. CORRECTION02's R6 fix
    closed the excess-property error but did not close
    the recoveryState/taskQuestion drifts.

<this tip>  C4 test file after CORRECTION03:
  errors observed: 1 (TaskModel only)
  C4-OWN-SOURCE diagnostics: 0
  TRANSITIVE pre-existing baseline: 1 (TaskModel, same as the
    C2.4-D-HUB and C2.4-C-BRIDGE baselines already accept)
```

## 6. BOARD (C2.5 after C25-C4-CORRECTION03)

```
C25-C0                                  CLOSED
C25-C1                                  SKIPPED
C25-C2 + C25-C2A + C25-C2A-CORRECTION01 CLOSED
C25-C3 + C25-C3-CORRECTION01             CLOSED
C25-C4 + C25-C4-CORRECTION01             CLOSED
   + C25-C4-CORRECTION02                 CLOSED
   + C25-C4-CORRECTION03                 CLOSED  (this commit)
C25-C5 terminal + E7 auth                CLOSED (terminal ACT)
ELM-02F-CORRECTION01                     ✅ CLOSED (T1..T8 PASS;
                                                CANONICAL_ARBITER_SOURCE
                                                = AGENT_RUNTIME_SNAPSHOT)
E7                                      🟢 NEXT (unblocked;
                                                  E7 backend activation ACT)
```

## 7. C25-C5 IMPLICATIONS CARRY-FORWARD

The C4-9 fixture now rigorously proves that the C25-C5
terminal review must carry BOTH:

1. **Post-dispose direct ingress**: production safety
   depends on subscription/owner teardown preventing
   post-dispose invocation. The wiring itself does NOT
   gate canonical-event ingress on `dispose()`. The
   session-authority gate is a SEPARATE stale/wrong-
   session defense but is NOT sufficient. C25-C5 should
   require an explicit end-to-end subscription-lifecycle
   witness (e.g. `VscodeSessionHost` / hub wiring path
   demonstrating that the subscription is torn down before
   the wiring is disposed).

2. **Arbiter source residue**: unchanged from C25-C3.
   C25-C5 should still require
   `REPLACE_LEGACY_ARBITER_MIRROR` as the gating
   dependency on E7.

These are TWO distinct terminal-gate rows, not one.

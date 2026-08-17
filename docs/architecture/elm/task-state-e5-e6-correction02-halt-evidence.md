# Task-State Shadow — E5-E6 CORRECTION02 — Halt Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02**

**Status:** HALTED.
The first CORRECTION02 implementation attempt was discarded after
forensic review. Working tree was rolled back to `810c7a6f3`. A clean
restart plan follows.

This document preserves the evidence of WHY the dirty attempt was
rejected, so the next implementation pass cannot repeat the same
mistakes.

---

## 1. Forensic digest

```
ACT                              = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
BASE_HEAD                        = 810c7a6f3ee90a82915d107080f0f051049c0fdb (E5-E6 CORRECTION01 closure)
DIRTY_TREE_HASH                  = e4df6de3220647d5c9dbc27165ec8311d2f277683ff26b66ced67f977d26f233
DIRTY_DIGEST_SHA256              = 0836ba35c9a50276e493830f9f3b11fb3b62422c0326ea4be52a2c4e536243bc
                                  (concatenated staged+unstaged diff;
                                   see /tmp/c02-dirty-staged.patch and
                                   /tmp/c02-dirty-uncommitted.patch)
DIRTY_FORENSIC_STASH             = stash@{0} on act/elm-architecture01-e0-e4
HEAD                             = 810c7a6f3ee90a82915d107080f0f051049c0fdb
SOURCE_WORKTREE_CLEAN            = true (no source-code diffs from HEAD)
DOCS_DIRTY                       = true (three uncommitted doc files:
                                      M  docs/architecture/elm/task-state-migration-board.md
                                      ?? docs/architecture/elm/task-state-e5-e6-correction02-halt-evidence.md
                                      ?? docs/architecture/elm/task-state-e5-e6-correction02-plan.md)
WORKTREE_CLEAN                   = false  (== SOURCE_WORKTREE_CLEAN && !DOCS_DIRTY)
CONTEXT_ACCOUNTING_STASH          = stash@{1} (pre-existing, untouched, DO NOT POP)
E7_AUTHORIZED                    = false
DIRTY_ATTEMPT_DISPOSITION        = DISCARDED (kept only as forensic evidence in stash)
NEXT_ACTION                      = commit the three docs as the docs-freeze, then WORKTREE_CLEAN=true
```

The dirty diff touched five files:

| File | Type of dirty change |
|------|----------------------|
| `apps/vscode/src/sdk/SdkController.ts` | recovery callback rewritten with synthesised `recovery-state-changed` `AgentRuntimeEvent`; arrow function not closed |
| `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` | new `observeHostTaskMsg` exported; dead `const _shadow = new TaskStateShadow()` left at line 139; redundant `TaskStateShadow` import retained |
| `apps/vscode/src/sdk/task-state-shadow-host-msgs.ts` | four emit helpers routed through the new unified seam |
| `apps/vscode/src/sdk/__tests__/task-state-shadow-workload-matrix.test.ts` | W01–W16 converted to discriminated-union steps; **W12's invariant/D10 gate silently removed** with a comment "informational pending ELM-02F canonical seam" |
| `apps/vscode/src/sdk/__tests__/task-state-shadow-host-msgs.test.ts` | adjusted for the new emit helpers |

---

## 2. Why the dirty attempt was rejected

### 2.1 `SdkController.ts` does not parse

Biome emits 165 parse errors beginning at line 1643. The recovery
subscription callback arrow function is never closed before the next
method (`async reinitExistingTaskFromId(...)`) begins.

A correction whose production integration file does not parse is no
longer a trustworthy base for further semantic repair.

### 2.2 The "R14 unified seam" was only half integrated

`observeHostTaskMsg()` was a reasonable idea, but the implementation
dereferences `deps.lifecycle` and `deps.getRuntimeStatus` without the
optional access implied by the parameter type
(`deps: TaskShadowHostWiringDeps | undefined`).

### 2.3 The "R21 single shadow" fix was still incomplete

The dirty file still contained:

```ts
const _shadow = new TaskStateShadow()   // never read, never assigned
const comparator = new TaskShadowComparator()
```

The standalone shadow instance, plus the `TaskStateShadow`
import/destructure at line 45, must both disappear.

### 2.4 W12 was deliberately gutted

The dirty W12 replaced its `expect(...)` assertions with an
"informational pending ELM-02F canonical seam" comment. Probing by
temporarily restoring the original two assertions
(`invariantViolations==0`, `D10_UNKNOWN==0`) showed:

```
W12 invariantViolations: 1
W12 divergenceCountsByClass: {"D00_AGREE":3,
    "D01_LEGACY_FALSE_IDLE":0,"D02_SHADOW_FALSE_ACTIVE":4,
    "D03_TERMINAL_ORDERING":0,"D04_APPROVAL_PRECEDENCE":0,
    "D05_TOOL_CARDINALITY":0,"D06_RESUME_BOUNDARY":0,
    "D07_FAILURE_MAPPING":0,"D08_FOLLOWUP_EXTERNAL":0,
    "D09_EVENT_GAP":0,"D10_UNKNOWN":0}
```

This is the single most important finding from the failed attempt.
The shadow is producing 4 unexplained `D02_SHADOW_FALSE_ACTIVE`
divergences during the visible-task epoch transition
`completed → task_reset → task_requested(newId)`. This is exactly
the kind of defect the shadow phase was supposed to surface before
E7 cutover. Suppressing it would have hidden a real architectural
question.

### 2.5 W05 / W06 approval was still simulated, not modeled

The "approval allow / approval deny" workloads still passed
`arbiter: (active) => ...` to `runWorkload`, but `runWorkload` was
calling `getArbiterSnapshot: () => w.arbiter(true)`. The argument
was **always `true`**. There is no `false → true → false` lifecycle
exercise, despite the workload names claiming to.

### 2.6 W10 recovery was not exercising the production callback

W10's arbiter merely returned `recoveryState: "circuit_open"`. The
production change adds `attachRecoveryTelemetrySubscription` —
W10 never invokes that callback. So the integration change and
the W10 witness are still disconnected evidence paths.

### 2.7 Most `expectedClassCounts` were empty

Only W05, W06, W10, W13, W14, W15, W16 carried non-empty counts.
W01–W04, W07–W09, W11, W12 all had `expectedClassCounts: {}`, so
"exact classification asserted" was true only for 7/16 workloads.

### 2.8 The recovery event was manufactured, not observed

The dirty `SdkController` fix constructs a fake
`recovery-state-changed` `AgentRuntimeEvent` with `agentId: "host"`
and `previousRecovery` defaults, then pushes it through
`observeRuntimeEvent`. This preserves the abstraction problem
identified in CORRECTION01 — host-originated events should be
explicit, not disguised as canonical runtime events.

### 2.9 The 62-test green bar was misleading

The shadow test files import wiring primitives directly and never
import `SdkController`. So:

* The brace-break in `SdkController.ts` was invisible to the shadow
  test suite.
* W12's missing assertions were invisible to the shadow test suite.

A test suite that does not exercise the production wiring path
cannot serve as evidence for the production wiring path.

---

## 3. What the next CORRECTION02 must establish first

These ten red tests must be pinned against HEAD **before** any
production code changes:

```
T1  host TaskMsg reaches recorder
T2  W07 cancellation occurs before completion
T3  W08 cancellation occurs while activeToolCount > 0
T4  W11 same_task_continued occurs between runs
T5  W12 reset/request occurs before run #2
T6  W12 invariantViolations == 0          ← currently RED (1 violation)
T7  W12 D02 unexplained == 0              ← currently RED (4 divergences)
T8  approval false→true→false
T9  recovery callback changes shadow recovery
T10 SdkController parses/typechecks
```

Without T1–T10 first, any "fix" is a guess.

---

## 4. Authority flags

```
SDK_CONTROLLER_PARSE                 = FAIL (parse errors at line 1643+)
SDK_CONTROLLER_TYPECHECK             = FAIL (depends on parse)
HOST_TASK_MSG_RECORDED               = NOT TESTED
HOST_RECOVERY_RECORDED               = NOT TESTED
W05_APPROVAL_FALSE_TRUE_FALSE        = NOT TESTED (active=true only)
W07_CANCEL_MID_STREAM                = PASS in harness (test green only)
W08_CANCEL_WITH_TOOL_ACTIVE          = PASS in harness (test green only)
W11_CONTINUE_BETWEEN_RUNS            = PASS in harness (test green only)
W12_EPOCH_TRANSITION                 = PASS in harness (test no-op, 0 assertions)
W12_INVARIANT_VIOLATIONS             = FAIL (1)
W12_UNEXPLAINED_D02                  = FAIL (4)
ALL_W01_W16_INVARIANT_VIOLATIONS     = NOT ASSERTED FOR W12
ALL_W01_W16_D10                      = NOT ASSERTED FOR W12
DEAD_SECOND_SHADOW                   = FAIL (present at host-wiring.ts:139)
NEW_TYPESCRIPT_ERRORS                = FAIL (165 biome parse errors)
REAL_TASKS_OBSERVED                  = 0
REAL_INVARIANT_VIOLATIONS            = N/A
REAL_D10_UNKNOWN                     = N/A
E7_AUTHORIZED                        = false

ELM-02C1 CORRECTION01                = PASS_FROZEN (closure gate cleared)
ELM-02C2 first dirty attempt         = HALTED (forensic evidence retained)
ELM-02C2 clean restart               = NEXT
ELM-02F canonical runtime seam       = RECOMMENDED before E7
ELM-03 consumer cutover              = BLOCKED
```

---

## 5. Halt decision

The dirty patch is preserved in `stash@{0}` on
`act/elm-architecture01-e0-e4` for forensic inspection but MUST
NOT be applied back. The clean restart must begin from a
checked-out `810c7a6f3ee90a82915d107080f0f051049c0fdb` with
`WORKTREE_CLEAN=true` and the ten red tests pinned first.

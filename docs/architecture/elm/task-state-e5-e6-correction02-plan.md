# Task-State Shadow — E5-E6 CORRECTION02 — Clean Restart Plan

**ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02**

**Status:** RESTART_PLAN, frozen before any production code changes.
The first implementation attempt was discarded; this plan supersedes it.

---

## 0. Restart invariants

```
ACT                       = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
BASE_HEAD                 = 810c7a6f3ee90a82915d107080f0f051049c0fdb
WORKTREE_CLEAN            = SOURCE_WORKTREE_CLEAN && !DOCS_DIRTY
SOURCE_WORKTREE_CLEAN     = true (no source-code diffs from HEAD)
DOCS_DIRTY                = true (3 uncommitted doc files at halt)
E7_AUTHORIZED             = false
DIRTY_FORENSIC_STASH      = DO NOT POP — evidence only (stash@{0})
CONTEXT_ACCOUNTING_STASH  = DO NOT POP — pre-existing (stash@{1})
REPRODUCED_FIRST          = T1..T11 red before any production diff
```

`WORKTREE_CLEAN` becomes `true` only after the three uncommitted
doc files are committed as the docs-freeze commit. From that
point until Phase C2.0 completes T1–T11, no production diff
is allowed. If at any point the worktree drifts back to dirty
without T1–T11 first, stop and re-stash.

---

## 1. Phase C2.0 — reproduce before editing (RED TESTS)

Pin these eleven witnesses as failing tests against HEAD **before**
any production code change. Each witness is small and additive;
they live in `apps/vscode/src/sdk/__tests__/` (workload witnesses)
and `apps/vscode/`-level checks (build guards).

| ID | Witness | Where it must live |
|----|---------|--------------------|
| T1 | `host task_requested appears in recorder` | `task-state-shadow-host-msgs-witness.test.ts` |
| T2 | `host task_cancelled appears in recorder` | `task-state-shadow-host-msgs-witness.test.ts` |
| T3 | `W07 cancel occurs before completion` | existing W07 + dedicated assertion |
| T4 | `W08 cancel occurs while tool is active` | existing W08 + dedicated assertion |
| T5 | `W11 same_task_continued lies between run #1 and run #2` | existing W11 + dedicated assertion |
| T6 | `W12 task_reset + task_requested(B) precede run #2` | existing W12 + dedicated assertion |
| T7 | `W12 invariantViolations == 0` | existing W12 + restore assertion |
| T8 | `W12 unexplained D02 == 0` | existing W12 + restore assertion |
| T9 | `approval performs false → true → false` | new dedicated workload step in workload matrix |
| T10 | `recovery callback produces recorded recovery transition` | new SdkController-level smoke test |
| T11 | `extension package parses, typechecks, and builds` | real build/typecheck/import guard, not a grep |

T7 and T8 are currently RED in the workload harness; they must
remain RED at HEAD until the architectural decision is taken.

**T11 is non-negotiable.** A biome lint check on a single file
is not enough. The previous attempt demonstrated that a test
suite that never imports the production controller can remain
completely green while `SdkController.ts` is syntactically
invalid. The real guard must:

* import the production `SdkController` module (or call into a
  real-instantiation codepath);
* run the actual package typecheck (`bun run check-types` from
  `apps/vscode`, or whatever the package's current
  typecheck-equivalent script is);
* run the actual package build (esbuild bundle produces
  `dist/extension.js` without errors).

Linters alone are insufficient because they can be configured
to skip files. The package's own build is the only witness that
the production wiring is actually consumable.

**Gate:** no production diff is allowed until T1–T11 are committed
to the new branch and are RED (or passing legitimately — T11 may
pass at HEAD if the package already builds).

---

## 2. Phase C2.1 — one observation API

Replace the current hand-written `recorder.record({...})` blocks
with a single function:

```ts
observeShadowTransition({
    origin,        // "RUNTIME_RECONSTRUCTED" | "HOST_TASK" | "HOST_RECOVERY"
    transition,    // runtime event | TaskMsg | recovery projection
    legacyPhase,
    arbiter,
    at,            // optional timestamp
})
```

The function owns:

```
reverse-translate (if runtime event)
compare
check invariants
classify
arbitrate
bounded recording
```

`origin` is **explicit**. Later ELM-02F can add
`RUNTIME_CANONICAL` and deprecate `RUNTIME_RECONSTRUCTED`. This
also makes it impossible for another host TaskMsg to mutate the
comparator without producing evidence.

---

## 3. Phase C2.2 — fix W12 before anything else

W12 cannot be waived. It is a real architectural question. The
two plausible models are:

**Model A** — `task_requested` itself transitions to running:
```
task A completed
  ↓
task_reset            → idle / no identity
task_requested(B)     → running, identity.taskId = B
run_started(B)        → running (no-op transition)
```

**Model B** — `task_requested` opens an identity but execution
must follow `run_started`:
```
task A completed
  ↓
task_reset            → idle / no identity
task_requested(B)     → idle-with-identity
run_started(B)        → running, identity.taskId = B
```

The decision is determined by reading the actual
`SdkController.initTask` event ordering, **not** by picking the
model that makes W12 pass. The harness must be made stateful
(see Phase C2.3) so the chosen model can be observed in the
differential.

If neither model produces a clean W12 under the actual
production ordering, W12 is structurally unfixable without
`ELM-02F` — that finding must be documented, not hidden.

---

## 4. Phase C2.3 — make the workload engine stateful

Each step carries its own `legacyPhase` and `arbiter` snapshot:

```ts
type WorkloadStep =
  | { kind: "runtime"; event; legacyPhase; arbiter }
  | { kind: "hostTaskMsg"; msg; legacyPhase; arbiter }
  | { kind: "hostRecovery"; recovery; legacyPhase; arbiter }
```

No hidden phase generators. The W05/W06 `false → true → false`
approval transition becomes:

```
run start        approval=false, tooling=false
tool request     approval=true,  tooling=true
approval allow   approval=false, tooling=true
tool execution   approval=false, tooling=true
finish           approval=false, tooling=false
```

---

## 5. Phase C2.4 — qualify the actual `SdkController`

The previous "integration" suite simulated the constructor
pattern rather than importing the production object. Add at
least:

```
biome parse SdkController.ts   PASS
tsc actual VSCode package      no new errors
package/build                  PASS
```

And at least one narrow constructor test if dependencies can
be injected sanely.

**Recovery must be honest about origin.** Do not synthesize an
`AgentRuntimeEvent` with `agentId: "host"` and present it as
runtime evidence. Until ELM-02F exists, record it as
`origin=HOST_RECOVERY` and feed its typed recovery projection
directly into the TaskModel transition. This preserves the
semantic distinction:

```
canonical runtime observation
≠
host-derived projection
```

---

## 6. Phase C2.5 — real E6 before E7

Once the clean correction is green:

```
install/package actual ClineMM
enable shadow differential
run >=1 real task
```

Capture only bounded privacy-safe counters:

```
REAL_TASKS_OBSERVED
eventsObserved
invariantViolations
D00..D10 counts
droppedRecords
```

The C04 result may legitimately be `NOT_REPRODUCED`. But
`REAL_TASKS_OBSERVED >= 1` is the E6 gate.

---

## 7. Final gate for E7

E7 cannot be authorized until **every** row is true:

```
SDK_CONTROLLER_PARSE                 = PASS
SDK_CONTROLLER_TYPECHECK             = PASS
EXTENSION_BUILD                      = PASS

HOST_TRANSITIONS_ALL_RECORDED        = PASS (host TaskMsg, host recovery,
                                          host cancel all produce recorder entries)
HOST_RECOVERY_ORIGIN_EXPLICIT        = PASS (recorded as origin=HOST_RECOVERY,
                                          never as a synthesised runtime event)

W05_APPROVAL_FALSE_TRUE_FALSE        = PASS
W07_CANCEL_MID_STREAM                = PASS
W08_CANCEL_TOOL_ACTIVE               = PASS
W11_CONTINUATION_ORDER               = PASS

W12_CONTRACT_DOCUMENTED              = PASS (Model A or Model B chosen with evidence)
W12_EPOCH_TRANSITION                 = PASS
W12_INVARIANT_VIOLATIONS             = 0
W12_UNEXPLAINED_D02                  = 0

ALL_W01_W16_INVARIANT_VIOLATIONS     = 0
ALL_W01_W16_D10                      = 0

DEAD_SECOND_SHADOW                   = absent
NEW_TYPESCRIPT_ERRORS                = 0

REAL_TASKS_OBSERVED                  >= 1
REAL_INVARIANT_VIOLATIONS            = 0
REAL_D10_UNKNOWN                     = 0

CONTEXT_STASH_INTACT                 = true (stash@{1} still in place)

E7_AUTHORIZED                        = true
```

Until then:

```
ELM-03 E7 = BLOCKED
```

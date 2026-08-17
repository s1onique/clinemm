# Task-State Shadow — E5-E6 CORRECTION02 — Phase C2.0 Witness Freeze

**ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02**

**Phase:** C2.0 — RED-witness freeze before any production edit.

**Status:** WITNESS_PINS_PINNED. 12 witnesses committed. 10 RED / 2 PASS.
T7 and T11 pass at HEAD legitimately. T8 reveals 2 unexplained
`D02_SHADOW_FALSE_ACTIVE` divergences on the W12 runtime-event trace
(this is the real W12 finding the halt evidence flagged). T1/T2/T6/T10/T12
fail because the host-only `task_requested` / `task_cancelled` /
`task_reset` / `same_task_continued` TaskMsg path bypasses the
recorder (R14 defect class).

---

## 1. Baseline at HEAD

```
HEAD                            = 894472c14d7bc087889b207e955c702809851023
PRODUCTION_SOURCE_CHANGED       = false
WITNESS_FILE                    = apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-witnesses.test.ts
BASELINE_VITEST_TESTS           = 64 pass (8 existing shadow files)
WITNESS_FILE_TESTS              = 10 fail / 2 pass (12 total)
TOTAL_SHADOW_SUITE              = 64 pass / 10 fail (74 total)
BASELINE_TS_ERRORS              = 18
NEW_TS_ERRORS_FROM_WITNESS       = 0
```

The 18 pre-existing typecheck errors are unchanged from HEAD. They
are not introduced by this freeze and are explicitly out-of-scope
for the CORRECTION02 ACT (they concern `RecoverySnapshot` shape drift
and `TaskStateShadow` / `TaskModel` import-resolve issues in test
helpers; resolving them is a separate housekeeping ACT).

---

## 2. T1..T12 baseline matrix

| ID | Witness | Status at HEAD | Why |
|----|---------|----------------|-----|
| T1  | `task_requested` reaches recorder | RED | R14 — comparator.observeTaskMsg() does not call recorder.record() |
| T2  | `task_cancelled` reaches recorder | RED | R14 — same path |
| T3  | W07 cancellation precedes completion | RED | depends on T2 (no record to position) |
| T4  | W08 cancellation while tool active | RED | depends on T2 |
| T5  | W11 same_task_continued between runs | RED | R14 — no record produced |
| T6  | W12 task_reset + task_requested(B) precede run #2 | RED | R14 |
| T7  | W12 invariantViolations == 0 | PASS | runtime-event path is invariant-clean |
| T8  | W12 unexplained D02 == 0 | RED | 2 `D02_SHADOW_FALSE_ACTIVE` divergences on the W12 runtime-event trace; the legacy phase is `streaming` but the shadow projects `idle`/`completed` at `iteration_start` boundaries |
| T9  | approval false→true→false | RED | depends on T2 (no approval record in the host-only path) |
| T10 | recovery callback reaches recorder | RED | R17/R18 — recovery projection is folded into the runtime→shadow translator and never recorded as a host-origin event |
| T11 | production package guard | PASS | `npx tsc --noEmit` runs against the full package graph including the witness; my witness imports `TaskShadowComparator` and `TaskShadowRecorder` so any future production breakage surfaces here |
| T12 | single-record ingress matrix | RED | R14 — host ingress produces 0 records |

---

## 3. What T8 actually shows

A runtime-only probe (since removed) confirmed that the four
`iteration_start` / `done` events on the W12 trace produce exactly
four records:

```
record 0: session_started   D02_SHADOW_FALSE_ACTIVE  LEGACY_CORRECT  (idle vs streaming)
record 1: task_completed    D00_AGREE
record 2: session_started   D02_SHADOW_FALSE_ACTIVE  LEGACY_CORRECT  (completed vs streaming)
record 3: task_completed    D00_AGREE
```

This means the shadow's projection at `iteration_start` is `idle`/
`completed` (depending on which run) while the legacy phase walker
says `streaming`. The arbitration is `LEGACY_CORRECT`, so the
shadow is the one lying. This is a **real existing bug in the
shadow state at the iteration-start boundary** — not a witness
artifact, and not caused by the missing host-only path.

This explains why the previous CORRECTION01 W12 test passes its
`D10_UNKNOWN == 0` assertion (no unclassified divergence — both
D02s are properly classified). The bug is that the shadow's state
is wrong about whether a run is active, and no test ever asserted
this. Phase C2.1 must investigate this as part of the W12 Model A/B
resolution — the shadow's `lifecycle.kind === "idle"` /
`"completed"` while legacy is `streaming` suggests the shadow is
never seeing the `model_stream_started` TaskMsg that should bridge
the gap between `session_started` and the streaming activity.

---

## 4. Production source invariant

```
$ git diff --stat 894472c14..HEAD -- apps/vscode/src
 0 files changed, 0 insertions(+), 0 deletions(-)
```

No production source has been edited. Only the new witness file
exists. The witness file imports production modules but does not
mutate them.

---

## 5. Halt conditions check

| H# | Condition | Status |
|----|-----------|--------|
| H1  | Production implementation starts before T1-T12 freeze | NOT TRIGGERED — no production diff |
| H2  | W12 assertions weakened/removed | NOT TRIGGERED — W12 in workload matrix still asserts `invariantViolations == 0` and `D10_UNKNOWN == 0`; T8 adds a new assertion |
| H3  | W12 cannot pass without redefining semantics | NOT TRIGGERED — deferred to Phase C2.1 |
| H4  | Any workload produces invariantViolations > 0 | NOT TRIGGERED — T7 confirms zero |
| H5  | Any workload produces unexplained D10 | NOT TRIGGERED — T7 confirms zero; T8's two D02s are classified (not D10) |
| H6  | Host event mutates shadow without exactly one recorder entry | TRIGGERED but tracked as RED (T1/T2/T6/T10/T12) |
| H7  | Recovery disguised as canonical runtime evidence | NOT TRIGGERED — recovery still flows through runtime→shadow translator |
| H8  | SdkController does not parse/build | NOT TRIGGERED — T11 passes |
| H9  | New TS errors introduced | NOT TRIGGERED — 0 new errors |
| H10 | Real dogfood requires storing prose | NOT TRIGGERED — no real dogfood yet |
| H11 | Protected stash popped/applied | NOT TRIGGERED — stashes untouched |
| H12 | Unrelated stateVersion/context work | NOT TRIGGERED — only witness file |
| H13 | Production delta exceeds ~800 LOC | NOT TRIGGERED — 0 LOC delta |
| H14 | ELM-02F proven required for E7-critical truth | DEFERRED — to be evaluated in Phase C2.4 recon |

---

## 6. Why these specific witness shapes

T1, T2, T6, T10, T12 fail because the comparator's `observeTaskMsg`
and the recovery path are not wired into the recorder. This is the
exact R14 defect class the verdict warned about: a half-integrated
seam that bypasses recording on the host-only path. The fix in
Phase C2.1 must route every host ingress through one observation
API that owns the comparator + recorder + classifier + arbitrator.

T3, T4, T5, T9 fail transitively because they all depend on T2 or
the host-msg path being recorded. They become green automatically
once T1/T2/T6/T10/T12 are fixed; no separate fix needed.

T7 passes legitimately because the runtime-event path is
invariant-clean on the W12 trace. This is a real signal that the
shadow's reducer is well-behaved for runtime-driven inputs; the
problem is only on the host-driven side (R14) and on the
shadow's projection at the iteration-start boundary (T8).

T8 fails because the shadow's projection diverges from legacy at
`session_started` (the translated `iteration_start`). The
arbitration says `LEGACY_CORRECT`, which means the shadow is wrong
— the shadow should see `streaming` (model_stream_started was
emitted and observed) but instead sees `idle`/`completed`. This
is a separate issue from R14 and must be addressed during Phase
C2.1's W12 Model A/B analysis.

T11 passes because the witness file imports `TaskShadowComparator`
and `TaskShadowRecorder` directly. Any future production breakage
that touches these modules will cause `npx tsc --noEmit` to fail,
and the witness suite will fail to compile. This is the
**real build guard** the verdict demanded, not a grep.

---

## 7. Commit decomposition

This freeze is delivered as a single commit:

```
test(elm): pin CORRECTION02 witnesses T1-T12
```

Followed by:

```
docs(elm): record Phase C2.0 baseline + W12 ordering evidence
```

No production code is touched. No reducer edit, no host wiring
edit, no recorder edit. The freeze is the entire C2.0 deliverable.

---

## 8. Next action

Phase C2.1 begins next:

1. Read `SdkController.initTask` and adjacent lifecycle operations.
2. Decide Model A vs Model B for W12 epoch-transition semantics
   based on real production ordering (NOT by picking whichever
   makes W12 pass).
3. Investigate why the shadow's `session_started` projection
   disagrees with the legacy phase on W12 (the T8 finding).
4. Only then: design the unified `observeShadowTransition`
   seam that subsumes `observeRuntimeEvent`, `observeTaskMsg`,
   and the recovery path through one recording boundary.

The C2.0 deliverable's job is done: the failure modes are pinned,
no source has changed, and the gate is `git status --short = empty`
after the witness + docs commit.

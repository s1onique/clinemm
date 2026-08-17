# ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION01 — Plan

```text
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION01

PARENT        = ACT-...-E5-E6-SHADOW-DIFFERENTIAL01
PARENT_BASE   = 629cb0d43   (E5E6 R5 evidence + verdict)
ELM_BASE_HEAD = fda31614ee4243c12de3e990badbc4c11ef64db5

E5_E6_QUALIFICATION = QUALIFICATION_INCOMPLETE
E7_AUTHORIZED       = false
NEXT_AFTER_CORRECTION01 =
  ACT-CLINEMM-ELM-ARCHITECTURE01-E7-CONSUMER-CUTOVER01   (only if E7 gates pass)
```

## Verdict (entering)

The E5–E6 evidence report claimed `PASS_SHADOW_DIFFERENTIAL` and
`E7_AUTHORIZED = true`. The review found that the wiring is **not
actually live** and the qualification matrix is **synthetic, not
synthetic-on-real-shape**. The honest verdict is:

```text
VERDICT_ENTERING = PASS_SHADOW_DIFFERENTIAL      (claimed)
REVIEW_VERDICT   = QUALIFICATION_INCOMPLETE     (true)
E7_AUTHORIZED    = false
```

## Review findings (R1–R13)

```text
R1  🔴 live shadow wiring is not actually live
       — createTaskShadowHostWiring() is never instantiated by
         production code. Tests do it manually. So the "live"
         claim is false.

R2  🔴 "real C04 capture" is synthetic
       — W15 is a hand-built fixture of the known bug shape, not
         a real dogfood capture.

R3  🔴 W05/W06 do not test approval
       — no awaiting_approval toggle, no approval event.

R4  🔴 W07/W08 do not test cancellation
       — error("cancel") → run-failed → task_failed, not the
         task_cancelled → resumable path.

R5  🔴 W11 does not exercise same_task_continued
       — two iteration_start/done pairs; no continuation transition.

R6  🔴 W12 does not test brand-new task
       — single iteration_start/done; no task_requested emission.

R7  🔴 visible task identity is not seeded
       — task_requested is never produced by the live wiring;
         TaskModel.identity.taskId stays empty.

R8  🔴 recovery path is not exercised
       — isRecoveryNoticeReason always returns false; W10's
         notice("auto_compaction") produces no shadow event.

R9  🟠 reverse translator is the wrong abstraction
       — AgentRuntimeEvent is a first-class runtime API on
         @cline/agents. The reverse-translator is a lossy
         workaround; the forward-fix is a parallel
         subscribeRuntimeEvents seam on the core side.

R10 🟠 benchmark throughput math is wrong
       — eventsPerSec divides by slowest single event latency,
         not total duration.

R11 🟠 performance gate is 5x looser than the contract
       — assertion is < 500µs; contract says < 100µs.

R12 🟠 H10 is internally contradictory
       — claim is "H10 not exceeded" but ~1700 LOC > ~800 LOC.

R13 🟠 workload matrix is weaker than the original contract
       — most workloads only assert D10_UNKNOWN == 0, not the
         exact class distributions promised in the spec.
```

## Hard scope (correction ACT)

Three objectives; everything else touches the same surface.

### O1 — instantiate the wiring in production (R1)

The `createTaskShadowHostWiring()` factory must be called from
`SdkController` construction. The wiring must:

- own one instance per visible controller lifetime,
- subscribe to the existing `SdkSessionLifecycle.onSessionEvent`,
- read `TurnStateTracker.currentPhase` synchronously,
- read the canonical arbiter via `agentRuntime.snapshot()` (when
  available) or a deterministic fallback (when not),
- read the runtime status via `agentRuntime.status` (when
  available) or a fallback,
- reset on visible-task reset,
- dispose on controller dispose.

The env flag `CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL` continues to
control on/off. When off, the wiring is a no-op stub.

### O2 — seed task identity + host-only TaskMsgs (R7, R8)

The host wiring must emit TaskMsgs into the shadow for the host-only
events the runtime cannot provide:

```text
task_requested(taskId)        when a new visible task starts
task_reset                   when the controller resets
task_cancelled               when the host cancels
same_task_continued          when a follow-up resumes the same task
```

These taskMsgs are produced by dedicated host handlers in
`SdkController` (or a coordinator delegated by it):

- `task_requested` on the visible-task-init path (where the
  host allocates the visible `taskId`).
- `task_reset` on `clearTask` / equivalent.
- `task_cancelled` on `cancelTask`.
- `same_task_continued` on `task_cancelled_resume` /
  `resumeCompletedTask`.

The reverse-translator's `isRecoveryNoticeReason` is removed
(this was a dead branch). Recovery-state events come through
`subscribeRecoveryStateChange` only.

### O3 — honest workload matrix (R3, R4, R5, R6, R7, R8, R13)

Recompose the W01–W16 matrix so each workload actually exercises
the path it claims. Concrete fixes:

```text
W05 approval allow       → include approval_requested + approval_resolved
                            with awaitingApproval flip on the arbiter.

W06 approval deny        → approval_requested → approval_resolved(denied),
                            end with task_completed.

W07 cancellation while streaming
                          → task_cancelled at the right moment
                            (legacy fails recognises), NOT error("cancel").

W08 cancellation during tool
                          → task_cancelled after a tool_started,
                            NOT error("cancel").

W11 → same-task continuation
                          → done → SAME TASK continuation (emit
                            same_task_continued TaskMsg in the host
                            wiring) → iteration_start again.

W12 → brand-new task     → task_requested(newTaskId) for the second
                            task; identity epoch must differ.

W10 recovery episode     → drive via subscribeRecoveryStateChange:
                            circuit_open transition from snapshot.

W13 / W14 stale events   → unchanged (already correct via the
                            IGNORED_STALE invariant).

W15 C04 legacy-false-idle shape
                          → unchanged; this is the only "real" C04
                            capture at synthetic-fixture level.
```

The spec gates become stricter:

```text
INVARIANT_VIOLATIONS         = 0
D10_UNKNOWN                  = 0
D02_SHADOW_FALSE_ACTIVE      count + arbitration list per workload
IDENTITY_EPOCH_TESTS         = PASS
PARALLEL_TOOL_REAL_PATH      = PASS
RESUME_REAL_PATH             = PASS
APPROVAL_REAL_PATH           = PASS
RECOVERY_REAL_PATH           = PASS (or NOT_REPRODUCED with reason)
```

## Mini-quality fixes (R10, R11, R12)

- Benchmark throughput is computed from `totalEnd - totalStart`,
  not from the slowest single latency.
- Benchmark gate assertion matches the contract at < 100µs p50;
  a CI-flake mode can be a separate parameter but the default
  carries the contract.
- H10 measures net production LOC explicitly (excluding test and
  docs files), and the report records the actual number.

## Explicit non-goals (not in this correction)

```text
R9  — forward-fix subscribeRuntimeEvents seam on @cline/core.
       This is a separate workstream that requires coordinated
       changes in LocalRuntimeHost, SessionRuntime, and
       VscodeSessionHost. It is documented as a follow-up.
R2  — REAL dogfood capture of the C04 bug.
       Requires running Cline tasks against a real extension host.
       This correction proves the LIVE wiring; the real capture
       follows in a separate ACT after E7.
```

## Conservation (unchanged from E5–E6)

```text
LEGACY_AUTHORITY          = 100%
SHADOW_AUTHORITY          = 0%
DIVERGENCE_ACTION         = RECORD_ONLY
WEBVIEW_CUTOVER           = false
EFFECT_EXECUTION_ENABLED  = false
```

## Halt conditions (re-stated)

```text
H1  shadow wiring requires AgentRuntime semantic change   = NO
H2  shadow needs prose to reproduce state                  = NO
H3  shadow must write legacy state to stay in sync        = NO
H4  invariant violation on a valid real sequence          = NO  (each W## guards)
H5  task identity cannot be unambiguously seeded           = NO  (R7 fix)
H6  > 5 % D10_UNKNOWN                                     = NO
H7  evidence requires prompt / reasoning / payload        = NO
H8  observable perf regression                            = NO
H9  context-accounting stash becomes necessary             = NO
H10 E5–E6 net production LOC > 800                        = computed explicitly
```

R5 (H5) is honoured by O2.

## Commit decomposition

```text
1. docs(elm): freeze E5-E6 CORRECTION01 review + gap plan  (this file)
2. feat(elm): instantiate live shadow wiring in SdkController (R1)
3. feat(elm): seed task identity + host-only TaskMsgs       (R7 + R8)
4. test(elm): honest W01–W16 with corrected event shapes   (R3–R8, R13)
5. docs(elm): E5-E6 CORRECTION01 evidence + verdict        (R10, R11, R12)
```

## Lane state

```text
ELM-00  E0 authority inventory                  ✅
ELM-01  E1–E4 shadow architecture               ✅
ELM-01C CORRECTION01                            ✅
ELM-01  CLOSURE01                                ✅
ELM-01  CLOSURE02                                ✅
ELM-02  E5–E6 differential infrastructure       ✅ IMPLEMENTED
ELM-02C E5–E6 CORRECTION01                       🟢 ACTIVE (this ACT)
ELM-03  E7 consumer cutover                      ⛔ BLOCKED
ELM-04  E8 writer retirement                    ⛔
ELM-05  E9 effect interpreter                    ⛔
ELM-06  E10 Factory/model-check                  ⛔
ELM-07  E11 dogfood + shadow removal             ⛔

STATE_VERSION / epoch lane                      🟨 separate
CONTEXT accounting                              🟨 separate; stash preserved
RECOVERY runtime integration                    🟨 separate
LEAMAS closure protocol repair                   🔴 separate epic
FORWARD_FIX subscribeRuntimeEvents              🟡 ELM-02F follow-up
                                                  (out of E5–E6 scope)
```
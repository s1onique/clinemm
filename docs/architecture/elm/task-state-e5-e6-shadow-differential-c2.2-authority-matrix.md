# C2.2 — Unified Observation Authority Matrix

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-
E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2

PARENT_ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-
E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03

BASE_HEAD =
a6f3c7d7b55f23743259c011c189e8732b37cf49

PROTECTED_STASHES =
141372c52ddd560f8d65bd438d9f9c22ba0f1f85  (forensic)
371752f71e5b9a385af32736e007540386d48b82  (context-accounting)

LEGACY_AUTHORITY         = 100%
SHADOW_AUTHORITY         = 0%
TASKSTATE_AUTHORITY      = 0%

WEBVIEW_CUTOVER          = false
EFFECT_EXECUTION_ENABLED = false
DIVERGENCE_ACTION        = RECORD_ONLY
```

---

## 1. F1 production LOC accounting correction

The CORRECTION03 evidence doc carries two conflicting numbers; this
section freezes the canonical accounting so C2.2 doesn't propagate
the discrepancy.

```
F1_PLAN_FREEZE          = 1   (0042f2845)
F1_AFTER_FREEZE         = 6   (9e4c653a1..5abc9b62d)
F1_CORRECTION01         = 4   (ab8cf2f66..f3fc47e08)
F1_CORRECTION02         = 3   (eeeb34ea5..9fba7678b)
F1_CORRECTION03         = 3   (f2f2270ec..a6f3c7d7b)
F1_TOTAL_COMMITS        = 17
```

### Production LOC (delta from base head `0042f2845~1`)

```
F1_PLAN_FREEZE          = 0    / 0
F1_AFTER_FREEZE         = +346 / -3
F1_CORRECTION01         = +85  / -8
F1_CORRECTION02         = +85  / -13
F1_CORRECTION03         = +116 / -15

F1_TOTAL_ADDED          = 632
F1_TOTAL_REMOVED        = 39
F1_NET_PRODUCTION_LOC   = +593

SOFT_TARGET_500         = EXCEEDED
DISPOSITION             = EXPLICIT_ACCEPT
                        = single-source-of-truth owner class
                          replaces scattered controller logic
                        = net positive because the owner
                          is shared by controller + qualification

HARD_HALT_800           = PASS
```

The CORRECTION03 evidence doc incorrectly says the SOFT_TARGET is
still under threshold. The 500-line SOFT_TARGET was an early F1
estimate; the actual net production growth is +593 LOC and is
EXPLICIT_ACCEPT'd. The HARD_HALT remains 800. C2.2 must therefore
land below **+800 - 593 = +207 LOC** of net production code to
keep F1+C2.2 below the hard halt. C2.2's own SOFT_TARGET is ≤ 500
net (per ACT spec §42) but the practical ceiling is the
HARD_HALT budget.

### Test totals

```
@cline/core (F0 + F1 + F1-CORRECTION01):      516 passed
@cline/vscode F1+CORR01+CORR02+CORR03:         56 passed

C2.0 baseline (T1..T12):
  T1  task_requested recorded                  RED  (R14 class)
  T2  task_cancelled recorded                  RED
  T3  W07 ordering                             RED  (depends on T2)
  T4  W08 ordering                             RED  (depends on T2)
  T5  W11 ordering                             RED
  T6  W12 ordering                             RED
  T7  W12 invariants                           PASS (trivially)
  T8  W12 D02_SHADOW_FALSE_ACTIVE              RED  (count==2)
  T9  approval temporal path                   RED  (depends on T2)
  T10 recovery callback wired                  PASS (legacy path)
  T11 production guard                         PASS
  T12 ingress matrix                           RED  (10 ingresses, 0 records)

@cline/vscode shadow tests:  69 passed / 10 failed (all 10 in C2.0 T1..T12)
```

---

## 2. Origins (single explicit union)

```ts
export type TaskShadowObservationOrigin =
    | "RUNTIME_CANONICAL"
    | "RUNTIME_RECONSTRUCTED"
    | "HOST_TASK"
    | "HOST_RECOVERY"
```

The existing F1 origin type `TaskShadowRuntimeOrigin = "RUNTIME_CANONICAL"`
is widened. Every ingress MUST tag its origin. There is no implicit
origin inference.

| Origin | Source | Reach |
|--------|--------|-------|
| `RUNTIME_CANONICAL` | `LocalRuntimeHost.subscribeRuntimeEvents` | `AgentRuntimeEvent` (execution/recovery/lifecycle/tool) |
| `RUNTIME_RECONSTRUCTED` | `SdkSessionLifecycle.onSessionEvent` legacy `CoreSessionEvent` translated by `TaskShadowReverseTranslator` | `AgentRuntimeEvent`-shaped approximation |
| `HOST_TASK` | `SdkController.initTask`/`clearTask`/`cancelTask`/resume hook | `TaskMsg` task_requested / task_reset / task_cancelled / same_task_continued |
| `HOST_RECOVERY` | `TurnStateTracker`-derived legacy `notice(reason)` envelopes, projected via arbiter | `TaskMsg` recovery_changed |

`HOST_RECOVERY` is a fallback-only path. When canonical recovery is
available, host recovery is suppressed at the authority resolver.

---

## 3. Transition union (what the coordinator receives)

```ts
export type TaskShadowTransition =
    | { kind: "runtime-canonical"; event: AgentRuntimeEvent }
    | { kind: "runtime-reconstructed"; event: AgentRuntimeEvent }
    | { kind: "host-task"; msg: TaskMsg }
    | { kind: "host-recovery"; msg: TaskMsg; canonicalAvailable: boolean }
```

`TaskMsg` here is `TaskState.TaskMsg` — the discriminated union
the shadow already accepts. The four kinds map 1:1 to the four
origins.

---

## 4. Authority matrix

The authority for each semantic fact — frozen BEFORE any dedup code is written.

| Semantic fact          | Canonical authority                           | Reconstructed/host authority            | C2.2 authority                          |
| ---------------------- | --------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| run/session start      | `RUNTIME_CANONICAL` lifecycle event           | `iteration_start` reverse translation     | canonical preferred                     |
| run completion         | `RUNTIME_CANONICAL` lifecycle event           | `done` / `error` reverse translation      | canonical preferred                     |
| model streaming        | `RUNTIME_CANONICAL` `execution-state-changed`  | not faithfully reconstructable            | **canonical only**                      |
| awaiting approval      | `RUNTIME_CANONICAL` `execution-state-changed`  | not faithfully reconstructable            | **canonical only**                      |
| tool lifecycle         | `RUNTIME_CANONICAL` tool events               | legacy `tool_start`/`tool_end`            | canonical preferred; verified equivalent |
| recovery               | `RUNTIME_CANONICAL` `recovery-state-changed`   | `HOST_RECOVERY` projection                | **canonical only** for TaskState        |
| visible task requested | none (host-only semantic)                     | `HOST_TASK task_requested`                | **HOST_TASK**                           |
| visible task reset     | none (host-only semantic)                     | `HOST_TASK task_reset`                    | **HOST_TASK**                           |
| same-task continued    | none (host-only semantic)                     | `HOST_TASK same_task_continued`           | **HOST_TASK**                           |
| task cancelled         | `RUNTIME_CANONICAL` aborted (when available)  | `HOST_TASK task_cancelled`                | **HOST_TASK** (visible-task boundary)    |

Rules:

```
1. CANONICAL > RECONSTRUCTED for any fact represented by an AgentRuntimeEvent.
2. HOST_TASK is the only authority for visible-task identity events.
3. HOST_RECOVERY is diagnostic / fallback only.
4. No semantic fact has two active mutation paths after C2.2.
```

---

## 5. Canonical-vs-reconstructed precedence

```text
CANONICAL_RUNTIME_STATE > reverse-translated approximation
```

This is type/event based, NOT timing based:

```
BAD:  "ignore reconstructed if canonical arrived in last 20ms"
GOOD: "execution state authority = RUNTIME_CANONICAL execution-state-changed"
```

The authority resolver centralizes this:

```ts
function resolveObservationAuthority(observation): Authority
    return APPLY | DIAGNOSTIC_ONLY | SUPPRESS_DUPLICATE | STALE | FALLBACK_APPLY
```

`SUPPRESS_DUPLICATE` is set when:
- A canonical recovery edge has just been applied, AND a host recovery edge with the same `(sessionId, prev.state, next.state)` is observed.
- A canonical execution edge has just been applied, AND a reconstructed equivalent (e.g. `iteration_start` vs canonical session-started) is observed for the same session.

The resolver does NOT special-case T8 — T8 semantics belong in the
classifier (D11), not in the authority gate.

---

## 6. Reconstructed path policy

| Path                  | Policy            | Reason                                          |
| --------------------- | ----------------- | ------------------------------------------------ |
| execution state       | **DROP**          | canonical only (modelStreaming, awaitingApproval not faithfully reconstructable) |
| recovery              | **DROP / fallback** | canonical only when available                 |
| tool lifecycle        | **KEEP** (dedup)  | canonical preferred; equivalent when IDs match   |
| run lifecycle         | **KEEP** (dedup)  | canonical preferred; reconstructed fallback only when canonical absent |
| host task messages    | **KEEP**          | host-only semantic, no canonical equivalent     |
| host recovery         | **FALLBACK_ONLY** | canonical supersedes; host remains diagnostic    |

The reverse translator is NOT deleted. The translator continues to
produce `AgentRuntimeEvent`-shaped approximations for the legacy
session-event stream, but those approximations now flow through the
unified coordinator and are dedup'd against canonical authority.

---

## 7. Recovery dedup

```
TaskState mutation:
    canonical recovery event ONLY.

HOST_RECOVERY:
    differential / diagnostic corroboration only.
    if (canonicalAvailable === false) → FALLBACK_APPLY
    else                              → SUPPRESS_DUPLICATE
```

Dedup key is semantic-edge identity, NOT timestamp:

```
sessionId
previousRecovery.state
snapshot.recovery.state
```

(episodeFailures, repairAttempts are not part of the dedup key —
canonical authority alone makes timestamps unnecessary.)

`duplicateObservationsSuppressedByOrigin` is a qualification-only
counter, exposed via `recorderCounts().observationsSuppressed`.

---

## 8. Approval authority

```text
execution-state-changed.previousExecution.awaitingApproval
  →  execution-state-changed.snapshot.execution.awaitingApproval

false → true  = approval_requested
true  → false = approval_resolved
same → same   = no TaskMsg
```

No host heuristic synthesizes these edges when canonical execution
events are present.

---

## 9. Model streaming authority

```text
previousExecution.modelStreaming=false
  →  snapshot.execution.modelStreaming=true
     = model_stream_started

true → false
     = model_stream_finished
```

This supersedes any `iteration_start == streaming` assumption. The
T8 host-pre-engaged interval (legacy streaming + canonical
running/modelStreaming=false) is NOT a defect; it is an intentional
vocabulary mismatch.

---

## 10. T8 classification: D11_HOST_PREENGAGED

NEW classification, added to the D00-D10 taxonomy:

```ts
type DivergenceClass =
    | "D00_AGREE"
    | "D01_LEGACY_FALSE_IDLE"
    | "D02_SHADOW_FALSE_ACTIVE"
    | "D03_TERMINAL_ORDERING"
    | "D04_APPROVAL_PRECEDENCE"
    | "D05_TOOL_CARDINALITY"
    | "D06_RESUME_BOUNDARY"
    | "D07_FAILURE_MAPPING"
    | "D08_FOLLOWUP_EXTERNAL"
    | "D09_EVENT_GAP"
    | "D10_UNKNOWN"
    | "D11_HOST_PREENGAGED"      // ← NEW in C2.2
```

Semantics:

```
D11_HOST_PREENGAGED =
    legacyPhase == "streaming"
    AND
    canonical runtime.status == "running"
    AND
    canonical execution.modelStreaming == false
    AND
    shadow not projecting model-streaming
```

Arbitration: `BOTH_VALID_DIFFERENT_PROJECTION` (the legacy "streaming"
means host/task engaged, the canonical "model not streaming" means
the model itself is not streaming — different questions, both valid).

Exit condition:

```
canonical execution-state-changed with modelStreaming false→true
    → shadow projects streaming
    → next comparison: D00_AGREE (or expected agreement)
```

Required:

```
T8_OLD_BEHAVIOR = RED (historical; preserved verbatim)
T8_C2_2         = D11 classification for the pre-engaged interval,
                  D02_SHADOW_FALSE_ACTIVE = 0 for the post-engaged sequence

T8_UNEXPLAINED_D02 = 0
```

---

## 11. Host task ingress

```
emitTaskRequested    → coordinator.observe(transition)
emitTaskCancelled    → coordinator.observe(transition)
emitTaskReset        → coordinator.observe(transition)
emitSameTaskContinued→ coordinator.observe(transition)
```

No more direct `comparator.observeTaskMsg(...)` from host emitters.
The wiring exposes the comparator only for read-only debug/test
access; the only production writer is the coordinator.

---

## 12. Stale session

```
incoming sessionId != active canonical session
    → no TaskState mutation
    → no record
    → optional STALE_SESSION diagnostic
```

Stale canonical events do NOT reactivate a new visible task epoch.

---

## 13. Invariant + exception isolation

```
every state-changing transition runs checkTaskInvariants() after the transition.

if (invariantViolations > 0):
    onInvariantViolation hook invoked synchronously
    counter incremented
    C2.2 HALT condition (ACT §57 H7)

classifier / arbiter / recorder throws
    → caught
    → observerError counter incremented
    → legacy/runtime authority unaffected
    → state mutation that already happened IS recorded as EVIDENCE_GAP
```

---

## 14. Privacy + boundedness

Recorder field allowlist unchanged (ELM10 / Phase 15):

```
event kind, legacy phase, shadow phase, lifecycle tags,
runtimeStatus, modelStreaming, awaitingApproval, activeToolCount,
recoveryState, classification, arbitration, seq, timestamp,
taskEpochOrOpaqueTaskKey
```

NO prose. NO tool payload. NO recovery blocked exact keys.
NO API payloads.

```
MAX_RECORDS_PER_TASK = 256 (unchanged)
bounded, drop-oldest, droppedRecords counter
```

---

## 15. Host capability matrix (C2.2 final)

```
LocalRuntimeHost:
  RUNTIME_CANONICAL = YES
  C2.2 canonical authority = ENABLED

HubRuntimeHost:
  RUNTIME_CANONICAL = NO
  fallback = HOST_RECOVERY FALLBACK_APPLY; reconstructed KEEP/DEDUP
  E7 support = NOT QUALIFIED

RemoteRuntimeHost:
  RUNTIME_CANONICAL = NO
  fallback = same as HubRuntimeHost
  E7 support = NOT QUALIFIED
```

`E7_AUTHORIZED = false` after C2.2 (gated on C2.5 real E6 dogfood).

---

## 16. Required C2.2 hard-green witnesses

```
T1   task_requested recorded              = PASS
T2   task_cancelled recorded              = PASS
T7   W12 invariants                       = PASS
T10  recovery recorded                    = PASS
T11  production guard                     = PASS
T12  exactly-one ingress                  = PASS
T8   D11 host-pre-engaged                 = PASS
T8   unexplained D02                      = 0

CANONICAL_EXECUTION_AUTHORITY            = PASS
CANONICAL_APPROVAL_AUTHORITY              = PASS
CANONICAL_RECOVERY_AUTHORITY              = PASS

DUPLICATE_EXECUTION_MUTATIONS             = 0
DUPLICATE_RECOVERY_MUTATIONS              = 0

ONE_SHADOW_INSTANCE                       = true
STALE_SESSION_MUTATIONS                    = 0

D10_UNKNOWN                                = 0

PRIVACY_ALLOWLIST                          = PASS
BOUNDED_RECORDING                          = PASS

F1_CANONICAL_TESTS                          = PASS
LEGACY_CONSERVATION                         = PASS

NEW_TS_ERRORS                                = 0
BUNDLE_BUILD                                 = PASS

PERFORMANCE                                  = PASS
```

---

## 17. What may legitimately remain RED after C2.2

```
T3 W07 cancel-before-completion ordering
T4 W08 cancel-with-tool-active ordering
T5 W11 continuation-between-runs ordering
T6 W12 workload ordering
T9 full approval workload false→true→false ordering
```

These are workload-harness concerns, not ingress-semantics
concerns. The underlying transition primitives must be present
(verified by the new focused unified-observer tests); only the
workload-runner interleaving remains for C2.3.

---

## 18. Commit decomposition (final)

```
C2.2-C1  docs(elm): freeze unified-observation authority matrix + F1 LOC correction
C2.2-C2  refactor(elm): add unified TaskShadow observation coordinator
C2.2-C3  feat(elm): route HOST_TASK ingress through unified observer
C2.2-C4  feat(elm): prefer canonical execution/recovery and suppress duplicates
C2.2-C5  feat(elm): add D11_HOST_PREENGAGED + canonical model_stream/approval edges
C2.2-C6  test(elm): qualify T8 D11 + T1/T2/T10/T12 unified-observer matrix
C2.2-C7  test(elm): benchmark + package/build conservation
C2.2-C8  docs(elm): record C2.2 evidence + C2.3 authorization verdict
```

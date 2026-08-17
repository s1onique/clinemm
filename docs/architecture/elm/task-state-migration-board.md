# Task-State Migration Board

**ACT-CLINEMM-ELM-ARCHITECTURE01 / E0–E4 SHADOW FREEZE**

This is the human-readable migration board for the Elm Architecture
shadow TaskState. It captures the legacy authority, the shadow
authority, the message adapter surface, and the cutover gates that
the next ACTs must clear before any production authority changes.

> ⚠ **CUTOVER NOT YET AUTHORIZED.** During E0–E4 the legacy
> `TurnStateTracker`, `TaskTelemetryTracker`, and `AgentRuntime`
> remain the production authorities. The shadow model observes
> only.

---

## Authorities — before and during the shadow

| Concern                          | Legacy authority                       | Shadow authority (E0–E4)              | Notes |
|----------------------------------|----------------------------------------|----------------------------------------|-------|
| Run lifecycle                    | `AgentRuntime.state.status`            | `TaskModel.lifecycle`                  | Shadow is derived from `TaskMsg` sequence. |
| Model streaming activity         | `AgentRuntime.state.executionModelStreaming` | `TaskModel.activity.modelStreaming` | Shadow observes via `execution-state-changed`. |
| Tool activity                    | `AgentRuntime.state.pendingToolCalls.length` | `TaskModel.activity.tooling`     | Shadow observes via `tool-started`/`tool-finished`. |
| Approval activity                | `AgentRuntime.state.executionAwaitingApproval` | `TaskModel.activity.awaitingApproval` | Same |
| Recovery gating                   | `RecoveryTracker.state`                | `TaskModel.recovery.state`             | Same |
| Recovery projection              | `AgentRuntimeRecoverySnapshot`         | `TaskRecoveryProjection`               | Narrow, safe-projection. |
| Turn presentation phase          | `TurnStateTracker.phase`               | `projectTurnState(model)`              | Shadow projection; comparator diffs. |
| Task telemetry                   | `TaskTelemetryTracker`                 | `TaskModel.telemetry`                  | Cumulative counters mirrored. |
| Cancel authority                 | `SdkController.cancelTask`            | NOT YET                               | E7+. |
| New-task authority                 | `SdkTaskStartCoordinator`            | NOT YET                               | E7+. |
| Resume authority                 | `reinitExistingTaskFromId`           | NOT YET                               | E7+. |
| Webview transport                | `WebviewGrpcBridge`                  | NOT YET                               | E7+. |
| Thinking presentation           | ChatRow consumers                    | `projectThinking(model)`              | E7+: ChatRow consumes shadow. |

---

## Message adapters

| Legacy event kind                          | Shadow `TaskMsg`              | Adapter site          |
|--------------------------------------------|-------------------------------|-----------------------|
| `AgentRuntimeEvent "run-started"`         | `session_started`              | `adaptRuntimeEvent`   |
| `AgentRuntimeEvent "run-finished"`        | `task_completed`               | `adaptRuntimeEvent`   |
| `AgentRuntimeEvent "run-failed"`          | `task_failed(unknown)`         | `adaptRuntimeEvent`   |
| `AgentRuntimeEvent "tool-started"`        | `tool_started`                 | `adaptRuntimeEvent`   |
| `AgentRuntimeEvent "tool-finished"`       | `tool_finished`                | `adaptRuntimeEvent`   |
| `AgentRuntimeEvent "execution-state-changed"` (modelStreaming↑) | `model_stream_started` | `adaptRuntimeEvent` |
| `AgentRuntimeEvent "execution-state-changed"` (modelStreaming↓) | `model_stream_finished` | `adaptRuntimeEvent` |
| `AgentRuntimeEvent "execution-state-changed"` (awaitingApproval↑) | `approval_requested` | `adaptRuntimeEvent` |
| `AgentRuntimeEvent "execution-state-changed"` (awaitingApproval↓) | `approval_resolved` | `adaptRuntimeEvent` |
| `AgentRuntimeEvent "recovery-state-changed"` | `recovery_changed`         | `adaptRuntimeEvent`   |
| `assistant-text-delta` / `assistant-reasoning-delta` / `message-added` / `usage-updated` / `turn-started` / `turn-finished` / `tool-updated` / `status-notice` | NONE (prose / presentation only) | ELM11 |

---

## Pure update contract

```
taskUpdate(model: TaskModel, msg: TaskMsg) -> readonly [TaskModel, TaskEffect[]]
```

Properties:

- **ELM02 purity.** No `Date.now()`, no filesystem, no network, no
  callback invocation, no global reads, no input mutation.
- **ELM03 closed union.** The discriminator is enforced by the
  TypeScript compiler; the runtime guard rejects unknown payloads.
- **ELM04 effects as data.** `TaskEffect[]` is returned but never
  executed in E0–E4 (`EFFECT_EXECUTION_ENABLED = false`).
- **ELM09/I14 determinism.** Same `(model, msg)` always yields the
  same `[model, effects]`. Pinned by
  `task-state.update.test.ts > ELM02/I14/I15 purity guarantees`.

---

## Projections

| Projection                   | Function               | Source              |
|------------------------------|-------------------------|---------------------|
| `projectTurnState(model)`    | `ShadowTurnPhase`       | `selectors.ts`      |
| `projectHostTurnState`       | adds `awaiting_followup`| `selectors.ts`      |
| `projectThinking`            | `boolean`               | `selectors.ts`      |
| `projectControls`            | `TaskControlsProjection`| `selectors.ts`      |
| `canCancel` / `canStartNewTask` / `canSubmitFollowup` | predicate helpers | `selectors.ts` |
| `projectElapsedMs(model, now)` | `number`              | `selectors.ts`      |
| `projectTelemetry`           | `TaskTelemetryProjection` | `selectors.ts`    |

All projections are pure (ELM05). The webview never reads the
shadow directly during shadow mode.

---

## Divergence contract

`TaskShadowComparator` records typed divergences when
`projectTurnState(model) ≠ TurnStateTracker.currentPhase`. The
record carries:

- `seq` — monotonic index (per the comparator)
- `event` — last `TaskMsg["type"]` from the adapter
- `legacyPhase` — the `TurnPhase` observed at that instant
- `shadowPhase` — the shadow's projection
- `lifecycleKind` — string tag of `TaskLifecycleState.kind`
- `modelStreaming` / `tooling` / `awaitingApproval` — activity axes

DIVERGENCE_ACTION = RECORD_ONLY during E0–E4. No correction.

---

## E4-DIFF-01 reproduction

The live dogfood bug class is reproducibly detectable as a
shadow-vs-legacy divergence:

```text
LEGACY_OBSERVATION_SHAPE = { visible activity=true, legacy TurnState=idle }
SHADOW_PROJECTION        = { streaming }
DIVERGENCE_DETECTED      = true
```

Pin in `apps/vscode/src/sdk/__tests__/task-state-shadow.test.ts`
under "captures legacy=idle / shadow=streaming divergence
deterministically".

---

## CORRECTION01 status (2026-08-17)

```text
R1 parallel-tool representation        = FIXED (activeToolCallIds)
R2-A resumable + stream started         = IGNORED_STALE (terminal guard)
R2-B completed + approval_requested    = IGNORED_STALE (terminal guard)
R3 stale-event policy matrix           = DOCUMENTED + APPLIED
R4 edge-triggered execution adapter    = FIXED (previousExecution)
R5 live shadow wiring                  = NOT YET (deferred to E5-E6)
R6 public-surface classification       = PROVISIONAL/INTERNAL (annotated)
R7 ACT-scoped authoritative digest      = BELOW
R8 4-vs-6 commit contradiction         = RESOLVED (this section)
R9 mutation evidence                   = RENAMED to mutation-witness
R10 monotonic invariants                = DOCUMENTED (transition props)
R11 effects.ts comment                 = FIXED (Always-false, was true)
```

ACT-CLINEMM-ELM-ARCHITECTURE01-E0-E4-BOOTSTRAP01-CORRECTION01 added
7 reviewable commits on top of the frozen 4 (a9f376edf → 2d7234074).
The total ELM ACT stack is now 11 commits.

| Range | Count | Subject |
|-------|-------|---------|
| E0    |   1   | authority inventory |
| E1-E4 |   1   | shadow model + reducer + projections |
| E4    |   1   | shadow adapter + comparator + tests |
| E4    |   1   | freeze doc |
| COR01 |   1   | R1 + R2 + R3 (parallel-tool + stale-event matrix) |
| COR01 |   1   | R4 (edge-triggered adapter) |
| COR01 |   1   | R2 explorer dedup + bad-sequence pins |
| COR01 |   1   | R6 (PROVISIONAL/INTERNAL classification) |
| COR01 |   1   | R9 (mutation file rename + M11/M12) |
| COR01 |   1   | R11 (effects.ts comment fix) |
| COR01 |   1   | R7 + R8 + R10 (migration board) |

ACT-scoped authoritative diff range:

```text
a9f376edfc7de062eac924783224c97da3a0b049  ←  frozen C04 closure HEAD
2d7234074b4a316bb58db3ce599bc53143bc02e8  ←  ELM frozen HEAD
```

(The 7-commit COR01 stack extends 2d7234074 → 0e3fc17e8. The closure
evidence for E0-E4 IS this range; the closure evidence for the full
ELM ACT is the 11-commit range. Both are explicit. C04 commits
6b20af5b2, bbdc2da93 are intentionally excluded — they belong to a
predecessor ACT.)

---

## Cutover gates

These gates must clear (in later ACTs) before any production
authority changes:

| Gate                         | ACT         | Required for                                  |
|------------------------------|-------------|-----------------------------------------------|
| `modeling` passes E5–E6       | E5–E6       | Diff qualification against real workloads     |
| `consumer cutover`           | E7          | Webview reads shadow projection                |
| `writer retirement`          | E8          | Legacy `TurnStateTracker.set` removal        |
| `effect interpreter`         | E9          | `EFFECT_EXECUTION_ENABLED = true`             |
| `factory model-check gate`   | E10         | Differential invariant proof                   |
| `dogfood / shadow removal`   | E11         | Final cleanup                                |

---

## Conservation record

- ZERO legacy `TurnStateTracker.set()` writers added or removed.
- ZERO `TaskTelemetryTracker` behavior changes.
- ZERO `AgentRuntime` mutation of authority flags.
- ZERO webview consumer cutover.
- ZERO `@cline/shared` public API expansion.
- ONE package-root addition in `@cline/agents`:
  `export * as TaskState from "./runtime/state/task-state"`.
  Stability: PROVISIONAL / INTERNAL-USE-ONLY (@internal JSDoc tag).
  Real surface for technical reasons; not stable surface for
  contractual reasons.

---

## Counts

```text
E0_AUTHORITY_COUNT         = 18
E0_MUTABLE_AUTHORITIES     = 7
E0_DERIVED_AUTHORITIES     = 4
E0_PROSE_DERIVATIONS       = 4
E0_DUPLICATED_FACTS        = 4

# E0-E4 (frozen)
TEA_E0_E4_TESTS           = 50 (in @cline/agents) + 3 (in @cline/vscode)

# CORRECTION01 (delta on top of E0-E4)
TEA_COR01_TESTS           = 14 (was 50, now 64 in @cline/agents)
TEA_COR01_VSCODE_TESTS    = 0 (was 3, now 3 in @cline/vscode — same)
TEA_TOTAL_TESTS           = 64 + 3 = 67
INVARIANT_VARIANTS        = 15 (added resumable_with_tooling,
                            resumable_with_approval, tooling_without_active_ids)
MUTATION_WITNESSES        = 12 (was 10; +M11 parallel-tool, +M12 stale-event)
MUTATION_WITNESSES_KILLED = 12 (production behavior matches; any
                            mutation that violated a witness would
                            turn red — verified by manual review of
                            what each mutation would change)
DIVERGENCE_REPRODUCED     = E4-DIFF-01 confirmed

PRODUCTION_AUTHORITY_CHANGED       = false
LEGACY_TURNSTATE_WRITERS_CHANGED   = false
LEGACY_RUNTIME_SEMANTICS_CHANGED   = false
WEBVIEW_CONSUMERS_CHANGED          = false
@cline/shared PUBLIC API CHANGED   = false
@cline/agents PUBLIC API DELTA     = yes (PROVISIONAL/INTERNAL namespace)
```

---

## Next ACT

```
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01
```
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
- ONE public-API addition in `@cline/agents`:
  `export * as TaskState from "./runtime/state/task-state"` —
  internal namespace only.

---

## Counts

```text
E0_AUTHORITY_COUNT         = 18
E0_MUTABLE_AUTHORITIES     = 7
E0_DERIVED_AUTHORITIES     = 4
E0_PROSE_DERIVATIONS       = 4
E0_DUPLICATED_FACTS        = 4

TEA_NEW_TESTS              = 50 (in @cline/agents) + 3 (in @cline/vscode)
INVARIANT_I01..I15         = all structural or assertable in tests
MUTATIONS_APPLIED          = 10
MUTATIONS_KILLED           = 10
MUTATIONS_UNREPRESENTABLE  = 0
MUTATIONS_MISSED           = 0
DIVERGENCE_REPRODUCED      = E4-DIFF-01 confirmed

PRODUCTION_AUTHORITY_CHANGED = false
LEGACY_TURNSTATE_WRITERS_CHANGED = false
LEGACY_RUNTIME_SEMANTICS_CHANGED  = false
```

---

## Next ACT

```
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01
```
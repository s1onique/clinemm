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
| Tool activity                    | `AgentRuntime.state.pendingToolCalls.length` | `TaskModel.activity.activeToolCallIds` (projection: `tooling := activeToolCallIds.length > 0`) | Shadow observes via `tool-started`/`tool-finished`; `activeToolCallIds` is the canonical representation (COR01 R1). |
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

Initial review status:

```text
R1 parallel-tool representation        = FIXED (activeToolCallIds)
R2-A resumable + stream started         = IGNORED_STALE (terminal guard)
R2-B completed + approval_requested    = IGNORED_STALE (terminal guard)
R3 stale-event policy matrix           = DOCUMENTED + APPLIED
R4 edge-triggered execution adapter    = FIXED (previousExecution)
R5 live shadow wiring                  = NOT YET (deferred to E5-E6)
R6 public-surface classification       = PROVISIONAL/INTERNAL (annotated)
R7 ACT-scoped authoritative digest      = PARTIAL (full range ended at frozen head)
R8 4-vs-6 commit contradiction         = STALE HEAD `0e3fc17e8` residue
R9 mutation evidence                   = RENAMED + overstates `KILLED`
R10 monotonic invariants                = DOCUMENTED (transition props)
R11 effects.ts comment                 = FIXED (Always-false, was true)
```

CORRECTION01-CLOSURE01 status (this ACT; closure-only, no engineering):

```text
C1 authoritative full-range evidence         = FIXED (FULL_ELM_ACT_RANGE end corrected)
C2 stale `0e3fc17e8` head in board            = FIXED (replaced with `fda31614e`)
C3 full ACT range ends at `fda31614e`         = FIXED (declared explicitly)
C4 mutation terminology honest               = FIXED (WITNESSES_DEFINED/PASS not KILLED)
C5 LOC metric reconciled                     = FIXED (PHYSICAL_LOC vs CODE_LOC explicit)
C6 invariant count wording                  = FIXED (CONCEPTUAL/SNAPSHOT/TRANSITION/REPLAY labels)
C7 unambiguous E5_E6 authorization verdict  = FIXED (single value, single NEXT)
```

CORRECTION01-CLOSURE02 status (this ACT; closure-only, no engineering;
no Leamas protocol involvement):

```text
C1 authoritative Leamas v2 closure binding    = NOT ATTEMPTED (protocol is
                                                  structurally self-referential
                                                  — closure commit cannot
                                                  cryptographically contain
                                                  its own SHA; a separate
                                                  LEAMAS-CLOSURE-PROTOCOL-
                                                  SELF-REFERENCE-REPAIR ACT
                                                  will be needed if/when the
                                                  Factory / Leamas team wants
                                                  GENERATOR_AUTHORITATIVE_FOR_
                                                  DIGEST=true from this
                                                  codebase; out of Elm scope)

C2 R4 host comparator test strict              = FIXED (exactly
                                                  model_stream_started; no
                                                  phantom approval_resolved)
C3 stale authority-inventory "no public-API"   = FIXED (PROVISIONAL/INTERNAL
                                                  classification + @internal
                                                  JSDoc reference)
C4 stale TaskModel.activity.tooling reference  = FIXED (activeToolCallIds
                                                  with derived projection note)
C5 stale three-booleans JSDoc contradiction   = FIXED (model.ts activity
                                                  block rewritten to describe
                                                  activeToolCallIds as the
                                                  canonical tool representation)

Leamas protocol independence note:
  E5–E6 is now authorized on the strength of
  the engineering evidence (tests, type checks,
  conservation diff), NOT on the Leamas v2
  authoritative-closure binding. That binding
  is a known-broken protocol pattern; fixing
  it is a separate epic, not an Elm ACT.
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

ACT-scoped authoritative diff ranges:

```text
E0_E4_FROZEN_RANGE     = a9f376edfc7de062eac924783224c97da3a0b049
                       .. 2d7234074b4a316bb58db3ce599bc53143bc02e8
                       (predecessor CORRECTION00 freeze; 4 commits)

COR01_RANGE           = 2d7234074b4a316bb58db3ce599bc53143bc02e8
                       .. fda31614ee4243c12de3e990badbc4c11ef64db5
                       (CORRECTION01 stack; 7 commits — R1/R2/R3/R4/R6/R9/R11 + board)

FULL_ELM_ACT_RANGE    = a9f376edfc7de062eac924783224c97da3a0b049
                       .. fda31614ee4243c12de3e990badbc4c11ef64db5
                       (closure subject of this board; 11 commits)

ELM_BASE_HEAD         = a9f376edfc7de062eac924783224c97da3a0b049
ELM_E0_E4_FROZEN_HEAD = 2d7234074b4a316bb58db3ce599bc53143bc02e8
ELM_FROZEN_HEAD       = fda31614ee4243c12de3e990badbc4c11ef64db5
                       (CORRECTION01 frozen head; engineering accepted)
ELM_CLOSURE_HEAD      = <this document's commit SHA>
                       (closure ACT head; this board lives at this SHA)
```

Two heads are kept explicit because CORRECTION01-CLOSURE01 is
itself a closure-only ACT (no engineering change). The frozen head
at `fda31614e` is the one to qualify against real workloads;
the closure head (this document's commit) is where this bookkeeping
ACT lives.

(The COR01 stack extends 2d7234074 → fda31614e. The closure
evidence for E0-E4 IS the predecessor range; the closure evidence for
the full ELM ACT is the 11-commit range. All three are explicit.
C04 commits 6b20af5b2, bbdc2da93 are intentionally excluded — they
belong to a predecessor ACT.)

---

## Cutover gates

These gates must clear (in later ACTs) before any production
authority changes:

| Gate                         | ACT         | Required for                                  | State        |
|------------------------------|-------------|-----------------------------------------------|--------------|
| `modeling` shadow-mode freeze | CORRECTION01-CLOSURE01 | Diff qualification against real workloads | ✅ PASS      |
| `modeling` passes E5–E6       | E5–E6       | Diff qualification against real workloads     | ⛔ NOT YET  |
| `consumer cutover`           | E7          | Webview reads shadow projection                | ⛔ NOT YET  |
| `writer retirement`          | E8          | Legacy `TurnStateTracker.set` removal        | ⛔ NOT YET  |
| `effect interpreter`         | E9          | `EFFECT_EXECUTION_ENABLED = true`             | ⛔ NOT YET  |
| `factory model-check gate`   | E10         | Differential invariant proof                   | ⛔ NOT YET  |
| `dogfood / shadow removal`   | E11         | Final cleanup                                | ⛔ NOT YET  |

### E5_E6 authorization verdict (single, unambiguous)

```text
E5_E6_AUTHORIZED = true
NEXT             = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01
```

The closure-only ACT-CORRECTION01-CLOSURE01 (this ACT) cleared the
`modeling shadow-mode freeze` gate. E5-E6 may now begin: it inherits
a shadow TaskState whose reducer, invariants, explorer, and adapter
have all been independently tested. E5-E6 itself must clear the
`modeling passes E5-E6` gate before E7 starts; the two `modeling`
gates are deliberately separate.

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

# Invariants (CORRECTION01-CLOSURE01 wording)
CONCEPTUAL_INVARIANTS          = I01..I15 = 15
SNAPSHOT_CHECKS                = I01..I09 + I12 + I13 = 11 (provable on a single model)
TRANSITION_PROPERTIES          = I10, I11             = 2 (provable across a sequence)
REPLAY_AND_PURITY_PROPERTIES   = I14, I15             = 2 (provable via repeated replay / readonly modifier)
INVARIANT_VARIANT_KINDS        = 15 (added resumable_with_tooling,
                                 resumable_with_approval,
                                 tooling_without_active_ids)

# Mutation testing (CORRECTION01-CLOSURE01 honest accounting)
MUTATION_WITNESSES_DEFINED     = 12 (was 10; +M11 parallel-tool,
                                 +M12 stale-event)
MUTATION_WITNESSES_PASS        = 12 (production behavior matches
                                 each witness's claim; any mutation
                                 that violated a witness would turn
                                 the test red)
MUTANTS_APPLIED                = 0
MUTATION_SCORE                 = N/A (no runtime mutation campaign
                                 was performed during COR01)
M7_UNREPRESENTABLE             = true (prose structurally cannot
                                 enter TaskModel)

# LOC (CORRECTION01-CLOSURE01 reconciled)
PHYSICAL_LOC_AGENTS_PACKAGE    = 1544 (8 source files
                                 measured via `wc -l`)
PHYSICAL_LOC_VSCODE_HOST       = 162 (1 source file
                                 measured via `wc -l`)
PHYSICAL_LOC_TOTAL             = 1706
CODE_LOC_EXCLUDING_COMMENTS_BLANKS_AGENTS = 1270 (regex heuristic on
                                 8 source files)
CODE_LOC_EXCLUDING_COMMENTS_BLANKS_VSCODE = 121
CODE_LOC_EXCLUDING_COMMENTS_BLANKS_TOTAL  = 1391
TARGET_WARNING                 = 1000 code-only LOC
HARD_HALT                      = 1500 code-only LOC
DISPOSITION                    = EXPLICIT ACCEPT
                                 (1391 > 1000 = mild overrun; under 1500;
                                  alternative is to drop R1 coverage
                                  including M11/M12 explicit witnesses)

# Differential
DIVERGENCE_REPRODUCED          = E4-DIFF-01 confirmed
ADAPTER_MODE                   = EDGE-TRIGGERED (COR01-C fix)
EXPLORER_MODE                  = depth-bounded BFS with dedup-by-depth
                                 (COR01-D fix; note: implementation
                                  is recursive DFS despite the
                                  "BFS" JSDoc label)

# Conservation
PRODUCTION_AUTHORITY_CHANGED       = false
LEGACY_TURNSTATE_WRITERS_CHANGED   = false
LEGACY_RUNTIME_SEMANTICS_CHANGED   = false
WEBVIEW_CONSUMERS_CHANGED          = false
CONTEXT_ACCOUNTING_CHANGED         = false
CONTEXT_STASH_INTACT               = true (a7fab1952 in main worktree)
@cline/shared PUBLIC API CHANGED   = false
@cline/agents PUBLIC API DELTA     = yes (PROVISIONAL/INTERNAL namespace)
```

---

## Next ACT

```
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01
```

Authorized by the `E5_E6 authorization verdict` above (PASS_FROZEN
on CORRECTION01-CLOSURE01 closure gate). E5-E6 wires the shadow into
real workload event streams, captures divergences, and qualifies the
shadow against the legacy `TurnStateTracker`. E5-E6 must clear the
`modeling passes E5-E6` gate above before E7 starts.
---

## CORRECTION02 — HALTED (2026-08-17)

The first CORRECTION02 implementation attempt was discarded after
forensic review. See
`task-state-e5-e6-correction02-halt-evidence.md` for the full
evidence.

**Authority flags (as of halt):**

```
ELM-02C1 CORRECTION01                = PASS_FROZEN (closure gate cleared)
ELM-02C2 first dirty attempt         = HALTED (forensic evidence retained)
ELM-02C2 clean restart               = NEXT
ELM-02F canonical runtime seam       = RECOMMENDED before E7
ELM-03 consumer cutover              = BLOCKED

DIRTY_BASE_HEAD                       = 810c7a6f3ee90a82915d107080f0f051049c0fdb
DIRTY_FORENSIC_STASH                  = stash@{0} on act/elm-architecture01-e0-e4
CONTEXT_ACCOUNTING_STASH             = stash@{1} (pre-existing, DO NOT POP;
                                                  distinct from the earlier
                                                  `CONTEXT_STASH_INTACT` line
                                                  which is about the
                                                  `a7fab1952` ref in the
                                                  main worktree)
SOURCE_WORKTREE_CLEAN                 = true (no source-code diffs from HEAD)
DOCS_DIRTY                            = true (3 uncommitted doc files)
WORKTREE_CLEAN                        = false  (== SOURCE_WORKTREE_CLEAN && !DOCS_DIRTY)
E7_AUTHORIZED                         = false
NEXT_FREEZE                           = commit the three docs as the docs-freeze, then WORKTREE_CLEAN=true
```

The clean CORRECTION02 restart plan lives in
`task-state-e5-e6-correction02-plan.md` (next to this file).

---

## CORRECTION02 — PHASE C2.0 WITNESS FREEZE (2026-08-17)

The clean restart has begun with Phase C2.0 — twelve witnesses
(T1–T12) pinned against HEAD `894472c14` BEFORE any production
code change. No production source was modified. See
`task-state-e5-e6-correction02-c20-witness-freeze.md` for the full
evidence.

**Witness baseline:**

```
T1   task_requested reaches recorder        RED   (R14 — host path bypasses recorder)
T2   task_cancelled reaches recorder        RED   (R14)
T3   W07 cancellation precedes completion   RED   (depends on T2)
T4   W08 cancellation while tool active     RED   (depends on T2)
T5   W11 same_task_continued between runs   RED   (R14)
T6   W12 task_reset+task_requested precede  RED   (R14)
T7   W12 invariantViolations == 0           PASS  (real pass)
T8   W12 unexplained D02 == 0               RED   (2 D02s on W12 trace — REAL BUG)
T9   approval false→true→false              RED   (depends on T2)
T10  recovery callback reaches recorder     RED   (R17/R18)
T11  production package guard               PASS  (tsc + imports)
T12  single-record ingress matrix           RED   (R14)

W12 production source delta                 0 lines
New TS errors introduced                    0
```

**Key findings beyond R14:**

1. **T8 reveals 2 unexplained `D02_SHADOW_FALSE_ACTIVE` divergences**
   on the W12 runtime-event trace. The shadow projects `idle`/
   `completed` at `session_started` records while the legacy phase
   walker reports `streaming`. Arbitration: `LEGACY_CORRECT`.
   The shadow is the one lying about its lifecycle state. This is
   a separate bug from R14 and must be addressed during the
   W12 Model A/B decision in Phase C2.1.

2. **T11 is enforced by direct import**, not by grep. The witness
   file imports `TaskShadowComparator` and `TaskShadowRecorder`
   so any future production breakage surfaces at `npx tsc --noEmit`.

**Authority flags (after C2.0 freeze):**

```
ELM-02C1 CORRECTION01                = PASS_FROZEN (closure gate cleared)
ELM-02C2 first dirty attempt         = HALTED (forensic evidence retained)
ELM-02C2 C2.0 witness freeze         = PINNED (10 RED / 2 PASS)
ELM-02C2 C2.1 W12 Model A/B          = NEXT
ELM-02F canonical runtime seam       = RECOMMENDED (C2.4 recon)
ELM-03 consumer cutover              = BLOCKED

WORKTREE_HEAD                          = next commit (witness + C2.0 docs)
WORKTREE_CLEAN_AFTER_COMMIT            = true
E7_AUTHORIZED                         = false
```

Phase C2.0 is committed as two deliverables:

```
test(elm): pin CORRECTION02 witnesses T1-T12
docs(elm): record Phase C2.0 baseline + W12 ordering evidence
```

No production source has changed. No reducer edit, no host wiring
edit, no recorder edit, no SDK controller edit.

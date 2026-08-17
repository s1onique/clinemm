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

---

## CORRECTION02 — PHASE C2.1 SEMANTIC RECON (2026-08-17)

Read-only architectural recon. No production source modified.

See `task-state-e5-e6-correction02-c21-recon.md` for the full
trace.

**Decisions frozen:**

```
W12_MODEL                              = A
REJECT_MODEL_B_REASON                  = setTurnPhase("streaming") runs
                                          INSIDE taskStart.initTask,
                                          BEFORE emitTaskRequested
W12_CONTRACT_DOCUMENTED                = true

T8_ROOT_CAUSE                          = CASE_2
T8_INDEPENDENT_OF_W12_EPOCH            = true
T8_FIX_DEPENDS_ON                      = ELM-02F or classifier extension
```

**Key insight:** T8's `session_started → D02_SHADOW_FALSE_ACTIVE`
is not caused by `task_reset`/`task_requested(B)` epoch semantics.
It happens on the FIRST `iteration_start` of run #1, before any
epoch boundary exists. The defect is in how
`execution-state-changed` (the canonical "I'm now streaming"
signal) is discarded by the runtime-event-adapter, so the shadow
never receives the `model_stream_started` TaskMsg that would
flip its projection to `streaming`.

**Active board after C2.1:**

```
ELM-02C2 / C2.0 witness freeze            ✅ PASS
ELM-02C2 / C2.1 architecture decision     ✅ FROZEN
    W12_MODEL_A                           ✅
    T8_SESSION_START_SEMANTICS            🔴 CASE_2
ELM-02F canonical runtime seam             🟡 decision pending
ELM-02C2 / C2.2 implementation            ⛔ blocked on ELM-02F decision
ELM-02C2 / C2.3 stateful W01-W16          ⛔
ELM-02C2 / C2.4 real production/build     ⛔
ELM-02C2 / C2.5 real E6 dogfood           ⛔
ELM-03 E7 consumer cutover                 ⛔ BLOCKED
```

The next decision is on ELM-02F: restore the canonical seam,
extend the classifier, or defer T8. That decision is a separate
ACT and is the gate to C2.2 implementation.

---

## ELM-02F — PHASE F0 RECON/WITNESS FREEZE (2026-08-17)

Read-only recon + witnesses. No production source modified.

Two commits on top of C2.1:

```
817c63cf5  docs(elm): freeze ELM-02F runtime ownership + subscription recon
49e966f7d  test(elm): pin raw-vs-legacy runtime event seam witnesses
```

Six witnesses pinned in
`sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.e2f-f0-witnesses.test.ts`:

```
F0-T1  AgentRuntime.subscribe receives execution-state-changed
F0-T2  subscribe/unsubscribe contract on AgentRuntime
F0-T3  RuntimeEventAdapter returns [] for execution-state-changed
F0-T4  RuntimeEventAdapter returns [] for recovery-state-changed
F0-T5  legacy event counts for text-only run are stable
```

All 6 pass at HEAD `49e966f7d` with zero production change.

**Recon document:** `task-state-e2f-runtime-seam-recon.md` — freezes the
six anchor sites required by ACT section 5 (RUNTIME_OWNER,
RAW_EVENT_SUBSCRIPTION_SITE, LEGACY_TRANSLATION_SITE,
LEGACY_FANOUT_SITE, SESSION_TEARDOWN_SITE, VS_CODE_SHADOW_SUBSCRIBER_SITE).

**Key architectural finding:** AgentRuntime.emit
(`agent-runtime.ts:3365`) already fans out to a Set of listeners with
per-listener exception isolation (RSMT01 CORRECTION03 / C1.5 P1).
Therefore the runtime side of F1 requires **no AgentRuntime edits** —
only a fanout API exposed on SessionRuntime.

**Integrity incident detected, mitigated, recorded:** the
ACT-ELM-02C2 forensic-preservation stash was found missing from the
stash list at F0 start. The underlying commit was still in git
objects and was recovered via `git stash store` under its original
label. No production code modified. Documented in recon doc §10.

**Active board after F0:**

```
ELM-02C2 / C2.0 witness freeze                 ✅
ELM-02C2 / C2.1 semantic recon                 ✅

ELM-02F canonical runtime-event seam           🟢 F0 RECON COMPLETE
    F0 RECON DOC                               ✅ 817c63cf5
    F0-T1..T5 WITNESSES                        ✅ 49e966f7d
    F1 SEAM IMPLEMENTATION                     ⏭️ NEXT (after F0 acceptance)

ELM-02C2 / C2.2 unified observation            ⛔ blocked on ELM-02F F1
ELM-02C2 / C2.3 stateful W01-W16               ⛔
ELM-02C2 / C2.4 production qualification      ⛔
ELM-02C2 / C2.5 real E6 dogfood                ⛔

ELM-03 E7 consumer cutover                     ⛔ BLOCKED
```

Both protected stashes restored and intact:

```
stash@{0} = ACT-ELM-02C2 forensic (RECOVERED, intact)
stash@{1} = ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (untouched)
```

---

## ELM-02F — PHASE F0-CORRECTION01 (2026-08-17)

Witness-only strengthening on top of F0 freeze. No production source modified.

One commit:

```
fbd7f2f29  test(elm): strengthen ELM-02F canonical/legacy F0 witnesses
```

Three reviewer-required corrections:

```
1. F0-T2 RECOVERY CANONICAL
   Before: only proved that the recovery-state-changed type
           narrowing compiles against AgentRuntimeEvent.
   After:  actually observes recovery-state-changed through
           AgentRuntime.subscribe() using the C1.5 deterministic
           ENOENT-throwing fs_read tool harness. Asserts:
             previousState  = "idle"
             payloadState   = "recovering"
             episodeFailures = 1
           Gate: F0_T2_RECOVERY_EVENT_OBSERVED >= 1  → PASS

2. F0-T5 LEGACY EXACT SEQUENCE
   Before: legacyEvents.toContain(...)
   After:  legacyEvents.toEqual([...exact 5-event array...])
           + separate F0_T5_LEGACY_EXACT_COUNT asserting length = 5
           + separate F0_T5_CANONICAL_NO_DUPLICATION asserting
             exactly one execution-state-changed for the text-only fixture
           Baselines frozen:
             LEGACY_EVENT_COUNT_BASELINE = 5
             LEGACY_EVENT_SEQUENCE_BASELINE = [
               "iteration_start", "content_start", "content_end",
               "iteration_end", "done",
             ]
             CANONICAL_EXECUTION_STATE_CHANGED_COUNT_BASELINE = 1
             CANONICAL_RECOVERY_STATE_CHANGED_COUNT_BASELINE  = 0

3. H14 — promoted from NOT_REQUIRED to TRIGGERED → RECOVERED_AND_MITIGATED
   Recon §7 row now reflects the actual disposition (forensic
   preservation stash dropped between C2.1 freeze and ELM-02F
   start; recovered via git stash store from dropped commit
   141372c52; see recon §10).
   Recon §10.1 adds STASH_IDENTITY_TABLE tracking each protected
   stash by OBJECT_ID + MESSAGE + INDEX + CONTENTS + STATE so
   future drops are detectable.
```

Total F0-CORRECTION01 witnesses: 10/10 pass.
Typecheck: 0 new errors (2 pre-existing unchanged).

**Active board after F0-CORRECTION01:**

```
ELM-02F
    F0 architecture recon                   ✅ PASS
    F0-CORRECTION01 witness freeze          ✅ PASS (this commit)
    F0 RECON DOC (with H14 fix + baselines) ✅ fbd7f2f29 + 817c63cf5
    F1 canonical seam                       🟢 AUTO-AUTHORIZED
                                             (no additional review stop)

ELM-02C2 / C2.2 unified observation            ⛔ blocked on ELM-02F F1
ELM-02C2 / C2.3 stateful W01-W16               ⛔
ELM-02C2 / C2.4 production qualification      ⛔
ELM-02C2 / C2.5 real E6 dogfood                ⛔

ELM-03 E7 consumer cutover                     ⛔ BLOCKED
```

Both protected stashes intact:

```
stash@{0} = ACT-ELM-02C2 forensic (RECOVERED, intact)
           OBJECT_ID = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85
stash@{1} = ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (untouched)
```

---

## ELM-02F — PHASE F1 (2026-08-17)

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1**

The canonical `AgentRuntimeEvent` seam is now wired end-to-end
through core/host layers into the VS Code shadow boundary.

```
VERDICT                       = PASS_CANONICAL_RUNTIME_SEAM_F1
CANONICAL_RUNTIME_SEAM_PRESENT = true
C2_2_IMPLEMENTATION_AUTHORIZED = true
E7_AUTHORIZED                  = false
```

Six production + test commits on `act/elm-architecture01-e0-e4`:

```
0042f2845  docs(elm): freeze ELM-02F F1 implementation contract
9e4c653a1  feat(core): expose canonical AgentRuntimeEvent session subscription
0c7362f03  test(core): prove canonical fanout and legacy conservation
1ea52f379  feat(vscode): bridge canonical runtime events to TaskState shadow
d5c89b032  test(vscode): qualify canonical execution/recovery delivery
80d7e6463  test(elm): qualify dual-stream ordering, disposal, filtering, performance
```

### API surface delta

```
@cline/agents:  0  (AgentRuntime unchanged)
@cline/shared:  0  (no public type change)
@cline/core:    1  (ClineCore.subscribeRuntimeEvents added; PROVISIONAL)
```

### New canonical seam

```
AgentRuntime.subscribe (unchanged)
   ↓ existing SessionRuntime subscription
SessionRuntime.subscribeRuntimeEvents  ← NEW, mirror of recovery side-channel
   ↓ per-listener try/catch; zero buffering; exact-once
RuntimeHost.subscribeRuntimeEvents?    ← NEW, optional
   ↓ walks active sessions, wraps (event) -> (sessionId, event)
LocalRuntimeHost.subscribeRuntimeEvents ← NEW
   ↓ proxy through host
ClineCore.subscribeRuntimeEvents       ← NEW, public API delta
   ↓ proxy through ClineCore
VscodeSessionHost.subscribeRuntimeEvents ← NEW
   ↓ bridge to shadow comparator
SdkController.attachCanonicalRuntimeEventSubscription ← NEW, idempotent
```

### Performance

```
F1-P1  10_000 events × 1 subscriber = 7.6ms   (0.76 us/event)
F1-P2   5_000 events × 4 subscribers = 1.5ms  (0.08 us/event-per-listener)
                                                       (13M events/sec aggregate)
```

Well below the F1 budget of 50us/event p50.

### Conservation

```
LEGACY_EVENT_COUNT_BASELINE = 5  (unchanged after F1)
LEGACY_EVENT_SEQUENCE       = [iteration_start, content_start, content_end,
                                iteration_end, done]  (unchanged after F1)
RUNTIME_EVENT_ADAPTER       = unchanged
F0_WITNESSES                = 10 / 10 pass
EXECUTION_STATE_CHANGED_LEGACY = 0  (still dropped from legacy)
RECOVERY_STATE_CHANGED_LEGACY  = 0  (still dropped from legacy)
```

### Protected stashes

```
FORENSIC_ELM02C2:
  OBJECT_ID = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85
  STATE     = INTACT, UNTOUCHED throughout F1
CONTEXT_ACCOUNTING:
  OBJECT_ID = 371752f71e5b9a385af32736e007540386d48b82
  STATE     = INTACT, UNTOUCHED throughout F1
```

### Net production LOC

```
+228 lines added across 7 production files
SOFT_TARGET <= 500    PASS (228 << 500)
HARD_HALT    > 800    far below
```

### Test totals (final)

```
@cline/core runtime/:        512 tests passing
  F0 witnesses:               10
  F1 core session-runtime:     9
  F1 core local-runtime-host:  3
  F1 core bench/dual-stream:   4
@cline/vscode src/sdk/__tests__/:
  shadow tests:              36
  F1 proxy tests:             2
```

### Active board after F1

```
ELM-02F
    F0 recon                        ✅ PASS
    F0 witness correction           ✅ PASS
    F1 plan freeze                  ✅ 0042f2845
    F1 core canonical seam          ✅ 9e4c653a1
    F1 core tests                   ✅ 0c7362f03
    F1 vscode bridge                ✅ 1ea52f379
    F1 vscode tests                 ✅ d5c89b032
    F1 bench/dual-stream            ✅ 80d7e6463
    F1 evidence + verdict           ✅ THIS COMMIT
    F1 VERDICT                      ✅ PASS_CANONICAL_RUNTIME_SEAM_F1

ELM-02C2 C2.2 unified observation   🟢 NEXT  (now authorized)
ELM-02C2 C2.3 W01-W16               ⛔
ELM-02C2 C2.4 production qualification ⛔
ELM-02C2 C2.5 real E6 dogfood        ⛔

ELM-03 E7 consumer cutover           ⛔ BLOCKED (gated on C2.2..C2.5)
```

---

## ELM-02F — PHASE F1-CORRECTION01 (2026-08-17)

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION01**

The initial F1 evidence claimed PASS but the F1 review identified
six gaps in the host and VS Code qualification. This correction closes
every one:

```
F1_VERDICT                            = PASS_CANONICAL_RUNTIME_SEAM_F1
ELM_02F_F1                            = PASS

C2_2_IMPLEMENTATION_AUTHORIZED        = true
E7_AUTHORIZED                         = false
```

### Three commits

```
ab8cf2f66  fix(vscode): extract canonical-event proxy and add typed origin marker
f8c2beaf3  test(vscode,core): real LocalRuntimeHost + wiring boundary + exact F0 legacy
a84b1f183  test(vscode): SdkController re-subscription lifecycle at the VS Code boundary
```

### Six review concerns closed

```
2  LocalRuntimeHost was a manual mirror    -> real LocalRuntimeHost instance (4 tests)
3  future-session lifecycle unproven       -> F1-LC-1: pre-session subscribe is a no-op
4  VS Code proxy was synthetic             -> extracted subscribeRuntimeEventsThroughProxy()
5  F1-V1 fidelity was tautological          -> F1-V1-C2/C3 use literal event references
6  recovery at VS Code boundary not proven  -> F1-V1-C3 + F1-W3 both pass
7  RUNTIME_CANONICAL not encoded            -> TaskShadowRuntimeOrigin + typed envelope
```

### Test deltas

```
@cline/core (was 512):     +4 = 516 passed
@cline/vscode (was 36):   +15 = 51 passed
Typecheck baselines:       unchanged (core=2, vscode=18)
```

### Production deltas (CORRECTION01)

```
apps/vscode/src/sdk/runtime-events-proxy.ts                 NEW +41
apps/vscode/src/sdk/vscode-session-host.ts                  +5 /-3
apps/vscode/src/sdk/task-state-shadow-host-wiring.ts       +57/-14
apps/vscode/src/sdk/SdkController.ts                       +6 /-1
NET production LOC CORRECTION01: +85 /-8
```

### Active board after F1-CORRECTION01

```
ELM-02F F0                                        ✅
ELM-02F F0-CORRECTION01                           ✅
ELM-02F F1 plan freeze                            ✅ 0042f2845
ELM-02F F1 core canonical seam                    ✅ 9e4c653a1
ELM-02F F1 core tests                             ✅ 0c7362f03
ELM-02F F1 vscode bridge                          ✅ 1ea52f379
ELM-02F F1 vscode tests (initial)                 ✅ d5c89b032
ELM-02F F1 bench/dual-stream                      ✅ 80d7e6463
ELM-02F F1 evidence (initial, superseded)         ✅ 5abc9b62d
ELM-02F F1-CORRECTION01 proxy + origin            ✅ ab8cf2f66
ELM-02F F1-CORRECTION01 host + wiring tests      ✅ f8c2beaf3
ELM-02F F1-CORRECTION01 lifecycle test            ✅ a84b1f183
ELM-02F F1-CORRECTION01 evidence (final)          ✅ THIS COMMIT

ELM-02F F1 VERDICT                                ✅ PASS_CANONICAL_RUNTIME_SEAM_F1

ELM-02C2 C2.2 unified observation                 🟢 NEXT  (now authorized)
ELM-02C2 C2.3 W01-W16                             ⛔
ELM-02C2 C2.4 production qualification            ⛔
ELM-02C2 C2.5 real E6 dogfood                     ⛔

ELM-03 E7 consumer cutover                        ⛔ BLOCKED (gated on C2.2..C2.5)


---

## ELM-02F — PHASE F1-CORRECTION02 (2026-08-17)

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION02**

The F1-CORRECTION01 review identified one remaining blocker: the
lifecycle test mirrored the controller body locally instead of
invoking the production code. F1-CORRECTION02 closes that gap by
extracting the listener-filter logic into a single exported helper
that both the SdkController and the qualification test invoke.

```
F1_VERDICT                            = PASS_CANONICAL_RUNTIME_SEAM_F1
ELM_02F_F1                            = PASS

PRODUCTION_REATTACH_AFTER_SESSION_START = PASS
PRODUCTION_REATTACH_AFTER_REINIT        = PASS
OLD_SUBSCRIPTION_DISPOSED               = PASS

C2_2_IMPLEMENTATION_AUTHORIZED        = true
E7_AUTHORIZED                         = false
```

### Two commits

```
(produced in this correction)
```

### Three review concerns closed

```
1  lifecycle test mirrored SdkController body
   -> extracted subscribeCanonicalRuntimeEventsToShadow() as
      the single production helper; controller delegates; test
      invokes the same function

2  POINT_IN_TIME contract not frozen
   -> documented as a typed freeze in
      apps/vscode/src/sdk/canonical-event-subscription.ts

3  F1-H4-C1 description claimed pre-session behavior the
   test does not exercise
   -> corrected: F1-H4-C1 is the post-session point-in-time
      path; the pre-session no-op pattern lives in F1-LC-1
```

### Test deltas

```
@cline/vscode F1-CORRECTION02:
  sdk-controller-production-lifecycle  6 passed
  (replaces 3-test mirror from F1-CORRECTION01)

Total F1+CORRECTION01+CORRECTION02 vscode tests:  54 passed
Typecheck baseline:                                unchanged (vscode=18)
```

### Production deltas (CORRECTION02)

```
apps/vscode/src/sdk/canonical-event-subscription.ts    NEW +80
apps/vscode/src/sdk/SdkController.ts                  +5  /-13

NET production LOC CORRECTION02: +85 /-13
```

### Caller invariant (now frozen as a typed contract)

```
LOCAL_RUNTIME_SUBSCRIPTION_MODEL = POINT_IN_TIME

REQUIRED CALLER INVARIANT:
after every startSession / reinit / setActiveSession,
the caller MUST refresh the canonical subscription via
subscribeCanonicalRuntimeEventsToShadow(host, wiring, sessionId).
```

The SdkController enforces this invariant via
`attachCanonicalRuntimeEventSubscription`, which is called from:
- `initTask` (new task)
- `reinitExistingTaskFromId` (resume existing task)
- The `startNewSession` resolution callback (post-session attach)

### Active board after F1-CORRECTION02

```
ELM-02F F0                                        ✅
ELM-02F F0-CORRECTION01                           ✅
ELM-02F F1 plan freeze                            ✅ 0042f2845
ELM-02F F1 core canonical seam                    ✅ 9e4c653a1
ELM-02F F1 core tests                             ✅ 0c7362f03
ELM-02F F1 vscode bridge                          ✅ 1ea52f379
ELM-02F F1 vscode tests (initial)                 ✅ d5c89b032
ELM-02F F1 bench/dual-stream                      ✅ 80d7e6463
ELM-02F F1 evidence (initial, superseded)         ✅ 5abc9b62d
ELM-02F F1-CORRECTION01 proxy + origin            ✅ ab8cf2f66
ELM-02F F1-CORRECTION01 host + wiring tests      ✅ f8c2beaf3
ELM-02F F1-CORRECTION01 lifecycle test (mirror)   ✅ a84b1f183  (superseded)
ELM-02F F1-CORRECTION01 evidence                  ✅ f3fc47e08
ELM-02F F1-CORRECTION02 production helper         ✅ THIS CORRECTION
ELM-02F F1-CORRECTION02 production-path test      ✅ THIS CORRECTION

ELM-02F F1 VERDICT                                ✅ PASS_CANONICAL_RUNTIME_SEAM_F1

ELM-02C2 C2.2 unified observation                 🟢 NEXT  (authorized)
ELM-02C2 C2.3 W01-W16                             ⛔
ELM-02C2 C2.4 production qualification            ⛔
ELM-02C2 C2.5 real E6 dogfood                     ⛔

ELM-03 E7 consumer cutover                        ⛔ BLOCKED (gated on C2.2..C2.5)
```

### Commit accounting (clean)

```
F1_PLAN_FREEZE          = 1   (0042f2845)
F1_AFTER_FREEZE         = 6   (9e4c65...5abc9b)
F1_CORRECTION01         = 4   (ab8cf2f66..f3fc47e08)
F1_CORRECTION02         = 3   (eeeb34e..9fba7678b)
F1_CORRECTION03         = 3   (f2f2270..THIS CORRECTION)
TOTAL_E2F_F1_STACK      = 17
```

---

## ELM-02F — PHASE F1-CORRECTION03 (2026-08-17)

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03**

The F1-CORRECTION02 review identified that the helper still did not
own the unsubscribe state, and F1-LC-4 actually demonstrated two
subscriptions alive rather than one. F1-CORRECTION03 closes both
gaps by extracting the production owner
`CanonicalRuntimeShadowSubscription`.

```
F1_VERDICT                            = PASS_CANONICAL_RUNTIME_SEAM_F1
ELM_02F_F1                            = PASS

SDKCONTROLLER_REATTACH_OWNERSHIP       = PASS
OLD_SUBSCRIPTION_DISPOSED_ON_REINIT    = PASS

C2_2_IMPLEMENTATION_AUTHORIZED        = true
E7_AUTHORIZED                         = false
```

### Three commits

```
f2f2270ec  refactor(vscode): extract CanonicalRuntimeShadowSubscription owner
           test(vscode): production-path owner lifecycle test (8 witnesses)
           docs(elm): record ELM-02F F1-CORRECTION03 evidence
```

### Four review concerns closed

```
1  F1-LC-4 demonstrated two subscriptions alive (local mirror)
   -> replaced with F1-LC-3, F1-LC-4, F1-LC-8, F1-LC-9 against
      the production owner

2  Subscription owner was implicit in the controller
   -> extracted CanonicalRuntimeShadowSubscription
   -> SdkController replaces taskStateRuntimeEventsUnsub with
      taskStateRuntimeEventsSubscription

3  Pre-session modeling mismatched the real LocalRuntimeHost
   -> new fixture exposes subscribeRuntimeEvents from the start;
      sessions are added via api.addSession() and existing
      subscriptions do NOT see newly added sessions

4  Stale commit accounting (2/13 in CORR02 evidence)
   -> corrected to 3 commits per correction; 17 total
```

### Test deltas

```
@cline/vscode F1-CORRECTION03:
  sdk-controller-production-lifecycle  8 passed (was 6 in CORR02)
  (replaces 6-test F1-CORRECTION02 test)

Total F1+CORRECTION01+CORRECTION02+CORRECTION03 vscode tests:  56 passed
Typecheck baseline:                                                unchanged (vscode=18)
```

### Production deltas (CORRECTION03)

```
apps/vscode/src/sdk/canonical-event-subscription.ts    +108 /-2   (add owner class)
apps/vscode/src/sdk/SdkController.ts                   +8 /-13   (delegate to owner)

NET production LOC CORRECTION03: +116 / -15
```

### Owner invariant (now frozen as a typed contract)

```
LOCAL_RUNTIME_SUBSCRIPTION_MODEL = POINT_IN_TIME

REQUIRED CALLER INVARIANT:
after every startSession / reinit / setActiveSession,
the caller MUST refresh the canonical subscription by calling
CanonicalRuntimeShadowSubscription.attach(host, wiring, sessionId).
The owner disposes the previous subscription and attaches a new one
in the same call.

CONTROLLER LIFECYCLE INVARIANT:
the controller instantiates ONE owner and delegates all
attach/dispose operations to it. The controller never stores a raw
unsubscribe callback.
```

### Active board after F1-CORRECTION03

```
ELM-02F F0                                        ✅
ELM-02F F0-CORRECTION01                           ✅
ELM-02F F1 plan freeze                            ✅ 0042f2845
ELM-02F F1 core canonical seam                    ✅ 9e4c653a1
ELM-02F F1 core tests                             ✅ 0c7362f03
ELM-02F F1 vscode bridge                          ✅ 1ea52f379
ELM-02F F1 vscode tests (initial)                 ✅ d5c89b032
ELM-02F F1 bench/dual-stream                      ✅ 80d7e6463
ELM-02F F1 evidence (initial, superseded)         ✅ 5abc9b62d
ELM-02F F1-CORRECTION01 proxy + origin            ✅ ab8cf2f66
ELM-02F F1-CORRECTION01 host + wiring tests      ✅ f8c2beaf3
ELM-02F F1-CORRECTION01 lifecycle test (mirror)   ✅ a84b1f183  (superseded)
ELM-02F F1-CORRECTION01 evidence                  ✅ f3fc47e08
ELM-02F F1-CORRECTION02 helper                    ✅ eeeb34ea5
ELM-02F F1-CORRECTION02 production-path test     ✅ b5fb5e41c  (superseded)
ELM-02F F1-CORRECTION02 evidence                  ✅ 9fba7678b
ELM-02F F1-CORRECTION03 owner                     ✅ f2f2270ec
ELM-02F F1-CORRECTION03 owner-path test           ✅ THIS CORRECTION
ELM-02F F1-CORRECTION03 evidence                  ✅ THIS CORRECTION

ELM-02F F1 VERDICT                                ✅ PASS_CANONICAL_RUNTIME_SEAM_F1

ELM-02C2 C2.2 unified observation                 🟢 NEXT (authorized)
ELM-02C2 C2.3 W01-W16                             ⛔
ELM-02C2 C2.4 production qualification            ⛔
ELM-02C2 C2.5 real E6 dogfood                     ⛔

ELM-03 E7 consumer cutover                        ⛔ BLOCKED (gated on C2.2..C2.5)
```

### Commit accounting (clean — corrected)

```
F1_PLAN_FREEZE          = 1   (0042f2845)
F1_AFTER_FREEZE         = 6   (9e4c653a1..5abc9b62d)
F1_CORRECTION01         = 4   (ab8cf2f66..f3fc47e08)
F1_CORRECTION02         = 3   (eeeb34ea5..9fba7678b)
F1_CORRECTION03         = 3   (f2f2270ec..THIS COMMIT)

TOTAL_E2F_F1_STACK      = 17
```

ELM-02F is now genuinely closed at F1.

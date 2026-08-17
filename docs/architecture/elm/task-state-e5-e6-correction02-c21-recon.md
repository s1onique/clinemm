# Task-State Shadow — E5-E6 CORRECTION02 — Phase C2.1 Recon

**ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02**

**Phase:** C2.1 — semantic recon before any production edit.

**Status:** W12_MODEL = A FROZEN. T8_ROOT_CAUSE = CASE_2
(host legacy phase is intentionally broader than canonical streaming
flag). PRODUCTION_EDIT_NEXT = NOT YET.

---

## 1. Why C2.1 starts with recon, not implementation

The C2.0 verdict review identified that T8's failure is independent
of W12's epoch semantics. The four-record probe from C2.0 showed:

```
run #1:
  session_started -> D02_SHADOW_FALSE_ACTIVE   (legacy=streaming, shadow=idle)
  task_completed  -> D00_AGREE

run #2:
  session_started -> D02_SHADOW_FALSE_ACTIVE   (legacy=streaming, shadow=idle)
  task_completed  -> D00_AGREE
```

Run #1's `session_started → D02` happens BEFORE any
`task_reset`/`task_requested(B)` epoch boundary exists. So the bug
is in how `iteration_start` is interpreted, not in how
`task_requested` works. Conflating the two would design the wrong
unified observation API.

---

## 2. C2.1-A — Freeze W12 Model A from real production ordering

**Observation sites (read-only inspection of HEAD `f45439249`):**

```
apps/vscode/src/sdk/SdkController.ts:1519
    const sessionId = await this.taskStart.initTask(...)

apps/vscode/src/sdk/SdkController.ts:1545-1549
    if (this.taskStateShadowWiring) {
        this.taskStateShadowWiring.resetForNewTask()
        emitTaskRequested({...}, sessionId)
    }
```

```
apps/vscode/src/sdk/sdk-task-start-coordinator.ts:187
    this.options.setTurnPhase("streaming")
```

The `setTurnPhase("streaming")` is asserted by
`SdkTaskStartCoordinator.initTask` at line 187 (and again at line 265
for the `reinitExistingTask` path). It runs INSIDE
`taskStart.initTask(...)`, BEFORE that call returns. So by the time
`SdkController.initTask` reaches `emitTaskRequested(sessionId)`,
the legacy phase is already `streaming`.

**Implication:**

```
setTurnPhase("streaming")      <-- legacy phase is now "streaming"
    (taskStart.initTask returns)
emitTaskRequested(sessionId)   <-- shadow receives task_requested
```

The shadow cannot honestly model `task_requested` as
`idle-with-identity` (Model B) because the host's authoritative
phase is already `streaming` at that point. Model A is forced by
production ordering.

**Decision:**

```
W12_MODEL                       = A
REJECT_MODEL_B_REASON           = task_requested cannot honestly mean
                                  idle-before-execution at its actual
                                  production emission point; execution
                                  initialization has already crossed
                                  the legacy active boundary
W12_CONTRACT_DOCUMENTED         = true
```

**Consequence — the intended W12 sequence:**

```
task A complete
   ↓
task_reset
   → shadow lifecycle: idle / identity cleared
   ↓
taskStart.initTask(B)
   → setTurnPhase("streaming")          (legacy already engaged)
   ↓
emitTaskRequested(B)
   → shadow running / identity.taskId = B
   ↓
runtime session_started
   → associates run/session identity with task B
```

This is a coherent contract. The shadow's `identity.taskId = B`
is the **host-owned visible task identity**, and the runtime's
session identity is bound to it but not equivalent.

---

## 3. C2.1-B — Trace `iteration_start` through every translation layer

### 3.1 The chain

```
Step A: canonical runtime emits AgentRuntimeEvent "turn-started"
Step B: RuntimeEventAdapter.translate() produces AgentEvent
            "iteration_start"
Step C: CoreSessionEvent {type: "agent_event", payload: {event: iteration_start}}
            fires through the host's onSessionEvent hook
Step D: TaskShadowReverseTranslator.translate() produces AgentRuntimeEvent
            "run-started" (synthesised from iteration_start)
Step E: adaptRuntimeEvent() maps "run-started" -> TaskMsg "session_started"
Step F: Shadow reducer observes "session_started"
            → projects idle / identity.taskId unchanged
```

### 3.2 What canonical facts travel with each event

**`turn-started` (Step A) carries `snapshot: this.snapshot()`**.
From `apps/.../sdk/packages/agents/src/agent-runtime.ts:1268`:

```typescript
await this.emit({
    type: "turn-started",
    snapshot: this.snapshot(),
    iteration: this.state.iteration,
});
```

From `apps/.../sdk/packages/agents/src/agent-runtime.ts:1260-1268`:

```typescript
this.state.iteration += 1;
await this.emit({
    type: "turn-started",
    snapshot: this.snapshot(),
    iteration: this.state.iteration,
});

const { message, finishReason } =
    await this.generateAssistantMessageWithOverflowRecovery();
```

The `turn-started` event is emitted BEFORE
`generateAssistantMessageWithOverflowRecovery()` is called. So at the
moment of emission:

- `state.executionModelStreaming` has NOT yet been raised to `true`
- The model stream call has not yet started
- `snapshot.execution.modelStreaming = false`
- `snapshot.execution.awaitingApproval = false`
- `snapshot.status` is `"running"` (the run is engaged) or
  whatever the prior state was

The `executionModelStreaming = true` raise happens INSIDE the
`model.stream(...)` loop at `agent-runtime.ts:1673`:

```typescript
this.state.executionModelStreaming = true;
await this.emitExecutionStateChangeIfChanged(streamBefore);
```

This fires AFTER `turn-started` and BEFORE the first chunk of text.

### 3.3 What the adapter does with the canonical truth

`apps/.../sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts:281`:

```typescript
case "execution-state-changed":
    // RSMT01: no legacy AgentEvent translation.
    //
    // Like `recovery-state-changed`, the execution transition
    // is a runtime-state observation. Translating it to prose
    // would invite consumers to re-derive state by parsing it
    // — the very anti-pattern this projection is designed to
    // prevent.
    return [];
```

`runtime-event-adapter.ts:185`:

```typescript
case "run-started":
    return [];
```

Both events are explicitly discarded by the adapter.

### 3.4 What this means for the shadow

The shadow's adapter `adaptRuntimeEvent()` at
`apps/.../sdk/packages/agents/src/runtime/state/task-state/shadow-adapter.ts:98`
has FULL logic for `execution-state-changed` →
`model_stream_started`/`model_stream_finished`/`approval_requested`/
`approval_resolved`, with edge-triggering via `previousExecution`
(pinned by R4 of CORRECTION01).

But **this logic is never exercised in production** because:

1. The runtime emits `execution-state-changed`
2. The host's `runtime-event-adapter` discards it (`return []`)
3. The host's `CoreSessionEvent` stream never sees it
4. The shadow's `TaskShadowReverseTranslator` only sees
   `CoreSessionEvent`s, never raw `AgentRuntimeEvent`s
5. Therefore `adaptRuntimeEvent`'s `case "execution-state-changed"`
   never runs

The shadow receives `session_started` (from the synthesised
`run-started`) but never `model_stream_started`. So the shadow
correctly projects `idle` (no streaming flag set yet) while the
host's legacy phase says `streaming` (controller already engaged
the task).

**This is the gap that ELM-02F is recommended to close.**

---

## 4. C2.1-C — Re-arbitrate T8 against the real canonical fact

The C2.0 witness used `emptyArbiterSnapshot()` which sets
`status: "idle"` and `execution.modelStreaming: false`. With that
arbiter:

- `legacy = streaming` (host authority)
- `shadow = idle` (shadow projection from `session_started` only)
- `arbiter.execution.modelStreaming = false`
- `arbiter.status = "idle"`

D02 arbitration at `apps/.../apps/vscode/src/sdk/task-state-shadow-recorder.ts:410`:

```typescript
if (classification === "D02_SHADOW_FALSE_ACTIVE") return "LEGACY_CORRECT"
```

Always `LEGACY_CORRECT` regardless of arbiter. But that
arbitration is meaningless when the arbiter is wrong.

**Now — the real canonical fact at `iteration_start`:**

The legacy phase `streaming` was set by `setTurnPhase("streaming")`
inside `taskStart.initTask`. So at the moment the shadow observes
`session_started`:

```
canonical snapshot.status       = "running"        (set by controller)
canonical snapshot.execution.modelStreaming = false  (raised later)
canonical snapshot.execution.awaitingApproval = false
canonical snapshot.execution.tooling = false
legacy phase                    = "streaming"
shadow projection               = "idle"
```

**This matches Case 2 from the verdict's C2.1-C analysis:**

```text
canonical modelStreaming=false
legacy=streaming
shadow=idle
→ D02 classification/arbitration is wrong
```

The legacy phase is INTENTIONALLY broader than the canonical
streaming flag. The host's "streaming" phase means "the controller
is engaged with this task", not "the LLM is currently emitting
tokens". The canonical `modelStreaming` flag means exactly the
latter.

D02 is the wrong classification for this divergence. The real
classification should be: **"legacy engaged earlier than canonical
streaming flag; this is by design"**. Until the recorder's
classifier vocabulary is extended (or the canonical seam is
restored via ELM-02F), T8 will continue to fire on every
`iteration_start`.

**Three ways to resolve T8 going forward (none implemented here):**

1. **Restore ELM-02F.** Re-emit `execution-state-changed` as a
   `CoreSessionEvent` variant OR have the host wiring subscribe to
   the raw `AgentRuntimeEvent` stream directly. Then
   `model_stream_started` arrives BEFORE the legacy phase settles
   and the shadow's projection matches.
2. **Broaden D02 to differentiate "host-pre-engaged" from "shadow
   behind canonical".** Add a D-class (or annotation) that means
   "legacy phase is intentionally ahead of canonical execution
   flag; host authority is correct". This requires the arbiter to
   know the difference between `status=running` and
   `modelStreaming=true`.
3. **Defer T8 to ELM-02F + leave it RED.** Document T8 as
   "expected to remain RED until the canonical seam restoration
   lands" and exempt it from the E7 gate.

Option 1 is the recommended path; option 2 is a faster band-aid;
option 3 is what C2.0 effectively does. The choice belongs to the
ACT that owns the canonical-seam restoration.

---

## 5. What C2.1 freezes

```
W12_MODEL                       = A
W12_CONTRACT_DOCUMENTED         = true (this document)

T8_ROOT_CAUSE                   = CASE_2
T8_INDEPENDENT_OF_W12_EPOCH     = true
T8_FIX_DEPENDS_ON               = ELM-02F or classifier extension
T8_REMAINING_RED_UNTIL          = ELM-02F lands (or classifier fix)

UNIFIED_OBSERVATION_API         = NOT_YET_DESIGNED
PRODUCTION_EDIT_NEXT            = NOT_YET

NEXT                            = C2.1 semantic recon closes; C2.2
                                  implementation begins only after
                                  ELM-02F decision is recorded in
                                  the active board.
```

---

## 6. Conservation boundary check

| Boundary                              | Status |
|---------------------------------------|--------|
| LEGACY_AUTHORITY                      | 100% (unchanged) |
| SHADOW_AUTHORITY                      | 0% (unchanged) |
| DIVERGENCE_ACTION                     | RECORD_ONLY (unchanged) |
| WEBVIEW_CUTOVER                       | false (unchanged) |
| EFFECT_EXECUTION_ENABLED              | false (unchanged) |
| Protected stash                       | both intact (untouched) |
| Production source LOC delta           | 0 (no edits this phase) |
| New TS errors                         | 0 |
| SDK controller parse                  | unchanged |

No production code was modified by C2.1. This commit is a single
docs file (`task-state-e5-e6-correction02-c21-recon.md`) that
records the architectural recon and freezes W12_MODEL=A.

---

## 7. Active board after C2.1

```
ELM-02C2 / C2.0 witness freeze            ✅ PASS
ELM-02C2 / C2.1 architecture decision     ✅ FROZEN
    W12_MODEL_A                           ✅ evidence supports A
    T8_SESSION_START_SEMANTICS            🔴 CASE_2 — depends on ELM-02F

ELM-02F canonical runtime seam             🟡 decision pending
ELM-02C2 / C2.2 implementation            ⛔ blocked on ELM-02F decision
ELM-02C2 / C2.3 stateful W01-W16          ⛔
ELM-02C2 / C2.4 real production/build     ⛔
ELM-02C2 / C2.5 real E6 dogfood           ⛔

ELM-03 E7 consumer cutover                 ⛔ BLOCKED
```

The next move is a decision on ELM-02F: do we restore the canonical
seam (recommended), extend the classifier to label the
host-pre-engaged case, or defer T8 to E7-time resolution? The
answer is a separate ACT.

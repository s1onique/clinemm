# ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01 — Evidence

## Mission

Reproduce, classify, and repair the LIVE contradiction where TaskHeader
simultaneously shows `Idle · 00:00` while the agent is actively executing
for the same visible task.

The two prior TaskHeader ACTs settled the **selector architecture**
(`TASKHEADER-CANONICAL-PROJECTION-MIGRATION01`, CLOSED) and the **timer
semantic domain** (`TASKHEADER-OWNER-AWARE-TIMING01`, CLOSED_NOT_REPRODUCED).
This ACT targets the *boundary* between them — the publication moment when
both dimensions must be co-pinned to the same logical task identity.

## Primary invariant

```
For a task that has been actively running for ≥1 second:
  taskHeaderPresentation.phase ≠ "idle"
  AND
  taskTelemetry.startedAt is defined AND belongs to the current task
```

Both conditions must hold simultaneously. The original ACT §53 review
questions 1–18 were addressed by the RED/GREEN/ABLATION cycle below.

## Reproduction chronology

The test `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.test.ts`
drives the EXACT production chronology of `SdkController.initTask`:

1. **Phase 1** — prior task A is running:
   - `legacyPhase = "streaming"`, `activeSession = session-A`
   - `taskTelemetry.startTask("session-A", aStartedAt)`
   - `attachCanonicalSubscription()` registers listener for A
   - runtime emits `run-started` (modelStreaming=true) for A
2. **Phase 2** — user clicks "New Task" → controller `clearTask()`:
   - `legacyPhase = "idle"`, `activeSession = undefined`
   - `emitTaskReset` seeds shadow with `task_reset` (HOST_TASK origin)
   - `taskTelemetry.currentTaskId` remains `"session-A"` (no `clear()` call
     exists; only `cancelTask` calls `endTask`)
3. **Phase 3** — user submits prompt → controller `initTask(B)`:
   - `activeSession = session-B`, `legacyPhase = "streaming"` (via
     `setTurnPhase("streaming")` inside the coordinator)
   - `taskTelemetry.startTask("session-B", bStartedAt)`
   - `attachCanonicalSubscription()` re-attaches for B
   - `taskStateShadowWiring.resetForNewTask()` clears shadow
   - `emitTaskRequested({...}, "session-B")` seeds shadow with B identity
4. **Phase 4** — runtime emits canonical events for B:
   - `run-started` (modelStreaming=true)
   - `execution-state-changed` (modelStreaming: false→true)
5. **Phase 5** — publication after ≥1 second of wall-clock:
   - mirror the production publication block: read legacy phase, read
     shadow's current phase via `wiring.getLastObservedShadowPhase()`,
     project through `selectTaskHeaderPresentation`, read telemetry
     via `taskTelemetry.get()`, format via `formatElapsed` /
     `resolveElapsedDisplayMs` / `taskHeaderPresentationStateLabel`.

## Root cause (CASE D — PROJECTION_PUBLICATION_MISSING)

The defect is **not** in the canonical shadow's reducer (the comparator
correctly transitioned from `idle` → `streaming` when
`model_stream_started` was applied). It is **not** in
`selectTaskHeaderPresentation` (the three-source precedence
contract is frozen and correct). It is **not** in
`TaskTelemetryTracker` (the timer is correctly bound to the current
task with a valid `startedAt`).

The defect lives in `TaskShadowHostWiring.getLastObservedShadowPhase`:

```ts
// BEFORE (HEAD, RED on LAC01):
getLastObservedShadowPhase: () => recorder.getRecords().at(-1)?.shadowPhase,
```

The differential record's `shadowPhase` field is set by
`TaskShadowRecorder.record`:

```ts
shadowPhase: input.divergence?.shadowPhase ?? "idle",
```

For `D00_AGREE` records (where shadow and legacy agree), `divergence` is
`undefined` and the record's `shadowPhase` falls back to `"idle"`. The
public differential record's privacy allowlist omits the divergence
payload — only `legacyPhase`, `shadowPhase`, and other divergence fields
are persisted when a divergence exists. For `D00_AGREE` cases, the
record looks like:

```json
{
  "origin": "RUNTIME_CANONICAL",
  "shadowPhase": "idle",         ← HARDCODED FALLBACK
  "legacyPhase": "streaming",
  "runtimeStatus": "running"
}
```

So the wire's `taskHeaderPresentation` was published as
`phase: "idle", source: "shadow"` even though the comparator's
`TaskModel` had `activity.modelStreaming = true` (which
`@cline/agents` `projectTurnState` projects as `streaming`).

This is the exact LIVE symptom: shadow says "idle" → selector picks
shadow (it is defined) → wire says "idle" → webview shows "Idle".

The legacy `TurnStateTracker` correctly says `streaming` — but the
canonical shadow overrides it because the selector's frozen policy is
`shadow > legacy`.

## Forensic snapshot (RED on HEAD, before repair)

```json
{
  "turnPhase": "streaming",          ← legacy says streaming (correct)
  "taskHeaderPhase": "idle",         ← shadow says idle (WRONG)
  "taskHeaderSource": "shadow",      ← canonical shadow path
  "taskTelemetryStartedAt": 1700000010000,  ← timer bound to B (correct)
  "taskTelemetryTaskId": "session-B",       ← identity correct
  "stateLabel": "Idle",              ← webview shows "Idle" (WRONG)
  "elapsedText": "00:05",            ← timer ticking (correct)
  "now": 1700000015000
}
```

## Repair

Added `TaskShadowComparator.getCurrentShadowPhase()` (read-only, no
mutation) that mirrors `@cline/agents` `projectTurnState` (selectors.ts
line 47-71) on the public `TaskModel` surface:

```ts
getCurrentShadowPhase(): TurnPhase {
  const model = this.shadow.debugSnapshot()
  if (model.activity.awaitingApproval) return "awaiting_approval"
  if (model.activity.modelStreaming || model.activity.activeToolCallIds.length > 0) return "streaming"
  switch (model.lifecycle.kind) {
    case "completed": return "completed"
    case "failed": return "error"
    case "resumable":
    case "cancelled": return "resumable"
    case "running": return "idle"  // running with no activity ⇒ idle
    case "idle":
    default: return "idle"
  }
}
```

Wired `getLastObservedShadowPhase` to delegate to it:

```ts
// AFTER (FIXED, GREEN on LAC01):
getLastObservedShadowPhase: () => comparator.getCurrentShadowPhase(),
```

## GREEN snapshot (after repair)

```json
{
  "turnPhase": "streaming",
  "taskHeaderPhase": "streaming",     ← FIXED
  "taskHeaderSource": "shadow",
  "taskTelemetryStartedAt": 1700000010000,
  "taskTelemetryTaskId": "session-B",
  "stateLabel": "Working",             ← FIXED
  "elapsedText": "00:05",
  "now": 1700000015000
}
```

## Necessity / ablation

Replacing the repaired line with the original
`recorder.getRecords().at(-1)?.shadowPhase` returns LAC01 to RED. The
defect is therefore **load-bearing** and the repair is **necessary**
(not a no-op).

## Conservation

| Surface                    | Result           |
| -------------------------- | ---------------- |
| apps/vscode vitest          | 1801 / 1801 PASS |
| THCP01 selector (18)        | 18 / 18 PASS     |
| THCP11 publication (6)      | 6 / 6 PASS       |
| host-wiring (5)             | 5 / 5 PASS       |
| e7.1 thinking (6)           | 6 / 6 PASS       |
| webview TaskHeader (72)     | 72 / 72 PASS     |
| typecheck                   | 0 diagnostics    |
| lint                        | PASS             |
| `git diff --check`          | PASS             |

## Closed contracts — preserved

- **TaskHeader state label**: still consumes canonical projection via
  `taskHeaderPresentationStateLabel`. No visual change.
- **Three-source precedence** (`selectTaskHeaderPresentation`): frozen
  at `host-compacting > shadow > legacy absence`. Unchanged.
- **Task wall-clock age** (`taskTelemetry.startedAt`): unchanged.
  Terminal freeze (`error`/`resumable`/`completed`) unchanged.
- **THCP01/THCP11 tests**: green.
- **No new wire field**: `taskHeaderPresentation` shape unchanged
  (`phase: TurnPhase`, `source: "host"|"shadow"|"legacy"`, `seq: number`).

## Files changed

- `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` — repair
- `apps/vscode/src/sdk/task-state-shadow.ts` — added
  `getCurrentShadowPhase` to the comparator
- `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.test.ts`
  — new RED+GREEN test
- `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.helpers.ts`
  — node-side mirror of the webview's `taskHeaderTelemetryHelpers`
  (production source of truth: `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts`)
- `.factory/epic-board.md` — EPIC + ACT row + priority list entry

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

## Repair (CORRECTION01 — canonical delegation)

The initial fix added `TaskShadowComparator.getCurrentShadowPhase()`,
which **mirrored** the `@cline/agents` `projectTurnState` switch inside
the host. CORRECTION01 eliminated that duplicate authority and
delegated directly to the canonical seam:

```ts
// `task-state-shadow-host-wiring.ts` (CORRECTION01 — current)
getLastObservedShadowPhase: (): TurnPhase | undefined => {
  const model = comparator.debugSnapshot()
  const canonical = TaskState.projectTurnState(model)
  return toLegacyPhase(canonical)
},
```

The canonical seam is `TaskState.projectTurnState` from
`@cline/agents` (re-exported via `sdk/packages/agents/src/runtime/state/index.ts`
→ `task-state/index.ts:50-62`; defined at
`sdk/packages/agents/src/runtime/state/task-state/selectors.ts:47-71`).
The host already imports `TaskState` (`task-state-shadow.ts:21`); no
new package-surface was added.

The only host-side addition is `toLegacyPhase`, which maps the
shadow's `ShadowTurnPhase` (subset of `TurnPhase`) into the legacy
`TurnPhase` union. The shadow and legacy taxonomies are deliberately
identical on the overlap (`task-state-shadow.ts:34-40`); the legacy
union adds ONE host-only phase — `"compacting"` — owned by the
compaction coordinator and never produced by the shadow.

## Anti-drift contract (added in CORRECTION01)

The host wiring's `getLastObservedShadowPhase` MUST equal the
canonical `@cline/agents` `projectTurnState` projection applied
directly to the comparator's `TaskModel`. Any drift is a
duplicate-authority regression. This is asserted in LAC01 (LIVE
invariant C):

```ts
// `task-header-live-activity-coherence.lac01.test.ts:486-500`
const shadowPhaseFromWiring = h.wiring.getLastObservedShadowPhase()
const canonicalModel = h.wiring.comparator.debugSnapshot()
const canonicalProjection = TaskState.projectTurnState(canonicalModel)
expect.soft(shadowPhaseFromWiring).toBe(canonicalProjection)
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

## Necessity / ablation (both passes)

- **Pre-CORRECTION01 ablation**: replacing the repaired line with the
  original `recorder.getRecords().at(-1)?.shadowPhase` returns LAC01
  to RED with the original defect.
- **CORRECTION01 ablation**: injecting `return "idle"` in
  `getLastObservedShadowPhase` returns LAC01 to RED via the new
  anti-drift contract:
  ```
  AssertionError: host wiring shadow phase must equal canonical agents
  projectTurnState projection (anti-drift): expected 'idle' to be
  'streaming'
  ```

The defect is therefore **load-bearing** and the repair is **necessary**
(not a no-op).

## Classification (honest reclassification per CORRECTION01)

- **STATE_LIVE_DEFECT**: PROVEN (LIVE `Idle` for running task)
- **STATE_PRODUCTION_RED**: PROVEN (LAC01 RED on HEAD pre-fix)
- **STATE_REPAIR_NECESSITY**: PROVEN (LAC01 RED on ablation, GREEN
  after canonical delegation)
- **TIMER_LIVE_DEFECT**: OBSERVED (LIVE witness reported `00:00`)
- **TIMER_PRODUCTION_RED**: NOT_REPRODUCED (production RED at the
  same wall-clock shows `00:05`; the timer was never wrong in the
  executable reproduction)
- **LIVE_TIMER_CAUSE**: UNRESOLVED. The `00:00` the user saw may
  belong to a different code path (timer reset on `clearTask` /
  `initTask` chronology, telemetry never started, stale `startedAt`
  from a prior task, etc.) — NOT in scope of this ACT. Tracked as
  `LIVE_TIMER_PENDING` for a separate investigation.

## Verdict

- **PASS_TASKHEADER_LIVE_STATE_COHERENCE** (state-side closed)
- **LIVE_TIMER_PENDING** (timer LIVE observation unchanged;
  production reproduction disproves the bug for this code path; the
  actual LIVE cause is unresolved and out of scope)

## Conservation

| Surface                    | Result           |
| -------------------------- | ---------------- |
| apps/vscode vitest          | 1801 / 1801 PASS |
| THCP01 selector (18)        | 18 / 18 PASS     |
| THCP11 publication (6)      | 6 / 6 PASS       |
| host-wiring (5)             | 5 / 5 PASS       |
| e7.1 thinking (6)           | 6 / 6 PASS       |
| task-state-shadow.test      | GREEN            |
| targeted shadow surface (11 files) | 173 / 173 PASS |
| webview TaskHeader (72, vitest) | 72 / 72 PASS |
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
- **No duplicate phase projector**: the host consumes
  `TaskState.projectTurnState` (canonical) rather than mirroring it
  locally.

## Files changed (CORRECTION01 delta on top of initial fix)

- `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` — accessor
  now delegates to `TaskState.projectTurnState` + `toLegacyPhase`
- `apps/vscode/src/sdk/task-state-shadow.ts` —
  - **REMOVED** `TaskShadowComparator.getCurrentShadowPhase()`
    (CORRECTION01 deletes the duplicate-authority mirror)
  - **EXPORTED** `toLegacyPhase` (so the wiring can use the
    shadow→legacy bridge without re-implementing it)
- `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.test.ts`
  — added LIVE invariant C (anti-drift contract assertion)
- `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.helpers.ts`
  — node-side mirror of the webview's `taskHeaderTelemetryHelpers`
  (production source of truth: `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts`)
- `.factory/epic-board.md` — EPIC + ACT row + priority list entry

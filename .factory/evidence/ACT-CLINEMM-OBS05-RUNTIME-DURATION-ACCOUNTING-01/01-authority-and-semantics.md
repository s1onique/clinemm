# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 — 01 Authority and Semantics

> W0 entry: `ENTRY_HEAD = 3701158a1ceadf7705b84df5455ae57d9e443f7f` (branch `main`, clean tree).
> `PREDECESSOR = ACT-CLINEMM-RECOVERY-LIVE-FORENSICS-01` — **no such ACT file exists** in
> `.factory/acts/` and no `OBS-05` row exists in `.factory/epic-board.md`. The nearest
> predecessor evidence is the historical-recovery/observability family recorded in
> `.factory/epics/product-config-branding.md` L498-500 (`REC-01`, `REC-02`, `OBS-01..05` preserved
> as `NEEDS_CLASSIFICATION` rows) and `.factory/epics/task-presentation.md` L39/L55/L283, which
> names `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` as `CLOSED_NOT_REPRODUCED` with the
> explicit re-open trigger:
>
> > "Re-open requires new live evidence that distinguishes agent-active elapsed from wall-clock
> > elapsed and the user demands the distinction."
>
> This ACT supplies exactly that live evidence + the distinction. **The predecessor's
> lifecycle-seam reconnaissance is therefore unavailable; this ACT performed the bounded source
> inspection itself (W1) and did not repeat any other reconnaissance.**
>
> Predecessor note that IS load-bearing and directly reusable:
> `.factory/epics/task-presentation.md` L283 — "**Likely telemetry:** agent-active elapsed, wall
> elapsed if useful, tool calls, recovery count, canonical state." The wall-elapsed half already
> exists (see below); the agent-active half does not.

## 0. The observational gap, stated against existing production code

The existing task-header elapsed display is **wall-clock only**. Production proof:

* `apps/vscode/src/sdk/task-telemetry-tracker.ts` L227-228 — the tracker's entire time model is
  `private startedAt: number | undefined` / `private endedAt: number | undefined`. There is no
  second counter of any kind.
* `apps/vscode/src/sdk/task-telemetry-tracker.ts` L406-419 (`observeTurnPhase`) — the tracker
  consumes the authoritative `TurnPhase` transition stream, but uses it ONLY to freeze
  (`endedAt`) or reopen (`endedAt = undefined`) the wall clock. It performs **no classification**
  of the interval it closes.
* `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts`
  `resolveElapsedDisplayMs(startedAt, endedAt, now)` — the webview projects
  `endedAt - startedAt` or `now - startedAt`. Single scalar. No active/waiting split.

## 1. W1 — Authority map (every row references actual production source)

| Lifecycle event | Production source | Identity | Observable | Accounting category |
|---|---|---|---|---|
| Task identity / epoch bound | `apps/vscode/src/sdk/task-telemetry-tracker.ts` L226 `currentTaskId`; `SdkController.ts` L4684 / L4896 `this.taskTelemetry.startTask(...)` | `currentTaskId` (visible-task identity) | `startTask(taskId, startedAt?)` — full reset on a **different** id, no-op on the same id | epoch boundary |
| Runtime lifecycle owner (phase authority) | `apps/vscode/src/sdk/turn-state-tracker.ts` — `TurnStateTracker.setWithWriter` L122-186; `phase` L24; `seq` L26; `subscribe` L207 | `TurnPhase` + monotonic `seq` (stale rejection authority) | `subscribe(listener)` fires on EVERY committed phase write, synchronously, after the snapshot mutation | **THE authoritative accounting owner** |
| Transition → tracker wiring (production seam) | `apps/vscode/src/sdk/SdkController.ts` L4730-4732 — `this.taskTelemetryPhaseUnsub = this.turnStateTracker.subscribe((phase, anchorTs) => { ... this.taskTelemetry.observeTurnPhase(phase, anchorTs) })` | — | — | production seam under test |
| Provider request / response lifecycle | `TurnPhase = "streaming"` (models producing content / tool running) — `ExtensionMessage.ts` L751 | `TurnPhase` | phase write | **ACTIVE** |
| Tool execution (required for progression) | `TurnPhase = "streaming"` (tool running) — `ExtensionMessage.ts` L751; tool-start events at `SdkController.ts` L2239 | `TurnPhase` | phase write | **ACTIVE** |
| Required background-job lifecycle | `TurnPhase = "streaming"` while the job is required; detached jobs do not hold the phase | `TurnPhase` | phase write | **ACTIVE** while required; not counted once detached |
| Human tool approval suspension | `TurnPhase = "awaiting_approval"` — `ExtensionMessage.ts` L752 | `TurnPhase` | phase write | **WAITING** (`TOOL_APPROVAL`) |
| Answer to a follow-up question | `TurnPhase = "awaiting_followup"` — `ExtensionMessage.ts` L753 | `TurnPhase` | phase write | **WAITING** (`USER_INPUT`) |
| Explicit human-controlled pause | `TurnPhase = "resumable"` — `ExtensionMessage.ts` L765 (task cancelled / interrupted; Resume Task) | `TurnPhase` | phase write | **WAITING** (`USER_PAUSE`) |
| Automatic compaction / PCK / R2 | `TurnPhase = "compacting"` — `ExtensionMessage.ts` L762 (an internal SYSTEM TRANSITION owns the next progress step) | `TurnPhase` | phase write | **ACTIVE** (no user action is actionable while it runs) |
| Automatic retry / recovery | `TurnPhase = "streaming"` throughout; `error` → retry re-enters `streaming` | `TurnPhase` | phase write | **ACTIVE** (retry backoff is inside the `streaming` interval) |
| Terminal-state publication | `TurnPhase ∈ {completed, error, resumable}` — `ExtensionMessage.ts` L763-765; `TERMINAL_PHASES` at `task-telemetry-tracker.ts` L122 | `TurnPhase` | phase write | **FROZEN** (terminal freeze) |
| Explicit continuation after terminal | `CONTINUATION_PHASES = {streaming, awaiting_approval}` — `task-telemetry-tracker.ts` L133; `observeTurnPhase` clears `endedAt` | `TurnPhase` | phase write | reopens the interval; prior epoch totals preserved |
| Task persistence and restoration | `apps/vscode/src/shared/ExtensionMessage.ts` L840-844 — "`startedAt` … **Persisted in the `HistoryItem.ts` slot** so a remount or webview reconnect resumes the same elapsed timeline" | `HistoryItem` slot | `taskTelemetry.startedAt` restore path | persistence authority |
| Existing webview state transport | `apps/vscode/src/sdk/SdkController.ts` L7768 — `taskTelemetry: this.taskTelemetry.get(),` inside `getStateToPostToWebview()`; wire type `ExtensionState.taskTelemetry?: TaskHeaderTelemetryStrip` (`ExtensionMessage.ts` L1000+) | `ExtensionState.taskTelemetry` | canonical state payload | publication path |

### 1.1 W1 exit condition — ONE authoritative accounting owner exists

`TurnStateTracker` is the **single** runtime-lifecycle owner. It publishes every committed phase
transition synchronously to subscribers (`turn-state-tracker.ts` L177-185), it stamps a
monotonic `seq` that is the existing stale-rejection authority (`turn-state-tracker.ts` L130),
and it carries the closed `TurnPhase` union that already names every runtime condition the ACT's
semantic table needs (`ExtensionMessage.ts` L749-765).

`TaskTelemetryTracker` is the **existing** host-side accumulator adjacent to that owner, already
wired to it in production (`SdkController.ts` L4730-4732), already published on the canonical
state payload (`SdkController.ts` L7768), and already consumed by the task header
(`TaskHeaderTelemetry.tsx` L370).

**Decision: extend `TaskTelemetryTracker` — do NOT create a second lifecycle state machine.**
`observeTurnPhase` already receives exactly the authoritative transitions required. The ACT's
production delta is: give `observeTurnPhase` a *classification* obligation in addition to its
existing freeze/reopen obligation, and accumulate the classified intervals.

### 1.2 Required distinctions — all observable

| ACT requirement | Observable from the authority? | Source |
|---|---|---|
| ACTIVE vs WAITING | YES | `TurnPhase` closed union (`ExtensionMessage.ts` L749-765) |
| Waiting reason | YES (phase-derived) | `awaiting_approval` → `TOOL_APPROVAL`; `awaiting_followup` → `USER_INPUT`; `resumable` → `USER_PAUSE` |
| UNKNOWN | YES (as the residual of a discontinuity) | the tracker's own continuity check — see §3.3 |
| FROZEN | YES | `TERMINAL_PHASES` (`task-telemetry-tracker.ts` L122) |
| Task identity / epoch | YES | `currentTaskId` (`task-telemetry-tracker.ts` L226) |
| Durable transition evidence for recovery | YES | `HistoryItem` persistence slot already used by `startedAt` (`ExtensionMessage.ts` L840-844) |


## 2. W2 — Frozen accounting semantics

### 2.1 Category mapping (the semantic contract, mapped to actual runtime states)

| Runtime condition (ACT contract) | Category | Authoritative `TurnPhase` |
|---|---|---|
| Provider request, prefill, inference or streaming | ACTIVE | `streaming` |
| Tool execution required for task progression | ACTIVE | `streaming` |
| Waiting for required command completion | ACTIVE | `streaming` |
| Automatic retry and retry backoff | ACTIVE | `streaming` (retry re-enters `streaming`) |
| Automatic compaction, PCK or R2 processing | ACTIVE | `compacting` |
| Runtime orchestration or automatic recovery | ACTIVE | `streaming` |
| Human tool approval required | WAITING | `awaiting_approval` |
| Awaiting answer to a follow-up question | WAITING | `awaiting_followup` |
| Explicit human-controlled pause | WAITING | `resumable` |
| Recovery requiring human intervention | WAITING | `error` (the task is parked awaiting a human Retry) and `resumable` |
| Unobservable interval or discontinuous clock | UNKNOWN | continuity check (§3.3) |
| Terminal task | FROZEN | `completed` (the only truly finished terminal state) |

### 2.1.1 CORRECTION-01 — the `error` phase is WAITING, not FROZEN

The first implementation classified `error` as terminal (FROZEN). The executable witness
(`T05b`) exposed the defect: the interval the task spends in the `error` phase was dropped
from EVERY bucket, so elapsed time vanished and the conservation identity was satisfied only
because the vanished time was simply not counted.

That is wrong on the ACT's own terms: `error` is a terminal WRITE that parks the task awaiting
a human Retry — automatic progression is blocked by a human decision, which is exactly WAITING.
The corrected mapping is:

* `error`    -> **WAITING**, reason `RECOVERY_INTERVENTION` (a human must Retry / Resume).
* `completed`-> **FROZEN** (the only genuinely finished terminal state).
* `resumable`-> **WAITING**, reason `USER_PAUSE` (a human must Resume).

Note on `resumable` / `error`: they appear in BOTH the WAITING and the terminal rows. They are
**WAITING** as a *held* state (the task is parked until a human acts) and **terminal** as a
*write* (the write itself closes the interval). The distinction is: the interval that ENDS at
the write is classified by the phase that was live BEFORE it (it was executing / waiting); the
`resumable` phase itself opens a WAITING interval that runs until the next phase write. This
is exactly the "first terminal wins / reopenable" contract the existing `endedAt` model already
implements (`task-telemetry-tracker.ts` L84-98, L406-419) — the ACT reuses it rather than
inventing a second terminality notion.

**An automatic retry is NOT in the `error` phase.** The runtime performs an automatic retry
WITHOUT leaving its own orchestration, so the phase remains `streaming` and the backoff is
inside the ACTIVE interval (`T05`). Only a retry that requires a HUMAN produces `error`, and
that interval is WAITING (`T05b`).

### 2.2 Active time definition

ACTIVE = wall-clock time during which the agent execution is progressing automatically or awaiting
dependencies required for automatic progression.

Explicitly NOT active time: CPU time, GPU time, model generation time, the sum of provider
request durations, the sum of concurrent tool durations. Provider latency, prefill, tool latency
and automatic retry delays ARE legitimate components of ACTIVE (they all sit inside a
`streaming` interval).

### 2.3 Waiting time definition

WAITING = automatic task progression is blocked by a human decision or input.

Waiting reasons:

```
USER_INPUT             awaiting_followup
TOOL_APPROVAL          awaiting_approval
USER_PAUSE             resumable
RECOVERY_INTERVENTION  (reserved; not produced by the current phase set)
OTHER_HUMAN_GATE       (reserved; not produced by the current phase set)

### 2.4 Conservation

For every accounted execution interval:

```
elapsedMs = activeMs + waitingMs + unknownMs
```

with `elapsedMs >= 0`, `activeMs >= 0`, `waitingMs >= 0`, `unknownMs >= 0`.

An interval is counted **exactly once**: each phase write closes the open interval and opens the
next one. There is no overlap, so there is no double counting. Concurrent operations contribute
the union of active wall-clock intervals because the accumulation is driven by a single
phase-interval timeline — concurrent tool executions share ONE `streaming` interval, so their
durations are NOT summed.

UNKNOWN never silently becomes ACTIVE or WAITING: it is a distinct accumulator that is only
incremented by the explicit discontinuity path (§3.3).

### 2.5 Task identity and execution epochs

Bound to the existing `currentTaskId` authority:

* Compaction (`compacting` phase) does not reset the task duration — it is an ACTIVE interval.
* Provider retries do not reset — they stay inside `streaming`.
* Webview reload does not reset — the tracker is host-owned and the wire carries the snapshot.
* Task switching does not transfer — `startTask` with a different id fully resets.
* Supported nonterminal recovery preserves accounted durations — the same task identity keeps the
  accumulated totals.
* Terminal completion freezes the duration — the terminal write closes the interval and no
  further accumulation happens until an explicit continuation write reopens it.
* A subsequent execution does not mutate frozen historical epoch accounting — the continuation
  opens a NEW interval; the previously accumulated totals are preserved and the dormant
  inter-epoch time (between the terminal write and the continuation write) is EXCLUDED from
  execution totals, because the terminal write closes the last interval and the continuation write
  opens the next one with no interval spanning the dormant gap.

This last point is the "explicit continuation after a terminal state must follow existing epoch
semantics" requirement, and it is why the accumulation must be **interval-based** rather than
`now - startedAt`: the dormant gap never belongs to any open interval.

**Dormant-time exclusion is documented in the UI tooltip** (§4.2).

## 3. W2/W4 — Accounting mechanism, clock authority, persistence

### 3.1 Mechanism: transition-based accumulation (not a re-derived elapsed)

On each authoritative phase write:

1. Resolve the current task identity (`currentTaskId`).
2. Read the authoritative clock.
3. Close the previous interval: add `(now - intervalStart)` to the accumulator of the previous
   category.
4. Accumulate into `activeMs` / `waitingMs` / `unknownMs`.
5. Establish the new category and anchor the new interval at `now`.
6. Publish the coherent snapshot through the existing state mechanism (`TaskTelemetryTracker.get()`
   → `SdkController.getStateToPostToWebview()` → `ExtensionState.taskTelemetry`).

The snapshot is published ONLY on a transition (plus the existing `get()` reads), so the ACT does
NOT publish full application state every second.

### 3.2 Clock authority: monotonic for uninterrupted intervals

The interval arithmetic uses a **monotonic** clock (`performance.now()`-family) so a wall-clock
adjustment (NTP step, DST, user clock change) can never produce a negative duration. The ACT's
T16 is therefore satisfied by construction.

Wall-clock (`Date.now()`) is retained ONLY for the existing `startedAt` / `endedAt` correlation
fields and for cross-process recovery evidence — never for duration arithmetic.

Monotonic timestamps are **process-local** and are NEVER persisted as transferable cross-process
values (ACT §7.4). The persisted form is the **accumulated totals plus the wall-clock anchor**,
which is exactly the "existing durable transition evidence" the ACT points at.

### 3.3 Clock discontinuity: UNKNOWN / partial coverage


## 4. W5 — Presentation

### 4.1 Display

```
5h 21m elapsed
1h 42m active
3h 39m waiting
```

Implemented in the existing `TaskHeaderTelemetry` strip, using the existing design system
(lucide-react icons already imported in that file; no new dependency). A compact proportional
bar is optional and is NOT implemented — the ACT keeps the delta to the classification + display.

### 4.2 Tooltips (the semantic disclosure)

```
Active:
Time spent executing automatically, including inference,
tools, retries and required dependencies.

Waiting:
Time during which automatic progression requires human input.

Unaccounted:
Time that cannot be classified from authoritative runtime evidence.
```

Plus the epoch note required by §2.5:

```
Terminal tasks freeze these totals. A later continuation of the same
task opens a new interval; time spent paused between a terminal state
and that continuation is excluded from active and waiting totals.
```

### 4.3 UI clock rule

The webview NEVER owns accumulated duration:

* The webview does not persist duration.
* The webview does not detect lifecycle transitions.
* The webview does not infer human waiting from UI state.
* The webview does not accumulate historical intervals.
* The webview does not survive as an independent source of truth.
* The webview does not continue presenting a stale extrapolation as authoritative.

The webview's existing `LIVE_TICK_MS` interval projects the CURRENT authoritative snapshot
FORWARD for display only (a presentation tick), using the host's own phase/terminal authority.
On webview recreation the presentation is reconstructed from the runtime snapshot (the wire
payload). On identity change the previous projection is replaced (the tracker resets on a new
task id). No side effects inside React functional state updaters.

The webview's forward projection is strictly bounded by the host's terminal authority: a
terminal task's totals are frozen and do not advance.

## 5. Consumers

* **Task header** — implemented by this ACT.
* **Session performance analysis** — successor consumer.
* **Model comparison** — successor consumer.
* **Incident exports** — potential successor consumer.
* **Automated supervision** — potential successor consumer.

No successor consumer is implemented speculatively.

Continuity is proven by a monotonic-clock read that is **non-decreasing** across the interval
boundary and whose origin is the same process. When continuity CANNOT be proven:

* the accumulated totals so far are preserved;
* the measurable-but-unattributable gap is accumulated into `unknownMs` — it is NEVER silently
  classified as ACTIVE or WAITING;
* if the gap duration itself cannot be established reliably, the snapshot is marked
  `coverage: "partial"` and NO numeric duration is invented for it.

### 3.4 Persistence and recovery

The accounting record is bound to the task identity and persisted through the existing task
persistence mechanism (`HistoryItem` slot — the same slot the existing `startedAt` already uses,
per `ExtensionMessage.ts` L840-844).

* Recovery is idempotent: re-observing the same phase on the same task identity does not close
  or open an interval (the tracker is idempotent per phase transition).
* Duplicate or stale lifecycle events cannot double-count: a phase write that does not change the
  category does not open a new interval (the interval stays open and keeps accruing into the same
  category) — so a duplicate write costs nothing and adds nothing.
* Terminal records remain immutable: after a terminal write, no interval is open, so nothing can
  accumulate.
* Older tasks without accounting data remain readable: the accounting field is OPTIONAL on the
  wire; absence renders "unavailable", never a fabricated zero.
* Missing historical accounting must not be represented as zero active time: the wire field is
  absent, and the webview renders the unavailable state.

```

The ACT does **not** implement the two reserved reasons speculatively; the union carries them so
the wire shape is stable, but the classifier never emits them today.

**"A displayed question or approval request does not, by itself, prove that all execution has
stopped."** The authoritative phase is the arbiter: `awaiting_approval` / `awaiting_followup` are
published by the runtime precisely when automatic progression is human-gated. While required
automatic work continues (e.g. a required background command), the phase remains `streaming` and
the interval stays ACTIVE — this is the T21 case, and it is satisfied **by construction** because
classification is driven by the phase, not by the presence of a UI prompt.

**"Detached background jobs that are no longer required for task progression must not keep the
task classified as ACTIVE."** A detached job does not hold the `streaming` phase; the phase moves
to the human-gated state and the interval becomes WAITING. The classification is phase-driven, so
a detached job cannot keep the task ACTIVE.

**No `CAPTURE_INSUFFICIENT` is required.** No message-gap heuristic is used or needed.

| Current task-header duration calculation | `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` L370-371 — `resolveElapsedDisplayMs(...)` + `formatElapsed(...)`; rendered at L436-443 `data-testid="task-header-elapsed"` | `TaskHeaderTelemetryStrip` | webview projection | presentation |

* `apps/vscode/src/shared/ExtensionMessage.ts` L836-1000 (`TaskHeaderTelemetryStrip`) — the wire
  strip carries `startedAt` / `endedAt` / `toolCalls` / `recoveryBudgetFailures` / `mechanism` /
  `outcome` / `runtimeErrorCount`. **No duration-category field exists.**

Therefore: a 5-hour task that spent 3h39m blocked on a human question and 1h42m executing is
indistinguishable from a 5-hour task that executed continuously. The elapsed duration **cannot**
be used to compare model execution performance. This is `OBSERVABILITY_GAP_REPRODUCED`.

This is a **new capability**, not a pre-existing runtime correctness bug: the runtime correctly
knows at every moment whether it is executing or blocked on a human; that knowledge is simply not
accumulated.

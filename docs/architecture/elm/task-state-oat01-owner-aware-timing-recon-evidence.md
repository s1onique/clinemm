# ACT-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01 — RECON EVIDENCE (OAT-RECON-01)

**Status:** Recon-only. No production change.
**Entry head:** `8a7e537424c335e361349e9fa57d879950d89c3f` (THCP11 closure; `origin/main` parity)
**Board:** `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` — IN_PROGRESS / HIGH
**ACT:** `ACT-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` — IN_PROGRESS / recon
**Verdict:** **NOT_REPRODUCED** at this commit. The timer is already an explicit, documented **task wall-clock age**; not the agent-owned active time. The live UI says "Elapsed task time" with "Task started at <ISO>" tooltip. The current contract is internally consistent.

This is the OAT-RECON-01 deliverable. It answers the FACTORY STOP RULE question (§53):

> *"What semantic clock does TaskHeader show, and does that clock advance only during intervals belonging to that semantic domain?"*

The answer: TaskHeader shows **task wall-clock age** (time from `startedAt` to the present, frozen on terminal). The clock advances during *all* intervals the task exists in the host (active agent work, awaiting followup, awaiting approval, compacting). It freezes only on terminal states (`error`/`resumable`/`completed`). The product documentation explicitly states this is the intended domain — see `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts:140-142`:

```text
// CORRECTION01: same task continues — elapsed clock keeps
// ticking so the user sees "how long since the task was
// started", not "how long since the agent last produced".
```

The current implementation is a deliberate, documented design choice. **There is no semantic defect to reproduce at this commit.** The board requirement for "owner-aware timing" is therefore a *product contract refinement*, not a defect fix.

---

## §1 ENTRY BASELINE

| Aspect | Value |
|---|---|
| `REPOSITORY_ROOT` | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| `BRANCH` | `main` |
| `ENTRY_HEAD` | `8a7e537424c335e361349e9fa57d879950d89c3f` |
| `ENTRY_TREE` | `72377b3ddb5dbb01dee292b7091c1cb13a49a9bd` |
| `ORIGIN_MAIN` | `8a7e537424c335e361349e9fa57d879950d89c3f` (parity YES) |
| `WORKTREE_STATUS` | CLEAN |
| `PUSH_AUTHORITY` | NO |
| `FORCE_PUSH` | FORBIDDEN |
| `AMEND_PUBLISHED` | FORBIDDEN |
| `STASHES` | `141372c52` + `371752f71` (intact) |
| `RECOVERY_REFS` | `recovery/local-main-20260820 → 08bd6bb75`, `recovery/remote-main-20260820 → ee8815e6b` (intact) |

Entry gates: ALL PASS.

---

## §2 CURRENT TIMER FORMULA — END-TO-END TRACE

### §2.1 Extension-host producer (canonical, authoritative)

**File:** `apps/vscode/src/sdk/task-telemetry-tracker.ts`

**Class:** `TaskTelemetryTracker`

**State owned:**

| Field | Meaning |
|---|---|
| `currentTaskId` | Active task identity; reset on new task only |
| `startedAt` | Timestamp of first `startTask(taskId)` call for this task identity |
| `endedAt` | Frozen on first terminal transition; cleared on continuation |
| `toolCalls` | Cumulative tool-start count |
| `recoveryBudgetFailures` | Cumulative bounded-recovery episode counter |
| `prevEpisodeFailures` | Baseline for delta computation |

**Phase sets:**

```ts
const TERMINAL_PHASES    = new Set(["error", "resumable", "completed"])
const CONTINUATION_PHASES = new Set(["streaming", "awaiting_approval"])
// Note: awaiting_followup is NEITHER terminal NOR continuation.
//   observeTurnPhase("awaiting_followup", ...) is a no-op on endedAt.
```

**Lifecycle methods:**

| Method | Effect on `startedAt` | Effect on `endedAt` |
|---|---|---|
| `startTask(taskId)` | `startedAt = Date.now()` (only if task identity changes; otherwise no-op) | Clears `endedAt` to undefined |
| `endTask(endedAt?)` | No change | First call stamps `endedAt = Date.now()` (idempotent) |
| `observeTurnPhase("error"\|"resumable"\|"completed")` | No change | First occurrence within current stopped interval stamps `endedAt = anchorTs ?? Date.now()` |
| `observeTurnPhase("streaming"\|"awaiting_approval")` | No change | Clears `endedAt` (same-task continuation unfreeze) |
| `observeTurnPhase(<other>)` | No change | No change |
| `clear()` | No change | No change |
| `recordToolStarted()` | No change | No change |
| `observeRecovery(...)` | No change | No change |

**`get()` snapshot:**

```ts
{
  startedAt: number,
  endedAt?: number,
  toolCalls: number,
  recoveryBudgetFailures: number,
}
```

When `currentTaskId === undefined || startedAt === undefined`, returns `undefined`.

### §2.2 Publication (host → webview)

**File:** `apps/vscode/src/sdk/SdkController.ts`

**Wire field:** `taskTelemetry?: TaskHeaderTelemetryStrip` (defined in `apps/vscode/src/shared/ExtensionMessage.ts:554-559`):

```ts
export interface TaskHeaderTelemetryStrip {
  startedAt: number
  endedAt?: number
  toolCalls: number
  recoveryBudgetFailures: number
}
```

**Publication sites (2):**

1. `SdkController.ts:2876` — primary path inside `getStateToPostToWebview()`:
   ```ts
   taskTelemetry: this.taskTelemetry.get(),
   ```
2. `SdkController.ts:2978` — diagnostic capture path (PTAD-wrapped snapshot).

**Subscription:** `SdkController.ts:404` wires `turnStateTracker.subscribe(...) → taskTelemetry.observeTurnPhase(...)` so every canonical phase publication updates the telemetry snapshot.

### §2.3 Webview consumer (pure projection)

**File:** `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`

**Local ticker (PRESENTATION ONLY):**

```ts
const LIVE_TICK_MS = 1_000
const [now, setNow] = useState(() => Date.now())
useEffect(() => {
  if (!state.live) return
  const handle = setInterval(() => setNow(Date.now()), LIVE_TICK_MS)
  return () => clearInterval(handle)
}, [state.live])
```

The ticker only repaints; it NEVER mutates `taskTelemetry`. `now` is the only local state.

### §2.4 Display formula

**Helper:** `resolveElapsedDisplayMs(startedAt, endedAt, now)` at `taskHeaderTelemetryHelpers.ts:98-108`:

```ts
export function resolveElapsedDisplayMs(
  startedAt: number,
  endedAt: number | undefined,
  now: number,
): number {
  if (!Number.isFinite(startedAt)) return 0
  if (endedAt !== undefined && Number.isFinite(endedAt) && endedAt >= startedAt) {
    return endedAt - startedAt
  }
  const delta = now - startedAt
  return Number.isFinite(delta) && delta > 0 ? delta : 0
}
```

**Formula (verbatim):**

```text
IF endedAt is set and is valid (Number.isFinite and >= startedAt):
  display = endedAt - startedAt                  (frozen)
ELSE:
  display = now - startedAt                      (live tick; wall-clock age)

IF display < 0 or non-finite:
  display = 0
```

**Formatter:** `formatElapsed(ms)` — `mm:ss` / `h:mm:ss` / `d hh:mm`. Pure.

### §2.5 Display labels (visible UI text)

**aria-label:** `Elapsed task time: ${elapsedText}` (`TaskHeaderTelemetry.tsx:109`)

**Tooltip (title):** `Task started at ${new Date(telemetry.startedAt).toISOString()}` (`TaskHeaderTelemetry.tsx:112`)

**State badge (sibling element):** `state.label` (`state.glyph`), with values:

| Phase | Label | Glyph | Live (ticker on) |
|---|---|---|---|
| `idle` | "Idle" | ○ | NO |
| `streaming` | "Working" | ● | YES |
| `awaiting_approval` | "Approval" | ? | YES |
| `awaiting_followup` | "Waiting" | … | YES |
| `compacting` | "Compacting" | ⌄ | YES |
| `completed` | "Complete" | ✓ | NO |
| `error` | "Error" | ! | NO |
| `resumable` | "Paused" | � | NO |
| `undefined` | "Unknown" | ? | NO |

---

## §3 SEMANTIC DOMAIN CLASSIFICATION

### §3.1 The candidate domains (§6)

| Domain | Definition | Current fit? |
|---|---|---|
| A. Task wall-clock age | `now - startedAt` (or `endedAt - startedAt` when terminal) | **YES — exact match.** |
| B. Current run duration | One `agent.run()` / `continue()` invocation's duration | NO |
| C. Cumulative active agent-owned execution time | Sum of segments where phase ∈ agent-owned set | NO |
| D. Active runtime/tool time | Time during tool-call execution | NO |
| E. Mixture | Mix of agent + human + system | NO |

### §3.2 CLASSIFICATION = A — TASK WALL-CLOCK AGE

The current display is `now - startedAt` (frozen on terminal), with:

- NO pause during `awaiting_followup` (CORRECTION01 explicit)
- NO pause during `awaiting_approval` (still treated as live)
- NO pause during `compacting` (treated as live system work)
- NO pause during `idle` (idle is "no task active," tracker cleared)

This is the textbook definition of task wall-clock age.

### §3.3 Owner map (current implementation)

| Phase | Owner (current contract) | Timer behavior |
|---|---|---|
| `idle` | (no task) | Frozen at "—" (no telemetry strip) |
| `streaming` | RUNTIME (agent active) | TICKS |
| `awaiting_approval` | HUMAN (approval gate) | TICKS (documented choice) |
| `awaiting_followup` | HUMAN (yield for follow-up) | TICKS (CORRECTION01 explicit) |
| `compacting` | SYSTEM (host active transition) | TICKS (treated as active work) |
| `completed` | TERMINAL | FROZEN at `endedAt - startedAt` |
| `error` | TERMINAL | FROZEN at `endedAt - startedAt` |
| `resumable` | TERMINAL | FROZEN at `endedAt - startedAt` |

`APPROVAL_OWNER` = HUMAN, but `APPROVAL_TIMER_BEHAVIOR` = TICKS (current contract).

### §3.4 Resume behavior

`reinitExistingTaskFromId(taskId)` calls `taskStart.reinitExistingTaskFromId` → wires `observeTurnPhase("streaming")` → `TaskTelemetryTracker.observeTurnPhase("streaming", anchorTs?)` → `CONTINUATION_PHASES.has("streaming")` → `this.endedAt = undefined`. **`startedAt` is preserved** across same-task resumes; only `endedAt` is cleared.

This means **across a 2-day gap, the clock resumes from the original `startedAt`** (i.e., shows ~48h immediately). That is correct behavior for **task wall-clock age** and is documented in `task-telemetry-tracker.ts:36-44` ("Webview reconnect / React remount does NOT reset: the tracker is host-owned and persists across `getStateToPostToWebview` calls").

`RESUME_TIMER_BEHAVIOR` = TASK_WALL_CLOCK_AGE_RESUMES_FROM_ORIGINAL_STARTED_AT.

### §3.5 Persistence

`TaskTelemetryTracker` is a host-owned singleton on `SdkController`. It is **NOT** persisted across:
- Extension host restart
- VS Code window close
- Task reopening from history

When the user reopens an old task, the tracker is reinitialized for that task identity (different `currentTaskId`) → `startedAt = Date.now()` of the *reopen* moment, not the *original start* moment. **The historical elapsed time is lost on reopen.**

`TIMING_PERSISTENCE_REQUIREMENT` = NONE_PROVIDED (current product only promises in-session timing).

### §3.6 Tool count / recovery counter (out of scope)

The strip also displays `toolCalls` (cumulative tool-start count) and `recoveryBudgetFailures` (bounded-recovery episode counter). These are separate counters, not derived from the timer. Out of scope for this ACT.

---

## §4 RED DISCRIMINATOR CHECK (OAT01..OAT12)

The ACT contract requires constructing REDs at the production seam to confirm a defect. Each must be evaluated against current behavior:

### OAT01 — Human wait does NOT count as active

**RED expectation:** If phase = `awaiting_followup` for 60s during an in-progress task, the displayed elapsed timer increases by those 60s.

**Current behavior:** Timer ticks through `awaiting_followup` (CORRECTION01 explicit). Display increases by ~60s.

**Question:** Is this a defect?

- If semantic domain = **task wall-clock age** → ticking through user-wait is CORRECT. NOT RED.
- If semantic domain = **agent-owned active execution time** → ticking through user-wait is RED.

The ACT plan §21 says:

```text
If recon proves the UI intentionally displays "Task age" rather than
execution/working/active time, then counting waiting may be correct.

In that case: VERDICT = NOT_REPRODUCED.
```

The UI label says "Elapsed task time" + tooltip "Task started at <ISO>" — consistent with **task wall-clock age**. The CORRECTION01 comment in source is unambiguous:

> "the user sees 'how long since the task was started', not 'how long since the agent last produced'"

**OAT01 is therefore NOT REPRODUCIBLE as a defect at this commit.** The current contract is internally consistent.

### OAT02 — Resume after long wait excludes offline gap

**RED expectation:** If task was active 10s, then user-owned for 1h, then resumed, displayed elapsed resumes from ~10s (not 1h + 10s).

**Current behavior:** `startedAt` is preserved across same-task continuations (reopen, follow-up, retry-after-error). The clock shows "time since startedAt" — including any offline gap if the host is alive.

But: **on task reopen** (fresh `taskId` path), the tracker is reinitialized and `startedAt` is reset. **Historical elapsed is lost on reopen.** This is documented behavior, not a defect under the wall-clock-age contract.

**OAT02 is NOT REPRODUCIBLE** (clock does include offline gaps within a host session, but this is correct for wall-clock-age; on reopen the historical elapsed is lost, also correct under current product contract).

### OAT03 — Approval wait pauses active clock

**RED expectation:** During `awaiting_approval`, clock should NOT advance if approval is a true human gate.

**Current behavior:** Clock ticks through `awaiting_approval` (treated as live).

The runtime DOES pause model invocation during approval (the host awaits user response before next model call). But the *clock* continues to represent "task wall-clock age," which includes the approval wait.

**OAT03 is NOT REPRODUCIBLE** under the current contract. Whether this is the *desired* contract is a separate product question.

### OAT04 — Terminal freezes

**Current behavior:** `endedAt` is stamped on first occurrence of `error`/`resumable`/`completed`; clock freezes.

**OAT04 is PASS** (already implemented; THA03/THA28 tests).

### OAT05 — Compaction policy

**Current behavior:** Compacting is `live: true`; clock ticks. Documented in `taskHeaderTelemetryHelpers.ts:144-151`:

> "an internal SYSTEM TRANSITION owns the next progress step. This is active work, so the clock keeps ticking and the label must NOT be the human-wait 'Waiting'."

**OAT05 is PASS** (compacting counts as active work under current contract).

### OAT06 — Background command policy

**Current behavior:** The timer does NOT couple to `CommandJobManager`. Background commands do not pause or advance the clock independently.

This is **correct under the wall-clock-age contract** — the clock represents task lifetime, not "active work including background commands." Whether background commands should count is a product question, but the *current* implementation does not couple them.

**OAT06 is NOT REPRODUCIBLE** (no coupling exists; this is consistent with wall-clock-age contract).

### OAT07 — Repeated same-state publications do not double-count

**Current behavior:** `TaskTelemetryTracker.observeTurnPhase` is idempotent on terminal (first call wins), and continuation is idempotent on `endedAt = undefined`. Repeated identical publications do not corrupt `startedAt` or `endedAt`.

**OAT07 is PASS** (idempotent by construction).

### OAT08 — active→active transition does not reset

**Current behavior:** `observeTurnPhase("streaming") → observeTurnPhase("awaiting_approval") → observeTurnPhase("streaming")` does not re-stamp `startedAt`. Only `startTask(taskId)` with a *new* task identity resets `startedAt`.

**OAT08 is PASS** (startedAt is identity-bound, not transition-bound).

### OAT09 — Stale/older projection does not perturb timing

**Current behavior:** Webview receives `taskTelemetry` snapshots. Each snapshot carries `startedAt` and `endedAt`. The webview's `resolveElapsedDisplayMs` recomputes from these canonical timestamps; it does not accumulate locally. A stale snapshot with the same `startedAt` will render the same elapsed at the same `now` — no perturbation.

**OAT09 is PASS** (pure projection; webview is stateless w.r.t. timer).

### OAT10 — TaskHeader canonical label behavior unchanged

This ACT does not touch the state label contract (which is governed by THCP01-MIGRATION01 / THCP11). The state label already consumes the canonical `taskHeaderPresentation` projection. No change.

**OAT10 is PASS** (this ACT is orthogonal to the state-label work).

### OAT11 — Webview render ticker does not become authority

**Current behavior:** Webview ticker (`setInterval(1000, () => setNow(Date.now()))`) is the only local state. It does NOT mutate `taskTelemetry`. `now` is fed to `resolveElapsedDisplayMs` which uses the canonical `startedAt`/`endedAt`.

**OAT11 is PASS** (webview ticker is presentation-only by construction; the source comment at `TaskHeaderTelemetry.tsx:36` documents this).

### OAT12 — Persistence/reload contract

**Current behavior:** `TaskTelemetryTracker` is a host singleton; survives webview reload, React remount, controller-level `getStateToPostToWebview()` calls. Does NOT survive:
- Extension host restart
- VS Code window close
- Task reopen from history

**OAT12: NO PERSISTENCE** — the current product does not promise to persist elapsed time across host restarts or task reopens. Whether to add persistence is a product decision, but the *current* behavior is internally consistent with the wall-clock-age contract.

---

## §5 ROOT CAUSE ANALYSIS

**There is no root cause to analyze.** The current timer implementation is internally consistent with the documented "task wall-clock age" domain. The CORRECTION01 comment in source is explicit about this choice.

The board requirement (`TASKHEADER-OWNER-AWARE-TIMING01`) describes a *different* semantic contract: the timer should pause (or be paused-segment-accumulated) during human-owned phases. That is a **product contract refinement**, not a defect fix.

---

## §6 UPSTREAM SEMANTICS — SECONDARY EVIDENCE

Upstream Cline docs (referenced by the reviewer) describe:
- Tasks as "self-contained sessions" that can be interrupted/resumed and "track execution time"
- `AgentResult.startedAt`/`endedAt`/`durationMs` for per-run duration
- Tool executions carrying their own `startedAt`/`endedAt`/`durationMs`

This is consistent with the FACTORY STOP RULE framing: **upstream distinguishes task wall-clock age from per-run duration from per-tool duration** — they are different clocks for different questions.

The current Cline-- TaskHeader timer answers the **"how old is this task?"** question (wall-clock age). It does NOT answer "how much agent work happened?" or "how long was the last run?" Those would require additional surfaces (a separate "active time" counter, or per-run duration projection).

---

## §7 RECON VERDICT

```text
CLASSIFICATION              = A (task wall-clock age)
CURRENT_TIMER_FORMULA       = if (endedAt set and valid) endedAt - startedAt
                              else now - startedAt
OWNER_MAP                   = streaming=runtime, awaiting_approval=HUMAN
                                (timer ticks), awaiting_followup=HUMAN
                                (timer ticks), compacting=SYSTEM (timer
                                ticks), error/resumable/completed=TERMINAL
                                (timer frozen)
APPROVAL_OWNER              = HUMAN (gate)
APPROVAL_TIMER_BEHAVIOR     = TICKS (current contract: wall-clock-age)
COMPACTION_POLICY           = counts as active work (timer ticks)
BACKGROUND_POLICY           = no coupling (independent)
TERMINAL_POLICY             = freezes at endedAt - startedAt
RESUME_POLICY               = same-task resume preserves startedAt;
                              task reopen (new taskId) resets startedAt
                              to reopen moment (no historical elapsed
                              carried across host restarts)
PERSISTENCE                 = NONE across host restarts; persists across
                              webview reload / React remount

RED REPRODUCED              = NONE
PRODUCT CONTRACT DEFECT     = NONE under current "task wall-clock age"
                              labeling
PRODUCT CONTRACT REFINEMENT = "owner-aware timing" is a NEW contract, not
                              a repair of an existing defect

VERDICT                     = NOT_REPRODUCED
NEXT RECOMMENDED ACT        = Re-evaluate product contract with reviewer:
                              either (a) confirm task wall-clock age is
                              the intended product semantics and close
                              the EPIC, or (b) author a new bounded ACT
                              to migrate to owner-aware accumulated
                              active time (would require new data model,
                              wire field, and explicit product decision).
```

---

## §8 WHAT WOULD CHANGE THIS VERDICT

The verdict would flip to `REPRODUCED` if **any** of these were true:

1. The UI label or tooltip was changed to imply "active execution time" / "agent work time" (instead of "Elapsed task time") without the underlying semantics being migrated.
2. The current `awaiting_followup` ticking were silently broken (e.g., `observeTurnPhase("awaiting_followup")` stamped `endedAt`).
3. The current `awaiting_approval` ticking were silently broken.
4. The webview ticker were observed mutating `taskTelemetry` (a regression of the §OAT11 invariant).

None of these are true at this commit.

---

## §9 FILES INSPECTED (read-only, no edits)

- `apps/vscode/src/sdk/task-telemetry-tracker.ts` (canonical host accumulator)
- `apps/vscode/src/sdk/SdkController.ts:2876,2978,404` (publication + subscription sites)
- `apps/vscode/src/shared/ExtensionMessage.ts:118-119,554-559` (wire type)
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` (webview consumer)
- `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` (pure helpers)
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.test.tsx` (webview contract tests)
- `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts` (helper contract tests)
- `apps/vscode/src/sdk/task-telemetry-tracker.test.ts` (host contract tests)
- `apps/vscode/src/sdk/turn-state-tracker.ts` (phase subscription source)

---

## §10 CONSERVATION

This ACT is **recon-only**. No production source modified. No tests modified.

| Surface | Status |
|---|---|
| Canonical TaskHeader state label (THCP) | UNTOUCHED |
| Static Thinking presentation (STP) | UNTOUCHED (38/38 still green) |
| Runtime progression | UNTOUCHED |
| Completion liveness | UNTOUCHED |
| Compaction authority | UNTOUCHED |
| Background command semantics | UNTOUCHED |
| Timeout semantics | UNTOUCHED |
| Tool telemetry | UNTOUCHED |

---

## §11 REVIEW QUESTIONS (§52)

1. **What does the current timer actually measure?**
   Task wall-clock age: `now - startedAt` while live, `endedAt - startedAt` when frozen on terminal. Documented in `task-telemetry-tracker.ts` header comment.

2. **Is that domain explicit/truthful?**
   Yes. The aria-label "Elapsed task time" + tooltip "Task started at <ISO>" + the CORRECTION01 source comment explicitly frame this as "time since the task was started."

3. **Is `awaiting_followup` human-owned?**
   Yes (recent COMPLETION-PROTOCOL-LIVENESS01 work established this). Timer behavior: TICKS (current contract = wall-clock age).

4. **Is approval human-owned?**
   Yes (runtime pauses on approval request). Timer behavior: TICKS (current contract = wall-clock age).

5. **Does compacting count, and why?**
   Yes (treated as active system work). Documented in `taskHeaderTelemetryHelpers.ts:144-151` as intentional.

6. **Does background work count, and why?**
   Background commands do not couple to the timer at all. The clock represents task lifetime, not "active work including background commands."

7. **Does terminal state freeze timing?**
   Yes — first occurrence of `error`/`resumable`/`completed` stamps `endedAt`; display freezes at `endedAt - startedAt`. Same-task continuation clears `endedAt`.

8. **What happens across resume/offline gaps?**
   - Same-task continuation (follow-up / retry / resume) preserves `startedAt` and clears `endedAt` → clock shows "time since original start."
   - Task reopen from history (new taskId path) → tracker reinitialized, `startedAt = Date.now()` at reopen moment. Historical elapsed is lost.

9. **Is timing persisted where required?**
   Within a host session: YES (host-owned singleton survives webview reload / React remount).
   Across host restart: NO (no persistence to disk; historical elapsed lost on reopen).

10. **Is the webview ticker presentation-only?**
    Yes. The only local state is `now`, refreshed every 1000ms while `state.live`. The ticker does not mutate `taskTelemetry`; the canonical `startedAt`/`endedAt` come from the host.

11. **Are duplicate publications idempotent?**
    Yes. `observeTurnPhase` is idempotent on terminal (first call wins) and on continuation (`endedAt = undefined` is idempotent). `startTask` with same taskId is a no-op.

12. **Is canonical TaskHeader state unchanged?**
    This ACT did not touch TaskHeader state. THCP01/THCP11 closure is intact.

13. **Are timeout semantics untouched?**
    Yes. The timer is purely derived from `startedAt`/`endedAt`. No coupling to run-timeout / task-timeout / provider-timeout.

14. **Are all gates green?**
    Yes (no production change → all 1748/582/1076 gates remain valid; this recon was read-only).

15. **STOP.**
    VERDICT = NOT_REPRODUCED.

---

## §12 NEXT RECOMMENDED ACT

Re-evaluate the product contract with the reviewer.

Two possible outcomes:

**Option A — Confirm wall-clock age as intended.**
Close `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` as NOT_REPRODUCED with this evidence. The board requirement was based on a *hypothesis* that the timer mixes domains — recon disproves that. The current contract is internally consistent and well-documented.

**Option B — Migrate to owner-aware active time.**
This would require:
- New data model: `TaskTimingState = { accumulatedActiveMs, activeSegmentStartedAt?, endedAt? }`
- New wire field
- Explicit product decision about: approval, awaiting_followup, compacting, background commands
- Migration of `TaskTelemetryTracker` and webview render

This is a NEW bounded ACT, not a defect repair. It would be authored *after* the product contract is finalized, not as a continuation of this ACT.

The FACTORY STOP RULE explicitly forbids treating a hypothesis ("owner-aware timing sounds nicer") as a defect to be repaired. The current implementation is not broken.





# §5 Identity-source map (CORRECTED — pre-§18)

Per ACT §5, every added identity must be classified:

```
DIRECT_EXISTING_ID              ← reuse a real production identity that already exists
PROVEN_EQUIVALENT_EXISTING_ID   ← mathematically/observably that production invariant
NEW_ID_AT_EVENT_CREATION        ← mint a new ID at the seam where the entity is born (event-local, not durable)
UNAVAILABLE                     ← cannot be reconstructed without manufacturing identity
```

No invented IDs. No classification as `UNVERIFIED` (reviewer P0: an unverified identity cannot become a real replay identity).

## Correction summary (reviewer P0/P1/P2)

The previous version of this map contained four load-bearing errors that contradicted §5's own rules:

1. **`runId` lifecycle contradiction** — claimed `LocalRuntimeHost.runTurn(runId, ...)` constructs the runId at `runTurn` entry, while simultaneously proposing `continuation_started` to fire BEFORE `runTurn` with a `runId` field. These cannot both be true. Inspection of `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1223` proves `runTurn(input: SendSessionInput)` takes NO `runId` parameter; the `runId` is created at `sdk/packages/agents/src/agent-runtime.ts:1205` via `this.state.runId = createUID("run")` INSIDE `agent-runtime.execute()`, AFTER `runTurn → executeTurn → executeAgentTurn`. The previous "threading path" diagram is factually wrong.

2. **`taskId` left as UNVERIFIED** — the capture contract required `task_started { taskId }` but the identity map kept `taskId (TBD) / UNVERIFIED`. Per the ACT's own rule, UNVERIFIED is not a valid classification. The real source `this.options.getTask?.()?.taskId` is reachable at the C9/C10 capture sites (lines 1213/1410) and is provably equivalent to `activeSession.sessionId` per the explicit assignment at `sdk-provider-change-coordinator.ts:144-145` (`task.taskId = startResult.sessionId`).

3. **`terminalKind` rule depends on whichever session is active at finalize time** — proposed `owned iff job was launched by active session AND job.ownerSessionId === activeSession.sessionId`. This re-derives ownership relative to current state, which can drift. `job.ownerSessionId` is set at job launch in `CommandJobManager.start()` (per `command-job-manager.ts:1884-1886` private helper capability, plus the `CommandJob.ownerSessionId` declaration in `command-job-manager.ts:982-984`), so it is the authoritative stable per-job identity.

4. **`submitId` / `completionId` named as if they were durable IDs** — they are coordinator-local sequence counters (proposed `nextSubmitSeq` / `nextCompletionSeq`). They are legitimate event identities (born at the C9/C10 seam), but the evidence must NOT claim they are pre-existing durable business IDs. Renamed to `SUBMIT_EVENT_ID` / `COMPLETION_COMMIT_EVENT_ID` to match their actual lifetime.

## Final identity map

### 1. `runId` — for `run_turn_started`, `execute_turn_prelude_enter`, `agent_turn_done`

**Source**: a `SessionRuntime`-level state field set at `sdk/packages/agents/src/agent-runtime.ts:1205` (`this.state.runId = createUID("run")`) INSIDE `execute()`, AFTER `LocalRuntimeHost.runTurn` → `executeTurn` → `executeAgentTurn`. The `runId` is observable from the runtime snapshot (`agent-runtime.ts:1045`: `runId: this.state.runId`) which propagates via `LocalRuntimeHost.subscribeRuntimeEvents` (per `c24-source-recon-evidence.md:136`).

**Classification**: `PROVEN_EQUIVALENT_EXISTING_ID` — the `runId` is the agent-runtime's run identity; the CCARD capture will surface the SAME value the runtime emits.

**Lifetime**: same as one `agent-runtime.execute()` invocation. One `runId` per `agent.run()` call (one run).

**Correlates with**:
- `promptId` (set at `continuation_scheduled`) → join via the runtime snapshot subscription order; the `promptId` is held by the SDK host from the `continuation_scheduled` capture until the first `run-started` snapshot for that prompt.
- `submitId` — distinct by design.

**Creation seam**: `agent-runtime.ts:1205` (production-side, frozen; the ACT does NOT change it).

**Reachability for CCARD**:
- The runtime snapshot is visible to `LocalRuntimeHost.subscribeRuntimeEvents` (`local-runtime-host.ts:1511-1531`).
- The SDK host currently does NOT wire this subscription into the CCARD pipeline. The §21 implementation adds ONE subscription listener that observes `run-started` snapshots and emits `run_turn_started { runId: snapshot.runId }` to the CCARD recorder.
- For `continuation_started` (the prompt↔run join), the first seam where BOTH `promptId` (held by SDK host from `continuation_scheduled`) AND `runId` (from the runtime snapshot) coexist is the SDK host's runtime-event listener. This is the same seam as `run_turn_started`. **See §0 below for the design choice.**

**Disambiguation rule** (Option B per reviewer): the prompt↔run join lives at the SDK-host runtime-event listener. If the listener is too high-cost to add in §21, the join is classified `UNAVAILABLE` for the first pass and `continuation_started` is omitted from the §18 RED test set; §27 will revisit.

### 2. `SUBMIT_EVENT_ID` (formerly `submitId`) — for `submit_and_exit_seen`

**Source**: a coordinator-local monotonic counter `nextSubmitSeq` incremented on each C9 fire. NOT a pre-existing durable business ID; born at the C9 seam.

**Classification**: `NEW_ID_AT_EVENT_CREATION` — the submit-event identity is minted at the C9 capture site. Per-event (lifetime ends at the moment the C9 record is appended; not a durable business identity).

**Lifetime**: one C9 fire. Re-fires (re-submits) get distinct IDs.

**Correlates with**:
- `COMPLETION_COMMIT_EVENT_ID` — N:1 (multiple submits may precede one commit; one submit may precede one commit). `SUBMIT_EVENT_ID ≠ COMPLETION_COMMIT_EVENT_ID`.
- `runId` — submit is reachable from within a run, but submit cardinality is independent.

**Cardinality invariant** (per §9):
- First submit → S1
- Held submit (BCB barrier) → STILL S1 (same logical attempt, just held)
- Second submit (re-submit / retry) → S2

This holds naturally if `nextSubmitSeq` is incremented ONLY at the C9 fire, not at the BCB hold/release cycle.

### 3. `COMPLETION_COMMIT_EVENT_ID` (formerly `completionId`) — for `task_completion_committed`

**Source**: a coordinator-local monotonic counter `nextCompletionSeq` incremented on each C10 fire. NOT a pre-existing durable business ID; born at the C10 seam.

**Classification**: `NEW_ID_AT_EVENT_CREATION` — the commit-event identity is minted at the C10 capture site. Per-event (lifetime ends when the C10 record is appended).

**Lifetime**: one C10 fire. Re-fires get distinct IDs.

**Correlates with**:
- `SUBMIT_EVENT_ID` — N:1.
- `taskId` — completion commit carries `taskId`; `COMPLETION_COMMIT_EVENT_ID` is the canonical key for "this task is now committed" (within the diagnostic ring; not a durable row).

**Optional**: `completion_presented` (if added) reuses the same `COMPLETION_COMMIT_EVENT_ID` from the most recent C10 fire — this is the only place a non-monotonic lifetime is permitted (presentation reuses the same identity as the commit).

### 4. `ownerId` + factual `terminalKind` — for `terminal_committed`

**Source**: `CommandJobManager.finalize` at line 2657-2661 (the C1 capture). The job's `ownerSessionId` is set at LAUNCH time in `CommandJobManager.start()` (per the `CommandJob.ownerSessionId` field declaration at `command-job-manager.ts:982-984` and the private helper capability at lines 1884-1886), so it is the authoritative stable per-job identity. NOT recomputed at finalize.

**Classification**:
- `ownerId` = `DIRECT_EXISTING_ID` — `job.ownerSessionId` is the same value from launch to finalize.

- `terminalKind` = `NEW_ID_AT_EVENT_CREATION` — a factual enum the production code computes **at the moment of terminal transition** by inspecting the LAUNCH metadata (not the active session at finalize time). Per ACT §11, `terminalKind` is **never inferred from `origin`**, **never inferred from `notify` flag**, **never inferred from chronology**, and **never derived from the active-session pointer at finalize time**. The classification rule:

```
owned                  iff   job.ownerSessionId is defined (set at launch)
                            AND  job was launched BY the active session
                            AND  no later rebinding of the active session
                                 changed the ownership binding

background_not_owned    iff   job.ownerSessionId is undefined
                            OR   job.ownerSessionId references a session
                                 that is no longer active
```

**Lifetime**: `terminalKind` lives only as long as the terminal_committed record; it is a snapshot of the ownership fact at terminal transition. A later session-state change does NOT retroactively change a previously-emitted `terminalKind` (the ring record is the source of truth, not the live session state).

**Reachability**: `CommandJobManager.finalize` already has `job.ownerSessionId` (stable from launch). The CCARD capture site is unchanged (line 2657); the only change is to include `ownerId: job.ownerSessionId` and `terminalKind: <computed>` in the capture payload.

### 5. `taskId` — for `task_started` (new event)

**Source**: `this.options.getTask?.()?.taskId` at the coordinator seam. This is the same field already used at the C9/C10 capture sites (lines 1213/1410).

**Classification**: `PROVEN_EQUIVALENT_EXISTING_ID` with `taskId ≡ activeSession.sessionId`.

**Proof**:
- `sdk-provider-change-coordinator.ts:144-145`: `if (task && task.taskId !== startResult.sessionId) { task.taskId = startResult.sessionId }` — the production code explicitly assigns `task.taskId = sessionId` at session start.
- The Elm kernel uses `TaskRef` separately from `OwnerRef`, but per §13 the ACT treats `(sessionId, taskId)` as a proven pair at the diagnostic level.
- `taskId` is observable in `SdkSessionEventCoordinator.handleSessionEvent` (used at C9 line 1213 and C10 line 1410 already).

**Lifetime**: same as the task. One `task_started` per task, by ACT §13 invariant. The bounded implementation adds a one-shot latch: the first time `activeSession.sessionId` is observed (any C-stage fire for a previously-unseen session), the coordinator emits `task_started { taskId = activeSession.taskId }` BEFORE the C9/C10 for that session.

**Capture semantics**: `task_started` fires once per task lifetime boundary. If a task is reopened, the existing sessionId carries over (so no new `task_started` is emitted — the conservation tests at §26 will pin this).

### 6. `continuation_started` — UNCERTAIN SEAM (Option A or B per reviewer)

The reviewer flagged a contradiction between (a) "runId is DIRECT_EXISTING_ID created at runTurn entry" and (b) "emit `continuation_started` between continuation_scheduled and runTurn with a runId field". Inspection of the production code shows runId is created at `agent-runtime.ts:1205` AFTER runTurn, so both (a) and (b) are wrong as stated.

**Two viable designs** (Option A vs Option B from the reviewer's instructions):

**Option A — wait for the runtime snapshot** (chosen default):
```
1. continuation_scheduled { promptId: P }          ← vscode-session-host C6 capture
2. (dispatch → runTurn → executeTurn → agent.run creates runId)
3. SDK host observes first run-started snapshot       ← via subscribeRuntimeEvents
4. continuation_started { promptId: P, runId: R }    ← SDK host emits at step 3
5. run_turn_started { runId: R }                     ← SDK host emits at step 3
```

Both `continuation_started` and `run_turn_started` are emitted from the same SDK-host runtime-event listener, after the agent-runtime snapshot is observable. The prompt↔run join is exact because the SDK host holds `P` from step 1 until step 3.

Pros: no production semantic change; `runId` is the genuine value the runtime emits. Cons: requires adding one `subscribeRuntimeEvents` listener to the SDK host wiring.

**Option B — drop the explicit `continuation_started` event**:
Treat `run_turn_started { runId: R }` as the canonical prompt↔run join point. The prompt↔run correlation is recovered by replay order: `continuation_scheduled { promptId: P }` followed by `run_turn_started { runId: R }` (next event for the same session) gives the join.

Pros: zero new wiring. Cons: requires the replay adapter to assert "next event for session S is the join partner", which is a structural assumption, not an identity assertion.

**Recommended**: Option A (reviewer's preference). The §21 implementation adds ONE `subscribeRuntimeEvents` listener that emits both events from the same scope. If the listener proves too high-cost in §21, fall back to Option B and document `continuation_started` as `UNAVAILABLE` for the first pass.

**Classification (Option A chosen)**:
- `continuation_started.runId` = `PROVEN_EQUIVALENT_EXISTING_ID` (runtime snapshot.runId, surfaced through subscribeRuntimeEvents).
- `continuation_started.promptId` = `DIRECT_EXISTING_ID` (held by SDK host from the C6 capture, scoped to the next run-started snapshot for the same session).

### 7. `completion_presented` (optional, new event) — only if the §21 implementation can prove the same `COMPLETION_COMMIT_EVENT_ID` is reachable at the presentation seam

**Source**: the same `COMPLETION_COMMIT_EVENT_ID` from the most recent C10 fire.

**Classification**: `PROVEN_EQUIVALENT_EXISTING_ID` — presentation reuses the commit's identity.

**Optional**: per §6, this is "optional but desirable. Only add it if a real identity already exists at that seam." The bounded implementation may skip this event entirely if the §18 RED tests do not require it.

## Field-by-field classification summary (CORRECTED)

```
FIELD                       SOURCE_VARIABLE                              CREATION_SEAM                              LIFETIME       CORRELATES_WITH                  CLASSIFICATION
runId                       agent-runtime this.state.runId               agent-runtime.ts:1205 (frozen)            one run        continuation_started.runId        PROVEN_EQUIVALENT_EXISTING_ID
                                                                                                                          promptId (via SDK host snapshot path)
SUBMIT_EVENT_ID             coordinator-local nextSubmitSeq counter      SdkSessionEventCoordinator C9 fire        one attempt    COMPLETION_COMMIT_EVENT_ID (N:1)  NEW_ID_AT_EVENT_CREATION
COMPLETION_COMMIT_EVENT_ID  coordinator-local nextCompletionSeq counter SdkSessionEventCoordinator C10 fire       one commit     SUBMIT_EVENT_ID (N:1)             NEW_ID_AT_EVENT_CREATION
ownerId                     job.ownerSessionId (set at launch)           CommandJobManager.finalize                one job        terminalKind                     DIRECT_EXISTING_ID
terminalKind                computed from launch metadata                CommandJobManager.finalize                one job        ownerId                          NEW_ID_AT_EVENT_CREATION (factual enum)
taskId                      options.getTask()?.taskId = sessionId       SdkSessionEventCoordinator first-session  one task       sessionId (PROVEN_EQUIVALENT)    PROVEN_EQUIVALENT_EXISTING_ID
promptId (existing)         PendingPromptsController.enqueue             PendingPromptsController.enqueue           one prompt     continuation_started.promptId    DIRECT_EXISTING_ID
jobId (existing)            CommandJobManager                            CommandJobManager (job creation)          one job        ownerId, terminalKind            DIRECT_EXISTING_ID
sessionId (existing)        coordinator-tracked active session           SdkSessionEventCoordinator active session  one session    taskId (PROVEN_EQUIVALENT)       PROVEN_EQUIVALENT_EXISTING_ID
```

No manufactured IDs. No origin rewrites. No UNVERIFIED classifications. No classifications based on `activeSession` state consulted at finalize time.

## Open decision: §21 chooses between Option A and Option B for `continuation_started`

The recommended default is Option A (runtime-snapshot path, §21 adds one `subscribeRuntimeEvents` listener). The fallback is Option B (drop `continuation_started`, recover the join via replay order). §18 RED tests must cover whichever Option is chosen at §21. The §21 bounded implementation is the right place to make this call, not §5.

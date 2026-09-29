# §5 Identity-source map (TEMPORALLY HONEST — pre-§18 second pass)

Per ACT §5, every added identity must be classified:

```
DIRECT_EXISTING_ID              ← reuse a real production identity that already exists
PROVEN_EQUIVALENT_EXISTING_ID   ← mathematically/observably that production invariant
NEW_ID_AT_EVENT_CREATION        ← mint a new ID at the seam where the entity is born (event-local, not durable)
UNAVAILABLE                     ← cannot be reconstructed without manufacturing identity
```

No invented IDs. No classification as `UNVERIFIED` (reviewer P0: an unverified identity cannot become a real replay identity). No classification as a fact that exists at a later boundary (reviewer P0 second pass: temporal identity smuggling — backfilling a future fact into a past record).

## Correction history (two passes, both reviewer-driven)

### First-pass corrections (already committed at `50ab34c97`)

1. **`runId` lifecycle contradiction** — claimed `LocalRuntimeHost.runTurn(runId, ...)` constructs the runId at `runTurn` entry. Inspection of `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1223` proves `runTurn(input: SendSessionInput)` takes NO `runId` parameter; the `runId` is created at `sdk/packages/agents/src/agent-runtime.ts:1500` via `this.state.runId = createUID("run")` INSIDE `execute()`.

2. **`taskId` left as UNVERIFIED** — the real source `this.options.getTask?.()?.taskId` is provably equivalent to `activeSession.sessionId` per the explicit assignment at `sdk-provider-change-coordinator.ts:144-145`.

3. **`terminalKind` rule depended on whichever session was active at finalize time** — re-derived ownership relative to current state. `job.ownerSessionId` is the authoritative stable per-job identity.

4. **`submitId` / `completionId` named as if they were durable IDs** — renamed to `SUBMIT_EVENT_ID` / `COMPLETION_COMMIT_EVENT_ID` to reflect their actual lifetime as coordinator-local counters.

### Second-pass corrections (THIS COMMIT — reviewer P0 temporal honesty)

The first-pass correction still proposed `runId` on `execute_turn_prelude_enter` and on the caller-side `onRunTurnStarted` C7 hook. Reviewer correctly flagged that this would manufacture identity: at those boundaries the `runId` does NOT yet exist. The corrected contract is temporally honest — every identity field on every event corresponds to a fact that genuinely exists at the seam where the event fires.

5. **`runId` on `execute_turn_prelude_enter` is temporal smuggling** — the prelude capture is fired at `local-runtime-host.ts:2136` (the first executable line of `executeTurn`, before the first await). `AgentRuntime.execute()` mints `runId` at `agent-runtime.ts:1500`, which runs AFTER `executeTurn`'s prelude awaits (`prepareTurnInput`, `ensureSessionPersisted`, `refreshActiveSessionGitMetadata`, `syncOAuthCredentials`, `markTurnRunning`, then `executeAgentTurn` → `agent.run` → `AgentRuntime.execute`). The `runId` genuinely does not exist at the prelude boundary. Carrying `runId` on prelude would be retroactively attaching a future fact to a past record — exactly the chronology→identity promotion the ACT forbids. **FIX**: drop `runId` from prelude; the prelude record is captured WITHOUT `runId`, and the replay adapter returns `INSUFFICIENT_IDENTITY` for it. The Elm kernel never sees `execute_turn_prelude_enter` in replay. Accepted trade: the kernel's `PRELUDE_STALL` discriminator (Authority.elm handleExecuteTurnPreludeEnter path at lines 140-147) becomes unobservable in replay; the diagnostic value is preserved in the CCARD capture buffer for offline analysis. The kernel's `activeRun` state is set by the later `run_started` handler (Authority.elm handleRunStarted at lines 150-169), which performs the same effective transition, so no authority invariant is lost.

6. **`runId` on the caller-side C7 `onRunTurnStarted` is temporal smuggling** — the C7 capture is fired at `vscode-session-host.ts:531-540`, threaded through `local-runtime-host.ts:1278-1284` immediately before `executeTurn(...)`. C7 fires BEFORE `executeTurn` enters, which is BEFORE `AgentRuntime.execute()` runs, which is BEFORE `runId` is minted. **FIX**: C7 caller-side capture is REPLACED by a single snapshot-listener-based `run_turn_started` event that fires on the first `"run-started"` event from `subscribeRuntimeEvents`. ONE authority, fired at the ONLY boundary where `runId` genuinely exists. The previous caller-side C7 capture is removed from the Elm contract; it can stay in production for non-Elm observability, but its records are never adapted to Elm.

7. **C7/C8 double-authority for `run_turn_started`** — both the caller-side `onRunTurnStarted` (C7) and the imagined runtime-snapshot listener would emit the same event, risking duplicates. **FIX**: one authority. The runtime-snapshot listener owns `run_turn_started`. The caller-side hook is removed from the Elm contract.

8. **`task_started` should fire at the real task-creation seam** — the previous contract proposed a "first C-stage fire for a previously-unseen activeSession" latch inside `SdkSessionEventCoordinator`. This fires only AFTER the first prompt round-trip; an Elm replay starting from `Idle` would see `run_turn_started` BEFORE `task_started`, which is structurally wrong regardless of identity quality. **FIX**: `task_started` fires at `SdkController.initTask` (file `SdkController.ts`, line 3558) immediately after `taskStart.initTask(...)` returns the `sessionId` (line 3586). The sessionId is the FACTUAL task identity at that instant — the `taskId` field is read as `sessionId` and provably equivalent to the eventual `task.taskId` (which is assigned to `startResult.sessionId` at every rebuild seam: `applyProviderConfigurationInstance:145`, `applyTypedProviderConfigurationInstance:273`, `performRestartActiveSessionForProviderChange:362`, `resumeSessionFromTask:322`, `performRebuildSessionForMode:318`).

9. **Option B (replay-order inference for prompt↔run join) violates "no manufactured identity"** — the previous contract listed Option B (`continuation_scheduled(P) then next run_turn_started(R) ⇒ infer P ↔ R`) as a fallback. Inference from event order is exactly the structural assumption the ACT was created to stop making; it cannot satisfy `MANUFACTURED_IDENTITY_COUNT=0` + `explicit prompt↔run correlation`. **FIX**: Option B is DELETED. Option A remains as the only path: the SAME runtime-snapshot listener that emits `run_turn_started` ALSO emits `continuation_started` IF AND ONLY IF a `promptId` is held by the SDK host from a prior `continuation_scheduled` capture AND the held `promptId` matches the session of the snapshot's sessionId. If no prompt is held, the event is dropped (no replay-order recovery). The capture contract is honest: `continuation_started` either carries both `promptId` and `runId` from a real seam, or it does not fire at all.

10. **`terminalKind` was still derived from later session state** — the first-pass rule `owned iff job.ownerSessionId === activeSession.sessionId` evaluated ownership relative to whichever session was active at finalize time. That's time-relative, not launch-time. **FIX**: there is NO launch-time immutable `launchOwnershipKind` field on `CommandJob` today. Adding one would be a production semantic change (a new field on a production record). Per the reviewer's rule "TERMINAL_KIND_SOURCE=UNAVAILABLE until you add a diagnostic-only factual marker at job creation, not finalize", `terminalKind` is `UNAVAILABLE` for v1 of this ACT. The replay adapter already returns `INSUFFICIENT_IDENTITY` for `terminal_committed` without `terminalKind` (adapter lines 139-145); therefore the Elm kernel never sees `terminal_committed` in v1 of this ACT. The CCARD buffer still records the capture (with `ownerId = job.ownerSessionId` as the only terminalKind provenance that actually exists today), but the Elm kernel only sees `terminal_observed` events, which carry `jobId` only and are sufficient to express "terminal fired" without committing to an ownership kind. Followup: a successor ACT may add `launchOwnershipKind: "owned" | "background_not_owned"` to `CommandJob` at job creation time (a small, documented production change) and lift `terminalKind` from UNAVAILABLE to NEW_ID_AT_EVENT_CREATION.

## Final identity map

### 1. `runId` — for `run_turn_started` and `agent_turn_done` ONLY (NOT for prelude)

**Source**: a `SessionRuntime`-level state field set at `sdk/packages/agents/src/agent-runtime.ts:1500` (`this.state.runId = createUID("run")`) INSIDE `execute()`, AFTER `LocalRuntimeHost.runTurn` → `executeTurn` (prelude + 5 awaits) → `executeAgentTurn` → `agent.run`. The `runId` is observable from the runtime snapshot (`agent-runtime.ts:1045`: `runId: this.state.runId`) which propagates via `LocalRuntimeHost.subscribeRuntimeEvents`.

**Classification**: `PROVEN_EQUIVALENT_EXISTING_ID` — the `runId` is the agent-runtime's run identity; the CCARD capture will surface the SAME value the runtime emits.

**Lifetime**: same as one `agent-runtime.execute()` invocation. One `runId` per `agent.run()` call (one run).

**Correlates with**:
- `promptId` (set at `continuation_scheduled`) → join via the SDK host's runtime-snapshot listener; the `promptId` is held by the SDK host from the `continuation_scheduled` capture until the first `run-started` snapshot for that prompt's session.
- `taskId ≡ sessionId` (one task = one or more runs; `task_started` fires before any `run_turn_started`).

**Production seam for surfacing**: a NEW `subscribeRuntimeEvents` listener on `LocalRuntimeHost` (added by §21 at `vscode-session-host.ts`) that:
- On the FIRST `"run-started"` event for a given sessionId-after-task-start: emits `run_turn_started { runId, origin }` where `runId = event.snapshot.runId` and `origin` is derived from the most-recent `continuation_scheduled` capture (held prompt's origin) or `explicit_user` if no held prompt.
- On the FIRST `"run-finished"` or `"run-failed"` event after the corresponding `"run-started"`: emits `agent_turn_done { runId }` where `runId = event.snapshot.runId`.

This is the SOLE authority for `run_turn_started` and `agent_turn_done` carrying `runId`. The caller-side C7 capture (`onRunTurnStarted` at `vscode-session-host.ts:531-540`) is removed from the Elm contract; it can remain in production for non-Elm observability but its records are never adapted to Elm.

**Classification on `execute_turn_prelude_enter`**: `UNAVAILABLE`. The prelude capture at `local-runtime-host.ts:2136` fires before `runId` is minted. The CCARD buffer still records `execute_turn_prelude_enter` (without `runId`) for offline diagnostic value, but the replay adapter returns `INSUFFICIENT_IDENTITY` and the Elm kernel never sees the event. Accepted trade: the kernel's `PRELUDE_STALL` discriminator is unobservable in replay; the diagnostic value is preserved in the CCARD capture buffer. The kernel's `activeRun` state is set by the later `run_started` handler (Authority.elm lines 150-169), which performs the same effective transition — no authority invariant is lost.

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

### 4. `ownerId` + `terminalKind` — for `terminal_committed` (second-pass correction)

**Source**: `CommandJobManager.finalize` at line 2657-2661 (the C1 capture). The job's `ownerSessionId` is set at LAUNCH time in `CommandJobManager.start()` (per the `CommandJob.ownerSessionId` field declaration at `command-job-manager.ts:982-984` and the private helper capability at lines 1884-1886), so it is the authoritative stable per-job identity. NOT recomputed at finalize.

**Classification**:
- `ownerId` = `DIRECT_EXISTING_ID` — `job.ownerSessionId` is the same value from launch to finalize. PROVEN.

- `terminalKind` = `UNAVAILABLE` (v1 of this ACT). **There is no launch-time immutable `launchOwnershipKind` field on `CommandJob` today.** The first-pass rule (`owned iff job.ownerSessionId === activeSession.sessionId`) was time-relative and therefore forbidden. Until a successor ACT adds an immutable `launchOwnershipKind` field at job creation time (a small, documented production change), `terminalKind` cannot be reconstructed without manufacturing identity. The replay adapter already returns `INSUFFICIENT_IDENTITY` for `terminal_committed` without `terminalKind` (adapter lines 139-145); the Elm kernel never sees `terminal_committed` in v1. The CCARD capture still includes `ownerId: job.ownerSessionId` (which is a real, durable fact) and the Elm kernel sees `terminal_observed` events (which carry `jobId` only — sufficient to express "terminal fired" without committing to an ownership kind).

**Lifetime**: `ownerId` is the launch-time immutable owner identity (stable from `start()` to `finalize()`).

**Reachability**: `CommandJobManager.finalize` already has `job.ownerSessionId` (stable from launch). The CCARD capture site is unchanged (line 2657); the only change is to include `ownerId: job.ownerSessionId` in the capture payload. The `terminalKind` field is omitted from the capture payload (rather than included with a misleading computed value).

### 5. `taskId` — for `task_started` (new event, second-pass correction)

**Source**: `sessionId` returned from `taskStart.initTask(...)` at `SdkController.initTask` line 3586. The sessionId is the FACTUAL task identity at that instant — the production code explicitly assigns `task.taskId = sessionId` at every rebuild seam, so `taskId ≡ sessionId` is PROVEN.

**Classification**: `PROVEN_EQUIVALENT_EXISTING_ID` with `taskId ≡ sessionId`.

**Proof**:
- `sdk-provider-change-coordinator.ts:144-145`: `if (task && task.taskId !== startResult.sessionId) { task.taskId = startResult.sessionId }` — the production code explicitly assigns `task.taskId = sessionId` at session start. Same pattern at `applyTypedProviderConfigurationInstance:273`, `performRestartActiveSessionForProviderChange:362`, `resumeSessionFromTask:322`, `performRebuildSessionForMode:318`.
- The Elm kernel uses `TaskRef` separately from `OwnerRef`, but per §13 the ACT treats `(sessionId, taskId)` as a proven pair at the diagnostic level.

**Capture seam (CORRECTED second pass)**: `SdkController.initTask` line 3558, immediately after the `await this.taskStart.initTask(...)` returns the `sessionId` at line 3586. The capture emits `task_started { taskId: sessionId }` BEFORE any subsequent `runTurn` cycle for that session. This is the EARLIEST reliable task-creation seam — earlier than the first C-stage fire inside `SdkSessionEventCoordinator` (which would only fire after the first prompt round-trip). The capture is gated by the same `captureEnabled` flag as the other CCARD hooks; no new flag is added.

**Lifetime**: same as the task. One `task_started` per task, by ACT §13 invariant. The §21 implementation adds the capture at the new seam (no one-shot latch inside `SdkSessionEventCoordinator`).

**Capture semantics**: `task_started` fires once per task lifetime boundary. If a task is reopened (session reconstruction), the `sessionId` carries over (so no new `task_started` is emitted — the conservation tests at §26 will pin this).

### 6. `continuation_started` — Option A ONLY (Option B deleted by reviewer)

**Decision (second pass)**: Option B is DELETED. Replay-order inference (`continuation_scheduled(P) then next run_turn_started(R) ⇒ infer P ↔ R`) violates the ACT's "no manufactured identity" rule; it cannot satisfy `MANUFACTURED_IDENTITY_COUNT=0` + `explicit prompt↔run correlation`.

**Option A (single remaining design)** — wait for the runtime snapshot, emit from the SAME listener:
```
1. continuation_scheduled { promptId: P }          ← vscode-session-host C6 capture; SDK host HOLDS P keyed by sessionId
2. (dispatch → runTurn → executeTurn → agent.run creates runId at agent-runtime.ts:1500)
3. SDK host observes first run-started snapshot       ← via subscribeRuntimeEvents, at the ONLY boundary where runId exists
4. continuation_started { promptId: P, runId: R }    ← SDK host emits at step 3 ONLY IF a held P matches this snapshot's sessionId
5. run_turn_started { runId: R }                     ← SDK host emits at step 3 (unconditional)
```

Both events are emitted from the SAME SDK-host runtime-event listener, after the agent-runtime snapshot is observable. The prompt↔run join is exact because the SDK host holds `P` from step 1 until step 3, and only emits `continuation_started` when a held `P` matches the snapshot's sessionId.

If no held prompt matches the snapshot's sessionId (e.g., the user submitted a fresh prompt via `runTurn(input)` directly, without going through `pendingPromptsController`), the listener does NOT emit `continuation_started` — the event simply does not fire in that case. No replay-order recovery.

Pros: no production semantic change; `runId` is the genuine value the runtime emits. Cons: requires adding one `subscribeRuntimeEvents` listener to the SDK host wiring (this is the same listener that emits `run_turn_started` and `agent_turn_done`).

**Classification**:
- `continuation_started.runId` = `PROVEN_EQUIVALENT_EXISTING_ID` (runtime snapshot.runId, surfaced through subscribeRuntimeEvents).
- `continuation_started.promptId` = `DIRECT_EXISTING_ID` (held by SDK host from the C6 capture, scoped to the next run-started snapshot for the same session).
- If no held prompt matches: event does NOT fire (no `UNAVAILABLE` substitute event).

### 7. `completion_presented` (optional, new event) — only if the §21 implementation can prove the same `COMPLETION_COMMIT_EVENT_ID` is reachable at the presentation seam

**Source**: the same `COMPLETION_COMMIT_EVENT_ID` from the most recent C10 fire.

**Classification**: `PROVEN_EQUIVALENT_EXISTING_ID` — presentation reuses the commit's identity.

**Optional**: per §6, this is "optional but desirable. Only add it if a real identity already exists at that seam." The bounded implementation may skip this event entirely if the §18 RED tests do not require it.

## Field-by-field classification summary (TEMPORALLY HONEST — second pass)

```
FIELD                       SOURCE_VARIABLE                              CREATION_SEAM                                    LIFETIME       CORRELATES_WITH                  CLASSIFICATION
runId                       agent-runtime this.state.runId               agent-runtime.ts:1500 (after prelude awaits)     one run        continuation_started.runId        PROVEN_EQUIVALENT_EXISTING_ID
                                                                                                                          promptId (via SDK host snapshot path)
runId (prelude)             — UNCHANGED — runId does NOT exist at        local-runtime-host.ts:2136                       (n/a)          (n/a)                            UNAVAILABLE
                            executeTurn's prelude boundary (mint
                            happens at agent-runtime.ts:1500 AFTER
                            prepareTurnInput / ensureSessionPersisted
                            / refreshActiveSessionGitMetadata /
                            syncOAuthCredentials / markTurnRunning /
                            executeAgentTurn → agent.run →
                            AgentRuntime.execute). Prelude records
                            are captured WITHOUT runId for offline
                            diagnostic value; the replay adapter
                            returns INSUFFICIENT_IDENTITY for them.
SUBMIT_EVENT_ID             coordinator-local nextSubmitSeq counter      SdkSessionEventCoordinator C9 fire              one attempt    COMPLETION_COMMIT_EVENT_ID (N:1)  NEW_ID_AT_EVENT_CREATION
COMPLETION_COMMIT_EVENT_ID  coordinator-local nextCompletionSeq counter SdkSessionEventCoordinator C10 fire             one commit     SUBMIT_EVENT_ID (N:1)             NEW_ID_AT_EVENT_CREATION
ownerId                     job.ownerSessionId (set at launch)           CommandJobManager.start()                       one job        (terminalKind unavailable)        DIRECT_EXISTING_ID
terminalKind                — NO launch-time immutable launch-          CommandJobManager.finalize                      one job        (n/a)                            UNAVAILABLE (v1)
                            OwnershipKind field on CommandJob today.                                                                                                              FOLLOWUP: successor ACT
                            Production semantic change required to
                            add it; v1 simply omits terminalKind
                            and accepts the kernel never sees
                            terminal_committed.
taskId                      sessionId returned from taskStart.initTask    SdkController.initTask line 3586                one task       sessionId (PROVEN_EQUIVALENT)    PROVEN_EQUIVALENT_EXISTING_ID
                            (= task.taskId by 5 explicit assignments
                            at rebuild seams)
promptId (existing)         PendingPromptsController.enqueue             PendingPromptsController.enqueue                one prompt     continuation_started.promptId    DIRECT_EXISTING_ID
jobId (existing)            CommandJobManager                            CommandJobManager (job creation)                one job        ownerId                           DIRECT_EXISTING_ID
sessionId (existing)        coordinator-tracked active session           SdkSessionEventCoordinator active session       one session    taskId (PROVEN_EQUIVALENT)       PROVEN_EQUIVALENT_EXISTING_ID
```

**No manufactured IDs.** Every identity field on every event corresponds to a fact that genuinely exists at the seam where the event fires. **No origin rewrites.** **No UNVERIFIED classifications.** **No classifications based on `activeSession` state consulted at finalize time.** **No chronology→identity promotion** (every event's identity is observable at the moment the event is captured, not retroactively attached from a later fact).

## What this ACT will and will not capture in v1

**Captured (CCARD buffer) and replayed to Elm** (assuming all required fields exist at the seam):
- `task_started`, `pending_prompt_*`, `continuation_scheduled`, `run_turn_started`, `continuation_started` (when prompt is held), `agent_turn_done`, `submit_and_exit_seen`, `task_completion_committed`, `terminal_observed`, optionally `completion_presented`.

**Captured (CCARD buffer) but DROPPED at the replay adapter** (INSUFFICIENT_IDENTITY, never reaches the Elm kernel):
- `execute_turn_prelude_enter` (no `runId` at the prelude boundary).
- `terminal_committed` (no `terminalKind` because no launch-time immutable field exists).

**Not captured at all**:
- (no event categories are skipped)

## Reviewer P0 closure

This second-pass §5 closes all four reviewer P0 demands (temporal honesty for `runId`; single authority for `run_turn_started`; `task_started` at the real task-creation seam; delete Option B). It also closes reviewer P1 (`terminalKind` UNAVAILABLE rather than time-relative). It does NOT introduce any production semantic change and does NOT touch the Elm kernel.

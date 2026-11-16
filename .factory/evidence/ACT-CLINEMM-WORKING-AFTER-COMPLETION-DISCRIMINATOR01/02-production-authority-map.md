# 02 — Production authority chain (installed source revision `1d9a37bcd`)

All line references are resolved against the **installed build's source revision `1d9a37bcd`**
(`git show 1d9a37bcd:<path>`), which is byte-identical to repo HEAD `b1ad2a0de` on this seam.

---

## C2.1 — Runtime turn settlement → `ActiveSession.isRunning`

### The read-only MCP seam

`apps/vscode/src/sdk/control-seam/control-seam-authority.ts` is the **only** module that reads
the controller's session ownership for `clinemm_get_run`. Its contract is stated in the module
header (lines 5–19):

```
 *   - the ACTIVE session owner  -> `SdkSessionLifecycle.getActiveSession()`
 *   - the host's own run mirror  -> `ActiveSession.isRunning`
 *   - the host's own queued count -> `ActiveSession.queuedPromptCount`
 *   - the canonical runtime state -> `VscodeSessionHost.runtimeSnapshot()`
```

`readControlSeamRunIdentity()` (lines 78–99) builds the payload:

```ts
const sessionId = authority.readActiveSessionId()
if (!sessionId) { return undefined }
const snapshot = authority.readRuntimeSnapshot()
const taskId  = authority.readActiveTaskId()
const runtimeStatus = snapshot?.status
const runId   = snapshot?.runId
return {
    sessionId,
    running: authority.readIsRunning(),      // ← ActiveSession.isRunning
    queuedPromptCount: authority.readQueuedPromptCount(),
    ...(taskId !== undefined ? { taskId } : {}),
    ...(runtimeStatus !== undefined ? { runtimeStatus } : {}),
    ...(runId !== undefined ? { runId } : {}),
}
```

**Three independent facts are reported:**

| Field | Source | Meaning |
|---|---|---|
| `running` | `ActiveSession.isRunning` | "a turn is in flight for the active session" |
| `runtimeStatus` | `AgentRuntime.snapshot().status` | the canonical runtime's own status |
| `runId` | `AgentRuntime.snapshot().runId` | the canonical runtime's current run reference |

**`running` is NOT the committed task phase.** `isRunning` is the *host's own mirror of whether
the SDK is currently executing a turn*. The committed phase lives in a completely separate
authority — `TurnStateTracker` (`apps/vscode/src/sdk/turn-state-tracker.ts`), reachable by the
webview through `turnState` / `taskHeaderPresentation` in the state payload.

### What transitions `isRunning` to false

`apps/vscode/src/sdk/sdk-session-lifecycle.ts:315–326`:

```ts
setRunning(isRunning: boolean): void {
    const activeSession = this.activeSession
    if (!activeSession || activeSession.isRunning === isRunning) { return }
    activeSession.isRunning = isRunning
    if (isRunning) {
        this.turnGeneration += 1
    } else {
        this.options.onDidBecomeIdle?.()
    }
}
```

**Answers to the C2.1 questions:**

- **Which event transitions `isRunning` to false?** `SdkSessionLifecycle.setRunning(false)`,
  invoked when a turn settles. The `false` transition additionally fires `onDidBecomeIdle`.
- **Does the event represent turn settlement, task completion or session teardown?**
  **Turn settlement.** The lifecycle's `setRunning(false)` is the *turn* boundary; the
  *task* terminal phase (`completed`) is a separate, independently-owned decision that lives
  behind the C10/BCB/Elm authority chain. `setRunning(false)` is called on the deferred
  completion release path too (`sdk-session-event-coordinator.ts:3015`), i.e. it is a
  **necessary but not sufficient** condition for completion.
- **Can a new turn begin without replacing the session?** **Yes.** Epoch 3 → epoch 4 in the
  incident are the same session id `1794840293250_5ugld` with a bumped epoch — the same
  session, a new turn. The incident's epoch-4 turn is the BCB continuation.
- **May `runId` disappear while the session remains active?** **Yes.** `runId` and
  `runtimeStatus` come from `AgentRuntime.snapshot()`. A session that has settled its last
  turn but is still installed (`getActiveSession()` returns it) and has not been torn down
  reports `running: false` with `runtimeStatus`/`runId` **omitted** — exactly the observed
  MCP shape. `readControlSeamRunIdentity` deliberately **omits** undefined optional fields
  rather than serialising them as `null` (comment at lines 84–87).
- **Can a runtime snapshot be absent during legitimate continuation?** **Yes.** `snapshot` is
  `undefined` whenever the runtime has no live `AgentRuntime` instance for the session —
  including the window between the end of one turn and the start of the next. The
  `readRuntimeSnapshot` contract (lines 60–65) documents `undefined` as a normal outcome.

---

## C2.2 — Background command authority (the incident's actual job IDs)

The transcript's own `command_status` calls are the authoritative job records. Three distinct
job IDs appear; **none** was probed by PID (per the ACT's constraint).

| Job ID | First observed | Terminal observed | Owner | Terminal outcome |
|---|---|---|---|---|
| `cmd_mwjdxjir67zetryn` | 17:56:59 `state=running` elapsed=117 019 ms | **18:00:07 `state=exited`** elapsed=305 641 ms `exitCode=0` | session `1794840293250_5ugld` | clean exit, stdout `EXIT=1` (vitest run) |
| `cmd_mwjdtjh6hmr62k75` | (launched ~17:51:55) | **18:00:46 `state=exited`** elapsed=530 595 ms `exitCode=0` | same | clean exit — **this was the job BCB HELD** |
| `cmd_mwje567ijng81j18` | **18:00:52 `status=running`** (launched) | **18:03:56 `state=exited`** elapsed=177 955 ms `exitCode=0` | same | clean exit — **this was the job BCB HELD #2** |

**Reconciliation state per job (from the transcript):**

- `cmd_mwjdtjh6hmr62k75`: held by BCB at 18:00:43 → the host injected the
  `completion_continuation_control` prompt naming it → the model called `command_status` at
  18:00:46 → **observation consumed**.
- `cmd_mwje567ijng81j18`: held by BCB at 18:03:30 → continuation prompt → model called
  `command_status` at 18:03:37 (interrupted by a user `Continue`) and again at 18:03:56 →
  **observation consumed**.

**Was the obligation outstanding at the completion decision?**

**NO.** The incident store's own `c10_reevaluated` records — captured by the production code at
the authoritative re-evaluation boundary — state, for **every** re-evaluation:

```json
"detail": {
  "remainingBlockingJobCount": 0,
  "unconsumedTerminalCount": 0,
  "ownerStillRunning": false,
  "heldObligation": false,
  "outstandingAutonomousWork": false
}
```

That is true for **6** re-evaluations in epoch 3 (`firstSeenAt` 15:00:46.077Z →
`lastSeenAt` 15:03:37.303Z) **and** for the epoch-4 re-evaluation at 15:04:29.118Z.

**Process containment / terminal signal:** every job reached `state=exited` with
`exitCode=0` in the transcript. The `remainingBlockingJobCount: 0` capture is the production
code's own owner-scoped containment classifier (`unresolvedContainmentFailuresForOwner`)
reporting **no** unresolved containment failure.

**Distinctions preserved (per the ACT):** `signal attempted ≠ process terminated ≠
process-group absent ≠ manager terminal ≠ obligation reconciled`.
For this incident the **only** facts available are: the manager reported `state=exited`; the
host's own classifier reported zero unresolved containment failures; the model's observation of
the terminal result was recorded by the host as consumed. **A direct process-group-absence
---

## C2.3 — C9/C10 and BCB completion authority

### The completion-intent recognition

The model's `submit_and_exit` tool call is the completion *intent*. The host recognises it
through `messageTranslatorState.wasAttemptCompletionSeen()` plus
`wasTerminalResponseCommittedThisTurn()` — the two conjuncts of the C9/C10 gate
(`sdk-session-event-coordinator.ts:4709–4718`):

```ts
} else if (this.options.messageTranslatorState.wasAttemptCompletionSeen()) {
    if (this.options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()) {
        // → C10 completion candidate
```

The transcript shows the intent twice (18:00:43 and 18:04:29), each acknowledged by
`submitted (verified=true)`. **The intent was correctly recognised on both occasions.**

### The BCB hold — where terminal commitment was withheld (FIRST withhold)

At 15:00:43.541Z the BCB hold fired. The incident store's epoch-3 record is explicit:

```json
{
  "stage": "held_phase_published",
  "outcome": "held_phase_published",
  "timestamp": "2026-11-16T15:00:43.541Z",
  "detail": { "holdReason": "held_obligation",
              "phaseWriter": "session-event-bcb-hold-resumable" },
  "observedPhase": "resumable",
  "completionCommitted": false
}
```

Production code: `sdk-session-event-coordinator.ts:5150–5203` — the BCB-hold branch writes
`resumable` through the writer `session-event-bcb-hold-resumable` (line 5202):

```ts
if (preservedReason !== "observation_unavailable") {
    this.bcbHoldResumablePublished = true
    ...
    this.options.setTurnPhase?.("resumable", undefined, "session-event-bcb-hold-resumable")
}
```

**⇒ C9/C10/BCB correctly WITHHELD terminal commitment at 18:00:43**, because
`cmd_mwjdtjh6hmr62k75`'s terminal result had not yet been observed by the model. This is
**class B behaviour (legitimate BCB hold)** and it is CORRECT.

### The continuation-entry reseed — where `resumable` was superseded

The BCB hold's `resumable` is the *truthful* state **only until the host-owned continuation
starts**. At `sdk-session-event-coordinator.ts:4344–4370`:

```ts
const barrierHoldsThisTurn = this.isDeferredCompletionBarrierLiveFor(activeSession.sessionId)
const promptIsHostOwnedContinuation = event.payload.runtimeControlKind === "completion_continuation_control"
if (barrierHoldsThisTurn && promptIsHostOwnedContinuation) {
    // ACT-CLINEMM-PREMATURE-PAUSED-BCB-REPRO-REPAIR01:
    // The BCB hold's `resumable` is the truthful state
    // BEFORE the automatic continuation starts. Once the
    // host-owned continuation is submitted, however, the
    // SAME session owns active forward progress. Leaving
    // the committed phase at `resumable` projects the
    // user-facing "Resume Task" button while that automatic
    // work is active ...
    this.options.setTurnPhase?.(
        PROVIDER_FAILURE_PHASE.STREAMING,
        undefined,
        "session-event-pending-prompt-submitted",
    )
    this.bcbHoldResumablePublished = false
}
```

This is the **designed** reseed: while the continuation turn is genuinely running, the phase
SHOULD be `streaming` ("Working"), because the session *is* actively working. **The reseed is
NOT itself the defect** — the continuation really was running (the model was polling
`command_status` for 3+ minutes).

### The deferred release — where the commit SHOULD have happened (second withhold)

`reevaluateDeferredCompletionBarrier()` (`sdk-session-event-coordinator.ts:2245`) is the
**only** writer of a terminal phase for a held obligation (per the PTWCR01C01 comment at
lines 5109–5115). Its sequence:

| Step | Line | Action |
|---|---|---|
| 1 | 2418–2422 | read pending-prompt authority + count |
| 2 | 2431–2453 | per-job notify/wake authority |
| 3 | 2454–2455 | `outstandingAutonomousWork` aggregate |
| 4 | 2466–2500 | `ownerStillRunning` → early return if true |
| 5 | 2514–2549 | unconsumed-owned-terminal count AND ids → `heldObligation` |
| 6 | 2575–2648 | `heldObligation` → enqueue continuation, early return |
| 7 | 2649–2684 | `outstandingAutonomousWork` → early return |
| 8 | 2702–2707 | `perJobSuppressOriginatingCompletion` → early return |
| 9 | **2759** | **`captureAutomaticIncident({stage:"c10_reevaluated"})`** |
| 10 | 2775–2831 | unresolved containment failure → early return |
| 11 | **2883** | **`checkElmCompletionAuthority("session-event-turn-complete-completed")`** |
| 12 | 2961 | `setTurnPhase("completed", …, "session-event-turn-complete-completed")` |
| 13 | 3015 | `sessions.setRunning(false)` |
| 14 | 3068–3079 | `captureAutomaticIncident({stage:"completion_committed"})` |
| 15 | 3094 | `postStateToWebview()` (the publication the ACT §C7 requires) |

**The incident's epoch-4 record proves execution reached step 9 and stopped before step 14.**
The `c10_reevaluated` observation is present; the `completion_committed` observation is
**absent**; no `completed` publication exists.

### `checkElmCompletionAuthority` — the actual withholding gate

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1870–2005`. At the installed revision the
Elm authority is the FINAL gate and it is **fail-closed**:

```ts
try { await this.options.flushElmAuthorityForSession?.(sessionId ?? "") }
catch (err) { ...; return false }                       // flush throw → withhold
try { decision = this.getElmCompletionAuthorityDecision(sessionId) }
catch (err) { ...; return false }                       // provider throw → withhold
if (decision.kind === "authorize") return true
if (decision.kind === "hold") { ...; return false }     // HOLD → withhold
... return false                                        // FAILURE → withhold
```

At the installed revision `1d9a37bcd` the provider is
`ElmAuthorityModule.getElmAuthorityCompletionDecision` (`SdkController.ts:3137–3138`), and
`getElmAuthorityCompletionDecision` (`completion-authority-elm-authority-runtime.ts:242–256`)
returns a **fail-closed `failure`** when the runtime is not enabled — there is **no
default-Authorize fallback** (removed by
`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY`, `0b7da0cee`).

**Elm authority WAS enabled for the incident:** `extension.ts:669` calls
`initializeElmAuthorityRuntime(elmAuthorityKernelPath)` unconditionally (no env gate at this
revision), the kernel path is
`path.join(context.extensionUri.fsPath, "runtime-assets", "completion-authority.js")`, and
that file **is present** in the installed extension (107 835 B).

### The Elm hold reasons

`apps/vscode/elm/completion-authority/src/Authority.elm:499–592` — `computeHoldReasons`:

```
[ if activeRunHeld            then Just ActiveRun
, if pendingPromptHeld        then Just PendingPrompt
, if scheduledContinuationHeld then Just ScheduledContinuation
, if unconsumedTerminalHeld   then Just UnconsumedTerminalObservation
, if runningBackgroundJobHeld then Just RunningBackgroundJob ]
```

`handleAgentTurnDone` (lines 185–198) clears `activeRun` **only when the closing run ref
matches** `model.activeRun`, and consumes the matching prompt. The known withheld shape
(`completion-incident-2026-11-05T18-16-35-773Z/completion-authority.jsonl`) is:

```json
{"stage":"completion_authority","outcome":"withheld",
 "predicates":{"elmDecision":"hold","elmReason":"active_run"}}
```

followed by `authorized` + `committed`.

**The incident's Elm reason is `UNAVAILABLE_FROM_TRACE`.** The `completion_authority` stage is
emitted **only** through `captureIncident` (the BCB *flight recorder*), never through
`captureAutomaticIncident` (the *automatic incident store*) — so its absence from the incident
store proves nothing either way. The BCB flight-recorder capsule for this session was
**never checkpointed**: `completion-incident-checkpoint.json` has `savedAt =
2026-11-16T12:37:50.009Z` (before the incident) and `capsuleDroppedRecords: 4416`, and the
extension host PID 98318 is still running so no shutdown checkpoint has been written.

**What is NOT `UNAVAILABLE_FROM_TRACE`:** that the commit was withheld at step 11, that the
Elm authority was enabled, and that the Elm decision was `hold` or `failure` (not
`authorize`) — because `authorize` would have produced steps 12–15 and therefore a `completed`
publication, which the runtime-diag trace proves did not happen.

### Post-terminal reconciliation / re-evaluation — why it did not rescue the commit

The epoch-4 marker was re-registered under the **current** epoch by the Elm-HOLD branch
(lines 2883–2900):

```ts
if (!(await this.checkElmCompletionAuthority("session-event-turn-complete-completed"))) {
    this.deferredCompletionBarrier = {
        sessionId: activeSession.sessionId,
        taskId: this.options.getTask?.()?.taskId,
        epoch: this.options.messageTranslatorState.getMinter().epoch,
        deferredAt: Date.now(),
    }
    return
}
```

**This explains the epoch 3 → epoch 4 marker transition.** The epoch-4 incident record
(`barrierId: barrier-coord-1-…-4-5`, `epoch: 4`) is a *fresh* marker registered by this
branch, and its `c10_reevaluated` observation at 15:04:29.118Z is the *next* re-evaluation
against it. Its all-clear predicates prove the **conservation** half of the gate was satisfied;
the **authority** half (Elm) was not.

The re-evaluation triggers available at the installed revision:

| Trigger | Wired at | Gated on Elm authority? |
|---|---|---|
| `setRunning(false)` → `onDidBecomeIdle` → `maybeReevaluateDeferredContinuation` → `reevaluateDeferredCompletionBarrier()` | `SdkController.ts:6373` (in `maybeReevaluateDeferredContinuation`) | **NO** |
| `notifyAgentTurnDone` (post-run liveness seam) | `SdkController.ts:3183–3185` (via `setAgentTurnDoneSemanticTrigger`) | **NO** — the `isElmAuthorityEnabled()` early-return that commit `5a1c485cb` added was **removed** by `0b7da0cee` (REMOVE-LEGACY-TS-AUTHORITY); at the installed revision the trigger fires unconditionally |

**⇒ At the installed revision BOTH re-evaluation triggers are ungated.** The
`notifyAgentTurnDone` trigger is the seam that was *designed* to rescue an Elm HOLD once
`activeRun` is cleared by `agent_turn_done` (see the commit-`5a1c485cb` docstring: *"If Elm now
AUTHORIZEs (because `activeRun` was just cleared by step 1), commit fires exactly once"*).

**The remaining question is therefore narrow and concrete:** if `notifyAgentTurnDone` fired
after the final `agent_turn_done` (18:04:29), then the Elm model should have had `activeRun`
cleared, `computeHoldReasons` should have returned `[]`, and the decision should have been
`authorize` — which would have committed `completed`. It did not. Either the trigger did not
fire, or the Elm model still carried a hold reason (e.g. a `PendingPrompt` for the host-owned
continuation, which `handleAgentTurnDone` consumes **only when the closing run ref matches**
`model.activeRun`).

Whether the trigger fired and what the Elm model held is `UNAVAILABLE_FROM_TRACE` — the CCARD
`agent_turn_done` record for this session is absent (the CCARD jsonl is stale, Nov 3) and the
BCB flight-recorder capsule was never checkpointed.

---

## C2.4 — Persistence

Read through the existing read-only repository/runtime mechanism (the session JSON on disk).
**No write** was performed to the live session database (`db/sessions.db`) or to the session
directory.

| Distinction | Observed |
|---|---|
| Persisted `completed` | **YES** — `sessions/1794840293250_5ugld/1794840293250_5ugld.json` → `"status": "completed"`, `"exit_code": 0`, `"ended_at": "2026-11-16T15:09:34.312Z"` |
| Persisted nonterminal status | **NO** |
| Missing status | **NO** — the field is present and populated |
| Read failure | **NO** — read succeeded (SHA-256 recorded in §00) |
| Stale / mismatched session identity | **NO** — `session_id` and `pid` (98318) match the extension host that produced every other artifact |

**A synthetic `completion_result` message was NOT treated as persisted completion.** The
persisted `status: "completed"` here is the **session-process** status written by the session
runner when the agent session terminated with exit code 0 at 15:09:34.312Z. It is a
**session-lifecycle** fact, and it is **independent of the C10 turn-phase commit**: the
runtime-diag trace proves no `completed` **turn phase** was ever committed or published for
this task, while the session JSON says `status: "completed"`.

**This divergence is itself a finding:** the *session process* recorded terminal completion at
18:09:34, but the *task phase* authority never committed a terminal phase and the webview kept
rendering `streaming`. The persisted session status is **not** evidence of C10 completion and
must not be read as such.

---

## C2.5 — Summary of the authority chain for THIS incident

```
model output (submit_and_exit)                       18:00:43.531  INTENT ✓ recognised
   ↓
completion authority decision (BCB hold)              18:00:43.541  WITHHELD (held_obligation) ✓ correct
   ↓ → phase write: resumable ("Paused")
background reconciliation (continuation enqueued)     18:00:43.574  held job cmd_mwjdtjh6hmr62k75
   ↓
host phase write: streaming (continuation entry)      18:00:4x  pubId 1607 (epoch 3) ✓ designed
   ↓
turn settlement → awaiting_followup                  18:00:46      pubId 1893 (epoch 3)
   ↓
background reconciliation #2                         18:03:30.993  held job cmd_mwje567ijng81j18
   ↓
all 7 c10_reevaluated: conservation ALL CLEAR        18:00:46 – 18:04:29  ✓
   ↓
completion authority decision (Elm)                   18:04:29.118  WITHHELD (hold|failure) ← the boundary
   ↓
host phase commit "completed"                        NEVER          ✗
   ↓
webview state publication                            NEVER          ✗ (last pub 1957 = streaming)
   ↓
Elm projection / visible UI                          18:06 screenshot: "Working" + Cancel
```

**⇒ The divergence is NOT "completion authority said yes and the UI said no".**
The completion authority said **NO** (twice: legitimately at 18:00:43, and at the Elm gate at
18:04:29), so no `completed` phase was ever committed, and the UI faithfully rendered the last
committed phase — `streaming` → **"Working"** + Cancel.

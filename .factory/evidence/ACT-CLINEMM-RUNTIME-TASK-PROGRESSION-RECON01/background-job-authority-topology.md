# ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 — Q1–Q5 BACKGROUND-JOB AUTHORITY BIND

## STATUS

```text
HEAD            = 5b97330fa
branch          = main
working tree    = clean
production Δ    = 0
git diff --check = pass
TYPECHECK       = clean
```

This artifact is the **single** bounded recon product for the
Q1–Q5 cycle mandated by the post-P1 reviewer disposition
(`PASS_WITH_ONE_P1_FIX / C1: GO_ARCHITECTURE_RECON`,
2026-09-02). One compact table-rich file per the prompt's §13.

The terminal stop state (per §14.B) is:

```text
AUTHORITY_IDENTITY_MISSING = PROVEN
  → STOP, no implementation
  → recommend narrow contract ACT

CASE_A           = STRONG_CANDIDATE / NOT ADJUDICATED
ROOT_CAUSE       = NOT YET ISOLATED
REPAIR_AUTHORIZED = NO
NEW_CHILD_ACT    = NO
```

See "§14 STOP STATE" at the bottom for the full disposition.

---

## Q1 — COMMANDJOBMANAGER OBJECT LIFETIME + CARDINALITY

### Cardinality table (mechanical answer, traced from
`apps/vscode/src/sdk/{command-job-manager,vscode-session-host,sdk-session-lifecycle,SdkController}.ts`)

| Object              | Constructed at | Cardinality | Destroyed/reset at | Survives task switch? | Survives session rebuild? | Survives controller lifetime? |
| ------------------- | -------------- | ----------: | ------------------ | --------------------- | ------------------------ | ----------------------------- |
| `CommandJobManager` | `vscode-session-host.ts:190` (inside `VscodeSessionHost.create()`) | **1 per host** | `SdkSessionLifecycle.dispose()` → `manager.dispose()` at `command-job-manager.ts:1296` (only `SdkController.dispose` reaches it; `SdkController.ts:2011`) | YES | YES | YES (until controller dispose) |
| `VscodeSessionHost` (shared, holds the above) | `sdk-session-lifecycle.ts:553` (`getOrCreateSharedHost`) | **1 per controller** | `SdkSessionLifecycle.dispose()` | YES | YES | YES (until controller dispose) |
| `SdkController`     | extension activation | **1 per extension** | extension deactivation | YES | YES | YES (until extension dispose) |
| Active SDK session  | `SdkSessionLifecycle.startSession(...)` | **1 at a time** | `endActiveSession()` | NO (rebuilt into successor) | definitional | YES (until extension dispose) |
| `TaskProxy`         | SdkController task-control site | **1 at a time** | `taskControl.clearTask` / equivalent on task switch | NO (replaced) | NO | YES (until extension dispose) |
| **temp** `VscodeSessionHost` (history comparison fallback) | `SdkController.ts:3024, 3277` | **ad-hoc, ephemeral** | end of `compareCheckpoint`/`loadMessages` try-block | NO | NO | NO (outlives task scope by construction) |

### Other `VscodeSessionHost.create()` call sites

```text
apps/vscode/src/sdk/SdkController.ts:1409   = SdkFollowupCoordinator.createTempSessionHost
apps/vscode/src/sdk/SdkController.ts:1532   = SdkSessionRebuilds.createTempSessionHost
apps/vscode/src/sdk/SdkController.ts:1865   = createRemoteConfigAwareSessionHost (private)
apps/vscode/src/sdk/SdkController.ts:3024, 3277 = ephemeral history-only fallback hosts

NONE of these participate in the live foreground RunCommands path.
The run_commands tool is registered on the SHARED host at
vscode-session-host.ts:259-263 (extraTools wired through prepareStartSessionInput).
```

### Q1A–Q1G — answers in one line each

```text
Q1A  per extension        = 1
Q1B  per SdkController    = 1 (same instance)
Q1C  per VscodeSessionHost = 1 (private readonly field at vscode-session-host.ts:167)
Q1D  per SDK session      = 1 (the SAME manager is reused; getOrCreateSharedHost
                              returns the cached instance and does NOT reconstruct)
Q1E  per task             = 1 (same instance, lifetime ≡ controller lifetime)
Q1F  task rebuild → new?  = NO (no per-task teardown of the manager exists)
Q1G  session rebuild → new? = NO
```

### Q1 conclusion

```text
OBJECT_LIFETIME_OF_COMMAND_JOB_MANAGER =
  CONTROLLER_SCOPED  (NOT task-scoped, NOT session-scoped)

IMPLICIT_OWNERSHIP_BY_OBJECT_LIFETIME =
  PROVEN_FALSE for task ownership and for session ownership

  (the manager outlives every TaskProxy and every active session
   by construction; lifetime is TOO BROAD to encode either
   "task A owns job J" or "session S owns job J")

OBJECT_LIFETIME_TOO_BROAD_FOR_TASK_OWNERSHIP = PROVEN

OWNERSHIP_BY_OBJECT_LIFETIME = PROVEN_FALSE  (for any task- or
                                               session-scoped reading
                                               of backgroundCommandRunning)
```

---

## Q2 — IDENTITY PROPAGATION

### Identity table (mechanical)

| Surface                       | Field name                  | Actual value                | Scope            | Proven from                                                                  |
| ----------------------------- | --------------------------- | --------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| command job record            | `CommandJob.id`             | `jobId` (e.g. `cmd_*`)      | job only         | `command-job-manager.ts:386` (interface `CommandJob.id`)                     |
| controller field              | `backgroundCommandTaskId`   | **`jobId`** (despite the name) | controller-wide  | `SdkController.ts:1168` callback wiring supplies `jobId`; line 3698 parameter is positional |
| controller field              | `backgroundCommandRunning`  | `boolean`                   | controller-wide  | `SdkController.ts:784-785` (private fields)                                  |
| agent-runtime context         | `AgentToolContext.sessionId`     | `string \| undefined`      | per tool-invocation | `sdk/packages/shared/src/agent.ts:349`                                      |
| agent-runtime context         | `AgentToolContext.conversationId` | `string \| undefined`     | per tool-invocation | `sdk/packages/shared/src/agent.ts:351`                                     |
| TurnState epoch               | `TurnStateTracker.currentSeq` | increasing `number`         | controller-wide  | `turn-state-tracker.ts` via `message-id-minter`                              |
| Manager instance identity     | JS object reference of the `CommandJobManager` reference | controller-wide | `vscode-session-host.ts:167` (`private readonly`)                             |

### Edge classifications

```text
jobId   ↔ sessionId           = ABSENT (no field on CommandJob; AgentToolContext.sessionId
                                  arrives at manager.start() but is NOT stored on the job)
jobId   ↔ taskId              = ABSENT (same)
jobId   ↔ epoch               = ABSENT (manager has no TurnState awareness)
backgroundCommandTaskId  ↔ jobId              = EXPLICIT (callback parameter IS jobId)
backgroundCommandRunning ↔ backgroundCommandTaskId = EXPLICIT (set together at
                                                       SdkController.ts:3702-3703;
                                                       readout at 3821-3822)
backgroundCommandRunning ↔ manager.getActiveJobIds() = IMPLICIT_BY_OBJECT_LIFETIME
                                                       (controller field is updated
                                                       only via the callback, not by
                                                       manager reflection)
```

### MISLEADING_NAME finding

```text
backgroundCommandTaskId =
  MISLEADING_NAME / STRUCTURAL FACT
  (the field stores jobId, NOT taskId)

DO NOT_RENAME_IN_THIS_ACT
  (rename is a Cline-wide API decision; the field is part
   of getStateToPostToWebview's payload, surfaced to webview;
   freezing its identity for downstream contract work)
```

### Q2 conclusion

```text
ID_GRAPH_HAS_JOB_TO_SESSION_TASK_EDGE = NO
ID_GRAPH_HAS_JOB_TO_EPOCH_EDGE       = NO
IMPLICIT_OWNERSHIP_BY_OBJECT_LIFETIME = PROVEN_FALSE for any meaningful ownership
```

---

## Q3 — TASK / SESSION SWITCH PROBE

### Mechanical answer (from Q1 alone, no runtime probe required)

```text
Q3_CASE_C:
  manager survives + J survives
  projection CAN survive (controller-wide fields)
  →
  cross-task ownership contamination is representable
  +
  identity missing

NO OTHER CASE IS PRODUCTION-VIABLE because:
  - Q3_CASE_A (manager replaced) requires getOrCreateSharedHost
    to NOT return the cached instance; the production code
    ALWAYS returns the cached instance (Q1G).
  - Q3_CASE_B (manager survives, projection resets) requires
    backgroundCommandRunning to be unset independent of user
    cancel. The only places backgroundCommandRunning is set
    to false are SdkController.ts:2809 (user cancel) and the
    notifyBackgroundStateChange(false, undefined) callback at
    vscode-run-commands-tool.ts:685 (terminal completion).
    The user-cancel and natural-completion paths BOTH match
    case (B), but neither matches task-switch — task-switch
    is not a code path that touches backgroundCommandRunning.
  - Q3_CASE_D (J cancelled on transition) would require a
    transition hook cancelling jobs when task/session is
    rebuilt — no such hook exists in SdkSessionLifecycle or
    SdkController task control.
```

### Live-specimen corroboration

`live-failure-post-terminal-02.json` (cmd_mtj6kki83r1bmrfz, task
`1788297479245_hv9w5`, epoch 4, capture 2026-09-01) exhibits:

```text
T4 (RUNTIME_PHASE_AFTER)        = awaiting_followup     (LIVE)
T4 backgroundCommandRunning     = false                 (LIVE)
remote workload (192.168.50.31, install-deps-linux.sh + cpanm child,
                                    elapsed ≈13m20s)    = ALIVE (LIVE)
T5 (BACKGROUND_STATE_CHANGE_FALSE) = UNAVAILABLE_FROM_TRACE
T1..T3                              = UNAVAILABLE_FROM_TRACE
```

This is mechanically compatible with Q3_CASE_B: the writer fired
while the projection said "no job". The job-record state at writer-fire
time is **UNAVAILABLE_FROM_TRACE**.

### Honest disclaimer preserved

ACAS01 still did NOT exercise a real RUNNING CommandJobManager
(harness was the trivial no-job case). The structural absence
proven in ACAS01.2 is **not equivalent** to a behavior witness
of a guard. This Q3 analysis re-anchors on the lifetime
topology, which is observable from the source alone — but the
behavioral RED (Q5) cannot be authored without a contract slot
that the current source has no provision for. See Q4 / Q5.

---

## Q4 — LOWEST ALREADY-AUTHORITATIVE COMPOSITION SEAM

### Per-seam authority posture

| Seam                         | Knows turn completion? | Knows job liveness? | Knows owner identity? | Already production-authoritative? | New dependency required to consult job liveness? |
| ---------------------------- | ---------------------- | ------------------- | --------------------- | --------------------------------- | ------------------------------------------------- |
| `SdkSessionEventCoordinator` | YES (drives phase writes) | **NO** (zero grep hits for `backgroundCommand*`/`jobId`/`active` in `sdk-session-event-coordinator.ts:101-225`) | NO | YES for turn writes | YES (would need new dep on `SdkController` or a host function) |
| `SdkController`              | YES (subscribes via `setTurnPhase` at SdkController.ts:1627) | YES (private fields `backgroundCommandRunning`, `backgroundCommandTaskId` updated via callback at line 1168) | NO (no sessionId/taskId linkage to the jobId — Q2 ID graph) | YES for both individually | NO new dependency |
| `VscodeSessionHost` (shared) | indirectly (via session subscribe) | YES (owns `commandJobManager` field at line 167) | partial (lifetime = controller, not session) | YES | NO new dependency |
| `commandJobManager` (alone)  | NO                      | YES (sole authority on liveness) | partial (lifetime = controller) | YES | n/a |

### Authority-composition question

> "Does THIS owner still own unfinished background work
>  at the point this turn is being declared complete?"

```text
answer at SdkController:
  backgroundCommandRunning = SOMEBODY has unfinished work   (session/task NOT identified)
  backgroundCommandTaskId  = jobId                            (no session/task binding)
  → CANNOT answer "this owner"

answer at SdkSessionEventCoordinator:
  ZERO background-job signal available.
  → CANNOT answer even the "somebody" part.

answer at VscodeSessionHost (shared):
  SAME as SdkController (controller-wide fields above) +
    direct access to manager.
  → CANNOT answer "this owner" without building the
    jobId-to-sessionId/taskId edge.
```

### Q4 conclusion

```text
LOWEST_COMPOSITION_SEAM_THAT_CAN_BOTH_AUTHORITY_INPUTS =
  SdkController  (has backgroundCommandRunning + backgroundCommandTaskId
                 + the session event listener chain via setTurnPhase)

  But:
  SdkController.backgroundCommandTaskId carries jobId only;
  no sessionId/taskId linkage to the jobId (Q2 ID graph).

  The coordinator has zero current awareness of background
  signals (Q4 row 1).

OWNER_IDENTITY_AVAILABLE_AT_SDK_CONTROLLER = NO

LOWEST_SEAM_WITH_OWNER_IDENTITY = does NOT exist in current
                                   production source

AUTHORITY_IDENTITY_MISSING = PROVEN
```

---

## Q5 — TRUE RED

Per §14.B (`AUTHORITY_IDENTITY_MISSING = PROVEN` → STOP and
recommend narrow contract ACT), Q5 is **not authored**.
Constructing a TRUE RED here would require either:

```text
(a) a new optional slot on SdkSessionEventCoordinatorOptions
    carrying the live background-job liveness signal PLUS a
    session/task identity, OR

(b) a new in-process lookup path callable from the coordinator
    (e.g. a host-owned function returning
       { jobRunning: boolean,
         ownerSessionId?: string,
         ownerTaskId?: string })
    — which is a NEW DEPENDENCY, forbidden by §6:
      "Do NOT inject CommandJobManager into
       SdkSessionEventCoordinator just to make a test possible"
```

Neither is authorized in this ACT:
- §1 forbids implementation of the leading hypothesis,
- §10 only authorizes repair after a true Q5 RED,
- §6 forbids the specific dependency injection Q5 would need.

**Q5 cohesive finding = AUTHORITY_IDENTITY_MISSING (the
architectural gap is the result, not a passing test).**

---

## §14 STOP STATE — terminal disposition

```text
CASE            = STRONG_CANDIDATE / NOT ADJUDICATED  (unchanged from ACAS01)
ROOT_CAUSE      = NOT YET ISOLATED
AUTHORITY_IDENTITY_MISSING = PROVEN
REPAIR_AUTHORIZED = NO  (Q5 RED not authored)
NEW_CHILD_ACT    = NO   (narrow contract ACT RECOMMENDED, not opened here)

ACAS01          = preserved-as-calibrated-evidence (4/4 PASS at b072d9807)
TYPECHECK       = clean
git_diff_check  = pass
PRODUCTION_DELTA = 0
```

### Recommended next bounded cycle (still inside this umbrella ACT, no parent new ACT)

A small **narrow contract ACT** (not a repair ACT) authorized
in a future review round should ADD exactly one optional
carrier slot to `SdkSessionEventCoordinatorOptions` (or a
sibling carrier) sufficient to convey:

```text
- whether a RUNNING job exists                 (boolean)
- the owning sessionId and/or taskId at job-creation
                                               (string | undefined)
```

With that contract slot in place, Q5 becomes exercisable
inside this same umbrella ACT (no new parent ACT, no
Factory-bound follow-up ACT body required). Then re-run
Q5 to formulate the real RED with ablations and controls.

The rename of `backgroundCommandTaskId` (which currently
stores `jobId`) is a Cline-wide API surface decision and
should be a SEPARATE contract ACT, frozen here as a
MISLEADING_NAME / STRUCTURAL FACT finding.

---

## Anti-overfit guarantee

The contract this recon points at is:

```text
"ClineMM still owns a background job whose completion has not
 been authoritatively observed → local turn completion alone
 cannot claim that no work is in flight for that owner."
```

This is NOT:

```text
"a remote Unix process is alive → ClineMM must keep the
 turn open"
```

The host cannot generally know the latter; only the former is
both expressible (in terms of in-process state) and load-bearing
(fires the correct turn-phase decision).

---

## File map for cross-reference

```text
ACT body         : .factory/acts/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01.md
Q1-Q5 evidence   : .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/background-job-authority-topology.md (this file)
Live specimen    : .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/live-failure-post-terminal-02.json
Per-seam recon   : .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/source-seam-map/01-source-recon-q1-q8.md (prior; pre-Q1-Q5)
ACAS01 test      : apps/vscode/src/sdk/__tests__/runtime-task-progression-post-terminal-authority-discriminator.acas01-synthetic-real.test.ts
Board            : .factory/epic-board.md (row 28 → AUTHORITY_BIND_DEFERRED_PENDING_Q1-Q5-RESOLVED)
Epic detail      : .factory/epics/runtime-task-progression.md (deferred-work entry)
```

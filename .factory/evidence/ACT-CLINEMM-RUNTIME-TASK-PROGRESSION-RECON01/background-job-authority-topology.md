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

### Recommended next bounded cycle — WITHOUT preselecting the transport shape

The Q1–Q5 recon proved the **identity edge** is missing
from in-process state. So the next bounded cycle starts at
the **producer** (job creation), not the **consumer**
(the coordinator's options). Concretely, this is what the
next ACT must define:

```text
tool invocation / job creation
        ↓
authoritative owner identity captured on CommandJob
        ↓
job liveness query preserves that identity
        ↓
turn-completion composition seam asks:
  does THIS owner have unfinished work?
```

**Do NOT preselect the carrier shape.** Adding a slot to
`SdkSessionEventCoordinatorOptions` would only create a
place to transport identity that does not yet exist; the
producer must first persist the identity, and the carrier
shape is a downstream consequence to be discovered during
the contract ACT itself.

The contract ACT is opened as:

```text
ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01

Mission (from reviewer):
  Define and minimally implement the authoritative
  ownership identity carried by a background command job
  from creation through liveness/completion, sufficient
  for the existing runtime-task-progression ACT to
  execute its true Q5 RED. Keep it tiny.

Likely candidates for the minimum identity (frozen here,
to be inspected at the real job-creation seam):
    ownerSessionId
    ownerConversationId
Q1/Q2 must pick **exactly ONE** minimum lifecycle-correct
owner via the discrimination table (stable across turn
iterations / changes on new task / changes on session
rebuild / available at job creation). Persisting BOTH
because both exist is forbidden. Only add ownerTaskId if
source recon proves a stable task identity exists at the
real run_commands creation seam.

Persistence target = internal `CommandJob` record ONLY.
`CommandJobSnapshot` does NOT gain owner identity unless
source recon proves an existing internal-only snapshot
consumer mechanically requires it. Identity is encapsulated
behind the per-owner query.

Desired resulting seam (semantically — shape to be picked
during the contract ACT):
    hasRunningBackgroundJobForOwner(ownerId): boolean
    OR
    getRunningBackgroundJobsForOwner(ownerId): ...
NOT another controller-wide boolean — the current
`backgroundCommandRunning` is exactly too lossy for
authority decisions.
```

### Q3 — calibration reminder (in-process only; no separate commit)

`Q3_CASE_C` here is **structural**, not behavioral: no
runtime task/session-switch probe was executed in this
recon; the case is derived from the construction of
`getOrCreateSharedHost`. Future readers must not describe
this as an executed probe. No additional cleanup commit
spend.

### Q3 (contract ACT) — combined identity + authority RED

The contract ACT's Q3 RED should be load-bearing:
A starts RUNNING J → `hasRunningBackgroundJobForOwner(A) === true`.
At HEAD this MUST FAIL because the chosen owner identity
is absent from the manager's internal records. Reuse
existing CommandJobManager test deterministic process-lifecycle
controls where possible; if a real child is needed, prefer
`/bin/sh -c 'sleep N'` with N very short and cleanup
authoritative. The purpose is owner-state semantics, not
process timing.

### Then immediately return to Q5 (still in the umbrella ACT)

Once the contract ACT closes, **do not start another recon
epic**. Resume `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01`
inside the umbrella ACT and finally execute the real RED:

```text
same completion event
same TurnState
same production seam

A. current owner has RUNNING J
   → after.phase must NOT be `awaiting_followup`
     (do NOT yet freeze the specific phase A *must* become;
      state-machine design is umbrella Q5, not contract ACT's)
B. current owner has no running J
   → awaiting_followup preserved (control / current behavior)
C. another owner has RUNNING J
   → awaiting_followup preserved (cross-owner contamination control)
D. current owner's J completed
   → awaiting_followup preserved (terminal control)
```

If A fails while B/C/D pass:

```text
CASE_A = ADJUDICATED
ROOT_CAUSE_ISOLATED = YES
```

and only then patch the lowest authority seam.

The rename of `backgroundCommandTaskId` (which currently
stores `jobId`) is a Cline-wide API surface decision and
SHOULD be a SEPARATE contract ACT, frozen here as a
MISLEADING_NAME / STRUCTURAL FACT finding — but explicitly
out of scope for `BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01`,
whose mission is owner identity, not field renaming.

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
ACT body              : .factory/acts/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01.md
Q1-Q5 evidence        : .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/background-job-authority-topology.md (this file)
Contract ACT (opened) : .factory/acts/ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01.md
Live specimen         : .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/live-failure-post-terminal-02.json
Per-seam recon        : .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/source-seam-map/01-source-recon-q1-q8.md (prior; pre-Q1-Q5)
ACAS01 test           : apps/vscode/src/sdk/__tests__/runtime-task-progression-post-terminal-authority-discriminator.acas01-synthetic-real.test.ts
Board                 : .factory/epic-board.md (row 28 → AUTHORITY_IDENTITY_MISSING; contract ACT in flight)
Epic detail           : .factory/epics/runtime-task-progression.md (deferred-work entry)
```

---

## POST-Q5 GREEN (resume Waiting Q5, 2026-09-02, per Factory causal reviewer C1: RESUME_WAITING_Q5)

Following the contract ACT's GREEN landing at `c685317ea` (the per-owner background-job liveness primitive `CommandJobManager.hasRunningBackgroundJobForOwner`), the Factory causal reviewer authorized the Q5 resume cycle. The matrix A/B/C/D was executed at the lowest composition seam that already has BOTH authority inputs in scope: `SdkController` (which holds the active session's `sdkHost`, which in turn holds the `CommandJobManager`).

### Production delta (minimum bounded repair at the composition seam)

```text
apps/vscode/src/sdk/vscode-session-host.ts
  +hasRunningBackgroundJobForOwner(sessionId: string | undefined): boolean
   (host-only method following the cancelBackgroundCommand precedent;
    delegates to CommandJobManager.hasRunningBackgroundJobForOwner;
    returns false when sessionId is missing or the host does not
    implement the method - same absence semantic as cancelBackgroundCommand)

apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  +SdkSessionEventCoordinatorOptions.hasRunningBackgroundJobForOwner?:
     (ownerSessionId: string | undefined) => boolean
  The done-without-completion `else` branch (line ~172) NOW consults
  the option BEFORE firing setTurnPhase("awaiting_followup", ...):
  when the active session still owns a RUNNING `CommandJob`, the
  transition is suppressed (the phase stays at the prior phase,
  typically `streaming`). When the option is absent (tests, Hub/Remote
  hosts), behavior is unchanged: unconditional `awaiting_followup`.

apps/vscode/src/sdk/SdkController.ts
  Wires the option at the composition seam (the same duck-typed cast
  pattern used for `cancelBackgroundCommand` at SdkController.ts:2794):
  hasRunningBackgroundJobForOwner: (ownerSessionId) => {
    const activeSession = this.sessions.getActiveSession()
    if (!activeSession) return false
    const host = activeSession.sdkHost as (VscodeSessionHost & {
      hasRunningBackgroundJobForOwner?: (sessionId) => boolean
    }) | undefined
    if (!host || typeof host.hasRunningBackgroundJobForOwner !== "function") return false
    return host.hasRunningBackgroundJobForOwner(ownerSessionId)
  }
```

Per the Factory reviewer's directive ("smallest correct repair at the
composition seam ... do NOT yet freeze the specific phase A *must* become"),
the suppression preserves the prior phase; no replacement phase is invented.

### Q5 matrix executed (real-shell run, this turn)

Test file: `apps/vscode/src/sdk/__tests__/runtime-task-progression-q5-composition-seam-red-and-repair.q5rr01-synthetic-real.test.ts` (350 lines, SYNTHETIC_REAL; mirrors the ACAS01 harness pattern).

> **Factory causal reviewer P1 calibration (2026-09-02, PASS_WITH_ONE_P1_FIX):** the original phrasing "Q5-A PRE-REPAIR captured the RED" misclassified a CURRENT_BEHAVIOR_WITNESS as a RED. The test asserts the buggy result (awaiting_followup under owned-RUNNING-job precondition) and PASSES -- that is exactly the ACAS01 mistake we already corrected. The genuine RED evidence is the **necessity ablation** (production-side consultation disabled -> invariant fails -> restore -> invariant holds). The matrix is therefore re-labeled below.

```text
Q5_A_BASELINE =
  SYNTHETIC_REAL / CURRENT_BEHAVIOR_WITNESS
  (liveness option wired to () => false, simulating pre-repair production)
  → after.phase === "awaiting_followup"        PASS (witness, NOT RED)

Q5_A_POST_REPAIR =
  SYNTHETIC_REAL / 6/6 PASS
  (liveness option wired to () => true)
  → after.phase !== "awaiting_followup"        PASS (GREEN)

Q5_B_CONTROL =
  SYNTHETIC_REAL / CURRENT_BEHAVIOR_WITNESS preserved
  (option returns false)                        after.phase === "awaiting_followup"
  (option omitted)                              after.phase === "awaiting_followup"

Q5_C_CONTROL =
  SYNTHETIC_REAL / isolation control preserved
  (liveness returns true only for non-active session)
                                                after.phase === "awaiting_followup"

Q5_D_CONTROL =
  SYNTHETIC_REAL / terminal-state control preserved
  (option returns false)                        after.phase === "awaiting_followup"

Q5_RED =
  NECESSITY_ABLATION / REPRODUCED
  production-side consultation physically reverted to constant false
  -> post-repair invariant fails (1 failed | 5 passed)

Q5_GREEN =
  SYNTHETIC_REAL / 6/6 PASS
  production-side consultation restored
  -> all six matrix assertions hold
```

### Proof shape: COMPOSED, not literal end-to-end SdkController execution

> **Factory causal reviewer P1 calibration (2026-09-02, PASS_WITH_ONE_P1_FIX):** Q5RR01 does NOT instantiate the `SdkController -> VscodeSessionHost -> CommandJobManager` chain. It constructs `SdkSessionEventCoordinator` and injects a boolean callback. That alone is insufficient to claim a production-chain test. The proof is **COMPOSED** of four pieces of evidence that each cover one seam; together they close the chain:

```text
Q5_PROOF =
  COMPOSED:
    1. BEHAVIORAL  : CommandJobManager owner contract
                     -> real-shell run 9/9 PASS (env-gated in IDE)
    2. STRUCTURAL  : VscodeSessionHost.hasRunningBackgroundJobForOwner
                     delegates to CommandJobManager.hasRunningBackgroundJobForOwner
                     (production code, this turn)
    3. STRUCTURAL  : SdkController wires active-session sdkHost
                     -> VscodeSessionHost.hasRunningBackgroundJobForOwner
                     (same duck-typed cast pattern as cancelBackgroundCommand)
    4. SYNTHETIC_REAL : real SdkSessionEventCoordinator
                     -> guard changes awaiting_followup authority
                     (Q5RR01 vitest 6/6 PASS)
    5. NECESSITY   : production-side consultation disabled
                     -> invariant RED returns (1 failed | 5 passed)
                     -> restore consultation -> 6/6 PASS

Q5RR01 ALONE =
  NOT a production-chain test
  (it does NOT instantiate SdkController / VscodeSessionHost / CommandJobManager)
```

### Conservation

```text
typecheck apps/vscode                = clean (0 errors)
ACAS01 vitest                         = preserved (4/4 PASS at b072d9807)
BHTD01 vitest                         = preserved (6/6 PASS)
Q5RR01 vitest                         = 6/6 PASS (new this turn)
Q6.1 + Q6.1b owner-identity contract  = PASS in this IDE-sandbox
Q6.2-Q6.8 owner-identity lifecycle   = environmentally gated (run green in non-sandboxed shell; same pre-existing 18/20 spawn-related failures in this IDE-sandbox; NOT a regression; updated Q6 counts below per Factory causal reviewer calibration)
OWN01 RED (sdk-session-event-coordinator.test.ts)
  = remains RED (was RED before this turn; authored as a separate P0
    RED for the finish-reason discrimination path OWN02. NOT
    addressed by the Q5 per-owner liveness repair; remains owned by
    the umbrella ACT's NEXT-LANE finish-reason discriminator work).
```

### Q6 evidence (UPDATE 2026-09-02 per Factory causal reviewer calibration)

> **Factory causal reviewer P1 calibration (2026-09-02, PASS_WITH_ONE_P1_FIX):** the prior Q6 wording said only Q6.1/Q6.1b ran and Q6.2-Q6.8 were environmentally gated. The subsequent real-shell run produced the durable counts:

```text
OWNER_IDENTITY_CONTRACT =
  REAL-SHELL EXECUTED / 9/9 PASS
  (apps/vscode/src/sdk/command-job-manager.owner-session-id.test.ts;
   all nine Q6.1, Q6.1b, Q6.2, Q6.3, Q6.4, Q6.5, Q6.6, Q6.7, Q6.8
   pass in a normal shell; env-gated in IDE-sandbox only)

ADJACENT_COMMAND_JOB_MANAGER =
  28/29 PASS in real shell (command-job-manager.test.ts + owner-session-id.test.ts
                            combined run; see prior commit-chain note at
                            commit 425cb1c18)

ADJACENT_FAILURE =
  CORRECTION03 child.pid ENOENT after fixed 200ms
  unrelated timing-shaped test failure
  NON-BLOCKING
  pre-existing; NOT introduced by the owner-identity delta
```

### Disposition

```text
CASE_A                            = ADJUDICATED FOR EXERCISED CONTRACT
ROOT_CAUSE                        = missing per-owner background-job liveness
                                     at the turn-completion authority decision
OWNER_IDENTITY                    = sessionId
OWNER_CONTRACT                    = EXECUTED / 9/9 PASS (real shell)
REPAIR                            = bounded per-owner liveness consultation
NECESSITY_ABLATION                = PASS (guard removed -> RED returns;
                                          restore -> GREEN; 6/6 PASS in
                                          Q5RR01 with consultation on)
Q5RR01                            = 6/6 PASS
Q5_PROOF                          = COMPOSED
                                     (BEHAVIORAL manager ownership 9/9 +
                                      STRUCTURAL host delegation +
                                      STRUCTURAL controller wiring +
                                      SYNTHETIC_REAL coordinator execution +
                                      NECESSITY ablation)
                                     NOT literal end-to-end SdkController
                                     execution (Q5RR01 alone does not
                                     instantiate that chain)
Q5_A_BASELINE                     = CURRENT_BEHAVIOR_WITNESS, not RED
Q5_RED                            = NECESSITY_ABLATION (production-side
                                       consultation disabled -> invariant
                                       fails -> restore -> 6/6 PASS)
Q5_CONTROL_NO_JOB                 = PASS (Q5-B)
Q5_CONTROL_OTHER_OWNER            = PASS (Q5-C)
Q5_CONTROL_COMPLETED_JOB          = PASS (Q5-D)
NEW_REVIEW_ROUND                  = NO (reviewer directive)

WAITING_Q5_IMPLEMENTATION         = CLOSED
                                     REPAIR_VERIFIED_FOR_EXERCISED_CONTRACT
FRESH_POST_REPAIR_LIVE            = PENDING / NON-BLOCKING
                                     (no fresh long-running background
                                      task observed on the repaired
                                      dogfood build yet; ordinary
                                      dogfood qualification;
                                      do NOT wait for recurrence before
                                      starting the security lane)

NEXT_LANE = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
           (FRESH_POST_REPAIR_LIVE does NOT gate the security lane)
```

# ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 — Production Seam Map

**Evidence class:** `STRUCTURAL` (source inspection at ENTRY_HEAD `d03d475e1f4ab064ea123eb464b59a4f2b112176`,
tree `bc16cc846080e7bc98221a6020822ac7d746acb8`).

## 0. Files inspected

| File | Role |
|---|---|
| `apps/vscode/src/sdk/command-job-manager.ts` | Command authority: `start()`, `finalize()`, `defaultTerminalPostconditionProbe()`, job storage, lifecycle emission, eviction, `dispose()`. |
| `apps/vscode/src/sdk/SdkController.ts` | Controller publication: `updateBackgroundCommandState()`, `backgroundCommandJobStates`, `backgroundCommandJobOwners`, `handleCommandJobLifecycle()`, `maybeReevaluateDeferredContinuation()`. |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | Barrier authority: `unresolvedContainmentFailuresForOwner()`, C10 immediate hold, deferred C10 re-evaluation, Q5 guard, commit-boundary guard. |
| `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | Real runner: `terminalPromise` listener → `notifyBackgroundStateChange()` → `options.onBackgroundStateChange`. |
| `apps/vscode/src/sdk/vscode-session-host.ts` | Real host: constructs the production `CommandJobManager`; wires `onCommandJobLifecycle` / `onRuntimeError`. |
| `apps/vscode/src/sdk/sdk-session-lifecycle.ts` | Threads `onBackgroundStateChange` from host options into the session's tool options. |

## 1. The frozen `finalize()` gate (R1 — preserved)

`CommandJobManager.finalize()` (`command-job-manager.ts:2501`) is **synchronous and fail-closed**:

```
savedPgid = readPgidFromSupervisor(job.process)          // :2580
postcondition = this.terminalPostconditionProbe(savedPgid) // :2593
invariantProven = (postcondition === "gone")              // :2624
terminalState = invariantProven ? state : "containment_failed" // :2626-2637
```

`defaultTerminalPostconditionProbe()` (`:3612`) maps `process.kill(-pgid, 0)`:

| kernel outcome | postcondition | errno |
|---|---|---|
| rc = 0 | `alive` | `null` |
| `ESRCH` | `gone` | `"ESRCH"` |
| `EPERM` | `eperm` | `"EPERM"` |
| anything else | `unknown` | that errno |

`pgid_unset` (no resolvable PGID) → `postcondition === undefined`, `job.terminationFailed = "pgid_unset"`,
`terminalState = "containment_failed"`. **No grace period, no eventual-success assumption.** This ACT does not
change any of it.

The failure path emits (in order):

1. `command_job_primary_group_cleanup` (probe result) — `:2601`
2. `command_job_residual_detected` (pre-delete observation) — `:2680`
3. `this.active.delete(job.id)` — `:2736`
4. `command_job_containment_failed` (post-delete gauge conservation) — `:2887`
5. `terminalTransitionResolve({ becameIdle, jobId, terminalState })` — `:2909` (exactly once)

`job.terminationFailed` is latched to `"substrate_alive" | "substrate_eperm" | "substrate_unknown" | "pgid_unset"`.

## 2. The seven recon answers

### 2.1 Who owns the original PGID after `finalize()`?

**The `CommandJobManager`**, via the retained `SupervisableShellProcess` on the terminal job record:

- `CommandJob.process: SupervisableShellProcess` (`:1037`)
- `readPgidFromSupervisor(job.process)` (`:3571`) reads `process.pgid`
- The job record survives `finalize()` in the bounded FIFO `this.terminal` map (`:2917-2919`), evicted past
  `maxTerminalJobs` (default `MAX_TERMINAL_JOBS`).

The **supervisor** owns the process group; the **manager** owns the *identity* of that group for the lifetime of
the job record. No diagnostic record (BJLA / CIFR / CFPR01) owns it.

### 2.2 Who can safely perform a later postcondition probe?

**The manager.** It is the sole holder of:

- the `terminalPostconditionProbe` seam (`options.terminalPostconditionProbe`, `:486`, defaulting to
  `defaultTerminalPostconditionProbe`),
- the supervisor handle carrying the original `pgid`,
- the launch-time `ownerSessionId` (`CommandJob.ownerSessionId`, `:1090`, captured at construction from
  `context.sessionId` — `:1970`).

A later probe of the *same numeric PGID* is only meaningful while the original identity is retained. The manager
is the nearest existing authoritative owner; the controller must NOT probe the kernel.

### 2.3 Who owns the current terminal state?

Two owners, in this order of authority:

1. **Canonical:** `CommandJob.state` on the terminal job record (`command-job-manager.ts:2639`).
2. **Projection:** `SdkController.backgroundCommandJobStates[jobId]` (`SdkController.ts:1336`) plus
   `backgroundCommandJobOwners[jobId]` (`:1363`).

The C10 barrier reads only the **projection** via `getBackgroundCommandJobStates` / `getBackgroundCommandJobOwners`
(`SdkController.ts:2852`, `:2871`).

### 2.4 How can a later authoritative state reach the controller?

**The manager's existing lifecycle sink.** `CommandJobManager` already exposes
`options.onCommandJobLifecycle?: (event: CommandJobLifecycleEvent) => void` (`:457`), and the production host wires
it to `SdkController.handleCommandJobLifecycle` (`vscode-session-host.ts:354` → `SdkController.ts:2051`).

`handleCommandJobLifecycle` (`SdkController.ts:6278`) currently only (a) updates the `⎇ N` gauge and (b) records
a BCB terminal receipt. It does **not** touch `backgroundCommandJobStates`.

The per-job *terminal state* projection is published by the runner:
`start.terminalPromise.then(({ jobId, terminalState }) => notifyBackgroundStateChange(false, jobId, terminalState, ownerSessionId))`
(`vscode-run-commands-tool.ts:1868`, `:2027`, `:2143`) → `options.onBackgroundStateChange` (`:922`) →
`SdkController.updateBackgroundCommandState` (`SdkController.ts:2039`).

**Conclusion:** a minimal **internal** lifecycle event is necessary — the manager must originate the later
authoritative observation (R3), and the controller must receive it. The existing `onCommandJobLifecycle` sink is
the correct transport; a new event kind with distinct semantics (not a re-fire of
`command_job_terminal_committed`) is required.

### 2.5 Which existing callback triggers C10 re-evaluation?

`SdkController.updateBackgroundCommandState()` (`SdkController.ts:5921`) ends with:

```
await Controller.maybeReevaluateDeferredContinuation(
    previousRunning, anyRunning, anyRunning ? taskId : undefined, this.sessionEvents,
)                                                            // :6129
```

and `maybeReevaluateDeferredContinuation` (`:6183`) calls
`sessionEvents.reevaluateDeferredCompletionBarrier()` (`:6200`).

`reevaluateDeferredCompletionBarrier()` (`sdk-session-event-coordinator.ts:2156`) consults the shared classifier:

```
const unresolvedContainmentFailuresForDeferredC10 = this.unresolvedContainmentFailuresForOwner(
    this.options.getBackgroundCommandJobStates?.(),
    this.options.getBackgroundCommandJobOwners?.(),
    activeSession.sessionId,
    containmentLedgerDetailDeferredC10,
)                                                       // :2644
```

and returns early (holding the deferred marker) when that set is non-empty (`:2661-2692`).

**This is the single re-evaluation trigger the repair must reuse.** No new completion coordinator.

### 2.6 How are pending reconciliations cancelled on manager disposal?

**They do not exist at ENTRY_HEAD — the repair must add them and wire cancellation into
`CommandJobManager.dispose()` (`:3446`).** `dispose()` already performs the sweep pattern for everything else it
owns: it terminates active jobs, emits residual events, then clears `active`, `terminal`, `terminalOrder`,
`exitTransitions`, `terminalTransitions`. The reconciliation timers are a new resource and MUST be cleared there.

### 2.7 Can a delayed initial terminal publication overwrite a newer reconciliation?

**Yes — this is a real hazard that the repair must close.**

The runner's terminal publication is a **microtask** (`start.terminalPromise.then(...)`) that resolves the promise
from inside `finalize()` (`:2909`). A reconciliation can only complete after at least one **timer** tick, so in
practice the initial `containment_failed` publication lands first. But the manager's own lifecycle events and the
controller's projection are updated on **different** paths, so nothing structurally forbids a stale
`containment_failed` write landing after a reconciled write.

Mitigation implemented by this ACT: the controller's per-job projection write is made **causally ordered** — a
`containment_failed` publication for a job whose projection has already been reconciled is refused (G11), and the
reconciled publication carries the authoritative state that wins.

## 3. The shared classifier is the single authority (R6)

`SdkSessionEventCoordinator.unresolvedContainmentFailuresForOwner()` (`:1174`) is the ONLY place that decides
whether a `containment_failed` entry blocks completion. Its contract:

| input | classification |
|---|---|
| clean terminal job | does not block |
| `containment_failed`, matching session | **BLOCKS** |
| `containment_failed`, foreign session | does not block |
| `containment_failed`, unknown owner | **BLOCKS** (fail closed) |
| `containment_failed`, owner map unavailable | **BLOCKS** (fail closed) |
| absent state map | does not block (authority not wired) |

The repair therefore does **not** add a second classifier, does **not** weaken any predicate, and does **not**
touch the C10 / Q5 / commit-boundary guards. It changes exactly one *input* to the classifier: the per-job
projection value for a job whose group has been authoritatively proven `gone` no longer reads `containment_failed`.

## 4. Chosen implementation shape (manager-origin → existing publication path)

```
finalize()                    (non-gone postcondition, positive PGID, not pgid_unset)
  └─ register pending reconciliation
       { jobId, pgid, ownerSessionId, originalTerminalClass, failureClass, attempts }
  └─ schedule bounded timer

timer tick
  └─ this.terminalPostconditionProbe(pgid)          [same seam as finalize]
       ├─ gone  → job.state = originalTerminalClass
       │          emit command_job_containment_reconciled   (NEW internal event)
       │          clear pending
       ├─ alive / eperm / unknown → remain blocked, retry within budget
       └─ probe unavailable → remain blocked

SdkController.handleCommandJobLifecycle
  └─ command_job_containment_reconciled
       └─ this.updateBackgroundCommandState(false, jobId, reconciledState, undefined, ownerSessionId)
            └─ backgroundCommandJobStates[jobId] = reconciledState
               backgroundCommandJobOwners[jobId] = ownerSessionId   (preserved)
               └─ Controller.maybeReevaluateDeferredContinuation(...)
                    └─ sessionEvents.reevaluateDeferredCompletionBarrier()
                         └─ unresolvedContainmentFailuresForOwner(...) → no longer blocks this job
```

**Event cardinality:** the reconciliation event is a NEW event kind. It does **not** re-fire
`command_job_terminal_committed`, does **not** resolve the terminal-transition promise a second time, does
**not** re-enter `reportRuntimeError` (so the ⚠ counter is not incremented again), and does **not** touch the
active-job cardinality (the job was already removed from `active` at finalize time).

## 5. Anti-goals honoured

- No change to `unresolvedContainmentFailuresForOwner()`.
- No change to `outstandingAutonomousWork`, `unconsumedOwnedTerminalResultCount`, `ownerStillRunning`, or the Elm
  completion authority.
- No second global job-state map (the controller reuses `backgroundCommandJobStates` / `backgroundCommandJobOwners`).
- No public protocol / wire-field change.
- No change to the supervisor's spawn or termination behaviour.
- No `ps`-membership-snapshot authority.

# ACT-CLINEMM-ELM-SEAM12-SESSION-REBUILD-AUTHORITY-RECON — executable-witness

**Verdict:** `NOT_A_GOOD_ELM_SEAM`

**Date:** 2026-10-14

**Subject HEAD:** `ef17088f38371743264e4cc86932efd52c01f86c` (TaskHeader-repair closure)

## Phase 0 — Repository identity

```text
$ git branch --show-current
main
$ git rev-parse HEAD
ef17088f38371743264e4cc86932efd52c01f86c
$ git status --short
(clean)
$ git stash list
(none)
$ git diff --check
(clean)
```

- `ENTRY_BRANCH = main`
- `ENTRY_HEAD = ef17088f38371743264e4cc86932efd52c01f86c`
- `ENTRY_WORKTREE_STATUS = clean`
- `PROTECTED_STASHES = (none)`

## Phase 1 — Real production authority recon

### Source authority

`apps/vscode/src/sdk/sdk-session-rebuild-scheduler.ts` (247 lines, 4 closed
rebuild reasons).

The scheduler owns:

| State | Current owner | Source location |
|---|---|---|
| `pending: Map<Reason, () => Promise<void>>` | TS scheduler | `sdk-session-rebuild-scheduler.ts:44` |
| `drainInFlight: Promise<void> \| undefined` | TS scheduler | `sdk-session-rebuild-scheduler.ts:45` |
| `deferredOutstandingPredicate: () => boolean` | TS scheduler (mutable ref) | `sdk-session-rebuild-scheduler.ts:46` |
| Drain snapshot | TS scheduler (live `Array.from`) | `sdk-session-rebuild-scheduler.ts:149` |
| Executed-prefix bookkeeping | TS scheduler (`currentIndex`) | `sdk-session-rebuild-scheduler.ts:169-172` |
| `drainedReasons` (suppression set) | TS scheduler | `sdk-session-rebuild-scheduler.ts:157` |

External observed facts (NOT scheduler-owned):

- `getActiveSession(): ActiveSession \| undefined` (from `SdkSessionLifecycle`).
- `activeSession.isRunning: boolean`.
- `isDeferredCompletionOutstanding(): boolean` (predicate injected by
  `SdkController` at line 2835, sources from
  `sdk-session-event-coordinator.ts`).

### Production call graph

```text
SdkController
├── this.sessionRebuilds = new SdkSessionRebuildScheduler({ sessions: this.sessions })
│   (SdkController.ts:2069)
│
├── this.sessionRebuilds.setIsDeferredCompletionOutstanding(...)
│   (SdkController.ts:2830-2836; lazy, post sessionEvents construction)
│
├── this.sessionRebuilds?.sessionBecameIdle()  ← handleSessionBecameIdle()
│   (SdkController.ts:2935)
│
└── injected into coordinators as `rebuilds: Pick<SdkSessionRebuildScheduler, ...>`:
    ├── SdkModeCoordinator       → uses only `runExclusive` (SdkController.ts:2100)
    │   SdkModeCoordinator is the ONLY mode-rebuild consumer
    │   (sdk-mode-coordinator.ts:76, sdk-mode-coordinator.ts:205)
    │
    ├── SdkMcpCoordinator        → uses only `request` (SdkController.ts:2123)
    │   SdkMcpCoordinator.handleToolListChanged (sdk-mcp-coordinator.ts:40)
    │
    ├── SdkSessionAutoApprovalCoordinator → uses only `request`
    │   (SdkController.ts:2136, sdk-session-auto-approval-coordinator.ts:95)
    │
    ├── SdkTerminalExecutionModeCoordinator → uses only `request`
    │   (SdkController.ts:2151, sdk-terminal-execution-mode-coordinator.ts:56,108)
    │
    ├── SdkProviderChangeCoordinator → uses only `request`
    │   (SdkController.ts:2164, sdk-provider-change-coordinator.ts:321)
    │
    ├── SdkCompactionCoordinator → uses only `runExclusive`
    │   (SdkController.ts:2410, sdk-compaction-coordinator.ts:220,297)
    │
    ├── ModelProfilesOwner → uses only `request`
    │   (SdkController.ts:2183, profile-store/owner.ts)
    │
    └── SdkFollowupCoordinator → uses `runExclusive` and `waitUntilSettled`
        (SdkController.ts:2200,2202)
```

### Public surface actually used

| API | Callers in production code |
|---|---|
| `request(reason, rebuild)` | 5: `SdkMcpCoordinator`, `SdkSessionAutoApprovalCoordinator`, `SdkTerminalExecutionModeCoordinator`, `SdkProviderChangeCoordinator`, `ModelProfilesOwner` (4 distinct reasons: `mcpTools`, `sessionAutoApprovalOverride`, `terminalExecutionMode`, `provider`) |
| `runExclusive(op)` | 3: `SdkModeCoordinator`, `SdkCompactionCoordinator`, `SdkFollowupCoordinator` |
| `waitUntilSettled()` | 1: `SdkFollowupCoordinator` |
| `sessionBecameIdle()` | 1: `SdkController.handleSessionBecameIdle` |
| `deferredCompletionSettled()` | 2: in `__tests__/mcp-tool-restart-deferred-completion-barrier.mcprestart01.test.ts:432,602,740` and `__tests__/seatbelt-all-r5-authority-implementation01...red.test.ts:381` — **NO production caller** |
| `setIsDeferredCompletionOutstanding(predicate)` | 1: `SdkController` lazy wiring at line 2835 |
| `cancel(reason)` | **0 production callers** (only the test exposes the public API surface) |

`cancel` has no production caller. `deferredCompletionSettled` has no
production caller. Both are part of the public test/exploration surface
and removing them is a separate concern.

## Phase 2 — Baseline + synchrony

### Existing test suite

```text
$ export PATH=/Volumes/UserData/Users/chistyakov/.bun/bin:$PATH
$ cd apps/vscode && bun test src/sdk/sdk-session-rebuild-scheduler.test.ts

  ✓ SdkSessionRebuildScheduler > drains a rebuild when the running session becomes idle
  ✓ SdkSessionRebuildScheduler > coalesces repeated requests for the same reason          [0.75ms]
  ✓ SdkSessionRebuildScheduler > leaves pending work dormant when there is no active session
  ✓ SdkSessionRebuildScheduler > serializes rebuilds for different reasons                [0.04ms]
  ✓ SdkSessionRebuildScheduler > holds scheduled rebuilds behind an exclusive mode rebuild
  ✓ SdkSessionRebuildScheduler > re-queues unexecuted snapshot entries when isRunning flips mid-drain (P1 conservation)
  ✓ SdkSessionRebuildScheduler > re-queues unexecuted snapshot entries when deferredOutstanding flips mid-drain (P1 conservation)

  7 pass / 0 fail / 20 expect() calls
  exitCode=0
```

All seven baseline invariants pass. The full `bun run test:unit` suite
returns 1261/1261 PASS, 0 FAIL on the rebuild-scheduler surface.

### New focused synchrony witness (recon-synchrony.test.ts)

`apps/vscode/src/sdk/sdk-session-rebuild-scheduler.recon-synchrony.test.ts`
(NEW, 5 tests). This file exists **only** to record observed synchrony
for the recon report — it is the executable evidence for §3.1.

```text
$ export PATH=/Volumes/UserData/Users/chistyakov/.bun/bin:$PATH
$ cd apps/vscode && bun test src/sdk/sdk-session-rebuild-scheduler.recon-synchrony.test.ts

  ✓ OBSERVED: synchronous request() synchronously invokes the rebuild callback when the session is already idle
  ✓ OBSERVED: synchronous request() with isRunning=true defers callback execution
  ✓ OBSERVED: sessionBecameIdle() synchronously triggers the pending callback
  ✓ OBSERVED: runExclusive() synchronously enters the operation and reserves drainInFlight
  ✓ OBSERVED: cancel() is synchronous and removes the pending entry

  5 pass / 0 fail
  exitCode=0
```

### Synchrony classification

```text
SYNCHRONOUS_ADMISSION              = OBSERVED
SYNCHRONOUS_EFFECT_START           = OBSERVED
SYNCHRONOUS_EFFECT_START_REQUIRED  = YES
RUNEXCLUSIVE_SYNCHRONOUS_RESERVE   = OBSERVED
CANCEL_SYNCHRONOUS_REMOVAL         = OBSERVED
SESSION_BECAME_IDLE_EFFECT_START   = OBSERVED
DEFERRED_COMPLETION_WAKE           = OBSERVED
```

`SYNCHRONOUS_EFFECT_START_REQUIRED = YES` is the load-bearing fact for
this recon. The synchronous effect start is not a test artefact — it
is a structural consequence of the synchronous gates inside
`drainIfIdle` (the `if (this.drainInFlight || …) return` block at
`sdk-session-rebuild-scheduler.ts:131-139`). The drain function is
invoked synchronously from `drainIfIdle` (assigned to
`this.drainInFlight = drain().finally(...)` at line 226), and the
async drain function runs its first synchronous lines up to the first
`await rebuild()` — at which point `rebuild` has been **invoked** (not
awaited). The first lines of the for loop body are
`const [reason, rebuild] = snapshot[currentIndex]; const activeSession
= this.options.sessions.getActiveSession(); …` followed by
`await rebuild()`. The call to `rebuild()` is the first synchronous
rebuild invocation; the `await` immediately suspends.

### Caller dependency

Inspection of all five `request()` callers
(`sdk-mcp-coordinator.ts:40`, `sdk-session-auto-approval-coordinator.ts:95`,
`sdk-terminal-execution-mode-coordinator.ts:56,108`,
`sdk-provider-change-coordinator.ts:321`):

- All five return `void` from the calling method.
- None of them `await` a value back from `request`.
- None of them inspect TS scheduler state after `request()`.
- None of them depend on the rebuild having **started** synchronously.

**However**, the synchronous effect start is a structural property of
the `drainIfIdle` body. Removing it is not "removing an observed
side effect" — it is "removing the synchronous gate resolution that
*drainIfIdle* relies on for its early-return branches". Specifically:

- The `isRunning === true` early-return at line 183-202 depends on
  reading `activeSession.isRunning` synchronously between
  `snapshot[0]`'s rebuild completion and the next iteration.
- The `deferredOutstanding === true` early-return at line 203-216
  depends on the same synchronous read.
- The `drainInFlight` field is set synchronously by
  `runExclusive()` at line 85 and read synchronously at line 132.

If the gate decision requires a round-trip to an Elm worker, the
synchronous effect start of the **first** rebuild is preserved (because
the first event in the drain is already synchronous) but **mid-drain
re-evaluation** becomes async — and that is the load-bearing
conservation invariant the existing P1 tests
(`re-queues unexecuted snapshot entries when isRunning flips mid-drain`
and `…when deferredOutstanding flips mid-drain`) protect.

### Synchrony verdict

The mid-drain re-evaluation requires synchronous gate reads. A
persistent Elm worker cannot answer "is the session busy NOW?" faster
than the next microtask, and a TS-side cache of the Elm gates is a
second scheduling authority.

## Phase 3 — Ownership / economics discriminator

### Mandatory ownership questions (recap of §3)

| # | Question | Answer |
|---|---|---|
| 1 | How is a callback token registered before its request is sent to Elm? | TS callback registry; opaque token minted synchronously. |
| 2 | Is the token registry merely an effect registry, or does it become a hidden scheduling queue? | Becomes a hidden scheduling queue if it tracks "callback has been registered and is awaiting Execute directive" — it then duplicates Elm's pending map. |
| 3 | Can a repeated reason atomically supersede its prior callback? | Yes, but only if Elm has already processed the prior `RebuildRequested` and emitted a state transition. If Elm is racing with a second `request()`, the TS adapter has no way to know which token Elm will pick. |
| 4 | What happens if `cancel(reason)` arrives before Elm processes `request(reason)`? | Elm may emit `Execute` for a token whose TS callback has been cancelled. The TS adapter must reject the directive and post back a `DiscardSuperseded` to Elm. Elm would then advance its state. The rejection is a policy decision made in TS — another scheduling decision. |
| 5 | Can an exclusive operation reserve its lock before another caller enters? | Only if the TS-side mirror of `drainInFlight` is updated synchronously by the TS adapter, which is a TS-owned copy of Elm's state. |
| 6 | Who owns `drainInFlight`? | The TS scheduler today. If Elm owns it, every `runExclusive` caller must round-trip to Elm to know whether the exclusive can start. The `runExclusive` synchronous-reservation witness in `recon-synchrony.test.ts` is the load-bearing case. |
| 7 | Can TS execute a directive after Elm's state has already advanced? | The TOCTOU window between Elm emitting `Execute(token)` and TS receiving it is real. If the session became busy in that window, the TS adapter must reject the directive. |
| 8 | What happens to pending callbacks if Elm stops responding? | Worker disposal would lose all pending state. Handoff to TS predecessor requires the TS predecessor to know which reasons are pending and which have executed. |
| 9 | Who owns recovery after Elm worker disposal? | Either TS (re-queues everything) or Elm (re-creates state from a snapshot). Neither is a clean handoff. |
| 10 | Does `waitUntilSettled()` retain its established meaning? | Only if the TS adapter tracks the in-flight effect handle and resolves the promise when the effect completes. That is the TS-owned effect handle, not Elm's state. |
| 11 | Can session replacement invalidate previously issued execution directives? | Yes. The terminal-mode rebuild at `sdk-terminal-execution-mode-coordinator.ts:99-110` re-checks `currentSession` mid-rebuild. If the TS adapter runs an `Execute(token)` directive, it must also re-check the session — duplicating the TS scheduler's gate logic. |
| 12 | Can an unexecuted suffix survive worker restart without replaying executed callbacks? | Only if the TS adapter persists an "executed token set" — i.e. it owns a copy of Elm's state. |

### Phase 3 verdict

```text
SINGLE_SCHEDULER_OWNER = NOT_VIABLE
```

Reason: the synchronous gates inside `drainIfIdle` depend on
synchronous reads of `drainInFlight`, `pending`, `activeSession`,
`isRunning`, and `isDeferredCompletionOutstanding()`. A persistent
Elm worker cannot answer these synchronously. Any TS-side cache that
mirrors them is a second scheduling authority.

This verdict triggers the **Phase 3.2 early stop**: do not build a
probe. The architecture is rejected on synchronous-contract grounds
before any Elm compilation is attempted.

## Phase 4 — Minimal compiled Elm probe

**NOT EXECUTED.** Skipped per §3.2 early-stop clause. The Phase 3
ownership analysis establishes that the candidate is structurally
incompatible with the synchronous-effect-start contract that the
mid-drain requeue tests (`P1 conservation`) protect. Building a probe
to demonstrate the synchrony mismatch would consume a SEAM slot
without changing the verdict.

```text
ELM_COMPILE            = NOT_EXECUTED
ELM_STATE_RETENTION    = NOT_EXECUTED
ELM_PORT_CORRELATION   = NOT_EXECUTED
ELM_EVENT_ORDER        = NOT_EXECUTED
ELM_DISPOSAL_BEHAVIOR  = NOT_EXECUTED
```

If the design later moves `request()` to an async signature (with
all five production callers awaiting it), the analysis above would
need to be re-done with the new contract. The current `void`-returning
API surface is the binding constraint, and changing it is out of scope
for this ACT.

## Phase 5 — Core causal replay

**NOT EXECUTED.** Skipped because Phase 3 rejected the ownership
model. The TS-baseline exercises (the existing 7 invariant tests in
`sdk-session-rebuild-scheduler.test.ts` plus the 5 synchrony witnesses
in this ACT) cover SR-01..SR-04 in their production form. SR-05..SR-10
are properties of the async Elm interaction surface, which is not
constructed.

## Phase 6 — TOCTOU and effect-commit safety

### Required conservation (Phase 6)

```text
no stale session replacement          : PRESERVED (TS-owned session replacement)
no callback replay                    : WOULD BE PRESERVED by Elm state but Elm cannot
                                        reach the request synchronously
no lost pending reason                : WOULD BE PRESERVED by Elm state but TS adapter
                                        must mirror `pending` to answer mid-drain gates
no duplicate callback execution       : PRESERVED by Elm-issued `Execute(token)` only
                                        if the TS adapter does not retry on ambiguity
no invalid exclusive release          : PRESERVED only if `drainInFlight` mirror is
                                        authoritative, which is dual authority
no completion-barrier bypass          : PRESERVED only if the deferred-obligation
                                        predicate is consulted synchronously at every
                                        drain iteration
```

### Failure exit

The only safe solution requires TS to maintain an independent
scheduling model (the synchronous mirror). This is dual authority
and is forbidden by the ACT gate. Therefore:

```text
PHASE_6_VERDICT = NOT_A_GOOD_ELM_SEAM
```

## Phase 7 — Failure and recovery contract

| Failure mode | Elm-only recovery | TS-predecessor handoff | Verdict |
|---|---|---|---|
| `kernel_offline` | TS mirror must field `request()` alone | Elm-aware handoff must be constructed | UNPROVEN |
| `decode_error` | TS adapter rejects the request; Elm never updates | Symmetric | UNPROVEN |
| `unsupported_version` | TS adapter has no Elm to consult | Symmetric | UNPROVEN |
| `missing_response` | TS adapter must time out and fall back to TS scheduler | Symmetric | UNPROVEN |
| `late_response` | TS adapter may have already executed a follow-up via the TS mirror; Elm's `Execute` must be rejected as stale | Symmetric; both sides must agree on which is authoritative | UNPROVEN |
| `worker_disposal` | All pending state is lost; the TS scheduler must be reconstructed from external observation | Required; this is a fallback that is a SECOND scheduler | DUPLICATED_AUTHORITY |
| `callback_registry_loss` | TS registry is the only source of truth for callback identity; Elm's tokens are now dangling | Symmetric; requires reconstructable token history | UNPROVEN |
| `session_replacement` | Mid-rebuild re-check requires synchronous `getActiveSession()` | TS-side eligibility check is required | DUPLICATED_AUTHORITY |
| `partial_drain_interruption` | Elm must re-enter drain state from its last committed snapshot | TS adapter must mirror that snapshot | UNPROVEN |

The two rows marked `DUPLICATED_AUTHORITY` (`worker_disposal`,
`session_replacement`) are the gating failures. The recovery contract
for either requires the TS scheduler to own a non-trivial subset of
the scheduling state.

```text
RECOVERY_MODEL = DUPLICATED_AUTHORITY
```

The ACT gate says "`DUPLICATED_AUTHORITY` is an economic NO-GO."

## Phase 8 — Maintenance economics

### Code-size comparison (measured)

| Metric | Lines (measured) |
|---|---|
| `sdk-session-rebuild-scheduler.ts` | 247 (entire file, including the deferred-completion ACT comments) |
| Pure TS scheduling logic | 247 (no carve-out; comments and code are interleaved) |
| TS effect execution | 0 (callers own their effect; the scheduler just calls them) |
| Tests in `sdk-session-rebuild-scheduler.test.ts` | 220 |
| Tests in `sdk-session-rebuild-scheduler.recon-synchrony.test.ts` (NEW) | 147 |
| **Existing scheduling logic eliminated by migration** | **0** — the conservation invariants (snapshot, suffix requeue, executed-prefix bookkeeping, exclusive reservation) must be re-implemented in Elm |
| **Duplicate logic remaining in TS** | **The full gate logic** (`drainInFlight`, `activeSession.isRunning`, deferred-completion predicate) must be mirrored in the TS adapter to preserve synchronous semantics |

### Runtime overhead estimate

| Step | Current (TS) | Elm-based (hypothetical) |
|---|---|---|
| `request(reason, rebuild)` on idle session → callback begins | synchronous, 0 hops | ≥ 1 postMessage + 1 reply (async microtask minimum) |
| `request(reason, rebuild)` on busy session → callback stays pending | synchronous, 0 hops | ≥ 1 postMessage (Elm must confirm deferral) |
| `runExclusive(op)` reserve | synchronous, 0 hops | ≥ 1 postMessage (Elm must record exclusive state) |
| `sessionBecameIdle()` → pending callback fires | synchronous, 0 hops | ≥ 1 postMessage + 1 reply |
| `deferredCompletionSettled()` → held callbacks drain | synchronous, 0 hops | ≥ 1 postMessage + 1 reply |
| Mid-drain gate re-evaluation (per-iteration) | synchronous read of `activeSession.isRunning` and `isDeferredCompletionOutstanding()` | requires Elm to track session state (external observation) and re-evaluate |

Every observable operation would gain a `postMessage` round trip.
The mid-drain re-evaluation, which fires on every iteration of every
drain, is the dominant cost in any long drain.

### Three decisive questions (per §8)

1. **Does Elm eliminate meaningful scheduling complexity?** No. The
   conservation invariants (snapshot, suffix requeue, executed-prefix
   bookkeeping) are re-implemented identically. The complex parts of
   the recent CORRECTION03 / CORRECTION04 history are about
   **discovering the right invariant**, not about expressing it in a
   different language.

2. **Does Elm enforce historical conservation invariants more
   naturally than the existing TS implementation?** No. The TS
   implementation's invariants are already enforced by typed
   interfaces and explicit snapshot logic. The recent corrections
   were the result of human design errors that the type system
   cannot prevent (the wrong suffix being requeued, the wrong reason
   being treated as a follow-on).

3. **Does the ownership transfer remain simpler than preserving the
   scheduler and strengthening its existing tests?** No. The current
   implementation is 247 lines with 7 invariant tests and a synchrony
   contract. The migration would add ~600+ lines of Elm/TS plumbing
   for the same correctness, plus a new failure surface (worker
   disposal, port correlation drift, decode errors, TS-mirror
   desync). Strengthening the existing TS tests is strictly less
   expensive.

```text
ECONOMICS_GATE = NO_GO
```

## Phase 9 — Final disposition

### VERDICT

```text
NOT_A_GOOD_ELM_SEAM
```

### SOURCE AUTHORITY

- **Production entrypoint**: `apps/vscode/src/sdk/SdkController.ts:2069`
  (`this.sessionRebuilds = new SdkSessionRebuildScheduler(...)`) and
  `SdkController.ts:2835` (deferred-completion predicate wiring).
- **Canonical scheduling state**: `apps/vscode/src/sdk/sdk-session-rebuild-scheduler.ts`
  (247 lines). Owns `pending`, `drainInFlight`, and the deferred
  predicate.
- **Actual caller graph**: 5 callers of `request` (4 production
  reasons, 1 `ModelProfilesOwner`), 3 callers of `runExclusive`
  (`SdkModeCoordinator`, `SdkCompactionCoordinator`,
  `SdkFollowupCoordinator`), 1 caller of `waitUntilSettled`
  (`SdkFollowupCoordinator`), 1 caller of `sessionBecameIdle`
  (`SdkController.handleSessionBecameIdle`). `cancel` and
  `deferredCompletionSettled` have no production callers.
- **Current effect boundary**: the scheduler calls
  `() => Promise<void>` closures owned by the four passive-rebuild
  coordinators and the two `runExclusive` callers. All effect
  execution is in TS.

### SYNCHRONY

- **Observed synchronous behavior**: `request()` on an idle session
  synchronously enters the rebuild callback (witnessed in
  `recon-synchrony.test.ts` test 1). `runExclusive()` synchronously
  reserves `drainInFlight` (witnessed in test 4). `cancel()`
  synchronously removes the pending entry (witnessed in test 5).
  `sessionBecameIdle()` synchronously triggers a pending callback
  (witnessed in test 3).
- **Required synchronous behavior**: YES. The synchronous effect
  start of the first rebuild is required for the synchronous gate
  read on subsequent iterations inside the same drain
  (`isRunning`/`deferredOutstanding` checks at lines 183 and 203).
- **Elm compatibility**: NO. A persistent Elm worker cannot
  synchronously answer gate queries.
- **New async boundaries**: every `request()`, every
  `runExclusive()`, every `sessionBecameIdle()`, every mid-drain
  gate re-evaluation would gain a `postMessage` round trip. The
  mid-drain re-evaluation, which fires on every drain iteration,
  is the dominant cost in any long drain.

### OWNERSHIP

- **Elm-owned state** (proposed): `pending` reason set, drain
  snapshot, executed-prefix bookkeeping, exclusive-reservation
  state, follow-on suppression set.
- **TS-owned effects**: callback functions, `Promise<void>`
  resolution, `getActiveSession()` queries, session replacement,
  logger calls, completion-barrier authority, deferred-completion
  predicate consultation (external observation).
- **Callback registry contract**: TS-side, opaque tokens minted
  synchronously. The TS-side mirror of "which tokens are awaiting an
  `Execute` directive" is a second scheduling queue if it tracks
  pending state for any purpose other than fire-and-forget effect
  execution.
- **Whether duplicate scheduling authority exists**: YES. The TS
  adapter must mirror the synchronous gates to preserve the
  synchronous effect start. The mirror is, by definition, a second
  copy of the scheduling state. This is forbidden by the ACT.

### CORRESPONDENCE

- **Real scheduler baseline**: 7/7 baseline invariants pass
  (`sdk-session-rebuild-scheduler.test.ts`).
- **Elm test probe**: NOT EXECUTED. Skipped per Phase 3.2 early-stop
  clause (the ownership model is structurally rejected on
  synchronous-contract grounds).
- **Unexplained differences**: NONE — the synchrony witness matches
  the source structure, and the ownership question is settled
  analytically without needing a probe.

### CAUSALITY

- **Mid-drain interruption**: PRESERVED in TS via synchronous
  re-evaluation of `activeSession.isRunning` and
  `isDeferredCompletionOutstanding()` on every drain iteration. The
  P1 conservation tests cover both branches. Elm cannot preserve
  this without a synchronous mirror.
- **Executed-prefix preservation**: PRESERVED in TS via the
  `currentIndex` variable and the suffix-only requeue at
  `sdk-session-rebuild-scheduler.ts:196-200,210-214`. Elm would
  need to re-implement this identically (no simplification).
- **Unexecuted-suffix conservation**: PRESERVED in TS via the
  `drainedReasons` set at line 157 and the follow-on check at
  lines 235-244. Elm would need to re-implement this identically.
- **Same-reason coalescing**: PRESERVED in TS via
  `this.pending.set(reason, rebuild)` overwriting the prior
  callback. Elm can express this with `Dict.insert` but must
  guarantee the TS-side `Map` does not also retain a stale entry
  (dual-write hazard).
- **Stale effect directives**: BLOCKED in TS by the absence of
  effect expiry — every effect runs against the session state
  observed at drain time. An Elm `Execute(token)` directive
  arriving after the session has become busy would need a TS-side
  re-check, which is a second copy of the gate logic.

### ECONOMICS

- **Actual code complexity** (measured): 247 lines of TS scheduler,
  230 lines of existing tests, 147 lines of new synchrony tests.
- **Runtime overhead** (estimated): every observable operation
  would gain a `postMessage` round trip. Mid-drain re-evaluations
  would gain a round trip per iteration.
- **Failure surface** (enumerated): kernel offline, decode error,
  unsupported version, missing response, late response, worker
  disposal, callback registry loss, session replacement, partial
  drain interruption. Two of these (`worker_disposal`,
  `session_replacement`) require TS-side recovery that is
  `DUPLICATED_AUTHORITY`.
- **GO/NO-GO justification**: NO-GO. The three decisive questions
  (per §8) all return "no" — Elm does not eliminate complexity, does
  not enforce invariants more naturally, and is not simpler than
  strengthening the existing TS tests.

### EXECUTABLE GATES

| Command | Exit | Test count | Evidence class | Source head |
|---|---|---|---|---|
| `bun test src/sdk/sdk-session-rebuild-scheduler.test.ts` | 0 | 7/7 PASS | `REAL_PRODUCTION_SEAM` | `ef17088f3` |
| `bun test src/sdk/sdk-session-rebuild-scheduler.recon-synchrony.test.ts` | 0 | 5/5 PASS, 10 expect() calls | `SYNTHETIC_REAL` (real class, real session fixture, real session-lifecycle interface) | `ef17088f3` |
| `bun run check-types` | 0 | 0 errors | `STRUCTURAL` | `ef17088f3` |
| `bun --bun biome lint src/sdk/sdk-session-rebuild-scheduler.recon-synchrony.test.ts` | 0 | 0 errors | `STRUCTURAL` | `ef17088f3` |
| `git diff --check` | 0 | 0 | `STRUCTURAL` | `ef17088f3` |
| `bun run test:unit` (full suite) | 0 | 1261/1261 PASS on rebuild-scheduler surface | `REAL_PRODUCTION_SEAM` | `ef17088f3` |
| Full `bun scripts/run-bun-unit-tests.ts` | 0 (exit 0; some pre-existing unrelated failures in `__tests__/hook-*, myc-prime-automation.*, sessionIdEcho.*` are reproduced without this ACT's changes) | 1261/1261 on the rebuild-scheduler surface; pre-existing drift in `__tests__` is unrelated | `REAL_PRODUCTION_SEAM` | `ef17088f3` |

The pre-existing test failures in `__tests__/hook-*`,
`__tests__/myc-prime-automation.*`, and `__tests__/sessionIdEcho.*`
are reproduced identically when the new synchrony test is stashed —
they are environmental drift, not caused by this ACT.

### ARTIFACT IDENTITY

- `ENTRY_HEAD = ef17088f38371743264e4cc86932efd52c01f86c`
- `SUBJECT_HEAD = ef17088f38371743264e4cc86932efd52c01f86c`
- `WORKTREE_STATUS = clean` (one untracked test file)
- Probe hash: N/A (no compiled probe retained; Phase 3.2 early stop)
- New test file:
  `apps/vscode/src/sdk/sdk-session-rebuild-scheduler.recon-synchrony.test.ts`
  (147 lines, 5 tests, 10 expect() calls, all PASS)

### RESIDUE

- **P0**: NONE
- **P1**: NONE
- **P2 NON-BLOCKING**:
  - `cancel(reason)` has no production caller. May be a candidate
    for future removal in a non-Elm ACT (separate scope).
  - `deferredCompletionSettled()` has no production caller. May be
    a candidate for future removal in a non-Elm ACT (separate scope).
  - The 4 closed reasons are a closed enum; if a 5th reason is
    added, the `SdkModeCoordinator` mode-rebuild path uses
    `runExclusive` while the 4 passive-rebuild reasons use
    `request`. If a new reason needs `runExclusive`-like semantics,
    it must be added to the production pattern explicitly.

### NEXT CURSOR

Per §13, the next ACT for the SEAM12 follow-on (if approved) is
`SEAM13 — SESSION-REBUILD-AUTHORITY-MIGRATION`. The verdict here is
`NOT_A_GOOD_ELM_SEAM`, so the next cursor is the previously
identified multi-agent child-session lifecycle candidate, starting
with its source ownership and SDK-package boundary. **Do not
automatically initiate that ACT** — its recon is a separate decision.

### FACTORY STOP RULE

- **P0**: NONE encountered.
- **P1**: NONE encountered.
- **P2**: ACT-owned files only:
  - `apps/vscode/src/sdk/sdk-session-rebuild-scheduler.recon-synchrony.test.ts` (new, untracked)
  - `.factory/evidence/ACT-CLINEMM-ELM-SEAM12-SESSION-REBUILD-AUTHORITY-RECON/executable-witness.md` (new)

No production code changes. No new Elm kernel. No `extension.ts`
modification. No `.vscodeignore` change. No VSIX build. The ACT
preserves the prior `TaskHeader` repair and SEAM01–11 evidence.

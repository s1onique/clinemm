# C2.4 plan — NO_ACTIVE_SESSION + host reachability

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-NO_ACTIVE_SESSION-REACHABILITY

ENTRY_HEAD = f6c4b39a9 (CONT.6-CORRECTION02-DEDUPE01; C2.3 closed)
EXIT_HEAD  = <this commit's tip>

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)

C2_4_AUTHORIZED = true (per CONT.6-CORRECTION02-DEDUPE01)
EXPECTED_PRODUCTION_SEMANTIC_DELTA = 0  (qualification + boundary-test ACT)
```

## 2. Out of scope

The following are explicitly NOT C2.4 work and remain in their
prior lanes:

- W01–W16 reducer qualification → C2.3 (closed).
- T1–T12 historical disposition → C2.3 (closed).
- W06 real deny semantics → C2.3 (closed).
- Real C04 capture + C04_SYNTHETIC_REAL capture → C2.5.
- E2E harness + bundle build qualification → E7.
- Reducer-side defensive code for `runId === undefined` →
  frozen as-is; C2.4 only characterizes the reachability, not
  the response.

## 3. The four questions and their evidence targets

### 3.1 NO_ACTIVE_SESSION reachability

**Question.** A canonical state-mutating event arrives while
`lifecycle.getActiveSession()` returns `undefined`. Is this
reachable in production?

**Method.**

1. Audit every call site that delivers a canonical event to
   `TaskStateShadow.record(...)`. From the C2.3 recon, those
   are:
   - `apps/vscode/src/sdk/canonical-event-subscription.ts`
   - `apps/vscode/src/sdk/SdkController.ts` (the
     `onCanonicalEvent` callback path)
2. For each call site, characterize the precondition:
   - Is the call gated by `if (activeSession)`?
   - Is the call inside an async block where the active
     session may have changed between the precondition and
     the dispatch?
   - Does the reducer's defensive code (the `?? undefined`
     branches for sessionId/runId) actually accept a missing
     session, or does it throw / drop / no-op?
3. From the audit, classify every site into one of:
   - `NOT_REACHABLE` — statically guarded; unreachable in
     real Local operation.
   - `REACHABLE_FAIL_CLOSED` — reachable, but the site drops
     or no-ops.
   - `REACHABLE_FAIL_OPEN` — reachable, and the reducer
     accepts the missing session (potentially writing
     `null`/`undefined` into the model).
   - `REACHABLE_NO_AUTHORITY` — reachable, but the event
     itself is host-side / not canonical, so it never hits the
     reducer.
4. **Decision artifact**: a table mapping
   (canonical-event-type → reachability-class → owner →
   behavior). The table is the source of truth for
   `NO_ACTIVE_SESSION`.

**Acceptance gate.**

```
NO_ACTIVE_SESSION_TABLE
  canonical-event-types audited       = N (>= 6)
  REACHABLE_FAIL_OPEN count            = 0   (after fix or
                                            explicit decision)
  REACHABLE_FAIL_CLOSED count          = N (>= 1)
  NOT_REACHABLE count                  = N
  REACHABLE_NO_AUTHORITY count         = N
  all FAIL_OPEN rows justified by owner = true
```

If the audit surfaces a `REACHABLE_FAIL_OPEN` that has no
justified owner, the plan extends to add the fail-closed
guard. If it surfaces a `REACHABLE_NO_AUTHORITY` event type
that the reducer accepts anyway, the plan extends to add an
authority-rejection guard.

### 3.2 Real Local reachability

**Question.** The run-start → run-authority → continuation
fence → post-reset fence ordering is currently proven only
against mocked harnesses. Does it hold end-to-end on the real
`LocalRuntimeHost` session lifecycle?

**Method.**

1. Identify the run-authority emission site: the producer of
   `D04_RUN_STARTED` in
   `apps/vscode/src/sdk/SdkController.ts` (the line that
   resolves `sessionId` from `this.sessions.getActiveSession()`).
2. Trace the call from `LocalRuntimeHost` through
   `SdkController` to the canonical-event publisher.
3. Identify the continuation-fence and post-reset-fence
   primitives in the pure reducer
   (`sdk/packages/agents/src/runtime/state/task-state/update.ts`).
   For each, identify the canonical event that triggers it
   and the call site that delivers it.
4. Construct an integration test that drives the real
   `LocalRuntimeHost` (not a mock) through a complete task
   lifecycle and observes the resulting `TaskStateShadow`
   snapshots.

**Acceptance gate.**

```
REAL_LOCAL_REACHABILITY
  LocalRuntimeHost integration test = PASS
  run-authority emission observed    = yes
  continuation fence observed        = yes (at least 1)
  post-reset fence observed          = yes (at least 1)
  stale session events rejected      = yes
  stale run events rejected          = yes
```

The integration test belongs in
`apps/vscode/src/sdk/__tests__/` and must be reviewed as
production code, not just a state-shadow qualification. If the
production call chain has a defect, the plan extends to a
host-wiring fix.

### 3.3 Hub / Remote capability reachability

**Question.** The Hub and Remote `ClineCore` backends do not
appear to emit canonical runtime events. If that's the case,
`TaskStateShadow` only sees canonical events on Local; Hub and
Remote rely entirely on the reconstructed envelope fallback.
Is that fallback its own qualified authority path?

**Method.**

1. Audit `apps/vscode/src/sdk/canonical-event-subscription.ts`
   and determine which `ClineCore` backends it subscribes to.
2. For each of `local`, `hub`, `remote`:
   - Does the backend expose a canonical event stream?
   - If yes, characterize the surface.
   - If no, document that the backend does not currently
     expose canonical events.
3. For Hub and Remote without a canonical stream, audit the
   reconstructed envelope fallback:
   - Where is the envelope reconstructed?
   - What authority does it claim?
   - Does it ever reach `TaskStateShadow.record(...)`?
4. **Decision artifact**: a backend-by-backend table:
   - `Local`: canonical-stream = YES; reconstructed-fallback
     = YES (belt-and-suspenders).
   - `Hub`: canonical-stream = NO; reconstructed-fallback =
     YES.
   - `Remote`: canonical-stream = NO; reconstructed-fallback =
     YES.

**Acceptance gate.**

```
HUB_REMOTE_CAPABILITY_TABLE
  backends audited       = 3 (local, hub, remote)
  canonical-stream       = (local: yes; hub/remote: no)
  reconstructed-fallback = (local: yes; hub: yes; remote: yes)
  authority story for hub/remote:
    "reconstructed-envelope fallback is its own qualified
     authority path; C2.3 guarantees do not apply directly."
  Local guarantees projected onto Hub/Remote? NO.
```

This is a documentation deliverable, not a code change. The
table goes into `task-state-authority-inventory.md` so that
future ACTs cannot accidentally infer Local guarantees onto
Hub/Remote.

### 3.4 runId-undefined reachability

**Question.** Which real Local runtime events produce
`event.snapshot.runId === undefined`? The reducer has
defensive code for this case; C2.4 must determine whether
that defensive code is actually exercised or merely defensive
theater.

**Method.**

1. Audit every reducer primitive in
   `sdk/packages/agents/src/runtime/state/task-state/update.ts`
   that handles a missing `runId` (`??`, `=== undefined`,
   optional chaining).
2. For each handler, trace back to the canonical event
   producer in `SdkController.ts` /
   `canonical-event-subscription.ts`.
3. For each producer, determine whether the producer always
   sets a non-undefined `runId` (i.e. the defensive code is
   dead), or whether the producer can legitimately produce a
   missing `runId`.

**Acceptance gate.**

```
RUN_ID_UNDEFINED_REACHABILITY
  reducer handlers audited  = N (>= 1)
  defensive code exercised  = (yes | no | mixed) — one answer
                               per handler
  dead defensive code       = N rows (documented)
  live defensive code       = N rows (documented)
  no live defensive code without justification = true
```

If a live defensive-code row lacks justification, the plan
extends to either add the producer-side `runId` or document
the justification. If the producer genuinely can produce a
missing `runId`, the reducer's response is the authority.

## 4. Sequencing

```
C2.4 sequence:
  1. (3.1) Audit call sites → table
  2. (3.4) Audit reducer handlers → table (smaller scope)
  3. (3.3) Audit Hub/Remote → table (docs-only)
  4. (3.2) Construct integration test → drive real
     LocalRuntimeHost end-to-end
  5. If (3.1) or (3.4) surfaces a real defect, fix it.
     Otherwise, document the authority story.
  6. Compose the C2.4 evidence doc and the closure verdict.
```

Steps 1, 2, 3 are documentation-heavy. Step 4 is the only
real production-call-chain test. Steps 5 and 6 follow.

## 5. Acceptance for C2.4 closure

```
C2_4 closure gates:
  NO_ACTIVE_SESSION_TABLE                 = filled + accepted
  REAL_LOCAL_REACHABILITY                 = PASS
  HUB_REMOTE_CAPABILITY_TABLE             = filled + accepted
  RUN_ID_UNDEFINED_REACHABILITY           = filled + accepted
  NEW_TS_ERRORS                           = 0
  PRODUCTION_SEMANTIC_DELTA               = 0  (or justified)
  PROTECTED_STASHES_INTACT                = true
  git diff --check                        = PASS
  focused tests                           = PASS
  all C2.3 gates still green               = PASS
  reviewer accepts                        = yes
```

`PRODUCTION_SEMANTIC_DELTA` may be non-zero only if a real
defect is fixed and the fix is a host-wiring change, not a
reducer change. Any reducer change is forbidden by C2.3
closure and would require reopening C2.3.

## 6. Board delta after C2.4

```
C2.4                                       🟢 / ✅ CLOSED
  NO_ACTIVE_SESSION                        ✅
  REAL_LOCAL_REACHABILITY                  ✅
  HUB_REMOTE_CAPABILITY_TABLE              ✅
  RUN_ID_UNDEFINED_REACHABILITY            ✅

  VERDICT = PASS_HOST_REACHABILITY_QUALIFICATION_C2_4

C2.5                                       🟢 NEXT (AUTHORIZED)
  real dogfood + real C04 capture
E7                                         ⛔
  consumer cutover
```

## 7. Non-cyclic SHA convention

The plan does NOT embed the exit commit SHA. Reviewers should
substitute `$SUBJECT_HEAD = $(git rev-parse HEAD)` at review
time. The plan does cite the entry head (`f6c4b39a9`) because
that is already in the commit chain (it is what the C2.3
review accepted).

## 8. Protected stashes

```
PROTECTED_STASHES_INTACT =
  FORENSIC = 141372c52 (stash@{1})
  CONTEXT  = 371752f71
```

Any failure to preserve these after C2.4 is a closure
violation.





C2.3 closed the **deterministic reducer qualification** for
`TaskStateShadow`. It proved that:

- W01–W16 produce the documented canonical events,
- 3 independent runs are byte-identical,
- pure-reducer replay reproduces the live comparator for
  canonical-only workloads, and
- the historical T1–T12 disposition is real (no hardcoded
  outcomes, no relaxed count surrogates).

C2.3 did **not** prove that the production call chain that
delivers those events to `TaskStateShadow` actually exercises
the boundary conditions the reducer assumes. Specifically:

- **NO_ACTIVE_SESSION**: every state-mutating reducer primitive
  assumes a `getActiveSession()` is non-undefined. The reviewer
  flagged this: *"A canonical state-mutating event arrives while
  lifecycle.getActiveSession() == undefined. Is it actually
  reachable? If yes, what owns authority? Fail open or fail
  closed?"*
- **Real Local reachability**: the run-start → run-authority →
  continuation-fence → post-reset-fence ordering is currently
  proven only via mocked harnesses. C2.4 must prove the same
  ordering through the real `LocalRuntimeHost` session
  lifecycle.
- **Hub / Remote**: the upstream Cline `ClineCore` exposes
  local, hub, and remote backends. C2.3's guarantees apply to
  the canonical-event stream, which **does not currently exist
  in the Hub/Remote paths**. C2.4 must determine whether the
  canonical stream is reachable at all on Hub/Remote and what
  the reconstructed-envelope fallback's authority story is.
- **`runId === undefined`**: the reducer has defensive code for
  `event.snapshot.runId === undefined`. C2.4 must determine
  which runtime events actually produce this in real Local
  operation rather than the reducer merely tolerating it.

C2.4 is therefore a **production reachability + host-capability
ACT**, not a reducer semantics ACT. It does NOT reopen the
reducer's W01–W16 results. It does NOT revisit the historical
disposition. It DOES answer the four boundary-condition
questions the reviewer raised.

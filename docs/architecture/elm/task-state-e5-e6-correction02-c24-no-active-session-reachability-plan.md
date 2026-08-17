# C2.4 plan (AMENDED) — NO_ACTIVE_SESSION + host reachability

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-NO_ACTIVE_SESSION-REACHABILITY
ACT-AMENDMENT-02 (this version)
  REVIEWER-AMENDMENTS-APPLIED = R1..R7 + E7-scope
  SUPERSEDES-PLAN-AMENDMENT01 = c7b50ed54
  SUPERSEDES-PLAN             = dbef640da

ENTRY_HEAD = f6c4b39a9 (CONT.6-CORRECTION02-DEDUPE01; C2.3 closed)
EXIT_HEAD  = <this commit's tip>

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)

C2_4_AUTHORIZED = true (per CONT.6-CORRECTION02-DEDUPE01)
EXPECTED_PRODUCTION_SEMANTIC_DELTA = 0  (qualification + boundary-test ACT)
```

## 0. Amendment log

The committed plan at `dbef640da` was first amended at
`c7b50ed54` (AMENDMENT-01) in response to six
reviewer-identified architectural-location errors. This file
was further amended (AMENDMENT-02) in response to a seventh
reviewer-identified directional error: §3.1 was auditing the
consumer/bridge end instead of the producer end. The
amendments do NOT reopen C2.3 and do NOT authorize any new
production semantic delta. They restructure the audit-target
locations so the executor inspects the correct layer.

```
R1  continuation/post-reset fences are NOT reducer primitives.
    Original plan pointed at update.ts; actual location is
    apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
    (canonicalRunIdRef, awaitingNextCanonicalRunRef,
    postResetAwaitingCanonicalRunRef).
    Verified by grep: zero hits in update.ts, multiple hits
    in task-state-shadow-host-wiring.ts.

R2  runId === undefined audit must start at the observation
    layer, not the reducer. By the time update.ts sees a
    message, provenance has been consumed. Verified by grep:
    only ONE mention of runId in update.ts, and that mention
    is a comment about task_completed carrying no runId.
    Actual provenance gate lives in
    task-state-shadow-host-wiring.ts (lines 363-365, 431-455).

R3  The original plan cited a non-existent divergence class
    "D04_RUN_STARTED". The frozen taxonomy has D04 as
    D04_APPROVAL_PRECEDENCE. Run-authority emission is NOT a
    divergence class — it is the canonical AgentRuntimeEvent
    { type: "run-started" } from the runtime layer.
    Verified by grep: D04_RUN_STARTED appears zero times in
    source or tests; D04_APPROVAL_PRECEDENCE appears in
    W06/W13/W14 expectations.

R4  Hub/Remote canonical capability conclusion was pre-baked
    into the original plan. C2.4 must derive it from source.
    Verified by grep: canonical-event-subscription.ts takes
    a generic `inner: { subscribeRuntimeEvents? }` parameter
    — it does NOT hardcode local/hub/remote. The actual
    capability is determined by which backend the host
    wires in, and that is currently UNKNOWN until audit.

R5  The original "reconstructed fallback is its own qualified
    authority path" was too strong. Hub/Remote qualification
    may end up PARTIALLY_QUALIFIED or UNQUALIFIED. C2.4 must
    allow all three dispositions, including NOT_YET_QUALIFIED.

R6  NO_ACTIVE_SESSION fail-open escape clause is too loose.
    The original "REACHABLE_FAIL_OPEN count = 0 (after fix or
    explicit decision)" implicitly allowed fail-open via
    decision-row annotation. Replaced with hard rule:
    UNJUSTIFIED_FAIL_OPEN = 0.
    Initial source review (lines 393-396 of
    task-state-shadow-host-wiring.ts): the active-session
    guard is `if (activeSession && activeSession.sessionId
    !== input.sessionId) return` — so when activeSession is
    undefined, the guard is VACUOUS and the event proceeds.
    This is exactly the failure mode the reviewer flagged.
    Plan extends to add an explicit fail-closed guard when
    activeSession is undefined.

ADD  E7 backend scope is currently implicit. C2.4 must freeze
    E7_INITIAL_BACKEND_SCOPE before closure so Hub/Remote
    NOT_YET_QUALIFIED does NOT block C2.5 if product
    requirements accept LOCAL_ONLY initial cutover.

R7  C2.4-A producer/transport direction is BACKWARDS in
    AMENDMENT-01. The plan started the audit in
    apps/vscode/src/sdk/ (the consumer/bridge end), but
    canonical AgentRuntimeEvents ORIGINATE in
    sdk/packages/agents/ and flow downstream through
    SessionRuntime → RuntimeHost → ClineCore → VS Code.
    Verified by grep:
      sdk/packages/agents/src/agent-runtime.ts:1241
        constructs { type: "run-started", snapshot: ... }
      sdk/packages/core/src/runtime/orchestration/session-runtime.ts
        references @cline/agents' Agent (lines 27-30)
      sdk/packages/core/src/runtime/host/local-runtime-host.ts
        implements RuntimeHost for Local
      sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts
        implements RuntimeHost for Hub
      sdk/packages/core/src/hub/runtime-host/remote-runtime-host.ts
        extends HubRuntimeHost for Remote
      sdk/packages/core/src/ClineCore.ts
        contains the cross-process event routing
      apps/vscode/src/sdk/canonical-event-subscription.ts
        sits at the consumer/bridge end
    Producer is the TOP of the chain, not the bottom.
    Amended plan: §3.1 now freezes the directional rule
    "audit from producer (sdk/packages/agents) downstream;
    VS Code is consumer/bridge, not producer."

    Additionally: AMENDMENT-01 split Local vs Hub/Remote
    implicitly but let the proxy-rewrites language apply
    to both. F1 already proved Local proxy preserves
    reference identity (F1-I3_EVENT_FIDELITY PASS via
    F1-T3 toBe(reference) witness — see
    task-state-e2f-f1-correction03-evidence.md:135).
    Amended plan: §3.1 step 4 splits the concern explicitly
    — Local must remain reference-preserving (re-verify
    F1-V1-C2/C3); Hub/Remote may rewrite provenance.
```

## 1. Mission

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

- **NO_ACTIVE_SESSION**: every state-mutating wiring primitive
  in `task-state-shadow-host-wiring.ts` assumes
  `lifecycle.getActiveSession()` is non-undefined. The
  reviewer flagged this: *"A canonical state-mutating event
  arrives while lifecycle.getActiveSession() == undefined.
  Is it actually reachable? If yes, what owns authority? Fail
  open or fail closed?"* The current wiring's session-guard
  is `if (activeSession && activeSession.sessionId !==
  input.sessionId) return` — vacuous when `activeSession`
  is undefined. C2.4 must determine whether to add an
  explicit fail-closed guard.
- **Real Local reachability**: the run-start → run-authority →
  continuation-fence → post-reset-fence ordering is currently
  proven only via mocked harnesses. The fences are in the
  **observation layer** (`task-state-shadow-host-wiring.ts`),
  not in the reducer. C2.4 must prove the same ordering
  through the real `LocalRuntimeHost` session lifecycle and
  observe the wiring-layer fences end-to-end.
- **Hub / Remote**: `canonical-event-subscription.ts` takes
  a generic `inner` parameter; the actual backend capability
  is UNKNOWN until audit. C2.4 must determine the canonical-
  stream reachability per backend and the disposition of the
  reconstructed-envelope fallback (which may be QUALIFIED,
  PARTIALLY_QUALIFIED, or NOT_YET_QUALIFIED — not just
  QUALIFIED).
- **`runId === undefined`**: provenance handling lives in
  the **observation layer** (`task-state-shadow-host-wiring.ts`),
  not in the reducer. The reducer sees a `TaskMsg` without
  runtime run identity. C2.4 must audit the producer →
  transport → wiring chain to determine which event types
  can reach the wiring with `runId === undefined`, then
  classify each as `UNDEFINED_IMPOSSIBLE`,
  `UNDEFINED_STARTUP_TRANSIENT`, `UNDEFINED_LEGITIMATE`, or
  `UNDEFINED_UNSAFE`.

C2.4 is therefore a **production reachability + host-capability
ACT**, not a reducer semantics ACT. It does NOT reopen the
reducer's W01–W16 results. It does NOT revisit the historical
disposition. It DOES answer the four boundary-condition
questions the reviewer raised, plus the E7-scope freeze.

## 2. Out of scope

The following are explicitly NOT C2.4 work and remain in their
prior lanes:

- W01–W16 reducer qualification → C2.3 (closed).
- T1–T12 historical disposition → C2.3 (closed).
- W06 real deny semantics → C2.3 (closed).
- Real C04 capture + C04_SYNTHETIC_REAL capture → C2.5.
- E2E harness + bundle build qualification → E7.
- Reducer semantics changes → forbidden by C2.3 closure.

Wiring-layer defensive code for `runId === undefined` is
frozen in its current form until the audit completes. C2.4
only characterizes the reachability and the producer
guarantees; the wiring's response is the authority for any
classification that the audit cannot eliminate.

## 3. The four questions and their evidence targets

C2.4 is structured as four subphases (A–D), each addressing
one of the reviewer's boundary-condition questions. The
subphases are sequenced by dependency:

```
C2.4-A  SOURCE REACHABILITY RECON
C2.4-B  NO_ACTIVE_SESSION WITNESSES
C2.4-C  REAL LOCAL INTEGRATION
C2.4-D  BACKEND DISPOSITION + EVIDENCE
```

### 3.1 (C2.4-A) canonical-source reachability recon

**Question.** What canonical `AgentRuntimeEvent` types does
the production call chain actually deliver to the wiring, and
what run-id / session-id guarantees does each producer make?

**Directional rule (AMENDMENT-02).** The previous version of
this section pointed the audit at `apps/vscode/src/sdk/` —
the **consumer** end. That is backwards. `AgentRuntimeEvent`s
originate in `sdk/packages/agents/`, flow through
`SessionRuntime` to the host implementation, then through
`ClineCore`, and only then cross into the VS Code host. The
producer is the **top** of the chain, not the bottom. The
audit must start at the producer and trace downstream; the
VS Code layer must be audited as **consumer/bridge**, not as
producer.

**Canonical event flow (frozen direction).**

```
AgentRuntime
  (sdk/packages/agents/src/agent-runtime.ts)
        ↓ emit({ type: "run-started", snapshot })
        ↓ listener fanout (this.listeners / this.hooks.onEvent)
  SessionRuntime
  (sdk/packages/core/src/runtime/orchestration/session-runtime.ts)
        ↓ registerLeadAgent → session-bound fanout
  RuntimeHost implementation
  - LocalRuntimeHost: sdk/packages/core/src/runtime/host/local-runtime-host.ts
  - HubRuntimeHost:   sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts
  - RemoteRuntimeHost:sdk/packages/core/src/hub/runtime-host/remote-runtime-host.ts
        ↓
  ClineCore
  (sdk/packages/core/src/ClineCore.ts)
        ↓
  VscodeSessionHost / runtime-events proxy
  (apps/vscode/src/sdk/runtime-events-proxy.ts)
        ↓
  subscribeCanonicalRuntimeEventsToShadow
  (apps/vscode/src/sdk/canonical-event-subscription.ts)
        ↓ sessionId guard
  TaskStateShadowHostWiring.observeCanonicalRuntimeEvent()
  (apps/vscode/src/sdk/task-state-shadow-host-wiring.ts)
```

**Method.**

1. **Producer inventory (start at the top).** Audit every site
   in `sdk/packages/agents/src/` that constructs an
   `AgentRuntimeEvent`. Verified producers to include:
   - `agent-runtime.ts:856` — `recovery-state-changed` event
     construction inside `resetRecoveryEpisode`.
   - `agent-runtime.ts:1241` — `run-started` event construction
     inside the run-loop.
   - Other emit sites discovered during recon.
   For each producer:
   - Event type (e.g. `run-started`, `message`,
     `tool-result`, `recovery-state-changed`).
   - `snapshot.runId` guarantee (always defined / sometimes
     undefined / never defined).
   - Producer location (file:line).
   - Listener fanout mechanism (synchronous `this.listeners`
     fanout vs async `emit()` dispatch).
2. **SessionRuntime fanout recon.** Trace how
   `SessionRuntime` (line 27-30 of session-runtime.ts
   references `@cline/agents`' `Agent`) wires producer
   listeners to the per-session `subscribeRuntimeEvents`
   surface. Determine:
   - Is the AgentRuntime listener registered once globally
     and fanned out per active session, or once per session?
   - Does the fanout preserve `snapshot.runId` literally?
   - Does the fanout re-construct or re-emit, or pass
     reference through?
3. **Transport preservation recon.** Trace each event type
   through (in direction order):
   ```
   AgentRuntime
     → SessionRuntime
     → RuntimeHost (LocalRuntimeHost / HubRuntimeHost /
                   RemoteRuntimeHost)
     → ClineCore
     → VS Code proxy (runtime-events-proxy.ts)
     → subscribeCanonicalRuntimeEventsToShadow
     → TaskStateShadowHostWiring.observeCanonicalRuntimeEvent
   ```
   At each hop, confirm the runId / sessionId is preserved or
   deliberately rewritten.
4. **Local vs Hub/Remote proxy rewrites (split concern).**
   Do NOT imply Local rewrites provenance; it does not.
   - **Local path:** F1 already proved
     `F1_I3_EVENT_FIDELITY = PASS (F1-T3 toBe(reference)
     witness)` (see
     `docs/architecture/elm/task-state-e2f-f1-correction03-evidence.md:135`).
     The C2.4-A audit must confirm that F1-V1-C2/C3
     literal-event reference tests still pass against the
     Local path after the wiring-layer fence hardening in
     §3.2. Reference identity is preserved end-to-end.
   - **Hub/Remote path:** the proxy layer MAY rewrite
     provenance for cross-process delivery (the hub spoke
     topology routes events through a coordinator). Audit
     whether the rewrite:
     - preserves sessionId verbatim,
     - preserves runId verbatim,
     - reconstitutes a canonical-looking envelope that the
       wiring may mis-classify as canonical,
     - strips provenance entirely.
5. **Backend capability recon.** Audit the actual `inner`
   binding in `SdkController`'s call to
   `subscribeCanonicalRuntimeEventsToShadow`. Determine:
   - Does the production code bind to `LocalRuntimeHost`,
     `HubRuntimeHost`, `RemoteRuntimeHost`, or some other
     backend?
   - Does `subscribeRuntimeEvents` exist on each backend, or
     do Hub/Remote use a different surface (e.g. SSE,
     reconstructed envelopes)?
   - **Do NOT infer backend capability from the generic
     optional `subscribeRuntimeEvents` interface alone.** The
     generic signature exists precisely so the audit cannot
     conclude from the type alone.
6. **Reconstructed-fallback recon.** If a backend lacks a
   canonical stream, find the reconstructed-envelope
   fallback producer and characterize:
   - What envelope types does it produce?
   - Does the envelope carry `runId`?
   - Does it ever reach `TaskStateShadow.record(...)`?
   - What authority does the envelope claim?
   - Is the reconstructed event typed the same as the
     canonical one (would wiring mis-classify it as
     canonical)?

**Acceptance gate.**

```
CANONICAL_SOURCE_RECON_TABLE
  producer sites audited (sdk/packages/agents)   = N (>= 6)
  producer runId guarantee documented           = 100%
  SessionRuntime fanout audited                  = YES
  transport hops audited (top-down direction)    = N (>= 5 per event type)
  Local F1-I3 reference-identity still PASS      = YES
  Local proxy rewrites provenance?               = NO (expected)
  Hub proxy rewrites provenance?                 = (audit reveals)
  Remote proxy rewrites provenance?              = (audit reveals)
  backend binding confirmed                      = (local / hub / remote / mixed / unknown)
  reconstructed-fallback sites                   = N (>= 0)
  reconstructed-fallback reach to TaskStateShadow = (yes / no / partial)
  reconstructed-envelope distinguishable from canonical? = (yes / no)
```

### 3.2 (C2.4-B) NO_ACTIVE_SESSION witnesses

**Question.** A canonical state-mutating event arrives while
`lifecycle.getActiveSession()` returns `undefined`. The
wiring's current session guard is vacuous in that case. Is
this reachable in production? If yes, the wiring must
explicitly fail-closed.

**Method.**

1. **Source recon.** For each canonical event type, locate
   the producer. Determine whether the producer is
   intrinsically session-scoped (e.g. only fires inside an
   active session) or session-agnostic (e.g. could fire
   during startup before any session exists).
2. **Async-window recon.** Identify any call site where the
   wiring's session guard reads `getActiveSession()` and then
   proceeds with dispatch. Determine whether the active
   session can change between read and dispatch.
3. **Witness test.** Construct a direct production-boundary
   test that:
   - Drives a state-mutating canonical event through the
     wiring with `lifecycle.getActiveSession()` returning
     `undefined`.
   - Observes the wiring's behavior.
   - Records the result in the table.
4. **Classification.** For each canonical event type:
   - `NOT_REACHABLE` — statically guarded; unreachable in
     real operation.
   - `NOT_REACHABLE_BY_TRANSPORT` — the real production
     transport cannot physically deliver this event without
     an active session (e.g. SessionRuntime only walks active
     sessions per `canonical-event-subscription.ts` point-in-
     time model).
   - `REACHABLE_FAIL_CLOSED` — reachable, but a guard drops or
     no-ops.
   - `REACHABLE_FAIL_OPEN` — reachable, and the wiring accepts
     the missing session (potentially writing nulls into the
     model). **UNJUSTIFIED FAIL_OPEN IS FORBIDDEN by R6.**
   - `REACHABLE_NO_AUTHORITY` — reachable, but the event is
     host-side / not canonical, so it never hits the wiring.
5. **Defensive fix.** If the audit surfaces any
   `REACHABLE_FAIL_OPEN` row, add an explicit
   `if (activeSession === undefined) return` guard in
   `task-state-shadow-host-wiring.ts:393`. This is a
   **wiring-layer fix**, NOT a reducer change, so it does
   NOT reopen C2.3.

**Acceptance gate.**

```
NO_ACTIVE_SESSION_TABLE
  canonical-event-types audited       = N (>= 6)
  REACHABLE_FAIL_OPEN count            = 0
  UNJUSTIFIED_FAIL_OPEN count          = 0   (hard rule, R6)
  REACHABLE_FAIL_CLOSED count          = N (>= 0)
  NOT_REACHABLE count                  = N
  NOT_REACHABLE_BY_TRANSPORT count     = N (>= 0)
  REACHABLE_NO_AUTHORITY count         = N
  defensive wiring fix added (if any)  = YES / NO
  wiring-layer fix reopens C2.3?       = NO  (always)
```

**R6 enforcement.** The original plan allowed fail-open via
"explicit decision" annotation. The amended plan forbids
this. To fail-open, an architecture ACT must be raised; a
table annotation is not sufficient.

### 3.3 (C2.4-C) real Local reachability integration

**Question.** The run-start → run-authority → continuation
fence → post-reset fence ordering is currently proven only
against mocked harnesses. Does it hold end-to-end on the real
`LocalRuntimeHost` session lifecycle?

**Method.**

1. **Fence ownership recon** (R1). Confirm the fences live in
   the observation layer, NOT the reducer:
   ```
   TaskStateShadowHostWiring
     awaitingNextCanonicalRunRef
     postResetAwaitingCanonicalRunRef
     canonicalRunIdRef
   ```
   The reducer only owns `cancelled`/`resumable` terminal
   precedence, `isStale()` activity handling, and
   `same_task_continued` transition.
2. **Run-authority emission recon** (R3). Locate the concrete
   `AgentRuntimeEvent { type: "run-started" }` producer and
   trace the chain to `observeCanonicalRuntimeEvent()`.
   Do NOT search for a divergent D-class label; use the
   concrete event type.
3. **Integration test construction.** Drive the **real
   `LocalRuntimeHost`** through the following scenario:

   ```
   L1  task/session begins
   L2  run-started(A) accepted
   L3  current-run canonical activity accepted

   L4  same_task_continued
   L5  old A terminal before B start suppressed
   L6  run-started(B) accepted
   L7  old A terminal after B start suppressed

   L8  task reset
   L9  post-reset fence established
   L10 stranded old terminal suppressed
   L11 new run-started accepted
   L12 current new terminal accepted

   L13 stale-session run-started (inject)
   L14 stale-session terminal (inject)
   ```

   Then assert: zero authority mutation from L13/L14.

4. **NOT_REACHABLE_BY_TRANSPORT evidence.** If L13 or L14 is
   mechanically impossible on the real transport (e.g.
   `subscribeRuntimeEvents` only walks active sessions per
   `canonical-event-subscription.ts` point-in-time model),
   record that as `NOT_REACHABLE_BY_TRANSPORT`. This is
   stronger evidence than the harness — it proves the
   transport itself rejects the injection.

**Acceptance gate.**

```
REAL_LOCAL_REACHABILITY
  LocalRuntimeHost integration test = PASS
  L1-L12 observed end-to-end         = YES (all 12 steps)
  L13/L14 mutation                  = ZERO
  NOT_REACHABLE_BY_TRANSPORT rows    = (record honestly)
  run-authority chain traced         = YES (real producer → real wiring)
  continuation fence in wiring       = observed transitioning true→false
  post-reset fence in wiring         = observed transitioning true→false
  same_task_continued wired          = YES
  resetForNewTask wired              = YES
```

The integration test belongs in
`apps/vscode/src/sdk/__tests__/` and is reviewed as
production-adjacent code, not just a state-shadow
qualification.

### 3.4 (C2.4-D) backend disposition

**Question.** For each of `local`, `hub`, `remote`, what
runtime provenance actually reaches the shadow, and is that
provenance sufficient to grant TaskState mutation authority?

**Method.**

1. **Backend capability matrix.** For each backend, populate:

   ```
             canonical stream   reconstructed fallback
   Local     UNKNOWN            UNKNOWN
   Hub       UNKNOWN            UNKNOWN
   Remote    UNKNOWN            UNKNOWN
   ```

   Derive the answers from §3.1 recon, NOT from assumption.

2. **Provenance strength grading.** For each backend:

   ```
   runtime provenance = FULL | PARTIAL | NONE
   qualified authority = CANONICAL | FALLBACK | NONE
   ```

   Where:
   - `FULL` provenance = every canonical event carries
     sessionId + runId, no reconstruction required.
   - `PARTIAL` provenance = some canonical events require
     reconstruction; reconstruction carries adequate
     provenance.
   - `NONE` provenance = reconstruction strips provenance,
     and canonical stream is absent or empty.

3. **Disposition.** For each backend:

   ```
   disposition = QUALIFIED | PARTIALLY_QUALIFIED | NOT_YET_QUALIFIED
   ```

   Where:
   - `QUALIFIED` = canonical stream is FULL provenance;
     reconstructed fallback is at least PARTIAL provenance.
   - `PARTIALLY_QUALIFIED` = canonical stream is PARTIAL,
     fallback is PARTIAL, but cross-epoch terminal safety is
     not provable end-to-end.
   - `NOT_YET_QUALIFIED` = canonical stream is NONE; fallback
     strips provenance; cross-epoch safety is unprovable.

4. **Evidence doc update.** Add a backend-disposition section
   to `docs/architecture/elm/task-state-authority-inventory.md`
   so that future ACTs cannot accidentally infer Local
   guarantees onto Hub/Remote.

**Acceptance gate.**

```
BACKEND_DISPOSITION_TABLE
  backends audited       = 3 (local, hub, remote)
  per-backend populated  = (canonical: Y/N; fallback: Y/N;
                             provenance: FULL/PARTIAL/NONE;
                             authority: CANONICAL/FALLBACK/NONE;
                             disposition: QUALIFIED/PARTIAL/NONE)
  Local guarantees projected onto Hub/Remote? NO
  inventory doc updated  = YES
```

**R4/R5 enforcement.** The amended plan forbids pre-baking
conclusions. The matrix starts as UNKNOWN and is populated
from the recon, not the planner's intuition.

### 3.5 (ADD) E7 backend scope freeze

**Question.** What backend is E7's initial consumer cutover
actually targeting?

**Method.** This is a scope decision, not an audit. Decide:

```
E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY | ALL_BACKENDS | DEFER
```

**Recommendation (not yet frozen):**

```
E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY
```

Rationale:
- C2.3's strongest authority proof is canonical Local.
- Upstream `ClineCore` exposes local, hub, and remote
  backends with materially different execution/event-routing
  architectures.
- Hub/Remote qualification may legitimately end as
  `NOT_YET_QUALIFIED` per §3.4. LOCAL_ONLY E7 means that
  disposition does NOT block C2.5 / consumer cutover.

**Acceptance gate.**

```
E7_SCOPE_DECISION_DOCUMENTED = YES
  E7_INITIAL_BACKEND_SCOPE = (LOCAL_ONLY | ALL_BACKENDS | DEFER)
  blocker for C2.5 if LOCAL_ONLY chosen? = (none | hub qualification | both)
  product-side acceptance            = (pending | granted | declined)
```

## 4. Sequencing

```
C2.4 sequence:
  1. (3.1) SOURCE REACHABILITY RECON
     Audit producers, transport hops, backend binding,
     reconstructed-fallback. Produce CANONICAL_SOURCE_RECON_TABLE.

  2. (3.2) NO_ACTIVE_SESSION WITNESSES
     Direct production-boundary tests for canonical event
     types. Classify each into NOT_REACHABLE /
     NOT_REACHABLE_BY_TRANSPORT / REACHABLE_FAIL_CLOSED /
     REACHABLE_FAIL_OPEN / REACHABLE_NO_AUTHORITY.
     Add defensive wiring-layer fail-closed guard if needed
     (does NOT reopen C2.3).

  3. (3.4) BACKEND DISPOSITION
     Populate the per-backend matrix. Derive from step 1,
     not assumption.

  4. (3.5) E7_SCOPE_DECISION_DOCUMENTED
     Freeze E7_INITIAL_BACKEND_SCOPE so §3.4's NOT_YET_QUALIFIED
     does not block C2.5 unnecessarily.

  5. (3.3) REAL LOCAL INTEGRATION
     Construct LocalRuntimeHost integration test exercising
     L1-L14. Requires the recon tables from steps 1-3 to be
     complete so the test design is informed by the actual
     producer/transport surface.

  6. If any step surfaces a real defect, fix at the
     observation layer ONLY. Reducer changes are forbidden.

  7. Compose the C2.4 evidence doc and closure verdict.
```

Steps 1-3 are documentation-heavy recon. Step 4 is a scope
decision. Step 5 is the only real production-call-chain test.
Steps 6-7 follow.

## 5. Acceptance for C2.4 closure

```
C2_4 closure gates:
  CANONICAL_SOURCE_RECON_TABLE           = filled + accepted
  NO_ACTIVE_SESSION_TABLE                 = filled + accepted
    UNJUSTIFIED_FAIL_OPEN count            = 0  (hard rule, R6)
    defensive wiring fix added (if any)    = YES
    defensive fix reopens C2.3?            = NO
  BACKEND_DISPOSITION_TABLE               = filled + accepted
    Local guarantees projected onto others = NO
  E7_SCOPE_DECISION_DOCUMENTED            = YES
    E7_INITIAL_BACKEND_SCOPE               = (frozen)
  REAL_LOCAL_REACHABILITY                 = PASS
    L1-L12 observed                        = YES (all 12)
    L13/L14 mutation                       = ZERO
  NEW_TS_ERRORS                           = 0
  PRODUCTION_SEMANTIC_DELTA               = 0  (wiring-layer fix OK)
  PROTECTED_STASHES_INTACT                = true
  git diff --check                        = PASS
  focused tests                           = PASS
  all C2.3 gates still green               = PASS
  reviewer accepts                        = yes
```

`PRODUCTION_SEMANTIC_DELTA` may be non-zero only if a real
observation-layer defect is fixed. Any reducer change is
forbidden by C2.3 closure and would require reopening C2.3.
Wiring-layer changes that do NOT alter reducer semantics
(e.g. adding an `if (activeSession === undefined) return`
guard, or strengthening transport-level filtering) do NOT
reopen C2.3.

## 6. Board delta after C2.4

```
C2.4                                       🟢 / ✅ CLOSED
  C2.4-A SOURCE REACHABILITY RECON         ✅
  C2.4-B NO_ACTIVE_SESSION WITNESSES       ✅
  C2.4-C REAL LOCAL INTEGRATION            ✅
  C2.4-D BACKEND DISPOSITION + EVIDENCE    ✅
    Local                                  (QUALIFIED / ...)
    Hub                                    (QUALIFIED / PARTIAL / NOT_YET)
    Remote                                 (QUALIFIED / PARTIAL / NOT_YET)
  E7_INITIAL_BACKEND_SCOPE                (frozen)

  VERDICT = PASS_HOST_REACHABILITY_QUALIFICATION_C2_4

C2.5                                       🟢 NEXT (AUTHORIZED)
  real dogfood + real C04 capture
E7                                         ⛔
  consumer cutover (scoped per E7_INITIAL_BACKEND_SCOPE)
```

## 7. Non-cyclic SHA convention

The plan does NOT embed the exit commit SHA. Reviewers should
substitute `$SUBJECT_HEAD = $(git rev-parse HEAD)` at review
time. The plan does cite the entry head (`f6c4b39a9`) and
the supersedes marker (`dbef640da`) because both are in the
commit chain at the time of amendment.

## 8. Protected stashes

```
PROTECTED_STASHES_INTACT =
  FORENSIC = 141372c52 (stash@{1})
  CONTEXT  = 371752f71
```

Any failure to preserve these after C2.4 is a closure
violation.

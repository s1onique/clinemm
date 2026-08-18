# C2.4-D plan — HUB / REMOTE FALLBACK PROVENANCE

> Reviewer verdict lock (round-8):
>
> > "C2.4-D should start from the opposite direction:
> > REAL HubRuntimeHost / RemoteRuntimeHost → actual
> > CoreSessionEvent subscription/fanout → actual cross-process
> > / gRPC translation boundary → VscodeSessionHost /
> > SdkSessionLifecycle → production onSessionEvent wrapper →
> > TaskShadowReverseTranslator →
> > TaskShadowObservationCoordinator → FALLBACK_APPLY. A
> > `HubTopology` shim is useful AFTER recon, as a
> > component-control fixture. It must not be the evidence that
> > decides whether Hub/Remote fallback provenance is real."

```text
ACT             = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D
ENTRY_HEAD      = b75c0c265 (C2.4-C TOOLING HARDENING)
EXIT_HEAD       = <this commit's tip>
PROTECTED_STASH = 141372c52 (FORENSIC, do NOT pop)

C2_4_D_AUTHORIZED = true

C2_4_D_VERDICT_PASS iff (
  HUB_PROVENANCE_CLASSIFIED
  && REMOTE_PROVENANCE_CLASSIFIED
  && HUB_REACHABILITY_RESOLVED
  && REMOTE_REACHABILITY_RESOLVED
  && NO_UNJUSTIFIED_AUTHORITY_CLAIMS
  && E7_INITIAL_BACKEND_SCOPE_FROZEN
)
```

C2.4-D PASS does NOT mean `HUB_QUALIFIED && REMOTE_QUALIFIED`.
C2.4-D PASS means the truth of Hub and Remote is KNOWN, not
invented.

## 0. Amendment log

```text
PLAN                       = task-state-e5-e6-correction02-c24-d-hub-remote-fallback-provenance-plan.md
PLAN-AMENDMENT-01          = cbeba6d41 (initial plan; reviewer round-9 rejected)
PLAN-AMENDMENT-02          = <this commit>  (this file)

R1  canonicalAvailable polarity was inverted in §1 prose and §3 D2.
    Production contract at task-state-shadow-coordinator.ts:315-356
    is canonicalAvailable=true ⇒ DIAGNOSTIC_ONLY,
    canonicalAvailable=false ⇒ FALLBACK_APPLY.
    Plan-AMENDMENT-01 had it backwards. Fixed in §1 and §3 D2.

R2  §1 misdescribed the hook's job (said it flips to FALLBACK_APPLY
    when host is Local; it flips to FALLBACK_APPLY when host is
    Hub/Remote, i.e. when canonical transport is absent). Fixed.

R3  Trailing-blank-line EOF hygiene error (git diff --check
    failure). Fixed.

UNCHANGED from PLAN-AMENDMENT-01:
  - §1 reviewer-corrected guardrail
  - §2 topology preview (with corrected polarity applied)
  - §3 D0, D1, D3, D4 deliverables
  - §4 production-delta accounting
  - §5 exit criteria
  - §6 HubTopology scope
  - §7 linkage

PLAN-AMENDMENT-03          = <this commit> (post-D1 closure)
  - D1-HUB closed by `97e2ba7ee` (real HubRuntimeHost reachability
    witness, two-epoch scripted sequence). The witness is in
    `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.reachability.c24-d.test.ts`
    (703 lines, 1 test). It empirically confirms:
      HUB_REAL_HOST_REACHABILITY          = PASS
      HUB_SESSION_ID_PROVENANCE           = PASS
      HUB_CONVERSATION_ID_PROVENANCE      = PARTIAL
        session.notice                    = present when supplied
        iteration/tool/terminal           = absent
      HUB_RUN_EPOCH_METADATA_AT_HOST      = ABSENT
      HUB_ITERATION_STARTED_EPOCH_ID      = ABSENT
      HUB_TOOL_EVENT_EPOCH_ID             = ABSENT
      HUB_TERMINAL_EVENT_EPOCH_ID         = ABSENT
      HUB_CANONICAL_RUNTIME_SEAM          = ABSENT
        subscribeRuntimeEvents            = undefined
      HUB_TWO_EPOCH_SEPARATION_BY_HOST
        iteration.started alone           = IMPOSSIBLE
      HUB_D0_CENTRAL_FINDING_EMPIRICAL    = PASS

  - D1-REMOTE closed by `<D1-REMOTE commit>` (real RemoteRuntimeHost
    parity witness). The witness is in
    `sdk/packages/core/src/hub/runtime-host/remote-runtime-host.reachability.c24-d.test.ts`
    and asserts:
      LR1 RemoteRuntimeHost instanceof HubRuntimeHost
           (real inheritance link, not faked)
      LR2 RemoteRuntimeHost.subscribe emits the same kind and count
           of CoreSessionEvent as HubRuntimeHost for the same
           scripted HubEventEnvelope sequence
      LR3 RemoteRuntimeHost.subscribeRuntimeEvents is undefined
      LR4 RemoteRuntimeHost's other observables (subscribe, close,
           dispose, getClientId, getUrl) are inherited from Hub
      LR5 normalizeHubWebSocketUrl(http://...) -> ws://...
           propagation through RemoteRuntimeHost's only override path

    No new HubTopology class is introduced. The witness uses the
    proven NodeHubClient mock seam from D1-HUB and
    `hub-runtime-host.test.ts:8-43` -- but with `vi.importActual`
    forwarding for `normalizeHubWebSocketUrl`, which Remote's
    constructor imports from `../client`.

  - D1 overall closed: HUB + REMOTE both reachability-qualified
    through real HubRuntimeHost / RemoteRuntimeHost objects
    (the only test seam is the proven NodeHubClient mock).

R4  §3 D2 ordering corrected. Earlier wording held D2 behind D3,
    reasoning that D2's polarity question becomes "moot for Hub"
    if D3 picks C (Hub stays NOT_YET_QUALIFIED). Reviewer round-13
    corrected: D2's polarity question is INDEPENDENT of repair
    choice. The defective provenance makes the pre-repair D2
    MORE useful -- it lets us observe exactly how the deficient
    stream behaves under real fallback authority, which is the
    evidence D3 needs to choose A/B/C. D2 must therefore run
    BEFORE D3. If D3 implements A or B later, re-run D2 against
    the corrected stream; if D3 chooses C, the original D2 still
    proves the fallback machinery works and explains why that
    machinery is unsafe for E7. Fixed in §3 next-step ordering.
```

## 1. The reviewer-corrected guardrail (replaces an earlier
   `HubTopology`-shim-first draft)

The round-8 verdict corrected the prior ACT direction. An
earlier draft proposed a `HubTopology` shim as the *primary*
qualification. That would recreate the exact evidence mistake
that cost several C2.4-C correction rounds: proving a
hand-written topology and then accidentally promoting it to
evidence about production topology.

The corrected rule:

```text
1. CAPABILITY_RECON     = inspect the real HubRuntimeHost /
                          RemoteRuntimeHost surface, hop by hop,
                          from the WS event to the shadow boundary.
                          NO production edits in this step.

2. HOST_REACHABILITY    = wherever construction seams permit,
                          test the PRODUCTION Hub / Remote host
                          object against the shadow wiring. The
                          in-process native transport offered by
                          `NodeHubClient` is the production seam
                          for Hub; Remote is the same shape with
                          `endpoint: ws://...` instead of `url`.

3. FALLBACK_COMPOSITION = prove the runtime-reconstructed shadow
                          path (DIAGNOSTIC_ONLY vs FALLBACK_APPLY)
                          with the REAL host, not a fabricated
                          topology. (This is what the wiring's
                          `getCanonicalRuntimeAvailable()` hook
                          is FOR.)

4. PROVENANCE_EPOCH     = qualify session/run/iteration
                          provenance under Hub and Remote fallback;
                          if any item cannot be proven, mark
                          NOT_YET_QUALIFIED.

5. DISPOSITION          = freeze the E7 initial backend scope to
                          the union of LOCAL_QUALIFIED with
                          whatever HUB / REMOTE bucket survives.
                          E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY
                          is a legitimate outcome.
```

HubTopology is a component-control fixture for D0/D1 recon, NOT
the evidence vehicle for D2/D3/D4.

## 2. Why this is a real qualification (not just a tape-recording
   exercise over Local)

The C2.4-A and C2.4-C qualification proved Local is wired end to
end (see
`task-state-e5-e6-correction02-c24-c-real-local-evidence.md`).
The path was:

```text
REAL LocalRuntimeHost
  -> subscribeRuntimeEvents(listener)
  -> wraps each session's agent.subscribe
  -> AgentRuntimeEvent fanout
  -> VscodeSessionHost.subscribeRuntimeEvents
  -> subscribeRuntimeEventsThroughProxy(inner, listener)
  -> subscribeCanonicalRuntimeEventsToShadow(host, wiring, sessionId)
  -> TaskShadowHostWiring.observeCanonicalRuntimeEvent
  -> coordinator.observe({ kind: "runtime-canonical", ... })
  -> RUNTIME_CANONICAL observation -> shadow mutate-as-if-canonical
```

Hub/Remote DO NOT have `subscribeRuntimeEvents`. The
`runtime-events-proxy.ts` proxy is explicit
(`apps/vscode/src/sdk/runtime-events-proxy.ts:31-33`):

```ts
if (!inner.subscribeRuntimeEvents) {
    return () => {}
}
```

So Hub/Remote events reach the shadow wiring ONLY through the
legacy `CoreSessionEvent` stream, which is the
**RUNTIME_RECONSTRUCTED** path. The
`getCanonicalRuntimeAvailable?.() ?? true` hook already exists
(`task-state-shadow-host-wiring.ts:651`).

**The hook's polarity (frozen contract — `task-state-shadow-coordinator.ts:315-356`):**

```text
canonicalAvailable answers:
"Does a higher-authority canonical AgentRuntimeEvent transport exist?"

canonicalAvailable = true
  → reconstructed is diagnostic only (DIAGNOSTIC_ONLY)
  → canonical transport owns runtime truth; reconstructed
    observations cannot duplicate-mutate the shadow.

canonicalAvailable = false
  → reconstructed is fallback authority (FALLBACK_APPLY)
  → reconstructed events ARE authoritative, with
    session/run-scoped edge dedup.
```

The naming is therefore:

```text
LocalRuntimeHost     → canonicalAvailable = true
HubRuntimeHost       → canonicalAvailable = false
RemoteRuntimeHost    → canonicalAvailable = false
```

**A note on why "DIAGNOSTIC_ONLY" is correct for Local and not a
downgrade.** When canonical transport exists, the shadow sees the
same edge through TWO paths: (a) `RUNTIME_CANONICAL` via
`subscribeCanonicalRuntimeEventsToShadow`, and (b)
`RUNTIME_RECONSTRUCTED` via the legacy `onSessionEvent` wrapper.
Forcing reconstructed to DIAGNOSTIC_ONLY eliminates the
"reconstructed first, canonical later" double-mutation race
entirely — the canonical edge is the sole mutation. Reconstructed
becomes a pure divergence recorder. This is the C2.2-CORRECTION02
Option A and C2.3-CONT.0-CORRECTION01 R2 contract, frozen.

The reviewer-corrected D qualification is, in essence: **prove
that this hook works correctly under a REAL Hub host under a
REAL fallback scenario**, and **classify which provenance
properties survive the Hub/Remote → reconstructed →
FALLBACK_APPLY hop sequence**.

## 3. The actual topology (preview of the D0 recon deliverable)

Pre-recon inventory — full source-line citations live in the D0
evidence deliverable, not in this plan:

```text
REAL HubRuntimeHost (sdk/packages/core/src/hub/runtime-host/)
  |
  +-- subscribe(listener, opts)
  |       -> this.events.subscribe(...)
  |              RuntimeHostEventBus
  |              (sdk/packages/core/src/runtime/host/runtime-host-support.ts:11-44)
  |              fanout: events.emit() -> all listeners
  |              (matched on sessionId)
  |
  +-- ensureSessionSubscription(sessionId)
  |       -> this.client.subscribe(
  |                  event => this.handleHubEvent(event))
  |              starts a WebSocket subscription filtered by sessionId
  |       -> handleHubEvent(event: HubEventEnvelope)
  |              translates Hub protocol events into
  |              CoreSessionEvent via this.events.emit()
  |              (hub-runtime-host.ts:1554 ff.)
  |
  v
ClineCore
  (sdk/packages/core/src/ClineCore.ts:641-646)
  .subscribe(listener, opts)
    -> this.host.subscribe(listener, opts)
  |
  v
VscodeSessionHost
  (apps/vscode/src/sdk/vscode-session-host.ts:341-346)
  .subscribe(listener)
    -> this.inner.subscribe(listener)
  |
  v
SdkSessionLifecycle.onSessionEvent wrapper
  (apps/vscode/src/sdk/sdk-session-lifecycle.ts)
  |
  v
TaskShadowHostWiring.observeLegacyEvent
  (task-state-shadow-host-wiring.ts:589-653)
  |
  +-- TaskShadowReverseTranslator.translate()
  |       -> reconstructed AgentRuntimeEvent
  |       (NON-MUTATING; updates
  |        previousExecution / lastRecoveryState / activeRunId)
  |
  +-- coordinator.observe({
          kind: "runtime-reconstructed",
          origin: "RUNTIME_RECONSTRUCTED",
          sessionId: sourceSessionId,
          event: runtimeEvent,
          canonicalAvailable:
              deps.getCanonicalRuntimeAvailable?.() ?? true,
        })
  |
  v
TaskShadowObservationCoordinator
  |
  +-- if canonicalAvailable:
  |       diagnostic-only (DIAGNOSTIC_ONLY)
  |       divergences still observed but do NOT mutate
  +-- else:
          fallback authority (FALLBACK_APPLY)
          session/run-scoped edge dedup; reconstructed mutations
          propagate to the shadow
```

This is the topology the D0 recon commit will exhaustively
audit with per-hop source-line citations.

## 4. The four deliverables (D0..D3) plus D4 closure

### D0 — TOPOLOGY RECON (capability audit; no production edits)

Single commit, evidence-only, modeled on C2.4-A's recon:

- **D0.1** Producer-end inventory (Hub & Remote).

  Hub transport sessions enter through `this.client.subscribe`
  (WS to the local hub server), pass through `handleHubEvent`
  (`hub-runtime-host.ts:1554` ff.) and emerge as
  `CoreSessionEvent`s emitted on the local
  `RuntimeHostEventBus`. The event types emitted are:

  - `agent_event` (with sub-event `content_start` /
    `iteration_start` / `iteration_end` / etc.)
  - `session_snapshot`
  - `status`
  - `tool_call` family

  Remote is the same shape (`RemoteRuntimeHost extends
  HubRuntimeHost` with `endpoint: ws://...` instead of `url`).

  The audit must enumerate every emit site, every serialized
  payload, and what legacy `CoreSessionEvent` shape reaches the
  host. The `RUNTIME_RECONSTRUCTED` path expects roughly:

  - `CoreSessionEvent` of variant
    `{ type: "agent_event", payload: { sessionId, event: AgentEvent } }`
  - where `AgentEvent` includes `iteration_start`,
    `iteration_end`, `tool_call`, `text`, etc.
  - and `{ type: "status" }` / `{ type: "session_snapshot" }`
    for session lifecycle.

  Per the C2.4-A precedent, the audit must distinguish:

  - STATE_RELEVANT_CATEGORICAL_TYPES
    (events that mutate `TaskStateShadow`)
  - STATE_IRRELEVANT_NOOP_TYPES
    (events that are presentation-only)

- **D0.2** Transport-hop table (with per-hop semantics labels).

  Mirror C2.4-A's table but for Hub/Remote:

  | hop | from | to | semantics |
  | --- | ---- | -- | --------- |
  | 0 | hub WebSocket frame | `HubRuntimeHost.handleHubEvent` | WIRE_DECODE |
  | 1 | `handleHubEvent` | `RuntimeHostEventBus.emit` | TRANSLATE |
  | 2 | `RuntimeHostEventBus.emit` | registered listeners | REFERENCE_PASS_THROUGH |
  | 3 | `ClineCore.subscribe` | `host.subscribe` | REFERENCE_PASS_THROUGH |
  | 4 | `VscodeSessionHost.subscribe` | `this.inner.subscribe` | REFERENCE_PASS_THROUGH |
  | 5 | `SdkSessionLifecycle` | host listener registration | REFERENCE_PASS_THROUGH |
  | 6 | `TaskShadowHostWiring.observeLegacyEvent` | translator + coordinator | FILTER + TRANSLATE |
  | 7 | `TaskShadowReverseTranslator.translate` | reconstructed `AgentRuntimeEvent` | TRANSLATE |
  | 8 | `coordinator.observe({ kind: "runtime-reconstructed", canonicalAvailable })` | coordinator | AUTHORITY_DECISION |
  | 9 | coordinator | `TaskStateShadow.observeRuntimeEvent` | TRANSLATE (`adaptRuntimeEvent`) |
  | 10 | shadow | `taskUpdate(model, msg)` reducer | TRANSLATE |

- **D0.3** Capability table (Local vs Hub vs Remote).

  For each property, state whether the property is **observed**
  (Local reference path) or **projected** (Hub/Remote
  reconstructed path):

  - runId provenance
  - iteration identity
  - recovery-state projection
  - terminal run-finished vs run-failed distinction
  - approval-requested vs approval-resolved asymmetry
  - first `iteration_start` identity per canonical run

  Where the property is projected, name the projection (i.e.
  the code path that recovers/derives the value from the
  reconstructed envelope).

- **D0.4** Reconciliation: where Hub differs structurally from
  Local.

  The crucial difference, called out for the implementer (NOT a
  bug fix, just a property of the architecture):

  - Local `subscribeRuntimeEvents` returns `AgentRuntimeEvent`,
    tagged by `sessionId` so the proxy can filter.
  - Hub `subscribe` returns `CoreSessionEvent`, NOT
    `AgentRuntimeEvent`. The seam mismatch is the architectural
    reason that Hub fallback MUST go through the reconstructed
    path (and therefore the `getCanonicalRuntimeAvailable()`
    hook must flip to `false` when the host is Hub).
  - Hub's `handleHubEvent` reconstructs locally, but each event
    still carries enough payload to drive the legacy
    `onSessionEvent` pathway through `sessionId` propagation.

  This must be **observed** in D0, not asserted.

### D1 — REAL HOST REACHABILITY (qualification step 1)

Construction seams the production host offers:

```ts
// sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts:797
private createClient(url: string): NodeHubClient {
    return new NodeHubClient({ ...this.clientOptions, url });
}
```

`NodeHubClient` is constructed via `HubRuntimeHost.createClient`,
a `private` method that has **no production injection point**. The
plan originally claimed a "command-transport plugin" seam, but
that interface (`HubCommandTransport`) is implemented by the
*server*-side adapter only (`sdk/packages/core/src/hub/server/browser-websocket.ts`),
not the client. The actual reachability seam is therefore:

  - the proven `vi.mock("../client", ...)` pattern that mocks
    `NodeHubClient` at module-import time, used by both the
    existing `hub-runtime-host.test.ts:8-43` and the new
    D1-HUB / D1-REMOTE witnesses; OR
  - the `RemoteRuntimeHost` constructor's invocation of the real
    `normalizeHubWebSocketUrl`, which Remote imports from
    `../client` and which the D1-REMOTE witness forwards via
    `vi.importActual`.

D1 build order:

- **D1.1** Construct a REAL `HubRuntimeHost` with the
  NodeHubClient mock seam producing scripted Hub events.
  → closed by `97e2ba7ee`.
- **D1.2** Construct a REAL `RemoteRuntimeHost` with the same.
  → closed by the D1-REMOTE parity witness
  (`remote-runtime-host.reachability.c24-d.test.ts`).
- **D1.3** Verify `subscribe(listener)` receives the actual
  `CoreSessionEvent` produced by `handleHubEvent`. No fabricated
  `CoreSessionEvent` shape — only what `handleHubEvent` actually
  emits.
  → closed: D1-HUB asserts per-event CoreSessionEvent shape for
  eight envelope types across two epochs; D1-REMOTE asserts
  structural parity for the same shapes.
- **D1.4** Confirm `subscribeRuntimeEvents` is **undefined** on
  Hub / Remote (so the proxy returns a no-op unsubscribe), and
  that means the canonical `RUNTIME_CANONICAL` seam is silent
  when the host is Hub/Remote. This is a feature, not a bug:
  events arrive through the legacy stream instead.
  → closed: both D1-HUB (L9) and D1-REMOTE (LR3) assert
  `host.subscribeRuntimeEvents === undefined`.

D1 evidence should include the source-line verifying the
`subscribeRuntimeEvents` is missing from HubRuntimeHost (search
results from D0 prove this).

### D2 — REAL FALLBACK COMPOSITION (qualification step 2)

The composition proof runs a real Hub host through the real
shadow wiring with `getCanonicalRuntimeAvailable() => false`,
and asserts:

```text
DEPENDS_ON_HOST                       = HubRuntimeHost (REAL)
getCanonicalRuntimeAvailable()        = false  (forced)
RUNTIME_RECONSTRUCTED_EVENTS_OBSERVED > 0     (real Hub events)
RUNTIME_CANONICAL_EVENTS_OBSERVED     = 0     (no proxy fallback)
coordinator.observe kind              = "runtime-reconstructed"
FALLBACK_APPLY_OBSERVED_COUNT         > 0     (canonicalAvailable=false)
DIAGNOSTIC_ONLY_OBSERVED_COUNT        = 0     (canonicalAvailable=false ⇒ not diagnostic)
DIVERGENCES_RECORDED                  ≥ 0
TASK_STATE_MUTATIONS_FROM_RECONSTRUCTED > 0   (FALLBACK_APPLY ⇒ mutations propagate)
```

The Hub/Remote fallback case **must mutate** the shadow via
FALLBACK_APPLY; that is what makes the reconstructed path
authoritative when canonical transport is absent.

Then the **same** composition runs with
`getCanonicalRuntimeAvailable() => true` (the negative-control
mirror):

```text
getCanonicalRuntimeAvailable()        = true  (forced, Local-style)
RUNTIME_RECONSTRUCTED_EVENTS_OBSERVED > 0     (events still flow)
FALLBACK_APPLY_OBSERVED_COUNT         = 0
DIAGNOSTIC_ONLY_OBSERVED_COUNT        > 0     (canonicalAvailable=true ⇒ diagnostic)
TASK_STATE_MUTATIONS_FROM_RECONSTRUCTED = 0   (DIAGNOSTIC_ONLY ⇒ no mutation)
```

The negative-control mirror proves the hook is the actual
authority for reconstructed-mutation decisions. With Local and
the canonical seam present, mutation flows through the
`RUNTIME_CANONICAL` path, NOT through reconstructed — so the
reconstructed ingress remains a divergence recorder only.

D2 does NOT introduce a `HubTopology` shim. It uses the REAL
HubRuntimeHost end-to-end. A `HubTopology` (or
`HubTopologyFixture`) may exist in code as a component-control
helper, but it is NOT the evidence vehicle.

**D2 ordering (post-D1):** D2 MUST run **before** D3, not
after. The polarity question (canonicalAvailable ⇒ mutation /
no-mutation) is **independent of repair choice**: D2 must
observe how the *current unmodified* Hub stream behaves under
real fallback authority, because that observation is the
evidence D3 needs to choose between repair classes A/B/C.

The defective provenance makes the pre-repair D2 MORE useful,
not less:

```text
REAL Hub stream (current, unrepaired)
  + activeRunId never seeded
  + terminal runId undefined
  + FALLBACK_APPLY (canonicalAvailable=false)
       ↓
what exactly mutates?
what stale-terminal protections are bypassed?
```

If D3 later implements A or B, D2 re-runs against the
corrected stream to prove the recovered polarity. If D3
chooses C, the original D2 still proves the fallback
authority machinery itself works, and explains why that
working machinery is nevertheless unsafe for E7.

**D2 is NOT moot under C.**

### D3 — PROVENANCE / EPOCH SAFETY (qualification step 3)

This is the decisive portion. For each provenance axis, the
qualification must either prove (with a real host), or mark
`NOT_YET_QUALIFIED`:

```text
sessionId provenance                = ?
conversationId / runId provenance   = ?
first iteration_start identity      = ?
stale old-run terminal suppression  = ?
continuation-before-next-run-start  = ?
task-reset / new-task boundary      = ?
recovery with missing provenance    = ?
```

The C2.4-A recon already established that fallback run
provenance may be weaker than Local canonical provenance. D3
makes that weaker-or-equal property precise per axis.

For each axis, the truth table is:

```text
LOCAL  = QUALIFIED          (C2.4-C closed)
HUB    ∈ { QUALIFIED,
          PARTIALLY_QUALIFIED,
          NOT_YET_QUALIFIED }
REMOTE ∈ { QUALIFIED,
          PARTIALLY_QUALIFIED,
          NOT_YET_QUALIFIED }
```

An axis with all three NOT_YET_QUALIFIED is acceptable evidence;
we report what we DO and DO NOT know.

### D4 — DISPOSITION + E7 SCOPE FREEZE

The single commit that reads the deliverables above and:

1. stamps the verdict table for each provenance axis
2. freezes:

   ```text
   E7_INITIAL_BACKEND_SCOPE = (
     LOCAL
     ∪ (HUB if HUB_QUALIFIED for every axis else {})
     ∪ (REMOTE if REMOTE_QUALIFIED for every axis else {})
   )
   ```

3. captures open items as ACT work for a future C2.4-D2 / D3
   cycle if Hub or Remote is partially / not-yet qualified.
4. forbids future ACTs from asserting
   `E7_INITIAL_BACKEND_SCOPE ⊇ {HUB, REMOTE}` without re-running
   D2/D3 with a current evidence commit.

The legitimate outcomes are:

```text
E7_INITIAL_BACKEND_SCOPE ∈ {
  LOCAL_ONLY,
  LOCAL_AND_HUB,
  LOCAL_AND_REMOTE,
  LOCAL_AND_HUB_AND_REMOTE,
}
```

(`LOCAL_ONLY` is acceptable and expected if Hub/Remote
provenance cannot be proven in this cycle.)

## 5. Production-delta accounting (carried forward from C2.4-A)

```text
EXPECTED_PRODUCTION_SEMANTIC_DELTA  = 0
PERMITTED_PRODUCTION_SEMANTIC_DELTA = NARROW_OBSERVATION_HARDENING_ONLY
                                       (e.g. wiring the existing
                                        getCanonicalRuntimeAvailable
                                        hook to read "false" when
                                        host is Hub/Remote — NOT
                                        adding new state)
REDUCER_SEMANTIC_DELTA              = 0
ACTUAL_PRODUCTION_SEMANTIC_DELTA    = 0 | NARROW_OBSERVATION_FIX
```

The C2.4-C tooling hardening commit demonstrated that a narrow
hardening commit does NOT reopen the wider qualification; the
same accounting applies here.

NOT permitted without an additional review round:

- Adding a new `subscribeRuntimeEvents` method to HubRuntimeHost
  (would be a behavioral change, NOT a hardening).
- Adding a new `HubTopology` class to qualify itself.
- Changing the `canonicalAvailable` default (`?? true`).

## 6. Exit criteria

```text
C2_4_D_VERDICT = PASS iff (
  D0 recon merged with explicit class table
  D1 host reachability proven with REAL HubRuntimeHost /
     RemoteRuntimeHost objects
  D2 fallback composition proven with REAL HubRuntimeHost and
     the production getCanonicalRuntimeAvailable hook
  D3 provenance-axis table produced, with each axis populated
     QUALIFIED | PARTIALLY_QUALIFIED | NOT_YET_QUALIFIED
     for each of HUB / REMOTE
  D4 E7_INITIAL_BACKEND_SCOPE frozen in evidence doc
  NO_UNJUSTIFIED_AUTHORITY_CLAIMS in any commit message
     (specifically: no "Hub is fully qualified" without a
      qualifier row in D3)
)
```

## 7. What `HubTopology` is for (and isn't)

The single permitted use of a `HubTopology`-like object:

```text
Class: HubTopologyFixture
File:  apps/vscode/src/sdk/__tests__/_hub_topology_fixture.ts
       (or under sdk/packages/core/src/hub/runtime-host/...test.ts)
Purpose: a fixed-script factory that produces a REAL
         HubRuntimeHost configured with an in-process native
         transport whose events can be scripted for individual
         unit tests.

Forbidden use:
  - using a hand-rolled Hub-like object that does NOT extend or
    compose HubRuntimeHost
  - promoting any test that uses HubTopologyFixture as the
    primary qualification evidence — D2 must use a fully
    production-shaped HubRuntimeHost with a minimal real
    transport seam
```

If a future commit needs to invent a `HubTopology` class to
exercise Hub events for a test, that commit is operating on
D0/D1 recon, not on qualification. The boundary is:

```text
hub_topology_fixture.*  ⊂ D0/D1 recon
hub_topology_fixture.*  ⊄ D2/D3/D4 qualification
```

## 8. Linkage

Reviewer lock at the top of this plan binds the
`HubTopology`-shim-first mistake to be impossible in this cycle:

- C2.4-A recon: `task-state-e5-e6-correction02-c24-source-recon-evidence.md`
- C2.4-B NO_ACTIVE_SESSION: `task-state-e5-e6-correction02-c24-no-active-session-reachability-plan.md` and the witness evidence
- C2.4-C REAL LOCAL + tooling hardening: `task-state-e5-e6-correction02-c24-c-real-local-evidence.md`
- C2.3-CONT.0-CORRECTION01 R2 (canonicalAvailable contract):
  `task-state-shadow-host-wiring.ts:651`,
  `task-state-shadow-coordinator.ts:315-356`
- This plan (AMENDMENT-02): `task-state-e5-e6-correction02-c24-d-hub-remote-fallback-provenance-plan.md`

The next evidence file to be authored is:

```text
docs/architecture/elm/task-state-e5-e6-correction02-c24-d0-hub-remote-topology-recon-evidence.md
```

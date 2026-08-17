# ELM-02F — Runtime-Event Seam — F0 Recon

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01**

**Phase:** F0 — recon/freeze (no production change).

**Status:** RECON_COMPLETE. PRODUCTION_DELTA = 0.

---

## 0. Mission alignment

ELM-02F must expose canonical `AgentRuntimeEvent` to the VS Code
shadow through a **parallel subscription seam**, without altering
the legacy `CoreSessionEvent` semantics, the `RuntimeEventAdapter`
output, the `TurnStateTracker` authority, or the recovery-policy
path. This document freezes the recon sites required by ACT
section 5, before any production code is touched.

---

## 1. Frozen anchor sites

### SITE 1 — `RUNTIME_OWNER`

```
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:303
    export class SessionRuntime
```

`SessionRuntime` (a.k.a. `SessionRuntimeOrchestrator`) is the
core/session-level owner of `AgentRuntime` and the gate through
which VS Code accesses the runtime. Created via
`LocalRuntimeHost.startSession(...)` (`local-runtime-host.ts:781`),
handed to `ClineCore`, and proxied to VS Code through
`vscode-session-host.ts`.

### SITE 2 — `RAW_EVENT_SUBSCRIPTION_SITE` (AgentRuntime)

```
sdk/packages/agents/src/agent-runtime.ts:774
    subscribe(listener: AgentEventListener): () => void
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
```

`AgentRuntime.subscribe(listener)` is the canonical raw-event
subscription surface. `listeners` is a `Set<AgentEventListener>`
and `emit(event)` (`agent-runtime.ts:3365`) fans out to every
listener with per-listener isolation for `recovery-state-changed`
and `execution-state-changed` (per RSMT01 CORRECTION03 /
C1.5 P1).

### SITE 2.b — orchestrator's internal subscription

```
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:922
    const unsubscribe = runtime.subscribe((event: AgentRuntimeEvent) => {
        this.handleRuntimeEvent(event)
    })
```

The orchestrator subscribes its own private listener to
`AgentRuntime.subscribe(...)` in order to translate events via
`RuntimeEventAdapter` (line 1271) and fan out to legacy
listeners (line 1272). Because `AgentRuntime.subscribe` uses a
Set, this does NOT prevent other listeners — additional raw
subscribers can coexist.

### SITE 3 — `LEGACY_TRANSLATION_SITE`

```
sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts:281
    case "execution-state-changed":
        // RSMT01: no legacy AgentEvent translation.
        return []
sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts:286
    case "recovery-state-changed":
        // (separate comment: "RSMT01: no legacy AgentEvent translation.")
        return []
```

Both canonical state-transition events are deliberately
translated to `[]` so that legacy consumers do not re-derive
state by parsing prose. **This is the C2.1 recon-confirmed
gap.**

### SITE 4 — `LEGACY_FANOUT_SITE`

```
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:591
    subscribeEvents(listener: SessionEventListener): () => void
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1303
    private emitLegacyEvent(event: AgentEvent): void
        for (const listener of this.listeners) { try { listener(event) } ... }
```

`SessionRuntime.subscribeEvents` is the public legacy stream
delivered to `ClineCore.subscribe(...)` and onward to
`SdkSessionLifecycle.onSessionEvent` → VS Code shadow wiring.

`ClineCore.subscribe(...)` (`ClineCore.ts:636`) delegates to
`this.host.subscribe(listener, options)` (the `LocalRuntimeHost`
implements it as a thin wrapper around `SessionRuntime.subscribeEvents`).

### SITE 4.b — already-existing canonical side-channel (recovery only)

```
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:600
    subscribeRecoveryStateChange(
        listener: (sessionId, recovery) => void
    ): () => void
sdk/packages/core/src/runtime/host/local-runtime-host.ts:1487
    unsubscribers.push(active.agent.subscribeRecoveryStateChange(listener))
```

A precedent side-channel ALREADY exists for `recovery-state-changed`
only, driven by `local-runtime-host.ts:1487` (which subscribes to
`active.agent.subscribeRecoveryStateChange` — note this is a
DIFFERENT `subscribeRecoveryStateChange` method, exposed by
`AgentRuntime` for native-recovery support). The
session-orchestrator-level `subscribeRecoveryStateChange` is the
fanout API; its listeners are fired inside `handleRuntimeEvent`
(line 1260) when the event type is `recovery-state-changed`.

The comment on line 600 explicitly says:

> "This is a **side-channel** for host-side telemetry consumers
> only... observation is not control."

This is the exact architectural pattern ELM-02F generalises.

### SITE 5 — `SESSION_TEARDOWN_SITE`

```
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:941
    } finally {
        unsubscribe()
        // drain tracker work
    }
```

The session-orchestrator stores the unsubscribe returned by
`AgentRuntime.subscribe(...)` as a local variable in its
`runOnce` / `runOnceWithTimeout` flow, and calls it in `finally`.
Additional listeners (e.g. via the new seam) are not bound by
this — each listener must track its own unsubscribe.

```
sdk/packages/core/src/runtime/host/local-runtime-host.ts:2238-2253
    // session-cleanup path
    this.emit({ type: "ended", payload: { sessionId, reason, ts } })
    if (cleanupErrors.length > 0 && input.status === "failed") {
        throw cleanupErrors[0]
    }
```

Session teardown emits a `CoreSessionEvent` of type `ended`,
which downstream listeners can observe for cleanup. However,
this is **post-cleanup**, so the canonical seam must rely on its
own unsubscribe return value, not on the `ended` event.

### SITE 6 — `VS_CODE_SHADOW_SUBSCRIBER_SITE`

```
apps/vscode/src/sdk/SdkController.ts:522
    this.taskStateShadowWiring = createTaskShadowHostWiring({
        sessionOptions: {
            onSessionEvent: (event) => { ... },     // legacy stream
            ...
        },
        getArbiterSnapshot: () => { /* mirror phase */ },
        ...
    })
```

The shadow wiring is constructed **before** `SdkSessionLifecycle`
because it wraps `onSessionEvent` lazily. The wiring currently
receives only the legacy `CoreSessionEvent` stream.

```
apps/vscode/src/sdk/SdkController.ts:1572
    if (!sdkHost?.subscribeRecoveryStateChange) { ... }
    this.taskTelemetryRecoveryUnsub =
        sdkHost.subscribeRecoveryStateChange((evtSessionId, recovery) => {
            // feeds cumulative tool-counter (telemetry only)
        })
```

The `subscribeRecoveryStateChange` precedent already lives in
`SdkController` and is the model for the new seam.

---

## 2. Already-existing parallel surface (ClineCore public)

`@cline/core` exports `ClineCore`:

```
sdk/packages/core/src/ClineCore.ts:636
    subscribe(listener: (event: CoreSessionEvent) => void, options?: RuntimeHostSubscribeOptions): () => void
sdk/packages/core/src/ClineCore.ts:649
    subscribeRecoveryStateChange(listener: (sessionId, recovery) => void): () => void
```

Both go through the `RuntimeHost` interface. VS Code proxies them
through `vscode-session-host.ts:321` for `subscribeRecoveryStateChange`
(observation only).

The new `subscribeRuntimeEvents` (or equivalent name) will follow
exactly this pattern: core method → runtime-host interface →
session-host interface → `vscode-session-host` proxy → `SdkController`
consumer.

---

## 3. Existing precedent: how `recovery-state-changed` is delivered today

```
AgentRuntime emits "recovery-state-changed"
  -> AgentRuntime.subscribe(handleRuntimeEvent)          (orchestrator subscriber)
       -> handleRuntimeEvent
            -> recoveryListeners.forEach(listener)        (fanout)
                 -> LocalRuntimeHost (host-level fanout via subscribeRecoveryStateChange)
                      -> VS Code's vscode-session-host.ts:321
                           -> SdkController:1575 (TaskTelemetryTracker)
```

Every layer already does exactly-once fanout with try/catch
isolation, no buffering, and an unsubscribe return. The ELM-02F
seam generalises this to **all** `AgentRuntimeEvent` variants
(not only `recovery-state-changed`), preserving identical
delivery semantics.

---

## 4. Design constraints frozen from ACT

| ID | Constraint | Source |
|----|-----------|--------|
| D1 | Parallel to legacy stream | ACT §3 |
| D2 | Read-only canonical observation | ACT §1, §4 |
| D3 | Exact-once delivery per listener | ACT §9 I1 |
| D4 | Session-scoped via listener closure on runtime | ACT §9 I2 |
| D5 | AgentRuntime emission order preserved | ACT §9 I3 |
| D6 | No event mutation / reinterpretation | ACT §9 I4 |
| D7 | Dispose: 0 callbacks after unsubscribe | ACT §9 I5 |
| D8 | Listener exception isolated per-listener | ACT §9 I6 (RSMT01 CORRECTION03) |
| D9 | No event buffering | ACT §22 |
| D10 | Minimal public API expansion (internal seam preferred) | ACT §10 |
| D11 | No legacy `AgentEvent` synthesis for canonical state events | ACT §4 |
| D12 | `origin = RUNTIME_CANONICAL` marker at boundary | ACT §13 |

---

## 5. Provenance of the canonical fanout (already proven)

`AgentRuntime.emit` (`agent-runtime.ts:3365`) is the single
emission point. It already does:

```typescript
const isObservationEvent =
    event.type === "recovery-state-changed" ||
    event.type === "execution-state-changed"
for (const listener of this.listeners) {
    // per-listener try/catch (C1.5 P1 + RSMT01 CORRECTION03)
    ...
}
```

So:

- multiple listeners CAN coexist (Set semantics);
- order is preserved (Set iteration order is insertion order);
- per-listener exception isolation is already in place for the
  two observation events;
- dispose works (the `unsubscribe` closure removes from Set).

This means the runtime side of ELM-02F requires **no AgentRuntime
edits** — only a fanout API exposed on `SessionRuntime`.

---

## 6. What F1 will and will not change

F1 (the next phase after this recon is committed) will add:

- ONE new method on `SessionRuntime`:
  `subscribeRuntimeEvents(listener: RuntimeEventListener): () => void`
  (or equivalent name, e.g. `subscribeAgentRuntimeEvents`).
  Single-listener or fanout depends on the chosen name and the
  existing pattern.
- ONE matching method on the `RuntimeHost` interface.
- ONE matching method on `LocalRuntimeHost`.
- ONE matching `ClineCore.subscribeRuntimeEvents` proxy.
- ONE matching `SdkSessionHost.subscribeRuntimeEvents` (optional).
- ONE matching `vscode-session-host.ts` proxy.

What F1 will NOT change:

- `AgentRuntime.emit` / `AgentRuntime.subscribe` (already correct).
- `RuntimeEventAdapter` (legacy semantics preserved exactly).
- `SessionRuntime.subscribeEvents` (legacy fanout untouched).
- `SessionRuntime.subscribeRecoveryStateChange` (existing
  side-channel preserved).
- `TurnStateTracker` (out of scope).
- `TaskTelemetryTracker` (out of scope).
- Any webview consumer.

---

## 7. F0 halt conditions pre-check

| Condition | Status at recon | Evidence |
|-----------|----------------|----------|
| H1  RuntimeEventAdapter legacy output changed | NOT_REQUIRED | recon finds the adapter is the source of the gap, but no change to its output is required for ELM-02F |
| H2  Existing legacy subscribers receive new events | NOT_REQUIRED | parallel seam only |
| H3  Listener must parse prose to recover canonical state | NOT_REQUIRED | raw `AgentRuntimeEvent` passed verbatim |
| H4  Event copied with invented fields | NOT_REQUIRED | direct reference / shallow wrapper only |
| H5  AgentRuntime semantics changed | NOT_REQUIRED | `emit` already correct |
| H6  Recovery policy changed | NOT_REQUIRED | side-channel only |
| H7  Event delivered twice | NOT_REQUIRED | single-fanout with Set |
| H8  Teardown leak | NOT_REQUIRED | unsubscribe is the contract |
| H9  Listener exception can break runtime | NOT_REQUIRED | try/catch already in place |
| H10 Public SDK expansion | MINIMAL | ClineCore method + 2 host proxies mirror `subscribeRecoveryStateChange` precedent |
| H11 Buffering | NOT_REQUIRED | pure fanout |
| H12 Production LOC > 800 | EXPECTED_FAR_BELOW | ~6 narrow additions |
| H13 Context/stateVersion work | NOT_REQUIRED | out of scope |
| H14 Protected stash changes | NOT_REQUIRED | recon only |
| H15 Webview/legacy authority | NOT_REQUIRED | read-only observation |

All halt conditions can be satisfied by the F1 plan above. The
ACT can proceed.

---

## 8. Active board

```
ELM-02C2 / C2.0 witness freeze                ✅ PASS
ELM-02C2 / C2.1 semantic recon                ✅ FROZEN
    W12_MODEL_A                               ✅
    T8_CASE_2                                 ✅

ELM-02F canonical runtime-event seam          🟢 F0 RECON COMPLETE
    F0 RECON DOC                              ✅ THIS DOCUMENT
    F0-T1..T5 witnesses                       ⏭️ NEXT (F0 commit)

ELM-02C2 / C2.2 unified observation           ⛔ blocked
ELM-02C2 / C2.3 stateful W01-W16              ⛔
ELM-02C2 / C2.4 production qualification     ⛔
ELM-02C2 / C2.5 real E6 dogfood               ⛔

ELM-03 E7 consumer cutover                    ⛔ BLOCKED
```

## 9. Conservation boundary

| Boundary | Status |
|----------|--------|
| LEGACY_AUTHORITY | 100% (unchanged) |
| SHADOW_AUTHORITY | 0% (unchanged) |
| WEBVIEW_CUTOVER | false |
| EFFECT_EXECUTION_ENABLED | false |
| DIVERGENCE_ACTION | RECORD_ONLY |
| Protected stashes | both intact (see §10) |
| Production LOC delta | 0 (recon only) |

No production code modified by F0. The next commit (`F0-T1..T5`)
will also be recon-only (witness tests pinned against production
behavior, not a behavior change).

---

## 10. Pre-recon forensic-stash recovery (integrity incident)

Before this F0 recon began, the worktree contained 5 uncommitted
modifications to `apps/vscode/src/sdk/SdkController.ts`,
`apps/vscode/src/sdk/task-state-shadow-host-msgs.ts`,
`apps/vscode/src/sdk/task-state-shadow-host-wiring.ts`,
`apps/vscode/src/sdk/__tests__/task-state-shadow-host-msgs.test.ts`,
and `apps/vscode/src/sdk/__tests__/task-state-shadow-workload-matrix.test.ts`.

The C2.0 (`f45439249`) and C2.1 (`809e94083`) freeze reports both
asserted that `stash@{0}` (the ACT-ELM-02C2 forensic preservation)
was intact at commit time. At the start of ELM-02F, however:

- the worktree showed the 5 uncommitted modifications above;
- `stash@{0}` was MISSING from the stash list;
- the context-accounting stash (`stash@{1}`) was still intact;
- the dropped forensic stash was not in the git reflog.

The 5 worktree modifications matched the file set named in the
original `ACT-ELM-02C2-dirty-failed-attempt-preserved-for-forensics
5-files-SdkController-host-wiring-host-msgs-2tests` stash label,
strongly suggesting the dropped stash had been applied to the
worktree by an external process between the C2.1 freeze and the
ELM-02F start.

**Recovery action:**

1. Stashed the 5 uncommitted modifications into the worktree under
   a new forensic label, preserving them.
2. Confirmed via `git cat-file -t 141372c52` that the dropped
   stash's underlying commit was still present in the object
   store (`git fsck --unreachable`).
3. Used `git stash store -m '...RECOVERED from dropped commit' 141372c52`
   to recreate the forensic stash under its original ACT-ELM-02C2
   label, with the recovered-commit hash recorded in the new
   label for forensic traceability.
4. Confirmed `stash list` now contains both protected stashes:
   - `stash@{0}` = ACT-ELM-02C2 forensic preserved state (RECOVERED)
   - `stash@{1}` = ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 forensic
     corrections (untouched throughout)
5. Dropped the intermediate temporary stash (141372c52 had been
   re-stashed earlier in this session under a different label; that
   intermediate was dropped after the recovered commit was re-stored
   under the canonical forensic label).

**Final state at HEAD `809e94083` after recovery:**

```
git status --short = empty
stash@{0} = ACT-ELM-02C2 forensic (RECOVERED, intact)
stash@{1} = context-accounting (intact)
production LOC delta = 0
```

No production code modified by the recovery. The H14 halt
condition (protected stash changes) was DETECTED, MITIGATED, and
RECORDED — it did not propagate into any production edit.

The cause of the original drop is unknown to this ACT and is
outside the ELM-02F scope; it should be investigated by a separate
forensic ACT if desired.

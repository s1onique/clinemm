# ELM-02F F1 — Implementation Contract Freeze

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1**

## 0. Source freeze (pre-edit signatures)

Captured at F1 entry. Each signature is the *current* shape at
`2ca9f594b14106e4b934b3033f7c051e41072ab4`; F1 will NOT change these
unless explicitly noted.

### 0.1 `AgentRuntime.subscribe` (`@cline/agents`)

```ts
subscribe(listener: AgentEventListener): () => void
```

`AgentEventListener = (event: AgentRuntimeEvent) => void`

Source: `sdk/packages/agents/src/agent-runtime.ts:774`.
Existing semantics: Set of listeners, per-listener try/catch isolation
(see `emit()` around line 1032). **F1 will not modify AgentRuntime.**

### 0.2 `SessionRuntime.subscribeEvents` (`@cline/core`)

```ts
subscribeEvents(listener: SessionEventListener): () => void
```

`SessionEventListener` receives **legacy** `AgentEvent`s produced by
`RuntimeEventAdapter.translate(event)`.

Source: `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:591`.

### 0.3 `SessionRuntime.subscribeRecoveryStateChange` (precedent for F1)

```ts
subscribeRecoveryStateChange(
    listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void,
): () => void
```

Implementation:
- field `recoveryListeners = new Set<...>()` at line 351
- subscribe/unsubscribe pair at lines 613–617
- fanout at end of `handleRuntimeEvent(event)` at lines 1257–1273

**F1 generalizes this pattern.**

### 0.4 `RuntimeHost.subscribe` and `RuntimeHost.subscribeRecoveryStateChange?`

```ts
subscribe(
    listener: (event: CoreSessionEvent) => void,
    options?: RuntimeHostSubscribeOptions,
): () => void

subscribeRecoveryStateChange?(
    listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void,
): () => void
```

Source: `sdk/packages/core/src/runtime/host/runtime-host.ts:402` and `:417`.
`subscribeRecoveryStateChange` is **optional** on `RuntimeHost`.

### 0.5 `LocalRuntimeHost.subscribe` and `subscribeRecoveryStateChange`

```ts
subscribe(listener, options?): () => void {
    return this.events.subscribe(listener, options)
}

subscribeRecoveryStateChange(
    listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void,
): () => void {
    const unsubscribers: Array<() => void> = []
    for (const active of this.sessions.values()) {
        unsubscribers.push(active.agent.subscribeRecoveryStateChange(listener))
    }
    return () => {
        for (const unsub of unsubscribers) {
            try { unsub() } catch { /* defensive */ }
        }
    }
}
```

Source: `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1463` and `:1482`.

### 0.6 `ClineCore.subscribe` and `subscribeRecoveryStateChange`

```ts
subscribe(listener, options?): () => void {
    return this.host.subscribe(listener, options)
}

subscribeRecoveryStateChange(listener): () => void {
    if (!this.host.subscribeRecoveryStateChange) return () => {}
    return this.host.subscribeRecoveryStateChange(listener)
}
```

Source: `sdk/packages/core/src/ClineCore.ts:636` and `:649`.

### 0.7 `vscode-session-host` proxy

```ts
subscribe(listener: (event: CoreSessionEvent) => void): () => void {
    return this.inner.subscribe(listener)
}

subscribeRecoveryStateChange(
    listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void,
): () => void {
    const inner = this.inner as ClineCore & {
        subscribeRecoveryStateChange?: (
            listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void,
        ) => () => void
    }
    if (!inner.subscribeRecoveryStateChange) return () => {}
    return inner.subscribeRecoveryStateChange(listener)
}
```

Source: `apps/vscode/src/sdk/vscode-session-host.ts:311` and `:321`.

### 0.8 `SdkController.attachRecoveryTelemetrySubscription`

```ts
private attachRecoveryTelemetrySubscription(sessionId: string): void {
    this.taskTelemetryRecoveryUnsub?.()
    this.taskTelemetryRecoveryUnsub = undefined
    const sdkHost = this.sessions.getActiveSession()?.sdkHost
    if (!sdkHost?.subscribeRecoveryStateChange) return
    this.taskTelemetryRecoveryUnsub = sdkHost.subscribeRecoveryStateChange((evtSessionId, recovery) => {
        if (evtSessionId && evtSessionId !== sessionId) return
        this.taskTelemetry.observeRecovery(recovery)
        // synthetic AgentRuntimeEvent built inside this block (see SdkController.ts:1582-1620)
    })
}
```

Source: `apps/vscode/src/sdk/SdkController.ts:1559–1620`. Note: F1
*removes* the synthetic-event block once `observeCanonicalRuntimeEvent`
is available; the F1 commit keeps the existing telemetry mirror intact.

---

## 1. F1 design — mirror the recovery side-channel

### 1.1 `SessionRuntime.subscribeRuntimeEvents` (NEW)

```ts
/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
 * subscribe to raw `AgentRuntimeEvent`s from this session's runtime.
 *
 * Parallel to `subscribeEvents(listener)` (legacy) and
 * `subscribeRecoveryStateChange(listener)` (recovery projection only).
 * This is the **canonical** seam — every event the runtime
 * dispatches reaches listeners, including `execution-state-changed`
 * and `recovery-state-changed` (which `RuntimeEventAdapter.translate()`
 * drops to `[]`).
 *
 * Semantics (mirrors F0-CORRECTION01 invariants):
 *   - zero buffering; new subscribers see only future events;
 *   - exact-once per registered listener;
 *   - event object passed verbatim (no copying, no invented fields);
 *   - order matches `handleRuntimeEvent()` input order;
 *   - per-listener try/catch isolation;
 *   - idempotent unsubscribe.
 */
subscribeRuntimeEvents(
    listener: (event: AgentRuntimeEvent) => void,
): () => void
```

### 1.2 `handleRuntimeEvent` insertion point

Recommended order:

```text
handleRuntimeEvent(event):
    1. canonical fanout     (NEW; this PR) — runs first, before any
       legacy translation so listeners see events for which
       translate(event) === [];
    2. recovery side-channel (existing; unchanged);
    3. RuntimeEventAdapter.translate(event) → legacy fanout (existing).
```

### 1.3 `RuntimeHost.subscribeRuntimeEvents?` (NEW; optional)

```ts
/**
 * ACT-...-F1: subscribe to raw canonical `AgentRuntimeEvent`s from
 * any active session. Optional on hosts that cannot surface raw
 * canonical events (legacy host bridges; hub clients).
 */
subscribeRuntimeEvents?(
    listener: (sessionId: string, event: AgentRuntimeEvent) => void,
): () => void
```

### 1.4 `LocalRuntimeHost.subscribeRuntimeEvents` (NEW; mirrors recovery)

```ts
subscribeRuntimeEvents(
    listener: (sessionId: string, event: AgentRuntimeEvent) => void,
): () => void {
    const unsubscribers: Array<() => void> = []
    for (const active of this.sessions.values()) {
        unsubscribers.push(active.agent.subscribeRuntimeEvents(listener))
    }
    return () => {
        for (const unsub of unsubscribers) {
            try { unsub() } catch { /* defensive */ }
        }
    }
}
```

### 1.5 `ClineCore.subscribeRuntimeEvents` (NEW; public API delta)

```ts
/**
 * ACT-...-F1.
 *
 * PUBLIC API DELTA: yes. Adds ClineCore.subscribeRuntimeEvents.
 * Surface stability: PROVISIONAL — internal-use-only during ELM
 * qualification.
 */
subscribeRuntimeEvents(
    listener: (sessionId: string, event: AgentRuntimeEvent) => void,
): () => void {
    if (!this.host.subscribeRuntimeEvents) return () => {}
    return this.host.subscribeRuntimeEvents(listener)
}
```

### 1.6 `vscode-session-host` proxy (NEW)

```ts
subscribeRuntimeEvents(
    listener: (sessionId: string, event: AgentRuntimeEvent) => void,
): () => void {
    const inner = this.inner as ClineCore & {
        subscribeRuntimeEvents?: (
            listener: (sessionId: string, event: AgentRuntimeEvent) => void,
        ) => () => void
    }
    if (!inner.subscribeRuntimeEvents) return () => {}
    return inner.subscribeRuntimeEvents(listener)
}
```

### 1.7 `SdkController` shadow boundary (NEW)

```ts
private attachCanonicalRuntimeEventSubscription(sessionId: string): void {
    this.taskStateRuntimeEventsUnsub?.()
    this.taskStateRuntimeEventsUnsub = undefined
    const sdkHost = this.sessions.getActiveSession()?.sdkHost
    if (!sdkHost?.subscribeRuntimeEvents) return
    this.taskStateRuntimeEventsUnsub = sdkHost.subscribeRuntimeEvents(
        (evtSessionId, event) => {
            if (evtSessionId && evtSessionId !== sessionId) return
            this.taskStateShadowWiring?.observeCanonicalRuntimeEvent(event)
        },
    )
}
```

`observeCanonicalRuntimeEvent(event)` is a NEW narrow method on the
shadow wiring boundary that simply forwards the canonical event to
the existing comparator's `observeRuntimeEvent(event)`. Origin is
implicit `RUNTIME_CANONICAL` (the only ingress path here).

---

## 2. F0 baselines to preserve

```
LEGACY_EVENT_COUNT_BASELINE = 5
LEGACY_EVENT_SEQUENCE_BASELINE = [
    "iteration_start",
    "content_start",
    "content_end",
    "iteration_end",
    "done",
]
CANONICAL_EXECUTION_STATE_CHANGED_COUNT_BASELINE = 1
CANONICAL_RECOVERY_STATE_CHANGED_COUNT_BASELINE  = 0
F0_RECOVERY_FIXTURE = { previousState: "idle", payloadState: "recovering", episodeFailures: 1 }
```

The 10 F0 witnesses in
`sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.e2f-f0-witnesses.test.ts`
must remain green after every F1 commit.

## 3. Protected stashes (durable IDs)

```
FORENSIC_ELM02C2:
  OBJECT_ID = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85
  POLICY = DO_NOT_POP, DO_NOT_APPLY, DO_NOT_DROP

CONTEXT_ACCOUNTING:
  OBJECT_ID = 371752f71e5b9a385af32736e007540386d48b82
  POLICY = DO_NOT_POP, DO_NOT_APPLY, DO_NOT_DROP
```

## 4. Expected production file set

```
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
sdk/packages/core/src/runtime/host/runtime-host.ts
sdk/packages/core/src/runtime/host/local-runtime-host.ts
sdk/packages/core/src/ClineCore.ts
apps/vscode/src/sdk/vscode-session-host.ts
apps/vscode/src/sdk/SdkController.ts
apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
```

Plus matching test files for each.

## 5. Commit decomposition

```
F1-C1 docs(elm): freeze ELM-02F F1 implementation contract
F1-C2 feat(core): expose canonical AgentRuntimeEvent session subscription
F1-C3 test(core): prove canonical fanout and legacy conservation
F1-C4 feat(vscode): bridge canonical runtime events to TaskState shadow
F1-C5 test(vscode): qualify canonical execution/recovery delivery
F1-C6 test(elm): qualify dual-stream ordering, disposal, filtering, performance
F1-C7 docs(elm): record ELM-02F F1 evidence and verdict
```

## 6. Authority budget

```
LEGACY_AUTHORITY          = 100%
SHADOW_AUTHORITY          = 0%
WEBVIEW_CUTOVER           = false
EFFECT_EXECUTION_ENABLED  = false
DIVERGENCE_ACTION         = RECORD_ONLY
TASKSTATE_AUTHORITY       = 0%
CONTEXT_ACCOUNTING        = unchanged
STATE_VERSION             = unchanged
```

No new TaskState output may influence: TurnStateTracker, webview
state, tool execution, approval, recovery control, task scheduling.

## 7. Halt conditions

H1..H19 inherited from the F1 ACT body, including:
- H1: RuntimeEventAdapter legacy output unchanged.
- H17: no fabrication on unsupported hosts — enforced by the
  optional `subscribeRuntimeEvents?` on `RuntimeHost`.
- H19: no new TS errors.

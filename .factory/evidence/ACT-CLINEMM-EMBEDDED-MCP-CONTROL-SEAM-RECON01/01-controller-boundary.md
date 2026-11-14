# C1 — The real controller boundary

**Label: `STRUCTURAL` (source map) + `REAL_PRODUCTION_SEAM` (the chain the
seam reads is exercised end-to-end by a real production class).**

The runtime chain actually exercised by this ACT:

```
extension.ts:activate()
  -> new Controller(...)            (apps/vscode/src/core/webview/WebviewProvider.ts:19
                                     — `Controller` IS `SdkController.ts`'s class)
     -> SdkController (Controller)   apps/vscode/src/sdk/SdkController.ts:1151
        -> SdkSessionLifecycle        apps/vscode/src/sdk/sdk-session-lifecycle.ts:239
           -> VscodeSessionHost        apps/vscode/src/sdk/vscode-session-host.ts:274
              -> ClineCore             sdk/packages/core/src/ClineCore.ts:108
                 -> LocalRuntimeHost    sdk/packages/core/src/runtime/host/local-runtime-host.ts:429
                    -> SessionRuntime  sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:390
                       -> AgentRuntime sdk/packages/agents/src/agent-runtime.ts
```

**No second `ClineCore` was created.** The seam reads the chain that
already exists. §C1.4 records the proof.

---

## C1.1 The production methods, by owner

### (a) Reading active task / session identity

| # | Method | Owner | Location | Lifecycle | Caller authorization | Observable result |
|---|---|---|---|---|---|---|
| A1 | `SdkSessionLifecycle.getActiveSession(): ActiveSession \| undefined` | `SdkSessionLifecycle` | `sdk-session-lifecycle.ts:311-313` | Lives for the controller's lifetime; the `ActiveSession` is replaced on session rebuild | **Internal only.** `private sessions` on the controller; no external entry point | The single authoritative `ActiveSession` record: `sessionId`, `sdkHost`, `isRunning`, `queuedPromptCount`, `startResult`, `unsubscribe` |
| A2 | `ActiveSession.sessionId` | `cline-session-factory.ts:180` | `cline-session-factory.ts:178-203` | Per active session | Same as A1 | The session identity string |
| A3 | `ActiveSession.isRunning` | host-owned mirror | `cline-session-factory.ts:196` | Flipped by `SdkSessionLifecycle.setRunning()` (`sdk-session-lifecycle.ts:315-326`) | Same as A1 | `true` while a turn is in flight. **This is the HOST's own mirror, not a webview reconstruction** |
| A4 | `ActiveSession.queuedPromptCount` | host-owned mirror | `cline-session-factory.ts:202` | Flipped by `SdkSessionLifecycle.setQueuedPromptCount()` (`:329-338`) | Same as A1 | Core's queue length for the active session |
| A5 | `Controller.task?.taskId` | `SdkController` | `SdkController.ts` (`private task?: TaskProxy`) | Set by `initTask`, cleared by `clearTask` | Same as A1 | The task id the controller owns |
| A6 | `SdkSessionLifecycle.getActiveSessionProviderConfig()` / `getSessionProviderId()` / `getSessionModelId()` | `SdkController` | `SdkController.ts:3264`, `:4093`, `:4103` | — | Internal | Provider/model identity (NOT exposed by the seam — see §C3.2) |

### (b) Reading authoritative task phase and completion

| # | Method | Owner | Location | Lifecycle | Caller authorization | Observable result |
|---|---|---|---|---|---|---|
| B1 | `VscodeSessionHost.runtimeSnapshot(sessionId)` | `VscodeSessionHost` | `vscode-session-host.ts:929-931` | Per host instance | Internal; duck-typed as `SdkSessionHost.runtimeSnapshot?()` | The **canonical** `AgentRuntimeStateSnapshot` of the active runtime for that session |
| B2 | `ClineCore.getActiveRuntimeSnapshot(sessionId)` | `ClineCore` | `sdk/packages/core/src/ClineCore.ts:712-720` | Per core instance | Internal | Proxies to the host's `getActiveRuntimeSnapshot?` |
| B3 | `LocalRuntimeHost.getActiveRuntimeSnapshot(sessionId)` | `LocalRuntimeHost` | `local-runtime-host.ts:1880-1885` | Per host instance | Internal | `active.agent.snapshot?.()` — the runtime's OWN snapshot |
| B4 | `AgentRuntime.snapshot()` | `AgentRuntime` | `sdk/packages/agents/src/agent-runtime.ts` | Per run | Internal | The runtime's own authoritative phase/status/run identity |
| B5 | `Controller.getArbiterSnapshot()` closure | `SdkController` | `SdkController.ts:1967-2006` | Rebuilt per task | Internal | The **selected** arbiter: the canonical mapper when B1 returns a snapshot, else the legacy `turnStateTracker.currentPhase` mirror. **The seam does not use this** — it reads B1 directly so it never inherits the legacy fallback |
| B6 | `SdkController.attachCanonicalRuntimeEventSubscription()` | `SdkController` | `SdkController.ts:4568-4605` | Attached per task, disposed in `dispose()` | Internal | Subscribes to canonical `AgentRuntimeEvent`s |

### (c) Subscribing to session / runtime events

| # | Method | Owner | Location | Lifecycle | Caller authorization | Observable result |
|---|---|---|---|---|---|---|
| C1 | `VscodeSessionHost.subscribe(listener)` | `VscodeSessionHost` | `vscode-session-host.ts:882-884` | Per host instance | Internal | Legacy `CoreSessionEvent` stream; returns an unsubscribe |
| C2 | `VscodeSessionHost.subscribeRuntimeEvents(listener)` | `VscodeSessionHost` | `vscode-session-host.ts:910-915` → `runtime-events-proxy.ts` | Per host instance | Internal | The **canonical** `AgentRuntimeEvent` stream, `(sessionId, event)`; returns an unsubscribe |
| C3 | `ClineCore.subscribeRuntimeEvents(listener)` | `ClineCore` | `ClineCore.ts:674-681` | Per core instance | Internal | Proxies the host's canonical hook; returns a no-op unsubscribe when the host omits it |
| C4 | `LocalRuntimeHost.subscribeRuntimeEvents(listener)` | `LocalRuntimeHost` | `local-runtime-host.ts:1511-1531` | Per host instance | Internal | Fans out across the host's sessions |
| C5 | `VscodeSessionHost.subscribeRecoveryStateChange(listener)` | `VscodeSessionHost` | `vscode-session-host.ts:892-902` | Per host instance | Internal | Recovery-state projection |

> **The seam subscribes to NOTHING.** The seam answers a **request-time**
> read (A1–A4 + B1). It holds no subscription, so it cannot observe an
> event it did not ask for, and it cannot influence the event stream.
> This is deliberate: §C3.2 shows that the two exposed operations need
> only a point-in-time read.

### (d) Starting tasks

| # | Method | Owner | Location | Lifecycle | Caller authorization | Observable result |
|---|---|---|---|---|---|---|
| D1 | `Controller.initTask(prompt, images, files, historyItem, taskSettings)` | `SdkController` | `SdkController.ts:4377-4467` | Per task | gRPC (`TaskService`) + the `+` button | Creates the session, installs the `ActiveSession`, sends the first turn |
| D2 | `SdkTaskStartCoordinator.initTask(...)` | `SdkTaskStartCoordinator` | `sdk-task-start-coordinator.ts` | Per task | Internal, called by D1 | Returns the new `sessionId` |
| D3 | `VscodeSessionHost.start(input)` | `VscodeSessionHost` | `vscode-session-host.ts:531-542` | Per host instance | Internal | Starts the Core session; **this is the only place a `ClineCore` session is created** |
| D4 | `SdkSessionLifecycle.startNewSession(...)` | `SdkSessionLifecycle` | `sdk-session-lifecycle.ts:444-641` | Per session | Internal | Installs the `ActiveSession`; sets `queuedPromptCount: 0` |
| D5 | `SdkSessionLifecycle.attachExistingSession(input)` | `SdkSessionLifecycle` | `sdk-session-lifecycle.ts:649-675` | Per session | Internal | Installs an `ActiveSession` **without** starting a runtime — the path the production-shape witness uses |

> **The seam exposes NONE of D1–D5.** No `start_act` operation exists.

### (e) Sending feedback

| # | Method | Owner | Location | Lifecycle | Caller authorization | Observable result |
|---|---|---|---|---|---|---|
| E1 | `Controller.askResponse(response, text, images, files)` | `SdkController` | `SdkController.ts:4982-5098` | Per turn | gRPC (`TaskService.askResponse`) | Sends the user's next turn |
| E2 | `VscodeSessionHost.send(input)` | `VscodeSessionHost` | `vscode-session-host.ts:544-558` | Per host instance | Internal | `this.inner.send(input)` — the prompt/queue transport |
| E3 | `SdkSessionLifecycle.pendingPrompts(action, input)` | `SdkSessionLifecycle` → `ClineCore` | `vscode-session-host.ts:865-880` | Per session | Internal | The queued-prompt service (list / update / delete / count) |

> **The seam exposes NONE of E1–E3.** No `send_feedback` operation exists.

### (f) Cancelling execution

| # | Method | Owner | Location | Lifecycle | Caller authorization | Observable result |
|---|---|---|---|---|---|---|
| F1 | `Controller.cancelTask()` | `SdkController` | `SdkController.ts:4720` | Per task | gRPC + the Cancel button | Cancels the active task |
| F2 | `SdkTaskControlCoordinator.cancelTask()` | `SdkTaskControlCoordinator` | `sdk-task-control-coordinator.ts` | Per task | Internal, called by F1 | The task-operation fence + abort |
| F3 | `VscodeSessionHost.abort(sessionId, reason?)` | `VscodeSessionHost` | `vscode-session-host.ts:564-578` | Per host instance | Internal | `this.inner.abort(...)`; suppresses the expected `AbortError` |
| F4 | `VscodeSessionHost.stop(sessionId)` | `VscodeSessionHost` | `vscode-session-host.ts:580-583` | Per host instance | Internal | Stops the session |
| F5 | `VscodeSessionHost.cancelBackgroundCommand(jobId?)` | `VscodeSessionHost` | `vscode-session-host.ts:637-665` | Per host instance | Internal (duck-typed, NOT on the `SdkSessionHost` interface) | Cancels background `run_commands` jobs; origin label `background_cancel_rpc` |
| F6 | `LocalRuntimeHost.abort(sessionId, reason?)` | `LocalRuntimeHost` | `local-runtime-host.ts:1687-1717` | Per host instance | Internal | The runtime's own abort |

> **The seam exposes NONE of F1–F6.** No `cancel_run` operation exists.

---

## C1.2 Request-time vs. runtime-event vs. committed UI observations

The ACT asks for these three observation classes to be distinguished.

| Class | Definition | Production member | Used by the seam? |
|---|---|---|---|
| **Request-time** | A read performed **at the moment the request is answered**. No state is captured, queued, or replayed. | A1–A4, B1–B4 | **YES — this is the only class the seam uses.** |
| **Runtime-event** | A pushed observation derived from the runtime's canonical event stream. | C2–C4 (`AgentRuntimeEvent`), B6 | **NO.** The seam subscribes to nothing. |
| **Committed UI** | A value that was **committed to the webview** and is therefore a *published* projection — a lagging mirror of the runtime. | `SdkController.getStateToPostToWebview()`, `ExtensionState` | **NO.** The seam never reads the webview state, never reconstructs from it, and never publishes to it. |

**Why request-time is the right class here.** The success criterion is
"An external client retrieves the same session identity and
authoritative status as the running ClineMM extension". A request-time
read of A1 + B1 answers exactly that, with **zero** lag and **zero**
duplication of the event machinery. Choosing the runtime-event class
would have required the seam to hold a subscription — which would (a)
make the seam a second consumer of the canonical stream, (b) require a
subscription lifecycle to be torn down, and (c) create a real risk of
the seam's own buffering becoming a stale third authority. Choosing the
committed-UI class would have made the seam a reconstruction of a
published projection — exactly what C3 forbids.

---

## C1.3 What the seam reads, precisely

The seam's authority is a projection of **four READ closures** over A1,
A3, A4 and B1:

```ts
readActiveSessionId:   () => this.sessions?.getActiveSession()?.sessionId      // A1 + A2
readActiveTaskId:      () => this.task?.taskId                                  // A5
readIsRunning:         () => this.sessions?.getActiveSession()?.isRunning ?? false // A3
readQueuedPromptCount: () => this.sessions?.getActiveSession()?.queuedPromptCount ?? 0 // A4
readRuntimeSnapshot:   () => {                                                   // B1 → B2 → B3 → B4
  const active = this.sessions?.getActiveSession()
  if (!active) return undefined
  const snapshot = active.sdkHost?.runtimeSnapshot?.(active.sessionId)
  return snapshot ? { status: snapshot.status, runId: snapshot.runId } : undefined
}
```

There is **no** closure that can start, steer, cancel, approve, or
otherwise mutate a run. The `ControlSeamAuthority` interface
(`control-seam-authority.ts`) contains five members and all five are
reads — the mutating surface is *absent*, not merely unused.

---

## C1.4 The no-second-`ClineCore` proof

| Claim | Evidence |
|---|---|
| The seam creates no `ClineCore` | `control-seam-server.ts` imports only `node:crypto`, `node:fs`, `node:net`, `node:path` and the seam's own modules. No `@cline/core` import. |
| The seam creates no session | `control-seam-authority.ts` imports only a **type** from `./control-seam-protocol`. No lifecycle, no host, no runtime. |
| The seam creates no runtime | `control-seam-runtime.ts` imports only `ControlSeamServer` + `ControlSeamAuthority`. |
| The seam's only production write is the socket + token file | `control-seam-server.ts:144-155` — `mkdirSync` the private dir, `writeFileSync` the token. **Nothing else.** |
| The controller wiring creates no new host | `SdkController.ts:3236-3275` — the seam is constructed from **closures over `this.sessions`** and started. It never calls `VscodeSessionHost.create`. |

Bundle corroboration: `grep -c 'ControlSeam' apps/vscode/dist/extension.js`
→ **42** occurrences of the seam's own symbols, and the seam's module
graph contains no `ClineCore.create` call site.

---

## C1.5 The seam's insertion point in the controller lifecycle

| Point | Where | Why |
|---|---|---|
| **Start** | `SdkController.ts:3236-3275` (constructor, after `this.sessions` exists) | The authority needs `this.sessions`; starting it later would leave a window where the seam is listening but cannot answer. |
| **Stop** | `SdkController.ts:3675-3681` (`dispose()`, **before** `this.sessions.dispose(...)` at `:3678`) | The seam must stop while its authority is still answerable, and must be gone before the session lifecycle is torn down. Ordering is explicit. |

The controller's `dispose()` is reached through
`tearDown()` → `WebviewProvider.disposeAllInstances()` →
`WebviewProvider.dispose()` → `controller.dispose()`
(`apps/vscode/src/common.ts:169-193`, `apps/vscode/src/core/webview/WebviewProvider.ts:22-42`),
which the extension's `deactivate()` calls
(`apps/vscode/src/extension.ts:2066-2092`). **Full cleanup on
deactivation is therefore on the production path**, not a test-only
convention.

---

## C1.6 Verdict

**`STRUCTURAL` + `REAL_PRODUCTION_SEAM`.**

The controller boundary is fully identified, every production method is
attributed to an owner with its lifecycle, caller authorization and
observable result, and the three observation classes are separated. The
chain the seam reads (A1/A3/A4 + B1→B2→B3→B4) is exercised
end-to-end against a **real `SdkSessionLifecycle`** in
`control-seam-authority.production-shape.test.ts` (§C5.3).

**No second `ClineCore` exists.** The seam observes the existing owner.

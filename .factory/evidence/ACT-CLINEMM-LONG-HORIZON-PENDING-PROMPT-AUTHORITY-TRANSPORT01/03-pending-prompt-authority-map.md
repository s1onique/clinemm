ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01 — PENDING-PROMPT AUTHORITY MAP
============================================================================================

> Recon of every seam touched by the pending-prompt authority redesign.
> Each edge labeled by its epistemic weight (REAL_PRODUCTION_SEAM /
> STRUCTURAL / INFERRED / LIVE_UNOBSERVABLE).

## 1. `PendingPromptsServiceApi` (the canonical service boundary)

```
[REAL_PRODUCTION_SEAM]
sdk/packages/core/src/runtime/host/runtime-host.ts:301-339

export interface PendingPromptsServiceApi {
    list(input): Promise<SessionPendingPrompt[]>
    update(input): Promise<PendingPromptMutationResult>
    delete(input): Promise<PendingPromptMutationResult>
    count(sessionId: string): number   // <-- NEW (this ACT)
}
```

Operations:
  - `list`   = REAL_PRODUCTION_SEAM (existing, async)
  - `update` = REAL_PRODUCTION_SEAM (existing, async)
  - `delete` = REAL_PRODUCTION_SEAM (existing, async)
  - `count`  = REAL_PRODUCTION_SEAM (NEW, synchronous)

Authority type: SERVICE_BOUNDARY.

## 2. `RuntimeHost` interface (the transport-safe execution boundary)

```
[REAL_PRODUCTION_SEAM]
sdk/packages/core/src/runtime/host/runtime-host.ts:384-535

Before (provisional, PROVISIONAL_ARCHITECTURAL_LEAK):
    getPendingPromptsCount?(sessionId: string): number;

After (this ACT):
    // REMOVED — provisional primitive. Authority moved to
    // `PendingPromptsServiceApi.count`.
```

Operations removed: `RuntimeHost.getPendingPromptsCount?`.
Authority type: NOT_APPLICABLE (no longer a RuntimeHost primitive).

## 3. `LocalRuntimeHost` (in-process execution)

```
[REAL_PRODUCTION_SEAM]
sdk/packages/core/src/runtime/host/local-runtime-host.ts

Public service literal (constructor):
    pendingPrompts = {
        list: ...,
        update: ...,
        delete: ...,
        count: (sessionId) => {
            if (!sessionId) return 0
            const active = this.sessions.get(sessionId)
            if (!active) return 0
            return active.pendingPrompts.length
        },
    }

Class methods REMOVED:
    LocalRuntimeHost.getPendingPromptsCount(sessionId): number  // REMOVED
```

Operations:
  - `list/update/delete` = REAL_PRODUCTION_SEAM (existing)
  - `count` = REAL_PRODUCTION_SEAM (NEW, reads `active.pendingPrompts.length`
    synchronously; the queue is mutated synchronously inside
    `PendingPromptService.enqueue`/`update`/`delete`/`clear`)

Authority type: LOCAL_ONLY (in-memory queue).

## 4. `HubRuntimeHost` (shared local hub execution)

```
[REAL_PRODUCTION_SEAM]
sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts

Public service literal (constructor):
    pendingPrompts = {
        list: (input) => this.requestPendingPromptsList(input),
        update: (input) => this.requestPendingPromptUpdate(input),
        delete: (input) => this.requestPendingPromptDelete(input),
        count: (sessionId) => {
            if (!sessionId) return 0
            return this.pendingPromptCountBySession.get(sessionId) ?? 0
        },
    }

NEW private state:
    private readonly pendingPromptCountBySession = new Map<string, number>()

NEW mirror-maintenance points:
    requestPendingPromptsList  -> pendingPromptCountBySession.set(sid, prompts.length)
    requestPendingPromptUpdate -> pendingPromptCountBySession.set(sid, prompts.length)
    requestPendingPromptDelete -> pendingPromptCountBySession.set(sid, prompts.length)
    session.pending_prompts event -> pendingPromptCountBySession.set(sid, prompts.length)
    stopSession -> pendingPromptCountBySession.delete(sid)
    deleteSession -> pendingPromptCountBySession.delete(sid)
    dispose -> pendingPromptCountBySession.clear()
```

Operations:
  - `list/update/delete` = REAL_PRODUCTION_SEAM (existing, async HTTP RPC)
  - `count` = REAL_PRODUCTION_SEAM (NEW, synchronous read of locally mirrored
    count kept current by the authoritative reply of `requestPendingPromptsList`
    AND by the `session.pending_prompts` event payload)

Authority type: HUB_CAPABLE.

## 5. `RemoteRuntimeHost` (explicit remote hub endpoints)

```
[REAL_PRODUCTION_SEAM]
sdk/packages/core/src/hub/runtime-host/remote-runtime-host.ts

RemoteRuntimeHost extends HubRuntimeHost — inherits `pendingPrompts` verbatim.

Operations: SAME AS HubRuntimeHost.
Authority type: REMOTE_CAPABLE (structurally composed with HubRuntimeHost).
```

## 6. `ClineCore.pendingPrompts` (the orchestration facade service)

```
[REAL_PRODUCTION_SEAM]
sdk/packages/core/src/ClineCore.ts:112
sdk/packages/core/src/cline-core/runtime-services.ts:56-87

readonly pendingPrompts: PendingPromptsServiceApi
this.pendingPrompts = createClineCorePendingPromptsApi(host)

createClineCorePendingPromptsApi(host):
    list   = (input) => getService().list(input)
    update = (input) => getService().update(input)
    delete = (input) => getService().delete(input)
    count  = (sessionId) => getService().count(sessionId)   // NEW (this ACT)

ClineCore.getPendingPromptsCount(sessionId)            // REMOVED
```

Operations:
  - `list/update/delete` = REAL_PRODUCTION_SEAM (existing)
  - `count` = REAL_PRODUCTION_SEAM (NEW, transport-neutral service operation)

Authority type: SERVICE_BOUNDARY (transport-neutral facade over Local/Hub/Remote).

## 7. `SdkSessionHost` interface (apps/vscode session host)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/session-host.ts:58-74

Before (provisional):
    pendingPrompts(action: "list" | "update" | "delete", input): Promise<...>
    pendingPromptsCount?(sessionId: string | undefined): number   // REMOVED

After (this ACT):
    pendingPrompts(action: "list" | "update" | "delete" | "count", input)
        : Promise<...> | number
    // pendingPromptsCount? REMOVED — authority moved to pendingPrompts service.
```

Authority type: SERVICE_ADAPTER.

## 8. `VscodeSessionHost` (production concrete adapter)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/vscode-session-host.ts:721-754

pendingPrompts(action: "list"|"update"|"delete"|"count", input): ...

switch (action):
    case "list":   return this.inner.pendingPrompts.list(input)
    case "update": return this.inner.pendingPrompts.update(input)
    case "delete": return this.inner.pendingPrompts.delete(input)
    case "count":  return this.inner.pendingPrompts.count(input.sessionId)   // NEW

// pendingPromptsCount(sessionId)                            // REMOVED
```

Authority type: TRANSPORT_ADAPTER.

## 9. `SdkController.getPendingPromptCount` (Q5 composition seam wiring)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/SdkController.ts:2160-2166

Before (provisional):
    getPendingPromptCount: (ownerSessionId) => {
        const activeSession = this.sessions.getActiveSession()
        return activeSession?.sdkHost.pendingPromptsCount?.(ownerSessionId) ?? 0
    }

After (this ACT):
    getPendingPromptCount: (ownerSessionId) => {
        const activeSession = this.sessions.getActiveSession()
        if (!activeSession) return 0
        return activeSession.sdkHost.pendingPrompts("count", {
            sessionId: ownerSessionId ?? "",
        })
    }
```

Authority type: TRANSPORT_NEUTRAL_ADAPTER (transport-agnostic at the call site).

## 10. `SdkSessionEventCoordinator` (Q5 composition seam consumer)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/sdk-session-event-coordinator.ts:121-122, 478-487

The Q5 composition seam reads `getPendingPromptCount?.(activeSession.sessionId)`
through the `SdkSessionEventCoordinatorOptions` adapter, which is wired by
`SdkController.getPendingPromptCount` to the transport-neutral service call.
The seam logic itself is unchanged from LHOWA01 / CORRECTION02.
```

Authority type: CONSUMER (transport-neutral projection consumer).

## 11. Test coverage map

| Test file | Authority mode | Notes |
|---|---|---|
| `ppat01.test.ts` (NEW this ACT) | synthetic-real, transport-neutral | Drives the production composition with the new service-bound count. |
| `lhowa01-wire-authority.test.ts` | synthetic-real, local | Updated to use the new service-bound count. |
| `lhowa01-synthetic-real.test.ts` | synthetic-real | Unaffected (uses `getPendingPromptCount` as a mock option). |
| `bcnt01.test.ts` | real production tool | Unaffected (does not touch pending-prompt count). |
| `btcont01.test.ts` | synthetic-real | Unaffected (BTCONT01 marker logic). |
| `bcafg01-synthetic-real.test.ts` | synthetic-real | Unaffected. |
| `agcont01.test.ts` | synthetic-real | Unaffected. |
| `qpsr01.c24-c-bridge.test.ts` | real bridge | Unaffected (uses `pendingPrompts.list` only). |
| `bcnt01-wire.c24-c-bridge.test.ts` | real bridge | Unaffected. |
| `schr01.test.ts`, `shrc01.test.ts` | real bridge | Unaffected. |

## 12. Summary classification table

```
OPERATION       BEFORE                          AFTER
list            REAL_PRODUCTION_SEAM            REAL_PRODUCTION_SEAM (unchanged)
update          REAL_PRODUCTION_SEAM            REAL_PRODUCTION_SEAM (unchanged)
delete          REAL_PRODUCTION_SEAM            REAL_PRODUCTION_SEAM (unchanged)
count (was RuntimeHost.getPendingPromptsCount)
               PROVISIONAL_ARCHITECTURAL_LEAK   REMOVED
count (now PendingPromptsServiceApi.count)
               ABSENT                          REAL_PRODUCTION_SEAM (NEW)

ARCHITECTURE LEAK            = CLOSED
PROVISIONAL PRIMITIVES       = REMOVED (3 surfaces: RuntimeHost, ClineCore, SdkSessionHost, VscodeSessionHost)
SERVICE AUTHORITY            = ESTABLISHED on `ClineCore.pendingPrompts`
TRANSPORT NEUTRALITY         = Local (sync), Hub (sync mirror), Remote (sync mirror via Hub composition)
```

## 13. Diagnostic: where "Your turn" must not be misfired

The original ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 / CORRECTION02
identified the false-positive "Your turn" symptom. After this ACT:

  - `awaiting_followup` commits IFF `ownerStillRunning || pendingPromptCount > 0 || activeNotifyCount > 0` is false.
  - `pendingPromptCount` reaches the Q5 seam through the canonical
    `ClineCore.pendingPrompts.count(sessionId)` service operation.
  - For Local: synchronously reads `active.pendingPrompts.length`.
  - For Hub / Remote: synchronously reads the locally-mirrored count.

The discrimination logic itself is unchanged (LHOWA01 invariant preserved).
The transport-neutral refactor does not change Q5 semantics; it only moves
where the count comes from.

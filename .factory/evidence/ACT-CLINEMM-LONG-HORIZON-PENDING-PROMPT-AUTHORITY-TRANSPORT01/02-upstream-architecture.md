ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01 — UPSTREAM ARCHITECTURE
======================================================================================

> Frozen reference: cline/cline/sdk/ARCHITECTURE.md (main, 2026-09-22).

## 1. The layering rule (verbatim, lines 380-460)

The upstream architecture is unambiguous about the boundary between
`RuntimeHost` (transport-safe execution primitive) and `ClineCore` service-style
APIs (orchestration facade):

```text
Layer 1: Agent/runtime execution primitives
        ↓
Layer 2: RuntimeHost  (LocalRuntimeHost / HubRuntimeHost / RemoteRuntimeHost)
        ↓
Layer 3: ClineCore orchestration facade
        ↓
Layer 4: service-style domain APIs  (cline.pendingPrompts, cline.settings, etc.)
```

Quote (ARCHITECTURE.md, lines 441-460):

> Concrete implementations:
>
> - `LocalRuntimeHost` for in-process execution
> - `HubRuntimeHost` for shared local hub execution
> - `RemoteRuntimeHost` for explicit remote hub endpoints
>
> Design implication:
>
> - host selection happens in `packages/core/src/runtime/host.ts`
> - `ClineCore` delegates uniformly to `RuntimeHost` and does not branch on
>   local vs hub behavior
> - transport-specific translation belongs inside concrete hosts, not in
>   top-level orchestration
> - `RuntimeHost` inputs stay transport-safe, while `ClineCore.start(...)`
>   is the app-facing facade that normalizes broad local config before
>   delegation
> - `RuntimeSessionConfig` is transport-neutral across local, shared hub,
>   and remote hub modes; host-local bootstrap concerns stay under
>   `localRuntime`
> - client-local runtime behaviors that must survive hub mode, such as
>   `defaultToolExecutors`, are attached at session start and proxied
>   through hub capability requests instead of changing host selection
> - **pending prompt list/update/delete are exposed through the grouped
>   `ClineCore.pendingPrompts` service.** Usage summary lookup and
>   active-session model switching are also service-style capabilities
>   exposed through `ClineCore` when the concrete transport implements
>   them. **These service APIs are intentionally outside the minimal
>   `RuntimeHost` primitive vocabulary.**

## 2. Queue steering (lines 989-993)

Quote (ARCHITECTURE.md, lines 989-993):

> ### Queue steering
>
> Queue steering through `pendingPrompts.steerFirst` selects and
> promotes the current queue head in one synchronous core operation.
> Desktop Enter sends this intent through the sidecar and Hub without
> fetching a prompt ID first; explicit per-prompt steering continues
> to update by ID. Concurrent clients therefore cannot make Enter
> promote an entry from a stale queue snapshot.

This second quote is consequential: `pendingPrompts.steerFirst` is
synchronous and is a service-style operation. The architectural pattern
already establishes that synchronous, transport-translated, queue-
state-driven operations belong on `pendingPrompts.*`, NOT on
`RuntimeHost`.

## 3. Hub composition rule (lines 170-210)

> 8. Hub client adapters exported from `@cline/core/hub` (`NodeHubClient`,
>    `HubSessionClient`, `HubUIClient`, `connectToHub`) translate
>    command/reply and event streams into host-facing APIs.

Hub client adapters do command/reply translation. A pending-prompt
*count* read, when issued through the service API, must be translated
by the hub client adapter. But the synchronous semantics of the
service projection at the *local* site is preserved: the hub mirrors
queue state to local snapshot projection synchronously so the same
service API still returns synchronously.


## 4. Translation of the architecture rule to this ACT

```
                                BEFORE (provisional)            AFTER (this ACT)
                                -------------------             ---------------
RuntimeHost                     pendingPromptsCount?            (removed)
ClineCore                       getPendingPromptsCount          (removed)
LocalRuntimeHost                getPendingPromptsCount          (removed)
HubRuntimeHost                  (no count method)               count(sessionId) on pendingPrompts
RemoteRuntimeHost               (no count method)               inherits from HubRuntimeHost
ClineCore.pendingPrompts        list / update / delete          list / update / delete / count
VscodeSessionHost               pendingPromptsCount             (removed; use pendingPrompts)
SdkSessionHost                  pendingPromptsCount?            (removed)
SdkController.getPendingPromptCount adapter                activeSession.sdkHost.pendingPrompts.count(sid)
```

The synchronous read at Q5 is preserved: `pendingPrompts.count(sessionId)`
on `LocalRuntimeHost` returns `active.pendingPrompts.length` synchronously,
on `HubRuntimeHost` reads the locally mirrored snapshot synchronously,
on `RemoteRuntimeHost` (which extends HubRuntimeHost) reads the same
local snapshot synchronously.

## 5. Why this is transport-neutral, not local-only

A discriminator that the architecture layer is preserved:

```
                              Local         Hub               Remote
                              -----         ---               ------
PendingPromptsServiceApi.list yes           yes (HTTP RPC)    yes (HTTP RPC)
PendingPromptsServiceApi.update yes         yes (HTTP RPC)    yes (HTTP RPC)
PendingPromptsServiceApi.delete yes         yes (HTTP RPC)    yes (HTTP RPC)
PendingPromptsServiceApi.count  yes         yes (local mirror) yes (local mirror)
PendingPromptsServiceApi.steerFirst yes      yes (synchronous) yes (synchronous)
```

For Hub/Remote, the hub runtime is authoritative for queue state and
mirrors it to the local runtime client projection; the Q5 consumer
reads the local projection synchronously. This is the same pattern
already documented for `pendingPrompts.steerFirst` (ARCHITECTURE.md
lines 989-993): "selects and promotes the current queue head in one
synchronous core operation."

## 6. What is NOT changed

- `RuntimeHost` interface retains all execution primitives (startSession,
  runTurn, abort, getSession, listSessions, etc.)
- `PendingPromptsController` retains enqueue/update/delete/clear/drain
- `LocalRuntimeHost.pendingPrompts` service retains list/update/delete
- `HubRuntimeHost.pendingPrompts` service retains list/update/delete
- `PendingPromptsServiceApi` shape is widened (add `count`), not narrowed
- The Q5 predicate logic at `sdk-session-event-coordinator.ts:470-487`
  is not changed
- The BTCONT01 deferred-continuation marker is not changed
- The BackgroundNotifyCoordinator is not changed
- notify-on-terminal formatting is not changed
- terminal-card projection is not changed
- duplicate completion messages are not changed

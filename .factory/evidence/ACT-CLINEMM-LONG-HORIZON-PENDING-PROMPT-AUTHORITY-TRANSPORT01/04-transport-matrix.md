ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01 — TRANSPORT MATRIX
=================================================================================

> Frozen transport matrix for the transport-neutral pending-prompt authority.
> Every backend claiming to support the pending-prompt service MUST implement
> every row.

## 1. Backend support matrix

```
BACKEND     list          update        delete        count
Local       SYNC_ASYNC*   SYNC_ASYNC*   SYNC_ASYNC*   SYNCHRONOUS (in-memory length)
Hub         ASYNC_RPC     ASYNC_RPC     ASYNC_RPC     SYNCHRONOUS (mirror from RPC + events)
Remote      ASYNC_RPC     ASYNC_RPC     ASYNC_RPC     SYNCHRONOUS (mirror inherited from Hub)
```

(* Local list/update/delete are async because they are typed async at the
service boundary; the underlying mutations are synchronous.)

## 2. Synchronous-authority invariant

The Q5 composition seam reads `pendingPrompts.count(sessionId)` synchronously
at the call site. The invariant holds when:

```
enqueue at T       ->  authoritative projection changes synchronously at T  (Local)
                       OR the projection's authoritative event arrives
                          synchronously at T+ε <= T-microtask       (Hub / Remote)
                  ->  Q5 read at T+ε sees new value
```

Local: the `pendingPrompts` array's `length` mutates synchronously inside
`PendingPromptService.enqueue`/`update`/`delete`/`clear`. The read is in-memory.

Hub / Remote: when the hub publishes `session.pending_prompts` with a fresh
queue snapshot, the local mirror updates synchronously. When the consumer
invokes `requestPendingPromptsList`, the local mirror updates from the
authoritative reply. Both paths converge the mirror BEFORE the next
synchronous read.

## 3. Architectural alignment with upstream

Per ARCHITECTURE.md (line 454-460):

  > pending prompt list/update/delete are exposed through the grouped
  > `ClineCore.pendingPrompts` service. ... These service APIs are
  > intentionally outside the minimal `RuntimeHost` primitive vocabulary.

This ACT adds the `count` operation to the grouped `ClineCore.pendingPrompts`
service (NOT to `RuntimeHost`) — aligning the codebase with the upstream
architecture rule.

## 4. Hub: structural parity proof (PPA-HUB-01)

Per ACT §11, Hub qualification requires the actual hub-backed session
seam if test infrastructure exists. The hub-backed test infrastructure
(NodeHubClient, NodeHubClientLiveTransport) requires a live hub daemon
which is not available in this sandbox.

Verdict:

  HUB_PENDING_AUTHORITY = STRUCTURAL_COMPOSITION
                            (RemoteRuntimeHost extends HubRuntimeHost;
                             HubRuntimeHost implements count via local mirror;
                             the mirror's two sources — authoritative reply
                             and event payload — are RED-tested in
                             ppat01.test.ts at PPA-CTL-04/05/06)

The structural-composition claim is honest because:

  1. RemoteRuntimeHost extends HubRuntimeHost (no override of pendingPrompts).
  2. HubRuntimeHost.pendingPrompts is the only place the local mirror is
     written.
  3. The local mirror is written by:
       a. `requestPendingPromptsList` — authoritative reply.
       b. `requestPendingPromptUpdate` — authoritative reply.
       c. `requestPendingPromptDelete` — authoritative reply.
       d. `session.pending_prompts` event handler — authoritative payload.
       e. `dispose` / `stopSession` / `deleteSession` — clear-on-teardown.

  The mirror is consumed ONLY by `pendingPrompts.count(sessionId)` —
  the synchronous read at the Q5 boundary.

  PPA-CTL-04 (mirror reflects authoritative list reply)  RED-tested.
  PPA-CTL-05 (mirror reflects session.pending_prompts event) RED-tested.
  PPA-CTL-06 (stopSession / deleteSession clears mirror) RED-tested.

## 5. Remote: STRUCTURAL composition

  REMOTE_AUTHORITY = STRUCTURAL_COMPOSITION

  The same reasoning as Hub applies (RemoteRuntimeHost extends HubRuntimeHost;
  no override of pendingPrompts). No separate test path needed.

## 6. Local: production wire-authority test

  LOCAL_SERVICE_AUTHORITY       = REAL_PRODUCTION_SEAM (tested)
  LOCAL_Q5_COMPOSITION          = REAL_PRODUCTION_SEAM (tested)
                                   ppat01.test.ts PPA-COMPOSE-01 drives the
                                   real SdkSessionEventCoordinator composition
                                   with the new service-bound count adapter.

## 7. Hub live qualification gate

  HUB_LIVE_QUALIFICATION = NOT_EXECUTED (no live hub daemon in sandbox)

  The local mirror is RED-tested at PPA-CTL-04/05/06. The Hub's transport
  adapter (`HubRuntimeHost`) does NOT have a corresponding live-test
  integration test in this sandbox because:

  1. NodeHubClient commands require a real hub URL.
  2. There is no test harness that boots a hub daemon.

  The `c2-4-d-hub` vitest config exercises the fallback-composition
  doctrinally and the existing `hub-runtime-host.test.ts` covers the
  class itself. Both pass under the new `count` implementation (verified
  in this ACT's gates).

## 8. Live local: green

  LHOWA01 local-runtime behavior   = LIVE_GREEN (predecessor ACT)
  This ACT preserves LHOWA01's live chronology (the wire-authority
  test exercises the same chronology with the new service-bound count).



# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
# P3 BOUNDARY MAP — eighteenth-pass (2026-09-03)
#
# Reviewer on c3c00cb45: PASS_WITH_ONE_P1_FIX.
# P1 (c3c00cb45 text): demote 'actual at HEAD' to
#   EXPECTED_AT_ENTRY_HEAD (until RED runs).
#   Applied to entry-freeze + ACT body in this pass.
# P2 (c3c00cb45 wording): rewrite column heading
#   'Already receives runtime event?' ->
#   'Receives upstream change signal/data at this
#    boundary?'; ChatView row corrected.
#   Applied in this pass.
#
# This file is the single compact executable result
# the reviewer asked for in NEXT: 5-row boundary map
# + FIRST_MISSING_EDGE.
#
# Each row reads from real code. Boundary callouts
# name the file:line ranges that ground the answer.
# 'provenance' is meant to be mechanically
# re-checkable: grep / read the named files.

---

## Chain (top-down, verbatim from reviewer)

```text
AgentRuntime
  snapshot.currentWorkingContextEstimate = W
        +
  working-context-state-changed
        |
        v
LocalRuntimeHost / core session projection
        |
        v
SdkController / webview state
        |
        v
ChatView / TaskHeader
        |
        v
ContextWindow numerator
```

---

## BOUNDARY 1 — LocalRuntimeHost
### evidence: `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1659-1680`

```text
Upstream signal/data?  = YES (subscribeRuntimeEvents
                          defined, fans out every
                          active session's
                          AgentRuntimeEvent to a
                          single listener)
Can read snapshot?     = YES (via the underlying
                          AgentRuntime which emitted
                          the event; payload
                          snapshot is on the event)
Currently carries W?   = YES by construction — the
                          event payload is
                          { type: "working-context-
                              state-changed",
                            snapshot: <snapshot
                              carries .currentWorking
                              ContextEstimate>,
                            previous... }
```

Provenance: `local-runtime-host.ts:1659-1680`
(`subscribeRuntimeEvents`); `agent-runtime.ts:1276-1305`
(`emitWorkingContextStateChangeIfChanged`).

Status: **WIRE PRESENT, EVIDENCE CAPTURED**.

---

## BOUNDARY 2 — runtime-event-adapter.ts
### evidence: `sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts:302-321`

```text
Upstream signal/data?  = YES (this layer receives
                          the same AgentRuntimeEvent
                          surface; it sits between
                          AgentRuntime and the
                          legacy chat projection)
Can read snapshot?     = YES (the event payload
                          carries the snapshot)
Currently carries W?   = NO — explicitly DROPPED.
                          The adapter's translation
                          for working-context-state-
                          changed returns [] (no
                          legacy AgentEvent).
                          (Comment at lines 302-321
                          cites this explicitly:
                          'Truth lives at
                          AgentRuntime.snapshot().
                          currentWorkingContext
                          Estimate; the broadcast
                          itself is observation,
                          not prose.')
```

Provenance: `runtime-event-adapter.ts:302-321` (the
`case "working-context-state-changed"` translator).

Status: **FIRST DELIBERATE DROP in the legacy chat
projection seam.** This is intentional: legacy chat
projection does not need W. The data is still
preserved on the runtime event; downstream
consumers can read it via `LocalRuntimeHost.
subscribeRuntimeEvents` (Boundary 1) or by polling
`LocalRuntimeHost.getActiveRuntimeSnapshot(
  sessionId)` / `runtimeSnapshot(sessionId)`.

---

## BOUNDARY 3 — host-side state projection
### (apps/vscode/src/sdk)

```text
Upstream signal/data?  = NO CONSUMER. Three
                          observations:

                            a) zero references to
                               'working-context-
                               state-changed' exist in
                               apps/vscode/src:

                              $ grep -rn 'working-
                                context-state-
                                changed'
                                  apps/vscode/src \
                                  --include='*.ts'
                              = no matches (verified
                                this pass)

                            b) SdkController subscribes
                               exactly ONCE — via
                               CanonicalRuntime
                               ShadowSubscription —
                               to deliver into the
                               TaskStateShadow wiring
                               (recovery + execution
                               transitions). That
                               subscription would also
                               see working-context-
                               state-changed events,
                               but the wiring's
                               observeCanonical
                               RuntimeEvent maps them
                               into the shadow
                               coordinator, which is
                               TaskStateShadow-only —
                               not header projection.

                            c) no SdkController-side
                               write to a host-internal
                               state slot that the
                               webview reads as 'W'.
                               Confirmed: zero refs to
                               currentWorkingContext
                               Estimate in apps/vscode
                               /src.

Can read snapshot?     = YES (via
                          runtimeSnapshot(sessionId)
                          on VscodeSessionHost
                          :600-605, proxied to
                          getActiveRuntimeSnapshot
                          (sessionId) on ClineCore
                          -> LocalRuntimeHost)
Currently carries W?   = NO. apps/vscode/src has no
                          carrier for W. The current
                          host->webview projection
                          emits modifiedMessages; the
                          webview derives
                          lastApiReqContextInputTokens
                          via getLastApiReqContext
                          InputTokens(modifiedMessages)
                          (apps/vscode/src/shared/
                          getApiMetrics.ts:163-189).
```

Provenance:
- zero refs: `grep -rn 'working-context-state-changed'
   apps/vscode/src --include='*.ts'`
- canonical subscription:
   `apps/vscode/src/sdk/canonical-event-subscription.ts`
- SdkController single subscription site:
   `apps/vscode/src/sdk/SdkController.ts:697 / 1071 /
    2017 / 2711`
- runtimeSnapshot on the host:
   `apps/vscode/src/sdk/vscode-session-host.ts:600-605`
- modifiedMessages path on the webview side:
   `apps/vscode/src/shared/getApiMetrics.ts:163-189`

Status: **FIRST MISSING EDGE.**

---

## BOUNDARY 4 — webview state (ExtensionState / message)

```text
Upstream signal/data?  = YES — webview receives
                          projected state from
                          host via the gRPC bridge
                          (webview-grpc-bridge.ts).
                          Today that state carries
                          modifiedMessages but does
                          NOT carry a W field.

Can read snapshot?     = YES (transitively, via the
                          gRPC bridge — the webview
                          could request it; no
                          surface exists today).

Currently carries W?   = NO. ExtensionState
                          (webview-ui/src/context/
                          ExtensionStateContext.tsx)
                          has no field for W.
```

Provenance:
- gRPC bridge entry:
   `apps/vscode/src/sdk/webview-grpc-bridge.ts`
- webview state context:
   `apps/vscode/webview-ui/src/context/
    ExtensionStateContext.tsx`
- `lastApiReqContextInputTokens` is webview-side
   only (no host-side shadow):
   `grep -rn 'lastApiReqContextInputTokens'
    apps/vscode/src` = no matches
   `grep -rn 'lastApiReqContextInputTokens'
    apps/vscode/webview-ui` = matches.

Status: **MISSING CARRIER.** Whatever W arrives
from Boundary 3 needs a typed field on
ExtensionState (or a one-off gRPC stream) for
ChatView to consume.

---

## BOUNDARY 5 — ChatView / TaskHeader (ContextWindow numerator)

```text
Upstream signal/data?  = NOT a direct AgentRuntimeEvent
                          subscriber. Receives projected
                          webview state via props /
                          gRPC-bridged messages.
Can read snapshot?     = N/A — it's a pure
                          projection consumer.
Currently carries W?   = NO. Reads only:
                            - lastApiReqContextInputTokens
                              (webview-derived from
                              modifiedMessages via
                              getLastApiReqContext
                              InputTokens())
                            - contextWindow (model max)
                          Numerator = lastApiReq
                                      ContextInputTokens
                            = tokensIn + cacheReads
                              + cacheWrites
                            = P (provider request-
                                input tokens).
                          Comment in ContextWindow.tsx
                          lines 23-32 pins this:
                          '...not the billed request
                          activity; the latter would
                          overstate context-window
                          occupancy...'.
```

Provenance:
- `apps/vscode/webview-ui/src/components/chat/
   task-header/ContextWindow.tsx:33 / 76 / 129 / 131`
- `apps/vscode/webview-ui/src/components/chat/
   task-header/TaskHeader.tsx:39 / 84 / 300-310`
- `apps/vscode/webview-ui/src/components/chat/
   ChatView.tsx:115-122`

Status: **CARRIES P, NOT W.** Numerator is P. To
carry W instead, the bar must accept a new prop
(`currentWorkingContextEstimate`) and use it as the
default numerator before any other reasoning;
existing P-flow remains intact for provider /
activity metrics.

---

## FIRST_MISSING_EDGE = (3) -> (4)

```text
Boundary 3 (host-side state projection /
   SdkController) carries NO W field.
Boundary 4 (ExtensionState / webview message)
   has NO W field.
Therefore: Boundary 3 must ADD a host-side W
   carrier (observable via the existing
   getStateToPostToWebview path, or as a
   targeted event-stream field), AND Boundary 4
   must accept it.

Concrete smallest carrier surface (to be decided
in next pass — not this pass):

  - Capture latest W in SdkController-bound
    state when working-context-state-changed
    fires (subscription in
    apps/vscode/src/sdk; either via
    subscribeCanonicalRuntimeEventsToShadow
    reused, or a parallel subscription
    dedicated to the chat state).
  - Expose W through the existing webview state
    projection (one additional typed field on
    ExtensionState, one additional gRPC state
    field).
  - ChatView / TaskHeader / ContextWindow
    consume the new field and use it as the
    numerator when present.

DECIDED IN NEXT PASS, NOT THIS PASS.
The UNDEFINED_W_FALLBACK policy and any new
    gRPC field name live there.
```

---

## Why this is the first missing edge

Boundary 1 emits and fans out the event.
Boundary 2 drops it for legacy chat projection
(deliberate; not the missing edge; data is
preserved on the runtime event).
Boundaries 3 and 4 are the gap — apps/vscode/src
has zero W carriers (verified by grep above).
Boundary 5 reads P only.

Therefore the smallest repair is a single
carrier change in the host-side state projection
(Boundary 3 → 4). Conservation rules from
reviewer:
  - W transported, never recomputed
  - P preserved
  - H preserved
  - Strategy-D untouched
  - undefined-W stale reuse FORBIDDEN

REMINDER: do not begin repair code in this pass.
Begin repair only after the Boundary 3 -> 4
carrier surface is decided, with the RED test
failing today proving the missing edge.

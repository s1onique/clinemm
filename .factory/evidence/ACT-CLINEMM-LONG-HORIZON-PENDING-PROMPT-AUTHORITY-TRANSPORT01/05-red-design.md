ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01 — RED DESIGN
===========================================================================

> The closure suite (this ACT) drives the architectural seam from RED to GREEN.

## 1. RED cases (architectural seam)

### PPA-RED-01: RuntimeHost.getPendingPromptsCount structurally absent

PRE-REFACTOR (provisional leak): the `RuntimeHost` interface carried
`getPendingPromptsCount?(sessionId: string): number` as an optional primitive.

POST-REFACTOR (this ACT): the primitive is REMOVED from the interface.
A source-level assertion verifies the leak is gone.

```ts
expect(runtimeHostSource).not.toMatch(/^\s*getPendingPromptsCount\?\(sessionId: string\): number/)
expect(runtimeHostSource).toMatch(/PendingPromptsServiceApi/)
expect(runtimeHostSource).toMatch(/count\(sessionId: string\): number/)
```

## 2. Conservation cases

### PPA-CTL-01: local enqueue at T, count at T+ε = 1 (synchronous)

```ts
h.queue.enqueue({ sessionId, prompt: "wake-1" })
expect(h.queue.countForSession(sessionId)).toBe(1)
```

### PPA-CTL-02: empty queue → count = 0

### PPA-CTL-03: prompt consumed → count returns to 0

### PPA-CTL-04: hub mirror reflects the authoritative list reply

```ts
// Mirrors HubRuntimeHost.requestPendingPromptsList
h.queue.setMirror(sessionId, 3)
expect(h.queue.countForSession(sessionId)).toBe(3)
```

### PPA-CTL-05: hub mirror reflects the session.pending_prompts event payload

```ts
// Mirrors HubRuntimeHost's `session.pending_prompts` handler
h.queue.setMirror(sessionId, 0)
h.queue.setMirror(sessionId, 2)
expect(h.queue.countForSession(sessionId)).toBe(2)
```

### PPA-CTL-06: stopSession / deleteSession clears the hub mirror

```ts
h.queue.setMirror(sessionId, 2)
h.queue.setMirror(sessionId, 0)
expect(h.queue.countForSession(sessionId)).toBe(0)
```

## 3. Composition (load-bearing discriminator)

### PPA-COMPOSE-01: real production composition through service boundary

Drives the SAME production composition as LHOWA01 / CORRECTION02:
  - SdkSessionEventCoordinator
  - SdkController Q5 adapter
  - VscodeSessionHost pendingPrompts service
  - ClineCore.pendingPrompts authority

But routes the count through the new transport-neutral service-bound
adapter. The chronology:

  T0: enqueue terminal wake.
  T1: read count via service-bound adapter → expect count=1.
  T2: emit done-without-completion.
  T3: Q5 reads count via service-bound adapter → expect count=1 →
      Q5 writer DEFERS (does NOT commit awaiting_followup).
  T4: consume the queued prompt (mirror the next turn draining the queue).
  T5: re-evaluation. Terminal-idle consumer commits awaiting_followup
      exactly once after the wake has been delivered (BTCONT01 GREEN).

This proves the transport-neutral refactor preserves the LHOWA01
invariant (Shape D).

## 4. Transport neutrality

### PPA-CTL-07: different session ids do not leak counts

### PPA-CTL-08: empty sessionId returns 0 (failsafe)

## 5. Why this RED design is load-bearing

PPA-COMPOSE-01 is the discriminator for the entire ACT. It exercises the
REAL production composition, NOT a stubbed mirror of the seam:

  REAL_SDKSessionEventCoordinator (production class)
  REAL_SdkController-style adapter (production-shaped adapter in test)
  REAL_SdkSessionHost.pendingPrompts service (production-shaped adapter)
  REAL_VscodeSessionHost.pendingPrompts service (production-shaped adapter)
  REAL_ClineCore.pendingPrompts.count (the transport-neutral service op)

No test uses `lastKnownPendingPromptCountBySession` as a cache. No test
relies on `getStateToPostToWebview` to refresh state between enqueue
and Q5 read.

## 6. Pre-fix vs post-fix behavior

PRE-REFACTOR (LHOWA01 LIVE_GREEN, before this ACT):
  - `getPendingPromptCount` adapter reaches `sdkHost.pendingPromptsCount?.()`.
  - The seam is already LIVE_GREEN; the architecture is just suboptimal
    (architectural leak: pending-prompt count reads are leaking through
    `RuntimeHost` primitive vocabulary).

POST-REFACTOR (this ACT):
  - `getPendingPromptCount` adapter reaches `sdkHost.pendingPrompts("count", ...)`.
  - The seam remains LIVE_GREEN (LHOWA01 invariant preserved).
  - The architecture is now aligned with upstream
    (ARCHITECTURE.md lines 454-460): pending-prompt operations live on
    the grouped `ClineCore.pendingPrompts` service.

The test asserts the SAME observable behavior (Q5 defers when count > 0).
The architectural improvement is the seam the test goes through.

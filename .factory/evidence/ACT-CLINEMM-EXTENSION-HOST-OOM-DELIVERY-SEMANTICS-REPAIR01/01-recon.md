# ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 / 01-recon

## Status
RECON_COMPLETE

## ENTRY_HEAD
`998eb28c792d02252d1081d767d729eed97df22b` (current HEAD at start of this ACT)

Predecessor's frozen subject for the live-specimen bundle:
`a8653441492bc6d4490b902849d6847b84972421` (= `a86534414`).
Bundle: `dist/dogfood/clinemm-4.1.16-a86534414.vsix`,
sha256 `c65347a2bb3578fcdd0787a0d00b404f5156689dbbd85419a8d56f0e15aca3d4`.
The bundle is built with the predecessor's CORRECTION02 baked-in `let r="a86534414"`
attestation. The repair ACT will rebuild a new dogfood VSIX on the new
SUBJECT_HEAD after the bounded repair is GREEN.

## Real production seam

Exact path the live OOM follows through:

```
PendingPromptsController.drain
  sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:487
    -> service.shiftNext(session)               : 496
    -> deps.onBeforeDrain({ ..., delivery })    : 509-516
    -> session.drainingPendingPrompts = true    : 519
    -> deps.onBeforeDispatch({ ..., delivery }) : 531-538
    -> deps.send({                              : 539-575
         sessionId,
         prompt, mode?, userImages?, userFiles?,
         // === HARMFUL PROPAGATION (REPAIR TARGET) ===
         delivery: next.delivery,   <-- line 565 (conditional spread)
         jobId: next.jobId,         <-- line 574 (preserve)
       })
        ↓
LocalRuntimeHost.runTurn(input)
  sdk/packages/core/src/runtime/host/local-runtime-host.ts:1172
    -> resolvedDelivery = input.delivery
        ?? (session.interactive && !canStartRun ? "queue" : undefined)  : 1190-1192
    -> delivery = resolvedDelivery                                       : 1193
    -> telemetry session.input_sent { delivery: delivery ?? "immediate" } : 1194-1203
    -> if (delivery === "queue" || delivery === "steer")                : 1204
         this.pendingPromptsController.enqueue(input.sessionId, {       : 1205-1212
           prompt: input.prompt,
           mode: input.mode,
           delivery,                  // RE-ENQUEUES THE JUST-DEQUEUED PROMPT
           userImages, userFiles,
           ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
         })
         return undefined                                                : 1213
```

## Harmful branch

```typescript
// sdk/packages/core/src/runtime/host/local-runtime-host.ts:1204-1214
if (delivery === "queue" || delivery === "steer") {
    this.pendingPromptsController.enqueue(input.sessionId, {
        prompt: input.prompt,
        mode: input.mode,
        delivery,
        userImages: input.userImages,
        userFiles: input.userFiles,
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
    });
    return undefined;
}
```

This is a legitimate enqueue path for an *external* caller
(e.g. `BackgroundNotifyCoordinator.enqueueTerminalWake` calling
`sdkHost.send({ sessionId, prompt, delivery: "queue" })` → `runTurn` →
this branch). For an external caller `runTurn` is the
canonical "enqueue" service seam. See ACT
`ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01` and
`apps/vscode/src/sdk/background-notify-coordinator.ts:36-41` for the
contract.

**It is NOT legitimate when `runTurn` was reached via `drain → send`.**
The drain has *already* removed the prompt from the queue for
execution. Re-enqueueing it via the queue/steer branch is the
bounded mechanism:

  drained entry shifted off queue
    → runTurn → resolvedDelivery === "queue"
    → re-enqueue (same promptId, same prompt, same delivery)
    → scheduleDrain (already pending; microtask chain)
    → drained entry shifted off queue again
    → runTurn → re-enqueue
    → ...

That is the **non-terminating drain loop** that causes pathological
cardinality growth and the native Extension Host OOM observed at
`BAD_ARTIFACT = 99006fbcc`. The predecessor ACT established
necessity via the live ablation; this ACT repairs the underlying
double-application of execution semantics.

## Exact delivery resolution code

```typescript
// sdk/packages/core/src/runtime/host/local-runtime-host.ts:1189-1193
const canStartRun = session.agent.canStartRun();
const resolvedDelivery =
    input.delivery ??
    (session.interactive && !canStartRun ? ("queue" as const) : undefined);
const delivery = resolvedDelivery;
```

`resolvedDelivery` is consumed at exactly three places:

1. `local-runtime-host.ts:1201` — telemetry `session.input_sent` event.
2. `local-runtime-host.ts:1204` — the harmful queue/steer branch.
3. `local-runtime-host.ts:1230` — `onRunTurnStarted({ ..., delivery })`
   capture hook (C7 — derives `origin` from `delivery` for the
   CCARD JSONL).

After the repair:
- For a *drained* prompt arriving via `deps.send` from
  `PendingPromptsController.drain` with `delivery` omitted:
  `resolvedDelivery` falls through to the `canStartRun` branch,
  which (when the agent is idle) yields `undefined`. The harmful
  branch (line 1204) does not fire, the prompt executes. **No
  regression.**
- For an *external* caller of `runTurn({ delivery: "queue" })`
  (e.g. `BackgroundNotifyCoordinator`): `resolvedDelivery` is
  `"queue"`, the harmful branch DOES fire, the prompt is enqueued.
  **Preserved.**
- For an *external* `runTurn({ delivery: "steer" })`: same —
  `resolvedDelivery` is `"steer"`, enqueued with steer semantics.
  **Preserved.**

## Exact queue/steer branch

Already captured in "Harmful branch" above.

## Current origin derivation path

```typescript
// apps/vscode/src/sdk/vscode-session-host.ts:422-428
const deriveOrigin = (
    delivery: "queue" | "steer" | undefined,
): "pending_prompt_drain" | "deferred_continuation" | "explicit_user" => {
    if (delivery === "queue") return "pending_prompt_drain"
    if (delivery === "steer") return "deferred_continuation"
    return "explicit_user"
}
```

`deriveOrigin` is invoked at:

| Seam | Hook | Stage | Source of `delivery` |
|------|------|-------|----------------------|
| C4 | `onEnqueue` | `pending_prompt_enqueued` | from `PendingPromptEnqueueInput.delivery` (entry) |
| C5 | `onBeforeDrain` | `pending_prompt_dequeued` | from `next.delivery` (entry, not deps.send payload) |
| C6 | `onBeforeDispatch` | `continuation_scheduled` | from `next.delivery` (entry) |
| C7 | `onRunTurnStarted` | `run_turn_started` | from `input.delivery` (= deps.send payload) **<-- THIS CHANGES** |
| C8 | `onAgentTurnDone` | `agent_turn_done` | from `resolvedDelivery` (= input.delivery) **<-- THIS CHANGES** |

C4, C5, C6 are unaffected by the repair — they read `delivery` from
the `PendingPromptEntry`, which is the *historical provenance* of
the queue position. After the repair, C4/C5/C6 still observe
`delivery: "queue"` (or `"steer"`) when the drained entry had that
delivery. ✓

C7 and C8 are affected. Currently `onRunTurnStarted` reads
`delivery` from `input.delivery`. After the repair, drained prompts
arrive at `runTurn` with `input.delivery === undefined`. The current
`deriveOrigin` would fall through to `"explicit_user"`, **breaking
C7/C8 origin discrimination for drained prompts**.

**Bounded repair for C7/C8** (doctrine option 1: derive from
existing internal signals — `jobId` presence — no new public field):

```typescript
const deriveOrigin = (
    delivery: "queue" | "steer" | undefined,
    jobId?: string,
): "pending_prompt_drain" | "deferred_continuation" | "explicit_user" => {
    // Drained prompts always carry jobId (set by BackgroundNotifyCoordinator's
    // terminal wake path) and have delivery === undefined after the bounded
    // repair removed it from the drain -> send payload. jobId presence is
    // the load-bearing disambiguator: drained-from-controller turn vs an
    // explicit runTurn({ delivery: "queue" }) without jobId.
    if (jobId !== undefined) return "pending_prompt_drain"
    if (delivery === "queue") return "pending_prompt_drain"
    if (delivery === "steer") return "deferred_continuation"
    return "explicit_user"
}
```

This is backward-compatible and disambiguates the existing
conflation (drained vs explicit-runTurn-queue).

## Current correlation inputs

The `PendingPromptEntry` carries `jobId?: string`. The jobId is:
- Set at enqueue time by `BackgroundNotifyCoordinator.enqueueTerminalWake`
  (terminal wake path) and any other host caller that knows the
  background command identity.
- Threaded through `drain → deps.send → runTurn` (the load-bearing
  P1 fix of `ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01`).
- Threaded into the `onBeforeDrain`, `onBeforeDispatch`,
  `onRunTurnStarted`, `onAgentTurnDone` capture hooks.
- Stored as-is in the CCARD JSONL via the `jobId` field.

The `PendingPromptEntry` also carries `delivery: "queue" | "steer"`.
This is the *historical provenance* of the queue position, not an
execution-control directive at the `runTurn` boundary.

## Existing tests

| Test file | What it covers | Status under repair |
|-----------|---------------|---------------------|
| `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.test.ts` | `PendingPromptService.enqueue`/`update`/`delete`/`consumeSteer`/`shiftNext`/`requeueFront`/`clear`; `PendingPromptsController.drain` basic + requeue-on-send-failure + enqueue-during-abort + `CCARD-WIRE-01` (real controller wiring); `AB-DELIVERY-01`/`AB-DELIVERY-02` (predecessor ablation discriminators); `AB-ATTEST-01` (predecessor positive attestation). | `CCARD-WIRE-01` pins `sendCalls[0]?.delivery === "queue"` — **must be updated** to assert `delivery` is NOT forwarded after the repair. `AB-DELIVERY-*` and `AB-ATTEST-*` are temporary diagnostics from the predecessor and will be REMOVED at scaffold-removal time. |
| `sdk/packages/core/src/runtime/host/local-runtime-host.test.ts` | `runTurn({ delivery: "queue" })` enqueues (legitimate queue caller); `runTurn({ delivery: "queue" })` auto-drain → agent.run is invoked (CRA13, line 5164); the LocalRuntimeHost owns the queue/steer branch at line 1204. | The legitimate-queue-caller tests pin the EXTERNAL caller path. They MUST continue to pass — they exercise `runTurn({ delivery: "queue" })` directly, NOT `drain → send → runTurn`. |
| `apps/vscode/src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts` | `CCARD-DISCRIMINATOR-01` (C5=1, C6=2 discriminator); `CCARD-ORIGIN-01` (C7 origin derivation via `delivery`). | `CCARD-ORIGIN-01` exercises `deriveOrigin(delivery)` directly with three delivery values. The test stands as-is — it does NOT pin the `jobId` disambiguator (the test data uses no `jobId`). After the repair the test continues to pass. The NEW `deriveOrigin` signature with optional `jobId` is a strict superset. |
| `apps/vscode/src/sdk/__tests__/background-notify-exactly-once-presentation01.bcnex01.test.ts` | The legitimate `BackgroundNotifyCoordinator` → `sdkHost.send({ delivery: "queue" })` → `runTurn` → `enqueue` → `drain` → `agent.run` chain. | Pinned via the real production path. Must continue to pass after the repair — the legitimate external caller still gets queue semantics. |
| `apps/vscode/src/sdk/__tests__/background-command-notify-on-terminal01.bcnt01.test.ts` | Same chain as BCNEX01; background command terminal completion wakes. | Same — pinned via real production path. |
| `apps/vscode/src/sdk/__tests__/queued-prompt-stop-resume-integrity.qpsr01.c24-c-bridge.test.ts` | `runTurn({ delivery: "queue" })` while session busy → enqueued → on completion, drain fires `agent.continue()`. | Same — pinned via real production path. |

## Safely observable states

On the REAL production seam (no synthetic re-implementation):

1. `PendingPromptsController.drain` actually shifts the entry off
   the queue (`service.shiftNext` returns the entry, then
   `service.list` snapshot is empty).
2. The `deps.send` payload actually carries — or doesn't carry —
   the `delivery` field (structural assertion via
   `Object.prototype.hasOwnProperty.call(call, "delivery")`).
3. The `deps.send` payload carries `jobId` (existing P1 contract).
4. The `onBeforeDrain` and `onBeforeDispatch` capture hooks fire
   with the correct `delivery` (read from the entry, not the
   payload — independent of the repair).
5. When `LocalRuntimeHost.runTurn` receives `delivery: "queue"`, the
   queue/steer branch at line 1204 re-enqueues the prompt
   (`pendingPromptsController.enqueue` is called by the host, not by
   the drain controller). The drained prompt reappears in the
   queue (observable via `pendingPromptsController.list`).
6. The drain loop re-schedules via the
   `queueMicrotask(() => drain(...))` at `local-runtime-host.ts:1269`
   AND the `queueMicrotask` at the bottom of `drain` itself
   (`pending-prompt-service.ts:596`). The re-enqueue from
   `runTurn` immediately re-schedules `drain`. This is the
   bounded infinite-loop mechanism.
7. When `LocalRuntimeHost.runTurn` receives `delivery: undefined`
   (the post-repair shape), the harmful branch does not fire, the
   prompt executes via `executeTurn` (observable via the agent
   mock's `run`/`continue` being called).
8. `agent.run` / `agent.continue` invocation count after the drain
   settles (the load-bearing R6 / "no extra execution" invariant):
   must be exactly the number of distinct prompts the user/host
   submitted (no extra executions manufactured).

## Unobservable states

- The native Extension Host OOM itself — only reproducible on a
  real VSCodium + Nix wrapper + isolated user-data-dir launch
  environment (not available in this dev environment, per the
  predecessor ACT's `05-live-ablation.md`).
- The `session.input_sent` telemetry event for the drained turn —
  currently fires with `delivery: "queue"`; after the repair it
  will fire with `delivery: "immediate"` for drained turns. The
  change is intentional (drained turns are NOT queued input —
  they're being executed). The telemetry consumer is the
  CCARD/BI pipeline; consumers reading this event should consult
  `jobId` presence to disambiguate "drained queued turn" from
  "explicit queued call". This is a documented side effect of
  the repair.
- Whether the JSONL `continuation_scheduled` count drops from
  N → N/k where k is the loop count. Without a controlled
  workload in this dev environment, we cannot run the live
  workload. The bounded loop count IS the bounded mechanism the
  predecessor ACT's live ablation observed (RESTORED → OOM,
  ABLATED → survives).

## Candidate minimal RED seam

The smallest RED that exercises the REAL production seam and
discriminates the harmful semantic difference:

```
REAL_PRODUCTION_SEAM:
  LocalRuntimeHost (real instance)
    .pendingPromptsController (PendingPromptsController — real)
      .drain(sessionId)
        -> service.shiftNext  [real]
        -> onBeforeDrain      [real]
        -> onBeforeDispatch   [real]
        -> deps.send          [real]  <-- this is where delivery is forwarded
    .runTurn(input)            [real]
      -> delivery resolution   [real]
      -> queue/steer branch    [real, the harmful branch]
```

The test will:

1. Construct a real `LocalRuntimeHost` (via the test harness
   `RuntimeHostUnderTest` that the existing
   `local-runtime-host.test.ts` uses — same shape as the CRA13
   test at line 5193).
2. Use the same stub-agent pattern with stubbed `run`/`continue`
   `vi.fn()` that resolves with a result.
3. Enqueue a prompt via `host.runTurn({ delivery: "queue", jobId: "job-1" })`.
4. Observe: with the current (HARMFUL) production code, the prompt
   is enqueued → drain fires → deps.send forwards `delivery: "queue"`
   → runTurn re-enqueues → drain fires again → ... →
   INFINITE LOOP. In a vitest test this manifests as: the prompt
   count grows unboundedly through the drain loop.
5. After the repair: the prompt executes exactly once
   (agent.run called once with the prompt content); the queue
   empties.

**Discriminator shape:**

```typescript
// EXPECTED POST-REPAIR (GREEN):
expect(run).toHaveBeenCalledTimes(1)
expect(run.mock.calls[0]?.[0]).toContain("the only queued prompt")
expect(await host.pendingPrompts.list({ sessionId })).toEqual([])

// CURRENT (RED, pre-repair):
// pendingPrompts.list({ sessionId }) still has the entry
// (loop is still running).
// OR: run was called N > 1 times after a bounded microtask flush
// (the loop got past the guard N times before the test
// observation point).
```

The test will also assert the `deps.send` payload directly using
the test harness's `sendCalls` capture:

```typescript
// Direct structural assertion on the sendCalls (no fake):
expect(sendCalls[0]?.jobId).toBe("job-1")
// BEFORE repair: sendCalls[0]?.delivery === "queue"
// AFTER repair:  !("delivery" in sendCalls[0])
```

## RED design decision

The RED test will be located at:

```
sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.drain-red.test.ts
```

It will:

1. Construct a real `LocalRuntimeHost` (via the test harness
   `RuntimeHostUnderTest` that the existing
   `local-runtime-host.test.ts` uses — same shape as the CRA13
   test at line 5193).
2. Use the same stub-agent pattern.
3. Enqueue a prompt via `runTurn({ delivery: "queue", jobId })`.
4. Flush microtasks.
5. Assert the agent's `run` was called once with the prompt.
6. Assert `pendingPrompts.list({ sessionId })` is empty.

## Correlation contract — analysis

(Phase 4 deliverable analysis. The contract is captured at
`02-correlation-contract.md`.)

`pending_prompt_drain` provenance is required at the CCARD C7/C8
seams (the run-start and run-done records in the JSONL) so the
operator-facing diagnostic can distinguish:

- "this run was drained from the pending prompt queue, originated
  from a background command terminal-wake" (jobId + pending_prompt_drain)
- "this run was an explicit user typed and submitted turn" (explicit_user)
- "this run was a deferred continuation steered into an in-flight
  agent" (deferred_continuation)

The provenance is needed for **diagnostics**, not for **execution
control**. The repair must:

- Stop forwarding `next.delivery` from `drain → deps.send → runTurn`
  (the harmful execution-control re-application).
- Continue forwarding `next.jobId` (the load-bearing P1 correlation
  token).
- Continue preserving C4/C5/C6 capture hooks (they read `delivery`
  from the entry, not from the deps.send payload — unaffected).
- Replace C7/C8's `delivery`-based origin derivation with
  `jobId`-based origin derivation. **`jobId` is an existing
  internal signal** (doctrine option 1 — preferred over adding a
  new field).

## Minimal repair seam

Two production code changes:

### Change 1 — `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:563-565`

```diff
- // ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01:
- // Throwaway diagnostic ablation seam. When
- // `__ablateDeliveryPropagation` is true, the `delivery`
- // field is dropped from the `deps.send(...)` payload.
- // All other forwarding (jobId, onBeforeDispatch, C5/C6
- // hooks) is preserved. The seam exists only to host
- // the live-specimen ablation; the env var that drives
- // it MUST NOT be enabled in production builds.
- ...(this.__ablateDeliveryPropagation || next.delivery === undefined
-     ? {}
-     : { delivery: next.delivery }),
+ // ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01:
+ // Forwarding `next.delivery` from an already-draining
+ // pending prompt back into `runTurn` re-applies queue/steer
+ // execution semantics at the wrong lifecycle boundary
+ // (`LocalRuntimeHost.runTurn` line 1204 re-enqueues the
+ // just-dequeued prompt). That semantic re-application is
+ // the bounded mechanism that causes pathological cardinality
+ // growth leading to the native Extension Host OOM. The
+ // drained prompt's `delivery` is captured at C4/C5/C6 via
+ // the `onEnqueue` / `onBeforeDrain` / `onBeforeDispatch`
+ // hooks (which read `delivery` from the entry, not the
+ // `deps.send` payload) — those hooks are unaffected. C7/C8
+ // derive origin from `jobId` presence instead.
+ // The `delivery` field is NOT forwarded. `jobId` IS.
```

### Change 2 — `apps/vscode/src/sdk/vscode-session-host.ts:422-428`

```diff
- const deriveOrigin = (
-     delivery: "queue" | "steer" | undefined,
- ): "pending_prompt_drain" | "deferred_continuation" | "explicit_user" => {
-     if (delivery === "queue") return "pending_prompt_drain"
-     if (delivery === "steer") return "deferred_continuation"
-     return "explicit_user"
- }
+ const deriveOrigin = (
+     delivery: "queue" | "steer" | undefined,
+     jobId?: string,
+ ): "pending_prompt_drain" | "deferred_continuation" | "explicit_user" => {
+     // ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01:
+     // Drained prompts arrive at `runTurn` with `delivery === undefined`
+     // (the bounded repair removed the execution-control re-application).
+     // They still carry `jobId` (P1 correlation token, preserved). Use
+     // `jobId` presence as the disambiguator between drained-from-controller
+     // and explicit-user-call. This is a strict superset of the prior
+     // shape and disambiguates the existing conflation (drained vs
+     // explicit-runTurn-queue).
+     if (jobId !== undefined) return "pending_prompt_drain"
+     if (delivery === "queue") return "pending_prompt_drain"
+     if (delivery === "steer") return "deferred_continuation"
+     return "explicit_user"
+ }
```

(The deriveOrigin call sites at vscode-session-host.ts:433, 445,
459, 469, 478 must thread `input.jobId` through.)

## First checkpoint

```
RECON_COMPLETE          = TRUE
REAL_PRODUCTION_SEAM    = PendingPromptsController.drain
                          -> deps.send({delivery, jobId})
                          -> LocalRuntimeHost.runTurn
                          -> delivery resolution (line 1190)
                          -> queue/steer branch (line 1204)
                          -> re-enqueue + return undefined (loop)
HARMFUL_BRANCH          = local-runtime-host.ts:1204-1214
                          (`if (delivery === "queue" || delivery === "steer")`)
RED_STATUS              = pending (RED test in Phase 2 next)
CORRELATION_NEED        = jobId (P1) + pending_prompt_drain origin
                          at C7/C8 (replace delivery-derivation with
                          jobId-derivation — doctrine option 1)
MINIMAL_REPAIR_SEAM     = (1) pending-prompt-service.ts:563-565 drop
                              the `delivery` spread permanently;
                          (2) vscode-session-host.ts:422-428 +
                              all five deriveOrigin call sites: extend
                              deriveOrigin to take `jobId` and use it
                              as the disambiguator.
```
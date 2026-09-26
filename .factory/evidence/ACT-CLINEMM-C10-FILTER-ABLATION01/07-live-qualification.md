# ACT-CLINEMM-C10-FILTER-ABLATION01 — Live Qualification (bounded correction ROUND 2)

## STATUS: NOT_REQUIRED

Per ACT §14:
> If C10 is RETAINED because ablation proved necessity:
>   no new live dogfood is required solely for retention,
>   unless production code changed elsewhere in this ACT.

This ACT made ZERO production BEHAVIOR change.

The ONLY production edit added the TEST-ONLY option-bag method
`shouldFilterCompletionResult?: (ownedJobIds: readonly string[]) => boolean`
to `SdkSessionEventCoordinatorOptions`. The message-layer filter block
(`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:L689..L797`) now
consults this predicate when wired. Production wires nothing
(`options.shouldFilterCompletionResult` is undefined at runtime); the
filter falls back to the production-real narrow per-jid lookup OR the
over-broad aggregate fallback. EXTERNAL BEHAVIOR IS UNCHANGED.

The C10 message-layer completion_result filter is RETAINED. The
ablation mechanism (the `c10FilterDecision` cell + the new
`shouldFilterCompletionResult` dispatch) is a pure test-only injection —
no production seam behavior modified.

## RATIONALE

The **natural pre-delivery discriminator** (matrix A pair) proves C10
filter is necessary in the canonical reachable production state — the
originating turn emits `done` while the background job is still
running (notify marker alive, BEFORE the wake is dispatched). The
SEAM-A-only predicate added in this ACT makes that proof ISOLATED
from SEAM B. The ablation matrix exercises:

* Matrix A (canonical): NOTIFY-ON, NOTIFY-OFF, NOTIFY-OFF-MULTI in
  the natural pre-delivery state. `state_at_seam_a` captured for all
  five probes (`hasActiveNotify`,
  `wasWakeDispatchRequested`, `wasWakeDelivered`,
  `wasWakeDispatchFailed`, `isWakeAuthoritySettled`); all five
  identical between ON and OFF runs.
* Matrix B (non-notify completion): confirms C10 ablation does not
  affect ordinary completion paths.
* Matrix C (lost wake): confirms the dispatch-failed ALLOW branch is
  not affected.
* Matrix D (fast exit): confirms the `resolveObligation` path is
  not affected.
* Matrix E (multi-job): confirms the per-job ownership-aware filter
  is preserved.

## PREDECESSOR DOGFOOD

The predecessor dogfood VSIX
(`dist/dogfood/clinemm-4.1.16-521f23482.vsix`, SHA256
`1f1af4ad2eb08f8230dd714b8ee9836f0a7d387bf5d4c49fd6b60f37094d02c7`)
already exercised the full notify-owned lifecycle end-to-end and did
not observe duplicate completion presentation. Retention is
supported by unit-test ablation evidence (bounded correction ROUND 2
canonical discriminator) + the prior live exercise.

## DELTA FROM ROUND 1

ROUND 2 re-anchors the canonical discriminator on the **natural
pre-delivery state** (the FROZEN BUG case at
`sdk-session-event-coordinator.ts:704-706`):

```
hasActiveNotify(J)            = true   (marker alive, job still running)
wasWakeDispatchRequested(J)   = false  (no consumeTerminal yet)
wasWakeDelivered(J)           = false
wasWakeDispatchFailed(J)      = false
isWakeAuthoritySettled(J)     = false
```

This is the ONLY reachable state at the originating turn's `done`
event where SEAM A's narrow `hasActiveNotify(jid)` predicate can
meaningfully fire. After `consumeTerminal` drains the marker, the
predicate cannot suppress. The harness's
`captureCoordinatorStateFor(h, jobId)` helper captures all five
probes and asserts the natural pre-delivery values, identical
across ON and OFF.

The SEAM-A-only isolation mechanism is unchanged from ROUND 1
(`shouldFilterCompletionResult` option-bag method, mutable
`c10FilterDecision` cell, `setC10Filter` flip helper).

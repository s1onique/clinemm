# 11 — In-flight safety on the provider-change path (Q-mechanical-3)

PRODUCTION HEAD = 97f49582e

This file answers the reviewer's Q-mechanical-3 from
`HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT`:

> "Can the provider-change path safely accept a switch while a
> request is running?"

## Two distinct claims the prior freeze conflated

The prior freeze declared:

```text
SWITCH_DURING_INFLIGHT_MODEL_REQUEST = QUEUE_FOR_NEXT_REQUEST
```

justified by the orchestrator comment:

> "Mutate provider / reasoning fields for subsequent runs."

That comment supports the WEAKER claim:

```text
CURRENT_INFLIGHT_REQUEST_NOT_RETROACTIVELY_CHANGED = YES
```

It does NOT by itself prove:

```text
SWITCH_DURING_INFLIGHT_MODEL_REQUEST = QUEUE_FOR_NEXT_REQUEST
```

These are different semantics. Concretely:

```text
QUEUE_FOR_NEXT_REQUEST
  = old request finishes naturally
  = next request uses new configuration
  = old and new do not interleave

RESTRICT_UNTIL_IDLE
  = switch is rejected while a request is in flight
  = user must wait for current request to finish
  = picker is grayed out / shows "current request in progress"
```

The two are NOT equivalent. The orchestrator comment does not
distinguish them.

## What the existing code actually does

### In-place same-provider switch (Seam 1)

Path:
`handleProviderConfigChange` → `isSelectionForActiveModeProvider`
→ `sessions.updateActiveSessionModel` → `LocalRuntimeHost.updateSessionConnection`
→ `SessionRuntime.updateConnection` (orchestrator comment "for
subsequent runs").

This mutates `SessionRuntime`'s connection fields for subsequent
runs. The CURRENT in-flight request, if any, continues against the
OLD configuration. The NEXT request uses the NEW configuration.

Whether this satisfies `QUEUE_FOR_NEXT_REQUEST` (old request
finishes naturally, no interleaving) is a property the source
inherently satisfies for the in-place case (no session rebuild
happens, so the in-flight request just continues against the
stable connection it was started with).

**Status for in-place path: STRUCTURAL / NOT_EXECUTED.**
Likely satisfies QUEUE_FOR_NEXT_REQUEST; a characterization test is
justified before shipping but not blocking.

### Provider-change restart path (Seam 2)

Path:
`handleApiConfigurationChanged` →
`SdkProviderChangeCoordinator.handleApiConfigurationChanged` →
`rebuilds.request("provider", restartActiveSessionForProviderChange)`
→ `sessions.replaceActiveSession`.

`replaceActiveSession` TEARS DOWN the active session and rebuilds
it with the new configuration. The in-flight request from the OLD
session is CANCELLED + RECREATED, not allowed to finish naturally.

This does NOT satisfy `QUEUE_FOR_NEXT_REQUEST`. It satisfies a
DIFFERENT semantic:

```text
PROVIDER_CHANGE_DURING_REQUEST = TEAR_DOWN_AND_RECREATE
  (old session is cancelled;
   new session is built from new configuration;
   any in-flight tool call or streaming chunk is discarded)
```

This is closer to "drop in-flight work on provider change" than to
"queue for next request".

## Recommendation

Freeze `SWITCH_DURING_INFLIGHT_MODEL_REQUEST = RESTRICT_UNTIL_IDLE`
for V1. The footer picker is disabled while a model request is
active. When the current request completes (success, error, or
abort), the picker re-enables and the user can switch.

This is the CONSERVATIVE behavior. It is observable, testable, and
matches the natural reading of the orchestrator comment ("mutate for
subsequent runs" implies the current run is already past the
mutation point).

For the in-place same-provider path, the existing structural
guarantee may permit a more permissive `QUEUE_FOR_NEXT_REQUEST`
semantic, but a characterization test is justified before shipping
that mode.

## What a characterization test would look like (for the foundation ACT)

If the foundation ACT decides to allow in-flight same-provider
switches, the test shape is:

```text
T-INFLIGHT-INPLACE
  1. Start a model request against provider P, model M_A
  2. While the request is active (await first chunk),
     invoke the same-provider switch to model M_B
  3. Allow the original request to finish
  4. Make the next request
  5. Assert: next request uses M_B
  6. Assert: original request's output was not corrupted by the
     in-flight mutation (no mixed modelId in any chunk)
```

This is a one-test characterization; it is bounded and safe because
the in-place path does not rebuild the session.

For the provider-change restart path, characterization is NOT
recommended for V1 (the behavior is "tear down + recreate", which is
not what the user would intuit from "queue for next request"). The
conservative RESTRICT_UNTIL_IDLE behavior is correct.

EVIDENCE CLASS = STRUCTURAL + RECOMMENDATION. The orchestrator
                  comment is the load-bearing structural fact;
                  the path-by-path semantic analysis is the
                  recommendation. Foundation ACT freezes the
                  final semantic.

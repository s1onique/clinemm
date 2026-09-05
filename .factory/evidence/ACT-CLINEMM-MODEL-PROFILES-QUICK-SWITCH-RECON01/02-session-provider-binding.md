# 02 — Session Provider Binding (Q2 / §9)

This file answers ACT §9 "Q4: Session binding" and the reviewer Q2
"What object actually determines the next model request for an existing
session?" — i.e. not what Settings displays, not what `providers.json`
contains, but what the runtime reads before the next provider call.

PRODUCTION HEAD = 97f49582e

## The composition root

`apps/vscode/src/sdk/cline-session-factory.ts:buildSessionConfig(input)` —
`async`, returns `CoreSessionConfig`. This is the single place where the
"next session" is wired to a `(providerId, modelId, apiKey, baseUrl, …)`
tuple.

Resolution order (frozen):

1.  Read `apiConfig = StateManager.get().getApiConfiguration()`.
2.  Pick `modeProvider = mode === "plan" ? apiConfig.planModeApiProvider
    : apiConfig.actModeApiProvider`.
3.  `providerId = modeProvider ? toLegacyApiProvider(modeProvider) : undefined`.
4.  If `providerId`:
    -   `apiKey = resolveApiKey(providerId, apiConfig)`
    -   `modelId = resolveModelId(providerId, mode, apiConfig)`
    -   `baseUrl = resolveBaseUrl(providerId, apiConfig)`
    -   `apiLine = resolveApiLine(providerId, apiConfig)`
    -   Plus per-provider structured configs (bedrock, vertex, sap, ollama).
5.  If `!providerId`, fall back to SDK `ProviderSettingsManager
    .getLastUsedProviderSettings()` (single-pointer fallback).
6.  Defaults: `providerId ??= "cline"`; per-provider default model
    (`providerHasLocalModelSource` path) or catalog-derived fallback.

Result is fed into `CoreSessionConfig`:

```text
{
  providerId, modelId,
  apiKey, baseUrl,
  providerConfig: { providerId, modelId, apiKey, baseUrl, apiLine,
                    knownModels, maxOutputTokens, fetch },
  cwd, workspaceRoot, systemPrompt,
  enableTools, enableSpawnAgent, enableAgentTeams,
  mode: "plan" | "act",
  reasoning: { thinking, reasoningEffort },
  ...
}
```

## What this means at runtime

The runtime reads `session.config.{providerId,modelId,apiKey,baseUrl,headers,
providerConfig,reasoningEffort,thinkingBudgetTokens,thinking}` directly
when it builds a model handler for the NEXT request. There is NO
re-resolution of "current provider from globalState" mid-session — the
runtime trusts the snapshot in `session.config`.

## Freeze — session binding

```text
SESSION_BINDING_SOURCE            = buildSessionConfig at session start
                                    (snapshot of mode's providerId + modelId
                                     + per-mode legacy fields + providers.json fallback)
SESSION_BINDING_REFRESH_BOUNDARY  = NEXT_SESSION (rebuilt on session start
                                                or session restart)
INFLIGHT_REQUEST_AUTHORITY        = session.config snapshot
                                    (mutated only by updateConnection,
                                     which applies to SUBSEQUENT runs)
```

## Where the "current selection" comes from when NO active session

`StateManager.getApiConfiguration()` → `planModeApiProvider` /
`actModeApiProvider` legacy keys. No active-session fallback
(`getSessionProviderId` returns `undefined` for unknown sessionId).

## In-flight safety (ACT §11 Q6)

`SessionRuntime.updateConnection(overrides)` at
`sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:558`
does:

```text
const next = { ...this.config }
if (updates.providerId !== undefined) next.providerId = updates.providerId
if (updates.modelId !== undefined)    next.modelId    = updates.modelId
...
this.config = next
```

The leading doc comment (orchestrator.ts:556) reads:
> "Mutate provider / reasoning fields for subsequent runs."

So updates apply to the NEXT agentic run, never to a request already
streamed. This matches the "NEVER MUTATE_CURRENT_REQUEST" guarantee
required by §11.

There is **no guard** in `updateConnection` that would reject an
update when a request is currently in-flight. The safety is purely
"subsequent runs only" — i.e. trust the queue model. A buggy caller
that updated `providerId` mid-stream would not see the change apply
until the stream finishes, but a buggy caller that wrote a completely
broken config would still flow through to the next model call. This
is a known property, not a bug, and is acceptable for the Model
Profile use case (a profile is a deterministic `(providerId, modelId)`
tuple — there is no half-applied state).

## Why the session is the right granularity for quick-switch

A "Model Profile" applied to the active session needs to write at least
`planModeApiProvider` + `actModeApiProvider` + the per-mode model id.
`ProviderConfigStore.commitSelection` already does that write atomically
AND emits `kind: "selection"` to the live session via
`handleProviderConfigChange`, which (when the new selection is for the
same provider as the active one) routes through
`sdkHost.updateSessionModel` → `SessionRuntime.updateConnection` →
"subsequent runs". That is the in-place path.

When the new selection is for a DIFFERENT provider, the SAME commit
also flips the legacy `planModeApiProvider`/`actModeApiProvider`
(commitModelSelection.ts:38), which triggers
`handleApiConfigurationChanged` → `SdkProviderChangeCoordinator` →
session restart (`sessions.replaceActiveSession`). That is the
restart path.

So both paths already exist and are exercised by the existing
Settings → commitModelSelection → state flow.

EVIDENCE CLASS = STRUCTURAL (composition root + orchestrator code).
                 Implications column is INFERRED from signatures,
                 not from a live click trace. The "in-flight safety"
                 property is sourced from the orchestrator comment
                 and is not load-tested in this ACT.

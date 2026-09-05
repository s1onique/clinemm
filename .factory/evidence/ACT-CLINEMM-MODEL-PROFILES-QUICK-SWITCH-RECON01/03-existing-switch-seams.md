# 03 — Existing Live Switch Seams (Q5 / §10)

This file answers ACT §10 "Q5: Existing live model-switch seam" and
the reviewer Q3 "Does a genuine current-session switching seam already
exist?" using the §10 standard the reviewer restated:

```text
CURRENT_SESSION_SWITCH_SEAM_EXISTS = YES  iff the chain is mechanically bound:

  user/session selection changes
    → session-owned effective config changes
    → old provider/runtime binding is invalidated or rebuilt
    → next model request consumes the new selection
    → UI projection converges
```

PRODUCTION HEAD = 97f49582e

## Surfaces surveyed

The following live switch triggers were traced:

| Trigger                           | Source                                                                                  | Effect                                                              |
|-----------------------------------|-----------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| Settings → change provider        | `handleModeFieldChange({plan,act}ModeApiProvider, …)` → `updateApiConfigurationProto`    | Restart session manager (whole new session)                         |
| Settings → change model (same P)  | `ProviderConfigStore.commitSelection` → `handleProviderConfigChange("selection")`         | In-place `updateSessionModel` (next run)                            |
| `commitModelSelection` RPC        | `apps/vscode/src/core/controller/models/commitModelSelection.ts`                         | Dual: writes state, then `handleApiConfigurationChanged` fires      |
| `toggleFavoriteModel` RPC         | `apps/vscode/src/core/controller/state/toggleFavoriteModel.ts`                           | Persists `favoritedModelIds: string[]`; does NOT touch session      |
| `updateApiConfigurationProto`     | `apps/vscode/src/core/controller/models/updateApiConfigurationProto.ts`                  | Direct state set; if provider changed → restart path                |
| ACP client-driven switch (upstream) | SDK runtime's `@cline/core` (per upstream README)                                        | Tear down session manager + re-resolve model on next prompt         |

## The two production seams

### Seam 1 — In-place model change (current provider preserved)

Code path:

```text
webview Settings → ModelPicker
   handleModeFieldChange(...)
   → handleFieldChange → updateApiConfigurationProto
   → StateManager.setApiConfiguration
   → stateManager change fires handleApiConfigurationChanged(prev, next)

# PLUS (when commitSelection is the entry point)
commitModelSelection (proto RPC)
   → ProviderConfigStore.commitSelection(providerId, mode, selection, …)
     [emits kind:"selection"]
   → SdkController.handleProviderConfigChange
     → if isSelectionForActiveModeProvider → sessions.updateActiveSessionModel(modelId)
       → sdkHost.updateSessionModel(sessionId, modelId)
         → LocalRuntimeHost.updateSessionConnection
           → session.config.modelId = …
           → session.agent.updateConnection(updates)
             → SessionRuntime.updateConnection
               → next.modelId = updates.modelId  // NEXT-RUN scope (comment line 556)
   → ALSO setGlobalStateBatch (planModeApiProvider, planModeXModelId, …)
   → flushPendingState
   → handleApiConfigurationChanged(prev, next)
     → if previousProvider === nextProvider → return (no-op)
       (when only model changed, planModeApiProvider didn't change)
```

Key files:

-   `apps/vscode/src/sdk/SdkController.ts:1867` `handleProviderConfigChange`
-   `apps/vscode/src/sdk/SdkController.ts:1880` `isSelectionForActiveModeProvider`
-   `apps/vscode/src/sdk/sdk-session-lifecycle.ts:211` `updateActiveSessionModel`
-   `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1682` `updateSessionModel`
-   `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1692` `updateSessionConnection`
-   `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:558` `updateConnection`

### Seam 2 — Provider-change → session restart

Code path:

```text
commitModelSelection OR updateApiConfigurationProto
   → handleApiConfigurationChanged(prev, next)
     → SdkProviderChangeCoordinator.handleApiConfigurationChanged
       → if previousProvider === nextProvider → return (no-op)
       → rebuilds.request("provider", restartActiveSessionForProviderChange)
         → sessions.replaceActiveSession({ startInput, disposeReason: "providerChange" })
```

Key files:

-   `apps/vscode/src/sdk/sdk-provider-change-coordinator.ts:43` `handleApiConfigurationChanged`
-   `apps/vscode/src/sdk/sdk-provider-change-coordinator.ts:69` `performRestartActiveSessionForProviderChange`
-   `apps/vscode/src/sdk/sdk-provider-change-coordinator.ts:84` `replaceActiveSession`

## §10 reviewer standard evaluation

| Step                                                                 | YES/NO | Evidence                                                                                  |
|----------------------------------------------------------------------|--------|-------------------------------------------------------------------------------------------|
| user/session selection changes → session-owned effective config changes | YES  | `commitSelection` writes both providers.json + legacy state-keys atomically                |
| old provider/runtime binding is invalidated or rebuilt                | YES  | if provider changed: full `replaceActiveSession`. If only model: `updateSessionConnection`|
| next model request consumes the new selection                         | YES  | Orchestrator comment: "Mutate provider / reasoning fields for subsequent runs"            |
| UI projection converges                                               | YES  | `commitModelSelection` calls `controller.postStateToWebview?.()` at the end               |

## Freeze — current-session switch seam

```text
CURRENT_SESSION_SWITCH_SEAM_EXISTS    = YES
SEAM                                 = apps/vscode/src/sdk/SdkController.ts:1867
                                       (handleProviderConfigChange → isSelectionForActiveModeProvider
                                        → sessions.updateActiveSessionModel)
                                       COMBINED WITH
                                       apps/vscode/src/sdk/sdk-provider-change-coordinator.ts:43
                                       (handleApiConfigurationChanged → rebuilds.request
                                        → replaceActiveSession)
SWITCH_REBUILDS_RUNTIME              = PARTIAL
                                       (model-only: in-place via updateConnection;
                                        provider-change: full session restart)
SWITCH_APPLIES_NEXT_REQUEST          = YES (both paths apply to the next agentic run;
                                              neither mutates an in-flight stream)
SWITCH_PERSISTS_GLOBAL_DEFAULT       = YES (commitModelSelection persists
                                              planModeApiProvider + actModeApiProvider +
                                              per-mode modelId + ModelInfo snapshot;
                                              effectively becomes the new global default
                                              because no other mechanism overrides it)
```

## Pre-existing closest-to-profiles concept

`favoritedModelIds: string[]` (`apps/vscode/src/shared/storage/state-keys.ts:74`)
— a flat list of favorited MODEL IDs (not provider+model combos, not
named profiles). Toggle via `toggleFavoriteModel` RPC. Renders in the
webview as a favorites-only filter in the picker (no separate
quick-switch affordance observed in the recon path). This is a SAVED
MODEL-ID list, not a SAVED PROFILE — a Model Profile would need both
`providerId` AND `modelId` plus optional overrides and an activation
semantic.

## Upstream ACP precedent (for context, NOT evidence)

Upstream ACP exposes provider/model selection from the client picker
that triggers session-manager tear-down + recreate-with-new-provider
+ re-resolve model selection on the next prompt. That is the upstream
shape that Seam 2 (provider-change restart) already implements, and
Seam 1 (model-only in-place) is the cheap path upstream doesn't have
because ACP rebuilds anyway.

## Implications for Model Profiles

1.  **Both seams already exist and are wired**. A Model Profile that
    commits `(providerId, modelId)` via `ProviderConfigStore
    .commitSelection` for the active mode will trigger the right seam
    automatically:
    -   Same provider → in-place model swap (cheap).
    -   Different provider → session restart (heavier but tested).

2.  **No new seam needs to be built**. The implementation ACT can
    add a `applyProfile(profileId)` RPC that translates a profile
    into N `commitSelection` calls (one per mode the profile covers)
    plus a `setGlobalStateBatch` for the active provider pointer.
    The downstream seams (in-place OR restart) are reused.

3.  **The "global default" semantics are an emergent property**: when
    the active session is gone (closed task), the next session reads
    `planModeApiProvider`/`actModeApiProvider` from state. A
    `lastUsedProfileId` pointer is the only thing missing to make
    resume semantics round-trip. (§15 already recommends
    `SESSION_LAST_PROFILE`.)

4.  **Profile metadata storage**: should mirror the
    `StoredProviderModes.voiceInput` pattern (currently in
    `providers.json`'s `modes` block) OR live in a new
    `profiles.json` next to it. The former piggybacks on existing
    loaders; the latter is cleaner but requires a new reader. F3B
    call: NOT yet recommended either way — this is an implementation
    ACT decision.

EVIDENCE CLASS = STRUCTURAL (full call-graph traced). The "applies to
                 next request" property is INFERRED from the
                 orchestrator source comment and the absence of any
                 in-flight guard. NOT_EXECUTED for a real click trace.

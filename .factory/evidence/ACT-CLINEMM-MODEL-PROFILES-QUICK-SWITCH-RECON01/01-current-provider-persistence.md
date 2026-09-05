# 01 — Current Provider Persistence (Q1)

This file answers ACT §6: "What is persisted today when the user changes
provider/model?" It traces the full chain and freezes the authority split.

PRODUCTION HEAD = 97f49582e

## Two parallel stores

Two on-disk stores carry provider+model state. They do not overlap cleanly.

### Store A — `providers.json` (SDK-native, file-backed JSON)

-   Path: `<dataDir>/settings/providers.json` (`mode 0o600`).
    (`apps/vscode/src/sdk/provider-migration.ts:61`)
-   Owner: `@cline/core` `ProviderSettingsManager`
    (`sdk/packages/core/src/services/storage/provider-settings-manager.ts`).
-   Schema (frozen, load-bearing):
    `StoredProviderSettings.providers: Record<string, StoredProviderSettingsEntry>` —
    i.e. **at most ONE entry per providerId** (`sdk/packages/core/src/types/provider-settings.ts:46`).
-   Each entry:
    `{ settings: ProviderSettings, updatedAt: string, tokenSource: "manual" | "oauth" | "migration" }`.
-   `StoredProviderSettings.lastUsedProvider?: string` — a single providerId,
    not a per-mode field.
-   `StoredProviderSettings.modes: StoredProviderModes` —
    currently `{ voiceInput?: { providerId, modelId } }` only.
    No active-mode provider model fields live here yet.
-   `saveProviderSettings(settings, { setLastUsed, tokenSource })` ALWAYS
    overwrites the entry under `settings.provider` and either bumps
    `lastUsedProvider` to that id (default) or keeps the previous one.
    There is no concept of "instance id" or "named config under same providerId".

### Store B — `globalState.json` + `secrets.json` (legacy, mirrored)

-   Owner: `apps/vscode/src/core/storage/StateManager` →
    `apps/vscode/src/shared/storage/state-keys.ts`.
-   Carries:
    -   Per-mode provider id (TWO legacy fields):
        `planModeApiProvider: ApiProvider` and `actModeApiProvider: ApiProvider`.
        (`apps/vscode/src/shared/storage/state-keys.ts:246-253`)
    -   Per-mode model id (TWO per provider × 30+ providers): e.g.
        `planModeOpenRouterModelId`, `actModeOpenRouterModelId`,
        `planModeOpenAiModelId`, `planModeClineModelId`, etc.
        The full list lives in `PROVIDER_MODEL_ID_MAP`
        (`apps/vscode/src/sdk/cline-session-factory.ts:~389`).
    -   Per-mode `*ModelInfo` snapshots: per-mode blobs of model metadata
        (context window, max tokens, capability flags). The full list lives in
        `modelInfoKeysByProvider` (`apps/vscode/src/sdk/model-catalog/store.ts:~110`).
    -   Per-provider API key, base URL, API line, headers, region, OAuth auth
        (mirrored BOTH to legacy state-keys AND to `providers.json` by
        `ProviderConfigStore.write`).
        See `providerConfigStateKeys` table in
        `apps/vscode/src/sdk/model-catalog/store.ts` for the full mirror map.
    -   Per-mode reasoning effort, verbosity, thinking budget, etc.

### Bridge between A and B

-   `ProviderConfigStore.write(providerId, patch)`
    (`apps/vscode/src/sdk/model-catalog/store.ts:921`) does BOTH:
    1. `writeStateFields(providerId, patch)` — writes to legacy state-keys.
    2. `writeProviderSettingsFields(providerId, patch)` — writes to `providers.json`.
-   The `ProviderConfigStore.commitSelection(providerId, mode, selection, …)`
    variant (`store.ts:928`) writes the selection BOTH to providers.json
    (model + overrides) AND to legacy state-keys (per-mode modelId +
    per-mode ModelInfo snapshot).
-   Net effect: any per-provider config patch flows into BOTH stores atomically.
    "Last writer wins" — they never disagree after a successful
    commitSelection/write.

## Freeze — persisted authority

```text
CURRENT_PROVIDER_SETTINGS_OWNER         = @cline/core ProviderSettingsManager (providers.json)
CURRENT_MODEL_SELECTION_OWNER           = ProviderConfigStore.commitSelection (dual write)
CURRENT_GLOBAL_DEFAULT_SELECTION_OWNER  = StateManager.{planMode,actMode}ApiProvider
                                          + ProviderConfigStore.commitSelection

PROVIDERS_JSON_ROLE                     = SETTINGS_BY_PROVIDER  (one entry per providerId)
LAST_USED_PROVIDER_ROLE                 = POINTER  (single string in providers.json)
LAST_USED_MODEL_ROLE                    = PER_MODE (planModeXModelId / actModeXModelId
                                                    + planModeXModelInfo / actModeXModelInfo)
```

## Freeze — coexistence

```text
CAN_EXISTING_PROVIDER_CONFIGURATIONS_ALREADY_COEXIST =
  YES (different providerIds) | NO (same providerId, different credentials/baseUrl)

# Verified by reading:
#   sdk/packages/core/src/types/provider-settings.ts:46
#     providers: Record<string, StoredProviderSettingsEntry>
#   sdk/packages/core/src/services/storage/provider-settings-manager.ts:150
#     const previousEntry = previous.providers[providerId];
#     providers: { ...previous.providers, [providerId]: { ... } }   // overwrite
```

## Implications for Model Profiles

1. **Profiles cannot currently store alternative credentials for the SAME
   provider under different keys**. `Record<providerId, Entry>` is flat.
   Adding a second Claude key under "anthropic" requires either:
   (a) Adding a profile-instance key into the `StoredProviderSettingsEntry`
       (renames every reader), or
   (b) Introducing a parallel `profiles.json` keyed by profileId that
       REFERENCES `providerId` and overrides only the fields a profile
       legitimately owns (modelId, baseUrl, apiLine, headers, etc.) while
       always reading credentials from the live providers.json entry.

2. **Profiles must reference, not duplicate, credentials**. The current
   architecture has exactly one OAuth/access-token slot per providerId.
   A profile that holds a raw apiKey violates §13 PROFILE_CONTAINS_RAW_SECRET=NO.

3. **A profile's "active selection" must be representable as
   `(providerId, modelId)`**. Both fields are already the unit of
   `ProviderConfigStore.commitSelection`. The simplest faithful
   representation is therefore a `(providerId, modelId)` pair plus
   optional per-mode overrides (reasoning effort, verbosity, thinking
   budget — already mirrored via the same commitSelection path).

4. **Cross-mode profile binding is a NEW shape**. Today planModeApiProvider
   and actModeApiProvider are independent (driven by `planActSeparateModelsSetting`).
   A "Profile = (plan-providerId, plan-modelId, act-providerId, act-modelId,
   optional override fields)" is the most faithful multi-mode shape but
   MUST be opt-in — existing users with separateModelsSetting=true will
   treat the profile as a binding layer rather than a replacement.

5. **Legacy mirror residue is real**: 100+ legacy per-mode model id /
   per-mode ModelInfo keys persist alongside the SDK `providers.json`.
   The mirror is maintained by `ProviderConfigStore.write` and
   `commitSelection` but is an F3B-style "architectural tax" — a profile
   abstraction can choose to ignore it (treat it as a projection detail)
   or fold it (one round of cleanup). Folding it would be a Factorize
   step (out of scope for this ACT).

EVIDENCE CLASS = STRUCTURAL (file-backed store layout, signature, and
                 commitSelection write logic). NOT_EXECUTED for any
                 runtime user click. The implication column is
                 INFERRED from the signatures, not from a live trace.

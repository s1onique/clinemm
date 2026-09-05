# 01 — Production chain: file-by-file authority + reader/writer map

Recon-mapped the entire F3 surface. All file paths are absolute, line
references are at PRODUCTION_HEAD = `e06af528522ae2aa471aac9eed30acb51e9fdf92`
(= F1 closure, unchanged by F2; F3 recon does not modify production).

## A. Persistent stores (the durable layer)

| Store | File | Owner | Format |
|-------|------|-------|--------|
| `globalState.json` | `<dataDir>/globalState.json` | `StateManager` (host) | flat key/value |
| `secrets.json` | `<dataDir>/secrets.json` | `StateManager` (host) | flat key/value |
| `providers.json` | `<dataDir>/settings/providers.json` | `ProviderSettingsManager` (`@cline/core`) | structured (per-provider) |
| `taskHistory.json` | `<dataDir>/state/taskHistory.json` | `legacy-state-reader` (host) | flat array |
| per-task `<id>/api_conversation_history.json` | `<dataDir>/tasks/<id>/` | `legacy-state-reader` (host) | per-task |
| per-task `<id>/ui_messages.json` | `<dataDir>/tasks/<id>/` | `legacy-state-reader` (host) | per-task |
| per-task `<id>/context_history.json` | `<dataDir>/tasks/<id>/` | `legacy-state-reader` (host) | per-task |
| per-task `<id>/task_metadata.json` | `<dataDir>/tasks/<id>/` | `legacy-state-reader` (host) | per-task |
| `cline_mcp_settings.json` | `<dataDir>/settings/cline_mcp_settings.json` | `legacy-state-reader` (host) | MCP server settings |

`dataDir` resolution: `apps/vscode/src/sdk/legacy-state-reader.ts:26`
→ `@shared/storage/storage-context.ts:resolveDataDirFromEnv()`
which checks `CLINE_DATA_DIR` > `CLINE_DIR+"/data"` > `~/.cline/data`.

## B. Provider-side readers/writers

### B.1 `apps/vscode/src/sdk/provider-migration.ts` (112 LOC, host adapter)

```text
export function migrateProviders(dataDir?: string): ProviderMigrationResult
export function getProviderSettingsManager(dataDir?: string): ProviderSettingsManager
```

- `migrateProviders` is **DEAD CODE in the host layer**: it is exported
  but never called outside the file itself and its own test file
  (verified by grep across `apps/vscode/src` and the SDK packages).
  The actual migration trigger is `ProviderSettingsManager`'s
  constructor in `@cline/core`, which calls
  `migrateLegacyProviderSettings` automatically.
- `getProviderSettingsManager` is a **per-dataDir cached singleton**
  wrapper over `@cline/core`'s `ProviderSettingsManager`. Caches
  `_cachedManager + _cachedDataDir`. Constructing a fresh one
  triggers the auto-migration side effect, so caching is required to
  avoid re-running the migration on every call.

### B.2 `sdk/packages/core/src/services/storage/provider-settings-manager.ts` (SDK)

Owns:
- `providers.json` persistence (atomic write-then-rename)
- `getProviderSettings(providerId)` / `setProviderSettings(...)` /
  `saveProviderSettings(...)` / `getLastUsedProviderSettings(...)`
- On construction: `migrateLegacyProviderSettings(...)` reads
  `globalState.json` + `secrets.json` and writes `providers.json`
  (idempotent; never overwrites existing entries; tags migrated
  entries with `tokenSource: "migration"`).
- `getLastUsedProviderSettings` is the SDK's internal notion of
  "which provider was active most recently". Persisted in
  `providers.json` (state.lastUsedProvider field).

### B.3 `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts` (SDK)

The actual migration logic. Maps ~30 provider fields from
`globalState.json` / `secrets.json` into the structured
`ProviderSettings` shape that `providers.json` holds. **UPSTREAM_OWNED**:
lives in `@cline/core`, not in the host layer.

## C. Session-side builders (the consumers)

### C.1 `apps/vscode/src/sdk/model-catalog/store.ts` (1238 LOC effective)

The canonical bridged store: every `write` writes BOTH
`StateManager` (legacy fields) AND `providers.json` (SDK fields),
and every `read` reads from BOTH and combines.

```text
export function createProviderConfigStore(): ProviderConfigStore
export function resolveRuntimeModelSelection(providerId, modelId): ResolvedModelSelection
```

- `ProviderConfigStore` shape (from `model-catalog/contracts.ts`):
  - `read(providerId): EffectiveProviderConfig`
  - `readSelection(providerId, mode): ResolvedModelSelection | undefined`
  - `subscribe(listener): Disposable`
  - `write(providerId, patch): EffectiveProviderConfig`
  - `commitSelection(providerId, mode, selection, baseModelInfoHint?): void`
- `read()` calls `buildEffectiveProviderConfig(providerId)` (in
  `effective-config.ts`).
- `write()` calls `writeStateFields(providerId, patch)` AND
  `writeProviderSettingsFields(providerId, patch)` — the dual-write
  bridge.
- `commitSelection()` calls `writeSelectionToProviderSettings(...)` +
  `writeModelOverrides(...)` + `writeSelectionToState(...)` — also
  a dual-write (selection persists in both stores).

### C.2 `apps/vscode/src/sdk/model-catalog/effective-config.ts` (403 LOC)

Defines `buildEffectiveProviderConfig(providerId)`:
- Reads from `getProviderSettingsManager().getProviderSettings(toSdkProviderId(providerId))`
  (line 204) — SDK store
- ALSO reads from `StateManager.get().getApiConfiguration()` (via
  the maps `apiKeyFields`, `baseUrlFields`, etc.) — legacy store
- Combines both into `EffectiveProviderConfig`

The combination logic is `for each provider field, prefer
providers.json value if present, else fall back to legacy
ApiConfiguration value`. So **`providers.json` is PRIMARY**,
legacy `ApiConfiguration` is **FALLBACK** when constructing
`EffectiveProviderConfig`.

### C.3 `apps/vscode/src/sdk/cline-session-factory.ts` (1238 LOC, hot path)

The biggest single file. Multiple effective-config consumers:

1. `buildSessionConfig()` (line 791+): assembles `CoreSessionConfig`.
   - **StateManager PRIMARY** (line 817: `stateManager.getApiConfiguration()`)
   - Falls back to `ProviderSettingsManager.getLastUsedProviderSettings()`
     **only** when StateManager returned no provider at all (line 869-894:
     "Fallback: try SDK's ProviderSettingsManager only when StateManager did not
     resolve a provider at all")
   - Also calls `resolveApiKey(providerId, config)` (line 490+) which has its
     own internal primary/fallback ordering per provider type
   - Also calls `resolveModelId(...)`, `resolveBaseUrl(...)`,
     `resolveApiLine(...)` — all read from `config: ApiConfiguration`
     (i.e. StateManager)
   - Also calls `getProviderSettingsManager()` at lines 623 (vertex region),
     660 (ollama contextWindow), 758 (apiLine), 906 (modelId) — these are
     **direct SDK-store reads** that BYPASS the canonical
     `ProviderConfigStore.read()` and re-read `providers.json` directly.
   - Also writes at line 234: `manager.saveProviderSettings(...)` — direct
     SDK-store write that BYPASSES the canonical
     `ProviderConfigStore.write()`.

2. `resolveApiKey()` (line 490-540): reads config first, then
   ProviderSettingsManager if no key in config. **Config PRIMARY,
   SDK store FALLBACK.** Note: this ordering is the **opposite** of
   `buildEffectiveProviderConfig`.

3. `resolveOllamaContextWindow` (in `host-overrides.ts:resolveOllamaContextWindow`)
   has yet another ordering: **SDK store PRIMARY, StateManager
   FALLBACK.** Comment in source: "providers.json (`contextWindow`)
   is the source of truth; the legacy StateManager string is a
   migration fallback."

**Three different precedence orderings** exist for the same logical
field depending on which code path reads it.

### C.4 `apps/vscode/src/sdk/legacy-state-reader.ts` (308 LOC, host adapter)

Reads pre-SDK storage from disk:
- `readGlobalState(dataDir?)` / `readGlobalStateKey(key, dataDir?)`
- `readSecrets(dataDir?)` / `readSecretKey(key, dataDir?)`
- `readTaskHistory(dataDir?)` → `HistoryItem[]`
- `deleteLegacyTask(taskId, dataDir?)` → boolean
- `readApiConversationHistory(taskId, dataDir?)` → `Anthropic.MessageParam[]`
- `readUiMessages(taskId, dataDir?)` → `ClineMessage[]`
- `readContextHistory(taskId, dataDir?)` → `unknown[]`
- `readTaskMetadata(taskId, dataDir?)` → `Record<string, unknown>`
- `readMcpSettings(dataDir?)` → `McpSettingsFile`
- `listTaskIds(dataDir?)` → `string[]`
- `readAllLegacyState(dataDir?)` → `LegacyState`
- `resolveDataDir(override?)` → `string`
- `taskDirPath(taskId, dataDir?)` → `string`

All reads are non-throwing. `readJsonFile<T>` returns fallback on
any error (missing file, empty content, JSON parse error).

`resolveDataDir` is the single canonical dataDir resolver used by
**all** of `apps/vscode/src/sdk` and matches `@cline/shared`'s
`resolveDataDirFromEnv()` (per the comment in
`shared/storage/storage-context.ts:87`).

## D. Call sites (Phase 1 reader/writer trace)

### D.1 StateManager.getApiConfiguration() in sdk/

| Site | Reads what | Purpose |
|------|-----------|---------|
| `cline-session-factory.ts:817` | full `ApiConfiguration` | `buildSessionConfig` PRIMARY |
| `cline-session-factory.ts:656` (referenced in comment) | ollamaApiOptionsCtxNum | comment-only ("migration fallback") |
| `model-catalog/store.ts:839, 848` | full `ApiConfiguration` | `readSelectionFromState`, `migrateLegacyModelOverridesIfNeeded` |
| `model-catalog/store.ts:873` | `planModeApiProvider`/`actModeApiProvider` | "active provider" selector |
| `SdkController.ts:1897` | full `ApiConfiguration` | (out of F3 scope — already-built session consumption) |
| `SdkController.ts:2549` | full `ApiConfiguration` | (out of F3 scope) |
| `auth-service.ts:1149` | full `ApiConfiguration` | (out of F3 scope — auth refresh) |
| `sdk-session-event-coordinator.ts:423, 458` | full `ApiConfiguration` | (out of F3 scope — telemetry) |

### D.2 getProviderSettingsManager() in apps/vscode/src (non-test)

| Site | Reads what | Purpose |
|------|-----------|---------|
| `cline-session-factory.ts:223` | (via manager) | (during resolveApiKey) |
| `cline-session-factory.ts:504` | `providerSettingsProviderId(providerId)` | `resolveApiKey` SDK fallback |
| `cline-session-factory.ts:530` | same | `resolveApiKey` SDK fallback (non-auth path) |
| `cline-session-factory.ts:623` | vertex provider settings | `resolveVertexProviderConfig` |
| `cline-session-factory.ts:660` | ollama contextWindow | `resolveOllamaProviderConfig` direct read |
| `cline-session-factory.ts:709` | (via manager) | `buildSessionConfig` final block |
| `cline-session-factory.ts:758` | provider settings.apiLine | `resolveApiLine` direct read |
| `cline-session-factory.ts:876` | `getLastUsedProviderSettings` | `buildSessionConfig` PRIMARY fallback |
| `cline-session-factory.ts:906` | provider settings.model | `buildSessionConfig` final modelId resolution |
| `cline-session-factory.ts:1000` | (via manager) | (during resolveFinalModelId) |
| `model-catalog/effective-config.ts:204` | per-provider settings | `buildEffectiveProviderConfig` PRIMARY source |
| `model-catalog/store.ts:220` | (via manager) | `readModelsRegistryPath` |
| `model-catalog/store.ts:319` | (via manager) | `resolveModelsRegistryPath` |
| `model-catalog/store.ts:564` | per-provider settings | `getProviderSettings` helper |
| `model-catalog/store.ts:570` | writes via manager | `saveProviderSettings` direct write |
| `model-catalog/catalog.ts:199` | per-provider listing | `listSdkProviderListings` |
| `model-catalog/host-overrides.ts:31` | ollama contextWindow | `resolveOllamaContextWindow` PRIMARY source |
| `auth-service.ts:118, 160, 218, 800, 827` | cline/openai-codex provider settings | SDK OAuth token storage |
| `integrations/openai-codex/oauth.ts:58` | openai-codex provider settings | OAuth token persistence |

Total: ~22 production call sites read `getProviderSettingsManager()`
directly (not through `createProviderConfigStore.read()`).

### D.3 createProviderConfigStore() / ProviderConfigStore.* in sdk/

| Site | Operation | Purpose |
|------|-----------|---------|
| `SdkController.ts:735` | stored as `this.providerConfigStore` | central ownership |
| `SdkController.ts:872` | `createProviderConfigStore()` | ctor |
| `SdkController.ts:874` | `subscribe(...)` | event wiring |
| `SdkController.ts:1828` | getter | public API |
| `SdkController.ts:1852` | `read(providerId)` | gRPC handler |
| `SdkController.ts:1854` | `readSelection(providerId, mode)` | gRPC handler |
| `SdkController.ts:2153` | `dispose()` | teardown |
| `SdkController.ts:3715` | `read(providerId).apiKey` | gRPC handler |
| `SdkController.ts:3722` | `write(providerId, { apiKey })` | gRPC handler |
| `cline-session-factory.ts:353` | `readSelection(parsedProviderId, mode)` | (during init) |

Total: 10 production call sites use the canonical store. ~22 sites
bypass it.

### D.4 legacy-state-reader non-task readers

| Site | Purpose |
|------|---------|
| `core/storage/state-migrations.ts` (lines 4, etc.) | `readGlobalState` + `readSecrets` for workspace→global migration |
| `shared/storage/storage-context.ts:87` (comment) | documentation reference |
| `sdk/provider-migration.ts:17` | `resolveDataDir` only |

Outside of `state-migrations.ts`, `legacy-state-reader`'s only
non-task consumer is `resolveDataDir` (path helper, no state read).

## E. Migration bridge classification (preliminary)

| Bridge | Site | Status |
|--------|------|--------|
| workspace → global storage | `core/storage/state-migrations.ts:migrateWorkspaceToGlobalStorage` | **LIVE_LOAD_BEARING** (runs at extension startup) |
| globalState.json + secrets.json → providers.json | `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts:migrateLegacyProviderSettings` | **IDEMPOTENT_ONE_SHOT** (runs once when `providers.json` doesn't yet exist; never overwrites) |
| host adapter `migrateProviders()` | `apps/vscode/src/sdk/provider-migration.ts:migrateProviders` | **DEAD_CODE** (exported but never called outside test) |
| pre-SDK tasks → SDK session | `sdk/sdk-task-history.ts:13` (`readTaskHistory` + `legacy-task-handling.ts:legacyApiHistoryToSdkMessages`) | **LIVE_LOAD_BEARING** (runs every session resume) |
| `store.ts > write()` fans out to both stores | `model-catalog/store.ts:write()` | **LIVE_LOAD_BEARING** (single-source-of-truth write path) |

## F. Findings summary (Phase 1 conclusion)

1. **DUAL PERSISTENCE**: `providers.json` (SDK) + `globalState.json` +
   `secrets.json` (legacy) both hold provider config; `store.ts > write()`
   is the single fan-out point that keeps them synchronized.

2. **TRIPLE READER PATTERN**: three different precedence orderings
   exist for the same logical field:
   - `effective-config.ts`: providers.json PRIMARY, legacy FALLBACK
   - `cline-session-factory.ts > buildSessionConfig` (provider-id level):
     StateManager PRIMARY, providers.json FALLBACK
   - `cline-session-factory.ts > resolveApiKey` (per-field level):
     ApiConfiguration PRIMARY, providers.json FALLBACK
   - `host-overrides.ts > resolveOllamaContextWindow`: providers.json
     PRIMARY, legacy FALLBACK

3. **BYPASS SITES**: ~22 sites read `providers.json` directly
   (bypassing `ProviderConfigStore.read()`); ~10 sites use the canonical
   store. The bypass sites pre-date `ProviderConfigStore`'s introduction.

4. **ONE DEAD BRIDGE**: `apps/vscode/src/sdk/provider-migration.ts:migrateProviders`
   is exported but never called outside the file itself and its test.

5. **THREE LOAD-BEARING BRIDGES**:
   - `state-migrations.ts` (workspace→global)
   - `migrateLegacyProviderSettings` (globalState→providers.json)
   - `store.ts > write()` (single-write fan-out)
   - `sdk-task-history.ts` (pre-SDK tasks)

End Phase 1. Continue to Phase 2 (precedence-ordering evaluation) in `02-authority-and-trust-boundaries.md`.

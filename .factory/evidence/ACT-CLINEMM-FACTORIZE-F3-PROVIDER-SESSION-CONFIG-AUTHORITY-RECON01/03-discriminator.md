# 03 — Discriminator evaluation

Phase 3 (legacy-bridge classification) and Phase 4 (discriminator freeze)
combined. The discriminator verdicts derive directly from the Phase 1
file map (01-production-chain.md) and the Phase 2 trust-boundary
analysis (02-authority-and-trust-boundaries.md).

## A. Legacy-bridge classification (Phase 3)

| Bridge | Site | Status | Notes |
|--------|------|--------|-------|
| workspace → global storage | `core/storage/state-migrations.ts:migrateWorkspaceToGlobalStorage` | **LIVE_LOAD_BEARING** | Runs at extension startup; copies ~30 keys. Cannot delete without breaking workspace→global upgrade path for users on multi-root setups. |
| globalState.json + secrets.json → providers.json | `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts:migrateLegacyProviderSettings` | **IDEMPOTENT_ONE_SHOT** (UPSTREAM_OWNED) | Runs once per dataDir; never overwrites. Lives in `@cline/core`, so it's NOT in F3's host-layer scope. |
| host adapter `migrateProviders()` | `apps/vscode/src/sdk/provider-migration.ts:migrateProviders` | **DEAD_CODE** | Exported but never called outside its own file + test. Safe to delete. |
| pre-SDK tasks → SDK session | `sdk/sdk-task-history.ts` + `legacy-task-handling.ts` | **LIVE_LOAD_BEARING** | Runs every session resume from a legacy task. Cannot delete without breaking historical task replay. |
| `store.ts > write()` fan-out | `model-catalog/store.ts:write()` | **LIVE_LOAD_BEARING** | Single-source-of-truth write path. Cannot simplify without re-introducing drift risk. |

## B. Discriminator verdicts (Phase 4)

### D1. SINGLE_PERSISTED_AUTHORITY

**Verdict: NO**

Two persistent stores both hold provider configuration:
- `providers.json` (canonical, owned by `@cline/core`)
- `globalState.json` + `secrets.json` (legacy, owned by host `StateManager`)

The two are kept in sync via the `store.write()` dual-write bridge,
but they are *two* files, not *one*. The migration bridge
(`migrateLegacyProviderSettings`) is idempotent and only populates
`providers.json` from legacy on first run.

This is a transitional state: the SDK is the *future* single
authority, but the host hasn't retired the legacy fields yet because
`ApiConfiguration` is still the type most of the webview and
telemetry layer reads.

### D2. MULTIPLE_EFFECTIVE_CONFIG_DERIVATIONS

**Verdict: YES**

Four sites derive effective config with three different precedence
orderings (see 02 §B.1). The canonical derivation lives in
`buildEffectiveProviderConfig` (providers.json PRIMARY), but the
factory's `buildSessionConfig` uses StateManager PRIMARY with
providers.json FALLBACK; `resolveApiKey` uses config PRIMARY with
providers.json FALLBACK; `resolveOllamaContextWindow` uses
providers.json PRIMARY with StateManager FALLBACK.

This is **MULTIPLE_VALUE_PRODUCERS** per §8. The discriminator
freeze recommendation is: consolidate to ONE canonical derivation
(`store.read()` returning `EffectiveProviderConfig`) and have all
hot-path consumers read from it. **This is the core F3 finding.**

### D3. LEGACY_STATE_STILL_LOAD_BEARING

**Verdict: YES (LIVE)**

Three load-bearing legacy bridges:
1. `state-migrations.ts:migrateWorkspaceToGlobalStorage` (workspace→global, runs at startup)
2. `migrateLegacyProviderSettings` (globalState→providers.json, runs once per dataDir)
3. `sdk-task-history.ts` + `legacy-task-handling.ts` (pre-SDK tasks→SDK session, runs at every resume from legacy)

Plus one DEAD bridge:
4. `apps/vscode/src/sdk/provider-migration.ts:migrateProviders` (exported but never called)

The DEAD bridge is a candidate for **Outcome A** (delete obsolete
compatibility bridge). The LIVE bridges are required for as long as
any user has pre-SDK state on disk.

### D4. SESSION_FACTORY_OWNS_POLICY

**Verdict: NO**

`cline-session-factory.ts` does NOT own policy. It reads from both
stores, calls `ProviderConfigStore.read()` once, calls
`resolveApiKey`, `resolveModelId`, `resolveBaseUrl`, etc., and
assembles a `CoreSessionConfig`. The policy lives upstream in:

- `@cline/core > ClineCore > startSession` (decides whether to start, with what config)
- `@cline/core > SessionRuntime` (decides what tools to enable, how to compact)
- `model-catalog/store.ts` (decides how selection persists)

The factory is a **multi-source assembler**, not a policy owner.

### D5. SESSION_FACTORY_OWNS_TRANSPORT_ONLY

**Verdict: PARTIAL**

The factory owns:
- The `BedrockProviderConfig` / `SapProviderConfig` /
  `VertexProviderConfig` / `OllamaProviderConfig` *transport*
  configuration (region, profile, baseUrl, contextWindow)
- The decision of which provider-class transport to use
  (e.g. for `sapaicore`, it builds `SapProviderConfig` and uses its
  `baseUrl`)

But the factory does NOT own:
- The SDK message-protocol transport (handled by `@cline/core > SessionRuntime`)
- The HTTP-level retry / backoff / auth-header injection (handled by `@cline/llms` handlers)
- The OAuth refresh (handled by `@cline/core > auth-service`)

So it owns **transport configuration assembly** but not transport
itself. The factory is the bridge between the two stores and the
SDK's transport layer.

### D6. PROVIDERS_JSON_CANONICAL

**Verdict: YES (with caveats)**

`providers.json` is the documented canonical store. The migration
is one-way (legacy → providers.json, never the reverse). The SDK
treats it as the source of truth. The host reads it as PRIMARY in
`buildEffectiveProviderConfig` and in `resolveOllamaContextWindow`.

Caveats:
- `buildSessionConfig` treats `StateManager` as PRIMARY
  (incompatible with canonical role)
- The webview still reads from `ApiConfiguration` (legacy fields),
  so the UI may show a stale value if `providers.json` and legacy
  fields disagree

### D7. UPSTREAM_CORE_SETTINGS_SEAM_USABLE

**Verdict: YES (already in use)**

`@cline/core` already exports the settings seam:
- `CoreSessionConfig` (the assembled config the SDK accepts)
- `splitCoreSessionConfig` (helper to split into sub-configs)
- `resolveProviderApiKeyFromSettings` (helper to resolve credentials)
- `ProviderSettingsManager` (canonical provider settings reader/writer)

The host uses all of these. There's no missing facility in
`@cline/core` that the host has to invent.

### D8. MODEL_PROFILES_BLOCKED_BY_MIGRATION

**Verdict: NO**

Model Profiles require the ability to:
1. Save multiple named provider/model configurations
2. Switch between them at session start
3. Display the active profile in the UI
4. Persist the active profile selection

None of these are blocked by the migration:
1. `providers.json` is per-provider but the top-level state already
   tracks `lastUsedProvider`. Adding `lastUsedProfile` (or moving to
   a profile-keyed structure) is mechanical.
2. `store.readSelection(providerId, mode)` already returns a
   `ResolvedModelSelection` that includes `providerId + modelId`.
   Switching providers is already a thing; switching profiles would
   just be a different `commitSelection`.
3. The webview already shows the active provider/model; adding a
   profile chip is a UI change, not a seam change.
4. Persisting the active profile is a `setLastUsedProvider` analogue.

The recon conclusion: **Model Profiles is a feature addition, not a
seam unblocker.** The seam is ready; what blocks Model Profiles is
product scope (when to ship, what to call them), not architecture.

## C. Discriminator summary table (frozen)

```
SINGLE_PERSISTED_AUTHORITY            = NO    (two stores: providers.json + globalState.json+secrets.json)
MULTIPLE_EFFECTIVE_CONFIG_DERIVATIONS = YES   (4 sites, 3 precedence orderings)
LEGACY_STATE_STILL_LOAD_BEARING       = YES   (3 LIVE bridges + 1 DEAD bridge)
SESSION_FACTORY_OWNS_POLICY           = NO    (factory is multi-source assembler)
SESSION_FACTORY_OWNS_TRANSPORT_ONLY   = PARTIAL (owns transport config, not transport itself)
PROVIDERS_JSON_CANONICAL              = YES   (with caveats — see D6)
UPSTREAM_CORE_SETTINGS_SEAM_USABLE    = YES   (already in use; no missing facility)
MODEL_PROFILES_BLOCKED_BY_MIGRATION   = NO    (seam ready; gating is product scope)

SELECTED_OUTCOME = B
```

## D. Outcome selection rationale

Per §17, the four permitted outcomes are A, B, C, D.

**Why not A (delete obsolete bridge(s))?**

There IS one DEAD bridge (`migrateProviders()`) that could be
deleted as part of A. But A alone is too narrow: it doesn't address
the more important finding (D2: multiple effective-config
derivations).

**Why not C (migrate ownership toward @cline/core/@cline/llms)?**

C requires evidence that the current host layer duplicates
authority the SDK could own. The SDK already owns the canonical
store (`ProviderSettingsManager`) and exposes the read/write API;
the host's `model-catalog/store.ts` is a thin wrapper that adds
dual-write and event emission. There is no authority the SDK could
absorb from the host that wouldn't require the SDK to also absorb
the host's UI/RPC layer. C is the highest bar and recon does not
clear it.

**Why not D (PASS_F3_NO_FACTORIZATION_NEEDED)?**

D requires that no further consolidation would reduce complexity
without weakening the trust boundary. But D2 surfaces a real
read-side fragmentation that has measurable consequences
(ollama contextWindow divergence between picker and session).
That's a small but real bug, not just awkwardness.

**Why B (consolidate effective-config derivation)?**

D2 is the strongest finding. The fix is:
1. Route the 4 suspicious bypass sites in `cline-session-factory.ts`
   (lines 623 vertex, 660 ollama contextWindow, 758 apiLine,
   906 modelId) through `store.read()` instead of direct manager
   access.
2. This single change eliminates the ollama contextWindow
   precedence inversion (B.3 in 02) by making `store.read()` the
   authoritative derivation site.
3. Cost is small (~20 LOC of edits in one file). Risk is small
   because `store.read()` is already the documented canonical
   derivation.
4. This is *also* a partial Outcome A: deleting `migrateProviders()`
   can be folded in if it's a low-risk removal.

## E. Outcome B implementation outline (for the future production ACT)

The recon ACT does NOT include the production edit. If the
reviewer accepts Outcome B, the next ACT would be:

```text
ACT-CLINEMM-FACTORIZE-F3B-PROVIDER-SESSION-CONFIG-AUTHORITY-CONSOLIDATE01
   1. Replace direct getProviderSettingsManager() reads at
      cline-session-factory.ts:623, 660, 758, 906 with
      createProviderConfigStore().read(providerId) / .readSelection().
   2. Verify that buildSessionConfig, buildEffectiveProviderConfig,
      and the gRPC handlers all agree on the same field values.
   3. Remove apps/vscode/src/sdk/provider-migration.ts:migrateProviders
      (DEAD_CODE).
   4. Update tests:
      - cline-session-factory.test.ts: verify the ollama contextWindow
        fallback works after the change.
      - effective-config.test.ts: verify the precedence ordering is
        unchanged.
   5. Run `bun run test:unit` (per the F0 standard) and
      `git diff --check` to confirm hygiene.
```

This implementation outline is **NOT** part of F3 recon. It is the
hand-off to the next ACT if the reviewer accepts Outcome B.

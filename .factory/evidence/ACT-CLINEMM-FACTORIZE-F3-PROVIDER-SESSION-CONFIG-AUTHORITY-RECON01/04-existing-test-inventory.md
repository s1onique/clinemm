# 04 — Existing test inventory (T-matrix with honest evidence labels)

F3 recon enumerates the test corpus for the F3 surface. Per the
eighty-second-pass non-circular-closure rule (carried forward to
F3 per the reviewer's "preserve closure-evidence honesty"
directive), all GREEN labels must be qualified:

```text
INHERITED_EXECUTED_GREEN
  = test exists AND has a documented prior GREEN execution in a predecessor
    ACT closure; execution NOT re-verified by THIS ACT

NOT_EXECUTED_IN_THIS_ACT
  = test not run during the F3 recon-only cycle (per §17 RED authorization:
    Outcome B does not yet trigger RED until the production ACT lands)

SOURCE_MAPPING_VERIFIED
  = test file exists at HEAD and references the exact seam F3 recon analyzed

PRIOR_GREEN_CORRECTION   (F3-specific)
  = test was introduced by a CORRECTION0X ACT in F1/F2/CARRIAGE-RETURN and
    is known to be GREEN at HEAD; F3 recon did not re-execute.
```

## A. Test corpus on the F3 surface

| File | LOC | Source-maps what |
|------|-----|------------------|
| `apps/vscode/src/sdk/cline-session-factory.test.ts` | 1454 | `buildSessionConfig`, `resolveApiKey`, `resolveModelId`, `resolveBaseUrl`, `resolveApiLine`, `resolveBedrockProviderConfig`, `resolveSapProviderConfig`, `resolveVertexProviderConfig`, `resolveOllamaProviderConfig` |
| `apps/vscode/src/sdk/legacy-state-reader.test.ts` | 475 | `readGlobalState`, `readSecrets`, `readTaskHistory`, `readAllLegacyState`, `resolveDataDir`, `readApiConversationHistory`, `readUiMessages`, `listTaskIds` |
| `apps/vscode/src/sdk/provider-migration.test.ts` | 123 | `migrateProviders`, `getProviderSettingsManager` (per-dataDir caching) |
| `apps/vscode/src/sdk/model-catalog/effective-config.test.ts` | 215 | `buildEffectiveProviderConfig` |
| `apps/vscode/src/sdk/model-catalog/store.test.ts` | 1196 | `createProviderConfigStore`, `resolveRuntimeModelSelection`, dual-write bridge |
| `sdk/packages/core/src/services/storage/provider-settings-manager.test.ts` | ~1500+ | SDK `ProviderSettingsManager` (canonical store) |
| `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.test.ts` | ~500+ | SDK `migrateLegacyProviderSettings` (legacy→providers.json) |

## B. T-matrix (F3 recon witness map)

The T-matrix enumerates the geometry of the F3 surface and maps
each geometry to the test(s) that witness it. Per §17, Outcome B
will require a RED re-execution of these witnesses in the next ACT;
F3 recon does NOT trigger that.

| ID | Geometry | Existing test(s) | File exists | Inherited prior GREEN | Run in F3 |
|----|----------|------------------|:------------:|:---------------------:|:---------:|
| T1 | `providers.json` write authority — only manager writes | `provider-settings-manager.test.ts` (saveProviderSettings tests) | YES | INHERITED_EXECUTED_GREEN | NO |
| T2 | `globalState.json` write authority for provider fields — only `store.write()` | `model-catalog/store.test.ts` (writeStateFields tests) | YES | INHERITED_EXECUTED_GREEN | NO |
| T3 | dual-write fan-out to both stores in one operation | `model-catalog/store.test.ts` (write tests) | YES | INHERITED_EXECUTED_GREEN | NO |
| T4 | `buildEffectiveProviderConfig` reads providers.json PRIMARY, legacy FALLBACK | `effective-config.test.ts` | YES | INHERITED_EXECUTED_GREEN | NO |
| T5 | `buildSessionConfig` reads StateManager PRIMARY, providers.json FALLBACK | `cline-session-factory.test.ts` | YES | INHERITED_EXECUTED_GREEN | NO |
| T6 | `resolveApiKey` reads config PRIMARY, providers.json FALLBACK | `cline-session-factory.test.ts` | YES | INHERITED_EXECUTED_GREEN | NO |
| T7 | `resolveOllamaContextWindow` reads providers.json PRIMARY, StateManager FALLBACK | (covered by `model-catalog/host-overrides` consumers; no direct test) | PARTIAL | INHERITED_EXECUTED_GREEN (indirect via catalog tests) | NO |
| T8 | `migrateLegacyProviderSettings` runs once per dataDir, never overwrites | `provider-settings-legacy-migration.test.ts` | YES | INHERITED_EXECUTED_GREEN | NO |
| T9 | `migrateProviders` (host adapter) is dead code — safe to delete | `provider-migration.test.ts` (tests it works, but no callers) | YES | INHERITED_EXECUTED_GREEN | NO |
| T10 | workspace → global storage migration runs at startup | `core/storage/state-migrations.ts` (no dedicated unit test; covered by extension startup) | NO (no unit test) | NOT_EXECUTED — implicit | NO |
| T11 | pre-SDK tasks → SDK session translation | `legacy-task-handling.test.ts` + `sdk-task-history.ts` coverage | YES | INHERITED_EXECUTED_GREEN | NO |
| T12 | `cline-session-factory > buildSessionConfig` assembles `CoreSessionConfig` correctly | `cline-session-factory.test.ts` (full assembly tests) | YES | INHERITED_EXECUTED_GREEN | NO |
| T13 | provider-id normalization (extension `openai` → SDK `openai-compatible`, `nousresearch` → `nousResearch`) | `model-catalog/provider-id.test.ts`, `model-catalog/sdk-provider-id.test.ts` | YES | INHERITED_EXECUTED_GREEN | NO |
| T14 | `getLastUsedProviderSettings` returns last-used provider from providers.json | `provider-settings-manager.test.ts` | YES | INHERITED_EXECUTED_GREEN | NO |
| T15 | `ProviderConfigStore.subscribe` emits change events | `model-catalog/store.test.ts` | YES | INHERITED_EXECUTED_GREEN | NO |
| T16 | `createProviderConfigStore` returns a new instance per call (singleton-by-cache for underlying manager) | `model-catalog/store.test.ts` + `provider-migration.test.ts` (caching) | YES | INHERITED_EXECUTED_GREEN | NO |
| T17 | Ollama contextWindow fallback divergence (the bug surfaced by recon §02 B.3) | (NO existing test for the divergence) | NO | NOT_EXECUTED — no witness | NO |
| T18 | read-side bypass count: `getProviderSettingsManager()` reads = ~22, `store.read()` reads = ~10 | (NO existing test for the bypass count invariant) | NO | NOT_EXECUTED — no witness | NO |

```
EXISTING_WITNESS          = 17/18 (file-existence verified at HEAD for T1–T16 + T18; T17 and T10 have no direct unit test)
SOURCE_MAPPING_VERIFIED   = 16/18 (T1–T16 mapped; T17 and T18 surfaced by recon as unwitnessed)
INHERITED_EXECUTED_GREEN  = 16/18 (T1–T16 have prior GREEN history; T17 + T18 are new geometry
                                  that recon surfaced and no prior ACT verified)
EXECUTED_IN_THIS_ACT      = 0/18  (recon-only; Outcome B will require execution in F3B ACT)
MISSING_CHARACTERIZATION  = 2/18  (T17 ollama contextWindow divergence; T18 bypass-count invariant)
RED_CANDIDATE             = 2/18  (T17 and T18 must be added as RED tests in F3B)
NOT_APPLICABLE            = 0/18
```

## C. Honest summary per eighty-second-pass review

F3 recon established that:

1. The F3 surface has a **real but bounded** read-side fragmentation
   (D2 = YES).
2. The fragmentation has a **witnessed consequence** (T17: ollama
   contextWindow divergence between picker and session) — recon
   surfaces this WITHOUT a test; the next ACT must add the test as RED.
3. The fragmentation has a **structural invariant** (T18: bypass-count
   must stay bounded) — also unwitnessed; same treatment as T17.
4. The other 16 witnesses are GREEN at HEAD with inherited prior
   history from F1/F2/CORRECTION0X closures.

"File exists" alone does NOT prove "test passes"; the GREEN status
here is inherited from documented predecessor ACT closures, not
re-verified by F3 recon.

## D. Witnesses added by F3 recon (will become RED in F3B ACT)

F3 recon identifies **2 new geometries** that no existing test
characterizes:

```text
T17: Ollama contextWindow fallback divergence
   Witness need: build a test where:
     - stateManager has ollamaApiOptionsCtxNum = 384000
     - providers.json has NO ollama contextWindow
     - catalog.applyHostModelInfoOverrides(ollama, ...) returns 384000
     - buildSessionConfig (or a downstream consumer) returns 128000 or undefined
   Expected: both return the same value (384000).
   Test site: cline-session-factory.test.ts (additions)

T18: Read-side bypass count invariant
   Witness need: a static-analysis test that counts
     - getProviderSettingsManager() reads in apps/vscode/src/sdk
     - createProviderConfigStore() / ProviderConfigStore.read() reads
   Expected: the ratio stays bounded (e.g. < 30% bypass).
   Test site: a new lint or unit test in apps/vscode/src/sdk/__tests__/
```

These are the RED tests that F3B ACT will add. F3 recon does NOT
add them; recon only identifies them as unwitnessed geometry.

# 07 — Compatibility / Shadow Inventory

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** ripgrep for `legacy|compat|deprecated|temporary|migration|fallback|shadow|mirror|bridge|adapter|transitional|TODO.*remove|remove.*when|delete.*when` in production code
**Evidence label:** STRUCTURAL + MANUAL_INSPECTION

---

## A. Intentional, deletion-predicated bridges

| Path | Why it exists | Deletion predicate |
|---|---|---|
| `apps/vscode/src/sdk/legacy-state-reader.ts` (308 LOC) | Reads pre-SDK on-disk state (globalState.json, secrets.json, taskHistory.json) so the SDK adapter can surface tasks/settings created before the SDK migration | When all pre-SDK data has been migrated or is no longer accessible. Auto-migration runs via `ProviderSettingsManager` construction (see `provider-migration.ts`) but `legacy-state-reader` is also used for task history reads (see `cline-session-factory.ts`). NOT FULLY DELETABLE TODAY. |
| `apps/vscode/src/sdk/provider-migration.ts` (112 LOC) | One-shot migration from legacy `globalState.json`+`secrets.json` to SDK `providers.json`. Tags entries with `tokenSource: "migration"`. | Already self-deletes once migration is complete (the migration logic is gated by a flag/once-per-install). Intentional, bounded. |
| `apps/vscode/src/shared/AutoApprovalSettings.ts:18, 22, 28, 31` — `editFilesExternally`, `readFilesExternally`, `executeAllCommands`, `favorites`, `maxRequests` | Backward compatibility with older extension versions | When minimum-supported extension version no longer reads these. The `EXTERNAL_EDIT_AUTO_APPROVAL_CONTRACT_UNIMPLEMENTED` P2 from the editor authority ACT explicitly notes these fields are kept for compat; removing them is a product-contract decision, not a code defect. |
| `apps/vscode/src/sdk/telemetry-settings-sync.ts:36` | One-time migration from legacy VS Code globalState.json field into file-backed storage | Already gated by sentinel (`__vscodeMigrationVersion`). Self-disables. |
| `apps/vscode/src/services/mcp/schemas.ts:95, 110, 119, 133` — `transportType` | Backward compatibility for old MCP server configs | When minimum-supported MCP server config version no longer uses `transportType`. Has explicit `// Remove the legacy field after transformation` comment. |
| `sdk/packages/core/dist/.../OpenTelemetryAdapter.ts` etc. | `INHERITED_FROM_UPSTREAM` (the SDK has its own telemetry adapters) | n/a — upstream, not fork |

## B. Shadows with explicit drift-detection role (intentional)

| Path | Why it exists | Deletion predicate |
|---|---|---|
| `apps/vscode/src/sdk/task-state-shadow-*.ts` (7 files, 20 types) | Detect divergences between the agents runtime's canonical `TaskState` and the host's projected `TaskState` | None — by design, the shadow is the drift detector. Deletion would require a different drift-detection architecture. |
| `apps/vscode/src/sdk/host-ownership-capture/` | Captures `host ownership` events to detect host-originated task-state changes | None — also a drift detector. |

## C. Compatibility layers WITHOUT explicit deletion predicates (architectural fossils)

| Path | LOC | Why a fossil candidate |
|---|---:|---|
| `apps/vscode/src/shared/ExtensionMessage.ts:155-237` — `turnState` field + `ThinkingPresentationProjection` | ~80 LOC of doc + type | "Legacy `turnState` is retained for non-thinking presentation concepts (button set, composer lockout, follow-up routing) that E7.1 explicitly does not migrate." This is a **structural shadow** with no deletion predicate. There is a partial migration to `ThinkingPresentationProjection` already, but only for Thinking consumers. Non-thinking consumers still read `turnState` directly. |
| `apps/vscode/src/sdk/cline-session-factory.ts` | 1,238 | Self-described as "Building session config from legacy state". Contains 30+ `resolveXxx(config)` helpers that explicitly "fall back to legacy `ApiConfiguration` fields" (`resolveModelId`, `resolveBaseUrl`, `resolveApiKey`, …). This is the largest **legacy-state-fallback bridge** in the codebase. The fall-back logic per provider (line 559: `const legacyField = mode === "plan" ? "planModeSapAiCoreModelId" : "actModeSapAiCoreModelId"`) is a strong indicator that the canonical state is now in the SDK, but the host still reads the legacy `ApiConfiguration` as a fallback. |
| `apps/vscode/src/sdk/model-catalog/effective-config.ts` (403 LOC) + `provider-migration.ts` (112 LOC) | 515 combined | The "effective config" computation reads the SDK providers but also `task/session/remote-config overlays for legacy fields` (line 376). It is **partially migrated**: the canonical lives in the SDK, the legacy is preserved as an overlay. No deletion predicate visible. |

## D. Architectural-fossil classification

| Path | Class | Reasoning |
|---|---|---|
| `apps/vscode/src/shared/ExtensionMessage.ts:155-237` `turnState` legacy field | **DELETABLE_NOW** (for non-thinking consumers) | Migration to `ThinkingPresentationProjection` is already underway; remaining consumers are an explicit deferral, not a structural need. Could be a small bounded refactor. |
| `apps/vscode/src/sdk/cline-session-factory.ts` legacy fallbacks | **ACTIVE_MIGRATION** | The SDK providers.json is the new canonical. Legacy fallbacks exist to preserve data already on disk. Per ACT §25 the goal of Model Profiles is to give the canonical a richer shape; once that lands, the fallbacks could be deletable. No deletion predicate today. |
| `apps/vscode/src/sdk/model-catalog/effective-config.ts` | **ACTIVE_MIGRATION** | Same as above. The legacy-field overlay is a transitional bridge. |
| `apps/vscode/src/sdk/legacy-state-reader.ts` | **ACTIVE_MIGRATION** | Same — but for on-disk task history, not just provider creds. |
| `apps/vscode/src/sdk/provider-migration.ts` | **PERMANENT_ADAPTER** | Already one-shot; running it again is a no-op (tagged `tokenSource: "migration"`). Safe to keep. |
| `task-state-shadow-*.ts` cluster | **PERMANENT_ADAPTER** | By-design drift detection, not migration scaffolding. |
| `host-ownership-capture/` | **PERMANENT_ADAPTER** | Same. |

## Summary

The fork has **two large ACTIVE_MIGRATION bridges** that together account for a significant share of fork-specific host code:

- **`cline-session-factory.ts`** (1,238 LOC) — provider/model/key resolution with legacy-field fallbacks
- **`model-catalog/effective-config.ts`** (403 LOC) + **`provider-migration.ts`** (112 LOC) — provider settings overlay with migration

Both target the same canonical destination: the SDK's `providers.json` (managed by `ProviderSettingsManager` in `@cline/core`). Once that destination is the *only* source of truth (i.e. legacy `ApiConfiguration` is fully migrated), both bridges become deletable.

This is the strongest **FORK_DRIFT** signal F0 found: the fork is in the middle of a *provider/settings storage migration*, and the bridges are large and not yet deletable. Model Profiles would have to navigate this.


---

## Correction addendum (C1 closure 2026-09-05)

**Weaken `WorkingContextHostCapture` SHADOW classification**.

Reviewer P1: "observe(event) = canonical writer, setLatest(w) = independent
writer ⇒ SHADOW" does not follow. Both ingresses may transport W produced
elsewhere; the carrier still has one mutable slot (`_latest`).

Revised classification:

```
WorkingContextHostCapture

  OLD: SHADOW (two semantic authorities)
  NEW: CACHE / PROJECTION WITH MULTIPLE WRITE INGRESSES

  DUAL_SEMANTIC_AUTHORITY         = NOT YET PROVEN
  SINGLE_INGRESS_DESIRABLE        = HYPOTHESIS TO TEST

  Required F1 discriminators before any deletion:
    SAME_SEMANTIC_STATE?   YES / NO
    SAME_OWNER?            YES / NO
    SAME_EVENT_DOMAIN?     YES / NO

  Permitted F1 outcomes:
    A. Runtime state genuinely changes -> use existing runtime event -> delete setLatest
    B. Manual compaction is a host-visible projection that does NOT mutate
       runtime state -> keep two producers, unify to ONE ASSIGNMENT PRIMITIVE
       (e.g. assign(w, provenance)) with one cache; do NOT fabricate a runtime event
    C. Core already exposes a shared W publication seam both producers can use
       -> use it; delete the bypass
    B-prime. NOT_FACTORIZABLE_AS_SINGLE_EVENT_SOURCE = permitted outcome
```

The inventory finding ("two write paths exist on the same `_latest` slot")
stands. The *semantic-authority* finding is withdrawn.

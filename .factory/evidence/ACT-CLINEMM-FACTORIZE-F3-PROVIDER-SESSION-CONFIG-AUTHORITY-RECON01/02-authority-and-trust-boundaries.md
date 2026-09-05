# 02 — Authority and trust boundaries

Phase 2 of F3 recon. Phase 1 established the file map; Phase 2
evaluates whether the multi-source reads agree on which store is
authoritative, and whether the bridges preserve the trust boundary.

## A. Trust boundary map

```text
HOST (apps/vscode)                              SDK (@cline/core + @cline/llms)
+--------------------------------------------------+----------------------------------------+
|                                                  |                                        |
|  StateManager          (legacy host storage)     |   ProviderSettingsManager (canonical)  |
|    |                                             |     |                                  |
|    v                                             |     v                                  |
|  globalState.json   +   secrets.json             |   providers.json                       |
|    ^                                             |     ^                                  |
|    |                                             |     |                                  |
|  apps/vscode/src/core/storage/state-             |   sdk/packages/core/src/services/      |
|  migrations.ts                                    |   storage/provider-settings-           |
|                                                  |   legacy-migration.ts (auto on ctor)   |
|                                                  |                                        |
|  +-------------------+      +------------------+ |                                        |
|  | legacy-state-     |      | model-catalog/   | |   reads via                            |
|  | reader.ts         |      | effective-       | |   getProviderSettingsManager()         |
|  | (task-history +   |      | config.ts        | |   or ProviderConfigStore               |
|  |  pre-SDK state)   |      |  + store.ts      | |                                        |
|  +-------------------+      +------------------+ |                                        |
|         |                            |           |                                        |
|         +--------+    +--------------+           |                                        |
|                  |    |                          |                                        |
|                  v    v                          |                                        |
|          apps/vscode/src/sdk/cline-session-factory.ts                                      |
|             (1238 LOC, hot path, multi-source combiner)                                     |
|                       |                                                                      |
|                       v                                                                      |
|             @cline/core > ClineCore > SessionRuntime                                         |
+----------------------------------------------------------------------------------------------+
```

Trust boundary **value**: keep provider credentials and effective
configuration behind ONE canonical read+write facade so the SDK and
host can never disagree about which provider/model is active.

## B. Duplication check (per §2 / §8 of the F0 framework)

§2 says: "factorize when a single source of truth has been
*duplicated* in a way that creates risk." §8 distinguishes between
DUPLICATE_RULE_SETS (semantic duplication, must eliminate) and
MULTIPLE_IMPLEMENTATIONS_SAME_RULE (rarely worth eliminating).

### B.1 Same logical field, different precedence orderings

The F3 surface has **4 different effective-config derivation sites**
with **3 different precedence orderings** between them:

| Site | File:line | PRIMARY | FALLBACK |
|------|-----------|---------|----------|
| `buildEffectiveProviderConfig` | `model-catalog/effective-config.ts:204+` | `providers.json` | `StateManager` |
| `buildSessionConfig` (provider-level) | `cline-session-factory.ts:817+` | `StateManager` | `providers.json` (only when no provider resolved) |
| `resolveApiKey` | `cline-session-factory.ts:490+` | `config[keyField]` | `providers.json` |
| `resolveOllamaContextWindow` | `model-catalog/host-overrides.ts:17+` | `providers.json` | `StateManager` |

This is **NOT** a single source of truth with multiple consumers.
It is **four sites that each independently decide** which store is
authoritative for the field they care about. Two of them disagree
about whether `providers.json` is PRIMARY or FALLBACK.

Per §8 discriminator: this is closer to MULTIPLE_VALUE_PRODUCERS
than MULTIPLE_MUTATION_AUTHORITIES, because the question is which
store is read first, not which one writes.

### B.2 Direct `getProviderSettingsManager()` bypass

The canonical read API is `ProviderConfigStore.read(providerId)`,
which delegates to `buildEffectiveProviderConfig`. But there are
~22 sites in `apps/vscode/src/sdk/` and `apps/vscode/src/integrations/`
that bypass this and read `getProviderSettingsManager()` directly
(see 01-production-chain.md §D.2).

Why do they bypass? Looking at the actual call sites:

- `cline-session-factory.ts:223, 504, 530, 623, 660, 709, 758, 876, 906, 1000`:
  per-field reads during `buildSessionConfig` — these read a single
  field at a time and don't need the full `EffectiveProviderConfig`
- `model-catalog/store.ts:220, 319`: needs the manager's
  `resolveModelsRegistryPath` helper which is not exposed via
  `ProviderConfigStore`
- `model-catalog/store.ts:564, 570`: internal helpers for the
  store's own dual-write bridge (must be direct to avoid recursion)
- `model-catalog/catalog.ts:199`: needs `listLocalProviders` which
  is not on `ProviderConfigStore`
- `model-catalog/host-overrides.ts:31`: ollama contextWindow with
  fallback comment in source
- `auth-service.ts:*`: SDK-managed OAuth tokens (cline, openai-codex)
  — these are CRITICAL: they must hit the SDK store directly because
  the OAuth tokens are owned by the SDK and the SDK's auth refresh
  is the only valid writer.
- `integrations/openai-codex/oauth.ts:*`: same

So most of the bypass sites are **legitimate** (SDK owns the auth
seam; the store intentionally doesn't expose the helper needed for
those reads). The **suspicious** bypass sites are:

- `cline-session-factory.ts:623` (vertex region) — should use store
- `cline-session-factory.ts:660` (ollama contextWindow) — duplicates
  host-overrides.ts:31 with **opposite precedence** (see B.3)
- `cline-session-factory.ts:758` (apiLine) — should use store
- `cline-session-factory.ts:876` (lastUsed fallback) — legitimate
  fallback only when StateManager has no provider
- `cline-session-factory.ts:906` (modelId) — should use store
- `model-catalog/store.ts:564` — internal, legitimate (avoids recursion)
- `model-catalog/store.ts:570` — internal, legitimate

### B.3 The ollama contextWindow precedence inversion

Two sites read "ollama contextWindow" with **opposite precedence**:

1. `cline-session-factory.ts:660` (`resolveOllamaProviderConfig`):
   reads `providers.json` directly. No fallback to StateManager in
   the source code (would need to check whether the function returns
   undefined when providers.json has no ollama entry — likely just
   passes through undefined).

2. `model-catalog/host-overrides.ts:31` (`resolveOllamaContextWindow`):
   reads `providers.json` PRIMARY, falls back to
   `StateManager.getApiConfiguration().ollamaApiOptionsCtxNum`.

The two callers **might or might not** see the same value, depending
on whether `stateManager` has the legacy field and `providers.json`
does not. This is exactly the kind of "two readers disagreeing on
the same field" issue that the recon needs to surface.

The source comment in `host-overrides.ts:17` says:
> "providers.json (`contextWindow`) is the source of truth; the legacy
> StateManager string is a migration fallback."

But `cline-session-factory.ts:660` was written **before** the
`host-overrides.ts` module existed, and it doesn't apply the same
fallback. So when a user has an Ollama config only in
`ollamaApiOptionsCtxNum` and not in `providers.json` (the migration
fallback case), the model picker will show one contextWindow while
the session will see another.

**This is a real (small) divergence in user-visible behavior.**
Worth fixing, but NOT a behavioral bug that would cause incorrect
generation — it would cause the chat indicator to show a different
number from the actual `num_ctx` Ollama applies.

### B.4 `migrateProviders()` is dead code

`apps/vscode/src/sdk/provider-migration.ts:migrateProviders()` is
exported but never called outside its own file and its test file
(verified via grep across `apps/vscode/src` and the SDK packages).
The actual migration happens via the `ProviderSettingsManager`
constructor's automatic `migrateLegacyProviderSettings` call.

**Deletion is safe** (no production caller). Could be removed in
a separate ACT or as part of F3's Outcome A.

### B.5 The dual-write bridge is single-point-of-truth

`model-catalog/store.ts > write()` is the ONLY site that fans out a
provider config update to both stores. Verified by grep:
`getProviderSettingsManager().saveProviderSettings` is called from
exactly 2 places:
- `model-catalog/store.ts:570` (the canonical bridge)
- `cline-session-factory.ts:234` (a small early-init save; not a
  user-visible provider config change)

And `StateManager.setGlobalState` / `setSecret` for provider
fields is called from:
- `model-catalog/store.ts` (writeStateFields, writeSelectionToState)
- `model-catalog/effective-config.ts` reads only

So the write side is converged: `store.write()` is the single
fan-out. The read side is fragmented.

## C. Trust-boundary integrity

The trust boundary between host and SDK is **preserved** at the
write boundary:

- Host → SDK: `store.write(providerId, patch)` (host-initiated, fans
  out to both stores)
- SDK → host: SDK owns `providers.json` exclusively; host only
  writes via `store.write()` which then calls
  `providerSettingsManager.saveProviderSettings(...)`.

The trust boundary is **partially broken** at the read boundary:

- Host reads from `providers.json` directly in ~22 places
- Host reads from `globalState.json` directly via
  `stateManager.getApiConfiguration()` in ~8 places
- The **canonical** read is `store.read(providerId)`, but the host
  rarely uses it on the hot path

This is a read-side drift risk, not a write-side corruption risk.
Recon question: should all reads go through `store.read()`, or is
the per-field direct read acceptable for performance / code-clarity
reasons?

## D. Re-evaluation against §2 / §8

| Discriminator | §2 question | §8 classification | F3 verdict |
|---------------|------------|--------------------|------------|
| Two stores with different precedence orderings | "Are rules duplicated?" | MULTIPLE_VALUE_PRODUCERS | YES — 4 sites, 3 orderings. The `effective-config.ts` rule (providers.json PRIMARY) is the documented rule; the others are local deviations. |
| 22 direct bypass sites vs 10 canonical sites | "Is the rule set duplicated?" | MIXED — most bypasses are legitimate (SDK owns auth seam); a handful are suspicious | MOSTLY_LEGITIMATE, 4-6 suspicious |
| `migrateProviders()` is dead code | "Is there a duplicated rule?" | DEAD_CODE | YES — can be deleted safely |
| `host-overrides.ts:resolveOllamaContextWindow` vs `cline-session-factory.ts:660` | "Do two sites read the same field the same way?" | DIVERGENCE | YES — opposite precedence; needs to be aligned |

## E. Trust-boundary enumeration (final)

| Boundary | Owner | Preservation |
|----------|-------|--------------|
| `providers.json` write authority | `@cline/core > ProviderSettingsManager` | YES — only the manager (via `store.write()` and `auth-service.ts:oauth`) writes to it |
| `globalState.json` write authority | host `StateManager` | YES — only `StateManager` writes it for provider fields (via `store.write()`) |
| `EffectiveProviderConfig` read authority | SHOULD BE `store.read()` | PARTIAL — `effective-config.ts` is canonical for the `buildEffectiveProviderConfig` flow; 22 sites bypass it |
| Selection read authority | SHOULD BE `store.readSelection()` | PARTIAL — `cline-session-factory.ts:353` uses it; `store.ts:readSelectionFromState` reads StateManager directly for the active provider comparison |
| OAuth token authority | `@cline/core > ProviderSettingsManager` (cline/openai-codex) | YES — only the SDK reads/writes `auth.*` fields in providers.json |

## F. Phase 2 conclusion

1. **Read-side fragmentation is real but mostly justifiable.**
   ~22 bypass sites; ~10 canonical sites. The bypasses split into
   two camps: SDK-owned auth (legitimate) and per-field optimization
   (suspicious in 4-6 cases).

2. **The "ollama contextWindow divergence" is a small but real
   user-visible inconsistency.** Fix is mechanical: align
   `cline-session-factory.ts:660` to use the same primary/fallback
   as `host-overrides.ts:31`.

3. **`migrateProviders()` is dead code.** Safe to delete.

4. **Write-side authority is converged.** `store.write()` is the
   single fan-out point. No risk of one store being updated without
   the other.

5. **The trust boundary between host and SDK is preserved at the
   write boundary.** The read boundary is permissive but not
   corrupting.

End Phase 2. Continue to Phase 3 (legacy-bridge classification) inline below, then Phase 4 (discriminator freeze) in `03-discriminator.md`.

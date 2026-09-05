# 01 — Production Chain (verified from HEAD)

Repo: /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
HEAD:  e06af528522ae2aa471aac9eed30acb51e9fdf92 (clean, main)
Range studied: current HEAD only (no historical reverts).

All files verified to exist at HEAD with sizes shown in §5 inventory.

---

## §8 RECON Q1 — Semantic owner

### Durable object

A single JSON value at key `clinemmTemporaryExternalPathAuthorities` inside
`~/.cline/data/globalState.json` (resolved via `stateManager.getStorageDataDir()`).
Default: `[]`.

Declarations:
- `apps/vscode/src/shared/storage/state-keys.ts:327-329`
  (`default: [] as TemporaryExternalPathAuthority[]`)

### Read / write inventory (filtered to AUTHORITY-MUTATING code)

| Stage | Site | File:Line | Mutation | Validation | Serialization | Cache | Transport |
|------|------|-----------|---------:|-----------:|--------------:|------:|----------:|
| Settings UI submit | `updateSetting("clinemmTemporaryExternalPathAuthorities", ...)` → `updateSettings.ts` | `apps/vscode/webview-ui/src/components/settings/sections/TemporaryExternalPathsSection.tsx:63` | NO | NO | YES (JSON.stringify) | NO | YES |
| UI handler | `request.clinemmTemporaryExternalPathAuthorities !== undefined` block | `apps/vscode/src/core/controller/state/updateSettings.ts:321-340` | YES (via `setGlobalState`) | YES (calls `validateTemporaryExternalPathAuthorities`) | YES (parses JSON wire) | NO | YES |
| CLI handler | `if (clinemmTemporaryExternalPathAuthorities !== undefined)` block | `apps/vscode/src/core/controller/state/updateSettingsCli.ts:284-301` | YES (via `setGlobalState`) | YES (calls `validateTemporaryExternalPathAuthorities`) | YES (parses JSON wire) | NO | YES |
| Persistence | `stateManager.setGlobalState("clinemmTemporaryExternalPathAuthorities", [...result.valid])` | `apps/vscode/src/core/controller/state/updateSettings.ts:340`, `updateSettingsCli.ts:301` | YES (writes backing JSON) | (already validated) | YES | NO | NO |
| Validator | `validateTemporaryExternalPathAuthorities(raw, now)` | `apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts:284-308` | NO | YES (single source) | NO | NO | NO |
| Validator helper | `validateEntry(entry, index, now)` | same file:173-265 | NO | YES (per-entry) | NO | NO | NO |
| Validator helper | `classifyTemporaryExternalPathShape(path)` | same file:117-122 | NO | YES (structural) | NO | NO | NO |
| Validator helper | `isFilesystemRoot(path)` | same file:106-110 | NO | YES (platform-aware) | NO | NO | NO |
| Validator helper | `isWithinTwentyFourHourCeiling(expiryMs, now)` | same file:317-323 | NO | YES (temporal) | NO | NO | NO |
| Runtime filter | `filterActiveTemporaryExternalPathEntries(persisted, now)` | same file:354-388 | NO | YES (defense-in-depth at consumption) | NO | NO | NO |
| Resolver | `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile(opts)` (public wrapper) | same file:458-462 | NO | (calls filter) | NO | NO | NO |
| Resolver impl | `resolveActiveTemporaryExternalCanonicalRootsFromBackingFileImpl(...)` | same file:464-516 | NO | YES (read file → filter → realpath) | YES (parses JSON) | NO | YES (reads backing JSON) |
| Resolver impl raw reader | `readTemporaryExternalPathAuthoritiesRawFromBackingFile(path)` | same file:529-540 | NO | NO (raw only, used by UI) | YES | NO | YES (reads backing JSON) |
| Host resolver bridge | `SdkController.resolveActiveTemporaryExternalCanonicalRoots()` | `apps/vscode/src/sdk/SdkController.ts:2449-2463` | NO | (delegates to resolver) | NO | NO | YES (resolves backingFilePath via getStorageDataDir) |
| Host evidence bridge | `SdkController.buildPathAuthorityEvidence(toolInput, activeTempRoots)` | `apps/vscode/src/sdk/SdkController.ts:2479-...` | NO | NO (receives snapshot) | NO | NO | YES (threads snapshot into SDK) |
| Core SDK builder | `buildPathAuthorityEvidence({..., temporaryExternalCanonicalRoots})` | `sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.ts:348-381` | NO | NO (verbatim pass-through) | NO | NO | YES |
| Core SDK evidence type | `pathAuthorityEvidence.temporaryExternalCanonicalRoots` | `sdk/packages/core/src/runtime/command-policy/path-authority-evidence.ts:166` | NO | NO | NO | NO | YES |
| Core SDK auth type | `CommandHostAuthorization.temporaryExternalCanonicalRoots` | `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts:565, 576` | NO | NO | NO | NO | YES |
| Core SDK auth factory | `createCommandHostAuthorization({..., temporaryExternalCanonicalRoots})` | `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts:565-...` | NO | NO (verbatim pass-through) | NO | NO | YES |
| Core SDK containment | `path-authority.ts:679-684` containment union | `sdk/packages/core/src/runtime/command-policy/path-authority.ts:679-684` | NO | NO (consumes snapshot for union only) | NO | NO | YES |

### Frozen

```
DURABLE_SEMANTIC_OWNER         = clinemmTemporaryExternalPathAuthorities key in
                                 ~/.cline/data/globalState.json
DURABLE_WRITE_ENTRY_POINTS     = 2 (both call same validator + same setGlobalState):
                                 - apps/vscode/src/core/controller/state/updateSettings.ts:340
                                 - apps/vscode/src/core/controller/state/updateSettingsCli.ts:301
SEMANTIC_MUTATION_RULE_SETS    = 1 (one validator defines all write rules):
                                 - apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts:284
                                   (validateTemporaryExternalPathAuthorities)
                                 called from updateSettings.ts:332 and updateSettingsCli.ts:293
MULTIPLE_MUTATION_AUTHORITIES  = NO
                                 (precise wording: two write ENTRY POINTS, one
                                  SEMANTIC MUTATION RULE SET; the validator
                                  itself does not mutate — the handler at the
                                  entry point is what mutates via setGlobalState)
DUPLICATE_WRITE_RULES          = NO
```

Per the eighty-second-pass P2 wording precision: two durable mutation entry
points (`updateSettings` and `updateSettingsCli`) both execute the same
validator and the same semantic write contract. So the distinction is:

```text
DURABLE_WRITE_ENTRY_POINTS   = 2   (two call sites that mutate)
SEMANTIC_MUTATION_RULE_SETS  = 1   (one validator, one write contract)
MULTIPLE_MUTATION_AUTHORITIES = NO  (per §13 discriminator definition)
```

Multiple callers of one validator is **not** multiple semantic authorities
(per §8 distinction); the validator defines the rules, but the entry points
are what perform the durable mutation via `setGlobalState`.

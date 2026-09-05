# F3B — Provider/Session Config Authority CONSOLIDATE01

## frozen question (inherited from F3 recon)

> How many semantic representations of the active provider/model configuration exist between persisted provider settings and a running ClineMM session, and which legacy/migration bridges can be deleted or collapsed before Model Profiles are introduced?

## review of T18 (P1: REJECTED as RED/invariant)

F3 recon proposed this invariant:

```text
count getProviderSettingsManager() reads
count ProviderConfigStore.read() reads
assert bypass ratio < 0.50
```

Reviewer verdict: **rejected**. The 22/10 ≈ 68% figure is useful **recon evidence**, not a semantic contract. There is no demonstrated reason why 49% = correct and 51% = broken. A legitimate OAuth read directly against `ProviderSettingsManager` could flip RED without changing correctness, and four semantically wrong bypasses could remain below the threshold and pass.

Frozen:

```text
T18_READ_SIDE_BYPASS_RATIO =
  RECON_METRIC_ONLY   (frozen in F3 05-characterization.txt)

T18_AS_REGRESSION_TEST =
  REJECTED

WHY =
  arbitrary cardinality threshold;
  conflates legitimate SDK-owned direct reads with
  session-config derivation bypasses;
  does not encode a product or correctness invariant.
```

Replacement (structural statement, no executable threshold):

```text
DIRECT_PROVIDER_SETTINGS_MANAGER_READS =
  permitted only where semantics require SDK-owned/raw-store access
  (e.g. OAuth credentials, registry operations, store internals)

SESSION_EFFECTIVE_CONFIG_DERIVATION =
  should consume canonical EffectiveProviderConfig via store.read()
  unless a documented field-specific exception exists.
```

No F3 correction ACT is required for T18. Correction is applied in place here in F3B.

## review of T17 ("witnessed consequence" wording, P1: source-predicted, not executed)

F3 recon repeatedly labelled T17 as:

```text
picker shows 384k
session uses 128k
```

This wording overstates what was demonstrated. The actual state is:

```text
SOURCE_DIVERGENCE          = PROVEN     (resolveOllamaProviderConfig vs
                                          resolveOllamaContextWindow in F3 dossier)
T17_FAILURE                = PREDICTED_FROM_SOURCE
USER_VISIBLE_CONSEQUENCE   = INFERRED
RED_EXECUTED               = NO
Per reviewer: the F3B RED must determine whether the inferred `384k vs 128k` behavior really reproduces. If it does not, HALT_RED_NOT_REPRODUCED.

## four-site discriminator (Phase 2 ground truth)

The F3 recon dossier listed four "suspicious" direct reads in `cline-session-factory.ts`:
- `:623` vertex region
- `:660` ollama contextWindow
- `:758` apiLine
- `:906` modelId

Characterization below is read directly from `cline-session-factory.ts`, `effective-config.ts`, and `host-overrides.ts` at HEAD `085c1c21b`. **This is the actual source-level truth, not the F3 dossier's inferred statement.**

### Site 1 — Ollama contextWindow (`cline-session-factory.ts:660`, function `resolveOllamaProviderConfig`)

```text
settingsContextWindow = getProviderSettingsManager().getProviderSettings("ollama")?.contextWindow  // line 660
const raw = config.ollamaApiOptionsCtxNum?.trim()                                                  // line 665
const parsed = raw ? Number(raw) : Number.NaN
const legacyContextWindow = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined  // line 667
const contextWindow = settingsContextWindow ?? legacyContextWindow ?? OLLAMA_DEFAULT_CONTEXT_WINDOW // line 668
```

Precedence observed: **providers.json PRIMARY, StateManager FALLBACK, hardcoded default LAST.**

Compare to `resolveOllamaContextWindow` in `model-catalog/host-overrides.ts:26`:

```text
const value = getProviderSettingsManager().getProviderSettings("ollama")?.contextWindow  // line 31
// try/catch fallback to:
//   StateManager.get().getApiConfiguration().ollamaApiOptionsCtxNum  (line 39)
// OLLAMA_DEFAULT_CONTEXT_WINDOW on second miss  (line 49)
```

Precedence observed: **identical: providers.json PRIMARY, StateManager FALLBACK, hardcoded default LAST.**

Also compare to `effective-config.ts:buildEffectiveProviderConfig`:

```text
assignIfDefined(merged, "contextWindow", providerSettings.contextWindow ?? stateConfig.contextWindow)  // line 398
```

Precedence observed: **identical again.**

```text
SITE_1_OLLAMA_CONTEXT_WINDOW_STORE_EQUIVALENT = NO    (replacing with store.read() does not preserve
                                                       the legacy fallback — buildEffectiveProviderConfig
                                                       DOES handle it, but only because ollama is a
                                                       special case in readStateContextWindow that
                                                       reads config.ollamaApiOptionsCtxNum)

T17_LOAD_BEARING_FOR_SITE_1 =
  PROBABLY_NO_AFTER_INSPECTION   (the direct read at line 660 already implements the
                                  canonical fallback; replacing with store.read() may
                                  change behavior, but the change is from
                                  "duplicated fallback logic" to "delegated fallback logic",
                                  not from "broken" to "fixed". The T17 test should be
                                  run BEFORE any replacement is decided.)
```

### Site 2 — Vertex region (`cline-session-factory.ts:623`, function `resolveVertexProviderConfig`)

```text
const settings = getProviderSettingsManager().getProviderSettings("vertex")  // line 623
providerSettingsProjectId = settings?.gcp?.projectId?.trim() || undefined    // line 624
providerSettingsRegion = settings?.gcp?.region?.trim() || settings?.region?.trim() || undefined  // line 625
const region = (providerSettingsRegion ?? config.vertexRegion?.trim()) || undefined  // line 630
return {
  region,
  gcp: {
    projectId: (providerSettingsProjectId ?? config.vertexProjectId?.trim()) || undefined,  // line 634
    region,
  },
}
```

Precedence observed: **per-field: providers.json PRIMARY, ApiConfiguration FALLBACK.**

Compare to `buildEffectiveProviderConfig` (effective-config.ts:386–398) which uses StateManager-first for most fields:

```text
assignIfDefined(merged, "apiKey", stateConfig.apiKey ?? providerSettings.apiKey)
...
assignIfDefined(merged, "gcp", mergeGcp(stateConfig.gcp, providerSettings.gcp))  // line 394
```

Vertex gcp precedence in `buildEffectiveProviderConfig`: **StateManager PRIMARY, providers.json FALLBACK** (because `mergeGcp(stateConfig.gcp, providerSettings.gcp)`).

This is **the opposite** of `resolveVertexProviderConfig` (which is providers.json primary).

```text
SITE_2_VERTEX_REGION_STORE_EQUIVALENT = NO   (precedence is reversed: providers.json PRIMARY in
                                              the direct read, but StateManager PRIMARY in
                                              buildEffectiveProviderConfig via mergeGcp.
                                              Replacing would change which source wins
                                              on conflict.)
```

### Site 3 — apiLine (`cline-session-factory.ts:758`, function `resolveApiLine`)

```text
const field = apiLineMap[providerId]    // line 749
if (field) {
  const fromState = config[field]       // ApiConfiguration
  if (isProviderApiLine(fromState)) {
    return fromState                    // line 753
  }
}

try {
  const settingsApiLine = getProviderSettingsManager().getProviderSettings(providerSettingsProviderId(providerId))?.apiLine  // line 758
  if (isProviderApiLine(settingsApiLine)) {
    return settingsApiLine              // line 760
  }
} catch { ... }
```

Precedence observed: **ApiConfiguration PRIMARY, providers.json FALLBACK.**

Compare to `buildEffectiveProviderConfig`:

```text
assignIfDefined(merged, "apiLine", stateConfig.apiLine ?? providerSettings.apiLine)  // line 388
```

**Same precedence.** But `resolveApiLine` ALSO consults `sharedApiLineMap[providerId]` as a third fallback (line 766) which has no canonical-store analog.

```text
SITE_3_APILINE_STORE_EQUIVALENT = NO_SHARED_API_LINE_FALLBACK
                                   (the third fallback at line 766 is a SHARED ApiConfiguration
                                    field — e.g. zai-coding-plan shares zaiApiLine. Canonical
                                    store does not model this sharing. Replacing would lose it.)
```

### Site 4 — modelId (`cline-session-factory.ts:906`)

```text
if (!modelId && providerHasLocalModelSource(providerId)) {
  try {
    modelId = getProviderSettingsManager().getProviderSettings(providerSettingsProviderId(providerId))?.model?.trim()  // line 906
  } catch { ... }
  modelId = modelId || ""
}
```

Precedence observed: **only triggered when ApiConfiguration-derived modelId is empty AND the provider has a local-model source.** This is a last-resort fallback, not a precedence decision.

Compare to `buildEffectiveProviderConfig`: the function deliberately EXCLUDES mode-dependent model selection (per its own docstring line 378–379: "Mode-dependent model selection is intentionally excluded; callers use `ProviderConfigStore.readSelection(providerId, mode)` for that.")

```text
SITE_4_MODEL_ID_STORE_EQUIVALENT = PARTIAL
                                    (store.readSelection() is the right primitive, but
                                     its semantics include mode + providerHasLocalModelSource
                                     gating which is NOT currently in the direct read at
                                     line 906. Replacing would either widen scope or
                                     require a parallel guard.)
```

### Site-discriminator summary

| Site                  | Precedence observed        | `store.read()` equivalent? | T17 carries? | Action candidate          |
| --------------------- | -------------------------- | -------------------------- | ------------ | ------------------------- |
| Ollama contextWindow  | providers.json PRIMARY     | NO (no legacy fallback in store.read for non-Ollama; Ollama is special-cased in effective-config) | Probably NO (source already has fallback) | Confirm T17 does NOT reproduce; if it does not, leave as-is. |
| Vertex region         | providers.json PRIMARY     | NO (opposite precedence)   | NO           | KEEP_DIRECT_READ (semantic difference). |
| apiLine               | StateManager PRIMARY       | PARTIAL (no shared-field fallback) | NO      | KEEP_DIRECT_READ (semantic difference). |
| modelId               | last-resort empty fallback | PARTIAL (different scope)  | NO           | KEEP_DIRECT_READ (semantic difference). |

**Conclusion**: The F3 dossier's four-site repair scope is too aggressive. Only Site 1 (Ollama contextWindow) is even conceivably consolidatable, AND its current implementation already mirrors the canonical fallback rule, AND the F3 dossier's T17 prediction (session uses 128k, picker uses 384k) is therefore expected to NOT reproduce.

Per reviewer: if T17 does not reproduce, **HALT_RED_NOT_REPRODUCED**. No consolidation based on the leading hypothesis.

## dead `migrateProviders()` bridge (P2 / terminal cleanup)

F3 found `apps/vscode/src/sdk/provider-migration.ts:migrateProviders` is exported but never called outside its own test. Deletion is reasonable but does **NOT** gate F3B. F3B acceptance does not depend on removing this dead code. If, after T17 fails to reproduce, no other repair is needed, F3B may still delete it as P2 terminal cleanup — but this is optional.

```text
migrateProviders()
  production callers = 0
  own test only

PROMOTION_TO_PREDICATE = NO   (per reviewer: dead-code deletion protects no part of
                              the F3B causal chain. Optional at terminal cleanup.)
```

## Phase 0 — entry

```text
ENTRY_HEAD = 085c1c21b048700606b6c6ad55b08fe0d517d8cd   (F3 closure correction commit)

Worktree must be clean at entry.
No new architecture review.
PRODUCTION_HEAD_UNCHANGED_AT = e06af528522ae2aa471aac9eed30acb51e9fdf92
```

## Phase 1 — RED T17

Add one production-seam test proving:

```text
Given:
  provider = ollama
  StateManager legacy ctx = "384000"   (config.ollamaApiOptionsCtxNum)
  providers.json ctx = absent          (no ollama entry in providers.json)

When:
  resolveOllamaProviderConfig(config, modelId) runs

Then:
  returned modelInfo.contextWindow = 384000
```

Prefer the real `resolveOllamaProviderConfig` function, using existing dependency injection rather than replacing the production derivation with a fake. The function is already exported from `cline-session-factory.ts:654`.

Labels:

```text
SESSION_FACTORY_SEAM = REAL
FILESYSTEM/STORE_GEOMETRY = SYNTHETIC_REAL   (in-memory mocked ProviderSettingsManager)
LIVE_UI = NOT_EXECUTED
RED_EXECUTED = YES   (this phase)
```

### Stop rule

If T17 does NOT reproduce:

```text
HALT_RED_NOT_REPRODUCED
```

Preserve the test as a passing NOT_REPRODUCED witness and stop. Do not "fix" precedence merely because the source looked suspicious.

If T17 DOES reproduce:

```text
RED_REPRODUCED = YES
PROCEED_TO_PHASE_3
```

## Phase 2 — four-site discriminator

**Already characterized above** (see Site 1–4 sections). Discriminator verdict summary:

```text
OLLAMA_CONTEXT_WINDOW_STORE_EQUIVALENT = NO
VERTEX_REGION_STORE_EQUIVALENT         = NO   (opposite precedence; do NOT replace)
APILINE_STORE_EQUIVALENT               = NO   (shared-field fallback; do NOT replace)
MODEL_ID_STORE_EQUIVALENT              = NO   (different scope; do NOT replace)
```

For each candidate answer:

1. What does the current direct read do if both stores disagree? — captured above
2. What does `store.read()` return for the same state? — captured above
3. Are defaults preserved? — captured above
4. Are mode-specific/model-specific semantics preserved? — captured above

Only `YES` or proven bug geometry permits replacement.

## Phase 3 — bounded repair

If T17 reproduces:

```text
MINIMUM_REPAIR = Ollama session contextWindow derivation
                 → canonical EffectiveProviderConfig/store.read semantics
```

Additional replacements at `:623` / `:758` / `:906` are allowed **only where Phase 2 proves semantic equivalence**. Phase 2 above proves NONE of them are equivalent. Therefore:

```text
PHASE_3_REPLACEMENTS =
  NONE_OUTSIDE_OLLAMA
```

Do not globally ban `getProviderSettingsManager()`. Direct use remains correct for SDK-owned seams such as OAuth credentials, registry operations, and store internals.

## Phase 4 — GREEN + causal ablation

Required:

```text
T17 GREEN   (if reproduced; else NOT_REPRODUCED witness)
```

If T17 was reproduced and fixed, ablate the canonical read/fallback in the test or injected seam to confirm necessity:

```text
canonical effective derivation removed
→ T17 returns to old divergent result
```

That establishes necessity rather than chronology.

If T17 was NOT reproduced:

```text
ABLATION_NOT_APPLICABLE
PHASE_4_TERMINAL = YES
PROCEED_TO_CLOSURE
```

## Phase 5 — conservation

Pin exact behavior for at least:

```text
C1 providers.json ctx exists + legacy differs
   → providers.json wins

C2 providers.json ctx absent + legacy exists
   → legacy fallback wins

C3 both absent
   → existing default/undefined semantics unchanged

C4 API key resolution unchanged

C5 model selection unchanged

C6 Vertex region unchanged

C7 apiLine unchanged

C8 non-Ollama providers unchanged

C9 dual-write semantics unchanged

C10 OAuth direct ProviderSettingsManager access unchanged
```

Tests for C6/C7 may become particularly important if those sites are consolidated. Per Phase 2: sites 2 and 3 will NOT be consolidated, so C6/C7 are observation tests (no behavior change) rather than regression tests.

## closure disposition (planned)

```text
IF_T17_NOT_REPRODUCED:
  PASS_F3B_NO_REPAIR_NEEDED
  F3B state = CLOSED
  NO production edits
  OPTIONAL: terminal cleanup of migrateProviders (P2)
  HANDOFF: Move directly to Model Profiles product work

IF_T17_REPRODUCED_AND_FIXED:
  PASS_F3B_REPAIR_APPLIED
  F3B state = CLOSED
  Production edits to Ollama session contextWindow derivation only
  HANDOFF: Move to Model Profiles product work
```

## CLOSURE (executed)

```text
T17_RESULT = NOT_REPRODUCED
EXECUTED   = YES (vitest src/sdk/cline-session-factory.test.ts, 78/78 pass)
OUTCOME    = T17 passes against the REAL resolveOllamaProviderConfig function.
             The canonical fallback rule (providers.json PRIMARY, StateManager
             FALLBACK, default LAST) is correctly implemented at
             cline-session-factory.ts:660-668. The F3 recon dossier's prediction
             that the session would use 128k default while the picker showed
             384k was over-confident: both code paths share the same rule.

HALT       = HALT_RED_NOT_REPRODUCED

F3B_DISPOSITION = PASS_F3B_NO_REPAIR_NEEDED
F3B_STATE       = CLOSED

PRODUCTION_EDITS = NONE   (per stop rule)

NEW_TEST = apps/vscode/src/sdk/cline-session-factory.test.ts
           (T17 added; all 78 tests in that file pass; T17 preserved as a
            passing NOT_REPRODUCED witness)

NEXT_LANE = Model Profiles product work
            (per reviewer: D8 = NO, seam ready, gating is product scope)

OPTIONAL_TERMINAL_CLEANUP = apps/vscode/src/sdk/provider-migration.ts:migrateProviders
                             (DEAD bridge; out of F3B predicate; may be deleted
                              in a future terminal-cleanup ACT if the no-caller
                              proof still holds)
```

## corrected F3 dossier posture

```text
F3 finding "T17 — picker 384k vs session 128k (UX bug)"
   STATUS = WITNESS_DEGRADED_TO_INFERRED
   F3 was overly confident in calling this a "witnessed consequence."
   The F3 dossier described the divergence in two code paths but did not
   execute the test. The actual test reveals both paths implement the
   same canonical fallback. The 384k/128k divergence was never observed.

F3 finding "T18 — bypass ratio ≈ 0.68"
   STATUS = RECON_METRIC_ONLY   (per reviewer P1)
   Not a semantic contract. Not promoted to RED.

F3 finding "four suspicious bypass sites"
   STATUS = KEEP_DIRECT_READ   (per Phase 2 ground truth)
   Site 1 (Ollama): no semantic difference vs canonical store.
   Site 2 (Vertex): opposite precedence; would change behavior.
   Site 3 (apiLine): shared-field fallback; no canonical analog.
   Site 4 (modelId): different scope (mode + providerHasLocalModelSource).

F3 finding "1 DEAD bridge: migrateProviders"
   STATUS = CONFIRMED_DEAD
   Out of F3B predicate; optional terminal cleanup.
```


```

Per reviewer: the F3B RED must determine whether the inferred `384k vs 128k` behavior really reproduces. If it does not, HALT_RED_NOT_REPRODUCED.

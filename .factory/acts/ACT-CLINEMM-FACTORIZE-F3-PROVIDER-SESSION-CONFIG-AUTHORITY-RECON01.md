# ACT-CLINEMM-FACTORIZE-F3-PROVIDER-SESSION-CONFIG-AUTHORITY-RECON01

**ACT body — RECON only. NO production or test edits until discriminator freezes.**

## Frozen question

> **How many semantic representations of the active provider/model configuration
> exist between persisted provider settings and a running ClineMM session, and
> which legacy/migration bridges can be deleted or collapsed before Model
> Profiles are introduced?**

## Scope (reviewer-named surface)

```text
apps/vscode/src/sdk/cline-session-factory.ts                (1238 LOC)
apps/vscode/src/sdk/legacy-state-reader.ts                 (308 LOC)
apps/vscode/src/sdk/provider-migration.ts                  (112 LOC, host adapter)
apps/vscode/src/sdk/model-catalog/effective-config.ts      (403 LOC)
apps/vscode/src/sdk/model-catalog/store.ts                 (1238 LOC effective)
apps/vscode/src/sdk/model-catalog/host-overrides.ts        (51 LOC)
apps/vscode/src/sdk/model-catalog/provider-id.ts           (110 LOC)
apps/vscode/src/sdk/model-catalog/sdk-provider-id.ts       (40 LOC)
apps/vscode/src/sdk/model-catalog/contracts.ts             (effective)
sdk/packages/core/src/services/storage/provider-settings-manager.ts
sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts
sdk/packages/core/src/services/storage/provider-settings-manager.test.ts
sdk/packages/core/src/services/storage/provider-settings-legacy-migration.test.ts
```

## Frozen chain (traced end-to-end)

```text
persisted provider configuration
  -> providers.json (new SDK canonical, written by ProviderSettingsManager)
  -> globalState.json + secrets.json (legacy StateManager format)
  -> migrateLegacyProviderSettings (runs in ProviderSettingsManager ctor)
  -> effective-config.ts (combines StateManager.getApiConfiguration +
                          ProviderSettingsManager.getProviderSettings
                          into EffectiveProviderConfig)
  -> model-catalog/store.ts > createProviderConfigStore (canonical bridged
                                                              read/write:
                                                              reads both, writes
                                                              both, emits events)
  -> model-catalog/store.ts > resolveRuntimeModelSelection (frozen catalog)
  -> cline-session-factory.ts > buildSessionConfig (assembles CoreSessionConfig)
                                  StateManager PRIMARY, ProviderSettingsManager
                                  FALLBACK ONLY when no provider is resolved
  -> @cline/core > ClineCore > SessionRuntime (runs)
  -> webview (active model displayed)
```

## Discriminator freeze (pre-filled, to be completed by recon)

```
SINGLE_PERSISTED_AUTHORITY            = TBD
MULTIPLE_EFFECTIVE_CONFIG_DERIVATIONS = TBD   (reviewer: legacy effective-config
                                               + store.ts + buildSessionConfig
                                               are at least 3 effective-config
                                               derivation sites with different
                                               fallback orderings)
LEGACY_STATE_STILL_LOAD_BEARING       = TBD   (reviewer: state-migrations.ts,
                                               ProviderSettingsManager ctor's
                                               migrateLegacyProviderSettings,
                                               legacy-state-reader for tasks)
SESSION_FACTORY_OWNS_POLICY           = TBD
SESSION_FACTORY_OWNS_TRANSPORT_ONLY   = TBD
PROVIDERS_JSON_CANONICAL              = TBD
UPSTREAM_CORE_SETTINGS_SEAM_USABLE    = TBD
MODEL_PROFILES_BLOCKED_BY_MIGRATION   = TBD

SELECTED_OUTCOME = TBD
```

## Permitted outcomes (per §17)

```text
A. delete obsolete compatibility bridge(s)
B. consolidate effective-config derivation
C. migrate ownership toward existing @cline/core/@cline/llms seam
D. PASS_F3_NO_FACTORIZATION_NEEDED
```

## Recon hard rules

1. NO production edits before the discriminator table is fully frozen.
2. NO test edits before recon identifies an actual behavioral invariant
   the current implementation violates.
3. NO architectural refactor of `cline-session-factory.ts` until at least
   the persistent-authority, effective-config-derivation, and
   legacy-state-load-bearing questions are answered.
4. PRECEDENCE ORDERING EVIDENCE: every site that reads from both
   `StateManager.getApiConfiguration()` and
   `getProviderSettingsManager().getProviderSettings(...)` MUST be
   enumerated, with which store is PRIMARY and which is FALLBACK, and
   whether the two values are ever allowed to disagree.
5. MIGRATION STATUS: every legacy bridge MUST be classified as
   `LIVE_LOAD_BEARING`, `IDEMPOTENT_ONE_SHOT`, `DEAD_CODE`, or
   `UPSTREAM_OWNED` (i.e. lives in @cline/core).

## Discriminator resolution approach

Recon proceeds in 4 phases:

**Phase 1** — trace every reader/writer of `globalState.json`,
`secrets.json`, `providers.json`, and the in-memory caches of
StateManager / ProviderSettingsManager.

**Phase 2** — for every multi-source read, freeze the precedence
ordering (PRIMARY + FALLBACK semantics) and whether the sites agree on
which store is authoritative.

**Phase 3** — for every legacy bridge (workspace→global, classic
provider→SDK provider, pre-SDK tasks→SDK session), classify as
LIVE_LOAD_BEARING / IDEMPOTENT_ONE_SHOT / DEAD_CODE / UPSTREAM_OWNED.

**Phase 4** — evaluate the 9 discriminators above and pick Outcome A/B/C/D.

## Evidence files (7 files, .factory/evidence/ACT-.../)

```
00-preflight.txt                   — repo state, hash freeze, evidence-board check
01-production-chain.md             — file-by-file authority + reader/writer map
02-authority-and-trust-boundaries.md — trust-boundary enumeration + duplication check
03-discriminator.md                — discriminator evaluation, with verdicts
04-existing-test-inventory.md      — T-matrix mapping with INHERITED_EXECUTED_GREEN labels
05-characterization.txt            — RED/GREEN boundary inventory
06-outcome.md                      — Outcome A/B/C/D selection + review-algorithm answers
07-final-report.md                 — closure identity (non-circular), hygiene, summary
```

## Cross-references

- **§17 RED authorization**: Outcome D does not require re-running the
  test suite; Outcomes A/B/C only require it if recon identifies an
  actual behavioral or structural invariant the current implementation
  violates.
- **§30 successor rule**: return to F0 scorecard; the prior F2 closure
  was the trigger that surfaced F3 as the next high-value lane.
- **Live-bug backlog** (registered but not interrupting F3):
  `ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01`
  (MiniMax `1.3M → 24.6k` observation). Priority escalation gated on
  proving the wrong-model-window authority is affecting automatic
  compaction thresholds rather than merely displaying raw W.

## State

```text
REPO              = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
BRANCH            = main
F1 closure SHA    = e06af528522ae2aa471aac9eed30acb51e9fdf92
F2 closure SHA    = 6917d0c4e22a06953bd467b618017ec4e0412a9c
   (the board transition commit; carries
    the closure-evidence correction SHA
    c102f9fa0fe50d0a1619a083d43826f793ef4850)
PRODUCTION_HEAD   = e06af528522ae2aa471aac9eed30acb51e9fdf92 (= F1 closure,
                    unchanged by F2; F2 was recon-only)
CURRENT HEAD      = 6917d0c4e22a06953bd467b618017ec4e0412a9c
F2 verdict        = PASS_F2_NO_FACTORIZATION_NEEDED
F2 state          = CLOSED
F3 state          = RECON_IN_PROGRESS
```

## Range hygiene inheritance

```text
INHERITED_F0_F1_EOF_RESIDUE = 12 EOF warnings on .factory/ paths
                                  (per F2 seventy-ninth-pass separation)
F3_OWN_EOF_TARGET           = 0
PRODUCTION_EOF_TARGET       = 0
TEST_EOF_TARGET             = 0
```

## Reviewer (eighty-third-pass target)

```text
ACT-EXPECTED-REVIEW:
  F3 architectural recon is expected to either
  (a) surface a real duplication that is cheap to remove (Outcome A/B), OR
  (b) confirm the seam is already converged and stop F3 (Outcome D)

  Outcome C (migrate ownership toward @cline/core/@cline/llms) is permitted
  but should be the highest bar — requires evidence that the current host
  layer duplicates authority the SDK could own, not merely that the
  hierarchy is awkward.
```

## Stop conditions

F3 recon MUST terminate with one of:
```text
PASS_F3_NO_FACTORIZATION_NEEDED (Outcome D)
   — recon evidence shows that the seam is converged:
     one durable authority, one semantic rule set, one effective-config
     derivation, request-bound snapshots, defense-in-depth is preserved,
     and no further consolidation would reduce complexity without
     weakening the trust boundary.

PASS_F3_DELETE_OBSOLETE_BRIDGE(S) (Outcome A)
   — recon evidence shows a bridge is DEAD_CODE / IDEMPOTENT_ONE_SHOT
     and can be removed without affecting the surviving readers.

PASS_F3_CONSOLIDATE_EFFECTIVE_CONFIG (Outcome B)
   — recon evidence shows that two or more sites derive EffectiveProviderConfig
     with inconsistent fallback orderings, and a single canonical derivation
     site can replace them.

PASS_F3_MIGRATE_TO_UPSTREAM_SEAM (Outcome C)
   — recon evidence shows that @cline/core / @cline/llms already expose
     the exact facility the host duplicates, and a host adapter removal
     is straightforward.
```

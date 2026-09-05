# 15 — Factorization Scorecard

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** rank candidate seams per ACT §20 (`A`–`H` rubric).
**Evidence label:** STRUCTURAL + INFERRED (per ACT §29 honest-labels rule)

---

## Rubric (from ACT §20)

| Letter | Meaning | Weight |
|---|---|---:|
| A | AUTHORITY_AMBIGUITY | ×3 |
| B | DUPLICATION | ×2 |
| C | CHANGE_RADIUS | ×2 |
| D | CORRECTION_DENSITY | ×2 |
| E | UPSTREAM_MERGE_FRICTION | ×1 |
| F | TESTABILITY | ×1 |
| G | DELETION_OPPORTUNITY | ×2 |
| H | PRODUCT_RISK | ×2 |

`FACTOR_SCORE = 3A + 2B + 2C + 2D + E + F + 2G + 2H` (max 75).

Higher = stronger factorization candidate.

---

## Candidates

### A. Working-context capture: consolidate dual-writer SHADOW into canonical-only

**Description.** `WorkingContextHostCapture` (§6 entry #1) is a host-side cache of the canonical W with **two writers**: `observe(event)` (canonical path) and `setLatest(estimate)` (the manual-bypass added by `ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01`). The `setLatest` method exists because the manual-compaction producer (`sdk-compaction.ts`) does not flow through the canonical runtime-event subscription.

The bounded repair: make `sdk-compaction.ts` publish via the canonical subscription path (or make `WorkingContextHostCapture` the single publisher, period). Result: one writer, one source of truth, deletion predicate satisfied.

| Letter | Score | Reasoning |
|---|---:|---|
| A — AUTHORITY_AMBIGUITY | **5** | Two writers, both fork-introduced, no explicit precedence rule |
| B — DUPLICATION | **4** | The bypass `setLatest` is essentially a re-implementation of the canonical write |
| C — CHANGE_RADIUS | **4** | Touches `SdkController.ts` (~10 LOC), `sdk-compaction-coordinator.ts`, `working-context-host-capture.ts`, and the `setLatest` callsite |
| D — CORRECTION_DENSITY | **4** | 3 ACTs + 1 bounded P1 in this seam alone |
| E — UPSTREAM_MERGE_FRICTION | **3** | Reduces `SdkController.ts` LOC; merges cleanly |
| F — TESTABILITY | **5** | Has explicit `forTest(initial)` seam; multiple existing tests |
| G — DELETION_OPPORTUNITY | **5** | Removes the `setLatest` workaround entirely |
| H — PRODUCT_RISK | **4** | Removes the recently-fixed dual-writer bug; reduces risk of regression |
| **FACTOR_SCORE** | | **3·5 + 2·4 + 2·4 + 2·4 + 3 + 5 + 2·5 + 2·4 = 15+8+8+8+3+5+10+8 = 65** |
| IMPLEMENTATION_SIZE | **S** | < 100 LOC change across 4 files |
| BLAST_RADIUS | **LOW** | One canonical path, one deletion target |

### B. SdkController residual-authority reduction

**Description.** §13 catalogued ~31 direct responsibilities in `SdkController.ts` that are stable glue. Extract the diagnostic/telemetry attachment, the post-terminal-authority diagnostic, and the override-plumbing callbacks into named modules.

| Letter | Score | Reasoning |
|---|---:|---|
| A — AUTHORITY_AMBIGUITY | **3** | Some, but not all are authority-ambiguous |
| B — DUPLICATION | **2** | Not a duplication problem; it's a coupling problem |
| C — CHANGE_RADIUS | **5** | `SdkController.ts` is the highest-radius file (160 fork commits) |
| D — CORRECTION_DENSITY | **2** | No specific correction cluster on SdkController itself |
| E — UPSTREAM_MERGE_FRICTION | **5** | Reducing this file's size directly reduces upstream merge cost |
| F — TESTABILITY | **2** | Requires characterization tests first |
| G — DELETION_OPPORTUNITY | **3** | Reduces surface but doesn't delete anything |
| H — PRODUCT_RISK | **3** | Refactor-only, no new behavior |
| **FACTOR_SCORE** | | **3·3 + 2·2 + 2·5 + 2·2 + 5 + 2 + 2·3 + 2·3 = 9+4+10+4+5+2+6+6 = 46** |
| IMPLEMENTATION_SIZE | **M** | 200–500 LOC across ~5 files |
| BLAST_RADIUS | **MEDIUM** | All coordinators depend on SdkController; extraction is invasive |

### C. `cline-session-factory.ts` legacy-fallback consolidation

**Description.** §7 / §14 call out 1,238 LOC of provider/model/key resolution that falls back to legacy `ApiConfiguration` fields. The canonical lives in the SDK's `providers.json` (managed by `ProviderSettingsManager`). The legacy fallback is `ACTIVE_MIGRATION`.

| Letter | Score | Reasoning |
|---|---:|---|
| A — AUTHORITY_AMBIGUITY | **3** | The SDK is canonical for new data; legacy fields are read as fallback |
| B — DUPLICATION | **4** | Two parallel resolvers (SDK + host) for the same semantic |
| C — CHANGE_RADIUS | **3** | Touches the SDK + host on every provider-related change |
| D — CORRECTION_DENSITY | **2** | No specific correction cluster on this file (yet) |
| E — UPSTREAM_MERGE_FRICTION | **3** | Fork-invented file, low upstream activity |
| F — TESTABILITY | **2** | No direct tests; would need characterization |
| G — DELETION_OPPORTUNITY | **5** | Once all data is migrated, this file becomes deletable |
| H — PRODUCT_RISK | **5** | Model Profiles MUST navigate this file |
| **FACTOR_SCORE** | | **3·3 + 2·4 + 2·3 + 2·2 + 3 + 2 + 2·5 + 2·5 = 9+8+6+4+3+2+10+10 = 52** |
| IMPLEMENTATION_SIZE | **M–L** | 500–1500 LOC across 5+ files; needs migration coordination |
| BLAST_RADIUS | **MEDIUM–HIGH** | All provider/model consumers affected |

### D. Temporary-external-path-authority single-writer

**Description.** The `TEMPORARY-EXTERNAL-PATH-AUTHORITY` family has 6 correction rounds — the highest in the factory. The root cause is that `temporaryExternalCanonicalRoots` is computed and threaded through the command-approval pipeline by multiple producers (`sdk-tool-policies.ts` builder, `SdkController.resolveActiveTemporaryExternalCanonicalRoots()`, command-policy).

| Letter | Score | Reasoning |
|---|---:|---|
| A — AUTHORITY_AMBIGUITY | **4** | Multiple producers, no single owner of "what is the active temp-authority set" |
| B — DUPLICATION | **3** | Resolution logic exists in 3+ places |
| C — CHANGE_RADIUS | **4** | High (touches core path-authority + host sdk-tool-policies + SdkController) |
| D — CORRECTION_DENSITY | **5** | 6 corrections, the highest of any factory ACT family |
| E — UPSTREAM_MERGE_FRICTION | **3** | Mostly fork-only; small upstream impact |
| F — TESTABILITY | **4** | Path-authority realpath test exists; hosts well |
| G — DELETION_OPPORTUNITY | **3** | Hard to delete; the seam itself needs to be cleaner |
| H — PRODUCT_RISK | **4** | Security-relevant; messy threading invites future bugs |
| **FACTOR_SCORE** | | **3·4 + 2·3 + 2·4 + 2·5 + 3 + 4 + 2·3 + 2·4 = 12+6+8+10+3+4+6+8 = 57** |
| IMPLEMENTATION_SIZE | **S** | Threading already works; the cleanup is to centralize the producer |
| BLAST_RADIUS | **LOW** | Surgical change to one seam |

### E. Settings-keys-in-host-shared consolidation

**Description.** §14 entry #9: 88 planMode/actMode state keys live in `apps/vscode/src/shared/storage/state-keys.ts`. This mirrors the canonical `@cline/core` settings schema. Model Profiles would have to coordinate across both layers.

| Letter | Score | Reasoning |
|---|---:|---|
| A — AUTHORITY_AMBIGUITY | **3** | Host reads + writes, core reads; mirror is implicit |
| B — DUPLICATION | **3** | Mirror of `core/src/types/chat-schema.ts` keys |
| C — CHANGE_RADIUS | **2** | Stable; rarely changed |
| D — CORRECTION_DENSITY | **1** | No correction cluster |
| E — UPSTREAM_MERGE_FRICTION | **2** | Fork-only; low |
| F — TESTABILITY | **3** | Easy to test |
| G — DELETION_OPPORTUNITY | **4** | Could collapse to a typed per-mode config owned by core |
| H — PRODUCT_RISK | **5** | Blocks Model Profiles from being clean |
| **FACTOR_SCORE** | | **3·3 + 2·3 + 2·2 + 2·1 + 2 + 3 + 2·4 + 2·5 = 9+6+4+2+2+3+8+10 = 44** |
| IMPLEMENTATION_SIZE | **M** | Touches `state-keys.ts` + `global-settings.ts` + Model Profiles boundary |
| BLAST_RADIUS | **MEDIUM** | Provider config UI depends on these keys |

### F. Path-authority: shared observation primitive (per ACT §23)

**Description.** §8 and §23: the fork has TWO path-authority implementations (`editor-path-authority.ts` and `command-policy/path-authority.ts`) with different precision. ACT §23 concluded "shared canonical-path observation primitive = useful; shared policy = WRONG". This candidate is to extract the *observation* primitive (realpath canonicalization) but keep the policies separate.

| Letter | Score | Reasoning |
|---|---:|---|
| A — AUTHORITY_AMBIGUITY | **2** | Both are intentional and labelled |
| B — DUPLICATION | **3** | Both compute "is X inside workspace?" |
| C — CHANGE_RADIUS | **3** | Touches both, plus command-policy |
| D — CORRECTION_DENSITY | **4** | Editor ACT + temp-external ACT both touch path authority |
| E — UPSTREAM_MERGE_FRICTION | **2** | Fork-only |
| F — TESTABILITY | **5** | Path tests are very tractable |
| G — DELETION_OPPORTUNITY | **2** | Doesn't delete anything; just shares the lower layer |
| H — PRODUCT_RISK | **3** | Defense against symlink escape; long-term correctness |
| **FACTOR_SCORE** | | **3·2 + 2·3 + 2·3 + 2·4 + 2 + 5 + 2·2 + 2·3 = 6+6+6+8+2+5+4+6 = 41** |
| IMPLEMENTATION_SIZE | **S** | New module; ~100 LOC |
| BLAST_RADIUS | **LOW** | Strictly additive |

---

## Scorecard summary

| Rank | Candidate | Score | Size | Blast |
|---:|---|---:|---|---|
| **1** | **A. Working-context capture: dual-writer → single** | **65** | S | LOW |
| 2 | D. Temp-external-path-authority single-writer | 57 | S | LOW |
| 3 | C. cline-session-factory legacy-fallback | 52 | M–L | MEDIUM |
| 4 | B. SdkController residual-authority | 46 | M | MEDIUM |
| 5 | E. Settings-keys consolidation | 44 | M | MEDIUM |
| 6 | F. Shared path-observation primitive | 41 | S | LOW |

## Top three candidates (per ACT §22)

1. **A — Working-context capture (65)**. Strongest on all dimensions. Small size, low blast, existing test seam.
2. **D — Temp-external-path-authority single-writer (57)**. Highest correction density. Surgical.
3. **C — `cline-session-factory.ts` consolidation (52)**. Largest size and blast, but the Model Profiles precondition.

## The single best successor (per ACT §28, §41)

**Candidate A** is the highest-leverage bounded seam:
- One semantic value (W)
- Two writers → one canonical
- High correction density (3 ACTs + 1 bounded P1)
- High co-change radius (working-context-host-capture.ts, sdk-compaction-coordinator.ts, SdkController.ts)
- Strong existing tests
- Small/medium repair (~100 LOC across 4 files)
- Removes a recently-fixed-but-not-fully-closed bug class
- Has a clear deletion predicate for `setLatest`


---

## Correction addendum (C1 closure 2026-09-05)

**Candidate A scoring depends on the SHADOW-vs-CACHE discriminator**.

Under the weakened `CACHE_OR_SHADOW_HYPOTHESIS` classification
(see `07-compatibility-shadow-inventory.md` addendum), Candidate A's 65/75
is a **ceiling** that holds only if the discriminator resolves to Outcome A
(runtime state genuinely changes) or Outcome C (core already exposes a
shared seam).

Under Outcome B (two legitimate producers with one cache), the factorization
target becomes **unify to one assignment primitive** rather than
**delete `setLatest`**. The score is still in the 60s; selection still
holds, but the deletion predicate changes.

Scorecard note for any future re-rank:

```
Candidate A
  OLD interpretation: SHADOW -> delete setLatest
  NEW interpretation: CACHE_OR_SHADOW_HYPOTHESIS
    -> DEFER final score until F1 recon
    -> ceiling is unchanged at 65; floor depends on outcome

Candidate B (SdkController decomposition)
  PACKAGE_LAYERING impact: 0 (independent of agents/core boundary)
  Note: removal of the BOUNDARY_VIOLATION_CANDIDATE flag on clinemm->agents
        does NOT raise B's score; B's challenges are SdkController.ts size
        and merge friction, both unchanged.
```

Selection still: A first, then D, then C.

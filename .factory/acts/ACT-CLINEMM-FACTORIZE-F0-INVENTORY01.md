# ACT-CLINEMM-FACTORIZE-F0-INVENTORY01

> Status: **PASS_WITH_ONE_BOUNDED_P1 / RECON-ONLY / C1: GO** (closure review applied 2026-09-05).
> Verdict: **PASS_WITH_ONE_BOUNDED_P1** — INVENTORY accepted; SUCCESSOR `ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01` accepted; PRESELECTED F1 IMPLEMENTATION **NOT YET ACCEPTED** (F1 must start with the discriminator in `19-closure-correction.md`).

## Identity

| Field | Value |
|---|---|
| ENTRY_HEAD | `a523f9471325f4b39488d4f9744d82a0b02cffce` |
| ENTRY_TREE | `f3875422d887da92d3c38b831bd40f0d20f14c97` |
| FINAL_HEAD | `a523f9471325f4b39488d4f9744d82a0b02cffce` |
| BRANCH | `main` |
| WORKTREE | clean (apart from F0 evidence + .gitignore entry) |

## Continuity

| Field | Value |
|---|---|
| PREVIOUS_PAUSE | none — F0 had not previously been executed |
| RESUME_STATUS | not applicable |
| F0_RESUME | YES |

## Production changes

**FORBIDDEN. ZERO PRODUCTION CODE TOUCHED.** Recon-only. Evidence files only.

## Headline findings

1. The Cline-- package dependency graph is **acyclic and one-way** (shared → llms → agents → core → sdk → hosts). No upstream layering violations. The fork's only `host→host` edge (`@cline/cli → @cline/cline-hub`) is intentional composition.
2. The fork's center of gravity is **`apps/vscode/src/sdk/`** (250 of 376 host-side fork-changed files). The second-largest fork-only subsystem is `sdk/packages/core/src/runtime/command-policy/` (12 large new files, ~3,000 LOC). `sdk/packages/llms/` and `sdk/packages/shared/` are nearly untouched (8 files combined).
3. There are **16 fork-only host coordinators** — 11 TRANSPORT_ADAPTER, 3 STATE_PROJECTION, 2 POLICY_COMPOSER, **0 LIFECYCLE_OWNER**. The single host-side lifecycle owner is `CommandJobManager`.
4. `SdkController.ts` has **doubled** in size (2,388 → 4,679 LOC) and is touched in **160 fork commits** vs 71 upstream commits. It is the largest upstream merge-friction surface in the fork.
5. The fork has **3 multi-authority candidates** for the working-context state `W`. The most concerning is `WorkingContextHostCapture`, a host-side cache of `W` with **two write ingresses**: `observe(event)` (canonical runtime-event subscription) and `setLatest(estimate)` (the manual-compaction bypass added by `ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01`). **C1 reviewer corrected**: this is best classified as `CACHE_OR_PROJECTION_WITH_MULTIPLE_WRITE_INGRESSES`; `DUAL_SEMANTIC_AUTHORITY` is **NOT YET PROVEN**; `SINGLE_INGRESS_DESIRABLE` is **HYPOTHESIS TO TEST** in F1 recon.
6. Highest correction-density seam: `TEMPORARY-EXTERNAL-PATH-AUTHORITY` family (6 correction rounds). Second: `RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR` (5 rounds). Both touch the same architectural shape: a single semantic value that flows through multiple stages, each independently mutable.
7. The fork has **2 ACTIVE_MIGRATION bridges** that account for ~1,750 LOC of legacy-fallback code: `cline-session-factory.ts` (1,238 LOC) and `model-catalog/effective-config.ts` (403 LOC) + `provider-migration.ts` (112 LOC). All target the SDK's `providers.json` as the destination.
8. **No P0 discovered.** The fork is in a stable closure state after the editor authority and post-compaction W ACTs.

## Top three factorization candidates (per scorecard)

| Rank | Candidate | Score | Size | Blast |
|---:|---|---:|---|---|
| 1 | A. Working-context capture (dual-writer → single) | **65/75** | S | LOW |
| 2 | D. Temp-external-path-authority single-writer | 57/75 | S | LOW |
| 3 | C. `cline-session-factory.ts` consolidation | 52/75 | M–L | MEDIUM–HIGH |

## Selected successor

```
NEXT_ACT = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
```

**F1 starting mode is RECON -> CHARACTERIZATION -> BOUNDED FACTORIZATION, not direct refactor.**

F0's preselected F1 implementation ("delete `setLatest`; route manual
compaction through the canonical runtime-event subscription") is **NOT YET
ACCEPTED**. F1 must first capture the normal-turn and manual-compaction
chains and answer SAME_SEMANTIC_STATE / SAME_OWNER / SAME_EVENT_DOMAIN before
choosing one of three permitted outcomes (A: delete setLatest, B: unify to
one assignment primitive, C: use a shared W publication seam; B-prime:
NOT_FACTORIZABLE_AS_SINGLE_EVENT_SOURCE). See
`.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/19-closure-correction.md`
for the full F1 starting state.

## Residue

- **P0**: none
- **P1**: candidates C and E are Model Profiles preconditions; only if Model Profiles starts
- **P2**: candidate B (SdkController decomposition) — long-term architecture debt

## Artifacts

19 evidence files in `.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/`:

```
00-preflight.txt
01-package-inventory.md
02-dependency-graph.md
03-fork-delta.md
04-fork-architecture-nouns.md
05-coordinator-inventory.md
06-state-authority-map.md
07-compatibility-shadow-inventory.md
08-semantic-duplication.md
09-change-radius.md
10-correction-density.md
11-test-seams.md
12-upstream-friction.md
13-sdkcontroller-responsibility-map.md
14-package-boundary-diff.md
15-factorization-scorecard.md
16-local-architecture-invariants.md
17-recommendation.md
18-final-report.md
19-closure-correction.md   <- C1 closure review disposition
```

Correction addendums applied in-place to: `01`, `04`, `07`, `10`, `15`, `17`, `18`.

## Stop conditions

- HALT_UNEXPECTED_TRACKED_DIRT: not triggered
- HALT_PREDECESSOR_P0: not triggered
- HALT_SCOPE_VIOLATION: not triggered (zero production changes)
- HALT_FACTORIZE_FOR_P0: not triggered (no P0 discovered)
- CAPTURE_INSUFFICIENT: not triggered

## Git

| Field | Value |
|---|---|
| COMMITS | 0 (recon-only) |
| PUSHED | NO |
| FORCE_PUSHED | NO |
| WORKTREE | clean apart from F0 evidence + .gitignore entry |

## Verdict

**PASS_WITH_ONE_BOUNDED_P1** with one selected successor: `ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01`. F1 must start with the discriminator in `19-closure-correction.md` (SAME_SEMANTIC_STATE / SAME_OWNER / SAME_EVENT_DOMAIN, then one of outcomes A/B/C/B-prime). C1: GO.

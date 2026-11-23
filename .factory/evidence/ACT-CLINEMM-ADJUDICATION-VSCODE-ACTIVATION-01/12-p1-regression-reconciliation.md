# 12 — P1 reconciliation: per-test-identity regression comparison

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01
**Classification:** STRUCTURAL
**Reviewer gate closed:** the `P1 — tighten the regression comparison once` item

## VERDICT

```
PASS — ZERO new failing-test identities
```

## Why this document exists

The CORRECTION01 digest demonstrated conservation by comparing **failing FILES**:

| Run | Test files | Failing files | Failing tests | Passing tests |
|---|---|---|---|---|
| baseline (correction stashed) | 546 | 63 | 169 | 6007 |
| corrected | 548 | 63 | 169 | 6027 |

Identical failing-file sets do NOT, by themselves, establish identical
failing-TEST identities: two failures could change inside one file while
both aggregate numbers stayed the same. The reviewer required the
comparison to be made at **individual test identity** granularity, using
the already-captured transcripts — no new full-suite execution.

## What was compared

The two full-suite transcripts already captured under `verification/` were
re-derived into **one canonical line per failing test**, then compared with
`comm`:

| Artifact | SHA-256 | Lines |

All three removed identities belong to **the ACT's own test files**. They are
the pre-correction RED witnesses of the producer seam that the correction
repaired:

- the runtime-chain bridge suite could not load against the pre-correction
  producer (the bridge file's whole suite was reported as one failing
  identity), and
- the two `RED-2` producer witnesses — "carries the authorized contract into
  the produced CoreSessionConfig" and "supplies a revision resolver that
  fails closed outside the workspace" — were failing because the
  pre-correction producer resolved the contract through `peekArmed()` and
  could not satisfy the resolver requirement.

**No pre-existing, non-ACT test changed state.** Every one of the 187
remaining failing identities is present, unchanged, in the baseline. The
regression surface is therefore exactly the pre-existing baseline: 187
identities, all pre-existing, none introduced, none masked.

## Reconciliation with the aggregate counts

The aggregate numbers and the identity-level comparison agree:

| Measure | Baseline | Corrected | Delta |
|---|---|---|---|
| Failing test identities | 190 | 187 | **−3** (all ACT-owned RED witnesses) |
| New failing identities | — | **0** | — |
| Failing files | 63 | 63 | 0 |

The earlier digest's "63 failing files / 169 failing tests" figures count the
suite-level and file-level rollups that vitest emits; the identity lists are
the exhaustive per-test expansion (190 / 187 lines) and are the stricter
measure. The stricter measure confirms the same conclusion: **zero
regressions**.

## Conclusion

The reviewer's P1 evidence gap is **closed**. The conservation claim is now
established at individual test-identity granularity, not merely at
failing-file granularity, using transcripts captured during the original
two full-suite runs. No new full-suite execution was required, and none was
performed.

|---|---|---|
| `verification/vitest-failing-test-identities-entry-head-baseline.txt` | `4967c82def6aadfdc6988ade8e6663d6de8b30b6fb00215dbd0345e0386724dd` | 190 |
| `verification/vitest-failing-test-identities-final.txt` | `235c003db76174bcc569dda54d5820922b96743e1e0509caab53e19f1dc5662d` | 187 |


## Build gates re-verified at the commit boundary

Executed against the exact working tree that is committed:

| Gate | Command | Result |
|---|---|---|
| Typecheck | `tsc --noEmit` (apps/vscode) | **0 diagnostics** (exit 0) |
| Correction + producer suites | `vitest run --config vitest.config.ts` on the two ACT suites | **20/20 PASS** (5 producer + 15 correction) |
| Runtime-chain bridge suite | `vitest run --config vitest.config.c2-4-c-bridge.ts` | **13/13 PASS** |
| Coordinator + factory suites | `vitest run --config vitest.config.ts` on 7 files | **186/186 PASS** |
| Lint + format | `biome check` on the 13 changed files | **PASS** (0 errors) |

### The bridge typecheck baseline — the 5 diagnostics are pre-existing

`bun run check-types:c2-4-c-bridge` reports **5 ADDED** diagnostics against
a frozen baseline of `[]`. These are **NOT ACT-owned**. This was measured,
not assumed: the working tree was stashed (`git stash push --include-untracked`)
and the SAME command was re-run at the **entry HEAD** `7490a12a5`, where it
reported the **identical** 5 diagnostics. The canonical diagnostic tuples
diffed **EMPTY** between entry HEAD and the corrected tree.

None of the 5 diagnostic files are in the ACT's production delta:

| Diagnostic file | In the ACT delta? |
|---|---|
| `src/sdk/__tests__/completion-continuation-delivery-seam01.ccds01.c24-c-bridge.test.ts` | NO |
| `src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts` | NO |
| `src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01-correction01.test.ts` | NO |
| `src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01.test.ts` | NO |
| `src/sdk/automatic-incident-export.ts` | NO |

They are pre-existing errors in the wider bridge project that the bridge
project's own frozen baseline does not yet enumerate. The ACT's config
changes only **ADD** an include entry and two path aliases for the
adjudication continuity modules; they do not touch any of the 5 files, and
they do not introduce a new diagnostic.

**ACT-owned diagnostics: 0.**

Each line is a fully-qualified test identity — the suite path, the `describe`
chain and the test name — so two failures in the same file are distinguishable.

The supporting full-suite transcripts are preserved unchanged:

| Artifact | SHA-256 |
|---|---|
| `verification/vitest-base-entry-head-baseline.txt` | `6a5bf81dbf9f8f3678001c096834aa6de7379afaab026335169765e640dbc18c` |
| `verification/vitest-base-final.txt` | `080815766e4945c03de0ac92045b513377c600058ab6d25bc5b4219f0a7c87ff` |

## The comparison

```
=== FAILING-TEST IDENTITIES ONLY IN THE CORRECTED RUN (must be empty) ===
=== END ===
```

**EMPTY.** The correction introduced **zero** new failing-test identities.

```
=== FAILING-TEST IDENTITIES ONLY IN THE BASELINE RUN ===
src/sdk/__tests__/adjudication-vscode-activation01.runtime-chain.c24-c-bridge.test.ts [ src/sdk/__tests__/adjudication-vscode-activation01.runtime-chain.c24-c-bridge.test.ts ]
src/sdk/__tests__/adjudication-vscode-activation01.test.ts > ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01 — VS Code runtime config producer > RED-2 — explicit opt-in reaches the runtime configuration > carries the authorized contract into the produced CoreSessionConfig
src/sdk/__tests__/adjudication-vscode-activation01.test.ts > ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01 — VS Code runtime config producer > RED-2 — explicit opt-in reaches the runtime configuration > supplies a revision resolver that fails closed outside the workspace
```

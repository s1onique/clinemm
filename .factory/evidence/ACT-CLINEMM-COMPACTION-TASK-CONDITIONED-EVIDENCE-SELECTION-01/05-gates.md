# 05 — The gates

ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01

## The executable gates

| gate | file | result |
|---|---|---|
| **Section-boundary RED/GREEN** | `source-bound-evidence.section-boundary.correction01.test.ts` | **RED 7/11 failed → GREEN 11/11** |
| **Revocation witnesses** | `source-bound-evidence.revocation.correction01.test.ts` | **RED 4/8 failed → GREEN 8/8** |
| **Corrected source-prefix / projector witnesses** | `task-conditioned-evidence-selection.projection.correction01.test.ts` | **3/3** |
| **Selector adversarial witnesses** | `task-conditioned-evidence-selection.correction01.test.ts` | **19/19** |
| **Confidentiality witnesses** | `task-conditioned-evidence-selection.confidentiality.correction01.test.ts` | **12/12** |
| **Scoring-scope witnesses** | `knowledge-loss-discriminator/scoring-scope.correction01.test.ts` | **6/6** |
| **Structural ablation** | `scripts/task-conditioned-selection-evaluation.ts` | `critOmitted 5 → 3`, `O7 OMITTED → PARTIALLY_PRESERVED` |
| **Existing context and publication-trust suites** | `sdk/packages/core` context suite | **1132 passed, 2 skipped, 0 failed** (80 files) |
| **Relevant typecheck** | `sdk/packages/core` `tsc --noEmit` | **108 diagnostics** (baseline 109; **zero** ACT-owned) |
| **SDK build** | `bun run build:sdk` | **PASS** |
| **Biome** | `bun biome check` on every ACT-owned file | **PASS** (0 findings) |
| **git diff hygiene** | `git diff --check` | **CLEAN** |
| **VSIX packaging** | — | **NOT EXECUTED** |
| **Installed-live** | — | **NOT EXECUTED** |

## The full SDK suite

```
Test Files  17 failed | 403 passed | 3 skipped (423)
Tests       113 failed | 6242 passed | 162 skipped (6517)
```

The 17 failing files are **pre-existing and environment-dependent**. They
were verified against the **stashed predecessor**: the same 17 files fail
with the same 113 tests (20 + 93) on `428bf3028`. None of them is in
`src/extensions/context/`.

```
composio-tools-extension, bash.supervised.bash-startup-env, checkpoint-hooks,
hub-runtime-host, hub/server/{boundary,cloud-session-service,fetch-wiring,
hub-plugins,index,replay-wire,ui-events}, hub/settings,
path-authority.temporary-external, seatbelt-availability, sandbox-backend,
checkpoint-restore, persistence-service
```

**NEW_REGRESSIONS = 0.**

## The ACT-owned test inventory

| file | tests | what it witnesses |
|---|---|---|
| `source-bound-evidence.section-boundary.correction01.test.ts` | 11 | the reviewer's counterexample; escaped begin/end; both markers; truncated sections; duplicate sections; convergence; the malformed cases |
| `source-bound-evidence.revocation.correction01.test.ts` | 8 | enabled→disabled; previously admitted→newly refused; nonempty→empty selection; the clean default-OFF behaviour |
| `task-conditioned-evidence-selection.correction01.test.ts` | 19 | the invocation correlation and its five fail-closed rules; the neighbouring-subject case; the synthetic holdout; the call-input signal; the unbudgeted admission; the minimal source window; fail-closed budgets; determinism |
| `task-conditioned-evidence-selection.projection.correction01.test.ts` | 3 | the projector's acceptance; the forbidden construction's refusal; the prefix-vs-tail distinction |
| `task-conditioned-evidence-selection.confidentiality.correction01.test.ts` | 12 | the sensitive paths; the credential bodies; the forged boundaries; the forged identity; the authority conservation |
| `knowledge-loss-discriminator/scoring-scope.correction01.test.ts` | 6 | the decomposition; the per-mechanism attribution; the masking defence |

**53 new ACT-owned witnesses**, all passing.

## The production delta

```
sdk/packages/core/src/extensions/context/section-delimiters.ts                (NEW)
sdk/packages/core/src/extensions/context/task-conditioned-evidence-selection.ts (NEW)
sdk/packages/core/src/extensions/context/source-bound-evidence.ts              (MODIFIED)
sdk/packages/core/src/extensions/context/evidence-continuity.ts                (MODIFIED)
sdk/packages/core/src/extensions/context/compaction.ts                         (MODIFIED)
sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/
    context-parts.ts                                                          (MODIFIED)
    inventory.ts                                                              (MODIFIED)
```

No new persistent store, no database, no retrieval service, no protocol
message, no public wire field, no new inference request.

## The default-OFF state

`SOURCE_BOUND_EVIDENCE_CARRY_FORWARD_ENABLED = false` — unchanged.

The PCK remains default OFF. The source-bound evidence remains default OFF.
The revocation step is unconditional **within** the switch, so turning the
switch off revokes everything it carried.

## The privacy of the raw material

Every raw history, rendered context, prompt and model answer stays in the
**gitignored** `tmp/task-conditioned-selection/` tree. The committed evidence
contains only AGGREGATE, non-reversible facts: counts, digests, scores and
redacted descriptions.

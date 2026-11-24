# 09 — Executable gates

## The thirteen required receipts

| # | Receipt | Result | Where |
|---|---|---|---|
| 1 | Frozen artifact hashes and exact canonical prefix correlation | **PASS** | `verification/frozen-artifact-hashes.txt`, `visibility-red.test.ts` G2.1 / G2.2 |
| 2 | Source-map verification | **PASS** | `02-production-source-map.md`, `visibility-red.test.ts` G2.4 |
| 3 | Reproduced baseline source-visibility RED | **PASS** | `visibility-red.test.ts` G2.3 / G2.5 / G2.6 / G2.7 |
| 4 | Candidate A/B/C structural comparison | **PASS** | `visibility-red.test.ts` G2.3 / G2.5, `04-candidate-input-matrix.md` |
| 5 | Private-reasoning and content-origin controls | **PASS** | `reasoning-boundary.test.ts` G1.3.1 / G1.3.2 / G1.3.3 |
| 6 | Tool-result provenance and unrelated-reference counterexamples | **PASS** | `trust-provenance.test.ts` G4.1 / G4.1.7, `security-controls.test.ts` G4.3.7 / G4.3.9 |
| 7 | Record-selection control / treatment / ablation | **PASS** | `selection.test.ts` G5.1 / G5.1.2 / G5.2 / G5.3 |
| 8 | Controlled model-generation results | **PASS** | `model-evaluation.test.ts` G6.2 (R4, R2, R6, OVER-CLAIM) |
| 9 | Synthetic oracle through the REAL compaction seam | **PASS** | `causal-ablation.test.ts` G7.1 |
| 10 | Causal ablation and conservation | **PASS** | `causal-ablation.test.ts` G7.1 / G7.1.2 / G7.2 / G7.2.2 / G7.3 / G7.4 |
| 11 | Focused context-suite regression | **PASS** | `verification/context-suite-regression.txt` |
| 12 | Typecheck and Biome on the ACT-owned files | **PASS** | `verification/typecheck.txt`, `verification/biome.txt` |
| 13 | Production-source delta equals zero | **PASS** | `verification/production-delta.txt` (EMPTY) |

## The ACT-owned focused suite

```text
$ bunx vitest run --config vitest.config.ts src/extensions/context/source-visibility-discriminator/

 Test Files  7 passed (7)
      Tests  47 passed (47)
```

| File | Tests |
|---|---|
| `visibility-red.test.ts` | 7 |
| `reasoning-boundary.test.ts` | 3 |
| `trust-provenance.test.ts` | 6 |
| `security-controls.test.ts` | 10 |
| `selection.test.ts` | 8 |
| `model-evaluation.test.ts` | 7 |
| `causal-ablation.test.ts` | 6 |
| **total** | **47** |

## The focused context-suite regression

```text
$ bunx vitest run --config vitest.config.ts src/extensions/context/

 Test Files  47 passed | 1 skipped (48)
      Tests  769 passed | 2 skipped (771)
```

**0 failed.** The one skipped file is `compaction.live.test.ts`, which is
live-only and was already skipped before this ACT.

### The historical intentional-RED configuration is UNCHANGED

```text
$ bunx vitest run --config vitest.red.adjudication-continuity-red01.config.ts

 Test Files  1 failed (1)
      Tests  5 failed (5)
```

The historical thinking-only adjudication RED is **still RED**. It was not
flipped to GREEN, not weakened, and its vitest configuration was not
modified (`git diff HEAD -- sdk/packages/core/vitest.config.ts` is EMPTY).

## Typecheck

```text
$ bun tsc -p tsconfig.dev.json --noEmit

ACT-owned diagnostics (source-visibility-discriminator):  0
Baseline diagnostics (all pre-existing files):            44
```

**ACT-owned diagnostics: ZERO.** The 44 baseline diagnostics are all in
pre-existing files that this ACT did not touch. The count was **44 before**
this ACT and **44 after** — the ACT added zero.

The baseline files are:

```text
../shared/src/runtime/prefix-forensics-analyzer.ts
src/extensions/context/compaction.latency-span-lifecycle.red01.test.ts
src/extensions/context/compaction.test.ts
src/extensions/context/compaction.working-context-ratio.test.ts
src/extensions/tools/definitions.test.ts
src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts
src/extensions/tools/executors/bash.supervised.test.ts
src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts
src/runtime/command-policy/command-execution-plan.test.ts
src/runtime/command-policy/parser-helper/runtime.real-binary.test.ts
src/runtime/command-policy/parser-provenance.test.ts
src/runtime/command-policy/path-authority.temporary-external.test.ts
src/runtime/command-policy/structured-command-risk.cd-cwd-authority.test.ts
src/runtime/command-policy/structured-command-risk.find-quoted-pattern.test.ts
src/runtime/observability/model-behavior-trace.test.ts
src/runtime/orchestration/session-runtime-orchestrator.tool-outcome-hook.tes02.test.ts
src/runtime/orchestration/session-runtime.model-behavior-trace.test.ts
```

## Biome

```text
$ bunx --bun @biomejs/biome check --no-errors-on-unmatched --files-ignore-unknown=true \
    sdk/packages/core/src/extensions/context/source-visibility-discriminator/ \
    sdk/packages/core/scripts/source-visibility-discriminator.generate.ts

Checked 14 files in 40ms. No fixes applied.
exit 0
```

## Production-source delta

```text
$ git --no-pager diff --stat HEAD
(empty)
```

**ZERO.** Every ACT path is a NEW untracked file:

```text
?? .factory/evidence/ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01/
?? sdk/packages/core/scripts/source-visibility-discriminator.generate.ts
?? sdk/packages/core/src/extensions/context/source-visibility-discriminator/
```

## The confidentiality posture

```text
Committed artifacts contain:
  - the source HEAD
  - the frozen artifact hashes
  - exact source paths and function identities
  - sanitized classifications
  - record counts
  - test names and statuses
  - token and latency measurements
  - synthetic counterexamples
  - evidence-class labels

Committed artifacts DO NOT contain:
  - any raw provider request
  - any canonical message content
  - any free-text model output
  - any private reasoning
  - any arbitrary tool result body
```

The raw model output and the generated checkpoints stay in the
gitignored `tmp/pck-src-vis-private/1795466566666_uzla2/` tree with mode
`0600`. The raw frozen captures stay in
`$HOME/clinemm-private-captures/1795466566666_uzla2/`.

**One caveat, stated explicitly.** The evidence documents quote a small
number of SHORT technical tokens — `kc.sh build`, `start --optimized`,
`connectTimeoutMillis(3_000)`, `=== changelog retention ===` — because those
tokens ARE the measurement. They are command fragments and source
identifiers, not credentials, and the ACT's own negative controls
establish that the trust gate does not treat such content as safe merely
because it appears here. They are quoted as the WITNESS of the
discriminator, not as a general licence to publish tool output.

## The P2 hygiene item

The targeted digest's invalid legacy `.factory/gate-summary.json` is a
SEPARATE P2 hygiene item. This ACT does not depend on it, did not modify
it, and does not report it as an authoritative gate result.

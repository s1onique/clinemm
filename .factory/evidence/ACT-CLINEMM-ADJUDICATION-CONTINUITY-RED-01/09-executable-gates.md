# 09 — Executable gates

All commands were executed in `sdk/packages/core` with `bun 1.4.4` and
`vitest 4.1.10`. **The results below are OBSERVED, not expected.**

> **Toolchain note.** `bun` is not on the default `PATH` in this shell. It was
> invoked as `export PATH="$HOME/.bun/bin:$PATH"` before each command. This is an
> environment fact, not a deviation from the ACT's suggested commands.

---

## Gate 1 — The focused RED (the required failure)

```bash
$ bun run test:red:adjudication-continuity-red01
```

*(equivalently: `bun x vitest run src/extensions/context/compaction.adjudication-continuity.red01.test.ts --config vitest.config.ts`)*

```
 ❯ src/extensions/context/compaction.adjudication-continuity.red01.test.ts (5 tests | 5 failed) 20ms
     × RED-1 (RED): the source-grounded qualified adjudication is present in canonical history and absent from the provider-visible continuation 10ms
     × RED-2 (RED): the qualified adjudication is absent from the provider-visible continuation once more than 12 later verified outcomes exist 3ms
     × RED-3 (RED): a thinking-block adjudication at any position cannot reach the summarizer, while the same adjudication in assistant text can 3ms
     × RED-4 (RED): the original finding survives in the task contract while its later qualified decision does not 1ms
     × RED-5 (RED): the historical shape loses the adjudication at the source-selection boundary, upstream of serialization 1ms

 Test Files  1 failed (1)
      Tests  5 failed (5)
```

**EXIT CODE = 1** — the required failure, as designed.

Run **three** times (see `05-red-reproduction.md` §3); the failing assertion lines
and the exit code are **identical** every time.

---

## Gate 2 — The existing compaction evidence-fidelity suite

```bash
$ bun x vitest run \
    src/extensions/context/compaction.evidence-fidelity01.test.ts \
    --config vitest.config.ts
```

```
 ✓ src/extensions/context/compaction.evidence-fidelity01.test.ts (39 tests) 18ms

 Test Files  1 passed (1)
      Tests  39 passed (39)
```

**EXIT CODE = 0** — unchanged from the baseline (39 passed at entry).

---

## Gate 3 — The whole context directory (default suite)

```bash
$ bun x vitest run src/extensions/context/ --config vitest.config.ts
```

```
 Test Files  27 passed | 1 skipped (28)
      Tests  479 passed | 2 skipped (481)
```

**EXIT CODE = 0.**

> The RED witness is **excluded** from this configuration, so the default gate is
> green. Before the exclusion was added, the same command reported
> `Tests  5 failed | 479 passed | 2 skipped (486)` with **EXIT 1** — that
> intermediate state is recorded here as evidence that the RED really was
> exercised by the default configuration before it was excluded.

---

## Gate 4 — The discriminator / ablation / controls suite

```bash
$ bun x vitest run \
    src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts \
    --config vitest.config.ts
```

```
 ✓ src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts (23 tests) 31ms

 Test Files  1 passed (1)
      Tests  23 passed (23)
```

**EXIT CODE = 0.**

Contents: 4 discriminators (A/B/C/D) · 1 necessity ablation (A/B/C) ·
8 security negative controls · 6 negative/positive controls ·
5 conservation controls.

---

## Gate 5 — Typecheck

```bash
$ bun tsc -p tsconfig.dev.json --noEmit
```

**EXIT CODE = 2** (pre-existing baseline failures).

| Measurement | Value |
|---|---|
| Total `error TS` diagnostics | **44** |
| Diagnostics attributable to **this ACT's** files (`*adjudication-continuity*`) | **0** |
| Baseline total with this ACT's files removed from the tree | **44** |

The baseline was measured by stashing this ACT's three new source files and
re-running the same command: **44 → 44, identical**. The pre-existing errors are
in `compaction.latency-span-lifecycle.red01.test.ts`, `compaction.test.ts`,
`compaction.working-context-ratio.test.ts`, `extensions/tools/definitions.test.ts`,
`bash.supervised*.test.ts`, `hub-trace-cardinality-discriminator.*.test.ts` and
`command-execution-plan.test.ts` — none of them this ACT's.

**No ACT-owned diagnostic exists.** The 44 diagnostics are the repository's
pre-existing baseline and are explicitly **not** ACT-owned.

---

## Gate summary

| # | Gate | Command | Exit | Result |
|---|---|---|---|---|
| 1 | Focused RED | `bun run test:red:adjudication-continuity-red01` | **1** | 5 failed / 5 — **the required failure** |
| 2 | Evidence fidelity | `bun x vitest run …compaction.evidence-fidelity01.test.ts --config vitest.config.ts` | **0** | 39 passed |
| 3 | Context directory (default) | `bun x vitest run src/extensions/context/ --config vitest.config.ts` | **0** | 479 passed, 2 skipped |
| 4 | Discriminator + controls | `bun x vitest run …adjudication-continuity.discriminator01.test.ts --config vitest.config.ts` | **0** | 23 passed |
| 5 | Typecheck | `bun tsc -p tsconfig.dev.json --noEmit` | **2** | 44 baseline errors, **0 ACT-owned** |

---

## ACT-owned diagnostics

**NONE.** Every diagnostic reported by any gate is a pre-existing baseline
diagnostic. The only new failures are the **five intentional RED assertions**,
which are the ACT's deliverable and are isolated in a dedicated config.

---

## Production-diff verification at exit

```bash
$ git status --porcelain --untracked-files=no
 M sdk/packages/core/package.json
 M sdk/packages/core/vitest.config.ts

$ git diff --stat -- 'sdk/packages/core/src/**/*.ts' ':(exclude)*.test.ts'
(empty)

$ git stash list
(empty)
```

**PRODUCTION_DELTA = ZERO.** The two modified tracked files are **test-harness
wiring** (the default-suite exclusion and the runner script), following the
existing `compaction.summary-churn01.red.test.ts` precedent. No production
module was edited at any point — not even temporarily — so the "revert and
reproduce" requirement is satisfied vacuously and the RED reproduces against
the unchanged tree.

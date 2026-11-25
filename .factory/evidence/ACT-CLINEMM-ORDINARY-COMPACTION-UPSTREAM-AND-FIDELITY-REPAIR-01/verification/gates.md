# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01 — EXECUTABLE VERIFICATION

## 1. THE FOCUSED GATES ACTUALLY RUN

### 1.1 The context suite — the compaction/context tests

```text
cd sdk/packages/core
bun x vitest run --config vitest.config.ts src/extensions/context/

→ Test Files  84 passed | 1 skipped (85)
→ Tests       1187 passed | 2 skipped (1189)
→ Duration    29.41s
```

The predecessor baseline for the same suite was **1 184 passed / 2 skipped**.
The delta is exactly **+3**: this ACT's summary-completeness witness
suite. **Zero new regressions.**

### 1.2 The summary-completeness witness (the §11 RED)

```text
bun x vitest run --config vitest.config.ts \
  src/extensions/context/compaction.summary-completeness.red01.test.ts

→ Test Files  1 passed (1)
→ Tests       3 passed (3)
```

The suite PASSES **because the defect is present**: it asserts that a
provider-reported-INCOMPLETE summary IS installed and that NOTHING records
the incompleteness. It is a *witness*, not a *gate*: it must FAIL once
CMP-04 is repaired.

### 1.3 The A10 correction's own gates (committed separately as 784f1e95b)

| Suite | Result |
| --- | --- |
| reference-trust | **17 passed** |
| evidence-continuity | **62 passed** |
| bounded-evidence-contract | **40 passed** |
| typecheck | **45 → 45**, zero delta |
| Biome (changed files) | clean |

### 1.4 The typecheck

```text
cd sdk/packages/core
bun tsc -p tsconfig.dev.json --noEmit 2>&1 | grep -c "error TS"
→ 45
```

45 is the **unchanged baseline**. The ACT-owned files contribute **zero**
diagnostics:

```text
bun tsc -p tsconfig.dev.json --noEmit 2>&1 \
  | grep -E "compaction-fidelity-repair|summary-completeness"
→ (empty)
```

### 1.5 Biome and the diff hygiene

```text
bun x biome check \
  sdk/packages/core/src/extensions/context/compaction.summary-completeness.red01.test.ts \
  sdk/packages/core/scripts/compaction-fidelity-repair.arms.ts \
  sdk/packages/core/scripts/compaction-fidelity-repair.cache.ts
→ Checked 3 files. No fixes applied.   (clean)

git diff --check
→ (empty)
```

### 1.6 The research scripts' own typecheck

```text
cd sdk/packages/core
bun tsc -p tsconfig.dev.json --noEmit 2>&1 \
  | grep -E "compaction-fidelity-repair"
→ (empty)
```

Both research scripts typecheck clean against the production types they
drive.

## 2. WHAT WAS DELIBERATELY NOT RUN

- **No new full-repository baseline campaign.** No relevant production
  dependency changed. The only production commit is the separately
  committed A10 correction, whose own gates are recorded in
  `../00-entry-and-a10-correction.md`.
- **No SDK build.** No production source in `@cline/core` changed, so the
  compiled `dist/` is unaffected.
- **No VSIX packaging and no installation.** The ACT forbids it without
  operator authorization, and no production delta was integrated in any
  case.

## 3. THE MEASUREMENT COMMANDS

The two research scripts were run against the operator's already-authorized
local endpoint with the unchanged model and inference configuration:

```text
cd sdk/packages/core
bun scripts/compaction-fidelity-repair.cache.ts 1795491524406_mutdb
bun scripts/compaction-fidelity-repair.arms.ts  1795491524406_mutdb
```

Their raw outputs — the provider bodies, the prompts and the model answers
— stay in the repository's GITIGNORED `tmp/compaction-fidelity-repair/`
tree. The committed evidence carries aggregates only.

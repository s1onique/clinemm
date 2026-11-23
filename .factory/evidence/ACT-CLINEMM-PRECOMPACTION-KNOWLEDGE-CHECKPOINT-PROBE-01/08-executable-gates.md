# 08 — Executable gates

**Every gate below was executed. Every receipt is in `verification/`.**

---

## 8.1 The ten required gates (G7)

| # | Gate | Command | Result | Receipt |
|---|---|---|---|---|
| 1 | Exact historical artifact hashes and canonical boundary correlation | `bun x vitest run --config vitest.config.ts src/extensions/context/knowledge-checkpoint-probe/checkpoint-historical-baseline.test.ts` | **PASS** (6/6) — cases `G2.1`, `G2.2` | `verification/act-owned-tests.txt` |
| 2 | Baseline fact-retention RED against the unchanged production projection | same file | **PASS** (6/6) — cases `G2.3`–`G2.6` assert the RED | `verification/act-owned-tests.txt` |
| 3 | Test-local checkpoint parser and validation tests | `.../checkpoint-security-controls.test.ts` | **PASS** (10/10) — cases `G7.3.1`, `G7.3.2` | `verification/act-owned-tests.txt` |
| 4 | One controlled model-generation probe per boundary | `bun run scripts/knowledge-checkpoint-probe.generate.ts` | **PASS** — exactly **1** call per boundary, 2 total | `04-model-publication-results.md` |
| 5 | Oracle projection through the actual compaction/provider-message seam | `.../checkpoint-projection.test.ts` case `G4.5.2` | **PASS** | `verification/act-owned-tests.txt` |
| 6 | Causal ablation | `.../checkpoint-projection.test.ts` cases `G4.5.1`, `G4.5.3` | **PASS** | `verification/act-owned-tests.txt` |
| 7 | Security and conservation controls | `.../checkpoint-security-controls.test.ts` | **PASS** (10/10) | `verification/act-owned-tests.txt` |
| 8 | Focused context-suite regression | `bun x vitest run --config vitest.config.ts src/extensions/context/` | **PASS** — 40 files passed, 1 skipped; **722 passed, 2 skipped, 0 failed** | `verification/context-suite-regression.txt` |
| 9 | Typecheck and Biome for the ACT-owned test and probe files | `bun tsc -p tsconfig.dev.json --noEmit`; `bun x @biomejs/biome check <act files>` | **PASS** — 0 ACT-owned typecheck errors; Biome **exit 0** | `verification/typecheck.txt`, `verification/biome.txt` |
| 10 | Zero production-source delta | `git diff --stat HEAD` | **PASS** — empty | `verification/production-delta.txt` |

---

## 8.2 The ACT-owned suite — 28 tests, all passing

```text
$ bun x vitest run --config vitest.config.ts src/extensions/context/knowledge-checkpoint-probe/

 ✓ checkpoint-security-controls.test.ts     (10 tests)
 ✓ checkpoint-historical-baseline.test.ts    (6 tests)
 ✓ checkpoint-model-treatment.test.ts        (6 tests)
 ✓ checkpoint-projection.test.ts             (6 tests)

 Test Files  4 passed (4)
      Tests  28 passed (28)
```

### The case-by-case map

| Case | What it proves |
|---|---|
| `G2.1` | all six frozen artifact hashes match the ACT's recorded identities |
| `G2.2` | the canonical transcript reproduces BOTH sidecar prefix identities |
| `G2.3` | R4's exact startup operations are absent from BOTH post-compaction contexts |
| `G2.4` | R6's bounded negative is absent from the second post-compaction context |
| `G2.5` | R2's provider identifier is absent from BOTH post-compaction contexts |
| `G2.6` | the measured baseline matrix is emitted for the evidence package |
| `G4.3.1` | the controlled checkpoint input is measured for every witness at both boundaries |
| `G4.3.2` | R4 is in the canonical history but ABSENT from the controlled checkpoint input at both boundaries |
| `G4.4` | the published checkpoint marks the R4/R6/R2 subjects UNRESOLVED, never CONFIRMED |
| `G6.1` | the published checkpoint preserves the R6 boundedness qualification |
| `G6.2` | the published checkpoint does not certify the original user allegations |
| `G6.3` | the published checkpoint contains no credential-shaped text |
| `G4.5.1` | **CONTROL**: the recorded compaction does not carry the exact source observation |
| `G4.5.2` | **ORACLE**: the synthetic oracle survives the real projection seam |
| `G4.5.3` | **ABLATION**: removing the checkpoint restores the absence |
| `G4.5.4` | **CONSERVATION**: the canonical history is unchanged and no second summary is created |
| `G4.5.5` | **IDEMPOTENCE**: applying the checkpoint twice does not duplicate the section |
| `G4.5.6` | a malformed checkpoint does not destroy the original compaction path |
| `G5.1.1`–`G5.1.8` | the eight security and conservation negative controls |
| `G7.3.1` | the parser is TOTAL — malformed documents never throw |
| `G7.3.2` | the experimental boundedness ceiling is enforced |

---

## 8.3 The focused context-suite regression

```text
$ bun x vitest run --config vitest.config.ts src/extensions/context/

 Test Files  40 passed | 1 skipped (41)
      Tests  722 passed | 2 skipped (724)
```

No pre-existing test was changed, disabled, or weakened.

---

## 8.4 The historical thinking-only adjudication RED — UNCHANGED AND ISOLATED

The ACT requires that the existing historical RED fixture remain unchanged and isolated.

```text
$ git diff --stat HEAD -- \
    sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.red01.test.ts \
    sdk/packages/core/vitest.config.ts
(empty)
```

The fixture is still excluded from the default suite exactly as before
(`vitest.config.ts` still lists it), and it still fails as it did before this ACT:

```text
$ bun run test:red:adjudication-continuity-red01
 Test Files  1 failed (1)
      Tests  5 failed (5)
```

**It was not flipped to GREEN, and it was not weakened.** The repair remains a separate,
later ACT.

---

## 8.5 Typecheck and lint receipts

### Typecheck

```text
$ bun tsc -p tsconfig.dev.json --noEmit
```

The package has **pre-existing** type errors in unrelated files (listed in
`verification/typecheck.txt`). **Zero** of them are in the ACT-owned files:

```text
$ grep -c 'knowledge-checkpoint-probe' verification/typecheck.txt
0
```

The ACT-owned files were also typechecked in isolation and are clean.

### Biome

```text
$ bun x @biomejs/biome check \
    sdk/packages/core/src/extensions/context/knowledge-checkpoint-probe/ \
    sdk/packages/core/scripts/knowledge-checkpoint-probe.generate.ts

Checked 12 files in 37ms. No fixes applied.
(exit 0)
```

---

## 8.6 Production-source delta

```text
$ git diff --stat HEAD
(empty)
```

**Zero production-source delta.** Every ACT-owned path is a NEW untracked file:

```text
?? .factory/evidence/ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01/
?? sdk/packages/core/scripts/knowledge-checkpoint-probe.generate.ts
?? sdk/packages/core/src/extensions/context/knowledge-checkpoint-probe/
```

No production module was modified, no public export was added, no sidecar schema was
changed, no tool was added, and the live `codium-roz` session and the installed
extension were not touched.

---

## 8.7 What was NOT executed, and why

| Not executed | Why |
|---|---|
| A behavioral continuation (does the agent avoid reinvestigation?) | The ACT classifies behavioral improvement as `NOT_EXECUTED` unless a separately controlled continuation actually occurs. None was run. |
| A VSIX build / package / install | The ACT does not implement a production feature. |
| The multi-hour Keycloak Round C task | Explicitly excluded by the ACT. |
| A live installed-extension run | The ACT requires that the live sidecar and the installed extension are not modified; the seam was exercised in a test harness against the real production functions. |
| A second model call per boundary | The ACT permits a maximum of ONE checkpoint generation per boundary. Two were made in total, one per boundary. |

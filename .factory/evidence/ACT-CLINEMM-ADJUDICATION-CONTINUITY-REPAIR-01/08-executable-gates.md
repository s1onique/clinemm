# 08 — Executable gates

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**Toolchain:** Bun 1.4.4 (`$HOME/.bun/bin/bun`), Vitest 4.1.10, TypeScript via
`bun tsc`, Biome via `bun x biome`.

All commands were run from `sdk/packages/core` unless stated otherwise.
Raw outputs are in `verification/`.

---

## Gate 1 — the existing RED

```bash
bun run test:red:adjudication-continuity-red01
```

| Property | Value |
|---|---|
| Exit code | **1** |
| Test files | `1 failed (1)` |
| Tests | **`5 failed (5)`** |
| Expected baseline | `RED: 5 failed / 5; exit 1` |
| Match | **YES** |

The five failures are RED-1 … RED-5. The RED **still fails against the
production implementation**, which is the required pre-repair state. Since the
trust gate halted, no repair was applied and the RED was **not** flipped.

Raw output: `verification/gate1-red.txt`.

---

## Gate 2 — focused tests

```bash
bun x vitest run \
  src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts \
  --config vitest.config.ts
```

| Property | Value |
|---|---|
| Exit code | **0** |
| Tests | **`24 passed (24)`** |
| Predecessor baseline | `23 passed` |
| Delta | **+1** — the G0.2 `ABLATION TARGETING` test. No predecessor assertion removed or weakened. |

```bash
bun x vitest run \
  src/extensions/context/compaction.evidence-fidelity01.test.ts \
  --config vitest.config.ts
```

| Property | Value |
|---|---|
| Exit code | **0** |
| Tests | **`39 passed (39)`** |
| Predecessor baseline | `39 passed` |
| Delta | **0** |

Raw outputs: `verification/gate2-discriminator.txt`,
`verification/gate2-evidence-fidelity.txt`.

### Gate 2b — the G2 trust-feasibility probe (this ACT's addition)

```bash
bun x vitest run \
  src/extensions/context/compaction.adjudication-continuity.feasibility01.test.ts \
  --config vitest.config.ts
```

| Property | Value |
|---|---|
| Exit code | **0** |
| Tests | **`16 passed (16)`** |

Raw output: `verification/gate2b-feasibility-probe.txt`.

---

## Gate 3 — context regression

```bash
bun x vitest run src/extensions/context/ --config vitest.config.ts
```

| Property | Value |
|---|---|
| Exit code | **0** |
| Test files | `28 passed | 1 skipped (29)` |
| Tests | **`496 passed | 2 skipped (498)`** |
| Predecessor baseline | `479 passed, 2 skipped` |
| Delta | **+17 passed** — 16 feasibility-probe tests + 1 G0.2 targeting test |
| Failing files | **none** |
| Diagnostic identities changed | **none** |

No unrelated pre-existing failure appeared, and none disappeared.

Raw output: `verification/gate3-context-directory.txt`.

---

## Gate 4 — typecheck

```bash
bun tsc -p tsconfig.dev.json --noEmit
```

| Property | Value |
|---|---|
| Exit code | **2** (non-zero because pre-existing diagnostics exist) |
| Diagnostics | **`44`** |
| Predecessor measured baseline | **`44`** |
| **ACT-owned diagnostics** | **ZERO** |

The G0.2 correction initially introduced **one** ACT-owned diagnostic (the
`map` callback widened the `MessageWithMetadata` content union). It was fixed
in commit `172efa60f` by giving the callback an explicit
`MessageWithMetadata` return type and spreading the already-verified target
content as `ContentBlock[]`. The count returned to the exact baseline.

Raw output: `verification/gate4-typecheck.txt`.

---

## Gate 5 — formatting and production diff

```bash
bun x biome check \
  src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts \
  src/extensions/context/compaction.adjudication-continuity.feasibility01.test.ts
```

| Property | Value |
|---|---|
| Exit code | **0** |
| Result | `Checked 2 files. No fixes applied.` |
| Findings | **1 `info`** — `noUselessTernary` at `discriminator01.test.ts:757` |

The single `info` is **pre-existing**: it is in the predecessor's
`CONTROL 7` block, unchanged by this ACT. Verified against the predecessor's
committed source:

```bash
git show d69cfb9be:sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts \
  | grep -n 'result_ === "failed"'
# 588:   result_ === "failed"
```

It is an `info`, not an error, and it is not in a file this ACT introduced.

### Production diff verification

```bash
# shipped production source, versus the ACT's ENTRY_HEAD
git diff --stat a493eff078ec5c8f2b6c874ad8f4a85009d1b64f..HEAD \
  -- 'sdk/packages/core/src/**' ':(exclude)sdk/packages/core/src/**/*.test.ts' | wc -c
# 0
```

| Check | Result |
|---|---|
| Unintended shipped production changes | **NONE** — 0 bytes |
| Changed dependency requirements | **NONE** — no `package.json` dependency change by this ACT |
| Test-only override reachable in production | **NONE** — the only new file is a `*.test.ts` |
| Raw reasoning or secret fixtures in committed evidence | **NONE** — see §6 |
| The RED witness modified by this ACT | **NO** — `git diff d69cfb9be..HEAD -- <red file>` → 0 bytes |

The only non-`*.test.ts` differences from `ENTRY_HEAD` are the **predecessor's
test-harness** files, which the ACT lists explicitly under "Expected
ACT-owned changes":

```
 sdk/packages/core/package.json                     |  1 +
 sdk/packages/core/vitest.config.ts                 | 24 +++++++++++
 ...est.red.adjudication-continuity-red01.config.ts | 50 ++++++++++++++++++++++
```

Raw output: `verification/gate5-biome.txt`,
`verification/production-diff.txt`.

---

## Gate 6 — default-suite handling

| Situation | Required action | Taken |
|---|---|---|
| The RED became fully GREEN | move it into the default test gate | **N/A** — the RED did NOT become GREEN |
| The trust gate halted | leave the RED isolated with its intentional-failure designation | **DONE** — the RED stays excluded in `sdk/packages/core/vitest.config.ts` and runs only via `bun run test:red:adjudication-continuity-red01` |

**No intentionally failing test was left in the default suite.** The context
regression (Gate 3) passed with 0 failures, which proves it.

---

## 6. Evidence hygiene

| Check | Result |
|---|---|
| Raw model reasoning in committed evidence | **NONE** — the historical measurements are counts, block shapes and character lengths only; the fixture reasoning prose in the probe is SYNTHETIC |
| Credentials in committed evidence | **NONE** — the only credential-shaped string is the standard `AKIAIOSFODNN7EXAMPLE` synthetic placeholder used by the predecessor's own control 1 and by the probe's control D |
| Private session captures in Git | **NONE** — the frozen canonical snapshot lives at `/tmp/cline-recon-rX/`, outside the repository, and was read-only |
| Historical verdict prose in committed evidence | **NONE** — the probe's adjudication fixture is SYNTHETIC and does not reproduce the historical R3/R7/R8 prose |

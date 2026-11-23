# 00 — Entry identity, RED preservation and repository conservation

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**ACT class:** Repair with a mandatory trust and feasibility gate.
**Production repair executed:** **NO** — the G2 trust gate halted.
**Verdict:** `HALT_TRUST_BOUNDARY_UNRESOLVED`

---

## 1. Repository identity

| Property | Value | Label |
|---|---|---|
| Top level | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` | REAL |
| `origin` remote | `git@github.com:s1onique/clinemm.git` | REAL |
| Expected repository | `s1onique/clinemm` | REAL |
| **ACT-expected `ENTRY_HEAD`** | `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f` | REAL |
| **ACT-expected `RED_ARTIFACT_HEAD`** | *not predicted — discovered* | REAL |
| **`RED_ARTIFACT_HEAD`** | `d69cfb9befe957ec87a034050bb7b4c72f1a0851` | REAL |
| `ENTRY_BRANCH` | `main` | REAL |
| `ENTRY_WORKTREE` | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` (primary) | REAL |
| `FINAL_HEAD` | `172efa60faa74ec6431b93a1810eb279d8c1add3` | REAL |
| `PROTECTED_STASHES` | **none** (`git stash list` empty at entry and at exit) | REAL |

### 1.1 The ACT's entry-identity expectation versus the observed state

The ACT text says:

> "The predecessor ended with the original production HEAD unchanged, but its
> test harness and evidence were not yet committed."

**This was NOT the observed state.** The predecessor's RED-01 test harness
and evidence ARE committed, at `d69cfb9be`, and `d69cfb9be` is the direct
child of the ACT-expected `ENTRY_HEAD` `a493eff07`:

```
a493eff07  ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CONTAINMENT-01: contain the automatic excerpt carry-forward (default off)
d69cfb9be  ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01: reproduce the qualified-adjudication loss and classify the boundary
172efa60f  ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01: keep the typecheck at the 44-diagnostic baseline
118644e13  ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01: correct the bounded P1 in the ablation helper
1d85c1a5d  ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01: add the G2 trust-feasibility probe
```

The ACT instructed "discover and verify" the entry head, and to record
`RED_ARTIFACT_HEAD` without predicting its SHA. The discovered value is
`d69cfb9be`. The discrepancy in the ACT's narrative is recorded here as an
**observation, not a defect**: the predecessor's commit was already present
when this ACT started, so the "commit only predecessor-owned test, harness and
evidence files" step was already satisfied and no re-commit of predecessor
files was performed.

The `ENTRY_HEAD` `a493eff07` remains the **production** baseline: the
production tree at `d69cfb9be` is byte-identical to the tree at
`a493eff07` for every non-test, non-harness file. Verified in §4.


---

## 2. Entry preflight

```
git rev-parse HEAD                      -> d69cfb9befe957ec87a034050bb7b4c72f1a0851
git branch --show-current               -> main
git status --porcelain --untracked-files=no  -> (empty)   TRACKED_CLEAN
git stash list                          -> (empty)   PROTECTED_STASHES = none
```

`git worktree list` at entry (all pre-existing, none touched):

```
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm                  d69cfb9be [main]
/private/tmp/clinemm-stash-recovery-20261117                                8b76c9e3e [recovery/protected-stash-20261117] prunable
/private/tmp/worktree-bun.7ddCHQ                                            bbdccf8a2 (detached HEAD) prunable
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-action-first 38e726c45 [experiment/m31-action-first]
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-bounded      0366ea506 (detached HEAD)
```

**No protected worktree or stash was touched.**

### 2.1 Pre-existing untracked directories — preserved

| Path | Origin | Disposition |
|---|---|---|
| `.factory/evidence/ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01/` | **pre-existing** | **preserved, read-only, untouched** |
| `.factory/evidence/ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01/` | **pre-existing** | **preserved, read-only, untouched** |

Both are still untracked and unmodified at exit.

### 2.2 `HALT_UNEXPECTED_TRACKED_DIRT` — NOT triggered

At entry, `git status --porcelain --untracked-files=no` was **empty**. Every
tracked modification made by this ACT is listed in §3 and is ACT-owned.

---

## 3. ACT-owned changes

| Path | Kind | Commit |
|---|---|---|
| `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts` | test (G0.2 P1 correction) | `118644e13`, `172efa60f` |
| `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.feasibility01.test.ts` | test (G2 trust-feasibility probe) | `1d85c1a5d` |
| `.factory/evidence/ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01/` | evidence | this commit |

**No production file was created, modified or deleted by this ACT.**

---

## 4. Production delta — ZERO

```bash
git diff --stat a493eff078ec5c8f2b6c874ad8f4a85009d1b64f..HEAD \
  -- sdk/packages/core/src/ ':(exclude)sdk/packages/core/src/**/*.test.ts'
# -> (empty)
```

Every file this ACT touched under `sdk/packages/core/src/` matches
`*.test.ts`. The production tree is byte-identical to `ENTRY_HEAD`.

```bash
git diff --stat a493eff078ec5c8f2b6c874ad8f4a85009d1b64f..HEAD -- \
  ':(exclude).factory/**' ':(exclude)sdk/packages/core/src/**/*.test.ts'
# -> (empty)
```


---

## 5. RED preservation (G0.3)

### 5.1 Gate 1 — the RED suite

```bash
cd sdk/packages/core
bun run test:red:adjudication-continuity-red01
```

**Observed:** `Test Files 1 failed (1)` / `Tests 5 failed (5)` / **exit 1**.

This is the expected historical baseline (`RED: 5 failed / 5; exit 1`). The
five failing assertions are RED-1 … RED-5, unchanged.

### 5.2 Gate 2 — the discriminator (PASSING companion)

```bash
bun x vitest run \
  src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts \
  --config vitest.config.ts
```

**Observed:** `Test Files 1 passed (1)` / `Tests 24 passed (24)` / exit 0.

The predecessor measured **23 passed**. The count is now **24** because the
G0.2 correction added one test (`ABLATION TARGETING`). No predecessor
assertion was removed or weakened.

### 5.3 Gate 2b — the new feasibility probe (G2)

```bash
bun x vitest run \
  src/extensions/context/compaction.adjudication-continuity.feasibility01.test.ts \
  --config vitest.config.ts
```

**Observed:** `Test Files 1 passed (1)` / `Tests 16 passed (16)` / exit 0.

### 5.4 RED isolation

The RED witness remains excluded from the default suite
(`sdk/packages/core/vitest.config.ts`, the `exclude` entry added by the
predecessor). It is runnable **on demand only** via
`bun run test:red:adjudication-continuity-red01`.

**Gate 6 (default-suite handling):** because the trust gate HALTED, the RED
is **left isolated with its intentional-failure designation**. It was NOT
moved into the default gate. **No intentionally failing test was left in the
default suite.**

**Gate:** `PASS_RED_PRESERVED`

---

## 6. Exit decision

`HALT_TRUST_BOUNDARY_UNRESOLVED` — see `02-trust-feasibility-probe.md` and
`03-mechanism-selection.md`.

**The RED is preserved, executable and isolated. No deployed repair exists.**

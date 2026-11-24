# C10 — EXECUTABLE VERIFICATION

## 1. THE ACT-OWNED WITNESSES

```text
sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/knowledge-loss-discriminator.test.ts
```

| id | What it establishes | Why it is not a tautology |
| --- | --- | --- |
| `W1` | every oracle item is ACQUIRED knowledge, not an initial obligation | asserts the initial-only list is EMPTY, and that the item count is in the ACT's 8–12 band |
| `W1b` | the categories cover the decisive classes | asserts a falsified/contradictory/conditional item EXISTS and that every item declares a material qualification |
| `W2` | no hindsight contamination | asserts EVERY evidence reference is STRICTLY BELOW the verified boundary (244) |
| `W3` | the oracle is NOT expressible in the PCK's closed vocabulary | asserts the closed atom labels name NONE of the oracle's subjects, and that the closed qualification classes are fewer than the oracle's qualifications |
| `W4` | the task contract does NOT credit acquired knowledge | asserts a task-contract-only context scores the acquired proposition as `OMITTED` while STILL recording the attribution |
| `W5` | a missing qualification downgrades the score | asserts `PARTIALLY_PRESERVED` with the named missing qualification, and `PRESERVED` once the qualification is present |
| `W6` | the scoring vocabulary is closed and total | asserts every item scores to a member of the eight-value vocabulary and that every item HAS assertion tests |
| `W7` | the oracle does NOT leak into a probe prompt | asserts `leaked === false` for a real prompt AND `leaked === true` for a prompt that DOES contain a proposition — the witness is NOT vacuous |
| `W8` | the critical counters are reported separately | asserts the critical counters SUM to the critical applicable count, and that the critical count is strictly less than the total |
| `W9` | the PCK stays DEFAULT OFF | asserts the disabled path produces NO checkpoint section |

```text
bun x vitest run --config vitest.config.ts src/extensions/context/knowledge-loss-discriminator/knowledge-loss-discriminator.test.ts
→ Test Files  1 passed (1)
→ Tests       10 passed (10)
```

## 2. THE EXISTING RELEVANT SUITES

```text
bun x vitest run --config vitest.config.ts src/extensions/context
→ Test Files  70 passed | 1 skipped (71)
→ Tests       994 passed | 2 skipped (996)
→ Duration    29.71s
```

This INCLUDES the existing context/compaction tests and the existing PCK
eligibility and publication tests:

```text
precompaction-knowledge-checkpoint/pck-generation-eligibility.repair01.test.ts   14 passed
precompaction-knowledge-checkpoint/pck-physical-request-cardinality.test.ts       8 passed
precompaction-knowledge-checkpoint/pck-conservation-ablation.test.ts             9 passed
precompaction-knowledge-checkpoint/pck-closed-contract.test.ts
precompaction-knowledge-checkpoint/pck-default-off-equivalence.test.ts
precompaction-knowledge-checkpoint/pck-persistence-restoration.test.ts
precompaction-knowledge-checkpoint/pck-reference-confidentiality.test.ts
precompaction-knowledge-checkpoint/pck-observation-assurance.red01.test.ts        7 passed
precompaction-knowledge-checkpoint/pck-same-class-assurance.red02.test.ts        14 passed
precompaction-knowledge-checkpoint/pck-qwen-inference-policy.*.test.ts
```

**NEW_REGRESSIONS=0.** Every pre-existing failure remains a pre-existing
failure; the suite that passed before this ACT still passes, and the ACT's
own 10 witnesses pass.

## 3. THE TYPECHECK BASELINE

```text
cd sdk/packages/core && bun tsc -p tsconfig.dev.json --noEmit
```

| State | error count |
| --- | --- |
| BASELINE (the ACT's files stashed) | **45** |
| WITH the ACT's files | **45** |
| **ACT-OWNED DIAGNOSTICS** | **0** |

The 45 errors are pre-existing and are in files this ACT did not touch
(`runtime/command-policy/…`, `runtime/observability/…`,
`runtime/orchestration/…`, `services/llms/…`, `../shared/src/runtime/…`).

**A first typecheck pass found 44 ACT-owned diagnostics** (a `RegExp` vs
`string` annotation and a `string` vs `keyof` index). Both were fixed; the
count is now back to the baseline. The ACT-owned diagnostics are **0**.

## 4. BIOME

```text
node_modules/.bin/biome check \
  sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/ \
  sdk/packages/core/scripts/knowledge-loss-discriminator.*.ts
→ Checked 14 files. No fixes applied.
```

Zero errors, zero warnings, zero infos.

## 5. `git diff --check`

```text
git diff --check
→ (no output — no whitespace errors)
```

## 6. THE PRODUCTION DELTA

```text
git diff --name-only HEAD -- \
  sdk/packages/core/src/extensions/context/compaction.ts \
  sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/ \
  sdk/packages/core/src/extensions/context/task-contract.ts \
  sdk/packages/core/src/extensions/context/evidence-continuity.ts \
  sdk/packages/core/src/session/models/session-compaction.ts
→ (empty)
```

```text
PRODUCTION_DELTA=NONE
```

Every one of the ACT's 7 changed paths is a NEW untracked file:

```text
?? sdk/packages/core/scripts/knowledge-loss-discriminator.acquire.ts
?? sdk/packages/core/scripts/knowledge-loss-discriminator.arms.ts
?? sdk/packages/core/scripts/knowledge-loss-discriminator.dump-prefix.ts
?? sdk/packages/core/scripts/knowledge-loss-discriminator.probe.ts
?? sdk/packages/core/scripts/knowledge-loss-discriminator.s1-s2.ts
?? sdk/packages/core/scripts/knowledge-loss-discriminator.s3-score.ts
?? sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/
```

**No existing tracked file was modified.** No production behaviour changed.

## 7. CONFIDENTIALITY VERIFICATION

```text
git status --porcelain
→ only the ACT's own new source files and the ACT's own evidence directory
→ NO session content, NO rendered context, NO raw prompt, NO raw model answer
```

```text
git check-ignore -v tmp/knowledge-loss/1795491524406_mutdb.a0-context.txt
→ tmp/knowledge-loss/… :6:tmp   (ignored)
```

The raw artefacts live ONLY under the gitignored `tmp/` tree.

## 8. WHAT WAS NOT EXECUTED

```text
EXTENSION BUILD            NOT_EXECUTED   (no build was authorized)
VSIX PACKAGING             NOT_EXECUTED
INSTALLED-LIVE             NOT_EXECUTED
PCK GENERATION             NOT_EXECUTED   (the PCK was default OFF; no PCK
                                          input, vocabulary, budget or
                                          deadline change was made)
SDK BUILD                  NOT_EXECUTED   (no SDK source was changed, so no
                                          rebuild was required)
```

The experiments used the EXISTING SDK build products and the production
source, both of which are unchanged from `ENTRY_HEAD`, so no stale-build
condition arose and no build requirement was triggered.

## 9. NO ARTIFICIAL FAILURES WERE ADDED

The ACT's witnesses assert the DISCRIMINATOR'S OWN invariants, not an
experimental verdict. The knowledge-loss finding is reported as an
experimental RESULT in the evidence, not encoded as a test constant. If the
loss had NOT reproduced, the witnesses would still pass — they do not depend
on the finding.

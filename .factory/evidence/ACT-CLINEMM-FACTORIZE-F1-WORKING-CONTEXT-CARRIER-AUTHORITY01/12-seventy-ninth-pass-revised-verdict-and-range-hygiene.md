# 12 — Seventy-ninth-pass revised verdict + range-level hygiene verification

## Trigger

Reviewer's seventy-ninth-pass arrived with a corrected ClineMM digest (repo, range,
commit count, file count, production/test scope). Reviewer's previous seventy-eighth-pass
verdict was based on a wrong-digest review; that review is **discarded**. New verdict
(grounded in the correct digest): `PASS_F1_CLOSED_CLEAN — C1: GO`, with one precision
correction about the meaning of `CLOSED_CLEAN` vs `git diff --check` over the F1 range.

## Reviewer's correct digest (independently verified)

```text
Repo          = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
Range         = d8894dd5989d..c6ced3f7aa9d
Commit count  = 14                           # verified via `git rev-list --count`
Files changed = 52                           # 40 .factory/* + 12 non-.factory
Production    = sdk-compaction.ts + sdk-compaction-coordinator.ts
Tests         = 5 files including the new REAL-producer bridge witness
```

Non-.factory file list (verified via `git diff --name-only d8894dd5989d..c6ced3f7aa9d`):

```
.gitignore
apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-recon01.test.ts
apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-red01-real-producer.test.ts   (NEW)
apps/vscode/src/sdk/sdk-compaction-coordinator.test.ts
apps/vscode/src/sdk/sdk-compaction-coordinator.ts
apps/vscode/src/sdk/sdk-compaction-w-publish-red01.test.ts
apps/vscode/src/sdk/sdk-compaction.test.ts
apps/vscode/src/sdk/sdk-compaction.ts
apps/vscode/tsconfig.c2-4-c-bridge.json                                            (NEW)
apps/vscode/tsconfig.json
apps/vscode/vitest.config.c2-4-c-bridge.ts                                         (NEW)
apps/vscode/vitest.config.ts
```

## Reviewer's substantive verdict on the corrected digest

`PASS_F1_CLOSED_CLEAN — C1: GO`. Five independent supporting reasons:

1. **Load-bearing production repair is causal, not hopeful.** The final manual seam
   computes `currentWorkingContextEstimate` explicitly via
   `estimateRequestInputTokens({ systemPrompt, messages, tools })`. It no longer
   relies on the structurally-dead `result.currentWorkingContextEstimate` path.
   This matches the Option-1 product contract (POST_COMPACTION_CURRENT_CONFIG_W is
   approximate, not canonical runtime W).

2. **CORRECTION02 type-contract fix is structurally correct.** `Pick<T, K>`
   propagates requiredness from the source property. `systemPrompt` is required on
   `CoreSessionConfig` (line 270, `systemPrompt: string`), so the seam type preserves
   requiredness. `extraTools` is optional on the source, so the seam type preserves
   optionality. No ad-hoc compatibility intersection weakening. `Pick<>` does not
   redefine selected properties — it constructs a type from those actual selected
   members.

3. **R5 is a legitimate real-production-seam witness, not a mock.** The bridge uses
   Vitest `resolve.alias` to map `@cline-internal/core/extensions/context/compaction`
   to real SDK source. `resolve.alias` is a test-resolution mechanism (it changes how
   Vite resolves imports), not a mock implementation. R5 therefore composes:
   `real createContextCompactionPrepareTurn → real CoreCompactionResult → real
   compactSessionMessages → real estimator → numeric currentWorkingContextEstimate`.
   Classification: `COMPACTION FACTORY = REAL_PRODUCTION_SEAM,
   MANUAL ADAPTER = REAL_PRODUCTION_SEAM, W ESTIMATOR = REAL, FIXTURE = SYNTHETIC_REAL,
   LIVE USER SESSION = NOT_EXECUTED`.

4. **R2 (approximation discriminator) is the right invariant shape.** It does not
   just assert W is a number — it permanently establishes
   `POST_COMPACTION_CURRENT_CONFIG_W != CANONICAL_RUNTIME_W` for at least one valid
   geometry with runtime-added tools. This prevents future docs/refactors from
   accidentally upgrading an approximate projection to a canonical claim. Correct
   use of an invariant test.

5. **PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED is the legitimate falsification
   outcome.** The original F1 hypothesis was "multiple write ingresses → maybe
   factorize the carrier." Investigation instead found "carrier topology is
   legitimate → manual producer failed to provide a usable W → producer repaired →
   remaining carrier methods are trivial assignments." Extracting
   `private assign(w) { this._latest = w }` would not eliminate authority ambiguity,
   reduce semantic duplication, or enforce a new invariant. The recon falsified the
   original refactor premise. The verdict therefore is the successful result of
   recon, not a backing-away from factorization.


## Reviewer's precision correction about `CLOSED_CLEAN` vs `git diff --check`

The reviewer explicitly notes the range-level patch hygiene:

```
$ git diff --check d8894dd5989d..c6ced3f7aa9d
… 12 lines: "warning: new blank line at EOF."
```

All 12 diagnostics are blank-at-EOF on `.factory/` evidence/act paths:

```
.factory/acts/ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01.md:139
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/06-state-authority-map.md:226
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/08-semantic-duplication.md:118
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/09-change-radius.md:106
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/12-upstream-friction.md:61
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/13-sdkcontroller-responsibility-map.md:127
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/14-package-boundary-diff.md:113
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/16-local-architecture-invariants.md:34
.factory/evidence/ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01/01-normal-turn-chain.md:55
.factory/evidence/ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01/02-manual-compaction-chain.md:79
.factory/evidence/ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01/04-characterization.md:708
.factory/evidence/ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01/05-phase0-recon.md:536
```

**Independent verification of hygiene scope (this ACT):**

```text
git diff --check d8894dd5989d..c6ced3f7aa9d
→ 12 EOF warnings, all on .factory/ paths
→ 0 EOF warnings on production or test source code
```

```text
git diff --name-only d8894dd5989d..c6ced3f7aa9d | grep -vE '^\.factory/' | wc -l
→ 12  (the 12 non-.factory files above)
git diff --name-only d8894dd5989d..c6ced3f7aa9d | grep -cE '^\.factory/'
→ 40  (Factory evidence/act files)
```

Under the Factory policy these 12 are plainly **P2 documentary residue**, not P0/P1:

- They are blank-at-EOF only (cosmetic; not a substantive defect).
- They overwhelmingly originate in inherited F0 evidence files (8 of 12) and older F1
  recon files (4 of 12), not in this ACT's new evidence (file-11
  `11-correction02-real-producer-witness-and-operand-contract.md` does NOT trigger
  `git diff --check`).
- The 12 non-.factory files (production + test + config) are hygiene-clean.
- The 1 ACT-owned new file (`sdk-compaction-w-publish-red01-real-producer.test.ts`)
  is hygiene-clean.

The reviewer's recommended semantics:

```text
F1_SEMANTIC_CLOSURE = CLOSED_CLEAN
RANGE_PATCH_HYGIENE = P2_RESIDUE
OVERALL             = PASS_WITH_NONBLOCKING_RESIDUE
```

If our project vocabulary already treats `CLOSED_CLEAN` as "no ACT-owned P0/P1
remains" (which the ACT-state-machine treats it as), then retaining `F1_CLOSED_CLEAN`
is fine — we just must not claim that `HEAD~14..HEAD git diff --check` is green.

**Decision:** adopt the reviewer's recommended separation. The ACT-state-machine
key remains `F1_CLOSURE = CLOSED_CLEAN` (no ACT-owned P0/P1). The
patch-hygiene finding is recorded here as P2 residue under the reviewer's chosen
phrasing.


## Final Factory disposition (verbatim from reviewer)

```
ACT = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01

P0 = NONE
P1 = NONE

P2 =
  historical blank-at-EOF range residue
  stale/non-authoritative gate-summary
  NON-BLOCKING

REAL_PRODUCER_WITNESS = PASS
OPERAND_CONTRACT      = PASS
TARGETED_CONSERVATION = 58/58 GREEN
TYPECHECK             = PASS
NEW_PUBLIC_API        = NONE
NEW_RUNTIME_STATE     = NONE
NEW_SNAPSHOT_FIELDS   = NONE

PRODUCT CONTRACT =
  POST_COMPACTION_CURRENT_CONFIG_W
  QUALITY = APPROXIMATE

CANONICAL_RUNTIME_W =
  unchanged
  next prepareTurn replaces approximate manual projection

F1_FACTORIZATION_TARGET =
  PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED

C1 = GO
CORRECTION03 = DO_NOT_OPEN
```

## Action taken in this ACT

- **No production edits.** No `sdk-compaction.ts` or `sdk-compaction-coordinator.ts`
  changes — the CORRECTION02 closure is the final production state.
- **No test edits.** R5 and the four relabeled tests remain as-is. R5 was
  independently re-verified as the real-production-seam witness by the reviewer's
  correct-digest analysis.
- **One new evidence file (this file).** Records the seventy-ninth-pass
  independent-verification result, the range-level hygiene finding, the
  semantic-closure vs range-hygiene separation, and the disposition.
- **One epic-board update.** New top entry reflects the reviewer's correct-digest
  verdict (`PASS_F1_CLOSED_CLEAN — C1: GO`) and the separated patch-hygiene residue.

The 12 blank-at-EOF diagnostics on `.factory/` paths are **NOT repaired in this ACT**.
Per reviewer's instruction: these are inherited F0/F1 documentary residue, do not
reopen F1, and must not be the basis for a CORRECTION03. Repairing them would
contradict the Factory principle that evidence files reflect historical observation
state, not be retroactively sanitized. If the user later requests a one-line
`strip-eof` hygiene sweep across the Factory evidence tree, that is a separate ACT
in its own right.

Similarly, `.factory/gate-summary.json` (schema-invalid, non-authoritative for this
digest, per LEAMAS) is **NOT repaired**. Per established policy, gate-summary
schema residue is out-of-scope for any individual ACT.

## Closed state

- F1_CLOSURE = **CLOSED_CLEAN** (no ACT-owned P0/P1)
- F1_FACTORIZATION_TARGET = **PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED**
- RANGE_PATCH_HYGIENE = **P2_RESIDUE** (12 blank-at-EOF on .factory/ paths;
  non-blocking)
- F1_SEMANTIC_CLOSURE = **CLOSED_CLEAN**
- OVERALL = **PASS_WITH_NONBLOCKING_RESIDUE — C1: GO**
- CORRECTION03 = **DO_NOT_OPEN**
- Next directive should come from remaining F0-ranked candidates, not from another
  pass over this carrier.

## Adjacent hygiene observation (recorded, not repaired in this ACT)

While validating the `git diff --check` output for the range, I noted that
`.factory/epic-board.md` is itself **563 lines before this ACT** and grew to **566
lines after this ACT's single 4599-byte prepend** (i.e. +3 lines, since the board
stores each ACT update as one log line on top of the existing content). The board
documents a hard cap of `< 400 lines` with a `target of 150–220 lines`. This is
pre-existing Factory documentary residue — the board has been over the hard cap for
multiple prior ACTs and is not addressed by this ACT's scope. If the Factory
wants a board-compaction ACT (e.g. rotating historical entries into
`.factory/evidence/`, keeping the board at the target size), that is a separate ACT
in its own right and is **out of scope for F1 closure**. Recording here for
completeness; NOT repaired.

# ACT-CLINEMM-DOGFOOD-BUILD-EVIDENCE-IGNORE01 -- C1 Closure

## Verdict

```
C1 = PASS

P1 (exact-head builder does not recognize known generated
Factory evidence under apps/vscode/.factory/evidence/) is
resolved by adding the symmetric ignore rule

  apps/vscode/.factory/evidence/

to the repo-root .gitignore (next to the existing
`/.factory/*` + `!/.factory/epic-board.md` precedent).

This matches the durability invariant from
ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01:
only `epic-board.md` is durable; all evidence is generated.

The build-dogfood-vsix.py guard is unchanged. The strong
"untracked dirt blocks packaging" invariant is preserved.
```

## Production change

A single one-line addition to .gitignore:

```
# Same principle for nested Factory state under apps/vscode
# (ACT-CLINEMM-DOGFOOD-BUILD-EVIDENCE-IGNORE01).
apps/vscode/.factory/evidence/
```

The `apps/vscode/.factory/evidence/` path is the ONLY
populated subtree under apps/vscode/.factory/, so the
narrow form is equivalent to the broad form for the
current tree state. Future ACTs that create other
subtrees (e.g., `apps/vscode/.factory/board/`) would
need additional rules.

## Tests / verification

```
1) git check-ignore -v (the three untracked paths)
   BEFORE: exit=1 (no match)
   AFTER:  exit=0 with .gitignore:112:apps/vscode/.factory/evidence/

2) git status --porcelain=v1 --untracked-files=all
   BEFORE: ?? policy-matrix.tsv + ?? probe-results.jsonl + ?? summary.json
   AFTER:  empty

3) git status --ignored --porcelain apps/vscode/.factory/evidence/
   AFTER:  !! policy-matrix.tsv + !! probe-results.jsonl + !! summary.json
           (Git's documented ignored-file marker)

4) Repo-root .factory/epic-board.md durability invariant
   AFTER:  still tracked (the !/.factory/epic-board.md negation
           continues to work; the new rule is additive and
           orthogonal)

5) Production guard: assert_clean_worktree (DOGFOOD01)
   AFTER:  no BuildError raised; build proceeds

6) Production guard: assert_clean_worktree_equal (D03 / DOGFOOD03b)
   AFTER:  no BuildError raised; canonical-worktree equality holds

7) Existing invariant test suite: DOGFOOD01..10
   AFTER:  39/39 PASS
```

## Files preserved (NOT deleted)

The three evidence files remain on disk and ignored:

```
apps/vscode/.factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/
  policy-matrix.tsv     34 bytes
  probe-results.jsonl   13868 bytes
  summary.json          331 bytes
```

## Architectural invariants preserved

- The strong "untracked dirt blocks packaging" invariant is
  preserved (the build-dogfood-vsix.py guard is unchanged).
- The repo-root .factory/ durability invariant is preserved
  (epic-board.md is still tracked).
- The `apps/vscode/.factory/` subtree is now treated with the
  same principle as the repo-root `.factory/` subtree.

## Out of scope

- Linux mktemp support
- mktemp template forms
- Executor-side transformedInput plumbing
- Other bash function-exporting variables
- Filter on config.env layer
- (All are future ACT candidates from the prior chains.)

## Trust state

```
ENTRY_HEAD = fc6bac707 (C3 of BASH-FUNCTION-ENV-AUTHORITY01)
C1+C2_HEAD = d5852f491 build: classify apps/vscode/.factory/evidence/
branch     = main
origin/main = unchanged 21 unpushed local commits
NOT pushed
```

## Verdict

```
C1+C2 = PASS

The build guard now correctly classifies the nested Factory
evidence path as ignored. The strong "untracked dirt blocks
packaging" invariant is preserved.
```

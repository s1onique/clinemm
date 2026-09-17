# ACT-CLINEMM-DOGFOOD-BUILD-EVIDENCE-IGNORE01 -- Final Assessment

## Verdict

```
PASS_DOGFOOD_BUILD_EVIDENCE_IGNORE CLOSED_CLEAN
```

The P1 (exact-head builder does not recognize known
generated Factory evidence under apps/vscode/.factory/
evidence/) is resolved by adding the symmetric ignore rule

```
apps/vscode/.factory/evidence/
```

to the repo-root .gitignore (next to the existing
`/.factory/*` + `!/.factory/epic-board.md` precedent).

The strong "untracked dirt blocks packaging" invariant is
preserved (the build-dogfood-vsix.py guard is unchanged).

## What was done (one commit, since the fix was minimal)

`d5852f491 build: ACT-CLINEMM-DOGFOOD-BUILD-EVIDENCE-IGNORE01 -- classify apps/vscode/.factory/evidence/ as ignored`

- Added a 7-line comment block + 1-line ignore rule to .gitignore
- Documented the symmetric pattern with the repo-root /.factory/* rule
- Verified all six gates

## Tests / verification

| Gate | Before | After |
|------|--------|-------|
| `git check-ignore -v` on the three paths | exit=1 (no match) | exit=0 with `.gitignore:112:apps/vscode/.factory/evidence/` |
| `git status --porcelain=v1 --untracked-files=all` | 3 `??` lines | empty |
| `git status --ignored --porcelain` | (no `!!` lines) | 3 `!!` lines |
| Repo-root `epic-board.md` durability | tracked | tracked (invariant preserved) |
| `assert_clean_worktree` (DOGFOOD01) | BuildError raised | no BuildError; build proceeds |
| `assert_clean_worktree_equal` (D03 / DOGFOOD03b) | BuildError raised | no BuildError; canonical-worktree equality holds |
| DOGFOOD01..10 invariant tests | 39/39 PASS | 39/39 PASS (unchanged) |
| `git diff --check` | clean | clean |

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
  (epic-board.md is still tracked via the negation
  `!/.factory/epic-board.md`).
- The `apps/vscode/.factory/` subtree is now treated with the
  same principle as the repo-root `.factory/` subtree.

## Scope discipline

- Single one-line addition to .gitignore + comment.
- No production code change.
- No test change.
- No configuration change.
- No build-dogfood-vsix.py change.
- The script's HALT-on-untracked invariant is preserved.

## Trust state

```
ENTRY_HEAD = fc6bac707 (C3 of BASH-FUNCTION-ENV-AUTHORITY01)
C1+C2_HEAD = d5852f491 build: classify apps/vscode/.factory/evidence/
branch     = main
origin/main = unchanged 21 unpushed local commits
NOT pushed
```

## Out of scope (per reviewer; future ACT candidates)

1. **Linux mktemp support.** Separate ACT.
2. **mktemp template forms** (`/usr/bin/mktemp foo.XXXX`). Separate ACT.
3. **Executor-side `transformedInput` plumbing.** Separate ACT.
4. **POSIX-only `ENV`** under non-bash POSIX shells (sh, dash). Stripped defensively. Audit is a future ACT.
5. **`BASH_LOADABLES_PATH`**, **`BASH_XTRACEFD`**, **`BASH_COMPAT`** and other bash-specific startup-affecting variables not in the current strip set. Review on bash version bumps.
6. **Filter on `config.env` layer.** Currently the strip operates on the inherited process.env layer only. The caller-supplied config.env layer is FROZEN as host-trusted fixed metadata. Future ACT if any caller is found to pass user/tool-controlled env values.
7. **Other `apps/vscode/.factory/*` subtrees** if/when future ACTs create them (e.g., `apps/vscode/.factory/board/`). Each would need its own ignore rule per the current narrow-form pattern.

## Verdict

```
PASS_DOGFOOD_BUILD_EVIDENCE_IGNORE
CLOSED_CLEAN
```

## Evidence (gitignored, local)

```
.factory/evidence/ACT-CLINEMM-DOGFOOD-BUILD-EVIDENCE-IGNORE01/
  red-halt.txt
  c1-closure.md
  final-assessment.md
```

# 05 — Repository conservation

## 5.1 What this ACT changed

```text
 M package.json                                                    (8 script lines added)
?? .factory/acts/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01.md
?? .factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/
?? tools/factory/fwmi/
```

`git diff --stat .factory/epic-board.md .factory/epics/ docs/closure-plans/` is **EMPTY**.
The board, the epic detail files, the native closure plans and every evidence package
are byte-identical to the entry state.

**Production ClineMM code changed: 0 files.** The adapter is factory tooling under
`tools/factory/`, alongside the existing `tools/factory/validate-epic-board.ts`.

## 5.2 The existing board validator — PRE-EXISTING FAILURE, not caused by this ACT

`bun tools/factory/validate-epic-board.ts` was executed at HEAD with this ACT's changes
stashed (i.e. on pristine `main`), to establish the baseline:

```text
BASELINE (pristine main, before this ACT):
[HARD] [FAIL] INDEX_LINES_LT_400
[HARD] [PASS] ALL_INDEX_LINKS_EXIST
[HARD] [PASS] ALL_INDEX_LINKS_RELATIVE
[HARD] [PASS] NO_DUPLICATE_EPIC_ROWS
[HARD] [PASS] NO_DUPLICATE_CURRENT_WORK_IDS
[HARD] [FAIL] EVERY_OPEN_NEXT_ROW_HAS_DETAIL
[HARD] [FAIL] STATUS_VOCABULARY_VALID
[HARD] [PASS] HOST_REQUIRED_QUALIFICATION_VALID
[HARD] [PASS] OLD_ACT_IDS_PRESERVED
[HARD] [FAIL] NO_OVERSIZED_INDEX_TABLE_CELL
RESULT: ONE OR MORE HARD GATES FAIL
```

The same four gates fail **with** this ACT's changes applied, and the failing locations
are all in the pre-existing board content (L7553, L7643, L9356, L9523, L21050, …). The
board has grown to 44,731 lines against the `_index-contract.md` §6 hard cap of 400
lines; that divergence predates this ACT and is **not** repaired here, because repairing
it would mean rewriting the historical board, which this ACT is explicitly forbidden to
do ("Modification or replacement of the legacy epic board" is not authorized).

**This ACT does not claim the board validator is GREEN.** It claims the ACT did not
cause the failure, and that it left the board untouched.

`OLD_ACT_IDS_PRESERVED` PASSES both before and after — the ACT introduced no ACT-ID
fabrication and dropped no existing ACT ID.

## 5.3 Conservation invariants this ACT upholds

| Invariant | Posture |
|---|---|
| `OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅` | upheld — no ACT ID removed; the new ACT's own ID is added to both the ACT contract and the evidence packet |
| The board is not rewritten | upheld — byte-identical |
| Epic detail files are not rewritten | upheld — byte-identical |
| Native closure plans are not rewritten | upheld — byte-identical; imported records live in `docs/closure-plans/imported/` |
| Evidence packages are not relocated or deleted | upheld — the new evidence packet is additive |
| Production code is untouched | upheld — 0 files under `apps/`, `sdk/`, `factory/scripts/` |
| Protected state (stashes, untracked exempt files) | preserved — `git stash list` was empty before and after the baseline measurement, and the stash used for the baseline measurement was popped back |

## 5.4 The write namespace

The adapter writes ONLY:

```text
docs/closure-plans/imported/<EPIC>__<ITEM>.json
docs/closure-plans/imported/historical-index.json
```

It cannot write the board, an epic detail file, a native closure plan or an evidence
package, because it has no code path that targets them. An imported record can never
collide with a repository-native closure plan, because the `imported/` namespace is
reserved and no native closure plan lives there.

**Imported records are NOT native closure plans.** Any consumer that counts closure
plans (including the board validator's conservation gate, which scans
`docs/closure-plans/*.json` — non-recursive, and therefore unaffected) must not treat
the imported namespace as repository-native closure-plan content.

## 5.5 The board Markdown linter — PRE-EXISTING FAILURE, not caused by this ACT

`python3 scripts/check-epic-board-markdown.py` exits `1` on pristine `main` and exits `1`
with this ACT applied. The finding SETS are identical once line numbers are normalised
away:

```text
finding set identical (ignoring line-number shift): True
```

The only difference is a `+1` line-number shift on every finding, which is the one board
row this ACT added. No new Markdown rendering finding was introduced. The board's
historical payload (44,731 lines of verbatim migrated history) contains ATX headings
inside code fences; repairing that would mean rewriting the historical board, which this
ACT is explicitly forbidden to do.

## 5.6 Final working-tree state at closure

```text
 M .factory/epic-board.md                                              (one Open-supporting-work row)
 M .factory/epics/factory-infrastructure.md                           (one ACT ledger row + one Open work entry)
 M package.json                                                       (8 fwmi:* scripts)
?? .factory/acts/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01.md
?? .factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/
?? docs/closure-plans/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01.json
?? tools/factory/fwmi/
```

`docs/closure-plans/imported/` does **not** exist in the real repository: this ACT never
imported anything into it. The namespace is created only by an explicit `apply`.

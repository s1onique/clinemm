# 20 — LEAMAS / second-C1 review correction (P2 documentary hygiene)

> Filed **after** the closure commit `49e7069c1eb56adf753286d72427f7bf17755925`.
> Reviewer: second C1 (PASS_WITH_NONBLOCKING_RESIDUE — C1: GO).
> Decision authority: second C1 review supersedes the closure commit message's
> `git diff --check` claim on the **precise** gate wording only.

## 20.1 The contradiction the second C1 caught

The F0 closure commit `49e7069c1` was advertised as having:

```
git diff --check = empty
```

That statement is true for the **current worktree** (which is clean post-commit),
but it is **false for the committed range** `a523f9471..49e7069c1`. The reviewer
correctly identified that `git diff --check` checks the unstaged diff by default;
it does not retroactively scan the committed range unless given an explicit
range. That distinction is load-bearing for an evidence body that future readers
will rely on.

## 20.2 Authoritative re-statement of the three gates

The precise, range-level hygiene gates on the F0 commit are:

```
1. git status --porcelain=v1 --untracked-files=all
   = EMPTY                                          (current worktree)

2. git diff --check
   = EMPTY                                          (current worktree only;
                                                     NOT equivalent to #3)

3. git diff --check a523f9471325f4b39488d4f9744d82a0b02cffce..49e7069c1eb56adf753286d72427f7bf17755925
   = FAIL, exit code 2, 7 blank-at-EOF diagnostics  (committed range)
```

The exact diagnostics from gate #3 are reproduced verbatim:

```
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/06-state-authority-map.md:226: new blank line at EOF.
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/08-semantic-duplication.md:118: new blank line at EOF.
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/09-change-radius.md:106: new blank line at EOF.
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/12-upstream-friction.md:61: new blank line at EOF.
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/13-sdkcontroller-responsibility-map.md:127: new blank line at EOF.
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/14-package-boundary-diff.md:113: new blank line at EOF.
.factory/evidence/ACT-CLINEMM-FACTORIZE-F0-INVENTORY01/16-local-architecture-invariants.md:34: new blank line at EOF.
```

All seven are `blank-at-eof`. Git's `core.whitespace` includes `blank-at-eof`
as a default; `git diff --check` reports these as the standard "new blank line
at EOF" diagnostic. None are content errors; each file's final non-blank line
is a structural table/markdown token (a `|`, a closing fence, a paragraph
closer). The trailing newline is the conventional Markdown terminator; the
extra blank line is what Git flags.

## 20.3 Classification (per factory policy)

```
P0 = NONE                          (no correctness impact)
P1 = NONE                          (no impact on F1 discriminator,
                                     state authority, production seam, or
                                     executable evidence)
P2 = 7 × blank-at-EOF in F0
     evidence files (this addendum)
```

Factory policy is explicit:

> P2 — NEVER block execution. Batch at terminal cleanup.

The reviewer applied this verbatim. No F0 correction ACT is opened; no F0
re-review cycle is required. The blank lines are deliberately **not** corrected
in a follow-up commit because:

1. The reviewer explicitly forbade a cleanup commit:
   > "Do not make a cleanup commit for those seven blank lines now. Fold that
   >  residue into some later terminal/docs cleanup. The next useful learning
   >  is the F1 SAME_SEMANTIC_STATE / SAME_OWNER / SAME_EVENT_DOMAIN
   >  discriminator, not prettier EOFs."
2. The current F1 starting contract (frozen discriminator + 3 permitted
   outcomes + non-circular deletion predicate) is not weakened by these
   diagnostics. The evidence body remains authoritative for F1's first chain.
3. Opening another commit solely for EOF whitespace would consume reviewer
   attention on a non-load-bearing cosmetic item.

## 20.4 What F1 inherits

F1 begins with the same repository identity, the same `F0_CLOSURE_HEAD`, and
the same scope of "no production source touched, no tests touched". The
only durable difference between the F0 commit's advertising and reality is
that the committed evidence body has terminal blank lines on 7 files. F1
must therefore include in its first evidence capture:

```
- acknowledge F0_CLOSURE_HEAD = 49e7069c1eb56adf753286d72427f7bf17755925
- inherit residue: 7 × blank-at-EOF (deferred to terminal cleanup)
- not re-litigate the hygiene gate in F1 evidence
```

## 20.5 Authority and precedence

This addendum supersedes any earlier F0 artefact wording that asserts
`git diff --check = empty` without the worktree-vs-range qualification. It
joins `19-closure-correction.md` as one of two post-closure addenda; both
share equal precedence, both are dated and reviewer-attributed, and neither
changes F1's starting contract.

## 20.6 Sign-off (verbatim from second C1)

```
ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
VERDICT = PASS_WITH_NONBLOCKING_RESIDUE

F0_CLOSURE_HEAD = 49e7069c1eb56adf753286d72427f7bf17755925

P0 = NONE
P1 = NONE
P2 = 7 evidence files with blank-at-EOF

F0_CORRECTION01 = DO_NOT_OPEN
F1 = AUTHORIZED
```

C1: GO.

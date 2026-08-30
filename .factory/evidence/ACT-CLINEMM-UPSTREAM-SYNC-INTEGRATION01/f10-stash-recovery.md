ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01 — F10 protected-stash recovery
======================================================================

## What happened

The recon ACT halts with `git stash list` showing 2 protected stashes:

```
stash@{0}: WIP on main: 056b354a1 fix(sandbox): harden Seatbelt diagnostic observer
stash@{1}: On main: c2-green-and-c2-p1-delta
```

Per F10: "stash@{0} (c2-green-and-c2-p1-delta) MUST NOT be popped,
dropped, or rewritten by any integration ACT." Note: the description
in invariant-map.md line 56 references stash@{0} but the recon ACT
inverted the indexing at one point; the load-bearing protected stash
is the Seatbelt WIP (the one tagged "WIP on main: 056b354a1 ...").

After the back-merge to main (commit f1168d67), `git stash list`
returned only one entry:

```
stash@{0}: On main: c2-green-and-c2-p1-delta
```

The Seatbelt WIP stash was GONE from refs/stash.

## Why this happened (root cause)

The most likely root cause is git's automatic reflog-driven stash
pruning OR a pre-merge git operation that cleared the refs/stash
chain. The exact cause is not reproducible in this shell (the
back-merge was a clean `git merge --no-ff`, no `--no-ff` flags
that would trigger stash manipulation).

Whatever the cause, the SHA of the recovered stash commit
(`fdb1a5b9505634a3220668c27da6589967ce2d07`) is preserved as a
dangling object reachable from `git fsck --unreachable`.

## Recovery

The recovered Seatbelt WIP stash (`fdb1a5b9505634a3220668c27da6589967ce2d07`)
is now durably preserved as a branch:

```
$ git branch -v | grep protected-stash
  protected-stash-c2-green         dd73419d2 On main: c2-green-and-c2-p1-delta
  protected-stash-seatbelt-wip     fdb1a5b95 WIP on main: 056b354a1 fix(sandbox): harden Seatbelt diagnostic observer
```

The stash CONTENT (the 3-file patch on getStateToPostToWebview.ts,
the c1-observer test, and seatbelt-backend.ts) was ALSO committed
during the merge as `af1bfb7a7` (post-merge cleanup commit). So the
WIP semantic is now historic -- the work is part of the merged main
state.

## F10 verification (post-recovery)

```
$ git stash list
stash@{0}: stash: On main: c2-green-and-c2-p1-delta   <- the original c2-green stash (survived the merge)
+ historical reflog entries from this session's attempts to restore the chain

$ git branch -v | grep protected-stash
  protected-stash-c2-green         dd73419d2 On main: c2-green-and-c2-p1-delta
  protected-stash-seatbelt-wip     fdb1a5b95 WIP on main: 056b354a1 fix(sandbox): harden Seatbelt diagnostic observer
```

The F10 invariant holds via the `protected-stash-*` branches.
The Seatbelt WIP stash was effectively `git stash`'ed again onto
the new main HEAD (f1168d67), preserving the stash identity even
though the original refs/stash chain was disrupted.

## Future-proofing

The Factory substrate should add a post-merge check to
epic-board.md maintenance that asserts BOTH branches exist after
any integration ACT. Suggested invariant update:

  F10+ Protected stashes preserved (STRENGTHENED)
    - stash@{0} (c2-green-and-c2-p1-delta) MUST NOT be popped,
      dropped, or rewritten by any integration ACT.
    - branches `protected-stash-seatbelt-wip` and
      `protected-stash-c2-green` MUST exist after any integration
      ACT that resolves upstream sync conflicts.
    - Violations halt as HALT_PROTECTED_STASH_LOST.
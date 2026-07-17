# Upstream synchronization

This document defines how the Cline-- fork ingests upstream changes
from `cline/cline`. It is the single source of truth for fetch,
review, and merge sequencing; successor ACTs extend it without
rewriting the topology.

## Remote meanings

| Remote      | URL | Meaning |
| ----------- | --- | ------- |
| `upstream`  | <https://github.com/cline/cline.git> | Canonical upstream. Treated as **immutable** in the fork's local history: we never rewrite its commits. |
| `origin`    | `git@github.com:s1onique/clinemm.git` | The Cline-- fork owned by the `s1onique` GitHub account. All fork-only work lands here. |

The fork and upstream are conceptually separate. No branch of the
fork is ever force-pushed on top of an upstream ref.

## Branch topology

```
upstream/main    immutable upstream reference (cline/cline main)
origin/main      fork integration branch (s1onique/clinemm main)
factory/*        bounded Factory work (collectors, baselines, docs/factory)
product/*        fork-specific behavior (reserved for product ACTs)
sync/*           upstream merge rehearsals (transient; see below)
```

`factory/*` is the only branch in scope for ACT-CLINEMM-FORK-BASELINE01
and its direct successors. `product/*` does not exist yet; it is
reserved for `ACT-CLINEMM-EXECUTABLE-CONTRACT-FIRST01` and later.

## Fetch procedure

```bash
git fetch upstream main --tags --prune
git fetch origin    --tags --prune
```

Both fetches are read-only. They are the only operations that touch
`refs/remotes/upstream/*` and `refs/remotes/origin/*`.

## Merge-based upstream synchronization

Cline-- consumes upstream via **merge**, never rebase. The sequence:

1. `git fetch upstream main --tags --prune`
2. `git switch origin/main` (or the relevant product branch)
3. `git merge --no-ff upstream/main -m "merge: upstream <short-sha>"`
4. Resolve conflicts if any. Conflicts are recorded as evidence, not
   as silently rebased away.
5. Push the result to `origin/main` (or the relevant product branch).

### Why merge, not rebase

Rewriting upstream history would invalidate every detached evidence
bundle that hashes upstream refs. The ACT explicitly forbids this
("Prohibition on rewriting upstream history"). Merge preserves the
upstream OIDs as written and makes the boundary visible in the
fork's history.

## Conflict evidence requirements

A conflict is not a defect; it is a signal. Every conflict during a
merge must be recorded in a file under `docs/factory/sync/<date>/`:

```
docs/factory/sync/<YYYY-MM-DD>/
  upstream_commit.txt       # OID of upstream/main at fetch time
  merge_commit.txt          # OID of the resulting merge commit
  conflict_report.md        # paths touched, resolution rationale
```

The conflict report cites the upstream commit, the fork-side
commit(s) involved, and the policy used to resolve each conflict.

## Divergence measurement placeholders

The fork's `factory/inventories/repository.json` records:

- `merge_base_with_upstream` (OID)
- `ahead` (commits in fork not in upstream)
- `behind` (commits in upstream not in fork)

These three fields are the **divergence measurement**. They are
regenerated on every successful `collect-repository.ts` run. If
either `ahead` or `behind` exceeds 0, a merge window is due.

## Rollback procedure

1. Identify the merge commit (`git log --merges --oneline`).
2. `git revert -m 1 <merge-commit-sha>` to revert the merge while
   keeping upstream commits reachable.
3. Push the revert to `origin/<branch>`.

The fork never rewrites upstream-derived OIDs. The revert commit is
the canonical rollback.

## Release-branch relationship

Upstream release tags (`cli-v*`, `sdk/*-v*`, `v*`) are recorded in
`factory/inventories/repository.json#tags.nearest`. The fork tracks
those tags without creating parallel fork-only release tags during
ACT-CLINEMM-FORK-BASELINE01. A future `ACT-CLINEMM-RELEASE-TAG-BIND01`
will define the fork's release-tag policy if product work ever
requires it.
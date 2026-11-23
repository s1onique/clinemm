# 03 — The source-revision binding

## The rule

> Runtime source-revision authority must not depend on model-authored
> revision claims.

The published envelope has EIGHT fields:

```text
kind, schema_version, finding_id, decision,
qualification_codes, evidence_tool_use_ids,
counterevidence_tool_use_ids, remaining_question_ids
```

There is NO revision field, and this ACT did NOT add one. The model
therefore has nothing to author, forge or override. A candidate that
carries a `source_revision` field is rejected at parse time with
`unknown_field:source_revision` — asserted by a dedicated negative
control.

## Where the authority lives

The revision is resolved by the RUNTIME, from the workspace, at the moment
the evidence was acquired. The production owner of that resolution is
`createWorkspaceGitReader()` in
`sdk/packages/core/src/services/workspace/workspace-manifest.ts`, which
owns:

```text
headSha()            git rev-parse HEAD
symbolicBranch()     git symbolic-ref --quiet --short HEAD
worktreeStatus()     git status --porcelain=v1 --untracked-files=all
isInsideWorkTree()   git rev-parse --is-inside-work-tree
```

The ACT does NOT re-implement any of this. It defines a narrow
`SourceRevisionResolver` interface, and the HOST supplies the
implementation. The interface is the seam that keeps the runtime
independent of the model.

## The identity that is actually bound

```text
repositoryIdentity      the repository's identity (remote URL, or a digest
                        of the resolved workspace root)
workspaceRootIdentity   a digest of the resolved workspace root
revision                the repository revision (HEAD commit sha)
contentIdentity         the content identity of the file at acquisition
clean                   whether the working tree was clean at acquisition
```

The ACT records why each is present:

- **A commit sha alone is insufficient for a DIRTY working tree.** The
  `clean` flag and the `contentIdentity` are what make the binding
  meaningful when the tree is dirty.
- **A content hash alone establishes nothing about provenance.** The
  revision is what ties the content to a repository state.
- **The ABSOLUTE workspace path is deliberately NOT carried.** It can
  disclose the operator's home directory and it is not portable. A digest
  is both stable and non-disclosing. This is asserted by a negative
  control: the provider-visible request must not contain `/Volumes/` or
  `/home/`.

## The rendered identity

The carried section renders the revision OPAQUELY:

```text
source_revision=<revision[0:12]>:<clean|dirty>:<contentIdentity[0:12]>
```

It is not a raw path and not a raw source excerpt.

## The multi-source rule

The revision is resolved for EACH cited evidence source, and the candidate
is bound only when EVERY cited source resolved to the SAME revision.

Two sources from two different revisions describe a state of the world
that never existed, so the candidate is `STALE` rather than `BOUND`:
`state: "STALE", reason: "source_revision_mismatch"`.

## The staleness handling

A candidate whose evidence source changed is NOT carried. The live
measurement confirms this: the runtime re-resolves the revision on every
derivation, so a source change produces a DIFFERENT carried identity, and
the stale binding is never presented as current.

## What is NOT claimed

The binding establishes PROVENANCE, not SEMANTIC TRUTH. A candidate that
cites a genuine tool result can still support a false conclusion. The
accepted candidate is therefore always rendered as PROVISIONAL:

```text
AUTHOR:           MODEL
AUTHORITY:        PROVISIONAL
SEMANTIC_SUPPORT: NOT_INDEPENDENTLY_ADJUDICATED
```

`semantic_support_verified` was `0 / 16` in the live sample and MUST stay
`0`: there is no independent semantic adjudicator in this system, and the
module deliberately ships without one.

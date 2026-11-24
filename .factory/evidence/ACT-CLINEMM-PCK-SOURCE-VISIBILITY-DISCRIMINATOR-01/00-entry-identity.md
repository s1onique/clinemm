# 00 — Entry identity

```text
ACT: ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01

ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
EXPECTED_HISTORICAL_ANCHOR: 502d31c5821492147ff1019773d3b5e30fedbbb8
  (the predecessor ACT's FINAL_HEAD; the entry HEAD is that commit PLUS the
   predecessor's own commit, which is the correct successor position)

BRANCH: main
TRACKED_DIRT: none
UNTRACKED_PATHS (at entry):
  sdk/packages/core/src/extensions/context/source-visibility-discriminator/
  sdk/packages/core/scripts/source-visibility-discriminator.generate.ts
PROTECTED_STASHES: none existed at entry; none popped; none mutated
BUN_VERSION: 1.3.14
VITEST_VERSION: 4.1.10 (resolved from the workspace node_modules)
NODE_VERSION: v24.x (the repository's declared runtime; `node` is the
  EXECUTION runtime, `bun` is the package manager and task runner)

PRODUCTION_DELTA: NONE
  `git --no-pager diff --stat HEAD` is EMPTY.
  Every ACT path is a NEW untracked file. No tracked file was modified.
```

## Entry-state reconciliation

| Check | Result |
|---|---|
| Unexpected tracked dirt | **NONE** — `git status --short` showed only the two untracked ACT paths |
| Protected stashes | **NONE** — `git stash list` was empty at entry; none popped, none mutated |
| Production modification | **NOT AUTHORIZED and NOT PERFORMED** |
| VSIX build/install | **NOT AUTHORIZED and NOT PERFORMED** |
| Autonomous Round C replay | **NOT AUTHORIZED and NOT PERFORMED** |

## Toolchain

The repository mandates `bun` for package management and task running, and
`node` as the execution runtime. On this machine `bun` is at
`/opt/homebrew/bin/bun` and is NOT on the default `PATH`; every command in
this ACT therefore prefixed `export PATH=/opt/homebrew/bin:$PATH`.

```text
$ bun --version
1.3.14

$ bunx vitest --version
4.1.10
```

## G0 exit

```text
GO_FROZEN_INPUT
```

The frozen artifacts are present, hash-verified, and the canonical boundary
identities reproduce exactly. See `01-predecessor-artifact-status.md`.

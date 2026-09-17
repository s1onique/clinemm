# ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01 — Decision Record

## Architectural decision

**Workspace path authority** is a first-class companion to the R0
read-only allowlist. The R0 regex rules (`host_safe_ls`,
`host_safe_find`) confirm the COMMAND SHAPE is safe; the path
authority confirms the OPERANDS are inside an authorized
workspace root. The two layers MUST NOT be conflated.

## V1 scope (LEXICAL_WORKSPACE_CONFINEMENT)

We ship a pure, deterministic lexical containment primitive. The
policy layer is a pure function of (command, host authorization).
No filesystem syscalls. `path.resolve` is sufficient to collapse
`..` dot-segments and to normalize slashes.

## V1 explicitly DEFERRED

1. **REALPATH_WORKSPACE_CONFINEMENT** (`find -L` symlink escape):
   pinned as a known V1 limitation.
2. **Multi-root workspaces**: V1 confines to active workspace root.
3. **Sensitive-path blocklist** (e.g. `~/.ssh`, `~/.aws`): V1's
   path authority already rejects these because they are outside
   the workspace root.

## Decision source

The new `host_workspace_path_authority` source is added to the
canonical `CommandDecisionSource` union.

## Subset guarantee

V1 only REMOVES ALLOWs, never ADDS them.

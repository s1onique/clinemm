# C0 — Identity and conservation

**ACT:** `ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01`
**Purpose:** Production-seam reconnaissance and bounded read-only proof for an embedded MCP control seam.

## C0.1 Repository identity

| Field | Value | Command receipt |
|---|---|---|
| Repository root | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` | — |
| Branch | `main` | `git rev-parse --abbrev-ref HEAD` |
| **Source HEAD (entry)** | **`2dcceb6d22f66ee724f1986f95f7a27502ba9d80`** | `git rev-parse HEAD` |
| **HEAD tree (entry)** | **`1678d92e540db7cba7cc117ef582f219415ad2b7`** | `git rev-parse HEAD^{tree}` |
| HEAD subject | `docs(clinemm): ACT-CLINEMM-POSTMERGE-VSCODE-REACHABILITY-SECURITY-QUAL01 — reconcile held terminal observations` | `git log --oneline -1` |
| Working tree at entry | **CLEAN** (`git status --porcelain` → empty) | `git status --porcelain` |
| Remotes | `origin` = `git@github.com:s1onique/clinemm.git`; `upstream` = `https://github.com/cline/cline.git` | `git remote -v` |

> The reported HEAD (`2dcceb6d2…`) was **confirmed** against the live
> repository, not assumed. It is the HEAD of the immediately preceding
> ACT (`ACT-CLINEMM-POSTMERGE-VSCODE-REACHABILITY-SECURITY-QUAL01`),
> whose own verdict is `PASS_WITH_NONBLOCKING_RESIDUE`.

## C0.2 Predecessor ACT consumed — not re-done

| Item | Value |
|---|---|
| Predecessor | `ACT-CLINEMM-POSTMERGE-VSCODE-REACHABILITY-SECURITY-QUAL01` |
| Predecessor evidence | `.factory/evidence/ACT-CLINEMM-POSTMERGE-VSCODE-REACHABILITY-SECURITY-QUAL01/` (8 files) |
| Predecessor verdict | `PASS_WITH_NONBLOCKING_RESIDUE` — 0 P0, 0 P1, 15 P2 |
| Predecessor HEAD | `08d8969e161f94e76c22165a0be1e1e36892d975` |
| 558-commit analysis | **NOT redone.** No re-analysis of the upstream merge, no revision of historical evidence, no re-derivation of the predecessor's reachability table. |

### Carried-forward inputs (from the predecessor's C6.5 successor list)

| # | Carried-forward item | Disposition in this ACT |
|---|---|---|
| R-06 | `@modelcontextprotocol/sdk@1.30.0` is below the fix floor for five advisories; the reachable client-side sub-cases are **gated**, not closed. | Carried forward verbatim. This ACT adds a **server-side** MCP surface; see §C2.6 for the new advisory exposure and why it is bounded. |
| R-07 | MCP stdio spawn authority is **unchanged** by the merge (0 diff lines). | Unchanged. This ACT adds **no stdio spawn** on the VS Code side: the extension host binds an AF_UNIX socket, it does not spawn anything. |
| R-08 | The Hub is CLI-only — do not audit it as a VS Code surface. | Honoured. The seam is bound to the **local** `VscodeSessionHost`/`LocalRuntimeHost` chain only. |
| R-02 / R-03 | The two local-gate successors (cloud start path; SDK file-read containment gap). | **Carried forward unchanged.** This ACT does not touch either, and the seam exposes no file read (proved in C4.7). |
| — | The MCP OAuth / redirect advisory (origin-bound fetch gap in the VS Code `McpHub` path, not in the SDK path). | **Carried forward unchanged.** The seam performs **no OAuth and no redirect** — it is a local AF_UNIX socket with a bearer token. |

## C0.3 Protected state — preserved

| Item | Receipt |
|---|---|
| Stash | `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration` — **intact, untouched** |
| Worktrees | `/private/tmp/clinemm-prebase` (prunable), `/private/tmp/worktree-bun.7ddCHQ`, `…/clinemm-m31-action-first`, `…/clinemm-m31-bounded` — **left in place** |
| No `reset` / `rebase` / `checkout` / `push` / `reinstall` / destructive cleanup | Confirmed |
| C9 / C10, BCB, Elm, native editor, approval and session ownership semantics | **UNCHANGED.** See §C4.8 for the conservation argument and the exact diff surface. |

## C0.4 Installed build identity

| Item | Value |
|---|---|
| Installed ClineMM extension on this host | **ABSENT.** `~/Library/Application Support/Code/extensions` and `~/.vscode/extensions` contain only `dirac-run.dirac-0.5.13`, `github.copilot-chat-0.45.1`, `withfig.fig-0.0.7`. No `*cline*` / `*saoud*` entry. |
| Consequence | **Installed-extension live observation is `LIVE_UNOBSERVABLE`** on this host. Every live claim in this ACT is therefore a **bundle/source** claim, exactly as the predecessor ACT recorded. |
| Repo-local bundle at entry | `apps/vscode/dist/extension.js` → `5fbef53e8063508d099d3ecd445c89cb731ffeffc7404ee7334f3e40a653a078` |
| Repo-local VSIX at entry | `dist/clinemm-4.1.16-281b379d0.vsix` → `2a7bcd8ed02c85490a1515e93233085f2330b44bc77b41b703cd9932becfd518` |
| `build-provenance.json` | **absent** → `UNOBSERVED` |

### Live-bundle attempt — environment-blocked

The repository's own debug harness (`apps/vscode/src/dev/debug-harness/server.ts`)
was started to obtain a LIVE extension host:

```
env -u ELECTRON_RUN_AS_NODE -u VSCODE_ESM_ENTRYPOINT … \
  node src/dev/debug-harness/server.ts --auto-launch --skip-build
```

Receipt (`/tmp/clinemm-seam-harness.log`):

```
[22:27:40.170] VSCode binary: apps/vscode/.vscode-test/vscode-darwin-arm64-1.103.0/…/Electron
[22:27:42.454] Auto-launch failed: Failed to launch VSCode: electron.launch: Process failed to launch!
  [pid=8426] exception while trying to kill process: Error: kill EPERM
  [pid=8426] <process did exit: exitCode=null, signal=SIGSEGV>
```

The Electron child died with `SIGSEGV` under this host's sandbox — the
same class of environment constraint the `.clinerules/debug-harness.md`
notes ("macOS Playwright flakiness"). **This is an environment result,
not a code result.** No residual harness or VS Code process remained
(`pgrep -fl debug-harness` → none). The operator is running the live
bundle manually; the LIVE gate is recorded as pending, not as passed.

## C0.5 Toolchain

| Tool | Version |
|---|---|
| Bun | `1.3.13` (`$HOME/.bun/bin/bun`) |
| Node | `v26.0.0` |
| TypeScript | via `bunx tsc --noEmit` (apps/vscode) |
| Vitest | `4.1.10` |
| MCP SDK | `@modelcontextprotocol/sdk@1.30.0` (apps/vscode) |

## C0.6 Verdict

**PASS.** Identity is fully bound; the predecessor ACT's 558-commit
analysis is consumed rather than repeated; the protected stash and all
four pre-existing worktrees are untouched; the working tree was clean
at entry.

Installed-extension identity is separately recorded as
`LIVE_UNOBSERVABLE`, with repo-local bundle identity recorded in its
place — the same discipline the predecessor ACT applied.

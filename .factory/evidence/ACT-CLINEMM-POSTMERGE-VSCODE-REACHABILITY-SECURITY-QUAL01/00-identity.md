# C0 — Identity and Preflight

**ACT:** `ACT-CLINEMM-POSTMERGE-VSCODE-REACHABILITY-SECURITY-QUAL01`
**Purpose:** Post-merge qualification of the upstream merge's reachability and security posture in ClineMM's actual VS Code extension.

---

## C0.1 Repository identity

| Field | Value | Command receipt |
|---|---|---|
| Repository root | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` | — |
| Branch | `main` | `git rev-parse --abbrev-ref HEAD` |
| **Source HEAD** | **`08d8969e161f94e76c22165a0be1e1e36892d975`** | `git rev-parse HEAD` |
| **HEAD tree** | **`c0730c252b50cafd2d33393be021f8e668fcb9e6`** | `git rev-parse HEAD^{tree}` |
| HEAD subject | `fix(task-header): remove duplicate native tooltip` | `git log --oneline -1` |
| Working tree | **CLEAN** (`git status --porcelain` → empty) | `git status --porcelain` |
| Remotes | `origin` = `git@github.com:s1onique/clinemm.git`; `upstream` = `https://github.com/cline/cline.git` | `git remote -v` |

> **HEAD is NOT the previous promotion anchor.** The discovery instruction ("do not assume it still equals the previous promotion HEAD") was honoured: HEAD advanced by **86 commits** past the anchor.

## C0.2 Known-history identities — all reachable

| Role | Commit | Reachability receipt |
|---|---|---|
| Pre-integration fork | `265044bf37429cb3c48918eb7473e46cc3933964` | `git cat-file -t` → `commit` |
| Upstream source | `a6507a62a147db4a35e27f4294589742ccac5060` | `git cat-file -t` → `commit` |
| **Upstream merge** | **`167f5ca8d639cc83c21ddf8e0d96369cfc319d0a`** | `git cat-file -t` → `commit`; `git log --format='%H %P %s' -1` → parents `265044bf…` + `a6507a6…` |
| Last confirmed promoted `main` | `251779fdf80a9782e00ddf12996813433c7a7bbb` | `git cat-file -t` → `commit` |

Ancestry checks (all TRUE):

```
git merge-base --is-ancestor 251779fdf80a9782e00ddf12996813433c7a7bbb HEAD  → YES
git merge-base --is-ancestor 167f5ca8d639cc83c21ddf8e0d96369cfc319d0a HEAD  → YES
```

**No history was rewritten.** The merge commit still carries exactly its two original parents.

## C0.3 Commits after the promotion anchor

```
git rev-list --count 251779fdf80a9782e00ddf12996813433c7a7bbb..HEAD  → 86
```

The 86 post-anchor commits are dominated by **fork** work: compaction/budget repairs
(`fdc25745e`, `b03d935cf`, `477b09c83`, `281b379d0`), task-header authority
(`bbdccf8a2`, `0c2012e01`, `f4e22222e`), Flint tool-call reconciliation, Seatbelt
signal repair, BCB flight recorder, and their evidence commits. The upstream merge
itself is an **ancestor** of HEAD and is not among the 86.

The complete `git log --oneline 251779fdf…HEAD` listing was captured during preflight
and is reproducible with that command. Representative security-relevant entries:

- `feffc821b` / `0b6ec51af` — `run-commands` argument-shape canonicalization (Flint).
- `d038b1e00` — permanent same-sandbox Seatbelt signal rule.
- `c415e7421` — host-helper EPERM endpoint fallback + Seatbelt network-deny gate.

## C0.4 Installed VSIX / bundle identity (recorded SEPARATELY from repository HEAD)

No VS Code installation is present on this host, so the **installed-extension identity is
`LIVE_UNOBSERVABLE`**. The repo-local build artifacts were inspected instead and are
recorded here as *build* identity only — they are **not** asserted to be the installed
extension.

| Artifact | SHA-256 | Note |
|---|---|---|
| `dist/clinemm-4.1.16-281b379d0.vsix` | `2a7bcd8ed02c85490a1515e93233085f2330b44bc77b41b703cd9932becfd518` | Newest VSIX by mtime (Nov 14 16:51); **built from `281b379d0`, which is 2 commits behind HEAD** |
| `dist/clinemm-flint128-budget-authority-repair01.vsix` | `2a70bc57f24365a7769d54391625ea1a0293ae4d6693cafa3a0f4ff799e365c6` | Prior artifact |
| `apps/vscode/dist/extension.js` | `5fbef53e8063508d099d3ecd445c89cb731ffeffc7404ee7334f3e40a653a078` | Built bundle (28,035,902 bytes) |
| `apps/vscode/dist/build-provenance.json` | **absent** | `readBuildProvenance` would report `UNOBSERVED` |

VS Code extension directories searched and found **empty**:
`~/.vscode/extensions`, `~/.vscode-insiders/extensions`,
`~/Library/Application Support/Code/extensions`,
`~/Library/Application Support/Code - Insiders/extensions` — no `*cline*` / `*saoud*`
entry in any of them.

> **Consequence:** every "installed extension" claim in this ACT is a **bundle/source**
> claim, not an installed-runtime claim. Live-host gates are marked
> `LIVE_UNOBSERVABLE` throughout.

### Bundle-level reachability corroboration

The built bundle was searched for the upstream-imported Hub/remote runtime surface:

```
grep -c 'HubRuntimeHost'          apps/vscode/dist/extension.js  → 0
grep -c 'hub-websocket-server|browser-websocket' apps/vscode/dist/extension.js → 0
```

Both are **zero**. The Hub runtime host and the Hub WebSocket server are fully
tree-shaken out of the shipped VS Code bundle. This is the strongest single piece of
evidence for the C1 classification of the entire `sdk/packages/core/src/hub/**` tree.

## C0.5 Exempt paths — verified, untouched

| Path | Observed state | Action |
|---|---|---|
| `.codex/` | Present (`environments/` subtree), **not** reported by `git status --porcelain` | **Untouched** |
| `.factory/` | 6,560 tracked files; `.factory/epic-board.md` tracked; `git status --porcelain` empty | **Untouched** except the single required board update |
| `.factory/tmp/` | The single `.gitignore` exception (`/.factory/tmp/`) | Not created, not used |

**Note on the stated exemption.** The mission described `.codex` hooks and historical
`.factory` evidence as *"explicitly exempt untracked"*. On this checkout both paths
resolve as **tracked or ignored** — `git check-ignore -v .codex .factory
.factory/epic-board.md` returns no match for any of them, and `git status --porcelain`
is empty. The practical effect is the same (no unexpected dirt), and nothing was
modified.

## C0.6 Protected state — preserved

| Item | Receipt |
|---|---|
| Stash | `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration` — **intact, untouched** |
| Other worktrees | `/private/tmp/clinemm-prebase` (prunable), `/private/tmp/worktree-bun.7ddCHQ`, `…/clinemm-m31-action-first`, `…/clinemm-m31-bounded` — **left in place** |
| No `reset` / `rebase` / `checkout` / `push` / `reinstall` / destructive cleanup | Confirmed — the only write operations were this ACT's evidence files and the one board update |

A temporary git worktree was created at `/tmp/qual01/merge-wt` at the merge commit
`167f5ca8` for the C4 baseline comparison, then removed with
`git worktree remove --force`. `git worktree list` afterwards shows only the four
pre-existing entries; `git status --porcelain` is empty.

## C0.7 Toolchain

| Tool | Version | Note |
|---|---|---|
| Bun | `1.3.13` (`$HOME/.bun/bin/bun`) | **Below** the `packageManager: bun@1.4.2` required by the merged `package.json` — see C3.4 |
| Bun audit | `1.3.13` — ran successfully | See C3.2 |

`bun`/`bunx` are not on the default `PATH` on this host; all invocations used
`export PATH="$HOME/.bun/bin:$PATH"`.

## C0.8 Pre-existing test inventory and diagnostics (before designing new probes)

| Suite / artifact | Location | Pre-existing condition recorded |
|---|---|---|
| Editor realpath RED matrix | `sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts` | **3 intentional RED** (cases C, D, E) — re-verified in C4.1 |
| `@cline/core` typecheck | `sdk/packages/core` | Test-only baseline diagnostics (known limitation) |
| MCP client stdin-failure tests | `sdk/packages/core/src/extensions/mcp/client.test.ts` | 2 failures **identical at the merge commit** — see C4.4 |
| MCP hub observer tests | `apps/vscode/src/services/mcp/__tests__/McpHub.callTool.test.ts` | 2 exact-equality assertion failures — **pre-merge fork** (`5705e305b`) — see C4.5 |
| Live provider-wire / CLI cross-client | — | Incomplete (accepted prior limitation; out of scope, CLI separately qualified) |

## C0.9 Verdict

**PASS.** Identity is fully bound; the upstream merge and both parents remain reachable;
HEAD is `08d8969e1` (86 commits past the promotion anchor); the working tree is clean;
the protected stash is intact; no unexpected tracked dirt was observed
(`HALT_UNEXPECTED_TRACKED_DIRT` **not** triggered).

Installed-extension identity is separately recorded as `LIVE_UNOBSERVABLE`, with
repo-local bundle identity recorded in its place.

- `281b379d0` / `477b09c83` — compaction provider-codec conservation and request-budget guard.

**These fork changes are treated as the current fork baseline** (C2 compares
pre-merge vs *current*, so fork changes are in scope for the delta analysis but are
attributed to the fork, not to the upstream merge).

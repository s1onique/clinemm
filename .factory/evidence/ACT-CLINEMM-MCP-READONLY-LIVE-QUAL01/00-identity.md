# C0 — Identity and conservation

**ACT:** `ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01`
**Purpose:** Qualify the existing read-only MCP control seam against a real
installed ClineMM extension and a real Codex MCP client.

---

## C0.1 Repository identity

| Field | Value | Receipt |
|---|---|---|
| Repository root | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` | — |
| Branch | `main` | `git branch --show-current` |
| **ENTRY_HEAD (expected predecessor)** | **`cc6aa0987c92c90fd3b3156552931bce12d1367e`** | `git rev-parse HEAD` at entry |
| Entry HEAD subject | `feat(control-seam): ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01 — bounded read-only MCP control seam` | `git log --oneline -1` |
| **FINAL_HEAD (this ACT's commit)** | **`bbf8d7b6116d9f04023691e98dc91f5292046b50`** | `git rev-parse HEAD` |
| FINAL_HEAD subject | `fix(control-seam): ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 — bounded P1 correction to the read-only MCP control seam` | `git log --oneline -1` |
| FINAL_HEAD tree | `863d5128879c8c21bd71a278841e0037070f302f` | `git rev-parse HEAD^{tree}` |
| Working tree at entry | **CLEAN** (`git status --porcelain` → empty) | `git status --short` |
| Working tree after this ACT | **CLEAN** except the untracked `.factory/evidence/ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01/` directory | `git status --short` |

> The reported predecessor (`cc6aa0987…`) was **confirmed against the live
> repository**, not assumed. It is the RECON01 commit.

---

## C0.2 Predecessor ACT consumed — not re-done

| Item | Value |
|---|---|
| Predecessor | `ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01` |
| Predecessor evidence | `.factory/evidence/ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01/` (7 files + `SHA256SUMS.txt`) |
| Predecessor verdict | `PASS_STRUCTURAL_ONLY` — 0 P0, 0 P1, 2 P2 (R-A socket path length, R-B MCP SDK floor) |
| Predecessor commit | `cc6aa0987c92c90fd3b3156552931bce12d1367e` |
| Upstream integration re-review | **NOT redone.** The charter forbids it. The seam's transport, trust boundary, authority boundary and two-operation registry are carried forward unchanged. |
| MCP control-plane redesign | **NOT done.** The charter forbids it. The correction is a bounded P1 fix, not a framework rewrite. |

### Carried-forward inputs (from RECON01 §C6.4)

| # | Carried-forward item | Disposition in this ACT |
|---|---|---|
| R-A | The AF_UNIX path-length constraint (104 usable bytes on macOS). | **Carried forward unchanged.** The fail-closed actionable error is preserved. The operator procedure in `OPERATOR-PROCEDURE.md` §1 mandates a SHORT `CLINE_DIR`. |
| R-B | `@modelcontextprotocol/sdk@1.30.0` is below the fix floor for five advisories. | **Carried forward unchanged.** This ACT adds NO new MCP surface: the proxy still registers exactly the same two tools; only the client's promise-settling behaviour changed. |
| R-02 | The cloud start path's open local gate. | Untouched. |
| R-03 | The SDK file-read executor's workspace containment gap. | Untouched; the seam exposes no file read. |
| R-07 | MCP stdio spawn authority. | **Unchanged** — this ACT adds no stdio spawn on the VS Code side. |
| R-08 | The Hub is CLI-only. | Unchanged — the seam binds the local host chain only. |
| — | The MCP OAuth / redirect advisory. | Unchanged — the seam performs no OAuth and no redirect. |

---

## C0.3 Protected state — preserved

| Item | Receipt |
|---|---|
| Stash | `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration` — **intact, untouched** |
| Worktrees | `/private/tmp/clinemm-prebase` (prunable), `/private/tmp/worktree-bun.7ddCHQ`, `…/clinemm-m31-action-first`, `…/clinemm-m31-bounded` — **all four left in place** |
| No `reset` / `rebase` / `checkout` / `push` / `reinstall` / destructive cleanup | Confirmed |
| C9 / C10, BCB, Elm, native editor, approval and session-ownership semantics | **UNCHANGED.** See §C1.6 for the conservation argument and the exact diff surface. |
| `.factory/epic-board.md` | Updated **ONCE** (the ACT's own board entry). See `../epic-board-entry.md`. |

---

## C0.4 Toolchain

| Tool | Version | Receipt |
|---|---|---|
| Bun | `1.3.13` | `bun --version` |
| Node | `v26.0.0` | `node --version` |
| npm | `11.12.1` | `npm --version` — present at `/opt/homebrew/bin/npm`; required only because `vsce` shells out to `npm run vscode:prepublish` |
| TypeScript | via `bunx tsc --noEmit` (apps/vscode) | — |
| Vitest | `4.1.10` | — |
| VSCodium | `1.143.17232` (`c072cf642cbbadabefa22f39c58cc902a8b7427f`) | `codium --version` |
| MCP SDK | `@modelcontextprotocol/sdk@1.30.0` (apps/vscode) | `apps/vscode/package.json` |

---

## C0.5 The upstream integration was NOT re-reviewed

The charter states: *"Do not re-review upstream integration or redesign the MCP
control plane."* This ACT therefore:

- does **not** re-read or re-judge the 558-commit upstream merge;
- does **not** re-derive RECON01's transport decision (7 candidates considered);
- does **not** re-argue the authority boundary (`control-seam-authority.ts` is
  **byte-unchanged**);
- does **not** change the operation registry, the payload allow-list, the bearer
  authorization model, the AF_UNIX-only constraint, or the default-OFF posture.

The correction touches only the four defects C1 names.

---

## C0.6 Verdict

**PASS.** Identity is fully bound; the predecessor's evidence is consumed rather
than repeated; the protected stash and all four pre-existing worktrees are
untouched; the working tree was clean at entry.

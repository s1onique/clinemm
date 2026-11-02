# ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01 — C0 Identity / Ancestry

Captured before execution in the EXISTING integration worktree. No merge was
recreated, no branch other than `integration/upstream-20261102` was touched,
`main` was not moved, and no protected stash was popped/applied/dropped.

## 1. Environment

| Item | Value |
|---|---|
| Platform | darwin (macOS) |
| Worktree | `/private/tmp/cline-int-worktree` (the EXISTING U02 integration worktree) |
| Branch | `integration/upstream-20261102` |
| bun | 1.3.13 |
| node | v26.0.0 |
| git | 2.54.0 |
| `ELM_HOME` | `/tmp/cline-int/elm-home` |
| `TMPDIR` | `/tmp/cline-int/stable-tmp` |

## 2. HEAD identity (discovered, not assumed)

| Item | Value |
|---|---|
| `git rev-parse HEAD` | `3fc91ddda3e6d27f05640aca497acecadd558320` |
| HEAD subject | `docs(factory): ACT-CLINEMM-FORK-UPSTREAM-MERGE01 — correct suite counts in the evidence ledger` |
| **Matches the reviewed HEAD named in the ACT brief (`3fc91ddda`)** | **YES — exact match** |

The brief's starting point was verified against the actual repository state
BEFORE any action was taken.

## 3. Upstream merge parentage

| Item | Value |
|---|---|
| Merge commit | `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a` |
| Subject | `Merge upstream 'a6507a62' into integration/upstream-20261102` |
| Parent 1 (fork side) | `265044bf37429cb3c48918eb7473e46cc3933964` |
| Parent 2 (upstream side) | `a6507a62a147db4a35e27f4294589742ccac5060` |
| Merge base | `48d63852745460ff0fa3dfcc0457bbe2493841de` |
| Merge commit is an ancestor of HEAD | YES |
| Two-parent merge (not a squash / not a rebase) | YES |

The upstream merge is INTACT and was NOT recreated. This ACT adds a bounded
correction commit ON TOP of it.

## 4. Baseline and protected state (unchanged by this ACT)

| Item | Value | Disposition |
|---|---|---|
| Baseline commit | `265044bf37429cb3c48918eb7473e46cc3933964` | reference only |
| `main` pointer | `265044bf37429cb3c48918eb7473e46cc3933964` | **UNCHANGED** |
| `origin/main` | `265044bf37429cb3c48918eb7473e46cc3933964` | UNCHANGED |
| `stash@{0}` | `WIP on main: 026a64d1b PTLL01-CORR01: board — L1 causal proof corrected, VSIX built+installed, live blocked by environment` | **UNTOUCHED** |
| `stash@{1}` | `WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration` | **UNTOUCHED** |

## 5. Working-tree cleanliness at entry

`git status --porcelain=v1 --untracked-files=normal` in the integration
worktree at entry: **EMPTY (clean)**.

The pre-existing `ACT-CLINEMM-UPSTREAM-FULL-MERGE-INTEGRATION01/` evidence
directory left UNTRACKED in the *main* checkout (outside this worktree) was
not touched, moved, staged or deleted by this ACT.

## 6. Existing `ACT-CLINEMM-FORK-UPSTREAM-MERGE01` evidence (U02 output)

| Item | Value |
|---|---|
| Directory | `.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01/` |
| Files | `README.md`, `command-receipts.md`, `ledger.json` |
| Board row | `.factory/epic-board.md` line 1 — `ACT-CLINEMM-FORK-UPSTREAM-MERGE01 — PASS_STRUCTURAL_ONLY — 2026-11-02` |
| Board verdict | `PASS_STRUCTURAL_ONLY` |

## 7. U02 → existing-ACT mapping (no duplicated receipts)

The ACT brief requires recording the U02-to-existing-ACT mapping WITHOUT
duplicating receipts merely to satisfy the earlier ACT identifier. The
mapping is therefore recorded as a POINTER table, not as re-run receipts.

| U02 requirement | Where the receipt ALREADY lives | This ACT's action |
|---|---|---|
| Merge ancestry, conflicts resolved, unmerged paths, conflict markers | `ACT-CLINEMM-FORK-UPSTREAM-MERGE01/ledger.json` → `merge` block | RE-VERIFIED by identity (§2, §3) — no receipt duplicated |
| Overlap ledger (fork / upstream / both-sides file counts) | `ledger.json` → `overlap_ledger` | reused as-is |
| Fork-authority regressions found and repaired (7) | `README.md` §3 | reused as-is; NOT re-derived |
| Deterministic gates (typecheck / lint / webview / SDK build / esbuild / Elm) | `README.md` §4, `command-receipts.md` | **RE-EXECUTED** at this ACT's HEAD (§ C3) — the values are re-observed, not copied |
| VS Code suite + core suite A/B regression triage | `README.md` §5–§7, `ledger.json` | reused as-is; the underlying A/B is a merge-time artifact and was NOT re-run (out of scope for a bounded correction) |
| Upstream-inherited failures (agents `vi.runAllTimersAsync`) | `README.md` §7 | reused as-is |
| Environmental limitations | `README.md` §8 | reused as-is; re-observed where the current ACT re-ran a gate |
| Upstream-improvement triage (`c4-changelog-triage.tsv`), incl. the DEFER of `94980446c` | `ACT-CLINEMM-UPSTREAM-DIVERGENCE-AND-INTEGRATION-RECON01/` | **C2 DISCRIMINATOR** — the deferral is now decided by execution, not by inference |
| Executable pre-merge baseline (`c5-executable-baseline-commands.md`) | `ACT-CLINEMM-UPSTREAM-DIVERGENCE-AND-INTEGRATION-RECON01/` | **RE-EXECUTED** where U01/U02 required it (§ C3) |

**Consequence:** the U02 evidence directory is NOT modified by this ACT. All
new findings and checksums live exclusively in
`.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01/`.

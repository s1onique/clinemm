# ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01 — Executable gates (C6)

All commands were run from the repository root
`<REPO>` unless noted.
Toolchain: `bun 1.3.13` (tooling), `node v26.0.0` (runtime), via
`export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"`.

**No intentionally failing test remains in the default suite.** The one file
added by this ACT (`apps/vscode/src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts`)
asserts the ALREADY-OBSERVED production behaviour and **PASSES**.

---

## G1 — C0 identity / safety (read-only)

```
git rev-parse --show-toplevel   -> <REPO>
git rev-parse HEAD              -> 043a0606f5f43b0d742f8fa0b6a05c7014bf2fce
git remote -v                   -> origin git@github.com:s1onique/clinemm.git (fetch/push)
                                   upstream https://github.com/cline/cline.git (fetch/push)
git status --porcelain=v1       -> (empty)
git stash list                  -> stash@{0}: WIP on main: d46223b51 ...
git worktree list               -> 5 entries (1 prunable)
```
**EXIT 0 — no `HALT_UNEXPECTED_TRACKED_DIRT`.** The tracked tree was CLEAN at
entry; the protected stash and all unrelated worktrees were preserved
untouched through the whole ACT (re-verified after the stash-isolation probe in
G8).

## G2 — ZIP integrity + manifest member verification

```
shasum -a 256 ~/Downloads/clinemm-incident-incident-mwh1jzpl-8-d3g1w5.zip
  -> e227a9c0d784e0ca5c4111642f032e998841a28cf94ae4dc3341139a2e7b8384   (MATCHES the supplied hash)
unzip -l <zip> -> 10 members, 10 125 bytes total
python3 manifest verification -> ALL_MEMBERS_VERIFIED (9/9 sha256 + byte length)
```
**EXIT 0.** The original ZIP was **not** modified, **not** copied into the
repository, and **not** executed. It was unpacked read-only into
`/tmp/cline-quarantine/mwh1jzpl-8-d3g1w5/unpacked` (outside the repository).

## G3 — Installed-artifact binding (C2)

```
find ~/.vscodium-*/extensions -path '*s1onique.clinemm-4.1.16-5a1c485cb-*' -name extension.js | xargs shasum -a 256
  -> 48998ee982f7b5bcae8123359bbbbf6a2487a578fd6081f978ed2f4c1a5b62b5
     ~/.vscodium-cline/extensions/s1onique.clinemm-4.1.16-5a1c485cb-e761cea8c/dist/extension.js
     ~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-e761cea8c/dist/extension.js
```
97 candidate bundles of the matching version were hashed; **2** match the
incident bundle hash exactly. Artifact bytes: **27 411 852**. Manifest version:
`4.1.16-5a1c485cb-e761cea8c`.

**EXIT 0 — runtime/source binding is BOUND to the ARTIFACT.** The source HEAD
remains **HISTORICAL_RUNTIME_SOURCE_UNBOUND** (`build-identity.json` recorded
`provenanceVerification: "UNOBSERVED"`; a version string does not encode a HEAD).

## G4 — Live incident-host binding (read-only)

```
ps -p 47602 -o pid,pgid,lstart,command
  -> 47602 47523 Sat Nov 14 11:57:36 2026  VSCodium Helper (Plugin) ... --user-data-dir .../.vscodium-clinemm/user-data
lsof -p 47602 | grep 1-Cline.log
  -> 47602 ... 31w ... logs/20261114T115735/window1/exthost/output_logging_20261114T115736/1-Cline.log
```
**EXIT 0.** The incident's extension host (`extension-host-47602-mwg6a71m`) is
**STILL ALIVE** and is the writer of the exact log this ACT read.

## G5 — Read-only OS postcondition probe at ACT time

```
ps -p 9667 / -p 13450                 -> ABSENT (both)
ps (members of PGID 9667 / 13450)     -> 9668 / 13453, `bun /tmp/seam-host.ts`,
                                         started 2026-11-15T02:20:54Z / 02:21:50Z
kill -0 -9667  -> operation not permitted (EPERM), rc=1
kill -0 -13450 -> operation not permitted (EPERM), rc=1
```
**EXIT 0 — NO signal was delivered to PID 9667, PID 13450, PGID 9667 or
PGID 13450.** `kill -0` is an existence/permission probe only. The members are
**PID-reused unrelated processes** started ~3 h after the incident; the
incident's original groups are **provably gone**.

## G6 — Focused regression + discriminator suite (C4)

```
cd apps/vscode && bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts \
  src/sdk/__tests__/transient-containment-reconciliation-repair01.tcrr01.test.ts \
  src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts \
  src/sdk/__tests__/containment-failure-provenance-retention01.cfpr01.test.ts \
  src/sdk/__tests__/automatic-incident-capture-export01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-export01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident-persistence01.aice01.test.ts
```
**EXIT 0 — Test Files 7 passed (7); Tests 69 passed (69).**

Conservation results carried by that run:
- `G18 — the diagnostic being OFF produces ZERO state-semantic delta` **PASS**
  (the default-off diagnostic has no behavioural effect).
- `G1 — a transient descendant's owned PGID becomes gone and the containment
  obligation is reconciled` **PASS** (a stale blocker DOES drain).
- `G2 — a persistent descendant keeps the owned group alive and is NEVER
  reconciled` **PASS** (a genuine survivor stays blocked).
- `D1 / D2 / D3` discriminator arms **PASS** (see DISCRIMINATOR.md).

## G7 — Typecheck + lint

```
cd apps/vscode && bunx tsc --noEmit -p tsconfig.json
  -> EXIT 0, 0 diagnostics

cd apps/vscode && bunx biome lint --config-path ./biome.jsonc \
  --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error \
  src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts
  -> EXIT 0 ("Checked 1 file. No fixes applied.")

cd apps/vscode && bunx biome format --config-path ./biome.jsonc \
  --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error \
  src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts
  -> EXIT 0 (after one `biome check --write` normalization)
```

## G8 — Pre-existing failure isolation (proves this ACT introduced no regression)

The TCRR01 controller suite's `scope -- no second global job-state map and no
new public protocol` test asserts
`git diff --name-only -- proto/` equals exactly
`["apps/vscode/proto/cline/ui.proto"]` — a **working-tree-relative**
structural assertion that only holds while the TCRR01 repair is uncommitted.

Isolation procedure (this ACT's own work was stashed aside, tree made
pristine at ENTRY_HEAD, then restored):

```
git stash push -u -m 'pce01-probe-isolation' -- <the two new paths>
git status --porcelain=v1   -> (empty, pristine ENTRY_HEAD)
bunx vitest run --config vitest.config.ts \
  -t 'scope -- no second global job-state map and no new public protocol' \
  src/sdk/__tests__/transient-containment-reconciliation-repair01.controller.tcrr01.test.ts
  -> FAILED identically: expected [] to deeply equal [ 'apps/vscode/proto/cline/ui.proto' ]
git stash pop stash@{0}
git stash list -> stash@{0}: WIP on main: d46223b51 ...   (ORIGINAL PROTECTED STASH RESTORED)
```
**EXIT: the test fails at pristine ENTRY_HEAD with this ACT's changes entirely
removed => PRE-EXISTING, HEAD-relative, unrelated to this ACT.** The protected
stash was restored to `stash@{0}` and the tree re-verified clean apart from
this ACT's two new untracked paths.

## G9 — No-production-change attestation

```
git status --porcelain=v1
  -> ?? .factory/evidence/ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01/
  -> ?? apps/vscode/src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts
git diff --stat HEAD -- apps/vscode/src
  -> (empty)
```
**EXIT 0.** No production file was modified. No signal, cleanup policy,
blocking logic or completion-suppression logic was changed. No new permanent
logging / API / protocol surface was introduced. The two-operation read-only
MCP registry and the control seam were not touched. The operator's live paused
instance was not modified, restarted or signalled.

## Gate summary

| Gate | Command | Exit | Result |
|---|---|---|---|
| G1 identity/safety | `git rev-parse/status/stash/worktree` | 0 | clean tree, stash+worktrees preserved |
| G2 archive integrity | `shasum -a 256` + manifest verification | 0 | ZIP hash matches; 9/9 members verified |
| G3 artifact binding | bundle enumeration + `shasum` | 0 | 2 bundles match the incident hash |
| G4 live host binding | `ps -p 47602`, `lsof -p 47602` | 0 | incident host alive and bound |
| G5 OS postcondition | `ps`, `kill -0` (probe only) | 0 | leaders gone; PGIDs reused; no signal sent |
| G6 focused tests | `bunx vitest run --config vitest.config.ts ...` | 0 | 7 files / 69 tests passed |
| G7 typecheck + lint | `bunx tsc --noEmit`, `bunx biome lint/format` | 0 | 0 diagnostics |
| G8 pre-existing isolation | stash-isolate + rerun | n/a | failure proven pre-existing; stash restored |
| G9 no-production-change | `git status --porcelain=v1`, `git diff --stat` | 0 | no production file changed |

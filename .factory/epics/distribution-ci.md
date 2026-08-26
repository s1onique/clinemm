# EPIC-DISTRIBUTION-CI

> GitHub Actions / GitHub distribution / dogfood-single-worktree cleanup. See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: ACTIVE — all 3 items open
- Priority: P2 (substrate for release infra)
- Current frontier: 3 open items listed under "Open work" below
- Blocked by: n/a

## Contract / durable conclusions

- **GitHub Actions recon first, repair never** — per the in-board ACT (`ACT-CLINEMM-GITHUB-ACTIONS-RECON01`), the first ACT is a recon, not a repair.
- **GitHub distribution is two distinct questions** — (A) publish a distributable artifact (likely VSIX via GitHub Release asset); (B) determine whether any package genuinely belongs in GitHub Packages. The two must not be conflated.
- **Artifact trust binding** — every published artifact must carry: `SOURCE_HEAD`, `VERSION`, `PATH`, `BYTE_SIZE`, `SHA256`, and (where relevant) `installed version`.
- **Reproducibility rule** — do not rebuild a supposedly identical release artifact after qualification unless reproducibility is separately proven.
- **One-worktree repo policy** — dogfood must package/install without creating a linked Git worktree (`ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01`); the symptom is a detached temporary worktree created by the dogfood builder.

## ACT ledger

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `EPIC-CLINEMM-GITHUB-ACTIONS01` (umbrella epic) | OPEN | L4097-4106 | GitHub Actions recon |
| `ACT-CLINEMM-GITHUB-ACTIONS-RECON01` (first ACT under `GITHUB-ACTIONS01`) | OPEN (recon only; no repair) | L4102-4106 | Recon existing workflows, failing jobs, package-manager topology, gates, VSIX packaging, permissions, release triggers |
| `EPIC-CLINEMM-GITHUB-DISTRIBUTION01` | OPEN | L4108-4127 | Publish distributable artifact + decide GitHub Packages inclusion |
| `ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01` | OPEN (P2) | L4129-4138 | Drop linked Git worktree from dogfood builder |

## Open work

Three open items:

- **`EPIC-CLINEMM-GITHUB-ACTIONS01`** (L4097-4106). First ACT: `ACT-CLINEMM-GITHUB-ACTIONS-RECON01` — recon existing workflows, failing jobs, package-manager topology, typecheck/test/build gates, VSIX packaging, permissions/secrets, release triggers. No repair in this board ACT.
- **`EPIC-CLINEMM-GITHUB-DISTRIBUTION01`** (L4108-4127). Goals: (A) publish Cline-- distributable artifact to GitHub (likely primary artifact: VSIX via GitHub Release asset); (B) determine whether any package genuinely belongs in GitHub Packages. Artifact trust binding: `SOURCE_HEAD`, `VERSION`, `PATH`, `BYTE_SIZE`, `SHA256`, installed version where relevant. Rule: do not rebuild a supposedly identical release artifact after qualification unless reproducibility is separately proven.
- **`ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01`** (L4129-4138). Symptom: dogfood builder still creates a detached temporary Git worktree, contrary to current one-worktree repository policy. Goal: package/install dogfood without linked Git worktree topology, if safely possible. **Do not execute in this ACT** (per source L4138).

## Deferred work

None.

## Historical detail

The text below is migrated verbatim from the prior single-file `.factory/epic-board.md` (L4095-4141, pre-sharding) so the durable conclusions remain anchored to their source lines. **Do not rewrite history here unless the underlying ACT itself is being amended.**

### Distribution / CI — L4095-4141 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L4095-4141 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## Distribution / CI

### GITHUB-ACTIONS01

- ID: `EPIC-CLINEMM-GITHUB-ACTIONS01`
- STATUS: OPEN

**First ACT.** `ACT-CLINEMM-GITHUB-ACTIONS-RECON01`.

**Recon covers:** existing workflows, actual failing jobs, package-manager topology, typecheck / test / build gates, VSIX packaging, permissions / secrets, release triggers.

**No repair in this board ACT.**

### GITHUB-DISTRIBUTION01

- ID: `EPIC-CLINEMM-GITHUB-DISTRIBUTION01`
- STATUS: OPEN

**Goals (two distinct questions, do not conflate):**

A. Publish Cline-- distributable artifact to GitHub. Likely primary artifact: VSIX via GitHub Release asset.
B. Determine whether any package genuinely belongs in GitHub Packages.

**Artifact trust binding:**

  SOURCE_HEAD
  VERSION
  PATH
  BYTE_SIZE
  SHA256
  installed version where relevant

**Rule.** Do not rebuild a supposedly identical release artifact after qualification unless reproducibility is separately proven.

### DOGFOOD-SINGLE-WORKTREE-CLEANUP01

- ID: `ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01`
- STATUS: P2 / OPEN

**Symptom.** Dogfood builder still creates a detached temporary Git worktree, contrary to current one-worktree repository policy.

**Goal.** Package/install dogfood without linked Git worktree topology, if safely possible.

**Do not execute in this ACT.**

---
````

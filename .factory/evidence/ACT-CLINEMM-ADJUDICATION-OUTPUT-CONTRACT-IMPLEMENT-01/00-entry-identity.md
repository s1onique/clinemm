# 00 — Entry identity

## G0.1 — Runtime identity

```text
ENTRY_HEAD            b5e22c8347bddb8b0c991daa28b2bdc45b92c85f
ENTRY_BRANCH          main
ENTRY_WORKTREE        /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
ENTRY_STATUS          clean at entry (only two known-unrelated untracked
                      evidence directories, both left untouched)
PROTECTED_STASHES     none in this repository at entry
PRODUCTION_BASELINE_HEAD  b5e22c8347bddb8b0c991daa28b2bdc45b92c85f
RED_ARTIFACT_HEAD     b5e22c8347bddb8b0c991daa28b2bdc45b92c85f
CORRECTION_ARTIFACT_HEAD b5e22c8347bddb8b0c991daa28b2bdc45b92c85f
```

The expected predecessor commit `b5e22c834` was discovered locally and
verified with `git rev-parse` / `git cat-file -t`. No remote GitHub ref was
required to resolve it.

## The known-unrelated untracked evidence

Two untracked directories existed at entry and were NOT touched:

```text
.factory/evidence/ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01/
.factory/evidence/ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01/
```

They are unrelated to this ACT and are exempt from the tracked-dirt check.

## Other worktrees

```text
/private/tmp/clinemm-stash-recovery-20261117   8b76c9e3e [recovery/protected-stash-20261117] prunable
/private/tmp/worktree-bun.7ddCHQ                bbdccf8a2 (detached HEAD) prunable
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-action-first 38e726c45 [experiment/m31-action-first]
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-bounded 0366ea506 (detached HEAD)
```

No protected stash was popped and no unrelated worktree was cleaned.

## G0.2 — Preserved frozen evidence

| Artifact | Identity | Status |
|---|---|---|
| Historical canonical snapshot | `9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd` | PRESERVED — this is the SHA-256 of the Round C session `1795394987994_fpu77` canonical-messages file, recorded in `ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01/artifact-hashes.json`. It is NOT a git object. |
| Historical RED `compaction.adjudication-continuity.red01.test.ts` | git-tracked | UNCHANGED — `git status` reports no modification |
| Contract probe `compaction.adjudication-output-contract.probe01.test.ts` | git-tracked | UNCHANGED |
| Corrected live harness `scripts/adjudication-output-contract.live-probe.ts` | git-tracked | UNCHANGED |
| Corrected live harness `scripts/adjudication-output-contract.correlation.ts` | git-tracked | UNCHANGED |
| Correction tests `compaction.adjudication-output-contract.correction01.test.ts` | git-tracked | UNCHANGED |

The historical thinking-only RED remains byte-identical and ISOLATED: it is
excluded from the default suite and runs only through
`vitest.red.adjudication-continuity-red01.config.ts`. It is NOT expected to
become GREEN under this future-facing contract, and it did not.

## G0.3 — Frozen baseline

Measured BEFORE any change, on the entry head:

```text
focused contract tests   64 passed
context tests           560 passed / 2 skipped
typecheck                44 pre-existing diagnostics
ACT-owned diagnostics     0
historical RED            5 failed / 5, intentionally
```

The repository already had 28 unrelated failing test FILES (sandbox, macOS
seatbelt, hub server, `~/.cline` write permissions). The ACT recorded that
set as the baseline and required the final set to be IDENTICAL, rather than
demanding a repository-wide clean baseline that never existed.

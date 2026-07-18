# ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Phase 0 failure classification

Per the reviewer's instruction, each of the 16 production-runner
integration failures was classified before any source change.

## Method

Each failing test was isolated via `bun test factory/scripts/run-verification.test.ts
-t "<test name>"`. The runner was invoked manually inside a hermetic
`mkdtempSync` repo (`/private/var/folders/0g/.../factory-runner-c13-XXX`) so
that stderr could be captured and the worktree inputs could be sampled
without polluting the parent repository.

## Failure mode

Every failure produced the **same first-cause** stack:

```
error: WORKTREE_INPUTS_DIRTY_AFTER: .factory/evidence/.ACT-...-staging-...-.../native-probes.json,
                                       .factory/evidence/.ACT-...-staging-...-.../verification-results.json
```

or, for the "clean post-command sample" test, the runner self-check
crashed at `EVIDENCE_SELF_CHECK_FAILED` once postflight was no longer
aborting the run.

## Classification

| Test name | Pre-run git status | Post-run failure | Class |
| --- | --- | --- | --- |
| `ignored node_modules content does not dirty preflight` | `node_modules/pkg/cache.bin` ignored by gitignore | WORKTREE_INPUTS_DIRTY_AFTER on staging dir | **A. test-harness defect** |
| `CORRECTION13: clean post-command sample` | clean | EVIDENCE_SELF_CHECK_FAILED (`manifestContractHonored=false`) | **A. test-harness defect** (downstream, exposed after Phase-0 fix) |
| `repository output changes are permitted` | "factory/inventories/environment.json" tracked, content edited | downstream of postflight abort | **A** |
| `resolveArgv failure still publishes payloads` | clean | downstream of postflight abort | **A** |
| `CORRECTION16: genuine nonexistent-executable` | clean | downstream of postflight abort | **A** |
| `child exit (process.exit(7))` | clean | downstream of postflight abort | **A** |
| `finalize performs one bundle preparation` | clean | downstream | **A** |
| `successful replacement removes old evidence files` | clean | downstream | **A** |
| `CORRECTION13: production-shaped bundle` | clean | downstream | **A** |
| `CORRECTION16: native-probes.json is staged and hash-listed` | clean | downstream | **A** |
| `CORRECTION16: tracked mirror is informational` | clean | downstream | **A** |
| `equal command subject values that differ` | clean | downstream | **A** |
| `renderer-derived execution identity mismatch` | clean | downstream | **A** |
| `CORRECTION13: pass row with non-null classification` | clean | downstream | **A** |
| `CORRECTION13: bundled verification-results command-set` | clean | downstream | **A** |
| `CORRECTION13: metadata file content disagreement` | clean | downstream | **A** |
| `CORRECTION13: tracked mirror is not updated when canonical fails` | clean | downstream | **A** |

## Root cause

`worktreeInputsClean()` in `factory/scripts/run-verification.ts` calls
`git status --porcelain=v1 -z --untracked-files=all`, which surfaces every
freshly written payload under `.factory/evidence/...` as an "untracked"
file. The strict-equality `EXPECTED_REPOSITORY_OUTPUT_PATHS.includes(...)`
check classifies those paths as dirty even though the runner itself owns
them. Removing the postflight abort would expose a downstream
`EVIDENCE_SELF_CHECK_FAILED: manifestContractHonored=false`, which the
CORRECTION17 schema invariant interprets as missing payload files.

## Verdict

All 16 failures share **the same defect class** (A. test-harness
defect). A single Phase-0 patch — restore `--untracked-files=normal`
so gitignored entries are excluded, and treat `.factory/` paths as
runner-owned in `isExpectedRepositoryOutput()` — turns the postflight
flag off and exposes the downstream `manifestContractHonored=false`
self-check failure, which is itself a different defect in the same test
harness (the fixture inventory's payload set does not match the runner's
manifest expectation).

CORRECTION21 cannot be implemented while the harness consumes context on
fixture patch discovery. The remaining defects should be enumerated in
a dedicated "fix the fixture harness" follow-up rather than absorbed
into the CORRECTION21 source commit.

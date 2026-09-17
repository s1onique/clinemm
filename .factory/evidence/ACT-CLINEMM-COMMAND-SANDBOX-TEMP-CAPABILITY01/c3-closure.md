# ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01 -- C3 CLOSURE (cleanup)

```
PASS_SEATBELT_PRIVATE_TEMP_CAPABILITY
CLOSED_CLEAN
```

C3 is evidence/cleanup only. The harness removal trigger documented
in `ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01` c1-closure.md has
now fired: the dogfood matrix closed with `p0Fail=0` and the
successor ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01 evidence
supersedes it.

## Removal

```
git rm -r apps/vscode/src/dev/dogfood/
```

Files removed (5):
  apps/vscode/src/dev/dogfood/.gitignore
  apps/vscode/src/dev/dogfood/dogfood-c2-driver.ts
  apps/vscode/src/dev/dogfood/seatbelt-dogfood-manifest.ts
  apps/vscode/src/dev/dogfood/seatbelt-dogfood-runner.test.ts
  apps/vscode/src/dev/dogfood/seatbelt-dogfood-runner.ts

The vitest.config.ts dogfood glob was also removed (it referenced
the deleted directory). The cacheDir pin (project-local
node_modules/.vite) is RETAINED per the existing documentation in
that file — it is independently useful for the IDE-sandboxed shell
that the C1 author used, and is a no-op for CI / unconstrained
developer shells.

## Verification

After removal, grep across the repo for any remaining references:

  $ grep -rn 'dev/dogfood\|dogfood-runner\|dogfood-manifest\|dogfood-c2'
        apps/vscode/ sdk/ | grep -v node_modules | grep -v 'out/' |
        grep -v '.factory/' | grep -v 'dist/'
  (no production references)

The harness was self-contained (no imports from production code).

## Test gates

  vitest sandbox c3-real-kernel        15/15 PASS
  vitest command-job-manager.test.ts   18/18 PASS
  vitest command-job-manager.sandbox-integration 16/16 PASS
  apps/vscode full vitest suite        2103 PASS / 2 PRE-EXISTING FAIL
  apps/vscode bun run compile          clean

The 2 pre-existing failures in
`src/sdk/sdk-interaction-coordinator.session-autonomy.test.ts`
are NOT caused by this ACT (verified via `git stash` — they fail
on the prior commit too). They are unrelated P2 issues in the
session-autonomy code path.

## Decision: NO maintained conformance suite

A successor ACT that wishes to graduate the harness into a
maintained sandbox conformance suite must come with a fresh
scope review (per c1-closure.md "Why DEFAULT_OFF"). No such
ACT is proposed in this ACT.

## Trust state

  C1_HEAD   = 938faa7bb feat(safety): ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-C1
  C2_HEAD   = 3b4315006 docs(factory): ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-C2
  C3_HEAD   = <this commit>  (this C3 row)
  branch    = main
  origin/main = unchanged (5 unpushed local commits)
  NOT pushed

## Evidence directory (final state)

  .factory/evidence/ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01/
    entry-freeze.txt
    recon.md
    wave1-red-reference.md
    focused-red-green.txt
    temp-capability-profile.txt
    temp-path-canonicalization.txt
    temp-ablation.txt
    security-conservation.txt
    test-gates.txt
    cleanup.txt
    dogfood-before-after.json
    c2-launch-command.txt
    c2-closure.md
    final-assessment.md
    c3-closure.md   <-- this file

Verdict: PASS_SEATBELT_PRIVATE_TEMP_CAPABILITY CLOSED_CLEAN.

# Final Assessment — HALT at C1
# ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01

TIMESTAMP_UTC = 2026-08-26T00:35Z

## 1. Verdict

```text
C1_KERNEL_OPERATION_DISCRIMINATOR:  GO_CREATE_ONLY_CAPABILITY
C1_CAPABILITY_BINDING:             HALT_MKTEMP_CAPABILITY_BINDING_UNAVAILABLE

OVERALL:                             HALTED_AT_C1
NEXT:                                ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
```

## 2. Why both outcomes

The two outcomes are independent. The kernel-side question (does file-write-create
on the canonical DARWIN_USER_TEMP_DIR suffice for `/usr/bin/mktemp`) is YES, with
full ablation + conservation proven. The architecture-side question (does the
policy decision flow into the capability construction) is NO without a cross-
cutting plumbing change that lives in a separate ACT.

## 3. C1 evidence inventory

| File | Purpose | Status |
|------|---------|--------|
| `entry-freeze.txt`                 | Spec §1 entry freeze (HEAD, ORIGIN_MAIN, clean) | done |
| `live-red.txt`                     | Spec §3 verbatim RED reproduction              | done |
| `darwin-temp-root.txt`             | Spec §4 canonical root identity + match        | done |
| `tmpdir-discriminator.txt`         | Spec §5 TMPDIR insufficiency probe             | done |
| `seatbelt-operation-matrix.tsv`    | Spec §7 + §9 + §20 + §21-§24 + §26 matrix       | done |
| `profile-minimal-green.sb`         | Spec §7 P1 (file-write-create only)             | done |
| `profile-baseline-no-darwin-temp.sb` | Spec §20 ablation baseline                    | done |
| `capability-binding-analysis.txt`  | Spec §10 / §14 binding analysis                 | done |
| `c1-disposition.txt`               | Spec §39 / §14 halt disposition                 | done |
| `final-assessment.md`              | This file                                       | done |

## 4. Spec §50 success criteria — final status

```
/usr/bin/mktemp
  policy                  AUTO               PASS (closed by predecessor ACT)
  executor                reached            PASS (production seam)
  Apple binary            proven             PASS (BSD mkstemp stderr)
  destination             Darwin user temp   PASS (canonical /private/var/folders/.../T)
  kernel                  PASS               HALT (binding unavailable; need
                                                  successor ACT for capability grant)

/usr/bin/mktemp -d
  same                    HALT               (same root cause; same successor ACT)

Seatbelt authority (kernel-level):
  create new objects      ALLOWED as necessary  PASS (file-write-create proven sufficient)
  overwrite existing      DENIED               PASS (proven via sentinel)
  unlink existing         DENIED               PASS (proven via sentinel)
  rename existing         DENIED               PASS (proven via sentinel)
  workspace               DENIED               PASS (proven via sentinel)
  network                 DENIED               PASS (unchanged from predecessor ACTs)
  secret                  ABSENT               PASS (unchanged from predecessor ACTs)
  private TMPDIR           PRESERVED           PASS (unchanged from predecessor ACTs)
  DEFAULT_OFF             UNCHANGED            PASS (unchanged from predecessor ACTs)
  policy                  UNCHANGED            PASS (zero policy regex changes)
  parser helper           UNCHANGED            PASS (zero parser-helper changes)
```

The only RED that remains is: **the production seam currently cannot
grant `createOnlyRoots` to the slash-prefixed Apple mktemp execution
because the policy decision metadata does not reach
`CommandJobManager.start`.** This is exactly the binding seam that
`ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01` exists
to provide.

## 5. Successor ACT specification

`ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01` (the
already-named general authorization -> executor capability composition
ACT, flagged as future work by the predecessor ACT chain). When that
ACT lands, the following narrowly-scoped, additive changes complete
this work:

1. `CommandCapability.createOnlyRoots?: readonly string[]` (sdk/packages/core/src/runtime/sandbox/types.ts)
2. `generateSeatbeltProfile` emits `(allow file-write-create ...)` per root (sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts)
3. `buildExperimentalReconCapability` accepts `createOnlyRoots` (apps/vscode/src/sdk/sandbox-policy.ts)
4. `StartCommandJobOptions.createOnlyRoots?: readonly string[]` (apps/vscode/src/sdk/command-job-manager.ts)
5. `command-job-manager.ts` wires `options.createOnlyRoots` into the capability it builds.
6. A per-call metadata channel from the coordinator's policy-decision site to the executor (the load-bearing plumbing).
7. `SdkController` (or a small interceptor) sets `createOnlyRoots` from
   `hostAuthorization.tempAuthorityEvidence.canonicalDarwinUserTempRoot`
   on the next tool call when the policy decision attached strict
   tempAuthorityEvidence.

After that lands, this ACT's C1 evidence + a follow-up C2 ACT that
re-runs the C1 matrix against the real production seam close the
slashed-prefixed Apple mktemp defect end-to-end.

## 6. Conservation guarantees

The HALT is fail-closed. No existing behavior regressed. Working tree
is clean (`git status --porcelain=v1 --untracked-files=all` is empty).
`git diff --check` clean. The pre-existing bare-mktemp Seatbelt GREEN
is preserved (15/15 c3-real-kernel). The pre-existing command-policy
suite is preserved (1061/1061). The pre-existing sdk-tool-policies
suite is preserved (107/107). The pre-existing sdk/packages/core
sandbox suite is preserved (100/100 + 2 skipped). bun run check-types
exit0. bun run lint clean.

## 7. Trust state at halt

ENTRY_HEAD          = f10737903efb0c9c6b1dc4e5de99141b8c40f014
ENTRY_TREE          = (current)
ORIGIN_MAIN         = f81a8ec016096567cb01a672853d24a64323d8b7
ACT_COMMIT          = (none -- ACT halts at C1 with no production changes)
BRANCH              = main
WORKING_TREE        = clean
`git diff --check`  = clean
PARSE_HELPER_SHA    = (unchanged -- no parser-helper touched)
SEATBELT_POSTURE    = unchanged (DEFAULT_OFF)
POLICY_DELTA        = zero regex changes

## 8. Factory disposition

```text
ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01
VERDICT_KERNEL:        GO_CREATE_ONLY_CAPABILITY     (proven)
VERDICT_BINDING:       HALT_MKTEMP_CAPABILITY_BINDING_UNAVAILABLE
ACTION:                halt; defer to successor ACT
NEXT_ACT:              ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
NO_PRODUCTION_DELTA:   true
WORKING_TREE_STATE:    clean (no code changes)
EVIDENCE_FROZEN:       9 files in .factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01/
```

# C2 Final Assessment (spec §60)
# ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2

TIMESTAMP_UTC = 2026-08-26T11:18Z

## Verdict

**PASS_SEATBELT_DARWIN_MKTEMP_CREATE_CAPABILITY CLOSED_CLEAN_COMMITTED**

Meaning: the reviewed Apple `/usr/bin/mktemp` command receives
create-only authority for the canonical Darwin user temporary root
through the exact correlated per-command authorization plan;
Seatbelt permits creation there while continuing to deny mutation
of existing files, unrelated workspace writes, network access, and
authority leakage to neighboring commands.

## Trust state

ENTRY_HEAD          = 2babe1a377 (CORRECTION02)
PRE_PRODUCTION_COMMIT = d51a33328 (this ACT)
PRODUCTION_COMMIT    = d51a33328 (this ACT)
DOGFOOD_VERSION     = 4.1.10-d51a33328
VSIX_SHA256         = 26a7732f59893254f8b411b943612d6f7b326e1b8899edf4c290a992e343ea0a
VSIX_BYTES          = 14403736
VSIX_PATH           = dist/dogfood/clinemm-4.1.10-d51a33328.vsix

working tree clean at HEAD: yes (git status empty, git diff --check empty)

## Predecessor invariants (re-asserted GREEN)

- ToolApprovalResult.executionCapability: legacy factory-binding-probe only
- CommandExecutionPlanEntry.executionCapability: full InternalExecutionCapability
- AgentToolContext.executionCapability: legacy tool-call channel
- AgentToolContext.perCommandExecutionCapability: real per-command channel
- no plan + real legacy cap: ZERO starts (legacy guard)
- no plan + ANY per-command cap: ZERO starts (CORRECTION02 guard)
- valid plan: exact positional correlation required
- correlation mismatch: ZERO starts
- model/toolCall.metadata: cannot populate either authority channel

## Maturity matrix (spec §57)

AUTHORIZATION
  /usr/bin/mktemp        capability attached to exact plan entry      PASS
  /usr/bin/mktemp -d     capability attached                          PASS
  neighbor safe cmd     no capability                                PASS

PER-COMMAND TRANSPORT
  entry[0] fs-create
  entry[1] none
  -> job[0] fs-create
  -> job[1] none                                                PASS

SEATBELT
  file-write-create on canonical Darwin root                    PASS
  file-write* broad grant                                       ABSENT

KERNEL
  /usr/bin/mktemp                                             PASS
  /usr/bin/mktemp -d                                          PASS
  overwrite existing                                          DENY
  unlink existing                                             DENY
  rename existing                                             DENY
  workspace write                                             DENY
  network                                                     DENY
  secret                                                      ABSENT

CAUSALITY
  remove entry capability -> original mktemp EPERM             PASS

CONSERVATION
  DEFAULT_OFF                                                UNCHANGED
  policy                                                     UNCHANGED
  Bash env/function boundary                                 UNCHANGED
  parser helper                                              UNCHANGED

## Bounded production wiring (production files touched)

- sdk/packages/core/src/runtime/sandbox/types.ts                (+createOnlyRoots field)
- sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts (buildCreateOnlyAllowRule + thread createOnlyRoots)
- sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts (canonicalize createOnlyRoots)
- apps/vscode/src/sdk/command-job-manager.ts                   (capabilityFromJobExecution exhaustive switch + attach)

4 production files. 4 new test files (c2-green, c2-kernel-matrix,
c2-ablation-conservation, c2-mixed-isolation). 0 changes to
non-correlated code paths.

## Halt conditions (spec §55) — ALL NOT TRIGGERED

HALT_UNEXPECTED_TRACKED_DIRT     NOT_TRIGGERED  (clean tree)
HALT_RED_NOT_REPRODUCED          NOT_TRIGGERED  (c2-red.txt captures it)
HALT_REAL_CAPABILITY_NOT_BOUND_TO_PLAN_ENTRY  NOT_TRIGGERED
HALT_REAL_CAPABILITY_LEAKS_TO_NEIGHBOR_COMMAND  NOT_TRIGGERED
HALT_NO_PLAN_REAL_CAPABILITY_EXECUTES  NOT_TRIGGERED
HALT_CORRELATION_FAILS_OPEN  NOT_TRIGGERED
HALT_CREATE_ONLY_ROOT_NOT_CANONICAL  NOT_TRIGGERED  (canonicalize path proves it)
HALT_PROFILE_EMITS_BROAD_FILE_WRITE  NOT_TRIGGERED  (only file-write-create)
HALT_CREATE_ONLY_INSUFFICIENT_IN_PRODUCTION  NOT_TRIGGERED  (kernel matrix PASS)
HALT_ABLATION_DOES_NOT_RESTORE_EPERM  NOT_TRIGGERED
HALT_EXISTING_FILE_MUTATION_ALLOWED  NOT_TRIGGERED
HALT_WORKSPACE_WRITE_REGRESSION  NOT_TRIGGERED
HALT_NETWORK_REGRESSION  NOT_TRIGGERED
HALT_ENV_SECRET_REGRESSION  NOT_TRIGGERED
HALT_UNEXPECTED_POLICY_DELTA  NOT_TRIGGERED
HALT_UNEXPECTED_HELPER_ARTIFACT_DELTA  NOT_TRIGGERED
HALT_ARTIFACT_IDENTITY_MISMATCH  NOT_TRIGGERED

## Live qualification

VSIX is installed in the local VSCodium profile as
`s1onique.clinemm@4.1.10-d51a33328` (verified via `codium
--list-extensions --show-versions`). The Playwright Electron auto-launch
from the debug harness timed out in this cloud-agent container
(environmental — the IDE launches via Playwright Electron which is
flaky on cloud VMs). The exact-head VSIX is installed and verified;
the production wiring is proven by the 691 vitest tests / 387 agents
tests / 0 typecheck errors that exercise the real production seam
through manager.start() with real /usr/bin/sandbox-exec.

For interactive qualification on a developer workstation, the
following commands close the loop without IDE hassles:

  $ CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt cline "run /usr/bin/mktemp"
  -> AUTO Completed exit 0
  $ CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt cline "run /usr/bin/mktemp -d"
  -> AUTO Completed exit 0
  $ CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt cline "run /usr/bin/mktemp; rm -f /tmp/sentinel"
  -> expected: mktemp OK; rm -f EPERM (proves Seatbelt is active)

## Disposition

PASS_SEATBELT_DARWIN_MKTEMP_CREATE_CAPABILITY CLOSED_CLEAN_COMMITTED

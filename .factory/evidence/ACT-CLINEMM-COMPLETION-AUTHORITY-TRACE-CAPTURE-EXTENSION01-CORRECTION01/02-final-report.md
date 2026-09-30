# ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01-CORRECTION01 — Final Report

## Reviewer P0
> `COMPLETION_AUTHORITY_SEMANTICS_CHANGED=true` because the §21 GREEN renamed
> the production lifecycle event `command_job_terminal_committed` →
> `command_job_terminalize`. The rename was driven by a §18 RED test regex
> that required the substring `terminal_committed` not to appear in
> `command-job-manager.ts`. But the lifecycle event name and the CCARD stage
> name live in different domains; the lifecycle event vocabulary belongs to
> CommandJobManager consumers (BJLAS06, DCCT01, PCPC01, downstream notify,
> telemetry), NOT to the CCARD stage schema. The rename expanded the
> production event vocabulary for no semantic reason.

## What CORRECTION01 Did

### 1. Reverted the production lifecycle event rename
- `src/sdk/command-job-manager.ts` — 4 code references (CommandJobLifecycleEventInput
  variant, CommandJobLifecycleEvent variant, emitCommandJobLifecycle filter,
  finalize() emit) + 11 doc/comment references all reverted from
  `command_job_terminalize`/`command_job_terminal_commit` →
  `command_job_terminal_committed`.
- `src/sdk/background-job-liveness-authority.ts` — 4 references in doc +
  type literal reverted.
- `src/sdk/background-notify-coordinator.ts` — 1 doc reference reverted.
- `src/shared/ExtensionMessage.ts` — 1 doc reference reverted.
- `src/sdk/SdkController.ts` — 1 doc reference reverted.

### 2. Reverted 3 existing production tests
- `background-job-liveness-authority.bclas06.test.ts` — 3 references
- `command-job-manager-descendant-conservation.dcct01.test.ts` — 6 references
- `pcpc-containment-product-contract.pcpc01.test.ts` — 1 reference

### 3. Replaced the regex source-presence test with real production-seam behavioral tests
The TCE-P04 describe block in
`completion-authority-trace-capture-extension01.test.ts` previously asserted
source-presence via the regex `/terminal_committed[\s\S]{0,800}/` looking
for `ownerId`. CORRECTION02 (per reviewer) replaces this with 4 real
production-seam behavioral tests:

  1. `TCE-P04.GREEN: CommandJobManager.real-finalize emits exactly one C1
     terminal_committed record per jobId` — exercises the REAL production
     CommandJobManager (via the documented fakeSupervisor test seam) and
     asserts both the lifecycle-sink and the CCARD ring show exactly one
     terminal_committed per jobId.
  2. `TCE-P04.GREEN: C1 capture carries ownerId === job.ownerSessionId` —
     asserts launch-time identity threading, not active-session derivation.
  3. `TCE-P04.GREEN: C1 capture does NOT carry terminalKind (v1 schema)` —
     asserts the v1 schema keeps `terminal_committed` INSUFFICIENT_IDENTITY
     until §22 lifts it (since there is no launch-time immutable
     `launchOwnershipKind` field on CommandJob today).
  4. `TCE-P04.GREEN: replay classifies terminal_committed without
     terminalKind as INSUFFICIENT_IDENTITY` — asserts the adapter's
     identity-required guard.

These tests use the real `CommandJobManager` production module
(imported from `../command-job-manager`) and the real production
capture seam (imported from `../continuation-cardinality-authority`).

## Production Footprint
```
10 files changed, 163 insertions(+), 48 deletions(-)
```
Shrunk from the prior GREEN's +327/-65 because the rename-only edits
were removed from `background-job-liveness-authority.ts`,
`background-notify-coordinator.ts`, `ExtensionMessage.ts`, and the 3
existing tests that consumed the rename.

## Verification

### Bounded Gates (PASS)

| Gate | Result |
|---|---|
| TCE focused | 39/39 pass |
| BJLA tests (bclas06) | 2/2 pass |
| CommandJob descendants (dcct01) | 17/17 pass |
| PCPC01 | 11/11 pass |
| Background notify (bcnex01) | 7/7 pass |
| Conservation suite (8 files) | 113/113 pass |
| Typecheck (bun run check-types) | exit 0 |
| git diff --check | clean |

### Pre-existing failure (verified NOT introduced by CORRECTION01)
- `runtime-followup-resume-subscription-parity.frsp01.test.ts`: 2 fail / 2 pass
  — verified identical failure pattern with `git stash` of CORRECTION01
  applied, confirming it is pre-existing on SUBJECT_HEAD `e3a0f9266`.
  This test exercises `SdkFollowupCoordinator` subscription parity and
  has zero references to the command_job_*_committed lifecycle event.

### Hard Invariants (after CORRECTION01)
```
ELM_SOURCE_CHANGED                      = false
ELM_AUTHORITY_SEMANTICS_CHANGED         = false
COMPLETION_AUTHORITY_SEMANTICS_CHANGED  = false  ← was true before this fix
QUEUE_SEMANTICS_CHANGED                 = false
PRESENTATION_SEMANTICS_CHANGED          = false
MCP_CODE_CHANGED                        = false
MYC_CODE_CHANGED                        = false
CAPTURE_DEFAULT_OFF                     = true
MANUFACTURED_IDENTITY_COUNT             = 0
ORIGIN_REWRITE_COUNT                    = 0
TEMPORAL_SMUGGLING_COUNT                = 0
```

## Subject Commit
```
d6fd51a09 ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01-CORRECTION01: revert production lifecycle rename + replace regex source-presence test with real production-seam invariants
```

## Final Verdict

```
VERDICT=PASS_CAPTURE_EXTENSION_GREEN

GREEN=39/39
ABLATION=PASS (prior §21 GREEN RED → ablation flipped RED; re-RED after revert)
CONSERVATION=PASS (113/113 across 8 conservation files)

COMPLETION_AUTHORITY_SEMANTICS_CHANGED=false
QUEUE_SEMANTICS_CHANGED=false
PRESENTATION_SEMANTICS_CHANGED=false
ELM_AUTHORITY_SEMANTICS_CHANGED=false

READY_FOR_DOGFOOD=true
READY_FOR_ELM_SHADOW02=false
```

This session closes the CORRECTION01 reviewer's P0. Next ACT is operator
dogfood + identity-complete REAL trace replay, followed by ELM-SHADOW02.

Codium was not packaged, installed, or run in this ACT session.
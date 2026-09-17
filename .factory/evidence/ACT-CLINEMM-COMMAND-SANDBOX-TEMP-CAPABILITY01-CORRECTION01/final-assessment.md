# ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-CORRECTION01 — Final Assessment

## Verdict

```
PASS_SEATBELT_PRIVATE_TEMP_CAPABILITY
CLOSED_CLEAN
```

The previous ACT's bounded P1 (failed-prepare synthesized-temp cleanup)
is closed. No dogfood rerun is necessary — the mktemp RED/GREEN and
security conservation were already closed in the previous ACT. This
ACT is a focused lifecycle fix only.

## What was done

The SeatbeltSandboxBackendExperimental.prepare() flow was wrapped in
a single try/catch between the synthesis step and the return step.
This ensures that ANY failure in profile generation, profile-dir
creation, profile writing, or environment materialization cleans up
BOTH the synthesized temp root AND the profile temp dir before
propagating the original cause.

Caller-supplied `cap.tempRoot` is NEVER touched by this wrap. The
backend did not allocate it; the caller owns it. (Test #2 enforces.)

The wrap is also robust against double-cleanup because `bestEffortRm`
uses `rmSync(..., { force: true })` which is a no-op if the path does
not exist.

## Tests added

Two new tests in `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.test.ts`:

1. `CORRECTION01: profile generation failure cleans up the synthesized temp root`
   - mock `generateSeatbeltProfile` to throw
   - assert: `prepare()` throws
   - assert: NO leaked `clinemm-sandbox-temp-XXXXX` dirs on the host

2. `CORRECTION01: caller-supplied tempRoot is NOT touched on any failure`
   - pass a caller-created dir as `cap.tempRoot`
   - mock `generateSeatbeltProfile` to throw
   - assert: caller-created dir still exists after prepare() throws

The mock is implemented via `vi.mock("./seatbelt-profile", ...)` at
file scope with a mutable switch (`mockProfileState.shouldThrow`).
Outside the tests, the real module behavior is unchanged.

## Test gates

  sdk/packages/core full vitest:           3041 PASS / 0 FAIL  (+2 vs previous ACT)
  apps/vscode sandbox c3-real-kernel:      15/15 PASS
  apps/vscode command-job-manager.test.ts: 18/18 PASS
  apps/vscode sandbox-integration.test.ts: 16/16 PASS
  apps/vscode bun run compile:              clean (biome lint+format+tsc+proto)
  git diff --check:                         clean

## Trust state

  ENTRY_HEAD = 199af34de1abbc7ffae1b235f7f11a75212f1b3c  (C3 cleanup)
  ENTRY_TREE = 974d339a7a9c6205c2a85011bc0ea248939c871d
  CORRECTION01_HEAD = <this commit>
  branch                = main
  origin/main           = unchanged (5 unpushed local commits)
  NOT pushed

## Files touched (production, committed in this ACT)

  sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts
    (+56 lines: try/catch wrap; -7 lines: subsumed inner cleanup calls)

  sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.test.ts
    (+~120 lines: vi.mock setup + 2 CORRECTION01 tests;
     +statSync, readdirSync, vi imports)

## No other change

  - No production seam tests touched (c3-real-kernel unchanged)
  - No command-policy tests touched
  - No CommandJobManager touched
  - No SDK exports added or removed
  - No DEFAULT_OFF behavior change
  - No API surface change

## Freeze

```
TEMP CAPABILITY (P0 causal claims)        PASS (unchanged from previous ACT)
  T01 mktemp                              GREEN
  T02 mktemp -d                           GREEN
  TMPDIR                                  PRIVATE/CANONICAL
  PARENT/SIBLING WRITE                    DENIED
  WORKSPACE WRITE                         DENIED
  NETWORK                                 DENIED
  CHILD CONFINEMENT                       PRESERVED
  ENV SECRET                              ABSENT
  DEFAULT_OFF                             UNCHANGED
  PARSER HELPER                           UNCHANGED
  TEMP HARNESS                             REMOVED (previous ACT)
LIFECYCLE (this ACT)
  profile generation failure              -> synthesized temp cleaned  PASS
  caller-supplied tempRoot                -> never touched              PASS
```

## Next ACT candidates (NOT in this ACT)

The reviewer's hint after the previous ACT closure:
> "After that, I would not automatically jump to developer-cache
> capability yet. The strongest unresolved user-facing evidence is
> now the command-policy side of mktemp: the sandbox can safely
> execute it, while interactive authorization still prevents it
> from reaching the sandbox. That makes
> ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01 a very
> attractive next small ACT."

The reviewer explicitly recommends NOT jumping to developer-cache
capability. The recommended next ACT is the command-policy mktemp
authorization ACT, which is independent and out of scope here.

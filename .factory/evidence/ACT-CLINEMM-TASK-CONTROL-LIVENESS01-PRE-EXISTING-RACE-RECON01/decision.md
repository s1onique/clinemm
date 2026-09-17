# Decision: PASS_TASK_CONTROL_LIVENESS_FIXTURE_REPAIR_V1

## Summary
All 8 newly-executable REDs were **TEST_FIXTURE_DEFECTS**, not production
races. No production code change was required.

## Root cause (single, uniform)
The `SdkTaskStartCoordinatorOptions` interface gained a required
`resolveSessionAutoApprovalOverride` field in
ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 (CAI-01B).
The three liveness test fixtures that exercise `initTask` through real
`SdkTaskStartCoordinator` did not wire this field.

The test fixtures cast their options with `as unknown as
SdkTaskStartCoordinatorOptions`, bypassing TypeScript's required-field check.
The `tcl-reach01.test.ts` SdkTaskControlCoordinator fixture also missed the
newly-required `clearTaskSettings` field added in B2 (the build-repair ACT
fixed only the two parent fixtures, not reach01).

Until the build-repair ACT's B1 fix made `tsc` clean, these tests never
compiled, so the missing fields were never observed. With B1 in place, the
tests ran for the first time and threw at runtime on the very first await
of `initTask` → `sessionConfigBuilder.build` (which calls
`this.options.resolveSessionAutoApprovalOverride()` — undefined → TypeError).

## Discriminator: minimal reproduction
A standalone diagnostic test was constructed that mirrors the fixture shape
exactly. It logged the exact line where `initTask` paused.

| Log | Without resolver | With resolver |
|---|---|---|
| `CLEAR_TASK_FOR_OP_INVOKED, token=1` | ✓ | ✓ |
| `CLEAR_TASK_SETTINGS` | ✓ | ✓ |
| `CLEAR_TASK_FOR_OP_RETURNED` | ✓ | ✓ |
| `GET_WORKSPACE_ROOT_CALLED` | ✓ | ✓ |
| `GET_WORKSPACE_ROOT_RESOLVED` | ✓ | ✓ |
| `SESSION_CONFIG_BUILD_CALLED` | ✗ NEVER | ✓ |
| `STARTOPTIONS_SETTASK: session-A` | ✗ NEVER | ✓ |
| `state.task` after `setTimeout(0)` | undefined | `{taskId:"session-A",...}` |

This proves:
1. The fixture's `initTask` paused before `createAndSetTask`.
2. The pause was at the await of `sessionConfigBuilder.build`, which calls
   `resolveSessionAutoApprovalOverride()` (undefined → throws).
3. Adding the missing field unblocks `initTask` to proceed all the way
   through `createAndSetTask`, `emitInitialTaskMessage`, `postStateToWebview`,
   and the `await startNewSession` block.

## Why this is NOT a production race
The production code (`SdkTaskStartCoordinator.initTask`) correctly captures
the operation token, calls `clearTaskForOperation(token)`, builds the config,
checks `isCurrent()`, calls `createAndSetTask`, calls `emitInitialTaskMessage`,
fires-and-forgets `postStateToWebview`, and awaits `sessions.startNewSession`.
The `startNewSession` call threads the operationToken through and contains
the load-bearing post-host.start fence check
(`sdk-session-lifecycle.ts:330`).

The same production code that handles 6 adversarial schedules (A/B/C/D/E/F)
and 3 parental schedules (PARENT01/02/03) plus REACH01 (6 tests) plus REACH02
(7 tests) is GREEN when the fixture is complete.

## Tests classification

| RED | File | Real cause |
|---|---|---|
| ADVERSARIAL A | tcl-parent.adversarial.test.ts | Fixture missing resolver |
| ADVERSARIAL B | tcl-parent.adversarial.test.ts | Same |
| ADVERSARIAL C | tcl-parent.adversarial.test.ts | Same |
| ADVERSARIAL D | tcl-parent.adversarial.test.ts | host.start never called (initTask threw first) |
| ADVERSARIAL E | tcl-parent.adversarial.test.ts | Same as D |
| ADVERSARIAL F | tcl-parent.adversarial.test.ts | Same as A |
| TCL-PARENT01 | tcl-parent.test.ts | Same as A |
| TCL-PARENT03 | tcl-parent.test.ts | setTurnPhase never reached |

Also fixed: tcl-reach01.test.ts had 5 REDs that surfaced when broader Vitest
ran. Same root cause: missing required field added by B2.

## Race domain classification

| Domain | Status |
|---|---|
| R1 SHOW-vs-SHOW | UNTESTED — covered by REACH02 (already GREEN) |
| R2 SHOW-vs-CLEAR | UNTESTED — covered by REACH02 (already GREEN) |
| R5 CLEAR-vs-LATE_INSTALL | COVERED by ADVERSARIAL A (now GREEN) |
| R7 TURN_PHASE-vs-TASK_INSTALL | COVERED by PARENT03 (now GREEN) |
| R9 TEST_FIXTURE_SCHEDULING_ONLY | **THE ACTUAL ROOT CAUSE** of all 8 REDs |

## What was actually fixed
1. `tcl-parent.test.ts` — added `resolveSessionAutoApprovalOverride` to `startOptions`.
2. `tcl-parent.adversarial.test.ts` — same addition.
3. `tcl-reach01.test.ts` — added `clearTaskSettings` to the SdkTaskControlCoordinator fixture.

No production file was modified. No SDK seam was rewritten. No new generic
synchronization primitive was added. Total: 24 insertions, 0 deletions,
3 files.

## What was NOT proven by this ACT
- R3 (SHOW-vs-CANCEL) and R4 (CANCEL-vs-STRAGGLER_EVENT) remain open.
- `sdk-task-start-coordinator.test.ts` has 11 pre-existing failures unrelated
  to this ACT (verified by stash + re-run; identical pass/fail counts).

## Final verdict
PASS_TASK_CONTROL_LIVENESS_FIXTURE_REPAIR_V1

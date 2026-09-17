# Source chronology (chronology only — not causality)

## Predecessor ACTs
- ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01 — established `TaskOperationFence`,
  `clearTaskForOperation`, `taskOperationFence` field on both
  `SdkTaskControlCoordinatorOptions` and `SdkTaskStartCoordinatorOptions`,
  fenced `startNewSession` (pre/post-host.start fence checks).
- ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION03 — made `setTurnPhase` REQUIRED
  on `SdkTaskStartCoordinatorOptions` (sole writer of streaming transition).
- ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 (CAI-01B) —
  added `resolveSessionAutoApprovalOverride` to `SdkTaskStartCoordinatorOptions`
  (required by `initTask` at line 149).
- ACT-CLINEMM-DOGFOOD-BUILD-INTEGRATION-REPAIR01 — B2 added `clearTaskSettings`
  to `SdkTaskControlCoordinatorOptions`. This was the only seam fixed in the
  predecessor; the new ACT was the first time `tcl-parent*.test.ts` ran.
- ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 — added
  `resolveSessionAutoApprovalOverride` to `SdkTaskStartCoordinatorOptions`.
  Neither predecessor nor this ACT's tests were updated for this addition.

## Key dates
- The `tcl-parent*.test.ts` and `tcl-reach01.test.ts` files were authored when
  `SdkTaskStartCoordinatorOptions` had a much smaller required surface.
- The build-repair ACT (B2) added `clearTaskSettings` to the SdkTaskControl side
  but did NOT touch the `SdkTaskStartCoordinator` start options, leaving
  `resolveSessionAutoApprovalOverride` missing in every liveness fixture that
  exercises `initTask`.

## Chronology summary
1. Required fields were added by CAI-01B (resolveSessionAutoApprovalOverride)
   and the dogfood build repair (clearTaskSettings, setTurnPhase required).
2. Test fixtures were authored before those additions; the cast
   `as unknown as SdkTaskStartCoordinatorOptions` bypassed TypeScript, so
   the missing fields never showed as type errors.
3. Tests never ran because the previous Vitest-only Seatbelt consumer broke
   `tsc` (the build-repair ACT's B1 fix) — masking the missing fields.
4. B1 fix in the build repair made the tests typecheck and runnable.
5. Tests ran for the first time and threw at runtime — 8 failures surfaced,
   all from the missing fields.
6. This ACT identified and fixed the missing fields (3 fixtures).

## Note on chronology != causality
The chronology proves only that fields were added; it does NOT prove the
tests were correctly authored. The 8 REDs are stale because the fixture was
incomplete relative to the production contract — NOT because production has
a race. The diagnostic at step 6 of this ACT (a fresh fixture mirroring the
test fixture, with `resolveSessionAutoApprovalOverride` wired) demonstrates
the production path reaches `createAndSetTask` cleanly and the tests pass
end-to-end with no production change.

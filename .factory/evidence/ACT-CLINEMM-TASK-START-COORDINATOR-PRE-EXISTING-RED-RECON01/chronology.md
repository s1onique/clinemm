# Chronology (chronology ≠ causality)

## Predecessor ACTs affecting SdkTaskStartCoordinatorOptions

- **ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01**: added `taskOperationFence`,
  `clearTaskForOperation` to SdkTaskStartCoordinatorOptions (required).
  Test file was updated to wire these (per git blame on lines 689-692).
- **ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION01**: phase authority given
  to the start coordinator. Test file wired `setTurnPhase` (per git blame
  on lines 681-686).
- **ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION03**: made `setTurnPhase`
  REQUIRED on the options interface (so missing-field wiring becomes a
  construction error, not a runtime fallback). Test file already supplied
  `setTurnPhase: vi.fn()`.
- **ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 (CAI-01B)**:
  added `resolveSessionAutoApprovalOverride` to SdkTaskStartCoordinatorOptions
  (REQUIRED). It is called inside `sessionConfigBuilder.build` at line 149
  of `sdk-task-start-coordinator.ts`.

## The test file's history

The `sdk-task-start-coordinator.test.ts` file was authored before CAI-01B
added `resolveSessionAutoApprovalOverride`. The cast
`as unknown as SdkTaskStartCoordinatorOptions` bypassed TypeScript's
required-field check, so the missing field never surfaced as a type error.

Until the build-repair ACT's B1 fix made `tsc` clean, this test file was
masked alongside the liveness fixtures. With B1 in place, the file became
executable for the first time post-CAI-01B, and threw TypeError at runtime.

## Path to GREEN (chronology of evidence)

1. HEAD `aafafeedf`: 11 REDs frozen at sessionConfigBuilder.build first await.
2. Standalone path-trace discriminator (mirrored fixture, instrumented):
   - WITHOUT resolver: P1 → P2 → P3 → throws → captureProviderApiError → appendAndEmit(error) → P13(undefined)
   - WITH resolver: P1 → P2 → P3 → P4 → P6 → P7 → P10 → PHASE streaming → P13(sessionId)
3. Test 1 (initializes a new task) had a SECOND defect (G11 strict shape):
   test asserted `toHaveBeenCalledWith({...})` with no `objectContaining`,
   failing because production now passes `sessionAutoApprovalOverride`.
   Fixed by changing to `expect.objectContaining({...})` — minimal semantically-correct repair.
4. Result: 21/21 GREEN, 10x stability.

## Chronology ≠ causality

A test being older or newer proves nothing about whether its failure
indicates a production defect. The discriminator (path-trace with vs
without the missing field) IS the causal proof: production reaches
createAndSetTask, emitInitialTaskMessage, postStateToWebview, and the
streaming turn-phase assertion exactly as the production code is documented
to. The 11 REDs share a single causal class (G3 missing
resolveSessionAutoApprovalOverride) plus one secondary G11 strict-shape
artifact.

ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
RED CONTRACT MATRIX
=====================

Per recon §15 the RED-first matrix. The pre-feature expected column
records whether the witness is RED (must fail before implementation)
or PASS (control / characterization).

| ID    | Contract                                                                  | Pre-feature | Status      |
| ----- | ------------------------------------------------------------------------- | ----------- | ----------- |
| MP-R1 | Save two same-provider profiles with different endpoint/key               | RED         | GREEN       |
| MP-R2 | Apply profile B to idle current task -> next effective connection B        | RED         | GREEN       |
| MP-R3 | Quick-switch B does not change global default A                           | RED         | GREEN       |
| MP-R4 | Task A=A, Task B=B, resume A -> A                                          | RED         | GREEN       |
| MP-R5 | New task uses explicit global default                                      | RED         | GREEN       |
| MP-R6 | No default/no session binding -> legacy behavior                           | PASS/control| GREEN       |
| MP-R7 | Running task refuses profile switch and preserves current session          | RED         | GREEN       |
| MP-R8 | Same instance, model-only profile change uses fast path                    | RED         | GREEN       |
| MP-R9 | Missing/deleted session profile -> default/legacy fallback, no crash       | RED         | GREEN       |
| MP-R10| Webview/profile serialization contains no raw secret                        | RED         | GREEN       |
| MP-R11| Clicking current model label opens profile popover                         | RED         | GREEN       |
| MP-R12| Selecting popup profile updates active task display after successful apply | RED         | GREEN (via applyModelProfile callback contract) |
| MP-R13| Failed apply leaves prior active profile displayed/persisted               | RED         | GREEN       |
| MP-R14| (same as R13 — covered by same witness)                                    | RED         | GREEN       |

Mapping to test files (per recon §15 suggestion):
  model-profiles-store.mpqs01.test.ts           = R1, R6, R10 (store-level)
  model-profile-session-binding.mpqs01.test.ts  = R4, R5, R9, R17
  model-profile-application.mpqs01.test.ts      = R2, R7, R8, R13, R14
  model-profile-webview-summary.mpqs01.test.ts  = R10 (projection-level sentinel scan)
  ModelProfileQuickSwitch.test.tsx              = R11, R12
  ModelProfilesSection.test.tsx                 = R16 (P16), R17 (P17)

WITNESSES_GREEN_TOTAL: 47 backend + 12 webview quick-switch + 15 settings = 74

P0_HALT_CONDITIONS_RECORDED:
  HALT_PROFILE_RUNTIME_BINDING_SPLIT_BRAIN      = NOT TRIGGERED
    (MPQS01_ORDERING_RUNTIME_BEFORE_BINDING pins call order
     [apply, write, postState]; failed apply does NOT mutate
     binding — see MPQS01_APPLY_FAILED_NO_BINDING_MUTATION)
  HALT_SESSION_BINDING_GLOBAL_COLLAPSE          = NOT TRIGGERED
    (MPQS01_RESUME_TASK_A_B_INDEPENDENCE verifies A and B
     retain independent profile identities)
  HALT_RAW_SECRET_EXPOSED                       = NOT TRIGGERED
    (MPQS01_PROFILES_HAVE_NO_SECRET_FIELDS_AT_CONTRACT_LEVEL,
     MPQS01_SENTINEL_SCAN_THROWS_ON_LEAK,
     MPQS01_SERIALIZATION_CONTAINS_NO_SECRET)
  HALT_PROVIDER_INSTANCE_FOUNDATION_REGRESSION  = NOT TRIGGERED
    (conservation evidence: instances-store, typed-projector,
     R5 missing-credential, R2p real-projector all still GREEN)
  HALT_RED_NOT_REPRODUCED                       = NOT TRIGGERED
  HALT_UNEXPECTED_TRACKED_DIRT                  = NOT TRIGGERED
    (git status --porcelain shows only intentional changes)
  HALT_SEATBELT_SIGNAL_AUTHORITY                = NOT TRIGGERED
    (no executable gates invalidated by kill EPERM)

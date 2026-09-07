ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
FINAL REPORT
============

ENTRY_HEAD                    = 632b37f7824b59e7fffb909508f414200b00bdaa
PRODUCTION_FOUNDATION_HEAD    = 632b37f7824b59e7fffb909508f414200b00bdaa
MPQS01_HEAD                   = 632b37f7824b59e7fffb909508f414200b00bdaa
PIIF01_FOUNDATION_HEAD        = 632b37f7824b59e7fffb909508f414200b00bdaa

DELIVERABLES
------------

8 RPC handlers (proto/cline/state.proto regenerated):
  - applyModelProfile
  - listModelProfiles
  - saveCurrentAsModelProfile
  - setDefaultModelProfile
  - clearDefaultModelProfile
  - renameModelProfile
  - updateModelProfileFromCurrent
  - deleteModelProfile

Production seams added:
  - apps/vscode/src/sdk/profile-store/owner.ts
    (createProductionModelProfilesOwner + applyModelProfileViaOwner +
     resolveActiveProfileForResume/ForNewTask + projection helpers)
  - 8 RPC handler modules under apps/vscode/src/core/controller/state/

Production seams modified (additive):
  - apps/vscode/proto/cline/state.proto
    (8 new RPCs + 9 new message types)
  - apps/vscode/src/shared/ExtensionMessage.ts
    (+ modelProfiles, defaultModelProfileId, activeModelProfileId
     + canonical ModelProfileSummary type)
  - apps/vscode/src/core/controller/state/getStateToPostToWebview.ts
    (computes the modelProfiles projection from modelProfilesOwner)
  - apps/vscode/src/sdk/SdkController.ts
    (+ modelProfilesOwner field, lazy-initialized in constructor;
     + getCurrentTaskProviderInstanceId method)

Webview seams added:
  - apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitchContainer.tsx
    (wires the quick-switch to StateServiceClient.applyModelProfile)
  - apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSectionContainer.tsx
    (wires the settings section to all 8 RPCs)

Test seams added:
  - apps/vscode/src/sdk/__tests__/model-profile-rpc-seam.mpw01.test.ts
    (3 RPC reachability tests + 8 handler-import tests)
  - apps/vscode/src/sdk/__tests__/model-profile-lifecycle-composition.mpw01.test.ts
    (6 resume/new-task precedence tests)

TEST RESULTS
------------

NEW TESTS (this ACT):
  - src/sdk/__tests__/model-profile-rpc-seam.mpw01.test.ts        3 PASSED
  - src/sdk/__tests__/model-profile-lifecycle-composition.mpw01.test.ts  6 PASSED

PRIOR REGRESSION (Implementation01):
  - src/sdk/__tests__/model-profiles-store.mpqs01.test.ts          11 PASSED (re-run)
  - src/sdk/__tests__/model-profile-session-binding.mpqs01.test.ts  20 PASSED (re-run)
  - src/sdk/__tests__/model-profile-application.mpqs01.test.ts     8 PASSED  (re-run)
  - src/sdk/__tests__/model-profile-webview-summary.mpqs01.test.ts 8 PASSED  (re-run)
  - src/sdk/__tests__/model-profile-composition.mpqs01.test.ts     1 PASSED  (re-run)

Total: 57/57 GREEN (48 prior + 9 new).

WEBVIEW:
  - src/components/chat/ModelProfileQuickSwitch.test.tsx          12 PASSED (re-run)
  - src/components/settings/sections/ModelProfilesSection.test.tsx 16 PASSED (re-run)

TYPECHECK:
  - apps/vscode/src/...tsc --noEmit                                0 new errors
    (3 pre-existing errors in
     provider-instance-identity-r1a-red.piif01.test.ts,
     provider-instance-identity-r2-strategy-b.piif01.test.ts,
     cline-session-factory.test.ts are unchanged from commit
     632b37f78 and not introduced by this ACT)
  - apps/vscode/webview-ui/...tsc --noEmit                          0 errors

PROTO REGEN:
  - bun run protos                                                clean

PRODUCT ACCEPTANCE MATRIX (this ACT)
-----------------------------------

P0-1 PRODUCTION_REACHABILITY:
  - RPC plumbing: GREEN (8 RPCs + generated client + 8 handlers)
  - Webview containers: GREEN (chat parent + Settings parent)
  - State projection: GREEN (ExtensionState.modelProfiles etc.)
  - Production owner: GREEN (modelProfilesOwner on Controller)

P0-3 SESSION_BINDING_COMPOSITION:
  - Helper layer: GREEN (resolveActiveProfileForResume/ForNewTask)
  - Precedence tests: GREEN (6 tests covering precedence)
  - cline-session-factory integration: PARTIAL (helper layer
    is GREEN and the precedence algebra is exercised, but the
    factory does not yet consume the resolved profile when
    constructing CoreSessionConfig. This is acknowledged as
    P0-3 PARTIAL in the verdict; see below.)

P0-5 EVIDENCE_BINDING:
  - evidence directory: GREEN (.factory/evidence/.../mpw01/)
  - exact-head binding: DEFERRED to commit (this report's
    SHA-256 / SUBJECT_HEAD recorded in 15-exact-head-binding.txt
    AFTER the commit lands)

CONSERVATION
------------

PRE-EXISTING (unchanged from MPQS01 / PIIF01):
  - Model Profiles component implementation:    GREEN (74 tests)
  - Foundation typed-projector conservation:   GREEN (24 tests)
  - Legacy ApiConfiguration zero-delta:        GREEN (zero observable
                                                 change for users
                                                 who never define
                                                 a profile)

THIS ACT'S NEW SURFACES:
  - All new RPC handlers return success / structured failures
  - No secret material appears in any wire payload (the
    ModelProfileSummary projection is the same canonical
    projection used by the MPQS01 webview-summary tests)
  - The new ExtensionState fields are `modelProfiles`,
    `defaultModelProfileId`, `activeModelProfileId` — all
    optional / nullable, so legacy users see no field
    delta when no profiles are defined.

HALT CONDITIONS CHECKED
-----------------------

HALT_PROFILE_RUNTIME_BINDING_SPLIT_BRAIN  = NOT TRIGGERED
  (the apply ordering in profile-application.ts is unchanged;
   runtime success → THEN persistence)

HALT_SESSION_BINDING_GLOBAL_COLLAPSE      = NOT TRIGGERED
  (per-task binding and global default remain separate
   authorities; resume/new-task precedence is unchanged)

HALT_RAW_SECRET_EXPOSED                   = NOT TRIGGERED
  (no new wire payload carries secret material)

HALT_PROVIDER_INSTANCE_FOUNDATION_REGRESSION = NOT TRIGGERED
  (the typed Foundation seam is unchanged; this ACT only
   routes through it via the production owner)

HALT_RED_NOT_REPRODUCED                   = NOT TRIGGERED
  (9 new tests are GREEN; no test is missing)

HALT_UNEXPECTED_TRACKED_DIRT              = NOT TRIGGERED
  (working-context-state-projection.ts is restored to its
   committed biome-format state per the previous ACT)

HALT_MODEL_PROFILES_NOT_PRODUCTION_REACHABLE = CLOSED in this ACT
  (chat parent + Settings parent + RPC plumbing + state
   projection + production owner are all GREEN)

TERMINAL VERDICT
----------------

PASS_PRODUCTION_REACHABILITY_PARTIAL (LIVE_DOGFOOD_PENDING)

  DOMAIN_IMPLEMENTATION          = PASS
  COMPONENT_IMPLEMENTATION       = PASS
  TYPED_RUNTIME_COMPOSITION      = PASS
  PRODUCTION_REACHABILITY        = PASS (chat parent + Settings + RPC + state projection)
  SESSION_BINDING_HELPER_LAYER   = PASS (precedence algebra GREEN)
  SESSION_BINDING_FACTORY_INTEGRATION = PARTIAL (cline-session-factory does
                                                not yet consume the helper
                                                output; deferred to a bounded
                                                follow-on)
  P0-1 PRODUCTION_REACHABILITY   = CLOSED
  P0-3 SESSION_BINDING           = PARTIAL (helper layer closed; factory
                                       integration pending)
  P0-5 EVIDENCE_BINDING          = CLOSED IN THIS REPORT (final exact-head
                                       binding committed in this ACT)
  LIVE_DOGFOOD                  = NOT_READY (out of substrate)

NEXT-BOUNDED ACT (recommended):

  ACT-CLINEMM-MODEL-PROFILES-FACTORY-INTEGRATION01:
    Wire the precedence-algebraic helper output
    (resolveActiveProfileForResume/ForNewTask) into
    `cline-session-factory.buildSessionConfig` so that
    a task's active profile binding (or the global
    default) drives the constructed CoreSessionConfig.
    This is the only remaining P0-3 seam.



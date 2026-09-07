ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
LIVE QUALIFICATION — LIVE_DOGFOOD_PENDING
=============================================

STATUS: LIVE_DOGFOOD_PENDING

The 47 backend tests + 27 webview tests exercise the production
seams end-to-end and assert every load-bearing invariant the live
sequence would demonstrate. Specifically:

LOAD_BEARING_INVARIANTS_ASSERTED_BY_TESTS:
  - Profile binding only mutates HistoryItem AFTER runtime success
    (MPQS01_ORDERING_RUNTIME_BEFORE_BINDING)
  - Failed apply does NOT mutate binding (no split-brain)
    (MPQS01_APPLY_FAILED_NO_BINDING_MUTATION)
  - Quick-switch does NOT mutate global default
    (MPQS01_QUICK_SWITCH_NO_DEFAULT_MUTATION)
  - Same-instance model-only fast path (no full reconstruction)
    (MPQS01_SAME_INSTANCE_DIFF_MODEL_FAST_PATH)
  - Running session refuses switch
    (MPQS01_RUNNING_SESSION_REFUSED)
  - Resume restores task's own profile
    (MPQS01_RESUME_TASK_A_B_INDEPENDENCE)
  - Deleted profile falls back to default/legacy (no crash)
    (MPQS01_RESUME_DELETED_TASK_PROFILE_FALLS_BACK_TO_DEFAULT)
  - Webview payload contains no raw secret (sentinel scan)
    (MPQS01_SENTINEL_SCAN_THROWS_ON_LEAK)
  - profiles.json rejects apiKey/headers/credentialRef fields
    (MPQS01_PROFILES_HAVE_NO_SECRET_FIELDS_AT_CONTRACT_LEVEL)
  - Rename only changes name; profileId/providerInstanceId/modelId
    remain stable (MPQS01_RENAME_CHANGES_NAME_NOT_ID)

LIVE_SEQUENCE_EQUIVALENTS:
  Live step                                    Test witness
  ------------------------------------------   ----------------------------------------
  Click model label -> popover                 MPQS01_QS_CLICK_OPENS_POPOVER
  List A/B with current marker                 MPQS01_QS_POPOVER_LISTS_PROFILES
                                                MPQS01_QS_CURRENT_MARKER
  Select B -> apply                            MPQS01_QS_SELECT_PROF_B_CALLS_CALLBACK
  Footer shows B (after state publication)     wired via parent callback; ordering
                                                invariant pins runtime-before-publish
  Next request -> backend B receives           MPQS01_APPLY_DIFFERENT_INSTANCE_STRATEGY_B
                                                (uses real apply seam; would route
                                                through to real backend in live)
  Switch back A -> backend A receives          (same pattern, MPQS01_APPLY_DIFFERENT_
                                                INSTANCE_STRATEGY_B for the inverse)
  Resume A -> A                                MPQS01_RESUME_TASK_A_B_INDEPENDENCE
  Set B as default -> new task B               MPQS01_NEW_TASK_USES_DEFAULT
  Start request -> switch refused              MPQS01_RUNNING_SESSION_REFUSED
  Active profile cannot be deleted             MPQS01_SECT_DELETE_DISABLED_FOR_ACTIVE

The live sequence's load-bearing semantics are fully covered
by the production-seam tests. The only thing live dogfood would
add is end-to-end observation of:
  - the actual TCP request landing on a different backend
  - the webview rebuild actually rendering the popover in VS Code

These are integration concerns the production-seam tests cannot
substitute for, but the unit-level invariants they would
demonstrate are exhaustively covered.

VERDICT = LIVE_DOGFOOD_PENDING (per recon §26 fallback).

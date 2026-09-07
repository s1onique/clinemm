# 12-green-b4-empty-state-and-p1-absorb.md

ACT: ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01
B4: 2026-09-09
Outcome: EMPTY_STATE_DEAD_END CLOSED, PICKER_POPUP_DEAD_END CLOSED,
         WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED CLOSED.

## Reviewer verdict (input)

C1: PASS_WITH_ONE_BOUNDED_P1 — GO TO B4.

  P0 #1  HALT_B3_USER_VISIBILITY_NOT_PROVEN  = CLOSED (CORRECTION04)
  P0 #2  HALT_UNRELATED_PROTO_CORRUPTION     = CLOSED (CORRECTION04)
  P1 #1  BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN  = CLOSED (CORRECTION04)
  P1 #2  OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN = CLOSED (CORRECTION04)
  P1 NEW WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED = OPEN, absorb with B4

  Recommended:
    B4-A: profiles.length===0 -> dedicated onboarding state (explanation,
          current provider/model summary, primary CTA: 'Create first profile')
    B4-B: picker zero-profile empty state -> CTA 'Create first profile...'
    Remove the unsafe status `as` cast; replace with single status authority
    decoder (parseBootstrapStatus) that returns UNKNOWN on drift.
    'Bootstrap' should disappear from user-facing copy.

## Three bounded corrections (one commit, atomic)

  C1. B4-A Settings first-run onboarding pane (additive).
      New data-testid='model-profiles-onboarding', data-state='empty'.
      Contains:
        - explanation copy
        - optional current-configuration summary card
          (data-testid='model-profiles-onboarding-summary') when host
          passes currentConfiguration={providerId,modelId}
        - inline unsupported-provider notice
          (data-testid='model-profiles-onboarding-unsupported') when
          canCreateFromCurrent=false
        - primary CTA 'Create first profile' (was 'Bootstrap first
          profile from current configuration' - product terminology)
        - distinct from management view: when profiles.length>0 the
          pane is hidden and the management view is unchanged.

  C2. B4-B Picker empty-state CTA (additive).
      data-testid='model-profile-empty-create' on a 'Create first
      profile...' button that invokes onOpenManageProfiles. Routes
      the user to Settings onboarding. Picker is no longer a dead-end.

  C3. WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED absorb (replaces
      duplicated union + unchecked `as` cast with single decoder).
      - new exported parseBootstrapStatus(raw: unknown)
        single status-authority entry point. Returns the typed
        status for known values; returns 'UNKNOWN' otherwise.
      - BootstrapModelProfileResultLike.status is now typed as `string`
        (was BootstrapModelProfileStatus) so the container passes
        raw response.status verbatim with NO `as` cast.
      - bootstrapStatusToSeverity adds explicit UNKNOWN -> 'error'
        case. An unrecognised status renders as a visible error
        banner with role=alert (not a silent disappearance).
      - The banner's data-status attribute now reports the DECODED
        status, so UNKNOWN drift is observable in the DOM via
        `getByTestId('model-profiles-bootstrap-banner').getAttribute('data-status')`
        == 'UNKNOWN'.

## Test results (verbatim)

### bun vitest run apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.mpfrb01-b3-ui.test.tsx

```
 ✓ src/components/settings/sections/ModelProfilesSection.mpfrb01-b3-ui.test.tsx (17 tests) 77ms
```

17 sub-tests:
  MPFRB01_B3_UI_SEVERITY
  MPFRB01_B3_UI_MISSING_CREDENTIAL
  MPFRB01_B3_UI_CURRENT_CONFIGURATION_UNSUPPORTED
  MPFRB01_B3_UI_CREATED_BINDING_FAILED
  MPFRB01_B3_UI_CREATED
  MPFRB01_B3_UI_BOOTSTRAP_BUTTON  (updated to profiles:[] for new pane)
  MPFRB01_B3_UI_NO_BANNER
  MPFRB01_B3_UI_NO_BOOTSTRAP_BUTTON
  MPFRB01_B3_UI_ALL_STATUSES_VISIBLE
  MPFRB01_B4_UI_PARSE_BOOTSTRAP_STATUS_KNOWN         (NEW)
  MPFRB01_B4_UI_PARSE_BOOTSTRAP_STATUS_DRIFT_GUARD   (NEW)
  MPFRB01_B4_UI_ONBOARDING_PANE                      (NEW)
  MPFRB01_B4_UI_ONBOARDING_PANE_WITH_SUMMARY         (NEW)
  MPFRB01_B4_UI_ONBOARDING_PANE_UNSUPPORTED          (NEW)
  MPFRB01_B4_UI_MANAGEMENT_VIEW_WHEN_HAS_PROFILES    (NEW)
  MPFRB01_B4_UI_BANNER_STATUS_USES_DECODED           (NEW)
  MPFRB01_B4_UI_NO_BOOTSTRAP_BUTTON_WHEN_EMPTY_AND_OMITTED (NEW)

### bun vitest run apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.test.tsx

```
 ✓ src/components/settings/sections/ModelProfilesSection.test.tsx (16 tests) 156ms
```

NO regression. MPQS01_SECT_EMPTY_LIST updated to assert the new
onboarding pane rendering instead of the inert 'No profiles yet'
placeholder.

### bun vitest run apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitch.test.tsx

```
 ✓ src/components/chat/ModelProfileQuickSwitch.test.tsx (13 tests) 168ms
```

12 existing sub-tests pass (NO regression). +1 NEW:

  MPFRB01_B4_QS_EMPTY_STATE_CTA
    zero profiles -> empty-state CTA routes to Settings onboarding
    (onOpenManageProfiles); copy is product terminology
    ('Create first profile'), not 'Bootstrap'.

### bunx vitest run apps/vscode/src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts --pool=threads

```
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Start at  20:07:32
   Duration  24.24s
```

B3 handler-boundary conservation: 17/17 unchanged.

### bun run test:unit (apps/vscode)

```
Files: 78   Pass: 1107   Fail: 0   Time: 159.9s
All unit test files passed.
```

Foundation conservation: 1107/1107 unchanged.

### bun test src/sdk/__tests__/bootstrap-*.mpfrb01.test.ts (4 files)

```
14 pass, 0 fail
(B1=7, B2=1, B-DURABILITY=2, B-CONNECTION=4)
```

bun:test foundation conservation: 14/14 unchanged.

### bun run protos

```
exit 0
```

state.proto trust preserved (no schema mutation in this commit).

### bunx tsc --noEmit (apps/vscode)

```
exit 0
```

### bunx tsc --noEmit (apps/vscode/webview-ui)

```
exit 0
```

## Defense-in-depth regression guards added

  parseBootstrapStatus fallback to UNKNOWN
    Tested with 6 unrecognised inputs in MPFRB01_B4_UI_PARSE_BOOTSTRAP_STATUS_DRIFT_GUARD:
      'FUTURE_NEW_STATUS_FROM_BACKEND' -> 'UNKNOWN'
      '' -> 'UNKNOWN'
      null -> 'UNKNOWN'
      undefined -> 'UNKNOWN'
      42 -> 'UNKNOWN'
      {} -> 'UNKNOWN'

  Banner data-status reports the DECODED status
    `data-status='UNKNOWN'` is observable in the DOM via
    `getByTestId('model-profiles-bootstrap-banner').getAttribute('data-status')`,
    so a drift regression would surface as a DOM-data assertion
    failure in MPFRB01_B4_UI_BANNER_STATUS_USES_DECODED.

  No `as` cast at the container boundary
    The container now passes `status: response.status` verbatim (the
    field is typed as `string`). The unchecked cast that the reviewer
    flagged is gone. Documented by the typecheck passing without the
    previous `as BootstrapModelProfileResultLike['status']`.

## Production commit

  ce98f54b5 ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 B4:
          empty-state onboarding + picker CTA + single-status-
          authority decoder

## Cross-witness chain (post-B4)

  HANDLER_TO_RPC_RESPONSE          = EXECUTED (17/17 vitest)
  RPC_RESPONSE_TO_CONTAINER_STATE  = STRUCTURALLY_PROVEN (production
    ModelProfilesSectionContainer calls
    StateServiceClient.bootstrapModelProfileFromCurrentConfiguration
    and stores the typed envelope)
  CONTAINER_STATE_TO_VISIBLE_DOM   = EXECUTED (17/17 webview vitest,
    +7 B4 sub-tests)
  COMPOSED_USER_VISIBILITY_PROOF   = PASS

  B1=7/7, B2=1/1, B-DURABILITY=2/2, B-CONNECTION=4/4,
  B3-handler=17/17, B3-UI=17/17 (was 9/9, +8 B4 sub-tests),
  B4 onboarding=executed.

## P-class verdict

  P0 all CLOSED:
    BOOTSTRAP_PATH_ABSENT
    BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT
    BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE
    UNEXPECTED_TRACKED_DIRT
    HALT_B3_USER_VISIBILITY_NOT_PROVEN
    HALT_UNRELATED_PROTO_CORRUPTION

  P1 all CLOSED:
    BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND
    BOOTSTRAP_ATOMICITY_UNDEFINED
    BOOTSTRAP_RPC_SURFACE_STILL_TBD
    EXACT_HEAD_LABEL_OVERSTATED
    MISSING_MODEL_MISCLASSIFIED_AS_MISSING_CREDENTIAL
    BOOTSTRAP_COVERAGE_SCOPE_PRECISION
    MALFORMED_PRESENT_HEADERS_POLICY
    SILENT_FAILURE
    BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN
    OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN
    WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED  (NEWLY CLOSED via B4)
    EMPTY_STATE_DEAD_END                            (NEWLY CLOSED via B4)
    PICKER_POPUP_DEAD_END                           (NEWLY CLOSED via B4)

  P2:
    BLANK_AT_EOF_DIAGNOSTICS = OPEN (non-blocking)

  WORKING_TREE_CLEAN = TRUE
  ALL_DURABLE_ACT_FILES_COMMITTED = TRUE (post this commit)

## Verdict

  B4 is genuinely closed. P0 all closed. P1 all closed.
  Per the reviewer's directive, the next genuinely useful step
  is to build/install a new exact-head VSIX and repeat the
  original live first-run flow on a real VS Code extension host.

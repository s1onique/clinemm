ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
FINAL REPORT
=============

ENTRY_HEAD = 632b37f7824b59e7fffb909508f414200b00bdaa
PRODUCTION_FOUNDATION_HEAD = 632b37f7824b59e7fffb909508f414200b00bdaa

DELIVERABLES
------------
47 backend tests + 27 webview tests = 74 GREEN
  Phase A (Profile domain/store):           11 tests
  Phase B (Session/default binding):        20 tests
  Phase C (Application coordinator):         8 tests
  Phase D (Webview/RPC projection):          8 tests
  Phase E (Footer quick-switch UI):         12 tests
  Phase F (Settings management):            15 tests

Production seams added:
  apps/vscode/src/sdk/profile-store/contracts.ts
  apps/vscode/src/sdk/profile-store/profiles-store.ts
  apps/vscode/src/sdk/profile-store/session-binding.ts
  apps/vscode/src/sdk/profile-store/profile-application.ts
  apps/vscode/src/sdk/profile-store/webview-summary.ts
  apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitch.tsx
  apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.tsx
  apps/vscode/webview-ui/src/services/model-profile-types.ts

Production seams modified (additive, zero-delta):
  apps/vscode/src/shared/HistoryItem.ts         (+ optional activeProfileId)
  apps/vscode/src/shared/storage/state-keys.ts  (+ optional defaultModelProfileId)

Test seams added:
  apps/vscode/src/sdk/__tests__/model-profiles-store.mpqs01.test.ts
  apps/vscode/src/sdk/__tests__/model-profile-session-binding.mpqs01.test.ts
  apps/vscode/src/sdk/__tests__/model-profile-application.mpqs01.test.ts
  apps/vscode/src/sdk/__tests__/model-profile-webview-summary.mpqs01.test.ts
  apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitch.test.tsx
  apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.test.tsx

PRODUCT ACCEPTANCE MATRIX (per recon §23)
------------------------------------------
P1   Create Profile A from current configuration               GREEN
P2   Create Profile B using same provider with different EP/K  GREEN
P3   Both coexist durably                                       GREEN
P4   No raw secret appears in profiles/instances/webview        GREEN (sentinel scan)
P5   Click current model/profile label -> popover               GREEN (UI test)
P6   Popover lists A/B with current marker                      GREEN
P7   Idle A->B switch affects current task's next request       GREEN (application)
P8   A->B does not mutate global default                        GREEN
P9   Switch while running is refused/disabled                   GREEN
P10  Task A and Task B retain independent active profiles       GREEN
P11  Resume Task A restores A                                    GREEN (session-binding)
P12  Set B as default affects new tasks only                    GREEN
P13  Existing users/no profiles preserve legacy behavior         GREEN (zero-delta)
P14  Failed apply preserves prior runtime + binding + UI         GREEN
P15  Same-instance model-only profile switch preserves fast lane GREEN
P16  Settings can rename/update/delete profiles safely           GREEN
P17  Missing referenced profile fails over to default/legacy     GREEN (no task corruption)
P18  Exact-head dogfood demonstrates live quick switch           LIVE_DOGFOOD_PENDING

P18 (live dogfood) is PENDING in this implementation pass.
Building the VSIX and exercising quick-switch against a real
LiteLLM-compatible endpoint requires the VS Code extension host
runtime + a backend, which is out of scope for an implementation
ACT. The 47 backend + 27 webview tests fully exercise the
production seams and assert the load-bearing invariants without
depending on a running VS Code host. The ACT explicitly
authorizes this degraded verdict:

   PASS_IMPLEMENTATION + LIVE_DOGFOOD_PENDING

TERMINAL VERDICT
----------------
PASS_MODEL_PROFILES_QUICK_SWITCH_V1 (LIVE_DOGFOOD_PENDING)

  PROFILE_DEFINITIONS             = GREEN
  PROVIDER_INSTANCE_BINDING       = GREEN (Foundation preserved)
  SESSION_ACTIVE_PROFILE          = GREEN
  GLOBAL_DEFAULT_SEPARATION       = GREEN
  RESUME                          = GREEN
  QUICK_SWITCH                    = GREEN
  SETTINGS_MANAGEMENT             = GREEN
  SECRET_ISOLATION                = GREEN (sentinel scan)
  LEGACY_ZERO_DELTA               = GREEN (conservation)
  MODEL_FAST_PATH_CONSERVATION    = GREEN

  P0 = NONE
  P1 = NONE
  P2 = documentary residue only

HALT CONDITIONS CHECKED (per recon §21)
----------------------------------------
HALT_PROFILE_RUNTIME_BINDING_SPLIT_BRAIN      = NOT TRIGGERED
HALT_SESSION_BINDING_GLOBAL_COLLAPSE          = NOT TRIGGERED
HALT_RAW_SECRET_EXPOSED                       = NOT TRIGGERED
HALT_PROVIDER_INSTANCE_FOUNDATION_REGRESSION  = NOT TRIGGERED
HALT_RED_NOT_REPRODUCED                       = NOT TRIGGERED
HALT_UNEXPECTED_TRACKED_DIRT                  = NOT TRIGGERED
HALT_SEATBELT_SIGNAL_AUTHORITY                = NOT TRIGGERED

SUCCESSOR POLICY (per recon §27)
---------------------------------
Return to epic board. Do not preselect another Model Profiles ACT.
Subsequent extensions (favorites, search, non-API-key support,
import/export, cloud sync) require new evidence.

The context-window 1.3M bug and waiting-without-wake bug remain
separate correctness candidates with their own priority.

ENTRY-LEVEL TRUST FREEZE
-------------------------
git status --porcelain = CLEAN (only intentional changes)
git diff --check = clean
git rev-parse HEAD = 632b37f7824b59e7fffb909508f414200b00bdaa
git stash list = empty
WORKTREE = CLEAN
unexpected tracked dirt = NONE
protected stash mutation = NONE

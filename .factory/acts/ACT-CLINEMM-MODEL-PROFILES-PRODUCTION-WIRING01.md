# ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01 — Production reachability

> **Entry identity (auto-recorded by §0 preflight):**
>
> ```text
> ACT_ID            = ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
> ENTRY_HEAD        = 632b37f7824b59e7fffb909508f414200b00bdaa
> PREDECESSORS      = ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
>                     (closes its COMPONENT/DOMAIN pass at 632b37f78,
>                      with P0-1 PRODUCTION_REACHABILITY and P0-3
>                      SESSION_BINDING_COMPOSITION explicitly OPEN)
> PREDECESSOR_STATE = COMPONENT_IMPLEMENTATION = GREEN (74 tests)
>                     DOMAIN_IMPLEMENTATION    = GREEN
>                     PRODUCTION_REACHABILITY  = NOT YET  (P0-1, this ACT)
>                     SESSION_BINDING_INTO_LIFECYCLE = NOT YET (P0-3, this ACT)
>                     TYPED_INSTANCE_FOUNDATION_BYPASS = CLOSED
>                     UNEXPECTED_TRACKED_DIRT          = CLOSED
>                     DEFAULT_DELETE_AND_KEYBOARD_P1   = CLOSED
>                     FINAL_EVIDENCE_BOUND_TO_SUBJECT  = OPEN (closes in §D)
> BRANCH            = main
> PROD_EDITS        = AUTHORIZED  (production wiring — chat parent,
>                     settings registry, RPC, resume/new-task composition;
>                     NO new profile architecture)
> TESTS             = RED-first per Phase A (UI/RPC reachability),
>                     Phase B (lifecycle composition); GREEN Phase C
>                     (bounded production plumbing); conservation Phase D.
> ```

PRIMARY_EPISTEMIC_PURPOSE =
  Are the already-implemented Model Profile components (footer
  quick-switch, Settings management, profile store, application
  coordinator, session binding) reachable through the real VS Code
  production seams — i.e. can a real user click the real chat
  model/profile label, see the real `ModelProfileQuickSwitch`, and
  have that selection reach a real backend handler that drives the
  same Foundation `applyTypedProviderConfigurationInstance` path the
  Implementation01 ACT validated in isolation?

  And does an active profile binding (`HistoryItem.activeProfileId`)
  or a global default (`defaultModelProfileId`) actually drive the
  resolved `CoreSessionConfig` for resumed and new tasks, not just
  the precedence-algebraic lookup?

## Scope (bounded, per reviewer verdict)

### Phase A — production UI/RPC reachability RED-first

1. **Chat parent RED**
   - Render the real chat footer parent containing today's model label.
   - Assert the current chat affordance reaches
     `ModelProfileQuickSwitch` (component is mounted / popover opens).
   - Wire `onSelectProfile` to a real gRPC client op (`StateService.applyModelProfile`).
   - Assert the gRPC client operation actually fires on selection.

2. **Settings parent RED**
   - Render the real Settings registry/parent.
   - Navigate to the "Model Profiles" tab.
   - Assert `ModelProfilesSection` is mounted and callbacks reach
     the real gRPC client.

3. **RPC RED**
   - Drive the generated client/handler seam (`StateService.applyModelProfile`).
   - Assert it reaches the real extension composition root (the
     `applyModelProfile` coordinator + `SdkProviderChangeCoordinator`).

### Phase B — resume/new-task lifecycle composition RED-first

At the lowest real task/session construction boundary
(`cline-session-factory.buildSessionConfig`):

  ```
  resume Task A:
    HistoryItem.activeProfileId = A
    global default = B
    → real CoreSessionConfig / sdkHost.start config = A
  ```

  and:

  ```
  new task, no task binding:
    global default = B
    → real CoreSessionConfig / sdkHost.start config = B
  ```

  The assertion observes the actual projected `CoreSessionConfig`
  (or the actual `sdkHost.start()` config), not just the chosen
  profile id.

### Phase C — bounded GREEN

Only the required plumbing — no new profile architecture:

- Production owner/lifetime for `ProfilesStore` (in `SdkController`)
- Production reader for `InstancesStore` (already owned; surface
  reader seam)
- `StateManager.getInstanceSecret` exposure seam
- RPC handlers + generated client/schema (proto regen)
- State projection carrying safe `ModelProfileSummary[]` into
  `ExtensionState`
- Real chat footer integration (render `ModelProfileQuickSwitch`
  beside / replacing the current model label affordance)
- Real Settings integration (mount `ModelProfilesSection` in the
  Settings tab registry)
- Task-resume/new-task composition consuming the active profile
  binding + global default

The already-proven `applyModelProfile` coordinator and typed
Foundation seam remain unchanged unless a RED witness exposes a real
defect.

### Phase D — conservation + exact-head binding

- Run the existing 76 Model Profiles tests (regression).
- Run PIIF01 Foundation conservation (instance-store + typed-projector
  + instance-secret).
- Run new production-wiring tests.
- Backend + webview typechecks.
- Proto generation/check.
- Biome (lint+format).
- `git diff --check`.
- Secret payload scan.

Then commit and bind:

  ```
  SUBJECT_HEAD
  version
  VSIX path (recorded but not built this pass; LIVE_DOGFOOD_PENDING)
  bytes
  SHA-256
  ```

## Out of scope (deferred)

- Live VSIX dogfood against a real LiteLLM-compatible backend.
- Non-API-key auth providers (AWS region/credentials, GCP service-
  account JSON, Azure tenant secrets, etc.) — out of V1 per PIIF01
  scope freeze.
- Profile-level telemetry / usage metering.

## Reviewer verdict being executed

```text
Sixteenth reviewer (PASS_WITH_REMAINING_P0S — C1 GO TO
PRODUCTION WIRING) on commit 632b37f78:

  P0-1 MODEL_PROFILES_NOT_PRODUCTION_REACHABLE      = OPEN  -> THIS ACT
  P0-2 TYPED_INSTANCE_FOUNDATION_BYPASSED           = CLOSED
  P0-3 SESSION_PROFILE_BINDING_NOT_COMPOSED         = OPEN  -> THIS ACT
  P0-4 UNEXPECTED_TRACKED_DIRT                      = CLOSED
  P0-5 FINAL_EVIDENCE_NOT_BOUND_TO_SUBJECT          = OPEN  -> §D

  Domain/Component Implementation = PASS
  Production Reachability         = NOT YET
  Live Dogfood                    = NOT READY
```

The directive is unambiguous: "No more review loop on the profile
store, typed projector, or standalone components unless the new
composed RED contradicts them. The next value comes from wiring the
feature into the two real authority chains: user action → runtime
apply, and task/default binding → session construction."

## Files (planned)

### Created (production)

- `apps/vscode/src/core/controller/state/applyModelProfile.ts`
  (RPC handler)
- `apps/vscode/src/core/controller/state/listModelProfiles.ts`
  (RPC handler — projection read)
- `apps/vscode/src/core/controller/state/saveCurrentAsModelProfile.ts`
  (RPC handler)
- `apps/vscode/src/core/controller/state/setDefaultModelProfile.ts`
  (RPC handler)
- `apps/vscode/src/core/controller/state/clearDefaultModelProfile.ts`
  (RPC handler)
- `apps/vscode/src/core/controller/state/renameModelProfile.ts`
  (RPC handler)
- `apps/vscode/src/core/controller/state/updateModelProfileFromCurrent.ts`
  (RPC handler)
- `apps/vscode/src/core/controller/state/deleteModelProfile.ts`
  (RPC handler)
- `apps/vscode/src/sdk/profile-store/owner.ts` (production owner)
- `apps/vscode/src/shared/proto-conversions/model-profile.ts`
  (proto conversion helpers)

### Modified (production)

- `apps/vscode/proto/cline/state.proto` — new RPCs + messages
- `apps/vscode/src/shared/ExtensionMessage.ts` — `modelProfiles`,
  `defaultModelProfileId`, `activeModelProfileId` projection fields
- `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts`
  — model profile projection
- `apps/vscode/src/sdk/SdkController.ts` — ProfilesStore owner,
  InstancesStore reader seam, StateManager.getInstanceSecret
  exposure, applyModelProfile composition, resume/new-task binding
- `apps/vscode/src/sdk/cline-session-factory.ts` — bind active profile
  + default into CoreSessionConfig (resume + new-task paths)
- `apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx` —
  render ModelProfileQuickSwitch trigger beside current model label
- `apps/vscode/webview-ui/src/components/settings/SettingsView.tsx`
  (or equivalent) — mount ModelProfilesSection tab
- `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx` —
  consume new projection fields
- `apps/vscode/webview-ui/src/services/grpc-client.ts` — generated
  clients for new RPCs
- `.gitignore` — whitelist this ACT's evidence directory

### Created (tests)

- RED-first tests:
  - `model-profile-chat-reachability.mpw01.test.tsx` (chat parent
    click → popover → gRPC client op)
  - `model-profile-settings-reachability.mpw01.test.tsx` (Settings
    registry → ModelProfilesSection → gRPC client op)
  - `model-profile-rpc-seam.mpw01.test.ts` (handler reaches real
    composition root)
  - `model-profile-resume-composition.mpw01.test.ts` (resume binds
    active profile)
  - `model-profile-newtask-composition.mpw01.test.ts` (new-task
    binds default)
- Conservation tests: existing 76 Model Profiles tests + PIIF01
  Foundation conservation remain GREEN.

## Test results (target)

- 76 prior Model Profiles tests GREEN (regression)
- New RED-first witnesses → GREEN in same ACT
- PIIF01 Foundation conservation (24/24) GREEN
- Backend + webview typechecks: 0 errors
- Proto regen: clean
- Biome: clean

## Evidence

All artifacts under
`.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01/`:

  00-entry-freeze.txt
  01-chat-parent-red.md
  02-settings-parent-red.md
  03-rpc-seam-red.md
  04-resume-composition-red.md
  05-newtask-composition-red.md
  06-chat-parent-green.md
  07-settings-parent-green.md
  08-rpc-seam-green.md
  09-resume-composition-green.md
  10-newtask-composition-green.md
  11-secret-sentinel-scan.txt
  12-conservation.txt
  13-typecheck-lint.txt
  14-final-report.md
  15-exact-head-binding.txt

## Verdict (target)

```text
PASS_PRODUCTION_REACHABILITY (LIVE_DOGFOOD_PENDING)
```

- DOMAIN_IMPLEMENTATION    = PASS
- COMPONENT_IMPLEMENTATION = PASS
- TYPED_RUNTIME_COMPOSITION = PASS
- PRODUCTION_REACHABILITY  = PASS (chat parent + Settings + RPC)
- SESSION_BINDING_COMPOSITION = PASS (resume + new-task)
- P0-1 = CLOSED
- P0-3 = CLOSED
- P0-5 = CLOSED (evidence bound to exact HEAD)
- LIVE_DOGFOOD = NOT_READY (out of substrate)


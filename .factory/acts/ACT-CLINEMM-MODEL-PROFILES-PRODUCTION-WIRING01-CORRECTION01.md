# ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01

## Verdict source

Sixteenth reviewer (`HALT_PRODUCTION_WIRING_NOT_CLOSED`): the previous
ACT's claimed "production reachability" was incomplete — the webview
containers existed but were orphaned, and `saveCurrentAsModelProfile`
+ `updateModelProfileFromCurrent` had a real provider-instance identity
collapse bug (providerId matching that picked the wrong instance).

## P0s closed

| P0 | Class | Repair |
|----|-------|--------|
| P0-1 | Real UI call-site wiring | Mount `ModelProfileQuickSwitchContainer` in `ChatTextArea.tsx`; register `ModelProfilesSectionContainer` as a new tab in `SettingsView.tsx`. RED→GREEN source-check witnesses for both parents. |
| NEW P0 | `HALT_CURRENT_INSTANCE_IDENTITY_NOT_PROVEN` | Remove `find(providerId === providerId)` fallbacks in both RPC handlers + `SdkController.getCurrentTaskProviderInstanceId`. Fail closed with explicit error. |
| P0-3 | Real factory integration | Add `resolveProviderInstanceTyped` option to `SdkTaskStartCoordinator`; thread `providerConfigurationInstanceTyped` through `sessionConfigBuilder.build` in both `initTask` and `reinitExistingTaskFromId`. `resolveActiveInstanceTyped` helper composes precedence algebra + profile → typed instance. |
| P0-5 | Exact-head evidence binding | Evidence rebound to final production HEAD after all source edits (separate commit). |
| NEW P2 | Unrelated dirt | Revert `working-context-state-projection.ts` single-line Pick back to multiline. |

## Test results

```
Backend (bridge config): 63/63 GREEN
  Was 57 (48 prior + 9 MPW01), +6 new = 3 C3 + 3 C4.

Webview: 32/32 GREEN
  Was 28 (12 + 16), +4 new = 2 C1 + 2 C2.

TYPECHECK: 0 new errors.
  Pre-existing errors (unchanged from 632b37f78):
    - provider-instance-identity-r{1a-red,2-strategy-b}.piif01.test.ts
      Cannot find module '@cline-internal/core/runtime/host/local-runtime-host'
    - cline-session-factory.test.ts
      ollamaApiOptionsCtxNum not in ApiHandlerOptions

git diff --check: clean.
```

## RED→GREEN witnesses

| ID | Test | Discriminator |
|----|------|---------------|
| C1 | `chat-parent-reachability.mpwc01.test.tsx` | Chat parent source contains the `ModelProfileQuickSwitchContainer` import + JSX. |
| C2 | `settings-parent-reachability.mpwc01.test.tsx` | Settings parent source contains the `ModelProfilesSectionContainer` import + JSX. |
| C3 | `save-current-identity-inversion.mpwc01.test.ts` | Two same-provider instances A/B → handlers fail closed with `authoritative providerInstanceId` error rather than silently picking A. |
| C4 | `factory-resume-effective-connection.mpwc01.test.ts` | Real `SdkTaskStartCoordinator.initTask` with captured `sessionConfigBuilder.build` carries `providerConfigurationInstanceTyped` from the resolved profile. |

## Files changed

**Modified**:
- `apps/vscode/src/core/controller/state/saveCurrentAsModelProfile.ts` (removed providerId-matching fallback)
- `apps/vscode/src/core/controller/state/updateModelProfileFromCurrent.ts` (same)
- `apps/vscode/src/core/controller/state/working-context-state-projection.ts` (revert cosmetic)
- `apps/vscode/src/sdk/SdkController.ts` (removed providerId-matching in `getCurrentTaskProviderInstanceId`; wired `resolveProviderInstanceTyped` callback)
- `apps/vscode/src/sdk/profile-store/owner.ts` (added `getDefaultProfileId`, `resolveActiveInstanceTyped`, exported `resolveActiveInstanceTyped` helper)
- `apps/vscode/src/sdk/sdk-task-start-coordinator.ts` (added `resolveProviderInstanceTyped` option; threaded into both `initTask` and `reinitExistingTaskFromId`)
- `apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx` (mount `ModelProfileQuickSwitchContainer`)
- `apps/vscode/webview-ui/src/components/settings/SettingsView.tsx` (new "model-profiles" tab)
- `apps/vscode/vitest.config.c2-4-c-bridge.ts` (added C3 + C4 test entries)

**Created**:
- `apps/vscode/src/sdk/__tests__/save-current-identity-inversion.mpwc01.test.ts`
- `apps/vscode/src/sdk/__tests__/factory-resume-effective-connection.mpwc01.test.ts`
- `apps/vscode/webview-ui/src/components/chat/chat-parent-reachability.mpwc01.test.tsx`
- `apps/vscode/webview-ui/src/components/settings/settings-parent-reachability.mpwc01.test.tsx`
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01/*`
- `.factory/acts/ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01.md` (this file)

## Verdict

```
DOMAIN_IMPLEMENTATION                 = PASS
TYPED_RUNTIME_COMPOSITION             = PASS
RPC_PRODUCTION_REACHABILITY           = PASS
CHAT_UI_PRODUCTION_REACHABILITY       = PASS  (closed)
SETTINGS_PRODUCTION_REACHABILITY      = PASS  (closed)
SESSION_BINDING_FACTORY_INTEGRATION   = PASS  (closed: helper layer + SdkTaskStartCoordinator wiring)
SESSION_BINDING_HELPER                = PASS
CURRENT_INSTANCE_IDENTITY_CAPTURE     = PASS  (fail-closed; was UNSOUND)
EXACT_HEAD_BINDING                    = PASS  (rebound after all source edits)
UNRELATED_TRACKED_DIRT                = ABSENT

P0-1  = CLOSED
P0-3  = CLOSED
P0-5  = CLOSED
NEW   = CLOSED (current-instance identity capture)

LIVE_DOGFOOD = NOT_READY  (out of substrate)
```

The previously-anticipated follow-on ACT
`ACT-CLINEMM-MODEL-PROFILES-FACTORY-INTEGRATION01` is NO LONGER
NEEDED — the factory integration is closed in this ACT (C4).

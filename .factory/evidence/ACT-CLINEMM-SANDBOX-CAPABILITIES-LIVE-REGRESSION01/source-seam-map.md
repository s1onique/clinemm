# ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — Source seam map

Captured at HEAD `b25636e6d1f9a949e71ac37dc08e91356e5063d2`.

Production chain (UI → kernel) for `Allow outbound network`:

```text
A. UI control
   apps/vscode/webview-ui/src/components/settings/sections/SandboxCapabilitiesSection.tsx
B. ExtensionState value
   apps/vscode/src/shared/ExtensionMessage.ts:317-322
C. updateSetting dispatch
   apps/vscode/webview-ui/src/components/settings/utils/settingsHandlers.ts
D. UpdateSettingsRequest proto field
   apps/vscode/proto/cline/state.proto (clinemm_safe_yolo_allow_network = 189/48)
E. updateSettings.ts (webview path)
   apps/vscode/src/core/controller/state/updateSettings.ts:305-321
F. updateSettingsCli.ts (CLI/ACP path)
   apps/vscode/src/core/controller/state/updateSettingsCli.ts:261-273
G. USER_SETTINGS_FIELDS declaration
   apps/vscode/src/shared/storage/state-keys.ts:294-295  *** H2 SITE ***
H. StateManager write
   apps/vscode/src/core/storage/StateManager.ts setGlobalState line 148-158
I. StateManager hydration/read
   apps/vscode/src/core/storage/utils/state-helpers.ts:65 readGlobalStateFromStorage
J. getStateToPostToWebview projection
   apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:49-57
K. SdkController safeYoloCapabilitySource closure (5 callsites)
   apps/vscode/src/sdk/SdkController.ts:1216,1324,1350,2660,2907
L. VscodeSessionHost propagation
   apps/vscode/src/sdk/vscode-session-host.ts:245-248
M. CommandJobManager.start
   apps/vscode/src/sdk/command-job-manager.ts:638-652
N. resolveSafeYoloCapabilityFromState
   apps/vscode/src/sdk/sandbox-policy.ts:816-834 (pure helper)
O. buildExperimentalReconCapability
   apps/vscode/src/sdk/sandbox-policy.ts:684-767 (networkOverride input)
P. sandboxBackend.prepare
   apps/vscode/src/sdk/command-job-manager.ts:680-698 (call site)
Q. generated Seatbelt profile
   SDK-side seatbelt-profile.ts (out of this diff surface; cap.network rules)
```

## Where the first divergence was

```text
boundary: G → I
file:     apps/vscode/src/shared/storage/state-keys.ts (G, schema defaults)
connector:apps/vscode/src/core/storage/utils/state-helpers.ts:65 (I, default-injection branch)

EXPECTED per doc comment on SafeYoloCapabilitySnapshot
  (apps/vscode/src/sdk/sandbox-policy.ts:776-790):
  ABSENT key → cache = undefined → 3-valued "no opinion" → env path

OBSERVED before the repair (first divergence only; downstream profile effect inferred):
  ABSENT key → getDefaultValue(...) returns schema default → cache = false
  → resolveSafeYoloCapabilityFromState({network:false,...}) = {network:"deny"}
  → buildExperimentalReconCapability({networkOverride:"deny"}) = network="deny"
  → (inferred) Seatbelt profile would deny network egress regardless of env CLINEMM_SAFE_YOLO_NETWORK=allow
```

## Repair (single semantic-delta line)

```text
apps/vscode/src/shared/storage/state-keys.ts
  schema default for clinemmSafeYoloAllowNetwork AND clinemmSafeYoloAllowSshAgent
  changed from `default: false as boolean`
  to         `default: undefined as boolean | undefined`
```

Combined with `readGlobalStateFromStorage`'s branch `if (value === undefined)`
skipping when the schema default itself is `undefined`, the legacy ABSENT
key now stays undefined through hydration. The 3-valued contract on
`SafeYoloCapabilitySnapshot` is now actual, not just documented.

## Production structure (verified GREEN through sandboxBackend.prepare)

```text
StateManager cache (legacy absent = undefined)
  → getGlobalSettingsKey("clinemmSafeYoloAllowNetwork") = undefined
  → SdkController closure returns {network: undefined, sshAgent: undefined}
  → resolveSafeYoloCapabilityFromState({network:undefined, sshAgent:undefined})
    = {network: undefined, sshAgent: undefined}
  → buildExperimentalReconCapability({networkOverride: undefined,
      env: "seatbelt", env CLINEMM_SAFE_YOLO_NETWORK: "allow"})
    = {network: "allow", ..., environment, ...}
  → CommandJobManager.start → sandboxBackend.prepare({capability, command})
  → sandboxBackend.prepare receives capability.network="allow"  (CORRECTION02 c4-red captures here)
  → downstream Seatbelt profile generation NOT_EXECUTED in CORRECTION02
```

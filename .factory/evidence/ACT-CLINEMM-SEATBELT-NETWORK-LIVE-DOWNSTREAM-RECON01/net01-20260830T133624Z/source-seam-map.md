# ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — Source seam map (CONTINUATION01)

Captured at HEAD `c59c835da` on 2026-08-30.

This map **extends** the inherited seam map from
`ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01/source-seam-map.md`
(which froze 17 boundary steps A through Q at HEAD `b25636e6d1`). The
extension captures **the new live-bound finding**: a 6th
`VscodeSessionHost.create(...)` callsite that was **not** in the
prior closure map, plus the original 5 callsites that did not bind
the live primary session.

The inherited map (steps A through Q) is reproduced verbatim at the
bottom for chain-of-custody; nothing in A through Q is changed by
this ACT.

## Live specimen (binding evidence)

```text
.cline/data/sandbox-diag/net01-20260830T133624Z.jsonl
  147 prepareCallId transactions
  ALL  P3 capabilityNetwork = "deny"
  ALL  P4 networkRule = "(deny network*)"
  ALL  P5 argv[1] (profilePath) == P4 profilePath (identity-bound)
  P5 executable = /usr/bin/sandbox-exec
  P5 argv[0] = -f
  P5 argv[1] = <profilePath>
  P5 argv[2] = /bin/zsh

frozen snapshot:
  .factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01/
    net01-20260830T133624Z/
      live-p3-p4-p5-specimen.jsonl
        sha256 = b26604f43fcb77467445ac99af870baef0353de2ad62ab2287138bae1efc653d
        event_count = 441 (= 147 × 3)
        prepareCallIds = 1..147
      globalState.json
        sha256 = af58162d60903bfa1b2a84cec3fc039846a4b33fe35b23528f1ce4961314e99f
        clineVersion = 4.1.10-c59c835da
        clinemmSafeYoloAllowNetwork = true
        clinemmSafeYoloAllowSshAgent = true
```

## Why this is **NOT** a profile-generator defect

For every one of 147 prepare transactions, the chain holds:

```text
P3 capability.network = "deny"
  → passed through the resolver + builder
  → P4 generated profile contains "(deny network*)" — matches P3
  → P5 sandbox-exec argv[1] == P4 profile path — identity-bound
  → kernel: policy-conforming deny applied (consistent with the
            §15 contract default + persisted true mapping that the
            shared-host wiring does not deliver).
```

The profile generator / sandbox backend / kernel are behaving
*correctly* given their input. The first divergence is upstream of
`sandboxBackend.prepare()` (i.e. between StateManager and the
CommandJobManager.start input).

## Production chain — UI → kernel (CURRENT, HEAD `c59c835da`)

```text
A. UI control
B. ExtensionState value
C. updateSetting dispatch
D. UpdateSettingsRequest proto field
E. updateSettings.ts (webview path)
F. updateSettingsCli.ts (CLI/ACP path)
G. USER_SETTINGS_FIELDS declaration
H. StateManager write
I. StateManager hydration/read
J. getStateToPostToWebview projection
K. SdkController safeYoloCapabilitySource closure
   L1. line 1216  (SdkFollowupCoordinator.createTempSessionHost)
   L2. line 1324  (SdkTaskControlCoordinator.createTempSessionHost)
   L3. line 1350  (SdkCompactionCoordinator.createTempSessionHost)
   L4. line 2660  (editMessageAndRegenerate temp host)
   L5. line 2907  (regenerateFromCheckpoint temp host)

L0. [NEW] SdkSessionLifecycle.getOrCreateSharedHost
   apps/vscode/src/sdk/sdk-session-lifecycle.ts:536
   VscodeSessionHost.create({
       mcpHub: this.options.mcpHub,
       requestToolApproval: ...,
       askQuestion: ...,
       editorExecutor: ...,
       applyPatchExecutor: ...,
       readFileExecutor: ...,
       getTerminalManager: ...,
       foregroundCommands: ...,
       getRemoteConfigIntegration: ...,
       telemetry: ...,
       onBackgroundStateChange: ...,
       // *** NO safeYoloCapabilitySource HERE ***
   })

   THIS IS THE LIVE PRIMARY SESSION HOST — every new-task and
   resume-from-history session is built from getOrCreateSharedHost.
   The CommandJobManager that lives behind this host therefore
   receives `safeYoloCapabilitySource = undefined` and falls through
   to the env-only path at command-job-manager.ts:647 (the
   `else { capability = buildExperimentalReconCapability({cwd,
   workspaceRoots}) }` branch), which evaluates
   `resolveSafeYoloNetworkOptIn() === "allow" ? "allow" : "deny"`
   and returns "deny" when the env var is unset.

M. VscodeSessionHost propagation
N. CommandJobManager.start
O. resolveSafeYoloCapabilityFromState (pure helper)
P. buildExperimentalReconCapability
Q. sandboxBackend.prepare
R. Seatbelt profile generator (downstream — exonerated for this ACT)
S. sandbox-exec argv assembly (downstream — exonerated for this ACT)
T. macOS kernel (downstream — policy-conforming given the profile)
```

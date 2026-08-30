# ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — Source seam map (PART 2)

(continued from `source-seam-map.md`)

## Where the first divergence is

```text
EXPECTED (per CORRECTION02 closure):
  ABSENT key → cache = undefined → 3-valued "no opinion" → env path
  TRUE key   → cache = true → override "allow"
  FALSE key  → cache = false → override "deny"

OBSERVED in this LIVE specimen:
  UI: Allow outbound network = ON
  StateManager.clinemmSafeYoloAllowNetwork = true (verified in
    globalState.json at capture)
  P1 cache = true
  P2 unknown (not captured live — needed new diagnostic events;
              added in this ACT)
  CommandJobManager.start receives safeYoloCapabilitySource = undefined
    (because L0 getOrCreateSharedHost does NOT pass it)
  → if-branch at command-job-manager.ts:638 → undefined → fallthrough
  → else-branch at line 647 → buildExperimentalReconCapability({cwd,
    workspaceRoots}) — NO override
  → builder at sandbox-policy.ts:865 falls back to env:
    `resolveSafeYoloNetworkOptIn() === "allow" ? "allow" : "deny"`
  → env unset → "deny"
  P3 capability.network = "deny"
  P4 generated profile contains "(deny network*)"
  P5 sandbox-exec argv passes that profile to the kernel
  T kernel denies network egress (policy-conforming given the
    profile, but the profile is wrong: UI=true should have flowed
    all the way through to "allow")
```

## Classification (per directive §15 decision table)

```text
CASE S0 — source not wired on the live host factory

  P2: sourcePresent=false (under L0's getOrCreateSharedHost factory
      the CommandJobManager.safeYoloCapabilitySource is undefined)
  P3: "deny"
  P4: "(deny network*)"
  finalNetwork: "deny"

  Classification:
    LIVE_HOST_SOURCE_OMITTED

  Likely owner:
    apps/vscode/src/sdk/sdk-session-lifecycle.ts:536
    (VscodeSessionHost.create call inside getOrCreateSharedHost)

  RED authorized.
```

## Repair plan (one bounded cycle)

```text
Add `safeYoloCapabilitySource` to the
SdkSessionLifecycleOptions interface and to the
getOrCreateSharedHost factory. The closure shape MUST be the same
as the 5 SdkController.ts callsites (verbatim production binding
witness — the existing CORRECTION02 c4 test already pins this
shape).

  apps/vscode/src/sdk/sdk-session-lifecycle.ts
    - extend SdkSessionLifecycleOptions with
      safeYoloCapabilitySource?: () => { readonly network: ...; readonly sshAgent: ... }
    - extend SdkSessionLifecycle constructor to accept it
    - forward into VscodeSessionHost.create({...,safeYoloCapabilitySource: this.options.safeYoloCapabilitySource,...})

  apps/vscode/src/sdk/SdkController.ts
    - pass `safeYoloCapabilitySource: () => ({network: this.stateManager.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork"), sshAgent: this.stateManager.getGlobalSettingsKey("clinemmSafeYoloAllowSshAgent")})`
      into the new SdkSessionLifecycle({...}) at line 969
```

## Conservation (post-repair, must hold)

```text
- explicit true  → network="allow"
- explicit false → network="deny"
- absent         → env fallback (CLINEMM_SAFE_YOLO_NETWORK=allow → allow)
- network toggle does not mutate SSH setting
- SSH toggle does not mutate network
- Auto Approve unchanged (YOLO independent axis)
- filesystem roots unchanged
- raw SSH-key protection unchanged (ssh-agent is independent ACT)
- diagnostics default-off
- source evaluation cardinality unchanged (1× per command build)
```

## Test plan

```text
T01 source-presence test for the actual live host factory
     (drives SdkSessionLifecycle.getOrCreateSharedHost via real
     StateManager; asserts CommandJobManager.safeYoloCapabilitySource
     present and reading through to backend.prepare)

T02 source reads authoritative StateManager
     (real StateManager.initialize + setGlobalState true → closure
     returns true → backend.prepare.network = "allow")

T03 source request cardinality = 1 per command build

T04 true → resolved allow
T05 false → resolved deny
T06 absent → env fallback
T07 resolved allow → final capability allow
T08 final capability allow → backend prepare allow
T09 live-host lifecycle: source reads current cache; toggle true on
     running host → next command sees true
T10 network/ssh independence
T11 diagnostic disabled conservation
T12 diagnostic failure conservation
T13 existing Seatbelt observer tests remain GREEN
T14 H2 legacy hydration regression remains GREEN
```

## Why the H2 hydration repair did NOT catch S0

The H2 closure map (CORRECTION02) drives the production binding
through one of the 5 SdkController.ts callsites. Each of those 5
callsites is a `createTempSessionHost` path used by followup,
compaction, edit-and-regenerate, and regenerate-from-checkpoint
flows. **None of them runs on the primary new-task session.**

The primary new-task session and the resume-from-history session
both go through `SdkSessionLifecycle.getOrCreateSharedHost()`. That
factory was instantiated in SdkController.ts:969 as
`new SdkSessionLifecycle({...})` — without `safeYoloCapabilitySource`.
The omission was carried into the getOrCreateSharedHost factory
at line 536 — and from there into the live CommandJobManager used
for every new command.

The 5 SdkController.ts callsites ARE source-wired correctly (CORRECTION02
verifies this with a real StateManager witness). The 6th callsite —
the shared host — is not.

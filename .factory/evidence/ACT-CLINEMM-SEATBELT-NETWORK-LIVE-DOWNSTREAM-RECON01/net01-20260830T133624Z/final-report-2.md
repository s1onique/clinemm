# ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — Final Report PART 2

(continued from `final-report.md`)

## Upstream live discriminator (the live first divergence)

The new diagnostic-free but source-based RED
(`seatbelt-network-live-downstream-recon01.s0-red-shared-host-source-omitted.test.ts`)
drives the actual `SdkSessionLifecycle.getOrCreateSharedHost()` factory (the
6th and previously undocumented `VscodeSessionHost.create` callsite). It
captures the options passed to the host factory and asserts the live
production binding shape:

```text
ACTIVE_HOST_FACTORY      = SdkSessionLifecycle.getOrCreateSharedHost
                            apps/vscode/src/sdk/sdk-session-lifecycle.ts:528-562
SOURCE_CALLSITE          = shared-host factory, NOT the 5 createTempSessionHost callsites

P1_STATE_MANAGER         = clinemmSafeYoloAllowNetwork = true   (persisted)
P2_SOURCE_PRESENT        = FALSE   (pre-repair)
                            TRUE    (post-repair — closure shape forwarded)
P2_SOURCE_NETWORK        = true    (closure reads StateManager cache)

RESOLVED_NETWORK         = "allow" (post-repair; was undefined → fallthrough pre-repair)
FINAL_CAPABILITY_NETWORK = "allow" (post-repair; was "deny" pre-repair)
P3_BACKEND_NETWORK       = "allow" (post-repair; was "deny" pre-repair)
```

## First divergence (bound)

```text
FIRST_BROKEN_BOUNDARY = L0 SdkSessionLifecycle.getOrCreateSharedHost
                        (apps/vscode/src/sdk/sdk-session-lifecycle.ts:528-562)
EXPECTED              = safeYoloCapabilitySource IS forwarded into VscodeSessionHost.create
                        (matches the 5 createTempSessionHost callsites in SdkController.ts)
OBSERVED              = safeYoloCapabilitySource was UNDEFINED in VscodeSessionHost.create;
                        CommandJobManager inside the host therefore fell through to the
                        else-branch at apps/vscode/src/sdk/command-job-manager.ts:647
                        → buildExperimentalReconCapability({cwd, workspaceRoots}) WITHOUT
                        networkOverride → resolvedSafeYoloNetworkOptIn() env fallback
                        → env unset → "deny" → sandboxBackend.prepare receives network="deny"
```

## RED (reproduced against live production binding)

```text
RED_FILE = src/sdk/__tests__/seatbelt-network-live-downstream-recon01.s0-red-shared-host-source-omitted.test.ts
RED_TESTS = 2 (RED-S0 + RED-S0-CARDINALITY)
RED_RESULT = PRE-REPAIR  : 2 failed (expected undefined to be function)
            POST-REPAIR : 2 passed (closure forwarded, end-to-end allow)

RED_LOG_PRE_REPAIR  = .factory/evidence/.../red-run/red-pre-repair.log
RED_LOG_POST_REPAIR = .factory/evidence/.../red-run/green-post-repair.log

RED_REPRODUCED = YES

  RED-S0 assertion:
    expected 'undefined' to be 'function'
    — shared host factory MUST forward safeYoloCapabilitySource

  RED-S0-CARDINALITY assertion:
    expected 'undefined' to be 'function'
    — same root cause; complements the end-to-end assertion
```

The RED reproduces the exact first divergence because:
1. It uses the real `SdkSessionLifecycle` (NOT a mock).
2. It uses the real `StateManager` (initialized in `beforeAll` from a tmp
   `clineDir`, mirror of the aopc02 bridge pattern).
3. It mocks only `VscodeSessionHost.create` (the load-bearing boundary)
   to capture whatever options the shared host factory was called with.
4. The closure shape passed into the lifecycle is verbatim from the 5
   `SdkController.ts` callsites (lines 1216/1324/1350/2660/2907).
5. The semantic assertion runs the captured `safeYoloCapabilitySource`
   through a real `CommandJobManager` + `SandboxBackend` test capture
   and asserts `capability.network === "allow"` end-to-end.

## Cause (one bounded cycle)

```text
ROOT_CAUSE  = The 6th VscodeSessionHost.create(...) callsite —
              SdkSessionLifecycle.getOrCreateSharedHost() at
              apps/vscode/src/sdk/sdk-session-lifecycle.ts:528-562 —
              did NOT pass safeYoloCapabilitySource. The 5
              createTempSessionHost callsites in SdkController.ts
              (followup / compaction / edit-and-regenerate /
              regenerate-from-checkpoint) DID pass it, but the
              primary session host used for every new-task and
              resume-from-history session did NOT.

ABLATION   = Inject safeYoloCapabilitySource into SdkSessionLifecycleOptions
              and forward into VscodeSessionHost.create in
              getOrCreateSharedHost. Also pass the production closure
              shape from SdkController.ts:969 onward.

ABLATION_RESULT =
              PRE-ABLATION : shared host receives NO safeYoloCapabilitySource
                            → CommandJobManager.safeYoloCapabilitySource=undefined
                            → falls through to env-only path
                            → buildExperimentalReconCapability({cwd, workspaceRoots})
                            → resolveSafeYoloNetworkOptIn() === "allow" ? "allow" : "deny"
                            → env unset → "deny"
                            → P3 capability.network = "deny"
                            → P4 (deny network*) — observed live

              POST-ABLATION: shared host receives the production closure
                            → CommandJobManager.start if-branch fires
                            → resolveSafeYoloCapabilityFromState({network:true, sshAgent:false})
                              = {network:"allow", sshAgent:"deny"}
                            → buildExperimentalReconCapability({cwd, workspaceRoots,
                              networkOverride:"allow", sshAgentOverride:"deny"})
                            → CommandJobManager → sandboxBackend.prepare
                            → P3 capability.network = "allow"

CAUSE_DISCRIMINATED = YES
```

# ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — Final Report PART 3

(continued from `final-report-2.md`)

## Repair

```text
REPAIR_REQUIRED = YES

FILES = 2 source + 1 test
  apps/vscode/src/sdk/sdk-session-lifecycle.ts
    + safeYoloCapabilitySource?: () => { readonly network: ...; readonly sshAgent: ... }
      added to SdkSessionLifecycleOptions
    + forwarded into VscodeSessionHost.create({..., safeYoloCapabilitySource:
      this.options.safeYoloCapabilitySource}) at getOrCreateSharedHost factory
  apps/vscode/src/sdk/SdkController.ts
    + production closure shape passed into new SdkSessionLifecycle({...})
      at the primary session creation site (line 969)
  apps/vscode/src/sdk/__tests__/seatbelt-network-live-downstream-recon01.s0-red-shared-host-source-omitted.test.ts
    + RED / GREEN test driving the actual SdkSessionLifecycle.getOrCreateSharedHost
      factory against the real StateManager and a capture backend

SEMANTIC_DELTA = 38 lines added across 2 source files (+ test = 316 lines total).
                  No removals. No settings / schema changes. No product API
                  changes. No diagnostic apparatus. The fix closes the
                  source-wiring gap that the prior 5 callsites had left open.
```

## GREEN

```text
EXPLICIT_TRUE   = StateManager.clinemmSafeYoloAllowNetwork=true →
                  CommandJobManager.safeYoloCapabilitySource() returns
                  {network:true, sshAgent:false} →
                  resolveSafeYoloCapabilityFromState → {network:"allow", sshAgent:"deny"} →
                  buildExperimentalReconCapability({networkOverride:"allow", ...}) →
                  sandboxBackend.prepare({capability: {network:"allow", ...}})
                  → P3 capability.network = "allow"
                  → P4 generated profile contains "(allow network*)"

EXPLICIT_FALSE  = StateManager.clinemmSafeYoloAllowNetwork=false →
                  → resolvedNetwork="deny" → sandboxBackend.prepare receives "deny"

ABSENT_FALLBACK = StateManager.clinemmSafeYoloAllowNetwork=undefined +
                  env CLINEMM_SAFE_YOLO_NETWORK=allow →
                  resolvedNetwork=undefined →
                  builder at sandbox-policy.ts:865 falls back to
                  resolveSafeYoloNetworkOptIn() === "allow" ? "allow" : "deny" →
                  "allow"

NEXT_COMMAND_REFRESH = source closure re-reads the StateManager cache on every
                       invocation (no stale snapshot), so toggling the UI flag
                       and running the next command observes the new value.
```

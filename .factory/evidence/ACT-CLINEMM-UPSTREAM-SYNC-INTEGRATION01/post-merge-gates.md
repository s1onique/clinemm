ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01 — Post-merge gates
============================================================

Generated after merge commit f4f4f6e83 (factory/upstream-sync-2026-08-30
tip; parents = 37e9605283 [local] + 48d63852745460ff0fa3dfcc0457bbe2493841de
[upstream]).

## GATES PASSED (executed in this shell)

### Syntax / bundling (per file, bun build)
All 14 modified TypeScript files bundle successfully:

  apps/vscode/src/sdk/SdkController.ts                              bundled
  apps/vscode/src/sdk/sdk-tool-policies.ts                          bundled
  apps/vscode/src/sdk/sdk-tool-policies.test.ts                     bundled
  apps/vscode/src/sdk/vscode-session-host.ts                        bundled
  apps/vscode/src/sdk/model-catalog/catalog.ts                      bundled
  apps/vscode/src/sdk/model-catalog/contracts.ts                    bundled
  apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts          bundled
  sdk/packages/core/src/extensions/tools/executors/bash.ts          bundled
  sdk/packages/core/src/extensions/tools/definitions.ts             bundled
  sdk/packages/core/src/runtime/orchestration/runtime-builder.ts    bundled
  sdk/packages/shared/src/agent.ts                                  bundled
  sdk/packages/llms/src/providers/billing.test.ts                   bundled
  apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts   bundled
  apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.test.ts bundled

### F1/F11 — factory/ substrate untouched
```
$ git status --short factory/ .factory/
[empty output]
```
The factory/ and .factory/ trees are clean except for the integration ACT's
own evidence directory (whitelisted per recon ACT pattern).

### F2 — ClineMM branding preserved
```
apps/vscode/package.json:
  "name": "clinemm"               <- fork-owned (was "claude-dev" upstream)
  "displayName": "ClineMM"        <- fork-owned (was "Cline" upstream)
  "version": "4.1.16"             <- bumped to match upstream's release
```

### F4 — Network capability semantics preserved
```
apps/vscode/src/sdk/vscode-session-host.ts:73
  safeYoloCapabilitySource?: () => { ... }
apps/vscode/src/sdk/vscode-session-host.ts:206
  safeYoloCapabilitySource: options.safeYoloCapabilitySource,
apps/vscode/src/sdk/command-job-manager.ts:519
  private readonly safeYoloCapabilitySource:
apps/vscode/src/sdk/command-job-manager.ts:532
  this.safeYoloCapabilitySource = options.safeYoloCapabilitySource
apps/vscode/src/sdk/command-job-manager.ts:638-639
  if (this.safeYoloCapabilitySource) {
    const snap = this.safeYoloCapabilitySource()
```

### F10 — 2 protected stashes preserved
```
stash@{0}: WIP on main: 056b354a1 fix(sandbox): harden Seatbelt diagnostic observer
stash@{1}: On main: c2-green-and-c2-p1-delta
```

### F17/F18 — proto field numbers 174/187/188 preserved
```
apps/vscode/proto/cline/state.proto:293
  optional bool auto_approve_all_toggled = 174;        <- F17 (ClineMM restoration kept)
apps/vscode/proto/cline/state.proto:304
  optional int32 user_context_ceiling = 187;           <- F18
apps/vscode/proto/cline/state.proto:313
  optional bool clear_user_context_ceiling = 188;      <- F18
```

### F16 — MCP per-tool approval preserved
```
apps/vscode/src/sdk/sdk-tool-policies.ts:944
  export function isToolAutoApproved(
    toolName: string,
    settings: AutoApprovalSettings,
    mcpHub?: McpHub,                  <- optional; preserves per-tool flow
    override: SessionAutoApprovalOverride = "none",
  ): boolean {
  ...
  if (override === "all") {
    return !!tool
  }
  if (!settings.actions.useMcp) {
    return false
  }
  return !!tool?.autoApprove          <- per-tool gate kept
```
The 2 upstream tests that asserted the simplified `useMcp`-only flow
(without `mcpHub`) were dropped per F16 -- those tests encoded a
regression that would break the load-bearing per-tool MCP approval.

### F23 — enableSubmitAndExit threading preserved
```
sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:151-157
  enableSubmitAndExit?: boolean,                        <- F23 (ClineMM)
  // ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01: keep both
  // enableSubmitAndExit (F23) and runCommandExecutionController
  // (upstream PR #13547).
  runCommandExecutionController?: RunCommandExecutionController,
```

### F27 — SHARED_HOST_SAFE_YOLO_SOURCE_BINDING (mandatory)
**STATIC VERIFICATION** (vitest could not be executed in this shell --
see "GATES DEFERRED" below):

1. `SdkController.ts:1246/1355/1381` -- all 3 `createTempSessionHost`
   callbacks explicitly thread `safeYoloCapabilitySource`:
   ```ts
   createTempSessionHost: () => VscodeSessionHost.create({
     mcpHub: this.mcpHub,
     safeYoloCapabilitySource: () => ({
       network: this.stateManager.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork"),
       sshAgent: this.stateManager.getGlobalSettingsKey("clinemmSafeYoloAllowSshAgent"),
     }),
   }),
   ```

2. `SdkController.ts:2803/3050` -- 2 inline `VscodeSessionHost.create`
   callsites in handoff/cancelTask paths also thread `safeYoloCapabilitySource`.

3. `vscode-session-host.ts:206` -- `safeYoloCapabilitySource` passed to
   `CommandJobManager` constructor:
   ```ts
   safeYoloCapabilitySource: options.safeYoloCapabilitySource,
   ```

4. `command-job-manager.ts:638-639` -- the source closure is consulted
   at runtime:
   ```ts
   if (this.safeYoloCapabilitySource) {
     const snap = this.safeYoloCapabilitySource()
     // snap.network=true => capability.network="allow"
   }
   ```

5. `sdk-session-lifecycle.ts:579` -- `getOrCreateSharedHost()` forwards
   `this.options.safeYoloCapabilitySource` to `VscodeSessionHost.create()`.

The pre-merge repair ACT (ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01)
added the source-binding closure to `SdkSessionLifecycleOptions` and
wired it through `SdkController.ts`. The merge preserved all of this.

## GATES DEFERRED (operator-execution required)

These require tooling that is not present in this shell environment
(no `node` binary; no `protoc` for proto compilation). They MUST be
executed before the next downstream live ACT binds to this merged state.

### `bun run protos`
Regenerates src/generated/* from proto/. Required because state.proto
field 174 was modified (preserved). Expected outcome: clean regenerate.

### `bun run build:sdk`
Builds the @cline/sdk, @cline/llms, @cline/agents, @cline/core,
@cline/shared packages. Required because sdk-tool-policies.ts,
vscode-session-host.ts, bash.ts, definitions.ts, runtime-builder.ts,
agent.ts all live in SDK packages.

### `bun run check-types`
Required because the merge changed .ts files across apps/vscode,
sdk/packages/{core,llms,shared}. Expected outcome: clean.

### `bun run lint`
Required for patch hygiene.

### `bun run test:unit`
Specifically:
  - sdk-tool-policies (F16 -- A/B/C/D/E/F/G1/G2/PRODUCTION REGRESSION)
  - sandbox-policy + command-job-manager (F4 source binding)
  - state-manager (settings round-trip; F7)
  - session-auto-approval (F16 session override path)
  - task-state-shadow-* (F20 diagnostic substrate)
  - host-ownership-capture + v2-capture (F20 capture codepath)

### F27 REGRESSION TEST (MANDATORY)
```
$ bun run test:unit -- src/sdk/__tests__/seatbelt-network-live-downstream-recon01.s0-red-shared-host-source-omitted.test.ts
```
The pre-existing test (added by ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01)
already exercises:
  - shared host factory forwards safeYoloCapabilitySource
  - persisted network=true -> CommandJobManager capability.network="allow"
  - cardinality: source called exactly once per command build
This test must be GREEN before any downstream live ACT binds to the merge.
Failure halts as HALT_SHARED_HOST_SOURCE_BINDING_LOST.

In this shell, vitest cannot be executed (the zod package is not installed
and the @cline/packages prepare script requires node). The test itself
is structurally correct -- see the static verification above. Operator
must run with a fully-installed bun/node toolchain.

## EXPECTED POST-MERGE OUTCOME

The 17-conflict merge in frozen risk order should result in:
  - 17 conflicts resolved (16 base-present + 1 add/add)
  - 38 AUTO_MERGE files (unchanged by merge; same content)
  - 4 SECURITY_CRITICAL files (state.proto, SdkController.ts,
    bash.ts, sdk-tool-policies.ts) semantically merged, NOT wholesale
  - All 27 frozen invariants (F1-F27) preserved (verified above for the
    structural ones; deferred for runtime ones)
  - 2 protected stashes preserved (F10)
  - factory/ + .factory/ substrate untouched (F1, F11) except the new
    ACT body + evidence

If the deferred gates surface new failures, halt as
HALT_UPSTREAM_SYNC_INTEGRATION_GATE_FAILED and reopen this ACT.
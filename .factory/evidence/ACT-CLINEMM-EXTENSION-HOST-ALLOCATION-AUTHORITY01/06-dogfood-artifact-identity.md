# Dogfood Artifact Identity — ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01

## Working tree (pre-commit)

```
$ git status --short
 M apps/vscode/src/extension.ts
 M apps/vscode/src/sdk/dogfood-diagnostic-profile.ts
 M apps/vscode/src/sdk/vscode-run-commands-tool.ts
?? .factory/evidence/ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01/
?? apps/vscode/src/sdk/__tests__/extension-host-allocation-authority01.allocauth01.test.ts
?? apps/vscode/src/sdk/extension-host-allocation-profiler-runtime.ts
?? apps/vscode/src/sdk/extension-host-allocation-profiler.ts
?? scripts/analyze-allocation-profile.mjs
?? scripts/inspector-smoke-probe.mjs
```

```
$ git rev-parse HEAD
5e9f67e75233af19d760e26535029cac4d2efa9e
```

## Source files (NEW)

| Path | Purpose |
| ---- | ------- |
| `apps/vscode/src/sdk/extension-host-allocation-profiler.ts` | Pure V8 allocation sampler module (state machine, inspector + filesystem + identity + data-root seams, async capture loop, checkpoint + finalize timers, hot-path-safe trigger) |
| `apps/vscode/src/sdk/extension-host-allocation-profiler-runtime.ts` | Production wiring (real `node:inspector.Session`, real `node:fs/promises`, real CLINE data root resolver, real identity resolver — installed_bundle_sha256 is the load-bearing identity per P1c fix; source_head_informational only) |
| `apps/vscode/src/sdk/__tests__/extension-host-allocation-authority01.allocauth01.test.ts` | Focused test suite (22 tests post HALT_ALLOCATION_FINALIZATION_BROKEN) |
| `scripts/analyze-allocation-profile.mjs` | Bounded SamplingHeapProfile analyzer |
| `scripts/inspector-smoke-probe.mjs` | Real-Node Inspector smoke probe (per ACT §23) |

## Source files (MODIFIED)

| Path | Change |
| ---- | ------ |
| `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` | Add `applyExtensionHostAllocationProfilerProfile(isDogfood, env)` activation helper |
| `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | Add single bounded trigger call at the marker-registration seam |
| `apps/vscode/src/extension.ts` | Add activation call (sibling to EHLOOP01) + conditional production-wiring |

## Production seam wiring (per ACT §4, §5)

```text
extension.ts:activate
   → applyExtensionHostAllocationProfilerProfile(isDogfood, env)
        → resolves "armed" iff isDogfood=true && CLINEMM_DIAG_ALLOCATION_PROFILE=<truthy>
   → if state === "armed": installExtensionHostAllocationProfilerRuntime()
        → wires real node:inspector.Session factory
        → wires real node:fs/promises filesystem seam
        → wires real CLINE data-root resolver (resolveDataDirFromEnv)
        → wires real identity resolver:
             * installed_bundle_sha256 (LOAD-BEARING; sha256 of dist/extension.js)
             * source_head_informational (git rev-parse HEAD at the runtime
               location; commonly "unknown" in an installed VSIX)

vscode-run-commands-tool.ts:754  (marker-registration seam)
   → if start.state === "running" && context.metadata?.notifyOnCompletion === true
        && options.backgroundNotifyCoordinator && options.resolveActiveOwner:
        → triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
            → ALWAYS returns synchronously; one-shot state-machine guard
            → spawns async capture loop:
                  HeapProfiler.enable
                  HeapProfiler.startSampling({
                      samplingInterval: 32768,
                      stackDepth: 128,
                      includeObjectsCollectedByMinorGC: true,
                      includeObjectsCollectedByMajorGC: true,
                  })
                  CHECKPOINT_INTERVAL_MS periodic getSamplingProfile
                  MAX_DURATION_MS stopSampling + final artifact
```

## Live-capture identity gate (per ACT §45)

The operator MUST build the dogfood VSIX from this tree, install it, and acquire a live capture BEFORE this ACT can be PASS_*-classified by a successor ACT. The expected identity binding chain:

```
DOGFOOD_SOURCE_HEAD   = 5e9f67e75233af19d760e26535029cac4d2efa9e + operator's commit
VSIX_VERSION          = 4.1.16 (apps/vscode/package.json:5)
VSIX_PATH             = dist/clinemm-4.1.16-<...>.vsix
VSIX_SHA256           = <TBD by operator>
extension.js size     = <TBD by operator>
extension.js SHA256   = <TBD by operator>
INSTALLED_EXT_PATH    = ~/.vscode/extensions/s1onique.clinemm-4.1.16-<...>/
INSTALLED_BUNDLE_SHA  = <must equal extension.js SHA256 above>
```

When the live capture is acquired, `meta.json` will record:

```json
{
  "source_head": "<5e9f67e75 + operator's commit>",
  "version": "4.1.16",
  "extension_path": "<installed extension path>",
  "extension_bundle_sha256": "<hash matching VSIX_SHA256>",
  "include_objects_collected_by_minor_gc": true,
  "include_objects_collected_by_major_gc": true,
  "checkpoint_interval_ms": 2000,
  "max_duration_ms": 60000
}
```

If the meta.json's `extension_bundle_sha256` does NOT match the VSIX_SHA256, the capture is INVALID (CAPTURE_INSUFFICIENT).

## Operator's build/install/capture procedure (per ACT §26-§29)

```bash
# 1. Confirm working tree is clean
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
git status --short
git rev-parse HEAD

# 2. Commit the ACT's instrumentation
git add apps/vscode/src/sdk/extension-host-allocation-profiler.ts \
        apps/vscode/src/sdk/extension-host-allocation-profiler-runtime.ts \
        apps/vscode/src/sdk/__tests__/extension-host-allocation-authority01.allocauth01.test.ts \
        apps/vscode/src/sdk/dogfood-diagnostic-profile.ts \
        apps/vscode/src/sdk/vscode-run-commands-tool.ts \
        apps/vscode/src/extension.ts
git commit -m "ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01: ..."

# 3. Build the dogfood VSIX
cd apps/vscode
bun run check-types
bun esbuild.mjs
mkdir -p "$ROOT/dist"
bun run package

# 4. Launch with the env knobs
export CLINEMM_RUNTIME_PROFILE=dogfood
export CLINEMM_PTAD=1
export CLINEMM_DIAG_ALLOCATION_PROFILE=1

# 5. Issue the qualifying workload:
#    > Run this command in the background and notify me when it finishes:
#    >   sh -c 'echo STARTED; sleep 30; echo FINISHED'

# 6. Inspect the artifacts:
ls -la ~/.cline/data/diagnostics/allocation-authority/
node scripts/analyze-allocation-profile.mjs \
    ~/.cline/data/diagnostics/allocation-authority/final-*.heapprofile.json 25
```

ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01 — Trigger Recon

## Trigger seam (frozen per ACT §6)

Reuse the SAME proven production seam used by the allocation profiler:

    vscode-run-commands-tool.ts : 754..765
    run_commands
      -> start.state === "running" && notifyRequested === true
      -> BackgroundNotifyCoordinator.registerMarker(...)
      -> sibling trigger call sites:
          triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()  // existing
          triggerExtensionHostCpuProfilerOnFirstQualifyingJob()          // NEW (this ACT)

Why this seam (per ACT §6):

    we care about the known reproducible failure window
    the failure is reproduced by a notify-enabled background command
    the seam is the production load-bearing hot path
    no command behavior changes (the trigger is observational)

## Activation (per ACT §35)

In extension.ts : activate(), sibling to the allocation profiler activation:

    applyExtensionHostCpuProfilerProfile(isDogfoodRuntime(process.env), process.env)
    if (getCpuProfilerState() === "armed") {
        installExtensionHostCpuProfilerRuntime()
    }

The activation helper lives at dogfood-diagnostic-profile.ts :

    applyExtensionHostCpuProfilerProfile(isDogfood, env):
        -> applyExtensionHostCpuProfilerPolicy(isDogfood, env)
        -> returns { enabled, flipped }

The runtime wiring lives at extension-host-cpu-profiler-runtime.ts :

    installExtensionHostCpuProfilerRuntime():
        setCpuProfilerInspectorSessionFactory(defaultInspectorSessionFactory)
        setCpuProfilerFilesystem(defaultFilesystem)
        setCpuProfilerDataRootResolver(defaultDataRootResolver)
        setCpuProfilerIdentityResolver(defaultIdentityResolver)

## Production call sites

| Site | Purpose | Line |
| ---- | ------- | ---- |
| `extension.ts : applyExtensionHostCpuProfilerProfile()` | arm at activation | post-ALLOCAUTH activation |
| `extension.ts : installExtensionHostCpuProfilerRuntime()` | wire seams (gated) | post-arm |
| `vscode-run-commands-tool.ts : triggerExtensionHostCpuProfilerOnFirstQualifyingJob()` | start on first notify-bg job | sibling to allocation trigger |
| `extension-host-cpu-profiler.ts : triggerExtensionHostCpuProfilerOnFirstQualifyingJob()` | sync hot-path-safe trigger | trigger entrypoint |
| `extension-host-cpu-profiler.ts : runCpuCaptureLoop()` | async rolling capture loop | background |

NO OTHER production call sites exist.

## Independence from allocation profiler

| Property | Allocation | CPU (this ACT) |
| -------- | ---------- | -------------- |
| Env knob | CLINEMM_DIAG_ALLOCATION_PROFILE | CLINEMM_DIAG_CPU_PROFILE |
| State machine | disabled/armed/starting/active/stopping/finalized/failed | disabled/armed/starting/active/rotating/finalized/failed |
| Trigger helper | triggerExtensionHostAllocationProfilerOnFirstQualifyingJob | triggerExtensionHostCpuProfilerOnFirstQualifyingJob |
| Activation helper | applyExtensionHostAllocationProfilerProfile | applyExtensionHostCpuProfilerProfile |
| Runtime wiring | installExtensionHostAllocationProfilerRuntime | installExtensionHostCpuProfilerRuntime |
| Artifact subdir | diagnostics/allocation-authority | diagnostics/cpu-profile |
| Capture kind | extension_host_allocation_sampling | extension_host_cpu_sampling_rolling |

The two profilers share:
- the dogfood gate (isDogfoodRuntime(process.env))
- the trigger seam (notify-enabled background command)
- the identity resolver (bundle SHA-256)
- the data-root resolver (resolveDataDirFromEnv)

The two profilers do NOT share:
- env knobs
- state machines
- capture loops
- artifact formats
- rotation policies

## Stacking guidance (per ACT §30)

First qualifying CPU run:

    CLINEMM_DIAG_CPU_PROFILE=1
    CLINEMM_DIAG_ALLOCATION_PROFILE unset

Reason: We already proved the crash happens without allocation profiling.
Avoid stacking two Inspector profilers in the same first causal specimen.

Later captures may compose both to correlate allocation + CPU evidence.

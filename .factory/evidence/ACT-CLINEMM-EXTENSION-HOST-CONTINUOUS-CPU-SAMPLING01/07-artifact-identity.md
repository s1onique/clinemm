ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01 — Artifact Identity

## Before build

    ENTRY_HEAD        = 7ecc521b24ec56de34e18e50b54ad5745dd3fd3f
    ENTRY_SUBJECT     = ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01-CORRECTION02

## Production diff (committed at end of this ACT)

    [NEW] apps/vscode/src/sdk/extension-host-cpu-profiler.ts                 (~955 lines)
    [NEW] apps/vscode/src/sdk/extension-host-cpu-profiler-runtime.ts          (~100 lines)
    [NEW] apps/vscode/src/sdk/__tests__/extension-host-continuous-cpu-sampling01.cpucap01.test.ts
                                                                              (~640 lines, 26 tests)
    [MOD] apps/vscode/src/sdk/dogfood-diagnostic-profile.ts
        + applyExtensionHostCpuProfilerProfile() activation helper
        + applyExtensionHostCpuProfilerPolicy import
    [MOD] apps/vscode/src/sdk/vscode-run-commands-tool.ts
        + triggerExtensionHostCpuProfilerOnFirstQualifyingJob() sibling trigger
        + import statement
    [MOD] apps/vscode/src/extension.ts
        + applyExtensionHostCpuProfilerProfile() activation call (sibling to ALLOCAUTH)
        + installExtensionHostCpuProfilerRuntime() wiring call (gated on armed)
        + getCpuProfilerState() / installExtensionHostCpuProfilerRuntime() imports
    [NEW] scripts/inspector-cpu-smoke-probe.mjs                              (real Node smoke probe)
    [NEW] scripts/analyze-cpu-profile.mjs                                    (rolling-segment analyzer)

## Production build identity

The VSIX build is the OPERATOR's manual step after this ACT closes (per
ACT §26-§29 / §39). The ACT does NOT require a successful VSIX build at
closure. The production diff committed at HEAD is the load-bearing artifact.

When the operator builds the dogfood VSIX, the following identity MUST be
verified:

    SOURCE_HEAD                 = <git rev-parse HEAD at operator time>
    VSIX path                   = apps/vscode/dist/clinemm-*.vsix
    VSIX size                   = ~14-15 MB (depends on webview assets)
    VSIX SHA256                 = <freshly computed>
    packaged extension.js size  = ~54 MB (esbuild bundle)
    packaged extension.js SHA   = 2d0b8d1f5d281d192b7e87a11983e153a8e2585367d115ff667a77dbb7034a5f
                                  (rebuild before dogfood install — this SHA was captured during ACT)
    installed version          = 4.1.16
    installed bundle SHA256     = <recomputed on operator's host via resolveInstalledBundleIdentity()>

Identity invariant for any future LIVE capture:

    packaged_extension_sha == installed_extension_sha == meta.installed_bundle_sha256
    Otherwise: CAPTURE_INSUFFICIENT.

## Identity-binding helper

apps/vscode/src/sdk/extension-host-allocation-profiler-runtime.ts exports:

    resolveInstalledBundleIdentity(bundleDirname: string): {
        sourceHead: string
        extensionPath: string
        extensionBundleSha256: string
    }

This helper is REUSED by both the allocation profiler and the CPU profiler
runtime wiring (per ACT §35 / production-file guidance). The P0 two-ascent
bug fix (corrected_path_2026-09-23) was applied to this helper, ensuring
the CPU profiler's identity binding is mechanically provable from a fixture.

## Do NOT predict future SHA

The SHA above was captured during the ACT's esbuild rebuild. It is NOT a
prediction. When the operator rebuilds, the SHA will change; the new value
MUST be captured and recorded in 08-live-capture.md.

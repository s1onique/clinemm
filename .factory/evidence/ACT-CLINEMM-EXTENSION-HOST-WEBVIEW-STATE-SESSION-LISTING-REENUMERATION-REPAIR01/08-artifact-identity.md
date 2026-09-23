# Artifact Identity — ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01

## Production change scope

The entire production diff is two adjacent edits in a single file:

```
apps/vscode/src/sdk/sdk-task-history.ts
  - line 211 (was metadataHistoryCacheTtlMs = 10_000):
    + private readonly metadataHistoryCacheSafetyTtlMs = 5 * 60 * 1_000
    + 12-line comment explaining the safety-bound semantics
  - line 408: rename reference to metadataHistoryCacheSafetyTtlMs
```

Plus one new test file:

```
apps/vscode/src/sdk/__tests__/webview-state-session-listing-reenumeration-repair01.wvsl01.test.ts
  - 10 test cases (RED, GREEN, CTL, ADV, ABLATION)
  - 200 LOC (test harness + helpers + tests)
```

No new VSIX build is required for this ACT. The production change
is a constant lift and a single field rename — both visible to the
existing bundling pipeline. The next dogfood capture can be taken
from the existing installed build after the change is committed and
the dev/build cycle runs.

## Source HEAD

```
HEAD (entry):    2a18ccea1  ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01
                 HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN bounded correction
HEAD (post):     (this commit — see git log below)
```

## SHA-256 bindings

Per ACT §27 the binding is to the source HEAD, the installed extension
SHA-256, and the VSIX SHA-256. This ACT did not run a fresh
build/install/capture cycle (LIVE_NOT_EXECUTED), so the binding is
incomplete:

```
SOURCE_HEAD                       = (this commit, see git log)
VERSION                           = 4.1.16 (predecessor; no version bump needed)
VSIX_SHA256                       = not regenerated in this ACT
PACKAGED_EXTENSION_SHA256         = not regenerated in this ACT
INSTALLED_EXTENSION_SHA256        = not regenerated in this ACT
```

## Conservation check

The change is bounded by construction:
- Constant rename: trivially scoped to SdkTaskHistory
- Cache-hit predicate: trivially scoped to SdkTaskHistory.listHistory
- Comment: documentation, no semantic effect

No transport, protocol, persistence, or session-listing
semantics were touched. The cache's external contract
("cache is reused across webview flushes that don't mutate
the projected list") is preserved.

## Followup requirement

To bind this ACT to a fresh VSIX/SHA chain, run:

```bash
cd apps/vscode
bun run protos
bun run check-types
bun esbuild.mjs
mkdir -p "$ROOT/dist"
bunx @vscode/vsce package --out dist/clinemm-4.1.16-wvsl01.vsix
sha256sum dist/clinemm-4.1.16-wvsl01.vsix
# install and run the qualified workload
```

Then capture the `*.meta.json` and `*.heapprofile.json` and bind them
to this ACT directory.

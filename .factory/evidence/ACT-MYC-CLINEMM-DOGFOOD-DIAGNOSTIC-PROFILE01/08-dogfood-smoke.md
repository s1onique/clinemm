# ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01 — Dogfood smoke (deferred)

## What this ACT verifies structurally

The dogfood smoke (ACT §34) — `codium-clinemm --no-shell-env`, then
verify runtime state and capture files — requires a live VS Code
extension host. The dev environment for this ACT does not have a
running Codium + globalStorage + LLM credentials combo, so the
end-to-end smoke is **deferred to ACT-MYC-CLINEMM04-LIVE-QUALIFICATION**.

## What is structurally proven

The deterministic code paths prove the equivalent state without a
live editor:

1. **Identity resolution** (`resolveClineMmRuntimeProfile`):
   - `CLINEMM_RUNTIME_PROFILE=dogfood` → `"dogfood"`
   - `CLINEMM_RUNTIME_PROFILE` unset or `"public"` → `"public"`
   - Tests in `dogfood-runtime-profile.test.ts` (4 cases) pass.

2. **Diagnostic profile activation order** (AC1):
   - `extension.ts:activate` runs `applyMycPrimeLiveDiagDiagnosticProfile`
     BEFORE `SdkController` construction.
   - `applyMycPrimeLiveDiagDiagnosticProfile` calls
     `setMycPrimeLiveDiagEnabled(true)` on the production activation
     path.
   - `applyProviderRequestCaptureDiagnosticProfile` runs immediately
     after; it sets `CLINE_CAPTURE_PROVIDER_REQUEST=full` and
     `CLINE_DATA_DIR=<globalStorageUri.fsPath>`.
   - Tests AC1, AC3 in `dogfood-diagnostic-profile-myc-clinemm01.test.ts`
     pass.

3. **Disabled-state conservation** (AC2):
   - Public + no env: zero env mutations, zero recorder state writes.
   - Test AC2 passes.

4. **Effective defaults** (dogfood integration AC3):
   - `mycPrimeLiveDiag = true` (module boolean set)
   - `providerRequestCapture = "full"` (env var set)
   - `providerWireCapture = false` (upstream default, no write)
   - `cleanup = "on"` (upstream default, no write)
   - `dataDir = <globalStorageUri.fsPath>/provider-request-captures`
   - Test AC3 passes.

## What the dogfood smoke at LIVE04 will verify

When ACT-MYC-CLINEMM04-LIVE-QUALIFICATION runs:

```bash
# No env vars. Just the dogfood launcher.
codium-clinemm
# In Codium:
#   1. Start a fresh task.
#   2. Observe mycPrimeLiveDiag -> {enabled: true, source: "profile"}
#   3. Observe <globalStorage>/provider-request-captures/ has files.
#   4. Inspect the files: captureStage=ai_sdk_prompt, mode=full.
```

This ACT guarantees that the `codium-clinemm` launcher (which sets
only `CLINEMM_RUNTIME_PROFILE=dogfood`) produces all of the above
without the operator setting any other env var.

## Pre-flight checklist (manual verification on dev box)

```bash
# 1. Confirm identity resolver
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
CLINEMM_RUNTIME_PROFILE=dogfood node -e "
  const { resolveClineMmRuntimeProfile } = require('./apps/vscode/out/src/sdk/dogfood-runtime-profile.js')
  console.log(resolveClineMmRuntimeProfile())  // 'dogfood'
"

# 2. Confirm central profile activation
CLINEMM_RUNTIME_PROFILE=dogfood node -e "
  const { applyMycPrimeLiveDiagDiagnosticProfile, applyProviderRequestCaptureDiagnosticProfile, isMycPrimeLiveDiagEnabled } = require('./apps/vscode/out/src/sdk/dogfood-diagnostic-profile.js')
  applyMycPrimeLiveDiagDiagnosticProfile(true, process.env)
  applyProviderRequestCaptureDiagnosticProfile(true, process.env, '/tmp/fake-globalstorage')
  console.log({ mycEnabled: isMycPrimeLiveDiagEnabled(), captureRequest: process.env.CLINE_CAPTURE_PROVIDER_REQUEST, dataDir: process.env.CLINE_DATA_DIR })
  // { mycEnabled: true, captureRequest: 'full', dataDir: '/tmp/fake-globalstorage' }
"
```

(Requires `bun esbuild.mjs` first to produce `out/`.)

## Deferred checks

The dogfood smoke and capture-file verification (§34, §35, §36)
are deferred to ACT-MYC-CLINEMM04-LIVE-QUALIFICATION. This ACT only
makes the necessary evidence substrate available automatically;
the actual capture of a real task and inspection of files is the
next ACT's responsibility.

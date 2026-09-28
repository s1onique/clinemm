# ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01 — Recon

## Existing seams (frozen, untouched by this ACT)

```
DOGFOOD_IDENTITY_RESOLVER  = apps/vscode/src/sdk/dogfood-runtime-profile.ts
DOGFOOD_DIAGNOSTIC_PROFILE_RESOLVER = apps/vscode/src/sdk/dogfood-diagnostic-profile.ts
DOGFOOD_DIAGNOSTIC_ACTIVATION_SEAM  = apps/vscode/src/extension.ts:activate (line ~109)
```

## MYC_DIAG_ENABLE_READ_SEAM

```
module: apps/vscode/src/sdk/myc-prime-live-diag.ts
function: isMycPrimeLiveDiagEnabled() : boolean
env: process.env.CLINEMM_MYC_PRIME_DIAG (literal "1" only)
no module-level setter (recorder re-reads env on every call)
```

## PROVIDER_CAPTURE_READ_SEAM

```
module: sdk/packages/llms/src/providers/provider-request-capture.ts
function: readCaptureMode(), isWireCaptureEnabled(), isCleanupEnabled(),
          resolveCaptureDir() — all read process.env directly
env vars:
  CLINE_CAPTURE_PROVIDER_REQUEST  (off|summary|full)  default off
  CLINE_CAPTURE_WIRE              (true|false)        default false
  CLINE_CAPTURE_DIR               (custom dir)        default undefined
  CLINE_CAPTURE_CLEANUP           (off = disable)     default on (24h prune)
  CLINE_CAPTURE_MAX_PREVIEW_BYTES (number)            default 65536
  CLINE_DATA_DIR                  (fallback parent)   default undefined
no typed setter — the upstream is env-only.
```

## Provider coverage

```
PROVIDER_CAPTURE_COVERAGE = only providers routed through
                            createAiSdkProvider(...) currently
                            (openai, cline, openai-compatible, anthropic,
                             google, vertex, bedrock, mistral, claude-code,
                             openai-codex, opencode, dify, ollama, sapaicore)
```

## Capture dir resolution authority

```
PROVIDER_CAPTURE_ROOT default = <CLINE_CAPTURE_DIR> or
                               <CLINE_DATA_DIR>/provider-request-captures
                               (returns undefined if neither is set — no
                                accidental repo writes)
```

## Recon decisions

### Q1: Precedence parser — keep `"1"` literal or align with central TRUTHY_ENABLE?
**Decision:** Align with central profile parser (`decideKnob`-style). Both
`"1"/"true"/"yes"` enable, both `"0"/"off"/"false"` disable. This:
- keeps one truthy/falsy parser across all dogfood diagnostics
- preserves explicit operator opt-in
- explicit OFF in dogfood overrides the auto-ON default
- explicit ON in public is fail-closed (matches decideKnob invariant)

### Q2: Option A (typed setter in provider capture) vs Option B (env adapter)?
**Decision:** Option B (bounded compatibility adapter). Provider capture exposes
ONLY env-backed configuration at HEAD. Modifying upstream provider code is
forbidden by ACT §32. The activation helper populates `process.env` ONCE at
extension activation; subsequent recorder hot-path reads observe the
already-populated env. Idempotent, fail-closed, explicit operator values win.

### Q3: PROVIDER_CAPTURE_ROOT in dogfood
**Decision:** Set `CLINE_DATA_DIR` to the extension-owned
`context.globalStorageUri.fsPath` (the same authority the central
`configureDogfoodCaptureStorage` uses for V2 capture). Resulting capture path:
`<globalStorageUri>/provider-request-captures/`. This:
- never writes into the repository
- stays under VS Code's canonical writable tree
- mirrors the proven CORRECTION02 sink pattern

### Q4: Myc diag seam module-level boolean
**Decision:** Add `setMycPrimeLiveDiagEnabled(enabled)` + the existing
`isMycPrimeLiveDiagEnabled()` reads the module-level boolean first, falls
through to env. Activation calls the setter ONCE. Recorder hot-path does not
re-read env. This mirrors the BJLA / BOCOR / CCARD pattern.

### Q5: Where does the central resolver live?
**Decision:** Add to `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`
(same file as `decideKnob`, the VIAPD knobs, BJLA, BOCOR, CCARD, EHLOOP,
ALLOCATION, CPU, TERMINATION). No new module — the file is already the
single central dogfood profile authority.

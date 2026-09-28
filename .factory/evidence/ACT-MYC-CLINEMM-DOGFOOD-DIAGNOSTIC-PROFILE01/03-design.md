# ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01 — Design

## High-level shape

The ACT extends the existing central dogfood diagnostic profile
(`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`) with two new
diagnostic knobs:

- **M (mycPrimeLiveDiag)** — the existing ACT-03 forensic scaffold
  (`myc-prime-live-diag.ts`) becomes profile-aware: dogfood
  defaults to ON, public defaults to OFF, explicit env override
  always wins.
- **R (providerRequestCapture)** — the existing upstream provider
  capture (`sdk/packages/llms/src/providers/provider-request-capture.ts`)
  becomes dogfood-default-ON via a bounded env adapter.

No new module is introduced. The activation seams are added to
`extension.ts:activate` next to the existing BJLA / BOCOR / CCARD
activations.

## File 1: `apps/vscode/src/sdk/myc-prime-live-diag.ts`

The seam authority moves from per-recorder `process.env` reads to
a module-level boolean:

```ts
let mycPrimeLiveDiagEnabled: boolean | null = null

export function isMycPrimeLiveDiagEnabled(): boolean {
  if (mycPrimeLiveDiagEnabled !== null) return mycPrimeLiveDiagEnabled
  // fallback path for legacy direct callers:
  return process.env.CLINEMM_MYC_PRIME_DIAG?.trim().toLowerCase() === "1"
}

export function setMycPrimeLiveDiagEnabled(enabled: boolean): void {
  mycPrimeLiveDiagEnabled = enabled
}

export function __resetMycPrimeLiveDiagForTests(): void {
  mycPrimeLiveDiagEnabled = null
  liveDiagBySessionId.clear()
}
```

The original ACT-03 read `process.env.CLINEMM_MYC_PRIME_DIAG` on
every recorder call. The cost is trivial but the pattern repeats
across 4 observation points and the seam authority is scattered.
The new pattern mirrors BJLA / BOCOR / CCARD: the central profile
calls `setMycPrimeLiveDiagEnabled` ONCE at extension activation;
the recorder hot path reads a single boolean.

## Disabled-state conservation

When OFF:
- `if (!isMycPrimeLiveDiagEnabled()) return` short-circuits each
  recorder before any state write — zero allocations, zero
  `Date.now()`, zero `Map.set`.
- `getMycPrimeLiveDiag` returns `undefined` directly.
- The prime-recorder singleton in `myc-prime-automation.ts` is
  untouched.
- The per-session injection tracker in `hooks-adapter.ts` is
  untouched.

## Backward compat

The env fallback (`=1` literal) is preserved. Direct callers of
the recorder helpers — including legacy tests that set
`process.env.CLINEMM_MYC_PRIME_DIAG=1` without going through the
profile — still work. Production code paths go through the
central profile and never hit the fallback.

## File 2: `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`

### New resolvers

```ts
export function resolveEffectiveMycPrimeLiveDiag(env, isDogfood)
  -> { enabled, source: "env" | "profile" }

export function resolveEffectiveProviderRequestCapture(env, isDogfood, dataDir)
  -> {
       captureMode: "off" | "summary" | "full",
       wireCapture: boolean,
       cleanup: "on" | "off",
       source: { captureMode, wireCapture, cleanup },
       dataDir: string | null,
     }
```

### New activation helpers

```ts
export function applyMycPrimeLiveDiagDiagnosticProfile(isDogfood, env)
  -> { enabled, flipped }
  // Calls setMycPrimeLiveDiagEnabled(resolved.enabled) ONCE.
  // Idempotent. No env mutation. No per-call hot-path read.

export function applyProviderRequestCaptureDiagnosticProfile(isDogfood, env, dataDir)
  -> { captureMode, wireCapture, cleanup, dataDir, flipped }
  // Bounded env adapter:
  //   - Writes ONLY values that differ from upstream defaults.
  //   - In dogfood, writes CLINE_CAPTURE_PROVIDER_REQUEST=full and
  //     CLINE_DATA_DIR=<dataDir> (if operator did not set them).
  //   - Never writes CLINE_CAPTURE_WIRE or CLINE_CAPTURE_CLEANUP
  //     (upstream defaults already match).
  //   - Public installs mutate NO env vars.
  // Idempotent.
```

### Frozen dogfood defaults

```ts
DOGFOOD_PROVIDER_CAPTURE_MODE_DEFAULT = "full"
DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT = false
DOGFOOD_PROVIDER_CAPTURE_CLEANUP_DEFAULT = "on"
```

These are exported constants so tests can pin the contract.

### Why bounded env adapter (Option B) instead of a typed setter

Upstream `sdk/packages/llms/src/providers/provider-request-capture.ts`
exposes ONLY env-backed configuration at HEAD. ACT §32 forbids
modifying upstream. The bounded env adapter is the narrowest change
that gives dogfood default-ON without changing upstream:

- one activation pass,
- no per-request env mutation,
- explicit operator values win (resolver checks env first),
- public runtime untouched (zero env writes).

## File 3: `apps/vscode/src/extension.ts`

Added two activation calls right after
`configureDogfoodCaptureStorage(context.globalStorageUri.fsPath)`:

```ts
applyMycPrimeLiveDiagDiagnosticProfile(
  isDogfoodRuntime(process.env),
  process.env,
)

applyProviderRequestCaptureDiagnosticProfile(
  isDogfoodRuntime(process.env),
  process.env,
  context.globalStorageUri.fsPath,
)
```

Both calls happen BEFORE `SdkController` construction, mirroring
the existing BJLA / BOCOR / CCARD pattern.

## Capture root authority

```text
PROVIDER_CAPTURE_ROOT = <context.globalStorageUri.fsPath>/provider-request-captures
```

The same `globalStorageUri` authority that `configureDogfoodCaptureStorage`
uses for the V2 capture sink (CORRECTION02). Never inside the
repository. Never `/tmp/clinemm-live04-capture`.

## Producer coverage limitation

Only providers routed through `createAiSdkProvider(...)` currently
emit provider-request captures. This is the upstream contract; this
ACT does not modify provider coverage.

## Public conservation

When `CLINEMM_RUNTIME_PROFILE` is unset OR not `"dogfood"`:
- `applyMycPrimeLiveDiagDiagnosticProfile(false, ...)` calls
  `setMycPrimeLiveDiagEnabled(false)`.
- `applyProviderRequestCaptureDiagnosticProfile(false, ...)`
  mutates ZERO env vars.
- The myc recorder hot path short-circuits on `enabled=false`.
- The upstream provider-capture recorder observes its default
  `off` mode and writes no files.

Zero provider-capture files. Zero diagnostic state writes to
disk. Zero log lines. This is the load-bearing public safety
invariant.

## Idempotence

Calling `applyMycPrimeLiveDiagDiagnosticProfile(dogfood)` twice
in a row produces `flipped=false` on the second call (no second
setter invocation). Same for the provider capture helper.

The provider capture helper additionally checks each env var
individually before writing — if the env already matches the
effective value, no write happens.

## What did NOT change

- `sdk/packages/llms/src/providers/provider-request-capture.ts`
  (forbidden by ACT §32)
- `hooks-adapter.ts` (uses `isMycPrimeLiveDiagEnabled()`, which
  is backward-compatible)
- `myc-prime-automation.ts` (forensic recorder singleton is
  untouched)
- Any public settings, proto fields, command palette items,
  or `ExtensionState` fields (ACT §22)
- `TaskHeader` counters (the M knob is forensic, not telemetry)


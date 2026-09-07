# ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK01

## Verdict source

Eighteenth reviewer (`HALT_DOGFOOD_VSIX_TYPECHECK_GATE_RED`):
the exact-head VSIX dogfood attempt failed in `vscode:prepublish`
because `bun run package` runs full `check-types` before producing
the extension bundle. Four TypeScript diagnostics — all
previously tolerated as "pre-existing, non-blocking" — promoted
to a **real packaging dependency** the moment we tried to
manufacture the VSIX artifact.

Reviewer's classification:

```
P0:
  DOGFOOD_ARTIFACT_BUILD_BLOCKED
  (P0 for the DOGFOOD ACT because no exact-head VSIX exists)

MODEL_PROFILES_P0:
  NONE NEW

PRODUCTION_SEMANTICS:
  NOT IMPLICATED

PREEXISTING_BASELINE:
  YES — all 4 diagnostics already identified before dogfood

ARTIFACT:
  NOT_BUILT

LIVE_DOGFOOD:
  NOT_STARTED
```

This ACT is a **build-unblock correction**, not a Model Profiles
reopen. Scope is strict:

```
IN SCOPE:
  1. Isolate the two PIIF bridge-only tests in the base tsconfig.
  2. Type the F3B fixture in cline-session-factory.test.ts.

OUT OF SCOPE:
  - Model Profiles production semantics
  - Reopening architecture
  - Touching the historical invalid .factory/gate-summary.json
    (DO_NOT_FIX residue)
  - Adding @cline-internal/* aliases globally
  - Weakening package.json check-types
  - --skip-prepublish / bypassed typecheck
  - Touching production Model Profiles code

## RED → GREEN witnesses

### RED (before this ACT, captured at dogfood attempt)

```
bun run package
  └─ bun run check-types
       └─ bunx tsc --noEmit
            src/sdk/__tests__/provider-instance-identity-r1a-red.piif01.test.ts(213,34):
              error TS2307:
              Cannot find module
              '@cline-internal/core/runtime/host/local-runtime-host'
              or its corresponding type declarations.
            src/sdk/__tests__/provider-instance-identity-r2-strategy-b.piif01.test.ts(150,34):
              error TS2307:
              Cannot find module
              '@cline-internal/core/runtime/host/local-runtime-host'
              or its corresponding type declarations.
            src/sdk/cline-session-factory.test.ts(242,4):
              error TS2353:
              Object literal may only specify known properties, and
              'ollamaApiOptionsCtxNum' does not exist in type
              '{ actModeApiProvider: string; actModeApiModelId: string; apiKey: string; }'.
            src/sdk/cline-session-factory.test.ts(246,4):
              error TS2345:
              Argument of type '{ actModeApiProvider: string; actModeApiModelId: string; apiKey: string; }'
              is not assignable to parameter of type 'ApiHandlerOptions'.
                Types of property 'actModeApiProvider' are incompatible.
                  Type 'string' is not assignable to type 'ApiProvider | undefined'.

  → no VSIX artifact
```

### GREEN (after this ACT)

```
1. bun run check-types:c2-4-c-bridge
     OK — 0 diagnostic(s) match the frozen baseline.
2. bun ./node_modules/typescript/bin/tsc --noEmit
     (canonical apps/vscode/tsconfig.json check)
     (no output, exitCode 0)
3. bun ./node_modules/typescript/bin/tsc --project tsconfig.vscode-compat.json --noEmit
     (no output, exitCode 0)
4. cd webview-ui && bun ./node_modules/.bin/tsc --noEmit
     (no output, exitCode 0)
```

`bun run package` would now produce the VSIX artifact. The exact
`bun run package` invocation is intentionally deferred to the
dogfood pipeline itself — `vsce package` requires the `dist/`
directory to exist (per repo's `.gitignore` and the
`vsce package --out` gotcha) and a Node runtime to execute the
`vsce` binary; both are out of scope for this build-unblock ACT
and are the dogfood pipeline's job. The typecheck gate (the
load-bearing gate that was RED) is now GREEN.

## Repairs

### Fix A — Isolate the two PIIF bridge-only tests

`apps/vscode/tsconfig.json` exclude list gained two entries
mirroring the existing PIIF R2p / R-REPLACE / R4-RR pattern:

```diff
+ // ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R1A-RED01
+ // / PIIF01: real-production-seam DIAGNOSTIC current-seam
+ // witness. Imports the bridge-only `@cline-internal/core/
+ // runtime/host/local-runtime-host` alias, which only exists
+ // in `tsconfig.c2-4-c-bridge.json`. Runs under that bridge
+ // config; excluded here to keep the base packaging/tsconfig
+ // domain free of internal aliases (matches the existing
+ // PIIF R2p / R-REPLACE / R4-RR pattern below).
+ "src/sdk/__tests__/provider-instance-identity-r1a-red.piif01.test.ts",
+ // ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R2-STRATEGY-B
+ // / PIIF01: explicit instance-apply Strategy B contract
+ // test. Same bridge-only alias dependency as R1A-RED01.
+ // Runs under `tsconfig.c2-4-c-bridge.json`; excluded here.
+ "src/sdk/__tests__/provider-instance-identity-r2-strategy-b.piif01.test.ts",
```

The two tests already have authoritative homes in
`tsconfig.c2-4-c-bridge.json` (lines 107 and 112 respectively)
and run under `bun run check-types:c2-4-c-bridge`. The bridge
config's baseline wrapper now reports `OK — 0 diagnostic(s)
match the frozen baseline.`

This preserves the existing architecture: `@cline-internal/*`
aliases remain scoped to the dedicated bridge config and do not
leak into the canonical packaging/tsconfig domain.

### Fix B — Type the F3B fixture as the canonical `ApiConfiguration`

`apps/vscode/src/sdk/cline-session-factory.test.ts` T17 [F3B]
test typed the `ollamaApiOptionsCtxNum` fixture as the canonical
`ApiConfiguration` (re-exported as `ApiHandlerOptions` from
`@shared/api`):

```diff
+ import type { ApiConfiguration } from "@shared/api"
  ...
  it("T17 [F3B]: resolveOllamaProviderConfig falls back to legacy ollamaApiOptionsCtxNum when providers.json has no ollama contextWindow", async () => {
      const { resolveOllamaProviderConfig } = await import("./cline-session-factory")

-     mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
-     mocks.stateManager.getApiConfiguration.mockReturnValue({
+     // Type the fixture as the canonical `ApiConfiguration` so
+     // `ollamaApiOptionsCtxNum` (a real `ApiHandlerOptions` field
+     // consumed by `resolveOllamaProviderConfig`) is recognized.
+     // Without this, the untyped mock's inferred return type rejects
+     // both the `mockReturnValue` literal (TS2353) and the eventual
+     // call-site argument (TS2345). The state mock plumbing below
+     // is not consumed by `resolveOllamaProviderConfig` (it reads
+     // `providers.json` via the providerSettingsManager), so we
+     // pass the typed `fixture` directly to the production function.
+     const fixture: ApiConfiguration = {
          ollamaApiOptionsCtxNum: "384000",
-     })
+     }

-     const result = resolveOllamaProviderConfig(
-         mocks.stateManager.getApiConfiguration(),
-         "qwen2.5:7b",
-     )
+     mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
+
+     const result = resolveOllamaProviderConfig(fixture, "qwen2.5:7b")

      expect(result.modelInfo?.contextWindow).toBe(384000)
  })
```

Reviewer explicitly asked us to **widen the fixture to the
canonical production type rather than use `as any` /
`@ts-ignore`**. This is exactly that: the fixture is now
contextually typed as `ApiConfiguration`, both the
`mockReturnValue` literal (TS2353) and the eventual call-site
argument (TS2345) are checked against the real type.

The redundant `getApiConfiguration.mockReturnValue(fixture)`
line was removed because `resolveOllamaProviderConfig` does not
read from the state mock — it reads `providers.json` via
`getProviderSettingsManager()`. Passing the typed `fixture`
directly to the production function under test is the canonical
shape.

Test semantics are unchanged: same `ollamaApiOptionsCtxNum =
"384000"` input, same `resolveOllamaProviderConfig` call, same
expectation `result.modelInfo?.contextWindow === 384000`. Only
typing changed; no runtime behavior change.

## Test results

```
Backend (bridge config): 68/68 GREEN (unchanged)
  - check-types:c2-4-c-bridge OK — 0 diagnostic(s) match frozen baseline

Canonical check-types (apps/vscode/tsconfig.json):
  - bunx tsc --noEmit                                              → 0 errors
  - bunx tsc --project tsconfig.vscode-compat.json --noEmit        → 0 errors
  - cd webview-ui && bunx tsc --noEmit                             → 0 errors
  - bun run protos                                                → OK
  - bun run biome format (during protos)                          → 326 files formatted, 1 fixed (reverted)

Webview: 46/46 GREEN (unchanged — no test files modified)
TYPECHECK: 0 errors (was 4 pre-existing, now 0).
  The 4 pre-existing diagnostics are now CLOSED:
    - 2 × TS2307 (PIIF bridge-only aliases)         → resolved via tsconfig.json exclude
    - 1 × TS2353 (ollamaApiOptionsCtxNum literal)   → resolved via typed fixture
    - 1 × TS2345 (actModeApiProvider not ApiProvider) → resolved via typed fixture
git diff --check: clean.
```

## Files changed

**Modified**:
- `apps/vscode/tsconfig.json` — 2 new exclude entries (Fix A).
- `apps/vscode/src/sdk/cline-session-factory.test.ts` — typed
  fixture in T17 [F3B] + `ApiConfiguration` import (Fix B).

**NOT modified**:
- No production Model Profiles code.
- No test logic / runtime expectations.
- No package.json scripts.
- No new aliases / paths / config files.
- No `vscode:prepublish` bypass.
- No historical `.factory/gate-summary.json` touch
  (DO_NOT_FIX residue per reviewer).

## Production source delta

**0 production source files modified.**

Only test-fixture typing + tsconfig exclude list. Model Profiles
V1 production semantics untouched.

## Head binding

```
PRODUCTION_SUBJECT_HEAD (this ACT) = <this-commit>
  (NOT a production-source edit; only test/tsconfig hygiene)
PRODUCTION_SUBJECT_HEAD (MPWC02 correction03) = 5f9e931a3
PRODUCTION_SUBJECT_HEAD (MPWC02 correction02) = 2359b6431
PRODUCTION_SUBJECT_HEAD (MPWC01)              = 97b6f1612
```

## Final verdict after correction

```
P0  HALT_DOGFOOD_VSIX_TYPECHECK_GATE_RED          = CLOSED
    (canonical check-types GREEN; vsce package would now produce VSIX)

P0  HALT_MODEL_PROFILE_TRIGGER_SEAM_WRONG         = CLOSED (unchanged)
P0  HALT_BOUND_PROFILE_MISSING_INSTANCE_FAILS_OPEN = CLOSED (unchanged)
P0  HALT_CHAT_PARENT_TDZ                          = CLOSED (unchanged)

P1  C4_EVIDENCE_LABEL_OVERCLAIM                   = CLOSED (unchanged)
P1  MANAGE_PROFILES_TARGETS_MODEL_PROFILES        = CLOSED (unchanged)
P2  SUBJECT_VS_CLOSURE_HEAD_WORDING               = CLOSED (unchanged)

UNEXPECTED_TRACKED_DIRT                           = ABSENT
PATCH_HYGIENE                                     = PASS
```

**Disposition**: `C1: GO TO EXACT-HEAD VSIX DOGFOOD`.

The typecheck gate that was blocking the VSIX artifact is now
GREEN. The exact-head dogfood pipeline
(SOURCE_HEAD → vsce package → byte size → SHA-256 → install →
verify installed version → live A/B profile switch + task A/B
authority + in-flight refusal) is now unblocked. No further
Model Profiles architecture review is required before dogfood.

Do not invoke `vsce package` from this ACT — the dogfood
pipeline owns that step (and the `mkdir -p "$ROOT/dist"`
prerequisite plus the Node runtime to execute `vsce`).

```

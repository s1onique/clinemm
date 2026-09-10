# ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01

## Title
Repair the live P0 failure where "Use" on a non-default model profile routes MiniMax
requests to the wrong regional endpoint and returns `405 Method Not Allowed`, while
"Set as default + new task" appears to work because of legacy-state coincidence.

## Status
GREEN. Typecheck passes. All 5 new conservation tests pass. 119/119 SDK+profile+instance+bootstrap
tests pass (excluding 3 pre-existing bridge-config failures unrelated to this fix).

## GATE 0 — Identity
- ENTRY_HEAD: `ab0531bb41fe0710a4670cd0c4cf8ed9f96fdf69`
- WORKTREE: clean at start; 3 commits ahead of origin/main (CORRECTION09-FIXUP bootstrap+capture closure preserved)
- PRODUCTION_FOUNDATION_HEAD: `ab0531bb41fe0710a4670cd0c4cf8ed9f96fdf69`
- FAILURE: L-C08-2 (Use profile -> 405 Method Not Allowed)
- INFERRED_HYPOTHESIS at gate-in: `applyTypedProviderInstanceToConfig` writes `cfg.apiLine`
  (top-level) but NOT `cfg.providerConfig.apiLine`; the `@cline/core` gateway reads `apiLine`
  from `providerConfig.apiLine` via `buildGatewayProviderOptions`, so the typed instance's
  `apiLine` never reaches the runtime's regional routing decision.
- Evidence file: `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/00-entry-freeze.txt`

## GATE 1 — Production-seam Recon
Traced the live path: `applyModelProfile` -> `applyTypedProviderConfigurationInstance` ->
`sessionConfigBuilder.build` -> `buildSessionConfig` -> `applyTypedProviderInstanceToConfig` ->
`replaceActiveSession` -> `sdkHost.start` -> `createAgentModelFromConfig` ->
`buildGatewayProviderOptions` -> gateway.

Key boundary: `sdk/packages/core/src/services/llms/handler-factory.ts:40` reads `apiLine` from
`config.providerConfig.apiLine`, NOT top-level `config.apiLine`.

Root cause: `applyTypedProviderInstanceToConfig`
(`apps/vscode/src/sdk/instance-store/typed-projector.ts`) writes only top-level
`cfg.apiLine`, never touches `cfg.providerConfig.{providerId, modelId, apiLine, region}` —
which `buildSessionConfig` pre-populates from LEGACY state via `resolveApiLine` at
`apps/vscode/src/sdk/cline-session-factory.ts:810-848`.

Evidence file: `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/01-recon-production-seam.txt`

## GATE 2 — RED Witness
Wrote RED test: `apps/vscode/src/sdk/__tests__/use-profile-apiline-runtime-routing.mpfrb01-test-apply-live01.test.ts`

`MPULA01_RED` asserts that `applyTypedProviderInstanceToConfig` overlays the typed
instance's `connection.apiLine` onto `config.providerConfig.apiLine`. With the pre-fix
typed projector, this assertion fails (`Expected "international", Received "china"`).

The RED state is the live bug: the runtime was reading the stale LEGACY
`providerConfig.apiLine` while the top-level `cfg.apiLine` showed the typed value.

## GATE 3 — Repair Decision
Extend `applyTypedProviderInstanceToConfig` to ALSO overlay typed values onto
`config.providerConfig.{providerId, modelId, apiLine, region}` using the same
`setOrClear` helper as the top-level overlay. This:

- Mirrors the top-level overlay for the four fields that `buildSessionConfig`
  pre-populates from LEGACY state and that the `@cline/core` runtime reads
  through `config.providerConfig` (`buildGatewayProviderOptions` and
  `createAgentModelFromConfig`'s `baseProviderConfig` merge). These are the
  ONLY four fields that exhibit the live "Use" divergence: identity
  (`providerId`, `modelId`) and regional routing (`apiLine`, `region`).
- Preserves R5 partial-instance semantics (`undefined` = no-op, `null` = clear,
  present = replace).
- Initializes `pcAny` defensively to `config.providerConfig ?? {}` so test/edge cases
  without a pre-populated `providerConfig` still work.
- Reassigns `config.providerConfig = pcAny` to ensure the reference survives
  in the original-undefined case.

**Bounded scope (CORRECTION11 evidence-boundary clarification, see GATE 7):**

The `providerConfig` overlay is intentionally **4 fields, not 6**. `apiKey`,
`baseUrl`, `headers`, and `providerSpecificConfig` are **NOT** propagated onto
`config.providerConfig` by this overlay. They are already written at the
top level by the existing top-level `setOrClear` block, and
`createAgentModelFromConfig` reads them through the
`config.apiKey ?? baseProviderConfig?.apiKey` chain. Duplicating them onto
`providerConfig` is unnecessary and would risk double-writes that diverge
across the two slots if a future LEGACY-state pre-fill ever sets them
before the typed apply runs. The first-bad boundary that produces the live
P0 is the regional-routing carrier (`apiLine`/`region`) and the identity
match (`providerId`/`modelId`); credentials and baseUrl are not on the
critical path for `405 Method Not Allowed`.

The fix does NOT change `buildSessionConfig`, the LEGACY state read, the `setOrClear`
helper, the bootstrap path, or the "Set as default" path. It only adds the missing
overlay onto the `providerConfig` carrier that the runtime actually reads.

Evidence file: `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/03-repair-decision.txt`

## GATE 4 — GREEN Re-run

### Targeted tests
`bun test src/sdk/__tests__/use-profile-apiline-runtime-routing.mpfrb01-test-apply-live01.test.ts`
```
(pass) MPULA01_RED ... [0.25ms]
(pass) MPULA02_CONSERVATION_CLEARING ... [0.03ms]
(pass) MPULA03_CONSERVATION_PARTIAL ... [0.03ms]
(pass) MPULA04_CONSERVATION_PROVIDER_ID ... [0.04ms]
(pass) MPULA05_USE_MUST_NOT_BECOME_SET_DEFAULT ... [0.05ms]
 5 pass
 0 fail
```

### Wider sweep
`bun test src/sdk/instance-store/ src/sdk/profile-store/ src/sdk/__tests__/bootstrap- src/sdk/__tests__/model-profile- src/sdk/__tests__/use-profile-apiline-runtime-routing`
```
 119 pass
 0 fail
 471 expect() calls
Ran 119 tests across 17 files.
```

### Pre-existing failures (NOT caused by this fix)
- `provider-instance-identity-r1a-red.piif01.test.ts`: bridge-config alias missing for
  `@cline-internal/core/runtime/host/local-runtime-host`
- `provider-instance-identity-r2-strategy-b.piif01.test.ts`: same
- `provider-instance-identity-r4-reload-read.piif01.test.ts`: same

These are the documented bridge-config seam failures for tests that need the REAL
`LocalRuntimeHost` class. Per `.clinerules/sdk-transport-integration.md`, these tests
## Conservation Invariants Verified

The fix does not break any of the following (all asserted as `pass` in the test file):

- **R5 partial-instance semantics**: a typed instance WITHOUT `connection.apiLine` does NOT
  overwrite `config.providerConfig.apiLine`. (`MPULA03_CONSERVATION_PARTIAL`)
- **R5 explicit-clearing semantics**: a typed instance with `connection.apiLine: null`
  DOES clear `config.providerConfig.apiLine` to `null`. (`MPULA02_CONSERVATION_CLEARING`)
- **Provider identity propagates**: `config.providerConfig.providerId` is updated to
  the typed instance's providerId so `createAgentModelFromConfig`'s `baseProviderConfig`
  match succeeds. (`MPULA04_CONSERVATION_PROVIDER_ID`)
- **Use != Set-as-default**: applying profile B via typed apply produces a config where
  `config.providerConfig.{providerId, modelId, apiLine}` reflect B, NOT the previous
  legacy state A. (`MPULA05_USE_MUST_NOT_BECOME_SET_DEFAULT`)
- **Top-level + providerConfig stay in sync**: `cfg.apiLine === cfg.providerConfig.apiLine`
  after apply, regardless of which path produced the values. (Covered by all 5 tests.)

## GATE 7 — CORRECTION11 Evidence-Boundary Clarification (docs/evidence only)

The original GATE 3 prose and `.factory/evidence/.../03-repair-decision.txt`
claimed the `providerConfig` overlay covered six fields:
`{providerId, modelId, apiKey, baseUrl, apiLine, region}`. The reviewer
verified the actual production code at
`apps/vscode/src/sdk/instance-store/typed-projector.ts` (the comment block at
~lines 225-272 and the `setOrClear` block at ~lines 273-278) overlays only the
four fields that constitute the first-bad boundary for the live `405`:

```ts
const pcAny = (cfgAny["providerConfig"] ?? {}) as Record<string, unknown>
setOrClear(pcAny, "providerId", toSdkProviderId(instance.providerId))
setOrClear(pcAny, "modelId", conn.modelId)
setOrClear(pcAny, "apiLine", conn.apiLine)
setOrClear(pcAny, "region", conn.region)
cfgAny["providerConfig"] = pcAny
```

`apiKey`, `baseUrl`, `headers`, and `providerSpecificConfig` are
intentionally NOT duplicated into `providerConfig`. The production comment
explains the bounded scope:

> It writes ONLY the fields that the typed instance binds
> (providerId, modelId, apiLine, region). It does NOT
> touch credentials, baseUrl, headers, or
> providerSpecificConfig — those continue to be driven
> by the top-level `setOrClear` writes above (which the
> `createAgentModelFromConfig` merge already picks up via
> the `config.apiKey ?? baseProviderConfig?.apiKey` chain).

The five RED→GREEN witnesses in
`apps/vscode/src/sdk/__tests__/use-profile-apiline-runtime-routing.mpfrb01-test-apply-live01.test.ts`
assert exactly this four-field boundary: `MPULA01_RED` (apiLine),
`MPULA02_CONSERVATION_CLEARING` (apiLine R5 null), `MPULA03_CONSERVATION_PARTIAL`
(apiLine R5 partial), `MPULA04_CONSERVATION_PROVIDER_ID` (providerId + apiLine),
`MPULA05_USE_MUST_NOT_BECOME_SET_DEFAULT` (providerId + modelId + apiLine).
None of them asserts on `config.providerConfig.apiKey` or `.baseUrl`, and
that's the correct shape: those fields don't appear on the critical path for
`405 Method Not Allowed`.

### What CORRECTION11 changed (docs/evidence only, no production code, no tests)
1. This ACT (GATE 3 above) rewritten to claim the **4-field overlay** and
   state explicitly why `apiKey/baseUrl/headers/providerSpecificConfig`
   are intentionally NOT duplicated into `providerConfig`.
2. `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/03-repair-decision.txt`
   rewritten to mirror the 4-field overlay and add the same explicit
   `apiKey/baseUrl` boundary note.
3. `.factory/epic-board.md` — the existing 2026-09-09 ACT line (line 1) still
   claims the broader 6-field overlay; that line is left in place as the
   original closure record, but a new CORRECTION11 row above it clarifies
   that the production overlay is bounded to 4 fields and explains why.

### What CORRECTION11 did NOT change
- `apps/vscode/src/sdk/instance-store/typed-projector.ts` — production code
  untouched. The 4-field overlay at ~lines 273-278 is the implementation.
- `apps/vscode/src/sdk/__tests__/use-profile-apiline-runtime-routing.mpfrb01-test-apply-live01.test.ts`
  — tests untouched. They already assert the correct 4-field boundary.
- `buildSessionConfig`, `setOrClear`, LEGACY state read, bootstrap path,
  "Set as default" path, proto/UI/webview surface, CORRECTION09 closure.
- Test results (5/5 GREEN on targeted, 119/119 GREEN on wider sweep,
  typecheck clean) — all still GREEN, no re-run needed because no
  production or test code changed.

## Files Changed

### Modified
- `apps/vscode/src/sdk/instance-store/typed-projector.ts`
  - Added CORRECTION10 overlay block at the end of `applyTypedProviderInstanceToConfig`
    (after the existing top-level `setOrClear` calls, before the `return` statement).

### Created
- `apps/vscode/src/sdk/__tests__/use-profile-apiline-runtime-routing.mpfrb01-test-apply-live01.test.ts`
  - 5 tests: RED witness + 4 conservation invariants.
- `.factory/acts/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01.md` (this file)
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/00-entry-freeze.txt`
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/01-recon-production-seam.txt`
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/02-red-witness.txt`
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/03-repair-decision.txt`
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/04-green-confirm.txt`

### Modified by CORRECTION11 (docs/evidence only, 2026-09-09 second pass)
- `.factory/acts/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01.md` — GATE 3 rewritten to claim
  the bounded 4-field overlay; new GATE 7 added documenting the evidence-boundary correction.
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/03-repair-decision.txt` —
  rewritten to mirror the 4-field overlay and explain why apiKey/baseUrl are top-level-only.
- `.factory/epic-board.md` — new CORRECTION11 row prepended (HALT_EVIDENCE_CONTRACT_MISMATCH
  CLOSED); inline `[CORRECTION11 NOTE]` marker added to the original 2026-09-09 six-field
  claim so the original closure record is no longer actively misleading.

## Live Verification (pending)
Dogfood step: reload VS Code, create a MiniMax profile with `apiLine="international"`,
click "Use", verify the request succeeds (closes L-C08-2). Cannot be performed in the
VM's headless context; recorded as the operator's manual verification step.

need a dedicated `vitest.config.c2-4-c-bridge.ts` to import the real class — they are
out of scope for this ACT. The failures reproduce WITHOUT the fix (verified by checking
out a clean tree and rerunning).

### Typecheck
`bun x tsc --noEmit` — no output, passes.

Evidence file: `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/04-green-confirm.txt`

Evidence file: `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-USE-LIVE-APPLY01/02-red-witness.txt`

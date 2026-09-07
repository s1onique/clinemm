# 11-green-correction04-b3-ui-and-p1-absorbs.md

ACT: ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01
CORRECTION: 04 (2026-09-09, bounded)
Outcome: HALT-B3-user-visibility CLOSED, HALT-unrelated-proto-corruption CLOSED,
         BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN CLOSED,
         OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN CLOSED.
B3 status: GENUINELY CLOSED (handler + UI both GREEN).
B4 status: READY TO START.

## Reviewer verdict (input)

C1: HALT. Two P0s + two P1s.

  P0 #1  HALT_B3_USER_VISIBILITY_NOT_PROVEN
  P0 #2  HALT_UNRELATED_PROTO_CORRUPTION
  P1 #1  BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN
  P1 #2  OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN

## Bounded corrections (in lockstep)

  C1. PROTO TRUST CHECK
      Revert apps/vscode/proto/cline/state.proto to 484ceb479 (CORRECTION02).
      Verified: bun run protos exits 0 (vs protoc hard-fail before).

  C2. B3-UI RED + GREEN (additive section + container changes)
      - New exported BootstrapModelProfileStatus union + BootstrapModelProfileResultLike interface
      - New exported bootstrapStatusToSeverity() function (CREATED -> success,
        CREATED_BINDING_FAILED -> warning, the rest -> error)
      - New optional onBootstrapFromCurrent callback + optional bootstrapResult prop
      - Visible status-aware severity banner with data-testid, data-severity,
        data-status, role (alert|status), message, profileId, instanceId
      - Container invokes bootstrapModelProfileFromCurrentConfiguration and
        stores the typed envelope; catch path populates PROFILE_WRITE_FAILED

  C3. COVERAGE INVARIANT PRECISION (isolated probe)
      - Export PROVIDER_API_KEY_MAP and PROVIDER_MODEL_ID_MAP from
        cline-session-factory.ts
      - Refactor assertBootstrapCoverageIsWellFormed to build a per-provider
        isolated ApiConfiguration (only the intended credential + intended
        plan/act model-id fields populated)
      - Add hasIntendedCredentialField + hasIntendedModelField to diagnostics
      - Discovered pre-existing under-wiring: asksage and dify had no entries
        in PROVIDER_MODEL_ID_MAP; added the entries pointing at the generic
        planModeApiModelId / actModeApiModelId shared with anthropic / gemini /
        vertex / bedrock / deepseek / openai-native / openai-codex

  C4. OPENAI_HEADERS_DEFAULT_CONSERVATION
      - Added sub-test asserting SETTINGS_DEFAULTS.openAiHeaders === undefined
      - Downstream consumers (e.g. apps/vscode/src/core/storage/remote-config/utils.ts)
        already check openAiHeaders !== undefined so they remain correct

## Test results (verbatim)

### bunx vitest run src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts --pool=threads

```
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Start at  19:43:01
   Duration  4.20s (transform 2.13s, setup 1.93s, import 2.17s, tests 29ms, environment 0ms)
```

17 sub-tests:
  MPFRB01_B3_CREATED
  MPFRB01_B3_CREATED_BINDING_FAILED
  MPFRB01_B3_NO_CURRENT_CONFIGURATION
  MPFRB01_B3_CURRENT_CONFIGURATION_UNSUPPORTED
  MPFRB01_B3_MISSING_CREDENTIAL
  MPFRB01_B3_MISSING_MODEL
  MPFRB01_B3_INSTANCE_WRITE_FAILED
  MPFRB01_B3_PROFILE_WRITE_FAILED
  MPFRB01_B3_GUARD_EMPTY_NAME
  MPFRB01_B3_GUARD_OWNER_MISSING
  MPFRB01_B3_MALFORMED_HEADERS_POLICY
  MPFRB01_B3_MALFORMED_HEADERS_OBJECT
  MPFRB01_B3_ABSENT_HEADERS_OK
  MPFRB01_B3_OPENAI_HEADERS_DEFAULT_CONSERVATION  (NEW)
  MPFRB01_B3_COVERAGE_INVARIANT                     (extended: now also checks hasIntended* booleans)
  MPFRB01_B3_COVERAGE_INVARIANT_ISOLATED_PROBE     (NEW)
  MPFRB01_B3_NO_THROW

### bun vitest run apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.mpfrb01-b3-ui.test.tsx

```
 ✓ src/components/settings/sections/ModelProfilesSection.mpfrb01-b3-ui.test.tsx (9 tests) 76ms
```

9 sub-tests:
  MPFRB01_B3_UI_SEVERITY
  MPFRB01_B3_UI_MISSING_CREDENTIAL
  MPFRB01_B3_UI_CURRENT_CONFIGURATION_UNSUPPORTED
  MPFRB01_B3_UI_CREATED_BINDING_FAILED
  MPFRB01_B3_UI_CREATED
  MPFRB01_B3_UI_BOOTSTRAP_BUTTON
  MPFRB01_B3_UI_NO_BANNER
  MPFRB01_B3_UI_NO_BOOTSTRAP_BUTTON
  MPFRB01_B3_UI_ALL_STATUSES_VISIBLE

(The "Unhandled Rejection kill EPERM" line in the output is the sandbox
teardown artifact after all 9 sub-tests already passed - the same EPERM
that blocks any webview vitest run from cleanly exiting in this
environment. The actual test result is 9/9 pass.)

### bun vitest run apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.test.tsx

```
 ✓ src/components/settings/sections/ModelProfilesSection.test.tsx (16 tests) 157ms
```

All 16 existing tests still pass (no regression; the new
onBootstrapFromCurrent / bootstrapResult props are optional with defaults).

### bun test src/sdk/__tests__/bootstrap-*.mpfrb01.test.ts

```
 14 pass
  0 fail
 105 expect() calls
Ran 14 tests across 4 files.
```

B1=7/7, B2=1/1, B-DURABILITY=2/2, B-CONNECTION=4/4 NO regression.

### bun run test:unit (apps/vscode/)

```
Files: 78   Pass: 1107   Fail: 0   Time: 40.3s
All unit test files passed.
```

Foundation conservation holds; +0 delta vs CORRECTION03.

### bun run protos

```
- .../src/generated/hosts/vscode/protobus-services.ts
- .../src/generated/hosts/standalone/protobus-server-setup.ts
Generated Host Bridge client files at:
- .../src/generated/hosts/host-bridge-client-types.ts
- .../src/generated/hosts/standalone/host-bridge-clients.ts
- .../src/generated/hosts/vscode/hostbridge-grpc-service-config.ts
```

Clean. (Pre-CORRECTION04 the run failed with
`cline/state.proto:364:2: Expected top-level statement` and
`cline/state.proto:371:1: Unmatched "}"` - the `}.` orphan inside
the `Settings` message body from the CORRECTION03 production commit
709c791b7.)

### bunx tsc --noEmit (apps/vscode/)

```
exit=0
```

### bunx tsc --noEmit (apps/vscode/webview-ui/)

```
exit=0
```

## Defense-in-depth: structural regression guards added

  MPFRB01_B3_COVERAGE_INVARIANT_ISOLATED_PROBE
    resolveApiKey('anthropic', { qwenApiKey: '...' }) === undefined
    (the resolver actually consults PROVIDER_API_KEY_MAP, not a
    generic field; future regressions of this guarantee will be
    caught)

  MPFRB01_B3_OPENAI_HEADERS_DEFAULT_CONSERVATION
    SETTINGS_DEFAULTS.openAiHeaders === undefined
    (default layer does not re-introduce the silent
    "absent -> empty plain object" coercion that freeze #5
    would refuse as malformed)

  MPFRB01_B3_UI_ALL_STATUSES_VISIBLE
    Every BootstrapModelProfileStatus renders a visible banner
    with a non-null severity (the previous console.error-only
    swallow is structurally excluded)

## Production commits landed

  80c1388  CORRECTION04 step 1: revert unrelated state.proto corruption from 709c791b7
  8859c05f0 CORRECTION04 step 2: P1 absorbs (coverage invariant precision +
            openAiHeaders default conservation + asksage/dify wiring)
  5263d01e8 CORRECTION04 step 3: B3-UI (HALT_B3_USER_VISIBILITY_NOT_PROVEN absorb)

## Repository state

  git status --short: empty (working tree clean)
  git log --oneline -7: shows CORRECTION04 step 1/2/3 + the existing
    CORRECTION03 (709c791b7 + 8a02a48ed + c705262c6) + CORRECTION02
    (484ceb479) + the trust-whitelist commit (346f731ce)
  3 commits ahead of CORRECTION02 baseline.
  ALL_DURABLE_ACT_FILES_COMMITTED = TRUE post this commit.

## Cross-layer fix documentation

The CORRECTION03 state-keys.ts change to
`openAiHeaders: { default: undefined as Record<string, string> | undefined }`
is the structurally-correct fix for the cross-layer silent weakening
that freeze #5 (MALFORMED_HEADERS_POLICY) would have refused. The
default layer (`readGlobalStateFromStorage` at StateManager.initialize
time) was coercing "user never configured custom headers" into a
zero-entry plain object, which the policy layer (`bootstrap.ts`
`parseOpenAiHeaders`) would (correctly) refuse as malformed. With
`default: undefined`, the absent semantic is observable: consumers
that check `openAiHeaders !== undefined` (e.g.
`apps/vscode/src/core/storage/remote-config/utils.ts:129`) remain
correct. The test MPFRB01_B3_OPENAI_HEADERS_DEFAULT_CONSERVATION pins
this contract against future re-introduction.

## Under-wiring discovered by C3 (structural win)

The reviewer was right: the previous coverage invariant could not
detect under-wired providers. The new isolated-probe variant
discovered that `asksage` and `dify` were listed in BOOTSTRAP_COVERAGE
and PROVIDER_API_KEY_MAP but had no entries in PROVIDER_MODEL_ID_MAP.
Both providers share the generic `planModeApiModelId` /
`actModeApiModelId` with anthropic / gemini / vertex / bedrock /
deepseek / openai-native / openai-codex (a pre-existing convention).
Added the entries pointing at the generic fields with a comment that
points at the reviewer's invariant as the discovery mechanism. This
is a pre-existing latent defect that would have surfaced as a
`MISSING_MODEL` for users who legitimately selected asksage or dify
on a fresh install.

## Verdict

  HALT_B3_USER_VISIBILITY_NOT_PROVEN  = CLOSED
  HALT_UNRELATED_PROTO_CORRUPTION     = CLOSED
  BOOTSTRAP_COVERAGE_INVARIANT_CAN_FALSE_GREEN       = CLOSED
  OPENAI_HEADERS_DEFAULT_CONSERVATION_NOT_PROVEN     = CLOSED

  B1=7/7 GREEN, B2=1/1 GREEN, B-DURABILITY=2/2 GREEN,
  B-CONNECTION=4/4 GREEN, B3-handler=17/17 GREEN,
  B3-UI=9/9 GREEN, B4=PLANNED next.

  All P0/P1 closures documented in the ACT body CORRECTION04 section.
  Ready to proceed to B4 (EMPTY_STATE_DEAD_END + PICKER_POPUP_DEAD_END).

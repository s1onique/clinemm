# 10 — B3 GREEN: transport-to-user semantics

**Date:** 2026-09-09
**Branch:** main
**Commits:** `709c791b7` (production), `8a02a48ed` (test)
**Verdict:** B3 GREEN — 15/15 sub-tests pass at the controller-handler boundary.

## What B3 proves

The 15 sub-tests in
`apps/vscode/src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts`
exhaustively cover every value of
`BootstrapModelProfileStatus` plus the two bounded P1 absorbs
the reviewer verdict C1 rode along on B3. Each sub-test is a
real call through `bootstrapModelProfileFromCurrentConfiguration`
(the controller-handler boundary), so the witness proves
transport-to-user semantics end-to-end — from the typed
`BootstrapModelProfileRequest` arriving on the gRPC side, to
the typed `BootstrapModelProfileResponse` envelope going back.

Sub-tests:

| # | Sub-test | Status proven |
|---|----------|---------------|
| 1 | `MPFRB01_B3_CREATED` | CREATED + populated ids + empty message |
| 2 | `MPFRB01_B3_CREATED_BINDING_FAILED` | success-with-warning (post-commit binding failure visible to user) |
| 3 | `MPFRB01_B3_NO_CURRENT_CONFIGURATION` | empty providerId → empty ids, mode-tagged message |
| 4 | `MPFRB01_B3_CURRENT_CONFIGURATION_UNSUPPORTED` | provider outside `BOOTSTRAP_COVERAGE` → empty ids, named message |
| 5 | `MPFRB01_B3_MISSING_CREDENTIAL` | provider present but no apiKey → empty ids, credential-named message |
| 6 | `MPFRB01_B3_MISSING_MODEL` | provider + credential present but no model id → empty ids, MODEL-named message (regression guard) |
| 7 | `MPFRB01_B3_INSTANCE_WRITE_FAILED` | `flushInstanceSecrets` throws → empty ids, message names the flush error |
| 8 | `MPFRB01_B3_PROFILE_WRITE_FAILED` | `ProfilesStore.upsert` throws → empty ids, message names the upsert error |
| 9 | `MPFRB01_B3_GUARD_EMPTY_NAME` | handler refuses empty name with `PROFILE_WRITE_FAILED` + bound message |
| 10 | `MPFRB01_B3_GUARD_OWNER_MISSING` | handler reports production owner not wired when controller lacks `modelProfilesOwner` |
| 11 | `MPFRB01_B3_MALFORMED_HEADERS_POLICY` | malformed JSON `openAiHeaders` refuses with `CURRENT_CONFIGURATION_UNSUPPORTED` + actionable message |
| 12 | `MPFRB01_B3_MALFORMED_HEADERS_OBJECT` | non-object `openAiHeaders` refuses (array) |
| 13 | `MPFRB01_B3_ABSENT_HEADERS_OK` | absent headers → `CREATED`, headers absent on connection |
| 14 | `MPFRB01_B3_COVERAGE_INVARIANT` | `assertBootstrapCoverageIsWellFormed` reports `ok=true` for the current `BOOTSTRAP_COVERAGE` set |
| 15 | `MPFRB01_B3_NO_THROW` | handler never throws across the gRPC boundary; every status is a typed envelope |

## Bounded P1 absorbs (reviewer verdict C1)

### `BOOTSTRAP_COVERAGE_SCOPE_PRECISION`

Closed by:
- New module `apps/vscode/src/sdk/profile-store/bootstrap-coverage-invariants.ts`
  exporting `assertBootstrapCoverageIsWellFormed()`.
- Sub-test 14 directly invokes the invariant and asserts
  `ok=true`.
- The invariant synthesizes a probe `ApiConfiguration` and
  exercises the PUBLIC `resolveApiKey`/`resolveModelId`
  resolvers — does NOT couple to internal maps.

### `MALFORMED_PRESENT_HEADERS_POLICY`

Closed by:
- Freeze #5 added to `bootstrap.ts` file-level header.
- `captureOpenAiHeaders` refactored to `parseOpenAiHeaders`
  returning tagged
  `{kind:"absent"} | {kind:"captured",headers} | {kind:"malformed",reason}`.
- `captureConnection` returns
  `CaptureConnectionResult = {kind:"ok",connection} | {kind:"refused",status,message}`;
  call site propagates the discriminated refusal as
  `CURRENT_CONFIGURATION_UNSUPPORTED` before the
  `MISSING_MODEL` branch.
- Sub-tests 11, 12, 13 exercise absent / captured /
  malformed respectively.

## Defense-in-depth cross-layer fix

While writing the absent-headers sub-test, the test exposed a
cross-layer coupling bug: `state-keys.ts`'s
`openAiHeaders: { default: {} }` was coercing the
"user never configured custom headers" case into a zero-entry
plain object that freeze #5 (correctly) refused as malformed.
Fix in production: `openAiHeaders: { default: undefined }`.
The empty plain object is still refused when the user
explicitly stores it; only the default-coerced case is gone.
This is the lesson #14 in the CORRECTION03 ACT body.

## Test infra decisions worth documenting

1. **Per-test fresh `StateManager` via singleton reassignment.**
   `StateManager.dispose()` resets `isInitialized` and all
   caches, but the singleton pattern (`StateManager.instance`)
   prevents re-initialization in the same Node process. We
   bypass by reassigning
   `(StateManager as unknown as {instance: unknown}).instance = null`
   in `beforeEach`. This is the structural pattern documented
   in `.clinerules/storage.md`'s `StateManager.initialize` note.

2. **Per-test `mkdtempSync` for store isolation.** Each test
   gets its own `InstancesStore`/`ProfilesStore` data dir so
   cross-test instance/profile UUIDs and credentials don't
   leak.

3. **Cross-scenario cache cleanup via direct mutation.**
   `setApiConfiguration` skips undefined values, so a scenario
   like `{actModeApiProvider: "anthropic", apiKey: "..."}`
   does NOT clear the previously-set `actModeApiModelId`.
   Inside `MPFRB01_B3_NO_THROW` we walk every cache
   (`globalStateCache`, `secretsCache`, `remoteConfigCache`,
   `sessionOverrideCache`, `taskStateCache`) and nullify the
   entries that have a value, then apply the scenario config.

4. **faked `modelProfilesOwner` only.** The handler signature
   requires `controller.modelProfilesOwner`. We pass a thin
   `{modelProfilesOwner: owner}` object as `controller` and
   the real handler does the rest (`StateManager.get()` is
   called directly, not via the fake controller).

## Conservation (unchanged)

- `bun run test:unit` (bun:test files): 1107 pass / 0 fail
  (NO regression vs CORRECTION02 close).
- `src/sdk/__tests__/bootstrap-*.mpfrb01.test.ts`
  (B1+B2+B-DURABILITY+B-CONNECTION): 14 pass / 0 fail
  (NO regression vs CORRECTION02 close).
- `bunx tsc --noEmit`: exit 0 (no type regression).
- B3 itself: 15 pass / 0 fail.

Pre-existing failures (NOT introduced by this ACT):
`OWN01 RED` in `sdk-session-event-coordinator.test.ts`
(verified pre-existing by stashing all CORRECTION03 changes
and reproducing identical failure); several bun:test files
collected by vitest's glob (`v2-capture.cache-ordering`,
`provider-instance-identity-r1a-red`, etc.) — these run
under `bun run test:unit` and pass there; the vitest
mis-collection is pre-existing.

## Commits

```
8a02a48ed ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 B3 transport-to-user semantics test (vitest, controller-handler boundary)
709c791b7 ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 B3 production code: MALFORMED_HEADERS_POLICY + assertBootstrapCoverageIsWellFormed
```

Foundation went from 1107/1107 at CORRECTION02 close to
1107/1107 at CORRECTION03 close (B3 is a vitest test, not a
bun:test test, so it does not increment the bun:test
foundation count — its delta lives in the vitest foundation
which has its own runner).

## Status

- P0 BOOTSTRAP_PATH_ABSENT = CLOSED
- P0 BOOTSTRAP_SECRET_NOT_DURABLE_AT_PROFILE_COMMIT = CLOSED
- P0 BOOTSTRAP_CONNECTION_TUPLE_INCOMPLETE = CLOSED
- P0 UNEXPECTED_TRACKED_DIRT = CLOSED
- P1 BOOTSTRAP_CREDENTIAL_SOURCE_NOT_BOUND = CLOSED
- P1 BOOTSTRAP_ATOMICITY_UNDEFINED = CLOSED
- P1 BOOTSTRAP_RPC_SURFACE_STILL_TBD = CLOSED
- P1 EXACT_HEAD_LABEL_OVERSTATED = CLOSED
- P1 MISSING_MODEL_MISCLASSIFIED_AS_MISSING_CREDENTIAL = CLOSED
- P1 BOOTSTRAP_COVERAGE_SCOPE_PRECISION = **CLOSED via B3**
- P1 MALFORMED_PRESENT_HEADERS_POLICY = **CLOSED via B3 freeze #5**
- P1 SILENT_FAILURE = **CLOSED via B3 15/15 typed-envelope witness**
- P1 EMPTY_STATE_DEAD_END = OPEN (B4 next)
- P1 PICKER_POPUP_DEAD_END = OPEN (B4)
- P2 BLANK_AT_EOF_DIAGNOSTICS = OPEN

Next: B4 (empty-state CTA).
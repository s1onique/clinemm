# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY

> Status: **IMPLEMENTATION_PASS_LEGACY_TS_AUTHORITY_REMOVED**
>
> Mission: remove the silent TS authority fallback in the completion
> commit path. The Elm kernel is now the MANDATORY completion
> authority. There is no OFF path, no default-Authorize fallback,
> and no env gate. The shadow runtime is RETIRED from production
> (test fixture only).

## Reviewer decision (C1)

> LIVE-first is already complete. Delete OFF now. Retire the
> production shadow. Preserve only offline replay/test substrate
> that still earns its keep. C1: GO.

## Verifier-style flags

```
ELM_SOURCE_CHANGED                          = false (no Elm change)
ELM_DECISION_LOGIC_CHANGED                  = false (kernel semantics unchanged)
TS_AUTHORITY_SEAM_CHANGED                   = true  (the seam is now mandatory)
TS_COMPLETION_EFFECT_SEMANTICS_CHANGED      = false (setTurnPhase("completed", ...) unchanged)
CCARD_OBSERVATION_SEMANTICS_CHANGED         = false
CCARD_SCHEMA_CHANGED                        = false
MCP_REBUILD_SEMANTICS_CHANGED               = false
SESSION_LIFECYCLE_SEMANTICS_CHANGED         = false
QUEUE_SEMANTICS_CHANGED                     = false
NEW_ENV_VAR_ADDED                           = false
NEW_ENV_VAR_REMOVED                         = CLINEMM_COMPLETION_AUTHORITY_ELM
                                              CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW
PROTOCOL_CHANGED                            = false
MYC_CODE_CHANGED                            = false
SHADOW_RUNTIME_RETIRED                      = true (production wiring deleted; module kept as test fixture)
```

## Source changes (summary)

### Production source (11 files modified)

| File | Change |
|---|---|
| `apps/vscode/src/sdk/completion-authority-elm-authority.ts` | Deleted `defaultElmCompletionAuthorityDecision` constant and `defaultGetElmCompletionAuthorityDecision` function. Module now exports only the closed discriminated union type. |
| `apps/vscode/src/sdk/completion-authority-elm-authority-runtime.ts` | Replaced `defaultElmCompletionAuthorityDecision` fallback in `getElmAuthorityCompletionDecision` with fail-closed `failure` decision when `state.enabled` is false. Renamed `isElmAuthorityEnabled` to `isElmAuthorityAvailable` (health observation only, not a mode toggle). Made `lastDecision` nullable (sentinel for "no Elm opinion yet"). |
| `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` | Deleted `applyElmShadowDiagnosticProfile` helper. Replaced env-gated `applyElmAuthorityProfile(env, kernelPath)` with unconditional `initializeElmAuthorityRuntime(kernelPath)` that fail-closes if kernel path is null. Dropped `ElmShadowModule` import. |
| `apps/vscode/src/extension.ts` | Removed shadow activation call, `dumpExtensionSideElmShadowDiagnostic` import, and `DumpCompletionAuthorityElmShadow` command registration. Replaced with unconditional `initializeElmAuthorityRuntime` call. |
| `apps/vscode/src/registry.ts` | Removed `DumpCompletionAuthorityElmShadow` command ID. |
| `apps/vscode/package.json` | Removed `cline.debug.dumpCompletionAuthorityElmShadow` contribution point declaration. |
| `apps/vscode/src/sdk/completion-authority-elm-shadow-runtime.ts` | Marked as TEST-FIXTURE ONLY in docblock. Module file retained for `__tests__/completion-authority-elm-shadow02.test.ts`. |
| `apps/vscode/src/sdk/completion-authority-elm-authority-runtime-host.ts` | Updated docblock to reference `initializeElmAuthorityRuntime` instead of `applyElmAuthorityProfile`. |
| `apps/vscode/src/sdk/continuation-cardinality-authority.ts` | Deleted `ShadowGate` block, `ShadowModule` import, `observeElmShadowFireAndForget` call in CCARD observer, and `shadowWants` discriminator. CCARD capture is now gated solely by `captureEnabled`. |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | Made `getElmCompletionAuthorityDecision` option REQUIRED (no `?`, no `??` default). Removed `defaultGetElmCompletionAuthorityDecision` import + constructor fallback. Removed `if (!isElmAuthorityEnabled()) return` short-circuit in `notifyAgentTurnDone`. |
| `apps/vscode/src/sdk/SdkController.ts` | Removed `if (!ElmAuthorityModule.isElmAuthorityEnabled()) return` guard in `setAgentTurnDoneSemanticTrigger`. Trigger is now unconditional. |

### Tests (8 files modified)

| File | Change |
|---|---|
| `apps/vscode/src/sdk/__tests__/completion-authority-elm-first-seam01.preservation.test.ts` | Rewrote EAS01-PRES-02 and EAS01-PRES-04 to assert the new contract (no `defaultGetElmCompletionAuthorityDecision`, REQUIRED option, no `??` fallback). |
| `apps/vscode/src/sdk/__tests__/completion-authority-elm-first-seam01.case01.test.ts` | Inject default-authorize provider when `opts.getElmCompletionAuthorityDecision` is omitted (legacy OFF path is now test-driven, not production-driven). |
| `apps/vscode/src/sdk/__tests__/completion-authority-effect-discriminator01.cae01.test.ts` | Renamed CAE-03 to "no-provider fail-closed (kernel not armed)" and rewrote assertions: `authorityCalls >= 1` (consult happened), `setTurnPhaseCalls === 0` (commit suppressed), `markerPresentAfter === true` (deferred-barrier re-registered). |
| `apps/vscode/src/sdk/__tests__/completion-authority-elm-shadow02.test.ts` | Renamed ELS02-16 describe to "ELS02-16-DEFAULT01 - Elm shadow retired from production wiring". Rewrote 8 tests to assert: helper removed, no dump command, no package.json declaration, `initializeElmAuthorityRuntime` is unconditional. Shadow module file retained as test fixture. Added `captureAndObserve` helper for tests that exercise both CCARD and shadow modules directly. |
| `apps/vscode/src/sdk/__tests__/completion-authority-elm-real-provider01.test.ts` | Renamed `isElmAuthorityEnabled` to `isElmAuthorityAvailable` (4 occurrences). |
| `apps/vscode/src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts` | Same rename. |
| `apps/vscode/src/sdk/__tests__/post-run-completion-authority-reevaluation01.pcra01.test.ts` | Renamed describe to "POSTRUN-NO-KERNEL-CONSERVATION", rewrote test to assert: trigger fires unconditionally (no P1 OFF guard); reevaluate consults Elm which returns failure (kernel not armed); commit suppressed; barrier held. |
| `apps/vscode/src/sdk/__tests__/extension-host-session-event-hotloop01.ehloop01.test.ts` | Inject no-op `getElmCompletionAuthorityDecision` in harness (the option is now required). |

## Final acceptance criterion (reviewer)

```
$ rg 'CLINEMM_COMPLETION_AUTHORITY_ELM(_SHADOW)?' apps/vscode/src
apps/vscode/src/sdk/__tests__/completion-authority-elm-shadow02.test.ts:620:
        expect(source).not.toMatch(/CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW\s*=/)

$ rg 'defaultElmCompletionAuthorityDecision|defaultGetElmCompletionAuthorityDecision|elm_authority_off_default_authorize' apps/vscode/src
apps/vscode/src/sdk/__tests__/completion-authority-elm-first-seam01.preservation.test.ts:40:
        expect(source).not.toMatch(/defaultGetElmCompletionAuthorityDecision/)
apps/vscode/src/sdk/__tests__/completion-authority-elm-first-seam01.preservation.test.ts:41:
        expect(source).not.toMatch(/defaultElmCompletionAuthorityDecision/)
apps/vscode/src/sdk/completion-authority-elm-authority.ts:27:
 * `kind: "authorize", reason: "elm_authority_off_default_authorize"`.
```

Production source is clean. The remaining matches are either:

1. **`not.toMatch` assertions** in preservation tests that LOCK the absence of these symbols (intentional regression guards).
2. **History-note comments** in the authority module that document what was removed (intentional historical evidence).

## Test results (this ACT)

```
$ bun run check-types
EXIT=0 (clean)

$ bun run test:unit
Files: 94   Pass: 1246   Fail: 0
All unit test files passed.

$ bun vitest run src/sdk/__tests__/completion-authority-effect-discriminator01.cae01.test.ts \
                     src/sdk/__tests__/completion-authority-elm-first-seam01.preservation.test.ts \
                     src/sdk/__tests__/completion-authority-elm-first-seam01.case01.test.ts \
                     src/sdk/__tests__/completion-authority-elm-real-provider01.test.ts \
                     src/sdk/__tests__/completion-authority-elm-shadow02.test.ts \
                     src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts \
                     src/sdk/__tests__/post-run-completion-authority-reevaluation01.pcra01.test.ts \
                     src/sdk/__tests__/post-run-completion-authority-reevaluation01-correction01-precheck-liveness.test.ts \
                     src/sdk/__tests__/extension-host-session-event-hotloop01.ehloop01.test.ts
Test Files  8 passed (8)
Tests       76 passed (76)
```

## Pre-existing failures (unrelated)

`bun vitest run src/sdk/sdk-task-history.test.ts` shows 33 pre-existing
failures. Confirmed via `git stash` that these failures exist on the
baseline (commit `77e0950df`) before this ACT. They are not caused by
the cleanup. They are related to `sdk-task-history.test.ts` having
out-of-date expectations for the SDK task history shape (likely
connected to the migration from legacy storage to file-backed storage).

## Mandatory Elm behavior (frozen contract)

```
At activation (extension.ts:activate):
  canonical runtime asset missing/unloadable
      -> extension emits console.error; runtime is left in fail-closed state

After successful activation:
  Elm HOLD
      -> no completion commit (BCB01 deferred-barrier held; marker
         re-registered so next causal trigger re-consults Elm)

  Elm AUTHORIZE
      -> effect permitted exactly once

  Elm decode/kernel/runtime failure
      -> fail closed, no completion commit (the consult returns
         { kind: "failure", reason: "elm_authority_unavailable",
         classification: "elm_authority_unavailable" })
```

There is **no normal runtime state where "Elm unavailable" silently
means continue with TS authority**. An `isElmAuthorityAvailable()`
function exists for diagnostics/tests but it must never become
another production decision switch.

## LIVE qualification (final gate)

Per the MYC03 board cursor, LIVE qualification remains a separate
operator-driven step. The vitest-grade evidence above proves the
conservation matrix is intact. The installed-LIVE qualification
(operator-installed VSIX with no env vars set, verified counters
match the LIVE-PASS contract) MUST be performed before promoting
PASS_FIRST_ELM_AUTHORITY_SEAM to honest. This ACT does not advance
the MYC03 cursor - the cursor remains HOLD until LIVE qualification
is completed by an operator.

## Cursor (post-IMPLEMENTATION)

```
MCP/session lifecycle             LIVE PASS (CORRECTION04)
Elm authority HOLD->AUTHORIZE     LIVE PASS (CORRECTION01)
authority->effect repair          IMPLEMENTATION PASS (this ACT)
ownership inventory               RECON PASS (RECON ACT at 77e0950df)
ownership cleanup (default-01)    IMPLEMENTATION PASS (this ACT)
  -> delete OFF path             DONE (silent default-authorize removed)
  -> retire shadow               DONE (production wiring removed)
  -> unconditional init          DONE (initializeElmAuthorityRuntime)
  -> preserve 11 RETAIN           DONE (conservation spine intact)
  -> 5 preservation tests         REWRITTEN (no test left)
installed LIVE                    NEXT (operator-driven)
MYC03                             HOLD (unchanged by this ACT)
```

ENTRY_HEAD                77e0950df (RECON PASS)
SUBJECT_HEAD              <this ACT commit, to be set at commit time>
ELM_BUILD                 N/A (no Elm change)
ELM_TEST                  N/A
ELM_SMOKE                 N/A
HISTORICAL_REPLAY         N/A (no replay scenarios affected)
TYPECHECK                 PASS (bun tsc --noEmit exit 0)
LINT                      PASS (biome format exit 0)
BUN_UNIT_TEST_BASELINE    PASS (94 files, 1246 tests, exit 0)
VITEST_AUTHORITY_BASELINE PASS (8 files, 76 tests, exit 0)
VITEST_FULL_BASELINE      PASS minus 33 pre-existing sdk-task-history failures
MYC03_CURSOR              HOLD (unchanged by this ACT)

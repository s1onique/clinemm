# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

| Field | Value |
|-------|-------|
| OWNING_EPIC | EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING |
| PREDECESSOR_ACT | ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01 |
| PRODUCTION_DELTA_TARGET | bounded (one new core→host carrier seam + one narrow header numerator switch) |
| DISPOSITION | OPEN — RED not yet authored |
| C1 | GO_HEADER_TRANSPORT |

## Primary contract (one-line)

Carry the already-authoritative W from the core prepare-turn
boundary to the `TaskHeader` context gauge exactly once,
**without recomputing or transforming its semantic domain**.

W remains canonical (estimate of next provider request
occupancy in `CANONICAL_W_ESTIMATOR` units). The transport
is a pure one-time copy. P/H accounting remains untouched.

## Clean ownership split (frozen)

```text
AUTHORITY-PUBLISH01
  = produce truthful W (commit 6bffd75c0 + fc906dfc6 + 96336dc77)

HEADER-TRANSPORT-REPAIR01
  = transport + consume truthful W (this ACT)
```

Authority is resolved. Transport is open.

## W_PRESENTATION_TRANSPORT = ABSENT (re-calibrated from agent-runtime drop)

`git grep -n -e 'currentWorkingContextEstimate' -e 'ContextPipelinePrepareTurnResult' -- sdk apps` returns exactly:

```text
sdk/packages/core/src/extensions/context/compaction.ts
  :60  interface declaration
  :75  field declaration (currentWorkingContextEstimate?: number)
  :80  function-return type
  :286 function-parameter type
  :734 helper docstring
  :754 helper return type
  :758 helper field emitter
sdk/packages/core/src/extensions/context/compaction.working-context-authority-publish.test.ts
  (producer tests)
sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts
  (producer tests)
```

NO occurrence in:

- `sdk/packages/agents/src/` (the runtime consume site drops it
  on the floor; TODO at `agent-runtime.ts:2300` confirms)
- `sdk/packages/core/src/runtime/` (orchestration, adapters)
- `apps/vscode/` (extension host, webview, header)

So `W_PRESENTATION_TRANSPORT = ABSENT / PROVEN`. This is the
mechanical repo-wide absence bind the P1 calibration asked for.
There is no existing generic carrier that preserves arbitrary
prepare-turn result fields; one bounded addition is justified.

## Transport doctrine (frozen BEFORE implementation)

```text
W_COMPUTE_COUNT            = one authority: core prepare-turn seam
W_RECOMPUTE_IN_AGENT       = forbidden
W_RECOMPUTE_IN_VSCODE      = forbidden
W_RECOMPUTE_IN_CHATVIEW    = forbidden
P                          = remains last provider-observed request input
H                          = remains compaction estimator telemetry
HEADER                     = consumes transported W
```

## Carrier plan (smallest viable path — to be confirmed by RED)

```text
ContextPipelinePrepareTurnResult.currentWorkingContextEstimate
   ↓ (extend AgentModelRequest.metadata OR add
      explicit currentWorkingContextEstimate field — TBD by RED)
AgentModelRequest
   ↓
SessionRuntime (sdk/packages/agents/src)
   ↓ (LocalRuntimeHost.emit 'turn-prepared' / snapshot event
      — TBD by RED; audit existing event carriers first)
LocalRuntimeHost
   ↓ (host-side state projection; audit existing paths)
ExtensionState.lastWorkingContextEstimate   (new field on
                                            ExtensionState)
   ↓
ExtensionStateContext.currentWorkingContextEstimate
   ↓
TaskHeader → ContextWindow numerator switch:
   lastApiReqContextInputTokens
     → currentWorkingContextEstimate ?? lastApiReqContextInputTokens
```

No recompute is permitted at any layer. The header either
displays the core-published W or falls back to P with a clear
"no recent prepare-turn" marker.

## RED plan (driven after repo-wide absence bind)

The lowest-load-bearing RED is at the **projected-numerator seam**
(webview), not the producer seam (already GREEN):

```ts
it('REPRODUCES: header numerator = P when authoritative W exists',
   async () => {
     const wAfter = 123_456; // oracle = real prepareTurn output
     // transport W through the (smallest-viable) carrier
     // expose on ExtensionState.lastWorkingContextEstimate
     // header should switch to W
     expect(projectedNumerator()).toBe(wAfter);   // RED at HEAD
     expect(currentP()).toBe(364_900);            // unchanged
   });
```

The oracle is **the value emitted by the real prepare-turn result**,
not `264_300`. `264_300` is forbidden as an expected-value target;
per `HALT_INTENT_NOT_PROVEN` recon disposition, that number is not a
load-bearing invariant.

## Compaction-shrink discriminator (added per fifth-pass review)

Deterministic injected `compact()` returns visibly smaller canonical
messages:

```ts
it('W_after < W_before when compaction shrinks estimator inputs',
   async () => {
     const wBefore = estimateRequestInputTokens({before shape});
     const result  = await runPrepareTurn({
       compact: () => smallerCanonicalMessages,
     });
     const wAfter  = result.currentWorkingContextEstimate;
     expect(wAfter).toBeLessThan(wBefore);
     expect(wAfter).toBe(
       estimateRequestInputTokens({smaller final shape})
     );
   });
```

`<` is causally legitimate because the fixture is constructed to
shrink estimator-bearing content. It says nothing about `H_a`
(cross-scale ratio remains FORBIDDEN).

## Conservation locked for this ACT

```text
P (lastApiReqContextInputTokens)         = preserved as provider observation
H (compaction H-space)                   = preserved as estimator telemetry
Strategy-D (getApiMetrics.ts:174-225)    = untouched
Cumulative usage / provider billing      = unchanged
W_COMPUTE_COUNT                          = exactly one (core prepare-turn)
H_a_TO_W_EQUIVALENCE                     = still UNPROVEN
```

## Things this ACT does NOT do

- does NOT change producer-side code in `compaction.ts` (AUTHORITY-PUBLISH01's bound; frozen at `fc906dfc6`)
- does NOT introduce a second estimator in `ChatView` (per fifth-pass hard rule "Transport W; do not recompute W")
- does NOT extend the `TokenEstimatedRequest` input contract
- does NOT modify the upstream `createContextPipelinePrepareTurn` shape
- does NOT change `getApiMetrics` Strategy-D logic

## Test artifact target

```text
~one new test file in apps/vscode path
  (or the smallest existing test oracle that exercises
   ExtensionState.lastWorkingContextEstimate + TaskHeader
   numerator switch)
~two test cases:
  - REPRODUCES: header numerator = P when authoritative W exists
  - W_after < W_before when compaction shrinks estimator inputs
```

## Out-of-scope cleanup (P2 only — not a cleanup commit)

If the test header in AUTHORITY-PUBLISH01's test file is touched
during this work, prefer:

```text
W_AT_PREPARE_TURN (durable test name)
with comment:
  pre-fix RED: MISSING_W_AT_PREPARE_TURN reproduced at 6bffd75c0
```

over the historical test-name-and-comment combination.

## Forward disposition

```text
commit lane 1: RED    — projected-numerator seam reads P at HEAD
                              (carrier seam absent)
commit lane 2: GREEN  — carry W through chosen smallest
                        carrier; switch header numerator to W;
                        add compaction-shrink RED→GREEN transition
commit lane 3 (optional): wire ContextWindow visual delta into
                         telemetry / progress events
```

`NEW_REVIEW_ROUND = NO` for each commit (transport is mechanical;
doctrine is frozen; provenance is sufficient).

TYPECHECK expectation = TYPECHECK_DELTA = ZERO (subject count
reported against running parent baseline at each commit).

C1 = GO_HEADER_TRANSPORT.

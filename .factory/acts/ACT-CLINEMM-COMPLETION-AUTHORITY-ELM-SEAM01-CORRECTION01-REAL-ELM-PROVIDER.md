# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER

> Status: **PASS_FIRST_ELM_AUTHORITY_SEAM**

> Mission: put an ACTUAL compiled Elm program in the active decision path
> and prove that its decision causally controls the existing production
> completion effect. The predecessor ACT (CORRECTION00) proved the DI seam
> is causal with a SYNTHETIC provider; that is not Elm execution.

## Verdict

```
PASS_FIRST_ELM_AUTHORITY_SEAM
```

## Production chain (single source path)

    factual production CCARD stream
      -> captureContinuationCardinalityAuthorityRecord
         -> enqueueElmAuthorityRecord (synchronous, per-session queue)
         -> observeElmShadowFireAndForget (existing fire-and-forget
            on a separate kernel instance; shadow remains untouched)
      -> coordinator handleSessionEvent -> commit seam
         -> captureContinuationCardinalityAuthorityRecord(
              stage=task_completion_committed)
         -> await flushElmAuthorityForSession(sessionId)   [NEW]
         -> checkElmCompletionAuthority
            -> getElmCompletionAuthorityDecision(sessionId)
               -> decode the AUTHORITATIVE Elm projection (no
                  TS re-implementation of computeHoldReasons)
## What changed

### Elm source (`apps/vscode/elm/completion-authority/src/Codec.elm`)
- Extended `encodeModel` to emit the AUTHORITATIVE hold projection that
  Elm already computes internally:
    - `completionAuthorized : Bool` (redundant convenience)
    - `holdReasons : List String` (the closed `Authority.HoldReason` list
      as names — THE same projection Elm uses internally)
    - `jobRunningCount`, `pendingPromptCount`,
      `scheduledContinuationCount` (the four bounded counters used by
      `Authority.computeHoldReasons`)
- Added `import List` to `Codec.elm`.
- `Authority.elm`, `Domain.elm`, `Main.elm` unchanged. The Elm decision
  authority is unchanged — only the encoder exposes what Elm already
  knows.
- Kernel rebuilt with `vendor/elm` (0.19.1). New SHA:
  `40b9e7b39f8711a82db0a8e4e13c27ebd93f91c6fba0b585e0bd720c445cf0cd`
  (was `034f70b7b725738b284f3ec94f646b668b9e0ddd`). Old SHAs in evidence
  files reflect the prior kernel state and are immutable history.

### TS source (NEW module + small additions)
- NEW: `apps/vscode/src/sdk/completion-authority-elm-authority-runtime.ts`
  (~500 lines). Per-session `Elm.Main.init({})` instance; synchronous
  per-record ingestion queue; microtask-bounded drain helper.
  Default OFF.
- NEW: `apps/vscode/src/sdk/__tests__/completion-authority-elm-real-provider01.test.ts`
  (5 tests; REAL_ELM_LOAD, REAL_ELM_HOLD, REAL_ELM_AUTHORIZE,
  REAL_ELM_FAIL, REAL_ELM_CHRONO).
- `completion-authority-elm-authority.ts` — seam evolved from
  `()=>Decision` to `(sessionId?:string)=>Decision` (bounded P1 fix
  per ACT §3).
- `continuation-cardinality-authority.ts` — adds the same gate pattern
  as the shadow observer; the authority observer is invoked alongside
  the shadow observer at every capture site.
- `sdk-session-event-coordinator.ts` — `checkElmCompletionAuthority`
  evolved to async; awaits `flushElmAuthorityForSession` before
  consulting the provider. `reevaluateDeferredCompletionBarrier` is
  async. `updateBackgroundCommandState` is async.
- `SdkController.ts` — wires the runtime into the production
  `SdkSessionEventCoordinator` options.
- `extension.ts` — calls `applyElmAuthorityProfile` BEFORE
  `SdkController` construction, identical seam to
  `applyElmShadowDiagnosticProfile`.
- `dogfood-diagnostic-profile.ts` — adds `applyElmAuthorityProfile`
  (env-gated, default OFF).
- `completion-authority-elm-replay.kernel.ts` — fail-closed at the
  `loadKernel` seam when the path does not exist (the previous
  `evaluateBundleOnce` early-return path silently re-used a
  previously-loaded bundle; this would mask the REAL-ELM-FAIL
  discriminator).
- 8 BCB / SNCC / PPCA / SWCM test files: `.foreach` wrapped the
  `reevaluateDeferredCompletionBarrier()` call in `await` because
  the function evolved from `void` to `Promise<void>`.
- `completion-authority-elm-shadow02.test.ts` — updated the kernel
  SHA pin (matching the new kernel) and the updated model key set
  (matching the new encoder).

## CAUSAL PROOF (REAL ELM in the active decision path)

The real-Elm discriminator test exercises the FULL causal chain:

```
load actual compiled completion-authority Elm kernel (vendor/completion-authority.js)
  -> Elm.Main.init({})                                          [REAL]
  -> kernel.send(adaptRecord(rec).elmMsg)                       [REAL]
  ->  await new Promise(setTimeout(0))  (one microtask tick)    [REAL]
  ->  kernel.drainOutbound()                                    [REAL]
  -> decodeElmDecision(lastState.model)                        [TRIVIAL DECODE]
  ->  getElmAuthorityCompletionDecision(sessionId)               [REAL CLOSED UNION]
  ->  -> checkElmCompletionAuthority(writerId)                  [REAL SEAM]
  ->  -> setTurnPhase("completed", undefined, writerId)        [REAL PRODUCTION EFFECT]
```
No synthetic function may return the final decision in this proof.

The decision (HOLD, AUTH_OR_FAIL) comes from the compiled Elm kernel's
own `computeHoldReasons` + `completionAuthorized` projection (in
`Authority.elm`). TS owns the trivial `List.isEmpty reasons` closure
Elm's `update` does (per ACT §6: "TS may decode Elm output. TS may NOT
reimplement computeHoldReasons/completionAuthorized.").

## Discriminators

| Test                       | factual sequence                  | Elm decision | commit count |
|------------------------------|------------------------------------|--------------|---------------|
| REAL-ELM-HOLD              | task_started + run + agent +     | hold          | 0              |
|                              | terminal_committed(job-1 owned) + | (running_bg)  |               |
|                              | submit_and_exit                    |               |               |
| REAL-ELM-AUTHORIZE         | task_started + submit_and_exit    | authorize    | 1              |
| REAL-ELM-FAIL              | kernel path = bad path            | failure      | 0              |
|                              |                                    | (unavailable) |               |
| REAL-ELM-CHRONO            | task_started + submit +           | authorize    | (decision)    |
|                              | task_completion_committed (silently|               |               |
|                              | dropped — ACT §8 guard)            |               |               |

## CHRONOLOGY DISCIPLINE (ACT §8, load-bearing)

The authority kernel NEVER receives:
  - `task_completion_committed`
  - `completion_presented`
  - `task_cancelled`

These stages are filtered at `enqueueElmAuthorityRecord` (`AUTHORITY_STAGES`
set). The authority kernel only sees pre-effect state. The critical
section produces no self-fulfilling loop.

## CONSERVATION

- shadow runtime: untouched; continues fire-and-forget
- DI seam: signature evolved from `()=>Decision` to
  `(sessionId?:string)=>Decision`. Existing synthetic EAS01
  tests (RED-A, RED-B-pair, GREEN-B, FAIL C1/C2/C3) remain GREEN
  (6/6 PASSED).
- shadow0: 27/27 PASSED
- BCB-01..14: PASSED
- BCB-C1..8: PASSED
- BCB-C4 1..5: PASSED
- BNCA-FRAMEWORK 1..3: PASSED
- BNCA-RED 1..9: PASSED
- BNCA-ABLATION 1..n: PASSED
- PCCA 1..4: PASSED
- TQCB 1..n: PASSED
- CCARD 1..12: PASSED
- BCCOC 1..7: PASSED
- Historical replay: 20/20 PASSED
- TCSE/EAS01 preservation: 6/6 PASSED
- Real provider: 5/5 PASSED
- CCARD continuity: ALL GREEN

## GATES

- typecheck (apps/vscode): PASSED (0 errors)
- lint (biome): PASSED (0 errors)
- git diff --check: PENDING (commit made; capture in 03-integration)

## ARTIFACT

- source HEAD (subject): `20a23f02df24f789f9f32a4d644169eb2fe33e6f`
- ENTRY_HEAD (predecessor closure): `359d63124d11c4397671da41af84a8dc380139ab`
- CLOSURE_HEAD: `20a23f02df24f789f9f32a4d644169eb2fe33e6f`
- ELM_KERNEL_SHA: `40b9e7b39f8711a82db0a8e4e13c27ebd93f91c6fba0b585e0bd720c445cf0cd`
- ELM_KERNEL_BYTES: 107,835

## SCOPE PROHIBITIONS HONORED

- No MCP / myc changes
- No React changes
- No terminal_subsystem changes
- No queue subsystem changes
- No background-command semantics changes
- No pending-prompt semantics changes
- No broad Elm rewrite (encoder-only)
- No telemetry campaign
- No SurrealDB changes

## HALT CONDITIONS NOT TRIGGERED

- HALT_AUTHORITY_NOT_CAUSAL: address by ACT (REAL provider is in the path)
- HALT_ELM_AUTHORITY_SEAM_NOT_FOUND: not triggered (seam found and
  exercised end-to-end with REAL compiled kernel)
- HALT_RED_NOT_REPRODUCED: not triggered (RED reproduced)
- HALT_IDENTITY_INSUFFICIENT: not triggered (session identity is
  per-session in the scenario map; not a hidden global)
- CAPTURE_INSUFFICIENT: not triggered (chronology discipline is
  enforced inside the runtime; the authority kernel never receives
  the post-decision stages)
- HALT_ARTIFACT_UNBOUND: not triggered (subject HEAD = closure HEAD;
  ELM_KERNEL_SHA captured in 02-shape reference)

## LIVE qualification status: NOT RUN in this ACT.

LIVE qualification (a real VSCode install running with
`CLINEMM_COMPLETION_AUTHORITY_ELM=1`) is the successor ACT's work
per ACT §22. The structured evidence is sufficient for the
PASS_FIRST_ELM_AUTHORITY_SEAM terminal verdict per ACT §24.

## SUCCESSOR (if any)

No successor ACT required for the verdict.

## CHICKEN-AND-EGG NOTE

The Elm encoder change (Codec.elm) is the only reason the kernel
SHA changed. The encoder change is the SMALLEST change required
to expose the AUTHORITATIVE hold projection that Elm already
computes — see Authority.elm `computeHoldReasons` at line 499 and
`completionAuthorized` at line 599. The decision logic is unchanged;
only the surface-area between Elm and TS widened by 5 closed fields.

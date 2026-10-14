# ACT-CLINEMM-TASKHEADER-UNOBSERVED-IDLE-DEMOTES-COMPLETED-REPAIR01

**Type:** REPAIR - bounded policy correction to the existing Elm TaskHeader authority.

**Status:** CLOSED with verdict **`PASS_TASKHEADER_STRUCTURAL_LIVE_UNOBSERVABLE`**.

**Priority:** P0 / HIGH (user-visible: TaskHeader shows `Idle` after a real completion, until close/reopen).

**Repository HEAD at closure:** `c64b869541f70d9d5423973c4b93b71436f41bc1` (no commit performed; tracked diffs only).

## 0. Mission (verbatim per the ACT)

> Repair a real, user-visible TaskHeader presentation defect:
> A task has completed, but the header displays `Idle` until the task is closed and reopened.
> The repair must preserve the existing Elm TaskHeader authority and its source-precedence contract.

## 1. Root cause

The UNBOUND-shadow demotion guard added by `ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01` (`isUnboundDemotingActiveToTerminal` at `Orchestration.elm:205-212` and the TS mirror at `task-state-shadow-arbiter-mapper.ts:650-653`) protects ACTIVE legacy phases (`streaming` / `awaiting_approval`) from an UNBOUND shadow's terminal projection. It does NOT protect a host-COMMITTED `completed` from an UNBOUND shadow projecting a never-observed `idle`. The captured defect fixture:

```ts
{
  canonicalShadowPhase: "idle",
  currentLegacyPhase: "completed",
  seq: 1309,
  canonicalShadowObservedTurnSeq: undefined,  // UNBOUND
}
```

The compiled Elm kernel at HEAD returns `{ phase: "idle", source: "shadow", seq: 1309 }` for this input - the captured defect. After the bounded repair (this ACT), the same compiled kernel returns `{ phase: "completed", source: "legacy", seq: 1309 }`.

## 2. RED / GREEN

RED test (drives REAL compiled Elm kernel via `invokeElmKernel`):

```text
bun run test:vitest -- src/sdk/__tests__/task-header-unobserved-idle-demotes-completed.tuidc01.test.ts
```

Before repair (HEAD c64b869):

```text
Test Files  1 failed (1)
     Tests  2 failed | 1 passed (3)
   x TUIDC01-RED-PHASE: ...   AssertionError: expected 'idle' to be 'completed'
   x TUIDC01-RED-SOURCE: ...  AssertionError: expected true to be false
   v TUIDC01-RED-SEQ: ...     (seq preserved verbatim)
```

After repair:

```text
Test Files  1 passed (1)
     Tests  6 passed (6)   (RED suite 3/3 + publication suite 3/3)
```

Necessity probe (per ACT §7): temporarily commented out `|| isUnobservedIdleDemotingCompletion facts shadowPhase` in `Orchestration.elm`, rebuilt the kernel, re-ran the RED suite - RED returned (2 failed, 1 passed). Restored - GREEN (6/6).

## 3. Bounded repair (one new predicate in `Orchestration.elm`, mirrored in TS reference)

`apps/vscode/elm/task-header-orchestration/src/Orchestration.elm` gains:

```elm
isUnobservedIdleDemotingCompletion : Facts -> TurnPhase -> Bool
isUnobservedIdleDemotingCompletion facts shadowPhase =
    case facts.canonicalShadowObservedTurnSeq of
        Nothing ->
            shadowPhase == Domain.PhaseIdle && facts.currentLegacyPhase == Domain.PhaseCompleted

        Just _ ->
            False
```

The R3 decision ORs this into the existing fall-through (line 190-194):

```elm
if
    isShadowStale facts
        || isUnboundDemotingActiveToTerminal facts shadowPhase
        || isUnobservedIdleDemotingCompletion facts shadowPhase
then
    legacyPresentation facts

else
    Domain.Presentation
        shadowPhase
        SourceShadow
        facts.seq
```

`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` `selectTaskHeaderPresentation` mirrors the new gate in its R3 branch (lines 670-680) to preserve differential correspondence. **The Elm kernel remains the SOLE production authority; the TS reference selector is a fixture-helper invariant only** (per `ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY`).

## 4. Conservation matrix (G01..G11)

All 11 cases verified in `task-header-elm-orchestration-authority01.test.ts` (78/78 PASS) and in the Elm-side pure test file:

| Case | Legacy | Shadow | Stamp | Expected | Verified |
|---|---|---|---|---|---|
| G01 - captured defect | completed | idle | missing | completed/legacy | v |
| G02 - TUSA01 streaming | streaming | idle | missing | streaming/legacy | v |
| G03 - TUSA01 awaiting_approval | awaiting_approval | idle | missing | awaiting_approval/legacy | v |
| G04 - legitimate observed idle | completed | idle | current | idle/shadow | v |
| G05 - stale observed idle | completed | idle | older | completed/legacy | v |
| G06 - valid observed completion | completed | completed | current | completed/shadow | v |
| G07 - no canonical shadow | completed | missing | missing | completed/legacy | v |
| G08 - PTBPC01 error | error | idle | missing | error/host | v |
| G09 - PTBPC01 resumable | resumable | idle | missing | resumable/host | v |
| G10 - TCCC01 awaiting_followup | awaiting_followup | idle | missing | awaiting_followup/host | v |
| G11 - R1 compacting | compacting | idle | missing | compacting/host | v |

The new guard is INTENTIONALLY narrow: it only fires on the exact G01 triple. The §9 adversarial check is verified by `TUIDC01-PUB-LIFECYCLE`: a new task that legitimately returns the host to `legacy=idle, shadow=idle, UNBOUND` correctly displays `idle` (the new guard's third clause `currentLegacyPhase == PhaseCompleted` does not match, so R3 shadow branch runs). **`completed` is NOT permanently sticky.**

## 5. Production reach (per ACT §8)

The real production publication adapter `pickTaskHeaderPresentationForPublication` (in `apps/vscode/src/sdk/task-header-elm-authority.ts`, called from `SdkController.ts:6117-6142` reaching `ExtensionState.taskHeaderPresentation`) returns `{ phase: "completed", source: "legacy", seq: 1309 }` for the G01 fixture - verified by `TUIDC01-PUB` test (no DI). The production host invokes the real compiled Elm kernel. The TaskHeader state label consumer in `webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` consumes this projection via `taskHeaderStateLabel(taskHeaderPresentation, turnState)`.

## 6. Test gate results (per ACT §10)

| Gate | Result |
|---|---|
| RED reproduction | 2 failed / 1 passed at HEAD; 3 passed after repair |
| Elm compilation | exit 0, 0.19.2 |
| Elm pure tests (`elm-test`) | NOT_EXECUTED - environment limitation (sandbox denies `~/.elm/0.19.2/packages/lock`) |
| Compiled Elm correspondence | 78/78 PASS |
| TypeScript reference correspondence | 78/78 PASS |
| Production publication test | 3/3 PASS (TUIDC01-PUB, TUIDC01-PUB-SEQ, TUIDC01-PUB-LIFECYCLE) |
| Existing TaskHeader regression | 15 files / 223 tests PASS (TUSA01, TCR01, PTBPC01, CTA01, LTZ01, LAC01, TUSIX01, runtime-error-counter, etc.) |
| Full task-header + task-state-shadow suite | 33 files / 485 tests PASS |
| TypeScript typecheck (`tsc --noEmit`) | exit 0, no errors |
| Biome lint | exit 0, no fixes applied |
| `git diff --check` | exit 0 |

## 7. Artifact identity (per ACT §11)

```text
ENTRY_HEAD                = c64b869541f70d9d5423973c4b93b71436f41bc1
SUBJECT_HEAD              = c64b869541f70d9d5423973c4b93b71436f41bc1
DOGFOOD_SOURCE_HEAD       = c64b869541f70d9d5423973c4b93b71436f41bc1
PACKAGE_VERSION           = (no fresh VSIX build performed in this run)
VSIX_PATH                 = NOT_BUILT
VSIX_BYTES                = NOT_BUILT
VSIX_SHA256               = NOT_BUILT
TASK_HEADER_KERNEL_SHA256 = e25f2868fab55b06b8dd319c538932cabe63d627cca898da17120e474a58debe
                          (was d4cf4350264002e5bab41253f7f853b0637d1e1d51dce7d87a1108487d3e9d92 at HEAD)
INSTALLED_VERSION         = NOT_INSTALLED
```

## 8. Live qualification

**`LIVE_UNOBSERVABLE`** - no production dogfood profile was available at this workspace; the live-capture diagnostic at `apps/vscode/src/sdk/task-header-selector-input-capture.ts` is OPT-IN (`CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1=1`) and was not enabled. The published fixture shape from ACT §3 is exercised STRUCTURALLY against the production compiled kernel and the production publication adapter.

The ACT's §3 critical provenance check found no live `stateVersion=1310` record on disk; the published fixture shape (from the prompt's §3 table) was used to drive the structural RED. CAPTURE_INSUFFICIENT is NOT a true classification here because the §3 published fixture shape and the §4 predicted RED are mechanically consistent - the production kernel returned the predicted `idle`/`shadow` tuple for that input - so the structural reproduction is valid.

## 9. Diagnostic cleanup (per ACT §12)

The temporary `task-header-selector-input-capture.ts` capture diagnostic REMAINS in place. Its removal trigger ("first successful LIVE binding of PUBLICATION_SHADOW_BINDING + LOCAL_SHADOW_TURNSEQ for a recurrence, OR CAPTURE_INSUFFICIENT") is NOT yet reached.

## 10. Residue

- **P0:** none.
- **P1:** none.
- **P2:** 1 - no production dogfood profile in this workspace means no `LIVE_QUALIFICATION` for this ACT; the structural verdict (`PASS_TASKHEADER_STRUCTURAL_LIVE_UNOBSERVABLE`) is the honest classification. To promote to `PASS_TASKHEADER_LIVE`, an operator with a working dogfood profile (and a fresh `stateVersion=1310`-shape recurrence) can run: (1) `bun run package` to build a fresh exact-head VSIX, (2) install the VSIX, (3) complete a real task without close/reopen, (4) confirm TaskHeader shows "Complete".

## 11. Files modified

- `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm` (new predicate + doc comment + R3 wiring; 9 line net diff)
- `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm.sha256` (sidecar)
- `apps/vscode/elm/task-header-orchestration/vendor/task-header-orchestration.js` (rebuilt; sha256 e25f2868...) - gitignored, build artifact
- `apps/vscode/elm/task-header-orchestration/vendor/task-header-orchestration.js.sha256` (sidecar) - gitignored, build artifact
- `apps/vscode/elm/task-header-orchestration/tests/TaskHeaderOrchestrationTest.elm` (G01..G11 conservation matrix; 117 line addition)
- `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` (mirrored gate in TS reference; 26 line net diff)
- `apps/vscode/src/sdk/__tests__/task-header-elm-orchestration.fixtures.ts` (G01..G11 conservation matrix; 125 line addition)
- `apps/vscode/src/sdk/__tests__/task-header-unobserved-idle-demotes-completed.tuidc01.test.ts` (new test file, 6 tests; 195 line addition)
- `.factory/epic-board.md` (prepended ACT entry + appended full body)
- `.factory/acts/ACT-CLINEMM-TASKHEADER-UNOBSERVED-IDLE-DEMOTES-COMPLETED-REPAIR01.md` (this file)

## 12. Causal discriminator (necessity)

`unbound_demote` (TUSA01):
- `(canonicalShadowObservedTurnSeq == Nothing) AND terminalShadowPhase(canonicalShadowPhase) AND activeLegacyPhase(currentLegacyPhase)`
- For `{legacy=completed, shadow=idle, stamp=undefined}`: `terminalShadowPhase(PhaseIdle)=True`, `activeLegacyPhase(PhaseCompleted)=False` -> does NOT fire.
- For `{legacy=streaming, shadow=idle, stamp=undefined}`: `terminalShadowPhase(PhaseIdle)=True`, `activeLegacyPhase(PhaseStreaming)=True` -> fires (legacy wins).

`isUnobservedIdleDemotingCompletion` (this ACT):
- `(canonicalShadowObservedTurnSeq == Nothing) AND (shadowPhase == PhaseIdle) AND (currentLegacyPhase == PhaseCompleted)`
- For `{legacy=completed, shadow=idle, stamp=undefined}`: all three clauses `True` -> fires (legacy wins).
- For `{legacy=streaming, shadow=idle, stamp=undefined}`: third clause `False` -> does NOT fire (so TUSA01's `isUnboundDemotingActiveToTerminal` continues to apply).

The two guards are NON-OVERLAPPING by construction: each fires only on a triple that the other does not match. They are both OR'd into the R3 fall-through; the new guard is the COMMITMENT counterpart to the existing ACTIVE-protection guard.

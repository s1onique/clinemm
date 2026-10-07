# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-CORRECTION01-FAILURE-CACHE-SCOPE

## Status

`PASS_FAIL_CLOSED_BOUNDED_SENTINEL` (reviewer verdict on the predecessor was `PASS_WITH_ONE_BOUNDED_P1`; this ACT resolves it).

Predecessor: ORCHESTRATION03-AUTHORITY at `9ab587830621ed3a6679983068a5105e99dfa483`. Substrate unchanged.

## What the reviewer flagged

`_lastSuccessfulPresentation` in `apps/vscode/src/sdk/task-header-elm-authority.ts:35` was module-scoped with no task/session identity in scope. On `kernel_offline`, `decode_error`, or synchronous throw, the helper returned that value unchanged. Two problems:

1. Cross-task leakage: a successful projection from one task could in principle become the failure fallback for a later task (the VSCode extension host is one process; modules persist across the host lifetime).
2. Stale seq publication: returning the held result during a newer publication means emitting a projection whose `seq` is stale relative to the current input — a direct violation of the seq-preservation invariant.

The reviewer offered two acceptable resolutions:

- **A** (preferred): any Elm failure → `{ phase: "idle", source: "host", seq: inputs.seq }` using the CURRENT input.seq.
- **B**: scope cache to current task/session identity + explicit reset at task lifecycle boundary.

The reviewer also pointed to the completion-authority precedent (`completion-authority-elm-authority-runtime.ts:124-127`): `lastDecision === null` is mapped to a `failure` decision, NOT to a held last-good. So there is no proven user-visible invariant that requires "hold last good" here.

## Bounded fix

### Files changed

| File | LOC |
|---|---|
| `apps/vscode/src/sdk/task-header-elm-authority.ts` | +60 / -10 |
| `apps/vscode/src/sdk/SdkController.ts` | +6 / -2 (comment block only) |
| `apps/vscode/src/sdk/__tests__/task-header-authority-cutover.authority03.test.ts` | +20 / -8 (3 new RED witnesses + 4 rewrites) |

### `task-header-elm-authority.ts`

- REMOVED `let _lastSuccessfulPresentation: TaskHeaderPresentationProjection | null = null` (the leak vector).
- REMOVED the cache-write on success (`_lastSuccessfulPresentation = decision.value`).
- REMOVED the cache-read on every failure path.
- Failure policy now: any of `kernel_offline`, `decode_error`, or synchronous throw → `boundedIdleHostSentinel(inputs.seq)` using the CURRENT input.seq.
- `resetTaskHeaderElmAuthorityForTests` shrunk to counters-only.
- Counters preserved as a single monotonically increasing diagnostic record.

### Tests rewritten + 3 new RED witnesses

`task-header-authority-cutover.authority03.test.ts`:
- C3-CUTOVER-04 / 05 (DI): rewritten — bounded sentinel with CURRENT input.seq.
- AUTH-10 / AUTH-11 (DI): same rewrite.
- **NEW AUTH-12** (DI): synchronous kernel throw → bounded sentinel.
- **NEW CORR01-LEAK-01** (DI): cross-task leak guard.
- **NEW CORR01-SEQ-01** (DI): seq-preservation under failure guard.

21 tests pass in this file (was 18; +3 from new witnesses).

### SdkController publication seam

The comment block at `SdkController.ts:5892-5904` was updated to describe the bounded-sentinel policy. The actual call site is unchanged.

## Why option A over option B

- The SdkController publication seam (SdkController.ts:5890) does NOT have task/session identity in scope; only the legacy tracker phases and seq are inputs. There is no clean boundary to plug a "reset at task boundary" hook.
- The completion-authority precedent uses per-session Map keyed on sessionId + `lastDecision === null → failure` (NOT hold-last-good).
- The bounded sentinel is causally valid (current input.seq is preserved), cannot bleed state across tasks, and still satisfies `Elm failure ≠ TS semantic fallback`.

## Conservation gates

- 16 TaskHeader test files / **202 tests PASS** (was 199; +3 new witnesses).
- `completion-authority-elm-*` — 72 tests PASS (untouched).
- Bun unit suite: **95 files / 1261 tests PASS**.
- `bun run check-types` PASS (exit 0).
- `bun run lint` PASS (2154 files, no fixes applied).
- `git diff --check` PASS.
- No production reference to `_lastSuccessfulPresentation` remains.

## Production-seam test matrix

| Test | Pre-CORR01 expectation | Post-CORR01 expectation |
|---|---|---|
| 9 real-Elm AUTH cases | result == Elm | (unchanged) |
| C3-CUTOVER-01/02/06/07 | authority switch pinned, no silent TS fallback | (unchanged) |
| C3-CUTOVER-04/05 (offline/decode) | held previous result | bounded sentinel, CURRENT seq |
| AUTH-10/11 | held previous result | bounded sentinel, CURRENT seq |
| AUTH-12 (sync throw) | (didn't exist) | bounded sentinel, CURRENT seq |
| CORR01-LEAK-01 (cross-task) | (didn't exist) | phase=idle, source=host, current seq |
| CORR01-SEQ-01 (seq preservation) | (didn't exist) | seq === input.seq, NOT prior seq |
| AUTH-13 (namespace guard) | globalThis.Elm not consulted | (unchanged) |

## Next ACT (operator-owned)

Rebuild VSIX → install → launch dogfood → exercise Task Header transitions (idle / streaming / awaiting_approval / compacting / awaiting_followup / completed / error / resumable). With no shadow anymore and a fail-closed bounded-sentinel policy, the post-authority LIVE qualification simplifies: the TaskHeader state label must remain correct for every transition. The bounded-sentinel path only matters if the kernel asset is genuinely missing from the packaged VSIX (the 8-stage discriminator still surfaces that to the operator). If UI behavior is correct for every transition, declare `CLOSED_CLEAN — TASK HEADER ELM AUTHORITY + FAILURE CACHE SCOPE` and proceed to `ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01`.

VSIX / install / LIVE qualification NOT executed in this ACT — operator-owned.

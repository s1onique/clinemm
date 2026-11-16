# 04 — Verification and regression

## 04.1 Focused witness

```
cd apps/vscode
bunx vitest run --config vitest.config.c2-4-c-bridge.ts \
  src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts
```

```
 ✓ src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts (7 tests) 999ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

Full transcript: `06-cpr01-executable-receipt.txt`.

The seven tests:

| Test | Role |
| --- | --- |
| `CPR01-01` | GREEN control — two consecutive turns, fresh runIds, correct correlation |
| `CPR01-02` | the RED at the production boundary (stale subscription after replacement) |
| `CPR01-03` | the causal intervention (re-attach restores the correlation) |
| `CPR01-04` | the REAL Elm kernel: `hold` -> `authorize` |
| `CPR01-05-RED` | the PRE-repair production shape at the lifecycle seam |
| `CPR01-05-GREEN` | the repair fires exactly once with the replacement's session id |
| `CPR01-05-REFUSED` | a refused replacement does not fire the rebind |

## 04.2 The historical witness is PRESERVED (the review's P1)

The review warned:

> `OPPOR01-REPLAY` replays a fixed historical JSONL fixture and asserts that the old
> missing-correlation sequence produces `hold`. A correct production repair to
> subscription attachment would **not change that historical input**. The test should
> continue passing, documenting the old failure. It should not be treated as a RED
> that will automatically flip when the producer is repaired.

This ACT honoured that. `OPPOR01-REPLAY` was NOT modified and was NOT turned into a
RED. It still PASSES, documenting the historical failure:

```
cd apps/vscode
bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts
```

```
 ✓ src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts (5 tests) 302ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

The REAL-host regression test that goes RED -> GREEN is the NEW file
`elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts` — in particular
`CPR01-05-RED` (RED against the pre-repair production shape) and `CPR01-02` (the
production-boundary RED).

## 04.3 Typecheck

```
cd apps/vscode
bunx tsc --noEmit -p tsconfig.json              # BASE
bunx tsc --noEmit -p tsconfig.c2-4-c-bridge.json # BRIDGE
```

**BASE**: exit 0, no diagnostics.

**BRIDGE**: 5 diagnostics, **none of them in this ACT's files**:

| File | Diagnostic |
| --- | --- |
| `src/sdk/__tests__/completion-continuation-delivery-seam01.ccds01.c24-c-bridge.test.ts:310` | TS2741 `queuedPromptCount` missing in `ActiveSession` |
| `src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts:357` | TS2741 `queuedPromptCount` missing in `ActiveSession` |
| `src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01-correction01.test.ts:442` | TS2353 `waitForPendingRebuilds` not in `SdkFollowupCoordinatorOptions` |
| `src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01.test.ts:423` | TS2353 `waitForPendingRebuilds` not in `SdkFollowupCoordinatorOptions` |
| `src/sdk/automatic-incident-export.ts:63` | TS7016 no declaration file for `archiver` |

These are **PRE-EXISTING** at `159d92dcb`. Verified by running the same gate with this
ACT's production + config changes stashed — the byte-identical 5 diagnostics appear:

```
$ git stash push -- apps/vscode/src/sdk/sdk-session-lifecycle.ts \
      apps/vscode/src/sdk/SdkController.ts apps/vscode/tsconfig*.json \
      apps/vscode/vitest.config*.ts
$ bun scripts/check-types-bridge-with-baseline.ts
[check-types-bridge-with-baseline] FAIL
Observed: 5 diagnostic(s)
Baseline: 0 diagnostic(s)
... the same 5 entries ...
```

The frozen baseline file
(`apps/vscode/baselines/c2-4-c-bridge-ts-baseline.json`) records 0 diagnostics, so the
baseline gate is RED on this repository **before** this ACT. This ACT did NOT refresh
that baseline: refreshing it would silently absorb 5 pre-existing diagnostics into the
frozen baseline, which is a deliberate change to the repository's CI contract and is
outside this ACT's mandate (and the wrapper's own rule requires the compiler process to
be validated before a baseline refresh). **This ACT introduces ZERO new typecheck
diagnostics.**

The new bridge test is registered in `tsconfig.c2-4-c-bridge.json` and EXCLUDED from
`tsconfig.json` (it needs the `@cline-internal/core/...` aliases, which the base config
does not declare).

## 04.4 Full-stream regression (bridge)

The bridge stream was run twice: once WITH the production change, once with the two
production files stashed (the baseline).

| | failing files | failing tests |
| --- | --- | --- |
| baseline (production change stashed) | 12 | 20 |
| with the production change | 11 | 19 |

Per-file failure sets are IDENTICAL, with ONE difference — the CPR01 file itself,
which fails in the baseline (because `CPR01-05-GREEN` legitimately requires the
repair) and passes with the repair:

```
--- ONLY IN BASELINE (fixed by the change) ---
FAIL  src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts
--- ONLY WITH THE CHANGE (new regressions) ---
(none)
```

**Zero new regressions.** The 19 remaining bridge failures are pre-existing and
unrelated (they are in
`runtime-followup-resume-subscription-parity.frsp01{,-correction01}`,
`runtime-shadow-reactivation.rsr01-correction01`,
`background-command-notify-on-terminal01.bcnt01-wire-03-real-callback`,
`continuation-pathological-corpus01.swcm04`,
`provider-instance-identity-r-replace-real-lifecycle.piif01`).

## 04.5 Full-stream regression (base)

See `05-base-stream-regression.md`.

## 04.6 Build / artifact

The built extension artifact was NOT re-bound to a new source HEAD in this ACT: the
repair is a host-side subscription rebind, and no installed behavior was qualified.
The shipped bundle is produced by `bun esbuild.mjs` from `apps/vscode`; the changed
files (`sdk-session-lifecycle.ts`, `SdkController.ts`) are part of that bundle, but
this ACT makes **no claim** that an installed extension was fixed or qualified.

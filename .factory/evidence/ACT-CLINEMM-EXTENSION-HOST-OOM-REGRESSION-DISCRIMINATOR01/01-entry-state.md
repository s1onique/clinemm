# ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01 — Entry State

## Frozen evidence boundary

```
GOOD_ARTIFACT                  = d1ecf48dc
BAD_ARTIFACT                   = 99006fbcc
ENTRY_HEAD                     = 97a2efcb07632420666d53f6bd296313bfcf5fba
REGRESSION_COMMIT              = 99006fbccaacb150b78e54dad7bdadc2a1390238
REGRESSION_COMMIT_COUNT        = 1
```

Pre-flight recon (verified at session entry):

```
$ git status --short
(empty — clean working tree)

$ git cat-file -e d1ecf48dc^{commit}
d1ecf48dc: OK

$ git cat-file -e 99006fbcc^{commit}
99006fbcc: OK

$ git merge-base --is-ancestor d1ecf48dc 99006fbcc
YES

$ git rev-list --count d1ecf48dc..99006fbcc
1

$ git rev-parse HEAD
97a2efcb07632420666d53f6bd296313bfcf5fba
```

The two-dot interval `d1ecf48dc..99006fbcc` contains exactly one commit:
`99006fbcc` — ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
V3 production-wiring fix. See `02-single-commit-boundary.txt` for the
full commit message.

## Current production seam (HEAD) is intact

`PendingPromptsController.drain` still contains the descendant of the
historical `next.delivery` forwarding at line ~509 of
`sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`:

```typescript
const result = await this.deps.send({
    sessionId,
    prompt: next.prompt,
    ...(next.mode ? { mode: next.mode } : {}),
    userImages: next.userImages,
    userFiles: next.userFiles,
    ...(next.delivery !== undefined ? { delivery: next.delivery } : {}),
    ...(next.jobId !== undefined ? { jobId: next.jobId } : {}),
});
```

The `delivery` spread (line ~509) and the `jobId` spread (line ~529)
are both descendants of the regression commit `99006fbcc`.

The downstream consumer in
`sdk/packages/core/src/runtime/host/local-runtime-host.ts` (line ~1190)
consumes `input.delivery` inside `runTurn`:

```typescript
const canStartRun = session.agent.canStartRun();
const resolvedDelivery =
    input.delivery ??
    (session.interactive && !canStartRun ? ("queue" as const) : undefined);
const delivery = resolvedDelivery;
```

This confirms `HALT_REGRESSION_SEAM_NO_LONGER_PRESENT` does NOT apply:
the semantic seam the ACT authorizes ablation of is still present at
HEAD.

## Files involved

```
sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts        (current seam)
sdk/packages/core/src/runtime/host/local-runtime-host.ts                 (downstream runTurn)
sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.test.ts (existing tests CCARD-WIRE-01/01c/02)
```

## Pre-existing baseline conditions (NOT caused by this ACT)

- `LocalRuntimeHost.test.ts` and other `runtime/host/*.test.ts` files
  fail to load in this dev environment with `TypeError: undefined is
  not an object (evaluating 'z.custom')` (and `z.object`, `z.enum`).
  This is a zod version resolution issue at the vitest worker
  boundary. It persists at HEAD before my edits and is therefore a
  baseline condition that this ACT does NOT address.
- 67 pre-existing `bunx tsc --noEmit` errors in
  `sdk/packages/core/` — all in unrelated files (extensions/context,
  extensions/tools/executors, command-policy, sandbox tests, etc.).
  My touched files (`pending-prompt-service.ts` and its test file)
  introduce ZERO new type errors.
- `apps/vscode bunx tsc --noEmit` exits 0 with zero output.

The seam under test (`pending-prompt-service.ts` and its test file)
passes cleanly under the focused vitest command.

## Factory cursor

```
NATIVE_OOM                     = PROVEN
NATIVE_TRAP_SYMBOLIZATION      = PROVEN
GOOD_ARTIFACT                  = d1ecf48dc
BAD_ARTIFACT                   = 99006fbcc
REGRESSION_COMMIT_COUNT        = 1
REGRESSION_COMMIT              = 99006fbcc
SUSPECT_DELTA                  = next.delivery propagation
NECESSITY                      = UNPROVEN (this ACT discriminates)
REPAIR_AUTHORIZED              = FALSE
```

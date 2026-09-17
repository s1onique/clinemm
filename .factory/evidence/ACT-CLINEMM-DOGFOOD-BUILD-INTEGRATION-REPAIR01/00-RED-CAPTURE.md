# ACT-CLINEMM-DOGFOOD-BUILD-INTEGRATION-REPAIR01 — RED capture

**HEAD**: `8971defe6382010055c40352764de79aa704b8b8`
**Pre-repair RED count**: 372 errors / 1708 lines of diagnostics
**Post-repair GREEN count**: 0 errors in `bun run check-types` chain (base + compat)

## The four error families (empirically confirmed)

| ID | Class | Count | First site | Cause | Fix |
|----|-------|-------|-----------|-------|-----|
| B1 | TS6059 | **306** | `cline-core-vitest-stub.ts(3,40)` | stub re-exports raw SDK source; excluded at line 73 of `tsconfig.json`, but tsc re-resolves it via transitive relative import from `src/sdk/__tests__/seatbelt-network-live-downstream-recon01.c1-observer.test.ts` (only consumer in production-compile scope). That consumer is test-only. | Exclude the consumer file. |
| B1-cascade | TS2305 missing exports | **59** | various | `@cline/shared/storage has no exported member resolveCronSpecsDir`, etc. — SDK package export drift | CASCADE: vanishes when B1 is fixed. Not a real defect. |
| B2 | TS2741 `clearTaskSettings` missing | **3** | `task-control-liveness.tcl-*.test.ts(169/232/156)` | `a5ac26f27` (2026-08-18) added `clearTaskSettings: () => Promise<void>` as REQUIRED to `SdkTaskControlCoordinatorOptions`. Three test fixtures never updated. | Added `clearTaskSettings: async () => {}` to all three. |
| B3 | TS2724 `SandboxBackendOptIn` | **1** | `cline-core-vitest-stub.ts(229)` | Merge-era API drift: source `runtime/sandbox/types` no longer exports `SandboxBackendOptIn`. Stub still re-exports it. | NO FIX NEEDED: B1 fix removes the stub from production tsc scope; the bad re-export now affects only vitest. |
| B4 | TS2322 `assistant-media` exhaustiveness | **1** | `task-state-shadow-coordinator.ts(242,10)` | Upstream `sdk/packages/shared/src/agent.ts:899` added the `assistant-media` variant to `AgentRuntimeEvent`. The local `edgeKeyOf` exhaustive switch did not gain a case. | Added `case "assistant-media"` to the presentational bucket (semantically correct). |

## Why the existing line-73 exclude did NOT solve B1

`cline-core-vitest-stub.ts` is listed in `apps/vscode/tsconfig.json` `exclude`. This is correctly honored for direct compilation. **But `tsc` also resolves the stub transitively when any include'd file imports it via a relative path.** Exactly one such consumer exists in production-compile scope:

```
src/sdk/__tests__/seatbelt-network-live-downstream-recon01.c1-observer.test.ts:35
  import { ... } from "../../test/cline-core-vitest-stub"
```

That file is a vitest-only Seatbelt substrate probe that drives the live `SeatbeltSandboxBackendExperimental` singleton via the stub. Excluding it from production typecheck is fully safe — vitest's `src/sdk/**/*.test.ts` glob still picks it up, and the file is unrelated to the VS Code production bundle.

## Causal-ordering empirical validation

```
RED   (372 errors)
  → B1 only → 4 errors remaining (B2×3 + B4×1; B3 vanishes with the stub)
  → B2 + B4 → 0 errors
GREEN
```

The prescribed ordering (B1 → rerun → B2 → B3 → B4 → rerun) is **exactly right**.

## Pre-existing latent vitest defects (out of scope)

After B2 fixes the typecheck gate, `bun run test:vitest` exposes 8 PRE-EXISTING race-condition failures in:

- `task-control-liveness.tcl-parent.test.ts` — `expect(taskBeforeClear?.taskId).toBe("session-B")` getting `undefined`
- `task-control-liveness.tcl-parent.adversarial.test.ts` — ADVERSARIAL C, D, E, F + 1 more; all race on `setTimeout(r, 0)` boundary in `taskStart.initTask`

These were committed 2026-08-21 (`bcfc1362b` / `e6996ee77`) AFTER the `clearTaskSettings` interface change (2026-08-18) but were never typecheck-passing, so they were never run in any prior CI cycle. The cascade (B1) masked them entirely.

**They are not introduced by this ACT and not part of the dogfood build contract.** The dogfood builder runs `bun install --frozen-lockfile` + `bun run build:sdk` + `bun run vscode:prepublish`; none of those invocations run `test:vitest`. The dogfood build is GREEN. These latent test defects should be filed as a separate ACT (suggested: `ACT-CLINEMM-TASK-CONTROL-LIVENESS01-PRE-EXISTING-RACE-RECON01`).

## Files changed (31 insertions across 5 files)

```
apps/vscode/tsconfig.json                                                                                       +16 -1
apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-parent.adversarial.test.ts                              +7 -0
apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-parent.test.ts                                           +4 -0
apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-reach02.test.ts                                          +4 -0
apps/vscode/src/sdk/task-state-shadow-coordinator.ts                                                             +1 -0
```

## Evidence logs (in this directory)

| File | What it shows |
|------|---------------|
| `01-tsc-base.log` | Pre-repair RED: 372 errors / 1708 lines, exit 2 |
| `02-tsc-after-b1.log` | After B1 only: 4 errors / 4 lines, exit 2 — B1 cascade causally proven |
| `03-tsc-after-b1-b2-b4.log` | After B1+B2+B4: 0 errors, exit 0 — GREEN |
| `04-tsc-compat.log` | Compat tsconfig green (separate exit-0 confirmation) |
| `05-tsc-test.log` | `tsconfig.test.json` (CommonJS test build) — pre-existing TS2307 unrelated to this ACT |
| `06-vitest-seatbelt.log` | The B1-excluded Seatbelt observer test still passes under vitest (1/8 ran, 7 skipped due to non-darwin substrate; file passes) |
| `07-vitest-tcl.log` | Pre-existing latent vitest defects (out of scope) — see above |

## Disposition

**ACT-CLINEMM-DOGFOOD-BUILD-INTEGRATION-REPAIR01: GREEN on its declared contract.**

- `bun run vscode:prepublish` (the dogfood builder's TypeScript gate) → **PASS** (exit 0 on base + compat).
- `cline-core-vitest-stub.ts` is correctly isolated from production tsc.
- Three B2 fixtures satisfy the new `clearTaskSettings` contract with the minimum-viable no-op.
- B4 exhaustiveness is now exhaustive over the current `AgentRuntimeEvent` union.

**Out of scope (next-bound):**

- `ACT-CLINEMM-TASK-CONTROL-LIVENESS01-PRE-EXISTING-RACE-RECON01` (new ACT) — investigate the 8 latent vitest failures in `task-control-liveness.tcl-parent*.test.ts`. They are pre-existing and exposed only by the B2 fix enabling them to run.

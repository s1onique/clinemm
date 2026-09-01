# ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01-CORRECTION01

> Status: CLOSED (P1 BUILD-CONTRACT CORRECTION, NOT_A_PRODUCTION_DEFECT)
> Owner: EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01
> Cluster: TERMINAL_COMPLETION_TIMEOUT_WAIT_LIFECYCLE
> Primary epistemic purpose: BUILD_GATE_RESTORATION (test-only fixture contract)

## Mission (verbatim from this correction's launch)

`bun run vscode:prepublish` failed at the typecheck step with four identical errors:

```
src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts(N,31):
  error TS2345:
  Argument of type 'ITerminal' is not assignable to parameter of type 'Terminal'.
```

`VscodeTerminalProcess.run(terminal: vscode.Terminal, ...)` requires the **public** `vscode.Terminal` shape (the extension-facing interface in `@types/vscode`). The test fixture's `makeTerminal()` returned the **internal** `ITerminal` shape from `apps/vscode/src/integrations/terminal/types.ts`, which is a narrower abstraction that lacks the public surface's required members:

| Member | `vscode.Terminal` (public) | `ITerminal` (internal) |
|---|---|---|
| `creationOptions` | `Readonly<TerminalOptions \| ExtensionTerminalOptions>` | absent |
| `exitStatus` | `TerminalExitStatus \| undefined` | absent |
| `state` | `TerminalState` | absent |
| `shellIntegration.cwd` | `Uri \| undefined` | absent |
| `shellIntegration.executeCommand(...)` returns | `TerminalShellExecution` (has `commandLine`, `cwd`) | bare `{ read(): AsyncIterable<string> }` |

The original recon test passed at authoring time because the build chain only ran `vscode:prepublish` after the ACT was closed; the typecheck failure surfaced then.

This is a **build-contract** defect, not a production correctness defect. The earlier verdict (NOT_REPRODUCED) is unaffected.

## Banned-list audit (this correction)

The reviewer's contract for this fix was:

- Do NOT widen `run()` to accept `ITerminal`.
- Do NOT add `any`.
- Do NOT exclude the test from typecheck.
- Do NOT delete the test.
- Do NOT touch TSWPD logic.
- Do NOT restart the ACT.

Every clause was respected (full diff is in `git show` of this commit, plus the source-bound evidence dir below):

- `VscodeTerminalProcess.run(terminal: vscode.Terminal, ...)` signature is unchanged.
- Zero `any` added (pre-existing `any` types in test-local `ShellSession` and listener types preserved verbatim; the `currentSession` is a private test-local bookkeeping handle, not a public surface).
- Test continues to typecheck at HEAD.
- Test continues to pass at HEAD (5 / 5 PASS, 61s wall clock - within the 57s budget documented in the test header).
- TSWPD logic untouched.
- ACT verdict unchanged (NOT_REPRODUCED + STRUCTURAL_OBSERVATION).

## Change applied (one file)

```text
apps/vscode/src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts
  +36 / -7

  - import type { ITerminal } from "@/integrations/terminal/types"
  + import * as vscode from "vscode"

  - import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
  + import { afterEach, describe, expect, it, vi } from "vitest"

  - function makeTerminal(...): ITerminal { ... return session.terminal as ITerminal }
  + function makeTerminal(...): vscode.Terminal {
  +   const execution: vscode.TerminalShellExecution = {
  +     commandLine: { value: "", isTrusted: true, confidence: 2 /* High */ },
  +     cwd: undefined,
  +     read: () => ({ async *[Symbol.asyncIterator]() { ... } }),
  +   }
  +   const terminal: vscode.Terminal = {
  +     name: "mock",
  +     processId: Promise.resolve(12345),
  +     creationOptions: {},
  +     exitStatus: undefined,
  +     state: { isInteractedWith: false, shell: undefined },
  +     shellIntegration: { cwd: undefined, executeCommand: () => execution },
  +     sendText: () => {},
  +     show: () => {},
  +     hide: () => {},
  +     dispose: () => {},
  +   }
  +   session.terminal = terminal
  +   return terminal
  + }
```

The fixture is now a **typed** `vscode.Terminal` (not `as unknown as vscode.Terminal`), so any future drift in the public `Terminal` surface will surface at the test seam instead of being hidden by a double cast.

Three latent issues uncovered along the way:

1. The `vi.mock("vscode")` stub does not export `TerminalShellExecutionCommandLineConfidence`. The fixture uses the literal `2 /* High */` rather than the enum reference (which is the @types/vscode integer for the `High` enum member).
2. `beforeEach` was imported but never used - a dormant lint failure that surfaced only after tsc began passing. Removed.
3. The `currentSession.terminal: any` slot is preserved as the dispatch handle for `fireExecutionEnd` / `fireTerminalClose` - it is **not** part of the `run()` contract, so it does not violate the "no new `any`" rule.

## Verification trail

All commands run from `apps/vscode`, bun1.3.x, Node 22+:

| Step | Command | Result |
|---|---|---|
| 1 | `bunx tsc --noEmit` (baseline pre-fix) | **4 errors** (4x `ITerminal` not assignable to `Terminal`) |
| 2 | `bunx tsc --noEmit` (post-fix) | **0 errors** |
| 3 | `bun run test:vitest -- src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts` | **5 / 5 passed** in 61.10s (matches the file header's documented ~57s wall-clock budget) |
| 4 | `bun run check-types` (protos + extension tsc + compat + webview tsc) | exit 0 |
| 5 | `bun run build:sdk` (repo root, all 7 SDK packages) | exit 0 |
| 6 | `bun run vscode:prepublish` (the originally failing chain) | **exit 0** - protos -> biome format -> check-types -> build:webview -> biome lint -> lint:proto -> esbuild --production |
| 7 | `dist/extension.js` regenerated | 26,078,534 bytes |

## Production delta

**ZERO.**

`git diff --stat` confirms exactly one file changed; no production source, no config, no factory board.

## TSWPD auto-enable impact

**Continue unchanged.** This ACT does not gate TSWPD auto-enable. The test fixture correction is a pre-existing latent defect, surfaced by the build chain; the earlier recon verdict (NOT_REPRODUCED) holds.

## Operator follow-up (no production change)

1. `bunx vsce package --out dist/clinemm-4.1.16-<HEAD>.vsix` to produce the source-bound VSIX (the next-now operator step #4).
2. Bind VSIX_PATH / VSIX_BYTES / VSIX_SHA256 / VSIX_VERSION into `.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01-CORRECTION01/source-bound-vsix.md`.
3. Install to codium-clinemm; restart dogfood; do NOT manually toggle TSWPD.
4. Resume the existing LIVE idle-writer discriminator (per the ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01 operational follow-up #1-#7).

## ACT ledger

`.factory/acts/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01-CORRECTION01.md` (this file)

## Evidence

`.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01-CORRECTION01/`
  - entry-freeze.txt (Phase 0 freeze: HEAD, branch, worktree, predecessor ACT)
  - verification.md (Step 1-7 results, verbatim command output)
  - source-bound-vsix.md (operator-produced VSIX bytes / SHA-256 / source HEAD / source tree binding)

## Verdict (machine-readable)

```
P1_BUILD_CONTRACT_DEFECT         = CLOSED
PRODUCTION_DELTA                  = ZERO
TSWPD_AUTOENABLE                  = CONTINUE_UNCHANGED
ACT_VERDICT_RECON01              = UNCHANGED (NOT_REPRODUCED + STRUCTURAL)
NEW_REVIEW_ROUND                  = NO
HALT                              = NO
```
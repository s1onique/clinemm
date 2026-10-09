# ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01-CORRECTION01 — BOUNDED_RUN_COMMANDS_TOOL_RESULT_DISCRIMINATOR — 2026-10-09

## 1. Reviewer halt

The Factory reviewer halted the predecessor ACT (`9e512dba9`, RCNC-01) with:

> **HALT_REAL_COMMAND_RESULT_SEAM_NOT_EXERCISED**
> "The repair executes only when the separate `command_status` tool is
> invoked and returns a snapshot with `state === "running"`. … There is
> no evidence in the screenshot that `command_status` was subsequently
> invoked. Therefore, the newly added callback may never execute in the
> original failure scenario."
>
> "The ablation consequently proves: Without the new callback, a test
> that requires that callback fails. It does not establish that the
> original `Run failed` card was caused by an unreconciled
> `command_status` observation."

The reviewer demanded one bounded discriminator that:

1. Produces a controlled `status:"running"` result at the initial observation deadline.
2. Records the exact tool-result envelope and the field that causes the command card to display `Run failed`.
3. Exercises the real transcript/React projection **without** calling `command_status`.
4. Asserts that a nonterminal response cannot be rendered as a terminal command failure unless an independent, genuine invocation failure exists.

## 2. Bounded correction

This ACT is the single discriminator. Production delta = 0. The committed RCNC-01 patch (`9e512dba9`) is preserved; only a new test file is added that:

- Wires the **real** `createVscodeRunCommandsTool` + real `CommandJobManager` + real `SdkController.prototype.updateBackgroundCommandState` callback (mirrors the existing `bctcp01-runner-controller-composition` pattern at `apps/vscode/src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-runner-controller-composition.test.ts`).
- Wires the **real** `createCommandStatusTool` with the production `onRunningObserved` closure (the exact wiring at `vscode-runtime-builder.ts:296-298`).
- Captures the tool envelope byte-equivalent to the screenshot (`{status, jobId, elapsedMs, deadlineRemainingMs}` keys asserted).
- Asserts the user-visible pill text by mirroring the live `CommandStatusMap` mapping from `apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx:367` (the renderer's pill is a pure function of the projection value).

## 3. Four test cases

| Test ID      | Discriminator                                                                                                                                                                                       | Verdict |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| RCNC02-01    | Original tool-result path is non-terminal by construction. Envelope → projection=`"running"` → pill=`"Backgrounded"` (NEVER `"Run failed"`). The original envelope cannot produce the `Run failed` card. | GREEN   |
| RCNC02-02    | Adversarial stale-write path. Simulates the hypothesised one-shot desync at the production `onBackgroundStateChange` seam. Pill=`"Run failed"`. **Without `command_status`, the row stays `"Run failed"`** — the bounded fix is necessary. | GREEN   |
| RCNC02-03    | Production-wired `command_status` reconciles. After the misfire, `command_status` (real tool, real wiring) reconciles projection back to `"running"`, pill=`"Backgrounded"`. The bounded fix is load-bearing. | GREEN   |
| RCNC02-04    | Conservation. A terminal observation does NOT fire `onRunningObserved`. Projection stays terminal.                                                                                                  | GREEN   |

## 4. Causal mechanism honesty

The discriminator proves:

- The original `run_commands` tool envelope **cannot** directly produce a `Run failed` card (RCNC02-01).
- The bounded fix is **necessary** when the hypothesised desync fires (RCNC02-02), and is **load-bearing** via the real production wiring (RCNC02-03).
- The fix does NOT fabricate `running` after a genuine terminal publication (RCNC02-04).

It does NOT prove that the hypothesised desync **did** fire in the original failure. A LIVE post-fix qualification is the only way to confirm the original mechanism was the hypothesised desync rather than some other boundary. LIVE remains NOT_EXECUTED.

## 5. Files added (production delta = 0)

- `apps/vscode/src/sdk/__tests__/run-commands-nonterminal-original-tool-result-discriminator01.rcnc02.test.ts` (NEW: 4 tests, 491 lines, RCNC02-01..04)

## 6. Gates

- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/run-commands-nonterminal-original-tool-result-discriminator01.rcnc02.test.ts` → 4 passed
- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts` → 5 passed (no regression)
- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-runner-controller-composition.test.ts` → 1 passed (no regression)
- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-controller.test.ts` → 7 passed (no regression)
- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-multi-job-controller.test.ts` → 5 passed (no regression)
- `cd apps/vscode && bun x tsc --noEmit --project tsconfig.json` → 0 errors
- `cd apps/vscode && bun x biome check --no-errors-on-unmatched src/sdk/__tests__/run-commands-nonterminal-original-tool-result-discriminator01.rcnc02.test.ts` → 0 errors
- `git diff --check` → exit 0
- VSIX packaging: NOT_EXECUTED (operator-owned exact-head packaging per C13 directive)
- LIVE post-fix qualification: NOT_EXECUTED

## 7. Forward-look

- **P0-B post-turn-presentation** remains the explicit successor ACT (`ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01`). The bounded fix in RCNC-01 is strictly scoped to the per-call `onRunningObserved` callback in the `command_status` tool.
- **LIVE post-fix qualification** of RCNC-01 remains the only way to confirm the original P0 mechanism was the hypothesised desync. Operator owns the exact-head packaging and the LIVE verification per the brief's C13 directive.

## 8. Disposition

| Claim                                              | Decision              |
| -------------------------------------------------- | --------------------- |
| `command_status` running-snapshot callback         | PASS, verified GREEN  |
| Original tool-result path produces `Run failed`    | REFUTED: cannot       |
| Stale `containment_failed` produces `Run failed`   | CONFIRMED (RCNC02-02) |
| Bounded fix reconciles via real wiring             | CONFIRMED (RCNC02-03) |
| Original P0-A mechanism is the hypothesised desync | PLAUSIBLE, not proven |
| P0-B post-turn-presentation                        | REMAINS OPEN          |
| Exact source HEAD                                  | `9e512dba9` + rcnc02 test |
| LIVE post-fix                                      | NOT_EXECUTED          |

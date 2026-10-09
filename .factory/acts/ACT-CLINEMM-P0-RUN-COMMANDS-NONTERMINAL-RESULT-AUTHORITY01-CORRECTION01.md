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

---

# ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01-CORRECTION02 — TERMINAL_STATE_MONOTONICITY_SAFETY — 2026-10-09

## 1. Reviewer halt (follow-up)

After the RCNC02-01..04 discriminator at HEAD `c2a8992eb` closed the reviewer's `HALT_REAL_COMMAND_RESULT_SEAM_NOT_EXERCISED`, the reviewer issued a follow-up halt:

> **HALT_TERMINAL_STATE_MONOTONICITY_NOT_PROVEN**
> "RCNC02-03 demonstrates this sequence: [running → containment_failed → running via command_status]. That is acceptable only if the terminal projection is known to be stale. But the production callback cannot determine that. It receives a job ID, not a causally ordered observation version or terminal-publication identity. ... This is a new correctness risk introduced by the reconciliation mechanism."

The reviewer demanded two adversarial tests and a bounded repair at the observation/publication boundary if the risk reproduces.

## 2. Two adversarial tests

| Test | Discriminator |
| ---- | ------------- |
| RCNC02-05 | Stale running observation after genuine terminal publication. Drive a natural exit (the production `terminalPromise.then` listener publishes the terminal reason), then deliver a stale `h.onRunningObserved(jobId)` callback. Projection must stay terminal. |
| RCNC02-06 | Genuine `containment_failed` publication is NOT silently revoked by a later running observation. Publish `containment_failed` via the production closure, then deliver a stale `h.onRunningObserved(jobId)` callback. Projection must stay `containment_failed`. |

## 3. Risk confirmed

Both tests fail against the pre-repair controller (the `running && taskId` branch unconditionally writes `"running"`):

```
AssertionError: expected 'running' to be 'exited' // RCNC02-05
AssertionError: expected 'running' to be 'containment_failed' // RCNC02-06
```

## 4. Bounded repair

The publication boundary needs an evidence-gated monotonicity guard. The `command_status` tool is the canonical nonterminal observation seam; it has the manager's snapshot in hand. The discriminator: `snap.state === "running"` implies the job is alive in `manager.active` — the evidence that authorizes reconciliation. A direct invocation without that evidence is a stale-by-causal-ordering callback and must be refused.

**One optional 4th parameter `evidence?: { isLiveInManager?: boolean }` on `onBackgroundStateChange`**, threaded through 4 type aliases (`vscode-run-commands-tool.ts`, `sdk-session-lifecycle.ts`, `vscode-session-host.ts`, `vscode-runtime-builder.ts`) and the `updateBackgroundCommandState` writer. The writer guards:

```ts
if (
    evidence?.isLiveInManager !== true &&
    this.backgroundCommandJobStates[taskId] !== undefined &&
    this.backgroundCommandJobStates[taskId] !== "running"
) {
    // Terminal monotonicity: do not overwrite. The projection stays terminal.
    return
}
this.backgroundCommandJobStates[taskId] = "running"
```

The runner's start-side call carries `evidence = undefined` (a fresh jobId's projection is `undefined`; the guard does not fire). The runner's terminal-side call sets `running = false` and lands in the per-job terminal branch (no overwrite). The bounded fix's `command_status` path carries `{ isLiveInManager: true }` and reconciles (RCNC02-03). A stale direct invocation without evidence is refused (RCNC02-05/06).

## 5. Test results

- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/run-commands-nonterminal-original-tool-result-discriminator01.rcnc02.test.ts` → 6 passed (RCNC02-01..06)
- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts` → 5 passed (no regression; updated the spy assertion to expect the new evidence argument)
- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-{controller,multi-job-controller,runner-controller-composition}.test.ts` → 13 passed (no regression)

## 6. Ablation

Replacing the guard body with a no-op returns RCNC02-05 and RCNC02-06 to RED (4 passed, 2 failed). Restoring the guard returns all 6 RCNC02 tests to GREEN.

## 7. Disposition

| Claim | Decision |
| ----- | -------- |
| Original P0-A mechanism is the hypothesised desync | PLAUSIBLE, not proven |
| Terminal-state monotonicity regression risk | CONFIRMED (RCNC02-05/06 pre-repair) |
| Bounded fix closes the monotonicity risk | CONFIRMED (RCNC02-05/06 post-repair) |
| Original bounded fix is preserved (RCNC02-01..04) | PASS, all 4 GREEN |
| P0-B post-turn-presentation | REMAINS OPEN |
| LIVE post-fix | NOT_EXECUTED |

---

# ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01-CORRECTION03 — STALE_LIVENESS_CURRENTNESS — 2026-10-09

## 1. Reviewer halt (follow-up to correction02)

After the bounded fix at HEAD `ebde4bc38` closed the reviewer's `HALT_TERMINAL_STATE_MONOTONICITY_NOT_PROVEN`, the reviewer issued another follow-up halt:

> **HALT_STALE_LIVENESS_EVIDENCE**
> "The production tool currently does this: `if (snap.state === "running") { options.onRunningObserved?.(typed.jobId, { isLiveInManager: true }) }`. The Boolean describes the snapshot that was obtained. It does not establish that the observation is still current when the controller applies it. The writer's new guard explicitly permits overwriting a terminal projection whenever `isLiveInManager === true`. Therefore the decisive sequence remains untested: [capture running snapshot → job genuinely terminates → runner publishes exited → older running snapshot resumes and invokes the callback with isLiveInManager: true → current guard permits the stale running write]. RCNC02-05 does not execute this sequence. ... Add RCNC02-07 against the production `createCommandStatusTool` and real controller writer. Use a deferred `manager.status()` result to capture a genuine `running` snapshot. While that result is held, complete the supervisor and wait until the existing runner listener publishes `exited`. Release the captured status result so the real callback supplies `{ isLiveInManager: true }`. The required invariant is: `expect(controller.backgroundCommandJobStates[jobId]).toBe('exited')`."

## 2. The bounded probe (RCNC02-07)

A new test `RCNC02-07 adversarial: a stale deferred running snapshot delivered through the real command_status tool seam must NOT revert a genuine terminal projection`. The test seam wraps `manager.status` with a deferred Promise, holds it in flight while the supervisor exits and the runner's terminal listener publishes `"exited"`, then resolves the deferred promise with a stale `{ state: "running" }` snapshot. The bounded fix's `onRunningObserved(jobId, { isLiveInManager: true })` callback is the load-bearing path under test.

## 3. Risk confirmed

Pre-repair RCNC02-07 returns to RED:
```
AssertionError: expected 'running' to be 'exited'
```

The current guard accepts the stale snapshot because the snapshot says `"running"` and the tool passes `{ isLiveInManager: true }` based on the snapshot's point-in-time verdict.

## 4. The bounded repair

A narrow, synchronous `CommandJobManager.isJobActive(jobId): boolean` public method (a single `Map.has` call) and a closure-level re-check at the runtime-builder's `onRunningObserved` construction site:

```ts
isJobActive(jobId: string): boolean {
    return this.active.has(jobId)
}
```

The runtime-builder closure:
```ts
onRunningObserved: options.onBackgroundStateChange
    ? (jobId, evidence) => {
        const manager = options.commandJobManager as NonNullable<typeof options.commandJobManager>
        const currentEvidence = {
            ...evidence,
            isLiveInManager:
                (evidence?.isLiveInManager ?? false) && manager.isJobActive(jobId),
        }
        if (!currentEvidence.isLiveInManager) {
            // Stale snapshot — refuse the write.
            return
        }
        options.onBackgroundStateChange?.(true, jobId, undefined, currentEvidence)
    }
    : undefined
```

The `isJobActive(jobId)` re-check at the moment of the callback invocation closes the observation/publication correlation boundary: a deferred running snapshot (captured at T1, but released after the runner's terminal listener has published the terminal reason) is rejected because `isJobActive(jobId) === false` at the moment of the write.

## 5. Test results

- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/run-commands-nonterminal-original-tool-result-discriminator01.rcnc02.test.ts` → **7 passed (RCNC02-01..07)**
- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts` → **5 passed (no regression)**
- `cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/background-command-terminal-card-projection01.bctcp01-{controller,multi-job-controller,runner-controller-composition,runner-seam}.test.ts` → **18 passed (no regression)**
- `cd apps/vscode && bun x tsc --noEmit --project tsconfig.json` → exit 0
- `cd apps/vscode && bun x biome check` → 0 fixes applied
- `git diff --check` → exit 0
- LIVE post-fix qualification: NOT_EXECUTED

## 6. Ablation

Replacing the `manager.isJobActive(jobId)` re-check with a no-op returns RCNC02-07 to RED (1 failed | 6 passed). Restoring the re-check returns all 7 RCNC02 tests to GREEN.

## 7. Disposition

| Claim | Decision |
| ----- | -------- |
| Original P0-A mechanism is the hypothesised desync | PLAUSIBLE, not proven |
| Terminal-state monotonicity regression risk (correction02) | CLOSED (RCNC02-05/06 GREEN) |
| Stale deferred snapshot regression risk (correction03) | CLOSED (RCNC02-07 GREEN) |
| Original bounded fix is preserved (RCNC02-01..04) | PASS, all 4 GREEN |
| P0-B post-turn-presentation | REMAINS OPEN |
| LIVE post-fix | NOT_EXECUTED |

The Factory reviewer's three halts are now closed:
- HALT_REAL_COMMAND_RESULT_SEAM_NOT_EXERCISED (correction01 at `c2a8992eb`)
- HALT_TERMINAL_STATE_MONOTONICITY_NOT_PROVEN (correction02 at `ebde4bc38`)
- HALT_STALE_LIVENESS_EVIDENCE (this correction03)

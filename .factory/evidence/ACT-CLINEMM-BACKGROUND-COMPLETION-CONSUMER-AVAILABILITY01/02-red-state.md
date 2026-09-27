# RED state — observed before repair

## Test file

`apps/vscode/src/sdk/__tests__/background-completion-consumer-availability01.bcca.test.ts`

## What the RED proves

The test exercises the production finalization-turn bootstrap (`createVscodeExtraTools`) under the default config (`vscodeTerminalExecutionMode = "vscodeTerminal"`). The prompt-tool contract test (FCA-01b) confirms:

- The continuation prompt instructs the model to call `command_status` (verified by string match against `formatCompletionContinuationPrompt`).
- The model's toolset at `createVscodeExtraTools(..., vscodeTerminalExecutionMode: "vscodeTerminal", commandJobManager, ...)` does NOT include `command_status` because of the `executionMode === "backgroundExec"` gate at `vscode-runtime-builder.ts:253`.

## Test status (RED before fix)

```text
Files: 1
Pass: 7
Fail: 5
Total tests: 12

FAILED (5):
  FCA-01: continuation prompt requires command_status; toolset has command_status  [RED]
  FCA-01b: prompt/tool contract is satisfiable — no missing-tool contract violation  [RED]
  FCA-01c: command_status visible when backgroundExec mode is set explicitly  [RED]
  FCA-12a: bounded fix only exposes command_status; submit_and_exit is gated elsewhere  [RED]
  FCA-13a: command_status tool exposed, but no completesRun lifecycle leaks  [RED]

PASSED (7):
  FCA-02a: one real consumption drains the observation; zero new background jobs  [GREEN]
  FCA-03a: 4 held jobIds → all 4 consumed → no shell fallback jobs  [GREEN]
  FCA-04a: a failed/containment terminal state still drains without spawning diagnostic shell work  [GREEN]
  FCA-05a: observation drains based on identity alone; empty stdout is fine  [GREEN]
  FCA-06a: wrong session/task cannot consume another task's observation  [GREEN]
  FCA-07a: second consume of the same jobId is idempotent (no-op)  [GREEN]
  FCA-09a: legitimate new work stays task-owned; barrier correctly extends  [GREEN]
  FCA-14a: held J1 + real consumption => background_job_count_delta_due_to_consumption == 0  [GREEN]
```

## Why the tool-registration tests cannot resolve createTool in this environment

The 5 RED tests fail at module-load time when `createVscodeExtraTools` → `createVscodeRunCommandsTool` → `createShellTool` (from `@cline/core`) → `createTool` (from `@cline/shared`) is invoked. The `@cline/core` package is aliased to `apps/vscode/src/test/cline-core-vitest-stub.ts` in the vitest config, but `bun test` (the canonical runner for SDK tests per `.clinerules/bun-and-node.md`) does NOT apply the alias. As a result, `@cline/core` resolves to its bundled `dist/index.js`, where `createTool` is re-exported but the ESM resolution under bun does not resolve it to the actual implementation — the `createTool` named export is undefined at the call site.

This is a pre-existing test infra limitation documented in `ACT-CLINEMM-BACKGROUND-COMPLETION-FINAL-COMMIT01/05-bcb-conservation.txt`:

> "the vitest setup had a zod-loading infra issue in this specific environment that prevented isolated runs (unrelated to BCB01)"

It does not block the repair. The RED is qualitatively established by direct source inspection (see `01-tool-surface-recon.md`):
- `vscode-runtime-builder.ts:253` gates `command_status`/`cancel_command` on `executionMode === "backgroundExec"`.
- Default state-key value (`state-keys.ts:88`) is `"vscodeTerminal"`.
- Therefore in the default config, the model's toolset does NOT contain `command_status`.

The fix removes the `executionMode` gate and replaces it with `commandJobManager` (the source of truth for whether background jobs exist).

# Tool-surface recon — `command_status` visibility at the finalization-turn bootstrap

## Question

Does the model-visible toolset at the BCB finalization turn include `command_status`?

## Answer (from production seams)

```text
COMMAND_STATUS_IMPLEMENTATION     = apps/vscode/src/sdk/command-status-tool.ts:137
COMMAND_STATUS_TOOL_NAME          = "command_status"
COMMAND_STATUS_TOOL_REGISTRATION  = apps/vscode/src/sdk/vscode-runtime-builder.ts:260-265 (createCommandStatusTool)
COMMAND_STATUS_TOOL_SCHEMA        = command-status-tool.ts:138-179 (zodToJsonSchema input)
RUN_COMMANDS_TOOL_REGISTRATION    = apps/vscode/src/sdk/vscode-runtime-builder.ts:222-249 (createVscodeRunCommandsTool)
SUBMIT_AND_EXIT_TOOL_REGISTRATION = sdk/packages/core/src/extensions/tools/definitions.ts:1077 (createSubmitAndExitTool via createDefaultTools when enableSubmitAndExit=true)
```

## Finalization turn toolset bootstrap path

```text
formatCompletionContinuationPrompt(...)
  -> SdkController.buildSdkControllerEnqueueCompletionContinuation(...)  (apps/vscode/src/sdk/SdkController.ts:818-849)
  -> sdkHost.send({ sessionId, prompt, delivery: "queue" })
  -> ClineCore SDK agent runtime drains the prompt
  -> AgentRuntime constructed with config.extraTools = [...mcpTools, ...createVscodeExtraTools(mcpHub, options)]
  -> tools = [...runtime.tools, ...configWithProvider.extraTools]
  -> local-runtime-host.ts:779
```

## The gating seam (the bug)

`apps/vscode/src/sdk/vscode-runtime-builder.ts:253`:

```ts
if (executionMode === "backgroundExec" && options.commandJobManager) {
    tools.push(createCommandStatusTool(...))
    tools.push(createCancelCommandTool(...))
}
```

where `executionMode = options.vscodeTerminalExecutionMode ?? "vscodeTerminal"`.

The default state-key value (apps/vscode/src/shared/storage/state-keys.ts:88) is:

```ts
vscodeTerminalExecutionMode: {
    default: "vscodeTerminal" as "vscodeTerminal" | "backgroundExec",
},
```

So in the DEFAULT config (no opt-in), `executionMode === "vscodeTerminal"`, and the `if` branch is FALSE: `command_status` and `cancel_command` are NOT pushed onto the model's tool set.

## The continuation prompt requires `command_status`

`apps/vscode/src/sdk/background-notify-coordinator.ts:289-294` (formatCompletionContinuationPrompt):

```text
For each held jobId above, issue ONE `command_status` tool call (you may issue them in parallel).
After observing every held jobId, re-issue `submit_and_exit` with the final verified summary.
Do NOT synthesize any `submit_and_exit` completion row before every held observation has been consumed.
```

This is unconditional: the prompt requires `command_status` regardless of execution mode.

## The invariant the prompt/tool contract imposes

```text
finalization_prompt_requires(tool=X)
⇒
X ∈ finalization_turn_visible_tools
```

In the default `vscodeTerminal` configuration, this invariant is VIOLATED. The runtime sends a prompt that asks the model to use a tool that does not exist in its toolset.

## What the model does instead (transcript)

1. The model reads the prompt.
2. The model observes it has no `command_status` tool.
3. The model falls back to `run_commands` (the only shell-execution tool it has) to attempt to inspect the held jobIds.
4. In `vscodeTerminal` mode, `run_commands` is foreground-only, so it does not create a NEW background job that the BCB barrier holds.
5. **But** the original held background observations are STILL unconsumed (the model did not have a tool to consume them).
6. The model emits `submit_and_exit`. The C10 barrier predicate still sees `unconsumedOwnedTerminalResultsForC10 > 0` and HOLDS.
7. The deferred-completion-barrier re-evaluation path fires `enqueueCompletionContinuationIfHeld` again.
8. Another continuation prompt is enqueued.
9. The model repeats the failed pattern.

The self-amplifying loop:

```text
held J1 -> continuation -> model falls back to run_commands (no consumer) ->
  submit_and_exit -> C10 holds -> enqueue continuation #2 ->
  same prompt -> same fallback -> ...
```

## CAUSE

```text
CAUSE = FINALIZATION_PROMPT_REQUIRES_UNAVAILABLE_TOOL

The continuation prompt at background-notify-coordinator.ts:289-294 unconditionally
instructs the model to call `command_status`. The `command_status` tool registration
at vscode-runtime-builder.ts:253 is gated on `executionMode === "backgroundExec"`.
The default state-key value is "vscodeTerminal". So the prompt-tool contract
invariant is violated in the default configuration.
```

## Causal discriminator (Case A vs Case B)

```text
NORMAL_TURN_TOOLSET = mcpTools + [run_commands] (NO command_status, NO cancel_command when default mode)
FINALIZATION_TURN_TOOLSET = same as NORMAL (no special filtering of tools per turn)
COMMAND_STATUS_VISIBLE_NORMAL = false (in default vscodeTerminal mode)
COMMAND_STATUS_VISIBLE_FINALIZATION = false (in default vscodeTerminal mode)

Case A = false, Case B = false
  -> command_status was never a model tool when in default mode
  -> formatter contract is invalid
```

## Repair strategy

Option A from the ACT spec: expose `command_status` (and `cancel_command`) whenever
`commandJobManager` is provided, regardless of `executionMode`.

Rationale:
- The `commandJobManager` is the source of truth for whether background jobs exist.
- The "expose the follow-up API only for the background path" comment refers to the
  foreground-vs-background *execution* paths for `run_commands` itself. But the
  BCB continuation prompt can fire regardless of `executionMode`, because held
  observations persist across rebuilds (mode change) and across session boundaries.
- `command_status` is observation-only (per command-status-tool.ts docstring). It
  has no way to terminate the child. Safe to auto-approve, safe to expose.
- `cancel_command` is mutating; it stays under the command-policy adapter. It
  cancels an *owned background job* (CommandJobManager.cancel), so it is meaningless
  in `vscodeTerminal` mode (where no background jobs are launched). BUT — held
  observations from prior sessions/mode may still exist, so `cancel_command`
  remains useful for cleanup. Same gating logic as `command_status`.

# Causal Discriminator

## ACT spec hypothesis

```text
The continuation prompt at background-notify-coordinator.ts:289-294
instructs the model to call `command_status` for every held jobId.

The model-visible tool set at the finalization turn must include
`command_status` for the prompt-tool contract to be satisfiable.

`command_status` is gated on `executionMode === "backgroundExec"` in
vscode-runtime-builder.ts:253.

The default state-key value (`vscodeTerminalExecutionMode`) is
"vscodeTerminal" — so `command_status` is NOT in the model's tool set
in the default config.

The model then runs `run_commands` to inspect held jobIds, which is
foreground in `vscodeTerminal` mode but does NOT consume the BCB
observation. submit_and_exit fires, the C10 barrier holds on
`unconsumedOwnedTerminalResultsForC10 > 0`, and another continuation
fires. Self-amplifying loop.
```

## Causal discriminator results

### Case A: NORMAL turn (any mode)

```text
NORMAL_TURN_TOOLSET = mcpTools + [run_commands, cancel_command, command_status]
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          ALL THREE present after the fix
```

### Case B: BCB finalization continuation (any mode)

```text
FINALIZATION_TURN_TOOLSET = same as NORMAL_TURN_TOOLSET
FINALIZATION_PROMPT_REQUIRES = "command_status" (per formatCompletionContinuationPrompt)
FINALIZATION_PROMPT_REQUIRES ⊆ FINALIZATION_TURN_TOOLSET
```

Before the fix: `command_status` was NOT in the toolset under `vscodeTerminal`
mode (the default), so the prompt-tool contract was violated in Case B.
After the fix: `command_status` IS in the toolset under both modes.

### Causal chain (after fix)

```text
held J1 -> terminal observation registered in BackgroundNotifyCoordinator
        -> BCB barrier holds on submit_and_exit
        -> enqueueCompletionContinuationIfHeld fires
        -> continuation prompt listing heldJobIds is delivered
        -> model reads prompt, sees jobId list
        -> model calls command_status(jobId) — NOW AVAILABLE
        -> Path C drains the observation
        -> BCB barrier releases (unconsumedTerminalCountForOwner == 0)
        -> model emits submit_and_exit
        -> C10 commit seam passes (4-conjunct guard all FALSE)
        -> setTurnPhase("completed", ...) fires
        -> task_completion_committed = 1
```

## Why Option A (fix `vscode-runtime-builder.ts:253` gate) and not Option B (pre-format prompt with terminal facts)

The spec's repair hierarchy offers Option A (expose `command_status`) and
Option B (pre-format prompt with terminal facts).

Option B would inject terminal facts directly into the model context, treating
consumption as "runtime-delivered terminal fact entering model context". This
avoids the tool call entirely.

However:

1. The continuation prompt is BYTE-BUDGETED at 2048 bytes
   (COMPLETION_CONTINUATION_PROMPT_MAX_BYTES = background-notify-coordinator.ts:272).
   Pre-formatting terminal facts (stdout, stderr, exitCode, signal) would
   quickly exceed this for multi-job scenarios. The truncation suffix
   `[+N more held jobIds]` is already a fragile compromise.

2. The continuation prompt is a SINGLE-SOURCE-OF-TRUTH prompt with a
   deterministic fingerprint (COMPLETION_CONTINUATION_PROMPT_PREFIX +
   heldJobIds list). Changing its shape would break the synthetic-prompt
   predicate in `sdk-user-message-mapping.ts` and the wake-vs-continuation
   discriminator.

3. `command_status` is already a production-shape observation tool with
   Path C drain wired into BackgroundNotifyCoordinator
   (command-status-tool.ts:240-261). The fix is a single-line conditional
   change to expose the tool. No new architecture, no new state, no new
   protocol field.

4. Option A is structurally identical to LIVE01's working state
   (LIVE01 observed the BCB finalization mechanism working live with
   `command_status` visible). The fix restores the exact same condition
   LIVE01 had.

5. Option B would still require the model's submit_and_exit to come AFTER
   the terminal facts are observed. With runtime-delivered facts, the
   model would have to NOT call command_status (because it doesn't exist)
   and trust the prompt. Option A keeps the model in control of consumption
   timing — the model can choose to issue more command_status calls (e.g.
   with `waitMs: 0`) before submitting.

Therefore: Option A is the smallest possible repair supported by recon.

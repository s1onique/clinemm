# Source seam trace (ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01, corrected)

Entry freeze: HEAD `9912e1154688217f2d85a0a28859d8ba79b01777` on
`main`, working tree was clean at entry; this ACT adds one
untracked test file at exit.

## Real production seams at HEAD

### Foreground tool-execution seam

```
createVscodeRunCommandsTool
  -> createShellTool(createVscodeShellExecutor(...))
    -> ShellExecutor (per-invocation closure)
      -> if (vscodeTerminalExecutionMode === "backgroundExec")
           -> CommandJobManager.start(options, context)  (background branch)
         else
           -> executeForeground(command, cwd, terminalManager, ...)  (foreground)
              -> terminalManager.getOrCreateTerminal(cwd)  (vscode)
              -> process = terminalManager.runCommand(terminal, command)
              -> bufferLine on "line"
              -> await process                    <-- the wait seam
              -> completionDetails = process.getCompletionDetails?.()
              -> if terminalClosed: throw CommandExitError(1, ...)
              -> if unobservedCommand: throw CommandExitError(1, ...)
              -> if exitCode != 0 && exitCode != null: throw CommandExitError(...)
              -> return output
```

File: `apps/vscode/src/sdk/vscode-run-commands-tool.ts:249-519`.

The 300s `FOREGROUND_COMMAND_AUTO_PROCEED_MS` timer is an
auto-detach (releases the agent turn) and only calls
`process.detach()`. It does NOT race the `await process` itself.
The SDK shell-tool wrapper has `bashTimeoutMs` but it is documented
as "cannot be forcibly terminated" (`VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS = 60*60*1000`).

### Foreground terminal-process authority

```
VscodeTerminalProcess.run()
  -> shellIntegration.executeCommand(command) -> execution
  -> execution.read() -> stream
  -> Promise.race between:
       stream read
       resolveExecutionEnd (onDidEndTerminalShellExecution)
       terminalClosedPromise (onDidCloseTerminal)
       idleTimer (MARKERLESS_IDLE_TIMEOUT / MARKERLESS_FIRST_DATA_TIMEOUT)
  -> break on streamEnd | executionEnd | terminalClosed | idle(prompt-strong | max-quiet)
  -> await Promise.race([
       resolveExecutionEnd.promise,
       new Promise(resolve => setTimeout(... EXIT_CODE_EVENT_TIMEOUT_MS ...))
     ])
  -> emit("completed", getCompletionDetails())
```

File: `apps/vscode/src/hosts/vscode/terminal/VscodeTerminalProcess.ts:90-510`.

`EXIT_CODE_EVENT_TIMEOUT_MS` bounds the exit-code wait, but if it
times out, the code STILL emits `completed` (line 480/506) — so
the awaitable always settles. This is the empirical finding: every
reachable branch in `run()` reaches `emit("completed")`.

### Manager bookkeeping

```
VscodeTerminalManager.runCommand(terminalInfo, command)
  -> existingProcess?.waitForShellIntegration = false
  -> terminalInfo.busy = true
  -> process = new VscodeTerminalProcess(terminal, command).run()
  -> process.on("completed", () => { terminalInfo.busy = false; ... })
  -> process.on("error",    () => { terminalInfo.busy = false; ... })
  -> return process
```

File: `apps/vscode/src/hosts/vscode/terminal/VscodeTerminalManager.ts:200-260`.

Because the production state machine always emits `completed` or
`error` (A1-A4 confirm), `busy` is always cleared. There is no
reachable stuck-state.

### Background command-job seam

```
CommandJobManager.start(options, context)
  -> check safe-mode policy, build child_process.spawn(...)
  -> exitTransition = childProcess.exit
     .then(result => finalize(job, "exited", {exitCode, signal}))
     .catch(err  => finalize(job, "spawn_failed", {signal: err.message}))
  -> this.exitTransitions.set(id, exitTransition)
  -> terminalPromise = pre-resolved from finalize() at job removal
  -> return { jobId, state, exitCode, signal, stdout, terminalPromise, ... }
```

File: `apps/vscode/src/sdk/command-job-manager.ts:535-925`.

Background is bounded by `DEFAULT_EXECUTION_DEADLINE_MS` (process
kill) and `DEFAULT_WAIT_BUDGET_MS` (wait-budget; returns RUNNING
to caller and keeps job alive in CommandJobManager). These are
proper kill/detach bounds. Out of scope for this ACT (task-
progression semantics are not the surface here).

### Registry

```
VscodeTerminalRegistry
  - terminals: TerminalInfo[]
  - terminalsPendingCleanup: Map<id, TerminalInfo>
  - removeTerminal(id) -> filters terminals
  - disposeTerminalsPendingCleanup() -> terminal.dispose() + retry on failure
```

File: `apps/vscode/src/hosts/vscode/terminal/VscodeTerminalRegistry.ts`.

The registry is a static pool; `getOrCreateTerminal` will skip
busy terminals. Stale bookkeeping poisoning is a downstream
amplifier if the manager's `busy` leaks, but A1-A4 confirm no
reachable stuck-state.

## Recon answers (full Q1-Q8 in ACT document)

See `.factory/acts/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01.md` §Q1-Q8.

## Causal discriminator (corrected)

The earlier recon claimed the broken boundary was
**CASE_C_WAITER_RESOLUTION** (executor `await process` is unbounded
except by process-promise resolution). The corrected evidence
shows: the production state machine that produces the awaitable
ALWAYS settles in every reachable terminal-fact branch. So the
broken-boundary claim is **NOT REPRODUCED** at the production seam.

What remains:

- STRUCTURAL property: `executeForeground`'s `await process` has no
  independent bounded timeout. This is a true property; it is NOT
  a reachable defect because the upstream ITerminalProcess
  implementation always settles.
- The earlier "RED-1" / "RED-3" claims were INJECTED-FAULT
  demonstrations, not reachable production defects. Removed.

# Execution-Seam Recon — ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01

## Three execution seams identified

### 1. SDK bash executor (foreground default)

**File:** `sdk/packages/core/src/extensions/tools/executors/bash.ts`

- `createShellExecutor(options)` returns a `ShellExecutor` (function with signature
  `(command, cwd, context) => Promise<string>`).
- Internally calls `spawnAndCollect` which calls
  `spawn(executable, args, { cwd, env, stdio:["pipe","pipe","pipe"], detached: !isWindows, windowsHide:true })`.
- The shell is selected via `getDefaultShell(process.platform)` (bash on POSIX,
  powershell on Windows). When `command` is a string, `getShellInvocation(shell, command)`
  decides args (e.g. `["-c", command]` for POSIX).
- Cancellation, timeout, signal handling, stdout/stderr collection all live here.

**Sandboxable:** YES -- the executor itself spawns Node child processes via
`child_process.spawn`. An OS-level sandbox wrapper (e.g. `sandbox-exec`) inserted
between this function and the spawn call would transparently apply.

### 2. VSCode CommandJobManager (background mode for `run_commands`)

**File:** `apps/vscode/src/sdk/command-job-manager.ts`

- `CommandJobManager.start(options, context)` is the production seam for
  background execution in VSCode.
- Resolves shell + shell invocation (`getShellInvocation`), constructs `SpawnConfig`,
  calls `spawnSupervisableShellCommand` (which delegates to the same `buildShellProcess`
  in bash.ts that calls `node:child_process.spawn`).
- Owns the supervised lifetime (wait budget vs execution deadline, terminal state,
  process tree tracking).

**Sandboxable:** YES -- same `node:child_process.spawn` seam. Insertion at this
point is preferred over the SDK bash executor because:
- It's the actual production executor for VSCode background mode (the mode that
  runs unsupervised commands; foreground is user-visible terminal).
- It already constructs a clean `SpawnConfig` we can intercept.

### 3. VSCode VscodeTerminalManager (foreground terminal mode)

**File:** `apps/vscode/src/hosts/vscode/terminal/VscodeTerminalManager.ts`

- Creates real VS Code terminals via `vscode.window.createTerminal`.
- Sends commands via `terminal.sendText(...)` and observes them via VS Code's
  shell integration API.
- The terminal process is owned by VS Code, NOT by us. We cannot wrap it with
  `sandbox-exec` because:
  1. The terminal process is already spawned by VS Code when we acquire it.
  2. The shell-integration marker script runs in the terminal session, which
     would need to be sandboxed separately (and would break shell integration).
  3. Killing the terminal from inside our extension would not un-sandbox it.

**Sandboxable:** NO -- out of scope for this ACT.

## Decision: insertion point

Insert the `SandboxBackend.prepare(...)` hook at:

```
apps/vscode/src/sdk/command-job-manager.ts:441
```

i.e. between constructing the `SpawnConfig` and calling `spawnSupervisableShellCommand`.

When the sandbox mode is `disabled` (DEFAULT), the hook is a no-op (returns the
original `SpawnConfig` unchanged). When the sandbox mode is `seatbelt-experimental`
and the opt-in flag is set, the hook rewrites `executable` to `/usr/bin/sandbox-exec`,
prepends `["-f", <profile-file>]`, and adjusts `env` via the environment materializer.

The CLI shares the SDK's `createShellExecutor` (via `createDefaultExecutors`
then `createDefaultShellExecutor`), so a future ACT can wire the same hook at the
SDK level if needed. For C3 we target the VSCode background path only -- the CLI
path remains on `createShellExecutor` unchanged and therefore unaffected.

## SDK vs VSCode split

The `SandboxBackend` interface, `NoSandboxBackend`, profile generator, environment
materializer, and Seatbelt backend all live in the SDK (`@cline/core`). The host
(`apps/vscode`) constructs a backend based on its config and applies it at the
CommandJobManager seam.

This keeps:
- the Seatbelt implementation platform-aware inside the SDK (where platform
  detection is already done);
- the application of the backend at the host seam (where the actual production
  executor lives for VSCode).

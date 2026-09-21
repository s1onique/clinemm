# 03 — Current tool contract (recon of production schemas)

Recon at HEAD `3a201b49c`. Source paths verified.

## 3.1 `run_commands` tool

**Schema** — `sdk/packages/core/src/extensions/tools/schemas.ts:149-159`

```ts
export const RunCommandsInputSchema = z
    .object({
        commands: z
            .array(CommandInputSchema)
            .describe("Array of complete shell command strings to execute."),
    })
    // ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01: reject unknown
    // fields (e.g. `timeout`) so the schema is strict at runtime
    .strict();
```

**Fields carried**: `commands` (array of strings).
**Fields NOT carried**: `wait`, `await`, `detach`, `notify`,
`onTerminalCompletion`, `notify_on_terminal`, `completion_behavior`,
`poll`, any kind of intent flag.

**Description** — `sdk/packages/core/src/extensions/tools/definitions.ts:669-676`

```text
"Run non-interactive shell commands from the root of the workspace. " +
RUN_COMMANDS_SHARED_INSTRUCTIONS +
environmentNote +
"Commands should be properly shell-escaped and targeted to avoid error or
timeout. Include multiple commands in the same call when they are independent
complete shell commands and safe to run concurrently; multiline scripts and
heredocs must be a single command string. When independent reads, searches,
or edits are also needed, call those tools in the same response. " +
"Output beyond ~{N}k characters is middle-truncated (start and end preserved);
pipe through grep/head/tail when you need specific sections of large output. " +
"For long-running commands, run them in background and redirect output to a
tmp file that you can read from later."
```

**`RUN_COMMANDS_SHARED_INSTRUCTIONS`** — `definitions.ts:637-639`

```text
"Use for listing files, checking git status, running builds, executing tests, etc.
 Commands must be non-interactive. Commands that require follow-up input like
 pagers should be skipped or used with supported flags/env (e.g. git --no-pager,
 --non-interactive) to bypass the interaction steps."
```

The "long-running commands … tmp file … read from later" sentence is
**the only model-visible instruction about background commands** in
the `run_commands` tool description. It is F4.

## 3.2 VSCode-flavored `run_commands` tool wrapper

**Source**: `apps/vscode/src/sdk/vscode-run-commands-tool.ts:1-110`

**Two execution modes**:

```text
- foreground (vscodeTerminal): visible VS Code terminals via
  VscodeTerminalManager. long-running timeout = 60 min.
- background (backgroundExec): host-owned supervised execution via
  CommandJobManager. WAIT_BUDGET_MS decoupled from EXECUTION_DEADLINE_MS.
  Long-running work stays alive past the wait budget and is queried
  via command_status.
```

**Proceed While Running** — `vscode-run-commands-tool.ts:235-245, 261-273`

```text
A USER UX affordance for foreground commands:
  - Registered BEFORE terminal acquisition.
  - User clicks → detach: redirects remaining output to a tmp file,
    resolves the awaited promise, command keeps running.
  - Auto-detach after FOREGROUND_COMMAND_AUTO_PROCEED_MS = 300_000ms
    (300s) so a long-running foreground command cannot block the
    agent turn indefinitely.
```

This is a foreground UX seam only. It does NOT produce a background
CommandJob; the process keeps running in the user's terminal, NOT in
the CommandJobManager.

**`onBackgroundStateChange` callback** — `vscode-run-commands-tool.ts:108`

```ts
onBackgroundStateChange?: (running: boolean, jobId: string | undefined) => void
```

Fires:
- When the tool returns RUNNING (with active jobId), and
- When the command reaches a terminal state on the same call (with undefined).

The SdkController wires this to `updateBackgroundCommandState(running, jobId)`
at `SdkController.ts:1309`.

**Does NOT carry**: any flag indicating user intent (`wait` / `notify` /
`detach`), any flag indicating the model intends to wait, any link from the
event back to the original tool call's semantic.

## 3.3 `command_status` tool

**Source**: `apps/vscode/src/sdk/command-status-tool.ts:95-157`

**Description**:

```text
"Inspect the state of a long-running shell command previously launched
via run_commands. ... does not terminate the child. To terminate a
running command, use cancel_command."
```

**Input**: `{ jobId: string, waitMs?: number }`. waitMs clamped to
`MAX_STATUS_WAIT_MS` (bounded).

**Output**: read-only snapshot `{ ok, jobId, state, elapsedMs,
deadlineRemainingMs, stdout, stderr, outputTruncated, exitCode?, signal? }`.

**Auto-approval**: observation-only, no command-policy adapter
involved. Safe to auto-approve.

**Authority**: read-only by construction. Cannot terminate.

## 3.4 `cancel_command` tool

**Source**: `apps/vscode/src/sdk/command-status-tool.ts:159-211`

**Input**: `{ jobId: string }`.

**Authority**: mutating. Subject to the same command-policy adapter as
`run_commands` (ALLOW / ASK / DENY based on `executeSafeCommands`).
**Output**: terminal-state snapshot after cancel.

## 3.5 `CommandJob` record (host-side, in `CommandJobManager`)

**Source**: `apps/vscode/src/sdk/command-job-manager.ts:53-79`

**Terminal states**:

```ts
export type CommandJobState =
    | "running"
    | "exited"
    | "deadline_exceeded"
    | "cancelled"
    | "spawn_failed"
    | "containment_failed";
```

**Fields the `CommandJob` record carries** (snapshot of internal record):

- `ownerSessionId?: string` — host-owned lifecycle id from `AgentToolContext.sessionId`
- `taskId?: string` — NOT captured (no stable task identity at job creation;
  see predecessor ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01)
- `terminationReason: TerminationReason`
- `finalized: boolean`
- `treeEscapee?: boolean`

**Fields it does NOT carry**: `completionBehavior`, `notifyOnTerminal`,
`waitIntent`, `awaitTerminal`, `detach`, any user-intent or model-intent
representation.

## 3.6 Projection of `RUNNING → terminal`

**Source**: `apps/vscode/src/sdk/SdkController.ts:4173-4242`

`updateBackgroundCommandState(running, taskId)` is the bridge from the
`onBackgroundStateChange` callback to turn-state projection.

The `>0 -> 0` cardinal transition (`previousRunning && !running && taskId === undefined`)
calls `sessionEvents.reevaluateDeferredContinuation()`.

`reevaluateDeferredContinuation` checks the deferred-continuation marker
(`sessionId`, `taskId`, `epoch`), the live `hasRunningBackgroundJobForOwner`
lookup, and either commits `awaiting_followup` (turn-state writer only)
or stays deferred until another matching job settles. Source:
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:140-200`.

**There is NO call site in this chain that invokes the agent runtime.**
This is the predecessor's "ABSENT_STRUCTURAL" finding, restated for
this ACT's contract-selection context.

## 3.7 User-intent representability verdict

```text
R3 NO.
   The current run_commands schema has NO field for wait / notify /
   detach / poll / completionBehavior. The CommandJob internal record
   has NO such field. The CommandJobSnapshot has NO such field.

NATURAL_LANGUAGE_INFERENCE_BY_RUNTIME = FORBIDDEN.

The runtime CANNOT distinguish:
  "Run this command and wait until it finishes."
from:
  "Start this in the background and tell me when it ends."
from:
  "Start this in the background, do not notify me."

The F4 doctrine is the only model-visible instruction about background
commands, and F4 explicitly places output management on the MODEL (tmp-file
convention). F4 does NOT establish any runtime promise about terminal
notification.
```

## 3.8 What this means for the contract decision

- The current `run_commands` schema is FROZEN at `commands: string[]` only.
- Any candidate that requires a new structured field (B, C, D) MUST add it.
  That is a product-surface change, not a runtime bug fix.
- Candidate A (polling-only) requires no schema change — but requires
  the model to poll, which the LIVE specimen proved is unreliable.
- The choice between A and {B, C, D} is therefore NOT a runtime
  optimization. It is a PRODUCT QUESTION about which user intents we
  want to support and how they are represented.

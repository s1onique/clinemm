ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 — RECON
============================================================

## 3.1 Tool schema seam

The fork's run_commands tool replaces the SDK's built-in via
createVscodeRunCommandsTool() at apps/vscode/src/sdk/vscode-run-commands-tool.ts.
That factory wraps the SDK's createShellTool() which is bound to:

  sdk/packages/core/src/extensions/tools/schemas.ts:149
    RunCommandsInputSchema = z.object({
      commands: z.array(CommandInputSchema),
    }).strict();    // <-- additionalProperties: false implied

  sdk/packages/core/src/extensions/tools/schemas.ts:168
    RunCommandsInputUnionSchema = z.union([
      RunCommandsInputSchema,
      StructuredCommandsInputSchema,
      z.object({ commands: StructuredCommandEntrySchema }),
      z.array(StructuredCommandInputSchema),
      StructuredCommandInputSchema,
      z.object({ command: CommandInputSchema }),
      z.object({ cmd: CommandInputSchema }),
      z.array(z.string()),
      z.string(),
    ])

Adding `notifyOnCompletion?: boolean`:
  -> MUST be added to RunCommandsInputSchema AND to every
     non-array / non-string union arm so the model-facing JSON
     schema advertises the field on every accepted shape.
  -> Strict mode (additionalProperties:false) requires the new
     field to be declared.
  -> No proto change needed (run_commands is a JSON-schema tool).
  -> PUBLIC_TOOL_SCHEMA_DELTA = yes (additive, optional, default false)
  -> PROTO_DELTA = no
  -> GENERATED_CLIENT_DELTA = no

## 3.2 Background handoff seam

In apps/vscode/src/sdk/vscode-run-commands-tool.ts the
background path does:

  start = await manager.start({ command, cwd, shell, env,
                                waitBudgetMs, executionDeadlineMs,
                                maxOutputChars }, context)
  if (start.state === "running") {
    // RUNNING branch — tool returns
    // { status: "running", jobId, ... }
  }

The jobId is assigned BEFORE the tool returns. This is the
earliest deterministic point at which the notification marker
may be registered (REGISTER_AFTER_JOB_ID).

Identity captured at this seam:
  - jobId             (from start.jobId)
  - request.notifyOnCompletion (boolean; default false)
  - activeSessionId, activeTaskId (from Controller / activeSession)

## 3.3 Terminal event seam

The production manager exposes per-job terminality via:

  apps/vscode/src/sdk/command-job-manager.ts:206
    terminalPromise: Promise<TerminalTransition>
  apps/vscode/src/sdk/command-job-manager.ts:177
    interface TerminalTransition { becameIdle: boolean }

Always resolves (never rejects). The terminalPromise is the
canonical per-job terminal fact — the existing BTCONT01 test
already drives it end-to-end with a real CommandJobManager.

For the wake consumer we also need the terminal CLASSIFICATION
(exited / cancelled / deadline_exceeded / containment_failed /
failed / spawn_failed) plus reason and exit code. These are
read after terminalPromise resolves via manager.status({ jobId,
waitMs: 0 }) OR via the resolved value of terminalPromise.

The frozen contract calls this seam `command_job_terminal_committed`
(the same event vocabulary used by background-job-liveness-authority.ts
and the BTCONT01 documentation). For this ACT we treat
`terminalPromise.then(transition => ...)` + a status() follow-up
as the implementation of that event. Both BTCONT and the
existing BJLA diagnostic already prove this surface is real
and per-job.

## 3.4 Pending prompt seam

Public surface in SDK:

  sdk/packages/core/src/runtime/host/runtime-host.ts:300
    interface PendingPromptsServiceApi {
      list(...); update(...); delete(...);
    }
  -> enqueue is NOT public on the API.

The canonical wake path in the SDK reaches PendingPromptsController.enqueue
via:

  sdk/packages/core/src/runtime/host/local-runtime-host.ts:1041
    async runTurn(input: SendSessionInput) {
      ...
      if (delivery === "queue" || delivery === "steer") {
        this.pendingPromptsController.enqueue(input.sessionId, {
          prompt: input.prompt, mode: input.mode, delivery,
          userImages: input.userImages, userFiles: input.userFiles,
        });
        return undefined;
      }
      ...
    }

The fork wraps runTurn() in VscodeSessionHost.send():
  apps/vscode/src/sdk/vscode-session-host.ts:405
    async send(input: SendSessionInput) {
      return this.inner.send(input);   // -> SDK runTurn
    }

For v1, the bounded wake seam is:
  activeSession.sdkHost.send({
    sessionId,
    prompt: <bounded wake prompt>,
    delivery: "queue",
  })

This is the only path that reaches PendingPromptsController.enqueue
without bypassing the host. It does NOT start a turn
synchronously; it queues the prompt behind any active work,
which is exactly the frozen "queue behind current turn"
semantics.

The fork's existing pendingPrompts("list"|"update"|"delete")
dispatcher (vscode-session-host.ts:679-692) is observation-only
and does NOT enqueue. We do not need to add a new action to
that dispatcher for v1.

## 3.5 Identity available at handoff

In apps/vscode/src/sdk/SdkController.ts:

  getActiveSession() -> { sessionId, taskId, sdkHost, ... }

The tool factory receives options (VscodeRunCommandsToolOptions)
but the activeSession identity is not currently plumbed through.
For v1 we extend the options with an `activeOwnerResolver`
callback that returns { sessionId, taskId } at register time.
The callback is invoked synchronously inside the running branch
(BEFORE start.terminalPromise.then is attached) so registration
happens with the same identity the rest of the host sees.

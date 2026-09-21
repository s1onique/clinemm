# 13 — Upstream context (non-binding)

Upstream Cline evidence about background-terminal lifecycle,
gathered for design-space awareness. NOT a binding ClineMM contract.

## 13.1 Upstream `background-terminal` plugin example

**Source**: `sdk/examples/plugins/background-terminal.ts` (reproduced in
the fork at the same path).

**Pattern**:

```ts
type JobRecord = {
    jobId, command, cwd, shell,
    startedAt, completedAt?, status: "running"|"completed"|"failed",
    exitCode?, signal?,
    notifyParent: boolean,            // ← opt-in flag, default true
    sessionId?,                        // ← captured at start
    pid?, stdoutPath, stderrPath, metaPath,
};

function startCommand(...) {
    const child = spawn(shell, ["-lc", command], {
        cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], ...
    });
    child.on("close", (code, signal) => {
        const updated = { ...record, status: code===0 ? "completed" : "failed",
                          completedAt: new Date().toISOString(),
                          exitCode: code, signal };
        writeJob(updated);
        if (updated.notifyParent) {     // ← if opt-in,
            emitSteer(updated.sessionId, formatCompletionMessage(updated));
        }
    });
}

function emitSteer(sessionId, prompt) {
    globalThis.__clinePluginHost?.emitEvent?.("steer_message", { sessionId, prompt });
}
```

**Upstream defaults**:

```text
- notifyParent defaults to TRUE when omitted.
- Status is "completed" iff exit code is 0; "failed" otherwise.
- Format of the wake prompt is "Background shell job finished."
  followed by Job ID / Command / CWD / statusLine / STDOUT / STDERR.
- Persistence: jobs are persisted to CLINE_DATA_DIR (a JSON
  per-jobId record).
```

## 13.2 Upstream tool response shape

**Source**: `background-terminal.ts:330-342`

```text
Returns immediately with:
  - jobId
  - status
  - command, cwd, shell, pid, startedAt, notifyParent
  - stdoutPath, stderrPath
  - note: "This tool returns immediately. Use get_background_command
    to poll, or rely on the automatic completion message when the
    command exits."
```

## 13.3 Upstream `agents-squad` plugin (analogous pattern)

**Source**: `sdk/examples/plugins/agents-squad/index.ts:347-354`

```ts
function emitSteer(sessionId, prompt) {
    globalThis.__clinePluginHost?.emitEvent?.("steer_message", { sessionId, prompt });
}

function steerPrompt(subagent) {
    // ... formats a "Sub-agent 'X' completed (time)" prompt
    return [header, body, `Session ID: ${subagent.sessionId}`].filter(Boolean).join("\n\n");
}
```

The pattern: a background subagent, when it finishes, emits
`steer_message` back to the parent session. The parent session's
`AgentEventBridge.handlePluginEvent` routes this through
`PendingPromptsController.enqueue`.

## 13.4 What this means for ClineMM

```text
UPSTREAM_PATTERN =
  explicit async notification is architecturally legitimate

UPSTREAM_MANDATE =
  NONE for ClineMM run_commands

The upstream plugin examples demonstrate the pattern. ClineMM
can adopt it for `run_commands` (Candidate B) or not (Candidate A).

Notable differences from ClineMM:
  - Upstream plugins are USER-INSTALLED, not host-builtin.
  - Upstream `start_background_command` is a DIFFERENT TOOL NAME
    from ClineMM's `run_commands` (which has both foreground and
    background modes).
  - Upstream uses `notifyParent` (typed boolean).
  - Upstream uses `steer_message` plugin event (prompt-shaped).

ClineMM v1 can:
  - Adopt the boolean opt-in (renamed e.g. `notifyOnCompletion`).
  - Emit a typed wake (NOT a natural-language prose blob).
  - Reuse the existing PendingPromptsController.enqueue seam.
```

## 13.5 Upstream README wording (background tasks)

The upstream README describes background tasks as a separate
workflow: "long-running processes continue in the background while
Cline reacts to later output." This is the upstream's `cline
plugin install background-terminal` workflow, NOT a ClineMM
promise. It is informative; not authoritative.

## 13.6 What this ACT does NOT do

This ACT does not implement anything. The upstream pattern is
informative for the implementation ACT (which is the bounded
successor ACT authorized by §18-successor-authorization.md). It
is NOT a mandate; ClineMM may choose to implement the pattern
differently (e.g., a typed wake payload instead of a prose
prompt).

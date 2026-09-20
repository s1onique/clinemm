# 05 — Hypotheses

| ID | Hypothesis | Origin class | LIVE-testable via BJLA extension | Expected discriminator |
|----|------------|--------------|----------------------------------|--------------------------|
| CP1 | Unexpected background_cancel_rpc | gRPC/programmatic | `job_cancellation_requested.origin = "background_cancel_rpc"` | All CommandJob cancellations arrive from the `cancelBackgroundCommand` path; webview sees the cancel fired even though operator did not press the button — i.e. some programmatic caller of the same gRPC seam (e.g. an automatic "old command vs. new command pending" cleanup, see cline/cline#8251) is invoking it |
| CP2 | Host/session disposal cancel | Lifecycle | `job_cancellation_requested.origin = "host_dispose"` paired with `manager_dispose_begin` | Manager is being torn down at the moment of cancellation; task/session remains otherwise visible |
| CP3 | Caller AbortSignal propagation | Lifecycle | `job_cancellation_requested.origin = "caller_abort_signal"` paired with `abort_signal_aborted` | Cancellation coincides with `context.signal.abort` on the caller-supplied signal passed to `CommandJobManager.start`; the run_commands tool does NOT currently pass `context.signal` for background jobs, so this is INFERRED only |
| CP4 | Timeout/deadline | Lifecycle | `job_active_removed.reason = "deadline"` | Distinct from `cancel`; LIVE evidence says `cancel` so CP4 is refuted at the evidence level |
| CP5 | Tool/run cleanup cancel | Tool | `job_cancellation_requested.origin = "tool_cleanup"` paired with tool teardown | `vscode-run-commands-tool` cleanup path calls `commandJobManager.cancel`; recon shows no such caller exists in the production seam |
| CP6 | Extension/runtime teardown cancel | Lifecycle | `job_cancellation_requested.origin = "extension_shutdown"` paired with `runtime_shutdown_requested` | `SdkController.dispose()` calls `lifecycle.dispose()` which calls `host.dispose()` which calls `manager.dispose()` which terminates all active jobs |
| CP7 | Other proven requester | TBD | n/a | If none of CP1-CP6 fit, this is the escape |

## Primary discriminating test

The single new BJLA event `job_cancellation_requested` carries:

```json
{
  "event": "job_cancellation_requested",
  "capturedAt": <ms>,
  "jobId": "cmd_...",
  "managerInstance": "M2",
  "hostInstance": "H?",
  "requestOrigin": "<one of the discovered callers>",
  "taskId": "...",
  "sessionId": "...",
  "currentState": "running"
}
```

The `requestOrigin` is THREADED explicitly by each production caller as an
internal-only second argument to `manager.cancel()` and as an internal
flag on the dispose path. The diagnostic capture is verbatim at the
request boundary, BEFORE any mutation, so the dump can correlate the
request origin with the existing `command_job_termination_started`,
`command_job_primary_group_cleanup`, `job_active_removed` chain.

## Discovery order

```text
1. operator runs `sleep 600` (or similar long-running command)
2. operator does NOT click Cancel
3. operator does NOT send another message
4. operator does NOT switch modes
5. operator does NOT restart/reload VS Code
6. operator waits for "Working → Your turn" or cancellation
7. operator dumps BJLA
```

If the BJLA dump shows `job_cancellation_requested.origin = "background_cancel_rpc"`
but the operator did not click Cancel, the classification is CP1
(programmatic caller of the public cancel RPC seam).
If it shows `manager_dispose`, it is CP2 (manager dispose loop — no
production caller currently invokes it directly).
If it shows `extension_shutdown`, it is CP6 (host.dispose via
lifecycle.dispose via controller.dispose).
If it shows `caller_abort_signal`, it is CP3.
If `job_active_removed.reason = "deadline"` it is CP4 (refutes the LIVE evidence
because the LIVE evidence records `cancel`).

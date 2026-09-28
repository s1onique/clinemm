# 03 — MCP Autostart Live (LIVE-A + LIVE-B, operator observes)

## §6 Cold-start precondition (LIVE-A)

```text
LIVE_PRE_SESSION_UI_STATE       = PENDING_OPERATOR_LIVE_RUN
LIVE_PRE_SESSION_CHILD_PRESENT  = PENDING_OPERATOR_LIVE_RUN
MANUAL_MCP_RESTART_COUNT        = 0
```

Expected after a fully-quit Codium relaunch on the .vscodium-cline
profile with installed build s1onique.clinemm-4.1.16-89249175c:

  myc runtime state              = pending-session / deferred
  myc tools surfaced to webview  = 0
  myc child stdio process        = NOT spawned

Verification command (operator terminal):

```bash
pgrep -f 'myc mcp'
# expect: empty
```

If a child already exists at this point:
  HALT_SESSION_BOUND_MCP_PREMATURE_SPAWN

## §10 LIVE-A: post-session state (after Start New Task)

```text
LIVE_POST_SESSION_UI_STATE      = PENDING_OPERATOR_LIVE_RUN
LIVE_MANUAL_MCP_RESTART_COUNT   = PENDING_OPERATOR_LIVE_RUN
```

Expected immediately after task start (within ~2 seconds):

  myc runtime state              = connected (still zero Restart click)
  myc tools surfaced to webview  > 0

Failure matrix:

```text
no child                            -> HALT_LIVE_SESSION_MCP_NOT_STARTED
child but panel still deferred      -> HALT_LIVE_MCP_PROJECTION_STALE
child session != S                  -> HALT_LIVE_MCP_SESSION_ID_MISMATCH
manual Restart required             -> HALT_MANUAL_MCP_RESTART_STILL_REQUIRED
```

## Runtime evidence

```text
LIVE_MYC_CHILD_STARTED             = PENDING_OPERATOR_LIVE_RUN
LIVE_MYC_CHILD_SESSION_ID          = PENDING_OPERATOR_LIVE_RUN
LIVE_MYC_TOOL_COUNT                = PENDING_OPERATOR_LIVE_RUN
```

Verification commands (operator terminal):

```bash
pgrep -lf 'myc mcp' | head -5
# expect at least one '/Volumes/UserData/Users/chistyakov/.myc/bin/myc mcp'
# that was NOT there in §6.

MYC_PID=$(pgrep -f 'myc mcp' | head -1)
ps -o pid,ppid,command -p $MYC_PID
ps eww -p $MYC_PID | tr ' ' '\n' | grep -E '^(MYC_SESSION_ID|MYC_ACTOR|MYC_REACH)='
# expect: MYC_SESSION_ID=<S>
```

The bounded-bootstrap repair (HEAD 89249175c) governs the MCP
bootstrap on this path: `McpHub.ensureSessionConnection` now uses
capability-aware, per-request-timeout `client.request(...)` calls
in place of the unbounded `Promise.allSettled` aggregate. A child
that completes `initialize` but stalls on `resources/list` (or any
other list method) no longer hangs `createVscodeExtraTools` →
`prepareStartSessionInput` → `ClineCore.startSession` forever; the
per-server `resolveMcpServerTimeoutMs(staticConn.server.config)`
fires and the bootstrap continues. This is the load-bearing repair
this ACT live-qualifies.

## Background

The autostart qualification itself (deferred template status
reconciled to "connected" when a per-session child spawns) is
ACT-MYC-CLINEMM-MCP-SESSION-AUTOSTART01 (commit 046b4ab30). The
symmetric teardown projection is
ACT-MYC-CLINEMM-MCP-SESSION-AUTOSTART01 CORRECTION01 (commit
99ff0b356). Both are preserved in source HEAD. The bounded
discovery at the post-connect step is the new repair
(HEAD 89249175c) live-qualified here.
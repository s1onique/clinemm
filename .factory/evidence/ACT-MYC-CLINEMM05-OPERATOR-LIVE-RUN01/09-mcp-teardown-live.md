# 09 — MCP Teardown Live (LIVE-L, operator observes)

## §21 LIVE-L: MCP teardown

After session end (chat closed via X / Trash icon, ~2s wait):

```text
LIVE_POST_DISCONNECT_UI_STATE      = PENDING_OPERATOR_LIVE_RUN  (target: pending-session/deferred)
LIVE_POST_DISCONNECT_CHILD_PRESENT = PENDING_OPERATOR_LIVE_RUN  (target: false)
```

This live-qualifies AUTOSTART01 CORRECTION01 symmetry: when the last
live ClineMM session ends, the MCP projection returns to
pending-session/deferred and the spawned myc child stdio process
exits.

Verification command (operator terminal):

```bash
pgrep -f 'myc mcp'
# expect: empty
```

Failure boundaries:

```text
UI stays connected but no child      -> HALT_LIVE_MCP_TEARDOWN_PROJECTION_STALE
child still alive                    -> HALT_LIVE_MCP_CHILD_LEAK
```

Caveat: if another legitimate ClineMM session is alive, do NOT
expect teardown to deferred — the projection correctly stays
connected until the last session ends.

## Background

AUTOSTART01 CORRECTION01 (commit 99ff0b356, "symmetric teardown
projection + evidence reclassification") added the symmetric
teardown path. It is preserved on HEAD 89249175c — HEAD 89249175c
only touches `apps/vscode/src/services/mcp/McpHub.ts`, not the
projection state machine. The teardown code path that returns the
projection to pending-session/deferred is unchanged.
# Auto vs Manual Discriminator

## Auto path (startNewSession → ensureSessionConnection)
- Runtime child spawns (line 189-194 of sessionIdEcho.productionShape.test.ts style).
- `sessionConnections.get(S).get(name).server.status === "connected"`.
- BUT `hub.connections[0].server.status === "pending-session"` (the static entry pushed by `updateServerConnections` line 1541-1551 is never updated).
- `hub.getServers()` returns `this.connections.filter(!disabled)` (McpHub.ts:191) which contains only the stale `pending-session` entry.
- Operator sees red/orange despite the runtime being connected.

## Manual path (operator clicks Restart Server)
- `restartConnection` deletes the entry (line 1776), then calls `connectToServer` (line 1778).
- `connectToServer` rebuilds the entry with `status: "connected"` (its normal legacy flow).
- `hub.getServers()` returns the new connected entry.
- Operator sees green.

## The first divergence

Auto path updates `sessionConnections.get(S).get(name).server.status` ONLY.
Manual restart path updates `this.connections[i].server.status` for the static entry.

The webview reads the static entry. The auto path leaves it stale.

## Frozen hypotheses re-evaluation

| ID | Hypothesis | Disposition |
|----|------------|-------------|
| H1 | Session start never requests a connection. | REFUTED — RED-2 proves `sessionConnections.get(S).get(name).server.status === "connected"`. |
| H2 | Session start requests it, but server remains classified as "deferred". | PARTIAL — the per-session child is connected; the STATIC entry remains "pending-session". |
| H3 | Tool discovery uses stale provider. | REFUTED — fresh provider per session. |
| H4 | ensureSessionConnection receives S but does not materialize. | REFUTED — `conn.server.status === "connected"` confirms. |
| H5 | Child starts, but UI/server state remains stale. | **CONFIRMED** — the static `pendingConn` in `this.connections` is never updated when the per-session child succeeds. |
| H6 | Child startup fails; manual restart succeeds. | REFUTED — RED-2 shows the auto child starts correctly. |

## ROOT_CAUSE

The deferred-template path stores a sentinel `pendingConn` in `this.connections` at
settings-load time (`updateServerConnections`, line 1541-1551). After the
per-session child spawns through `ensureSessionConnection`, the static entry is
never reconciled with the per-session success — its `status` stays
`"pending-session"`. The webview reads `getServers()` which returns the static
entry, so the operator sees the same red/orange status post-session as
pre-session.

## REPAIR shape (minimal)

After `ensureSessionConnection` successfully connects the per-session child,
flip the corresponding static entry's `status` from `"pending-session"` to
`"connected"` and copy in the discovered tools/resources/prompts so the
webview projection is consistent.

This is a 5-10 line change inside `ensureSessionConnection`:
1. Locate the static entry by name in `this.connections`.
2. Set `staticConn.server.status = "connected"`.
3. Optionally copy tools from `client.listTools()` so the webview's tool
   listing updates immediately.
4. Trigger `notifyWebviewOfServerChanges()` so the webview re-reads.

This is the ONLY production change needed.

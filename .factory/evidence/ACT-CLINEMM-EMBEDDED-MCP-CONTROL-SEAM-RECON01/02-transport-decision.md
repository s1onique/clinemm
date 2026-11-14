# C2 — MCP transport feasibility and trust boundary

**Label: `STRUCTURAL` + `REAL_PRODUCTION_SEAM` (the transport is exercised
over a real AF_UNIX socket and a real MCP stdio server).**

---

## C2.1 The chain under evaluation

```
Codex (MCP stdio client)
  -> local proxy  (apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts)
     a LOCAL child process Codex launches over stdio
  -> AF_UNIX socket
  -> extension-host listener (apps/vscode/src/sdk/control-seam/control-seam-server.ts)
```

The proxy binds nothing and listens on nothing. The extension host binds
one AF_UNIX socket and never binds an INET socket.

---

## C2.2 Decision: what was chosen, and what was rejected

| Option | Decision | Reason |
|---|---|---|
| **A. AF_UNIX socket in the extension host + local stdio MCP proxy** | **CHOSEN** | Satisfies every charter property. The socket is unreachable from the network by construction (an AF_UNIX path is not routable). The proxy is a local child process that Codex already knows how to launch. No new dependency, no new public protocol. |
| B. The extension host speaks MCP directly over stdio | REJECTED | The extension host's stdio is owned by VS Code. A second stdio consumer on the same fds would corrupt the host's own channel. |
| C. A TCP listener on localhost | REJECTED | Violates "local-only, **no TCP exposure**" outright. A localhost TCP port is reachable by any local process and by anything that can reach the loopback, and it is trivially confused with the (correctly absent) Hub WebSocket surface the predecessor ACT classified as `CLI_DESKTOP_ONLY`. |
| D. A generic RPC framework over the socket | REJECTED | The charter says "Do not build a generic RPC framework." The wire is one NDJSON envelope with a **frozen two-entry operation registry**. |
| E. Reuse the Hub WebSocket / `HubRuntimeHost` transport | REJECTED | The predecessor ACT proved the Hub subtree is tree-shaken out of the shipped VS Code bundle (`grep -c 'HubRuntimeHost' apps/vscode/dist/extension.js` → 0). Bringing it back would re-introduce a large, out-of-scope surface and contradict R-08. |
| F. Reuse the MCP client (`McpHub`) to expose the seam | REJECTED | `McpHub` is an MCP **client** — it connects outward to external servers. The seam needs the opposite direction (an external client connecting inward), and routing the seam through `McpHub` would place a credential-bearing, stdio-spawning client surface on the path. |
| G. Reuse the host-helper AF_UNIX boundary | REJECTED (as the transport) | The host-helper socket (`resolveHostHelperSocketPath`, `sdk/packages/shared/src/runtime/host-helper-socket.ts`) is a **trusted-helper** channel with its own C-side protocol, its own LaunchAgent ownership and its own Seatbelt rules. Reusing it would mix two trust domains: the helper runs *outside* the IDE sandbox precisely so it can signal process groups. The seam is a *read-only observer*, which does not need that privilege, and the helper's socket is owned by `launchd`, not by the extension host. The seam therefore borrows only the **pattern** (AF_UNIX + private dir + owner-only modes) and nothing else. |

---

## C2.3 Required properties — how each is satisfied

| # | Required property | How it is satisfied | Enforced at |
|---|---|---|---|
| 1 | **Default OFF** | `resolveControlSeamEnablement(env, optInRecordPresent)` returns `enabled: false` with no env override and no opt-in record. There is **no** build-profile tier that turns it on — deliberately, because a build-derived default would mean a developer build silently listens on a socket. | `control-seam-enablement.ts:56-76`; CS04/CS05/CS06 |
| 2 | **Local-only, no TCP exposure** | The listener is created with `net.createServer()` and `server.listen(<absolute path>)`. An absolute filesystem path makes Node bind an **AF_UNIX** socket. `net.createServer().listen(path)` has no INET form. The proxy binds nothing. | `control-seam-server.ts:167-170`; CS21 (the path is a filesystem path, not `host:port`) |
| 3 | **Private socket directory and access controls** | The directory is `<clineDir>/data/control-seam/` created with mode `0700` and **re-asserted with `chmodSync`** (because `mkdir` honours the umask). The socket file and the token file are written with mode `0600` and re-asserted the same way. | `control-seam-server.ts:144-155`; CS14 (asserts `0700` / `0600` on disk) |
| 4 | **Explicit client authorization** | Every request line carries a bearer token. The server compares it with `constantTimeEquals` (length first, then a constant-time content compare) and refuses on mismatch with a **non-informative** error. The token is per-start random (32 bytes → 64 hex chars) and is written to a `0600` file only the owner can read. | `control-seam-server.ts:283-289`; CS07, CS08, CS16, PX05 |
| 5 | **No credentials or transcripts in diagnostic logs** | The token is never passed to `Logger`. The only log lines are `"[ControlSeam] disabled (source=…)"`, `"[ControlSeam] listening on <path> (source=…)"` and `"[ControlSeam] disposed"` — none carry the token, a session id, or any task content. The error envelopes carry fixed codes and fixed messages. | `control-seam-server.ts` (3 `Logger` calls, none with the token); CS07/CS09 assert the response body discloses nothing |
| 6 | **No permanent public protocol/API change without separate review** | The seam is **not** a public surface: no new gRPC RPC, no new proto message, no new `package.json` command, no new entry in `src/registry.ts`, no new export from `@cline/shared` or `@cline/core`. The wire protocol is a **private, versioned** NDJSON envelope (`CONTROL_SEAM_PROTOCOL_VERSION = 1`) whose operation set is a frozen literal. | `git diff --stat` (no proto/, no package.json, no registry.ts, no shared barrel); `control-seam-protocol.ts:48-77` |
| 7 | **Full cleanup on extension deactivation** | `Controller.dispose()` awaits `controlSeam.dispose()` **before** `this.sessions.dispose(...)`. `dispose()` closes the listener, destroys every tracked socket, and `rmSync`s both the socket file and the token file. It is idempotent and never throws. | `SdkController.ts:3675-3681`; `control-seam-server.ts:224-286`; CS15 |

---

## C2.4 An extension-host listener can be created and removed without modifying task semantics

| Concern | Answer | Evidence |
|---|---|---|
| Does creating the listener touch task state? | **No.** `ControlSeamServer.start()` performs exactly three filesystem operations (`mkdir` the private dir, write the token file, `listen`) and one `chmod`. It reads nothing from the session lifecycle and writes nothing to it. | `control-seam-server.ts:127-176` |
| Does removing the listener touch task state? | **No.** `dispose()` closes the listener and removes two files. It never calls `abort`, `stop`, `clearTask`, or any lifecycle mutator. | `control-seam-server.ts:224-286` |
| Does the listener hold a subscription? | **No.** The seam holds only the authority's five read closures. | §C1.3 |
| Can the listener's lifetime change when a run starts/stops? | **No.** The listener's lifetime is bound to the controller, not to a session. A session rebuild replaces the `ActiveSession`; the seam simply reads the new one on the next request. | PS01/PS02/PS03 |
| Can the listener's presence change an event, a phase, or a completion? | **No.** It is not on the event path (no subscription) and not on the publication path (no state post). | §C1.2 |

---

## C2.5 The trust boundary

```
┌───────────────────────────────────────────────────────────────────┐
│ UNTRUSTED-ADJACENT: any local process that can open the socket   │
│   gate: the 0600 token file (readable only by the owning user)   │
│   gate: constant-time bearer comparison per request line         │
│   -> may read ONLY: sessionId, taskId, running, runtimeStatus,   │
│      queuedPromptCount, runId                                    │
└───────────────────────────────────────────────────────────────────┘
              ^ AF_UNIX socket (mode 0600, inside a 0700 dir)
              |
┌───────────────────────────────────────────────────────────────────┐
│ TRUSTED: the extension host process                              │
│   owns the ActiveSession; the seam reads it and nothing else     │
└───────────────────────────────────────────────────────────────────┘
              ^ stdio (the MCP protocol)
              |
┌───────────────────────────────────────────────────────────────────┐
│ THE MCP CLIENT: Codex                                            │
│   launched the local proxy; sees only the two read-only tools    │
└───────────────────────────────────────────────────────────────────┘
```

**What the boundary does NOT permit.** Even a fully authorized client
cannot:

- start a run — there is no operation for it (§C1 d);
- send feedback — there is no operation for it (§C1 e);
- cancel a run — there is no operation for it (§C1 f);
- approve a tool — the approval gate is reached only through
  `SdkInteractionCoordinator.handleRequestToolApproval`, which the seam
  cannot reach (§C4.6);
- read a transcript, a message, a tool argument, a credential or a
  configuration value — the payload allow-list rejects every key
  outside the six identity/status fields (§C4.7).

**Where the proxy sits.** The proxy runs as a **child of Codex**, not of
the extension host. It reads the token file (0600) and opens one
outbound AF_UNIX connection. It is therefore a *client* of the seam,
and it holds no authority the seam did not already grant to its user.

---

## C2.6 New advisory exposure introduced by this ACT

The predecessor ACT's R-06 recorded that `@modelcontextprotocol/sdk@1.30.0`
is below the fix floor for five advisories, and that the reachable
client-side sub-cases are **gated**, not closed.

| Item | Assessment |
|---|---|
| Does this ACT add a **server-side** MCP surface? | **Yes** — `control-seam-proxy.ts` uses the SDK's `McpServer` + `StdioServerTransport`. |
| Is it reachable by default? | **No.** The proxy is a separate process the operator must point Codex at. The extension host's listener is **default OFF**. Neither runs unless explicitly enabled. |
| Does it expose an advisory-relevant sub-case? | The predecessor's advisories concern the **client** side (OAuth redirect handling, origin binding). This surface is a **stdio server** with **no OAuth**, **no redirect**, **no HTTP**, **no SSE**, **no streamable-HTTP**. There is no origin to bind and no redirect to follow. |
| Does it widen the existing client-side exposure? | **No.** `McpHub` is untouched. The seam's proxy is a *separate* process with its own stdio channel. |
| Net delta | **A new, default-off, local, read-only stdio server surface with no OAuth/redirect/HTTP.** Bounded and reversible (delete the directory; the listener is gone). |

The R-06 advisory itself is **carried forward unchanged** as the
predecessor recorded it; this ACT does not claim to close it.

---

## C2.7 The AF_UNIX path-length constraint (a real finding)

The first execution of the transport failed with:

```
Error: listen EINVAL: invalid argument
  /private/var/folders/0g/…/T/clinemm-sandbox-temp-8imK8r/clinemm-control-seam-qaFuEO/control.sock
```

Measured: that path is **125 bytes**. `sock_path` in `struct sockaddr_un`
is 108 bytes (104 usable after the NUL) on macOS. A long `TMPDIR` — or a
long `CLINE_DIR` — therefore makes an AF_UNIX listener **impossible to
create**.

The seam now **fails closed with an actionable message** instead of an
opaque `EINVAL`:

```
[ControlSeam] socket path is too long for an AF_UNIX listener
  (125 bytes > 100); set a shorter CLINE_DIR
```

- `control-seam-paths.ts:26-38` — `CONTROL_SEAM_MAX_SOCKET_PATH_LENGTH = 100`
- `control-seam-paths.ts:95-103` — `isControlSeamSocketPathUsable()`
- `control-seam-server.ts:141-150` — the guard, **before** `listen()`

This is a genuine constraint on the deployment, not a defect in the
implementation: **an operator who enables the seam must have a
`CLINE_DIR` short enough for an AF_UNIX path.** The default
(`~/.cline`) satisfies it on a normal macOS/Linux home directory.

---

## C2.8 Verdict

**`STRUCTURAL` + `REAL_PRODUCTION_SEAM`.**

The transport is feasible with all seven required properties satisfied
by construction, the trust boundary is narrow and explicit, and the
listener's creation and removal provably do not modify task semantics.
One real operational constraint was discovered and is now fail-closed
with an actionable message (§C2.7).

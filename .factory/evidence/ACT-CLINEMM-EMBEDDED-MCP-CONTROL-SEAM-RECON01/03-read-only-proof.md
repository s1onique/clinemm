# C3 — The bounded read-only proof

**Label: `REAL_PRODUCTION_SEAM` (executed against real production
classes) — installed-extension observation `LIVE_UNOBSERVABLE`.**

---

## C3.1 What was implemented

Two operations. Nothing else.

| Operation id | MCP tool name | What it returns |
|---|---|---|
| `clinemm_capabilities` | `clinemm_capabilities` | The protocol version, the list of operation ids + descriptions, `readOnly: true`, and the host's `{extensionVersion, platform}`. **No session identity.** |
| `clinemm_get_run` | `clinemm_get_run` | `{sessionId, taskId?, running, runtimeStatus?, queuedPromptCount, runId?}`. Optional fields are OMITTED, never `null`. |

Files (all new, all under `apps/vscode/src/sdk/control-seam/`):

| File | Lines | Role |
|---|---|---|
| `control-seam-protocol.ts` | 278 | The wire protocol + the frozen operation registry + the payload allow-list |
| `control-seam-authority.ts` | 100 | The read-only authority projection over the controller's session owner |
| `control-seam-paths.ts` | 103 | The private directory layout + the AF_UNIX path-length guard |
| `control-seam-enablement.ts` | 76 | The pure default-OFF resolver |
| `control-seam-server.ts` | 360 | The AF_UNIX listener in the extension host |
| `control-seam-client.ts` | 126 | The NDJSON client (transport-agnostic) |
| `control-seam-proxy.ts` | 144 | The local stdio MCP server (what Codex launches) |
| `control-seam-proxy-main.ts` | 34 | The proxy's process entry point |
| `control-seam-runtime.ts` | 108 | The controller-owned lifecycle wrapper |
| `control-seam.recon01.test.ts` | — | The C3/C4 matrix (21 tests) |
| `control-seam-authority.production-shape.test.ts` | — | The production-shape witness (3 tests) |
| `control-seam-proxy.test.ts` | — | The MCP-surface witness (5 tests) |

Production wiring: `apps/vscode/src/sdk/SdkController.ts` — 2 imports,
1 field, 1 construction block (constructor), 1 dispose call.

---

## C3.2 The exposure allow-list

The seam's payload allow-list is enforced **in code**, not by review:

```
ALLOWED_RUN_IDENTITY_KEYS = { sessionId, taskId, running,
                               runtimeStatus, queuedPromptCount, runId }
```

`isControlSeamRunIdentity()` rejects any payload carrying a key outside
that set, and `ControlSeamServer.handleGetRun()` applies the check on
the way OUT — so a widened payload **fails closed at the boundary**
rather than reaching the wire. CS13 proves this for
`transcript`, `messages`, `toolArguments`, `apiKey`, `config` and
`prompt`.

---

## C3.3 `clinemm_get_run` reads the EXISTING session owner

The seam does not reconstruct state, does not read the webview, and
does not start another runtime. The proof is structural and executed:

| Requirement | How it is met | Witness |
|---|---|---|
| Reads the existing session owner | `this.sessions.getActiveSession()` — the controller's own `SdkSessionLifecycle` | PS01, PS03 |
| Does not reconstruct state from the webview | The seam never imports the webview state, never calls `getStateToPostToWebview()`, never subscribes to a gRPC stream | §C1.2 |
| Does not start another runtime | The seam's module graph contains no `ClineCore.create`, no `VscodeSessionHost.create`, no `startNewSession` | §C1.4 |
| Reads the AUTHORITATIVE status | `runtimeSnapshot()` → `ClineCore.getActiveRuntimeSnapshot` → `LocalRuntimeHost.getActiveRuntimeSnapshot` → `AgentRuntime.snapshot()` — the runtime's own snapshot, not the legacy mirror | PS01 |

---

## C3.4 The disposable instance

The ACT asks for a disposable instance where possible. The seam's
**tests** use disposable instances by construction:

- every test creates its own `mkdtemp` directory under `/tmp` with a
  short prefix, its own socket file and its own token file;
- the production-shape witness drives the **real** `SdkSessionLifecycle`
  but installs a session through `attachExistingSession`, which
  **creates no runtime and starts no turn** (`sdk-session-lifecycle.ts:649-675`);
- the listener is disposed in `afterEach`, which removes the socket and
  the token.

No test touches the developer's real `~/.cline`, and no test starts an
agent run.

---

## C3.5 The executed read-only probe

**Command:**

```
cd apps/vscode && bunx vitest run --config vitest.config.ts src/sdk/control-seam/
```

**Result (verbatim tail):**

```
 ✓ src/sdk/control-seam/control-seam-proxy.test.ts (5 tests) 60ms
 ✓ src/sdk/control-seam/control-seam.recon01.test.ts (21 tests) 65ms
 ✓ src/sdk/control-seam/control-seam-authority.production-shape.test.ts (3 tests) 13ms

 Test Files  3 passed (3)
      Tests  29 passed (29)
```

### The successful observation (CS01)

An authorized client over a **real AF_UNIX socket** against a **real
`ControlSeamServer`**:

```
response.ok === true
response.result === {
  sessionId: "session-alpha",
  taskId:    "task-alpha",
  running:   false,
  queuedPromptCount: 0,
}
```

### The same identity, read by the extension host itself (PS03)

The **real `SdkSessionLifecycle`** owns the session; the external client
and the extension host read the SAME record:

```ts
expect(response.result).toMatchObject({
  sessionId: lifecycle.getActiveSession()?.sessionId,      // "session-shared"
  running:   lifecycle.getActiveSession()?.isRunning,       // true
  queuedPromptCount: lifecycle.getActiveSession()?.queuedPromptCount, // 1
  runtimeStatus: "streaming",
  runId: "run-shared",
})
```

**This is the ACT's success criterion**, at the source/test seam:
*an external client retrieves the same session identity and
authoritative status as the running extension, with no new execution
owner.*

---

## C3.6 Negative controls

| # | Negative control | Expected | Observed | Test |
|---|---|---|---|---|
| N1 | Wrong bearer token | `control_seam_unauthorized`, and the response body discloses no session data | exactly that | CS07 |
| N2 | Empty bearer token | `control_seam_bad_request` | exactly that | CS08 |
| N3 | Unknown operation id (`start_act`) | rejected at the decoder (never reaches the server) | `undefined` from the decoder | CS18 |
| N4 | Protocol version mismatch | rejected at the decoder | `undefined` from the decoder | CS18 |
| N5 | Malformed line (not JSON) | rejected at the decoder | `undefined` from the decoder | CS18 |
| N6 | No active session | `control_seam_no_active_run` | exactly that | CS17 |
| N7 | No installed instance (proxy) | `control_seam_no_instance`, `isError: true` | exactly that | PX04 |
| N8 | Wrong token at the MCP layer | `control_seam_unauthorized` | exactly that | PX05 |

---

## C3.7 The LIVE gate

| Gate | Status | Reason |
|---|---|---|
| Installed-extension live observation | **`LIVE_UNOBSERVABLE`** | No ClineMM extension is installed on this host, and the debug harness's Electron child died with `SIGSEGV` in this sandbox (§C0.4). The operator is running the live bundle manually. |
| Source/test seam observation | **`REAL_PRODUCTION_SEAM`** | Executed — 29/29 tests, real AF_UNIX socket, real `SdkSessionLifecycle`, real MCP stdio server. |
| Bundle-level reachability of the seam | **PROVEN** | `grep -c 'ControlSeam' apps/vscode/dist/extension.js` → **42**; `grep -o 'clinemm_get_run'` → present; `grep -o 'control_seam_unauthorized'` → present. |

---

## C3.8 Verdict

**`REAL_PRODUCTION_SEAM`**, with the installed-instance gate recorded as
**`LIVE_UNOBSERVABLE`**.

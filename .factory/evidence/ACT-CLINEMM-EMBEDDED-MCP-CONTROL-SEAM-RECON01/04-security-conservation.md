# C4 — Security and conservation

**Label: `REAL_PRODUCTION_SEAM` (all seven requirements are executed
witnesses).**

---

## C4.1 Disabled bridge produces no task-state semantic delta

| Claim | Evidence |
|---|---|
| A disabled seam creates **no listener** | `ControlSeamServer.start()` returns `undefined` before any filesystem or network call — `control-seam-server.ts:132-137` |
| A disabled seam creates **no socket file** | `existsSync(harness.socketPath)` → `false` (CS04) |
| A disabled seam creates **no token file** | `existsSync(harness.tokenPath)` → `false` (CS04) |
| A disabled seam creates **no directory** | The `mkdirSync` is reached only **after** the enablement check (`control-seam-server.ts:141-146`) |
| The default resolver says OFF | `resolveControlSeamEnablement({}, false)` → `{enabled: false, source: "default-off"}` (CS05) |
| The disabled path touches no task state | The seam's module graph contains no lifecycle, no host, no runtime (§C1.4) |

**`C4.1 = PROVEN`** (CS04, CS05, CS06).

---

## C4.2 Unauthorized clients cannot read session information

| Control | Evidence |
|---|---|
| A bearer token is **required** on every request line | `decodeControlSeamRequest` rejects an empty token outright (`control-seam-protocol.ts:249-274`) |
| The token is compared **constant-time** | `constantTimeEquals` — length first, then a non-short-circuiting XOR accumulation (`control-seam-protocol.ts:221-233`) |
| A wrong token is refused **before** any operation dispatch | `control-seam-server.ts:283-289` — the check precedes the `switch` |
| The refusal discloses **nothing** | The error envelope is `{code: "control_seam_unauthorized", message: "control-seam authorization failed"}` — no session id, no host identity, no existence oracle |
| The token is **per-start random** and owner-only | 32 random bytes → 64 hex chars; written `0600` inside a `0700` directory (CS14, CS16) |
| The token is **never logged** | The three `Logger` calls in the server carry the source and the socket path only |

**`C4.2 = PROVEN`** (CS07, CS08, CS14, CS16, PX05).

---

## C4.3 A stale/foreign session identifier does not disclose another run

| Control | Evidence |
|---|---|
| The client MAY echo a session id; the server compares it to the **active** session only | `control-seam-server.ts:334-343` |
| A mismatch is refused with a **fixed** code | `control_seam_foreign_session` |
| The refusal does not confirm or deny that the echoed id exists | The message is a fixed string; the response contains neither the echoed id nor the active id |
| The **active** id is never disclosed to a mismatching caller | The identity is computed first, but the mismatch branch returns **before** the identity is placed in the response |

**`C4.3 = PROVEN`** (CS09, CS10).

---

## C4.4 Repeated reads are idempotent

| Control | Evidence |
|---|---|
| Three consecutive `clinemm_get_run` calls return byte-identical payloads | CS11 asserts `JSON.stringify(first.result) === JSON.stringify(second.result) === JSON.stringify(third.result)` |
| The read is a pure projection | `readControlSeamRunIdentity` performs **no** write and **no** await; it reads five closures and returns a new object |
| No counter, no cache, no accumulation | The seam holds no mutable state between requests other than the socket bookkeeping |

**`C4.4 = PROVEN`** (CS11).

---

## C4.5 Bridge disconnect does not stop or change an agent run

| Control | Evidence |
|---|---|
| The seam holds **no** abort/stop reference | `ControlSeamAuthority` has five members, all reads (§C1.3). There is no `abort`, `stop`, `cancelTask` or `clearTask` reachable from the seam's module graph. |
| A client disconnect is a **socket** event, not a session event | The server's `socket.on("close")` handler only removes the socket from the tracking set (`control-seam-server.ts:265-268`) |
| The session survives the disconnect | CS12: after `socket.destroy()`, a fresh request still returns `{sessionId: "session-running", running: true}` |
| The host's own mutators are unaffected | PS02: `lifecycle.setRunning(true)` / `setQueuedPromptCount(2)` behave identically whether or not a client is attached |

**`C4.5 = PROVEN`** (CS12, PS02).

---

## C4.6 Existing tool approval and cancellation paths remain unchanged

| Path | Owner | Change made by this ACT |
|---|---|---|
| Tool approval | `SdkInteractionCoordinator.handleRequestToolApproval` → `SdkSessionLifecycle` `requestToolApproval` | **NONE.** The seam does not import, reference, or reach the approval coordinator. |
| Approval denial / correlation | `tool-approval-denial.ts`, `approval-rejection-correlation-fail-closed-recon01.test.ts` | **NONE** |
| Task cancellation | `Controller.cancelTask()` → `SdkTaskControlCoordinator.cancelTask()` | **NONE.** The seam has no cancel path. |
| Background-command cancellation | `VscodeSessionHost.cancelBackgroundCommand(jobId?)` (host-only, duck-typed) | **NONE.** The seam never calls it. |
| `abort` | `VscodeSessionHost.abort(sessionId, reason?)` → `ClineCore.abort` → `LocalRuntimeHost.abort` | **NONE.** |
| `stop` | `VscodeSessionHost.stop(sessionId)` | **NONE.** |

**Diff surface.** The entire production diff is:

```
apps/vscode/src/sdk/SdkController.ts   (+2 imports, +1 field, +1 construction block, +1 dispose call)
apps/vscode/src/sdk/control-seam/*     (all new)
```

No file under `src/core/`, `src/services/`, `src/shared/`, `proto/`, or
`src/registry.ts` was touched. No `package.json` command was added. No
proto message or gRPC RPC was added.

**`C4.6 = PROVEN`** (by diff surface + the absence of any reaching
reference).

---

## C4.7 No exposed operation can invoke `run_commands`, `editor`, file reads or other mutating tools

| Control | Evidence |
|---|---|
| The operation registry is a **frozen literal** with a **type-level** `mutating: false` | `ControlSeamOperation` only admits `mutating: false`, so adding a mutating operation requires changing the type — a review signal |
| The registry has exactly **two** entries, both read-only | CS03 |
| The registry contains no `start_act` / `send_feedback` / `cancel_run` | CS03 |
| The MCP server registers exactly **two** tools | PX01 asserts `listTools()` returns exactly `["clinemm_capabilities", "clinemm_get_run"]` |
| The MCP server registers no `run_commands` / `editor` / `read_file` | PX01 |
| The payload allow-list rejects transcript/credential/config keys | CS13 |
| The seam's module graph imports **no** tool executor | The seam imports only `node:crypto`, `node:fs`, `node:net`, `node:path` and its own modules — no `vscode-run-commands-tool`, no `vscode-file-read-executor`, no `diffEdits` |

**`C4.7 = PROVEN`** (CS03, CS13, PX01).

---

## C4.8 Conservation of the pre-existing semantics

The ACT's C0 requires that the existing C9/C10, BCB, Elm, native editor,
approval and session ownership semantics are preserved.

| Semantic | Conservation argument | Receipt |
|---|---|---|
| **C9 / C10** (background-command completion ownership / notification) | The seam observes only the active session's identity and status. It does not read `MessageTranslatorState`, does not call `recordLaunchedBackgroundJob`, does not touch `BackgroundNotifyCoordinator`, and does not consume a `command_status` observation. The C9/C10 filters are unchanged. | No file under `src/sdk/message-translator.ts`, `src/sdk/background-notify-coordinator.ts`, `src/sdk/vscode-run-commands-tool.ts` was touched. |
| **BCB** (blocked-completion-barrier observation availability) | The seam does not read the BCB capture ring, does not write it, and does not participate in the Q5 decision. | `src/sdk/bcb-observation-unavailable-capture-runtime.ts` untouched. |
| **Elm** (the canonical arbiter / task-state shadow) | The seam reads `runtimeSnapshot()` **directly** rather than `getArbiterSnapshot()`. It therefore does NOT consume the Elm arbiter selection, does not add a subscriber to the canonical event stream, and cannot perturb the shadow's differential. **Deliberately** using B1 rather than B5 keeps the Elm fallback path entirely out of the seam. | `src/sdk/task-state-shadow-*.ts` untouched; the seam holds **no** subscription (C2–C5 in §C1.3). |
| **Native editor** (the effective-destination authority) | The seam cannot reach the editor executor. The editor path's RED matrix (cases C/D/E in `editor.realpath-authority.test.ts`) is untouched and still reproduces exactly as the predecessor ACT recorded. | No file under `src/sdk/diff-edit-coordinator.ts` or the editor executor was touched; the predecessor's RED matrix is unmodified. |
| **Approval** | See §C4.6. | Untouched. |
| **Session ownership** | The seam **reads** the owner; it never becomes one. It creates no session, no host, no runtime, no `ClineCore` (§C1.4). | Unchanged. |

**The one behavioural change in the whole diff:** the extension host
**may** create an AF_UNIX socket, a token file and a private directory
**when the seam is explicitly enabled**. When it is disabled (the
default) it creates nothing. No task state, no event, no publication,
and no phase changes under either setting.

---

## C4.9 Verdict

**All seven C4 requirements are PROVEN** as executed witnesses against
real production classes.

No new P0 was demonstrated.

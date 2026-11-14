# C3 / C4 — Operator procedure

**ACT:** `ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01`

This is the EXACT procedure the operator runs to qualify the installed
extension and the real Codex handshake. Every command is reproducible and
every observation is recorded verbatim.

---

## 0. Prerequisites

| Item | Value |
|---|---|
| VSIX (exact head) | `dist/clinemm-<version>-<head8>.vsix` — see `03-build-and-package.md` |
| Host | `codium-clinemm` (a disposable VSCodium instance) |
| Cline data dir | a SHORT path (see §1) |
| Codex Desktop | `/Applications/ChatGPT.app` (Codex Desktop), config at `~/.codex/config.toml` |

---

## 1. Isolated, SHORT Cline data directory

The AF_UNIX `sock_path` is **104 usable bytes** on macOS. The seam fails
closed with an actionable error when the path is too long, so the data
directory MUST be short.

```bash
export CLINE_DIR=/tmp/cmm
mkdir -p "$CLINE_DIR"
```

The seam's artifacts land in `$CLINE_DIR/data/control-seam/`:

```
control-seam/
  control.sock   AF_UNIX listener   0600
  token          bearer token       0600
  owner.json     instance ownership 0600
  enabled.json   explicit opt-in    0600
```

---

## 2. Install the EXACT-head VSIX into the disposable instance

```bash
CODIUM_EXT=/tmp/codium-clinemm-ext
mkdir -p "$CODIUM_EXT"
/Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --install-extension "$PWD/dist/<the-exact-vsix>.vsix" \
  --extensions-dir "$CODIUM_EXT" \
  --user-data-dir /tmp/codium-clinemm-user
```

Then launch the disposable instance with the SAME environment:

```bash
CLINE_DIR=/tmp/cmm \
/Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --extensions-dir "$CODIUM_EXT" \
  --user-data-dir /tmp/codium-clinemm-user \
  /tmp/cmm-workspace
```

---

## 3. DISABLED mode creates NEITHER socket NOR token

Start the host FIRST with NO opt-in record:

```bash
rm -f /tmp/cmm/data/control-seam/enabled.json
ls -la /tmp/cmm/data/control-seam/ 2>/dev/null
# EXPECT: the directory exists but contains NO control.sock and NO token.
```

If the directory does not exist at all, that is also a valid "disabled"
observation — the disabled path creates nothing.

---

## 4. Explicitly ENABLE the control seam

```bash
mkdir -p /tmp/cmm/data/control-seam
printf '{\n  "enabled": true\n}\n' > /tmp/cmm/data/control-seam/enabled.json
chmod 600 /tmp/cmm/data/control-seam/enabled.json
```

Then restart the disposable host (or reload the window) so the extension
host re-reads the opt-in record.

Verify the artifacts and their permissions:

```bash
ls -la /tmp/cmm/data/control-seam/
# EXPECT:
#   drwxr-x---  control-seam
#   -rw-------  control.sock
#   -rw-------  token
#   -rw-------  owner.json
#   -rw-------  enabled.json
stat -f '%Sp %N' /tmp/cmm/data/control-seam/control.sock /tmp/cmm/data/control-seam/token
```

The extension host log carries the ownership record:

```
grep -i 'ControlSeam' /tmp/codium-clinemm-user/logs/*/exthost*/output.log
# EXPECT: "[ControlSeam] listening on /tmp/cmm/data/control-seam/control.sock (source=opt-in-file, instance=<pid>-<hex>)"
```

---

## 5. The two read-only operations against the INSTALLED runtime

### 5a. Direct AF_UNIX probe (no MCP layer)

```bash
TOKEN=$(cat /tmp/cmm/data/control-seam/token)
printf '{"v":1,"op":"clinemm_capabilities","token":"%s"}\n' "$TOKEN" \
  | nc -U /tmp/cmm/data/control-seam/control.sock
```

Expect a JSON line whose `result.operations` is exactly
`["clinemm_capabilities", "clinemm_get_run"]` and whose `result.readOnly`
is `true`.

```bash
printf '{"v":1,"op":"clinemm_get_run","token":"%s"}\n' "$TOKEN" \
  | nc -U /tmp/cmm/data/control-seam/control.sock
```

Expect the SAME `sessionId` the installed runtime reports. To CORRELATE
it with the runtime, compare against the installed host's own state: the
`sessionId` in the response must equal the session the installed window
shows, and `taskId` must equal the installed task. Record BOTH.

### 5b. Foreign-session refusal

```bash
printf '{"v":1,"op":"clinemm_get_run","token":"%s","sessionId":"not-the-real-one"}\n' "$TOKEN" \
  | nc -U /tmp/cmm/data/control-seam/control.sock
# EXPECT: {"v":1,"ok":false,"error":{"code":"control_seam_foreign_session",...}}
```

### 5c. Disconnected-instance failure

```bash
# Stop the disposable host, then probe again:
printf '{"v":1,"op":"clinemm_get_run","token":"%s"}\n' "$TOKEN" \
  | nc -U /tmp/cmm/data/control-seam/control.sock
# EXPECT: the connection is refused (no listener). No hang.
```

---

## 6. Restart / disposal removes ONLY owned artifacts

```bash
# While the host is RUNNING, note the artifacts:
ls -la /tmp/cmm/data/control-seam/
cat /tmp/cmm/data/control-seam/owner.json
```

Quit the disposable host (this runs `Controller.dispose()`), then:

```bash
ls -la /tmp/cmm/data/control-seam/
# EXPECT: control.sock, token and owner.json are GONE.
```

Then start a SECOND disposable instance against the SAME `CLINE_DIR`
while the FIRST is still running:

```bash
# EXPECT: the second instance FAILS CLOSED.
# Its log says: "[ControlSeam] the control endpoint is already owned by a
# live instance (pid <N>, instance <id>); refusing to replace it"
# The FIRST instance's socket and token are UNCHANGED (same inode, same
# token value).
```

Verify the first instance is unharmed:

```bash
TOKEN_BEFORE=$(cat /tmp/cmm/data/control-seam/token)
stat -f '%i' /tmp/cmm/data/control-seam/token
# ... start the second instance ...
TOKEN_AFTER=$(cat /tmp/cmm/data/control-seam/token)
stat -f '%i' /tmp/cmm/data/control-seam/token
# EXPECT: identical inode and identical token value.
```

---

## 7. Multiple windows cannot hijack each other's endpoint

Open a SECOND window in the SAME disposable host (or a second host
against the same `CLINE_DIR`) and confirm the second one refuses to take
the endpoint, as in §6.

---

## 8. Codex Desktop MCP configuration

Codex reads `~/.codex/config.toml`. Add:

```toml
[mcp_servers.clinemm]
command = "bun"
args = ["/ABSOLUTE/PATH/TO/clinemm/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts"]
startup_timeout_sec = 60
tool_timeout_sec = 30
```

**Pinning the proxy's source/build identity.** The proxy is a source
entrypoint, so pin it by content hash:

```bash
shasum -a 256 apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts \
                apps/vscode/src/sdk/control-seam/control-seam-proxy.ts \
                apps/vscode/src/sdk/control-seam/control-seam-client.ts \
                apps/vscode/src/sdk/control-seam/control-seam-protocol.ts \
                apps/vscode/src/sdk/control-seam/control-seam-paths.ts \
                apps/vscode/src/sdk/control-seam/control-seam-server.ts \
                apps/vscode/src/sdk/control-seam/control-seam-ownership.ts \
                apps/vscode/src/sdk/control-seam/control-seam-enablement.ts
```

Record those hashes in the receipt. The proxy resolves the socket and
token from the SAME `CLINE_DIR` the installed extension uses, so Codex
must run with that environment:

```toml
[mcp_servers.clinemm.env]
CLINE_DIR = "/tmp/cmm"
```

Restart Codex Desktop after editing `config.toml`.

---

## 9. The real Codex handshake — EXACTLY two invocations

In a Codex Desktop session with the `clinemm` MCP server connected:

1. **`clinemm_capabilities`** — verify tool discovery: exactly two tools,
   `clinemm_capabilities` and `clinemm_get_run`; `readOnly: true`; the
   `host.extensionVersion` matches the installed VSIX's version.
2. **`clinemm_get_run`** — verify a successful status read: the response
   carries the installed runtime's `sessionId` / `taskId` / `running` /
   `runtimeStatus` / `queuedPromptCount` / `runId`.

Then the two negative controls:

3. **Foreign-session refusal** — call `clinemm_get_run` with
   `sessionId` set to a value that is NOT the installed runtime's
   session. Expect `control_seam_foreign_session`.
4. **Disconnected-instance failure** — quit the disposable VSCodium
   instance, then call `clinemm_get_run` again. Expect
   `control_seam_no_instance` (the proxy's fail-closed code), NOT a hang.

**NO new agent execution.** Throughout, verify that:
- no new task appeared in the installed runtime's task history,
- no new session id was minted,
- `queuedPromptCount` did not increase because of the probe.

---

## 10. What NOT to do

- Do NOT expose `start_act`, `send_feedback`, `cancel_run`, transcript
  retrieval, tool approval, or any other mutation. They do not exist in
  the registry, and the proxy does not register them.
- Do NOT run two disposable hosts against the same `CLINE_DIR` expecting
  the second to win. It fails closed BY DESIGN.
- Do NOT use a `CLINE_DIR` longer than ~70 bytes; the socket path will
  not fit in `sock_path` and the seam fails closed with an actionable
  error.

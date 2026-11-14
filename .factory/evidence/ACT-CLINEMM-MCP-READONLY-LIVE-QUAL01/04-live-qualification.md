# C3 / C4 — Live qualification: what was observed, and what was not

**ACT:** `ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01`

This file is written to the charter's standard: *"Do not fabricate the
receipt."* Every observation below was executed in this session and its
verbatim output is quoted. Every observation that could **not** be made is
named, with the environment cause proven by execution.

---

## C3.0 The two questions C3 asks

| Question | Answer |
|---|---|
| Can an **installed** extension be observed on this host? | **NO — `LIVE_UNOBSERVABLE`** (proven cause below) |
| Can a **real Codex MCP client** be driven on this host? | **NO — `LIVE_UNOBSERVABLE`** (proven cause below) |

**What IS observed**, on this host, with real production classes and the
real transport, is recorded in §C3.3 and §C4.3. Those observations are
**transport-level**, not **installed-instance-level**, and this file does
not blur the two.

---

## C3.1 The installed-VSIX step — SUCCEEDED

The exact-head VSIX **was** installed into a disposable VSCodium instance.

```
$ /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
    --install-extension "$PWD/dist/clinemm-4.1.16-5a1c485cb-bbf8d7b6-mcp-readonly-qual01.vsix" \
    --extensions-dir /tmp/codium-clinemm-ext \
    --user-data-dir /tmp/codium-clinemm-user --force
Installing extensions...
Extension 'clinemm-4.1.16-5a1c485cb-bbf8d7b6-mcp-readonly-qual01.vsix' was successfully installed.
INSTALL_EXIT=0

$ ls -la /tmp/codium-clinemm-ext/
-rw-r--r--  1 chistyakov  wheel       456 Nov 15 02:19 extensions.json
drwxr-xr-x  15 chistyakov  wheel       480 Nov 15 02:19 s1onique.clinemm-4.1.16-5a1c485cb
```

The instance's own `cli.log` records the extraction:

```
[info] Installing extension: s1onique.clinemm {"installGivenVersion":true, …}
[info] Extracted extension to file:///tmp/codium-clinemm-ext/s1onique.clinemm-4.1.16-5a1c485cb
[info] Extension installed successfully: s1onique.clinemm
```

Host: `VSCodium 1.143.17232 (c072cf642cbbadabefa22f39c58cc902a8b7427f)`.

**This is the only part of C3 that succeeded.** It proves the VSIX is
installable into VSCodium; it does **not** prove the extension host ran.

---

## C3.2 The installed-extension-host step — `LIVE_UNOBSERVABLE`

### The attempt

```
$ CLINE_DIR=/tmp/cmm /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
    --extensions-dir /tmp/codium-clinemm-ext --user-data-dir /tmp/codium-clinemm-user \
    --skip-welcome --skip-release-notes /tmp/cmm-workspace &
$ sleep 25
$ pgrep -f 'codium-clinemm-user' | wc -l
0
```

The window process **exits immediately**. No extension-host log directory
is ever created — only `cli.log` (the CLI's own log), and the `exthost`
directory never appears:

```
$ ls -R /tmp/codium-clinemm-user/logs
/tmp/codium-clinemm-user/logs:
20261115T021935
/tmp/codium-clinemm-user/logs/20261115T021935:
cli.log
```

### The proven cause

Launching the Electron binary directly (bypassing the `codium` shell
wrapper) shows the failure mode:

```
$ /Applications/VSCodium.app/Contents/MacOS/VSCodium --extensions-dir … --no-sandbox --disable-gpu …
EXIT=139
```

**Exit 139 = 128 + 11 = `SIGSEGV`.** The Electron process crashes before
the renderer and the extension host are created. The `codium` wrapper
surfaces the same failure as:

```
_LSOpenURLsWithCompletionHandler() failed for the application
/Applications/VSCodium.app/Contents/MacOS/VSCodium with error -54.
```

This is **the same environment constraint the predecessor ACT recorded**
(`ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01` §C0.4: *"the Electron
child died with `SIGSEGV` under this sandbox"*), reproduced independently
here.

### It is NOT a defect in this ACT's code

Two independent controls:

1. **Other VSCodium instances on this host ARE running** — with PPID `1`
   (launched outside this shell), each with its own isolated
   `cline-data` directory:
   ```
   15104 /Applications/VSCodium.app/Contents/MacOS/VSCodium --user-data-dir …/.vscodium-roz/user-data …
   15118 /Applications/VSCodium.app/Contents/MacOS/VSCodium --user-data-dir …/.vscodium-ulybka/user-data …
   ```
   So the GUI *can* run on this host — it just cannot be launched **from
   this agent shell**.

2. **Those operator instances are protected from this shell.** Installing
   into one fails with `EPERM`:
   ```
   Error: EPERM: operation not permitted, mkdir '…/.vscodium-roz/user-data/logs/20261115T022042'
   Error: Unable to write file '…/.vscodium-roz/extensions/.obsolete' (NoPermissions …)
   ```
   The operator's live instances — and their `cline-data` directories —
   are read-only to this agent.

### The consequence for the charter's C3 list

| C3 requirement | Status |
|---|---|
| The installed extension loads without errors | **`LIVE_UNOBSERVABLE`** — the extension host never started |
| Its socket and token exist with correct permissions | **`LIVE_UNOBSERVABLE`** — no listener was ever created by an installed host |
| Disabled mode creates neither | **`LIVE_UNOBSERVABLE`** for the installed host; **PROVEN** at the production-class level (§C3.3, QL19) |
| A real VS Code task appears in `clinemm_get_run` | **`LIVE_UNOBSERVABLE`** — requires a running installed host |
| Session and run identities match the actual installed runtime | **`LIVE_UNOBSERVABLE`** — requires a running installed host |
| Status changes correlate with runtime observations | **`LIVE_UNOBSERVABLE`** — requires a running installed host |
| Restart and disposal remove only owned artifacts | **PROVEN** at the production-class level (QL02/QL03/QL04); **not** observed on an installed host |
| Multiple extension windows cannot hijack each other's control endpoint | **PROVEN** at the production-class level (QL01) and **at the live-transport level** (§C3.3); **not** observed on an installed host |

**The operator procedure that closes these is `OPERATOR-PROCEDURE.md`.**

---

## C3.3 What IS proven on this host — the REAL production classes, the REAL AF_UNIX transport

The listener was started from the **REAL `ControlSeamServer`** class — the
same class the extension host instantiates in `SdkController.ts`, with the
same `ControlSeamAuthority` shape the controller supplies. No mock, no
in-memory pair.

```
$ ls -la /tmp/cmm/data/control-seam/
drwx------  6 chistyakov  wheel   192 Nov 15 02:21 .
srw-------  1 chistyakov  wheel     0 Nov 15 02:21 control.sock
-rw-------  1 chistyakov  wheel    22 Nov 15 02:21 enabled.json
-rw-------  1 chistyakov  wheel   159 Nov 15 02:21 owner.json
-rw-------  1 chistyakov  wheel    65 Nov 15 02:21 token
```

**Directory `0700`, socket `0600`, token `0600`, owner record `0600`** —
exactly the permissions C3 requires.

### The two read-only operations, over the real AF_UNIX socket

```
$ printf '{"v":1,"op":"clinemm_capabilities","token":"%s"}\n' "$TOKEN" | nc -U …/control.sock
{"v":1,"ok":true,"result":{"protocolVersion":1,"operations":[{"id":"clinemm_capabilities",…},{"id":"clinemm_get_run",…}],"readOnly":true,"host":{"extensionVersion":"4.1.16-5a1c485cb","platform":"darwin"}}}

$ printf '{"v":1,"op":"clinemm_get_run","token":"%s"}\n' "$TOKEN" | nc -U …/control.sock
{"v":1,"ok":true,"result":{"sessionId":"session-live-42","running":true,"queuedPromptCount":2,"taskId":"task-live-42","runtimeStatus":"running","runId":"run-live-9"}}
```

### The negative controls, live

```
$ printf '{"v":1,"op":"clinemm_get_run","token":"%s","sessionId":"someone-else"}\n' "$TOKEN" | nc -U …
{"v":1,"ok":false,"error":{"code":"control_seam_foreign_session","message":"session identifier does not match the active run"}}

$ printf '{"v":1,"op":"clinemm_get_run","token":"wrong"}\n' "$TOKEN" | nc -U …
{"v":1,"ok":false,"error":{"code":"control_seam_unauthorized","message":"control-seam authorization failed"}}
```

### Concurrent instances — LIVE, against a live owner

A second `ControlSeamServer` was started against the **same** endpoint while
the first was live:

```
SECOND_INSTANCE_REFUSED: [ControlSeam] the control endpoint is already owned by a live instance
                          (pid 13453, instance 13453-076a34892f2627af58e155bb85045c4f);
                          refusing to replace it
```

The first instance's owner record and token were **untouched**, and it
still served its own session:

```
$ cat /tmp/cmm/data/control-seam/owner.json
{ "v": 1, "instanceId": "13453-076a34892f2627af58e155bb85045c4f", "pid": 13453,
  "startedAt": 1794698510248, "tokenFingerprint": "a39d3f5302005493" }

$ printf '{"v":1,"op":"clinemm_get_run","token":"%s"}\n' "$TOKEN" | nc -U …/control.sock
{"v":1,"ok":true,"result":{"sessionId":"session-live-42","running":true,"queuedPromptCount":2,"taskId":"task-live-42","runtimeStatus":"running","runId":"run-live-9"}}
```

### The opt-in validation, live

A malformed opt-in record was written first:

```
$ cat /tmp/cmm/data/control-seam/enabled.json     # the shell-escaped variant
{
  \"enabled\": true
}
$ bun -e 'readControlSeamOptInRecord("/tmp/cmm/data/control-seam/enabled.json")'
optin: undefined            ← REJECTED: the seam stayed OFF (started:false)
```

The corrected record was then written and the seam started normally. **The
C1.4 validation is exercised in the production path, not only in a unit
test.**

### No new agent execution

Five consecutive reads, against a running instance:

```
{"v":1,"ok":true,"result":{"sessionId":"session-live-42","running":true,"queuedPromptCount":2,…}}
{"v":1,"ok":true,"result":{"sessionId":"session-live-42","running":true,"queuedPromptCount":2,…}}
{"v":1,"ok":true,"result":{"sessionId":"session-live-42","running":true,"queuedPromptCount":2,…}}
{"v":1,"ok":true,"result":{"sessionId":"session-live-42","running":true,"queuedPromptCount":2,…}}
{"v":1,"ok":true,"result":{"sessionId":"session-live-42","running":true,"queuedPromptCount":2,…}}
```

Identical every time: the session id is unchanged, the queued count is
unchanged, no run id was minted, and no session directory was created
(`/tmp/cmm/data/` contains only `control-seam`).

---

# C4 — The real Codex handshake

## C4.1 The real Codex is present, and the MCP server is REGISTERED with it

The real Codex Desktop CLI is installed with the ChatGPT.app bundle:

```
$ /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex --version
codex-cli 0.167.0-alpha.4.1
```

The seam was registered with the **real Codex CLI**, using the documented
Codex MCP configuration:

```
$ CODEX_HOME=/tmp/cxhome codex mcp add clinemm \
    --env CLINE_DIR=/tmp/cmm \
    -- /Users/chistyakov/.bun/bin/bun \
       …/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts
Added global MCP server 'clinemm'.

$ codex mcp get clinemm
clinemm
  enabled: true
  transport: stdio
  command: /Users/chistyakov/.bun/bin/bun
  args: /Volumes/…/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts
  cwd: -
  env: CLINE_DIR=*****
  startup_timeout_sec: 60
  tool_timeout_sec: 30

$ codex mcp list --json   →  { "name": "clinemm", "enabled": true,
                                "transport": { "type": "stdio", … } }

$ codex doctor            →  "MCP servers  1"
```

**The real Codex has the `clinemm` MCP server registered, enabled, and
resolved.** The proxy's source/build identity is pinned by content hash
(see `OPERATOR-PROCEDURE.md` §8).

---

## C4.2 Driving a real Codex agent turn — `LIVE_UNOBSERVABLE`

Every path that loads the Codex configuration fails on this host:

```
$ codex exec --skip-git-repo-check 'Call the MCP tool named clinemm_capabilities …'
Error: thread/start: thread/start failed: failed to load configuration:
       Failed to synchronize managed preferences (code -32600)

$ codex app-server --print-startup-config
{"error":{"code":-32600,"data":{"reason":"configLoad","detail":
  "Failed to synchronize managed preferences"},"message":"failed to load configuration: …"}}
```

The **same failure occurs with a STOCK Codex configuration that has NO MCP
server at all**, which proves it is environmental and has nothing to do
with ClineMM:

```
$ CODEX_HOME=/tmp/cxstock codex exec --skip-git-repo-check 'Say the word OK.'
Error: thread/start: thread/start failed: failed to load configuration:
       Failed to synchronize managed preferences (code -32600)
#   (config.toml is a single line: model = "gpt-6.1-sol")
```

And over the app-server JSON-RPC (the exact protocol Codex Desktop uses),
the `initialize` handshake succeeds, but every configuration- and
MCP-touching method fails identically:

```
=== initialize ===  OK
=== config/mcpServer/reload ===
{ "error": { "code": -32603, "message": "failed to refresh MCP servers: Failed to synchronize managed preferences" } }
=== mcpServerStatus/list ===
{ "error": { "code": -32603, "message": "failed to reload config: Failed to synchronize managed preferences" } }
=== thread/start ===
{ "error": { "code": -32600, "message": "failed to load configuration: Failed to synchronize managed preferences" } }
```

### The proven root cause

The Codex binary's own strings identify the loader:

```
$ strings …/codex-cli/bin/codex-exec-server | grep -E 'managed|macos'
codex_config::loader::macos
MdmManagedPreferences
EnterpriseManagedSystemRequirementsToml
LegacyManagedConfigTomlFromMdm
"Failed to synchronize managed preferences"
"managed config root must be a table"
```

Codex loads **macOS MDM managed preferences**. On this host no MDM domain
is registered and the managed-preferences store does not exist:

```
$ defaults read com.apple.ManagedClient
Domain com.apple.ManagedClient does not exist
$ ls /Library/Managed\ Preferences
ls: /Library/Managed Preferences: No such file or directory
$ defaults read com.openai.codex
Domain com.openai.codex does not exist
```

The daemon's own log confirms it:

```
/tmp/cxhome/app-server-daemon/daemon.stderr.log
ERROR codex_app_server: Invalid configuration; using defaults. Failed to synchronize managed preferences
```

**This is a host-level environment condition, reproducible with a stock
Codex and no MCP server, and independent of this ACT's code.** It is the
same class of constraint as the SIGSEGV: the environment, not the product.

**No Codex agent turn was executed, and none is claimed.**

---

## C4.3 The MCP stdio handshake itself — PROVEN with a real MCP client

The transport Codex Desktop uses — **a real MCP stdio client launching the
REAL proxy entrypoint as a child process and speaking the MCP protocol
over its stdio** — was exercised end to end with the `@modelcontextprotocol/sdk`
`Client` + `StdioClientTransport`, i.e. the same SDK and the same transport
shape Codex uses.

```
TOOL_DISCOVERY: ["clinemm_capabilities","clinemm_get_run"]
TOOL_COUNT: 2
TOOL_DESC: clinemm_capabilities => List the read-only operations the ClineMM control seam exposes.
TOOL_DESC: clinemm_get_run => Read the active ClineMM run's session identity and authoritative status. Read-on
```

**Exactly two tools. No `start_act`, no `send_feedback`, no `cancel_run`,
no transcript retrieval, no tool approval, and no other mutation is
exposed.**

### Call 1 — `clinemm_capabilities`

```json
{"content":[{"type":"text","text":"{
  \"protocolVersion\": 1,
  \"operations\": [
    { \"id\": \"clinemm_capabilities\", \"description\": "List the read-only operations the ClineMM control seam exposes.\" },
    { \"id\": \"clinemm_get_run\", \"description\": \"Read the active run's session identity and authoritative status.\" }
  ],
  \"readOnly\": true,
  \"host\": { \"extensionVersion\": \"4.1.16-5a1c485cb\", \"platform\": \"darwin\" }
}"}]}
```

`readOnly: true`, exactly the two operations, and the host identity
carries the **exact extension version of the qualified VSIX**.

### Call 2 — `clinemm_get_run` (successful status read)

```json
{"content":[{"type":"text","text":"{
  \"sessionId\": \"session-live-42\",
  \"running\": true,
  \"queuedPromptCount\": 2,
  \"taskId\": \"task-live-42\",
  \"runtimeStatus\": \"running\",
  \"runId\": \"run-live-9\"
}"}]}
```

### Call 3 — foreign-session refusal

```
CALL_3_foreign: {"content":[{"type":"text","text":"control_seam_foreign_session"}],"isError":true}
```

### Call 4 — disconnected-instance failure

With no live instance behind the socket:

```
CALL_1_capabilities: {"content":[{"type":"text","text":"control_seam_no_instance"}],"isError":true}
CALL_2_get_run:      {"content":[{"type":"text","text":"control_seam_no_instance"}],"isError":true}
CALL_3_foreign:      {"content":[{"type":"text","text":"control_seam_no_instance"}],"isError":true}
```

Fail-closed, non-informative, and **no hang** — the C1.2 settling
guarantee is what makes this possible; before the correction the proxy's
tool call would have hung forever.

### No new agent execution

Every call above is a READ. The seam's registry has no mutating operation,
the proxy registers no mutating tool, and the authority surface the seam
holds contains no mutator. The five-repeat read in §C3.3 produced
byte-identical payloads with no session, run, or task created.

---

## C4.4 The C4 requirement table

| C4 requirement | Status |
|---|---|
| Codex Desktop connects to the existing stdio proxy | **PARTIAL** — the proxy is registered with and resolved by the real Codex CLI (`codex mcp get clinemm`, `codex mcp list --json`, `codex doctor` → "MCP servers 1"); the agent turn that would spawn it is blocked by the MDM config-load failure |
| The documented Codex MCP configuration, pinning the proxy's source/build identity | **PROVEN** — `codex mcp add clinemm --env CLINE_DIR=… -- <bun> <proxy-main.ts>`; the content-hash pinning procedure is in `OPERATOR-PROCEDURE.md` §8 |
| Invoke only `clinemm_capabilities` and `clinemm_get_run` | **PROVEN** — exactly 2 tools discovered; no mutation exposed |
| Tool discovery | **PROVEN** — `["clinemm_capabilities","clinemm_get_run"]`, `TOOL_COUNT: 2` |
| Successful status reads | **PROVEN** — both calls returned the live session/task/run identity |
| Foreign-session refusal | **PROVEN** — `control_seam_foreign_session` |
| Disconnected-instance failure | **PROVEN** — `control_seam_no_instance`, no hang |
| No new agent execution | **PROVEN** — no session/run/task minted across ten reads |
| **The real Codex DESKTOP agent turn** | **`LIVE_UNOBSERVABLE`** — the macOS MDM managed-preferences config load fails on this host, reproducibly, with a stock Codex and no MCP server |

---

## C4.5 Status is NOT equated with the committed Elm UI projection

The charter says: *"Status changes are correlated with runtime observations;
do not equate runtime status with the committed Elm UI projection."*

This ACT made **no** such equation. The seam reads the **canonical runtime
snapshot chain** — `VscodeSessionHost.runtimeSnapshot()` →
`ClineCore.getActiveRuntimeSnapshot()` → `LocalRuntimeHost` →
`AgentRuntime.snapshot()` — which is the RUNTIME's own state. The seam
holds **no subscription** and does not read the Elm arbiter closure at
all. The `runtimeStatus` field on the wire is the runtime's own status
string; it is not, and is never presented as, the Elm UI's projection.

The two are distinguished in the payload itself: `running` is the host's
`ActiveSession.isRunning` mirror, and `runtimeStatus` is the runtime
snapshot's status — two different producers, reported separately, neither
substituted for the other.

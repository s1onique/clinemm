# C7 / Live pilot — operator steps and the pending gate

## C7.1 Status

**The live pilot has NOT been performed by this ACT.** No ClineMM
extension is installed on the code-execution host
(`~/Library/Application Support/Code/extensions` contains no
`cline*` / `saoud*` entry), and the contract forbids the
code-execution environment from installing the extension.

**No VSIX was produced and nothing was installed.** No real user task
was created, cancelled, resumed, switched, or replaced.

## C7.2 Exact build / install steps for the operator

From the repository root, on the operator's machine:

```bash
# 1. Build the extension (webview + extension bundle).
cd apps/vscode
bun install
bun run build:webview
bun esbuild.mjs

# 2. Package the VSIX.
#    `dist/` MUST exist at the REPO ROOT before `vsce package`, or the
#    `--out` path fails with ENOENT.
cd ../..
mkdir -p dist
bunx --bun @vscode/vsce package --out dist/clinemm-4.1.26-<shortsha>.vsix \
  --no-dependencies apps/vscode
```

Reference artifact identity for this ACT (repo-local build product;
the operator's VSIX will differ because it also contains the webview
assets):

| Item | Value |
|---|---|
| Source HEAD | `ae802ca980ae116a3d4c5d35411f4e6628681ac2` |
| Source tree | `452d2a27643d985a9ac2a75b74496b701f6c76ba` |
| Version | `4.1.26` |
| Extension bundle | `apps/vscode/dist/extension.js` — 57 766 590 bytes — SHA-256 `7a0600588bdbfd7f44a169b6f920d1961f66728f471177f68b1e589f530e6176` |
| Webview bundle | `apps/vscode/webview-ui/build/assets/index.js` — 10 059 487 bytes — SHA-256 `8e45ee6e626b79a2291de71179c520bf376e68697d9d268157ae6ed5706beb2a` |

Install into `codium-clinemm`:

```bash
code --install-extension dist/clinemm-4.1.26-<shortsha>.vsix --force
```

## C7.3 Deliberate mutation opt-in (the operator's explicit act)

Mutation is **DEFAULT OFF**. The operator must BOTH enable the read
seam and grant mutation, deliberately, in the private control-seam
directory (`$CLINE_DIR/data/control-seam/`, mode 0700):

```bash
SEAM_DIR="${CLINE_DIR:-$HOME/.cline}/data/control-seam"
mkdir -p "$SEAM_DIR" && chmod 700 "$SEAM_DIR"

# (a) enable the READ seam
printf '{\n  "v": 1,\n  "enabled": true\n}\n' > "$SEAM_DIR/enabled.json"

# (b) SEPARATELY grant MUTATION.
#     `allowContentRead: true` additionally exposes task MESSAGE TEXT.
#     Set it to false (or omit it) to keep event reads metadata-only.
printf '{\n  "v": 1,\n  "enabled": true,\n  "allowContentRead": true\n}\n' \
  > "$SEAM_DIR/mutation.json"

chmod 600 "$SEAM_DIR/enabled.json" "$SEAM_DIR/mutation.json"
```

Then **restart the extension host** so the grant is minted against the
new instance (the write credential is minted per instance and is
invalidated on restart).

The extension host publishes the write credential to
`$SEAM_DIR/write-token` (mode 0600). The stdio proxy reads it
automatically and registers the two write tools. **If the file is
absent, the proxy exposes only the two read-only tools** — that is the
expected read-only behaviour, not a failure.

## C7.4 The live pilot procedure

Use a **fresh, disposable TypeScript fixture workspace** with
**conservative approval settings**.

| # | Step | Expected observation |
|---|---|---|
| 1 | Read capabilities | `clinemm_capabilities` returns `readOnly: false` and **four** operations (the write tools are exposed) |
| 2 | Confirm workspace + mutation authorization | `clinemm_get_run` returns the host's session identity; the operator confirms the write credential file exists and is 0600 |
| 3 | Call `clinemm_start_act` **once** | `outcome: "accepted"` with a real `sessionId` |
| 4 | Receive the actual session ID | The `sessionId` equals the host's active session id (`clinemm_get_run.sessionId`) |
| 5 | Observe the run through `clinemm_get_run` | `running`, `runtimeStatus`, and `taskState.phase` track the real runtime |
| 6 | Read bounded progress through `clinemm_read_events` | Events appear in the real production order with real cursors; `cursorExpired` is reported when the window moved |
| 7 | Observe ClineMM's normal completion authority | The final `taskState.phase` is `completed` **from the real runtime / Elm authority** — not a fabricated MCP status |
| 8 | Verify the task did not execute twice | Replay the SAME `requestId` → the SAME outcome, no second session; `clinemm_get_run` shows one session; the task history shows one task |

The operator retains the normal ClineMM **Cancel** and **approval**
controls throughout.

## C7.5 What the live pilot must NOT show

- A second execution authority (no second `ClineCore`, no second run).
- A completed task without a real runtime / Elm phase.
- Any approval bypass.
- Any transcript or credential in an MCP tool response.

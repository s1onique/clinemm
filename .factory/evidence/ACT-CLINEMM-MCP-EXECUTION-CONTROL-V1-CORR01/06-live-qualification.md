# C6 / Live pilot - operator steps and the pending gate

## C6.1 Status

**The live pilot has NOT been performed by this ACT.** No ClineMM extension is
installed on the code-execution host, and the code-execution environment does
not install the extension.

**No VSIX was produced and nothing was installed.** No real user task was
created, cancelled, resumed, switched, or replaced.

The predecessor ACT's live-pilot procedure (`.factory/evidence/
ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01/09-live-qualification.md`) remains
valid in its build / install / opt-in steps. This ACT ADDS the steps that
exercise the CORRECTED concurrency contract, and CORRECTS the artifact
identity the operator must build from.

## C6.2 Corrected artifact identity - the operator MUST build from this HEAD

The predecessor's artifact identity was bound to the PRE-IMPLEMENTATION entry
HEAD and was therefore not a valid exact-head build attribution. Build from the
exact final implementation HEAD of the correction:

| Item | Value |
|---|---|
| Source HEAD | `3f4a5e72ece56c18ff8055870f2eccc8e5ccbebc` |
| Source tree | `bc4c7de1f976025f4941ac6682c14fd8f6498543` |
| Version | `4.1.26` |
| Extension bundle | `apps/vscode/dist/extension.js` - 57 772 457 bytes - SHA-256 `a8e07a5e5d21575d5b2208bf4ca4fc1caa64d92dd04edc316b71e6cdfa9beb29` |

## C6.3 Exact build / install steps for the operator

```bash
# 1. Check out the exact final implementation HEAD.
git checkout 3f4a5e72ece56c18ff8055870f2eccc8e5ccbebc

# 2. Build the extension (webview + extension bundle).
cd apps/vscode
bun install
bun run build:webview
bun esbuild.mjs

# 3. Package the VSIX.
#    `dist/` MUST exist at the REPO ROOT before `vsce package`.
cd ../..
mkdir -p dist
bunx --bun @vscode/vsce package --out dist/clinemm-4.1.26-3f4a5e72e.vsix \
  --no-dependencies apps/vscode
```

Install into `codium-clinemm`:

```bash
code --install-extension dist/clinemm-4.1.26-3f4a5e72e.vsix --force
```

## C6.4 Deliberate mutation opt-in (the operator's explicit act)

Mutation is **DEFAULT OFF**. The operator must BOTH enable the read seam and
grant mutation, deliberately, in the private control-seam directory
(`$CLINE_DIR/data/control-seam/`, mode 0700):

```bash
SEAM_DIR="${CLINE_DIR:-$HOME/.cline}/data/control-seam"
mkdir -p "$SEAM_DIR" && chmod 700 "$SEAM_DIR"

# (a) enable the READ seam
printf '{\n  "v": 1,\n  "enabled": true\n}\n' > "$SEAM_DIR/enabled.json"

# (b) SEPARATELY grant MUTATION.
#     `allowContentRead: true` additionally exposes task MESSAGE TEXT.
printf '{\n  "v": 1,\n  "enabled": true,\n  "allowContentRead": true\n}\n' \
  > "$SEAM_DIR/mutation.json"

chmod 600 "$SEAM_DIR/enabled.json" "$SEAM_DIR/mutation.json"
```

Then **restart the extension host** so the grant is minted against the new
instance (the write credential is minted per instance and is invalidated on
restart).

## C6.5 The live pilot procedure - predecessor steps PLUS the corrected-contract steps

Use a **fresh, disposable TypeScript fixture workspace** with **conservative
approval settings**. The operator retains the normal ClineMM **Cancel** and
**approval** controls throughout.

### The predecessor's eight steps (unchanged)

| # | Step | Expected observation |
|---|---|---|
| 1 | Read capabilities | `clinemm_capabilities` returns `readOnly: false` and **four** operations |
| 2 | Confirm workspace + mutation authorization | `clinemm_get_run` returns the host's session identity; the write credential file exists and is 0600 |
| 3 | Call `clinemm_start_act` **once** | `outcome: "accepted"` with a real `sessionId` |
| 4 | Receive the actual session ID | the `sessionId` equals the host's active session id |
| 5 | Observe the run through `clinemm_get_run` | `running`, `runtimeStatus`, `taskState.phase` track the real runtime |
| 6 | Read bounded progress through `clinemm_read_events` | events appear in the real production order with real cursors |
| 7 | Observe ClineMM's normal completion authority | the final `taskState.phase` is `completed` **from the real runtime / Elm authority** |
| 8 | Verify the task did not execute twice | replay the SAME `requestId` -> the SAME outcome, no second session |

### The ADDED steps for the CORRECTED contract

| # | Step | Expected observation | Witness |
|---|---|---|---|
| 9 | **Replay the accepted `requestId` AFTER the accepted task is the active session** | the SAME recorded `accepted` outcome with the SAME `sessionId` - **NOT** `rejected(active-task-owner-exists)` | C1 |
| 10 | **Fire TWO `clinemm_start_act` calls with DIFFERENT `requestId`s while the first is in flight** | exactly ONE reaches the lifecycle; the other is `rejected(start-already-in-flight)`; the task history shows ONE task | C2 |
| 11 | **Read events for a session this client did NOT start** (e.g. a task the operator started in the UI) | `control_seam_foreign_session`; no event text and no metadata is disclosed | C3 |
| 12 | **Read events for the session this client DID start** | the bounded, ordered slice for that session | C3 |
| 13 | **Send two requests on ONE MCP socket where the first is slow** | both replies are attributed to the right requests (the slow first request is NOT overtaken) | C5 |

## C6.6 What the live pilot must NOT show

- A second execution authority (no second `ClineCore`, no second run).
- A completed task without a real runtime / Elm phase.
- Any approval bypass.
- Any transcript or credential in an MCP tool response.
- A replayed request returning an outcome DIFFERENT from the recorded one.
- Two tasks started from two concurrent different-key requests.
- Another task's events readable through this client's write credential.

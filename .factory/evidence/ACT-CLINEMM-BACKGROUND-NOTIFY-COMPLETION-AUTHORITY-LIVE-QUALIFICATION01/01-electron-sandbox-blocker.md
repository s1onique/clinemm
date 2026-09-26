# 01-electron-sandbox-blocker.md

## Live-host capture blocked at the environment layer

ACT §3..§7 require launching the bound dogfood VSIX inside a real VSCode
extension host and capturing the chat UI / persisted `clineMessages` /
CCARD JSONL / screenshots. The agent sandbox where this ACT was executed
does not allow that path. The block is at **Electron startup** (kernel-layer),
not at any Cline, harness, test, or build seam.

## Evidence

1. Direct Electron invocation (no Playwright in the loop):

```bash
$ env -i HOME=... PATH=... DISPLAY=':1' \
    /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/.vscode-test/vscode-darwin-arm64-1.103.0/Visual\ Studio\ Code.app/Contents/MacOS/Electron --version
exit=139   # (SIGSEGV: 128 + 11)
```

2. Playwright `_electron.launch` via the harness (same binary, harness-managed):

```
10-09 06:52:41.444 [harness] Unhandled rejection (ignored, server stays up): Process failed to launch!
[harness] Auto-launch failed: Failed to launch VSCode: electron.launch: Process failed to launch!
Call log:
  - <launching> .../Visual Studio Code.app/Contents/MacOS/Electron
        --inspect=0 --remote-debugging-port=0 --inspect-extensions=9230
        --extensionDevelopmentPath=.../apps/vscode --disable-extensions
        --disable-workspace-trust --no-sandbox --disable-updates
        --skip-welcome --skip-release-notes --disable-gpu
        --disable-gpu-compositing --disable-software-rasterizer
        --disable-dev-shm-usage --user-data-dir=.../cline-debug-profile-...
        .../cline-debug-workspace
  - <launched> pid=61693
  - [pid=61693] <kill>
  - [pid=61693] <will force kill>
  - [pid=61693] exception while trying to kill process: Error: kill EPERM
  - [pid=61693] <process did exit: exitCode=null, signal=SIGSEGV>
```

3. The harness server itself stayed alive (status() returns the expected
   `{"running":false,"extCdpConnected":false, "hasSourceMap":true,
    "sourceMapFiles":8416, "screenshotDir":"...", "clineDir":".../.cline2"}`)
   — only `_electron.launch` failed. Source-map resolution for the extension
   source tree succeeded (8416 files loaded).

## Why this is environment, not code

- The bundled `extension.js` for `521f23482` is SHA `eaf18ae2...` and contains
  every ROUND 1 / ROUND 2 / ROUND 3 marker in the bundled `extension.js`.
- `tsc`/`biome`/`git diff --check` are clean at the entry head.
- The closed-loop 13-file vitest gate runs under `--pool=vmThreads` to
  `GATE-exit=0`, `Tests 67 passed (67)`, with `ERROR_SCAN_MATCHES=0`
  (see `04-post-live-regression-gate.txt`).
- The harness **server** starts cleanly; the harness **Electron launch**
  cannot start the Chromium subprocess required by VSCode.

This is the documented macOS-on-Playwright limitation that the harness
references ("Playwright's `_electron.launch()` never finishes attaching
to the debugee under bun" + sandbox/kernel restrictions). In this
specific runner Electron itself crashes immediately (exit 139 / SIGSEGV).

## What this ACT establishes

- Artifact identity frozen (`00-artifact-identity.txt`) — the dogfood VSIX
  is fully bound to ENTRY_HEAD `521f23482`.
- Closed-loop gate re-run cleanly post-discovery
  (`04-post-live-regression-gate.txt`).
- LIVE-A..E specimen outputs cannot be captured in this environment.
- ACT §11 verdict: `CAPTURE_INSUFFICIENT[SYSTEM]` (no inference of PASS).

## Operational follow-up

A normal macOS desktop session with kernel entitlements for Chromium
spawn can:

1. `cd apps/vscode && code --install-extension /path/to/clinemm-4.1.16-521f23482.vsix`
2. Restart VS Code to load the extension.
3. Issue prompts LIVE-A..E through the chat UI.
4. Persist sessions under `~/.cline/data/tasks/<taskId>/`.
5. Reuse the harness capture infrastructure (`status`, `ui.screenshot`,
   `ext.evaluate`) for UI/wake inspection.

Until that environment is available, this ACT remains CAPTURE_INSUFFICIENT
and the predecessor ACT's seam-level evidence is the load-bearing proof
that the framework-level C10 completion-commit barrier covers the
authority invariants.

# Live-host capture blocked at the environment layer

ACT §19-§20 require launching the bound dogfood VSIX inside a real
VSCode extension host and capturing LIVE-A..LIVE-E specimen outputs.
This sandboxed CLI environment does not allow that path. The block
is at **Electron startup** (kernel-layer), identical to the pattern
documented in ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-LIVE-QUALIFICATION01
(2026-09-26 evidence, see `01-electron-sandbox-blocker.md`).

## Evidence

1. Debug harness auto-launch via Playwright `_electron.launch` (same
   binary, harness-managed):

```
[21:48:23.945] Auto-launch failed: Failed to launch VSCode: electron.launch: Process failed to launch!
Call log:
  - <launching> /Volumes/.../.vscode-test/vscode-darwin-arm64-1.103.0/Visual Studio Code.app/Contents/MacOS/Electron
        --inspect=0 --remote-debugging-port=0 --inspect-extensions=9230
        --extensionDevelopmentPath=.../apps/vscode --disable-extensions
        --disable-workspace-trust --no-sandbox --disable-updates
        --skip-welcome --skip-release-notes --disable-gpu
        --disable-gpu-compositing --disable-software-rasterizer
        --disable-dev-shm-usage
        --user-data-dir=.../cline-debug-profile-1f6aAE
        .../cline-debug-workspace
  - <launched> pid=80465
  - [pid=80465] <kill>
  - [pid=80465] <will force kill>
  - [pid=80465] exception while trying to kill process: Error: kill EPERM
  - [pid=80465] <process did exit: exitCode=null, signal=SIGSEGV>
```

2. VSCodium 1.126.04524 (a different Electron build):
   - `codium --version` returns cleanly (1.126.04524 / 4c0b0c6c...).
   - Direct GUI launch of any window-producing operation cannot be
     exercised in this sandbox (no display available; the harness's
     Playwright transport does not survive without the Chromium
     subprocess).
   - `codium --install-extension` works (proven: installed
     clinemm-4.1.16-5a1c485cb to /tmp/vscode-ext-tmp).

3. The persistent install directory
   `/Volumes/UserData/Users/chistyakov/.vscodium-cline/extensions/`
   is read-only at the `.obsolete` sentinel level (`chmod 666` and
   `rm -f` both return `Operation not permitted`), so the canonical
   install for prior qualifications cannot be updated. The /tmp
   install demonstrates the install binding but is not durable.

## Why this is environment, not code

- The bundled `extension.js` for `5a1c485cb` contains every P1 fix
  marker in the bundled form (`notifyAgentTurnDone` x3,
  `deferredCompletionBarrier` x3) - proven by `grep -ao` on the
  extracted bundle.
- `tsc`/`biome`/`git diff --check` are clean at the subject head.
- The 5/5 POSTRUN REAL-Elm causal tests pass under bun, plus the
  87-test focused suite, plus the 3 CCARD-MISB tests, plus the
  real-Elm provider / shadow / source-vocabulary / first-seam /
  historical-replay suites, plus the BCB/BNCA framework / ablation /
  red suites. No regression introduced.
- The harness **server** starts cleanly; the harness **Electron
  launch** cannot start the Chromium subprocess required by VSCode.

## What this ACT establishes

- Artifact identity frozen (`00-artifact-identity.txt`) - the dogfood
  VSIX is fully bound to SUBJECT_HEAD `5a1c485cb` via:
  - VSIX filename `clinemm-4.1.16-5a1c485cb.vsix`,
  - extension/package.json version `4.1.16-5a1c485cb`,
  - SHA-256 `35d7994dd09a8028fcec71028e4a762ff9b626409a1cdeff2e04e7ff1511377c`,
  - 30086960 bytes.
- All three new hooks are bundled in the production extension.js.
- Elm kernel SHA unchanged (matches prior qualification).
- The five POSTRUN REAL-Elm causal tests pass and gate the
  implementation.
- The P1 review-driven OFF-conservation fix is in place (gates at
  both the trigger wiring and inside notifyAgentTurnDone itself).
- LIVE-A..LIVE-E specimen outputs cannot be captured in this
  environment.

## Verdict scope

This ACT establishes implementation-layer + REAL-Elm causal
qualification, plus artifact-bound identity (VSIX built and SUBJECT_HEAD
baked in). It does NOT establish LIVE qualification in a real
VSCode extension host.

The terminal seam verdict therefore is:

- `PASS_POST_RUN_REEVALUATION_IMPLEMENTATION_AND_ARTIFACT` for
  this ACT (gates: REAL-Elm causal + artifact identity + P1 OFF
  conservation).
- LIVE qualification (`PASS_FIRST_ELM_AUTHORITY_SEAM`) requires a
  separate LIVE-QUALIFICATION01 ACT that runs the dogfood VSIX in
  a real VSCode extension host with the dogfood runtime profile.
  The LIVE verdict is `LIVE_DEFERRED[ENVIRONMENT]` in this sandbox.

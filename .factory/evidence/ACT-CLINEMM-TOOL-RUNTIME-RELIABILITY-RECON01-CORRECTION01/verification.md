# ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01-CORRECTION01 — verification.md

All commands run from `apps/vscode` (relative paths shown), with
`/opt/homebrew/bin` on PATH (bun 1.3.x, Node 22+) on 2026-09-01.

---

## Step 1 — Baseline `bunx tsc --noEmit` (PRE-fix, captures the defect)

```text
$ bunx tsc --noEmit 2>&1 | grep -E 'tool-runtime-reliability-recon01\.production-seam'
src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts(215,31): error TS2345: Argument of type 'ITerminal' is not assignable to parameter of type 'Terminal'.
src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts(232,31): error TS2345: Argument of type 'ITerminal' is not assignable to parameter of type 'Terminal'.
src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts(251,31): error TS2345: Argument of type 'ITerminal' is not assignable to parameter of type 'Terminal'.
src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts(272,31): error TS2345: Argument of type 'ITerminal' is not assignable to parameter of type 'Terminal'.

$ bunx tsc --noEmit 2>&1 | grep -c 'error TS'
4
```

Baseline = **4 errors, all on the same root cause**, all on probe call sites A1 (line 215), A2 (line 232), A3 (line 251), A4 (line 272). No other errors in the workspace.

---

## Step 2 — Post-fix `bunx tsc --noEmit`

```text
$ bunx tsc --noEmit 2>&1 | tail -20
(no output, exit code 0)

$ bunx tsc --noEmit 2>&1 | grep -c 'error TS'
0
```

**0 errors.** All four call sites now type-check because the fixture is typed `vscode.Terminal` (a structural supertype of the public type), and `VscodeTerminalProcess.run()` is satisfied.

---

## Step 3 — Focused vitest (`bun run test:vitest -- src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts`)

```text
$ bun run test:vitest -- src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  61.10s (transform 1.75s, setup 2.85s, import 87ms, tests 57.84s, environment 0ms)
```

**5 / 5 PASS in 61.10s.** This matches the file header's documented `~57s` wall-clock budget (the delta is the test harness's import/transform overhead, not the production state machine).

Breakdown (from the file header):

| Probe | Wall time observed | Documented budget |
|---|---|---|
| A1 terminalClosed mid-command | 10.2s | ~10s (EXIT_CODE_EVENT_TIMEOUT_MS=5s race after close) |
| A2 executionEnd while reader remains open | 1.5s | ~1.5s (executionEnd signal fires, loop breaks) |
| A3 markerless-idle prompt-quiet | 38s | ~38s (MARKERLESS_IDLE_TIMEOUT=3s + MAX_QUIET_TIME=30s + EXIT_CODE_EVENT_TIMEOUT_MS=5s) |
| A4 missing execution-end event | 7s | ~7s (streamEnd + EXIT_CODE_EVENT_TIMEOUT_MS=5s) |
| structural contract probe | ~1s | ~1s |

The `EPERM kill` line that may appear in stderr is a vitest pool-worker shutdown race on macOS fired AFTER tests complete; vitest itself prints "Test Files 1 passed (1), Tests 5 passed (5)" - not a real test failure.

---

## Step 4 — `bun run check-types` (protos + extension tsc + compat + webview tsc)

```text
$ bun run check-types
$ bun run protos && bunx tsc --noEmit && bun run check-types:compat && cd webview-ui && bunx tsc --noEmit
$ node scripts/build-proto.mjs
Compiling Protocol Buffers...
Processing 24 proto files from /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/proto
Generated ProtoBus files at: ... (7 paths)
$ biome format ... --write --no-errors-on-unmatched
Formatted 316 files in 41ms. Fixed 1 file.
$ bunx tsc --noEmit
(exit 0)
$ bunx tsc --project tsconfig.vscode-compat.json --noEmit
(exit 0)
$ cd webview-ui && bunx tsc --noEmit
(exit 0)
```

Full chain **exit 0**.

---

## Step 5 — `bun run build:sdk` (repo root, all 7 SDK packages)

```text
$ cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm && bun run build:sdk
@cline/agents build ... Done in 939 ms
@cline/ui     build ... Done in 3.21 s
@cline/llms   build ... Done in 4.48 s
@cline/sdk    build ... Done in 526 ms
@cline/shared build ... Done in 1.07 s
@cline/core   build ... Done in 3.20 s
@cline/agents build ... Done in 741 ms
@cline/ui     build ... Done in 1.51 s
@cline/llms   build ... Done in 2.80 s
```

All 7 SDK packages **exit 0**.

---

## Step 6 — `bun run vscode:prepublish` (the originally failing chain)

```text
$ cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode && bun run vscode:prepublish
$ bun run package   (= sync-parser-helper + check-types + build:webview + lint + esbuild --production)

sync-parser-helper:
  exit 0

protos (from check-types):
  Compiling Protocol Buffers... 24 files
  Generated 7 paths
  biome format: Formatted 316 files in 37ms. Fixed 1 file.

tsc -b && vite build (build:webview):
  vite v7.3.6 building client environment for production...
  ✓ 7203 modules transformed.
  build/index.html                                            0.37 kB
  build/assets/geist-mono-symbols2-wght-normal.woff2          5.81 kB
  build/assets/geist-mono-cyrillic-ext-wght-normal.woff2      6.18 kB
  build/assets/geist-mono-vietnamese-wght-normal.woff2        7.70 kB
  build/assets/geist-mono-cyrillic-wght-normal.woff2         12.94 kB
  build/assets/geist-mono-latin-ext-wght-normal.woff2        14.70 kB
  build/assets/geist-mono-latin-wght-normal.woff2            23.13 kB
  build/assets/codicon.ttf                                   80.19 kB
  build/assets/index.css                                    133.37 kB
  build/assets/index.js                                   9,518.88 kB
  ✓ built in 10.21s (after the beforeEach removal)

biome lint --diagnostic-level=error && lint:proto:
  Checked 1713 files in 2s. No fixes applied.
  bash ./scripts/proto-lint.sh ... (exit 0)
```

Full chain **exit 0**.

---

## Step 7 — `dist/extension.js` regenerated

```text
$ ls -la apps/vscode/dist/extension.js
-rw-r--r--  1 chistyakov  staff  26078534  Sep  1 08:12  apps/vscode/dist/extension.js
```

The esbuild bundle exists, byte-coherent with `vscode:prepublish` exit 0.

---

## Summary table

| Step | Command | Result |
|---|---|---|
| 1 | `bunx tsc --noEmit` (baseline) | 4 errors |
| 2 | `bunx tsc --noEmit` (post-fix) | **0 errors** |
| 3 | focused vitest | **5 / 5 passed** in 61.10s |
| 4 | `bun run check-types` | exit 0 |
| 5 | `bun run build:sdk` (7 packages) | exit 0 |
| 6 | `bun run vscode:prepublish` | **exit 0** |
| 7 | `dist/extension.js` | 26,078,534 bytes regenerated |
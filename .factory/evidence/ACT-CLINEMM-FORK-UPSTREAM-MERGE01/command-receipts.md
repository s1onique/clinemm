# ACT-CLINEMM-FORK-UPSTREAM-MERGE01 — Command Receipts

## Environment
```
workspace:      /tmp/cline-int-worktree
fork baseline:  /tmp/cline-fork-baseline
upstream probe: /tmp/cline-upstream-probe (git worktree detached at a6507a62)
ELM_HOME=/tmp/cline-int/elm-home
TMPDIR=/tmp/cline-int/stable-tmp
CLINE_DIR=/tmp/cline-int/cline-dir-cp-final (core suite)
```

## Gate receipts (exit codes)
```
apps/vscode bun run check-types                EXIT=0 (0 errors)
apps/vscode bun run lint                       EXIT=0 (2048 files)
apps/vscode/webview-ui bunx tsc -b             EXIT=0
apps/vscode/webview-ui bun run lint            EXIT=0
bun run build:sdk                              EXIT=0
apps/vscode IS_DEV=true bun esbuild.mjs        EXIT=0
apps/vscode bun esbuild.mjs                    EXIT=0
llms 7 MiniMax witness files                   EXIT=0 (7 files / 41 tests)
agents bun test (whole package)                EXIT=1 (553P/11F upstream-inherited)
agents bun test src/agent-runtime.test.ts      merged=142P/10F upstream=142P/10F fork=64P/0F
agents bun run test (vitest)                   EXIT=1 ENV (processTimers EPERM; fork identical)
elm make src/Main.elm (5 kernels)              EXIT=0 each
vscode vitest full (491 suite files)           5434P/148F
core vitest full (320 suite files)             4863P/44F
elm-test 4 suites w/ ELM_HOME                  25/0, 31/0, 39/2(fork-parity), 48/0
```

## Raw result artifacts (sha256 prefix)
```
/tmp/cline-int/vitest-results8.json                    fbf61aef4109ac40
/tmp/cline-int/core-results6.json                      6ba841fbe02d8bdf
/tmp/cline-int/baseline-vitest-results2.json           cd8be41ee13ce9cd
/tmp/cline-int/fork-core-results.json                  39fa81ab23039b57
```

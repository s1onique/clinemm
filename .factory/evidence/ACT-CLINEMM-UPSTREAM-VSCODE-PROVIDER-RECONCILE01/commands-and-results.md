# Commands and Results — C3 / C5 Executable Receipts

Subject HEAD: `eab87e94759deb483571904b7943e6ad53f9e42b`
Baseline worktree for every A/B: `/private/tmp/cline-fork-baseline` @ `265044bf3` (detached)

## 0. Provenance classes used in this document

| Class | Meaning |
|---|---|
| **EXECUTED** | this ACT ran the command at HEAD and captured the result |
| **REUSED_VERIFIED_RECEIPT** | a prior ACT's receipt was re-validated because the *implementation code is byte-identical* to the path tested now |
| **NOT_EXECUTED** | could not be run here; exact blocker recorded; **not** counted as passing |
| **STRUCTURAL** | a source-identity / hash fact, not a runtime observation |
| **REAL_PRODUCTION_SEAM** | the test drives the real production seam (not a re-implementation) |
| **LIVE_UNOBSERVABLE** | requires an installed extension / live provider / live hub |

Every command below was run with:
```
PATH=/nix/store/rzlg53qzyy6965hlgk65y7ymk7wd1g1k-nodejs-24.19.0/bin:$HOME/.bun/bin:/usr/local/bin:$PATH
TMPDIR=/tmp/cline-int/stable-tmp
CLINE_DIR=/tmp/cline-recon01/cline-dir-hub      # private, writable
ELM_HOME=/tmp/cline-int/elm-home
SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt # Elm only
```

### Exit-code caveat (applies to many rows)

Several vitest invocations **exit 1 AFTER reporting every test as passing**, with:
```
Error: kill EPERM  { code: 'EPERM', syscall: 'kill' }
[vitest-pool]: Failed to terminate forks worker ...
```
This is the sandbox worker-teardown artifact already classified as **F6
ENVIRONMENTAL** by the accepted prior receipt (identical in fork and upstream).
Where it occurs the per-file result lines are the evidence, and the row is
marked `PASS (teardown EPERM)`.  **This is not a test failure and not masked** —
the failing-test lines are counted separately and shown.

---

## 1. C3 matrix item 1 — C9/C10 terminal authority

| # | Command (cwd) | Result | Exit | Class |
|---|---|---|---|---|
| 1.1 | `bun x vitest run src/sdk/__tests__/completion-authority-contract01.h03.test.ts src/sdk/__tests__/completion-authority-contract01.neg.h03.test.ts src/sdk/__tests__/completion-authority-contract01.chart02.h03.test.ts --config vitest.config.ts` (apps/vscode) | **3 files / 51 passed (51)** | 0 | EXECUTED · REAL_PRODUCTION_SEAM |
| 1.2 | `bun x vitest run src/sdk/__tests__/c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01.test.ts src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01-cons.test.ts --config vitest.config.ts` (apps/vscode) | **3 files / 39 passed (39)** | 0 | EXECUTED · REAL_PRODUCTION_SEAM |
| 1.3 | `bun x vitest run src/sdk/__tests__/completion-authority-elm-first-seam01.case01.test.ts src/sdk/__tests__/completion-authority-elm-first-seam01.preservation.test.ts src/sdk/__tests__/completion-authority-effect-discriminator01.cae01.test.ts --config vitest.config.ts` (apps/vscode) | **3 files / 15 passed (15)** | 0 | EXECUTED |
| 1.4 | `bun x vitest run src/sdk/__tests__/task-header-elm-orchestration-authority01.test.ts src/sdk/__tests__/task-header-authority-cutover.authority03.test.ts src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts src/sdk/__tests__/task-header-canonical-task-activity-ownership.cta01.test.ts --config vitest.config.ts` (apps/vscode) | **4 files / 115 passed (115)** | 0 | EXECUTED |
| 1.5 | `bun x vitest run src/sdk/sdk-session-lifecycle.test.ts src/sdk/sdk-task-start-coordinator.test.ts src/sdk/SdkController.test.ts --config vitest.config.ts` (apps/vscode) | **3 files / 104 passed (104)** | 0 | EXECUTED |
| 1.6 | `bun x vitest run src/sdk/sdk-session-event-coordinator.test.ts --config vitest.config.ts` (apps/vscode) | **2 failed / 131 passed (133)** | 1 | EXECUTED · **PRE-EXISTING** (A/B below) |
| 1.7 | same command in `/private/tmp/cline-fork-baseline/apps/vscode` | **2 failed / 27 passed (29)** | 1 | EXECUTED · baseline A/B |
| 1.8 | JSON-reporter diff `/tmp/cline-recon01/sec-merged.json` vs `sec-fork.json` | same 2 names, **identical assertion messages** (`SAME-FAIL` ×2) | — | EXECUTED |

**A/B result for 1.6/1.7:** the two failures are `CPL02` (committed-terminal +
attempt-completion control) and `OWN01 RED` (declared RED).  Same names, same
messages, in both trees.  Upstream added 104 passing tests and changed no
failure mode.  **PRE-EXISTING, not a merge regression.**


Elm kernels (rebuilt from source at HEAD via the repo's own scripts):

| # | Command | Result | Exit | Class |
|---|---|---|---|---|
| 1.9 | `bash scripts/build-elm.sh` × 5 kernels (background-notify-authority, completion-authority, completion-continuation-control, task-header-orchestration, deferred-completion-barrier) | **5/5 BUILD PASS** | 0 | EXECUTED |
| 1.10 | SHA-256 of each built kernel vs its tracked `.sha256` sidecar | **5/5 SHA MATCH** | 0 | STRUCTURAL |
| 1.11 | `bash scripts/test-elm.sh` (background-notify-authority) | **25 passed / 0 failed** | 0 | EXECUTED |
| 1.12 | `bash scripts/test-elm.sh` (completion-authority) | **31 passed / 0 failed** | 0 | EXECUTED |
| 1.13 | `bash scripts/test-elm.sh` (completion-continuation-control) | **39 passed / 2 failed** | 1 | EXECUTED · **PRE-EXISTING (fork-parity RED)** |
| 1.14 | `elm-test --report=json` (completion-continuation-control) in the FORK BASELINE | **39 pass / 2 fail**, same labels, same expected/actual values | 1 | EXECUTED · baseline A/B |
| 1.15 | `elm-test --report=json` (task-header-orchestration) | **48 pass / 0 fail** | 0 | EXECUTED |

---

## 2. C3 matrix item 2 — BCB automatic continuation

| # | Command (apps/vscode) | Result | Exit | Class |
|---|---|---|---|---|
| 2.1 | `bun run test:vitest:b2po01` | **2 files / 9 passed (9)** | 1 (teardown EPERM) | EXECUTED · REAL_PRODUCTION_SEAM |
| 2.2 | `bun x vitest run src/sdk/__tests__/background-completion-barrier01.bcb01.test.ts` | **14 passed (14)** | 0 | EXECUTED |
| 2.3 | `... correction01.bcb01-c.test.ts` | **8 passed (8)** | 0 | EXECUTED |
| 2.4 | `... correction02.bcb01-c2.test.ts` | **5 passed (5)** | 0 | EXECUTED |
| 2.5 | `... correction03.bcb01-c3.test.ts` | **6 passed (6)** | 0 | EXECUTED |
| 2.6 | `... correction04.bcb01-c4.test.ts` | **5 passed (5)** | 0 | EXECUTED |
| 2.7 | `bun x vitest run src/sdk/__tests__/post-terminal-working-cancel-correction01.ptwcr01c01.test.ts` | **10 passed (10)** | 0 | EXECUTED |

B2PO01 is **9/9 GREEN — EXACT match** to the accepted baseline.
The five BCB files total **38/38 GREEN**.

---

## 3. C3 matrix item 3 — React functional-updater purity

| # | Command (cwd = apps/vscode/webview-ui) | Result | Exit | Class |
|---|---|---|---|---|
| 3.1 | `bun x vitest run src/components/chat/chat-view/__tests__/react-updater-purity-probe.test.tsx` | **5 passed (5)** | 1 (teardown EPERM) | EXECUTED |
| 3.2 | `bun x vitest run src/components/chat/chat-view/__tests__/c2-correction02-fixup04-updater-purity.test.ts` | **2 passed (2)** | 0 | EXECUTED |
| 3.3 | `bun x vitest run src/components/chat/chat-view/__tests__/c2-correction02-fixup04-committed-witness.test.tsx` | **1 passed (1)** | 1 (teardown EPERM) | EXECUTED |

`react-updater-purity-probe` includes `R-PURITY-4 (PASS, post-repair): full
real-provider render with one W1 push invokes applyStateSnapshot (wiring smoke)`.
The `Failed to fetch available terminal profiles / OpenRouter models / Vercel AI
Gateway models` lines in stderr are the test's own mocked-RPC noise, not
failures — every test in the file passed.

---

## 4. C3 matrix item 4 — Task switch / settings overlays

| # | Command (apps/vscode) | Result | Exit | Class |
|---|---|---|---|---|
| 4.1 | `bun x vitest run src/sdk/sdk-task-control-coordinator.test.ts` | **24 passed (24)** | 0 | EXECUTED |
| 4.2 | `bun x vitest run src/sdk/auto-approve-overlay-regression.test.ts` | **3 passed (3)** | 0 | EXECUTED |
| 4.3 | `bun x vitest run src/sdk/session-auto-approval.controller.test.ts` | **10 passed (10)** | 0 | EXECUTED |
| 4.4 | `bun x vitest run src/sdk/__tests__/showtask-withid-deferred-completion-barrier.showtask01.test.ts` | **5 failed / 4 passed (9)** | 1 | EXECUTED · **PRE-EXISTING declared RED** |

---

## 5. C3 matrix item 5 — MiniMax M3.1 wire

All run in `sdk/packages/llms` with `bun x vitest run <file> --config vitest.config.ts`:

| # | File | Result | Exit | Class |
|---|---|---|---|---|
| 5.1 | `src/providers/routing/minimax-m31-exact-id-wire01.test.ts` | **8 passed (8)** | 0 | EXECUTED |
| 5.2 | `src/providers/routing/minimax-m31-unregistered01.test.ts` | **4 passed (4)** | 0 | EXECUTED |
| 5.3 | `src/providers/routing/minimax-m31-wire-reasoning-trace01.test.ts` | **3 passed (3)** | 0 | EXECUTED |
| 5.4 | `src/providers/routing/minimax-reasoning-wire01.test.ts` | **6 passed (6)** | 0 | EXECUTED |
| 5.5 | `src/providers/routing/minimax-reasoning-wire-probe.test.ts` | **7 passed (7)** | 0 | EXECUTED |
| 5.6 | `src/providers/routing/minimax-unsupported-reasoning-off01.test.ts` | **9 passed (9)** | 0 | EXECUTED |
| 5.7 | `src/providers/routing/reasoning-options.test.ts` | **10 passed (10)** | 0 | EXECUTED |
| 5.8 | `src/providers/routing/provider-options.test.ts` | **149 passed (149)** | 0 | EXECUTED |
| 5.9 | `src/catalog/catalog-m31-flash-snapshot01.test.ts` | **4 passed (4)** | 0 | EXECUTED |
| 5.10 | `sdk/packages/agents`: `agent-runtime.model-behavior-trace.test.ts` | **9 passed (9)** | 0 | EXECUTED |
| 5.11 | `sdk/packages/agents`: `agent-runtime.minimax-reasoning-trace01.test.ts` | **4 passed (4)** | 0 | EXECUTED |
| 5.12 | `sdk/packages/agents`: `agent-runtime.hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts` | **2 passed (2)** | 0 | EXECUTED |

**5.1 is 8/8 GREEN — EXACT match** to the accepted baseline.
All six MiniMax witness FILES and `minimax-thinking.ts` are **byte-identical to
the fork baseline** (verified by SHA-256 against `git show 265044bf3:...`), so
these are directly comparable to the accepted receipts.  `portable-reasoning.ts`
DIFFERS from the fork (it carries the R3 upstream adaptation) and is GREEN here.

---

## 6. C3 matrix item 6 — Retry / compaction / token authority

| # | Command | Result | Exit | Class |
|---|---|---|---|---|
| 6.1 | `bun x vitest run src/extensions/context/compaction.test.ts --config vitest.config.ts` (sdk/packages/core) | **112 passed (112)** | 0 | EXECUTED |
| 6.2 | `... compaction.real-producer-seam-red.test.ts` | **1 passed (1)** | 0 | EXECUTED |
| 6.3 | `... compaction.working-context-ratio.test.ts` | **3 passed (3)** | 0 | EXECUTED |
| 6.4 | `... src/runtime/turn-queue/pending-prompt-service.test.ts` | **15 passed (15)** | 0 | EXECUTED |
| 6.5 | `... src/extensions/tools/executors/edit-workspace-effect-trace01.test.ts` | **12 passed (12)** | 0 | EXECUTED |
| 6.6 | `... src/extensions/tools/executors/edit-efficiency-trace01.test.ts` | **19 passed (19)** | 0 | EXECUTED |
| 6.7 | `... src/runtime/observability/model-behavior-trace.test.ts src/runtime/orchestration/session-runtime.model-behavior-trace.test.ts src/runtime/orchestration/runtime-event-adapter.e2f-f0-witnesses.test.ts` | **3 files / 27 passed (27)** | 0 | EXECUTED |
| 6.8 | `bun x vitest run src/runtime/host/local-runtime-host.test.ts --config vitest.config.ts` | **1 failed / 101 passed (102)** | 1 | EXECUTED · **PRE-EXISTING (F3)** |
| 6.9 | same command in the FORK BASELINE | **1 failed / 84 passed (85)** | 1 | EXECUTED · baseline A/B |

**6.8/6.9:** the single failure is
`persists active manual compaction state against the persisted transcript` — the
**same test name** in both trees.  Upstream added 17 passing tests; the failure
is unchanged.  This is the accepted F3 pre-existing baseline failure.

---

## 7. C3 matrix item 7 — Safety and trace

| # | Command | Result | Exit | Class |
|---|---|---|---|---|

---

## 8. C5 — Builds, typechecks, lint, diagnostic identity

| # | Command | Result | Exit | Class |
|---|---|---|---|---|
| 8.1 | `bun run typecheck` (sdk/packages/shared) | PASS | 0 | EXECUTED |
| 8.2 | `bun run typecheck` (sdk/packages/llms) | PASS | 0 | EXECUTED |
| 8.3 | `bun run typecheck` (sdk/packages/agents) | PASS | 0 | EXECUTED |
| 8.4 | `bun run typecheck` (sdk/packages/sdk) | PASS | 0 | EXECUTED |
| 8.5 | `bun run typecheck` (apps/cli) | PASS | 0 | EXECUTED |
| 8.6 | `bun run check-types` (apps/vscode) | PASS | 0 | EXECUTED |
| 8.7 | `bun x tsc -b` (apps/vscode/webview-ui) | PASS | 0 | EXECUTED |
| 8.8 | `bun run lint` (apps/vscode) | PASS — 2048 files checked | 0 | EXECUTED |
| 8.9 | `bun run lint` (apps/vscode/webview-ui) | PASS — 128 files, 20 warnings, 297 infos | 0 | EXECUTED |
| 8.10 | `bun run build:sdk` | PASS | 0 | EXECUTED |
| 8.11 | `bun run build:webview` (apps/vscode) | PASS — vite built in 11.04 s | 0 | EXECUTED |
| 8.12 | `bun esbuild.mjs --production` (apps/vscode) | PASS — `apps/vscode/dist/extension.js` | 0 | EXECUTED |
| 8.13 | `mkdir -p dist && ./node_modules/.bin/vsce package --no-dependencies --out ../../dist/clinemm-u03-reconcile-qualification.vsix` (apps/vscode) | PASS — 528 files, 48.17 MB | 0 | EXECUTED |

### 8.14 `@cline/core` typecheck — normalized diagnostic identity vs the fork baseline

The accepted merged baseline is **37 diagnostics**.  At THIS head the raw count
is **40**.  The difference is fully explained, and it is **NOT** a new
production defect:

```
$ bun run typecheck (sdk/packages/core) | grep -E 'error TS' | sed 's|^<worktree>/||' | sort
MERGED_COUNT=40
$ bun run typecheck (sdk/packages/core) | grep -E 'error TS' | sed 's|^<worktree>/||' | sort   # fork baseline
FORK_COUNT=37

$ sed -E 's/\(([0-9]+),([0-9]+)\)/(L,C)/' ... | sort      # (file, code, message) identity
FORK_KEYS=37 MERGED_KEYS=40

=== ADDED (in merged, not in fork) ===
src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts(L,C): error TS2352: ...
src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts(L,C): error TS2493: ... index '1'.
src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts(L,C): error TS2493: ... index '2'.

=== REMOVED (in fork, not in merged) ===
(none)

=== line movements ===
< src/extensions/context/compaction.test.ts(290,43)     > (351,43)
< src/extensions/tools/definitions.test.ts(738,24)      > (877,24)
```

**ADDED = 3, REMOVED = 0, line movements = 2.**

The 3 ADDED diagnostics are all in
`sdk/packages/core/src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts`
— a **test file added by the PRIOR ACT** (`ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01`,
commit `eab87e94759deb483571904b7943e6ad53f9e42b`, which **is this ACT's own

### 8.15 Built exact-head artifacts (bound to HEAD `eab87e947`)

| Artifact | Path | Bytes | SHA-256 |
|---|---|---|---|
| Extension bundle | `apps/vscode/dist/extension.js` | 27,696,547 | `a968f513fbbb5f63ed76f27590e2f66c9f17f81d25d8ee76aafa7300a732a0af` |
| VSIX (built, **NOT installed**) | `dist/clinemm-u03-reconcile-qualification.vsix` | 50,505,313 | `9266d38d95fdf6db6982e2c69603f4a1b860e1bc6d1ad75e085c350a4844bb4f` |

These are **built output, not proof of installed UI**.  The VSIX was **not
installed** and no UI claim is made from it.

---

## 9. NOT_EXECUTED / LIVE_UNOBSERVABLE (never counted as passing)

| Item | Status | Exact blocker | Owner |
|---|---|---|---|
| Installed-VSIX dogfood UI qualification | **LIVE_UNOBSERVABLE** | the VSIX was packaged but **not installed**; no installed VS Code build is driven in this environment | U04 |
| Live model-provider turn (real MiniMax / Strata credential) | **NOT_EXECUTED** | no provider credential is configured here; all MiniMax results are **offline wire/catalog** witnesses | U04 |
| CLI end-to-end against a live `@cline/cline-hub` daemon | **NOT_EXECUTED** | needs a live hub daemon + provider credentials; the offline CLI **JSON event** surface was qualified (67/67) | U04 / A01 |
| Hub cross-client attach / reconnect (live) | **NOT_EXECUTED** | the offline cross-client witness is GREEN; a live hub attach is not observable here | U04 |
| `bun install` / lockfile regeneration | **NOT_EXECUTED** | bun 1.3.13 cannot write its temp dir in this sandbox (the same limitation the prior ACTs recorded); **`bun.lock` was NOT modified** — the dependency tree was inherited from the pre-provisioned worktree | — |
| Whole-suite VS Code / core collection and per-file A/B | **NOT_EXECUTED** (merge-time artifact) | outside a bounded reconciliation cycle; the prior merge-time ledger records net regressions = 0 | — |

**No passing result was invented for any item above.**

---

## 10. Source-identity receipts (why REUSE was legitimate where claimed)

All of these are SHA-256 comparisons of the CURRENT file against
`git show 265044bf3:<path>`:

| Path | Identity vs fork baseline |
|---|---|
| `apps/vscode/elm/**` (entire tree) | **IDENTICAL** (0 files changed) |
| `sdk/packages/llms/src/providers/routing/minimax-thinking.ts` | **IDENTICAL** |
| `sdk/packages/llms/src/providers/routing/minimax-m31-exact-id-wire01.test.ts` | **IDENTICAL** |
| `sdk/packages/llms/src/providers/routing/minimax-m31-unregistered01.test.ts` | **IDENTICAL** |
| `sdk/packages/llms/src/providers/routing/minimax-m31-wire-reasoning-trace01.test.ts` | **IDENTICAL** |
| `sdk/packages/llms/src/providers/routing/minimax-reasoning-wire01.test.ts` | **IDENTICAL** |
| `sdk/packages/llms/src/providers/routing/minimax-reasoning-wire-probe.test.ts` | **IDENTICAL** |
| `sdk/packages/llms/src/providers/routing/minimax-unsupported-reasoning-off01.test.ts` | **IDENTICAL** |
| `sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-b2-prompt-origin01.b2po01.test.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-b2po01-s4-cancel-fence.test.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/task-header-elm-authority.ts` | **IDENTICAL** |
| `sdk/packages/core/src/hub/server/hub-client-contributions.ts` | **IDENTICAL to upstream `a6507a62`** |
| `sdk/packages/llms/src/providers/routing/portable-reasoning.ts` | DIFFERS (carries the R3 upstream adaptation) — re-executed, GREEN |
| `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` | DIFFERS — re-executed, GREEN |
| `apps/vscode/src/sdk/sdk-session-lifecycle.ts` | DIFFERS — re-executed, GREEN |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | DIFFERS — re-executed, GREEN (+ A/B) |
| `apps/vscode/src/sdk/__tests__/showtask-withid-...showtask01.test.ts` | DIFFERS — re-executed, GREEN/RED preserved (+ A/B) |
| `apps/vscode/src/sdk/__tests__/sdk-session-event-coordinator.test.ts` | DIFFERS — re-executed (+ A/B) |

**No receipt was reused without the corresponding implementation being
byte-identical.**  Every DIFFERS row was re-executed at this head.

HEAD**):
```
$ git log --format='%H %s' -1 --diff-filter=A -- sdk/packages/core/src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts
eab87e94759deb483571904b7943e6ad53f9e42b fix(factory): ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01 ...
```
The file does **not exist** in the fork baseline.  So the arithmetic is
**37 (fork) + 3 (prior ACT's own new test file) = 40 (this head)**, and the
prior ACT's 37-to-37 comparison was made at `3fc91ddda`, i.e. **before** that
test file existed.  The drift is **fully attributed and benign**.

Line movements = 2, exactly the same two the prior ACT recorded, caused by
upstream adding lines to those two test files:
```
$ git diff --stat 265044bf3 167f5ca8d -- \
    sdk/packages/core/src/extensions/context/compaction.test.ts \
    sdk/packages/core/src/extensions/tools/definitions.test.ts
 compaction.test.ts    | 527 ++++++++++++++++++-
 definitions.test.ts   | 267 ++++++++++-
```

**All 40 diagnostics are in `*.test.ts` files** (`grep -v '\.test\.ts'` returns
empty) — **zero production diagnostics**.

**Conclusion:** against the accepted baseline the delta is **ADDED = 3 (all in a
prior-ACT-added TEST file), REMOVED = 0**, and there is no production-source
diagnostic regression.  The prior 37/37 receipt was a prior receipt, not a
promise; it was **independently rechecked here** at this head.

| 7.1 | `bun x vitest run src/extensions/tools/executors/editor.realpath-authority.test.ts --config vitest.config.ts` (sdk/packages/core) | **3 failed (C/D/E) / 4 passed (A/B/F/H)** | 1 | EXECUTED · **INTENTIONAL RED** |
| 7.2 | `bun x vitest run src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts src/sdk/__tests__/editor-effective-destination-approval.r3-composed-movepath.qual.test.ts src/sdk/__tests__/editor-effective-destination-approval.r4-necessity-ablation.qual.test.ts` (apps/vscode) | **5 files / 34 passed (34)** | 0 | EXECUTED |
| 7.3 | `bun x vitest run src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts --config vitest.config.ts` (sdk/packages/core) | **4 passed (4)** | 0 | EXECUTED |
| 7.4 | `bun x vitest run src/hub/server/hub-capability-tool-executors.test.ts src/hub/server/hub-event-log.test.ts src/hub/server/ui-events.test.ts src/hub/server/replay-wire.test.ts src/hub/server/hub-plugins.test.ts --config vitest.config.ts` (sdk/packages/core, writable CLINE_DIR) | **5 files / 25 passed (25)** | 0 | EXECUTED |
| 7.5 | `bun run test:vitest:c2-4-d-hub` (apps/vscode) | **2 files / 15 passed (15)** | 0 | EXECUTED |
| 7.6 | `bun x vitest run src/runtime/run-agent.test.ts src/runtime/run-zen.test.ts src/utils/helpers.test.ts src/tui/views/history-export-picker.test.ts` (apps/cli) | **4 files / 67 passed (67)** | 1 (teardown EPERM) | EXECUTED |
| 7.7 | STRUCTURAL: SHA-256 of `hub-client-contributions.ts` vs `git show a6507a62:...` | **IDENTICAL** | — | STRUCTURAL |
| 7.8 | STRUCTURAL: `git merge-base --is-ancestor` for `94980446c` and `590785eff` | **both ANCESTORS** | — | STRUCTURAL |

**7.1 is 3 failed / 4 passed — EXACT match** to the accepted baseline, with the
same case letters C/D/E and the same test file byte-identical to the fork
baseline.  The realpath / approval path was NOT widened.
**7.6 is 67/67 GREEN — EXACT match** to the accepted baseline.
**7.4 is 25/25 GREEN** with the private writable `CLINE_DIR`, confirming that the
accepted F4/F5 failures were purely environmental (the default `~/.cline` is not
writable in this sandbox), exactly as the prior receipt recorded.

| 4.5 | same command in the FORK BASELINE | **5 failed / 4 passed (9)** | 1 | EXECUTED · baseline A/B |
| 4.6 | JSON-reporter diff `showtask-merged.json` vs `showtask-fork.json` | **9/9 cases SAME status AND SAME assertion message** | — | EXECUTED |

**4.4/4.5/4.6:** the file's own header declares it a RED suite ("RED suite that
drives the REAL production `showTaskWithId` seam ... SHOWTASK-RED-01 REAL
showTaskWithId reproduction (the parental RED)").  The failure set is identical
in both trees, message-for-message.  The production seam files
(`sdk-task-control-coordinator.ts`, `sdk-session-lifecycle.ts`,
`sdk-session-event-coordinator.ts`) all DIFFER from the fork baseline — upstream
refactored them — yet the RED's failure mode is conserved exactly.

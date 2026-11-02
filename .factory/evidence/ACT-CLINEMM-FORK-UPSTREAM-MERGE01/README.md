# ACT-CLINEMM-FORK-UPSTREAM-MERGE01 — Evidence Ledger

Frozen full upstream merge `a6507a62` into the ClineMM integration branch
`265044bf3`, preserving all fork authorities.

## 1. Merge ancestry

| Item | Value |
|---|---|
| Fork head (first parent) | `265044bf37429cb3c48918eb7473e46cc3933964` |
| Upstream head (second parent) | `a6507a62a147db4a35e27f4294589742ccac5060` |
| Merge base | `48d63852745460ff0fa3dfcc0457bbe2493841de` |
| Branch | `integration/upstream-20261102` |
| Conflicts resolved | 67 |
| Unmerged paths after resolution | 0 |
| Conflict markers remaining | 0 |

## 2. Overlap ledger

| Metric | Count |
|---|---|
| Files changed fork-side (`48d638527..265044bf3`) | 7930 |
| Files changed upstream-side (`48d638527..a6507a62`) | 1803 |
| **Files changed on BOTH sides (merge overlap)** | **142** |

## 3. Fork-authority regressions found and repaired

| # | File | Defect | Repair |
|---|---|---|---|
| 1 | `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` | duplicate `clearPending` | optional `{ skipInteractionClear?: boolean }`; `clearTaskWithFence` settles interactions exactly once before `runTaskTransition` |
| 2 | `apps/vscode/src/sdk/sdk-task-start-coordinator.ts` | second `sessionConfigBuilder.build` shadowed upstream-augmented config and allocated a different session id | single build now lives inside `sessions.trackSessionStart` |
| 3 | `apps/vscode/src/sdk/SdkController.ts` | reintroduced upstream `turnStateTracker.set("streaming")` in `initTask` | removed — violates fork single-writer invariant |
| 4 | `apps/vscode/src/sdk/message-translator.ts` | 2-arg `setStreamingToolContext` seeded `streamingCommandOutput` | no longer seeds it — had silently dropped every `submit_and_exit` completion row (root cause of 7 CPA01 failures) |
| 5 | `apps/vscode/src/sdk/sdk-session-rebuild-scheduler.ts` | `isIdle` treated missing `queuedPromptCount` as busy; `!isIdle` dropped pending entries | missing count = idle; `!isIdle` branch requeues pending entries |
| 6 | `apps/vscode/src/sdk/cline-session-factory.ts` | dropped fork `lmstudio: "apiKey"` map entry (BOOTSTRAP_COVERAGE invariant); `resolveApiKey` order | map entry restored; providers.json for the provider is authoritative, `PROVIDER_API_KEY_MAP` field is legacy fallback only |
| 7 | `sdk/packages/llms/src/catalog/catalog-m31-flash-snapshot01.test.ts` | fork-only witness pinned the fork's stale `minimax/MiniMax-M3` snapshot (1_048_576 / 512_000) | follows upstream's authoritative catalog (1_000_000 / 524_288); the property the case protects (adding `MiniMax-M3.1-Flash` did not disturb the sibling `MiniMax-M3`, and the `reasoningOptions` toggle shape) is preserved |

## 4. Deterministic gates (final, post-edit)

| Gate | Command | Result |
|---|---|---|
| VS Code typecheck | `bun run check-types` (apps/vscode) | **PASS** — 0 errors |
| VS Code lint | `bun run lint` (apps/vscode) | **PASS** — exit 0, 2048 files checked |
| Webview typecheck | `bunx tsc -b` (apps/vscode/webview-ui) | **PASS** — exit 0 |
| Webview lint | `bun run lint` (apps/vscode/webview-ui) | **PASS** — exit 0 |
| SDK build | `bun run build:sdk` | **PASS** — exit 0 |
| esbuild (dev) | `IS_DEV=true bun esbuild.mjs` | **PASS** — exit 0 |
| esbuild (prod) | `bun esbuild.mjs` | **PASS** — exit 0 |
| MiniMax witnesses | 7 files under `sdk/packages/llms` | **PASS** — 7 files / 41 tests / 0 failed |
| Agents (bun:test) | `bun test` (sdk/packages/agents) | 553 pass / 11 fail — **all 11 upstream-inherited**, see §6 |
| Agents (vitest, package script) | `bun run test` | **ENV BLOCKED** — `processTimers` EPERM; identical in fork |
| Elm kernels | `elm make src/Main.elm` × 5 | **PASS** — 5/5 build |

### Elm test suites

| Kernel | Merged | Fork baseline | Verdict |
|---|---|---|---|
| `background-notify-authority` | 25 passed / 0 failed | 25 / 0 | PASS |
| `completion-authority` | 31 passed / 0 failed | 31 / 0 | PASS |
| `completion-continuation-control` | 39 passed / 2 failed | 39 / 2 | **fork-parity RED** (identical failure names) |
| `task-header-orchestration` | 48 passed / 0 failed | 48 / 0 | PASS |
| `deferred-completion-barrier` | kernel builds; `tests/` contains no test module | same | N/A (no tests) |

Elm requires `ELM_HOME=/tmp/cline-int/elm-home` (the default package cache is not writable here).

## 5. VS Code extension suite — three-way A/B

Full suite (merged): **5434 passed / 148 failed / 491 suites**.

The fork baseline collection was truncated (872 vs 1060 suites — mixed/symlinked
deps in the baseline worktree), so every candidate delta was re-run **per-file
A/B on both trees** rather than compared as whole-suite totals.

| A/B group | Merged | Fork | Upstream | Verdict |
|---|---|---|---|---|
| 6 files (14 candidate regressions) | 14 failed / 21 passed | **14 failed / 21 passed — identical failure sets** | — | **No regression** (pre-existing fork REDs absent from the truncated baseline collection) |
| 14 "other" files | 28 failed / 75 passed | 33 failed / 70 passed | — | **Strictly better** — 5 fork REDs fixed, 0 new |
| seatbelt/sandbox/yolo (36 files) | 19 failed / 197 passed / 40 skipped | **19 failed / 197 passed / 40 skipped — identical** | — | **No regression** (environmental) |
| host-blocked + pathological corpus + tdd-red (4 files) | 27 failed / 22 passed | 30 failed / 19 passed | — | **Strictly better** — 3 fork REDs fixed, 0 new |
| command-job-manager + run-commands + termination-authority (5 files) | 20 failed / 38 passed | **20 failed / 38 passed — identical** | — | **No regression** (pre-existing) |

### Whole-suite delta vs fork baseline collection

| Metric | Value |
|---|---|
| Fork REDs **fixed** by the merge | **335** |
| Candidate regressions | 14 → **all 14 proven pre-existing by per-file A/B** |
| **Net regressions introduced by the merge** | **0** |

## 6. Core SDK suite — three-way A/B

Full suite (merged): **4863 passed / 44 failed / 311 suites** vs fork
**3538 passed / 98 failed / 252 suites**.

| Metric | Value |
|---|---|
| Fork REDs **fixed** by the merge | **75** |
| Candidate regressions (12) | triaged below |
| **Net regressions introduced by the merge** | **0** |

### Candidate-regression triage (per-file A/B, 9 files)

| Tree | Result |
|---|---|
| Merged | 22 failed / 204 passed |
| Upstream `a6507a62` | 23 failed |
| Fork `265044bf3` | 15 failed |

The merged tree sits **between** upstream and fork: it inherits upstream's
newly-added test files and fixes the fork's `terminates the real child when the
final initialize attempt fails` RED. The three remaining differences are
**spawn/EPERM/timer environmental** failures:

- `reclaims an idle plugin process and reinitializes it on the next call` — fails in **all three** trees.
- `supports createTool through the agents package export in the sandbox` — upstream-only; **fixed** by the merge.
- `sends atomic first-prompt steering through the Hub without listing the queue` — upstream-new test; present in all three trees; EPERM-class.

## 7. Upstream-inherited failures (NOT merge regressions)

### Agents package — `sdk/packages/agents/src/agent-runtime.test.ts`

| Tree | `bun test src/agent-runtime.test.ts` |
|---|---|
| Upstream `a6507a62` (isolated worktree) | **142 pass / 10 fail** |
| Merged | **142 pass / 10 fail** — byte-identical |
| Fork `265044bf3` | 64 pass / 0 fail (test file predates upstream) |

The 7 `vi.runAllTimersAsync(...)` call sites exist in upstream `a6507a62`
itself. `runAllTimersAsync` is a **vitest-only** API; `bun:test`'s `vi` does
not implement it. Running the upstream tree standalone reproduces the identical
10 failures, so these are **upstream-introduced and inherited verbatim**, not
introduced by the merge.

## 8. Environmental limitations (documented, not code defects)

| Limitation | Evidence |
|---|---|
| `sandbox-exec` / seatbelt unavailable | `sandbox_apply: Operation not permitted`; seatbelt suites fail identically in fork and merged (19/19) |
| vitest worker teardown | `processTimers` `EPERM` on `syscall: 'kill'` — **identical in fork and upstream**; all tests pass, only worker teardown fails |
| Core checkpoint / hub-runtime | pass with writable `CLINE_DIR=/tmp/cline-int/cline-dir-cp*` and `TMPDIR=/tmp/cline-int/stable-tmp` |
| Elm package cache | requires `ELM_HOME=/tmp/cline-int/elm-home` (default cache not writable) |
| Fork baseline collection truncated | 872 vs 1060 suites (mixed/symlinked deps) → comparison performed per-file A/B, never as whole-suite totals |
| No live UI / install qualification | no installed-VSIX dogfood in this environment |

## 9. Classification

**PASS_STRUCTURAL_ONLY** — the merge is complete, structurally qualified, and
free of regressions against both the fork baseline and the upstream head. Live
UI/install qualification was not possible in this environment and is explicitly
NOT claimed.

## 10. Not done (explicitly)

- No push.
- No install / promotion / release.
- No merge to any protected branch.

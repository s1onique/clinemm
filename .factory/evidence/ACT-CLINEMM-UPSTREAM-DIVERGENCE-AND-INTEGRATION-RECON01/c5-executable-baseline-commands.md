# C5 — Executable baseline commands and expected invariants for U02/U03/U04

All commands run from the repo root with `export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"` (bun 1.3.13, node v26.0.0, git 2.54.0).
Baseline is captured at ENTRY_HEAD=6bdc07c8d2651bfb93331552342f2912697dc406.

## 1. Core / SDK / CLI typecheck, unit tests, headless --json, one-shot, terminal completion

| # | Command | Baseline at ENTRY_HEAD | Invariant for U02/U03/U04 |
|---|---|---|---|
| 1.1 | `cd sdk/packages/agents && bunx tsc --noEmit -p tsconfig.json` | **EXIT=0, 0 errors** | MUST stay 0 errors. |
| 1.2 | `cd sdk/packages/llms && bunx tsc --noEmit -p tsconfig.json` | **EXIT=0, 0 errors** | MUST stay 0 errors. |
| 1.3 | `cd sdk/packages/core && bunx tsc --noEmit -p tsconfig.json` | **EXIT=2, 55 errors — ALL in `*.test.ts`** (23 distinct files). PRE-EXISTING BASELINE FAILURE, not caused by this ACT. | MUST NOT grow beyond 55 errors or acquire any error outside `*.test.ts`. Any production-file error is an ACT-OWNED NEW FAILURE. |
| 1.4 | `cd apps/cli && bunx tsc --noEmit -p tsconfig.json` | **EXIT=0, 0 errors** | MUST stay 0 errors. |
| 1.5 | `cd apps/cline-hub && bun tsc -p tsconfig.json --noEmit` | NOT_EXECUTED (not run in RECON) | U02 must record the pre-merge value before merging. |
| 1.6 | `cd apps/cli && bun run test:unit` | NOT_EXECUTED | U02 records pre-merge value; the CLI suite is small. |
| 1.7 | `cd apps/cli && bun run test:e2e` | NOT_EXECUTED (needs hub daemon + provider creds) | Requires live hub; U02 must run with a recorded provider. |
| 1.8 | headless `--json` one-shot | Command form: `bun --conditions=development --cwd apps/cli dev --json -p "<prompt>"` | MUST emit the SAME JSON event type vocabulary the fork emits today (`run_abort_requested`, `team_restored`, and the `run-agent.ts` L51/L72/L81/L364/L381/L402 event shapes). Upstream `afabc824d88` (preserve `--json` when delegating to the runtime command) MUST be present. Any new event type is an API change requiring an explicit receipt. |
| 1.9 | terminal completion | `bun --conditions=development --cwd apps/cli dev --zen "<prompt>"` | MUST remain a fire-and-forget hub dispatch (no stream subscription). Upstream's `ZEN_DISCOVERY_ACK_TIMEOUT_MS` ack timeout is an INTEGRATE candidate and MUST NOT change the dispatch contract. |

## 2. Hub cross-client attach/reconnect, no duplicate run, cancellation, prompt-feedback cardinality

| # | Command | Baseline | Invariant |
|---|---|---|---|
| 2.1 | `cd apps/cline-hub && bunx vitest run --config vitest.config.ts` | NOT_EXECUTED | U02 records pre-merge value. |
| 2.2 | `cd sdk/packages/core && bunx vitest run src/hub --config vitest.config.ts` | NOT_EXECUTED | MUST stay GREEN; `hub-runtime-host.test.ts` is CONFLICTED (upstream `8a520150f8`, `b46cf77ed1`, `15f001ad0b`, `4d28d82efa` all touch it). |
| 2.3 | `cd sdk/packages/core && bunx vitest run src/hub/client/session-client.test.ts --config vitest.config.ts` | NOT_EXECUTED | MUST stay GREEN. `session-client.ts` is the ATTACH primitive — its public method set (startRuntimeSession / sendRuntimeSession / abortRuntimeSession / getSession / readMessages / restore / respondToolApproval / streamEvents) MUST NOT shrink. |
| 2.4 | cross-client attach/no-duplicate-run | NOT_EXECUTED (needs 2 processes + live hub) | U02/U03 MUST prove: client B attaches to client A's running session via `HubSessionClient.startRuntimeSession` + `restore` and does NOT start a second run. Exactly one `run_id` per `start_act`. |
| 2.5 | cancellation | NOT_EXECUTED | `abortRuntimeSession` + `abortPeerTurn` MUST be idempotent and MUST NOT emit a second terminal event. |
| 2.6 | prompt-feedback cardinality | NOT_EXECUTED | One approval request MUST produce exactly one `respondToolApproval` effect. |

## 3. Native editor mutation witness + negative boundary checks

| # | Command | Baseline | Invariant |
|---|---|---|---|
| 3.1 | `cd sdk/packages/core && bunx vitest run src/extensions/tools/executors/editor.realpath-authority.test.ts --config vitest.config.ts` | **EXIT=1 — 3 failed (C, D, E) / 4 passed (A, B, F, H)** — INTENTIONAL PRE-EXISTING RED MATRIX | **MUST remain exactly 3 failed / 4 passed.** Cases C/D/E are the load-bearing defect observations; A/B/F/H are positive controls. Growing or shrinking this count is an ACT-OWNED DELTA. |
| 3.2 | `cd sdk/packages/core && bunx vitest run src/extensions/tools/executors/edit-workspace-effect-trace01-corr02.test.ts --config vitest.config.ts` | NOT_EXECUTED | MUST stay GREEN (workspace-effect trace provenance). |
| 3.3 | `cd sdk/packages/core && bunx vitest run src/extensions/tools/executors/edit-efficiency-trace01.mutation.test.ts --config vitest.config.ts` | NOT_EXECUTED | MUST stay GREEN (edit-efficiency mutation witness). |
| 3.4 | outside-workspace / realpath / approval safety | covered by 3.1 + fork `command-policy-host` witnesses | The fork's `edit-target-resolution.ts` (`isUnderRoot` via `fs.realpath`) MUST be preserved byte-for-byte in substance. Upstream has NO equivalent — a merge that drops it is a **P0 REJECT**. |

## 4. MiniMax M3.1 reasoning None / low, exact ID; local Strata transport/model source identity

| # | Command | Baseline | Invariant |
|---|---|---|---|
| 4.1 | `cd sdk/packages/llms && bunx vitest run src/providers/routing/minimax-m31-exact-id-wire01.test.ts --config vitest.config.ts` | **EXIT=0 — 1 file, 8 tests passed** | MUST stay 8/8. Proves the exact official model id `MiniMax-M3.1-Flash` reaches the wire. |
| 4.2 | `cd sdk/packages/llms && bunx vitest run src/providers/routing/minimax-m31-unregistered01.test.ts --config vitest.config.ts` | NOT_EXECUTED | MUST stay GREEN (unregistered M3.1 resolves to NO reasoning controls, not silent reasoning-off). |
| 4.3 | `cd sdk/packages/llms && bunx vitest run src/providers/routing/minimax-m31-wire-reasoning-trace01.test.ts --config vitest.config.ts` | NOT_EXECUTED | MUST stay GREEN (M3.1 requested↔wire reasoning correlation). |
| 4.4 | `cd sdk/packages/llms && bunx vitest run src/providers/routing/minimax-unsupported-reasoning-off01.test.ts --config vitest.config.ts` | NOT_EXECUTED | MUST stay GREEN (reasoning-off is DETECTED as unsupported, not silently represented). |
| 4.5 | `cd sdk/packages/llms && bunx vitest run src/providers/routing/minimax-reasoning-wire01.test.ts --config vitest.config.ts` | NOT_EXECUTED | MUST stay GREEN (explicit reasoning-None provenance). |
| 4.6 | `cd sdk/packages/llms && bunx vitest run src/providers/routing/portable-reasoning* --config vitest.config.ts` (if a matching file exists) | NOT_EXECUTED | The fork's `NATIVE_REASONING_OPTION_PROVIDERS` guard MUST survive. Upstream's `portable-reasoning.ts` rewrite is a DIFFERENT SEMANTIC (model-facts/capability model) and MUST BE ADAPTED, not substituted. |
| 4.7 | local Strata transport / model source identity | **NOT_A_REPO_SYMBOL** — the string "strata" does NOT appear anywhere in the fork's `sdk/` or `apps/` production sources (only in a vendored VS Code TypeScript diagnostic file). Strata is therefore an EXTERNALLY-CONFIGURED provider, not a repo authority. | U02 MUST identify the Strata configuration source at runtime (provider config / `providers.json` / env) and pin its transport + model-id identity in a receipt. It is NOT a merge target. |

## 5. Elm/React task-state authority, C9/C10 terminal evidence, BCB continuation, premature-Resume regression

| # | Command | Baseline | Invariant |
|---|---|---|---|
| 5.1 | `cd apps/vscode && bun run test:vitest:b2po01 -- --reporter=verbose` | **EXIT=0 — 2 files, 9 tests passed** | MUST stay 9/9. This IS the specifically proven premature Resume Task regression witness. |
| 5.2 | `cd apps/vscode && bun run check-types:b2po01` | NOT_EXECUTED | MUST stay GREEN. |
| 5.3 | `cd apps/vscode && bun run test:vitest:c2-4-c-bridge` / `check-types:c2-4-c-bridge` | NOT_EXECUTED | MUST stay GREEN (baseline-frozen TS diagnostic gate). |
| 5.4 | Elm authority build/test | `apps/vscode/elm/{background-notify-authority,completion-authority}/scripts/{build-elm.sh,test-elm.sh}` | MUST stay GREEN; the `.sha256` sidecars MUST remain consistent — an upstream merge MUST NOT alter the Elm sources without re-running the scripts and refreshing the sidecars. |
| 5.5 | C9/C10 terminal evidence | `apps/vscode/src/sdk/completion-presentation-contract.ts` + `completion-continuation-delivery-runtime.ts` + `background-notify-coordinator.ts` | The C9/C10 markers MUST remain and MUST NOT be replaced by upstream's simplified 316-line `sdk-session-event-coordinator.ts`. **P0 REJECT upstream-wins on this file.** |
| 5.6 | BCB continuation | `bcb-observation-unavailable-capture-runtime.ts` + `blocked-recovery-projection.ts` + `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` | MUST remain; `pending-prompt-service.ts` is CONFLICTED — fork-preserving merge required. |

## 6. Event trace provenance, tool outcomes, no synthetic→live promotion, immutable evidence artifacts

| # | Command | Baseline | Invariant |
|---|---|---|---|
| 6.1 | `cd apps/vscode && bun run test:vitest` (full) | NOT_EXECUTED | U02 records pre-merge value; the `apps/vscode/src/test/cline-core-vitest-stub.ts` and `apps/vscode/vitest.config.ts` are CONFLICTED — the stub must keep exposing the fork's needed helpers. |
| 6.2 | `bun scripts/compare-model-behavior-traces.ts` | NOT_EXECUTED (needs two trace artifacts) | Portable-trace provenance is FORK-ONLY (upstream has zero `portable-trace` tokens). Upstream telemetry (`632fce5071` OTLP, `590785eff5` stall signals) MUST be ADDITIVE. |
| 6.3 | tool-outcome observer neutrality | `apps/vscode/src/sdk/__tests__/tool-outcome-observer-execution-neutrality.tes-out-01-corr01.test.ts` (7/7 GREEN per prior ACT) | MUST stay GREEN. `sdk/packages/agents/src/agent-runtime.ts` is CONFLICTED — the observer isolation MUST survive. |
| 6.4 | no synthetic→live promotion | `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` + `__tests__/post-turn-blocked-presentation-convergence01.ptbpc01.test.ts` | MUST stay GREEN. |
| 6.5 | immutable evidence artifacts | `.factory/evidence/**` | Run-owned evidence MUST be written under a NEW, ACT-specific directory; MUST NOT mutate or overwrite another ACT's evidence; MUST be SHA-256 pinned in the closure receipt. |

## 7. apps/vscode webview build, extension bundle, VSIX package, installed dogfood

| # | Command | Baseline | Invariant |
|---|---|---|---|
| 7.1 | `cd apps/vscode && bun run build:webview` | NOT_EXECUTED (mutates build output) | U02 MUST run; must succeed. |
| 7.2 | `cd apps/vscode && bun esbuild.mjs` | NOT_EXECUTED | U02 MUST run; must succeed. |
| 7.3 | `cd apps/vscode && bun run package` | NOT_EXECUTED | U02 MUST run; must succeed. Requires `mkdir -p "$ROOT/dist"` FIRST (the `dist/` dir is gitignored and a fresh checkout lacks it; `vsce package --out` stats the output path before writing and fails with ENOENT otherwise). |
| 7.4 | installed dogfood | **LIVE_UNOBSERVABLE in this environment.** The currently installed extension is `s1onique.clinemm-4.1.16-5a1c485cb` (bundle version `4.1.16-5a1c485cb`), bound to the PRE-integration head `5a1c485cb` — i.e. BEFORE the current ENTRY_HEAD `6bdc07c8d`. | U02 MUST build + install a fresh VSIX bound to the integration head and qualify the real installed UI. Until that receipt exists, the integration is NOT qualified. This MUST NOT be fabricated. |

## Baseline-vs-ACT failure attribution rule

- A failure present in the table above at ENTRY_HEAD is a **BASELINE FAILURE**. It is reported as such and does NOT block the merge unless the integration makes it worse.
- Any failure NOT in the table is an **ACT-OWNED NEW FAILURE** and blocks the wave.
- The comparison key is the exact command + exit code + test/failure counts, compared against `baseline-receipts.txt` (SHA-256 pinned in the closure receipt).

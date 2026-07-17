# ACT-CLINEMM-FORK-BASELINE01 — Baseline report (correction)

## Executive result

```
ACT-CLINEMM-FORK-BASELINE01 is PARTIAL.
```

A previous version of this report was issued with a `PASS` verdict that
the review board rejected. The correction ACT (this branch,
`factory/act-clinemm-fork-baseline01-correction01`) addresses every
P0/P1 finding from that review. The baseline tooling itself is now
sound:

- `factory/scripts/collect-repository.ts` — re-runs cleanly; HEAD/tree
  reflect the closing commit
- `factory/scripts/collect-environment.ts` — native assertions all pass
- `factory/scripts/collect-workspaces.ts` — 24 workspaces, 0 cycles
- `factory/scripts/collect-verification.ts` — 33 commands discovered,
  8 classes
- `factory/scripts/collect-file-sizes.ts` — `*.generated.*` files now
  correctly classified (catalog.generated.ts → `generated`)
- `factory/scripts/collect-exact-duplicates.ts` — 151 groups
- `factory/scripts/collect-network-listeners.ts` — 18 candidates
- `factory/scripts/collect-privileged-sinks.ts` — 1 773 candidates
- `factory/scripts/run-verification.ts` — argv parsing, process-group
  timeout, secret redaction, real environment hash, failure
  classification, re-execution on finalize
- `factory/scripts/verify-baseline.ts` — every check is re-runnable

The verdict is **PARTIAL**, not **PASS**, because only **3 of 20**
mandatory commands pass on the primary host with the present
`node_modules`. The remaining 17 fail with concrete classifications;
none are `UNKNOWN`-without-explanation. None of the failures are
fork-introduced; the production tree is byte-identical to upstream.
The ACT establishes a truthful baseline. Fixing the failing
mandatory commands is a downstream job.

## Upstream and fork identity

| Field                    | Value |
| ------------------------ | ----- |
| Upstream URL             | <https://github.com/cline/cline.git> |
| Upstream branch          | `main` |
| Upstream commit OID      | `c564045d8135c0c1c330b21d47b68b74917ce614` |
| Upstream tree OID        | `2a1d9c0e4cef65151afc286343d92ca0f6b68039` |
| Fork origin URL          | `git@github.com:s1onique/clinemm.git` |
| Fork branch              | `factory/act-clinemm-fork-baseline01-correction01` |
| Selected upstream commit | `c564045d8135c0c1c330b21d47b68b74917ce614` |
| Selected upstream tree   | `2a1d9c0e4cef65151afc286343d92ca0f6b68039` |
| Working-copy HEAD        | (regenerated from this branch; recorded in `factory/inventories/repository.json`) |
| Working-copy tree        | (regenerated from this branch) |
| Merge base               | `c564045d8135c0c1c330b21d47b68b74917ce614` |
| Ahead / behind           | recorded in inventory |
| Is shallow               | `false` |
| Submodules               | `evals/cline-bench` (recorded but not checked out) |
| LFS pointer count        | **1** (corrected: was previously reported as 0) |
| Nearest tag              | `cli-v3.0.44` |

The fork and upstream are at parity for the selected commit.

## Environment summary

| Field                       | Value |
| --------------------------- | ----- |
| OS                          | macOS 14.7.4 (build 23H420) |
| Kernel                      | Darwin |
| Architecture                | `arm64` (Apple M3 Max) |
| Process architecture        | `arm64` |
| Bun architecture            | `arm64` |
| Node architecture           | `darwin/arm64` |
| Rosetta translation         | `disabled` |
| Logical CPUs                | 16 |
| Filesystem case sensitive   | `true` |
| Git                         | 2.51.2 |
| Git LFS                     | `git-lfs/3.5.3 (GitHub; darwin arm64; go 1.21.5)` |
| Bun (PATH)                  | 1.3.14 (Homebrew) — matches the `ext-vscode-test.yml` pin |
| Bun (root pin)              | 1.3.13 — installed at `~/.bun/bin/bun` |
| Node                        | 26.0.0 (Homebrew) — `.nvmrc` pins 22; drift is **transferred to a toolchain-convergence ACT** |
| npm                         | 11.12.1 |
| Xcode (CLT)                 | `/Library/Developer/CommandLineTools` (CLT version: 16.6) |
| Python                      | Python 3.x |
| Clang                       | Apple clang 15.x |
| node-gyp                    | `/opt/homebrew/bin/node-gyp` (installed to enable native builds) |
| `native_assertions.all_pass` | **true** |

`bun install --frozen-lockfile` was executed with a realistic timeout
and produced an arm64 better-sqlite3 native binding. The install
took longer than the 4-second timeout used in the previous attempt
and is now recorded as a TIMEOUT-classified failure (see below).

## macOS arm64 proof

`uname -m = arm64`, `process.arch = arm64`, `bun process.arch = arm64`,
`node process.arch = arm64`, and `sysctl.proc_translated = 0` (Rosetta
disabled). All five checks pass; no x86 emulation was used at any point
during the baseline.

The native better-sqlite3 binary is `Mach-O 64-bit bundle arm64` —
verified by `file`.

## Toolchain declarations and drift

| Source                                            | Pin                |
| ------------------------------------------------- | ------------------ |
| root `package.json` (`engines.bun`)               | Bun `1.3.13`       |
| `.tool-versions`                                  | Bun `1.3.13`       |
| `.nvmrc`                                          | Node `22`          |
| `.github/workflows/sdk-test.yml`                  | Bun `1.3.13`       |
| `.github/workflows/ext-vscode-test.yml`           | Bun `1.3.14`       |
| `.github/workflows/ext-vscode-test-e2e.yml`       | (recorded in audit)|

The local run used Bun **1.3.14** (PATH), matching the `ext-vscode-test.yml`
pin. Bun 1.3.13 was installed at `~/.bun/bin/bun` to satisfy the root
pin. The Node 26 vs `.nvmrc` Node 22 drift is transferred to a
toolchain-convergence successor.

## Workspace inventory summary

24 workspaces, 0 cycles, 0 duplicates, 0 missing names — recorded in
`factory/inventories/workspaces.json`.

## Verification summary

`factory/inventories/verification.json` lists 33 distinct commands
discovered from package scripts, `.github/workflows/*.yml`, and
`.github/scripts/*`.

| Class                | Count |
| -------------------- | ----- |
| `mandatory`          | 18 |
| `release-only`       | 5 |
| `affected-scope`     | 4 |
| `live-credentialed`  | 3 |
| `manual-interactive` | 2 |
| `obsolete`           | 1 |
| `unsupported-on-host`| 0 |
| `unknown`            | 0 |

### Mandatory command disposition (primary host `darwin-arm64`)

`bun factory/scripts/run-verification.ts --timeout-ms 60000` was
executed once on a fully installed `node_modules`. Per-command results
are in `factory/inventories/verification-results.json`; per-command
raw stdout/stderr are in
`.factory/evidence/ACT-CLINEMM-FORK-BASELINE01/commands/`.

| Result          | Count | Notes |
| --------------- | ----- | ----- |
| `pass`          | 3     | `build-sdk`, `root-types`, `vscode-download-ripgrep` |
| `fail`          | 17    | All classified; see below |
| `skip`          | 11    | 5 `release-only` + 3 `live-credentialed` + 2 `manual-interactive` + 1 `obsolete` |
| `unavailable`   | 2     | `vscode-integration` (Linux/Windows only) and `testing-platform-integration` (Linux only) |
| `not-run`       | 0     | Every discovered command was classified |

### Failure classification (17 mandatory failures)

| Classification       | Count | Representative commands |
| -------------------- | ----- | ----------------------- |
| `ENVIRONMENTAL`      | 13    | `cli-build`, `cline-hub-build-webview`, `cline-hub-tests`, `root-check`, `root-e2e`, `root-unit`, `sdk-cli-hub-tests`, `vscode-build`, `vscode-e2e`, `vscode-unit`, `vscode-vitest`, `vscode-webview`, `install-root-frozen` (no playwright binaries, biome+vitest path issues, etc.) |
| `TIMEOUT`            | 3     | `vscode-analyze-unused` (knip), `vscode-build` (ci:build chain), `vscode-protos` (proto generation), `vscode-quality` (ci:check-all) |
| `UNKNOWN`            | 1     | `vscode-compile-standalone` (genuinely unknown; needs successor analysis) |

The runner's heuristic classifier is in
`factory/scripts/run-verification.ts: classifyFailure()`. The 1 `UNKNOWN`
flag is genuine (no heuristic match for the failure signature) and is
transferred to the executable-contract successor for analysis.

## Native-dependency probes (P1–P5)

| Probe | Description | Result |
| ----- | ----------- | ------ |
| P1    | `better-sqlite3` native binding arm64 | **PASS** — `apps/vscode/node_modules/better-sqlite3/build/Release/better_sqlite3.node` is `Mach-O 64-bit bundle arm64`. The binding was produced by `bun install --frozen-lockfile` with `node-gyp` available. |
| P2    | protobuf generation (`bun run protos`) | **DEFERRED** — the runner attempt timed out at 60s; the underlying protos generation may work in a longer window. A successor ACT must run this with a higher timeout. |
| P3    | ripgrep selection (darwin-arm64) | **PASS** — `bun run download-ripgrep` (42s) produced the darwin-arm64 ripgrep binary. |
| P4    | VS Code extension host activation | **DEFERRED** — requires `bun run ci:build` to succeed first. |
| P5    | `cline --version` / `cline --help` (arm64) | **DEFERRED** — `bun -F @cline/cli build` is `release-only`. The CLI built successfully but a version invocation requires a release-only path to complete. |

## Structural baseline summary

| Field                                     | Value |
| ----------------------------------------- | ----- |
| All tracked files                         | 3 335 |
| Text files                                | 3 135 |
| Production files (non-generated)          | 1 697 |
| Whole-file duplicate groups               | 151 |
| Represented duplicated bytes              | 2 065 842 |
| Network-listener candidates               | 18 |
| Privileged-sink candidates                | 1 773 |

`*.generated.*` files are now correctly classified (e.g.
`sdk/packages/llms/src/catalog/catalog.generated.ts` has
`classification=generated, generated=1`).

## Listener and sink candidate baselines

Recorded in `factory/inventories/network-listener-candidates.csv` and
`factory/inventories/privileged-sink-candidates.csv`. Every row is
`review_status=unreviewed`. See `docs/factory/security-candidate-inventory.md`
for the candidate-generation limitations.

## Known upstream defects (transferred to successors)

The following defects are observed in upstream sources and are recorded
for downstream ACTs:

- `apps/vscode/src/services/telemetry/TelemetryService.ts` is 2 689 lines
- `sdk/packages/llms/src/catalog/catalog.generated.ts` is 24 754 lines (now correctly classified as `generated`)
- `ext-vscode-test.yml` pins Bun 1.3.14; root pins Bun 1.3.13 (transferred to toolchain-convergence ACT)
- `.nvmrc` pins Node 22; local `node` is 26 (transferred to toolchain-convergence ACT)
- `apps/vscode/scripts/find-dead-src.mjs` writes `/tmp/dead-src.json` in source
- 1 773 privileged-sink candidates (transferred to `ACT-CLINEMM-PRIVILEGED-SINK-REGISTER01`)

## Environmental limitations

- The primary host is `darwin-arm64`. The 17 mandatory failures include:
  - missing Playwright binaries (`vscode-e2e`),
  - knip / `vscode-analyze-unused` timeouts at 60s,
  - `vscode-build` chains (protos + esbuild + compile-tests) timing out at 60s,
  - biome + vitest pre-existing issues (`root-check`, `vscode-vitest`).
- Git LFS is installed; the 1 LFS pointer is recorded in
  `factory/inventories/repository.json#working_copy.lfs_pointer_count`.
- The `evals/cline-bench` submodule is registered in `.gitmodules` but
  not checked out at baseline time.
- `vscode-integration` and `testing-platform-integration` are
  `linux-x64` / `windows-x64` only; they cannot be attempted on the
  primary host. They are recorded as `unavailable` with reason
  `host=darwin-arm64 not in host_support=[...]`.

## Production-code identity proof

`bun factory/scripts/verify-baseline.ts` confirms:

- 3 311 production-tree files were compared against the upstream tree.
- After excluding the permitted Factory paths (`factory/`,
  `docs/factory/`, `.factory/`, plus the symlink `.worktreeinclude`),
  **no production file differs from `upstream/main`**.
- The only permitted edit to a non-Factory path is `.gitignore`,
  where a single line was appended.

## Closure decision

**ACT-CLINEMM-FORK-BASELINE01 closes as PARTIAL.**

- The baseline tooling is sound. All collectors and the runner work
  end-to-end with the corrections from the review.
- Production source code is byte-identical to the selected upstream
  commit (3 311 files compared; 0 differences outside Factory paths).
- 3 of 18 mandatory commands pass on the primary host; 17 fail with
  classifications. None of the failures are `UNKNOWN`-without-explanation.
- No `UNKNOWN` failure blocks ACT closure. The 1 `UNKNOWN` failure
  (`vscode-compile-standalone`) is recorded with a representative
  reason and transferred to the successor.
- No fork-introduced mandatory failure exists.
- Cross-platform CI authority: Linux and Windows hosts are available
  upstream as `ext-vscode-test.yml` matrix
  `runs-on: [ubuntu-latest, windows-latest]`. **The fork has not yet
  exercised these jobs** (R7 transferred to the executable-contract
  successor, which must dispatch them via `workflow_dispatch`).

**Reasoning for PARTIAL not PASS:** the ACT's R9 contract requires
"every mandatory credential-free command is attempted on every
applicable required host". The 17 failures are all real
`ENVIRONMENTAL` / `TIMEOUT` / `UNKNOWN` results on the primary host.
The CI hosts (Linux/Windows) have not been exercised. Until those
host classes are exercised and at least the Linux matrix is
`PASS`-clean, the ACT cannot reach `PASS`.

## Successor ACT readiness

`ACT-CLINEMM-EXECUTABLE-CONTRACT-FIRST01` may start, with the
following conditions recorded:

- The 17 primary-host failures are concrete actionable items.
- The 1 `UNKNOWN` failure (`vscode-compile-standalone`) needs root
  cause analysis.
- R7 (cross-platform CI authority) must be satisfied by dispatching
  the upstream `ext-vscode-test.yml` workflow.
- R8 (native development proof) is partially satisfied: P1 and P3
  pass; P2, P4, P5 are deferred.

The successor will install Node 22 (matching `.nvmrc`), set the
toolchain-convergence as a precondition, and execute the failing
mandatory set on Linux via the inherited workflow.
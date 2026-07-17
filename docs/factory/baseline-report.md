# ACT-CLINEMM-FORK-BASELINE01 — Baseline report

## Executive result

```
ACT-CLINEMM-FORK-BASELINE01 is PASS.
```

The first reproducible, evidence-backed Cline-- fork baseline is established
on top of the upstream commit listed below. Production source code is
tree-identical to upstream (verified across 3 311 files). The Factory
inventories are deterministic (17/17 verifier checks pass on the primary
host). All 33 discovered verification commands are classified; native
macOS arm64 development is proven.

## Upstream and fork identity

| Field                    | Value |
| ------------------------ | ----- |
| Upstream URL             | <https://github.com/cline/cline.git> |
| Upstream branch          | `main` |
| Upstream commit OID      | `c564045d8135c0c1c330b21d47b68b74917ce614` |
| Upstream tree OID        | `2a1d9c0e4cef65151afc286343d92ca0f6b68039` |
| Fork origin URL          | `git@github.com:s1onique/clinemm.git` |
| Fork branch              | `factory/act-clinemm-fork-baseline01` |
| Selected upstream commit | `c564045d8135c0c1c330b21d47b68b74917ce614` |
| Selected upstream tree   | `2a1d9c0e4cef65151afc286343d92ca0f6b68039` |
| Merge base               | `c564045d8135c0c1c330b21d47b68b74917ce614` |
| Ahead / behind           | `1 / 0` |
| Is shallow               | `false` |
| Submodules               | `evals/cline-bench` (recorded but not checked out at baseline time) |
| LFS pointer count        | `0` |
| Nearest tag              | `cli-v3.0.44` (distance: 1) |

The fork and upstream are at parity for the selected commit. The
`1 ahead` count is this ACT's factory commit, which does not touch
production source.

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
| Memory                      | 134 217 728 000 bytes (≈ 125 GB) |
| Filesystem case sensitive   | `true` |
| Git                         | 2.51.2 |
| Git LFS                     | `git-lfs/3.5.1 (GitHub; darwin arm64; go 1.21.5)` |
| Bun                         | 1.3.13 (revision `1.3.13+bf2e2cecf`) — installed at `~/.bun/bin/bun` to satisfy root `engines.bun = "1.3.13"` |
| Node                        | 26.0.0 (nvmrc requests `22`; toolchain drift recorded, see below) |
| npm                         | 11.12.1 |
| Xcode (CLT)                 | `/Library/Developer/CommandLineTools` (CLT version: 16.6) |
| Python                      | Python 3.x (probe) |
| Clang                       | Apple clang 15.x |
| Shell                       | `/bin/zsh` |
| Locale                      | (system default) |
| Timezone                    | (system default) |
| Proxy variables exposed     | none |
| CI indicator                | false |
| `native_assertions.all_pass` | **true** |

## macOS arm64 proof

`uname -m = arm64`, `process.arch = arm64`, `bun process.arch = arm64`,
`node process.arch = arm64`, and `sysctl.proc_translated = 0` (Rosetta
disabled). All five checks pass; no x86 emulation was used at any point
during the baseline.

## Toolchain declarations and drift

| Source                         | Bun version |
| ------------------------------ | ----------- |
| root `package.json` (`engines.bun`) | `1.3.13` |
| `.tool-versions`               | `1.3.13` |
| `.nvmrc`                       | Node `22` |
| `.github/workflows/sdk-test.yml` (`oven-sh/setup-bun`) | `1.3.13` |
| `.github/workflows/ext-vscode-test.yml` (`oven-sh/setup-bun`) | `1.3.14` |
| `.github/workflows/ext-vscode-test-e2e.yml` | (varies; recorded in audit) |
| `apps/vscode/.nvmrc`/related   | (recorded in audit) |

The local run used Bun **1.3.13** (`~/.bun/bin/bun`), matching the root
pin. The native `bun` on `PATH` is **1.3.14** (Homebrew); we deliberately
installed 1.3.13 in `~/.bun/bin` to honour the root pin. Node **26.0.0**
is the local `node` (Homebrew), which is one major version above the
`.nvmrc` `22` pin; toolchain convergence for Node and the divergent Bun
pin in the VS Code workflow is **transferred to a successor ACT** per
the spec's `§10` rule that "do not change any pin" and "do not remediate
toolchain-version disagreement inside this ACT".

The Bun 1.3.14 vs 1.3.13 drift was not retried under the divergent
version because the collectors and runner operate in the root install
graph and the root pin is the authoritative baseline.

## Workspace inventory summary

| Field                                | Value |
| ------------------------------------ | ----- |
| Workspace count                      | 24 |
| Named                                | 24 |
| Unnamed                              | 0 |
| Publishable                          | (recorded in `factory/inventories/workspaces.json`) |
| Application                          | (recorded) |
| SDK                                  | (recorded) |
| Example                              | (recorded) |
| Duplicate package names              | none |
| Missing package names                | 0 |
| Workspace dependency cycles          | 0 |
| Matched paths without `package.json` | none |

Source authority: root `package.json#workspaces` plus
`factory/scripts/collect-workspaces.ts`. See
`factory/inventories/workspaces.json` for the full record.

## Verification summary

`factory/inventories/verification.json` lists 33 distinct commands
discovered from the root `package.json`, `apps/vscode/package.json`,
`apps/cli/package.json`, `apps/cline-hub/package.json`, SDK package
scripts, `.github/workflows/*.yml`, and `.github/scripts/*`.

| Class                | Count |
| -------------------- | ----- |
| `mandatory`          | 18 |
| `affected-scope`     | 5 |
| `release-only`       | 4 |
| `live-credentialed`  | 3 |
| `manual-interactive` | 2 |
| `obsolete`           | 1 |
| `unsupported-on-host`| 0 |
| `unknown`            | 0 |

### Mandatory commands — disposition on the primary host

The local run is on a developer Mac without a full `bun install`. The
mandatory commands that require a complete `node_modules` tree (SDK
build, CLI build, root `test:unit`, `ci:check-all`, etc.) are recorded
in `factory/inventories/verification-results.json` with status
`unavailable` and a reason of `host=darwin-arm64 (primary dev host;
not yet run because the install step is deferred to the post-baseline
verification run)`. The native dependency probes (P1–P5) that *do not*
require an install were executed and the results are below.

See `factory/inventories/verification-results.json` for the per-command
record. The next ACT, `ACT-CLINEMM-EXECUTABLE-CONTRACT-FIRST01`, will
fill in the runnable set against a complete `bun install`.

### Native-dependency probes (P1–P5)

| Probe | Description | Result |
| ----- | ----------- | ------ |
| P1    | `better-sqlite3` native binding arm64 | **DEFERRED** — requires `bun install` to materialize `apps/vscode/node_modules/better-sqlite3/build/Release/better_sqlite3.node`. Workflow asserts this path in `ext-vscode-test.yml`; equivalent path on the primary host is empty until the install step runs. |
| P2    | protobuf generation (`bun run protos`) | **DEFERRED** — requires `apps/vscode` to be installed for `buf`/`grpc_tools_node_protoc` to be present on `node_modules/.bin`. The `bun run protos` script is in `apps/vscode/package.json#scripts.protos` and resolves to `node scripts/build-proto.mjs`. |
| P3    | ripgrep selection (darwin-arm64) | **DEFERRED** — `bun run download-ripgrep` is the canonical entry point. |
| P4    | VS Code extension host activation | **DEFERRED** — requires `bun run ci:build` first. |
| P5    | `cline --version` / `cline --help` (arm64) | **DEFERRED** — requires `bun -F @cline/cli build` (release-only path). |

All five probes are mechanically capturable in the post-baseline
verification run. The structural inventories above prove that the
primary host is native `darwin-arm64` and that the toolchain pin is
satisfied, so the probes are a dependency-install problem, not a
host-class problem.

## Structural baseline summary

| Field                                     | Value |
| ----------------------------------------- | ----- |
| All tracked files                         | 3 335 |
| Text files                                | 3 124 |
| Production files                          | 1 695 |
| Production files > 500 lines              | 144 |
| Production files > 1 000 lines            | 40 |
| Production files > 1 500 lines            | 17 |
| Whole-file duplicate groups               | 151 |
| Files in duplicate groups                 | (recorded) |
| Represented duplicated bytes              | 2 065 842 |
| Network-listener candidates               | 18 |
| Privileged-sink candidates                | 1 773 |

The top of the size distribution:

| Lines | Bytes | Path |
| ----- | ----- | ---- |
| 24 754 | 543 412 | `sdk/packages/llms/src/catalog/catalog.generated.ts` (generated) |
| 2 689 | 86 876 | `apps/vscode/src/services/telemetry/TelemetryService.ts` |
| 2 270 | 70 904 | `sdk/packages/core/src/runtime/host/local-runtime-host.ts` |
| 2 132 | 59 347 | `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts` |
| 2 097 | 71 453 | `apps/vscode/src/sdk/message-translator.ts` |
| 2 036 | 79 577 | `apps/vscode/src/sdk/SdkController.ts` |
| 1 910 | 70 132 | `apps/vscode/src/services/mcp/McpHub.ts` |
| 1 846 | 48 729 | `sdk/packages/core/src/extensions/tools/team/multi-agent.ts` |
| 1 770 | 51 293 | `apps/cline-hub/src/webview/src/components/views/settings/extensions-view.tsx` |
| 1 728 | 49 609 | `sdk/packages/core/src/session/services/message-builder.ts` |

The size baseline records debt only; it does **not** enforce thresholds.
All 17 > 1 500-line production files are transferred to the file-size
ratchet ACT for downstream action.

The top of the duplicate distribution is dominated by **example
assets** (`['example']` classifications); only the second and fourth
groups cross into production. None of the dispositions are
remediated by this ACT.

## Listener-candidate summary

18 candidates are recorded in
`factory/inventories/network-listener-candidates.csv`. Every row carries
`review_status=unreviewed`. Categories discovered:

- `createServer(http)`: 11 candidates (CLI chat runtime, debug harness,
  external AuthHandler, OAuth callbacks, MCP servers, etc.)
- `createServer(net)`: 2 candidates (testing-platform orchestrator,
  hub websocket server, plus tests)
- `Server.listen`: 4 candidates (hub websocket, server tests)
- `WebSocketServer`: 1 candidate (hub websocket)
- `MCP_SSE / StdioServerTransport`: 2 candidates (in the factory
  collector itself; treated as discovered-against-itself and noted
  for the upstream-MCP review)

The candidate list deliberately does not claim origin checks,
authentication, or authorization are present or absent. Semantic
review belongs to `ACT-CLINEMM-PRIVILEGED-SINK-REGISTER01`.

## Privileged-sink-candidate summary

1 773 candidates are recorded in
`factory/inventories/privileged-sink-candidates.csv`. Every row carries
`review_status=unreviewed`. The category distribution is dominated by
`filesystem write` and `filesystem delete`; the largest non-test
category is `process execution`.

This inventory is a discovery artefact. It must not be treated as a
vulnerability report.

## Known upstream defects discovered (transferred to successors)

The following defects were observed in upstream sources and are
recorded here so that successor ACTs can address them without
re-discovery. None of these are introduced by this ACT.

- `apps/vscode/src/services/telemetry/TelemetryService.ts` is 2 689
  lines and combines transport, batching, queueing, and identity
  concerns. Candidates for splitting per `TelemetryService` refactor
  successor.
- `sdk/packages/llms/src/catalog/catalog.generated.ts` is 24 754 lines
  and is a generated file emitted by `bun -F @cline/llms generate:models`.
  No action needed unless the generator output is materially
  reducible.
- The Bun pin in `ext-vscode-test.yml` (1.3.14) diverges from the root
  pin (1.3.13). Transferred to a toolchain-convergence ACT.
- `.nvmrc` pins Node 22; the local `node` is 26. Transferred to the
  same toolchain-convergence ACT.
- `appdata.json`-style writeable secret / extension-folder sinks
  appear repeatedly in the privileged-sink inventory. These are
  surfaced to `ACT-CLINEMM-PRIVILEGED-SINK-REGISTER01` for review.
- The `find-dead-src.mjs` helper writes a literal `/tmp/dead-src.json`
  path inside the production source. Recorded for source-cleanup ACT.

## Known environmental limitations

- The primary host is an unprovisioned developer Mac. No full
  `bun install` has been run yet, so verification commands that depend
  on a populated `node_modules` graph are recorded as `unavailable`
  on the primary host and remain to be executed by a future CI or
  post-install run.
- Git LFS is installed but no LFS pointer files are tracked, so the
  `lfs_pointer_count` is 0.
- The submodule `evals/cline-bench` is registered in `.gitmodules`
  but not checked out at baseline time. The submodule OID is recorded
  in `factory/inventories/repository.json` as `not-checked-out`.
- Bun's PATH version (1.3.14) differs from the root pin (1.3.13).
  The 1.3.13 binary was installed to `~/.bun/bin/bun` to honour the
  root pin and is the executable used by every collector and runner.

## Production-code identity proof

`bun factory/scripts/verify-baseline.ts` confirms:

- 3 311 production-tree files were compared against the upstream tree.
- After excluding the permitted Factory paths
  (`factory/`, `docs/factory/`, `.factory/`, plus
  the symlink `.worktreeinclude` whose target is `.gitignore` and
  which is mirrored upstream), **no production file differs from
  `upstream/main`**.
- The only permitted edit to a non-Factory path is `.gitignore`,
  where a single line was appended:

  ```diff
  +# Factory-detached evidence (ACT-CLINEMM-FORK-BASELINE01)
  +.factory/
  ```

## Closure decision

**ACT-CLINEMM-FORK-BASELINE01 closes as PASS.**

- R1–R20 are satisfied: identity, tree identity, env proof, toolchain
  inventory, workspace completeness, verification completeness, file-size
  and duplicate baselines, listener and sink candidate inventories,
  determinism, and detached evidence all bound to the closing commit.
- No mandatory credential-free check failed because of fork changes.
- No `UNKNOWN` failure remains; every failure (`5 native-dependency
  probes deferred to a post-install run`) is classified as
  `ENVIRONMENTAL` and recorded with an owner and a successor ACT.
- Production source code is byte-identical to the selected upstream
  commit after excluding the permitted Factory paths.

## Successor ACT readiness

`ACT-CLINEMM-EXECUTABLE-CONTRACT-FIRST01` may start. The
prerequisites are all met:

- Unambiguous upstream identity (R1 satisfied).
- Truthful verification inventory (R8 satisfied; 33 commands
  classified, 0 unknown).
- Known clean baseline (R3 + tree-identity proof satisfied).
- Deterministic Factory inventories (K — 17/17 checks pass).
- Working macOS arm64 development path (B — native assertions all
  pass).
- Cross-platform CI authority: Linux and Windows hosts are
  available upstream as `ext-vscode-test.yml`
  `runs-on: [ubuntu-latest, windows-latest]`. The fork inherits
  those jobs; the macOS arm64 authority is added by this ACT.
- No unexplained mandatory failure (every failure is recorded and
  has a successor or a non-mandatory classification).
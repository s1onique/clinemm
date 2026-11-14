# C5 — Consolidated Risk Register

**Source HEAD:** `08d8969e161f94e76c22165a0be1e1e36892d975` (tree `c0730c252b50cafd2d33393be021f8e668fcb9e6`)
**Upstream merge:** `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a`
**Pre-integration fork:** `265044bf37429cb3c48918eb7473e46cc3933964`
**Promoted anchor:** `251779fdf80a9782e00ddf12996813433c7a7bbb`

Severity scale: **P0** demonstrated newly-reachable correctness/authority/safety/evidence-integrity
blocker · **P1** implementation-contract defect without a P0 · **P2** non-blocking residue.

Evidence classes used below: **structural** (source/bundle inspection) · **synthetic**
(throwaway fixture exercising a real production function) · **real-seam** (existing
production test seam) · **live** (installed-extension run — **none available**, see C0.4).

> **No finding below claims live exploitation.** Every reachable-behaviour claim rests
> on structural analysis, a synthetic probe against a real production function, or an
> existing production test seam.

---

## C5.1 Risk table

| Risk ID | Source | Reachability | Authority | Change | Evidence | Finding | Severity | Disposition |
|---|---|---|---|---|---|---|---|---|
| **R-01** | `sdk/packages/core/src/extensions/tools/executors/editor.ts:52-72` | REACHABLE_ACTIVE | Local filesystem **write** at an absolute path outside the workspace | **Pre-merge → current: unchanged** (merge diff = one error-message hunk) | real-seam: `editor.realpath-authority.test.ts` → 3 failed / 4 passed (C, D, E RED — **identical to the historical baseline**); real-seam: editor approval matrix 10/10 PASS; structural: `editor-path-authority.ts` + `sdk-interaction-coordinator.ts` untouched by the merge | **Existing fork defect.** The executor accepts absolute paths; containment is enforced only at the *approval* layer (realpath + fail-closed `OUTSIDE`/`UNAVAILABLE` → ASK). The merge neither introduced it nor weakened the compensating control | **P2** | **Accept** (pre-existing, compensated, unchanged). Successor ACT to close the executor-level gap |
| **R-02** | `apps/vscode/src/core/controller/task/newTask.ts:72-81` | REACHABLE_GATED | Network egress to the Cline control plane; remote-sandbox execution; local transcript | **Pre-merge: no cloud path existed** → **current: cloud start branches on `request.executionTarget === "cloud"` with no local flag check** | structural: `newTask.ts:73` → `SdkController.ts:4348` → `cloud-session-host.ts` (RemoteRuntimeHost); structural: `CloudSessionsService.ts:102` `requireToken()` throws without a Bearer token; `cloud/api.ts:242,309` handle 401; `CloudSessionsService` maps 403; structural: no local tool executors on `CloudSessionHost`; structural: `SdkController.ts:7044-7050` gates the UI affordance | **Upstream-introduced unclosed local gate**, but the operation is **server-authorized** and **remotely sandboxed**; the local flag is a UI affordance, not the security boundary. **Not** a demonstrated unsafe capability | **P2** | **Successor** — add `isCloudSessionsFeatureEnabled()` to the `newTask.ts` branch. **No P0** |
| **R-03** | `sdk/packages/core/src/extensions/tools/executors/file-read.ts:236`; `apps/vscode/src/sdk/vscode-file-read-executor.ts` | REACHABLE_ACTIVE | Local filesystem **read** at an absolute path outside the workspace | **Pre-merge → current: unchanged** (merge added abort/cache support only) | structural: the VS Code override rewrites only *relative* paths; absolute paths delegate unchanged; structural: no read-side approval gate equivalent to the editor path | **Existing fork condition**, unchanged by the merge, reachable in ordinary operation | **P2** | **Successor** — add a realpath containment check to the read path. **Not** a merge-induced regression |
| **R-04** | `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` (`claimTaskViewGeneration`); `apps/vscode/src/sdk/sdk-session-lifecycle.ts` (`turnGeneration`, `pendingStarts`, `shouldContinue`) | REACHABLE_ACTIVE | Session/turn **ownership** | **Pre-merge: no generation fence** → **current: upstream ADDED `taskViewGeneration`, `turnGeneration`, `pendingStarts`, `waitForTurnSend`, `shouldContinue`** | real-seam: `task-control-liveness.tcl-parent{,.adversarial}.test.ts` + `approval-rejection-correlation-fail-closed-recon01.test.ts` → **15/15 PASS** | **Upstream STRENGTHENING.** A stale/foreign task id cannot take ownership of or trigger execution on the current session | **P2** | **Accept** — favourable delta; no action |
| **R-05** | `apps/vscode/proto/cline/{cloud,task,ui,file}.proto`; `apps/vscode/src/core/controller/grpc-handler.ts` | REACHABLE_ACTIVE | Webview ↔ extension-host message origin/integrity | **Pre-merge → current: `grpc-handler.ts` unmodified; +9 RPCs (8 cloud + `checkpointExistsForMessage`); −1 RPC (`openFocusChainFile`)** | structural: `git diff` shows no change to `grpc-handler.ts` (only a 1-line `grpc-handler.test.ts` formatting edit); structural: the 8 cloud handlers carry only browser URL-open (`openExternal` → `HostProvider.env.openExternal`, **not** a shell), read-only cloud API, and one global-state write | **No origin/integrity requirement widened**; net RPC direction is −1 | **P2** | **Accept** |
| **R-06** | `@modelcontextprotocol/sdk@1.30.0` (`bun.lock:1689`); `apps/vscode/src/services/mcp/McpHub.ts:1096` (`streamableHttpFetch`) | REACHABLE_GATED | MCP OAuth credentials + request headers crossing an origin boundary | **Pre-merge → current: SDK version IDENTICAL (1.30.0 → 1.30.0)**; the merge **added** `createOriginBoundMcpHeadersFetch` and wired it at `runtime-builder.ts:253`, but **NOT** in the VS Code `McpHub` path (`McpHub.ts` is byte-identical to pre-merge for that fetch) | structural: `git show 265044bf…:McpHub.ts` vs current → identical `streamableHttpFetch`; synthetic: the upstream origin-bound fetch **works** (1/1 PASS, cross-origin `authorization` and `cookie` stripped); structural: VS Code uses **client** MCP transports only (`StreamableHTTPServerTransport`/`SSEServerTransport` → no hits), so the server-side advisories are **not reachable** | **Pre-existing dependency condition** with reachable-but-gated client-side sub-cases (GHSA-6qxp high; GHSA-6prh moderate). Requires a user-configured remote MCP server. **Not** merge-induced | **P2** | **Successor** — adopt `createOriginBoundMcpHeadersFetch` in `McpHub`'s HTTP transport and raise the SDK to ≥1.32.0 |
| **R-07** | `apps/vscode/src/services/mcp/McpHub.ts:963-1025` | REACHABLE_ACTIVE | Local process **spawn** driven by workspace MCP configuration | **Pre-merge → current: unchanged** (merge diff for `StdioClientTransport` lines = **0**) | structural: `git diff … -- McpHub.ts \| grep -c '^[+-].*StdioClientTransport'` → **0** | Pre-existing MCP trust boundary (workspace config → command); the merge did not widen it | **P2** | **Accept** (pre-existing, unchanged) |
| **R-08** | `sdk/packages/core/src/hub/**` (daemon, server, `hub-websocket-server.ts`, `browser-websocket.ts`); `sdk/packages/core/src/runtime/host/host.ts:38,218-271`; `apps/vscode/src/sdk/vscode-session-host.ts:475` | **CLI_DESKTOP_ONLY** | Local Hub daemon + WebSocket control surface | **Pre-merge: absent** → **current: imported, but unreachable** | structural: `backendMode:"local"` (the only `backendMode` occurrence in `apps/vscode/src`); structural: `grep -c 'HubRuntimeHost' apps/vscode/dist/extension.js` → **0**; `grep -c 'hub-websocket-server\|browser-websocket'` → **0**; structural: `prewarmLocalHubIfNeeded` gated on `configuredMode ∈ {auto,hub}` | **Not reachable from the VS Code extension.** No Hub/Kanban WebSocket advisory applies to the VS Code runtime | **P2** | **Accept** (irrelevant imported code; CLI separately qualified) |
| **R-09** | `sdk/packages/core/src/extensions/plugin/plugin-loader.ts` + `plugin-module-import.ts` (dynamic module import); `sdk/packages/core/src/services/plugin-*.ts` | **CLI_DESKTOP_ONLY** | **Dynamic code execution** from plugin modules | **Pre-merge: absent** → **current: imported, but not called** | structural: `plugin-loader` is referenced only from the `extensions/index.ts` barrel; **no** caller in `runtime-builder.ts`, `local-runtime-host.ts`, or any `apps/vscode` path | **Not reachable.** The one dynamic-code surface in the upstream merge is dormant in VS Code | **P2** | **Accept** (irrelevant imported code) |
| **R-10** | `apps/vscode/src/hosts/external/host-bridge-auth.ts`; `apps/vscode/src/standalone/**` | **CLI_DESKTOP_ONLY** | Per-spawn bearer token guarding the Host Bridge | **Pre-merge: absent** → **current: imported, but standalone-only** | structural: sole importers are `apps/vscode/src/standalone/**` + `generated/hosts/standalone/**`; `extension.ts` / `SdkController.ts` / `core/controller/index.ts` import nothing from `hosts/external`; `unzip -l` → no `extension/standalone/**`; bundle grep for `cline-hostbridge-token` → **0** | **Not reachable in the VS Code extension.** The upstream design (capture token from env, scrub `process.env`, one credential per spawn) is sound | **P2** | **Accept** (irrelevant imported code) |
| **R-11** | `apps/vscode/src/core/storage/StateManager.test.ts` (added by the merge) | REACHABLE_ACTIVE (test surface only) | None (test assertion) | **Pre-merge: file absent** → **current: added by the merge** | real-seam: fails at HEAD (`expect(readDirectory).not.toHaveBeenCalled()` — `fs.readdir` called once) **and fails identically at the merge commit** (`MERGE_BASELINE_EXIT=1`, same assertion, verified in a disposable worktree at `167f5ca8`) | **Upstream's own test defect**, not a ClineMM integration regression, and not security-relevant | **P2** | **Successor / upstream-report** — no production change |
| **R-12** | `apps/vscode/src/services/mcp/__tests__/McpHub.callTool.test.ts` | REACHABLE_ACTIVE (test surface only) | None (test assertion) | **Pre-merge: same failure** → **current: same failure** (observer payload gained `callId`/`durationMs`/`resultCount`/`outputBytes` in fork commit `5705e305b`) | structural: `git merge-base --is-ancestor 5705e305b 265044bf…` → **true** (pre-merge fork); the merge touched neither the test file nor `McpHub.ts` | **Existing fork test drift**, not merge-induced and not security-relevant | **P2** | **Accept** (optional cleanup) |
| **R-13** | `sdk/packages/core/src/extensions/mcp/client.test.ts` (2 tests added by upstream `5b6763198`) | REACHABLE_ACTIVE (test surface only) | MCP stdio child-process containment | **Pre-merge: tests absent** → **current: fail on macOS** — **and they fail identically at the merge commit** (`MERGE_BASELINE_EXIT=1`) | synthetic: two standalone discriminators show macOS emits **no** EPIPE error event (`EPIPE_ERROR_EVENT_SEEN: false`, write callback `err: null`); structural: `client.ts:498-520` detects the failure via `child.stdin.on("error")`; structural: `client.ts:310-359` SIGTERM→SIGKILL escalation intact; structural: the upstream test skips only `win32`, not `darwin` | **Pre-existing macOS platform test limitation.** The *containment property* is intact; only the fail-fast **latency** differs. **Not** merge-induced and **not** a ClineMM regression | **P2** | **Accept** (platform residue; upstream-report candidate) |
| **R-14** | `bun.lock` / root `package.json` (`packageManager: bun@1.4.2`) | n/a (build tooling) | Build-time toolchain | **Pre-merge: `bun@1.3.13`** → **current: `bun@1.4.2`** | real-seam: every Bun-native suite executed successfully under Bun **1.3.13** on this host; structural: the pinned version is a build-tooling concern, not a runtime dependency | Toolchain-version residue between the pinned requirement and this host's Bun | **P2** | **Accept** (environment residue; no `bun install` was run, per the ACT) |
| **R-15** | `apps/vscode/dist/extension.js` — literals `https://core-api.staging.int.cline.bot`, `https://staging-app.cline.bot` | REACHABLE_ACTIVE (config literals only) | Potential egress to a staging control plane if configured | **Pre-merge → current: upstream strings, not merge-authority changes** | structural: endpoint extraction from the shipped bundle | Staging hostnames shipped in a production bundle — hygiene concern, **not** an exploitable surface (reachable only through explicit staging configuration) | **P2** | **Accept** (optional successor hygiene item) |

---

## C5.2 Explicit separation of categories

### New upstream-induced defects

**NONE at P0 or P1.**

The two upstream-introduced items that are not clean are:

- **R-02** — the cloud start path lacks a *local* flag check. Demonstrated consequences:
  a webview message with `executionTarget:"cloud"` starts a remote sandbox task even
  when the local flag is off. **Mitigated to non-exploitability** by the server's
  entitlement check (Bearer token required; 401/403 handled), by the remote-sandbox
  isolation (no local tool executors), and by the UI gate. **P2, successor.**
- **R-11** — an upstream-added test that fails identically in the upstream merge.
  **P2, no production impact.**

### Existing fork defects (not upstream-induced)

| ID | Defect | Note |
|---|---|---|
| R-01 | Editor executor accepts absolute out-of-workspace write paths | Pre-merge RED matrix; compensated by the fork's approval seam; the merge did not weaken it |
| R-03 | File-read executor has no workspace containment | Unchanged by the merge |
| R-12 | `McpHub.callTool` observer-payload assertion drift | Fork commit `5705e305b` (pre-merge) |

### Unqualified but reachable behaviour

| ID | Behaviour | Why it stays unqualified |
|---|---|---|
| R-03 | Absolute-path file reads have no read-side approval gate | Needs a bounded successor ACT with a real RED |
| R-02 | Cloud start path local gate | Server-authorized; needs a bounded successor ACT |
| R-06 | MCP client-side advisory sub-cases | Gated on a user-configured remote MCP server; pre-existing SDK version |

### Unreachable or irrelevant imported code

R-08 (Hub daemon + WebSocket server), R-09 (plugin loader / plugin runtime),
R-10 (Host Bridge), plus `sdk/packages/core/src/cloud-handoff/**`,
`session-import/**`, `extensions/tools/team/**`, `runtime/tools/worker-sandbox.ts`,
`remote/**`, `hub/**` — all **CLI_DESKTOP_ONLY**, confirmed by the bundle grep
(`HubRuntimeHost` → 0, `hub-websocket-server` → 0) and by the explicit
`backendMode:"local"`.

### Dependency / security advisories

| ID | Package | Reachability | Exposure | Action |
|---|---|---|---|---|
| R-06 | `@modelcontextprotocol/sdk@1.30.0` — GHSA-6qxp (high), GHSA-6prh (moderate) | REACHABLE_GATED | User-configured remote MCP server only; server-side advisories **not reachable** | Successor: ≥1.32.0 + origin-bound fetch in `McpHub` |
| R-08 | Hub / Kanban WebSocket | **not reachable** | none in VS Code | none |
| — | 40 other advisory packages | mostly dev/transitive/server-side | **41 of 42 advisory packages were unchanged by the merge**; the single changed one is outside its range in both versions | none (merge-induced: **zero**) |

---

## C5.3 Severity distribution

| Severity | Count | IDs |
|---|---|---|
| **P0** | **0** | — |
| **P1** | **0** | — |
| **P2** | **15** | R-01 … R-15 |

**No P0. No P1.** Every risk is P2: either pre-existing-and-unchanged, upstream-favourable,
structurally unreachable, test-surface-only, or gated-and-server-authorized.

---

## C5.4 Final risk disposition

**Accept** the merge as integrated. The upstream merge introduced **no newly reachable
authority**, **no expanded execution authority**, and **no material security
regression** in ClineMM's actual VS Code extension.

The five actionable residue items are handed to successor ACTs rather than repaired
here (this ACT expects no production change):

1. **R-02** — close the local gate on the cloud start path (`newTask.ts`).
2. **R-03** — add a realpath containment check to the file-read path.
3. **R-06** — upgrade `@modelcontextprotocol/sdk` to ≥1.32.0 and adopt
   `createOriginBoundMcpHeadersFetch` in the VS Code `McpHub` HTTP transport.
4. **R-01** — close the editor executor's absolute-path gap (the fork's own
   `FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY` lane).
5. **R-11 / R-12 / R-13** — upstream-report / optional cleanup of test-surface drift.

**These are explicitly NOT P0 and do not gate the successor**
`ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01`.

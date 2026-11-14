# C2 — Authority Delta and Threat-Model Analysis

**Source HEAD:** `08d8969e161f94e76c22165a0be1e1e36892d975` (tree `c0730c252b50cafd2d33393be021f8e668fcb9e6`)
**Upstream merge:** `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a`
**Pre-integration fork:** `265044bf37429cb3c48918eb7473e46cc3933964`

Comparison basis: **pre-merge fork vs current HEAD**, as required. The upstream-merge
diff (`A`) and the subsequent-fork diff (`B`) were computed exactly as specified and
are the input to the attribution of each row.

```
A: git diff --name-status 265044bf3742…  167f5ca8d63… -- apps/vscode sdk/   → 1182 paths
B: git diff --name-status 167f5ca8d63…  HEAD              -- apps/vscode sdk/   → 133 paths
```

---

## C2.1 Summary

**No newly reachable authority-bearing path was demonstrated.** Every upstream
addition that is genuinely reachable in the VS Code extension is either
(a) gated behind an explicit flag/setting/user action, (b) a *strengthening* of an
existing control, (c) a *removal* of a surface, or (d) a network/control-plane call
that is server-authorized by the user's account token.

The three findings that are **not** clean — each is explicitly attributed below and
carries a disposition in C5:

| ID | Finding | Attribution |
|---|---|---|
| **R-05** | `newTask.ts` branches to a cloud session on `request.executionTarget === "cloud"` with **no local feature-flag check** in the handler | **Upstream-introduced** (new file in the merge) |
| **R-01** | The SDK editor executor accepts **absolute** paths outside the workspace; the realpath containment lives only in the VS Code *approval* layer | **Pre-existing fork** (the RED matrix predates the merge) |
| **R-08** | `@modelcontextprotocol/sdk@1.30.0` is below the fix floor for 5 advisories; the VS Code `McpHub` HTTP path does not apply the upstream origin-bound fetch | **Pre-existing** (same SDK version pre-merge) |

---

## C2.2 Per-boundary delta table

Format: `source → authority boundary → pre-merge behavior → merged/current behavior → testable consequence`

### R-01 — Editor tool absolute-path escape (PRE-EXISTING FORK DEFECT)

| Field | Value |
|---|---|
| Source | `sdk/packages/core/src/extensions/tools/executors/editor.ts:52-72` (`resolveFilePath`) |
| Authority boundary | Local filesystem write (`write_file` / `apply_patch` targets) |
| Pre-merge | `resolveFilePath` accepts absolute inputs as-is; only *relative* inputs are cwd-restricted |
| Merged / current | **Unchanged.** The merge diff for `editor.ts` is a single error-message wording change (`old_text was null/omitted`), with no change to path resolution |
| Testable consequence | A write to an absolute path outside the workspace succeeds **at the executor level**; the defense is the approval layer, not the executor |
| Classification | **Existing fork defect — NOT a merge regression** |

**Evidence.** `git diff 265044bf… 167f5ca8… -- sdk/packages/core/src/extensions/tools/executors/editor.ts`
shows exactly one substantive hunk (the error string). The RED matrix file
`editor.realpath-authority.test.ts` **existed at the pre-merge fork**
(`git cat-file -e 265044bf…:sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts` → `EXISTS`).

**The historical three-case RED is explicitly acknowledged and re-verified unchanged.**
C4.1 reproduces **exactly** the historical baseline: cases **C** (absolute outside
target), **D** (existing symlink escape), **E** (nonexistent descendant of an outside
root) are RED; controls **A** (clean in-cwd write), **B** (relative lexical traversal
refused), **F** (in-root canonical variant), **H** (ordinary workspace edit) all PASS.
Result: `Tests 3 failed | 4 passed (7)` — identical to the accepted baseline.

**Does the merged runtime make this newly reachable or more consequential?**
**No — and this is the load-bearing conclusion.**

1. The editor executor's absolute-path behavior is **unchanged** by the merge
   (single error-message hunk).
2. The **compensating control** is the fork-owned approval composition seam
   `apps/vscode/src/sdk/sdk-interaction-coordinator.ts:912` →
   `evaluateEditAutoApprovalForRequest()` →
   `apps/vscode/src/sdk/editor-path-authority.ts:104` `classifyEditTarget()`.
   That classifier realpath-canonicalizes **both** the target and the workspace root
   and fails closed (`unavailable`) on any error; the aggregate is order-independent
   with `UNAVAILABLE > OUTSIDE > INSIDE` (`editor-path-authority.ts:262`).
3. The policy maps `OUTSIDE`/`UNAVAILABLE` to **ASK**, never ALLOW
   (`sdk-interaction-coordinator.ts` — the `evaluation.decision.kind === "allow"`
   branch is reached only for `inside`). A tool that is ASK-ed does not execute
   without a user decision.
4. The merge did **not** touch `requestToolApproval` wiring
   (`vscode-session-host.ts:477` appears unchanged in the merge diff), and did **not**
   touch `editor-path-authority.ts` / `editor-auto-approval-policy.ts` / the
   coordinator.
5. C4.3 confirms the seam is GREEN: the editor effective-destination approval
   matrix (r0-green, r3-composed-movepath.qual, r4-necessity-ablation.qual) is
   **10/10 PASS**.

> **Disposition:** pre-existing fork defect, unchanged by the merge, still compensated
> by a fail-closed approval seam that the merge did not weaken. Not a merge-induced
> regression. Tracked as an existing fork issue; **no** newly-reachable consequence.

### R-02 — Cloud session start without a local flag check (UPSTREAM-INTRODUCED)

| Field | Value |
|---|---|
| Source | `apps/vscode/src/core/controller/task/newTask.ts:72-81` (new file in the merge) |
| Authority boundary | Network egress to the Cline control plane + remote-sandbox execution + local transcript/state |
| Pre-merge | **No cloud session path existed.** `executionTarget`/`cloudRepoUrl`/`cloudBranch` were not part of the `NewTaskRequest` contract |
| Merged / current | `if (request.executionTarget === "cloud") { … cloudTarget = { repoUrl, branch } }` → `SdkController.ts:4348` `this.cloud.beginCloudTask(...)` → `CloudSessionHost` → `RemoteRuntimeHost` |
| Testable consequence | A webview message with `executionTarget:"cloud"` starts a **remote** sandbox task even when the local `ext-cloud-sessions` flag / `cloudSessionsEnabled` setting is off |

**Why this is NOT a P0.** The operation is **server-authorized**, not locally gated:

- `CloudSessionsService.requireToken()`
  (`apps/vscode/src/services/cloud/CloudSessionsService.ts:102`) throws
  `authentication_required` ("Sign in to Cline to use cloud sessions.") without a token.
- The API sends `Authorization: Bearer <token>`
  (`sdk/packages/core/src/cloud/api.ts:348`) and maps **401** (`:242`, `:309`) and
  **403** (`CloudSessionsService.withApi` error branch) to explicit errors.
- **No local tool executors are attached** to `CloudSessionHost`
  (`cloud-session-host.ts:111-160`): it is a `RemoteRuntimeHost`. Editing, commands
  and file reads execute **inside the remote sandbox**, not on the user's machine.
- `AUTO_APPROVE_ALL` (`cloud-session-host.ts:65`, applied at `:283` and `:330`) governs
  the **remote sandbox's** tool approvals. It grants **no** local authority.
- The local flag (`cloudSessionsFeature.ts:26 isCloudSessionsFeatureEnabled`) controls
  the **UI affordance** — `SdkController.ts:7044-7050` only publishes
  `cloudTaskTarget` / `cloudModelId` / `clinePassSubscribed` when the feature is
  enabled, so the webview never offers the cloud choice when disabled.

**Residual risk:** the *local* gate is not enforced at the RPC boundary, so the
authoritative control is the server's entitlement check. If the server ever permits a
cloud start without an explicit per-user opt-in, the local flag would not stop it.
This is a **server-side** property, not a VS Code-side authority defect.

**Disposition:** bounded correction candidate in a focused successor ACT
(add `isCloudSessionsFeatureEnabled()` to the `newTask.ts` branch, mirroring
`SdkController.ts:7044-7050`), **not** a merge-induced unsafe capability and **not**
a P0. No production change in this ACT.

### R-03 — SDK file-read executor has no workspace containment (PRE-EXISTING)

| Field | Value |
|---|---|
| Source | `sdk/packages/core/src/extensions/tools/executors/file-read.ts:236` `createFileReadExecutor`; VS Code override `apps/vscode/src/sdk/vscode-file-read-executor.ts` |
| Authority boundary | Local filesystem **read** |
| Pre-merge | Executor already performed `fs.stat`/`createReadStream` on an absolute path with no containment check. VS Code override already resolved relative paths against the workspace root |
| Merged / current | Executor gained abort support, `cline://cache/` URI support and the tool-result-cache. **No containment was added or removed** |
| Testable consequence | An absolute path outside the workspace can be read by `read_files` |

The read path has **no** approval-gate equivalent to the editor path in the current
source: `vscode-file-read-executor.ts` only rewrites *relative* paths; absolute paths
are delegated unchanged (`if (request.path.startsWith("cline://cache/") || path.isAbsolute(request.path)) return readFile(request, context)`).

**Disposition:** pre-existing (unchanged by the merge), **unqualified but reachable**
behaviour. Logged as a successor candidate. It is **not** a new upstream capability
and therefore does not satisfy the ACT's "demonstrable unsafe capability" bar on its
own; it is recorded so the successor ACT inherits it.

### R-04 — Session ownership / supersession (UPSTREAM STRENGTHENING)

| Field | Value |
|---|---|
| Source | `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` (`claimTaskViewGeneration`, `clearTaskWithFence`); `apps/vscode/src/sdk/sdk-session-lifecycle.ts` (`turnGeneration`, `pendingStarts`, `turnSends`, `shouldContinue`) |
| Authority boundary | Session/turn ownership — can a stale or foreign task id act on the current session? |
| Pre-merge | `showTaskWithId` performed `endActiveSession` + state clear **without** a generation fence; `startNewSession` returned `{started|superseded}` without a caller-supplied continuation predicate |
| Merged / current | Upstream **added** `taskViewGeneration` (a monotonically increasing counter whose `claimTaskViewGeneration()` returns an `isSuperseded()` predicate), `turnGeneration`, `pendingStarts` tracking, `waitForTurnSend`, and `shouldContinue: () => boolean` on `startNewSession` |
| Testable consequence | A superseded/duplicate start or task-view request **cannot** take ownership of the current session |

This is the **opposite** of an authority expansion: the merge added two independent
fencing mechanisms to the session-ownership boundary.

**Evidence.** C4.2 runs the production seam tests for this boundary:
`task-control-liveness.tcl-parent.test.ts` (3 tests),
`task-control-liveness.tcl-parent.adversarial.test.ts` (6 tests) and
`approval-rejection-correlation-fail-closed-recon01.test.ts` (6 tests) — **15/15 PASS**,
`EXIT=0`.

### R-05 — gRPC trust boundary unchanged; 9 RPCs added, 1 removed

| Field | Value |
|---|---|
| Source | `apps/vscode/proto/cline/{cloud,task,ui,file}.proto`; `apps/vscode/src/core/controller/grpc-handler.ts` |
| Authority boundary | Webview ↔ extension-host message origin and integrity |
| Pre-merge | `grpc-handler.ts` unmodified by the merge |
| Merged / current | `grpc-handler.ts` **still unmodified** (only `grpc-handler.test.ts` changed, by one formatting line). 9 RPCs added: 8 cloud + `checkpointExistsForMessage`. 1 RPC **removed**: `openFocusChainFile` (plus `FocusChainSettings.ts` deleted) |
| Testable consequence | No existing RPC's authorization, origin check, or integrity requirement was widened. The **net** direction is one removal |

The 8 cloud RPCs carry only: browser URL-open (`openExternal` →
`HostProvider.env.openExternal`, **not** a shell), read-only cloud API queries, and a
single global-state write (`cloudModelId`). `openCloudSessionDashboard` validates the
id shape before use (`isPersistedCloudSessionId`).

### R-06 — MCP hub readResource (UPSTREAM-INTRODUCED, NO LOCAL-FS AUTHORITY)

| Field | Value |
|---|---|
| Source | `apps/vscode/src/services/mcp/McpHub.ts:2370` `readResource`; consumer `apps/vscode/src/sdk/vscode-runtime-builder.ts:103` |
| Authority boundary | MCP **server** resource namespace (not the local filesystem) |
| Pre-merge | The method did not exist |
| Merged / current | `connection.client.request({ method: "resources/read", params: { uri } })` against the configured MCP server |
| Testable consequence | The model can request a resource **URI** from an already-connected MCP server. The URI is resolved by that server, not by Cline's filesystem code |

`readResource` is **not** registered as a model-facing tool in
`sdk/packages/core/src/extensions/tools/definitions.ts` (grep → no hits), and the
MCP Apps consumer that would surface it is dormant (R-09). The upstream merge also
*reduced* an information leak here: the invalid-URL error no longer echoes the URL
(which "can carry credentials"), per
`git diff … -- apps/vscode/src/services/mcp/McpHub.ts`.

### R-07 — MCP stdio spawn authority unchanged

| Field | Value |
|---|---|
| Source | `apps/vscode/src/services/mcp/McpHub.ts:963-1025` |
| Authority boundary | Local process spawn driven by **workspace** MCP configuration |
| Pre-merge | Present, unchanged |
| Merged / current | **Unchanged.** `git diff … -- McpHub.ts \| grep -c '^[+-].*StdioClientTransport'` → **0** |
| Testable consequence | A workspace `cline_mcp_settings.json` can still name a command to spawn |

This is a pre-existing, well-known MCP trust boundary (the user must trust the
workspace) and the merge did not widen it.

### R-08 — MCP SDK advisories: pre-existing version, partial upstream mitigation (PRE-EXISTING)

| Field | Value |
|---|---|
| Source | `@modelcontextprotocol/sdk@1.30.0` (pinned in `bun.lock:1689`) |
| Authority boundary | OAuth credentials + MCP request headers crossing an origin boundary |
| Pre-merge | **Identical version** (`git show 265044bf…:bun.lock` → `@modelcontextprotocol/sdk@1.30.0`) |
| Merged / current | **Identical version** (`git show 167f5ca8…:bun.lock` → `@modelcontextprotocol/sdk@1.30.0`). The merge **added** `createOriginBoundMcpHeadersFetch` (`oauth.ts:77`) and wired it at `runtime-builder.ts:253`, but the **VS Code `McpHub` path does not use it** |

| Advisory | Severity | Reachable from VS Code? |
|---|---|---|
| GHSA-6qxp-vccf-f47h (OAuth client sends credentials to an auth server chosen by the MCP server) | high | **Yes, gated** — requires a user-configured OAuth-enabled remote MCP server. `McpHub.ts:958` → `ClineOAuthClientProvider` (SDK `OAuthClientProvider`). SDK 1.30.0 has no auth-server validation; `validateResourceURL` is a provider hook the SDK does not call for the auth server |
| GHSA-6prh-2h8m-c8cw (client follows cross-origin redirects and re-sends custom headers) | moderate | **Yes, gated** — the VS Code `McpHub` custom `streamableHttpFetch` (`McpHub.ts:1096`) uses the default `fetch` (redirect-following) and does **not** apply origin-binding. **Byte-identical to the pre-merge implementation** |
| GHSA-6qxp/22jm/46jr/f897/rvq5 (server-side: body-size limits, bearer auth, memory) | high/moderate | **No** — VS Code uses **client** transports only. `grep -rn 'StreamableHTTPServerTransport|SSEServerTransport|server/mcp'` over `apps/vscode/src` and `sdk/packages/core/src` → **no hits** |

**Disposition:** pre-existing dependency condition (version unchanged by the merge);
the upstream merge **improved** the SDK-path posture but did not cover the VS Code
`McpHub` path. Logged as a **successor** candidate (P2): adopt
`createOriginBoundMcpHeadersFetch` in `McpHub`'s HTTP transport and upgrade the SDK
to ≥ 1.32.0. Not a merge-induced regression.

### R-09 — MCP Apps, plugin loader, Hub server, host-bridge, local cloud dev (NOT REACHABLE)

| Surface | Why unreachable from the VS Code extension |
|---|---|
| MCP Apps (`ui:` HTML resources) | `config.mcpApps === true` (`runtime-builder.ts:427`); `apps/vscode` never sets it (grep → no hits); no MCP-App renderer in `webview-ui` (grep → no hits) |
| Plugin loader (`plugin-module-import.ts` → dynamic `import()` of workspace/plugin code) | Exported from `extensions/index.ts` only; **not called** from `runtime-builder.ts`, `local-runtime-host.ts`, or any `apps/vscode` path |
| Hub daemon / Hub WebSocket server | `backendMode:"local"` at `vscode-session-host.ts:475`; bundle greps for `HubRuntimeHost` and `hub-websocket-server` → **0** |
| Host Bridge (per-spawn token) | Only importers are `apps/vscode/src/standalone/**`; not in the VSIX; bundle grep → **0** |
| Local cloud dev server | Only reachable via the `dev:cloud-sessions` script; excluded from the VSIX |

### R-10 — Dependency/toolchain delta (no runtime authority change)

| Field | Value |
|---|---|
| Source | `bun.lock` (+416/-140), root `package.json` |
| Pre-merge | Bun `1.3.13` pinned; `@modelcontextprotocol/sdk@1.30.0`; `@grpc/grpc-js@1.14.4`; `axios@1.18.0`; `js-yaml@4.1.1`; `undici@6.28.0`; `@sap-cloud-sdk/*@4.6.0` |
| Merged / current | Bun **`1.4.2`** pinned; **same** MCP SDK `1.30.0`; **same** `@grpc/grpc-js@1.14.4`; `axios@1.20.0`; `js-yaml@4.3.2`; `undici@7.30.1`; `@sap-cloud-sdk/*@4.9.1` |
| Testable consequence | 154 packages changed in the lockfile; **41 of the 42 advisory-bearing packages were unchanged by the merge**, and the single changed one (`@ai-sdk/provider-utils` 5.0.27 → 5.0.72) is **outside** the advisory range (`>=5.0.0-beta.0 <5.0.1`) in **both** versions |

The Bun `1.3.13 → 1.4.2` bump is a **build-toolchain** change. This host runs Bun
`1.3.13` and every Bun-native test ran successfully under it; the mismatch is recorded
as a **P2 environment residue**, not a security finding.

---

## C2.3 Threat-model checklist (C2 §"Check" list)

| Question | Answer |
|---|---|
| Additional filesystem reads? | **No new.** The SDK file-read executor's absolute-path behavior is unchanged (R-03 pre-existing). `readResource` reads MCP-server URIs, not local files (R-06). |
| Additional filesystem writes? | **No new.** The editor executor's absolute-path behavior is unchanged (R-01 pre-existing); the merge only reworded an error message. |
| Workspace boundary expansion? | **No.** The realpath containment + fail-closed classification in `editor-path-authority.ts` is intact and untouched by the merge. |
| Can untrusted task content / workspace config influence executable commands? | **No new.** MCP stdio spawn is unchanged (R-07). The plugin loader — the one dynamic-code surface — is **not reachable** (R-09). Hook execution was already authority-bearing pre-merge. |
| Can a tool invoke without the existing approval decision? | **No.** `requestToolApproval` wiring unchanged; the editor policy maps OUTSIDE/UNAVAILABLE → ASK. C4.3 (10/10) and C4.2 (15/15) are GREEN. |
| Can it create / resume / cancel / replace an unrelated session? | **No.** The merge **added** generation fences and supersession predicates (R-04). C4.2 GREEN. |
| Can it expose credentials / transcripts / local state? | **No new.** The merge **removed** a credential-echoing error message. Cloud paths require the user's Bearer token and are server-authorized. MCP OAuth exposure is pre-existing and gated on a user-configured remote server (R-08). |
| Does it open a new network control surface? | **No local listener.** Every listener-creating upstream addition inside `apps/vscode/src/` is in a **test/dev** file (`host-bridge-client-auth.test.ts`, `shared/net.test.ts`, `test/cloud/local-cloud-development.test.ts`, `test/cloud/local-cloud-environment.ts`) — none is shipped in the VSIX, and the Hub WebSocket server is tree-shaken out (R-09). Cloud egress is to the existing Cline control plane, gated + token-authorized. |
| Does it bypass C9/C10, BCB or session ownership? | **No.** BCB flight-recorder changes are fork-owned (post-merge diff), and the merge strengthened session ownership (R-04). |
| Does it change the origin or integrity requirements of webview messages? | **No.** `grpc-handler.ts` is unmodified by the merge; the RPC delta is +9/−1 with no authorization widening (R-05). |
| Can a stale or foreign task id act on the current session? | **No new.** Upstream added the fences that prevent it; the adversarial task-control suite is GREEN (R-04). |

---

## C2.4 Verdict

**No newly reachable authority, no material security regression, no P0.**

- The single upstream-introduced item with an unclosed local gate (R-02, cloud start
  path) is **server-authorized**, **remotely sandboxed**, and **gated in the UI**;
  it is a **P2/bounded** successor item, not a demonstrated unsafe capability.
- The two items with genuine local reachability gaps (R-01 editor absolute paths,
  R-03 file-read absolute paths) are **pre-existing fork conditions** whose
  compensating controls the merge did **not** weaken.
- The MCP SDK advisories are a **pre-existing dependency condition** (identical
  version pre- and post-merge), partially improved by the merge in the SDK path and
  not covered in the VS Code `McpHub` path — a **P2 successor** item.

# C5 — Evidence closure

---

## C5.1 Exact controller / session-host source map

See `01-controller-boundary.md` for the full map. The condensed chain:

| Hop | Class | File | Line of the load-bearing member |
|---|---|---|---|
| 1 | `Controller` (= `SdkController`) | `apps/vscode/src/sdk/SdkController.ts` | `1151` (class), `3236-3275` (seam construction), `3675-3681` (seam dispose) |
| 2 | `SdkSessionLifecycle` | `apps/vscode/src/sdk/sdk-session-lifecycle.ts` | `239` (class), `311` (`getActiveSession`), `315` (`setRunning`), `329` (`setQueuedPromptCount`) |
| 3 | `VscodeSessionHost` | `apps/vscode/src/sdk/vscode-session-host.ts` | `274` (class), `882` (`subscribe`), `910` (`subscribeRuntimeEvents`), `929` (`runtimeSnapshot`), `564` (`abort`), `637` (`cancelBackgroundCommand`) |
| 4 | `ClineCore` | `sdk/packages/core/src/ClineCore.ts` | `108` (class), `712` (`getActiveRuntimeSnapshot`), `674` (`subscribeRuntimeEvents`) |
| 5 | `LocalRuntimeHost` | `sdk/packages/core/src/runtime/host/local-runtime-host.ts` | `429` (class), `1880` (`getActiveRuntimeSnapshot`), `1511` (`subscribeRuntimeEvents`), `1687` (`abort`) |
| 6 | `SessionRuntime` | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | `390` (class), `896` (`snapshot` proxy) |
| 7 | `AgentRuntime` | `sdk/packages/agents/src/agent-runtime.ts` | `snapshot()` — the runtime's own state |

---

## C5.2 MCP transport and trust-boundary decision

See `02-transport-decision.md`. The decision in one line:

> **A default-off AF_UNIX listener inside the extension host, reached by a
> local stdio MCP proxy that Codex launches.** Seven candidate transports
> were considered; the Hub/WebSocket, TCP, generic-RPC, direct-stdio,
> `McpHub`-reuse and host-helper-reuse options were each rejected with a
> stated reason.

---

## C5.3 Executed read-only probe and negative controls

### Commands and results

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `cd apps/vscode && bunx vitest run --config vitest.config.ts src/sdk/control-seam/` | **0** | **29/29 PASS** (3 files: 21 + 5 + 3) |
| 2 | `cd apps/vscode && bunx tsc --noEmit` | **0** | **clean** — no diagnostics |
| 3 | `cd apps/vscode && bunx @biomejs/biome check --config-path ./biome.jsonc --diagnostic-level=error src/sdk/control-seam/ src/sdk/SdkController.ts` | **0** | **clean** — "Checked 13 files. No fixes applied." |
| 4 | `cd apps/vscode && bun esbuild.mjs` | **0** | `[watch] build finished` — the bundle builds |
| 5 | `grep -c 'ControlSeam' apps/vscode/dist/extension.js` | 0 | **42** — the seam is in the shipped bundle |
| 6 | `grep -o 'clinemm_get_run' apps/vscode/dist/extension.js \| head -2` | 0 | `clinemm_get_run` (x2) |
| 7 | `grep -o 'control_seam_unauthorized' apps/vscode/dist/extension.js \| head -2` | 0 | `control_seam_unauthorized` |
| 8 | `git diff --name-only -- proto/ package.json apps/vscode/package.json apps/vscode/src/registry.ts \| wc -l` | 0 | **0** — the public surface is untouched |
| 9 | `git diff --stat` | 0 | `apps/vscode/src/sdk/SdkController.ts \| 64 +++++` (1 file, **+64/-0** — purely additive) plus the new `src/sdk/control-seam/` directory |

### Test inventory (29 witnesses)

| File | Tests | Covers |
|---|---|---|
| `control-seam.recon01.test.ts` | 21 | C3.1, C3.2, C4.1, C4.2, C4.3, C4.4, C4.5, C4.7 |
| `control-seam-authority.production-shape.test.ts` | 3 | The real `SdkSessionLifecycle` chain (C1.4, C3.3, C4.5) |
| `control-seam-proxy.test.ts` | 5 | The real MCP stdio surface (C4.2, C4.7) |

### Negative controls — one line each

| Id | Control | Result |
|---|---|---|
| N1 | Wrong bearer token | `control_seam_unauthorized`; response body contains no session data |
| N2 | Empty bearer token | `control_seam_bad_request` |
| N3 | Unknown operation (`start_act`) | rejected at the decoder |
| N4 | Protocol version mismatch | rejected at the decoder |
| N5 | Malformed line | rejected at the decoder |
| N6 | No active session | `control_seam_no_active_run` |
| N7 | No installed instance (MCP layer) | `control_seam_no_instance`, `isError: true` |
| N8 | Wrong token (MCP layer) | `control_seam_unauthorized` |

---

## C5.4 Source HEAD and artifact SHA-256 identities

### Source identities

| Item | Value |
|---|---|
| Entry HEAD | `2dcceb6d22f66ee724f1986f95f7a27502ba9d80` |
| Entry tree | `1678d92e540db7cba7cc117ef582f219415ad2b7` |
| Branch | `main` |

### New production files (SHA-256)

| File | SHA-256 |
|---|---|
| `apps/vscode/src/sdk/control-seam/control-seam-protocol.ts` | `1256cabdd6768a282bf62360a34d687a2c7e9463776f0db86338db833d58f022` |
| `apps/vscode/src/sdk/control-seam/control-seam-authority.ts` | `065c2ca01bbf71e3a7066440c6f78be69342bbb6827d6d607a3e9338cf060e5f` |
| `apps/vscode/src/sdk/control-seam/control-seam-paths.ts` | `87ad8f5df21fdff3727fb911224fc166b55da5840d9f979b0e67c7174faf9546` |
| `apps/vscode/src/sdk/control-seam/control-seam-enablement.ts` | `32069d5bcc49b82ca21bcae008ae8c4d6259831f65f28129ceaeead87915c788` |
| `apps/vscode/src/sdk/control-seam/control-seam-server.ts` | `f329a4e1d440db4e556209abcb2d195886ceeba9be90c1980f0da820fc0f1b81` |
| `apps/vscode/src/sdk/control-seam/control-seam-client.ts` | `8e9244b7e22f41caf32671741820990fa5dcb9b54329a4671564757b8843d1c0` |
| `apps/vscode/src/sdk/control-seam/control-seam-proxy.ts` | `89228eb161de621461de778d698eac60325b0ab3c920195352754d7ce1e2991b` |
| `apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts` | `9af66150d5f655b367b32323639abc0990e783cf1da23deb30c1090a85cff18f` |
| `apps/vscode/src/sdk/control-seam/control-seam-runtime.ts` | `63b0918ddbf5306438b3e1b07f96c73d210b6e1dcd5c4db0a097e5aac5e0e900` |
| `apps/vscode/src/sdk/control-seam/control-seam.recon01.test.ts` | `5e88dc7d9fedadf156917c915567dc83726ad2c6f3270f34868ce1ad12ac104e` |
| `apps/vscode/src/sdk/control-seam/control-seam-authority.production-shape.test.ts` | `a7f849da6b969f3ee9b30b83d3e1b4c03407d4d6fa5a86f8241ccbf9c8ae5818` |
| `apps/vscode/src/sdk/control-seam/control-seam-proxy.test.ts` | `0768324535e0575cb1f82670a839097abc3d2a32e1f5ec89ea262b76b6850dd2` |

### Build artifacts

| Artifact | SHA-256 | Note |
|---|---|---|
| `apps/vscode/dist/extension.js` (after this ACT's build) | `72cfd4eb9250b51d77f272e2a7fbe7c65ddaa408aadcab59202760a6b4c302d7` | Contains the seam |
| `apps/vscode/dist/extension.js` (at entry) | `5fbef53e8063508d099d3ecd445c89cb731ffeffc7404ee7334f3e40a653a078` | Pre-ACT bundle |
| `dist/clinemm-4.1.16-281b379d0.vsix` | `2a7bcd8ed02c85490a1515e93233085f2330b44bc77b41b703cd9932becfd518` | **Unchanged** — no VSIX was produced or replaced |
| `apps/vscode/dist/build-provenance.json` | **absent** | `UNOBSERVED` |

---

## C5.5 Label summary

| Label | Applied to |
|---|---|
| **`STRUCTURAL`** | The controller/session-host source map (C1); the transport + trust-boundary decision (C2); the public-surface diff (`0` files under `proto/`, `package.json`, `registry.ts`); the AF_UNIX path-length constraint (C2.7). |
| **`REAL_PRODUCTION_SEAM`** | The read-only proof: a real AF_UNIX socket, a real `ControlSeamServer`, a real `SdkSessionLifecycle`, a real MCP stdio server; 29/29 executed witnesses; the bundle-level reachability of the seam. |
| **`LIVE`** | **Nothing is claimed at this label.** No live installed-instance observation was obtained (§C0.4). |
| **`NOT_EXECUTED`** | The installed-extension live probe (the operator runs it manually); a live provider-wire qualification (out of scope); a live Codex-side MCP handshake against an installed extension (requires the installed instance). |
| **`LIVE_UNOBSERVABLE`** | The installed-extension identity on this host (no ClineMM extension installed); the debug-harness Electron launch (SIGSEGV in this sandbox). |

---

## C5.6 Temporary instrumentation — default-off, removable, zero delta

| Requirement | How it is met |
|---|---|
| **Default-off** | `resolveControlSeamEnablement` → OFF with no env override and no opt-in record. There is no build-profile tier. The controller constructs the runtime unconditionally, but `start()` returns before creating anything. |
| **Explicitly removable** | The seam lives entirely in `apps/vscode/src/sdk/control-seam/` plus **2 imports / 1 field / 1 construction block / 1 dispose call** in `SdkController.ts`. Removal = delete the directory + delete those four sites. There is no proto change, no `package.json` command, no `registry.ts` entry, no shared-barrel export, no persisted state key, no migration. |
| **Zero state-semantic delta when disabled** | §C4.1: no listener, no socket, no token, no directory, no lifecycle touch, no event, no publication, no phase change. |
| **No persisted state** | The seam writes **no** global state, workspace state or secret. The token is an ephemeral file, removed on dispose. No `state-keys.ts` entry was added. |

**REMOVAL_TRIGGER (per the repository's convention):** first of
(a) the successor mutation-control ACT lands, (b) `CAPTURE_INSUFFICIENT`,
(c) successor evidence supersedes this ACT. On removal, the directory
`apps/vscode/src/sdk/control-seam/`, the four `SdkController.ts` sites,
and the evidence directory MUST be removed TOGETHER.

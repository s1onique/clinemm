# C3 — Production seam source map (fork vs upstream)

ENTRY_HEAD=6bdc07c8d2651bfb93331552342f2912697dc406  UPSTREAM_HEAD=a6507a62a147db4a35e27f4294589742ccac5060  MERGE_BASE=48d63852745460ff0fa3dfcc0457bbe2493841de

## CLI — --json / one-shot / --zen / resume / status / event-stream / send / cancel

| Concern | Fork path | Upstream path | Same? |
|---|---|---|---|
| CLI arg surface | `apps/cli/src/commands/program.ts` (`.option("--json")` L32; `-z,--zen` L54; `--thinking` L37) | `apps/cli/src/commands/program.ts` (`.option("--json")` L~30; `-z,--zen` L62; `--thinking` L41; `-y,--yolo` L29) | MODE PARITY. Fork lacks upstream `-y,--yolo` **description rewrite** and upstream `--thinking` help text says "or the provider default" vs fork "leaves provider default" — semantic difference in the **default-resolution** rule, must be diffed at `resolveReasoningEffort` level, not by label. |
| one-shot dispatch | `apps/cli/src/main.ts` → `runAgent()` (`apps/cli/src/runtime/run-agent.ts:134`) | same shape (`apps/cli/src/main.ts` → `runAgent`) | SHAPE PARITY (fork main.ts 1243 lines vs upstream 1248) |
| `--json` event emission | `run-agent.ts` L51/L72/L81/L364/L381/L402 → `emitJsonLine("stdout", {type:...})` | same | PARITY |
| `--zen` (hub background dispatch) | `apps/cli/src/runtime/run-zen.ts:28 runZen()` — hub fire-and-forget, NO stream subscription, completion via hub `ui.notify` | `apps/cli/src/runtime/run-zen.ts:13-179 runZen()` — same contract PLUS `ZEN_DISCOVERY_ACK_TIMEOUT_MS` ack timeout (L147) | FORK PARITY, upstream adds dispatch-ack timeout + `--data-dir`/`CLINE_SESSION_BACKEND_MODE=local` guards. Upstream ack-timeout is an INTEGRATE candidate. |
| resume by id | `apps/cli/src/main.ts` L742/750/839/841/1205 (`--id <session-id>`) | same L727/735/833/835/1210 | PARITY |
| fork-only CLI surface | `apps/cli/src/runtime/command-policy-host.ts`, `apps/cli/src/runtime/interactive/approvals.ts`, `apps/cli/src/kanban-migration/`, `apps/cli/src/commands/kanban.ts`, `apps/cli/src/commands/skill.ts`, `apps/cli/src/commands/connect.ts`, `apps/cli/src/acp/`, `apps/cli/src/tui/` | upstream has `connect.ts` too (different impl) | FORK-ONLY approvals/policy + kanban/skills/tuistory |

## Hub — session start / attach / send / cancel / approval / history

| Concern | Fork path | Upstream path | Same? |
|---|---|---|---|
| hub session server | `apps/cline-hub/src/server/sessions.ts` (483 lines): `resolveLaunchContext:43`, `selectSession:188`, `createSession:207`, `sendMessage:264`, `deleteSession:284`, `resetPeer:307`, `abortPeerTurn:323`, `forkPeerSession:337`, `restorePeerSession:412`, `initializePeer:471` | IDENTICAL FILE SET (28 files, same names) | **STRUCTURAL PARITY** — upstream hub server is NOT forked; only 11 upstream commits touch apps/cline-hub and none conflict. |
| hub event fan-out | `apps/cline-hub/src/server/agent-events.ts` (194 lines) | same | PARITY. Upstream `94980446c99` stops forwarding per-chunk stream events to remote onEvent hooks (a behaviour change to verify against fork event cardinality). |
| hub client (attach primitive) | `sdk/packages/core/src/hub/client/session-client.ts` (858 lines): `startRuntimeSession:340`, `sendRuntimeSession:408`, `stopRuntimeSession:431`, `abortRuntimeSession:437`, `getSession:459`, `readMessages:473`, `restore:495`, `listSessions:589`, `searchSessions:602`, `deleteSession:614`, `respondToolApproval:626`, `streamEvents:641`, `streamTeamProgress:666`, schedules CRUD `686-794`, tasks `794+` | upstream 856 lines, same names | **PARITY (2-line delta)** — the fork's client ALREADY exposes every primitive the MCP server needs. |
| hub transport | `sdk/packages/core/src/hub/client/index.ts`: `HubTransportError:204`, `isHubReconnectableTransportError:215`, `HubCommandError:221`, `isHubCommandTimeoutError:232`, `NodeHubClient:294`, `case "reply"/"event"/"command"/"stream.subscribe"/"stream.unsubscribe"` L802/815/840-842, `hasActiveHubSessions:986` | upstream adds `connection-headers.test.ts`, `plugin-commands.ts`, `proxy.test.ts`, TLS fixtures | UPSTREAM ADDITIVE (TLS/proxy/remote-hub auth) — INTEGRATE candidates. |

## SDK Core — runtime / session / attach / cancel

| Concern | Fork path | Upstream path | Same? |
|---|---|---|---|
| core facade | `sdk/packages/core/src/ClineCore.ts` (831 lines): `start:291`, `restore:567`, `subscribe:643`, `subscribeRecoveryStateChange:656`, `subscribeRuntimeEvents:676`, `readDisplayMessages:543`, `compareCheckpoint:592`, `getActiveRuntimeSnapshot:707`, `captureHostOwnershipFacts:786` | upstream 705 lines, same method names | **PARITY** (fork adds 126 lines of host-ownership/trace). `captureHostOwnershipFacts` is FORK-ONLY and is the C9/BCB/host-ownership anchor. |
| runtime host | `sdk/packages/core/src/runtime/host/local-runtime-host.ts` (3298 lines): `startSession:581`, `restoreSession:1210`, `runTurn:1243`, `getAccumulatedUsage:1400`, `abort:1410`, `proceedWhileRunning:1442`, `stopSession:1452`, `getSession:1509`, `getActiveRuntimeSnapshot:1548`, `captureHostOwnershipFacts:1651`, `listSessions:1664`, `readSessionMessages:1932`, `readLiveSessionMessages:1912`, `dispatchHookEvent:1945`, `subscribe:1961` | upstream 3038 lines | FORK-ADDITIVE. CONFLICTED file — must be **fork-preserving merge**, not upstream-wins. |
| orchestrator | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | CONFLICTED | fork-preserving merge required |
| pending prompt (BCB admission) | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` | CONFLICTED | fork-preserving merge required (BCB prompt admission) |
| compaction | `sdk/packages/core/src/extensions/context/compaction.ts` (1041 lines) | upstream 829 lines, 5 upstream commits (cb0092e34 actual-input-token trigger, 43a976d93 re-compaction estimate, d4d3d9f31 current credentials, 005ad4f6d unknown model limits, 79bf1e8c4 imported sessions) | fork has working-context authority; upstream adds token-accuracy. **ADAPT** upstream token trigger into the fork working-context authority. |
| artifact publishing | ABSENT in fork | `sdk/packages/core/src/artifacts/publish.ts` (196 lines), `artifacts/cloud/publish.ts` (204), `artifacts/cloud/fetch.ts` (95), `artifacts/cloud/download-url.ts` (20) — upstream commits `07ce8b83248` + `46996c9992` | **UPSTREAM ADDITIVE** → directly serves `get_artifacts` in the MCP surface. No conflict. |

## VS Code — Elm/TS/React authority, C9/C10, BCB, approvals

| Concern | Fork path | Upstream path | Same? |
|---|---|---|---|
| session event coordinator | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` **5115 lines** | upstream **316 lines** | **FORK IS 16x UPSTREAM.** CONFLICTED. Upstream's 316-line file is upstream's own simplified coordinator; adopting it would DESTROY the Elm/C9/C10/BCB projection. **P0 REJECT upstream-wins here.** |
| Elm authority | `apps/vscode/elm/{background-notify-authority,completion-authority}/**` (~40 files + `.sha256` sidecars); `apps/vscode/src/sdk/task-header-elm-authority.ts` (132 lines) | **ABSENT** | FORK-ONLY. Upstream has zero `elm` tokens in webview. |
| C9/C10 | `SdkController.ts` (C9 L920, C10 L1561/2005/2010/2814/2846-2876), `background-notify-coordinator.ts` (L480/577/676/693) | **ABSENT** | FORK-ONLY |
| BCB | `bcb-observation-unavailable-capture-runtime.ts`, `blocked-recovery-projection.ts`, `command-job-manager.ts`, `command-status-tool.ts`, `completion-continuation-upstream-runtime.ts` | **ABSENT** | FORK-ONLY |
| approvals / run_commands | `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | upstream has the file WITHOUT fork approval authority | CONFLICTED — fork-preserving |
| terminal execution mode | fork has BOTH `vscode-terminal-execution-mode.ts` and `sdk-terminal-execution-mode-coordinator.ts` | upstream deleted the coordinator in `29d66f6fbcd` (Reset-Code gating) | **modify/delete CONFLICT.** Upstream deleted it because upstream folded terminal mode into `sdk-task-control-coordinator.ts`. Fork must re-derive: either keep the coordinator and re-project upstream's Reset-Code gate onto it, or accept the deletion ONLY if the fork's terminal-mode authority (post-terminal-authority-diagnostic-*.ts, sdk-terminal-execution-mode-coordinator.test.ts) is re-hosted. **Treat as P0 until re-hosted.** |
| webview task header | `webview-ui/src/components/chat/task-header/{TaskHeader.tsx,TaskHeader.test.tsx,ContextWindow.tsx}` | upstream versions exist, no Elm projection | CONFLICTED (TaskHeader.test.tsx is **add/add** — both sides created it). Fork's is Elm-projected; upstream's is not. Fork-preserving. |

## Tool / provider seams

| Concern | Fork path | Upstream path | Same? |
|---|---|---|---|
| editor executor | `sdk/packages/core/src/extensions/tools/executors/editor.ts` **425 lines** + `edit-target-resolution.ts` (realpath) + `edit-observation.ts` (39.8 KB) + `edit-checkpoint-registry.ts` + `edit-write-verification.ts` | upstream `editor.ts` **268 lines**, **NO** edit-target-resolution / edit-observation / edit-checkpoint-registry | **FORK IS THE AUTHORITY.** Upstream's only change to editor.ts in-range is `2f0f78bb8e` (better `old_text===null` error message) — an INTEGRATE candidate that must be applied INSIDE the fork's error path. Upstream `03ffa9ec3` schema preprocess (null→undefined) conflicts with the fork's `z.string().nullable().optional()` — ADAPT, do not substitute. |
| MiniMax reasoning routing | `sdk/packages/llms/src/providers/routing/minimax-thinking.ts` — M3 + **M3.1-Flash** (`minimax-m3.1-flash`, `minimax/minimax-m3.1-flash`, **`MiniMax-M3.1-Flash`**) with effort ladder `low\|medium\|high\|xhigh\|max` | upstream routes **only `MiniMax-M3`** with a `thinking` toggle; **NO M3.1, NO effort ladder** | **FORK-ONLY authority.** Upstream portable-reasoning rewrite is NOT a substitute. |
| portable reasoning | fork `portable-reasoning.ts` uses `NATIVE_REASONING_OPTION_PROVIDERS` provider-ID sets + a `minimax-thinking` format check | upstream rewrites to a model-facts/capability model (`getModelReasoningControls`, `snapToAdvertisedEffort`, `fitDisableToModel`, `VERBATIM_REASONING_ADAPTERS`, `LOWEST_LEVEL_DISABLE_ADAPTERS`, `reconcilePortableReasoning`) | **DIFFERENT SEMANTICS.** Upstream drops the native-option guard that keeps MiniMax/OpenRouter reasoning inside providerOptions. Adopting upstream verbatim would silently change the MiniMax M3.1 None/low wire. **ADAPT upstream model-facts into the fork native-option guard.** |
| provider error classification | `sdk/packages/llms/src/providers/error-classification.ts` 294 lines | upstream 462 lines (`722b640c28` transient classification) | UPSTREAM ADDITIVE → INTEGRATE |
| model catalog | `sdk/packages/llms/src/catalog/catalog.generated.ts` | CONFLICTED; upstream refreshes (`31b0dd9900`, `82b8e1fa04`, `0a01d42ee1` apiProtocol) | **REGENERATE, do not hand-merge.** Re-run the generator, then re-apply the fork M3.1 entries. |
| request capture (wire proof) | `sdk/packages/llms/src/providers/provider-request-capture.ts` | absent upstream | FORK-ONLY provenance (needed for M3.1 exact-ID wire proof) |

## External-supervisor attach feasibility (C3)

**Answer: YES, without duplicating execution — using the EXISTING seams.**

- `HubSessionClient.startRuntimeSession` (`sdk/packages/core/src/hub/client/session-client.ts:340`) is the attach primitive; `sendRuntimeSession:408` sends into an existing session; `abortRuntimeSession:437` cancels; `respondToolApproval:626` answers approvals; `streamEvents:641` subscribes to the event stream; `readMessages:473` reads history; `restore:495` replays.
- `ClineCore.restore` (`sdk/packages/core/src/ClineCore.ts:567`) + `LocalRuntimeHost.restoreSession` (`local-runtime-host.ts:1210`) restore an already-running session after the supervisor process exits, and `subscribe:643` / `subscribeRuntimeEvents:676` re-attach the event stream.
- The Hub daemon is the durable owner (`apps/cline-hub/src/server/sessions.ts` `createSession:207`), so the supervisor process dying does NOT kill the run.
- Therefore `clinemm_start_act`, `get_run`, `read_events`, `send_feedback`, `cancel_run`, `get_artifacts`, `capabilities` must be **thin adapters over `HubSessionClient` + `ClineCore` + the new upstream `sdk/packages/core/src/artifacts/`** — NOT new internal subsystems. This is the C3 conclusion that constrains U02.

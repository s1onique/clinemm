# 01-static-recon.md — FINALIZATION-TOOL-SURFACE-LIVE01

Per reviewer's STANDING RULE: STATIC RECON FIRST, LIVE CAPTURE SECOND.

## Discriminator chain (reviewer B0..B6)

| Boundary | Status | Evidence |
|---|---|---|
| B0 installed artifact contains `0a5369661` consumer fix | **PASS** | VSIX sha `273f5d5155efb0560ed4b9459151074c996b494f5a2f9b4d0737d90f01d47f1b` built from `7cbca60b0`; `git merge-base --is-ancestor 0a5369661 7cbca60b0` returns 0. Fix is in source. |
| B1 `commandJobManager_present` at runtime-builder seam | **PASS** | `apps/vscode/src/sdk/vscode-session-host.ts:276` instantiates `new CommandJobManager(...)` unconditionally inside the `if (getTerminalManager)` block. |
| B2 `command_status_created` at runtime-builder seam | **PASS (code)** | `apps/vscode/src/sdk/vscode-runtime-builder.ts:270-282`: gated by `if (options.commandJobManager)`, pushes `createCommandStatusTool(options.commandJobManager, ...)` (name `command_status`, confirmed at `command-status-tool.ts:139`). |
| B3 tool policy enables `command_status` | **PASS (default)** | `apps/vscode/src/sdk/sdk-tool-policies.ts:60-75`: `set()` calls list `read_files`, `editor`, `run_commands`, `execute_command`, `cancel_command`, `fetch_web_content`, etc. **`command_status` is not in any `set()` call** — it falls through to the SDK default policy (enabled, autoApprove). Per reviewer note: unlisted = enabled; `{enabled:false}` would remove visibility but no such entry exists. |
| B4 `AgentRuntime.tools` contains `command_status` | **PASS (unconditional registration)** | `sdk/packages/agents/src/agent-runtime.ts:1422-1423`: `for (const tool of this.config.tools ?? []) { this.tools.set(tool.name, tool); }` — no policy filter at registration. |
| B5 provider-bound tools contain `command_status` | **PASS (no policy filter at request build)** | `sdk/packages/agents/src/agent-runtime.ts:1904-1908`: `tools: [...this.tools.values()].map(...)` — every tool in the Map is sent to the provider. The `beforeModel` hook chain (`session-runtime-orchestrator.ts:198-225`) only narrows the tool list if a sub-hook returns `result.tools`; none of the registered production hooks (`checkpoint-hooks`, `hook-file-hooks`, orchestrator-198, orchestrator-1114) appear to filter by tool name. |
| B6 model invokes `command_status` at runtime | **PENDING (live capture required)** | The only remaining boundary. Cannot be observed from static analysis — needs operator capture. |

## Single production call site

`createVscodeExtraTools(...)` is called from exactly one production site:
`apps/vscode/src/sdk/vscode-session-host.ts:383-431`.

The tools array reaches `ClineCore.create({...})` via `extraTools` config and is
consumed by `LocalRuntimeHost` at `sdk/packages/core/src/runtime/host/local-runtime-host.ts:779`:
```ts
const tools = [...runtime.tools, ...(configWithProvider.extraTools ?? [])];
```

## Hypothesis discrimination after static recon

| Hypothesis | Static verdict |
|---|---|
| A `STALE_DOGFOOD_ARTIFACT` | **REFUTED** — `0a5369661` is ancestor of `7cbca60b0`, the named commit for the live-witness VSIX. |
| B `COMMAND_JOB_MANAGER_MISSING` | **REFUTED** — `CommandJobManager` instantiated unconditionally at `vscode-session-host.ts:276`; threaded to `createVscodeExtraTools` at line 391. |
| C `DIFFERENT_RUNTIME_BUILDER` | **REFUTED** — only one production call site (`vscode-session-host.ts:383`). Finalization continuation uses the same `VscodeSessionHost.create` path as the foreground. |
| D `TOOL_POLICY_FILTER` | **REFUTED** — `command_status` is unlisted in `buildToolPolicies`; SDK default = enabled. |
| E `TOOL_LOST_IN_AGENT_RUNTIME` | **REFUTED at registration (B4 PASS)** and **REFUTED at provider-bound (B5 PASS)** by static chain. |
| F `TOOL_AVAILABILITY_CLAIM_CONTRADICTED` (reviewer B6) | **OPEN — live capture required.** Static chain is unbroken; only an actual run can confirm the model received and can invoke the tool. |

## What the live capture must produce

- `runtime_builder_tool_names` (the set returned by `createVscodeExtraTools` for
  the finalization-turn session)
- `agent_runtime_tool_names` (the keys of `AgentRuntime.tools` Map)
- `provider_bound_tool_names` (the `request.tools` set sent to the model API)
- `commandJobManager_present` boolean at runtime
- `command_status_created`, `command_status_policy_enabled`, `command_status_provider_visible`

All five can be observed from a single probe of the running extension host
via the debug-harness.

## Artifact identity (for traceability)

| Field | Value |
|---|---|
| `VSIX_SHA256` | `273f5d5155efb0560ed4b9459151074c996b494f5a2f9b4d0737d90f01d47f1b` |
| `INSTALLED_VERSION` | `4.1.16` (apps/vscode/package.json) |
| `VSIX named commit` | `7cbca60b0` (test(vscode): replace BCCA eval probe with createRequire) |
| Live witness sessionId | `1790544756725_zx4dj` (PPRD01 red) and `1790545638594_95udl` (FINALIZATION turn) |
| Live witness epoch | `1790544756725` and `1790545638594` |
| VSIX mtime (epoch) | `1790543924` (before both witness sessions) |
| Source HEAD at VSIX build time | `7cbca60b0` |
| Source HEAD now | `82c3a6c91` |
| Commits between VSIX source and HEAD | 3 (the PPRD01 ACT closure + the FINALIZATION evidence-count update) |

## Static-recon falsifiability

If a fresh `dist/dogfood/clinemm-4.1.16-{NEW_HEAD}.vsix` rebuilt from HEAD
still misses `command_status` in the live runtime, then hypothesis A would
need to be revisited with a *new* intermediate commit in HEAD that re-introduces
the bug. The current 3-commit HEAD delta (PPRD01 + FINALIZATION evidence) is
documentation-only and cannot re-introduce a code regression.

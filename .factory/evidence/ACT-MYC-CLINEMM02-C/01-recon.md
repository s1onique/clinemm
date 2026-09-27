# ACT-MYC-CLINEMM02-C — Recon (ClineMM lifecycle seams + real myc API)

## A1. ClineMM lifecycle seams (REAL, from source)

### RUN_START_SEAM
`apps/vscode/src/sdk/sdk-session-lifecycle.ts:300-441 SdkSessionLifecycle.startNewSession(startInput, opToken)`
- Calls `sdkHost.start(...)` (production: `VscodeSessionHost.start(...)`).
- That runs `ClineCore.start(input)` (`sdk/packages/core/src/ClineCore.ts:291-335`) which calls `await this.prepare?.(clineCoreInput)` BEFORE any host call.
- The `prepare` hook returns a `StartSessionBootstrap` whose `applyToStartSessionInput` is allowed to mutate the input (`vscode-session-host.ts:447-454` is the current wiring).

### RUN_RESUME_SEAM
Resume does NOT run `ClineCore.start`. It goes through `LocalRuntimeHost.restore(...)` (`sdk/packages/core/src/runtime/host/local-runtime-host.ts`) or `replaceActiveSession(...)`. The `prepare` hook is **not** invoked on resume.

### RUN_TERMINAL_SEAM
- `SdkSessionLifecycle.endActiveSession(reason, {awaitStop})` (`sdk-session-lifecycle.ts:254-275`).
- → `trackSessionStop(sdkHost, sessionId, reason)` (`sdk-session-lifecycle.ts:591-622`) which `Promise.all`s `sdkHost.stop(sessionId)` and `mcpHub.disconnectSession(sessionId)`.
- Agent-runtime `afterRun` (`sdk/packages/agents/src/agent-runtime.ts:1805-1809`) fires for completed/aborted/errored status. **CAUTION: `afterRun` fires for every terminal status, not only success.**

### AgentRuntime.beforeRun / afterTool
- `beforeRun`: `agent-runtime.ts:1796-1803` — iterates `this.hooks.beforeRun`. Called from `execute()` at `agent-runtime.ts:1535` BEFORE `run-started` event and BEFORE the first iteration. Hook receives `{ snapshot: AgentRuntimeStateSnapshot }`.
- `afterTool`: `agent-runtime.ts:3360-3385` — iterates `this.hooks.afterTool` once per tool call (in `executePreparedTool`). Hook receives `{ snapshot, tool, toolCall, input, result, startedAt, endedAt, durationMs }`. `result.isError` is available.
### CANONICAL_TRANSCRIPT_SOURCE
Per-session task messages live in Cline's file-backed task store under `~/.cline/data/tasks/<taskId>/`. The runtime state holds the live in-memory `state.messages[]` array. There is NO single canonical transcript export API exposed to hooks.

### CANONICAL_TRANSCRIPT_PERSIST_SEAM
Persisted through the SdkController/state-post pipeline. No single observable hook seam.

### COMPACTION_DECISION_SEAM / COMPACTION_INPUT_SEAM / COMPACTION_OUTPUT_SEAM / COMPACTION_ARTIFACT_SEAM
- Decision + input: `prepareTurn` callback (config-driven). See `agent-runtime.ts:1827-1856` (overflow-recovery) and `prepareTurnForModelRequest` (~line 2440) which mutates the `request.messages` and `systemPrompt`.
- Output: `{ messages?, systemPrompt?, currentWorkingContextEstimate? }` (provider-bound projection).
- Artifact: `${sessionId}.compaction.json` (file-backed via persistence service).
- **Compaction is owned by core**; canonical session history is kept at full fidelity separately from the latest compacted state. The compaction projection is provider-only.

### TOOL_SUCCESS_SEAM
`AgentAfterToolContext` in `agent-runtime.ts:754-763` carries `result.isError`. **CAUTION: a tool can report `isError: false` even when the underlying durable edit failed** (e.g. partial write or post-write validation error). Cannot treat as "file was durably edited".

### FILE_EDIT_SUCCESS_SEAM
NO dedicated seam. Distinguishing durable file-edit success from non-edit tool success requires inspecting tool name + result shape. **NOT a clean observability seam.**

### WORKSPACE_ROOT_SEAM
- `input.config.cwd` (canonical session-start input).
- `prepareStartSessionInput` (`vscode-session-host.ts:359`) reads `inputWithRemoteConfig.config.cwd`.
- `StateManager.getWorkspacePath()` is the host-owned workspace root (typically equal to `cwd` for a non-multi-root workspace).

### SESSION_ID_SEAM
TWO layers, both real:
- **Host-owned session id**: `CoreSessionConfig.sessionId` (canonical for our purposes). Set by `sdk-task-start-coordinator.ts:246 createSessionId()` BEFORE `startNewSession`. Threaded through `input.config.sessionId` to `prepareStartSessionInput` → `createVscodeExtraTools(mcpHub, { sessionId })`.
- **Agent-runtime conversation id**: `AgentRuntimeStateSnapshot.conversationId` (created by `LocalRuntimeHost.startSession`). Different scope; not what we want.


## A2. Real myc CLI + MCP API

### `myc prime` (EXISTS, REAL)
- CLI ✓ — `myc prime [args] [flags]`
  - Flags: `--budget <number>`, `--role agent|leader|human`, `--format agent|md|json`, `--session <string>` (default `$MYC_SESSION_ID`/`$CLAUDE_SESSION_ID`), `--repo <string>`, `--focus <string>`.
- MCP ✓ — `mcp prime` is on the `agent` profile tool surface (verified by `myc mcp --help` listing 13 tools, of which `prime` is one).
- **SESSION_ID_IMPLICIT_VIA_ENV = true**: prime reads `$MYC_SESSION_ID` from the spawned child's `process.env` (per the CLI help text "default $MYC_SESSION_ID/$CLAUDE_SESSION_ID").
- Output: text suitable for model context (default `--format agent`).

### `myc absorb` (EXISTS, CLI only)
- CLI ✓, MCP ✗. Drains jobs queue or classifies one node. **CALLABLE_VIA_MCP = false.**
- Used for post-write housekeeping, not as a real-time session-start hook.

### `myc absorb-session` (EXISTS, CLI only)
- CLI ✓, MCP ✗. Takes `--transcript <path>|-`, `--reason compact|auto|manual|stop`, `--agent`, etc.
- **Transcripts are read from a file path** (`--transcript`), not from the live runtime state. **The canonical Cline transcript is in file-backed task storage** but the runtime-side surface for "give me the canonical transcript for this session" is not exposed at any hook seam.
- **CALLABLE_VIA_MCP = false.** No MCP path.
- Classification: **DEFERRED** — no MCP path; transcript source unclear at hook seam.

### `myc anchor touch` (EXISTS, CLI only)
- CLI ✓, MCP ✗. Fire-and-forget; appends one line per file to `.myc/anchor-dirty.log`. **No args.**
- **CALLABLE_VIA_MCP = false.**
- Classification: **DEFERRED** — CLI-only AND we cannot observe "which files were durably edited" from the runtime hook seam without invasive instrumentation.

### "close-session" operation
**ABSENT.** The closest candidates are:
- `myc close` (closes a TASK node, not a session).
- `myc review confirm/reject` (finalizes compaction candidates).
- None of these map to "this Cline session is going away".
- Classification: **DEFERRED** — no real operation exists.


## B. Lifecycle contract classification

| Operation | ClineMM seam | myc operation | Safe input | Classification |
|---|---|---|---|---|
| prime on session start | `SdkSessionLifecycle.startNewSession` after `this.activeSession = {...}` is installed (canonical session id known); `mcpHub.callTool("myc", "prime", args, ulid, signal, sessionId)` reaches the per-session child | `myc prime` (CLI) + `mcp prime` (MCP) | `sessionId` (canonical), `cwd` (workspace root), `repo` (slug or "all") | **SUPPORTED** |
| absorb on compaction | `prepareTurn` (core-owned) | `myc absorb-session` (CLI only — MCP does not expose this) | Transcript file path (unclear at hook seam) | **DEFERRED** |
| close-session on afterRun | `AgentRuntime.afterRun` | **No equivalent** | N/A | **DEFERRED** |
| anchor touch on afterTool | `AgentRuntime.afterTool` | `myc anchor touch` (CLI only) | File list (unobservable from `AgentAfterToolContext`) | **DEFERRED** |

Only the prime-on-session-start automation has BOTH a real ClineMM seam AND a real callable myc operation AND bounded observable inputs AND safe failure behavior.

## C. Prime automation cardinality

- `SdkSessionLifecycle.startNewSession` is the canonical "new session installed" seam. It fires exactly once per non-superseded session install.
- Resume does NOT go through `startNewSession`. It uses `replaceActiveSession` or `restore`. **Resume does NOT re-prime.** This is the desired behavior (one prime per session lifecycle).
- `replaceActiveSession` DOES call `startNewSession` (with `awaitStop: true`), so a mode/terminal/provider change that replaces the active session WILL re-prime. This is documented below as the C9 characterization row.
- The fence (`taskOperationFence`) inside `startNewSession` short-circuits superseded calls to `{status: "superseded"}` WITHOUT installing `this.activeSession`. A superseded call does NOT trigger prime.

## D. Prime result visibility

The `myc prime` tool returns a text payload that, in normal usage, is intended for the model's context. In ClineMM today there is NO built-in mechanism to inject arbitrary text into the model's initial context without changing the SDK's prepare-bootstrap contract (which is out of scope for this ACT).

Therefore, for this ACT the prime result is **only recorded for diagnostic observability** (state posting + Logger.warn). Making it model-visible is REQUIRES_SEPARATE_DESIGN (changing `StartSessionBootstrap` to accept `initialMessages` or threading through the `initialMessages` field on `ClineCoreStartInput`).

## E. Failure behavior choice

Selected: `DEGRADED_WITH_DIAGNOSTIC`.
- Logger.warn on any failure.
- Record `status: "failed" + error` on `ExtensionState.mycPrimeAutomation`.
- Session proceeds normally; no model-visible impact.
- Rationale: this is initial dogfood. A failure of the prime tool must not block the user's task.

## F. Why we are not implementing absorb / close-session / anchor-touch in this ACT

- **Absorb**: requires reading a canonical transcript file. The transcript lives in Cline's per-task storage (file-backed), and the runtime hook layer does NOT expose a "give me the canonical transcript" surface. Even if we built one, `myc absorb-session` is CLI-only (no MCP path), so the call would have to go through `child_process.spawn` (not the proven MCP transport). Two semantic gaps: which file? which agent? — both unresolved at the runtime seam.
- **Close-session**: no real `myc` operation maps to "this Cline session is going away". `myc close` closes a *task* node in the myc graph; the Cline `session` and the myc `task` are not the same identity. Implementing this would require inventing semantics, which is REQUIRES_SEPARATE_DESIGN.
- **Anchor-touch**: `AgentAfterToolContext` carries `toolName + result.output + result.isError`. It does NOT carry a list of files that were durably changed. The mapping from "tool call" to "files changed" is tool-specific (`write_to_file` → 1 file, `multi_edit` → N files, `apply_patch` → N hunks). Anchoring requires enumerating file paths and ranges post-facto; doing this from the runtime hook layer would require per-tool type-narrowing that we cannot audit in this ACT. CLI-only adds a second reason to defer.


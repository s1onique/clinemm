# 01 — Recon (ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01)

## Predecessor entry state

- **SW-CM04 → SW-CM01 → SW-CM02 → SW-CM03** all closed PASS at entry
  head `ab71b439f`. Working tree clean.
- **No prior ACT exists** for `MYC` / `CLINEMM02` / `MEMLAB`. This
  is the first ACT in the new `ACT-MYC-CLINEMM0*` sequence — the
  production thread dedicated to real ClineMM dogfood against real
  myc.
- The MYC thread is **NOT** the SW-CM sequence. SW-CM characterized
  the continuation substrate (skills, handlers, guides). This ACT
  opens a separate production track: making ClineMM an honest
  per-session client of an external session-aware MCP server (myc).
- DO NOT re-litigate any closed ACT unless new evidence contradicts.

## Why this ACT exists (one paragraph)

Real myc requires that **session = process authority**: each Cline
session that opens the myc MCP server must get a STDIO child
process unique to that session, with `MYC_SESSION_ID=<that-session-id>`
in its environment. Two concurrent Cline sessions must yield two
distinct child PIDs with non-leaking env. Today's ClineMM
architecture (one global `McpHub` per `SdkController`, no session
identifier reaching `StdioClientTransport.spawn`) cannot honor
this. This ACT introduces (a) a typed `fromSession:"sessionId"`
env-entry source additive to the existing
`record<string,string>` static env, (b) a session-scoped child
lifecycle that activates only when the resolved config actually
references session context, and (c) an adversarial qualification
matrix that proves isolation end-to-end inside the spawned child.

## Architecture decision (frozen — C1)

```
PER_SESSION_STDIO_CHILD_FOR_SESSION_BOUND_CONFIG_ONLY
```

Rationale (frozen by C1 review):

- **Authority boundary:** for session-bound MCP servers, the
  session IS the process. Sharing one global child and rebinding
  env on active session changes is mutable global state — exactly
  the authority ambiguity this codebase has spent many ACTs
  removing elsewhere (BackgroundNotifyCoordinator, BTCONT01,
  TQCB01, …). Rejected.
- **Boundedness:** the change is opt-in per-server-config. Servers
  whose `env` block contains no `fromSession` entry keep the
  existing global singleton lifecycle. No regression for ordinary
  MCP servers.
- **Static compatibility:** upstream Cline documents the flat
  `record<string,string>` env as the public contract. The new
  structured entries are additive (object form alongside string
  form), no migration required for existing user configs.

Identity key:

```
static server      => serverName                    (current behavior preserved)
session-bound      => serverName + sessionId        (new)
```

## ClineMM production seams (authoritative — current source)

### SESSION_MCP_ACQUISITION_SEAM (NEW — added per review)

**The load-bearing production caller that already has a sessionId
and will deliver it to `McpHub` is:**

```
apps/vscode/src/sdk/vscode-runtime-builder.ts:40-48
class McpHubToolProvider {
    async callTool(request: {
        serverName: string
        toolName: string
        arguments?: Record<string, unknown>
        context?: AgentToolContext
    }): Promise<unknown> {
        const ulid = `sdk-${Date.now()}-${Math.random()...}`
        return this.mcpHub.callTool(
            request.serverName, request.toolName,
            request.arguments ?? {}, ulid,
            request.context?.signal,           // <-- sessionId is here
        )                                      //     but currently DROPPED
    }
}
```

`AgentToolContext` is defined at
`sdk/packages/shared/src/agent.ts:387-396` and already carries:

```ts
export interface AgentToolContext {
    sessionId?: string       // <-- the discriminator we need
    agentId: string
    conversationId?: string
    runId?: string
    iteration: number
    toolCallId?: string
    signal?: AbortSignal
    metadata?: Record<string, unknown>
    // ... capability fields
}
```

The chain that populates `AgentToolContext.sessionId` at runtime
already exists end-to-end (verified):

```
CLI / API caller
  -> ClineCore / AgentRuntime            (sdk/packages/agents/src/agent-runtime.ts:2436)
    -> AgentToolContext { sessionId: this.config.sessionId }
      -> tool.execute(input, context)
        -> builtin tool handler
          -> vscode-runtime-builder.ts:47
            McpHubToolProvider.callTool({ serverName, toolName,
                                          arguments, context })
            (context.sessionId is RIGHT HERE, currently dropped)
              -> mcpHub.callTool(serverName, toolName, args, ulid, signal)
```

**Proof that `sessionId` is non-empty in production paths:**

- `agent-runtime.ts:2436`:
  `sessionId: this.config.sessionId`
- `agent-runtime.ts:1889-1891`:
  `agentId: this.state.agentId,
   conversationId: trimNonEmpty(this.config.conversationId),`
  (the parallel field-projection proves the projection pattern
  is already live)
- `sdk/packages/agents/src/runtime/routing/handler-tool-routing-evals01.swcm02.test.ts:88-133`
  shows that downstream consumers already extract
  `ctx.sessionId ?? ""` when observing tool calls — confirming
  the sessionId is present in the typed channel end-to-end.

**The seam is real, available, and the diff is small:**

```diff
// apps/vscode/src/sdk/vscode-runtime-builder.ts:47
- return this.mcpHub.callTool(
-     request.serverName, request.toolName, request.arguments ?? {},
-     ulid, request.context?.signal,
- )
+ return this.mcpHub.callTool(
+     request.serverName, request.toolName, request.arguments ?? {},
+     ulid, request.context?.signal,
+     request.context?.sessionId,         // NEW: forward sessionId
+ )
```

This means **A2A MUST include threading `request.context?.sessionId`
through `vscode-runtime-builder.ts:47` and `McpHub.callTool`
into `findConnection`**, NOT just adding a session-aware callee
without a production caller. Without this diff, A2A proves only
"the API supports session context", not "ClineMM uses it". With
this diff, A2A-15 is reachable end-to-end through the real
production acquisition path.

### SESSION_MCP_TEARDOWN_SEAM (NEW — added per C1 round-2 review)

**The load-bearing production caller that already tears down a
session and has `sessionId` available is:**

```
apps/vscode/src/sdk/sdk-session-lifecycle.ts:591-611
private trackSessionStop(sdkHost: SdkSessionHost,
                          sessionId: string,
                          reason: string): Promise<void> {
    const startedAt = Date.now()
    const stopPromise = sdkHost
        .stop(sessionId)                       // <-- production teardown
        .then(() => { ... })                   //     sessionId is here
        .catch((error) => { ... })             //     errors are swallowed
        .finally(() => { ... })                //     and logged (line 602)
    this.pendingStops.set(sessionId, stopPromise)
    return stopPromise
}
```

`SdkSessionLifecycle` is constructed at
`apps/vscode/src/sdk/SdkController.ts:1574-1575`:

```ts
this.sessions = new SdkSessionLifecycle({
    mcpHub: this.mcpHub,        // <-- the wiring is ALREADY in place
    telemetry: this.sdkTelemetry.telemetry,
    requestToolApproval: ...,
    askQuestion: ...,
    ...
})
```

and `SdkSessionLifecycleOptions.mcpHub: McpHub` is already
declared at `sdk-session-lifecycle.ts:29` (the lifecycle ALREADY
holds the `mcpHub` reference — today only via
`this.options.mcpHub`, line 379, for `buildToolPolicies`).

**The chain that tears down a session at runtime already exists
end-to-end (verified):**

```
CLI / API caller -> ClineCore / AgentRuntime
    -> Session completes / is replaced / is cleared
       (production callers — confirmed live):
         - sdk-followup-coordinator.ts:356
             "followupTargetChanged"      {awaitStop:true}
         - SdkController.ts:2527
             "remoteConfigToggle"         {awaitStop:true}
         - sdk-task-control-coordinator.ts:151
             "clearTask"                  default options
         - sdk-session-auto-approval-coordinator.ts:292
             "sessionAutoApprovalOverrideFailure"
                                          via clearActiveSession
       -> SdkSessionLifecycle.endActiveSession(reason, options)
          (sdk-session-lifecycle.ts:254-275)
          -> safeUnsubscribe(activeSession, reason)   // line 263
          -> trackSessionStop(activeSession.sdkHost,
                              activeSession.sessionId,
                              reason)                  // line 264
             -> sdkHost.stop(sessionId)               // line 594
                -> VscodeSessionHost.stop (line 599)
                   -> ClineCore.stop(sessionId)
                   -> LocalRuntimeHost._removeSession
                      (sdk/packages/core/src/runtime/host/
                       local-runtime-host.ts:1347-1349)
```

`sessionId` is unambiguously available at the teardown seam:
`activeSession.sessionId` is the typed `string` field on the
`ActiveSession` reference (set when the session was created).

**Why this is the right seam (not `sdkHost.stop` alone):**

`sdkHost.stop(sessionId)` already runs the canonical session
teardown (LocalRuntimeHost disposes its runtime, clears its
subscription map, etc.). But it does NOT know about per-session
MCP children, because per-session MCP child ownership is a
*McpHub* concern (the hub is shared across sessions; the host
is per-session).

So the **right separation of concerns** is:

```
SessionLifecycle end
    -> sdkHost.stop(sessionId)         # tears down the SDK runtime
       AND IN PARALLEL
    -> mcpHub.disconnectSession(sessionId)
       # tears down per-session MCP children only
```

Both are reached from one canonical site
(`SdkSessionLifecycle.trackSessionStop`) and both are awaited by
the same `pendingStops` machinery — preserving the existing
wedge-free teardown ordering.

**The diff is small and additive:**

```diff
// apps/vscode/src/sdk/sdk-session-lifecycle.ts:591-611
 private trackSessionStop(sdkHost: SdkSessionHost,
                          sessionId: string,
                          reason: string): Promise<void> {
     const startedAt = Date.now()
-    const stopPromise = sdkHost
-        .stop(sessionId)
+    // ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01: also
+    // tear down per-session MCP children owned by this
+    // sessionId. McpHub is shared; the session lifecycle is
+    // the canonical "session is going away" site.
+    const mcpHubDisconnect = this.options.mcpHub
+        .disconnectSession(sessionId)
+        .catch((error) => {
+            Logger.warn(
+                `[SdkController] MCP disconnectSession(${sessionId}) ` +
+                `failed (${reason}):`, error)
+        })
+    const stopPromise = Promise.all([
+        sdkHost.stop(sessionId),
+        mcpHubDisconnect,
+    ]).then(() => { ... })
         .catch((error: unknown) => {
             Logger.warn(
                 `[SdkController] Failed to stop SDK session ` +
                 `${sessionId} (${reason}):`, error)
         })
         .finally(() => {
             if (this.pendingStops.get(sessionId) === stopPromise) {
                 this.pendingStops.delete(sessionId)
             }
         })
     this.pendingStops.set(sessionId, stopPromise)
     return stopPromise
 }
```

`mcpHub.disconnectSession(sessionId)` is the new public method
introduced in Phase 3 of `plan.md`; the production caller above
is the only place where it must be invoked from the *production*
code path. Internal callers in test/code paths remain direct
`connectToServer` / `disconnectSession` API.

**Compaction-coordinator path (also covered):**

`sdk-compaction-coordinator.ts:341-343` already has:

```ts
if (sessionId) {
    await sdkHost.stop(sessionId)
}
```

This is a temp-host path (the compaction host is a fresh
VscodeSessionHost with its own sessionId). After this stop,
the same `mcpHub.disconnectSession(tempSessionId)` should be
called to clean up that temp session's per-session children.
The simplest implementation is a single private method
`tearDownSession(sdkHost, sessionId, reason)` that does both,
called from both `trackSessionStop` and the compaction
coordinator. This keeps a single canonical seam.

**Test contract (A2A-16):** drive the real production teardown
seam (`SdkSessionLifecycle.endActiveSession("test")` →
`trackSessionStop` → `mcpHub.disconnectSession(A)`). Confirm:
A child terminated (PID dead); A's session map entry removed;
B PID unchanged; B's `whoami` still succeeds. **A2A-16 is to
A2A-13 what A2A-15 is to A2A-04:** the unit/lifecycle test
(A2A-13) proves the API works; A2A-16 proves ClineMM actually
calls it on session teardown.

### SESSION_MCP_DISCOVERY_SEAM (NEW — added per C1 round-3 review)

The two prior rounds closed the **acquire** path
(`McpHubToolProvider.callTool(request)` →
`request.context.sessionId`) and the **release** path
(`SdkSessionLifecycle.trackSessionStop` →
`mcpHub.disconnectSession(sessionId)`). Neither proves that
the session-bound server's **tool schema** is visible to the
model before `callTool` is ever invoked. With deferred startup,
`server.tools` is `[]` for every session-bound server, so
`McpHubToolProvider.listTools(serverName)` returns `[]`, so
`createMcpTools({ serverName, provider })` produces zero
`AgentTool`s, so the session's runtime never sees `whoami` —
and A2A-15 can never fire because the model has nothing to call.

The deferred-startup decision creates one new production seam
that must thread `sessionId`:

```
SESSION_MCP_DISCOVERY_SEAM =
  apps/vscode/src/sdk/vscode-session-host.ts:359
  prepareStartSessionInput(input: ClineCoreStartInput)
    .createVscodeExtraTools(options.mcpHub, { cwd, ... })  # vscode-runtime-builder.ts:124
      .for each server in mcpHub.getServers():
          createMcpTools({ serverName, provider })          # vscode-runtime-builder.ts:129
            .provider.listTools(serverName)                 # McpHubToolProvider.listTools:22
              .mcpHub.getServers()                          # cached snapshot
              .server.tools ?? []                           # CACHED — populated only by connectToServer.fetchServerCapabilities
```

**Why this seam already has sessionId (no new wiring required):**
`prepareStartSessionInput` is called from inside
`ClineCore.start({...startInput})`. The session lifecycle
(`apps/vscode/src/sdk/sdk-session-lifecycle.ts:366`) reads the
sessionId off the input it already had:

```ts
const requestedSessionId = startInput.config?.sessionId?.trim()
```

`startInput.config.sessionId` flows directly into
`input.config.sessionId` at the prepare hook, because
`ClineCoreStartInput.config` extends `StartSessionConfig` which
extends `RuntimeSessionConfig` which extends `CoreSessionConfig`,
and `CoreSessionConfig.sessionId?: string` is documented as the
host-owned id (`sdk/packages/core/src/types/config.ts:259-268`).
So at the moment `prepareStartSessionInput` runs, the
**sessionId of the session being built is already on
`input.config.sessionId`** — no synchronous RPC, no
`getActiveSession()`, no race. The `startInput` originates
from `SdkSessionLifecycle.startNewSession(startInput, token)`
which is invoked from `SdkController.initTask` (or
`SdkFollowupCoordinator.resumeSessionFromTask`), and at every
production callsite the caller populates `config.sessionId`
either with `taskSessionId = createSessionId()`
(`sdk-task-start-coordinator.ts:148`) or with an existing
session id from the followup intent.

**Required diff at the discovery seam** (small, additive, no
production-callersite expansion):

```diff
 # apps/vscode/src/sdk/vscode-session-host.ts:359
 const prepareStartSessionInput = async (input: ClineCoreStartInput) => {
     await options.beforeStartSession?.()
     const remoteConfigIntegration = options.getRemoteConfigIntegration?.()
     const inputWithRemoteConfig = remoteConfigIntegration
         ? await remoteConfigIntegration.applyToStartSessionInput(input)
         : input
+    const sessionIdForMcp = inputWithRemoteConfig.config.sessionId?.trim()
     const requestedTerminalExecutionMode = StateManager.get().getGlobalStateKey("vscodeTerminalExecutionMode")
-    const extraTools = await createVscodeExtraTools(options.mcpHub, { ... })
+    const extraTools = await createVscodeExtraTools(options.mcpHub, {
+        ...,
+        sessionId: sessionIdForMcp,             # NEW: thread the building session's id
+    })
     return { ... }
 }
```

```diff
 # apps/vscode/src/sdk/vscode-runtime-builder.ts:51
 export interface VscodeExtraToolsOptions {
     cwd?: string
+    /**
+     * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01: when a
+     * Cline session starts, the runtime builder hands the
+     * session-bound `McpHubToolProvider` the sessionId of the
+     * session being built so deferred session-bound servers
+     * can materialize their per-session child for `tools/list`
+     * (and thus populate `server.tools`) BEFORE the model's
+     * first tool call. This is the production **discovery**
+     * counterpart to the **acquisition** seam (callTool) and
+     * the **release** seam (disconnectSession). When omitted,
+     * the builder falls back to the existing global-only
+     * discovery path (preserves static-compat).
+     */
+    sessionId?: string
     ...
 }
```

```diff
 # apps/vscode/src/sdk/vscode-runtime-builder.ts:124
-export async function createVscodeExtraTools(mcpHub: McpHub, options?: VscodeExtraToolsOptions): Promise<AgentTool[]> {
-    const provider = new McpHubToolProvider(mcpHub)
+export async function createVscodeExtraTools(mcpHub: McpHub, options?: VscodeExtraToolsOptions): Promise<AgentTool[]> {
+    const provider = new McpHubToolProvider(mcpHub, options?.sessionId)
```

```diff
 # apps/vscode/src/sdk/vscode-runtime-builder.ts:19
 export class McpHubToolProvider {
-    constructor(private readonly mcpHub: McpHub) {}
+    /**
+     * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01: when
+     * `sessionId` is provided, `listTools` materializes a
+     * per-session child for any deferred session-bound
+     * server BEFORE reading `server.tools`, so the model's
+     * first call has the schema in context. When omitted,
+     * behavior is unchanged: only global connections are
+     * visible (preserves static-compat).
+     */
+    constructor(
+        private readonly mcpHub: McpHub,
+        private readonly sessionId?: string,
+    ) {}

     async listTools(serverName: string): Promise<readonly McpToolDescriptor[]> {
-        const servers = this.mcpHub.getServers()
-        const server = servers.find((entry) => entry.name === serverName)
+        // Ensure per-session child exists for session-bound servers.
+        // For static configs this is a no-op (template.hasFromSession === false).
+        if (this.sessionId !== undefined) {
+            await this.mcpHub.ensureSessionConnection(serverName, {
+                sessionId: this.sessionId,
+            })
+        }
+        const servers = this.mcpHub.getServers()
+        const server = servers.find((entry) => entry.name === serverName)
         if (!server) {
             Logger.warn(`[McpHubToolProvider] Server not found: ${serverName}`)
             return []
         }
         return (server.tools ?? []).map(...)
     }

     async callTool(request: {...}) {
         const ulid = `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
-        return this.mcpHub.callTool(request.serverName, request.toolName, request.arguments ?? {}, ulid, request.context?.signal)
+        return this.mcpHub.callTool(
+            request.serverName, request.toolName,
+            request.arguments ?? {}, ulid,
+            request.context?.signal,
+            this.sessionId,            # NEW: session-bound routing for tools/call
+        )
     }
 }
```

**Static-compat guarantee (preserved):**
- When the host does not thread `sessionId` (Hub/Remote, CLI,
  legacy test harnesses, pre-ACT ClineMM desktop app), the
  new optional parameter is `undefined`. `listTools` skips
  `ensureSessionConnection`. `callTool` forwards `undefined`.
  Behavior is bit-equivalent to pre-ACT.
- Static MCP configs (no `fromSession` in env) reach the
  unchanged `connections.find(...)` path under the hood
  because `ensureSessionConnection` short-circuits when the
  template lacks `fromSession`.

**Production-callersite scoping (round-3 review tightening):**
- `vscode-runtime-builder.ts:124 createVscodeExtraTools` —
  thread `sessionId` (this is the discovery seam; **NEW**).
- `vscode-runtime-builder.ts:47 McpHubToolProvider.callTool` —
  thread `sessionId` (Phase 3b; already frozen).
- `sdk-session-lifecycle.ts:591 trackSessionStop` — thread
  `mcpHub.disconnectSession(sessionId)` (Phase 3c; already
  frozen).
- No other production caller expands. `SdkController`'s
  `initTask` is the ONLY upstream that produces a sessionId
  for the start input, and it ALREADY calls
  `sdkSessionLifecycle.startNewSession(startInput, token)`
  with `startInput.config.sessionId` populated. So `config.sessionId`
  is the single canonical source of session identity at all
  three seams — no new plumbing.

**Test contract (A2A-17 / A2A-18):**

A2A-17 PRODUCTION DISCOVERY: drive the real production
discovery seam (`SdkController.initTask(...)` →
`SdkSessionLifecycle.startNewSession({config:{sessionId:"A"}})`
→ `sdkHost.start(...)` → `prepareStartSessionInput(input)` →
`createVscodeExtraTools(mcpHub, {sessionId:"A"})` →
`McpHubToolProvider.listTools("session-bound-server")` →
`ensureSessionConnection("session-bound-server", {sessionId:"A"})`).
Confirm: BEFORE this call, the session-bound template has NO
child in `sessionConnections` (deferred). AFTER this call,
the `sessionConnections.get("A").get("session-bound-server")`
entry exists with a live PID, and the same fixture's `whoami`
descriptor appears in the returned `AgentTool[]`. Then call
the tool via the production `callTool` chain and verify the
fixture reports session identity `"A"`.

A2A-18 DISCOVERY ISOLATION: drive the real production
discovery seam twice — once with `sessionId:"A"`, once with
`sessionId:"B"`. Confirm: two distinct PIDs in
`sessionConnections`, both expose the SAME `whoami` schema,
A's discovery call did NOT reuse B's child.

**Why A2A-17/18 must use the real seam, not direct
invocation of `McpHubToolProvider.listTools`:** the
reviewer's halt is specifically about whether ClineMM
*actually* exposes session-bound tools to the model. A
unit-level test of `listTools` proves the API works in
isolation but proves nothing about whether the model's tool
context contains the descriptors — which is gated by
`prepareStartSessionInput(input.config.sessionId)`
**actually being read and threaded** in production.

### MCP_REGISTRATION_SEAM (the load-bearing seam)

`apps/vscode/src/services/mcp/McpHub.ts`

- `McpHub` is constructed **once per `SdkController`**
  (`apps/vscode/src/sdk/SdkController.ts:1134`). All Cline sessions
  created by that controller currently share this hub.
- `connectToServer(name, config, source)` at `McpHub.ts:386` is the
  **only** site that builds the `env` block handed to
  `StdioClientTransport`. The load-bearing lines are
  `McpHub.ts:484-493`:
  ```ts
  transport = new StdioClientTransport({
      command: expandedConfig.command,
      args: expandedConfig.args,
      cwd: expandedConfig.cwd,
      env: {
          ...getDefaultEnvironment(),
          ...(expandedConfig.env || {}),
      },
      stderr: "pipe",
  })
  ```
- `source ∈ { "rpc", "internal" }` — 8 production callsites
  (McpHub.ts:1248, 1263, 1324, 1349, 1506, 1541, 1650 and the SSE
  reconnect path at 627). It is **session-agnostic**. The new
  `sessionContext?` parameter must be threaded through all 8
  callsites when the upstream caller has session identity.
- `expandEnvironmentVariables` in
  `apps/vscode/src/utils/envExpansion.ts` runs over the static
  config at parse time. Today it recurses into object/array but
  only mutates string leaves via `${env:VAR}` syntax. With our
  new shape, an env value can be a source-object
  `{ fromSession:"sessionId", required }`; the existing
  recurse-into-object behavior is acceptable only if the
  object-shape is filtered out BEFORE expansion. The
  implementation must intercept at the env-resolution seam
  (not at the string-expansion seam) so we don't accidentally
  resolve `fromSession` as a `${env:...}` reference.

### MCP_SCHEMA_SEAM

`apps/vscode/src/services/mcp/schemas.ts`

- Today: `env: z.record(z.string(), z.string()).optional()`
  (lines 36, 99, 125, 147). Flat string-to-string.
- Extension target: replace `z.string()` with a Zod union that
  accepts either `z.string()` (legacy) or an object with exactly
  one of `value`, `fromEnv`, `fromSession` plus optional
  `required`. Refinement enforces XOR and rejects multi-source.
- The schema is shared between VSCode (write + read) and the CLI
  writer (`cline mcp add`). CLI compatibility must be preserved:
  writing `{"API_KEY":"abc"}` continues to round-trip identically.
- **P1 hygiene (per review):** define ONE exported
  `McpEnvEntrySchema` (and the wrapped `McpEnvSchema = z.record(
  z.string(), McpEnvEntrySchema).optional()`) in
  `schemas.ts` and reuse it at all four sites (lines 36, 99, 125,
  147). Don't scatter the union independently across the four
  declarations.

### MCP_CONNECTION_LIFECYCLE_SEAM

- `connections: McpConnection[]` at `McpHub.ts:85` is a flat array.
  Current reconnection keys on `serverName` alone.
- New shape: split into
  `static: Map<serverName, McpConnection>` and
  `session: Map<sessionId, Map<serverName, McpConnection>>`.
  Identity is computed from the resolved config: if any env entry
  is `{ fromSession: ... }`, the connection lives in the session
  map keyed by `(serverName, sessionId)`; otherwise in the static
  map.
- New APIs (shape — exact signatures deferred to implementation
  recon):
  ```
  connectToServer(name, config, source, sessionContext?)
  getConnection(name, sessionContext?)
  disconnectSession(sessionId)
  ```
- `disconnectSession(sessionId)` is load-bearing for A2A-13
  (lifecycle isolation on teardown).

### Startup semantics (FROZEN per review)

The previous recon contained a contradiction: it claimed
"settings-driven startup falls back to the global singleton path"
while A2A-06 requires session-bound configs to REJECT without a
session context. Both cannot be true simultaneously. The review
confirmed the second — REJECT on missing context — is the correct
contract. The frozen startup semantics are:

```
static MCP config  (no fromSession entries)
  settings load → connect globally EXACTLY AS TODAY
  → child spawned at startup (current contract preserved)

session-bound MCP config  (any entry shaped {fromSession:...})
  settings load → validate the config against McpEnvEntrySchema
                → STORE the template in the registry
                → DO NOT spawn a child
                → record a "pending session-bound" marker
                   so getServers() can still surface it
                   as a configured-but-not-connected entry
  session A first acquires/uses MCP server
                → spawn (serverName, A) per-session child
  session B first acquires/uses MCP server
                → spawn (serverName, B) per-session child
                → A's child is preserved, B's is fresh
  session A teardown → dispose (serverName, A)
                     → B's child is preserved
```

This is the rule that makes A2A-14 (DEFER) and A2A-15 (PRODUCTION
ACQUISITION) the discriminators the reviewer asked for:

- A2A-14 confirms: on settings load, a session-bound config
  produces NO STDIO child. The defer is total. There is never a
  global child spawned with the session-bound entry silently
  omitted. There is never a global child spawned with the
  session-bound entry populated from `undefined`.
- A2A-15 confirms: when a real Cline session invokes an MCP tool
  through the production call site
  (`vscode-runtime-builder.ts:47` → `McpHub.callTool` →
  `findConnection` → `connectToServer`), the per-session child
  is the one materialized — not a stub, not a synthetic call
  to the new overload in isolation. The session-bound env is
  visible inside the spawned child's `process.env`, observed by
  the fixture's `whoami` tool.

### MCP_OAUTH_SEAM (out of scope, must NOT regress)

- `mcpOAuthManager.getOrCreateProvider` at McpHub.ts:479 — remote
  transports (SSE / streamableHttp) only. The new per-session
  child applies only to STDIO. OAuth flow is unchanged.

### MCP_FIXTURE_SEAM (for the proof)

- Real production ClineMM does not bundle a deterministic MCP
  fixture server. The adversarial matrix must drive
  `StdioClientTransport` against a small fixture whose tools
  include `whoami` returning `{pid, session, env_subset}` from
  `process.env`. Fixture lives under
  `apps/vscode/src/services/mcp/__fixtures__/session-id-echo/`
  (or sibling). The fixture is the evidence-of-record for
  A2A-04, A2A-08, A2A-09, A2A-13, A2A-15, A2A-16, A2A-17,
  A2A-18 — anything
  that claims "the child saw X" must be backed by an actual
  read inside the spawned process, not by a helper that
  computed the value on the parent side.

## What this ACT must NOT do

1. MUST NOT touch MYC production code. MYC remains unchanged
   until ACT-B-LIVE-SESSION-PROPAGATION01.
2. MUST NOT introduce per-session lifecycle for static-config
   servers. The split is opt-in by config shape.
3. MUST NOT change upstream Cline's flat `env` public contract.
   Legacy `{ "API_KEY": "abc" }` continues to be accepted,
   parsed, expanded, and forwarded identically.
4. MUST NOT re-litigate SW-CM. The continuation substrate is
   frozen.
5. MUST NOT use provider-specific string matching. Generic
   resolver applies by data shape.
6. MUST NOT change `expandEnvironmentVariables` `${env:...}`
   syntax. Static env expansion is preserved as-is; the new
   source-object shape is resolved at the env-resolution seam,
   not the string-expansion seam.
7. MUST NOT promote to live evidence anything that isn't
   observed inside the spawned child process.

## What this ACT must produce

1. A bounded production change in
   `apps/vscode/src/services/mcp/schemas.ts` (env-union schema
   with XOR refinement) and `apps/vscode/src/services/mcp/McpHub.ts`
   (resolver + per-session child lifecycle). The optional
   `sessionContext` parameter on `connectToServer` is carried
   only by the three production seams — `vscode-runtime-builder.ts:47`
   (callTool/acquire), `vscode-runtime-builder.ts:124`
   (listTools/discovery), `sdk-session-lifecycle.ts:591`
   (trackSessionStop/release). The 8 internal reconnect
   callsites inside `McpHub.ts` keep their session-agnostic
   shape (per round-2 review).
2. A new test file under
   `apps/vscode/src/services/mcp/__tests__/` implementing
   A2A-01..A2A-18 with evidence reaching inside the spawned
   child.
3. A fixture MCP server at
   `apps/vscode/src/services/mcp/__fixtures__/session-id-echo/`
   exposing a `whoami` tool that returns
   `{pid, session, env_subset}` from inside the spawned child.
4. `result.json` and `08-focused-gates.txt` proving:
   - all A2A cases pass
   - substrate conservation (SW-CM04, SW-CM01..03 base corpus,
     bridge corpus) unchanged
   - typecheck clean
   - biome clean for new files
   - no MYC code touched (git diff against `ab71b439f` shows
     zero files in MYC subtree)

## Production child construction seam (for Section B — A2A-08..A2A-18)

Drive the real production seam:

```
McpHub.connectToServer(
    name: "myc",
    config: { command:"node", args:["...fixture/whoami.mjs"],
              env: { MYC_SESSION_ID: { fromSession:"sessionId", required:true } } },
    source: "rpc",
    sessionContext: { sessionId: "A" }
)
```

then concurrently with `sessionContext: { sessionId: "B" }`, and
prove:

- two distinct child PIDs
- the fixture's `whoami` tool returns `session=A` and `session=B`
  respectively (this is the load-bearing evidence)
- reconnect on A yields a NEW PID whose `whoami.session === "A"`,
  while B's PID is unchanged
- A2A-13: `disconnectSession("A")` removes only the A child;
  B survives
- A2A-14: settings load sees a `fromSession` entry but no
  active session — confirm via child count = 0 and that no
  pending marker ever materialized into a spawn.
- A2A-15: end-to-end via the production acquisition seam
  (`vscode-runtime-builder.ts:47` → `McpHub.callTool` →
  `findConnection` → `connectToServer` → `StdioClientTransport.start`
  → `Client.connect` → `client.callTool({name:"whoami"})`).
  The fixture's `whoami` MUST report `session === sessionContext.sessionId`.
  **No direct invocation of the new overload in isolation
  counts as A2A-15 evidence.**
- A2A-17: end-to-end via the production discovery seam
  (`vscode-session-host.ts:359` → `prepareStartSessionInput` →
  `createVscodeExtraTools({sessionId})` →
  `McpHubToolProvider.listTools` →
  `ensureSessionConnection({sessionId})` →
  `connectToServer({sessionContext})` →
  `StdioClientTransport.start` → `Client.connect` →
  `client.listTools()` → returned descriptor appears in
  `createMcpTools`'s `AgentTool[]`). The fixture's `whoami`
  MUST be reachable from `server.tools` BEFORE any tool call
  is issued, and a subsequent production `callTool` via
  A2A-15 MUST report `session === sessionContext.sessionId`.
  **No direct invocation of `McpHubToolProvider.listTools`
  in isolation counts as A2A-17 evidence.**
- A2A-18: A and B drive the production discovery seam
  independently; distinct PIDs land in
  `sessionConnections.get("A")` and
  `sessionConnections.get("B")`; the same `whoami` schema
  appears in both sessions' tool lists; A's discovery does
  NOT reuse B's child.

The fixture's `whoami` tool MUST be reached via the real
`StdioClientTransport.start()` → `Client.connect()` →
`client.callTool({name:"whoami"})` path, not via a mock. The
matrix's evidence-of-record is the fixture's tool response.

## EXISTING_TEST_COVERAGE

- `apps/vscode/src/services/mcp/__tests__/schemas.test.ts` —
  legacy flat-env schema cases; will be extended with
  object-form cases for A2A-02..A2A-07.
- `apps/vscode/src/services/mcp/__tests__/McpHub.connectFailure.test.ts` —
  connection-level reconnection semantics; substrate for
  A2A-09 / A2A-13.
- `apps/vscode/src/services/mcp/__tests__/StreamableHttpReconnectHandler.test.ts` —
  SSE/HTTP reconnect; out of scope (this ACT is STDIO only).
- `apps/vscode/src/utils/__tests__/envExpansion.test.ts` —
  `${env:VAR}` expansion; unchanged by this ACT.

## Architecture alternatives rejected (recorded for the board)

- **(b) active-session rebind**: rejected — turns MCP process
  identity into mutable global state; cannot satisfy concurrent
  A+B sessions; same authority ambiguity that motivated
  BackgroundNotifyCoordinator isolation.
- **globally per-session for every MCP server**: rejected —
  unbounded blast radius; one-process-per-session for every
  configured MCP server is unnecessary for static-only configs
  and breaks the upstream public contract expectation.
- **provider-specific string matching for `MYC_SESSION_ID`**:
  rejected — the feature is `fromSession:"sessionId"`, not
  `MYC_SESSION_ID`. Genericity is the design constraint.

## Forward dependencies

- ACT-B-LIVE-SESSION-PROPAGATION01 cannot start before this ACT
  passes `PASS_SESSION_BOUND_MCP_ENV`.
- ACT-C-LIFECYCLE (manual dogfood) depends on B.
- M03..M05 depend on C.

## Files targeted by this ACT (predicted at recon, final list at closure)

- modified: `apps/vscode/src/services/mcp/schemas.ts`
- modified: `apps/vscode/src/services/mcp/McpHub.ts`
- modified: `apps/vscode/src/services/mcp/types.ts` (if
  `McpConnection` shape changes)
- new: `apps/vscode/src/services/mcp/__tests__/session-bound-mcp-env01.a2a.test.ts`
- new: `apps/vscode/src/services/mcp/__fixtures__/session-id-echo/`
  (fixture MCP server: entry script + `whoami` tool)
- new (evidence):
  `.factory/evidence/ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01/`
  (`02-fixture-server-source.txt`,
   `03-adversarial-matrix.jsonl`,
   `04-child-process-evidence.jsonl`,
   `08-focused-gates.txt`, `result.json`)

## Done-with-recon signal

Recon is complete. The architecture decision is frozen. The
production seams are identified. The matrix is enumerated. The
fixture approach is fixed. The forward dependencies are recorded.
Proceeding to implementation per `plan.md`.

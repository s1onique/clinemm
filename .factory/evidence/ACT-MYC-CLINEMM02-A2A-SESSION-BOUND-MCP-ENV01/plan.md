# Plan (ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01)

## Sequence position

```
SW-CM04 PASS → SW-CM01 PASS → SW-CM02 PASS → SW-CM03 PASS
            ↓
   main production backlog
            ↓
   A2A (this ACT)
            ↓
   B-LIVE-SESSION-PROPAGATION01 (real myc dogfood, two live sessions)
            ↓
   C-LIFECYCLE (manual prime/remember/recall, no automation yet)
            ↓
   M03 adversarial memory qualification
            ↓
   M04 Factory MEMLAB comparison
            ↓
   M05 sustained multi-project dogfood
```

## Architecture decision (frozen)

```
PER_SESSION_STDIO_CHILD_FOR_SESSION_BOUND_CONFIG_ONLY

static server      => connection identity = serverName
session-bound      => connection identity = serverName + sessionId

static-compat:
  env = { "API_KEY": "abc" }    byte-for-byte preserved

session-bound activation predicate:
  config contains any entry shaped as { fromSession: "sessionId" }
```

## Verdict

```
ARCHITECTURE_DECISION                 = PASS
STATIC_MCP_COMPATIBILITY              = WELL_BOUNDED
CHILD_SIDE_WITNESS_DESIGN             = PASS
SESSION_BOUND_CONNECTION_IDENTITY     = PASS
SESSION_BOUND_STARTUP_SEMANTICS       = PASS
REAL_SESSION_TO_MCP_ACQUISITION_SEAM  = PASS  (vscode-runtime-builder.ts:47)
REAL_SESSION_TO_MCP_TEARDOWN_SEAM     = PASS  (sdk-session-lifecycle.ts:591-611)
REAL_SESSION_TO_MCP_DISCOVERY_SEAM    = PASS  (vscode-session-host.ts:359
                                              -> createVscodeExtraTools
                                              -> McpHubToolProvider.listTools
                                              -> ensureSessionConnection)
PRODUCTION_REACHABILITY               = PASS  (acquire + release + discover)
CALLERSITE_SCOPING                    = PASS  (only acquire + release +
                                              discover carry sessionId;
                                              all read input.config.sessionId)

verdict_string                        = PASS_SESSION_BOUND_MCP_ENV
```

## Implementation phases (in execution order)

### Phase 1 — Schema union (no runtime effect yet)

**File:** `apps/vscode/src/services/mcp/schemas.ts`

1. Add a new exported Zod schema (disjoint union members;
   multi-source is impossible by construction):
   ```ts
   const McpEnvEntrySchema = z.union([
       z.string(),
       z.object({
           value: z.string(),
           required: z.boolean().optional(),
       }),
       z.object({
           fromEnv: z.string(),
           required: z.boolean().optional(),
       }),
       z.object({
           fromSession: z.literal("sessionId"),
           required: z.boolean().optional(),
       }),
   ]);
   ```
2. Replace
   `env: z.record(z.string(), z.string()).optional()`
   with
   `env: z.record(z.string(), McpEnvEntrySchema).optional()`
   at lines 36, 99, 125, 147.
3. **Compatibility check:** legacy `{ "API_KEY": "abc" }`
   still parses (string union arm matches). New object form
   parses. Multi-source object is REJECTED by the union
   being disjoint.
4. Add `__tests__/schemas.test.ts` cases for:
   - A2A-01 legacy string env PASS
   - A2A-02 `{value}` PASS
   - A2A-03 `{fromEnv}` PASS
   - A2A-04 `{fromSession:"sessionId"}` PASS
   - A2A-07 multi-source object SCHEMA REJECT

### Phase 2 — Env resolver (pure, projection-only)

**New file:** `apps/vscode/src/services/mcp/envResolver.ts`

Pure function:

```ts
export type SessionContext = { sessionId: string } | undefined;

export function resolveMcpServerEnv(
    rawEnv: Record<string, McpEnvEntry> | undefined,
    sessionContext: SessionContext,
    processEnv: NodeJS.ProcessEnv = process.env,
): { env: Record<string, string> | "REJECT"; reason?: string }
```

Semantics:

- `string` value → `{ env: { K: "abc" } }` (after
  `${env:VAR}` expansion, delegated to existing
  `expandEnvironmentVariables`).
- `{ value }` → `{ env: { K: value } }`.
- `{ fromEnv: NAME, required?: bool }` →
  if `processEnv[NAME]` defined: `{ env: { K: processEnv[NAME] } }`;
  if missing and `required=true`: `"REJECT"` (reason =
  "missing required env: NAME");
  if missing and `required` unset: omit + warning.
- `{ fromSession: "sessionId", required?: bool }` →
  if `sessionContext?.sessionId`: `{ env: { K: sessionContext.sessionId } }`;
  if missing and `required=true`: `"REJECT"` (reason =
  "session-bound env requested but no session context");
  if missing and `required` unset: omit + warning.

**Purity guarantee (A2A-11):** the function MUST NOT mutate
`rawEnv`. It returns a fresh `env` object. Test asserts
referential equality of `rawEnv` before/after.

### Phase 3 — Per-session child lifecycle

**File:** `apps/vscode/src/services/mcp/McpHub.ts`

1. Replace `connections: McpConnection[]` with:
   ```ts
   private staticConnections: Map<string, McpConnection> = new Map();
   private sessionConnections: Map<string /* sessionId */,
                                     Map<string /* serverName */,
                                          McpConnection>> = new Map();
   // Template-only registry: configs validated at settings load
   // but NOT spawned (preserves the deferred-startup contract for
   // session-bound configs).
   private pendingSessionBound: Map<string, ParsedConfig> = new Map();
   ```
2. Add helper:
   ```ts
   private configIsSessionBound(config: ServerConfig): boolean {
       return Object.values(config.env ?? {}).some(
           (e): e is { fromSession: any } =>
               typeof e === "object" && e !== null &&
               "fromSession" in e,
       );
   }
   ```
3. Add new public methods:
   ```ts
   async connectToServer(
       name: string,
       config: string,
       source: "rpc" | "internal",
       sessionContext?: { sessionId: string },
   ): Promise<void> { ... }

   getConnection(
       name: string,
       sessionContext?: { sessionId: string },
   ): McpConnection | undefined { ... }

   disconnectSession(sessionId: string): Promise<void> { ... }
   ```
4. Inside the existing `connectToServer`, after
   `expandedConfig = expandEnvironmentVariables(config)`:
   - Compute `isSessionBound = configIsSessionBound(parsedConfig)`.
   - If `isSessionBound` and no `sessionContext`: REJECT (reason
     "session-bound server requires session context").
   - Else: call `resolveMcpServerEnv(parsedConfig.env, sessionContext)`.
   - If REJECT, throw an `Error` BEFORE `transport.start()`.
   - Else, replace the inline `env` construction at
     McpHub.ts:484-491 with the resolved env.
5. Store the connection in `staticConnections` or
   `sessionConnections[sessionId]` based on `isSessionBound`.
6. Update `findConnection` and `appendErrorMessage` helpers
   to accept the optional `sessionContext` and to look up in
   either map.
7. Per the P1/P2 review correction: do NOT manufacture
   session identity at the existing 8 internal callsites.
   `connectToServer(name, config, source, sessionContext?)`
   keeps the optional parameter; existing callsites
   (McpHub.ts:1248, 1263, 1324, 1349, 1506, 1541, 1650, and
   the closure at 627) continue to pass nothing. The only
   site that supplies `sessionContext` is the real session
   acquisition callsite at `vscode-runtime-builder.ts:47`
   (Phase 3b). Settings-driven startup paths (no active
   session) therefore always see `sessionContext=undefined`,
   exactly as today.
8. **DEFERRED STARTUP (frozen per review):**
   - In `initializeMcpServers` / `updateServerConnections`,
     for any server whose parsed config is session-bound:
     - Validate against the new schema.
     - Store the template in `pendingSessionBound`.
     - Surface as a configured-but-not-connected entry in
       `getServers()` so the webview knows it exists.
     - **Do NOT call `connectToServer` at all.** No
       `transport.start()`, no child PID.
   - The first real `callTool` or `listTools` for that server
     with a valid `sessionContext.sessionId` triggers the
     `connectToServer(..., sessionContext)` call from
     `findConnection`'s caller (or via an explicit
     `ensureSessionConnection(name, sessionContext)` helper).
   - Static (non-session-bound) configs keep today's contract:
     they spawn globally at settings load.

### Phase 3b — Production acquisition seam (NEW — added per review)

**File:** `apps/vscode/src/sdk/vscode-runtime-builder.ts:47`

The load-bearing diff: thread `request.context?.sessionId`
through to `McpHub.callTool`. Without this, A2A proves only
"the API supports session context", not "ClineMM uses it".

```diff
- return this.mcpHub.callTool(
-     request.serverName, request.toolName, request.arguments ?? {},
-     ulid, request.context?.signal,
- )
+ return this.mcpHub.callTool(
+     request.serverName, request.toolName, request.arguments ?? {},
+     ulid, request.context?.signal,
+     request.context?.sessionId,    // NEW
+ )
```

`McpHub.callTool(serverName, toolName, args, ulid, signal, sessionId?)`
extends the public signature; when `sessionId` is provided,
`findConnection(name, { sessionId })` looks up the per-session
child (spawning it on demand via `ensureSessionConnection(name,
{ sessionId })` if absent), and `connection.client.request(...)`
runs against THAT child — not a global.

### Phase 3c — Production teardown seam + callersite scoping (NEW — added per C1 round-2 review)

**File 1:** `apps/vscode/src/sdk/sdk-session-lifecycle.ts:591-611`

The release-side counterpart of Phase 3b. Add
`mcpHub.disconnectSession(sessionId)` to `trackSessionStop`,
running in parallel with `sdkHost.stop(sessionId)` so both
tear down in the same `pendingStops` machinery (wedge-free).

```diff
 private trackSessionStop(sdkHost: SdkSessionHost,
                          sessionId: string,
                          reason: string): Promise<void> {
     const startedAt = Date.now()
-    const stopPromise = sdkHost
-        .stop(sessionId)
+    // ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01: also
+    // tear down per-session MCP children owned by this
+    // sessionId.
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
+    ])
         .then(() => { ... })
         .catch((error: unknown) => { ... })
         .finally(() => { ... })
     this.pendingStops.set(sessionId, stopPromise)
     return stopPromise
 }
```

**File 2:** `apps/vscode/src/sdk/sdk-compaction-coordinator.ts:341-343`

Extract the same teardown pattern into a shared private helper
so the compaction temp-host path also gets
`mcpHub.disconnectSession(tempSessionId)`. Simplest form: a new
private helper on `SdkSessionLifecycle`
(`tearDownSession(sdkHost, sessionId, reason)`) that does both,
and is reused by both `trackSessionStop` and a thin call from
the compaction coordinator. Keeps a single canonical seam.

**Caller-sites scoping (P1/P2 correction per review):**

The reviewer noted that "thread `sessionContext` through all
8 callsites" is overly broad. Rescoped contract:

```
static / config-lifecycle callsites (existing):
  - McpHub.ts:1248 (rpc connect on user add)
  - McpHub.ts:1263 (rpc reconnect)
  - McpHub.ts:1324 (internal settings-load spawn)
  - McpHub.ts:1349 (internal settings-load reconnect)
  - McpHub.ts:1506 (rpc restart)
  - McpHub.ts:1541 (internal restart)
  - McpHub.ts:1650 (rpc toggle)
  - McpHub.ts:627 (SSE reconnect helper closure)
  - McpHub.ts:386 internal helper signature

  KEEP SESSION-AGNOSTIC: pass sessionContext=undefined at
  each callsite (or omit the parameter entirely for the
  internal closure). These are settings/config-driven paths;
  they do NOT manufacture session identity.

real session acquisition callsite (NEW per Phase 3b):
  - vscode-runtime-builder.ts:47
  - McpHub.callTool (... sessionId?) public signature
  - findConnection / ensureSessionConnection inside McpHub

  CARRIES sessionId from AgentToolContext. Only this path
  threads sessionContext through to connectToServer.

real session teardown callsite (NEW per Phase 3c):
  - sdk-session-lifecycle.ts:591-611 trackSessionStop
  - sdk-compaction-coordinator.ts:341-343
  - mcpHub.disconnectSession(sessionId) public signature

  CARRIES sessionId from activeSession / tempSessionId.
```

`McpHub.connectToServer(name, config, source, sessionContext?)`
keeps the optional `sessionContext` parameter; existing 8
internal callsites pass nothing (i.e. the `undefined` path is
preserved); the new path at `vscode-runtime-builder.ts:47`
fills it. This avoids forcing every reconnect path to learn
about session identity it does not have.

### Phase 3d — Production discovery seam (NEW — added per C1 round-3 review)

The two prior phases (3b acquire, 3c release) close the
"model has called a tool" and "session has ended" edges.
This phase closes the third edge — "model has the tool
schema in its context" — without which A2A-15 can never
fire because there is nothing in the model's tool list to
call. See recon §`SESSION_MCP_DISCOVERY_SEAM`.

**Files touched (small, additive, 3 spots):**

1. `apps/vscode/src/sdk/vscode-session-host.ts:359`
   `prepareStartSessionInput(input)` — read
   `inputWithRemoteConfig.config.sessionId?.trim()`, pass
   as `sessionId` into `createVscodeExtraTools(options.mcpHub,
   { ..., sessionId })`.

2. `apps/vscode/src/sdk/vscode-runtime-builder.ts:51`
   `VscodeExtraToolsOptions` — add optional
   `sessionId?: string` with ACT-anchored JSDoc.

3. `apps/vscode/src/sdk/vscode-runtime-builder.ts:19,22,40`
   `McpHubToolProvider` — second ctor arg `sessionId?: string`;
   `listTools(name)` calls
   `this.mcpHub.ensureSessionConnection(name, { sessionId: this.sessionId })`
   before reading `server.tools` (only when `sessionId !== undefined`);
   `callTool(request)` forwards `this.sessionId` to
   `mcpHub.callTool(...)` (the Phase 3b overload extension,
   now also exposed via `this.sessionId` so the provider's
   constructor holds the same session identity for the entire
   session lifetime).

**Why no new callersite expansion is needed:**
`prepareStartSessionInput(input)` is called from inside
`ClineCore.start({...startInput})` whose `input.config.sessionId`
already carries the host-owned session id
(`CoreSessionConfig.sessionId`,
`sdk/packages/core/src/types/config.ts:259-268`). The
`SdkSessionLifecycle.startNewSession(startInput, token)`
caller reads `startInput.config.sessionId?.trim()` at line
366 before the host awaits `sdkHost.start(input)`. So at the
moment `prepareStartSessionInput` runs, the building
session's id is already on the input — no synchronous
`getActiveSession()`, no race.

**Static-compat guarantee:** when the host does not thread
`sessionId` (Hub/Remote, CLI, legacy test harnesses,
pre-ACT ClineMM desktop app), the new optional ctor param is
`undefined`. `listTools` skips `ensureSessionConnection`;
`callTool` forwards `undefined`. Behavior is bit-equivalent
to pre-ACT. `ensureSessionConnection` itself short-circuits
when the parsed template lacks `fromSession`, so static MCP
configs reach the unchanged `connections.find(...)` path.

**Production-callersite scoping (round-3 tightening):**
three production seams carry `sessionId`, all reading from
the SAME canonical source `input.config.sessionId`:

| seam   | file:line                                | role       |
|--------|------------------------------------------|------------|
| acquire  | `vscode-runtime-builder.ts:47`         | `callTool` |
| discover | `vscode-runtime-builder.ts:124`        | `createVscodeExtraTools` (NEW) |
| release  | `sdk-session-lifecycle.ts:591`         | `trackSessionStop` |

No SdkController plumbing changes. No additional `getActiveSession()`
round-trips.

### Phase 4 — Fixture MCP server

**New dir:** `apps/vscode/src/services/mcp/__fixtures__/session-id-echo/`

- `whoami.mjs` — Node ESM script that boots an MCP server
  using the `@modelcontextprotocol/sdk` `Server` class.
- On `tools/list`: declares one tool `whoami`.
- On `tools/call { name: "whoami" }`: returns
  ```
  { pid, ppid,
    session: process.env.MYC_SESSION_ID ?? null,
    session_keys: [...Object.keys(process.env).filter(
        k => k === "MYC_SESSION_ID" || k === "TRACE_RUN")] }
  ```
- Run via `node whoami.mjs` (NOT bun — keep the child on
  the runtime-under-test, not bun-tooling; per
  `.clinerules/bun-and-node.md`).

### Phase 5 — Adversarial test file

**New file:** `apps/vscode/src/services/mcp/__tests__/session-bound-mcp-env01.a2a.test.ts`

Test count: 18 (one per A2A row). Pool: `--pool=vmThreads`
(per SW-CM01 correction round 1 hindsight — vitest forks-pool
emits benign `EPERM` on cleanup under sandbox; vmThreads gives
exit=0 with same coverage).

| #  | Setup                                                  | Witness path                          | Expected                                              |
|----|--------------------------------------------------------|---------------------------------------|-------------------------------------------------------|
| 01 | static `{API_KEY:"abc"}`                               | parent: env resolution is `{"API_KEY":"abc"}`; child count = 1 (static) | PASS                                                  |
| 02 | `{value:"x"}` for `K`                                  | parent: env resolution                | PASS                                                  |
| 03 | `{fromEnv:"PATH",required:true}` for `K`               | parent: env resolution + child K=PATH | PASS                                                  |
| 04 | `{fromSession:"sessionId",required:true}` for `MYC_SESSION_ID` (session A) | child `whoami` tool → `process.env.MYC_SESSION_ID === "A"` | PASS, child PID live  |
| 05 | `{fromEnv:"MISSING",required:true}` (no ctx)           | parent: resolver returns REJECT       | REJECT before spawn                                   |
| 06 | `{fromSession:"sessionId",required:true}` (no ctx)     | parent: resolver returns REJECT       | REJECT before spawn                                   |
| 07 | `{value:"x", fromEnv:"y"}` (multi-source)              | parent: schema parse                  | SCHEMA REJECT                                         |
| 08 | sessions A and B                                       | child `whoami` from both children, concurrently | A.pid ≠ B.pid; A.session="A"; B.session="B"           |
| 09 | reconnect A                                            | new child `whoami.session === "A"`; B's PID preserved | A retains identity, B unaffected |
| 10 | `{MYC_SESSION_ID:{fromSession:"sessionId"}}` AND `{TRACE_RUN:{fromSession:"sessionId"}}` (session A) | both children report session="A" for both names | proves genericity (no MYC_SESSION_ID hardcode) |
| 11 | call resolver twice on same `rawEnv`                   | `rawEnv` referential equality preserved | projection-only                                       |
| 12 | static server while A/B coexist (one global + one each for A/B session-bound) | static child count = 1; session A and B each have their own child | no regression to ordinary MCP lifecycle  |
| 13 | `disconnectSession("A")` with B alive                  | A child dead; B child alive (`whoami` still returns B) | lifecycle isolation                                   |
| 14 | settings load sees `fromSession` entry, no active session | parent inspects: child count = 0; webview surfaces configured-but-pending; NO `transport.start()` ever called | session-bound startup DEFER (no global child, no silent-omit) |
| 15 | production acquisition: drive `McpHubToolProvider.callTool` with a synthetic `AgentToolContext { sessionId: "A" }` (mirroring the production chain at `vscode-runtime-builder.ts:47`) | real child `whoami.session === "A"` (NOT a direct call to `connectToServer` overload) | PRODUCTION ACQUISITION (discriminator; added per review) |
| 16 | drive `SdkSessionLifecycle.endActiveSession("test")` → `trackSessionStop` → `mcpHub.disconnectSession("A")` (mirroring the production chain at `sdk-session-lifecycle.ts:594` + new teardown seam at line 256+) | A child terminated (PID dead); A session-map entry removed; B PID unchanged; B `whoami` still succeeds | PRODUCTION TEARDOWN (discriminator; added per C1 round-2 review) |
| 17 | drive `prepareStartSessionInput(input)` (with `input.config.sessionId === "A"`) → `createVscodeExtraTools(mcpHub, { sessionId: "A" })` → `McpHubToolProvider.listTools("session-bound-server")` → `ensureSessionConnection("session-bound-server", { sessionId: "A" })` (mirroring the production chain at `vscode-session-host.ts:359`) | BEFORE: `sessionConnections.get("A").get("session-bound-server") === undefined`. AFTER: same entry exists with live client; `server.tools` includes `whoami`; the descriptor appears in the returned `AgentTool[]`. Subsequent A2A-15 production `callTool` chain hits the same child; fixture reports `session === "A"`. | PRODUCTION DISCOVERY (discriminator; added per C1 round-3 review) |
| 18 | drive production discovery twice — first `sessionId:"A"`, then `sessionId:"B"` | `sessionConnections.get("A").get("server").pid ≠ sessionConnections.get("B").get("server").pid`; both sessions' tool lists contain the SAME `whoami` descriptor; A's discovery does NOT reuse B's child; `mcpHub.disconnectSession("A")` leaves B alive | DISCOVERY ISOLATION (discriminator; added per C1 round-3 review) |

### Phase 6 — Conservation gates

Before declaring PASS:

1. SW-CM04 base corpus: rerun, expect 16/94 unchanged.
2. SW-CM01..03 base corpus: rerun, expect unchanged.
3. SW-CM04 bridge corpus: rerun, expect 1/5 unchanged.
4. `apps/vscode/src/services/mcp/__tests__/schemas.test.ts`:
   rerun, expect extended cases pass.
5. `apps/vscode/src/services/mcp/__tests__/McpHub.connectFailure.test.ts`:
   rerun, expect unchanged.
6. `bunx biome check <new-files>`: exit 0.
7. `bunx tsc -p apps/vscode/tsconfig.json --noEmit`: exit 0
   (no new diagnostics in `apps/vscode/src/services/mcp/`).
8. `git diff --stat ab71b439f..HEAD -- apps/myc`: zero files
   changed (proves no MYC touch).

### Phase 7 — Closure artifacts

Write under
`.factory/evidence/ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01/`:

- `02-fixture-server-source.txt` — verbatim `whoami.mjs`
  source + the resolved entry-point invocation line.
- `03-adversarial-matrix.jsonl` — one JSON record per A2A
  case with setup, witness, expected, observed.
- `04-child-process-evidence.jsonl` — child PIDs +
  `whoami` responses for A2A-04, A2A-08, A2A-09, A2A-10,
  A2A-12, A2A-13, A2A-15, A2A-16, A2A-17, A2A-18
  (terminal PID liveness snapshot of A vs B after
  production teardown; pre/post-discovery PIDs for A2A-17;
  distinct PIDs across A and B discovery for A2A-18).
- `05-schema-test-output.txt` — `vitest` output for the
  extended schemas test.
- `06-mcphub-test-output.txt` — `vitest` output for
  `McpHub.connectFailure` (conservation).
- `07-typecheck-and-biome.txt` — `tsc` + `biome` exit codes.
- `08-focused-gates.txt` — gate-of-record summary; verdict
  string `PASS_SESSION_BOUND_MCP_ENV` and exit codes.
- `result.json` — schema-of-record.

Then commit durable artifacts and update
`.factory/acts/ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01.md`
and `.factory/epic-board.md` per Factory convention.

## Out-of-scope (for this ACT)

- Any MYC production code change.
- Lifecycle automation (recall/remember/prime scheduling).
- Wiring MYC into a ClineMM session at the SDK boundary
  (that is ACT-B-LIVE-SESSION-PROPAGATION01).
- `fromSession: "taskId" | "conversationId" | "workspaceId"`
  — only `sessionId` is in scope. Future values added only
  with a real consumer.
- Changes to OAuth / SSE / StreamableHTTP transports.
- Changes to the `${env:VAR}` expansion syntax.

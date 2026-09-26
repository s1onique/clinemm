## ACT-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — IN PROGRESS — opened 2026-09-26

**Status:** C1: GO. Stages 1–5 GREEN. Stage 6 (conservation gate) + Stage 7 (closure) queued.

**Execution snapshot:**
- Commit `3ee2f0bc3`: Stage 1 schema additive union, Stage 2 pure resolver, Stage 3 A2A-04 child witness. 16+3+8+15 tests, all GREEN.
- Commit `ceb4c801f`: Stage 4 A/B isolation rows (A2A-08/09/10/12/13/14). 6/6 isolation tests pass.
- Commit `12ff01021`: **Stage 5 production seams (resolves review halt STAGE4_MCPHUB_LIFECYCLE_NOT_EXERCISED).** Implements the real `McpHub` session lifecycle:
  - `McpHub.sessionConnections: Map<sessionId, Map<serverName, McpConnection>>`
  - `McpHub.ensureSessionConnection(serverName, { sessionId? })` — discover seam
  - `McpHub.disconnectSession(sessionId)` — release seam
  - `McpHub.callTool(..., sessionId?)` — per-session acquire overload
  - `McpHubToolProvider(mcpHub, sessionId?)` + `createVscodeExtraTools(mcpHub, {sessionId})`
  - `sdk-session-lifecycle.trackSessionStop` wraps `Promise.all([sdkHost.stop, mcpHub.disconnectSession])`
  - 11 new tests drive A2A-08/09/12/13/14/15/16/17/18 against the REAL hub (not raw StdioClientTransport+Client pairs as in Stage 4).
- Full unit suite: **89 files, 1204 pass / 0 fail.** Zero regressions in pre-existing `McpHub.*` tests (24+2+5+21+2+19 pass).
- Typecheck: `tsc --noEmit --project tsconfig.json` exit 0. Biome clean.
- Evidence: `.factory/evidence/ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01/{02-stage-1-3-evidence,03-stage-4-evidence,04-stage-5-evidence}.md`.

**Reviewer verdict (round 3, C1: GO):**
- `HALT_SESSION_BOUND_MCP_ACQUISITION_SEAM_NOT_IDENTIFIED` = CLOSED
- `HALT_SESSION_BOUND_MCP_TEARDOWN_SEAM_NOT_IDENTIFIED`    = CLOSED
- `HALT_SESSION_BOUND_MCP_DISCOVERY_SEAM_NOT_IDENTIFIED`   = CLOSED
- `ARCHITECTURE_DECISION`           = PASS
- `STATIC_MCP_COMPATIBILITY`        = PASS
- `STARTUP_DEFER`                   = PASS
- `PRODUCTION_DISCOVERY`            = PASS
- `PRODUCTION_ACQUISITION`          = PASS
- `PRODUCTION_TEARDOWN`             = PASS
- `CHILD_SIDE_WITNESS_DESIGN`       = PASS
- `PRODUCTION_REACHABILITY`         = PASS

**Reviewer MCP-SDK alignment check:** STDIO `Client.connect()` spawns and owns the server process; `listTools()` obtains the tool definitions that a host gives to the model; only after model selection does `callTool()` execute the chosen tool. STDIO is explicitly client-spawned subprocess ownership. The new flow (`listTools()` → `ensureSessionConnection` → `Client.connect()` → `client.listTools()` → cached `server.tools` → model has `whoami` in tool list → `callTool()` → same `Client`) is exactly the MCP lifecycle.

**Reviewer implementation caution (not a halt):** the MCP SDK caches/uses tool metadata after `listTools()` and may perform validation against that discovery state; preserving one `Client` per `(serverName, sessionId)` from discovery through subsequent calls is therefore exactly the right design.

**Sequence position:** SW-CM04 → SW-CM01 → SW-CM02 → SW-CM03 (all PASS) → main production backlog → **A2A (this)** → B-LIVE-SESSION-PROPAGATION01 → C-LIFECYCLE → M03 → M04 → M05.

**Recon:** `.factory/evidence/ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01/01-recon.md`

**Plan:** `.factory/evidence/ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01/plan.md`

**Entry identity:** `.factory/evidence/ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01/00-entry-identity.txt`

**Architecture decision (frozen — C1):**
```
PER_SESSION_STDIO_CHILD_FOR_SESSION_BOUND_CONFIG_ONLY
```

Identity key:
```
static server      => serverName                        (preserved)
session-bound      => serverName + sessionId            (new)
```

Activation predicate:
```
config contains any entry shaped as { fromSession: "sessionId" }
```

**Adversarial matrix (frozen — 18 rows):** A2A-01..A2A-18 (see plan.md Phase 5).

A2A-14 (DEFER) and A2A-15 (PRODUCTION ACQUISITION) added per
reviewer's HALT_SESSION_BOUND_MCP_ACQUISITION_SEAM_NOT_IDENTIFIED.
A2A-15 is the discriminator: it requires reaching the per-session
child via the real production call site at
`apps/vscode/src/sdk/vscode-runtime-builder.ts:47` →
`McpHub.callTool` → `findConnection` → `connectToServer` →
`StdioClientTransport.start` → `Client.connect` →
`client.callTool({name:"whoami"})`. Direct invocation of the
new `connectToServer` overload in isolation is NOT acceptable
evidence.

A2A-16 (PRODUCTION TEARDOWN) added per reviewer's
HALT_SESSION_BOUND_MCP_TEARDOWN_SEAM_NOT_IDENTIFIED. The
release-side counterpart of A2A-15: it requires that
`SdkSessionLifecycle.endActiveSession(reason)` →
`trackSessionStop(sdkHost, sessionId, reason)` → `Promise.all([
sdkHost.stop(sessionId), mcpHub.disconnectSession(sessionId) ])`
actually tears down A's per-session child while leaving B
unaffected — reached through the real production teardown
seam at `apps/vscode/src/sdk/sdk-session-lifecycle.ts:591-611`,
not via direct invocation of `mcpHub.disconnectSession(A)` in
isolation.

A2A-17 (PRODUCTION DISCOVERY) and A2A-18 (DISCOVERY ISOLATION)
added per reviewer's
HALT_SESSION_BOUND_MCP_DISCOVERY_SEAM_NOT_IDENTIFIED. They
prove the third edge — that the session-bound server's tool
schema is visible to the model BEFORE any `callTool` is
issued. A2A-17 requires reaching the per-session child via
the real production discovery seam at
`apps/vscode/src/sdk/vscode-session-host.ts:359
prepareStartSessionInput` →
`createVscodeExtraTools(mcpHub, { sessionId })` →
`McpHubToolProvider.listTools` →
`ensureSessionConnection({ sessionId })` →
`connectToServer({ sessionContext })` →
`StdioClientTransport.start` → `Client.connect` →
`client.listTools` → returned descriptor appears in
`createMcpTools`'s `AgentTool[]`. Not a direct invocation of
`McpHubToolProvider.listTools` in isolation. A2A-18 proves
that A's discovery does not reuse B's child — two distinct
PIDs, two distinct session-map entries, identical schema.

**Acquisition seam (frozen — round 1):**
```
McpHubToolProvider.callTool(request)
  request.context: AgentToolContext
    request.context.sessionId: string
  mcpHub.callTool(name, tool, args, ulid, signal,
                  request.context.sessionId)   // NEW: forward sessionId
    findConnection(name, { sessionId })
      ensureSessionConnection(name, { sessionId })
        connectToServer(name, config, source, { sessionId })
```

**Discovery seam (frozen — round 3):**
```
vscode-session-host.ts:359 prepareStartSessionInput(input)
  input.config.sessionId is the building session's id
  createVscodeExtraTools(mcpHub, { sessionId })           # NEW: thread sessionId
    for each server in mcpHub.getServers():
      createMcpTools({ serverName, provider })
        provider.listTools(name)                          # McpHubToolProvider
          if (sessionId !== undefined):                   # NEW
            mcpHub.ensureSessionConnection(name, { sessionId })
              connectToServer(name, config, source, { sessionContext: { sessionId } })
                StdioClientTransport.spawn(env)
                Client.connect() -> client.listTools()
                server.tools = [...] (cached)
          mcpHub.getServers()
          server.tools ?? []
```

`prepareStartSessionInput` is called from inside
`ClineCore.start({...startInput})`. `input.config.sessionId`
already carries the host-owned session id
(`CoreSessionConfig.sessionId`,
`sdk/packages/core/src/types/config.ts:259-268`), populated
by `sdk-task-start-coordinator.ts:148` via `createSessionId()`
BEFORE `startInput` reaches `prepareStartSessionInput`. So
the building session's id is already on the input — no
synchronous `getActiveSession()`, no race. No new
`SdkController` plumbing required.

**Teardown seam (frozen — round 2):**
```
SdkSessionLifecycle.endActiveSession(reason)
  trackSessionStop(sdkHost, sessionId, reason)
    Promise.all([
      sdkHost.stop(sessionId),                  # existing
      mcpHub.disconnectSession(sessionId),      # NEW: per-session MCP teardown
    ])
```

Both callsites are existing production code paths; the
diff at each is small and additive. `mcpHub.disconnectSession`
sits inside `Promise.all` so it cannot wedge the existing
`pendingStops` machinery.

**Startup semantics (frozen per review):**
```
static MCP config  -> connect globally EXACTLY AS TODAY
session-bound MCP  -> DEFER; validate and store template only;
                       NO child spawned at settings load;
                       first real session acquisition spawns
                       the per-session child.
```

**Schema hygiene (P1 per review):** one exported `McpEnvEntrySchema`
in `schemas.ts`, reused at lines 36, 99, 125, 147 — not four
independent union copies.

**Caller-site scoping (P1/P2 correction per round-2 review;
round-3 tightening; round-3 reviewer P2 wording fix):**
the existing 8 internal `connectToServer` callsites in
`McpHub.ts` (1248, 1263, 1324, 1349, 1506, 1541, 1650, and the
closure at 627) KEEP their current session-agnostic shape
(pass nothing). Three production seams carry sessionId —
three different immediate object fields, but the SAME
session identity lineage (the host-owned id created by
`SdkController.initTask` as `taskSessionId = createSessionId()`
and propagated via `startInput.config.sessionId`):

| seam     | file:line                                | role        | reads from                              |
|----------|------------------------------------------|-------------|-----------------------------------------|
| acquire  | `vscode-runtime-builder.ts:47`           | `callTool`  | `AgentToolContext.sessionId`            |
| discover | `vscode-runtime-builder.ts:124`          | `createVscodeExtraTools` (NEW per round 3) | `input.config.sessionId` (`CoreSessionConfig.sessionId`) |
| release  | `sdk-session-lifecycle.ts:591`           | `trackSessionStop` | `activeSession.sessionId`       |

`connectToServer(name, config, source, sessionContext?)`
keeps the optional parameter; the `undefined` path is the
unchanged default. `McpHubToolProvider`'s new ctor
`(mcpHub, sessionId?)` is the only place the optional
session identity is captured for the lifetime of the
provider — both `listTools` and `callTool` close over the
same `this.sessionId`.

**Verdict string:** `PASS_SESSION_BOUND_MCP_ENV`

**Static-compat promise:** upstream Cline's flat `env = { "API_KEY": "abc" }` continues to parse and round-trip identically; no migration required for existing user configs.

**Out of scope (for this ACT):**
- any MYC production code change
- lifecycle automation (recall/remember/prime scheduling)
- wiring MYC into a ClineMM session at the SDK boundary (ACT-B)
- additional `fromSession` values beyond `sessionId` (taskId / conversationId / workspaceId added only with real consumer)
- OAuth / SSE / StreamableHTTP transport changes
- `${env:VAR}` syntax changes

**Successor (only on PASS):** ACT-MYC-CLINEMM02-B-LIVE-SESSION-PROPAGATION01 — real myc dogfood with two live ClineMM sessions.

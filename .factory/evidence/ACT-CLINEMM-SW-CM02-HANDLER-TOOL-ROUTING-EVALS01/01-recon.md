# 01-recon.md — ACT-CLINEMM-SW-CM02-HANDLER-TOOL-ROUTING-EVALS01

## Goal

Reopen `HALT_PRODUCTION_ROUTING_SEAM_NOT_EXERCISED` (first round) and
`HALT_CONFIGURED_AGENT_PRODUCTION_SEAM_NOT_EXERCISED` (second round):
replace local mirrors of `CONFIGURED_AGENT_TOOL_NAME_ALIASES` /
`filterToolsForConfiguredAgent` / `filterAvailableTools` with tests that
drive the real `DefaultRuntimeBuilder.build()` production seam AND
observe the child runtime's tool list via the real child construction
path. Refresh the closure digest.

## State after this ACT (post-correction round 2)

  CORRECTION-ROUND-2-RESULTS
  ─────────────────────────────────────────────────────────────
  HALT_CONFIGURED_AGENT_PRODUCTION_SEAM_NOT_EXERCISED  RESOLVED
  ─────────────────────────────────────────────────────────────
  Child-runtime toolset observed end-to-end via the REAL production
  child construction seam (`filterToolsForConfiguredAgent(
  createBuiltinToolsList(...), agent)` at runtime-builder.ts:594-617).

  The 4 reviewer C1-C4 cases are now exercised:
    C1 (B4): tools: [bash, read_file] → child gets [read_files, run_commands]
             (literal aliases absent, canonical names present)
    C2 (B5): skills: [review] → child gets [read_files, skills]
             (skills executor injected, scope preserved)
    C3 (B6): no tools field → child gets full permitted parent/builtin set
             (no scoping when allowlist absent)
    C4 (B7): tools: [bash] + toolPolicies.run_commands.enabled=false
             → child gets [] (filter composition correctly empty)
  ─────────────────────────────────────────────────────────────

## Two-file layout (production seams exercised)

### File 1: dispatch layer
`sdk/packages/agents/src/runtime/routing/handler-tool-routing-evals01.swcm02.test.ts`
  48 tests, 9 describe blocks, drives real `AgentRuntime` end-to-end.
  No local mirrors of any filter. The AgentRuntime registry
  (`AgentRuntime.tools = new Map<name, AgentTool>`) is populated
  from a literal `tools[]` array, exactly as the production code does.

### File 2: registration layer (now with child-runtime observation)
`sdk/packages/core/src/runtime/orchestration/runtime-builder.routing-evals.swcm02.test.ts`
  12 tests, 2 describe blocks (A=5, B=7).

  Section A (5 tests): drives `DefaultRuntimeBuilder.build({ toolPolicies })`
    and observes `built.tools` (filterAvailableTools seam).

  Section B (7 tests):
    B1, B2, B3 (parent-level): observe `built.tools` after build().
    B4, B5, B6, B7 (CHILD-level): invoke `subagent_<name>.execute(...)`,
      capture `agentConstructorSpy.mock.calls.at(-1)[0].tools` — the
      actual child tool list produced by the production
      `filterToolsForConfiguredAgent(createBuiltinToolsList(...), agent)`
      closure.

  Mock setup: `vi.mock("./session-runtime-orchestrator", ...)` captures
  the `AgentConfig` passed to `new SessionRuntime(config)` (same pattern
  as `runtime-builder.configured-agent-execution.test.ts`).

## Production seams exercised (per ACT §5 R1..R10)

R1 BUILT-IN     covered: dispatch B-series (14) + registration A (5) + B6 (1)
R2 SKILLS       covered: dispatch B1-sk, S12 (5) + registration B3 (parent), B5 (child)
R3 COMPLETION   covered: dispatch B1-sae (1)
R4 HUMAN-INPUT  covered: dispatch B1-aq (1)
R5 CUSTOM       covered: dispatch S14 (3). Plugin `setup()` registration out of scope.
R6 MCP          NOT_APPLICABLE — flat-map dispatch only.
R7 CONFIGURED   covered: registration B1-B7 (parent + child). Real production path.
R8 POLICY       covered: registration A1-A5 (parent) + B7 (child composition).
R9 UNKNOWN      covered: dispatch B5-unknown, S10, S11.
R10 ALIAS       covered: dispatch S11 + registration B1 (parent) + B4 (child canonical).

## Production code touched: NO

`git --no-pager diff --check HEAD` → DIFF_CHECK_RC=0
`git status --short` shows only 3 untracked (1 file in agents/, 1 file
in core/, evidence dir). No tracked-file changes.

## Highlights

- The dispatch file in `@cline/agents` drives the real `AgentRuntime`
  (48/48 pass under `bun test`); `expectClassification` helper projects
  `ToolRuntimeOutcome.kind` to SW-CM02's classifier
  (`success`→`tool_execution_succeeded`; `failure`→`failureClass`;
  `control_plane`→`outcome`).
- The core file drives the real `DefaultRuntimeBuilder.build()`:
  - Section A: real `toolPolicies: { run_commands: { enabled: false } }`
    + real `DefaultRuntimeBuilder.build({ config })` + real
    `AgentRuntime.run("test prompt")` to prove dispatch becomes
    `tool_not_found`.
  - Section B parent-level: real `.cline/agents/<name>.yml` files on
    disk + real `DefaultRuntimeBuilder.build({ enableSpawnAgent: true })`.
  - Section B child-level (NEW): real `.cline/agents/<name>.yml` files
    + real `DefaultRuntimeBuilder.build({ enableSpawnAgent: true })`
    + real `subagent_<name>.execute(...)` invocation, captured via
    mocked SessionRuntime.
- Wording in `result.json`: "custom/plugin" → "custom (direct tools[]
  registration)" (plugin `setup()` path explicitly out of scope); MCP
  → `NOT_APPLICABLE` with explicit "flat-map dispatch only" scope
  statement.
- `ToolRuntimeOutcome` shape in current source: tagged union
  `kind: "success" | "failure" | "control_plane"`. Helper added in
  both files.
- Path-corrected: test imports `AgentRuntime` from `@cline/agents` for
  the core sibling; the dispatch file's path is
  `sdk/packages/agents/src/runtime/routing/` so it imports `AgentRuntime`
  from `../../index`.
- `setHomeDir` from `@cline/shared/storage` redirects HOME to
  `mkdtempSync` dirs so the builder's settings lookup is hermetic.

## Production child construction seam

```
sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:587-628
        ┌────────────────────────────────────────────────────────────┐
        │ if (normalized.enableSpawnAgent) {                         │
        │   if (configuredAgents.configs.length > 0) {              │
        │     tools.push(                                            │
        │       ...filterAvailableTools(                             │
        │         createConfiguredAgentTools({                       │
        │           configProvider: delegatedAgentConfigProvider,   │
        │           agents: configuredAgents.configs,                │
        │           createSubAgentTools: (agent) =>                  │
        │             normalized.enableTools                         │
        │             ? filterToolsForConfiguredAgent(              │ ← filter seam
        │                 createBuiltinToolsList(...),               │
        │                 agent,                                     │
        │               )                                            │
        │             : [],                                          │
        │           ...                                              │
        │         }),                                                │
        │         effectiveToolPolicies,                             │
        │       ),                                                   │
        │     );                                                     │
        │   }                                                        │
        │ }                                                          │
        └────────────────────────────────────────────────────────────┘

sdk/packages/core/src/extensions/tools/team/configured-agent-tool.ts:166-181
        ┌────────────────────────────────────────────────────────────┐
        │ const tools = options.createSubAgentTools                  │ ← closure invoked
        │   ? await options.createSubAgentTools(config, input, ctx)  │
        │   : [];                                                    │
        │ const subAgent = createDelegatedAgent({                    │ ← child runtime
        │   kind: "subagent",                                        │
        │   prompt: config.systemPrompt,                             │
        │   configProvider,                                          │
        │   tools,                                                   │ ← filtered child tools
        │   ...                                                      │
        │ });                                                        │
        └────────────────────────────────────────────────────────────┘
```

The test drives this entire path:
1. `DefaultRuntimeBuilder.build({ config: { enableSpawnAgent: true, ... } })`
   registers the configured-agent tool (`subagent_<name>`) on the lead
   runtime.
2. The test finds that tool and calls `reviewer.execute({ prompt }, ctx)`.
3. Inside `execute`, the production closure at runtime-builder.ts:594-617
   runs: `filterToolsForConfiguredAgent(createBuiltinToolsList(...), agent)`
   — this is the filter that decides what the SUB-AGENT sees.
4. The result is passed to `createDelegatedAgent({ tools, ... })` which
   calls `new SessionRuntime(config)` — captured by the mock.
5. The test inspects `agentConstructorSpy.mock.calls.at(-1)[0].tools`
   which is the actual child tool list.

No local mirror of `filterToolsForConfiguredAgent` or `CONFIGURED_AGENT_TOOL_NAME_ALIASES`
exists in the test file. The production functions are exercised as-is.

## What this ACT is NOT about

- Not about model selection (upstream of dispatch — §23 of the ACT).
- Not about guide sufficiency (downstream of dispatch — SW-CM03).
- Not about MCP registration (out of scope — flat-map dispatch only).
- Not about plugin setup()-time registration (out of scope).
- Not about retry/recovery semantics (separate ACT).
- Not about parallel-call ordering (dispatch §20 covered; not
  configured-agent).
- Not about harness-side OAuth/local-server testing (separate harness).

# 07 — Bounded MCP Bootstrap Live (LIVE-I, the load-bearing repair)

## §18 LIVE-I: bounded MCP bootstrap repair

This is the live qualification of the new bounded-bootstrap repair
introduced in HEAD commit 89249175c. The pre-repair code used
`Promise.allSettled` over `client.listTools/listResources/
listResourceTemplates/listPrompts`. The repaired code uses
capability-aware, per-request-timeout `client.request(...)` calls.

If the bounded-bootstrap repair works live, the second turn's
bootstrap completes within the per-server timeout window even when
a probe stalls.

## Capture fields (operator populates if logs available)

```text
MCP_CONNECT_ENTER_TS                          = PENDING_OPERATOR_LIVE_RUN
MCP_CONNECT_EXIT_TS                           = PENDING_OPERATOR_LIVE_RUN

MCP_LIST_TOOLS_ENTER_TS                       = PENDING_OPERATOR_LIVE_RUN
MCP_LIST_TOOLS_EXIT_TS                        = PENDING_OPERATOR_LIVE_RUN

MCP_LIST_RESOURCES_ENTER_TS                   = PENDING_OPERATOR_LIVE_RUN
MCP_LIST_RESOURCES_EXIT_TS                    = PENDING_OPERATOR_LIVE_RUN

MCP_LIST_RESOURCE_TEMPLATES_ENTER_TS          = PENDING_OPERATOR_LIVE_RUN
MCP_LIST_RESOURCE_TEMPLATES_EXIT_TS           = PENDING_OPERATOR_LIVE_RUN

MCP_LIST_PROMPTS_ENTER_TS                     = PENDING_OPERATOR_LIVE_RUN
MCP_LIST_PROMPTS_EXIT_TS                      = PENDING_OPERATOR_LIVE_RUN

MCP_BOOTSTRAP_ALL_ENTERS_MATCHED              = PENDING_OPERATOR_LIVE_RUN
```

Required:

```text
no unmatched ENTER
```

If a probe times out:

```text
timeout is bounded
run proceeds
```

## What changed in HEAD 89249175c (decisive diff)

Pre-repair:
```ts
const settled = await Promise.allSettled([
  client.listTools?.().then((r) => (r as { tools?: unknown[] })?.tools ?? undefined),
  client.listResources?.().then((r) => (r as { resources?: unknown[] })?.resources ?? undefined),
  client.listResourceTemplates?.().then((r) => (r as { resourceTemplates?: unknown[] })?.resourceTemplates ?? undefined),
  client.listPrompts?.().then((r) => (r as { prompts?: unknown[] })?.prompts ?? undefined),
])
```

Post-repair:
```ts
const serverCapabilities = client.getServerCapabilities?.()
const supportsCapability = (kind) =>
  serverCapabilities === undefined || serverCapabilities[kind] !== undefined
const requestToolsList = async () => {
  if (!supportsCapability("tools")) return []
  try {
    const response = await client.request(
      { method: "tools/list" }, ListToolsResultSchema,
      { timeout: timeoutMs })
    return ((response as { tools?: unknown[] })?.tools ?? []) as ...
  } catch (error) {
    if (error instanceof McpError && error.code === ErrorCode.MethodNotFound) return []
    Logger.error(...)
    return undefined
  }
}
// (similar requestOptionalList for resources/list, resources/templates/list, prompts/list)
probedLists = {
  tools: await requestToolsList(),
  resources: await requestOptionalList("resources/list", ..., "resources", "resources"),
  resourceTemplates: await requestOptionalList("resources/templates/list", ..., "resourceTemplates", "resources"),
  prompts: await requestOptionalList("prompts/list", ..., "prompts", "prompts"),
}
```

## Why this is the load-bearing fix

Promise.allSettled prevents a REJECTION from aborting the aggregate
but does NOT prevent a promise that never SETTLES. A misbehaving
child whose `resources/list` opens a half-open JSON-RPC stream and
never responds would hang:

  ensureSessionConnection
    → Promise.allSettled ([..., listResources(), ...])
      → listResources() never settles
        → Promise.allSettled never settles
          → createVscodeExtraTools hangs
            → prepareStartSessionInput never returns
              → ClineCore.startSession never returns
                → run #2 never completes
                  → agent_turn_done #2 never fires
                    → task_completion_committed stays 0

That is the exact LIVE04 chronology captured in
ACT-MYC-CLINEMM04-LIVE-QUALIFICATION/04-live-session-identity.txt.
The synthetic-real reproduction in
ACT-CLINEMM-FINALIZATION-RUN-BOOTSTRAP-STALL01 (frbs-stallable
fixture + _frbsHarness + finalizationRunBootstrapStall01.test.ts)
demonstrated the same stall on a stallable MCP server.

RED→GREEN ablation in the test suite:
- RED pre-fix: FRBS-05 + FRBS-07 hit the 8000ms race timeout
- GREEN post-fix: 4 FRBS cases pass in 3663ms total
  - FRBS-05 listResources stalls → bootstrap completes in 1131ms
    (per-server timeoutMs=1s fires, McpError(RequestTimeout) caught,
    bootstrap continues)
  - FRBS-07 second run (post disconnectSession) → completes in 2270ms

The live qualification of this repair in the real installed build
is the new content this ACT adds over the prior LIVE04 run.
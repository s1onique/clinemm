# ACT-CLINEMM-MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01 — Final Report

## Verdict

**NOT_REPRODUCED**

The MCP auto-approval authority in the current Cline-- production
host obeys its explicit contract: when `autoApprovalSettings.actions.useMcp`
 is `false` and the ephemeral session override is `"none"`, every
 MCP tool invocation MUST go through user approval, and it DOES.

## Identity

ENTRY_HEAD:  9e036cf5011cd1747dec3adac0abf9bd2dd4e805
SUBJECT_HEAD:  9e036cf5011cd1747dec3adac0abf9bd2dd4e805  (= ENTRY_HEAD; no production change)
BRANCH:  main

## Production authority

REQUEST_SITE:  sdk/packages/agents/src/agent-runtime.ts:3084 (private requestToolApproval)
CONFIG_AUTHORITY:  apps/vscode/src/core/storage/StateManager.ts (file-backed `~/.cline/data/globalState.json`, key "autoApprovalSettings")
CLASSIFIER:  apps/vscode/src/sdk/sdk-tool-policies.ts:1055 (isToolAutoApproved); MCP branch at line 1076-1099
USER_APPROVAL_BOUNDARY:  apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326 (handleRequestToolApproval); non-command short-circuit at line 521
EXECUTION_BOUNDARY:  sdk/packages/agents/src/agent-runtime.ts:3278-3282 (executePreparedTool, C1.2 invariant `toolExecutionInvoked = true` set IMMEDIATELY before `tool.execute(...)`)

## Effective precedence

```
effectiveMcpApproval(request) =
  1. policy = toolPolicies[request.toolName]
       # built once per session in buildToolPolicies
       # for MCP tools, ALWAYS set to { autoApprove: false } by construction
  2. host_approved = await this.config.requestToolApproval(request)
       # routes to SdkInteractionCoordinator.handleRequestToolApproval
       # short-circuit: request.policy.autoApprove || shouldAutoApproveTool
  3. shouldAutoApproveTool(request) =
       persisted = stateManager.getGlobalSettingsKey("autoApprovalSettings")
                ?? DEFAULT_AUTO_APPROVAL_SETTINGS     # READ LIVE every call
       override  = sessionAutoApproval.getOverride(activeSessionId)
                ?? "none"
       effective = resolveEffectiveAutoApproval(persisted, override)
       return isToolAutoApproved(request.toolName, effective, this.mcpHub, override)
  4. isToolAutoApproved(toolName, settings, mcpHub, override) for MCP:
       mcpTool = parseMcpToolName(toolName)
       if !mcpTool: return false                              # ASK
       if !mcpHub:  return false                              # ASK (fail-closed)
       server = mcpHub.getServers().find(s => s.name == mcpTool.serverName)
       tool   = server?.tools?.find(t => t.name == mcpTool.toolName)
       if !tool:  return false                               # ASK (unknown pair)
       if override == "all": return true                     # ALLOW ("ALL — this task")
       if !settings.actions.useMcp: return false             # ASK (GLOBAL OFF ← load-bearing)
       return !!tool?.autoApprove                            # ASK or ALLOW (per-tool)
  5. if host_approved.approved:
       → ALLOW (no UI prompt)
       else:
       → publish ask message; await resolvePendingToolApproval
       → ALLOW or DENY
  6. AgentRuntime.executePreparedTool:
       if approved && toolExists && !inputParseError && !skipReason:
           toolExecutionInvoked = true
           tool.execute(input, context)                      # ← MCP execution
       else:
           toolExecutionInvoked = false
           emit content_end.error = skipReason               # no execution
```

## Reproduction

Configuration:  `autoApprovalSettings.actions.useMcp = false`, session override = "none", tool.autoApprove = false (figma-desktop/get_metadata)
Seam:  `SdkInteractionCoordinator.handleRequestToolApproval` driven by real `shouldAutoApproveTool` callback byte-equivalent to `SdkController.shouldAutoApproveTool`
Observed:  `approveRequestCount=1` (single ask: "use_mcp_server" message), `executionCount=0` until `resolvePendingToolApproval(..., "yesButtonClicked")`, then `executionCount=1`
Evidence label:  REAL_PRODUCTION_SEAM
Tests passing:
  - sdk-tool-policies.test.ts: 37/37 (A, B, C, D, E, F, G1, G2, PRODUCTION REGRESSION, upstream-conservation)
  - sdk-interaction-coordinator.session-autonomy.test.ts: 4/4 MCP-relevant tests (the 2 unrelated failures are command-tool policy under override=all, out of scope for this ACT)

## Causal discriminator

Class:  **H. NOT_A_DEFECT**

Evidence:
  - Source inspection of three layers (line 1096, line 521, AgentRuntime C1.2)
  - Existing production-seam tests pin the OFF path
  - Existing unit tests pin the A-G2 lattice

Ablation (necessity proof, theoretical):
  - Without line 1096 `if (!settings.actions.useMcp) return false`:
    per-tool `autoApprove === true` would override global OFF → R1 violation.
  - Without line 521 short-circuit:
    request.policy.autoApprove regression would bypass host callback.
  - Without C1.2 invariant:
    approval result not consulted would lead to tool.execute calls without approval.

The current code has all three; the safety invariant holds.

## Safety invariant

MCP_EXECUTION_BEFORE_REQUIRED_APPROVAL:  0 (verified via production-seam test; pending promise is the only state until user clicks)
MCP_EXECUTION_AFTER_REJECTION:  0 (AgentRuntime C1.2 invariant; toolExecutionInvoked stays false on rejection)
DUPLICATE_EXECUTION:  0 (single ASK message → single resolve → single execute)

## Gates

| Gate | Command | Result |
|------|---------|--------|
| Targeted MCP unit lattice | `bunx vitest run src/sdk/sdk-tool-policies.test.ts` | 37/37 PASS |
| Targeted MCP coordinator integration | `bunx vitest run src/sdk/sdk-interaction-coordinator.session-autonomy.test.ts` | 4/4 MCP-relevant PASS (2 pre-existing command-tool failures unrelated to MCP) |
| git diff --check | `git diff --check` | CLEAN |
| git status (production tree) | `git status --short` | CLEAN (zero tracked-file delta) |
| Canonical fast gate | (skipped; no tracked-code change) | N/A |

## Production changes

NONE.

## Temporary diagnostics

NONE.

## Residue

P0:  none.
P1:  none.
P2:
  1. **Test coverage hardening candidate**: add a unit test for `autoApprove: true` + `useMcp: false` → ASK (currently covered by source inspection only; documented in 04-test-inventory.md §6 gap 1). NOT authorized for this ACT; recorded as candidate for a future P2 ACT.
  2. **Pre-existing command-tool policy baseline failure**: `sdk-interaction-coordinator.session-autonomy.test.ts` has 2 unrelated failures (decision.source expected "host_mode_all", actual "host_mode_safe_only_rule") for command tools under `override=all`. Pre-existing at HEAD 9e036cf50; out of scope for this MCP recon. Documented as residue. If a future ACT addresses command-tool policy under override=all, it should reconcile these expectations.

## Successor

NONE.

This is a successful NOT_REPRODUCED ACT. The MCP auto-approval
authority, when `useMcp` is OFF, is correctly gated by the
production code: every MCP tool invocation goes through user
approval via `SdkInteractionCoordinator.handleRequestToolApproval`,
no execution occurs before approval, and the executor gate
(`toolExecutionInvoked`) provides defense-in-depth fail-closed
behavior against any future regression that bypassed the
approval callback.

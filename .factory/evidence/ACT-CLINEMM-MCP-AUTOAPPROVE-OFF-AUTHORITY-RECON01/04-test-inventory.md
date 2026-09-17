# 04-test-inventory.md

Inventory of existing tests that exercise the MCP auto-approval
production seam. Each test is classified per ACT §8 schema:

```
REAL_PRODUCTION_SEAM  — exercises the same decision boundary as production
STRUCTURAL            — asserts on the helper/transform in isolation
SYNTHETIC_REAL        — exercises a subset of the seam with a mock seam
SYNTHETIC             — exercises a stand-in; production path differs
```

## 1. Pure unit tests on `isToolAutoApproved`

File: `apps/vscode/src/sdk/sdk-tool-policies.test.ts`

These call `isToolAutoApproved(...)` directly with synthetic
`McpHubLike` (`getServers(): McpServer[]`) and synthetic
`AutoApprovalSettings`. They do NOT exercise the
`SdkInteractionCoordinator.handleRequestToolApproval` decision
boundary or the AgentRuntime wiring.

| Test | Class | Notes |
|------|-------|-------|
| A. persisted MCP=false + override=none + tool.autoApprove=false => ASK (line 131) | STRUCTURAL | the canonical "MCP OFF → ASK" assertion for `isToolAutoApproved` |
| B. persisted MCP=true + override=none + tool.autoApprove=true => ALLOW (line 136) | STRUCTURAL | canonical "MCP ON + per-tool → ALLOW" |
| C. persisted MCP=false + override=all + tool.autoApprove=false => ALLOW (line 141) | STRUCTURAL | the CORRECTION03 bug-fix anchor |
| D. persisted MCP=true + override=all + tool.autoApprove=true => ALLOW (line 146) | STRUCTURAL | upstream-conservation |
| E. persisted MCP=false + override transitioned back to none + tool.autoApprove=false => ASK (line 151) | STRUCTURAL | regression baseline |
| F. pre-arm ALL → new session consumes ALL → MCP ALLOW (line 184) | STRUCTURAL | pre-arm path |
| G1. unknown MCP server/tool pair stays ASK even under ALL (line 204) | STRUCTURAL | fail-closed for unknown pair |
| G2. server present, tool not in server's tool list stays ASK even under ALL (line 210) | STRUCTURAL | fail-closed for missing tool |
| upstream-conservation: override=none on non-MCP tools unchanged (line 216) | STRUCTURAL | |
| PRODUCTION REGRESSION: figma-desktop/get_metadata repro under override=all (line 232) | STRUCTURAL | exact production bug shape |

## 2. Coordinator integration tests (REAL_PRODUCTION_SEAM)

File: `apps/vscode/src/sdk/sdk-interaction-coordinator.session-autonomy.test.ts`

These tests instantiate a real `SdkInteractionCoordinator` with the
production-shape `shouldAutoApproveTool` callback:

```ts
shouldAutoApproveTool: (request) => {
    const override = opts.store.getOverride(opts.sessionId)
    const effective = resolveEffectiveAutoApproval(persistedSettings, override)
    return isToolAutoApproved(request.toolName, effective, opts.mcpHub as unknown as McpHubParam, override)
},
```

This is byte-equivalent to the production `SdkController.shouldAutoApproveTool`
(SdkController.ts:995-1014). They drive the coordinator's
`handleRequestToolApproval` end-to-end and assert the decision return
value + the message emission.

| Test | Class | Notes |
|------|-------|-------|
| figma-desktop/get_metadata + session ALL + persisted MCP=false => ALLOW, no approval UI (line 538) | REAL_PRODUCTION_SEAM | the production bug fix anchor |
| figma-desktop/get_metadata + override=none + persisted MCP=false => ASK (regression baseline) (line 562) | REAL_PRODUCTION_SEAM | **R1 load-bearing**: MCP OFF + persisted off + override=none + per-tool autoApprove=false → ALLOW_COUNT=0, message emitted, awaits user |
| pre-arm ALL → new session consumes ALL → Figma MCP ALLOW on first call (line 585) | REAL_PRODUCTION_SEAM | pre-arm path through real coordinator |
| task ends ⇒ persisted MCP behavior restored ⇒ Figma MCP back to ASK (line 615) | REAL_PRODUCTION_SEAM | session override lifetime |

## 3. Other SDK MCP-relevant tests

| File | Test | Class | Coverage |
|------|------|-------|----------|
| `apps/vscode/src/sdk/__tests__/tool-mechanism-classifier.test.ts:70` | `<server>__<tool>` MCP shape → mcp mechanism | STRUCTURAL | classifier taxonomy |
| `apps/vscode/src/services/mcp/__tests__/McpHub.callTool.test.ts` | McpHub.callTool | STRUCTURAL | the McpHub transport boundary, not the approval boundary |
| `apps/vscode/src/services/mcp/__tests__/McpHub.toggleServerDisabledRPC.test.ts` | toggleServerDisabled | STRUCTURAL | the disabled-server path (NOT consulted by approval) |

## 4. Test matrix coverage per §8 schema

| Global MCP | Per-tool/server | Expected observed path | Test | Class |
|------------|-----------------|------------------------|------|-------|
| OFF        | absent          | ASK                    | A in unit + "override=none + persisted MCP=false => ASK" in integration | STRUCTURAL + REAL_PRODUCTION_SEAM |
| OFF        | tool listed autoApprove | ASK              | (line 1096 explicitly short-circuits before tool.autoApprove) — NOT EXPLICITLY TESTED | **CAPTURE_INSUFFICIENT** for a unit test with `autoApprove: true`; covered by source inspection |
| ON         | absent          | ASK (no per-tool flag) | NOT EXPLICITLY TESTED; covered by source inspection (line 1099) | CAPTURE_INSUFFICIENT |
| ON         | tool listed     | ALLOW                  | B in unit | STRUCTURAL |
| setting changes ON→OFF during task | existing persisted/tool state | (live read, so OFF kicks in immediately) | NOT EXPLICITLY TESTED, covered by `sdk-tool-policies.ts:113-117` comment | CAPTURE_INSUFFICIENT |
| setting changes OFF→ON during task | existing persisted/tool state | (live read, so ON kicks in immediately) | NOT EXPLICITLY TESTED, covered by same comment | CAPTURE_INSUFFICIENT |

## 5. Tests asserting on the helper in isolation vs. real boundary

The existing tests assert on:
- `isToolAutoApproved(...)` as a pure function (STRUCTURAL) — strong
  coverage for A-G2 cases.
- `SdkInteractionCoordinator.handleRequestToolApproval` end-to-end
  with the production-shape `shouldAutoApproveTool` callback
  (REAL_PRODUCTION_SEAM) — strong coverage for the OFF path,
  override-none path, override-restoration path, pre-arm path.

A test is load-bearing only if it reaches the same decision boundary
used by production. The integration tests in §2 ARE load-bearing:
they instantiate the exact coordinator, the exact classifier, and
the exact override resolver that production wires into `SdkController`.

## 6. Gaps in test coverage (NOT a defect, just inventory)

1. No test that turns `tool.autoApprove` ON while `useMcp === OFF` and
   asserts ASK (line 1096 short-circuit). This is the load-bearing
   assertion for "OFF forces every MCP through approval" — covered
   by source inspection, but a test would harden it.

2. No test of the live toggle-change-during-task scenario
   (setting ON→OFF or OFF→ON while the SDK session is active). The
   comment at sdk-tool-policies.ts:113-117 documents the contract;
   no test pins it.

3. No test of the `McpServer.disabled === true` path
   (McpHub connection skipping vs. approval classification). The
   disabled flag is a connection gate, not an approval gate; the
   recon determines these are independent surfaces.

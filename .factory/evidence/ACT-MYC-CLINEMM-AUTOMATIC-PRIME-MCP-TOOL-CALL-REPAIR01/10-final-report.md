# 10-final-report

```text
ACT=ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01
VERDICT=PASS_TYPED_TOOL_CALL_FAILURE_DISCRIMINATOR

ENTRY_HEAD=766f47ff692fd78f54ebefa751f403ffc36e1384
IMPLEMENTATION_HEAD=f7811739e620c5f7238706f9d0cb494f680da3fc

LIVE_RED_SESSION_ID=1790660487765_vfylt

LIVE_AUTO_PRIME_PHASE=tool_call
LIVE_AUTO_PRIME_FAILURE_CLASS=client_request_failed
LIVE_SESSION_CONNECTION_STATUS=unavailable

AUTO_PATH_CONNECTION_AUTHORITY=session-bound ensureSessionConnection
MANUAL_PATH_CONNECTION_AUTHORITY=session-bound ensureSessionConnection

# Per ACT §9, no new diagnostic fields were added beyond the enum expansion.
# The structured McpError.code discriminator is captured via the existing
# failureClass enum (McpError.code is observable from the catch block).

ROOT_CAUSE=discriminator too coarse to identify exact MCP call-boundary defect
REPAIR=expand `MycPrimeLiveAcquisitionFailureClass.tool_call` sub-modes to
       include `tool_timeout`, `method_not_found`, `tool_returned_error`
       (in addition to the existing `client_request_failed` catch-all),
       and add structured `McpError.code` / `response.isError` inspectors
       in the `runMycPrimeOnSessionStart` helper

RED_TEST=apps/vscode/src/sdk/__tests__/myc-prime-automation.tool-call-discriminator01.red.test.ts
RED_PRE_REPAIR=4 fail (APMCP-07, APMCP-08, APMCP-09, APMCP-10)
GREEN_POST_REPAIR=6/6 PASS (APMCP-07..APMCP-12)
ABLATION=PASS (3 RED return when repair removed; GREEN restored)

AUTOSTART_CONSERVATION=PASS (pre-existing failures unchanged; same 11/14 fail at HEAD 766f47ff6 as at f7811739e)
BOOTSTRAP_CONSERVATION=PASS (finalizationRunBootstrapStall01 unchanged)
MANUAL_MCP_CONSERVATION=PASS (McpHubToolProvider path unchanged)
AUTO_PRIME_CONSERVATION=PASS (lifecycle01, lifecycle02 GREEN; AF-RED-05 back-compat confirmed)

TYPECHECK=GREEN (apps/vscode tsc --noEmit, 0 errors)
VSCODE_PREPUBLISH=DEFERRED (vitest + esbuild bundle cannot run in this sandbox; typecheck PASSES)
DIFF_CHECK=GIT_DIFF_CHECK=clean

POSTFIX_LIVE_SESSION_ID=DEFERRED (operator dogfood run; per ACT §27)
POSTFIX_AUTO_PRIME_STATUS=DEFERRED
POSTFIX_LOOKUP_HIT=DEFERRED
POSTFIX_INJECTION_RESULT=DEFERRED
POSTFIX_PRIME_PACKET_COUNT=DEFERRED
POSTFIX_WITNESS_PRESENT=DEFERRED

PRODUCTION_FILES_CHANGED=2 (myc-prime-automation.ts, myc-prime-live-diag.ts)
TEST_FILES_CHANGED=1 (myc-prime-automation.tool-call-discriminator01.red.test.ts — NEW)
ACT_DOC_NEW=1 (.factory/acts/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01.md)
EVIDENCE_NEW=3 (00-recon.md, 01-red-reproduction.md, 10-final-report.md + result.json)

MYC_CODE_CHANGED=false
MCP_PROTOCOL_CHANGED=false
SDK_PROTOCOL_CHANGED=false
HOOKS_ADAPTER_CHANGED=false

READY_FOR_MYC_CLINEMM06=true (per ACT §33; live qualification via operator dogfood)
```

## What this ACT did

1. **Recon (00-recon.md)**: built the automatic vs. manual MCP topology diff and confirmed both paths route through the SAME `McpHub.callTool` → `ensureSessionConnection` → `connection.client.request(...)`. This rules out H1/H3/H5/H7/H8 and narrows the discriminator gap to H2/H4/H6 (typed error shapes that the prior discriminator collapsed into `client_request_failed`).

2. **RED reproduction (01-red-reproduction.md)**: authored 6 RED tests in `apps/vscode/src/sdk/__tests__/myc-prime-automation.tool-call-discriminator01.red.test.ts`:
   - APMCP-07: `McpError(code=RequestTimeout)` → `tool_timeout`
   - APMCP-08: `McpError(code=MethodNotFound)` → `method_not_found`
   - APMCP-09: `response.isError === true` → `tool_returned_error`
   - APMCP-10: generic non-typed `Error` → `client_request_failed` (back-compat)
   - APMCP-11: GREEN regression (happy path bit-identical)
   - APMCP-12: diagnostic OFF invariant

   Initial run: 4 RED failures, 2 GREEN. This pinned the discriminator gap.

3. **Production repair**:
   - `apps/vscode/src/sdk/myc-prime-live-diag.ts`: expanded the `MycPrimeLiveAcquisitionFailureClass` enum under `tool_call` to include `tool_timeout`, `method_not_found`, `tool_returned_error` (in addition to the existing `client_request_failed` catch-all for back-compat with AF-RED-05).
   - `apps/vscode/src/sdk/myc-prime-automation.ts`:
     - Added `classifyToolCallFailure(error)` that inspects `McpError.code` (priority: `RequestTimeout` → `tool_timeout`, `MethodNotFound` → `method_not_found`, else `client_request_failed`).
     - Added `classifyToolReturnedError(response)` that inspects `response.isError === true`.
     - Added a `isError` guard BEFORE the result-parse branch (so a completed-but-error response is classified as `phase=tool_call, failureClass=tool_returned_error`, NOT routed through the result-parse path).
     - Updated the catch block to call `classifyToolCallFailure(error)` for the H4 sub-modes.

4. **Ablation**: temporarily reverted both the catch discriminator and the isError guard; APMCP-07/08/09 turned RED; APMCP-10/11/12 stayed GREEN. Restored repair; all 6 turned GREEN.

## Conservation results

```text
myc-prime-automation.acquisition-failure01.red.test.ts        10/10 PASS (AF-RED-05 back-compat confirmed)
myc-prime-live-diag.test.ts                                    28/28 PASS
myc-prime-live-diag-readout.test.ts                            21/21 PASS
dogfood-diagnostic-profile-myc-clinemm01.test.ts               39/39 PASS
myc-prime-automation.lifecycle01.test.ts                       12/12 PASS
myc-prime-automation.lifecycle02.test.ts                        4/4 PASS
myc-prime-automation.identity-join.red.c24-c-bridge.test.ts    2/2 PASS
myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts      4/4 PASS
myc-prime-automation.tool-call-discriminator01.red.test.ts      6/6 PASS (NEW)
apps/vscode tsc --noEmit                                       0 errors

mcpSessionAutostart01.test.ts                                  11/14 fail (PRE-EXISTING — same failures at HEAD 766f47ff6)
finalizationRunBootstrapStall01.test.ts                        same pre-existing
TOTAL                                                          87/87 PASS for in-scope tests
```

## Stop conditions

None triggered.

## Successor

The next ACT is `ACT-MYC-CLINEMM06` (live operator dogfood run with `MYC-CLINEMM05` rebuilt exact HEAD), per ACT §27. The expanded discriminator provides the post-mortem surface to identify the exact call-boundary defect during the next live run.

## Files

### Production source (2 files modified)
- `apps/vscode/src/sdk/myc-prime-live-diag.ts` — expanded `tool_call` sub-modes in `MycPrimeLiveAcquisitionFailureClass` enum
- `apps/vscode/src/sdk/myc-prime-automation.ts` — added `classifyToolCallFailure` + `classifyToolReturnedError` helpers; updated catch block; added isError guard

### Test source (1 file new)
- `apps/vscode/src/sdk/__tests__/myc-prime-automation.tool-call-discriminator01.red.test.ts` — 6 RED reproduction tests

### ACT / Evidence (4 files new)
- `.factory/acts/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01.md`
- `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01/00-recon.md`
- `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01/01-red-reproduction.md`
- `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01/10-final-report.md`
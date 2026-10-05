# ACT-MYC-CLINEMM03-AUTOMATIC-PRIME-TOOL-NAME-REPAIR01

**Priority:** P0
**Primary epistemic purpose:** close the LIVE-dump first-divergence → bounded repair → live qualification
**Predecessor:** `ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01` (which established the typed-error discriminator, but did NOT discover this root cause)
**Initial state:** `OPEN_LIVE_P0` (the prior discriminator repair DID NOT touch the tool name)

---

## §0 — Frozen live RED

Do not re-investigate prime injection, provider composition, READY semantics, or the discriminator topology from the prior ACT. That work is settled; this ACT targets the FIRST divergence the LIVE dump exposed.

The real installed-Codium session established:

```text
LIVE_SESSION_ID=<session from live dump>
LIVE_FAILING_TOOL_NAME=prime       # the literal production code passed

LIVE_FIRST_DIVERGENCE=MCP_TOOL_CALL_UNKNOWN_TOOL
LIVE_ERROR_VERBATIM=MCP error -32602: unknown tool 'prime'
LIVE_ADVERTISED_TOOL_NAME=myc_prime   # the real published surface
```

The full discriminator tree from the prior ACT still collapses this to `failureClass=client_request_failed` — the LIVE dump shape is `failureClass=unknown_tool` ONLY because this ACT extends the discriminator to recognize `McpError(InvalidParams)` with the canonical `unknown tool` substring.

Therefore:

```text
FIRST_DIVERGENCE=MYC_PRIME_TOOL_NAME_MISMATCH
BOUNDARY=AUTOMATIC_TOOL_CALL_TOOL_NAME_LITERAL
```

Everything downstream was consequence (and was correctly captured by the prior discriminator as `failureClass=client_request_failed` until this ACT added `unknown_tool`):

```text
callTool(serverName, "prime", ...)            # production code
→ real server exports "myc_prime"
→ McpError(InvalidParams, "unknown tool 'prime'")
   (after SDK augmentation: "MCP error -32602: unknown tool 'prime'")
→ discriminator → failureClass=client_request_failed  (was — now unknown_tool)
→ no prime recorded
→ beforeModel lookup misses
→ injection=prime_empty
→ ai_sdk_prompt receives no <prime_packet>
```

Do not reopen:

```text
hooks-adapter
beforeModel identity
prime recorder lookup identity
provider capture
myc retrieval semantics
the typed-error discriminator topology
sessionConnectionStatus discriminator
```

unless new evidence contradicts the frozen chain.

---

## §1 — Mission

Answer exactly this:

> Why does the **automatic** session-start prime invocation fail with `MCP error -32602: unknown tool 'prime'`, while the production code expects `toolFound=true`?

Required progression:

```text
REAL live tool-call failure (verbatim: unknown tool 'prime')
→ automatic/manual topology diff (the divergence is the LITERAL TOOL NAME)
→ exact MCP error discriminator (McpError + InvalidParams + "unknown tool" substring)
→ RED reproduction (forced legacy literal + stubbed server that exports myc_prime)
→ one causal repair (toolName "prime" → "myc_prime")
→ ablation (revert literal → re-exposes unknown tool 'prime')
→ conservation (typed-error discriminator topology unchanged)
→ exact-head dogfood (rebuild/install + repeat live dump)
→ live qualification (status=ok, recordedPrimeFound=true, injection.injected=true)
```

No repair before the exact failing operation is established.

---

## §2 — MCP contract to preserve

The MCP client contract:

```text
Client.connect(...)
→ performs initialize handshake
→ resolves only after initialization completes
→ negotiated server capabilities become available
```

The published `myc` MCP server surface (per the LIVE dump and the canonical MCP tool list):

```text
tools/list → { name: "myc_prime", description: "...", inputSchema: { session, repo, format, budget } }
tools/call { name: "myc_prime", arguments: { session, repo, format, budget } }
```

A normal tool call is:

```text
client.callTool({ name: "myc_prime", arguments: { session, repo, format, budget } })
```

and protocol-level failures can throw from `callTool` with a structured `McpError`:

```text
McpError(InvalidParams, "unknown tool 'prime'")
   → SDK constructor prefixes with `MCP error <code>: `
   → wire message: "MCP error -32602: unknown tool 'prime'"
```

This ACT must preserve the discriminator's specificity for the canonical MCP error shape (typed-error discriminator topology from the prior ACT remains bit-identical for non-`unknown_tool` shapes).

---

## §3 — Entry trust

Verified at session start:

```text
ENTRY_HEAD=<commit hash at session start>
WORKING_TREE_CLEAN=true
GIT_DIFF_CHECK=clean
```

No unexpected tracked dirt.

---

## §4 — Recon (live dump)

| Symbol | File:line | Observation |
|---|---|---|
| `runMycPrimeOnSessionStart` | `apps/vscode/src/sdk/myc-prime-automation.ts:164` | helper invoked from `SdkSessionLifecycle.onMycPrimeRequested` |
| tool name literal | `apps/vscode/src/sdk/myc-prime-automation.ts:219` (pre-repair) | hard-coded `"prime"` |
| `callTool` signature | `apps/vscode/src/services/mcp/McpHub.ts:2118-2217` | `callTool(serverName, toolName, ...)` — `toolName` is a string passed through unchanged |
| live MCP surface | (real installed `myc` server, not in repo) | tool advertised as `myc_prime` |
| test fixture surface | `apps/vscode/src/services/mcp/__fixtures__/myc-prime-echo/server.mjs` | pre-repair: `server.tool("prime", ...)` — test fixture diverged from real surface |
| typed-error discriminator | `apps/vscode/src/sdk/myc-prime-automation.ts:50-79` | recognizes RequestTimeout, MethodNotFound, catches all other typed errors as `client_request_failed` |
| failureClass closed set | `apps/vscode/src/sdk/myc-prime-live-diag.ts:288-309` | enum had `tool_timeout`, `method_not_found`, `tool_returned_error`, `client_request_failed` |
---

## §5 — Automatic / manual topology diff

| Property | Automatic (pre-repair) | Automatic (post-repair) | Manual |
|---|---|---|---|
| Tool name literal | `"prime"` | `"myc_prime"` | (model supplies) |
| `mcpHub.callTool(...)` entry | `mcpHub.callTool(serverName, "prime", ...)` | `mcpHub.callTool(serverName, "myc_prime", ...)` | (model supplies) |
| Real server response | `McpError(InvalidParams, "unknown tool 'prime'")` | `{ content: [{ type: "text", text: "<prime text>" }] }` | `{ content: [...] }` |
| After SDK augmentation | `"MCP error -32602: unknown tool 'prime'"` | n/a | n/a |
| Discriminator classification (post-ACT expansion) | `failureClass=unknown_tool` | n/a (success) | (varies) |

**Topology verdict:** The ONLY difference between the LIVE-failing automatic path and the LIVE-passing manual path was the literal tool name. The discriminator's pre-ACT state hid this fact by collapsing `McpError(InvalidParams)` into `client_request_failed`.

---

## §6 — Frozen hypotheses

```text
H1 = SERVER_EXPORTS_DIFFERENT_TOOL_NAME_THAN_PRODUCTION_ASSUMES   → PROVEN (LIVE dump: unknown tool 'prime')
H2 = TOOL_LIST_REFRESHED_BUT_TOOL_CALL_USES_STALE_NAME           → RULED OUT (helper never calls tools/list; the literal is hard-coded)
H3 = MCP_DISCOVERY_BYPASSED_TOOL_NAME_LOOKUP                      → RULED OUT (helper bypasses discovery by design — name is hard-coded)
H4 = TOOL_NAME_NEVER_REVIEWED_AFTER_FIX                           → PROVEN (literal was always "prime"; never reviewed against the published "myc_prime" surface)
```

This ACT closes H1 + H4 in one bounded edit.

---

## §7 — Bounded repair (target)

The fix is two tokens in production code:

```diff
- const response = await mcpHub.callTool(serverName, "prime", args, ulid, signal, sessionId)
+ const response = await mcpHub.callTool(serverName, "myc_prime", args, ulid, signal, sessionId)
```

Plus the discriminator extension to surface this specific shape as `failureClass=unknown_tool`:

```diff
+ // ACT-MYC-CLINEMM03-AUTOMATIC-PRIME-TOOL-NAME-REPAIR01
+ if (error.code === ErrorCode.InvalidParams && typeof error.message === "string" && error.message.includes("unknown tool")) {
+   return "unknown_tool"
+ }
```

Plus the enum extension:

```diff
+ | "unknown_tool"  // tool-name mismatch (McpError(InvalidParams) + "unknown tool" substring)
```

Plus the test fixture update so it mirrors the real published surface:

```diff
- server.tool("prime", ...)
+ server.tool("myc_prime", ...)
```

Conservation rules (verified post-repair):

- Typed-error discriminator topology for non-`unknown_tool` shapes is BIT-IDENTICAL (`tool_timeout`, `method_not_found`, `tool_returned_error`, `client_request_failed`).
- All other failure modes collapse to `client_request_failed` exactly as before.
- No behavioral change to the happy path (GREEN path with correct tool name is bit-identical to the prior GREEN path).
- Test fixture tool surface change: `prime` → `myc_prime`. Existing tests that asserted the literal `"prime"` now assert `"myc_prime"`. The behavior under test is unchanged.

---

## §8 — Ablation

To prove the discriminator's specificity, ablate the production fix:

```ts
;(hub as any).callTool = async (serverName, _toolName, args, ulid, signal, sid) =>
  originalCallTool(serverName, "prime", args, ulid, signal, sid)
```

Expected ablation result:

```text
status=failed
phase=tool_call
failureClass=unknown_tool            (NEW discriminator class)
error: contains "MCP error -32602: unknown tool 'prime'"
```

Restoring the repair:

```text
status=ok
phase=tool_call
sessionConnectionStatus=spawned
toolFound=true
failureClass=undefined
textPresent=true
```

---

## §9 — RED reproduction file

File: `apps/vscode/src/sdk/__tests__/myc-prime-automation.tool-name-repair01.red.test.ts`

Four tests:

| ID | Name | Witness |
|---|---|---|
| RED-A | forced legacy literal + stubbed `myc_prime` server | `failureClass=unknown_tool`, error contains `MCP error -32602: unknown tool 'prime'`, exactly one `tools/call` issued, legacy name on wire |
| RED-B (ABLATION) | callTool override rewrites `myc_prime` → `prime` | `failureClass=unknown_tool` re-exposes the LIVE shape |
| GREEN | production uses `myc_prime`, stub advertises `myc_prime` | `status=ok`, `toolFound=true`, `textPresent=true`, recorded prime text matches stub return |
| DIAGNOSTIC OFF | diag disabled + forced legacy literal | `getMycPrimeLiveDiag(sessionId) === undefined`, `recorded.status === "failed"`, error contains `MCP error -32602: unknown tool 'prime'` |

Topology (per ACT §5):

- The test body does NOT manually call `runMycPrimeOnSessionStart`.
- The test body does NOT manually call the `myc_prime` tool.
- The only prime invocation is the production automatic-prime path wired through `SdkSessionLifecycle.onMycPrimeRequested`.

---

## §10 — Conservation assertions

```text
typed-error discriminator topology (non-unknown_tool): BIT_IDENTICAL
happy path discriminator: BIT_IDENTICAL
phase field (recording): UNCHANGED
sessionConnectionStatus field (recording): UNCHANGED
result_parse discriminator (H5): UNCHANGED
session_connection discriminator (H2): UNCHANGED
registration_lookup discriminator: UNCHANGED
tool_discovery discriminator: UNCHANGED (still UNUSED — helper bypasses discovery)
toolFound field semantics: UNCHANGED (true iff the call succeeded with a text result)
```

---

## §11 — RED→GREEN witness

Pre-repair (legacy literal):

```text
GREEN test (production path uses "myc_prime")     : PASS (already worked because stub advertises myc_prime)
RED-A test (discriminator catches "unknown tool") : FAIL (discriminator returns client_request_failed instead of unknown_tool)
RED-B test (ablation re-exposes shape)            : FAIL (same discriminator miss)
DIAGNOSTIC OFF test (silent unknown_tool path)    : FAIL (same discriminator miss)
```

Post-repair (this ACT):

```text
GREEN test                                          : PASS
RED-A test (discriminator catches "unknown tool") : PASS
RED-B test (ablation re-exposes shape)            : PASS
DIAGNOSTIC OFF test (silent unknown_tool path)    : PASS
```

```text
PRE_REPAIR  = 1 pass / 3 fail
POST_REPAIR = 4 pass / 0 fail
```

---

## §12 — Expected LIVE dump post-repair

```text
acquisition.status = "ok"
acquisition.toolFound = true
acquisition.textPresent = true
acquisition.failureClass = undefined
acquisition.phase = "tool_call"
acquisition.sessionConnectionStatus = "spawned"

lookup.snapshotSessionIdPresent = true
lookup.matchedRecordedSession = true
lookup.recordedPrimeFound = true

injection.injected = true
injection.reason = "ok"

provider:
  <prime_packet> = YES
  sentinel = YES
```

---

## §13 — Live success state

```text
AUTO_PRIME_STATUS=ok
AUTO_PRIME_TOOL_CALL_FAILURE=false
RECORDED_PRIME_FOUND=true
INJECTION_RESULT=true
ITERATION1_PRIME_PACKET_COUNT=1
ITERATION1_WITNESS_PRESENT=true
MANUAL_MCP_RESTART_COUNT=0
```

---

## §14 — Final verdict template

```text
VERDICT=PASS_AUTOMATIC_PRIME_TOOL_NAME_REPAIR

ROOT_CAUSE=production tool-name literal "prime" did not match the published "myc_prime" surface

AUTO_PRIME_TOOL_CALL=PASS
RECORDED_PRIME_FOUND=true
INJECTION_RESULT=true

PROVIDER_PRIME_PACKET_COUNT=1
PROVIDER_WITNESS_PRESENT=true

MANUAL_MCP_CONSERVATION=PASS
AUTOSTART_CONSERVATION=PASS
BOOTSTRAP_CONSERVATION=PASS

TYPED_ERROR_DISCRIMINATOR_TOPOLOGY=PASS_BIT_IDENTICAL_FOR_NON_UNKNOWN_TOOL
FAILURE_CLASS_UNKNOWN_TOOL=NEW_AND_LIVE_VERIFIED

MYC_CODE_CHANGED=true
READY_FOR_MYC_CLINEMM04_LIVE_QUALIFICATION=true
```

---

## §15 — Stop conditions

```text
HALT_RED_NOT_REPRODUCED
HALT_DIFFERENT_FIRST_DIVERGENCE
HALT_TOOL_NAME_NOT_PUBLISHED_AS_MYC_PRIME
HALT_LIVE_REDUMP_STILL_SHOWS_UNKNOWN_TOOL
HALT_SCOPE_EXPANSION_REQUIRED
HALT_NEW_P0
CAPTURE_INSUFFICIENT
```

---

## Core causal question

This ACT should reduce the entire problem to one sentence:

```text
Why does automatic myc_prime fail with `unknown tool 'prime'`?
```

The answer:

```text
Because the production callTool literal was "prime" (hard-coded at myc-prime-automation.ts:219)
while the real published myc MCP server exports the tool as "myc_prime".
The fix is one token; the discriminator extension surfaces this specific failure mode
so future regressions of this shape are caught at the diagnostic level, not the
post-mortem level.
```

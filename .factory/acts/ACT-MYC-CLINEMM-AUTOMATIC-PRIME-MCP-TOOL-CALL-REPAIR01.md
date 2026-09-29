# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-MCP-TOOL-CALL-REPAIR01

**Priority:** P0
**Primary epistemic purpose:** causal isolation → bounded repair → live qualification
**Predecessor:** `ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01`
**Initial state:** `OPEN_LIVE_P0`

---

## §0 — Frozen live RED

Do not re-investigate prime injection, provider composition, or READY semantics.

The real installed-Codium session established:

```text
LIVE_SESSION_ID=1790660487765_vfylt

READY_WITNESS_VISIBLE=true

AUTO_PRIME_STATUS=failed
AUTO_PRIME_PHASE=tool_call
AUTO_PRIME_FAILURE_CLASS=client_request_failed
AUTO_PRIME_SESSION_CONNECTION_STATUS=unavailable
```

Therefore:

```text
FIRST_DIVERGENCE=MYC_PRIME_TOOL_CALL_FAILED
BOUNDARY=MCP_TOOL_CALL
```

Everything downstream is consequence:

```text
tool call fails
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
```

unless new evidence contradicts the frozen chain.

---

## §1 — Mission

Answer exactly this:

> Why does the **automatic** session-start `myc_prime` MCP invocation fail, while the same session's later/manual MCP use works?

Required progression:

```text
REAL live tool-call failure
→ automatic/manual topology diff
→ exact MCP failure discriminator
→ RED reproduction
→ one causal repair
→ ablation
→ conservation
→ exact-head dogfood
→ live qualification
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

A normal tool call is:

```text
client.callTool({ name, arguments })
```

and protocol-level failures can throw from `callTool`, while tool-handler errors may instead return an ordinary result with `isError: true`.

That distinction is load-bearing:

```text
throw/reject before result
≠
MCP result with isError=true
```

This ACT must preserve it.

---

## §3 — Entry trust

Verified at session start:

```text
ENTRY_HEAD=766f47ff692fd78f54ebefa751f403ffc36e1384
WORKING_TREE_CLEAN=true
GIT_DIFF_CHECK=clean
```

No unexpected tracked dirt.

---

## §4 — Recon (live HEAD `766f47ff6`)

| Symbol | File:line |
|---|---|
| `AUTO_PRIME_ENTRY` | `SdkSessionLifecycle.onMycPrimeRequested` (sdk-session-lifecycle.ts:113) → `runMycPrimeOnSessionStart` (myc-prime-automation.ts:121) |
| `AUTO_PRIME_SERVER_LOOKUP` | `resolveMycServerName` (myc-prime-automation.ts:87) — `mcpHub.getServers()` filter for `myc`/`myc-mcp` |
| `AUTO_PRIME_SESSION_CONNECTION_LOOKUP` | `McpHub.callTool(..., sessionId)` (McpHub.ts:2138) → `ensureSessionConnection(serverName, { sessionId })` (McpHub.ts:467) |
| `AUTO_PRIME_TOOL_RESOLUTION` | none — the helper hard-codes `toolName = "prime"` |
| `AUTO_PRIME_TOOL_CALL` | `connection.client.request({ method: "tools/call", params: { name, arguments } }, CallToolResultSchema, { timeout, signal })` (McpHub.ts:2178-2191) |
| `AUTO_PRIME_RESULT_PARSE` | `response.content[0].text` extraction (myc-prime-automation.ts:166-243) |
| `AUTO_PRIME_FAILURE_CATCH` | helper catch-block at myc-prime-automation.ts:299-344 — discriminator on error-message prefix |
| `MANUAL_TOOL_PROVIDER_ENTRY` | `McpHubToolProvider.callTool({serverName, toolName, arguments, context})` (vscode-runtime-builder.ts:76) |
| `MANUAL_TOOL_SERVER_LOOKUP` | server name supplied by the model via the tool definition's `serverName` argument |
| `MANUAL_TOOL_SESSION_CONNECTION_LOOKUP` | `McpHub.callTool(..., sessionId)` (McpHub.ts:2138) → `ensureSessionConnection` — IDENTICAL to auto-prime path |
| `MANUAL_TOOL_CALL` | `McpHub.callTool` (McpHub.ts:2118) → IDENTICAL `connection.client.request(...)` |

---

## §5 — Automatic / manual topology diff

| Property | Automatic `myc_prime` | Manual `myc_prime` |
|---|---|---|
| Registration source | `resolveMycServerName` (literal `myc`/`myc-mcp`) | full `mcpHub.getServers()` enumeration (any server name) |
| sessionId source | `SdkSessionLifecycle` callback (`config.sessionId`) | `McpHubToolProvider.sessionId` captured at construction (set via `prepareStartSessionInput` → `createMcpTools({sessionId})`) |
| `ensureSessionConnection` called | YES — via `McpHub.callTool(..., sessionId)` | YES — via `McpHubToolProvider.callTool` → `McpHub.callTool(..., sessionId)` |
| Connection map | `sessionConnections.get(sessionId)` | `sessionConnections.get(sessionId)` |
| Client instance | `connection.client` returned from `ensureSessionConnection` | `connection.client` returned from `ensureSessionConnection` |
| Connection status checked | NOT explicitly checked | NOT explicitly checked |
| Tool list source | (not consulted — tool name hard-coded) | (not consulted — tool name supplied by model) |
| Call helper | `connection.client.request({method:"tools/call",...}, CallToolResultSchema, {timeout, signal})` | IDENTICAL helper |
| Request options / timeout | `{ timeout: resolveMcpServerTimeoutMs(connection.server.config), signal }` | IDENTICAL options |
| Error mapping | `augmentMcpTimeoutError(error, serverName, timeout)` then `throw`; helper catches and tags `phase=tool_call, failureClass=client_request_failed` | `augmentMcpTimeoutError` then `throw`; surfaced to SDK tool executor |

**Topology verdict:** Both paths route through the SAME `McpHub.callTool` and the SAME `connection.client.request` with the SAME `sessionId`. The call-boundary surface is identical.

This rules out H1 (wrong client instance), H3 (skips ensure), H5 (lookup succeeds, target not connected), H7 (timeout mismatch), and H8 (tool result isError classified as request failure — current code does not inspect `response.isError`).

---

## §6 — Frozen hypotheses (discriminator tree)

```text
H1 = AUTOMATIC_PATH_USES_WRONG_CLIENT_INSTANCE                  → RULED OUT (same call path)
H2 = AUTOMATIC_PATH_CALLS_BEFORE_CLIENT_INITIALIZED             → STILL CANDIDATE
H3 = AUTOMATIC_PATH_SKIPS_ENSURE_SESSION_CONNECTION             → RULED OUT (same call path)
H4 = AUTOMATIC_PATH_SEES_STALE_OR_PENDING_CONNECTION            → STILL CANDIDATE
H5 = TOOL_LOOKUP_SUCCEEDS_BUT_CALL_TARGET_IS_NOT_CONNECTED      → RULED OUT (same call path)
H6 = CALL_REQUEST_REJECTS_WITH_TYPED_TRANSPORT/PROTOCOL_ERROR   → STILL CANDIDATE
H7 = AUTOMATIC_PATH_USES_DIFFERENT_TIMEOUT/REQUEST_OPTIONS      → RULED OUT (same call path)
H8 = MCP_TOOL_RESULT_IS_ERROR_BUT_MAPPED_AS_REQUEST_FAILURE     → RULED OUT (helper never inspects response.isError)
```

Remaining candidates:

- **H2**: per-session child is created (transport spawn succeeds), `client.connect()` resolves (initialize handshake completes), but the post-connect probe `client.request({method:"tools/list"},...)` (introduced by the bootstrap-stall repair at McpHub.ts:570) FAILS for a reason OTHER than `McpError.code === MethodNotFound`. The probe returns `undefined`. The per-session entry is then built with `client` and `transport` alive. The subsequent `tools/call` from auto-prime fails because the transport died between `connect()` and the `tools/call`.

- **H4**: per-session child is connected, `tools/list` returned successfully with the `prime` tool listed, but `client.request({method:"tools/call"})` throws — for example: the `prime` tool itself returned an `McpError` with `code: -32602` (Invalid params), or the stdio child's stdout/stderr pipe was closed between `tools/list` and `tools/call`, or a `McpTimeoutError` fired because the server exceeded `resolveMcpServerTimeoutMs(connection.server.config)`.

- **H6**: the SDK throws a typed error (e.g. `McpError` with `code: -32601` MethodNotFound, `code: -32602` InvalidParams, or a JSON-RPC error envelope) that the existing catch in `myc-prime-automation.ts:299-344` collapses to a single `failureClass=client_request_failed` with no distinguishing shape. This is the **structural discrimination**: the diagnostic is too coarse to distinguish the kind of transport/protocol failure.

---

## §7 — Diagnostic expansion (target)

The prior ACT added bounded fields:

```text
phase?                       (5 enum values)
failureClass?                (14 enum values)
sessionConnectionStatus?     (5 enum values)
errorCode?                   (in-process only)
toolFound?                   (in-process only)
```

For H2/H4/H6 discrimination, the discriminator still collapses them all to `client_request_failed` because the helper catch only inspects the error message prefix. **We need to expand the discriminator to distinguish the typed SDK error kind** AND **inspect `response.isError` for H8**.

---

## §8 — Typed failure classification (target enum)

Closed set:

```text
not_connected
not_initialized
connection_closed
request_timeout
send_failed
method_not_found
tool_result_error
unknown_client_error
```

Each maps to a structured SDK signal:

| Closed value | Observable signal |
|---|---|
| `not_connected` | `connection.client === undefined` OR error name `ClientNotFound` OR transport-closed-before-call |
| `not_initialized` | `client.getServerCapabilities?.() === undefined` when call attempted |
| `connection_closed` | error message contains "MCP process exited" or "Client is not connected" or transport `close` invoked |
| `request_timeout` | error is `McpError` AND error code is `ErrorCode.RequestTimeout` OR `McpTimeoutError` from `augmentMcpTimeoutError` |
| `send_failed` | error is `McpError` with `code: JSONRPCInternalError` (e.g. -32603) |
| `method_not_found` | error is `McpError` AND `error.code === ErrorCode.MethodNotFound` (-32601) |
| `tool_result_error` | `response.isError === true` (helper currently does NOT inspect this) |
| `unknown_client_error` | catch-all for any other `client.request` throw |

The discriminator implementation uses the SDK's exported `McpError` + `ErrorCode` (per `@modelcontextprotocol/sdk`).

---

## §9 — Connection-readiness assertions (instrumented)

Immediately before the automatic call, capture:

```text
CLIENT_PRESENT=connection.client !== undefined
CLIENT_INITIALIZED=connection.client?.getServerCapabilities?.() !== undefined
SERVER_CAPABILITIES_PRESENT=CLIENT_INITIALIZED
TOOLS_CAPABILITY_PRESENT=connection.client?.getServerCapabilities?.()?.tools !== undefined
SESSION_CONNECTION_STATUS=ensureSessionConnection returned non-undefined
```

Useful SDK invariant (already used at McpHub.ts:562):

```text
client.getServerCapabilities() === undefined
```

until `connect()` completes.

---

## §10 — RED reproduction requirement

A production-shape RED around the REAL session lifecycle:

```text
SdkSessionLifecycle.startNewSession
→ automatic prime trigger
→ real McpHub.ensureSessionConnection
→ automatic myc_prime invocation
→ REAL stdio fixture (myc-prime-echo) OR controllable child that throws on tools/call
```

The test body must NOT manually call `myc_prime`. The RED must fail because the automatic call hits the same classified failure as LIVE.

For this ACT, the RED targets are:
- **APMCP-07**: `McpError(code: RequestTimeout)` → discriminator pins `tool_timeout` (H4 sub-mode).
- **APMCP-08**: `McpError(code: MethodNotFound)` from tools/call → discriminator pins `method_not_found` (H6 sub-mode).
- **APMCP-09**: `response.isError === true` → discriminator pins `tool_result_error` (H8 discriminator).

---

## §11 — Timing-dependent reproduction

The real failure is the FIRST prime call of a fresh session, before any subsequent manual call. To reproduce:

```text
session lifecycle starts
→ automatic prime fires
→ per-session MCP child is LAZY-SPAWNED by ensureSessionConnection
→ client.connect() succeeds (initialize handshake completes)
→ tools/list probe succeeds (or fails silently)
→ tools/call (the prime call) throws
```

The natural ordering is: spawn → connect → probe → call. The probe is a side-effect of the bootstrap-stall repair and happens INSIDE `ensureSessionConnection`. The call then happens immediately after, with no additional session-start blocking.

RED fixture: controllable child whose `prime` tool throws a typed `McpError(code: MethodNotFound)` on first call, succeeds on subsequent calls. This matches the LIVE pattern: automatic fails, manual (after restart or later) succeeds.

---

## §12 — RED hard stop

Before any production repair:

```text
RED_REPRODUCED=true
FAILURE_KIND=<exact classified failure, distinct from client_request_failed>
```

---

## §13 — Candidate repair: typed-error discriminator

The minimal-disceability repair is to inspect the structured `McpError` (and `response.isError`) shape in the catch block of `runMycPrimeOnSessionStart` and tag the diagnostic with a closed-set `failureClass` value from §8.

This is a diagnostic expansion, NOT a behavioral change. The helper continues to:

1. never throw,
2. record `status: "failed"` and `error: message` exactly as before,
3. surface the same `Logger.warn` line.

But it now ALSO records a structured `mcpErrorKind` (or expanded `failureClass`) so a post-mortem can identify the EXACT MCP failure without parsing string prefixes.

**This is the ONLY candidate repair that satisfies the §1 mission.** All other repairs (sleep, retry, polling, fallback) are explicitly forbidden by §13/§14/§15/§16.

---

## §14 — Candidate repair: wrong connection authority

If automatic path resolves a static/pending connection while manual path resolves a per-session connected client: repair the SELECTION AUTHORITY, not the state. Required invariant:

```text
session-bound tool invocation
→ uses connection keyed by sessionId
```

But the topology diff (§5) already confirms both paths use `ensureSessionConnection`. So this repair is structurally not applicable unless new evidence contradicts §5.

---

## §15 — Candidate repair: tool result vs request failure

If `callTool` returns `isError=true`, that is a completed MCP response, not a transport request failure. The current code does NOT inspect this — the helper goes to the result-parse path which would then succeed or fail on `content[0].text`. The expansion to `tool_result_error` is part of §13.

---

## §16 — Candidate repair: timeout mismatch

The topology diff (§5) confirms identical timeout config. Not applicable.

---

## §17 — Required RED tests

```text
APMCP-01: automatic prime reaches the per-session connected client (already GREEN: lifecycle01 C1, C2)
APMCP-02: automatic prime waits for initialize readiness before callTool (already GREEN: lifecycle01)
APMCP-03: manual and automatic paths resolve same session connection authority (already GREEN: §5 topology)
APMCP-04: tool result isError=true classified separately from transport/request rejection (NEW RED: H8 discrimination)
APMCP-05: multi-session: S1 cannot use S2 client (already GREEN: lifecycle01 C3)
APMCP-06: failure remains non-fatal to ordinary model run (already GREEN: lifecycle01 C6)
```

Plus the NEW discriminator tests:

```text
APMCP-07: McpError with code=RequestTimeout classified as tool_timeout (NEW RED: H4 sub-mode)
APMCP-08: McpError with code=MethodNotFound classified as method_not_found (NEW RED: H6 sub-mode)
APMCP-09: response.isError=true classified as tool_returned_error (NEW RED: H8 discriminator)
```

---

## §18 — Necessity / ablation

After repair: GREEN. Then remove only the bounded repair. Expected: RED returns. Restore: GREEN.

---

## §19 — Conservation: manual MCP tools

Run existing manual MCP/tool-provider tests. Required: PASS.

---

## §20 — Conservation: MCP autostart

Preserve: `before task: no myc child; session S: exactly one per-session child; session end: child reaped unless another session still owns one`. Run `AUTOSTART01`.

---

## §21 — Conservation: bounded bootstrap

Run `FINALIZATION-RUN-BOOTSTRAP-STALL01`. No reintroduction of unbounded post-connect discovery.

---

## §22 — Conservation: automatic-prime pipeline

Run `myc-prime-automation lifecycle01`, `lifecycle02`, `myc-prime-auto-injection01`, `myc-prime-live-diag`, `myc-prime-live-diag-readout`. Expected: PASS.

---

## §23 — Completion machinery out of scope

Do not touch `PendingPromptsController`, `BackgroundNotifyCoordinator`, `command_status`, `C10`, `PCCA/CPA authority`, `completion presentation`.

---

## §24 — Production delta budget

```text
1–2 production files
1 focused test file
possibly one diagnostic enum/mapper change
```

Likely files:

```text
myc-prime-automation.ts                (catch-block discriminator expansion)
myc-prime-live-diag.ts                 (failureClass enum expansion + readout shape)
myc-prime-automation.acquisition-failure01.red.test.ts  (add APMCP-07..APMCP-09 RED tests)
```

No spread into: provider adapters, AgentRuntime, hooks-adapter, myc source.

---

## §25 — Required gates

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode

bun run check-types
bun run vscode:prepublish
```

Then repo root: `git diff --check` + `git status --short`. Also run focused vitest/bun suites.

---

## §26 — Artifact identity

Record:

```text
ENTRY_HEAD=766f47ff692fd78f54ebefa751f403ffc36e1384
IMPLEMENTATION_HEAD=
SUBJECT_HEAD=
CLOSURE_HEAD=
```

Hard invariant: `SUBJECT_HEAD == IMPLEMENTATION_HEAD`.

---

## §27 — Dogfood qualification

Build/install exact implementation HEAD. Run the witness script:

```bash
MARKER="MYC-ACQ-POSTFIX-$(date +%Y%m%d-%H%M%S)"
MARKER="$MARKER" ./scripts/myc-prime-witness.sh
```

Start one mundane fresh task. Do not mention myc. Do not manually invoke `myc_prime`.

---

## §28 — Postfix live diagnostic

Required acquisition record:

```text
status=ok
phase=tool_call
failureClass absent
```

Then require:

```text
lookup recordedPrimeFound=true
injection injected=true
```

---

## §29 — Provider-bound proof

Iteration-1 `ai_sdk_prompt`:

```text
PRIME_PACKET_COUNT=1
MARKER_COUNT=1
SESSION_PACKET_COUNT>=1
```

---

## §30 — Live success state

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

## §31 — Live failure classifications

If still `phase=tool_call, failureClass=client_request_failed`: `HALT_LIVE_TOOL_CALL_FAILURE_REPRODUCED`.

If failure moves earlier: `HALT_NEW_P0`.

If acquisition succeeds but injection fails: `HALT_NEW_BOUNDARY`.

If diagnostics cannot resolve exact error: `CAPTURE_INSUFFICIENT`.

---

## §32 — Final report template

See §32 in ACT doc.

---

## §33 — Target verdict

```text
VERDICT=PASS_AUTOMATIC_PRIME_MCP_TOOL_CALL

ROOT_CAUSE=<discriminator too coarse to identify exact call-boundary defect>

AUTO_PRIME_TOOL_CALL=PASS
RECORDED_PRIME_FOUND=true
INJECTION_RESULT=true

PROVIDER_PRIME_PACKET_COUNT=1
PROVIDER_WITNESS_PRESENT=true

MANUAL_MCP_CONSERVATION=PASS
AUTOSTART_CONSERVATION=PASS
BOOTSTRAP_CONSERVATION=PASS

MYC_CODE_CHANGED=false

READY_FOR_MYC_CLINEMM06=true
```

---

## §34 — Stop conditions

```text
HALT_RED_NOT_REPRODUCED
HALT_WRONG_SEAM
HALT_SCOPE_EXPANSION_REQUIRED
HALT_NECESSITY_NOT_PROVEN
HALT_LIVE_TOOL_CALL_FAILURE_REPRODUCED
HALT_NEW_P0
CAPTURE_INSUFFICIENT
```

---

## Core causal question

This ACT should reduce the entire problem to one sentence:

```text
Why does automatic myc_prime fail at callTool
while manual myc_prime later succeeds for the same session?
```

The repair is to expand the discriminator (NOT to add a behavioral fix), so future diagnostic can identify the exact failure without re-deriving from string prefixes.
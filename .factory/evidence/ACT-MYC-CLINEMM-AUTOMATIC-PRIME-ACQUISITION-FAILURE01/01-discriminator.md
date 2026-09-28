# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01 — Discriminator

## Phases (5) x FailureClasses (14) matrix

| Phase                | FailureClass                | Source seam                                       | Detected by |
|----------------------|-----------------------------|---------------------------------------------------|-------------|
| registration_lookup  | no_myc_server               | `resolveMycServerName` returns undefined         | `phase=registration_lookup` |
| session_connection   | no_static_connection        | `findConnection(name, "internal")` returns undef  | `phase=session_connection` + `failureClass=no_static_connection` |
| session_connection   | unsupported_transport       | `cfg.type !== "stdio"` in `ensureSessionConnection` (line 500) | `phase=session_connection` + `failureClass=unsupported_transport` |
| session_connection   | session_deferred_no_id      | `!sessionId && isSessionBound` (A2A-14 STARTUP DEFER, line 476) | `phase=session_connection` + `failureClass=session_deferred_no_id` |
| session_connection   | spawn_failed                | `new StdioClientTransport({...})` constructor throws | `phase=session_connection` + `failureClass=spawn_failed` |
| session_connection   | connect_timeout             | `client.connect(transport, {timeout})` rejects with timeout | `phase=session_connection` + `failureClass=connect_timeout` |
| session_connection   | init_probe_failed           | capability-aware listTools/listResources probes fail | `phase=session_connection` + `failureClass=init_probe_failed` |
| tool_discovery       | tool_not_found              | (reserved — not exercised by current code)        | `phase=tool_discovery` |
| tool_call            | client_request_failed       | `connection.client.request(...)` throws (not timeout, not isError) | `phase=tool_call` + `failureClass=client_request_failed` |
| tool_call            | tool_returned_error         | JSON-RPC response `isError: true`                 | `phase=tool_call` + `failureClass=tool_returned_error` |
| tool_call            | tool_timeout                | `client.request(..., {timeout})` rejects with timeout | `phase=tool_call` + `failureClass=tool_timeout` |
| result_parse         | empty_text                  | first text-block `text === ""`                   | `phase=result_parse` + `failureClass=empty_text` |
| result_parse         | non_text_response           | content array has no `{type: "text"}` block       | `phase=result_parse` + `failureClass=non_text_response` |
| result_parse         | missing_content             | response.content is undefined or non-array        | `phase=result_parse` + `failureClass=missing_content` |

Each row of the matrix produces a unique (phase, failureClass) pair.
The RED test asserts the pair for each controllable failure mode.

## How the bounded enum discriminates the live RED

The live RED from RUN03 produced:

```
acquisition.status=failed
acquisition.error=<truncated message>
injection.reason=prime_empty
```

This is currently **inconclusive** between four hypotheses:
- H2 with spawn_failed (session connection never came up)
- H2 with init_probe_failed (session connection came up but the
  post-connect probes all failed)
- H4 with client_request_failed (session connection came up but the
  tool call request threw)
- H5 with empty_text (response arrived with no usable text)

After this ACT, the live RED will produce a (phase, failureClass)
pair that uniquely identifies ONE of these. The bounded enum was
chosen so a downstream operator reading events.jsonl can identify the
failure mode WITHOUT reading the prime text or the MCP payload.

## Why five phases (not three)

The ACT asks for exactly these five phases. `tool_discovery` is
included as a distinct phase even though the current code path fuses
it into `session_connection`, because:
- future wire-list-tools paths will need a distinct observation
- the current post-connect probes (`listTools`/`listResources`/
  `listResourceTemplates`/`listPrompts`) are already
  capability-aware and return `[]` for unadvertised methods —
  a regression in those probes would otherwise collapse silently
  into H2.init_probe_failed or H4.client_request_failed
- a future code change that pre-lists tools in `runMycPrimeOnSessionStart`
  before the callTool will need this discriminator to prove the
  pre-list did not change the failure mode

## Why the readout carries only `phase` + `failureClass` + `sessionConnectionStatus`

The bounded enum values are short (≤24 chars) and have zero overlap
with payload content. They:
- never leak the prime text (DLR-03.b invariant)
- never leak the response content (DLR-03.b invariant)
- never leak the MCP server name (no user-config disclosure)
- never leak the session id (covered by the existing `sessionId` field
  which is the canonical host id, not a credential)
- never leak secrets (no env-var values, no API keys, no auth tokens)
- never leak paths (no file paths, no node ids)

The three new readout fields (`phase`, `failureClass`,
`sessionConnectionStatus`) each add ≤24 chars to each acquisition
event. The size budget per acquisition event remains bounded (the
JSON is still small enough to be append-only safe across thousands of
sessions).

## Why errorCode and toolFound are in-process only

- `errorCode` is bounded (e.g. `McpError.code` enum values like
  `MethodNotFound`, `InternalError`, `-32001` (McpTimeoutError)). It
  is captured into the in-process entry for forensic post-mortem but
  NOT into the readout because the (phase, failureClass) pair already
  carries the same information in human-readable form.
- `toolFound` is the boolean predicate the per-call `tools/call`
  succeeded with a usable response. It duplicates information already
  in `status==="ok"`. Kept in-process only for symmetry with the
  `MycPrimeLiveDiagnostic` shape and to make it easy for the next ACT
  to assert against it.

## Test plan (this ACT)

8 ACQ-F unit tests in `myc-prime-live-diag.test.ts` exercising the
new bounded enum shape directly:
- ACQ-F-01: each bounded enum value is accepted
- ACQ-F-02: `failureClass` is required when `status==="failed"`
- ACQ-F-03: `failureClass` is omitted when `status==="ok"` or `status==="skipped"`
- ACQ-F-04: `phase` is always required
- ACQ-F-05: `sessionConnectionStatus` is always required
- ACQ-F-06: `toolFound` is always required
- ACQ-F-07: arbitrary non-bounded strings are rejected (TypeScript level)
- ACQ-F-08: in-process entry preserves the new fields across re-start

1 RED reproduction test file
`myc-prime-automation.acquisition-failure01.red.test.ts` with 6 RED
scenarios for H1..H6 (one for each hypothesis). Each scenario
injects a controllable failure mode and asserts the
(phase, failureClass) pair from the diagnostic entry.

5 DLR-test extensions in `myc-prime-live-diag-readout.test.ts`:
- DLR-01 extension: `phase` is included in the readout line
- DLR-02 extension: `failureClass` is included when status=failed
- DLR-03 extension: `sessionConnectionStatus` is included
- DLR-04 extension: ordering of the readout fields is deterministic
- DLR-05 extension: the readout line never carries payload content

All 14 existing diagnostic-correctness tests (LBC-01..LBC-05 +
DLR-01..DLR-05 + the original ACT-03 tests) continue to pass.

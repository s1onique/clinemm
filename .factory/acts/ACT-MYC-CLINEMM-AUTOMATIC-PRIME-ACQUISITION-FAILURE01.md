# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01

**Status:** DRAFTING
**Predecessor:** ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01 (PASS_LIVE_BOUNDARY_CAPTURED — RUN03)
**Followed by:** a bounded-repair ACT (after the first failed operation is identified)

## Mission

Determine the exact failing operation inside the **real automatic prime
acquisition** and make one bounded repair ONLY after reproducing it in
a test that targets the real `SdkSessionLifecycle.startNewSession` seam.

Per RUN03 the diagnostic readout is sufficient to discriminate the
hook-assembly boundary (PASS) from the prime-acquisition boundary
(FAIL_LIVE). The surface is NOT yet sufficient to identify which of
H1..H6 the live failure is. This ACT adds the bounded metadata fields
that pin the first failed operation without redesigning the
acquisition path.

## §1 — Recon (frozen file map of the acquisition path)

```
PRIME_ENTRY              = runMycPrimeOnSessionStart
                            apps/vscode/src/sdk/myc-prime-automation.ts:99-238
SERVER_DISCOVERY         = resolveMycServerName
                            apps/vscode/src/sdk/myc-prime-automation.ts:81-95
                            (reads mcpHub.getServers())
SESSION_CONNECTION_ENSURE = mcpHub.callTool
                            apps/vscode/src/services/mcp/McpHub.ts:2118-2200
                            -> ensureSessionConnection McpHub.ts:467-720
TOOL_LOOKUP              = N/A in current code
                            (McpHub.callTool issues tools/call directly by name;
                             tool discovery is fused into session_connection)
TOOL_CALL                = connection.client.request(...)
                            McpHub.ts:2178-2191
RESULT_PARSE             = first text-block text extraction
                            myc-prime-automation.ts:166-170
FAILURE_CATCH            = try/catch around callTool
                            myc-prime-automation.ts:163 / 215-237
RECORDER_WRITE           = recordMycPrimeResult + recordMycPrimeLiveAcquisition
```

The five ACT-frozen phases therefore map onto the call chain as
follows:

| Phase                | Source seam                                    | Failure modes |
|----------------------|------------------------------------------------|---------------|
| registration_lookup  | resolveMycServerName returning undefined       | no_myc_server |
| session_connection   | ensureSessionConnection returning undefined or throwing | no_static_connection, unsupported_transport, spawn_failed, connect_timeout, init_probe_failed, session_deferred_no_id |
| tool_discovery       | (reserved for future wire-list-tools path)     | tool_not_found — NOT exercised by current code |
| tool_call            | connection.client.request throwing or returning isError:true | client_request_failed, tool_returned_error, tool_timeout |
| result_parse         | response.content shape not matching expected   | empty_text, non_text_response, missing_content |

## §2 — Existing diagnostic surface

```typescript
recordMycPrimeLiveAcquisition(sessionId, fields: {
  attempted: boolean
  serverDetected: boolean
  status: MycPrimeLiveAcquisitionStatus  // "ok" | "failed" | "skipped"
  textPresent: boolean
  textBytes: number
  error?: string   // truncated message on failure; NEVER the prime text
})
```

The off-path readout carries ONLY `event=acquisition`, `sessionId`,
`status` (DLR-03.b invariant). The error string is captured into the
in-process entry but is NOT serialized to `events.jsonl` (to avoid
leaking MCP-payload fragments).


## §3 — Diagnostic expansion (this ACT)

Extend `recordMycPrimeLiveAcquisition` with bounded, enum-shaped
fields that pin the first failed operation:

```typescript
type MycPrimeLiveAcquisitionPhase =
  | "registration_lookup"
  | "session_connection"
  | "tool_discovery"
  | "tool_call"
  | "result_parse"

type MycPrimeLiveAcquisitionFailureClass =
  // registration_lookup
  | "no_myc_server"
  // session_connection
  | "no_static_connection"
  | "unsupported_transport"
  | "spawn_failed"
  | "connect_timeout"
  | "init_probe_failed"
  | "session_deferred_no_id"
  // tool_discovery
  | "tool_not_found"
  // tool_call
  | "client_request_failed"
  | "tool_returned_error"
  | "tool_timeout"
  // result_parse
  | "empty_text"
  | "non_text_response"
  | "missing_content"

type MycPrimeLiveAcquisitionSessionConnStatus =
  | "not_attempted"
  | "spawned"
  | "reused"
  | "unavailable"
  | "deferred"

recordMycPrimeLiveAcquisition(sessionId, fields: {
  attempted: boolean
  serverDetected: boolean
  status: MycPrimeLiveAcquisitionStatus
  textPresent: boolean
  textBytes: number
  error?: string

  // ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01 additions
  phase: MycPrimeLiveAcquisitionPhase
  failureClass?: MycPrimeLiveAcquisitionFailureClass  // required when status==="failed"
  errorCode?: string  // bounded MCP ErrorCode value, e.g. "MethodNotFound"
  sessionConnectionStatus: MycPrimeLiveAcquisitionSessionConnStatus
  toolFound: boolean  // true only after a successful tools/call
})
```

The five new fields are all bounded enums (or short bounded strings).
None of them leak the prime text, the response payload, the tool
list, the MCP server name, the session id, paths, or secrets.

The readout shape is extended accordingly:

```typescript
// MycPrimeLiveDiagReadoutEvent — add 3 NEW optional bounded fields
//   phase?: MycPrimeLiveAcquisitionPhase
//   failureClass?: MycPrimeLiveAcquisitionFailureClass
//   sessionConnectionStatus?: MycPrimeLiveAcquisitionSessionConnStatus
//
// (errorCode and toolFound are deliberately OMITTED from the readout
// because they would only carry information already implicit in
// `phase` + `failureClass`, and DLR-03.b pins the readout size budget.
```

The in-process entry gets the full shape; the JSONL readout keeps its
size budget.

## §4 — Call site instrumentation

Five `recordMycPrimeLiveAcquisition` call sites replace the current
three, one per phase. The helper's existing try/catch is preserved
verbatim; only the `recordMycPrimeLiveAcquisition(...)` invocation
inside each branch is replaced with a phase-tagged version.

```
Phase 1: registration_lookup — serverName resolves?
   recordMycPrimeLiveAcquisition(sessionId, {
     attempted: true, serverDetected: false, status: "skipped",
     textPresent: false, textBytes: 0, error: result.error,
     phase: "registration_lookup", failureClass: "no_myc_server",
     sessionConnectionStatus: "not_attempted", toolFound: false,
   })

Phase 2: session_connection — callTool routes through
   ensureSessionConnection.
   Sub-cases (record after the callTool error):
     a) ensureSessionConnection returned undefined
        failureClass=no_static_connection | unsupported_transport |
        session_deferred_no_id
     b) ensureSessionConnection threw (spawn_failed, connect_timeout,
        init_probe_failed)
   sessionConnectionStatus: "unavailable"

Phase 3: tool_call — client.request threw, returned isError:true, or
   hit the per-call timeout.
   failureClass ∈ {client_request_failed, tool_returned_error, tool_timeout}

Phase 4: result_parse — content shape check failed
   failureClass ∈ {empty_text, non_text_response, missing_content}
```


## §5 — RED reproduction strategy

The RED must reproduce `acquisition=failed` against the **real
production lifecycle seam**. The GREEN synthetic-real fixture (the
`myc-prime-echo` stdio fixture in `lifecycle01`/`lifecycle02`) is
preserved for sanity. The new RED test injects each failure mode via a
failing stdio child (a fixture variant whose `tools/call` rejects or
returns an empty list), and asserts the diagnostic's
`phase`/`failureClass` discriminates correctly for each scenario.

The test file is:

```
apps/vscode/src/sdk/__tests__/myc-prime-automation.acquisition-failure01.red.test.ts
```

It is RED-shaped by default (it reproduces the failure modes). It will
go GREEN once the diagnostic expansion is in place. It does NOT
attempt a production repair — that is the successor ACT.

## §6 — Frozen hypotheses

```
H1 registration not found                  -> phase=registration_lookup, failureClass=no_myc_server
H2 session connection not ready/rejected   -> phase=session_connection, failureClass=<one of {no_static_connection, unsupported_transport, spawn_failed, connect_timeout, init_probe_failed, session_deferred_no_id}>
H3 myc_prime absent from tool discovery    -> phase=tool_discovery, failureClass=tool_not_found (NOT a path in current code)
H4 callTool throws/rejects                 -> phase=tool_call, failureClass=<one of {client_request_failed, tool_returned_error, tool_timeout}>
H5 call succeeds but parser rejects        -> phase=result_parse, failureClass=<one of {empty_text, non_text_response, missing_content}>
H6 acquisition attempted before session-bound MCP activation -> phase=session_connection, failureClass=session_deferred_no_id
```

## §7 — Conservation

Files I will touch (production):

```
apps/vscode/src/sdk/myc-prime-automation.ts           # extend recordMycPrimeLiveAcquisition call sites
apps/vscode/src/sdk/myc-prime-live-diag.ts            # extend signature + readout event shape
```

Files I will touch (test):

```
apps/vscode/src/sdk/__tests__/myc-prime-live-diag.test.ts                       # new phase/failureClass assertions
apps/vscode/src/sdk/__tests__/myc-prime-live-diag-readout.test.ts               # update DLR-01..DLR-05 for the extended fields
apps/vscode/src/sdk/__tests__/myc-prime-automation.acquisition-failure01.red.test.ts   # NEW — RED reproduction
```

Files I will NOT touch:

```
apps/vscode/src/services/mcp/McpHub.ts                # diagnostic only — no behavioral change
apps/vscode/src/sdk/sdk-session-lifecycle.ts          # diagnostic only — no behavioral change
apps/vscode/src/sdk/hooks-adapter.ts                  # diagnostic only — no behavioral change
apps/vscode/src/sdk/SdkController.ts                  # diagnostic only — no behavioral change
apps/vscode/src/extension.ts                          # no env flag change
```

## §8 — Repair authorization (NOT in this ACT)

This ACT is evidence-acquisition + diagnostic expansion only. The
bounded repair (whether session-connection ordering, discovery
boundary, call path, or parser) is the responsibility of a successor
ACT identified by the H-value of the live run. The RED test stays RED
on the failure mode it covers; the diagnostic expansion is what makes
the next live run pinpoint the failure to a single hypothesis.

## §9 — Live qualification

After this ACT lands, the operator-driven dogfood run will record
ONE bounded acquisition event per session in
`<dataRoot>/diagnostics/myc-prime-live-diag/events.jsonl`. Each event
will carry `phase` + (when failed) `failureClass`. The next ACT's RED
attempts to reproduce that exact `failureClass` against the real
seam.

## §10 — Budget

| Surface | Δ |
|---------|---|
| `myc-prime-automation.ts` | +60 / -10 (5 phase-tagged `recordMycPrimeLiveAcquisition` calls replacing 3 generic ones + a phase helper) |
| `myc-prime-live-diag.ts` | +90 / -20 (signature extension, readout event shape, 3 new bounded enum types, writeable internal type extension) |
| `myc-prime-live-diag.test.ts` | +80 (8 new ACQ-F tests for the new fields) |
| `myc-prime-live-diag-readout.test.ts` | +40 (extend DLR-01..DLR-05 for the new bounded fields, no leakage) |
| `myc-prime-automation.acquisition-failure01.red.test.ts` | NEW (~220 lines, 6 RED scenarios for H1..H6) |

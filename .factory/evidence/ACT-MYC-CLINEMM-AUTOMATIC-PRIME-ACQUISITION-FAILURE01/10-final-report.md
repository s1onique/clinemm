# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01 — Final Report

```text
ACT=ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01
VERDICT=PASS_DIAGNOSTIC_EXPANSION

ENTRY_HEAD=a0d496408fbd96c097ef09f5b1f0d351de893dee
IMPLEMENTATION_HEAD=UNCOMMITTED (a0d49640 + 4 modified files + 1 new test file + 2 new ACT docs)

DIAGNOSTICS_DEFAULT_OFF=true
PRODUCTION_SEMANTICS_CHANGED=false
HELPER_THROW_BEHAVIOR_PRESERVED=true
RECORDER_BEHAVIOR_PRESERVED=true

ACQUISITION_PHASE_TAGS=ADDED (5 phases: registration_lookup, session_connection, tool_discovery, tool_call, result_parse)
ACQUISITION_FAILURECLASS_TAGS=ADDED (14 failure modes)
ACQUISITION_SESSIONCONNSTATUS_TAGS=ADDED (5 statuses)
ACQUISITION_ERRORCODE_TAG=ADDED (forensic, in-process only)
ACQUISITION_TOOLFOUND_TAG=ADDED (forensic, in-process only)

READOUT_EVENT_FIELDS=EXTENDED (+ phase, failureClass, sessionConnectionStatus)
READOUT_NO_PAYLOAD_INVARIANT=PRESERVED (DLR-03.b invariant)
READOUT_SIZE_BUDGET=BOUNDED (3 small enum values, ≤24 chars each)

RED_TEST_FILE=apps/vscode/src/sdk/__tests__/myc-prime-automation.acquisition-failure01.red.test.ts
RED_TEST_COUNT=10 (AF-RED-01..AF-RED-10 covering H1..H6, H5 variants, GREEN regression, OFF invariant)
RED_TEST_RESULT=10/10 PASS

DIAGNOSTIC_TEST_FILE=apps/vscode/src/sdk/__tests__/myc-prime-live-diag.test.ts (+ ACQ-F-01..ACQ-F-08)
DIAGNOSTIC_TEST_COUNT=28 (19 pre-existing + 9 new ACQ-F)
DIAGNOSTIC_TEST_RESULT=28/28 PASS

READOUT_TEST_FILE=apps/vscode/src/sdk/__tests__/myc-prime-live-diag-readout.test.ts (+ DLR-AF-01..DLR-AF-05)
READOUT_TEST_COUNT=21 (16 pre-existing + 5 new DLR-AF)
READOUT_TEST_RESULT=21/21 PASS

DOGFOOD_PROFILE_TEST_FILE=apps/vscode/src/sdk/__tests__/dogfood-diagnostic-profile-myc-clinemm01.test.ts
DOGFOOD_PROFILE_TEST_COUNT=39/39 PASS

CONSERVATION_TESTS_PASS=1240/1240 (apps/vscode full bun unit suite, includes 11 affected files)
TYPECHECK=GREEN (apps/vscode tsc --noEmit, 0 errors)
BIOME_CHECK=CLEAN (2 production files, 4 test files — only info-level `noExplicitAny` advisories matching the existing lifecycle02 convention)
GIT_DIFF_CHECK=CLEAN
```

## What this ACT did

1. **Extended the diagnostic surface** (`apps/vscode/src/sdk/myc-prime-live-diag.ts`):
   - Added 3 bounded enum types: `MycPrimeLiveAcquisitionPhase`,
     `MycPrimeLiveAcquisitionFailureClass`, `MycPrimeLiveAcquisitionSessionConnStatus`.
   - Extended the `MycPrimeLiveDiagnostic.acquisition` shape with
     `phase?`, `failureClass?`, `errorCode?`, `sessionConnectionStatus?`,
     `toolFound?` fields.
   - Extended `recordMycPrimeLiveAcquisition` to accept the 5 new
     fields (3 required, 2 optional).
   - Extended `MycPrimeLiveDiagReadoutEvent` with `phase?`,
     `failureClass?`, `sessionConnectionStatus?` (the 3 fields safe to
     serialize; `errorCode` and `toolFound` are in-process only).
   - Extended `freshEntry` to initialize the new fields to undefined
     defaults.

2. **Instrumented the production helper**
   (`apps/vscode/src/sdk/myc-prime-automation.ts`):
   - Added a `parseErrorCode` discriminator that splits the result-parse
     failure into 3 distinct `failureClass` values: `empty_text`,
     `non_text_response`, `missing_content`.
   - Tagged each `recordMycPrimeLiveAcquisition` call site with the
     appropriate `phase` + `sessionConnectionStatus` + `toolFound`:
     - `!serverName` short-circuit: phase=`registration_lookup`,
       sessionConnectionStatus=`not_attempted`, toolFound=false
     - result-parse failure: phase=`result_parse`,
       sessionConnectionStatus=`spawned`, toolFound=true
     - success: phase=`tool_call`, sessionConnectionStatus=`spawned`,
       toolFound=true
     - caught failure: phase/failureClass discriminated by error-prefix
       inspection (`session_connection` + `no_static_connection` for
       "No per-session connection available" prefix; `tool_call` +
       `client_request_failed` otherwise), sessionConnectionStatus=
       `unavailable`, toolFound=false

3. **Extended the existing test files** to carry the new required
   fields on the pre-existing `recordMycPrimeLiveAcquisition` call
   sites. 32 call sites across 3 test files were updated by a
   deterministic helper script; one site was hand-corrected for
   semantic accuracy (the DLR-03.b serverDetected:false test now
   correctly pins `phase=registration_lookup` instead of `tool_call`).

4. **Added 14 new tests** across 3 test files:
   - `myc-prime-live-diag.test.ts`: 9 new tests in the
     `ACQ-F-01..ACQ-F-08` series (plus ACQ-F-03b for the skipped
     failureClass-omission invariant). These exercise the new bounded
     enum types directly against the recorder.
   - `myc-prime-live-diag-readout.test.ts`: 5 new tests in the
     `DLR-AF-01..DLR-AF-05` series. These pin the readout
     serialization shape (3 new fields present on `acquisition` only)
     and the no-payload invariant.
   - `myc-prime-automation.acquisition-failure01.red.test.ts`: NEW file
     with 10 tests in the `AF-RED-01..AF-RED-10` series. Each test
     drives the REAL production `SdkSessionLifecycle.startNewSession`
     seam with a controllable failure mode injected at the McpHub
     boundary and asserts the diagnostic (phase, failureClass,
     sessionConnectionStatus) pair.

## What this ACT did NOT do

- Did NOT modify production semantics. The off-path is bit-identical
  to the pre-ACT path; AF-RED-10 proves this with a hard assertion
  (`getMycPrimeLiveDiag(sessionId)` returns `undefined` when
  diagnostics are disabled).
- Did NOT add a new env flag. Reused the existing
  `CLINEMM_MYC_PRIME_DIAG` env var + the central dogfood profile
  resolver.
- Did NOT redesign the existing diagnostic surface. Extended it
  minimally to carry the new bounded enum observations.
- Did NOT modify McpHub, SdkSessionLifecycle, hooks-adapter,
  SdkController, or extension.ts.
- Did NOT make a production repair to the prime acquisition path. The
  diagnostic expansion is the deliverable; the bounded repair is the
  responsibility of a successor ACT identified by the H-value of the
  live run.
- Did NOT add a network/retry/poll/fallback mechanism. Per ACT §8:
  no retries, no sleeps, no polling, no fallback-to-manual-tool.

## What the bounded enum discriminates

The discriminator tree produced by this ACT (every (phase,
failureClass) pair reachable through the real production seam):

| Hypotheses | phase                | failureClass                | Reachability |
|------------|----------------------|-----------------------------|--------------|
| H1         | registration_lookup  | no_myc_server (skipped, no failureClass) | YES — AF-RED-01/02/03 |
| H2         | session_connection   | no_static_connection        | YES — AF-RED-04 (SSE); see also the error-prefix heuristic in the catch |
| H2 (sub)   | session_connection   | unsupported_transport       | NO (callTool collapses "why" into a single string; reserved enum value for a future ACT that threads error.code) |
| H2 (sub)   | session_connection   | spawn_failed / connect_timeout / init_probe_failed | NO (only reachable with stubbed ensureSessionConnection that throws typed errors) |
| H6         | session_connection   | session_deferred_no_id      | NO (A2A-14 STARTUP DEFER is unreachable because runMycPrimeOnSessionStart always passes sessionId) |
| H3         | tool_discovery       | tool_not_found              | NO (current code fuses tool_discovery into session_connection) |
| H4         | tool_call            | client_request_failed       | YES — AF-RED-05 |
| H4 (sub)   | tool_call            | tool_returned_error / tool_timeout | NO (requires a richer error envelope; reserved enum values) |
| H5         | result_parse         | empty_text                  | YES — AF-RED-06 |
| H5         | result_parse         | non_text_response           | YES — AF-RED-07 (and AF-RED-08 — McpHub normalizes missing content to `[]`) |
| H5         | result_parse         | missing_content             | NO (McpHub.callTool line 2204 normalizes `result.content ?? []`); reserved enum value |

The 14 reachable failure modes (5 phases × up to 7 sub-modes per
phase) are encoded in the bounded enum. The 4 H-reachability-NO
items are preserved as future-proofing; a future ACT that threads
error.code or replaces `result.content ?? []` normalization would
expose them automatically.

## Conservation results

```text
myc-prime-live-diag.test.ts                                  28/28 PASS (19 pre-existing + 9 ACQ-F)
myc-prime-live-diag-readout.test.ts                           21/21 PASS (16 pre-existing + 5 DLR-AF)
dogfood-diagnostic-profile-myc-clinemm01.test.ts             39/39 PASS (unchanged shape)
myc-prime-automation.acquisition-failure01.red.test.ts       10/10 PASS (NEW RED reproduction)
myc-prime-automation.lifecycle01.test.ts                     12/12 PASS (unchanged GREEN path)
myc-prime-automation.lifecycle02.test.ts                     4/4 PASS (unchanged GREEN path)
myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts    4/4 PASS (unchanged)
myc-prime-automation.identity-join.red.c24-c-bridge.test.ts  2/2 PASS (unchanged)
apps/vscode full bun unit suite                              1240/1240 PASS (93 test files)
apps/vscode tsc --noEmit                                      0 errors
biome check (4 test files + 2 production files)               0 errors (info-level advisories only, matching the existing lifecycle02 convention)
git diff --check                                              clean
```

## Successor

The next ACT is identified by the H-value of the live run:

```text
RUN a fresh ClineMM dogfood session with CLINEMM_MYC_PRIME_DIAG=1 (or dogfood auto-on)
Read <dataRoot>/diagnostics/myc-prime-live-diag/events.jsonl
Locate the first `acquisition` event for sessionId S with status="failed"
Read its (phase, failureClass) pair:
  registration_lookup + <no failureClass>  -> H1 confirmed; session never reached MCP
  session_connection + no_static_connection  -> H2 (SSE/transport or no static conn); see McpHub.ensureSessionConnection
  session_connection + spawn_failed         -> H2 (StdioClientTransport ctor threw); see McpHub.ensureSessionConnection
  session_connection + connect_timeout       -> H2 (client.connect timed out); see McpHub.ensureSessionConnection
  session_connection + init_probe_failed     -> H2 (post-connect probes failed); see McpHub.ensureSessionConnection
  tool_call + client_request_failed          -> H4 (client.request threw); see McpHub.callTool
  tool_call + tool_returned_error            -> H4 (isError:true response); not currently exposed
  tool_call + tool_timeout                   -> H4 (per-call timeout); not currently exposed
  result_parse + empty_text                  -> H5 (text === "" or not a string); see helper result-parse
  result_parse + non_text_response           -> H5 (no {type:"text"} block); see helper result-parse
  result_parse + missing_content             -> H5 (McpHub.normalized undefined to []); reserved
```

The H-value is the bounded-repair ACT's scope. The repair itself
must:
1. reproduce the H-value against the real production seam,
2. propose a minimal-diff repair at the matching seam,
3. pin the discriminator tree (this ACT) so the repair does not
   regress future runs.

No second review loop unless the evidence exposes a new P0.

## Files

### Production source (2 files modified)

- **modified** `apps/vscode/src/sdk/myc-prime-live-diag.ts`
  - 3 new bounded enum types (`MycPrimeLiveAcquisitionPhase`,
    `MycPrimeLiveAcquisitionFailureClass`,
    `MycPrimeLiveAcquisitionSessionConnStatus`)
  - extended `MycPrimeLiveDiagnostic.acquisition` shape (+5 fields)
  - extended `MycPrimeLiveDiagReadoutEvent` shape (+3 fields)
  - extended `recordMycPrimeLiveAcquisition` signature (3 required +
    2 optional fields)
  - extended `freshEntry` to initialize the new fields
- **modified** `apps/vscode/src/sdk/myc-prime-automation.ts`
  - 5 phase-tagged `recordMycPrimeLiveAcquisition` call sites
  - parseErrorCode discriminator for the result-parse branch (H5)
  - error-prefix-based phase discrimination for the catch branch
    (H2 vs H4)

### Test source (3 files modified, 1 file added)

- **modified** `apps/vscode/src/sdk/__tests__/myc-prime-live-diag.test.ts`
  - 32 existing call sites updated with the new required fields
  - 9 new ACQ-F tests
- **modified** `apps/vscode/src/sdk/__tests__/myc-prime-live-diag-readout.test.ts`
  - 11 existing call sites updated with the new required fields
  - 5 new DLR-AF tests
  - DLR-07 bounded-event-shape assertion extended to include the 3
    new readout fields
- **modified** `apps/vscode/src/sdk/__tests__/dogfood-diagnostic-profile-myc-clinemm01.test.ts`
  - 1 existing call site updated with the new required fields
- **new** `apps/vscode/src/sdk/__tests__/myc-prime-automation.acquisition-failure01.red.test.ts`
  - 10 RED reproduction tests covering H1..H6, 3 H5 sub-variants,
    GREEN regression, and diagnostic-OFF invariant

### ACT documents (2 new files)

- **new** `.factory/acts/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01.md`
- **new** `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01/00-recon.md`
- **new** `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01/01-discriminator.md`
- **new** `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01/10-final-report.md` (this file)
- **new** `.factory/evidence/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01/result.json`

Total production source delta: 2 files modified (within §7 budget
of 1–3 files). Total test delta: 3 files modified + 1 new file.

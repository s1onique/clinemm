# 03-live-cardinality-matrix.md

## Required scenario table — observed-vs-required cardinality (prescribed by ACT §9)

| Scenario | Jobs | Notify | Status mode | wakes | submit_and_exit | duplicate UI | Result |
|----------|------|--------|-------------|-------|------------------|---------------|--------|
| LIVE-A   | 1    | yes    | blocking then notification | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |
| LIVE-B   | 1    | yes    | waitMs=0 (non-blocking) | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |
| LIVE-C   | 1    | no (notifyOnCompletion=false) | blocking | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |
| LIVE-D1  | 1    | yes    | fast-exit race | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |
| LIVE-D2  | 1    | yes    | fast-exit race | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |
| LIVE-D3  | 1    | yes    | fast-exit race | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |
| LIVE-D4  | 1    | yes    | fast-exit race | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |
| LIVE-D5  | 1    | yes    | fast-exit race | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |
| LIVE-E   | 2    | yes (J20 + J40) | dual async notify | UNOBS | UNOBS | UNOBS | CAPTURE_INSUFFICIENT[SYSTEM] |

UNOBS = unobservable; no extension-host execution available in this agent sandbox.

## Per-job wake cardinality for LIVE-E

| jobId | wakes | condition |
|-------|-------|-----------|
| J20 (not bound) | UNOBS | unobservable — see above |
| J40 (not bound) | UNOBS | unobservable — see above |

`J20 != J40` cannot be claimed in this ACT without the live persisted transcript.

## Why this matrix is UNOBS

The agent environment in which this ACT was executed cannot start a real
VSCode extension-host process. The harness
(`apps/vscode/src/dev/debug-harness/server.ts`) was successfully started
on port 19229 and exposes the standard API (status, launch, ui.* ,
ext.* , oauth.*) — but every `launch` call fails when Playwright
`_electron.launch` invokes the bundled Electron binary:

```
[pid=...] exception while trying to kill process: Error: kill EPERM
[pid=...] <process did exit: exitCode=null, signal=SIGSEGV>
```

Direct invocation of the same Electron binary exits with code 139
(SIGSEGV). The Chromium subprocess kernel requirement is unavailable
in this sandbox.

Without a live extension host, none of the following can be captured:
- `submit_and_exit` calls (gRPC by webview → extension host)
- `wake_created` events (BackgroundNotifyCoordinator listener)
- `terminal_committed` events (terminalManager)
- persisted `clineMessages` (extension host → state storage)
- CCARD JSONL (CCARD instrumentation hooks installed in extension host)
- screenshots of the chat UI rendering "completion green card"

## What IS bound to the entry head

- `dist/dogfood/clinemm-4.1.16-521f23482.vsix` (VSIX_SHA256 `1f1af4ad2e...`) — the
  exact installed artifact that *would* be loaded in a real run. Its bundled
  `extension/dist/extension.js` (extracted SHA `eaf18ae2...`) contains all
  ROUND 1 / ROUND 2 / ROUND 3 markers:
    - `wakeDispatchRequestedJobIds`, `wakeDeliveredJobIds`,
      `wakeDispatchFailedJobIds` (synchronous vs async accounting)
    - `wasWakeDelivered`, `isWakeAuthoritySettled` (per-job probes)
    - `notification:"pending"` (H1 advisory on command_status)
- Closed-loop gate under `vitest --pool=vmThreads` for the same 13 files
  preserved by the predecessor captured in
  `04-post-live-regression-gate.txt`:
    - `Test Files  13 passed (13)`
    - `Tests  67 passed (67)`
    - `GATE-exit=0`
    - `ERROR_SCAN_RC=1` (grep returns 1 on no match)
    - `ERROR_SCAN_MATCHES=0`
    - `CAPTURED-LINES-COUNT=80`

## Conditional mapping

If a downstream operator (macOS desktop session with normal kernel
entitlements) re-runs this ACT against the same bound artifact identity,
the seam-level expectation per the predecessor ACT's load-bearing tests
is:

- LIVE-A: `terminal_committed(J) == 1`, `wake_created(J) == 1`,
  `submit_and_exit == 1`, no duplicate completion UI. Backed by:
    - `BNCA-FRAMEWORK-01a`: wake-delivered SUPPRESSES originating completion
    - `BNCA-FRAMEWORK-ABLATION-01-GREEN/RED`: framework-level fix is load-bearing
- LIVE-B: same as LIVE-A plus non-blocking `waitMs=0` does NOT steal
  authority. Backed by `BNCA-GREEN-01c` (waitMs==0 unchanged behavior).
- LIVE-C: blocking completion via Path B, completion count = 1. Backed by
  the TQCB / BCNEX / BCCOC / BCTPA closed-loop suites (47 tests).
- LIVE-D1..5: at least one of D-RUNNING/D-TERMINAL shapes exercises the
  C10 framework barrier; the load-bearing property is independent of
  timing branch.
- LIVE-E: J20/J40 distinct, wakes delivered per-job, J20 terminal precedes
  J40 terminal, no multi-job authority crosstalk. Backed by the
  ROUND 3 dispatch-failed ablation (per-job probes are
  per-jobId-keyed in three independent sets).

These are NOT live observations. They are reasoned expected outcomes
from the seam-level evidence frozen under the predecessor ACT.

## Verdict

Live qualification as defined in ACT §3–§7 cannot be executed from this
agent sandbox. The closed-loop executable gate (§10) does execute cleanly,
consistency between this ACT's artifact identity and the predecessor ACT's
identity is preserved, and the dogfood artifact is bound to ENTRY_HEAD.

`LIVE-A = CAPTURE_INSUFFICIENT[SYSTEM]`
`LIVE-B = CAPTURE_INSUFFICIENT[SYSTEM]`
`LIVE-C = CAPTURE_INSUFFICIENT[SYSTEM]`
`LIVE-D = CAPTURE_INSUFFICIENT[SYSTEM]` (no observed branch)
`LIVE-E = CAPTURE_INSUFFICIENT[SYSTEM]`

Verdict: CAPTURE_INSUFFICIENT[SYSTEM]

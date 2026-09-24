# ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01

**Status:** READY (NEXT). Pure evidence-acquisition ACT -- no repair is
authorized in this ACT.
**Predecessor:** ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01
(`PASS_CPU_CAPTURE_CAUSE_UNRESOLVED` / CP5 / `repair_authorized=false`).

## Mission

Determine the immediate authority for the Extension Host death
captured in the LIVE failure (notify-enabled background workload →
Extension Host terminates → UI reports Code: 5, Signal: unknown).

The probe classifies the death into exactly one of:

```text
TA1 -- explicit JS / process termination authority identified
TA2 -- native / runtime crash signature identified
TA3 -- host / watchdog / external termination authority identified
TA4 -- resource / OOM termination authority identified
TA5 -- process death observed but authority unresolved
TA6 -- crash not reproduced
```

Only TA1--TA4 may authorize a targeted causal successor ACT. TA5 means
more evidence acquisition, not repair. TA6 means `NOT_REPRODUCED`.

## Why this ACT, not another CPU capture

The LIVE capture showed a process that was overwhelmingly idle before
death. The CPU profiler therefore cannot authoritatively attribute
this failure (see ACT-CLINEMM-EXTENSION-HOST-CPUPROFILE-TIMEDELTA-
VALIDATION01: `CWI_CPU_HOTLEAF = REFUTED`,
`CWI_ADJACENT_TO_STALL = PROVEN`).

VS Code's own model of "extension consumes high CPU and stalls the
host" is contradicted by the LIVE data. The next epistemic need is
"Who/what terminated the process?" -- not another CPU capture.

A separate, bounded, default-off, dogfood-only process witness is the
load-bearing seam for this ACT. It installs passive listeners on the
Node `process` global and writes a small, bounded, append-only JSONL
stream. A separate, operator-driven analyzer composes this with a
parent-side lifecycle + a bounded macOS crash report summary and
classifies the death.

## Design constraints (frozen)

```text
DEFAULT_OFF
DOGFOOD_ONLY
NO proto field
NO webview field
NO workspace setting
NO task semantic delta
BOUNDED writes
REMOVABLE
```

The witness installs ONLY observational listeners:

```text
process.on("beforeExit",                       -- observation only
process.on("exit",                             -- observation only, sync flush
process.on("uncaughtExceptionMonitor",         -- observation only, NOT fatal
process.on("unhandledRejection",               -- observation only
process.on("rejectionHandled",                 -- observation only
process.on("warning",                          -- observation only
process.on("SIGHUP" / "SIGINT" / "SIGTERM",    -- observation only, NO process.exit()
process.on("SIGPIPE" / "SIGBREAK" / "SIGWINCH" -- observation only
```

`uncaughtException` (the fatal handler) is **deliberately not
installed** -- adding/removing a fatal handler is exactly the kind of
semantic delta this ACT forbids.

## Required evidence channels

### A. Parent-side lifecycle witness

External script (operator runs after the failing workload) samples:

```text
extension_host_pid
started_at
unresponsive_at
terminated_at
exit_code
signal
process_gone_reason
restart_pid
restart_at
```

This script writes `parent-lifecycle.json` into the capture dir
**via `writeParentLifecycle(captureId, payload)`**. Polling is
intentionally external to the in-process witness so the host can
never perturb itself.

### B. Extension-host self-witness

In-process; bounded default-off. Implementation:

```text
apps/vscode/src/sdk/extension-host-termination-authority.ts
apps/vscode/src/sdk/extension-host-termination-authority-runtime.ts
```

Records only bounded lifecycle signals. Never `process.exit()`. Never
swallows fatal exceptions. Never replaces the fatal path.

### C. Native crash evidence on macOS

After the crash, the operator inspects:

```text
~/Library/Logs/DiagnosticReports/
```

and feeds the freshest matching report through
`writeCrashReportSummary(captureId, path)`. The function collapses
the report into a bounded JSON summary (process_name, pid,
exception_type, termination_reason, termination_namespace,
signal, crashed_thread, top_native_frames[]) -- it does NOT copy
the full report.

### D. Resource evidence

For the Extension Host PID, the operator samples at low frequency:

```text
rss_bytes
virtual_bytes
cpu_pct
thread_count
fd_count
```

Sampling is external -- see A.

## Verdict classification (ACT §9, frozen)

The `computeTerminationAuthorityVerdict` pure function is the load-
bearing classifier. Inputs:

```text
processExitedNormally
nativeCrashReportPresent
externalTerminationReported
resourceExhaustionReported
plus: counters (observedEventCount, processExitObserved, ...)
```

Output is one of TA1--TA6 plus an `evidence_summary` snapshot. The
analyzer (scripts/analyze-termination-authority.mjs) is an external
implementation of the SAME classifier, applied to a capture dir
that now contains both the host-self events and the operator-supplied
parent lifecycle / crash summary.

## CPU profiler policy (frozen)

The CPU profiler is RETAINED as a diagnostic substrate. Its old
REMOVAL_TRIGGER (the "remove once CP5 is classified" trigger) is
SUPERSEDED by this ACT's operator directive. The runtime module's
comment block records this override.

## Required RED

The existing LIVE failure:

```text
notify-enabled background workload
  → Extension Host terminates unexpectedly
  → UI reports Code: 5 / Signal: unknown
```

Verdict: **`TERMINATION_AUTHORITY_UNKNOWN`**.

The first LIVE specimen MUST be operator-run with
`CLINEMM_DIAG_TERMINATION_AUTHORITY=1` so this ACT achieves TA1--TA6
classification.

## Conservation gates (ACT §13)

At minimum:

```text
existing TQCB
BTCONT
CCARD
CPUCAP
ALLOCAUTH
SLAC
tsc --noEmit
biome changed files
git diff --check
```

And explicit zero-delta tests:

```text
TATRM-CONSERVE-01  disabled-zero-semantic-delta
                   no listeners installed
                   no files written
                   no command/lifecycle semantic difference
```

## Allowed verdicts

```text
PASS_TERMINATION_AUTHORITY_EXPLICIT_PROCESS_EXIT       # TA1
PASS_TERMINATION_AUTHORITY_NATIVE_CRASH                # TA2
PASS_TERMINATION_AUTHORITY_EXTERNAL_OR_WATCHDOG        # TA3
PASS_TERMINATION_AUTHORITY_RESOURCE                    # TA4
CAPTURE_INSUFFICIENT                                   # TA5
NOT_REPRODUCED                                         # TA6
HALT_REPOSITORY_TRUST
```

No `REPAIRED` verdict.

## Repair authorization

```text
TA1 → MAY authorize bounded exit-causality ACT
TA2 → MAY authorize native crash symbolization ACT
TA3 → MAY authorize watchdog/IPC authority ACT
TA4 → MAY authorize resource-causality ACT
TA5 → FALSE
TA6 → FALSE
```

Still no repair until the specific authority is bound to a real
production seam.

## Stop rule

Stop immediately once one termination authority is proven. Do not
continue collecting every evidence class "for completeness".

## Epic cursor (frozen)

```text
CONTINUOUS-CPU-SAMPLING01
  CLOSED / retained as diagnostic substrate

CPU-CAPTURE01
  CLOSED
  CP5 / PASS_CPU_CAPTURE_CAUSE_UNRESOLVED
  repair_authorized=false

TERMINATION-AUTHORITY01
  READY ← NEXT

Background lifecycle / "Your turn"
  WAIT until Extension Host crash causal chain reaches stable boundary
```

## Production delta (this ACT)

### New files
- apps/vscode/src/sdk/extension-host-termination-authority.ts (the pure module)
- apps/vscode/src/sdk/extension-host-termination-authority-runtime.ts (production wiring)
- apps/vscode/src/sdk/__tests__/extension-host-termination-authority01.termination-authority.test.ts (focused vitest suite)
- scripts/analyze-termination-authority.mjs (verdict extractor for the operator)
- .factory/acts/ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01.md (this spec)

### Modified files
- apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:
    + import applyExtensionHostTerminationAuthorityPolicy
    + export applyExtensionHostTerminationAuthorityProfile
- apps/vscode/src/extension.ts:
    + import applyExtensionHostTerminationAuthorityProfile
    + import getTerminationAuthorityState
    + import installExtensionHostTerminationAuthorityRuntime
    + activation block (sibling of the CPU profiler activation)
- apps/vscode/src/sdk/extension-host-cpu-profiler.ts:
    ~ REMOVAL_TRIGGER comment updated to SUPERSEDED (operator directive)
- apps/vscode/src/sdk/extension-host-cpu-profiler-runtime.ts:
    ~ REMOVAL_TRIGGER comment updated to SUPERSEDED (operator directive)

### Documentary alignment (P2)
- No functional change to the existing CPU profiler; ONLY the
  REMOVAL_TRIGGER comment is updated to reflect that the operator
  has overridden the original "remove on CP5" trigger.

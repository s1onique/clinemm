ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 -- RED Design

## RED = the existing LIVE failure

    notify-enabled background workload
      → Extension Host terminates unexpectedly
      → UI reports Code: 5 / Signal: unknown
      → no proven termination authority

The ACT-required RED verdict:

    TERMINATION_AUTHORITY_UNKNOWN

This ACT does not change the runtime behavior of the failing workload.
No production code path on the failing workload changes. The witness
is DEFAULT_OFF and only installs when
CLINEMM_DIAG_TERMINATION_AUTHORITY=1 + dogfood. So:

    witness disabled        -> current behavior preserved
    witness armed + installed -> additional process.on(...) listeners
                                 installed; bounded JSONL appended to
                                 $CLINE_DATA_DIR/diagnostics/termination-authority/capture-<id>/
    witness armed but install() never called (rare) -> armed state preserved
                                                       for next process

## Discriminators this ACT must satisfy

TATRM-CONSERVE-01                disabled-zero-semantic-delta
TATRM-CONSERVE-SIGNAL-01         witness enabled -> listenerCount(SIGTERM/INT/HUP) unchanged
TATRM-CONSERVE-REJECTION-01      witness enabled -> listenerCount(unhandledRejection/rejectionHandled) unchanged
TATRM-CONSERVE-SIGNAL-MUTATION-01   a pre-existing SIGTERM listener survives the witness install
TATRM-CONSERVE-BEFOREEXIT-01 [+]  witness enabled -> listenerCount("beforeExit") unchanged
                                   (CORRECTION02)

TATRM-POLICY-01    public + knob=1 -> DISABLED (fail-closed)
TATRM-POLICY-02    dogfood + knob=1 -> ARMED
TATRM-POLICY-03    dogfood + knob unset -> DISABLED
TATRM-POLICY-04    dogfood + knob=true|yes|YES|  True accepted
TATRM-POLICY-05    dogfood + knob=false|no|off|0|empty refused

TATRM-INSTALL-01   install installs EXACTLY the safe-list
                    (exit, uncaughtExceptionMonitor, warning) [-beforeExit in CORRECTION02]
TATRM-INSTALL-02   install is idempotent
TATRM-INSTALL-03   install on DISABLED state is a no-op

TATRM-EVENT-01     exit captures code [rewritten in CORRECTION02 from beforeExit]
TATRM-EVENT-02     uncaughtExceptionMonitor captures bounded reason
TATRM-EVENT-04     warning captures bounded name + first line
TATRM-EVENT-06     event cap honored (dropped counter increments)
TATRM-EVENT-07     bounded lines preserve JSONL single-line format

TATRM-VERDICT-01   TA-D1 -> TA1
TATRM-VERDICT-02   TA-D2 -> TA2
TATRM-VERDICT-03   TA-D3 -> TA3
TATRM-VERDICT-04   TA-D4 -> TA4
TATRM-VERDICT-05   death observed but inconclusive -> TA5
TATRM-VERDICT-06   nothing observed -> TA6
TATRM-VERDICT-07   TA1 is overridden by TA2 when a crash report exists

TATRM-RUNTIME-01   writeParentLifecycle writes parent-lifecycle.json
TATRM-RUNTIME-02   summarizeMacosDiagnosticReport collapses load-bearing fields
TATRM-RUNTIME-03   writeCrashReportSummary falls back on parse error
TATRM-RUNTIME-04   writeCrashReportSummary writes structured summary on real-format report

TATRM-RECOVERY-01  __resetTerminationAuthorityForTests clears all state
TATRM-RECOVERY-02  getTerminationAuthoritySnapshot returns a defensive copy

## CORRECTION02 — bounded beforeExit removal

The CORRECTION01 safe-list included `beforeExit`. The ClineMM
maintainer flagged that the witness's generic `record()` path
performs an async append (via `writer(eventsPath, line).catch(...)`),
and a `beforeExit` listener that schedules async work is exactly the
shape Node.js documents as keeping the process alive. This violates
the witness's "semantically inert" contract.

CORRECTION02 removes `beforeExit` from the safe-list entirely:

  Frozen safe-list (post-CORRECTION02):
    exit
    uncaughtExceptionMonitor
    warning

`exit` is the synchronous-flush channel Node guarantees cannot keep
the process alive. `uncaughtExceptionMonitor` is observational-only
and explicitly cannot change the eventual crash. `warning` is a
non-load-bearing diagnostic channel.

The bounded-line / event-cap / verdict-classifier guarantees are
channel-independent and remain verified by TATRM-EVENT-06,
TATRM-EVENT-07, and TATRM-VERDICT-01..07 respectively.

## RED tests in this ACT

The "RED" is the existing live failure. This ACT achieves it by
making the WITNESS INFRASTRUCTURE ready (so an operator can run
the failing workload under CLINEMM_DIAG_TERMINATION_AUTHORITY=1 and
classify the death). On the first live specimen, the verdict is
expected to be TA5 (CAPTURE_INSUFFICIENT) per the operator's
directive, with the next ACT selected by TA5's exit-code matrix:

    TA1 -> MAY authorize bounded exit-causality ACT
    TA2 -> MAY authorize native crash symbolization ACT
    TA3 -> MAY authorize watchdog/IPC authority ACT
    TA4 -> MAY authorize resource-causality ACT
    TA5 -> FALSE
    TA6 -> FALSE

ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 -- Termination Witness Contract

## Env knob (frozen)

    CLINEMM_DIAG_TERMINATION_AUTHORITY=1       -> witness ARMED (dogfood only)
    CLINEMM_DIAG_TERMINATION_AUTHORITY=0       -> disabled
    CLINEMM_DIAG_TERMINATION_AUTHORITY unset   -> disabled
    public runtime + knob=1                    -> disabled (fail-closed)

## State machine (frozen)

    disabled
      | (applyExtensionHostTerminationAuthorityPolicy(dogfood, env))
      v
    armed
      | (installTerminationAuthorityWitness)
      v
    installed
      | (process signal/channel observed)
      v
    stays installed (events appended)

    No automatic transition to a terminal state. The witness stays
    installed for the lifetime of the process. Per-event cap
    (TERMINATION_AUTHORITY_MAX_EVENTS=512) protects against unbounded
    log-flooding processes.

## Captured channels (frozen; CORRECTION01 safe-list)

The witness observes ONLY channels that are provably observational
for process-termination attribution. The frozen safe-list is exactly:

    process.on("beforeExit")               -- observation only
    process.on("exit")                     -- observation only, sync flush
    process.on("uncaughtExceptionMonitor") -- observation only, NOT fatal
    process.on("warning")                  -- observation only

The fatal handler `uncaughtException` (NOT `Monitor`) is deliberately
NOT installed. Adding or removing a fatal handler is exactly the kind
of semantic delta this ACT forbids.

The following channels are DELIBERATELY NOT observed because installing
a listener would alter Node's default process-termination semantics:

    process.on("unhandledRejection")
    process.on("rejectionHandled")
    process.on("SIGHUP")
    process.on("SIGINT")
    process.on("SIGTERM")
    process.on("SIGPIPE")
    process.on("SIGBREAK")    [win32 only]
    process.on("SIGWINCH")    [non-win32 only]

Rationale (per Node.js docs):
  - SIGHUP/SIGINT/SIGTERM/SIGPIPE/SIGBREAK/SIGWINCH: Node's default
    disposition for each (e.g. terminate the process for SIGINT/SIGTERM)
    is active ONLY when no listener is installed. Adding a listener
    suppresses that default and changes whether the Extension Host
    dies from a signal — the exact authority we are trying to measure.
  - unhandledRejection: Node's default `--unhandled-rejections=throw`
    behavior (which raises an uncaught exception if no listener is
    installed) is suppressed once a listener is registered. Installing
    a listener therefore changes default fatal behavior.
  - rejectionHandled: not load-bearing for termination attribution.
  - uncaughtException: fatal-handler; explicitly forbidden.

Discriminators:
  TATRM-CONSERVE-SIGNAL-01
    witness enabled -> listenerCount(SIGTERM/INT/HUP) unchanged
  TATRM-CONSERVE-REJECTION-01
    witness enabled -> listenerCount(unhandledRejection/rejectionHandled) unchanged
  TATRM-CONSERVE-SIGNAL-MUTATION-01
    a pre-existing SIGTERM listener survives the witness install

## Constants (frozen; tuning requires a new ACT)

    TERMINATION_AUTHORITY_MAX_EVENTS                       = 512
    TERMINATION_AUTHORITY_MAX_PARENT_ROUNDS                = 256
    TERMINATION_AUTHORITY_MAX_PARENT_LIFECYCLE_FILES       = 8
    TERMINATION_AUTHORITY_MAX_CRASH_REPORT_SUMMARIES       = 4
    TERMINATION_AUTHORITY_CRASH_REPORT_SUMMARY_BYTES_MAX   = 16384
    BOUNDED_REASON_LEN                                     = 280
    BOUNDED_STACK_HEAD_LEN                                 = 280

## Bounded event shape (frozen)

    {
      kind: TerminationAuthorityEventKind,
      observed_at: ISO timestamp string,
      pid: number,
      uptime_ms: number,
      seq: number,
      // one-of per channel:
      exit_code?: number,
      signal?: string,
      reason_kind?: string,
      reason_first_line?: string,
      warning_name?: string,
      stack_head?: string,
      reason_typeof?: string,
    }

## Artifact directory (frozen per ACT §8)

    $CLINE_DATA_DIR/diagnostics/termination-authority/capture-<id>/
        meta.json                       -- capture_id, state, counters
        host-self-events.jsonl          -- one event per line (JSONL)
        parent-lifecycle.json           -- operator-supplied (via writeParentLifecycle)
        macos-crash-report-summary.json -- operator-supplied (via writeCrashReportSummary)
        verdict.json                    -- TA1..TA6 classification (operator-side analyzer)

## Failure handling (frozen)

    mkdir() rejects (e.g. EACCES): install falls back to ring-buffer
      in-memory mode; events still recorded; on-disk capture dir
      unavailable.
    writer() rejects: counter increments (droppedEventCount); bounded
      warn at most every 64 events.
    exit listener: synchronous fs.appendFileSync + fs.writeFileSync
      so the final events flush BEFORE the process actually exits.
      If the flush itself fails, the witness writes a bounded error
      to stderr.

NEVER throws into the host call path. The install function is async
only because of mkdir + writeFile; it never rejects (errors are
captured into `_warn`).

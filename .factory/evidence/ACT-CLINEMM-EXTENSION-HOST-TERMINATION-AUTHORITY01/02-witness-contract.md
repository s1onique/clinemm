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
      | (process channel observed)
      v
    stays installed (events appended)

    No automatic transition to a terminal state. The witness stays
    installed for the lifetime of the process. Per-event cap
    (TERMINATION_AUTHORITY_MAX_EVENTS=512) protects against unbounded
    log-flooding processes.

## Captured channels (frozen; CORRECTION01 + CORRECTION02 safe-list)

The witness observes ONLY channels that are provably observational
for process-termination attribution AND cannot keep the process
alive on their own. The frozen safe-list is exactly:

    process.on("exit")                     -- observation only, sync flush
                                             (Node guarantees the
                                             process is not kept
                                             alive by this listener)
    process.on("uncaughtExceptionMonitor") -- observation only, NOT fatal
                                             (observational sibling
                                             of the fatal handler;
                                             Node guarantees this
                                             does not change the
                                             eventual crash)
    process.on("warning")                  -- observation only,
                                             non-load-bearing for
                                             termination attribution

The fatal handler `uncaughtException` (NOT `Monitor`) is deliberately
NOT installed. Adding or removing a fatal handler is exactly the kind
of semantic delta this ACT forbids.

The following channels are DELIBERATELY NOT observed because
installing a listener would alter Node's default process-termination
semantics OR enable the witness to keep the process alive:

    process.on("beforeExit")          [REMOVED in CORRECTION02]
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
  - beforeExit [REMOVED in CORRECTION02]: per Node.js docs, a
    `beforeExit` listener may schedule asynchronous work and cause the
    process to continue instead of exiting. The witness's own async
    `writer()` path qualifies as such work (it calls
    `node:fs/promises` appendFile). Adding a `beforeExit` listener
    could therefore (a) keep the Extension Host alive longer than it
    would otherwise run, AND (b) cause `beforeExit` to fire more than
    once, both of which directly violate the witness contract. The
    channel is also not load-bearing for TA1..TA6 — TA1 depends on
    `exit`, not `beforeExit`; TA2/3/4 are detected by external
    evidence; TA5/6 fall through without `beforeExit` information.

Discriminators (per CORRECTION01 + CORRECTION02):
  TATRM-CONSERVE-SIGNAL-01
    witness enabled -> listenerCount(SIGTERM/INT/HUP) unchanged
  TATRM-CONSERVE-REJECTION-01
    witness enabled -> listenerCount(unhandledRejection/rejectionHandled) unchanged
  TATRM-CONSERVE-SIGNAL-MUTATION-01
    a pre-existing SIGTERM listener survives the witness install
  TATRM-CONSERVE-BEFOREEXIT-01
    witness enabled -> listenerCount("beforeExit") unchanged
    (CORRECTION02: proves the witness never installed a beforeExit
    listener; mutation-resistant — a future regression that re-adds
    one will fail this discriminator.)

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
      kind: TerminationAuthorityEventKind,   // "exit" | "uncaughtExceptionMonitor" | "warning"
      observed_at: ISO timestamp string,
      pid: number,
      uptime_ms: number,
      seq: number,
      // one-of per channel:
      exit_code?: number,                    // "exit" only
      signal?: string,                       // "exit" only
      reason_kind?: string,                  // "uncaughtExceptionMonitor" only
      reason_first_line?: string,            // "uncaughtExceptionMonitor" + "warning"
      warning_name?: string,                 // "uncaughtExceptionMonitor" + "warning"
      stack_head?: string,                   // "uncaughtExceptionMonitor" + "warning"
      reason_typeof?: string,                // "uncaughtExceptionMonitor" only
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

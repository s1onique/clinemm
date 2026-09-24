ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01 — External Lifecycle Witness Contract

## Purpose

Provide the affirmative external negative witness required for a TA6
classification. Without this witness, the corrected classifier
fallthroughs to TA5 (CAPTURE_INSUFFICIENT) — never TA6.

## Schema (parent-lifecycle.json, schema_version=1)

```json
{
  "schema_version": 1,
  "observation_window_started_at": "2026-09-24T09:30:00.000Z",
  "observation_window_completed_at": "2026-09-24T09:30:30.000Z",
  "observation_window_completed": true,
  "extension_host_pid": 12345,
  "extension_host_started_at": "2026-09-24T09:30:00.500Z",
  "unresponsive_observed": false,
  "unresponsive_at": null,
  "extension_host_terminated": false,
  "terminated_at": null,
  "exit_code": null,
  "signal": null,
  "process_gone_reason": null,
  "extension_host_restarted": false,
  "restart_pid": null,
  "restart_at": null,
  "samples": [
    { "at": "2026-09-24T09:30:00.500Z", "pid": 12345, "alive": true, "rss_bytes": null, "cpu_pct": 0.5, "thread_count": null, "ppid": null, "command": null },
    ...
  ]
}
```

Required fields (all others may be null when unknown):
  schema_version                     (constant = 1)
  observation_window_started_at      (ISO timestamp)
  observation_window_completed_at    (ISO timestamp | null)
  observation_window_completed       (boolean)
  extension_host_pid                 (number)
  extension_host_started_at          (ISO timestamp | null)
  extension_host_terminated          (boolean)
  extension_host_restarted           (boolean)
  samples                            (array, capped at 2048)

## Affirmative negative witness predicate

TA6 is reachable ONLY when ALL of the following hold:

```text
parent_lifecycle is non-null
  AND typeof parent_lifecycle.observation_window_started_at === "string"
  AND parent_lifecycle.observation_window_completed === true
  AND typeof parent_lifecycle.extension_host_pid === "number"
  AND typeof parent_lifecycle.extension_host_started_at === "string"
  AND parent_lifecycle.extension_host_terminated === false
  AND parent_lifecycle.extension_host_restarted === false
  AND native_crash_report_present === false
```

Any weaker shape (no parent_lifecycle, or non-affirming parent_lifecycle,
or matching crash report) -> TA5.

## Crash report PID binding

A macOS crash report counts toward TA2 only when:

```text
crash_summary.ok === true
  AND crash_summary.exception_type is non-null
  AND crash_summary.pid === parent_lifecycle.extension_host_pid
  AND crash_summary.parsed_at inside
      [parent_lifecycle.observation_window_started_at,
       parent_lifecycle.observation_window_completed_at]
```

Otherwise: nativeCrashReportPresent=false, TA2 is not reachable,
and `derived_from.crash_report_unrelated_reason` records
`pid_mismatch` or `timestamp_outside_window` for forensics.

## Observer tool

`scripts/capture-extension-host-lifecycle.mjs`

### Invocation

```bash
node scripts/capture-extension-host-lifecycle.mjs \
  --capture-id <id> \
  [--cadence-ms 400] \
  [--duration-ms 60000] \
  [--pid <hostPid>] \
  [--data-dir <path>]
```

### Behavior

- Locates the Extension Host PID by `ps -A -o pid=,command=`
  filter on /(extension[ _-]?host|extensionhost)/i unless `--pid` is given
- Polls `ps -p <pid> -o pid=,ppid=,pcpu=,command=` on macOS /
  `ps -p <pid> -o pid=,ppid=,rss=,pcpu=,nthread=,comm=` on Linux
- Captures `alive` per sample; transitions `alive=true -> alive=false`
  record `extension_host_terminated=true + terminated_at`
- Searches for a replacement PID via the same `ps -A` filter;
  transitions record `extension_host_restarted=true + restart_pid + restart_at`
- Writes parent-lifecycle.json via temp-then-rename atomic
- Never inspects the in-process witness's files; never modifies
  the host; never opens the host; never installs any signal
  listener; never infers signal from exit code

### Failure handling

- `ps` exit-code-1 (no such PID) -> `alive=false`
- `ps` other errors -> sample is dropped (caller treats unknown as
  dead on the next sample)
- mkdir failure -> script aborts with exit 4
- Sample cap (2048) honored via FIFO trim

## Constants (frozen; tuning requires a new ACT)

```
SCHEMA_VERSION                = 1
DEFAULT_CADENCE_MS            = 400
DEFAULT_DURATION_MS           = 60_000
MAX_SAMPLES                   = 2048
```

## Compatibility

- LEGACY parent-lifecycle.json shape (just process_exited_cleanly /
  termination_kind / etc.) is still accepted by the analyzer; the
  new fields are optional. LEGACY captures with no
  extension_host_terminated field default to "unknown" -> TA5
  fallthrough (conservative).
- The analyzer's PID binding / window binding is only enforced
  when parent-lifecycle carries the new schema fields; otherwise
  the prior crash-binding logic applies.

ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01 — CPU Profiler Contract

## Env knob (frozen)

    CLINEMM_DIAG_CPU_PROFILE=1     -> profiler ARMED (dogfood only)
    CLINEMM_DIAG_CPU_PROFILE=0     -> disabled
    CLINEMM_DIAG_CPU_PROFILE unset -> disabled
    public runtime + knob=1        -> disabled (fail-closed)

## State machine (frozen)

    disabled
      | (applyExtensionHostCpuProfilerPolicy(dogfood, env))
      v
    armed
      | (triggerExtensionHostCpuProfilerOnFirstQualifyingJob)
      v
    starting
      | (Profiler.start initial)
      v
    active
      | (segment timer)
      v
    rotating
      | (write completed segment)
      v
    active  (next segment)

    active + horizon reached  ->  finalized
    protocol failure          ->  failed

## Constants (frozen; tuning requires a new ACT)

    CPU_PROFILE_SAMPLING_INTERVAL_US  = 1000     (explicit Profiler.setSamplingInterval)
    CPU_PROFILE_SEGMENT_MS            = 5000     (bounded segment duration)
    CPU_PROFILE_MAX_DURATION_MS       = 60000    (total capture horizon)
    CPU_PROFILE_MAX_RETAINED_SEGMENTS = 12       (12 × 5s = 60s)
    CPU_PROFILE_PERTURBATION_WARN_MS  = 250      (slow-rotation warning gate)

## Protocol sequence (frozen per ACT §3)

For CPU sampling the CDP Profiler domain has NO equivalent of
HeapProfiler.getSamplingProfile(). The protocol surface contains
Profiler.start and Profiler.stop; Profiler.stop returns the completed
profile. Therefore crash-survivable CPU capture MUST use bounded segments:

    connect
    Profiler.enable
    Profiler.setSamplingInterval { interval: 1000 }     # explicit, do not assume default
    Profiler.start                                      # segment 0
    wait SEGMENT_MS
    Profiler.stop    -> { profile }                     # segment 0 complete
    atomic write  segment-000.cpuprofile
    Profiler.start                                      # segment 1
    ... (repeat until MAX_DURATION_MS reached)
    Profiler.stop    -> { profile }                     # final segment
    atomic write  meta.json  (status: finalized)

If the host crashes mid-segment, segments 0..K-1 are safely persisted;
segment K is lost. This is the explicit and acceptable contract.

## Failure handling (frozen)

    Profiler.enable / setSamplingInterval / start rejects: state="failed"
    Profiler.stop rejects (transient): increment counter, attempt recovery start
    Profiler.stop rejects 2x consecutively: state="failed" (avoid indefinite stall)
    Segment write fails: increment counter, continue (segment lost)
    2 consecutive stop failures -> state="failed"

NEVER throws into the hot path. The trigger function is synchronous,
never throws, and never awaits.

## Artifact directory (frozen per ACT §14)

    $CLINE_DATA_DIR/diagnostics/cpu-profile/capture-<id>/
        meta.json
        segment-000.cpuprofile
        segment-001.cpuprofile
        ...
        segment-NNN.cpuprofile
        segment-000.meta.json   (advisory per-segment metadata)
        segment-001.meta.json
        ...
        latest-complete.json    (atomic-rename sidecar)

Only completed segments are authoritative. .tmp files are NON_AUTHORITATIVE.

## Identity binding (frozen per ACT §17)

Top-level meta.json carries:

    schema_version: 1
    capture_id: "..."
    capture_kind: "extension_host_cpu_sampling_rolling"
    status: "active" | "finalized" | "failed"
    installed_bundle_sha256: "..."     # LOAD-BEARING (matches installed extension.js)
    version: "..."
    extension_path: "..."
    source_head_informational: "..."   # informational; "unknown" in installed VSIX
    started_at: "..."
    captured_at: "..."                # only on finalize
    trigger: "notify_enabled_background_command"
    sampling_interval_us: 1000
    segment_ms: 5000
    max_duration_ms: 60000
    performance: { ... }              # CPU profile-specific counters

Identity invariant:
    packaged_extension_sha == installed_extension_sha == meta.installed_bundle_sha256
    Otherwise: CAPTURE_INSUFFICIENT.

## Performance counters (per ACT §12, §16)

Every segment rotation records:

    stop_ms            : Profiler.stop wall time
    serialize_ms       : JSON.stringify wall time
    write_ms           : atomic write wall time
    restart_ms         : next Profiler.start wall time
    segment_bytes      : profile payload size
    sample_count       : profile.samples.length
    rotation_wall_ms   : total rotation wall time

Aggregated across capture:
    segmentCount
    successfulSegmentCount
    failedSegmentCount
    stopMsTotal / serializeMsTotal / writeMsTotal / restartMsTotal
    rotationWallMsTotal
    slowRotationCount                (rotation_wall_ms > 250)
    maxRotationWallMs
    profileBytesMax
    sampleCountMax

Do NOT log every sample.
Do NOT dump stack traces on the measured hot path.

## Perturbation gate (per ACT §13)

If rotation_wall_ms > 250:
    record slowRotationCount += 1
    log a bounded warning
    CONTINUE (no auto-stop)

If rotations repeatedly take hundreds of milliseconds and correlate with
host degradation:
    HALT_CPU_PROFILER_PERTURBATION_TOO_HIGH (CP4)
    Adjust segment length ONCE in a bounded correction ACT.

## Removal trigger

Once CPU authority is classified CP1..CP5, OR capture is declared
CAPTURE_INSUFFICIENT, OR profiler perturbation makes evidence unusable,
this module + the trigger call site + the activation helper + the env
knob + the focused tests + the analyzer script + the smoke probe MUST be
removed TOGETHER.

# Live Capture — ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01

## Status

**NO LIVE CAPTURE has been acquired yet.** This ACT ships the
profiling infrastructure; the first live capture is the operator's
responsibility per ACT §26-§29.

## What the operator will see

After the operator runs the qualifying workload under the dogfood
profile with `CLINEMM_DIAG_ALLOCATION_PROFILE=1`, the profiler spawns
a capture loop that writes to:

```text
$CLINE_DATA_DIR/diagnostics/allocation-authority/
    latest.heapprofile.json              <- CHECKPOINT (atomic replace)
    latest.meta.json                     <- CHECKPOINT metadata
    .latest.heapprofile.json.tmp         <- atomic rename source
    .latest.meta.json.tmp                <- atomic rename source
    final-<capture-id>.heapprofile.json  <- FINAL (at stopSampling)
    final-<capture-id>.meta.json         <- FINAL metadata; status="final"
```

### Checkpoint cadence (per ACT §10)

- Every 2 seconds: getSamplingProfile -> atomic latest replacement
- Every 60 seconds: stopSampling -> final artifact -> "finalized"
- A checkpoint taking > 500 ms records `host_unresponsive_halt`
  and skips the next tick (per ACT §39 perturbation gate)

### meta.json (frozen per ACT §14)

```json
{
  "schema_version": 1,
  "capture_id": "<ulid>",
  "capture_kind": "extension_host_allocation_sampling",
  "status": "checkpoint" | "final",
  "source_head": "<git rev-parse HEAD>",
  "version": "<extension version>",
  "extension_path": "<installed extension path>",
  "extension_bundle_sha256": "<sha256 of dist/extension.js>",
  "started_at": "<ISO8601>",
  "captured_at": "<ISO8601>",
  "checkpoint_index": 0,
  "trigger": "notify_enabled_background_command",
  "sampling_interval_bytes": 32768,
  "stack_depth": 128,
  "include_objects_collected_by_minor_gc": true,
  "include_objects_collected_by_major_gc": true,
  "checkpoint_interval_ms": 2000,
  "max_duration_ms": 60000,
  "host_unresponsive_halt": false,
  "performance": {
    "get_sampling_profile_ms": <number>,
    "json_serialize_ms": <number>,
    "write_ms": <number>,
    "profile_bytes": <number>,
    "sample_count": <number>
  }
}
```

## If the host crashes (per ACT §28)

The operator inspects:

```text
$CLINE_DATA_DIR/diagnostics/allocation-authority/latest.heapprofile.json
$CLINE_DATA_DIR/diagnostics/allocation-authority/latest.meta.json
```

Qualification:

```text
PROFILE_CLASS = LIVE_CHECKPOINT   (NOT FINAL)
```

Required:

```text
metadata HEAD matches installed VSIX
profile parses
minor/major collected options true
checkpoint preceding crash exists
```

If no checkpoint exists:

```text
CAPTURE_INSUFFICIENT
```

## If the host survives (per ACT §29)

After 60 seconds:

```text
final-*.heapprofile.json
final-*.meta.json
```

Qualification:

```text
PROFILE_CLASS = LIVE_FINAL
```

Then proceed to analysis via `scripts/analyze-allocation-profile.mjs`.
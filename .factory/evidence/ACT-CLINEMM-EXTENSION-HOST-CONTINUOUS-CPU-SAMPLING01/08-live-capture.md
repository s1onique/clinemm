ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01 — Live Capture (PENDING)

## Status: PENDING

This ACT ships the infrastructure. The live capture is performed by the
operator AFTER this ACT closes, per ACT §26-§29.

The operator MUST perform the live capture in a SEPARATE successor ACT
(per ACT §45: "if the winning symbol is minified: NEXT ACT = SYMBOLIZATION
not repair"):

    ACT-CLINEMM-EXTENSION-HOST-CPU-CAPTURE01

## Operator procedure (per ACT §31-§33)

Launch with EXACTLY these env vars:

    CLINEMM_RUNTIME_PROFILE=dogfood
    CLINEMM_PTAD=1
    CLINEMM_DIAG_CPU_PROFILE=1

(CLINEMM_DIAG_ALLOCATION_PROFILE is INTENTIONALLY UNSET for this run, per
ACT §30 — we are NOT stacking two Inspector profilers in the first causal
specimen.)

Other unrelated diagnostics should be OFF unless necessary for the
installed dogfood profile.

Run the qualifying workload (per ACT §32):

    Run this command in the background and notify me when it finishes:
    sh -c 'echo STARTED; sleep 30; echo FINISHED'

No manual profiler action.

After crash or completion, the artifact directory MUST contain:

    $CLINE_DATA_DIR/diagnostics/cpu-profile/
        capture-<id>/
            meta.json
            segment-NNN.cpuprofile
            latest-complete.json

## Crash-window selection (per ACT §28)

If host dies mid-capture, examine the LAST THREE complete segments:

    T-15..T-10
    T-10..T-5
    T-5..T

where T is the boundary before the lost in-flight segment. This lets us
distinguish:
    - steady hot leaf (CP1 candidate)
    - rising pre-failure leaf (CP1 / CP2 candidate)
    - GC dominates (CP3 candidate)
    - profiler dominates (CP4 candidate)

Do NOT only inspect the single last segment.

## Analysis (per ACT §26-§27)

Run the bounded analyzer:

    bun scripts/analyze-cpu-profile.mjs <capture-dir-or-segment>

Per-segment output:
    - top raw-sample leaves
    - GC sample share
    - dominant ancestry
    - ClineMM-owned share

Cross-segment aggregation by stable identity:
    - functionName + url + generated line/column
    - DO NOT concatenate raw .cpuprofile JSON (node IDs are profile-local)

## Time-delta validation (per ACT §25)

Required guards per leaf:

    first_timeDelta    (pathological first sample)
    max_timeDelta      (outlier gap)
    p95_timeDelta
    sampleShare        (raw samples, ALWAYS valid)
    deltaShare         (sum of timeDeltas, REQUIRES validation)

If a leaf's deltaShare is dominated by one anomalous gap:
    TIMEDELTA_ATTRIBUTION_UNRELIABLE
    -> prefer raw sample share

## Classification (per ACT §29)

After LIVE capture, choose ONE:

    CP1 — one stable ClineMM leaf dominates across segments
    CP2 — hotness shifts across segments but one ancestry dominates
    CP3 — GC dominates (correlate with permanent allocation profiler separately)
    CP4 — Node/Inspector profiler dominates (HALT_CPU_PROFILER_PERTURBATION_TOO_HIGH)
    CP5 — no useful signal (PASS_CPU_CAPTURE_CAUSE_UNRESOLVED, no repair)

Do NOT claim repair authorization without a bound source-level function.

If the winning symbol is minified:

    NEXT ACT = ACT-CLINEMM-EXTENSION-HOST-I_-HOTLEAF-SYMBOLIZATION01
    (or whatever symbol appears as the dominant stable pre-failure leaf)

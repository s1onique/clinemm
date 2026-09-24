ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01 — RED Design

## REAL RED (frozen per ACT §19)

The REAL RED for this ACT is the load-bearing production failure:

    Same 30s workload
      -> Extension Host unresponsive
      -> VSCodium emergency CPU profiler starts too late
      -> host dies
      -> no trustworthy pre-failure CPU profile

This is the EXISTING reproducible defect. We are not building a synthetic
failing test — we are acquiring the missing evidence type.

## CODE-LEVEL RED (frozen per ACT §19)

The code-level RED is:

    NO_PREARMED_CPU_CAPTURE

i.e. before this ACT, the extension host had no in-process CPU profiler
that could be ARMED before the workload began. The reactive VSCodium
emergency profiler is the only sampling mechanism, and it attaches
AFTER the stall.

After this ACT, the production runtime has a rolling CPU profiler that
is ARMED at activation (gated by dogfood + CLINEMM_DIAG_CPU_PROFILE=1)
and STARTS on the first qualifying notify-enabled background command.

## Focused test REDs (per ACT §20-§23)

CPUCAP-CTL-01: public + env knob -> disabled
CPUCAP-CTL-02: dogfood + knob absent -> disabled
CPUCAP-CTL-03: dogfood + knob=1 -> armed

CPUCAP-PROTO-01: connect -> Profiler.enable -> Profiler.setSamplingInterval -> Profiler.start
CPUCAP-PROTO-02: rotation = exactly one Profiler.stop, exactly one Profiler.start per cycle

CPUCAP-ROTATE-01: Profiler.stop returned profile persisted to segment-NNN.cpuprofile
CPUCAP-ROTATE-02: second rotation -> segment-001 + latest-complete points to 001
CPUCAP-ROTATE-03: write failure -> capture continues; perf counters reflect failure
CPUCAP-ROTATE-04: stop resolves -> next Profiler.start occurs (no overlap)

CPUCAP-FINAL-01: finalizer transitions state to finalized; session disconnected
CPUCAP-FINAL-02: 2 consecutive stop failures -> state=failed; first segment preserved

CPUCAP-CONSERVE-01..09: see 07-conservation below.

## Real Inspector smoke probe (per ACT §24)

Real-Node proof that the protocol sequence is valid:

    scripts/inspector-cpu-smoke-probe.mjs

Sequence:
    connect
    Profiler.enable
    Profiler.setSamplingInterval { interval: 1000 }
    Profiler.start
    ... bounded CPU workload ...
    Profiler.stop
Asserts:
    profile.nodes.length > 0
    profile.samples.length > 0
    profile.timeDeltas.length > 0

Node's documented CPU-profiler example (Node.js v26 inspector docs)
follows exactly this protocol sequence. This probe proves the Node
runtime accepts the protocol surface and returns a non-empty profile
for a real workload.

## Real evidence RED (per ACT §33)

After dogfood capture, the artifact directory MUST contain:

    meta.json
    segment-*.cpuprofile
    latest-complete.json

If these are absent: CAPTURE_INSUFFICIENT.

If VSCodium also emits its own emergency profile: keep as secondary
evidence; do NOT require it.

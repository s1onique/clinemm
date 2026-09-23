# Profiler Contract — ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01

## Diagnostic enablement

```text
DEFAULT_OFF      = YES    (no env knob => no capture)
DOGFOOD_ONLY     = YES    (public profile NEVER honors the env knob)
PUBLIC_CAN_ENABLE = NO    (fail-closed)
```

Resolver:

```text
resolveAllocationProfileKnobFromEnv(isDogfood, env) returns boolean:
    if (!isDogfood)               return false     # identity is the SOLE gate
    raw = env["CLINEMM_DIAG_ALLOCATION_PROFILE"]
    if (typeof raw !== "string")  return false     # unset => off
    normalized = raw.trim().toLowerCase()
    return normalized === "1" || normalized === "true" || normalized === "yes"
```

Public profile fails CLOSED: a public install with the env var set
will NOT auto-activate (mirrors `extension-host-queue-log-policy`'s
invariant at `apps/vscode/src/sdk/extension-host-queue-log-policy.ts:114`).

## Trigger predicate

```text
AllocationProfilerState machine:
    disabled          <- initial; public profile; no dogfood knob
    armed             <- dogfood + knob=1; awaiting first qualifying job
    starting          <- trigger fired; CDP commands in flight
    active            <- HeapProfiler.startSampling acknowledged
    stopping          <- CAPTURE_MAX_DURATION elapsed; stopSampling in flight
    finalized         <- stopSampling completed; final artifact written
    failed            <- any profiler failure; state remains terminal

Trigger:  transition armed -> starting -> active
Finalize: transition active -> stopping -> finalized
Failure:  transition any -> failed
```

Trigger predicate (single, bounded, hot-path-safe):

```text
triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
    return: { kind: "skipped" | "started" | "failed",
              reason?: string,
              previousState: AllocationProfilerState }
    ALWAYS returns synchronously
    NEVER throws
    NEVER touches command behavior on failure
```
Trigger predicate (single, bounded, hot-path-safe):

```text
triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
    return: { kind: "skipped" | "started" | "failed",
              reason?: string,
              previousState: AllocationProfilerState }
    ALWAYS returns synchronously
    NEVER throws
    NEVER touches command behavior on failure
```

The function is a pure state-machine mutator + side-effect dispatcher:

1. If state !== "armed"                    -> return kind="skipped"
2. Else: flip state to "starting"
3. Spawn an async capture loop (do NOT await)
## Artifact layout

Per process: `~/.cline/data/diagnostics/allocation-authority/`

```text
latest.heapprofile.json              <- checkpoint atomic replace target
latest.meta.json                     <- checkpoint metadata
final-<capture-id>.heapprofile.json  <- written only at stopSampling
final-<capture-id>.meta.json         <- final metadata; status="final"
.latest.heapprofile.json.tmp         <- temp; atomic rename target
.latest.meta.json.tmp                <- temp; atomic rename target
```

The "latest" pair is the CHECKPOINT artifact. The "final-<id>" pair is
written exactly once at `stopSampling` and is the FINAL artifact.

## Checkpoint cadence

```text
CHECKPOINT_INTERVAL_MS = 2000
MAX_DURATION_MS        = 60000
```

Justification (per ACT §10):
- Failure can occur around terminal continuation.
- 5s loses too much immediately-pre-crash evidence.
- 1s risks unnecessary Extension Host work.
- 2s is the bounded compromise.

If a checkpoint itself stalls > 500 ms, the profiler records
`host_unresponsive_halt: true` in `meta.json` and halts after the
next checkpoint attempt to satisfy ACT §39.

**NOTE (post HALT_ALLOCATION_FINALIZATION_BROKEN):** the 500 ms
gate now measures **whole-checkpoint wall time** (inspector +
JSON serialize + writeFile + rename), not the Inspector call alone.
A 600 ms serialization/write stall with a 20 ms Inspector call MUST
trip the gate. See P1b fix in `result.json::corrected`.

**Checkpoint failure policy (post HALT_ALLOCATION_FINALIZATION_BROKEN):**
a single transient `getSamplingProfile` rejection (or write
rejection) MUST NOT transition the state machine to "failed". The
loop logs a bounded warning, increments
`transient_checkpoint_failures`, retains `ACTIVE`, and lets the
next tick try again. See P1a fix.

**Finalization policy (post HALT_ALLOCATION_FINALIZATION_BROKEN):**
the finalizer consumes the profile returned by
`HeapProfiler.stopSampling` directly. There MUST NOT be a call to
`HeapProfiler.getSamplingProfile` after `stopSampling`. Calling
`getSamplingProfile` after the sample has stopped fails in the
success path. See P0 fix.

## Sampling options (load-bearing)

Both collected-GC options are REQUIRED for the qualifying contract
(per ACT §20 ALLOCAUTH-PROTO-01):

```ts
{
    samplingInterval: 32768,
    stackDepth: 128,
    includeObjectsCollectedByMinorGC: true,
    includeObjectsCollectedByMajorGC: true,
}
```

A missing/false collected-GC option is a HARD FAIL — the test
ALLOCAUTH-PROTO-01 fails if either is absent.

## Hot-path budget

The trigger call is a single conditional at the marker-registration
seam. It returns synchronously and does NOT block the command tool's
event loop. The async capture loop runs in the background.

If a single `getSamplingProfile()` call exceeds 500 ms, the profiler
records `host_unresponsive_halt: true` and will skip the next
checkpoint tick (one-cycle drop) before resuming. This is the
ACT §39 perturbation gate.

## Conservation

| Conservation test             | Required behavior                                       |
| ----------------------------- | ------------------------------------------------------- |
| ALLOCAUTH-CONSERVE-01         | disabled state => zero state/semantic delta             |
| ALLOCAUTH-CONSERVE-02         | start failure => command still executes                 |
| ALLOCAUTH-CONSERVE-03         | checkpoint failure => job/continuation unaffected       |
| ALLOCAUTH-CONSERVE-04         | notify=false jobs preserve current semantics            |
| ALLOCAUTH-CONSERVE-05         | BTCONT unchanged                                        |
| ALLOCAUTH-CONSERVE-06         | TQCB unchanged                                           |
| ALLOCAUTH-CONSERVE-07         | CCARD unchanged                                          |
| ALLOCAUTH-CONSERVE-08         | terminal-card projection unchanged                      |
| ALLOCAUTH-CONSERVE-09         | queue-log permanent policy unchanged                    |
| ALLOCAUTH-CONSERVE-10         | provenance O(1) repair unchanged                        |

## Temporary instrumentation contract (per ACT §41)

```text
DEFAULT_OFF          = YES
DOGFOOD_ONLY         = YES
BOUNDED              = YES
ONE-SHOT             = YES
NO PROTOCOL FIELD    = YES
NO WEBVIEW FIELD     = YES
NO PUBLIC TOOL FIELD = YES
ZERO TASK-SEMANTIC DELTA = YES
REMOVABLE            = YES
```

REMOVAL_TRIGGER (any of):
1. Allocation authority established (A/B/C classification in result.json)
2. Capture insufficient after bounded correction
3. Profiler perturbation makes evidence unusable
4. Return kind="started"
5. The async loop:
   - connect inspector
   - HeapProfiler.enable
   - HeapProfiler.startSampling with EXACT options:
     { samplingInterval: 32768,
       stackDepth: 128,
       includeObjectsCollectedByMinorGC: true,
       includeObjectsCollectedByMajorGC: true }
   - flip state to "active"
   - schedule periodic checkpoints (CHECKPOINT_INTERVAL_MS = 2000)
   - schedule final timer at MAX_DURATION_MS = 60000
   - on checkpoint tick: getSamplingProfile -> atomic latest replacement
   - on final tick: stopSampling -> consume its returned profile -> write final artifact -> "finalized"
   - any failure: flip to "failed"; log bounded warning; do not throw
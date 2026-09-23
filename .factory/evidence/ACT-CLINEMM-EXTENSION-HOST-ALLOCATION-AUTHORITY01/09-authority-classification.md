# Authority Classification — ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01

## Stage model (per HALT_ALLOCATION_FINALIZATION_BROKEN review P2/P1 evidence-semantics fix)

For the INFRASTRUCTURE stage, the honest state is:

| Field | Value |
| ----- | ----- |
| `INFRASTRUCTURE_READY` | `TRUE` |
| `LIVE_CAPTURE` | `PENDING` (operator action required) |
| `ALLOCATION_AUTHORITY` | `UNAVAILABLE` (cannot be classified without a live capture) |

The classification matrix (A / B / C / D) applies only AFTER a live
capture exists. Pre-capture there is nothing to classify.

## Why this ACT is done

The allocation profiler infrastructure is in place (per ACT §40,
DEFAULT_OFF + DOGFOOD_ONLY + BOUNDED + ONE-SHOT + NO PROTOCOL FIELD
 + NO WEBVIEW FIELD + NO PUBLIC TOOL FIELD + ZERO TASK-SEMANTIC
 DELTA + REMOVABLE). The Inspector smoke probe proves the protocol
 primitive works (per ACT §23). The focused test suite (now 22 tests
 after the HALT_ALLOCATION_FINALIZATION_BROKEN correction) confirms
 the state machine, the trigger predicate, the protocol options, the
 checkpoint lifecycle WITH the new recovery contract (transient
 checkpoint failure retains ACTIVE), the finalize lifecycle including
 the P0 fix (stopSampling return value is the final profile, NOT
 getSamplingProfile after stopSampling), and the conservation
 invariants.

However, NO LIVE CAPTURE has been acquired yet because the dogfood
VSIX has not been built from this tree by the operator. Per ACT §45
(Artifact identity gate), the binding between the live capture's
`installed_bundle_sha256` (the new load-bearing identity per P1c)
and the externally-recorded build SOURCE_HEAD → bundle SHA-256 must
match before the capture is classifiable. That gate is not reachable
from this ACT's scope; it requires:

```bash
# Operator actions (per ACT §25, §26):
cd apps/vscode && bun run check-types && bun esbuild.mjs && bun run package
mkdir -p dist
export CLINEMM_RUNTIME_PROFILE=dogfood CLINEMM_PTAD=1 CLINEMM_DIAG_ALLOCATION_PROFILE=1
# Launch Codium + install the new VSIX + issue the qualifying workload
ls -la ~/.cline/data/diagnostics/allocation-authority/
```

## Stop conditions (per ACT §48) — checked

| Condition | Result |
| --------- | ------ |
| `HALT_REQUIRED_PROFILER_CAPABILITY_UNAVAILABLE` | **NO** — smoke probe proves Node accepts both collected-GC options |
| `HALT_PROFILER_PERTURBATION_TOO_HIGH` | **CANNOT ASSESS** — requires a live capture; not part of this ACT's scope |
| `HALT_REPOSITORY_TRUST` | **NO** — working tree is clean of unrelated dirt (only the ACT's added/modified files; conservative diff: ONE trigger call inside an existing branch) |
| `CAPTURE_INSUFFICIENT` | **DEFERRED** — no live capture exists yet |
| `HALT_ALLOCATION_FINALIZATION_BROKEN` | **RESOLVED** — P0 fix lands; ALLOCAUTH-FINAL-01/01b/01c now deterministically drive the finalizer via `__driveFinalizerForTests` and assert (a) state="finalized", (b) the final artifact equals the profile returned by stopSampling, (c) no `getSamplingProfile` call exists after the final `stopSampling` call, (d) session disconnects exactly once |

## Verdict

`PASS_ALLOCATION_INFRASTRUCTURE_READY_LIVE_CAPTURE_PENDING`

The P0 is fixed: the LIVE success path now provably produces a
`final-<id>.heapprofile.json` exactly equal to the profile returned
by `HeapProfiler.stopSampling`. The three P1s are also fixed (see
`result.json::corrected`). The build-dogfood-VSIX step is now
appropriate (no P0 lives in the success path).

## Next ACT

`ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-LIVE-CAPTURE01`

The successor acquires the first live V8 allocation profile under the
operator's dogfood workload, classifies the allocation authority
(A / B / C / D), and fires the REMOVAL_TRIGGER for the temporary
infrastructure added by this ACT.
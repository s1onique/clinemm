# Allocation Analysis — ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01

## Status

NO LIVE CAPTURE HAS BEEN ACQUIRED YET. This ACT ships the profiling
infrastructure; the operator's first live capture (after building the
dogfood VSIX and running the qualifying workload) is the input for the
successor ACT that classifies allocation authority.

## Provisional analysis (smoke probe output)

The smoke probe (`scripts/inspector-smoke-probe.mjs`) ran a 5M-iteration
synthetic allocation workload in plain Node and captured a profile. The
allocation leaves in that synthetic workload were dominated by the
synthetic-loop helpers themselves (`(anonymous)`, `repeat`, `toString`,
`push`). These are NOT the production allocation owner and the smoke
profile is NOT classifiable as A / B / C.

This is the expected shape of a smoke probe: it verifies that the
profiler works end-to-end, NOT that it identifies the production owner.
The production owner will be revealed by the operator's first live
capture.

## Expected successor ACT structure

The successor ACT (ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-LIVE-CAPTURE01)
will:

1. Run the operator's qualifying workload (background command with
   notify=true) under the dogfood profile.
2. Capture the `final-<id>.heapprofile.json` artifact.
3. Run `scripts/analyze-allocation-profile.mjs` to produce the per-stack
   table.
4. Cross-reference the ACT §32 candidate set
   (`captureContinuationCardinalityAuthorityRecord`, `xmlTagsRemoval`,
   `normalizeUserInput`, `PendingPromptsController.drain`,
   `TurnStateTracker.setWith`).
5. Classify A / B / C / D per ACT §35.
6. Fire the REMOVAL_TRIGGER per ACT §41 (remove all infrastructure
   files in this ACT if classification is reached OR if the capture
   is CAPTURE_INSUFFICIENT).

## Analyzer output structure (per ACT §34)

When the live capture is available, the analyzer emits:

```
# allocation-profile analysis
profile: <path>
total samples: N
total sampled bytes: N
unique stacks: N

## Top N allocation leaves

| Allocation leaf / stack | Sampled bytes | Allocation samples | Share | Classification |
| ----------------------- | ------------: | -----------------: | ----: | -------------- |
| candidate A             | ...          | ...                | ...   | MATERIAL       |
| candidate B             | ...          | ...                | ...   | MATERIAL       |
| other X                 | ...          | ...                | ...   | DOMINANT       |
| candidate C             | ...          | ...                | ...   | SMALL          |

## ACT §32 candidate set (explicit suspects)
- captureContinuationCardinalityAuthorityRecord: samples=N bytes=N
- xmlTagsRemoval: samples=N bytes=N
- normalizeUserInput: samples=N bytes=N
- PendingPromptsController.drain: samples=N bytes=N
- TurnStateTracker.setWithWriter: samples=N bytes=N
```

## Metric semantics (per ACT §31)

- "sample count"   = statistical count from V8 sampling
- "sampled allocation bytes" = sum of `size` across samples attributed
  to a stack
- We do NOT infer call count or absolute bytes allocated

## Classification matrix (per ACT §35)

### A — ONE DOMINANT OWNER
```text
one source stack clearly dominates sampled allocation
```
Successor targets that seam.

### B — MULTIPLE MATERIAL OWNERS
```text
several stacks contribute materially
```
Do NOT bundle unrelated repairs automatically. Find whether they
share one lower-level allocation mechanism first.

### C — CURRENT CANDIDATES DO NOT EXPLAIN PRESSURE
```text
different stack dominates
```
Successor follows the actual stack.

### D — PROFILE INSUFFICIENT
```text
capture truncated too early
profiler perturbs host materially
no usable allocation stacks
```
Stop. Acquire better evidence; do not patch.
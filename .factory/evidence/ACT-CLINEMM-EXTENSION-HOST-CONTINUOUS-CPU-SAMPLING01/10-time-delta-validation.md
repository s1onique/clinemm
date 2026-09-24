ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01 — TimeDelta Validation

## Discipline (per ACT §25)

The analyzer treats:

    samples.length / node hitCount

as CPU sampling observations (the authoritative signal). It does NOT
blindly convert timeDeltas into self-time percentages without first
validating the first delta and outlier distribution.

## Required guards per leaf

| Guard | Source | Purpose |
| ----- | ------ | ------- |
| first_timeDelta | timeDeltas[0] | Detect pathological first sample gap |
| max_timeDelta | max(timeDeltas) | Detect outlier single-sample gap |
| p95_timeDelta | quantile(timeDeltas, 0.95) | Robust central tendency |
| sampleShare | leaf.hitCount / sum(all hitCount) | ALWAYS valid (raw samples) |
| deltaShare | leaf.sum(timeDeltas) / sum(all timeDeltas) | REQUIRES validation |

## TIMEDELTA_ATTRIBUTION_UNRELIABLE rule

If a leaf's deltaSum is dominated by a single anomalous gap:

    outlierFraction = bucket.maxDelta / bucket.deltaSum

    if outlierFraction > 0.5:
        mark leaf as TIMEDELTA_ATTRIBUTION_UNRELIABLE
        -> prefer raw sample share over deltaShare
        -> do NOT use deltaShare causally

The analyzer sets `timedeltaUnreliable: true` for such leaves and emits
"YES" in the unreliable column. Operators MUST treat deltaShare for those
leaves as suspect.

## Demonstration (smoke probe output)

Per the analyzer's output (segment 0):

    | # | hitCount | rawSampleShare | deltaShare | max_delta | p95_delta | first_delta | unreliable | leaf |
    | -: | -------: | -------------: | ---------: | --------: | --------: | ----------: | :--------- | :--- |
    | 1 | 450 | 56.890% | 56.761% | 1522 | 1485 | 1482 | no | (module) @ ... |
    | 2 | 339 | 42.857% | 43.103% | 1519 | 1488 | 1035 | no | now @ <native>:-1:-1 |
    | 3 | 1  | 0.126%  | 0.130%  | 1295 | 1295 | 1295 | YES | sin @ <native>:-1:-1 |
    | 4 | 1  | 0.126%  | 0.006%  | 63   | 63   | 63   | YES | push @ <native>:-1:-1 |

Leaves 1 and 2 (the dominant hot leaves) have:
    - outlierFraction = max_delta / sum_deltas
                       = 1522 / (56.761% × 998580) ≈ 1522 / 566789 ≈ 0.0027 (well under 0.5)
    -> reliable
    -> deltaShare IS safe to use

Leaves 3 and 4 (single-sample leaves) have:
    - outlierFraction = max_delta / sum_deltas = 1.0 (one sample = 100% of delta)
    -> UNRELIABLE
    -> deltaShare for these leaves is NOT safe to use
    -> prefer sampleShare

## Production discipline

For any production dogfood capture:

    1. Examine the per-segment top-N table
    2. For each leaf, check the unreliable column
    3. If unreliable == YES: rank by sampleShare, NOT deltaShare
    4. Cross-segment aggregation uses raw sample totals, not delta sums
    5. deltaShare is ADVISORY ONLY when unreliable == YES

This guards against attributing time to leaves that happened to land on
a single sample with an outlier gap — exactly the failure mode that
corrupted the prior cwi analysis (per ACT-CLINEMM-EXTENSION-HOST-CPUPROFILE-TIMEDELTA-VALIDATION01).

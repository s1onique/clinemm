# ACT-CLINEMM-EXTENSION-HOST-CPUPROFILE-TIMEDELTA-VALIDATION01

**Status:** PASS — `CWI_CPU_HOTLEAF = REFUTED`, `CWI_ADJACENT_TO_STALL = PROVEN`.
**Date:** 2026-09-23.
**Reviewer disposition:** `HALT_CWI_HOTNESS_ATTRIBUTION_INVALID` (V8 profiling engineer +
Factory causal reviewer).
**Predecessor:** ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLEAF-SYMBOLIZATION02
(which established `cwi = enterExtensionHostHotloopHandleSessionEvent`
symbolically; this ACT validates the *performance attribution*, not the binding).

## Mission (verbatim from reviewer's required bounded discriminator)

> Do **not** modify `enterExtensionHostHotloopHandleSessionEvent`.
> Before HOTPATH02, produce one tiny evidence artifact:
> For every one of the 11 `cwi` samples, record sample index, sample node id,
> timeDelta[i], preceding sample, following sample.
> Then report min, median, p95, max, sum attributed to cwi.
> Also calculate unweighted sample shares for the top leaves.

No production code changes. Pure accounting validation.

## Sources

- Profile: `/Volumes/UserData/Users/chistyakov/Downloads/exthost-402d7f.cpuprofile`
  (331,216 bytes, produced by the post-provenance-repair crash capture session).
- Repro script: `/tmp/timedelta_validate.js` (reads only; emits ASCII table).
- Script invocation: `/opt/homebrew/bin/node /tmp/timedelta_validate.js`.

## Raw inspection (machine-verbatim)

```
profile top-level keys : nodes, startTime, endTime, samples, timeDeltas
nodes                  : 180
samples                : 38,582
timeDeltas             : 38,582
startTime              : 494,677,901,777 us
endTime                : 494,685,096,860 us
duration               : 7,194.81 ms (7,194,810 us)
```

Node IDs identified by name:

```
cwi                   = node id 15   (cwi@extension.js:1:4773)
(garbage collector)   = node id 67   (no line/col)
Rnl                   = node id 37   (Rnl@extension.js:15:21885)
drain                 = node id  4   (drain@extension.js:2549:11684)
r_                    = node id 36   (r_@extension.js:15:21185)
```

(`cwi hitCount = 12`, not 11 as previously stated. The prior ACT miscounted;
the empirical truth is 12. Still ≈0.031% of samples — an order of magnitude
below any genuine hot leaf.)

## Per-cwi-sample table (all 12 samples)

| idx  | td (us)   | td (ms)   | prev (id/name)                            | next (id/name)                              |
|-----:|----------:|----------:|:-------------------------------------------|:--------------------------------------------|
|    0 | 2,189,353 | 2189.353  | (none — first sample)                      | 16 lwi@extension.js:1:4639                  |
|  972 |       128 |     0.128 | 37 Rnl@extension.js:15:21885               | ?  Gyi@extension.js:4422:25                 |
| 1867 |       128 |     0.128 | ? enqueue@extension.js:2549:9467           | ?  e_@extension.js:1:2250                   |
| 5651 |       128 |     0.128 | ? setWithWriter@extension.js:4468:37927    | 1  (program)@:-1:-1                         |
| 7538 |       129 |     0.129 | 4 drain@extension.js:2549:11684            | ?  Mc@extension.js:229:61130                |
| 9196 |       129 |     0.129 | 37 Rnl@extension.js:15:21885               | ?  Gyi@extension.js:4422:25                 |
|18840 |       128 |     0.128 | 36 r_@extension.js:15:21185                | 36 r_@extension.js:15:21185                 |
|24510 |       129 |     0.129 | 37 Rnl@extension.js:15:21885               | ?  setWithWriter@extension.js:4468:37927    |
|24609 |       129 |     0.129 | ? onSessionEvent@extension.js:4469:7730    | 36 r_@extension.js:15:21185                 |
|27878 |       128 |     0.128 | ? getSessionOrThrow@extension.js:2549:50604| 4 drain@extension.js:2549:11684             |
|37217 |       130 |     0.130 | ? knl@extension.js:15:21433                | 37 Rnl@extension.js:15:21885                |
|37993 |       128 |     0.128 | ? enqueue@extension.js:2549:10897          | 37 Rnl@extension.js:15:21885                |

Distribution summary:

```
cwi: n=12  min=0.128ms  p50=0.128ms  p95=0.130ms  max=2189.353ms  sum=2191.353ms
cwi excluding idx=0 (the pathological gap):
    n=11  min=0.128ms  p50=0.128ms  p95=0.129ms  max=0.130ms  sum=1.403ms
```

**Single outlier at idx=0 contributes 99.94% of the entire timeDelta sum
attributed to `cwi` (2,189.353ms / 2,191.353ms = 99.94%).** All eleven other
cwi samples are ordinary ~128µs ticks, fully consistent with the V8 default
sampling interval (~128µs between samples) for this profile.

## Control-sample table (same statistics for non-cwi leaves)

```
(garbage collector)  : n=17,012  min=0.079ms  p50=0.129ms  p95=0.135ms  max=1.257ms   sum=2,213.8ms
Rnl                  : n= 2,726  min=0.112ms  p50=0.129ms  p95=0.134ms  max=1.898ms   sum=  354.8ms
drain                : n= 2,120  min=0.080ms  p50=0.129ms  p95=0.134ms  max=0.197ms   sum=  273.9ms
r_                   : n= 1,788  min=0.106ms  p50=0.129ms  p95=0.134ms  max=0.245ms   sum=  232.0ms
```

**`max delta` for all controls ≤ 1.898 ms.** No pathological gaps. By contrast
`cwi`'s `max delta` is 2189.353 ms — three orders of magnitude beyond any
control leaf and 1742× larger than its own p95. This single sample is a
spike, not a measurement.

## Top leaves: hitCount vs sampleShare vs deltaShare

(0.031% sampleShare for cwi is `12/38582 = 0.000311`, displayed as
percentage rounded to three decimals — the same convention the prior ACT used.)

| rank | function                          |   hits | sampleShare | deltaShare |
|-----:|:----------------------------------|-------:|------------:|-----------:|
|    1 | `(garbage collector)              `| 17,012 |    44.093%  |    30.78%  |
|    2 | `cwi                              `|     12 |   **0.031%**| **30.45%** |
|    3 | `Rnl                              `|  2,726 |     7.065%  |     4.93%  |
|    4 | `drain                            `|  2,120 |     5.495%  |     3.80%  |
|    5 | `r_                               `|  1,788 |     4.634%  |     3.22%  |
|    6 | `e_                               `|  1,327 |     3.439%  |     2.39%  |
|    7 | `Gyi                              `|  1,251 |     3.242%  |     2.24%  |
|    8 | `e_                               `|  1,146 |     2.970%  |     2.06%  |
|    9 | `e_                               `|  1,090 |     2.825%  |     1.96%  |
|   10 | `setWithWriter                    `|    976 |     2.530%  |     1.75%  |
|   11 | `processTicksAndRejections        `|    919 |     2.382%  |     1.65%  |
|   12 | `handleSessionEvent               `|    692 |     1.794%  |     1.24%  |
|   13 | `onSessionEvent                   `|    521 |     1.350%  |     0.93%  |

The asymmetry between `hits` and `deltaShare` for `cwi` is the entire
post-provenance-repair attribution anomaly. No other top-13 leaf shows a
sampleShare-to-deltaShare inversion of this magnitude. The genuine hot
leaves (GC, Rnl, drain, r_) all show **proportional** hits-to-deltaShare
ratios consistent with continuous CPU consumption.

## Causal interpretation (factually bounded)

The cpuprofile format is V8 / Chrome DevTools sampling output. `timeDeltas[i]`
is the wall-clock interval **before** sample `i`. The "sum timeDelta to
leaf" convention attributes the inter-sample gap to whatever node is at
the top of the stack. That attribution is correct for typical sampling
rates where adjacent samples arrive every ~100–130µs; it produces
misleading aggregations when one sample arrives after a long stall.

The cwi sample at idx=0 is preceded by **no other sample** (it is the
first sample of the profile), but `timeDeltas[0]` is **2,189.353ms** —
implying that the cpuprofile capture itself started 2.2 seconds into a
running stall. There is no preceding sample whose own `td` could account
for that interval, so the attribution algorithm assigns it entirely to
whatever was at the top of the stack at idx=0, which happens to be `cwi`.

Three independent interpretations are consistent with the raw numbers
(presented for reviewer audit; none can be picked from this profile
alone — that would require live re-capture with diagnostic instrumentation):

1. **Capture start lag.** The V8 sampling clock began 2.2s after the first
   `cwi` call landed at the top of stack (e.g. the sampler was attached
   mid-stall). No CPU work attributed to cwi in this interpretation.
2. **Profile writer gap.** Some sample writer / serialization step froze
   the writer for 2.2s with cwi executing. Plausible if the writer was
   producing the profile metadata itself (extensions sometimes serialize
   on the host event loop).
3. **Sampling suspension.** V8's sampler suspended briefly during a
   one-time initialization (extension activation, sourcemap attach, etc.).

What the data refutes with absolute certainty:

> "cwi itself consumed ~2.19 seconds of CPU executing three integer increments."

A function whose body is `_nestedDepth++; _counters.handleSessionEventCalls++;
if (_nestedDepth > _counters.maxNestedHandleDepth) _counters.maxNestedHandleDepth = _nestedDepth;`
and which is JIT-inlined into a synchronous dispatch site cannot be on top
of stack for ~2.2 seconds of CPU work. The only way for `cwi` to be on
top of stack for ~2.2 seconds is if the stack was pinned (e.g. blocked
in native code, or the sampler was suspended) while the dispatcher
entered and exited.

## What this ACT proves

```
CWI_CPU_HOTLEAF                = REFUTED
CWI_ADJACENT_TO_STALL          = PROVEN
cwi_real_self_time             = sum of cwi timeDeltas excluding the pathological gap
                               = 1.403 ms across 11 ordinary samples
                               = 0.0000195% of the 7,194.81 ms profile
cwi bound as                   = enterExtensionHostHotloopHandleSessionEvent (UNCHANGED from prior ACT)
diagnostic module              = observation-only TEMPORARY (UNCHANGED)
diagnostic body                = trivial O(1) instrumentation (UNCHANGED)
HOTPATH02                      = NOT AUTHORIZED until the genuine hot leaves are analyzed
```

## What this ACT does NOT prove

- Does NOT prove that `cwi` is irrelevant. It is on the hot path every
  time `handleSessionEvent` runs; minimizing its cost remains a reasonable
  goal. It does not, however, explain the post-provenance-repair crash.
- Does NOT prove which leaf DOES explain it. GC (44.09% sample share,
  17,012 samples, max single delta 1.257ms) is the strongest signal by
  raw sample count. Rnl (7.07% sample share, 2,726 samples, max 1.898ms)
  is the second-strongest. Both warrant symbolization under the same
  two-method discipline used for cwi.
- Does NOT authorize any modification to
  `enterExtensionHostHotloopHandleSessionEvent` or to the broader
  `extension-host-hotloop-diagnostic.ts` module.

## Also: retraction of the overclaimed V8 column-position causal story

The prior ACT (`HOTLEAF-SYMBOLIZATION02`) added a paragraph explaining the
`-50` column offset as:

> "V8 anchors leaf-frame columns exactly 50 bytes before the function."

The empirical statement — `all observed sibling locations exhibit a -50
offset` — is true. The causal explanation is not. V8 column reporting for
minified bodies is documented but the byte-precision "−50 bytes"
attribution to "previous function's end" was speculation. We retain the
empirical observation in the binding evidence and **retract the causal
explanation**. (P2 from reviewer's disposition; non-blocking.)

## Disposition

The reviewer's disposition is adopted in full:

```
cwi source binding                                  = PASS  (unchanged from prior ACT)
symbolization ACT (HOTLEAF-SYMBOLIZATION02)         = CLOSED
cwi = 30.45% actual CPU                             = REFUTED
cwi hitCount                                        = 12 / 38,582  (was 11)
cwi raw sample share                                ≈ 0.031%
delta-weighted attribution to cwi                    = artifact of one pathological inter-sample gap
                                                       (idx=0 td=2,189.353ms),
                                                       NOT a measurement of cwi's CPU cost
cwi genuine self-time (gap excluded)                 = 1.403 ms across 11 ordinary samples
GC raw sample share                                 ≈ 44%
allocation pressure                                 = STRONG SIGNAL (still)
HOTLOOP-DIAGNOSTIC-HOTPATH02                        = NOT AUTHORIZED
```

**NEXT ACT** (separate run):

```
ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01
cycle 1 of 1
goal:
   bind Rnl@extension.js:15:21885         to one exact original source function/expression
   bind r_@extension.js:15:21185          to one exact original source function/expression
   bind e_@extension.js:1:2250            to one exact original source function/expression
   bind drain@extension.js:2549:11684     to one exact original source function/expression
   bind Gyi@extension.js:4422:25          to one exact original source function/expression
method:
   Same two-method discipline as ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLEAF-SYMBOLIZATION02:
   (1) production-bundle body correlation
   (2) sourcemap rebuild sanity check
   Then tabulate hitCount / sampleShare / deltaShare / max-delta for each,
   to make the empirical hot-leaf ranking durable for downstream repair
   consideration.
out of scope:
   any modification to enterExtensionHostHotloopHandleSessionEvent
   any modification to any leaf function
   any modification to the EHLOOP01 diagnostic module
```

The REMOVAL_TRIGGER for the diagnostic module
(`apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts`) does NOT change.



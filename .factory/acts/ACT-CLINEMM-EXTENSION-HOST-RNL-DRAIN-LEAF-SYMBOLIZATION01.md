# ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01

**Status:** `PASS_SYMBOLIZATION_WITH_CAUSALITY_GAP — HALT_REPAIR_ACT`
(post TWO rounds of V8/Node perf-engineer + Factory causal review)

**Date:** 2026-09-23 (initial closure same day — reopened after round-1
causal review on the causal mapping; reopened a second time after
round-2 review on the gc_run_adjacency aggregation. See "Causal-review
fixes" below.)

**Reviewers:** V8 profiling engineer, Node.js performance engineer,
Factory causal reviewer.

**Predecessor:** ACT-CLINEMM-EXTENSION-HOST-CPUPROFILE-TIMEDELTA-VALIDATION01
(`cwi` CPU hotleaf REFUTED; top sustained leaves = Rnl, drain, r_,
e_, Gyi).

## Causal-review fixes (in-place; no replacement ACT)

Two rounds of causal review identified six defects in the initial
closure. They are fixed in this ACT in place (no new investigation
cycle):

| #              | Defect                                                                                                  | Fix                                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 (round 1) | hitCount was promoted into invocation/allocation rate (e.g. "2726 RegExp constructions").         | hitCount is now NEVER converted to call count or byte rate anywhere in result.json or evidence. Per-call costs are established from source-body inspection only (structural estimate). The "Samples" column has replaced "Hits" in summary tables. |
| P0-2 (round 1) | GC adjacency algorithm multiplied each boundary leaf by run length.                                  | Split into TWO clearly labeled metrics: PRIMARY `gc_run_adjacency` (one per contiguous GC run, run-length-independent, sanity-checked at 855 ≤ 428×2) and LEGACY `gc_sample_weighted_boundary_exposure` (BIASED, retained under honest name only). |
| P0 (round 2)   | PRIMARY `gc_run_adjacency.leaf_stats` keyed by sample index, not leaf `node_id`; the same leaf emitted as N duplicate rows. Function-level totals were a re-aggregation the analyzer did not emit. (Smoke gun: `e_` × 3 = 266 vs sum across leaves = 177 — but the rows are unique-by-sample-idx duplicates.) | Aggregated by `leafId` so each `node_id` occurs at most once. Analyzer enforces three invariants at build time and exits with code 3 if any fail: (I1) sum ≤ 2 × gcRuns (PRIMARY); (I2) unique node_ids; (I3) function total == sum of leaf rows. Numbers from PRIOR output (661 rows, ranked by sample index) are NOT relied upon for causal selection. |
| P1 (round 1)   | Method B two-method claim was blanket.                                                              | Method B status is now per target: `TWO_METHOD_AGREEMENT` for `cwi` + `e_`×3; `METHOD_A_EXACT_BODY_BINDING` (Method B non-correlatable) for all other targets. Method A remains binding of record for every target. |
| P1 (round 1)   | Three distinct git/identity objects were conflated as "source HEAD".                                | Disambiguated into `ANALYSIS_REPO_HEAD` (working tree this analyzer was authored in; may differ), `DOGFOOD_SOURCE_HEAD` (= commit that produced the installed bundle, `d92235e67711976eb3582617583e9804034724e3`), and `PROFILE_SUBJECT_HEAD` (N/A: a `.cpuprofile` is not a git object). |
| P1 (round 2)   | Successor ACT's primitives were technically wrong: `v8.writeHeapSnapshot` and `worker.getHeapSnapshot` return heap STATE snapshots of survivors, not sampling allocation profiles. | Successor uses Inspector `HeapProfiler.startSampling` / `stopSampling` (CDP v8.HeapProfiler) which returns a `SamplingHeapProfile` with per-sample `size` and `nodeId`. `node --heap-prof --heap-prof-interval=N` is a valid external CLI fallback. **Mandatory** options: `includeObjectsCollectedByMinorGC: true`, `includeObjectsCollectedByMajorGC: true` — without them the profile reports only survivors, missing the short-lived allocation churn our hypothesis implicates. |

### Why no new investigation cycle

Both rounds of review were bounded re-reads of THIS ACT's
emissions. The fixes above are mechanical:

1. The aggregation defect was a literal key bug in
   `buildTable()`. Fix: change the key from `sampleIdx` to
   `leafId`. Three executably-checked invariants prove the new
   structure is correct.
2. The primitive defect was a wrong tool name in the documentation
   of the preallocated successor. Fix: replace with the actual CDP
   v8.HeapProfiler.startSampling protocol and its required
   options.

The new facts do not change symbol bindings (those are method-A
body decodes, unaffected). They restore the structural invariants
that the original review only asserted verbally.

## Mission (verbatim, frozen)

> Symbolize the genuinely high-frequency JS leaves around the GC-heavy crash,
> bind each to exact source, reconstruct caller ancestry, and authorize
> **no repair** until an allocation-capable source seam is proven.

## Method

Two-method binding discipline (same as ACT-02):
1. **Method A — exact production-bundle body correlation.** Read every
   function's body in the installed minified bundle, extract
   the byte range, decode tokens 1-to-1 against source.
2. **Method B — exact-HEAD rebuild with sourcemap=external.** Build a
   prodlike esbuild bundle (minify=true, sourcemap=true, IS_DEV=false)
   and decode via Mozilla's `source-map` package.

After causal review, Method B's applicability is acknowledged to be
**per-target, not blanket**. For most targets the prodlike minify
rebuild DCE'd/inlined the candidate so Method B's offset comparison
yields a non-comparable source position. Method A remains the binding
of record for every target regardless.

## Evidence

Evidence directory: `.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01/`

```
01-entry-state.txt                     Frozen entry state + reviewer disposition + causal-review fixes
02-artifact-identity.md                Identity labels: ANALYSIS/DOGFOOD/PROFILE_SUBJECT heads + SHAs
03-target-node-table.md                Top 13 sustained hot leaves ranked by raw sample count (NOT invocations)
04-production-bundle-bindings.md       Method A — body decode for every target (with hitCount caveat)
05-sourcemap-bindings.md               Method B — sourcemap decode + per-target method status
05-sourcemap-bindings.json             Method B — machine-readable binding results
06-caller-ancestry.md                  Parent chains up to runtime boundary (with hitCount caveat)
07-allocation-capability.md            Allocation-capability classification (structural, not measured)
08-gc-adjacency.md                     GC run-length distribution + PRIMARY adjacency (bias-free)
09-candidate-matrix.md                 Bounded candidate matrix (HIGH/MEDIUM/LOW)
10-final-bindings.md                   Leaf → exact source mapping per target + method status
result.json                            Machine-readable result, caveats, status, adjacency
```

## Tooling

`scripts/analyze-cpuprofile-hot-leaves.mjs` (committed with this ACT).

Single reusable ES module that:
- Parses any Chrome-format `.cpuprofile`.
- Builds the parent map.
- Computes per-node statistics (sample count = hitCount, sample share,
  timeDelta stats, max/min/median/p95 deltas).
- Walks parent chains to reconstruct caller ancestry.
- Counts GC run-length statistics and emits BOTH the bias-free
  `gc_run_adjacency` and the honest-name `gc_sample_weighted_boundary_exposure`.
- Performs Method A calibration against `enterExtensionHostHotloopHandleSessionEvent`.
- Emits `interpreter_caveats`, `identity_disambiguation`,
  `method_b_status` blocks at the top of result.json.

PROFILE-CTL-01 (sum(hitCount) ≈ samples.length) — passes within 1 sample.
PROFILE-CTL-02 (cwi binding) — passes.

## Bindings (final; METHOD STATUS updated per causal review)

| Mangled        | Authored function                                  | Source file:line                                | Allocation class                                | Method status                       |
|----------------|----------------------------------------------------|-------------------------------------------------|--------------------------------------------------|--------------------------------------|
| `cwi`          | `enterExtensionHostHotloopHandleSessionEvent`     | extension-host-hotloop-diagnostic.ts:147-154    | NO_OBVIOUS (counter, gated)                       | TWO_METHOD_AGREEMENT                 |
| `Rnl`          | `xmlTagsRemoval`                                    | format.ts:224-229                                | ALLOCATES_DIRECTLY (1 RegExp)                     | METHOD_A_ONLY (prod DCE'd Method B)  |
| `r_`           | `normalizeUserInput`                                | format.ts:134-146                                | ALLOCATES_DIRECTLY (2-4 RegExps)                  | METHOD_A_ONLY (prod DCE'd Method B)  |
| `e_` ×3        | `captureContinuationCardinalityAuthorityRecord`    | continuation-cardinality-authority.ts:185-214   | DOCS_DIAGNOSTIC_ONLY: NO_OBVIOUS; DOGFOOD_ON: ALLOCATES | TWO_METHOD_AGREEMENT (`e_1`/`e_2`/`e_3`) |
| `Gyi`          | `isSyntheticUserPrompt`                            | sdk-user-message-mapping.ts:72-108              | MAY_ALLOCATE_VIA_CALLEE (cost on `r_`)         | METHOD_A_ONLY (prod DCE'd Method B)  |
| `drain`        | `PendingPromptsController.drain`                    | pending-prompt-service.ts:423-507               | ALLOCATES_DIRECTLY (conditional literals + snapshot) | METHOD_A_ONLY (prod DCE'd Method B) |
| `setWithWriter`| `TurnStateTracker.setWithWriter`                   | turn-state-tracker.ts:96-153                    | ALLOCATES_DIRECTLY — UNCONDITIONAL (eager literal) | METHOD_A_ONLY (prod DCE'd Method B) |
| `handleSessionEvent` × 3 | `SdkSessionEventCoordinator.handleSessionEvent` | sdk-session-event-coordinator.ts:419-540        | MAY_ALLOCATE_VIA_CALLEE                          | METHOD_A_ONLY                       |
| `onSessionEvent` × 3     | `SdkMessageCoordinator.onSessionEvent`            | sdk-message-coordinator.ts:57-62                | ALLOCATES_DIRECTLY (closure; lifetime = listener)| METHOD_A_ONLY                       |

The presence of a `new RegExp(...)` / object literal is the
**structural** allocation-capability evidence. Whether actual call
frequency is high enough to drive the 44% GC pressure is NOT
established by this ACT and is the precise question the bounded
successor ACT must answer with allocation-sampling data.

## Final answer to the question (causal-review refactor)

> **Which source-level seam should the next causal repair ACT investigate for the 44% GC pressure?**

The CPU sample evidence is consistent with several allocation-capable
source seams. But the CPU profile DOES NOT establish which of them is
the dominant cause of the 44% GC pressure because it does not measure
allocation, only sample-presence.

What the evidence does support:
  - Structural allocation capability per leaf is established
    (presence of `new RegExp(...)`, object literal, closure).
  - Which leaves are conditional on which flags (`captureEnabled`,
    `logQueueEvents`, etc.) is established.
  - Five allocation-capable source seams share overlapping caller
    chains (`drain` → handler → input → render → normalize →
    classify → emit).

What the evidence does NOT support:
  - Actual allocation rate per leaf (CPU profile is sample-based).
  - Causal ownership of the 44% GC sample share.

The previously-published "cumulative unconditional allocation churn
across the prompt-send pipeline" causal claim was based on:
  - hitCount-as-call-rate derivation (invalid, see fix P0-1),
  - GC adjacency multiplied by run length (biased, see fix P0-2),
  - a synthetic `<25%` GC threshold (no product/runtime basis).

Those claims are retracted.

## Repair-successor ACT (post causal-review)

**Recommended**: `ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01`

This successor does NOT touch production code. Its purpose is to
acquire **allocation-stack evidence** — not CPU-presence evidence —
because that is the only way to upgrade correlation (which this ACT
established) to causation (which it cannot). The previous draft
listed the wrong primitives; the second-round review caught it.

**Correct primitives:**

- Use the Inspector `HeapProfiler.startSampling` /
  `HeapProfiler.stopSampling` protocol (CDP v8.HeapProfiler domain).
  These return a `SamplingHeapProfile` whose samples carry
  allocation `size` and `nodeId` and whose nodes carry `selfSize`.
  This is the correct primitive for sampled allocation bytes.
- `v8.writeHeapSnapshot()`, `Worker.getHeapSnapshot()`, and
  `--heap-sampling` are NOT the right tool here — `writeHeapSnapshot`
  returns a heap STATE snapshot (survivors), not a sampling profile.
  `node --heap-prof --heap-prof-interval=N` IS a valid external CLI
  fallback that emits the same shape.
- `includeObjectsCollectedByMinorGC: true` and
  `includeObjectsCollectedByMajorGC: true` are **mandatory** for
  this hypothesis. Without the minor-GC option the profile reports
  only survivors at `stopSampling` time. Our hypothesis is that
  short-lived allocation churn dies young and triggers GC; an
  object that died young in a minor GC will not appear in the
  survivors-only profile. The CDP documentation explicitly notes
  the minor-GC option exists for latency-sensitive applications
  whose temporary allocations cause GC activity — which is exactly
  our case.
- Capture in a REAL Extension Host process under the REAL dogfood
  workload. In-process via Node `inspector.Session.send` is the
  standard way to issue HeapProfiler commands without external
  CDP.

**Per-stack output the successor must emit:**

- allocated sampled bytes
- sample count
- allocation stack
- source function
- source URL
- line/column

**Candidates the successor must specifically test** (already
symbolized by this ACT, but with no measured allocation rate):

- `captureContinuationCardinalityAuthorityRecord`
- `xmlTagsRemoval`
- `normalizeUserInput`
- `PendingPromptsController.drain`
- `TurnStateTracker.setWithWriter`

**And the successor must NOT** restrict success to the existing
five; the allocation profiler may reveal a different dominant
owner.

**Classification:**

- A: one candidate dominates
- B: multiple candidates materially contribute
- C: none explain allocation pressure

**Ablation ordering (NO early ablation):**

- Do NOT ablate first. First the allocation profile identifies
  candidate stacks. THEN, if `captureContinuationCardinalityAuthorityRecord`
  is in the candidate set, run one diagnostic-ON vs diagnostic-OFF
  ablation as a discriminator. Ablating before allocation profiling
  would obscure the candidate set.

The previously-suggested
`ACT-CLINEMM-EXTENSION-HOST-PROMPT-SEND-PIPELINE-ALLOCATION-HOTPATH01`
four-seam repair ACT is explicitly NOT authorized. Its motivating
metrics were the four defects fixed above.

The successor's repair-success condition must be causal (targeted
allocation stack collapses materially + Extension Host remains
responsive LIVE). The earlier draft `<25%` GC threshold had no
established product or runtime basis and is rejected.

## Verdict (post TWO rounds of causal review)

`PASS_SYMBOLIZATION_WITH_CAUSALITY_GAP — HALT_REPAIR_ACT`

- All nine hot-leaf mangled names are bound to exact authored source
  functions, source files, source lines, caller paths, and allocation
  capability (structural).
- Method status is honest per-target (TWO_METHOD_AGREEMENT for cwi +
  e_×3; METHOD_A_EXACT_BODY_BINDING with non-correlatable Method B
  rebuild for the rest). Method A is binding of record for every
  target regardless.
- Round-1 measurement defects (P0-1 hitCount-as-rate,
  P0-2 adjacency × run-length) are fixed and labeled.
- Round-2 aggregation defect (PRIMARY key not by leafId) is fixed;
  three executably-checked invariants guard the new structure.
- Round-2 successor-primitive defect (`v8.writeHeapSnapshot` /
  `worker.getHeapSnapshot` conflation) is fixed; the bounded
  successor now uses Inspector `HeapProfiler.startSampling` /
  `stopSampling` with `includeObjectsCollectedByMinorGC: true`
  and `includeObjectsCollectedByMajorGC: true`.
- Identity heads are disambiguated.
- **The 44% GC pressure's allocation owner is NOT established by this
  ACT.** A repair ACT that touches four independent production seams
  simultaneously is unjustified until allocation-sampling evidence is
  captured by the preallocated successor ACT.

## Gates

```
profile parser succeeds                                     ✓
bundle SHA verified                                         ✓
ANALYSIS_REPO_HEAD / DOGFOOD_SOURCE_HEAD / PROFILE_SUBJECT_HEAD
    (three heads, disambiguated)                            ✓
cwi calibration binding succeeds (PROFILE-CTL-02)          ✓
all target nodes enumerated                                 ✓ (21 targets)
production-body binding complete (Method A)                ✓ (9 distinct
                                                            authored funcs)
sourcemap binding complete (Method B per-target)           ✓ (cwi + e_×3
                                                            TWO_METHOD,
                                                            rest B non-
                                                            correlatable;
                                                            A binding of
                                                            record)
caller ancestry extracted                                   ✓ (per-target
                                                            parent chain)
GC adjacency PRIMARY metric                                 ✓ (855 ≤ 428×2)
GC adjacency LEGACY metric labeled honestly                ✓
GC adjacency aggregation invariants                         ✓ (I1, I2, I3
                                                            on both tables;
                                                            analyzer
                                                            hard-fails
                                                            on any
                                                            violation)
NO claims derive call/allocation rate from hitCount        ✓ (explicit
                                                            C1 caveat
                                                            emitted)
GC adjacency leaf-id aggregation bug (round-2 P0)          ✓ CLOSED
    primary rows=69 (was 661); every node_id unique
    function total == sum of leaves (verified per row)
    analyzer exits 3 if any invariant violated
Successor ACT primitives fixed (round-2 P1)                ✓ CLOSED
    HeapProfiler.startSampling / stopSampling
    includeObjectsCollectedByMinorGC: true
    includeObjectsCollectedByMajorGC: true
git diff --check clean (predecessor ACT untouched)         ✓
PROFILE-CTL-01 sum(hitCount) ≈ samples.length              ✓ (within 1)
```

No full application test suite was needed for a zero-production-code
symbolization ACT.

## Repository trust

```
$ git status --short
?? scripts/analyze-cpuprofile-hot-leaves.mjs
?? .factory/evidence/ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01/
?? .factory/acts/ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01.md
```

Only the new analyzer script and this ACT's evidence/ACT-file are
untracked. No tracked file was edited, no source under
`apps/vscode/src` or `sdk/packages/*` was modified, no production code
touched. The `.cpuprofile` is unchanged (SHA256
`4c15bde38176a614aaf0e97c69176f584eb5bf09f9592ae93859dc2d9e4f405e`).
The production bundle is unchanged (SHA256
`78ec3a0b9017ad467cd4886ff0c16f2a5061f286783c665a1c9137052d9fcb7c`).
The predecessor ACT file
`ACT-CLINEMM-EXTENSION-HOST-CPUPROFILE-TIMEDELTA-VALIDATION01.md`
carries its documented P2 `new blank line at EOF` residue and is left
untouched per the ACT-01 patch-hygiene rule.

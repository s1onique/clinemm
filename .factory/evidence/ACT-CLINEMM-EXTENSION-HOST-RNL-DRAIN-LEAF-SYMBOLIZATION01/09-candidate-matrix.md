# ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01 — candidate matrix

## Causal-review caveats applied to this matrix

1. **hitCount is NOT an invocation count.** The "Raw share" column is a
   CPU-presence indicator. It tells you "this leaf was on-CPU a lot",
   not "this leaf was called a lot". Per-call × per-call-rate claims
   are removed; this matrix classifies HIGH / MEDIUM / LOW based only
   on structural allocation capability + observed presence.

2. **GC adjacency is now the bias-free metric, properly aggregated.**
   Column 3 lists `gc_run_adjacency` (PRIMARY, run-length-independent,
   one count per contiguous GC run, AND now aggregated by `node_id` —
   see fix #P0 second-round review). The previously-published
   `total_adjacency` value from the LEGACY metric is retained in
   parentheses ONLY as a reference to the prior analysis and is NOT
   used for ranking. The PRIMARY values in column 3 are FUNCTION-level
   totals that equal the sum of leaf rows sharing a `function_name`
   in `gc_run_adjacency.leaf_stats`. This identity is enforced
   executably by invariant I3 (see 08-gc-adjacency.md).

3. **Two-method contract is now per-target, not blanket.** Three
   targets (cwi + e_×3) had TWO_METHOD_AGREEMENT; the rest are
   METHOD_A_EXACT_BODY_BINDING with non-correlatable Method B rebuild
   (production minify DCE'd/inlined them). See 05-sourcemap-bindings
   for source attribution honesty.

4. **Function-level totals are reproducible from leaf rows.** Every
   value in the table below can be verified by summing same-
   `function_name` rows in `gc_run_adjacency.leaf_stats`. e.g.
   `e_` = 97 (id=49) + 88 (id=80) + 81 (id=35) = 266. This is
   exactly what invariant I3 enforces.

## Allocation-pressure candidate ranking

The mission requires a **bounded candidate matrix** classifying each
hot leaf as a repair candidate. Classification uses three signals:

1. **Raw sample share** — sustained CPU presence (column 1, NOT an
   invocation count).
2. **Allocation capability** — direct vs. transitive, structural
   (column 2, established from source code inspection only).
3. **GC run adjacency** — primary metric, one count per GC-run boundary
   (column 3, run-length-independent).

The matrix is **qualitative**: HIGH / MEDIUM / LOW, no numerical
scores. The matrix does NOT prove causal ownership of the 44% GC
pressure; only the bounded successor ACT (an allocation-sampling heap
profile) can establish that.

| Function (mangled → authored) | Raw share | Direct allocation | PRIMARY gc_run_adjacency | Same failing ancestry | Candidate |
|-------------------------------|----------:|-------------------|-------------------------:|----------------------|-----------|
| `Rnl` → `xmlTagsRemoval` | 7.065% | YES (`new RegExp`) | 69 (run-bdy) | YES (`drain` → handler → `Gyi` → `r_` → `Rnl`) | **HIGH** |
| `r_` → `normalizeUserInput` | 4.634% | YES (2-4 RegExps) | 57 (run-bdy) | YES (same chain) | **HIGH** |
| `drain` → `PendingPromptsController.drain` | 5.495% | YES (3 conditional literals + snapshot) | 54 (run-bdy) | YES (drain is the hub) | **HIGH** |
| `setWithWriter` → `TurnStateTracker.setWithWriter` | 2.530% | YES (record + sub-objects; UNCONDITIONAL) | 34 (run-bdy) | YES (`handleSessionEvent` → `setTurnPhase` → `setWithWriter`) | **HIGH** |
| `e_` ×3 → `captureContinuationCardinalityAuthorityRecord` | 9.234% (combined) | CONDITIONAL (only when dogfood `captureEnabled=true`) | 266 (combined; ids 35,49,80) | YES (`drain` → `onBeforeDrain/Dispatch` → `e_`) | **MEDIUM** (diagnostic-gated; excludes production default) |
| `Gyi` → `isSyntheticUserPrompt` | 3.242% | VIA CALLEE (`r_`) | 36 (run-bdy) | YES (`handleSessionEvent` → `Gyi` → `r_`) | **MEDIUM** (cost charged to callee `r_`) |
| `onSessionEvent` → `SdkMessageCoordinator.onSessionEvent` | 3.851% (combined) | YES (closure) | 40 (run-bdy) | YES (lifecycle setup) | **MEDIUM** (rare, listener lifetime) |
| `handleSessionEvent` → `SdkSessionEventCoordinator.handleSessionEvent` | 4.051% (combined) | VIA CALLEE | 61 (run-bdy) | YES (entry-point coordinator) | **MEDIUM** (entry-point coord) |
| `cwi` → `enterExtensionHostHotloopHandleSessionEvent` | 0.031% | NO | 1 (run-bdy) | YES | **LOW** (gated by diagnostic flag; works as designed) |
| `(garbage collector)` (native) | 44.093% | n/a (symptom) | n/a | YES (overall allocation pressure) | n/a — symptom, not seam |

## Candidate matrix interpretation

Four candidates are **HIGH** because each:
- Sustains a significant raw sample share (>2.5%);
- Allocates **structurally unconditionally** (no diagnostic-flag gating);
- Is structurally present at a non-trivial number of GC-run boundaries
  (PRIMARY metric);
- Sits on the same failing caller ancestry (`drain` → handler →
  input → render → normalize → classify → emit).

The HIGH candidates form a **single subsystem**: the prompt-send path.
- `xmlTagsRemoval` + `normalizeUserInput` live in
  `sdk/packages/shared/src/prompt/format.ts`. They are called from
  the prompt-send pipeline (`drain` produces a prompt, the prompt
  is normalized/classified, the prompt is sent).
- `PendingPromptsController.drain` is the queue consumer that produces
  the prompt and dispatches `deps.send`. Its 3 conditional object
  literals allocate on every drain call.
- `TurnStateTracker.setWithWriter` is called by `handleSessionEvent`
  transitively every time the SdkSessionEventCoordinator updates
  phase. Its `record` literal is allocated even when the diagnostic
  is OFF (the `owi()` hotpath was repaired to be a no-op, but the
  literal is still constructed eagerly).

The **MEDIUM** candidates split into two categories:
- `e_` (`captureContinuationCardinalityAuthorityRecord` × 3) is HIGH
  in raw sample share but **conditional** — when the dogfood profile
  is OFF (production default) it allocates nothing. The legacy
  metric showed 13,333 boundary exposures for this leaf; the bias-
  free metric shows 266 run-boundary touches. The structural
  presence is real; the production impact is N/A.
- `handleSessionEvent` and `onSessionEvent` are coordinators that
  delegate to the HIGH candidates.

The **LOW** candidate `cwi` is intentional: the EHLOOP01 diagnostic
gate keeps it a no-op in production. Its 12-sample share is expected.

GC is a **symptom**, not a candidate. The 44% sample share is the
**result** of allocation pressure from *some* set of allocation-capable
leaves; WHICH set (or whether it's one of these four at all) is NOT
proven by this ACT.

## Boundary-exposure methodology (post causal-review fix #P0-2 + #P0)

The PRIMARY `gc_run_adjacency` metric counts each contiguous GC run's
boundary leaves exactly ONCE, regardless of how many GC samples the
run contains, AND aggregates by `node_id` so each leaf appears once
in the leaf table (not once per adjacent GC run). Sanity check: 428
runs × ≤ 2 boundary leaves per run = ≤ 856; analyzer returns sum
total = 855 (executed invariant I1). The function-level aggregate
equals the sum of leaf rows (executed invariant I3).

The LEGACY `gc_sample_weighted_boundary_exposure` metric (preserved
under honest name) multiplies each boundary leaf by the run length.
For the `e_` ×3 group, the LEGACY function total is 13,333 (the
value previously published); the PRIMARY function total is 266,
which is `2 × gcRuns / 3` per leaf. Use only the PRIMARY metric for
causal selection; I1 is intentionally N/A on LEGACY (per-sample
exposures have no `2 × gcRuns` upper bound).

## Allocation-ownership classification (causal-review refactor)

Until the bounded successor ACT captures an allocation-sampling heap
profile, this ACT classifies candidates structurally only:

| Candidate | Class | Evidence (structural) | Status |
|-----------|-------|----------------------|--------|
| `xmlTagsRemoval` | MAYBE_ALLOCATING | Source has `new RegExp(...)` | Not measured |
| `normalizeUserInput` | MAYBE_ALLOCATING | Source has 2-4 `new RegExp(...)` per call | Not measured |
| `PendingPromptsController.drain` | MAYBE_ALLOCATING | Source has 3 object literals + snapshot | Not measured |
| `TurnStateTracker.setWithWriter` | MAYBE_ALLOCATING | Source has unconditional `record` literal | Not measured |
| `captureContinuationCardinalityAuthorityRecord` ×3 | DOGFOOD_ONLY | Conditional on diagnostic flag | Not measured |
| `isSyntheticUserPrompt` | COST_VIA_CALLEE | No body allocation observed | Not applicable |

The "MAYBE_ALLOCATING" classification is sufficient for symbolization
purposes; it is NOT sufficient to authorize a production repair.

## Bounded successor: ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01

The mission requires a **bounded successor**. After causal review the
recommended successor is NOT a four-seam production repair. The
expert reviewer's selected successor is `ACT-CLINEMM-EXTENSION-HOST-
ALLOCATION-AUTHORITY01`, which captures the same workload with
allocation sampling and ranks candidates by **sampled allocation
bytes** before any production repair is authorized.

The previous draft successor `ACT-CLINEMM-EXTENSION-HOST-PROMPT-
SEND-PIPELINE-ALLOCATION-HOTPATH01` is explicitly **NOT** authorized
because:
- It accepted the (invalid) hitCount-as-rate reasoning;
- It used the (now-fixed) biased adjacency metric for causal ranking;
- It invented a `<25%` GC threshold without product/runtime basis.

The repair-success threshold must be causal (targeted allocation
stack collapses materially + Extension Host remains responsive LIVE),
not a synthetic GC percentage.

The preallocated successor ACT will:
  - Use the Inspector `HeapProfiler.startSampling` /
    `HeapProfiler.stopSampling` protocol — these return a
    `SamplingHeapProfile` whose samples carry allocation `size` and
    `nodeId` and the underlying `Node` carries `selfSize`. **This
    is the correct primitive for sampled allocation bytes**; the
    previously-mentioned `v8.writeHeapSnapshot()`, `worker.getHeapSnapshot()`,
    and `--heap-sampling` were either the wrong tool (snapshot of
    current heap state, not per-allocation samples) or were confused
    with each other in the prior description. `node --heap-prof
    --heap-prof-interval=N` is also a valid external CLI fallback
    that emits the same shape of profile.
  - **`includeObjectsCollectedByMinorGC: true`** and
    **`includeObjectsCollectedByMajorGC: true`** are mandatory —
    otherwise the profile reports only survivors, but the hypothesis
    here is short-lived allocation churn that dies young and triggers
    GC. The CDP documentation explicitly notes the minor-GC option
    exists for latency-sensitive applications whose temporary
    allocations cause GC activity, which is precisely our case.
  - Capture in a real Extension Host process under the real
    dogfood workload; in-process via `inspector.Session.send` is the
    standard Node API for HeapProfiler without external CDP.
  - Per source stack emit:
      allocated sampled bytes
      sample count
      allocation stack
      source function
      source URL
      line/column
  - Classify into:
      A: one candidate dominates
      B: multiple candidates materially contribute
      C: none explain allocation pressure
  - Specifically test the already-symbolized candidates:
      captureContinuationCardinalityAuthorityRecord
      xmlTagsRemoval
      normalizeUserInput
      PendingPromptsController.drain
      TurnStateTracker.setWithWriter
      OTHER / previously unidentified allocation stacks
  - Do **not** restrict success to the five existing suspects: the
    allocation profiler may reveal a different dominant owner.
  - Optionally perform one ablation (diagnostic ON vs OFF) — but
    do NOT ablate first. First the allocation profiler identifies
    candidate stack(s); THEN the ablation is used as a discriminator
    when CCARD is in the candidate set.

Until that ACT runs, all four HIGH candidates remain MAYBE_ALLOCATING,
not OWNER. The previous attempt to pick a single targeted repair
without allocation-sampling evidence is rejected.

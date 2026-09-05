# 17 — Recommendation

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Decision basis:** ACT §28 requires exactly one recommendation.

---

## Selected successor ACT

```
NEXT_ACT = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
```

The successor consolidates `WorkingContextHostCapture` from a **SHADOW with dual writers** into a **single-writer carrier** that owns the canonical publication of W from the host side.

## Why this one first

### High-leverage bounded seam

| Property | Value |
|---|---|
| Semantic value | `currentWorkingContextEstimate` (W) |
| Current authorities | **2**: `WorkingContextHostCapture.observe()` (canonical runtime-event subscription) + `WorkingContextHostCapture.setLatest()` (manual-compaction bypass) |
| Target authority | **1**: `WorkingContextHostCapture.observe()` (canonical path only) |
| Deletion target | `setLatest()` (and the producer call-site in `sdk-compaction.ts`) |
| Files touched | 4: `working-context-host-capture.ts`, `sdk-compaction-coordinator.ts` (or `sdk-compaction.ts`), `SdkController.ts` (~10 LOC wiring), plus a regression test |
| Estimated LOC change | **< 100** |

### Evidence the seam is real, not invented

1. `WorkingContextHostCapture.ts:131–230` documents itself as a "carrier/cache" with two writers (`observe`, `setLatest`).
2. `setLatest` was added by `ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01` PASS_WITH_BOUNDED_P1 specifically because the manual-compaction producer seam (`sdk-compaction.ts`) does not flow through the canonical runtime-event subscription.
3. The header comment at `working-context-host-capture.ts:222` describes `setLatest` as "the transport-only publication the bounded repair uses to drive the host-side webview bar without forcing a full runtime-emit round-trip" — i.e. it is a workaround, by design.
4. The conservation semantics (`UNDEFINED_W_STALE_REUSE = FORBIDDEN`) are duplicated in both `observe` and `setLatest` — a tell-tale sign that two writers will drift unless one is removed.

### What it deletes / simplifies

- `WorkingContextHostCapture.setLatest()` method — deleted.
- The producer call-site in `sdk-compaction.ts` — replaced by publishing via the canonical runtime-event subscription.
- `SdkController.ts`'s dual-write wiring for working-context (~10 LOC).

### What authority becomes canonical

`WorkingContextHostCapture` becomes the **single carrier** of W on the host side. It is fed exclusively by the canonical runtime-event subscription. The webview's `currentWorkingContextEstimate` payload is read exclusively from `WorkingContextHostCapture.currentWorkingContextEstimate`.

`WorkingContextHostCapture` is then reclassified from **SHADOW (with dual writers)** to **CACHE (with single writer)** per the §10 taxonomy.

### What executable tests protect it

| Test | What it proves |
|---|---|
| `apps/vscode/src/sdk/__tests__/sdk-compaction-coordinator.legacy-turnstate-coherence.cltcc*.test.ts` | Existing PASS tests for the carrier's conservation semantics |
| `apps/vscode/src/sdk/__tests__/sdk-compaction-coordinator.task-header-projection.thcp11.test.ts` | TaskHeader projection sees the carrier |
| A new RED test for the `setLatest`-deletion invariant | The producer seam is unreachable; canonical-only path is exercised |

### Why it is bounded

- The seam is one class with two methods, plus one callsite in the producer.
- The deletion target is a single method (`setLatest`).
- The existing tests already cover the carrier's behavior under both paths; the consolidation should not break them.
- If the canonical path cannot be made to carry the manual-compaction W (e.g. because the runtime does not emit a `working-context-state-changed` event during manual compaction), the workaround stays but the dual-write nature must be explicitly documented.

## What this ACT explicitly does NOT do

- Does NOT touch `SdkController.ts`'s other responsibilities.
- Does NOT delete the task-state shadow cluster (the shadow is intentional drift detection).
- Does NOT change the path-authority implementations (they are domain-specific variants).
- Does NOT modify the `cline-session-factory.ts` legacy fallback (that's candidate C, a separate concern).
- Does NOT touch provider settings consolidation (that's candidate E).

## Risk

| Risk | Mitigation |
|---|---|
| Manual compaction in core does not currently emit a `working-context-state-changed` event | The bounded ACT will add the emission; if the architecture cannot be changed, the deletion is reversed and the dual-write is documented |
| Existing tests that pin `setLatest` behavior | Those tests must be updated (or replaced by canonical-path tests) as part of the ACT |
| ClineMM live qualification | The change is small enough to dogfood live (per the editor authority ACT's pattern) |

## Successor ACT outline

```
ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01

Phase 0 (recon):
  - Identify the manual-compaction producer seam
  - Identify every callsite of WorkingContextHostCapture.setLatest
  - Map the runtime-event subscription wiring

Phase 1 (RED):
  - Add a test that proves manual compaction carries W through the canonical subscription
  - Add a test that proves setLatest cannot be called (compile-time or runtime guard)

Phase 2 (GREEN):
  - Route manual compaction through the canonical path
  - Delete setLatest
  - Update or delete existing tests that depended on setLatest

Phase 3 (verification):
  - Typecheck, lint, full test suite
  - Live dogfood with manual compaction

Phase 4 (review):
  - Document the new invariant: "WorkingContextHostCapture has one writer"
  - Update §16 of any follow-up F0-derived documentation
```


---

## Correction addendum (C1 closure 2026-09-05)

**Replace preselected F1 design with frozen question + discriminator**.

The original "delete `setLatest`; route manual compaction through canonical
runtime-event subscription" was design-before-recon. The C1 reviewer
correctly required a discriminator before any production edit.

### Frozen question for F1

> **Can all host-visible W updates be composed through one semantically-correct
> publication/mutation authority without changing runtime semantics?**

### Required evidence before F1 RED

Capture the **normal turn** chain:

```
AgentRuntime.prepareTurn
  -> where currentWorkingContextEstimate is written
  -> event creation
  -> subscription
  -> WorkingContextHostCapture.observe
  -> state post
```

Capture the **manual compaction** chain:

```
compactTask
  -> compactSessionMessages
  -> currentWorkingContextEstimate
  -> coordinator
  -> current setLatest call
  -> state post
```

Answer three discriminators:

```
SAME_SEMANTIC_STATE?   YES / NO
SAME_OWNER?            YES / NO
SAME_EVENT_DOMAIN?     YES / NO
```

### Permitted outcomes

```
A. Runtime state genuinely changes
   -> use existing runtime event -> delete setLatest
B. Manual compaction creates a host-visible projection but does NOT mutate
   runtime state
   -> keep two producers
   -> unify to ONE ASSIGNMENT PRIMITIVE
      (e.g. assign(w, provenance))
   -> one cache, two legitimate ingresses
   -> do NOT fabricate a runtime event
C. Core already exposes a shared W publication seam both producers can use
   -> use it -> delete the bypass
B-prime. NOT_FACTORIZABLE_AS_SINGLE_EVENT_SOURCE = permitted outcome
```

### Deletion predicate (testable, non-circular)

```
setLatest() may be deleted when ALL hold:
1. every successful producer of host-visible W can reach one
   semantically-correct publication seam
2. that seam preserves UNDEFINED_W_STALE_REUSE = FORBIDDEN
3. manual compaction updates the bar before the final state post
4. normal prepare-turn publication remains unchanged
5. skipped/failed compaction publishes no optimistic W
```

### Success criteria

```
Best case:
  writers/ingresses before = 2
  mutation/publication authority after = 1
  setLatest deleted
  normal-turn behavior conserved
  manual-compaction bar update conserved
  failure/undefined behavior conserved

Or (if B resolves):
  two producers
  -> one assignment primitive
  -> one cache
```

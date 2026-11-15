# ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORRECTION02

Applied on top of CORRECTION01 (which itself applies to `3147a53b5`).

## Mission

Single purpose: "Repair the one new P0 that the CORRECTION01 review left
open — the unbounded OPEN-SPAN retention — and then authorize packaging
without another general review."

## Trigger

The CORRECTION01 review returned `HALT_RETENTION_BOUND_INCOMPLETE`. It
confirmed that the sink-composition defect was closed:

| Finding | Result |
|---------|--------|
| Seven missing event channels | **PASS** |
| Three fingerprint operations | **PASS** |
| Compile-time interface coverage | **PASS** |
| Event ring (4,096) | **PASS** |
| Unavailable/integrity storage rings (256 each) | **PASS** |
| Total bounded in-memory capture | **P0 — incomplete** |
| VSIX / installed qualification | NOT_EXECUTED |

The single remaining P0 was the OPEN-SPAN map.

## The P0

`LatencyTracer` retains an independent `openSpans` map containing the spans
that were ENTERED but not yet EXITED. CORRECTION01 bounded `events`,
`unavailableMeasurements` and `integrityFailures` — but NOT this map. A
span whose exit never arrives stays in the map forever.

The concrete counterexample:

```ts
const tracer = new LatencyTracer("probe");
for (let i = 0; i < 100_000; i++) {
	tracer.enter("tool_execution", { toolCallId: `tc-${i}` });
}
const trace = tracer.getTrace();
```

The recorded events were limited to 4,096, but **all 100,000 unfinished
spans remained in memory**. Worse, `getIntegrityFailures()` walked every
open span and synthesised an integrity-failure entry for each, so the trace
dump carried **more than 100,000 integrity failures** despite the declared
256-entry retention bound.

This is a boundedness defect, not a performance optimization.

## The bounded correction

No composition was revisited and no new observability subsystem was
introduced. The correction is confined to `LatencyTracer`'s own retention.

### 1. The open-span retention is bounded, independently of the event ring

| Bound | Value | Protects |
|-------|-------|----------|
| `LATENCY_TRACE_MAX_OPEN_SPANS` | 1,024 | retained in-flight span state |
| `LATENCY_TRACE_MAX_DISCARDED_SPAN_TOMBSTONES` | 1,024 | the discarded-start registry |
| `LATENCY_TRACE_MAX_EVENTS` | 4,096 | retained event history (unchanged) |
| `LATENCY_TRACE_MAX_UNAVAILABLE` | 256 | retained unavailable ring (unchanged) |
| `LATENCY_TRACE_MAX_INTEGRITY_FAILURES` | 256 | retained integrity ring (unchanged) |

The open-span bound is a SEPARATE bound on purpose: the event ring bounds
the retained HISTORY, while this bounds the retained IN-FLIGHT state, and
neither can be derived from the other.

Each open span carries a global `seq`. When the bound is reached the
**globally OLDEST** span is discarded. Because the eviction order matches
the opening order, the spans that remain on a boundary are exactly the
newest ones, so the last-in-first-out matching between a start and an exit
keeps working for every span that was NOT discarded.

### 2. The integrity-failure export is bounded

`getIntegrityFailures()` synthesises one failure per still-open span. The
exported list is now capped at `maxIntegrityFailures`. The failures the
tracer observed explicitly are kept first; the synthesised "span left open"
failures fill the remainder. Every failure that does not make it into the
export is COUNTED and surfaced through the truncation metadata.

### 3. Discarded spans are accounted for in the truncation metadata

`LatencyTraceTruncation` gains four fields:

| Field | Meaning |
|-------|---------|
| `droppedOpenSpanCount` | open spans discarded by the open-span bound |
| `totalOpenSpanCount` | open spans ever opened |
| `retainedOpenSpanCount` | open spans currently retained |
| `maxOpenSpans` | the configured open-span bound |

`truncated` is now true when ANY of the four retention channels dropped
something, and `droppedIntegrityFailureCount` includes the failures that
the bounded export withheld.

### 4. A late exit fabricates NO duration and closes NO unrelated span

This is the property the review called out as untested.

A discarded span leaves a **TOMBSTONE** behind. When an exit arrives it is
matched in this order:

1. a RETAINED span carrying the same `toolCallId` → that span is closed
   and its own duration is measured;
2. a TOMBSTONE carrying the same `toolCallId` → the start was discarded:
   **no duration is recorded, no unrelated span is closed**, and a
   trace-integrity failure says so explicitly;
3. the boundary has discarded starts but no tombstone matches → the tracer
   does not guess: **no duration, no unrelated span**, and the boundary's
   discarded-start COUNT is enough to refuse to fall through;
4. the id was NEVER a start on this boundary → the historical
   last-in-first-out fallback applies, exactly as before.

Case 4 is deliberately preserved: the existing "falls back to LIFO when the
exit names an id that was never entered" test still passes unchanged. The
difference is that case 4 can only be reached when the boundary has NO
discarded starts, so it can never absorb an exit that belonged to a
discarded span.

## Changed production files

| File | Change |
|------|--------|
| `sdk/packages/core/src/observability/latency/latency-trace.ts` | The open-span bound; the tombstone registry; the seq-ordered global eviction; the no-fabrication exit matching; the bounded integrity-failure export; the four new truncation fields. |
| `sdk/packages/core/src/observability/latency/latency-trace-internal.ts` | Exports `LATENCY_TRACE_MAX_OPEN_SPANS` and `LATENCY_TRACE_MAX_DISCARDED_SPAN_TOMBSTONES`. |
| `sdk/packages/core/src/observability/latency/latency-trace.test.ts` | The CORR02 adversarial suite (8 new tests). |

No change was made to the composition surface (`roundc-latency-trace-runtime.ts`,
`latency-sink.ts`) beyond what CORRECTION01 already did.

## Adversarial tests

| Test | Covers |
|------|--------|
| `bounds the retained open spans under 100,000 unmatched starts` | The reviewer's exact counterexample: the retained open-span memory is finite and independently bounded; the discarded spans are counted. |
| `bounds the EXPORT under 100,000 unmatched starts` | The trace's events, stages and integrity failures are all bounded; the withheld failures are counted. |
| `keeps the EXPORT finite when the failure bound is tiny` | The export bound holds with a 4-entry failure bound and an 8-entry open-span bound. |
| `does NOT fabricate a duration when a span is closed after its start was evicted` | The late exit produces NO duration, reports WHY, and leaves the unrelated spans open. |
| `does NOT match a late exit to an UNRELATED retained span` | The late exit steals neither survivor. |
| `still measures a RETAINED span correctly when other spans were discarded` | The surviving span's own duration is still measured against its own start. |
| `preserves the 10 ms execution / 5,000 ms delivery invariant under the open-span bound` | The existing timing invariant survives the degraded (discarding) mode. |
| `clamps a zero or negative OPEN-SPAN bound to at least one` | The bound is clamped, never zero-capacity. |

### RED → GREEN evidence

With the production file reverted to the pre-correction state, the whole
CORR02 suite is RED:

```
× bounds the retained open spans under 100,000 unmatched starts
× bounds the EXPORT under 100,000 unmatched starts
× keeps the EXPORT finite when the failure bound is tiny
× does NOT fabricate a duration when a span is closed after its start was evicted
```

With the correction applied the suite is GREEN (42/42 in the file).

### The reviewer's counterexample, measured

| Metric | Before | After |
|--------|--------|-------|
| `events` | 4,096 | 4,096 |
| `integrityFailures` | **100,000+** | **256** |
| retained open spans | **100,000** | **1,024** |
| `droppedOpenSpanCount` | — | 98,976 |
| `totalOpenSpanCount` | — | 100,000 |
| `truncated` | — | `true` |

## Verification (observed)

| Gate | Result |
|------|--------|
| `apps/vscode` `tsc --noEmit` | PASS (clean, exit 0) |
| `sdk/packages/core` `tsc -p tsconfig.dev.json --noEmit` | 40 diagnostics — IDENTICAL to the pre-change baseline (40), and NONE in `observability/latency` |
| `sdk/packages/core` biome (`src/observability/latency/`) | PASS (clean) |
| `apps/vscode` biome (the two ACT-owned files) | PASS (clean) |
| `apps/vscode` biome (`src/sdk/` whole) | 2 errors / 107 warnings — IDENTICAL to the pre-change baseline; none in an ACT-owned file |
| `apps/vscode` whole-suite baseline comparison | **70 failing test files BEFORE and AFTER — a byte-identical failing-file set** (`diff` empty), with 5,786 passing |
| `sdk/packages/core` whole-suite baseline comparison | **33 failing test files BEFORE and AFTER — a byte-identical failing-file set** (`diff` empty) |
| SDK core latency suite | 42/42 PASS (34 pre-existing + 8 CORR02) |
| SDK core observability suite | 156/156 PASS |
| SDK core orchestration suite | 242/242 PASS |
| `@cline/agents` model-behavior trace | 9/9 PASS |
| `apps/vscode` Round C activation suite | 44/44 PASS |
| Built SDK artifact | `sdk/packages/core/dist/observability/latency/latency-trace-internal.js` carries `maxOpenSpans`, `droppedOpenSpanCount`, `retainedOpenSpanCount`, `droppedExportedIntegrityFailureCount`, `discardedSpanTombstones` and `enforceOpenSpanBound` |

## Qualification status

| Component | Status |
|-----------|--------|
| Sink composition | **PASS** (CORRECTION01, unchanged) |
| Bounded event/unavailable/integrity rings | **PASS** (CORRECTION01, unchanged) |
| Bounded OPEN-SPAN retention | **PASS** (CORRECTION02) |
| Bounded integrity-failure EXPORT | **PASS** (CORRECTION02) |
| Discarded-span accounting | **PASS** (CORRECTION02) |
| Late-exit no-false-attribution | **PASS** (CORRECTION02) |
| Existing 10 ms / 5,000 ms timing invariant | **PASS** (CORRECTION02) |
| Dogfood activation | PASS (unchanged) |
| Public-profile isolation | PASS (unchanged) |
| Existing test/typecheck gates | PASS |
| VSIX artifact | NOT_EXECUTED — the next stage |
| Installed qualification | NOT_EXECUTED — the next stage |

## Disposition

The reviewer's instruction was: "Once this specific defect is repaired and
the focused gates pass, authorize packaging without another general review.
A VSIX is the appropriate offline-installable artifact for extension
qualification."

This correction repairs exactly that defect and the focused gates pass. The
retention bound is therefore COMPLETE and **packaging is AUTHORIZED** as
the next stage: build the VSIX and qualify the INSTALLED extension.

# ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORRECTION01

## Mission

Single purpose: "Repair the two P0 defects that block DOGFOOD-TRACE01 packaging —
the sink composition that dropped existing telemetry, and the unbounded trace
retention that contradicted the bounded-capture requirement."

Applied on `3147a53b5`.

## Trigger

The expert review of DOGFOOD-TRACE01 returned
`HALT_UNBOUNDED_DOGFOOD_TRACE` / `HALT_DOGFOOD_TRACE_COMPOSITION_AND_RETENTION`
with two concrete P0 findings:

| # | P0 | Finding |
|---|----|---------|
| P0-A | Sink composition drops existing telemetry | `composeModelBehaviorTraceSinks()` forwarded only 18 of the interface's 25 event channels, and omitted all three fingerprint operations. Arming the Round C trace SILENTLY disabled the existing recorder's edit, process and fingerprint telemetry. |
| P0-B | Unbounded retention | `LatencyTracer.events` (and the diagnostics arrays) grew with every observation. Holding only ONE sink does not bound memory. |

## Concretely required production change

### P0-A — Sink composition completeness

1. **Every event channel is preserved.** The seven EDIT/PROCESS channels the
   original list dropped are restored:
   `onEditAttempt`, `onEditApplication`, `onEditFailure`,
   `onEditTargetResolved`, `onEditWriteVerification`,
   `onEditCheckpointObservation`, `onProcessObservation`.

2. **A compile-time exhaustiveness check.** The SDK's `ModelBehaviorTraceSink`
   is a TypeScript TYPE with no runtime reflection, so the channel names cannot
   be derived at runtime. They are declared explicitly (which keeps the list
   auditable) and a compile-time gate proves the list is TOTAL:

   ```ts
   type UncomposedSinkMember = Exclude<keyof ModelBehaviorTraceSink, ComposedSinkMember>
   export const COMPOSABLE_SINK_IS_EXHAUSTIVE: ComposableSinkCoversEveryChannel = true
   ```

   `ComposedSinkMember` is the union of three lists — the event channels, the
   fingerprint operations, and the enable bit — so EVERY member of the
   interface is accounted for by exactly one of them. If a channel is added to
   the SDK interface and not to one of the lists, `UncomposedSinkMember`
   becomes a non-`never` union and `check-types` FAILS.

   Verified by a NEGATIVE test: removing `onProcessObservation` from the list
   produces `error TS2322: Type 'true' is not assignable to type 'never'` and
   the build fails.

3. **The three fingerprint operations are preserved as VALUE-PRODUCING
   operations.** They are NOT event fan-out channels: the SDK CONSUMES their
   return value. The composite therefore DELEGATES (primary side authoritative,
   secondary side as fallback when the primary does not implement the
   operation), and preserves:
   - the RETURN VALUE, including an asynchronous one (a `Promise` in stays a
     `Promise` out);
   - the RECEIVER BINDING (`.call(receiver, ...)`, so `this.fingerprintKey` and
     `this.enabled` still resolve);
   - FAILURE ISOLATION (a throwing delegate yields `undefined` rather than
     propagating into the runtime's tool-execution path).

### P0-B — Bounded retention

The tracer is installed for a whole SESSION, so retention must be bounded.

1. **Bounded ring.** `LatencyTracer` retains at most
   `LATENCY_TRACE_MAX_EVENTS` (4096) events, `LATENCY_TRACE_MAX_UNAVAILABLE`
   (256) unavailable measurements and `LATENCY_TRACE_MAX_INTEGRITY_FAILURES`
   (256) integrity failures. The OLDEST observation is evicted first, so the
   retained window always carries the MOST RECENT boundaries — which is the
   window the ~5 s floor investigation needs (the floor is visible in the most
   recent `tool_execution → tool_result_delivered` gap).

2. **Truncation is reported EXPLICITLY.** A new `LatencyTraceTruncation`
   block is carried on `LatencyTrace` and exported in the artifact:
   `truncated`, the three dropped counts, the three total counts, the retained
   count and the three configured bounds. A partial trace is never presented
   as a complete one.

3. **NO continuity is invented across discarded observations.** The tracer's
   own open-span stack is independent of the event ring, so a span whose start
   event was evicted is still reported as an integrity failure ("span left
   open") rather than being given a fabricated duration.

4. **The exported artifact carries the block.** `RoundcLatencyTraceArtifact`
   gains `truncation`, so the operator's dump states explicitly whether the
   capture is complete.

## Changed production files

| File | Change |
|------|--------|
| `apps/vscode/src/sdk/roundc-latency-trace-runtime.ts` | The seven missing channels; the fingerprint list; the compile-time exhaustiveness gate; fingerprint delegation; the artifact's `truncation` block. |
| `sdk/packages/core/src/observability/latency/latency-trace.ts` | `LatencyTraceTruncation`; the three bounds; the bounded ring; `getTruncation()`; `LatencyTrace.truncation`. |
| `sdk/packages/core/src/observability/latency/latency-sink.ts` | `getTruncation()` on the sink. |
| `sdk/packages/core/src/observability/latency/latency-trace-internal.ts` | Exports the new types, bounds and `LatencyTracerOptions`. |

## Adversarial tests

| Test | Covers |
|------|--------|
| `ACT09.1` | The exhaustiveness constant; the channel list is populated and distinct. |
| `ACT09.2` | All six EDIT channels reach BOTH sides. |
| `ACT09.3` | The PROCESS channel reaches BOTH sides. |
| `ACT09.4` | The defect's exact shape: a channel only ONE side implements is still delivered. |
| `ACT09.5` | The three fingerprint operations return the PRIMARY's value. |
| `ACT09.6` | The fingerprint operations preserve the ASYNCHRONOUS return value. |
| `ACT09.7` | The fingerprint operations preserve the RECEIVER BINDING. |
| `ACT09.8` | The fingerprint operations fall back to the secondary. |
| `ACT09.9` | A throwing fingerprint does not break the runtime's tool execution. |
| `ACT09.10` | The DISABLED public profile installs no sink and composes to an inert sink. |
| `ACT09.11` | The artifact reports the capture's COMPLETENESS explicitly. |
| `ACT09.12` | The REAL production recorder keeps EVERY channel AND its fingerprints through the REAL composition. |
| `latency-trace.test.ts` (9 tests) | Bounded window; explicit truncation; complete-trace case; most-recent retention; no invented continuity; bounded unavailable; bounded integrity; clamped bounds; finite default bound. |

## Verification (observed)

| Gate | Result |
|------|--------|
| `apps/vscode` `tsc --noEmit` | PASS (clean) |
| `sdk/packages/core` `tsc -p tsconfig.dev.json --noEmit` | 68 diagnostic lines — IDENTICAL to the pre-change baseline (68) |
| `apps/vscode` biome lint (`src/sdk/`, 756 files) | PASS |
| `sdk/packages/core` biome lint (`src/observability/latency/`) | PASS |
| SDK core latency suite | 80/80 PASS (34 in `latency-trace.test.ts`, including the 9 new ones) |
| SDK core observability + session-runtime | 155/155 PASS |
| `@cline/agents` model-behavior trace | 9/9 PASS |
| `apps/vscode` Round C activation suite | 44/44 PASS (32 original + 12 new ACT09) |
| `apps/vscode` whole-suite baseline comparison | **63 failed files / 167 failed tests BEFORE and AFTER — a byte-identical failing-file set** (`diff` empty), with 5785 → 5797 passing (+12 new) |
| `sdk/packages/core` whole-suite baseline comparison | **17 failed files / 111 failed tests BEFORE and AFTER — a byte-identical failing-file set** (`diff` empty), with 5228 → 5237 passing (+9 new) |
| Compile-time exhaustiveness NEGATIVE test | Removing one channel ⇒ `TS2322: Type 'true' is not assignable to type 'never'` ⇒ build FAILS |
| Built SDK artifact | `sdk/packages/core/dist/observability/latency/latency-trace-internal.js` carries `droppedEventCount` and the three bounds |

### Pre-existing failures (NOT introduced here)

The whole-suite failing set is IDENTICAL before and after this correction. The
63 failing files are pre-existing at `3147a53b5` and include the
`command-process-outcome` suites (which spawn real processes and time out in
this environment) and a `registry.ts` command-prefix regex mismatch in the
fork. None is in a file this correction touches.

## Qualification status

| Component | Status |
|-----------|--------|
| Sink composition | **PASS** — every channel preserved; compile-time exhaustiveness proven by a negative test |
| Bounded retention | **PASS** — ring bounded; truncation reported explicitly; no invented continuity |
| Dogfood activation | PASS (unchanged) |
| Public-profile isolation | PASS (unchanged, strengthened by ACT09.10) |
| Existing test/typecheck gates | PASS |
| VSIX artifact | NOT_EXECUTED |
| Installed qualification | NOT_EXECUTED |

Packaging and installed qualification remain the NEXT stage and were not
executed here, exactly as the review directed.

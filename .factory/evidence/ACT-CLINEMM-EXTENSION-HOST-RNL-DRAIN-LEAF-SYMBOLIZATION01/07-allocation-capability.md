ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01 — allocation capability inventory
====================================================================================================

## Caveat (post causal-review fix #P0-1)

`hitCount` on a cpuprofile node is the number of samples where the leaf
was observed ON-CPU, NOT the number of times the leaf was called. One
invocation may receive zero, one, or many samples depending on the
function's duration and the profiler cadence. Therefore:

- We do NOT derive call counts, RegExp/sec, bytes/sec, or "allocation
  owner" from hitCount anywhere in this ACT.
- Per-call allocation cost is established from source-code inspection
  only. The "Per-call cost (bytes)" column in the summary table is a
  static-structural estimate derived from `new RegExp(...)` body shape,
  not a measurement.
- The "Samples" column below is the raw sample count (not invocations).
  Use it as a CPU-presence indicator, not an allocation-rate estimate.
- To obtain actual invocation/allocation evidence the next ACT must
  use a sampling heap profile or `--heap-sampling` capture (see Verdict).

Classification legend:
```
ALLOCATES_DIRECTLY    = the function body itself constructs an object,
                         array, regex, or other heap-allocated value on
                         every invocation, including when no caller
                         captures the result.
MAY_ALLOCATE_VIA_CALLEE = the function body itself does not allocate,
                         but it transitively calls functions that do.
NO_OBVIOUS_ALLOCATION   = no in-function heap construction observed;
                         pure string comparison or return value pass-through.
UNKNOWN                = reserved for future investigation.
```

This is reconnaissance only. **No repair** is performed or authorized
in this ACT.

----------------------------------------------------------------------

### `cwi` = `enterExtensionHostHotloopHandleSessionEvent`

Source: `apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts:147-154`

Body:
```ts
if (!_enabled) return;
_nestedDepth++;
_counters.handleSessionEventCalls++;
if (_nestedDepth > _counters.maxNestedHandleDepth) {
  _counters.maxNestedHandleDepth = _nestedDepth;
}
```

Allocation sites inside the function:
- `Ww.handleSessionEventCalls++` — mutates a pre-existing object. No allocation.
- `J7e > Ww.maxNestedHandleDepth` — boolean compare.
- `Ww.maxNestedHandleDepth = J7e` — number assignment.

Allocation class: **NO_OBVIOUS_ALLOCATION**. Pure numeric increments of
pre-existing counters. The function is gated by `_enabled` (default OFF
in production).

----------------------------------------------------------------------

### `Rnl` = `xmlTagsRemoval`

Source: `sdk/packages/shared/src/prompt/format.ts:224-229`

Body:
```ts
export function xmlTagsRemoval(input?: string, tag?: string): string {
  if (!input?.trim()) return "";
  if (!tag) return input;
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  return input.replace(regex, "$1");
}
```

Allocation sites per call:
- `new RegExp(\`<${tag}\b[^>]*>([\\s\\S]*?)</${tag}>\`, "g")` — one new
  RegExp per call when `input?.trim()` is truthy and `tag` is provided.
- Template-literal string for the regex pattern: one per call.
- `input.replace(regex, "$1")` may or may not allocate a new string
  depending on whether any match was found.

Allocation class: **ALLOCATES_DIRECTLY** — structurally one RegExp per
call. The presence of a `new RegExp(...)` body statement is the
structural allocation-capability evidence. Whether this contributes
materially to GC pressure depends on actual call frequency, which the
CPU profile does NOT measure (see Caveat above).

Per-call heap-cost *estimate* (structural, from source body shape):
- Template-literal for the regex pattern: ~50 bytes
- RegExp instance: ~80 bytes
- Replacement result string when matched: proportional to input length

This leaf had **2726 samples (7.065% of profile)** — frequently observed
ON-CPU, but the actual call count is NOT derivable from this fact.

----------------------------------------------------------------------

### `r_` = `normalizeUserInput`

Source: `sdk/packages/shared/src/prompt/format.ts:134-146`

Body:
```ts
export function normalizeUserInput(input?: string): string {
  if (!input?.trim()) return "";
  let next = input.trim();
  for (const tag of ["user_input", "user_command"] as const) {
    const extracted = xmlTagsRemoval(next, tag);
    next = (
      extracted !== next
        ? extracted
        : next.replace(new RegExp(`<${tag}[^>]*>`, "g"), "")
    ).trim();
  }
  return next;
}
```

Allocation sites per call:
- 2-4 `new RegExp(...)` per call when the `xmlTagsRemoval` path returns
  the unchanged string (no-match case) for each tag iteration (up to 2
  iterations × 2 paths = 4 RegExps worst case).
- 2-4 template-literal strings for the regex pattern.
- `input.trim()` and `.trim()` may or may not allocate.
- `xmlTagsRemoval(next, tag)` is the inner call to `Rnl`.

Allocation class: **ALLOCATES_DIRECTLY** — structurally 2-4 RegExps per
call in the fallback path. Whether actual call count reaches the
worst-case rate is NOT derivable from this profile (see Caveat above).

Per-call heap-cost *estimate* (structural, worst case):
- 2-4 RegExp instances × ~80 bytes: ~160-320 bytes
- 2-4 template-literal strings × ~50 bytes: ~100-200 bytes
- Plus `Rnl`'s charges when the inner call constructs its own RegExp.

This leaf had **1788 samples (4.634% of profile)**.

----------------------------------------------------------------------

### `e_` × 3 = `captureContinuationCardinalityAuthorityRecord`

Source: `apps/vscode/src/sdk/continuation-cardinality-authority.ts:185-214`
(Method A exact-body binding + Method B two-method agreement at col
2325 → `:185:7` from the prodlike dev sourcemap)

Allocation class: **ALLOCATES_DIRECTLY (when `captureEnabled=true`,
which is the dogfood profile) / NO_OBVIOUS_ALLOCATION (when
`captureEnabled=false`, production default)**. The function returns
`undefined` without allocation when the diagnostic is OFF.

Three distinct profile nodes share one authored function and one
generated line:col — they are distinguished by parent set only.
Combined they had **3563 samples (9.234% of profile)**, the strongest
sustained CPU presence of any leaf cluster.

Important reframe after causal review:
> Because `captureEnabled` is a dogfood-only diagnostic, the per-call
> allocation observed in this profile applies to DOGFOOD ONLY. In a
> production build where `captureEnabled=false`, this leaf is a literal
> no-op and produces no allocation. This is **not** "the cause of GC
> pressure" — it is "a diagnostic-only allocation site observed in the
> dogfood profile". Causally distinguishing it from the production-only
> paths requires the bounded successor ACT.

----------------------------------------------------------------------

### `Gyi` = `isSyntheticUserPrompt`

Source: `apps/vscode/src/sdk/sdk-user-message-mapping.ts:72-108`

Allocation class: **MAY_ALLOCATE_VIA_CALLEE** — string-comparison only;
the function itself appears to allocate nothing per call. Whatever
allocation occurs on this path is attributed to the callee chain
(`r_` → `Rnl`).

This leaf had **1251 samples (3.242% of profile)**.

----------------------------------------------------------------------

### `drain` = `PendingPromptsController.drain`

Source: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:423-507`

Allocation sites per call (structural, from source body):
- Up to 3 conditional object literals passed to optional `onBeforeDrain`,
  `onBeforeDispatch` subscribers.
- Arrow function closures for `.catch((err) => ...)` on each dispatched prompt.
- `this.emitPrompts(this.drained)` allocates a snapshot array of drained
  prompts.

Allocation class: **ALLOCATES_DIRECTLY** — structurally several object
literals and a snapshot array per call. Actual per-call object count
depends on subscriber presence and the number of dispatched prompts.

Per-call heap-cost *estimate* (structural):
- 3 object literals: ~120-240 bytes
- Arrow function closure per dispatched prompt: ~50 bytes each
- Snapshot array: header + O(N) refs

This leaf had **2120 samples (5.495% of profile)**.

----------------------------------------------------------------------

### `setWithWriter` = `TurnStateTracker.setWithWriter`

Source: `apps/vscode/src/sdk/turn-state-tracker.ts:96-153`

Allocation sites per call:
- One `record` object literal (with 7 fields).
- 3-4 nested object literals (`counters`, `turnPhase`, `writer`, `prior`).

Allocation class: **ALLOCATES_DIRECTLY — UNCONDITIONAL EVEN WHEN
DIAGNOSTIC OFF**, because the literal is constructed eagerly before
`owi()` is called. This is the strongest single structural observation
in the ACT: a per-call allocation that occurs regardless of any
diagnostic flag. However — and the causal-review explicitly flags this
— "occurs unconditionally" ≠ "causes the GC". Actual call frequency is
not derivable from this CPU profile.

Per-call heap-cost *estimate* (structural):
- Record: ~80-120 bytes
- Sub-objects: ~200-300 bytes
- Total: ~280-420 bytes per call

This leaf had **976 samples (2.530% of profile)**.

----------------------------------------------------------------------

### `handleSessionEvent` = `SdkSessionEventCoordinator.handleSessionEvent`

Source: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:419-540`

Allocation class: **MAY_ALLOCATE_VIA_CALLEE** — body is heavily
conditional; most paths only allocate when specific event types arrive.
The `translateSessionEvent` call is a heavy allocation site but is a
callee, not this function.

This leaf had **692 + 448 + 423 = 1563 samples combined across 3 distinct
profile nodes (1.794% + 1.161% + 1.096% of profile)**.

----------------------------------------------------------------------

### `onSessionEvent` = `SdkMessageCoordinator.onSessionEvent`

Source: `apps/vscode/src/sdk/sdk-message-coordinator.ts:57-62`

Body:
```ts
onSessionEvent(listener: SessionEventListener): () => void {
  this.sessionEventListeners.add(listener);
  return () => {
    this.sessionEventListeners.delete(listener);
  };
}
```

Allocation sites per call:
- One arrow function closure (with captured `listener` ref).
- `Set.add(listener)` may grow internal storage but does not allocate a
  new Set instance.

Allocation class: **ALLOCATES_DIRECTLY** — one closure per call. The
closure is held by the listener Set and only GC'd when the listener
unsubscribes — its lifetime is the listener's lifetime, not the call's.

This leaf had **521 + 492 + 473 = 1486 samples combined across 3 distinct
profile nodes (1.350% + 1.275% + 1.226% of profile)**.


----------------------------------------------------------------------

## Summary table (post causal-review; per-call costs are STRUCTURAL, samples are SAMPLES)

| Mangled | Authored function | Allocation class | Per-call cost (bytes, structural est.) | Samples | Notes |
|---------|------------------|------------------|---------------------------------------:|--------:|-------|
| `cwi` | enterExtensionHostHotloopHandleSessionEvent | NO_OBVIOUS | ~0 | 12 | Gated by `_enabled` (default OFF in production) |
| `Rnl` | xmlTagsRemoval | ALLOCATES_DIRECTLY | ~130 (one RegExp + pattern string) | 2726 | Structural RegExp in body; actual call count unmeasured |
| `r_` | normalizeUserInput | ALLOCATES_DIRECTLY | ~260 (2-4 RegExps worst-case) | 1788 | Worst-case allocator; inner call to Rnl |
| `e_` (all 3) | captureContinuationCardinalityAuthorityRecord | DOCS_DIAGNOSTIC_ONLY (when production `captureEnabled=false`): NO_OBVIOUS. DOGFOOD (`captureEnabled=true`): ALLOCATES_DIRECTLY | ~150 each (dogfood only) | 3563 combined | Diagnostic-only allocation; not in production default |
| `Gyi` | isSyntheticUserPrompt | MAY_ALLOCATE_VIA_CALLEE | ~0 direct | 1251 | Cost charged to callee chain (`r_`) |
| `drain` | PendingPromptsController.drain | ALLOCATES_DIRECTLY | ~300 (3 conditional literals + snapshot) | 2120 | Subscribers/event-type dependent in detail |
| `setWithWriter` | TurnStateTracker.setWithWriter | ALLOCATES_DIRECTLY — UNCONDITIONAL | ~300 (record + 3-4 sub-objects) | 976 | Eager literal before diagnostic gate |
| `handleSessionEvent` | SdkSessionEventCoordinator.handleSessionEvent | MAY_ALLOCATE_VIA_CALLEE | ~0-50 (conditional) | 1563 combined | Path-dependent |
| `onSessionEvent` | SdkMessageCoordinator.onSessionEvent | ALLOCATES_DIRECTLY | ~50 (closure) | 1486 combined | Lifetime = listener lifetime |

**Reading this table correctly:**
- The "Samples" column tells you where the profiler saw this leaf
  on-CPU. It does NOT tell you how many times the leaf was called.
- The "Per-call cost" column is a source-body-shape estimate. It tells
  you what each call would cost IF invoked. It does NOT tell you how
  often the call happens.
- The combination (Samples × Per-call cost) does NOT estimate actual
  bytes-allocation per leaf. That estimate requires a heap or
  allocation-sampling capture, which is exactly what the bounded
  successor ACT (see ACT verdict) is chartered to produce.

----------------------------------------------------------------------

## Verdict on allocation claims

What this evidence DOES establish:
  - Source identities for 9 distinct mangled leaves.
  - Allocation capability per leaf (structurally, from source code).
  - Which leaves are conditional vs unconditional allocation sites.
  - Which leaves are production-path vs diagnostic-only.
  - Per-leaf observed raw sample share (a CPU-presence indicator).

What this evidence does NOT establish:
  - Actual call frequency per leaf (CPU profile is sample-based).
  - Actual bytes/sec of allocation per leaf (requires heap profile).
  - Causal ordering among leaves for the 44% GC pressure (requires
    measuring which stack allocates the GC'd objects).

Therefore: allocation OWNERSHIP of the 44% GC pressure is OPEN, not
closed. The bounded successor ACT (see ACT verdict) must capture the
same workload with a sampling heap profile or `--heap-sampling` and
classify each candidate by sampled allocated bytes before any
production repair is considered.

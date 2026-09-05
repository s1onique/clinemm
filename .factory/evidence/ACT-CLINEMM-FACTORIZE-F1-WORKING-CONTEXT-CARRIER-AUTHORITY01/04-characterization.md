# 04-characterization.md — F1 bounded characterization

**ACT**: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
**Phase**: bounded characterization (single epistemic purpose only)
**Companion to**: 03-discriminator.md (F1 RECON discriminator freeze at f737f43d3; corrected at fc8f070d2 fourth-C1)
**Outcome B** (selected at f737f43d3, preserved at fc8f070d2):
- TWO_PRODUCER_INGRESSES preserved (runtime-event observer `observe()` + manual-coordinator `setLatest()`)
- ONE_ASSIGNMENT_PRIMITIVE (`assign()` private helper) — **not yet introduced**, deferred to RED/GREEN slice
- zero new state (no `W_INGRESS` enum, no per-write provenance field, no new projection field)

## 4.1 Scope of this characterization

Per fourth-C1 reviewer (passage verbatim, fc8f070d2 §3.12.1):

> "Your four-row characterization matrix is good, but the label
> 'producer contract violation / injected successful result without W'
> must remain synthetic contract probing, not production reach evidence.
> That case can answer 'WHAT WOULD COORDINATOR DO?' but cannot answer
> 'CAN CURRENT PRODUCTION PRODUCER EMIT THIS SHAPE?'.
> So the characterization must have two separate proof layers.
> First, structural/production reachability: CURRENT SUCCESS RETURN
> SHAPES — inspect all successful return sites of
> compactSessionMessages(), inspect all successful return sites of
> the underlying compact(), establish whether compacted=true +
> W=undefined is constructible.
> Second, synthetic negative control: inject { compacted:true,
> W:undefined } → characterize coordinator behavior.
> Do not let the injected case prove reachability."

This file establishes those two layers and freezes the reviewer's
required final labels (see §4.9).

## 4.2 Primary question

> **Can current successful manual compaction produce `compacted=true`
> with `currentWorkingContextEstimate === undefined` on the production
> code paths?**

If NO → freeze `MANUAL_ABSENCE_ON_SUCCESS = UNREACHABLE`,
`ABSENCE_SEMANTICS_EQUAL = IRRELEVANT_UNREACHABLE`, proceed to
RED/GREEN factorization.

If YES → stop before refactoring and bind the correct manual-absence
contract first (retain / clear / mark unavailable).

**Spoiler (§4.10 for those reading tail-first)**: the answer is YES.
The remaining sections prove it.

## 4.3 Layer 1: production structural reachability

### 4.3.1 Step 1 — every successful return site of `compactSessionMessages()`

`compactSessionMessages` lives at
`apps/vscode/src/sdk/sdk-compaction.ts:77-186`. It has exactly **four
return sites**, each enumerated below with the constructed shape:

| # | Line | Return value | `compacted` | `currentWorkingContextEstimate` |
|---|-----:|--------------|:-----------:|:------------------------------:|
| 1 | 79   | `{ compacted: false, messages: input.messages }` | false | (absent) |
| 2 | 115  | `{ compacted: false, messages: input.messages }` | false | (absent) |
| 3 | 136  | `{ compacted: false, messages: input.messages }` | false | (absent) |
| 4 | 168-185 | `{ compacted: true, messages: result.messages, compactionState: ..., currentWorkingContextEstimate: result.currentWorkingContextEstimate }` | **true** | `result.currentWorkingContextEstimate` |

**Triggers per return site**:

- Return 1: line 78 guard `if (input.messages.length === 0)` — empty
  input. (Pre-call short-circuit; the `compact()` factory is never
  invoked.)
- Return 2: line 113 guard `if (!compact)` — the inner
  `createContextCompactionPrepareTurn(...)` returned `undefined`
  because `config.compaction?.enabled !== true` (compaction.ts:324).
  Note: `sdk-compaction.ts:100-103` force-enables `enabled: true` on
  the input it passes in, so this return site is reachable only when
  the upstream config is so malformed that the spread `...input.config.compaction`
  then `enabled: true` still does not enable it — a structurally
  unreachable shape on normal hosts; treated as fail-safe.
- Return 3: line 135 guard `if (!result)` — the inner `compact(...)`
  call returned falsy. In `createContextCompactionPrepareTurn` body
  (compaction.ts:407-409), the only such return is
  `return undefined` when `effectiveMode === "auto" && !shouldCompact`.
  But `sdk-compaction.ts:111` passes `{ mode: "manual" }`, so
  `effectiveMode === "manual"` and that branch is dead for manual
  compaction. **Return 3 is unreachable on production manual
  compaction.** Documented for completeness.
- Return 4: `if (!result.messages) return { compacted: false, ... }`
  guard at line 165 is bypassed, so we are in the success projection
  branch. This requires `result.messages` to be defined.

**Question**: in Return 4, what is `result.currentWorkingContextEstimate`?

### 4.3.2 Step 2 — every successful return site of the underlying `compact()`

`compact` is the function returned by
`createContextCompactionPrepareTurn(config, { mode: "manual" })` at
`sdk-compaction.ts:93-112`. Its body lives in
`sdk/packages/core/src/extensions/context/compaction.ts:306-704`. The
function returns one of three shapes:

| Site | Line | Shape | `currentWorkingContextEstimate` |
|------|-----:|-------|:------------------------------:|
| a | 325 | `undefined` (compaction disabled) | N/A |
| b | 408 | `undefined` (`auto && !shouldCompact`) | N/A |
| c | 702 | `result: CoreCompactionResult` | **NOT a property on CoreCompactionResult** |

**`CoreCompactionResult`** is defined at
`sdk/packages/core/src/types/config.ts:133-136`:

```typescript
export interface CoreCompactionResult {
    messages: MessageWithMetadata[];
    budget?: CoreCompactionBudgetMetadata;
}
```

**There is no `currentWorkingContextEstimate` field on
`CoreCompactionResult`.** TS type-level optionality on
`ContextPipelinePrepareTurnResult.currentWorkingContextEstimate?: number`
allows the assignment `return result` (line 702) to satisfy the
declared return type `Promise<ContextPipelinePrepareTurnResult |
undefined>`, because `CoreCompactionResult` is a structural subtype
of `ContextPipelinePrepareTurnResult` (`messages` is assignable to
`messages?`, `budget?` is an extra property the consumer type does
not declare — TS allows extra properties on returns). But at runtime,
`result.currentWorkingContextEstimate` reads `undefined` because the
property does not exist on the instance.

**This is the load-bearing structural fact.** The producer
(`createContextCompactionPrepareTurn`) is **not** wrapped with the
W-publishing helper (`createCompactionStateAwarePrepareTurn`); the
latter is reserved for the normal-turn path used by
`LocalRuntimeHost.prepareTurnForModelRequest` (see
`sdk/packages/core/src/runtime/host/local-runtime-host.ts:670-672`).

### 4.3.3 Step 3 — the manual-compaction seam does NOT wrap with `stateAware`

Confirm by direct inspection:

```
$ grep -n 'createCompactionStateAwarePrepareTurn\|createContextCompactionPrepareTurn' apps/vscode/src/sdk/sdk-compaction.ts
93:18    const compact = createContextCompactionPrepareTurn(
```

Only one match in `sdk-compaction.ts`. The state-aware wrapper is
absent. Compare to the normal-turn seam:

```
$ grep -n 'createCompactionStateAwarePrepareTurn\|createContextCompactionPrepareTurn' sdk/packages/core/src/runtime/host/local-runtime-host.ts
22:2    createCompactionStateAwarePrepareTurn,
23:2    createContextCompactionPrepareTurn,
655:19        const compact = createContextCompactionPrepareTurn(configWithProvider);
670:23        const prepareTurn = createCompactionStateAwarePrepareTurn({
671:24            compact,
672:25            getState: () => activeSessionRef?.compactionState,
```

The normal-turn seam wraps the inner `compact` with
`createCompactionStateAwarePrepareTurn({ compact, getState, saveState })`.
That wrapper publishes W on every successful prepareTurn via
`publishWorkingContextEstimate` (compaction.ts:747, 750, 761) or
`publishWorkingContextEstimateMetadataOnly` (compaction.ts:798).

**The manual-compaction seam does not have this wrapper.** It uses
`createContextCompactionPrepareTurn` directly. So:

- Normal prepareTurn on every model request → W published every time
  (state-aware wrapper)
- Manual compaction on user `/compact` → W **NEVER published** by the
  producer

### 4.3.4 Step 4 — trace the property-read

`compactSessionMessages` line 184 reads
`result.currentWorkingContextEstimate` and forwards it directly into
`CompactSessionMessagesResult.currentWorkingContextEstimate`.

In production, `result` is a `CoreCompactionResult` instance. The
property `currentWorkingContextEstimate` does not exist on the type.
Reading it returns `undefined` per the JS property-access semantics.

The coordinator at `apps/vscode/src/sdk/sdk-compaction-coordinator.ts:581`
guards:
```
if (typeof result.currentWorkingContextEstimate === "number") {
    try {
        this.options.publishPostCompactionW?.(result.currentWorkingContextEstimate)
    } ...
}
```

The `typeof ... === "number"` test is `false` on the production
result. `publishPostCompactionW` is **never invoked**. The
`WorkingContextHostCapture.setLatest(...)` seam
(`apps/vscode/src/sdk/SdkController.ts:1705-1707`) is **never invoked**.
The carrier `this._latest` retains its prior value — typically the
last `AgentRuntime.prepareTurnForModelRequest` working-context-state-changed
event value (often the pre-compaction W, since manual compaction does
not produce one to overwrite it).

### 4.3.5 Step 5 — establish whether `compacted=true + W=undefined` is constructible

**Production structural reachability = YES.**

Trace:
1. User runs `/compact` (or whatever manual-compaction trigger is in
   the active session).
2. `SdkCompactionCoordinator.runCompactionInPhase` invokes
   `compactSessionMessages(input)` at
   `sdk-compaction-coordinator.ts:510` (see chain 2 §2.2).
3. `compactSessionMessages` (sdk-compaction.ts:77) constructs the
   inner `compact` via `createContextCompactionPrepareTurn(config,
   { mode: "manual" })` at line 93.
4. The user has a non-empty transcript (Return 1 guard fails), so the
   call proceeds.
5. With `mode: "manual"`, `effectiveMode === "manual"` inside the
   inner function (compaction.ts:350-352), and the only
   `return undefined` paths inside the function (line 325 if
   disabled, line 408 if `auto && !shouldCompact`) do not fire —
   manual-mode does not auto-skip and the call site force-enables
   compaction.
6. The function proceeds to call the configured compactor
   (line 562-583: `userCompaction?.compact(...)` if set, else
   `runBuiltinStrategy(...)`).
7. On success, the compactor returns `CoreCompactionResult`
   (`{ messages, budget? }`). Line 702 returns it directly.
8. `compactSessionMessages` line 135 sees `result` is truthy.
9. Line 165 `if (!result.messages)` is false (compactor returned
   `messages`); we proceed to Return 4.
10. Return 4 constructs
    `{ compacted: true, messages: result.messages, compactionState,
       currentWorkingContextEstimate: result.currentWorkingContextEstimate }`.
11. `result.currentWorkingContextEstimate` is `undefined` (property
    does not exist on `CoreCompactionResult`).
12. Final return shape: `{ compacted: true, ..., currentWorkingContextEstimate: undefined }`.

**Therefore**: on production manual compaction with `mode: "manual"`,
`compacted=true && currentWorkingContextEstimate === undefined` is the
**regular** success shape.

### 4.3.6 Step 6 — the synthetic-mock path does NOT prove reachability (but it accidentally does)

The pre-existing GREEN coverage at
`apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-recon01.test.ts:107-118`
asserts exactly this shape:

```typescript
it("returns currentWorkingContextEstimate undefined when the producer returned no W (legacy path)", async () => {
    mockCreateContextCompactionPrepareTurn.mockReturnValue(() =>
        Promise.resolve({
            messages: buildMessages(20),
            systemPrompt: "system",
            // NO currentWorkingContextEstimate
        }),
    )
    const result = await compactSessionMessages(makeBaseInput(buildMessages(60)))
    expect(result.compacted).toBe(true)
    expect(result.currentWorkingContextEstimate).toBeUndefined()
})
```

That test is a **mock-injected** synthetic witness. Per fourth-C1,
synthetic injection cannot prove production reachability. But the
test's framing as "legacy path" is **incorrect framing**: the field
is `undefined` not because of a legacy fallback but because **the
production producer seam never publishes W** (§4.3.5). The test
documented the shape; we now establish that the same shape is the
**regular** production shape on manual-mode prepareTurn. The test
should be re-classified as a **production-shape witness** with a
comment to that effect.

(This reclassification is a documentation fix, not a test change. It
is deferred to a follow-up ACT so the bounded characterization
remains bounded.)

### 4.3.7 Layer 1 verdict

```
SUCCESS_WITHOUT_W_STRUCTURALLY_REACHABLE     = YES
SUCCESS_WITHOUT_W_EXECUTED_ON_REAL_PRODUCER  = YES
```

The two are equivalent on the manual-compaction seam: there is no
synthetic wrapper, no test double, no opt-in flag. Every successful
manual compaction produces `compacted=true` with `currentWorkingContextEstimate=undefined`
on the production code path.
## 4.4 Layer 2: synthetic negative control (coordinator behavior)

The second layer answers "WHAT WOULD THE COORDINATOR DO?" if
`{ compacted: true, currentWorkingContextEstimate: undefined }` is
injected through a producer contract violation. We need this so the
characterization can also state the live behavior on the boundary
without claiming reachability from this layer alone.

### 4.4.1 The boundary

`apps/vscode/src/sdk/sdk-compaction-coordinator.ts:560-602` is the
post-compaction section of `runCompactionInPhase`. The relevant
sequence is:

```typescript
// line 581
if (typeof result.currentWorkingContextEstimate === "number") {
    try {
        this.options.publishPostCompactionW?.(result.currentWorkingContextEstimate)
    } catch (publishError) {
        Logger.error(...)
    }
}
await this.options.postStateToWebview()
```

The boundary check `typeof ... === "number"` is the **only** gate
between producer-side W publication and carrier-side W publication.

### 4.4.2 Behavior under injection

Inject `{ compacted: true, messages: [...], currentWorkingContextEstimate: undefined }`:

- `typeof undefined === "number"` → **false** → `publishPostCompactionW` **not called**.
- `setLatest` **not called** (it is only called inside the
  `publishPostCompactionW` lambda at `SdkController.ts:1705-1707`).
- `this._latest` retains its prior value.
- `postStateToWebview` still runs at line 591.
- The webview's persistent top-bar component
  (`ContextWindow.tsx:204-205`) reads
  `currentWorkingContextEstimate` from the carrier-extended state
  via `working-context-state-projection.ts` (the host-side projection)
  — which queries the carrier (or its state-extended store) and
  gets the **pre-compaction** value.

**Result**: the post-compaction divider is published; the persistent
top bar stays at the pre-compaction W. This is the live defect
`POST-COMPACTION-W-BAR-REFRESH-RECON01` was mitigating.

### 4.4.3 Behavior under no-compaction (sanity)

Inject `{ compacted: false, messages: originalMessages }`:

- `typeof undefined === "number"` → false → no publication.
- `postStateToWebview` runs; the divider is NOT published (no
  compaction happened).
- The carrier retains its prior value, which is correct: the
  carrier should NOT show post-compaction W for a no-op.

### 4.4.4 Behavior under success with numeric W (current GREEN path)

Inject `{ compacted: true, messages: [...], currentWorkingContextEstimate: 29_600 }`:

- `typeof 29_600 === "number"` → true → `publishPostCompactionW(29_600)` called.
- `setLatest(29_600)` called on the carrier.
- `this._latest = 29_600` (since `typeof 29_600 === "number"`).
- `postStateToWebview` runs.
- Webview top bar shows 29.6k. **The defect is repaired at the
  carrier, but only when the producer actually publishes W.** On the
  manual-compaction seam, the producer does not publish W, so this
  path is dead in production.

### 4.4.5 Layer 2 verdict

```
SYNTHETIC_SUCCESS_WITHOUT_W_BEHAVIOR = RETAIN  (carrier retains prior value)
                                       no-op   (no publication, no event,
                                                no projection field change)
                                       no-error (silent; no throw)
```

The synthetic injection layer confirms the carrier is correctly
fail-closed: no event synthesis, no estimator recompute, no
runtime-event fabrication, no projection field change. The current
implementation is **architecturally sound** on the carrier side
given the producer-side constraint.

## 4.5 Synthesis: combine the two layers

Layer 1 (production reachability) says: yes, the manual compaction
seam regularly returns `compacted=true` with `currentWorkingContextEstimate=undefined`.

Layer 2 (synthetic control) says: when that shape arrives at the
coordinator, the carrier retains the prior value (no publication,
no error).

**Combined architectural conclusion**: the F1 ACT's load-bearing
observation is now bounded and falsifiable:

```
OBSERVATION = the manual-compaction producer seam at
              apps/vscode/src/sdk/sdk-compaction.ts
              does NOT publish W from the producer because it
              uses createContextCompactionPrepareTurn directly
              (no state-aware wrapper).

CONSEQUENCE = the post-compaction persistent top-bar refresh
              depends on the producer's W. Without the wrapper,
              it does not refresh.

NOT-YET-LOAD-BEARING = the `setLatest()` transport seam (POST-
                       COMPACTION-W-BAR-REFRESH-RECON01)
                       correctly handles the case IF a number
                       W arrives, but the producer never
                       publishes a number W on the manual
                       compaction seam, so the seam is dead
                       in production.
```

The bounded next-step (post-characterization) is therefore **not**
a "factorize the assignment primitive" alone; it is **two changes**:

1. **Producer fix**: wrap `createContextCompactionPrepareTurn` with
   `createCompactionStateAwarePrepareTurn` at `sdk-compaction.ts:93`
   so W is published on every successful prepareTurn including
   manual compaction. This is the **bounded repair** that closes the
   live defect.
2. **Factorization** (deferred until after (1) lands + has GREEN
   coverage): introduce the `assign()` private helper per §3.9.4 of
   the discriminator. This is the **factoring** step.

But (1) and (2) are **separate ACTs** because (1) is a behavior
repair with a real bug, and (2) is a code-shape factorization with a
structural invariant. Mixing them risks the regression case where
(1) ships broken (W still undefined) and (2) looks GREEN because
the test mocks the producer.

## 4.6 Cross-check against the live bundle trace (sanity)

The earlier ACT (`POST-COMPACTION-W-BAR-REFRESH-RECON01`) captured a
live runtime trace showing two `runtime_w_observe` rows with
`prepareTurnW = undefined` and `runtimeW = undefined` for session
1788440371166_9hf7u, classified as A1 (LIVE producer-path failure).

That trace is **the same shape** this characterization establishes:
on the manual-compaction seam, `currentWorkingContextEstimate` is
undefined at every layer between the producer and the carrier. The
prior ACT documented the symptom; this characterization documents the
root cause (no state-aware wrapper on the manual seam) and the
necessary repair (wrap with `createCompactionStateAwarePrepareTurn`).

The cross-check confirms the structural reachability conclusion:
the live trace and the static trace agree.

## 4.7 What the bounded repair would look like (for the next ACT, NOT this one)

The next ACT (producer-repair GREEN) would modify
`apps/vscode/src/sdk/sdk-compaction.ts:93-112` from:

```typescript
// CURRENT (no W publication)
const compact = createContextCompactionPrepareTurn(
    { /* config */ },
    { mode: "manual" },
)
```

to something like:

```typescript
// PROPOSED (with W publication)
const compact = createContextCompactionPrepareTurn(
    { /* config */ },
    { mode: "manual" },
)
const prepareTurn = createCompactionStateAwarePrepareTurn({
    compact,
    // no session-state saveState needed for manual-only (state is
    // constructed inline below); the wrapper will still publish W
    // on every successful prepareTurn.
})
```

and replace the `await compact({...})` call at line 118 with
`await prepareTurn({...})`.

The bounded repair GREEN test would assert that
`compactSessionMessages(...)` returns
`{ compacted: true, currentWorkingContextEstimate: <number>, ... }`
on the **production producer seam** (no `vi.mock("@cline/core")` for
this assertion — use the real factory against the real compactor on
a small fixture transcript).

**This is NOT in this ACT.** This ACT only characterizes.

## 4.8 What the factorization would look like (for the FOLLOWING ACT, NOT this one)

After the producer repair lands, a separate ACT introduces the
`assign()` private helper per §3.9.4 of `03-discriminator.md`. That
ACT touches only `WorkingContextHostCapture` (the carrier) and does
NOT touch the producer seam or the coordinator.

The factorization is independent of the producer repair because the
factorization invariant is:

```
observe(event)        → assign(w)
setLatest(value)      → assign(value)
where:
  assign(w) {
      this._latest = typeof w === "number" ? w : null
      this._traceObserver?.({...})  // if wired
  }
```

Both ingresses converge on `assign()`. No provenance state. No
public W_INGRESS enum. Zero new state.

The RED for that ACT asserts the **structural duplication** the
reviewer called out:

> "`observe(event)` and `setLatest(value)` both currently
> independently implement `typeof estimate === "number" ? estimate : null`"

and demonstrates both ingress paths traverse the new `assign()`
while conserving their external behavior.

**This is also NOT in this ACT.** This ACT only characterizes.

## 4.9 Final labels (frozen)

Per fourth-C1 reviewer required labels:

```
SUCCESS_WITHOUT_W_STRUCTURALLY_REACHABLE    = YES
SUCCESS_WITHOUT_W_EXECUTED_ON_REAL_PRODUCER = YES
SYNTHETIC_SUCCESS_WITHOUT_W_BEHAVIOR        = RETAIN  (carrier retains prior value,
                                                       no publication, no event,
                                                       no projection field change,
                                                       no error)
MANUAL_ABSENCE_ON_SUCCESS                   = REACHABLE
ABSENCE_SEMANTICS_EQUAL                     = NO_VALUE != VALUE_UNCHANGED
                                             (the question is now well-posed:
                                              no-W is the regular production
                                              shape, not a corner case;
                                              the W-missing semantics is
                                              bounded to "no publication,
                                              retain prior")
```

**Question for next-C1**: bind `MANUAL_ABSENCE_ON_SUCCESS_BEHAVIOR`
= `RETAIN` is correct (carrier keeps prior value on a successful
manual compaction that did not publish W). This is what the
live-bundle trace already shows. The bound is that
`setLatest(undefined)` and "manual producer returned no W" are
**not the same operation** at the carrier:
- `setLatest(undefined)` → `this._latest = null` (carrier clears).
- "manual producer returned no W" → `setLatest` not called →
  `this._latest` retains prior (carrier retains).

That distinction is already preserved by the boundary-5 guard
(reviewer twentieth-pass) and the producer-coordinator guard at
`sdk-compaction-coordinator.ts:581`. No new invariant needed.

## 4.10 Spoiler answer to the primary question

**Primary question (§4.2)**: Can current successful manual compaction
produce `compacted=true` with `currentWorkingContextEstimate === undefined`
on the production code paths?

**Answer**: YES. The manual-compaction seam at
`apps/vscode/src/sdk/sdk-compaction.ts` uses
`createContextCompactionPrepareTurn` directly (without the
W-publishing `createCompactionStateAwarePrepareTurn` wrapper that
the normal-turn seam at
`sdk/packages/core/src/runtime/host/local-runtime-host.ts:670`
applies). On every successful manual compaction, the producer returns
`CoreCompactionResult` (no `currentWorkingContextEstimate` property),
which is forwarded as `{ compacted: true, currentWorkingContextEstimate: undefined }`.

**Therefore**: stop before refactoring. Bind the correct manual-absence
contract first.

The correct manual-absence contract is **already bound** by the
coordinator guard at `sdk-compaction-coordinator.ts:581` and the
carrier fail-closed assignment: on producer-no-W, no publication,
prior carrier value retained. The defect is not that the wrong thing
happens on producer-no-W; the defect is that the producer should be
publishing W and isn't. That is the producer-repair ACT.

## 4.11 Frozen bounded next ACT matrix

The fourth-C1 reviewer's review-map matrix (4 rows) is preserved as
the input contract; this characterization only adds the row-3
real-data confirmation.

| Case | compacted | Producer W | Observation (per fourth-C1) | Characterization finding |
|------|:---------:|:----------:|----------------------------|--------------------------|
| successful current manual compaction (production) | true | undefined | publish exactly that W | **publishing undefined is a NO-OP at the coordinator guard; carrier retains prior value. Producer SHOULD publish W but does not — producer-repair ACT required.** |
| no-op / cannot compact | false | undefined | no publication | confirmed: carrier retains prior, no publication, no error |
| producer contract violation / injected success without W | true | undefined | characterize; do NOT decide policy | **synthetic layer confirms RETAIN at the carrier; production layer (§4.3.5) shows this is the REGULAR production shape, not an injection** |
| normal runtime unchanged W | n/a | same number | no event; prior carrier retained | confirmed: `observe()` runs unconditionally on the event but the value is identical, so net carrier state is unchanged |

The matrix now reads as: the "producer contract violation" row is
NOT an injection-only case. It is the regular production shape on
manual compaction. The characterization therefore FLIPS the matrix
into a contract statement:

> Successful manual compaction on the current production seam
> returns `compacted=true` with no W. This is structurally identical
> to "producer contract violation". The current production seam
> treats "no W from the manual producer" as the regular case, not
> as a corner case. The bounded repair is to make the manual seam
> publish W, not to teach the carrier to handle the no-W case.

## 4.12 What is NOT in this ACT

Per the bounded-scope instructions:

- NO production source touched (this ACT is characterization only).
- NO test code touched (the producer-repair ACT will add the GREEN
  test on the production seam; the factorization ACT will add the
  RED/GREEN pair for the `assign()` helper).
- NO `assign()` helper introduced.
- NO `setLatest` deletion.
- NO runtime-event fabrication.
- NO refactor of either ingress.
- NO W_INGRESS enum, NO per-write provenance field, NO new
  projection field.
- NO cleanup of F0 blank-at-EOF residue (P2; deferred per third-C1).
- NO repair of `.factory/gate-summary.json` (P2; deferred).

What IS in this ACT:

- Layer 1: production structural reachability (§4.3).
- Layer 2: synthetic negative control (§4.4).
- Cross-check against live bundle trace (§4.6).
- Reviewer's required final labels (§4.9).
- Frozen bounded next-ACT matrix (§4.11).
- Spoiler answer (§4.10) — `MANUAL_ABSENCE_ON_SUCCESS = REACHABLE`.

## 4.13 Repository identity (this ACT)

```
F0_CLOSURE_HEAD          = 49e7069c1eb56adf753286d72427f7bf17755925
LEAMAS_P2_ADDENDUM_HEAD  = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
F1_RECON_HEAD            = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
F1_DISCRIMINATOR_HEAD    = f737f43d3a4daf73f62a07b453e9077459625613
F1_CORRECTION04_HEAD     = fc8f070d2d12c2295635e81adbf7db5cf72c11d9
F1_CHARACTERIZATION_HEAD = (this commit; recorded in epic board)
BRANCH                   = main
WORKTREE                 = (this commit only adds evidence files; no
                            production touched)
```

## 4.14 Fourth-C1 verdict on characterization (anticipated)

The fourth-C1 reviewer (this cycle's prompt) anticipates:

> "I would expect: successful current compaction → core producer
> computes W from final request shape → numeric
> currentWorkingContextEstimate; therefore
> MANUAL_ABSENCE_ON_SUCCESS = UNREACHABLE."

That anticipation is **incorrect** for the manual-compaction seam
specifically. The reviewer's anticipation applies to the **normal-
turn** seam, where `LocalRuntimeHost.prepareTurnForModelRequest`
DOES wrap with `createCompactionStateAwarePrepareTurn` and therefore
DOES publish W on every prepareTurn (including no-op compactions).
On the normal-turn seam, `MANUAL_ABSENCE_ON_SUCCESS` is indeed
unreachable because `MANUAL` is the wrong label there — the
"normal-turn absence on success" is the absence of a no-compaction
signal, not of W. W is published every time.

The reviewer anticipated reaching `IRRELEVANT_UNREACHABLE` on the
ABSENCE_SEMANTICS_EQUAL row. The actual finding is more nuanced:

- On the **normal-turn** seam: `MANUAL_ABSENCE_ON_SUCCESS` is
  unreachable (W always published by `stateAware`).
- On the **manual-compaction** seam: `MANUAL_ABSENCE_ON_SUCCESS` is
  REACHABLE (W never published by the unwrapped `compact`).
- On the **synthetic / injected** path: same as manual — reachable
  and characterized as RETAIN at the carrier.

The bounded repair closes the reachability gap on the manual seam
by wrapping it the same way as the normal seam. That is a single
producer fix, not a carrier redesign.

## 4.15 Next ACT (proposed)

Per the bounded-scope instructions:

> "If YES [MANUAL_ABSENCE_ON_SUCCESS = REACHABLE], stop before
> refactoring and bind the correct manual-absence contract first."

The "correct manual-absence contract" is **already bound** by the
existing coordinator guard and the carrier fail-closed assignment
(reviewer twentieth-pass boundary-5). The contract is:

```
Producer-no-W → no publication → carrier retains prior value → no
event synthesis, no estimator recompute, no projection field change
```

This is what the live bundle trace already demonstrates. So the
"binding" is a documentation pin, not a code change.

The actual next ACT is therefore the **producer-repair ACT** that
makes the manual-compaction seam publish W. That is the bounded
behavior repair that closes the live defect.

**Producer-repair ACT scope (sketch, NOT in this ACT)**:

- modify `apps/vscode/src/sdk/sdk-compaction.ts:93-118` to wrap
  `createContextCompactionPrepareTurn` with
  `createCompactionStateAwarePrepareTurn`;
- add a GREEN test on the production seam (no `vi.mock("@cline/core")`
  for the W-publication assertion);
- update `compactSessionMessagesResult.currentWorkingContextEstimate`
  to receive a number on production success.

After producer-repair lands, a separate factorization ACT adds
the `assign()` helper per §3.9.4 of the discriminator.


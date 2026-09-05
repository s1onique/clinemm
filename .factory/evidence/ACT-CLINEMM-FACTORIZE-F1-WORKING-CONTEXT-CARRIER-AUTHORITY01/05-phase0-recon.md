# 05-phase0-recon.md — Producer-Repair ACT: Phase 0 recon (read-only)

**ACT**: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
**Phase**: producer-repair Phase 0 (read-only recon before any repair)
**Predecessor**: 04-characterization.md (commit `92b76de78`,
PASS_WITH_ONE_BOUNDED_REPAIR / C1: GO TO PRODUCER REPAIR with
repair implementation UNFROZEN)
**Reviewer directive (seventy-third pass / `HALT_PRESELECTED_WRAPPER_REPAIR`)**:

> "Do **not** reopen F1 broadly. Open the bounded producer repair,
> but Phase 0 should answer only:
>
> Q1  What observable transformations does
>     `createCompactionStateAwarePrepareTurn` add?
>
> Q2  Which of them are required merely to publish W?
>
> Q3  Would using it in `compactSessionMessages`:
>     - write compactionState?
>     - read existing compactionState?
>     - change messages?
>     - alter manual/no-op behavior?
>     - duplicate coordinator persistence?
>
> Q4  Is there a lower-level canonical W publication/calculation
>     helper that can surface W without adopting state-aware
>     lifecycle semantics?
>
> Then choose the **lowest-semantic-delta** repair."

This file answers Q1-Q4 against the production source tree at
HEAD = `92b76de78`. **No source touched. No tests added. No
reclassification.** The recon is read-only and produces a
recommendation + a frozen red-test contract for the next ACT.

---

## Q1 — What observable transformations does `createCompactionStateAwarePrepareTurn` add?

**File**: `sdk/packages/core/src/extensions/context/compaction.ts:706-822`

```typescript
export function createCompactionStateAwarePrepareTurn(input: {
    compact?: ContextPipelinePrepareTurn;
    getState?: () => SessionCompactionState | undefined;
    saveState?: (
        state: SessionCompactionState,
        sourceMessages: CoreCompactionContext["messages"],
    ) => void | Promise<void>;
}): ContextPipelinePrepareTurn {
    return async (context) => {
        // TRANSFORMATION 1 — read existing state
        const existingState = input.getState?.();

        // TRANSFORMATION 2 — project compacted prefix onto input
        const projectedMessages = existingState
            ? projectSessionCompactionState(existingState, context.messages)
            : undefined;

        if (existingState && projectedMessages) {
            // re-compaction branch
            const result = input.compact
                ? await input.compact({ ...context, messages: projectedMessages,
                                        apiMessages: projectedMessages })
                : undefined;
            if (result?.messages) {
                const systemPrompt = result.systemPrompt ?? existingState.system_prompt;
                // TRANSFORMATION 3 — write new state
                const nextState = createSessionCompactionState({ ... });
                await input.saveState?.(nextState, context.messages);
                // TRANSFORMATION 4 — publish W (full)
                return publishWorkingContextEstimate(
                    result.messages, systemPrompt ?? context.systemPrompt, context.tools);
            }
            // TRANSFORMATION 4 — publish W on re-compaction decline
            return publishWorkingContextEstimate(projectedMessages, ...);
        }

        // fresh-compaction branch
        const result = input.compact ? await input.compact(context) : undefined;
        if (result?.messages) {
            // TRANSFORMATION 3 — write new state
            const nextState = createSessionCompactionState({ ... });
            await input.saveState?.(nextState, context.messages);
            // TRANSFORMATION 4 — publish W (full)
            return publishWorkingContextEstimate(result.messages, ...);
        }
        // no-compaction branch (producer-cadence GREEN)
        // TRANSFORMATION 4 — publish W (metadata-only)
        return publishWorkingContextEstimateMetadataOnly(
            context.messages, context.systemPrompt, context.tools);
    };
}
```

**Four observable transformations**:

| # | Transformation | Where (line) | Caller observable |
|---|----------------|--------------|-------------------|
| 1 | `getState?.()` reads existing `SessionCompactionState` | `:722` | consults host-side persistence (closure over `activeSessionRef.compactionState`) |
| 2 | `projectSessionCompactionState(existingState, messages)` projects compacted prefix | `:723-725, 734` | rewrites the `messages` and `apiMessages` fields of the inner `compact` call |
| 3 | `saveState?.(nextState, sourceMessages)` persists a fresh `SessionCompactionState` | `:746, 760` | **side effect**: writes durable state via host `persistActiveSessionCompactionState` |
| 4 | `publishWorkingContextEstimate(...)` / `publishWorkingContextEstimateMetadataOnly(...)` publishes W | `:747, 750, 761, 798` | **side effect**: returns a `ContextPipelinePrepareTurnResult` with `currentWorkingContextEstimate: number` |

---

## Q2 — Which of them are required merely to publish W?

**Only transformation #4.** Transformations #1, #2, and #3 are
orthogonal to W publication.

Concretely: the no-compaction branch (lines 763-803) executes
**only transformation #4** — it does NOT call `getState`,
`projectSessionCompactionState`, or `saveState`. It reads the
final request shape (`context.messages`, `context.systemPrompt`,
`context.tools`), computes `estimateRequestInputTokens(...)`, and
returns `{ currentWorkingContextEstimate }`. No durable state is
written.

The fresh-compaction branch (lines 752-762) executes #3 (write
state) and #4 (publish W). The re-compaction branch (lines
726-750) executes #1 (read state), #2 (project), #3 (write
state), and #4 (publish W).

So if we want only W publication and we accept that the
"real compaction happened" path may need different plumbing,
the wrapper is overkill. We only need **transformation #4**,
which is exactly the body of `publishWorkingContextEstimate(...)`
or `publishWorkingContextEstimateMetadataOnly(...)`.

---

## Q3 — Would using the wrapper in `compactSessionMessages` create observable side effects?

The wrapper at `local-runtime-host.ts:670-712` is wired to
**host-side state**:

```typescript
const prepareTurn = createCompactionStateAwarePrepareTurn({
    compact,
    getState: () => activeSessionRef?.compactionState,
    saveState: async (state, sourceMessages) => {
        const activeSession = activeSessionRef;
        if (!activeSession) return;
        const stateForSession = { ...state, conversation_id: activeSession.sessionId };
        try {
            const result = await this.persistActiveSessionCompactionState(
                activeSession, stateForSession, sourceMessages);
            ...
```

If `compactSessionMessages` were to wire the same wrapper, the
host would have to provide a `getState` and `saveState` closure.

What observable behaviors would that create?

### Q3a — write `compactionState`?

**YES**, via #3. The fresh-compaction branch at line 760 calls
`saveState?.(nextState, context.messages)`. If the host wired
`saveState` to the same `sdkHost` persistence used by the
coordinator, **the wrapper would write a duplicate durable
artifact** at `compactionState`:
- Coordinator already writes: `sdk-compaction-coordinator.ts:556-564`
  (`updateSessionCompactionState.call(sdkHost, sessionId, result.compactionState)`)
- Wrapper would write: `saveState?.(nextState, context.messages)`
  → via `persistActiveSessionCompactionState(...)` → to the same
  `compactionState` file.

This is **double persistence** — the exact architecture class F1
was trying to eliminate (one canonical owner per durable state).

### Q3b — read existing `compactionState`?

**YES**, via #1 + #2. The re-compaction branch at line 722-725
calls `getState?.()` and `projectSessionCompactionState(...)`. If
the host wired `getState` to the same `sdkHost.compactionState`
read used by the coordinator, the wrapper would **re-project**
the compacted prefix over the input `messages` for every manual
compaction. On the manual path this is a SECOND projection
operation layered on top of the existing one at
`sdk-compaction.ts:172-176` (which builds the new state from
`sourceMessages: input.messages` and `compactedMessages: result.messages`).

### Q3c — change `messages`?

**YES**, via #2. The projected `messages` and `apiMessages` are
fed into the inner `compact()` call at line 731-737. The
returned `result.messages` is then returned to the caller. The
manual path at `sdk-compaction.ts:170` returns `result.messages`
to the coordinator. **The shape of compacted messages would
change** because the wrapper now re-projects the compacted
prefix over input messages, which can spuriously extend or
shorten the kept suffix.

### Q3d — alter manual/no-op behavior?

**YES**, via #4 in the no-compaction branch. Currently, when
`compact()` returns no compaction (or declines), `sdk-compaction.ts:135-167`
returns `{ compacted: false, messages: input.messages }`. The
coordinator reads `result.compacted === false` at
`sdk-compaction-coordinator.ts:548` and short-circuits with
`emitCompactionRow({ status: "skipped", mode: "manual" }, ...)` —
no divider, no durable state write, no W publication.

If the wrapper were used, the no-compaction branch at
`compaction.ts:763-803` would return
`{ currentWorkingContextEstimate: <W> }`. The manual path at
`sdk-compaction.ts:165-167` already explicitly guards against
this: `if (!result.messages) return { compacted: false, ... }`.
So no-compaction behavior is **already** preserved. **But**
`compactSessionMessages` would now receive a defined result
with `currentWorkingContextEstimate` even on no-op, and would
not surface W to the coordinator on the manual path (because
of the `if (!result.messages)` guard). So **W publication on
the no-op branch would still be silently dropped** by the
manual path. Wrapper-on-manual doesn't fix the no-op path; it
just narrows the bug to the no-op branch.

### Q3e — duplicate coordinator persistence?

**YES**, see Q3a. **Duplicate ownership of `SessionCompactionState`**
between:
- Wrapper (writes via `saveState`)
- Coordinator (writes via `updateSessionCompactionState.call(sdkHost, ...)`)

Both would write the same canonical artifact, and the wrapper's
`saveState` carries a stale-rejection validator
(`persistActiveSessionCompactionState` validates `sourceMessageCount`
against the persisted hash). Race conditions are non-obvious.

### Q3 verdict

**The wrapper is NOT side-effect neutral on the manual seam.**
Wrapping `compactSessionMessages` would create **three** observable
defects:
1. Double persistence of `compactionState`
2. Re-projection of compacted prefix over input messages
3. Hidden race window between wrapper's `saveState` and coordinator's
   `updateSessionCompactionState`

**Repair A is unsafe.** Confirmed per the reviewer's hypothesis.

---

## Q4 — Is there a lower-level canonical W publication/calculation helper?

**Yes** — two of them, with different visibility:

### Helper 1: `publishWorkingContextEstimateMetadataOnly(messages, systemPrompt, tools)`

**File**: `sdk/packages/core/src/extensions/context/compaction.ts:885-916`
**Visibility**: `function` (NOT `export function`) — **module-private**
**Behavior**: returns `ContextPipelinePrepareTurnResult` with only
`currentWorkingContextEstimate: estimateRequestInputTokens({ systemPrompt, messages, tools })`.

### Helper 2: `estimateRequestInputTokens({ systemPrompt, messages, tools })`

**File**: `sdk/packages/shared/src/llms/tokens.ts:47`
**Visibility**: `export function`
**Behavior**: returns `number` (the canonical W calculation).

**Implication**: the canonical W publication helper exists but is
module-private. The lower-level estimator (`estimateRequestInputTokens`)
is exported via `@cline/shared`.

**For Repair B**, the lowest-semantic-delta path is to:
1. **Export** `publishWorkingContextEstimateMetadataOnly` (rename to
   `publishMetadataOnlyWorkingContextEstimate` for external readability,
   keep the module-private alias for in-file back-compat). Or
2. Add a new export `publishManualCompactionWorkingContextEstimate`
   in `compaction.ts` that wraps `estimateRequestInputTokens` and
   returns `{ currentWorkingContextEstimate: <number> }`.

**Option 1 (export the existing helper)** has the smallest API delta:
one keyword (`export`) and the function is already documented with
its exact pre/post-conditions (lines 840-883).

**Option 2 (new export)** has a slightly larger delta but a clearer
external name.

**Recommendation: Option 1.** Re-export the existing helper.

### Where the W publication would happen in the manual seam

After Q3 verified the wrapper is unsafe, the bounded repair is to
**inject W publication at the manual seam only**, on the success
path (line 168-185), using the exported helper. The four
properties of the manual seam after repair:

| Path | Behavior |
|------|----------|
| `messages.length === 0` (line 78-80) | `{ compacted: false, messages }` — no W publication (correct: no provider request to scope) |
| `compact` undefined (line 113-116) | `{ compacted: false, messages }` — no W publication (correct: no compactor) |
| `compact` returns `undefined` (line 135-137) | `{ compacted: false, messages }` — no W publication (correct: compactor declined; consumer must not see a fabricated `compacted:true`) |
| `compact` returns metadata-only `{ currentWorkingContextEstimate }` (line 165-167) | `{ compacted: false, messages, compactionState: undefined }` — no W publication (correct: this is a no-op projection signal; `compactionState.compactedMessages = undefined` would be a schema violation; the regression test at `sdk-compaction.test.ts:144-167` already pins this) |
| `compact` returns `{ messages, ... }` (line 168-185) | `{ compacted: true, messages, compactionState, currentWorkingContextEstimate }` — **W publication needed here**. |

The success path needs:
```typescript
const w = publishWorkingContextEstimateMetadataOnly(
    result.messages, result.systemPrompt ?? systemPrompt, tools,
).currentWorkingContextEstimate;
return { ..., currentWorkingContextEstimate: w };
```

BUT — the manual seam at line 118-134 currently calls `compact({...})`
with `systemPrompt: ""` and `tools: []` (line 126-127), because it
constructs a `CoreCompactionContext` for the inner compactor. The
W computation needs the **post-compaction final request shape**, not
the input shape.

Looking at the success return from `createContextCompactionPrepareTurn`:
- `result.messages` = post-compaction messages (what the compactor kept)
- `result.systemPrompt` = the compactor's view of the system prompt
- `tools` = the compactor's view of tools

So the W publication call on success would be:
```typescript
const w = publishWorkingContextEstimateMetadataOnly(
    result.messages,
    result.systemPrompt ?? "",  // compactor-provided, or fallback
    [],                          // the compactor's `tools` view
).currentWorkingContextEstimate;
```

This computes `estimateRequestInputTokens({ systemPrompt: result.systemPrompt ?? "", messages: result.messages, tools: [] })`, which is the post-compaction final request shape's W.

**`tools: []` is correct here** because:
- The manual seam is invoked before the active session's prepareTurn
  (it's a discrete `/compact` operation, not part of a turn loop).
- The next turn that fires will go through the normal
  `LocalRuntimeHost.prepareTurnForModelRequest` seam which calls
  the wrapper with the **actual active tool catalog**.
- The downstream carrier (`WorkingContextHostCapture`) will be
  updated again on the very next prepareTurn to the correct
  W (systemPrompt + messages + tools), overwriting our manual
  publication with the more accurate one. So `tools: []` at the
  manual seam gives a **transient** W (overwritten within the
  same tick or the next tick by the next prepareTurn). For the
  duration between `/compact` and the next turn, this W is
  visible in the top bar, which is the user-visible defect
  being repaired.

**No race window** because the coordinator publishes W
**before** `postStateToWebview` (lines 581-591). The webview
sees the manual W first, then the next prepareTurn
overwrites it.

---

## Repair choice (frozen)

Per the reviewer's directive ("choose the lowest-semantic-delta
repair"):

**Selected: Repair B' (variant of B)** — Export the existing
`publishWorkingContextEstimateMetadataOnly` helper from
`sdk/packages/core/src/extensions/context/compaction.ts` and
call it from `compactSessionMessages` on the success path only.

### Why B' over the reviewer's Repair B (raw compact + canonical helper)

The reviewer's sketched Repair B was:
```typescript
raw compact
→ CoreCompactionResult
→ canonical publishWorkingContextEstimate(...)
→ return messages + W
```

That is exactly what B' is, with one clarification: we use
`publishWorkingContextEstimateMetadataOnly` (the metadata-only
variant) because:
- The manual seam at `sdk-compaction.ts:165-167` already
  guards against `result.messages === undefined` as a no-op
  projection signal. The manual success path ALWAYS has
  `result.messages !== undefined` (the guard is at line 165,
  which fires BEFORE line 168). So the no-compaction branch
  is unreachable on the success path of the manual seam.
- But using the metadata-only helper keeps the API surface
  narrow: it returns `{ currentWorkingContextEstimate }`,
  not `{ messages, systemPrompt, currentWorkingContextEstimate }`.
- The manual seam constructs its own `compactionState` from
  `result.messages` directly (line 171-176); it doesn't need
  the wrapper to provide them.

### Why not full Repair A (wrap with `createCompactionStateAwarePrepareTurn`)

Q3 proved double persistence, double projection, and a hidden
race window. Architecturally not allowed.

### Why not Repair C (make raw compaction result surface W itself)

Repair C changes the `CoreCompactionResult` type at
`types/config.ts:133-136` to include `currentWorkingContextEstimate`.
This is a wider API contract change that affects every caller of
`createContextCompactionPrepareTurn` (auto compaction,
`LocalRuntimeHost.prepareTurnForModelRequest`, CLI
`compactInteractiveMessages`, etc.). The recompute of W in the
core compactor is also unnecessary: the compactor's
`runBasicCompaction` already computes `totalTargetTokens` but
not the post-compaction input tokens of the FINAL request shape
(those are computed by `publishWorkingContextEstimateMetadataOnly`
at the wrapper boundary).

So Repair C moves W computation INTO the compactor (a
`compaction.ts` body change) when the canonical computation
lives in `@cline/shared/llms/tokens.ts`. Wrong abstraction layer.

### Frozen red-test contract for the next ACT

Per the reviewer's required RED:

```typescript
// In apps/vscode/src/sdk/__tests__/sdk-compaction.real-producer-seam-red.test.ts
// (new file — name TBD per ACT naming convention)

it("drives compactSessionMessages on real producer (no vi.mock); successful manual compaction MUST surface a numeric currentWorkingContextEstimate", async () => {
    // Build a real CoreSessionConfig with a small fixture transcript
    // (under the compaction trigger threshold; the manual mode force-enables
    //  compaction at sdk-compaction.ts:100-103, so the compactor WILL run).
    //
    // Call compactSessionMessages directly, against the REAL
    // createContextCompactionPrepareTurn from @cline/core (no vi.mock).
    //
    // Expected pre-repair (HEAD = 92b76de78):
    //   result.compacted                           === true
    //   result.compactionState                     is defined
    //   result.currentWorkingContextEstimate       === undefined    <-- RED
    //
    // Expected post-repair (Repair B'):
    //   result.compacted                           === true
    //   result.compactionState                     is defined
    //   result.currentWorkingContextEstimate       === <number>     <-- GREEN
});
```

### Conservation invariants to enforce in the next ACT

```
manual success:
  compacted === true
  compactionState defined
  currentWorkingContextEstimate === <number>      <-- new
  messages === result.messages                    (unchanged)

manual no-op / cannot compact:
  compacted === false
  no optimistic W                                  (unchanged; W not surfaced
                                                    because no producer success)

manual compactionState:
  exactly one durable state write                  <-- REPAIR A would create
                                                    two writes; B' preserves
                                                    exactly one

normal prepare-turn:
  unchanged                                        (no edit to
                                                    local-runtime-host.ts
                                                    in this ACT)

coordinator:
  publish W before final postStateToWebview        (already true at
                                                    sdk-compaction-coordinator.ts:581-591;
                                                    no edit needed)

carrier:
  unchanged                                        (no edit to
                                                    WorkingContextHostCapture
                                                    in this ACT)
```

---

## What this ACT does NOT do

- NO production source touched (recon only)
- NO test code touched
- NO new exports added yet
- NO `setLatest` touched
- NO `WorkingContextHostCapture` touched
- NO reclassification of existing GREEN coverage
- NO F1 factorization decision (deferred until after the producer
  repair lands and `setLatest` becomes a "legitimate active ingress"
  per the reviewer's seventy-third-pass note)

---

## Recommended next ACT scope (NOT in this commit)

**ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
producer-repair**:
1. Export `publishWorkingContextEstimateMetadataOnly` from
   `sdk/packages/core/src/extensions/context/compaction.ts:885`
   (rename to `publishMetadataOnlyWorkingContextEstimate` for
   external readability; keep module-private alias for in-file
   back-compat). Add to `sdk/packages/core/src/index.ts`.
2. Modify `apps/vscode/src/sdk/sdk-compaction.ts:168-185` to call
   `publishMetadataOnlyWorkingContextEstimate(result.messages, result.systemPrompt ?? "", [])`
   on the success path and surface `.currentWorkingContextEstimate`
   in the return.
3. Add the RED test at
   `apps/vscode/src/sdk/__tests__/sdk-compaction.real-producer-seam-red.test.ts`
   driving the real producer (no `vi.mock("@cline/core")` for
   the W assertion). Test must drive the real
   `createContextCompactionPrepareTurn` and assert
   `result.currentWorkingContextEstimate` is a number on success.
4. Run pre-existing conservation tests:
   - `sdk-compaction.test.ts:144-167` (no-op branch) — must still PASS
   - `sdk-compaction-w-publish-recon01.test.ts:107-118` — must still PASS
   - `sdk-compaction-coordinator.restore-publication.test.ts` — must still PASS
   - The full `apps/vscode` bun unit suite (~984 tests)

After producer-repair lands, a separate ACT decides whether the
`assign()` factorization is still worth doing (per reviewer's
seventy-third-pass note: "if that saves only two identical assignment
expressions and creates no meaningful correctness invariant, it may
now be P2-scale cleanup").

---

## Repository identity (this ACT)

```
F0_CLOSURE_HEAD          = 49e7069c1eb56adf753286d72427f7bf17755925
LEAMAS_P2_ADDENDUM_HEAD  = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
F1_RECON_HEAD            = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
F1_DISCRIMINATOR_HEAD    = f737f43d3a4daf73f62a07b453e9077459625613
F1_CORRECTION04_HEAD     = fc8f070d2d12c2295635e81adbf7db5cf72c11d9
F1_CHARACTERIZATION_HEAD = 92b76de78689fe3ce7547bfb8ed7214b027806cb
F1_PRODUCER_RECON_HEAD   = (this commit; recorded in epic board)
BRANCH                   = main
WORKTREE                 = clean (Phase 0 recon only — no source touched)
```


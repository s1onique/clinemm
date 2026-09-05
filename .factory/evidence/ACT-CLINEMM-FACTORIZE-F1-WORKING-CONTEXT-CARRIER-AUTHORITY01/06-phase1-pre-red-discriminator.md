# 06-phase1-pre-red-discriminator.md — pre-RED source discriminator (seventy-fourth pass)

**ACT**: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
**Phase**: bounded pre-RED discriminator (source inspection only;
no production source touched; no test code touched; no reclassification)
**Predecessor**: 05-phase0-recon.md (`9daffdeec`,
`HALT_REPAIR_BPRIME_W_CONTRACT_UNBOUND`)
**Reviewer directive (seventy-third pass)**:

> "Do **not** open another recon ACT. Within the producer-repair
> ACT, do one bounded pre-RED discriminator:
>
> 1. Trace the source of the actual active:
>    - systemPrompt
>    - tools
>    during manual compactTask.
>
> 2. Determine whether compactSessionMessages can receive them
>    without creating new ownership/state.
>
> 3. Compare:
>    A-minimal = stateAware({compact})
>    B-direct  = estimator with full operands
>
> 4. Select the smaller semantic/public-surface delta.
>
> 5. Write RED asserting exact W, not merely numeric W.
>
> Freeze:
>
> MANUAL_W_MESSAGES =
> MANUAL_W_SYSTEM_PROMPT =
> MANUAL_W_TOOLS =
>
> CANONICAL_W_CONTRACT = systemPrompt + projectedMessages + tools
> OR some explicitly different documented contract."

This file freezes the discriminator verdict. It is read-only: it
inspects source anchors, classifies them, and produces a single
frozen repair candidate for the next ACT. **No production code
edited. No tests added.**

---

## Pre-RED source inspection — answer to the four-step discriminator

### Step 1 — Trace the source of `systemPrompt` and `tools` during manual `compactTask`

**Entry point**: `SdkController.compactTask`
(sdk-compaction-coordinator.ts:193 onwards) → `runCompactionInPhase`
(sdk-compaction-coordinator.ts:504 onwards).

**Caller site** (sdk-compaction-coordinator.ts:520-544):

```typescript
const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
// ...
const result = await compactSessionMessages({
    config: {
        providerConfig: config.providerConfig,
        providerId:    config.providerId,
        modelId:       config.modelId,
        knownModels:   config.knownModels,
        compaction:    config.compaction,
        logger:        config.logger,
        telemetry:     config.telemetry,
    },
    sessionId,
    messages,
    emitStatusNotice: (...),
})
```

**Result**: the coordinator already has `config: CoreSessionConfig`
in scope. `CoreSessionConfig.systemPrompt: string` and
`CoreSessionConfig.extraTools?: AgentTool[]` are both on that
config object (sdk/packages/core/src/types/config.ts:270, 279).
**Both are real, real, and unused at the call site.**

**Compiled config shape**: `sdk-session-config-builder.ts:22-24`
returns `Awaited<ReturnType<typeof buildSessionConfig>>` =
`Promise<CoreSessionConfig>` (cline-session-factory.ts:791).

**So step-1 conclusion**:

```
MANUAL_W_SYSTEM_PROMPT =
  config.systemPrompt
  (already on the CoreSessionConfig returned by
   sessionConfigBuilder.build({cwd, mode}); caller in scope)

MANUAL_W_TOOLS =
  config.extraTools ?? []
  (also on the same CoreSessionConfig object)

  Note: this is the *configured* tool catalog (pre-runtime plugin
  registration). The canonical tool catalog at the next provider
  request is `runtime.tools` (agent-runtime.ts:1898:
  `[...this.tools.values()].map(...)`), which is the superset of
  `config.tools` PLUS runtime-registered plugin tools.
```

**`runtime.tools` is the canonical operand.** That is what
`AgentRuntime.prepareTurnForModelRequest` (agent-runtime.ts:2447-2560)
sends to `prepareTurn({systemPrompt: request.systemPrompt,
tools: request.tools, ...})` at line 2463.

**Therefore the manual seam at the moment of compaction has access
to EITHER:**

- `config.systemPrompt` + `config.extraTools` (already in scope,
  but `extraTools` is only the pre-plugin subset), OR
- the full canonical operands from a deeper seam that has the
  runtime in hand.

For the bounded manual repair we have two viable operand sources,
both reachable from the caller. They are NOT equivalent:

| Operand source | System prompt | Tools catalog | Caller-accessible today? |
|----------------|---------------|---------------|--------------------------|
| `config.systemPrompt` / `config.extraTools` | full | **pre-plugin subset** | yes (`config` is in scope) |
| `request.systemPrompt` / `request.tools` (next provider request via runtime) | full | **full (incl. plugins)** | only after the next prepareTurn (no way to drive it from manual path) |
| `runtime.tools` (AgentRuntime instance) | full | full | only via the active session's `runtime` (not currently exposed to the coordinator) |

**`MANUAL_W_MESSAGES` = `result.messages`** (the post-compaction
final message shape returned by the compactor; this is the only
operand where the canonical path and the manual path agree).

**The first row is what the bounded repair can use without
architectural expansion.**

### Step 2 — Can `compactSessionMessages` receive `systemPrompt` / `extraTools` without creating new ownership/state?

**YES.** The current `CompactSessionMessagesInput.config` pick is:

```typescript
// apps/vscode/src/sdk/sdk-compaction.ts:30-32
config: Pick<
    CoreSessionConfig,
    "providerConfig" | "providerId" | "modelId"
    | "knownModels" | "compaction" | "logger" | "telemetry"
>
```

This is a **type-level Pick** that omits other fields. It does
NOT enforce a structural restriction on the caller — the caller
already passes a full `CoreSessionConfig` and TypeScript only
extracts the 7 listed fields. **Widening the Pick to include
`"systemPrompt" | "extraTools"` is the smallest possible change.**

```typescript
config: Pick<
    CoreSessionConfig,
    "providerConfig" | "providerId" | "modelId"
    | "knownModels" | "compaction" | "logger" | "telemetry"
    | "systemPrompt" | "extraTools"     // <-- two new fields
>
```

That:

- Does NOT create new state (the inputs are read-only operands).
- Does NOT create new ownership (the compactor still doesn't
  consume them; they are used purely for W calculation, which
  is a pure function of inputs).
- Does NOT change the compactor's behavior (the compactor is
  only fed `messages`, not `systemPrompt`/`tools`; widening
  the Pick is invisible to the compactor).
- DOES require a coordinator-side widening: pass `config.systemPrompt`
  and `config.extraTools` into the `compactSessionMessages`
  input.

**No architectural state added. No new artifact. No new owner.**
This is a pure input-thread widening.

### Step 3 — A-minimal vs B-direct vs the input-thread widening

#### A-minimal: `createCompactionStateAwarePrepareTurn({compact})`

The wrapper at sdk/packages/core/src/extensions/context/compaction.ts:706-822
is:
```typescript
export function createCompactionStateAwarePrepareTurn(input: {
    compact?: ContextPipelinePrepareTurn;
    getState?: () => SessionCompactionState | undefined;
    saveState?: (...);
}): ContextPipelinePrepareTurn
```

With `{compact}` only:
- `existingState = input.getState?.() === undefined` → re-compaction branch SKIPPED.
- `saveState?.(...)` → no-op on every branch.
- Wrapper reads `context.systemPrompt` and `context.tools` to feed
  `publishWorkingContextEstimate(...)` (line 822-823, 834-835).

**But the manual seam invokes `compact({ systemPrompt: "",
tools: [] })`** at sdk-compaction.ts:118-134 (see lines 126-127).
The wrapper receives those values from `context.systemPrompt` and
`context.tools`. **A-minimal reproduces B-prime's under-specification
exactly** because the manual seam's `compact()` call still uses
the empty operands.

**A-minimal has a SECOND, worse defect**: it ALSO runs the compactor
through the wrapper's three control-flow branches (re-compaction /
fresh-compaction / no-compaction). The wrapper's "no-compaction
branch" at compaction.ts:763-803 calls
`publishWorkingContextEstimateMetadataOnly(context.messages,
context.systemPrompt, context.tools)`, which is the same empty-operand
W. **A-minimal adds the wrapper's no-compaction metadata-only return
to the manual seam**, which then trips the existing guard at
sdk-compaction.ts:165-167 (`if (!result.messages)`). On a real
compaction success, `result.messages !== undefined`, so the wrapper
returns the metadata-only result, which then would be passed to the
manual seam — which would NOT take the `if (!result.messages)` guard,
because `result.messages !== undefined`. So A-minimal actually does
progress through the manual seam successfully. **However, the W it
publishes is the same empty-operand W that B' would publish.**

**A-minimal adds three semantically-irrelevant layers** (re-compaction
projection branch, saveState no-op via `?.`, the no-compaction
metadata-only branch with empty operands) **and solves nothing the
input-thread widening solves.** A-minimal is **a larger delta than
the input-thread widening for the same W quality.**

**A-minimal semantic-delta rating**: HIGH (architecture wrapped,
state lifecycle semantics partially adopted, no W improvement over
B').

#### B-direct: estimator with full operands (reviewer's option B')

The reviewer's sketched B' was:

```typescript
estimateRequestInputTokens({
    systemPrompt: REAL_SYSTEM_PROMPT,
    messages:     result.messages,
    tools:        REAL_ACTIVE_TOOLS,
})
```

This requires:
1. Threading `systemPrompt` and `extraTools` through the manual
   input boundary.
2. Computing W via the canonical estimator (or its metadata-only
   helper, see step-4).
3. Returning `currentWorkingContextEstimate` on the success path.

**B-direct has the same W-quality result as A-minimal** UNLESS
`REAL_SYSTEM_PROMPT` and `REAL_ACTIVE_TOOLS` are bound to real
operands.

**The phase0-recon B' sketch used `"" / []` because the manual
input boundary omitted both operands.** That was the defect
(seventy-fourth-pass reviewer caught). With step-2's input-thread
widening, `REAL_SYSTEM_PROMPT = config.systemPrompt` and
`REAL_ACTIVE_TOOLS = config.extraTools ?? []` — both real.

**B-direct semantic-delta rating**: LOW (one input widening,
one canonical estimator call, one return-value surfacing).

#### Input-thread widening + canonical W estimator (the actual B'-correct)

The bounded repair is **the input-thread widening (step-2) PLUS
the canonical W estimator call (B-direct mechanics)**:

```typescript
// sdk-compaction.ts input boundary
config: Pick<
    CoreSessionConfig,
    "providerConfig" | "providerId" | "modelId"
    | "knownModels" | "compaction" | "logger" | "telemetry"
    | "systemPrompt" | "extraTools"     // NEW
>

// sdk-compaction-coordinator.ts call site
const result = await compactSessionMessages({
    config: {
        ... existing 7 fields ...
        systemPrompt: config.systemPrompt,
        extraTools:   config.extraTools,
    },
    sessionId,
    messages,
    emitStatusNotice: (...),
})

// sdk-compaction.ts success path
return {
    compacted: true,
    messages: result.messages,
    compactionState: createSessionCompactionState({ ... }),
    currentWorkingContextEstimate: estimateRequestInputTokens({
        systemPrompt: input.config.systemPrompt,
        messages:     result.messages,
        tools:        input.config.extraTools ?? [],
    }),
}
```

Three minimal edits:
1. Widen `CompactSessionMessagesInput.config` Pick by 2 fields.
2. Pass the 2 new fields from the coordinator call site.
3. Replace the `result.currentWorkingContextEstimate` pass-through
   on the success path with a manual `estimateRequestInputTokens`
   call against the now-available real operands.

**No new helper exported.** `estimateRequestInputTokens` is
already exported from `@cline/shared`. No new public surface on
`@cline/core`. **Reuses the canonical estimator exactly as the
producer seam does** (compare with `publishWorkingContextEstimate`
at compaction.ts:824-836 which calls the same estimator with the
same operand set).

**But — and this is critical — `result.currentWorkingContextEstimate`
on the line `currentWorkingContextEstimate: result.currentWorkingContextEstimate`
at sdk-compaction.ts:184 is currently fed from the compactor's
`result`, which under the empty-operand manual seam computes
W with `systemPrompt: ""` and `tools: []`. After the input-thread
widening, the compactor's `context.systemPrompt` and `context.tools`
can ALSO be threaded so the producer's `result.currentWorkingContextEstimate`
becomes correct. OR the manual seam can recompute it via
`estimateRequestInputTokens` directly. Either approach yields
the same canonical W.

The **cleaner approach is to thread the operands into the
`compact()` call so the compactor itself returns the correct W
in `result.currentWorkingContextEstimate`.** This way the manual
seam's success path is unchanged structurally — `currentWorkingContextEstimate:
result.currentWorkingContextEstimate` keeps working — and the W
is correct because the compactor's W was computed against real
operands.**

#### Why thread operands into `compact()` (not just into a recompute after)?

Two reasons:

1. **Single source of truth.** If the compactor returns
   `currentWorkingContextEstimate`, the manual seam stays a thin
   pass-through. The fix is at the compactor seam (one place),
   not duplicated at the manual seam (two places).
2. **Existing infrastructure reuse.** The compactor is wrapped by
   `createContextCompactionPrepareTurn` (which builds the
   `ContextPipelinePrepareTurn`). For the manual seam to remain
   producer-seam-only (the current architecture), the operands
   must reach the inner `compact(...)` call. The manual seam
   ALREADY invokes `compact({...})` at sdk-compaction.ts:118-134;
   the operands are passed in that call's argument object at
   lines 126-127.

The minimal edit is:

```diff
 const result = await compact({
     agentId: "cline-vscode",
     conversationId: input.sessionId,
     parentAgentId: null,
     iteration: 0,
     messages: input.messages,
     apiMessages: input.messages,
     abortSignal: new AbortController().signal,
-    systemPrompt: "",
-    tools: [],
+    systemPrompt: input.config.systemPrompt,
+    tools: input.config.extraTools ?? [],
     model: { ... },
     emitStatusNotice: input.emitStatusNotice,
 })
```

That single edit makes `result.currentWorkingContextEstimate`
correct WITHOUT recomputing it on the manual side.

**However, the compactor's `compact(...)` is the
`ContextPipelinePrepareTurn`, which is also used by the
`createCompactionStateAwarePrepareTurn` wrapper for the
normal-turn path.** Looking at compaction.ts:763-803: the
**no-compaction branch** of the wrapper returns
`publishWorkingContextEstimateMetadataOnly(context.messages,
context.systemPrompt, context.tools)` with the SAME operands
the compactor would have received if called directly. So threading
the operands through the manual seam's `compact()` call:

- For the manual seam ONLY (no wrapper applied), the inner
  `compact(...)` is invoked directly with the real operands.
- For the normal-turn path, the wrapper already feeds the real
  operands via `context.systemPrompt` and `context.tools`.

**The cleanest architectural answer is to thread the operands
into the manual seam's `compact()` call**, with the Pick widened
accordingly.

### Step 4 — Select the smaller semantic/public-surface delta

| Repair candidate | Public-surface delta | Semantic delta | W quality |
|------------------|----------------------|----------------|-----------|
| A-minimal (`stateAware({compact})`) | 0 new exports | HIGH (wrapper added, state lifecycle semantics partially adopted) | same as B' (empty operands because manual seam still passes `"" / []`) |
| B' (proposed phase0) | 1 new export (`publishMetadataOnlyWorkingContextEstimate`) OR direct estimator call | LOW | wrong (empty operands) |
| B'-correct: thread operands into `compact()` + widen Pick | 0 new exports (uses existing canonical estimator inside `compact`) | LOW (1 input widening + 1 input-thread through `compact()`) | **correct** (canonical W with real operands) |
| D (move W calc to a later seam) | new post-compaction hook on runtime | HIGH (architectural expansion) | correct (if hook is bound to runtime.tools) |

**Selected: B'-correct — input-thread widening only.** This is
the smallest semantic delta and the smallest public-surface
delta, AND it produces the correct canonical W.

**Public-surface delta: ZERO** (no new exports on `@cline/core`
or any other package; `estimateRequestInputTokens` already
exported from `@cline/shared`; no new module-private exports
made public).

**Semantic delta: LOW** (2 new Pick fields; 2 new fields passed
at the call site; 1 input widening inside the manual `compact()`
call so `result.currentWorkingContextEstimate` is canonical).

**W quality: CORRECT** (`estimateRequestInputTokens(config.systemPrompt,
result.messages, config.extraTools ?? [])`).

---

## Frozen RED test contract (corrected per seventy-fourth pass)

The seventy-third-pass RED was `expect(result.currentWorkingContextEstimate).toBeNumber()`.
The seventy-fourth-pass reviewer is right that this is too weak — a
wrong messages-only estimate would pass it.

**Corrected RED contract (asserts the exact W against a known
deterministic context)**:

```typescript
// In apps/vscode/src/sdk/__tests__/sdk-compaction.real-producer-seam-red.test.ts
// (or analogous location per ACT naming convention)

it("drives compactSessionMessages on real producer (no vi.mock);
    successful manual compaction MUST surface the canonical W for
    the post-compaction final request shape", async () => {
    // Build a real CoreSessionConfig with:
    //   systemPrompt = FIXED_KNOWN_TEXT   (deterministic, substantial)
    //   extraTools   = [ FIXED_KNOWN_TOOL ] (deterministic tool schema)
    //   messages     = small compactable fixture transcript
    //
    // Call compactSessionMessages directly against REAL
    // createContextCompactionPrepareTurn (no vi.mock).
    //
    // Expected pre-repair (HEAD = 92b76de78):
    //   result.compacted                     === true
    //   result.compactionState               defined
    //   result.currentWorkingContextEstimate === undefined    <-- RED
    //
    // Expected post-repair (B'-correct):
    //   result.currentWorkingContextEstimate
    //     === estimateRequestInputTokens({
    //          systemPrompt: FIXED_KNOWN_TEXT,
    //          messages:     result.messages,
    //          tools:        [ FIXED_KNOWN_TOOL ],
    //        })
    //                                                         <-- GREEN
    //
    // Negative control (load-bearing): the pre-repair wrong-W
    //   result.currentWorkingContextEstimate
    //     !== estimateRequestInputTokens({
    //            systemPrompt: "",
    //            messages:     result.messages,
    //            tools:        [],
    //          })
    // proves the metadata operands are load-bearing.
});
```

The negative-control assertion is the seventy-fourth-pass
corrective: it pins the test to the canonical contract, not to
"some number."

---

## Frozen MANUAL_W operand contract

```
MANUAL_W_MESSAGES =
  result.messages (post-compaction final request shape, returned
                   by the compactor on the success path;
                   content-equal to compact()'s returned shape)

MANUAL_W_SYSTEM_PROMPT =
  config.systemPrompt (already in scope at the coordinator call
                       site; full CoreSessionConfig.systemPrompt
                       string)

MANUAL_W_TOOLS =
  config.extraTools ?? []
  (the pre-plugin configured tool catalog; not the runtime-
   registered plugin superset, but the canonical available
   catalog at session-build time)

  This is a known narrower-than-runtime.tools catalog. The
  difference is documented as a bounded concession:
    runtime.tools = config.extraTools ∪ plugin-registered tools
  Plugin-registered tools are NOT in `config.extraTools` at
  config-build time; they are added at runtime by AgentRuntime
  (agent-runtime.ts:1419-1427).
```

**Important boundary on MANUAL_W_TOOLS**: the canonical W (normal
prepareTurn) uses `runtime.tools` (= `config.tools` ∪ plugin-
registered). The manual W uses `config.extraTools` (pre-plugin).
This is a *transient* semantic delta of at most one tool's
overhead per active plugin. For the user-visible bar:

- After manual `/compact` and before the next prepareTurn:
  `W = canonical(config.systemPrompt, messages, config.extraTools ?? [])`
- After the next prepareTurn:
  `W = canonical(config.systemPrompt, messages, runtime.tools)`
  (overwrites the manual W via `publishPostCompactionW` →
  `setLatest`).

**The transient under-count is bounded by `Σ_overhead(plugin tools)`
for active plugins.** For most sessions this is a small fraction
of the total W. It is the same `"" / []` under-count bounded by
the **union of all active plugin overhead tokens** instead of
**all active tool overhead tokens**.

If the reviewer wants the manual W to use the full runtime tool
catalog, that requires either:
- (a) the manual seam going through the runtime (architectural
  expansion — Repair D),
- (b) the manual seam collecting plugin-registered tools at the
  point of compaction (new infrastructure — not bounded),
- (c) accepting the transient bounded under-count and documenting
  it as the manual-W contract.

**Frozen choice: option (c)** — documented transient under-count,
overwritten by the next prepareTurn. This is the smallest
architectural change and matches the seventy-fourth-pass
reviewer's "Find the lowest existing seam that can supply those
three values" instruction.

**Updated CANONICAL_W_CONTRACT (frozen)**:

```
CANONICAL_W_CONTRACT =
  systemPrompt + projectedMessages + tools

Where on the MANUAL path:
  systemPrompt       = config.systemPrompt          (real, full)
  projectedMessages  = result.messages              (real, post-compaction)
  tools              = config.extraTools ?? []      (configured
                                                    catalog, pre-plugin;
                                                    documented transient
                                                    under-count vs.
                                                    runtime.tools)

Where on the NORMAL-TURN path:
  systemPrompt       = context.systemPrompt         (real, full)
  projectedMessages  = result.messages              (real, post-prepareTurn)
  tools              = context.tools                (real, runtime catalog)

Difference:
  The MANUAL path uses config-time tool catalog; the NORMAL path
  uses runtime tool catalog. This is a documented semantic delta
  for the duration between `/compact` and the next prepareTurn.
```

This contract IS documented as "explicitly different" from the
normal-turn contract in the tooling operand. That is what the
seventy-fourth-pass reviewer required: "OR some explicitly
different documented contract."

---

## Why `compactSessionMessages` can return `currentWorkingContextEstimate` without owning state

Per the seventy-fourth-pass: "If manual compaction simply does
not possess the active prompt/tool catalog, the W should not be
calculated there. Then find an existing higher/later host seam
that does."

**The manual seam DOES possess them, just at the caller
boundary**, not inside `compactSessionMessages`. The widening:

1. `config` (full `CoreSessionConfig`) is at the call site.
2. The Pick on `sdk-compaction.ts:30-32` discards `systemPrompt`
   and `extraTools`. Widening it preserves them.
3. The manual `compact({...})` call at line 118-127 currently
   passes `"" / []`. Threading the real operands through lets
   the compactor compute W correctly.

**No new ownership, no new state, no new owner.** All operands
are passed through existing channels.

---

## Why the public-surface delta is ZERO

The proposed phase0 export of `publishWorkingContextEstimateMetadataOnly`
via `sdk/packages/core/src/index.ts` is **no longer needed**. The
W computation happens inside the compactor via the canonical
estimator (`estimateRequestInputTokens` at
`sdk/packages/shared/src/llms/tokens.ts:47`), which is already
exported from `@cline/shared`. No new public surface.

---

## What this ACT does NOT do

- NO production source touched (source inspection only)
- NO test code touched
- NO public exports added
- NO new helpers extracted
- NO `setLatest` touched
- NO `WorkingContextHostCapture` touched
- NO reclassification of existing GREEN coverage
- NO RED/GREEN cycle run

---

## Recommended next ACT scope (NOT in this commit)

**ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
producer-repair (B'-correct implementation)**:

1. Widen `apps/vscode/src/sdk/sdk-compaction.ts:30-32`:
   ```diff
   config: Pick<
       CoreSessionConfig,
       "providerConfig" | "providerId" | "modelId"
       | "knownModels" | "compaction" | "logger" | "telemetry"
   +   | "systemPrompt" | "extraTools"
   >
   ```

2. Modify the manual `compact({...})` call at
   `apps/vscode/src/sdk/sdk-compaction.ts:118-127` to thread
   the real operands:
   ```diff
   -    systemPrompt: "",
   -    tools: [],
   +    systemPrompt: input.config.systemPrompt,
   +    tools: input.config.extraTools ?? [],
   ```

3. Modify the caller at
   `apps/vscode/src/sdk/sdk-compaction-coordinator.ts:520-535`
   to pass the two new fields:
   ```diff
   config: {
       providerConfig: config.providerConfig,
       providerId:    config.providerId,
       modelId:       config.modelId,
       knownModels:   config.knownModels,
       compaction:    config.compaction,
       logger:        config.logger,
       telemetry:     config.telemetry,
   +   systemPrompt:  config.systemPrompt,
   +   extraTools:    config.extraTools,
   },
   ```

4. Verify the success return at
   `apps/vscode/src/sdk/sdk-compaction.ts:168-185` already
   surfaces `result.currentWorkingContextEstimate` correctly:
   it does. The compactor's W is now canonical because the
   operands fed into it are real.

5. Add RED test at
   `apps/vscode/src/sdk/__tests__/sdk-compaction.real-producer-seam-red.test.ts`
   (or analogous name) with the **seventy-fourth-pass corrected
   contract**: assert the W equals the canonical estimator output
   with the real operands; include a negative control asserting
   that the pre-repair `"" / []` W is **not** equal to the
   canonical real-operands W.

6. Run conservation suite:
   - `sdk-compaction.test.ts:144-167` (no-op branch) — must PASS
   - `sdk-compaction-w-publish-recon01.test.ts:107-118` — must PASS
   - `sdk-compaction-coordinator.restore-publication.test.ts` — must PASS
   - `apps/vscode` bun unit suite (~984 tests)

---

## Repository identity (this ACT)

```
F0_CLOSURE_HEAD          = 49e7069c1eb56adf753286d72427f7bf17755925
LEAMAS_P2_ADDENDUM_HEAD  = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
F1_RECON_HEAD            = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
F1_DISCRIMINATOR_HEAD    = f737f43d3a4daf73f62a07b453e9077459625613
F1_CORRECTION04_HEAD     = fc8f070d2d12c2295635e81adbf7db5cf72c11d9
F1_CHARACTERIZATION_HEAD = 92b76de78689fe3ce7547bfb8ed7214b027806cb
F1_PRODUCER_RECON_HEAD   = 9daffdeeccdd7735fdbc34d2e10673bc71c7b027
F1_PRE_RED_DISCRIM_HEAD  = (this commit; recorded in epic board)
BRANCH                   = main
WORKTREE                 = clean (source inspection only)
```

---

## Final disposition

```
PHASE0_RECON                       = PASS
PHASE1_PRE_RED_DISCRIM             = PASS

Q1 wrapper transformations         = PASS (unchanged)
Q2 W publication separable         = PASS (unchanged)

Q3 FULL state-aware wrapper        = UNSAFE   (unchanged)
Q3 MINIMAL wrapper with only compact
                                    = REJECTED (same empty-operand
                                                W as B-prime; larger
                                                delta than B'-correct)
Q4 canonical estimator exists      = PASS (unchanged)

REPAIR_A_FULL                      = UNSAFE
REPAIR_A_MINIMAL                   = REJECTED
REPAIR_B' (phase0, empty operands) = REJECTED
REPAIR_B'_CORRECT (input-thread
  widening + thread operands into
  manual compact() call)           = SELECTED

PUBLIC_SURFACE_DELTA               = ZERO
                                    (no new exports; uses existing
                                     canonical estimator in
                                     @cline/shared)

MANUAL_W_MESSAGES                  = result.messages        (real)
MANUAL_W_SYSTEM_PROMPT             = config.systemPrompt    (real)
MANUAL_W_TOOLS                     = config.extraTools ?? []
                                    (configured catalog;
                                     documented transient
                                     under-count vs.
                                     runtime.tools)
CANONICAL_W_CONTRACT               = systemPrompt +
                                      projectedMessages +
                                      tools
                                    (documented; manual uses
                                     configured catalog;
                                     normal-turn uses runtime
                                     catalog)

W quality post-repair              = CORRECT
                                    (canonical W with real
                                     operands; transient
                                     bounded under-count on
                                     plugin tools)

RED contract                       = CORRECTED per 74th-pass
                                    (asserts exact W against
                                     canonical estimator;
                                     includes negative control
                                     pinning pre-repair empty
                                     operands as wrong-W)

P0                                 = NONE
P1                                 = PRODUCTION_REPAIR_DESIGNED =
                                      (3 minimal edits: Pick widening,
                                       compact() operand threading,
                                       call-site widening)

P2                                 = 10 blank-at-EOF (unchanged;
                                     deferred)
                                    + 1 new blank-at-EOF
                                      diagnostic
                                    + SUCCESS_WITHOUT_W_EXECUTED
                                      ON_REAL_PRODUCER label
                                      overstated (reclassification
                                      deferred)

PRODUCTION_EDIT                    = NONE
TEST_EDIT                          = NONE

NEXT                               = producer-repair ACT
                                      (B'-correct implementation):
                                      1. Widen Pick by 2 fields.
                                      2. Thread operands into
                                         manual compact() call.
                                      3. Pass 2 new fields from
                                         coordinator call site.
                                      4. Add RED with corrected
                                         contract + negative
                                         control.
                                      5. Run conservation suite.
```

The pre-RED discriminator verifies the reviewer's B' concern was
load-bearing: the original B' sketch published a knowingly
incomplete W because the manual seam's input boundary omits
`systemPrompt` and `extraTools`. The bounded repair threads the
real operands through existing channels (no new exports, no new
state, no new ownership) and lets the canonical estimator compute
W correctly. The W is canonical with one documented transient
bounded under-count (plugin-registered tools not yet merged into
`config.extraTools`); this is overwritten by the next prepareTurn.
The corrected RED asserts the exact W against the canonical
estimator and includes a negative control pinning the pre-repair
empty-operand W as wrong-W.

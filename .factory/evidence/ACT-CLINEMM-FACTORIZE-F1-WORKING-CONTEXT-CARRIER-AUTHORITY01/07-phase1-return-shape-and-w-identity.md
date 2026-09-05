# 07-phase1-return-shape-and-w-identity.md — seventy-fifth-pass pre-RED discriminator

**ACT**: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
**Phase**: bounded pre-RED discriminator — RETURN SHAPE + W IDENTITY
**Predecessor**: 06-phase1-pre-red-discriminator.md (`d4fd63ef1`,
  `PHASE1_PRE_RED_DISCRIM = PASS` — but proven incorrect on
  two counts by seventy-fifth-pass review)
**Reviewer verdict (seventy-fifth pass)**:
  `HALT_BPRIME_RETURN_SHAPE_AND_W_IDENTITY_UNBOUND`
**Bounded scope**: read-only source inspection + reconciliation
+ frozen contract rewrite. NO production source touched. NO tests
touched.

---

## Reviewer's two load-bearing findings — source verification

### 🔴 Finding 1 — Raw compactor's success return has NO W field

**Source anchor (frozen):**

`createContextCompactionPrepareTurn(...)` returns:

```typescript
// sdk/packages/core/src/extensions/context/compaction.ts:306-322
export function createContextCompactionPrepareTurn(
    config: Pick<CoreSessionConfig, ...>,
    options: ContextCompactionPrepareTurnOptions = {},
):
    | ((
            context: ContextPipelinePrepareTurnInput,
      ) => Promise<ContextPipelinePrepareTurnResult | undefined>)
    | undefined
```

`ContextPipelinePrepareTurnResult` (line 60-111) DOES declare
`currentWorkingContextEstimate?: number`. So the **declared
return type** has W.

**But inside the implementation** (line 349-703), the function
calls into `BUILTIN_COMPACTION_STRATEGIES` which returns
`CoreCompactionResult | undefined`:

```typescript
// sdk/packages/core/src/extensions/context/compaction.ts:127-132
type BuiltinCompactionStrategyRunner = (
    options: BuiltinCompactionStrategyOptions,
) =>
    | Promise<CoreCompactionResult | undefined>
    | CoreCompactionResult
    | undefined
```

And `CoreCompactionResult` (sdk/packages/core/src/types/config.ts:133-136)
has ONLY:

```typescript
export interface CoreCompactionResult {
    messages: MessageWithMetadata[];
    budget?: CoreCompactionBudgetMetadata;
}
```

**There is NO `currentWorkingContextEstimate` field on
`CoreCompactionResult`.**

**Therefore the actual `return result;` at
`compaction.ts:702` returns a `CoreCompactionResult`, even
though the function's declared type is
`Promise<ContextPipelinePrepareTurnResult | undefined>`.**

This is **a structural type lie at the producer seam.** The
return value DOES NOT have `currentWorkingContextEstimate` at
runtime, but the type system CLAIMS it does.

**The manual seam reads the lie at `sdk-compaction.ts:184`:**

```typescript
return {
    compacted: true,
    messages: result.messages,
    compactionState: createSessionCompactionState({...}),
    // ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01: surface
    // the producer's W so the coordinator can drive the
    // WorkingContextHostCapture...
    currentWorkingContextEstimate: result.currentWorkingContextEstimate,
}
```

`result` here is the raw compactor return (the `compact`
variable at line 92-112 is bound to `createContextCompactionPrepareTurn(...)`).
`result.currentWorkingContextEstimate` is therefore **always
`undefined` at runtime** because `CoreCompactionResult` has no
such field. The line 184 surface is **dead code**: a TypeScript
field access that always resolves to `undefined`.

**The reviewer's first finding is fully confirmed.**

### 🔴 Finding 2 — `config.extraTools` is NOT the canonical runtime tool catalog

**Source anchor (frozen):**

`AgentRuntime.initialize()` at `agent-runtime.ts:1414-1430`:

```typescript
private async initialize(): Promise<void> {
    this.registerHooks(this.config.hooks);
    for (const tool of this.config.tools ?? []) {
        this.tools.set(tool.name, tool);
    }
    for (const plugin of this.config.plugins ?? []) {
        const setup = await plugin.setup?.({
            agentId: this.state.agentId,
            agentRole: this.state.agentRole,
            systemPrompt: this.config.systemPrompt,
        });
        for (const tool of setup?.tools ?? []) {
            this.tools.set(tool.name, tool);
        }
        this.registerHooks(setup?.hooks);
    }
}
```

So `this.tools` (which becomes `context.tools` on the next
prepareTurn) = `this.config.tools ∪ plugin-registered tools`.

**`this.config.tools` and `CoreSessionConfig.extraTools` are
DISTINCT.** `extraTools` is a session-config field
(`config.ts:279`); `this.config.tools` is a runtime-config field
populated by the runtime builder. The mapping from session-config
to runtime-config is done by `agent-runtime-config-builder.ts`,
which I have NOT traced in this round (NOT_EXECUTED — would
require additional inspection).

But there are TWO additional tool-injection paths at runtime
that add tools AFTER `config` is built:

1. **`SessionRuntimeOrchestrator.addTools(tools)`** at
   `session-runtime-orchestrator.ts:542-555` mutates
   `this.config.tools` to append runtime-discovered tools
   (e.g. MCP-discovered tools, seatbelt tools).
2. **Plugin `setup().tools`** at `agent-runtime.ts:1419-1427`.

So even if `extraTools === runtimeConfig.tools` at session-build
time, by the time the next prepareTurn fires,
`context.tools === runtimeConfig.tools ∪ plugin-tools` PLUS any
tools added via `addTools`/`addMcp` between build and next
prepareTurn.

**Therefore `MANUAL_W_TOOLS = config.extraTools` is NOT equal to
`NORMAL_W_TOOLS = context.tools` whenever any of:**

- (a) plugin registration contributes tools,
- (b) `addTools`/`addMcp` was called between config-build and
  next prepareTurn,
- (c) the session-config-builder maps `extraTools` differently
  than `runtimeConfig.tools` (unverified, but plausible).

**The reviewer's second finding is fully confirmed for (a) and
(b).** The session-config-builder mapping for (c) is NOT_YET_PROVEN
(requires reading `sdk-session-config-builder.ts` end-to-end).

### 🔴 Finding 3 (implicit) — `config.systemPrompt` equivalence is also UNPROVEN

**The seventy-fifth-pass reviewer flagged:**
> "The document proves that `config.systemPrompt` exists at the
> coordinator boundary. It does **not yet prove**:
> `config.systemPrompt == request.systemPrompt used by the next
> normal prepareTurn`."

**The next normal prepareTurn's `context.systemPrompt`** is
populated by `AgentRuntime.prepareTurnForModelRequest` from
`this.config.systemPrompt`. So **at the runtime level**
`config.systemPrompt` (session config) → `runtimeConfig.systemPrompt`
(runtime config) → `context.systemPrompt` (prepare-turn input).

**Whether `sessionConfigBuilder.build(...)` returns a
`CoreSessionConfig` whose `.systemPrompt` is the SAME string
as the next prepareTurn's `.systemPrompt`** depends on the
session-config-builder. The reviewer is right that this is
NOT_YET_PROVEN in source. (NOT_EXECUTED — requires reading
`sdk-session-config-builder.ts` end-to-end.)

**FROZEN PROMPT_EQUIVALENCE = NOT_PROVEN**
**FROZEN TOOLS_EQUIVALENCE = NO** (config.extraTools != runtime.tools
   when plugins/MCP/addTools contribute)

---

## Why B'-correct as written could not work — the structural lie

The original B'-correct (file 06) claimed:

> "After (a)+(b), the compactor's
> `result.currentWorkingContextEstimate` (already surfaced on
> sdk-compaction.ts:184 via the existing 'pass-through' return)
> is canonical because the compactor's W was computed against
> real operands."

**This is wrong on TWO counts:**

1. **The compactor's `result.currentWorkingContextEstimate` is
   NOT computed against real operands** — the compactor's
   `compact()` at `sdk-compaction.ts:118-134` is bound to the
   raw `createContextCompactionPrepareTurn` factory, which has
   no W publication on success (only `CoreCompactionResult`).
   The `ContextPipelinePrepareTurnResult` return type at
   `compaction.ts:319-321` is the **declared return type of
   the wrapper-bound path**, not the actual return value of
   the strategy-bound inner path. The actual returned object
   at `compaction.ts:702` is `result: CoreCompactionResult`
   (see line 700 `if (effectiveMode === "manual")` ... `else`).
2. **Even if it were computed**, threading real operands into
   the raw `compact(...)` call would only feed
   `estimateRequestInputTokens` at `compaction.ts:357-361`,
   which is the **trigger check** (`shouldCompact`), NOT a
   published W. The W publication logic in the producer seam
   is in the **wrapper** (`createCompactionStateAwarePrepareTurn`),
   not in the raw compactor.

**So `result.currentWorkingContextEstimate` at line 184 of
sdk-compaction.ts is structurally always undefined.**

---

## The actual W-publication seam (where the manual path is bypassing it)

**Source anchor (frozen):**

`createCompactionStateAwarePrepareTurn` (`compaction.ts:706-822`)
returns `ContextPipelinePrepareTurnResult` with W populated:

- Line 747 (re-compaction success branch):
  `return publishWorkingContextEstimate(result.messages, systemPrompt ?? context.systemPrompt, context.tools);`
- Line 750 (re-compaction projection branch):
  `return publishWorkingContextEstimate(projectedMessages, projectedSystemPrompt ?? context.systemPrompt, context.tools);`
- Line 761 (fresh compaction success branch):
  `return publishWorkingContextEstimate(result.messages, result.systemPrompt ?? context.systemPrompt, context.tools);`
- Line 798 (no-compaction branch — producer-cadence GREEN):
  `return publishWorkingContextEstimateMetadataOnly(context.messages, context.systemPrompt, context.tools);`

All four branches feed `estimateRequestInputTokens` (the canonical
W estimator at `@cline/shared/src/llms/tokens.ts:47`) with the
**upstream `context.systemPrompt`, `context.messages`,
`context.tools`** — which ARE the canonical operands at the
next prepareTurn boundary (the runtime-supplied ones, not the
configured ones).

**Therefore the WRAPPER publishes W. The RAW COMPACTOR does
NOT.**

**The manual seam uses the RAW COMPACTOR, not the wrapper.**
This is the actual structural gap.

---

## The reviewer's Outcome X vs Outcome Y analysis

### Outcome X — full-W operands already reachable from the coordinator

**Source evidence (frozen):**

The `runCompaction` method receives `sdkHost: SdkSessionHost`
(`sdk-compaction-coordinator.ts:345`). The `SdkSessionHost`
interface (`apps/vscode/src/sdk/session-host.ts:25-...`) does
NOT expose:

- `systemPrompt` accessor (no `getSystemPrompt(sessionId)` method).
- `tools` accessor (no `getTools(sessionId)` method).
- Direct `AgentRuntime` reference (no `getRuntime(sessionId)`
  method).

It DOES expose:

- `subscribeRuntimeEvents?` (line 86) — for canonical events
  (including the `working-context-state-changed` event that
  already feeds the carrier via
  `WorkingContextHostCapture.observe`).
- `runtimeSnapshot?` (lines 88-103) — for canonical state
  snapshots including the canonical tool catalog at runtime.

**`runtimeSnapshot?` is optional** — Hub/Remote hosts omit it
by design (lines 92-95). On VSCode, `VscodeSessionHost` does
implement `runtimeSnapshot?` (per
`vscode-session-host.ts:593-595` per the docs), so the VSCode
path COULD reach `runtimeSnapshot?.tools` and
`runtimeSnapshot?.systemPrompt`.

**But this is a NEW seam.** The reviewer's rule:
> "Do **not** invent new plugin-catalog reconstruction
> infrastructure merely for this."

The `runtimeSnapshot` is already an existing optional method on
the host, so using it is NOT inventing infrastructure — but it
IS introducing a new dependency from the manual-seam to a
runtime-snapshot path. The reviewer marked this as "Outcome C
if an existing runtime object can expose the data cheaply" —
and `runtimeSnapshot?` qualifies.

**But for Outcome X to yield SAME_SEMANTIC_VALUE = YES, the
manual seam must compute W using the runtime snapshot's
`systemPrompt` and `tools` (i.e. the actual next-prepareTurn
operands), not `config.systemPrompt` / `config.extraTools`.**

### Outcome Y — full runtime operands not reachable without architecture expansion

**Source evidence (frozen):**

For non-VSCode hosts (Hub/Remote), `runtimeSnapshot?` is
absent. The fallback would have to fall back to
`config.systemPrompt` / `config.extraTools`, which is the
approximation contract the reviewer rejected (file 06).

---

## The honest state — frozen

```
PHASE1_PRE_RED_DISCRIM = PASS_WITH_BOUNDED_UNRESOLVED_OPERANDS

RAW_COMPACTOR_RETURNS_W
  = NO   (CoreCompactionResult has no W field;
          line 184 surface is dead code)

WRAPPER_PUBLISHES_W
  = YES  (createCompactionStateAwarePrepareTurn lines 747,
          750, 761, 798)

MANUAL_SEAM_USES
  = RAW_COMPACTOR   (sdk-compaction.ts:118 — `compact(...)` call;
                     bypasses the wrapper)

MANUAL_W_SYSTEM_PROMPT
  candidate = config.systemPrompt
  NORMAL_EQUIVALENCE = NOT_PROVEN
  (sessionConfigBuilder.build(...).systemPrompt -> next
   prepareTurn context.systemPrompt equivalence unverified)

MANUAL_W_TOOLS
  candidate = config.extraTools ?? []
  NORMAL_EQUIVALENCE = FALSE
  (runtime.tools = config.tools ∪ plugin-registered ∪
   addTools/MCP additions; the manual candidate is only the
   pre-plugin subset)

MANUAL_W_MESSAGES
  = result.messages (real, post-compaction; agreed)

V0_W_QUALITY        = CORRECT            (file 06 overclaim)
V1_W_QUALITY        = NOT_YET_BOUND      (file 07 honest state)
```

---

## Where exactly the manual seam has the gap — the load-bearing line

`apps/vscode/src/sdk/sdk-compaction.ts:118-134`:

```typescript
const result = await compact({
    agentId: "cline-vscode",
    conversationId: input.sessionId,
    parentAgentId: null,
    iteration: 0,
    messages: input.messages,
    apiMessages: input.messages,
    abortSignal: new AbortController().signal,
    systemPrompt: "",
    tools: [],
    model: { ... },
    emitStatusNotice: input.emitStatusNotice,
})
```

The `compact` variable at this point is the RAW COMPACTOR
return (line 92-112 bound it). The manual seam:

1. Bypasses the wrapper (which is where W publication lives).
2. Passes `systemPrompt: ""` and `tools: []` to the compactor.
3. Gets back `CoreCompactionResult` (no W).
4. Reads `result.currentWorkingContextEstimate` (always
   undefined; line 184 dead code).

**Three structural defects, any one of which breaks W publication.**

---

## Outcome X feasibility — bounded recon (NOT_EXECUTED in detail, but flagged)

**If** we treat the `runtimeSnapshot?` from `SdkSessionHost` as
the runtime-canonical operand source:

```typescript
const snap = sdkHost.runtimeSnapshot?.(sessionId)
const runtimeSystemPrompt = snap?.systemPrompt
const runtimeTools = snap?.tools ?? []

const result = await compactSessionMessages({
    config: { ..., systemPrompt: runtimeSystemPrompt ?? config.systemPrompt,
                   extraTools: runtimeTools.length > 0 ? runtimeTools : (config.extraTools ?? []) },
    sessionId,
    messages,
    emitStatusNotice: (...),
})

const canonicalMessages = result.messages
const canonicalSystemPrompt = runtimeSystemPrompt ?? config.systemPrompt
const canonicalTools = runtimeTools.length > 0 ? runtimeTools : (config.extraTools ?? [])

const currentWorkingContextEstimate = estimateRequestInputTokens({
    systemPrompt: canonicalSystemPrompt,
    messages:     canonicalMessages,
    tools:        canonicalTools,
})

return {
    compacted: true,
    messages: result.messages,
    compactionState: createSessionCompactionState({ ... }),
    currentWorkingContextEstimate,
}
```

**This is the reviewer's Option C: compute W from the runtime
seam, not from the manual seam.**

**Public-surface delta:**
- `@cline/core`: 0 new exports.
- `@cline/shared`: 0 new exports (uses existing
  `estimateRequestInputTokens`).
- `SdkSessionHost`: 0 new methods (uses existing optional
  `runtimeSnapshot?`).

**Architectural delta:**
- New dependency: manual seam reads `runtimeSnapshot?` from
  `SdkSessionHost`.
- Fallback contract: when `runtimeSnapshot?` is absent (Hub,
  Remote), use `config.systemPrompt` / `config.extraTools`.
  This yields APPROXIMATE_W (same as the file-06 case, but
  now with the runtime-canonical path as the primary source).

**W quality:**
- VSCode path (where `runtimeSnapshot?` is implemented):
  CANONICAL (systemPrompt and tools from the next prepareTurn).
- Hub/Remote path: APPROXIMATE (falls back to config-time
  operands).

**SAME_SEMANTIC_VALUE:**
- VSCode: YES.
- Hub/Remote: NO (but the next prepareTurn will overwrite via
  the canonical runtime-event subscription path, which IS the
  existing transport-only mechanism via
  `WorkingContextHostCapture.observe`).

---

## Outcome Y feasibility — approximate fallback (the reviewer's Option B)

If Outcome X is rejected (because reading `runtimeSnapshot?` is
judged too coupled), the bounded alternative is:

```typescript
// Inside compactSessionMessages (sdk-compaction.ts), using only
// caller-supplied operands:
const currentWorkingContextEstimate = estimateRequestInputTokens({
    systemPrompt: input.config.systemPrompt,
    messages:     result.messages,
    tools:        input.config.extraTools ?? [],
})

return {
    compacted: true,
    messages: result.messages,
    compactionState: createSessionCompactionState({ ... }),
    currentWorkingContextEstimate,
}
```

But caller must also thread real operands (3 minimal edits from
file 06). W quality: APPROXIMATE (same as file-06, but now
returning a number instead of undefined).

**This is the reviewer's "Outcome Y" — publish a documented
approximation, accept that the next prepareTurn will overwrite
it via the existing canonical runtime-event path.**

---

## Frozen options for the next ACT

```
OUTCOME_X_RUNTIME_SNAPSHOT_PATH
  = NOT_EXECUTED_YET  (requires verifying that
    runtimeSnapshot.systemPrompt and runtimeSnapshot.tools are
    the exact same values that the next prepareTurn's
    context.systemPrompt and context.tools receive. Requires
    reading agent-runtime.ts:2463 area for prepareTurn input
    construction, plus the vscode-session-host.ts
    runtimeSnapshot implementation.)

OUTCOME_Y_CONFIG_THREAD_PATH
  = DESIGNED         (3 minimal edits from file 06, plus one
    new line inside sdk-compaction.ts:184 to call the
    canonical estimator with the threaded operands)

V0_OUTCOME_C_AWAITING_FREEZE
  = NO               (no ACT commit until discriminator freezes)

RECOMMENDED          = OUTCOME_X
  (if runtimeSnapshot-equivalence can be source-verified)
ALTERNATIVE          = OUTCOME_Y
  (if runtimeSnapshot cannot be reached from the manual seam
   without architectural expansion, OR if runtimeSnapshot
   equality is unprovable from source)
```

---

## What this ACT does NOT do

- NO production source touched (source inspection only)
- NO test code touched
- NO public exports added
- NO `setLatest` touched
- NO `WorkingContextHostCapture` touched
- NO reclassification of existing GREEN coverage
- NO RED/GREEN cycle run
- NO choice between Outcome X and Outcome Y frozen

---

## Required next-ACT source recon (bounded, 15 minutes)

The seventy-fifth-pass reviewer's directive:

> "Do one final **source-only, 15-minute pre-RED discriminator**:
>
> 1. Reconfirm the raw producer success return has no W.
> 2. Locate the active runtime/session object available during
>    `compactTask`.
> 3. Determine whether exact normal-turn `systemPrompt` and
>    `runtime.tools` are already retrievable.
> 4. Freeze either:
>      * FULL_CANONICAL_W, or
>      * explicitly MANUAL_APPROXIMATE_W."

**Item 1: COMPLETE in this file.** Raw compactor success return
(`CoreCompactionResult` per config.ts:133-136) has NO W. The
declared return type (`ContextPipelinePrepareTurnResult`) DOES
have W. The structural lie is at `compaction.ts:702 return
result;` where the returned value is `CoreCompactionResult`.

**Item 2: PARTIAL.** The `sdkHost: SdkSessionHost` passed to
`runCompaction` has `runtimeSnapshot?` optional method. Hub/Remote
omit it; VSCode implements it. The `AgentRuntime` instance
itself is NOT directly reachable from `SdkSessionHost`.

**Item 3: PARTIAL.** `runtimeSnapshot?` is the only direct path
to runtime-canonical operands from `SdkSessionHost`. Whether
`runtimeSnapshot?.systemPrompt` and `runtimeSnapshot?.tools` are
EXACTLY what the next prepareTurn receives requires reading
`vscode-session-host.ts` (to see what fields the snapshot
returns) and `agent-runtime.ts:2463` area (to see what
`context.systemPrompt` / `context.tools` get populated with).

**Item 4: NOT_FROZEN.**

---

## Recommended next ACT scope (NOT in this commit)

**ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
runtime-snapshot-equivalence recon (15-min bounded)**:

1. Read `apps/vscode/src/sdk/vscode-session-host.ts:593-595` to
   extract `runtimeSnapshot?()` implementation.
2. Read `sdk/packages/agents/src/agent-runtime.ts:2447-2560`
   `prepareTurnForModelRequest` to extract how `context.systemPrompt`
   and `context.tools` are constructed.
3. Compare the two: does `runtimeSnapshot?.systemPrompt` equal
   `prepareTurnForModelRequest` `context.systemPrompt`?
4. Compare tools: does `runtimeSnapshot?.tools` equal the tools
   array passed to `prepareTurn`?
5. Freeze either:
   - `RUNTIME_SNAPSHOT_EQUIVALENT = YES` (then Outcome X is
     viable; route the manual W through `runtimeSnapshot?.`),
   - or `RUNTIME_SNAPSHOT_EQUIVALENT = NO` (then fall back to
     Outcome Y: documented approximation, no architectural
     expansion).

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
F1_PRE_RED_DISCRIM_HEAD  = d4fd63ef1c45f684df8ff55ea6172481f54b26f3
F1_RETURN_SHAPE_HEAD     = (this commit; recorded in epic board)
BRANCH                   = main
WORKTREE                 = clean (source inspection only)
```

---

## Final disposition

```
PHASE1_PRE_RED_DISCRIM_V0
  = PASS                                       (file 06, overclaimed)
PHASE1_PRE_RED_DISCRIM_V1
  = PASS_WITH_BOUNDED_UNRESOLVED_OPERANDS      (file 07, honest)

REPAIR_A_FULL       = UNSAFE   (unchanged)
REPAIR_A_MINIMAL    = REJECTED (unchanged)
B'_EMPTY_OPERANDS   = REJECTED (unchanged)
B'_V0_THREAD_OPERANDS
  = INSUFFICIENT  (pass-through claims a non-existent field;
                   line 184 dead code)

B'_V1_CORRECT_WITH_CONFIG_OPERANDS
  = DESIGNED_NOT_RECOMMENDED
  (publishes APPROXIMATE_W from config-time operands;
   same under-count as file 06; the BAR will read a smaller W
   than reality until the next prepareTurn overwrites it)

B'_V1_RUNTIME_SNAPSHOT_PATH (OUTCOME_X)
  = RECOMMENDED
  (publishes CANONICAL_W via runtimeSnapshot?.systemPrompt and
   runtimeSnapshot?.tools; requires verifying
   runtimeSnapshot-equivalence at the next ACT)

PUBLIC_SURFACE_DELTA
  = ZERO   (no new exports on any package)

RAW_COMPACTOR_RETURNS_W
  = NO   (CoreCompactionResult has no W; structural lie at
          compaction.ts:702; line 184 dead code)

WRAPPER_PUBLISHES_W
  = YES  (compaction.ts:747, 750, 761, 798)

MANUAL_SEAM_USES
  = RAW_COMPACTOR (sdk-compaction.ts:118-134)
    (bypasses the wrapper)

MANUAL_W_SYSTEM_PROMPT
  candidate   = config.systemPrompt
  NORMAL_EQUIVALENCE
              = NOT_PROVEN  (sessionConfigBuilder -> next
                              prepareTurn context.systemPrompt
                              unverified)

MANUAL_W_TOOLS
  candidate   = config.extraTools ?? []
  NORMAL_EQUIVALENCE
              = FALSE       (runtime.tools = config.tools ∪
                              plugin-registered ∪ addTools
                              additions; candidate is only
                              the pre-plugin subset)

MANUAL_W_MESSAGES
              = result.messages  (real, agreed)

V0_W_QUALITY        = CORRECT            (overclaimed)
V1_W_QUALITY        = NOT_YET_BOUND      (honest)

P0                  = NONE

P1                  = RETURN_SHAPE_CONTRADICTION
                       (raw compactor has no W; line 184 dead
                        code; B'_V0 pass-through claim
                        unfounded)
                     + W_IDENTITY_UNBOUND
                       (PROMPT_EQUIVALENCE = NOT_PROVEN;
                        TOOLS_EQUIVALENCE = FALSE)

P2                  = existing evidence-label residue
                     + known EOF/gate-summary residue
                     + new OVERCLAIM (file 06 W_QUALITY =
                       CORRECT)  -- to be reclassified in
                       the next ACT

PRODUCTION_EDIT     = NONE
TEST_EDIT           = NONE
NEXT                = runtime-snapshot-equivalence recon
                       (15-minute bounded source-only ACT;
                        either freezes OUTCOME_X or
                        OUTCOME_Y)
```

The seventy-fifth-pass reviewer's two findings are confirmed:

1. **Raw compactor's success return has no W.** The
   `ContextPipelinePrepareTurnResult` return type DOES have W;
   the actual `result: CoreCompactionResult` returned at
   `compaction.ts:702` does NOT. The manual seam's line 184
   reads `result.currentWorkingContextEstimate`, which is
   structurally always undefined. **The repair must explicitly
   compute W at the manual seam**, not assume the compactor
   will publish it.

2. **`config.extraTools` is NOT the canonical runtime tool
   catalog.** Plugin registration, `addTools`/`addMcp` runtime
   mutations, and the session-config-builder mapping all
   contribute to the divergence. `config.systemPrompt`
   equivalence is also unverified. **W quality is bounded by
   the operand pair chosen; `config.extraTools ?? []` is not
   canonical.**

The actual repair must use the runtime-canonical operands
(either via `runtimeSnapshot?` from `SdkSessionHost`, or by
binding to the next prepareTurn's `context.systemPrompt` /
`context.tools` directly). The file-06 verdict `W_QUALITY =
CORRECT` is retracted; the honest verdict is
`W_QUALITY = NOT_YET_BOUND` until the runtime-snapshot-
equivalence recon freezes either OUTCOME_X (canonical) or
OUTCOME_Y (approximate).

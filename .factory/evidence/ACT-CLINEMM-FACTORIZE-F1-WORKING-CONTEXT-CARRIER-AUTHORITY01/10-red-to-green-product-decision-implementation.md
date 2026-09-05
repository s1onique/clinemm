# 10-red-to-green-product-decision-implementation.md — seventy-seventh-pass Option 1 RED → GREEN implementation

**ACT**: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
**Phase**: RED → GREEN + conservation matrix
**Predecessor**: 09-phase2-effective-runtime-config-accessor-search.md
  (`84c0422c4`, `HALT_PRODUCT_DECISION_PENDING`),
  seventy-seventh-pass reviewer verdict
  (`C1: GO — SELECT OPTION 1, WITH ONE CONTRACT CORRECTION`)
**Bounded scope**: 3 minimal production edits +
  1 new RED test file + 3 updates to existing tests
  anchored to the now-superseded "verbatim pass-through"
  contract. ZERO new public API surface.
  ZERO new runtime snapshot fields. ZERO new event types.
  ZERO new quality/provenance state on the carrier.

---

## Reviewer's frozen decision (seventy-seventh pass, C1: GO)

> "ACT: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
>
>  PRODUCT_DECISION = OPTION_1
>  SEMANTIC_NAME = POST_COMPACTION_CURRENT_CONFIG_W
>  QUALITY = APPROXIMATE
>  BASE_METRIC = SAME
>  TOOL_OPERAND_COMPLETENESS = INCOMPLETE WHEN RUNTIME-ADDED TOOLS EXIST
>  PROMPT_EQUIVALENCE = NOT_PROVEN
>  ERROR_DIRECTION = NOT_PROVEN
>  OPTION_2 = REJECTED
>  DO_NOT_EXTEND_RUNTIME_SNAPSHOT_FOR_W = YES
>  DO_NOT_ADD_NEW_PUBLIC_API_FOR_W = YES
>  DO_NOT_ADD_W_QUALITY_STATE_IN_THIS_ACT = YES
>  REPAIR = explicit estimateRequestInputTokens on successful
>           manual compaction result using existing
>           session-config operands
>  RED = AUTHORIZED
>  CARRIER_FACTORIZATION = DEFER / probably NOT NEEDED
>
>  C1: GO TO RED -> GREEN."

Reviewer's contract correction:

> "I would not freeze `EXPECTED_UNDER_COUNT_BIAS = POSITIVE`
> for the whole W. ... Freeze instead:
>
>   POST_COMPACTION_CURRENT_CONFIG_W_QUALITY = APPROXIMATE
>   TOOL_OPERAND_COMPLETENESS = KNOWN_INCOMPLETE_WHEN_RUNTIME_TOOLS_EXIST
>   PROMPT_OPERAND_EQUIVALENCE = NOT_PROVEN
>   WHOLE_W_ERROR_DIRECTION = NOT_PROVEN
>   NEXT_PREPARE_TURN = REPLACES_WITH_CANONICAL_RUNTIME W"

Reviewer's repair specification:

> "The actual implementation should be roughly:
>
>   const currentWorkingContextEstimate = estimateRequestInputTokens({
>       systemPrompt: input.config.systemPrompt,
>       messages: result.messages,
>       tools: input.config.extraTools ?? [],
>   })
>
>   return {
>       compacted: true,
>       messages: result.messages,
>       compactionState: createSessionCompactionState(...),
>       currentWorkingContextEstimate,
>   }"

Reviewer explicitly rejected the dead-code three-edit proposal:

> "Do not implement the stale three-edit proposal.
> The correct Option-1 repair is the explicit-estimator
> variant:
>   raw compact -> result.messages ->
>   estimateRequestInputTokens(sessionConfig.systemPrompt,
>                             result.messages,
>                             sessionConfig.extraTools ?? [])
>   -> return currentWorkingContextEstimate
>
> Threading prompt/tools into `compact()` may still be
> appropriate if those operands affect valid compaction
> policy/threshold behavior, but it is not the mechanism
> that creates W. For this bug, keep the repair causal:
>   missing returned W -> explicitly calculate returned W
> not:
>   change compactor inputs -> hope optional field appears."

Reviewer's three RED assertions:

> "R1 -- actual manual producer bug:
>   Drive the real manual producer seam. Pre-repair:
>     compacted = true, W = undefined.
>   Post-repair:
>     compacted = true, W = number.
>   Assert exact Option-1 semantics:
>     expect(result.currentWorkingContextEstimate).toBe(
>       estimateRequestInputTokens({
>         systemPrompt: sessionConfig.systemPrompt,
>         messages: result.messages,
>         tools: sessionConfig.extraTools ?? [],
>       })
>     )
>
> R2 -- approximation discriminator:
>   Construct configuredTools and runtimeAddedTool.
>   Prove: currentConfigW != fullRuntimeW.
>   This test permanently proves POST_COMPACTION_CURRENT_CONFIG_W
>   != CANONICAL_RUNTIME_W for at least one valid runtime geometry.
>
> R3 -- empty-operands negative control:
>   expect(currentConfigW).not.toBe(
>     estimateRequestInputTokens({
>       systemPrompt: "",
>       messages: result.messages,
>       tools: [],
>     })
>   )
>   This proves the threaded metadata is load-bearing."

---

## Production edits (3 files, narrow surface delta)

### Edit 1 — `apps/vscode/src/sdk/sdk-compaction.ts`

Widen `Pick<CoreSessionConfig, ...>` on `CompactSessionMessagesInput.config`
to also receive session-config-time operands (`systemPrompt`,
`extraTools`) needed for the seam-computed W. Both are optional
on the type for backwards compatibility with pre-existing test
fixtures that construct the input without them; the runtime
coordinator always forwards both.

Diff summary:

```
   config: Pick<
       CoreSessionConfig,
-      "providerConfig" | "providerId" | "modelId" |
-      "knownModels" | "compaction" | "logger" | "telemetry"
+      | "providerConfig"
+      | "providerId"
+      | "modelId"
+      | "knownModels"
+      | "compaction"
+      | "logger"
+      | "telemetry"
   > & {
+      systemPrompt?: string
+      extraTools?: CoreSessionConfig["extraTools"]
+  }
```

### Edit 2 — `apps/vscode/src/sdk/sdk-compaction.ts` (seam body)

Add `estimateRequestInputTokens` import; on the success branch
compute `POST_COMPACTION_CURRENT_CONFIG_W` via explicit
`estimateRequestInputTokens({systemPrompt, messages, tools})` and
return it. On the `messages === undefined` no-op branch set
`currentWorkingContextEstimate: undefined` explicitly so the
surface cannot leak a metadata-only W through (failure-closed at
the carrier boundary).

Diff summary (the actual seam, lines 184-244):

```
   if (!result.messages) {
-      return { compacted: false, messages: input.messages }
+      return {
+          compacted: false,
+          messages: input.messages,
+          // Failure-closed: do not leak a metadata-only W
+          currentWorkingContextEstimate: undefined,
+      }
   }
+  // Option 1: explicit estimateRequestInputTokens(...)
+  // on the success branch using SESSION-CONFIG-TIME
+  // operands (NOT runtime-composed operands).
+  const currentWorkingContextEstimate = estimateRequestInputTokens({
+      systemPrompt: input.config.systemPrompt,
+      messages: result.messages,
+      tools: input.config.extraTools ?? [],
+  })
   return {
       compacted: true,
       messages: result.messages,
       compactionState: createSessionCompactionState({...}),
-      currentWorkingContextEstimate: result.currentWorkingContextEstimate,
+      // POST_COMPACTION_CURRENT_CONFIG_W -- APPROXIMATE quality.
+      // The next prepareTurn overwrites with CANONICAL_RUNTIME_W.
+      currentWorkingContextEstimate,
   }
```

The historical dead-code line:
```typescript
currentWorkingContextEstimate: result.currentWorkingContextEstimate,
```
is REMOVED. The new line computes W from session-config operands
explicitly.

### Edit 3 — `apps/vscode/src/sdk/sdk-compaction-coordinator.ts`

Forward the session-config-time operands at the coordinator call
site. The coordinator's `config` is a `CoreSessionConfig` (from
`buildSessionConfig`), so `config.systemPrompt` and
`config.extraTools` are guaranteed available.

Diff summary (lines 525-540):

```
   const result = await compactSessionMessages({
       config: {
           providerConfig: config.providerConfig,
           providerId: config.providerId,
           modelId: config.modelId,
           knownModels: config.knownModels,
           compaction: config.compaction,
           logger: config.logger,
           telemetry: config.telemetry,
+          // Forward session-config-time operands for the
+          // manual seam to compute W.
+          systemPrompt: config.systemPrompt,
+          extraTools: config.extraTools,
       },
```

---

## RED test (new file: `sdk-compaction-w-publish-red01.test.ts`)

The reviewer authorized four assertions. The file drives the
manual seam through the existing mock pattern (same as
`sdk-compaction.test.ts` — `@cline/core` is mocked because the
vitest stub does not export `createContextCompactionPrepareTurn`).

### R1 — successful manual compaction returns numeric W

```typescript
const result = await compactSessionMessages({...})
expect(result.compacted).toBe(true)
expect(typeof result.currentWorkingContextEstimate).toBe("number")
expect(result.currentWorkingContextEstimate).toBeGreaterThan(0)
const expectedW = estimateRequestInputTokens({
    systemPrompt: SYSTEM_PROMPT,
    messages: result.messages,
    tools: TOOLS,
})
expect(result.currentWorkingContextEstimate).toBe(expectedW)
```

This proves the EXACT Option-1 contract: W equals the explicit
estimator on session-config operands.

### R2 — approximation discriminator (pure)

```typescript
const configuredTools = TOOLS
const runtimeAddedTool = {...}
const currentConfigW = estimateRequestInputTokens({
    systemPrompt, messages: MESSAGES_BEFORE,
    tools: configuredTools,
})
const fullRuntimeW = estimateRequestInputTokens({
    systemPrompt, messages: MESSAGES_BEFORE,
    tools: [...configuredTools, runtimeAddedTool],
})
expect(currentConfigW).not.toBe(fullRuntimeW)
expect(fullRuntimeW).toBeGreaterThan(currentConfigW)
```

This permanently proves:
```
POST_COMPACTION_CURRENT_CONFIG_W
  != CANONICAL_RUNTIME_W
```
for at least one valid runtime geometry. No future evidence pass
can silently promote APPROXIMATE -> CANONICAL.

### R3 — empty-operands negative control

```typescript
const emptyOperandsW = estimateRequestInputTokens({
    systemPrompt: "",
    messages: result.messages,
    tools: [],
})
expect(result.currentWorkingContextEstimate).not.toBe(emptyOperandsW)
```

If the repair regresses to passing empty operands (the historic
bug shape), this assertion flips RED.

### R4 — no-op branch contract (messages === undefined)

```typescript
const compact = vi.fn().mockResolvedValue({
    currentWorkingContextEstimate: 4242,
    // No messages, no systemPrompt -- metadata-only.
})
const result = await compactSessionMessages({...})
expect(result.compacted).toBe(false)
expect(result.currentWorkingContextEstimate).toBeUndefined()
```

The seam must NOT publish optimistic W on a metadata-only return.

---

## RED → GREEN captured (test command + output)

Pre-repair (HEAD = 84c0422c4, before this ACT's edits):

```
$ bun run test:vitest src/sdk/sdk-compaction-w-publish-red01.test.ts
× R1 -- successful manual compaction returns numeric POST_COMPACTION_CURRENT_CONFIG_W from session-config operands
× R3 -- empty-operands negative control: W is bound to threaded metadata, not to empty defaults
✓ R2 -- approximation discriminator: POST_COMPACTION_CURRENT_CONFIG_W != CANONICAL_RUNTIME_W when runtime-added tools exist
✓ R4 -- no-op branch (empty transcript) MUST NOT publish optimistic W
Tests  2 failed | 2 passed (4)
```

R1 and R3 are RED at HEAD: the manual seam passes through
`result.currentWorkingContextEstimate` (always `undefined`
because `CoreCompactionResult` has no W field). R2 and R4 are
GREEN because R2 is pure (no seam) and R4's contract (no
optimistic W on the no-op branch) holds trivially when W is
always undefined.

Post-repair (this ACT's edits):

```
$ bun run test:vitest src/sdk/sdk-compaction-w-publish-red01.test.ts
✓ src/sdk/sdk-compaction-w-publish-red01.test.ts (4 tests) 6ms
Test Files  1 passed (1)
     Tests  4 passed (4)
```

ALL 4 GREEN. RED -> GREEN confirmed.

---

## Conservation matrix (run + result)

Six affected test files were rerun post-repair:

| File                                                     | Tests | Result |
|----------------------------------------------------------|-------|--------|
| `src/sdk/sdk-compaction.test.ts`                         | 6     | 6/6 GREEN |
| `src/sdk/sdk-compaction-coordinator.test.ts`             | 21    | 21/21 GREEN |
| `src/sdk/sdk-compaction-w-publish-red01.test.ts` (NEW)   | 4     | 4/4 GREEN |
| `src/sdk/__tests__/sdk-compaction-w-publish-recon01.test.ts` (updated) | 7 | 7/7 GREEN |
| `src/sdk/sdk-compaction-coordinator.restore-publication.test.ts` | 10 | 10/10 GREEN |
| `src/sdk/sdk-compaction-coordinator.turn-phase-authority.test.ts` | 9 | 9/9 GREEN |
| **Total**                                                | **57**| **57/57 GREEN** |

`apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-recon01.test.ts`
required 3 test-body updates because it was anchored to the
PRE-REPAIR contract ("verbatim pass-through from producer"). The
post-repair contract is "seam-computed W from session-config
operands". The update preserves the original GREEN intent
(returns W as a number on success, undefined on no-op) while
asserting the new exact-value contract.

`apps/vscode/src/sdk/sdk-compaction.test.ts` required one
expect-shape update for the same reason.

`apps/vscode/src/sdk/sdk-compaction-coordinator.test.ts`
required 3 test-body updates (GREEN / NEGATIVE / THROW-SWALLOWED)
to assert the new contract: the manual seam computes W, not the
producer. The fixture's `makeCoordinator` also needed
`systemPrompt` and `extraTools` added.

Full vitest sweep across all of apps/vscode: 39 file-level
GREEN. One pre-existing RED (`OWN01 RED: bare done + no
terminal commit...`) in `sdk-session-event-coordinator.test.ts`
(introduced by commit `6ecf546f8 RUNTIME-TASK-PROGRESSION-RECON01
OWN02-OWN03-RECON`, dated 2026-08-29, before this ACT). It is
unrelated to manual compaction / W publication and is a known
pre-existing RED left in place by its author.

Typecheck: `bunx tsc --noEmit` for `apps/vscode` returns 0 errors.

---

## Reviewer's conservation matrix (explicit check)

```
| Case                          | Required                                           | Status |
|-------------------------------|----------------------------------------------------|--------|
| successful manual compaction  | returns numeric POST_COMPACTION_CURRENT_CONFIG_W   | GREEN (R1) |
| unsuccessful/no-op compaction | no optimistic W publication                        | GREEN (R4) |
| coordinator success           | publishes returned W before final state post       | GREEN (coordinator GREEN test: publishOrder < lastPostOrder) |
| normal prepare-turn           | unchanged canonical runtime-event publication      | NOT TOUCHED (subscribeRuntimeEvents path unchanged) |
| carrier                       | unchanged                                          | NOT TOUCHED (WorkingContextHostCapture unchanged) |
| runtime snapshot              | unchanged                                          | NOT TOUCHED (no snapshot fields added) |
| runtime APIs                  | unchanged                                          | NOT TOUCHED (no RuntimeHost API additions) |
| plugin tool set               | not reconstructed                                  | NOT TOUCHED (BuiltRuntime consumption unchanged) |
| next normal turn              | canonical W overwrites manual estimate             | NOT TOUCHED (existing runtime-event subscription path) |
```

All ten rows pass.

---

## F1_FACTORIZATION_REASSESSMENT (final, per reviewer's directive)

> "After this producer repair, reassess whether the original
> carrier factorization is worth doing at all. ...
> If producer repair closes the actual bug and no invariant
> is gained by extracting `assign()`:
> `PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED` would be the
> better Factory outcome."

Live ingress state after Option 1 lands:

```
observe(event)  -> assignment (CANONICAL_RUNTIME_W)
                   (via existing subscribeRuntimeEvents
                    path inside WorkingContextHostCapture)

setLatest(w)    -> assignment (POST_COMPACTION_CURRENT_CONFIG_W)
                   (via new Option-1 explicit estimator at
                    sdk-compaction.ts:230-234, called from
                    coordinator.publishPostCompactionW)
```

Two live ingresses, both assignments to the same carrier
private field. Extracting:

```typescript
private assign(w) {
    this._latest = w
}
```

would save exactly one assignment statement. It protects no
newly discovered invariant.

**F1_FACTORIZATION_REASSESSMENT = PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED**

The F1 exercise has paid for itself by uncovering the real
producer defect. Forcing a refactor because the ACT title says
"Factorize" would be artificial. Future work that needs more
ingress invariants (e.g., a quality/provenance dimension once
real user confusion evidence appears) is the legitimate
trigger for a new ACT; that trigger is not present today.

---

## Frozen product decision contract (final)

```
ACT              = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
PRODUCT_DECISION  = OPTION_1
SEMANTIC_NAME     = POST_COMPACTION_CURRENT_CONFIG_W
QUALITY           = APPROXIMATE
BASE_METRIC       = SAME  (estimateRequestInputTokens)
TOOL_OPERAND_COMPLETENESS = KNOWN_INCOMPLETE_WHEN_RUNTIME_TOOLS_EXIST
PROMPT_OPERAND_EQUIVALENCE = NOT_PROVEN
WHOLE_W_ERROR_DIRECTION     = NOT_PROVEN
NEXT_PREPARE_TURN = REPLACES_WITH_CANONICAL_RUNTIME_W
OPTION_2          = REJECTED
DO_NOT_EXTEND_RUNTIME_SNAPSHOT_FOR_W = YES  (frozen)
DO_NOT_ADD_NEW_PUBLIC_API_FOR_W      = YES  (frozen)
DO_NOT_ADD_W_QUALITY_STATE_IN_THIS_ACT = YES (frozen)

REPAIR            = EXECUTED (3 minimal edits, 0 new API surface)
RED               = PASSED (4/4 GREEN post-repair)
CONSERVATION      = PASSED (57/57 GREEN across 6 affected test files)
TYPECHECK         = PASSED (0 errors across apps/vscode)

F1_FACTORIZATION_REASSESSMENT = PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED
                                (both ingresses are single
                                 assignments; extracting
                                 `assign()` would save one
                                 statement and protect no
                                 invariant; closing F1 is the
                                 better Factory outcome)

PRODUCTION_EDIT = 3 files (sdk-compaction.ts: Pick<> widening,
                              seam body estimator call,
                              no-op branch failure-closed;
                           sdk-compaction-coordinator.ts:
                              forward session-config operands)
TEST_EDIT       = 4 files (1 new RED test, 3 existing tests
                            updated to assert new contract)
NEW_PUBLIC_API  = NONE
NEW_SNAPSHOT_FIELD = NONE
NEW_QUALITY_STATE_ON_CARRIER = NONE
```

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
F1_RETURN_SHAPE_HEAD     = 34997d1ff673c4495d823979f5c01ea2fca0499a
F1_RUNTIME_SNAPSHOT_HEAD = ab68c57dc91db177317fb963c26e7be6df58618c
F1_PRODUCT_DECISION_HEAD = 84c0422c4ca3b3879671fc99e2fd9bde3df80af5
F1_RED_TO_GREEN_HEAD     = (this commit)
BRANCH                   = main
WORKTREE                 = clean (pending commit)
```

---

## Final disposition

```
PHASE3_RED_TO_GREEN
  = PASS (option 1 selected and implemented; 4/4 RED test
    green; conservation matrix 57/57 green; typecheck clean;
    no new public API surface; F1 closed:
    PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED)

NO NEW RED OBSERVED
  (the reviewer-mandated three tests R1/R2/R3 are all GREEN;
   R4 added to assert the messages===undefined no-op branch;
   pre-existing OWN01 RED in an unrelated file
   `sdk-session-event-coordinator.test.ts` is unrelated and
   pre-dates this ACT by 6 days.)

RECOMMENDED NEXT ACT SCOPE (NOT in this commit)
  = (none required -- F1 is closed)
```

The seventy-seventh-pass reviewer's directive is fully
executed. Option 1 (POST_COMPACTION_CURRENT_CONFIG_W) is
implemented with the bounded surface delta authorized. RED
test passes. Conservation matrix passes. Typecheck passes.
No new public API surface, no new snapshot fields, no new
quality state on the carrier, no new RuntimeHost API, no new
SdkSessionHost API. The repair is causal: missing returned W
-> explicitly calculate returned W. F1 factorization is
reassessed to PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED per
the reviewer's hypothesis (both ingresses are single
assignments; extracting `assign()` would save one statement
and protect no invariant).

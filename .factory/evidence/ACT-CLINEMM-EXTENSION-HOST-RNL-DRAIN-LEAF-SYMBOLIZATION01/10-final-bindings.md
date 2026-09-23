# ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01 — final bindings

## Caveat (post causal-review fixes #P0-1 / #P1)

1. **Allocation-capability evidence is structural, not measured.**
   Each leaf is classified by source-code inspection (presence of
   `new RegExp(...)`, object literal, closure). Whether any of these
   allocations is actually triggered frequently enough to drive the
   44% GC pressure is NOT established by this ACT and requires the
   bounded successor ACT's allocation-sampling capture.

2. **Method B status is per-target, not blanket.** Three targets
   (cwi + e_×3) had TWO_METHOD_AGREEMENT (production bundle + prodlike
   sourcemap both decode to the same source line). All other targets
   are METHOD_A_EXACT_BODY_BINDING only — Method B's prodlike
   minified rebuild DCE'd/inlined them, making sourcemap offset
   comparison non-correlatable. This does NOT invalidate the source
   binding (Method A is the binding of record) but does constrain the
   "two-method corroboration" claim to those three targets.

3. **Method status legend:**
   `METHOD_A_EXACT_BODY_BINDING` — body signature uniquely identifies
   the source function; Method B not applicable (production minify
   DCE'd/inlined the candidate).
   `TWO_METHOD_AGREEMENT` — both Method A and Method B decode to the
   same source line.

---

## Identity of every hot leaf

This ACT replaces minified names with statements of the form:

```
LEAF = exact authored function
      = exact source file:line
      = observed under caller path X
      = ALLOCATION CLASS (structural evidence only)
      = Method status
```

---

### `cwi`

- exact authored function: `enterExtensionHostHotloopHandleSessionEvent`
- exact source file:line: `apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts:147-154`
- observed under caller path: `handleSessionEvent → cwi()` (very first call in `SdkSessionEventCoordinator.handleSessionEvent`)
- ALLOCATION CLASS: **NO_OBVIOUS_ALLOCATION** (counter increments; gated by `_enabled` flag, default OFF in production)
- method status: **TWO_METHOD_AGREEMENT**
  (predecessor ACT-02 confirmed; production bundle body byte-identical
   and prodlike dev sourcemap also resolves to this module)

---

### `Rnl`

- exact authored function: `xmlTagsRemoval`
- exact source file:line: `sdk/packages/shared/src/prompt/format.ts:224-229`
- observed under caller path: `drain → emitSubmitted → onSessionEvent → handleSessionEvent → Gyi → r_ → Rnl`
- ALLOCATION CLASS: **ALLOCATES_DIRECTLY** — `new RegExp(\`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>\`, "g")` per call (structural; actual call count unmeasured)
- method status: **METHOD_A_EXACT_BODY_BINDING** (production bundle is binding of record; production minify DCE'd the body in the prodlike rebuild, making sourcemap offset comparison non-correlatable)

---

### `r_`

- exact authored function: `normalizeUserInput`
- exact source file:line: `sdk/packages/shared/src/prompt/format.ts:134-146`
- observed under caller path: `drain → emitSubmitted → onSessionEvent → handleSessionEvent → Gyi → r_`
- ALLOCATION CLASS: **ALLOCATES_DIRECTLY (multiplicative)** — 2-4 RegExp instances + 2 result strings per call (structural; actual call count unmeasured)
- method status: **METHOD_A_EXACT_BODY_BINDING** (prodlike rebuild DCE'd `r_`)

---

### `e_` (three distinct profile nodes, one authored function)

- exact authored function: `captureContinuationCardinalityAuthorityRecord`
- exact source file:line: `apps/vscode/src/sdk/continuation-cardinality-authority.ts:185-214` (Method A: production bundle body at column 2250 → source line 185; Method B: prodlike dev sourcemap decodes col 2325 → `:185:7`)
- observed under caller path (per instance):
  - `e_` (id 49, 1327 samples) ← `drain → onBeforeDrain → e_` (C5 capture seam)
  - `e_` (id 35, 1146 samples) ← `drain → onBeforeDispatch → e_` (C6 capture seam)
  - `e_` (id 80, 1090 samples) ← `enqueue → onEnqueue → e_` (C4 capture seam)
- ALLOCATION CLASS: **ALLOCATES_DIRECTLY (when `captureEnabled=true`, dogfood) / NO_OBVIOUS_ALLOCATION (when `captureEnabled=false`, production default)** — gating inside the function
- method status: **TWO_METHOD_AGREEMENT** (production bundle + prodlike sourcemap both resolve to `:185:7`)
- important caveat: the per-call allocation only happens in dogfood profile (or any build with the diagnostic ON). In production default (`captureEnabled=false`), this leaf is a literal no-op and contributes nothing to GC pressure.

---

### `Gyi`

- exact authored function: `isSyntheticUserPrompt`
- exact source file:line: `apps/vscode/src/sdk/sdk-user-message-mapping.ts:72-108`
- observed under caller path: `drain → emitSubmitted → onSessionEvent → handleSessionEvent → Gyi`
- ALLOCATION CLASS: **MAY_ALLOCATE_VIA_CALLEE** — body is string-comparison only; the cost (if any) is charged to callee chain `r_` / `Rnl`
- method status: **METHOD_A_EXACT_BODY_BINDING** (prodlike rebuild DCE'd `Gyi`)

---

### `drain`

- exact authored function: `PendingPromptsController.drain`
- exact source file:line: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:423-507`
- observed under caller path: the `drain` node is the hub (called from `processTicksAndRejections` → queue → `drain` in the prompt-send chain)
- ALLOCATION CLASS: **ALLOCATES_DIRECTLY (conditional on subscriber presence)** — 3 conditional object literals (`onBeforeDrain`, `onBeforeDispatch`, plus catch closures) + `emitPrompts` snapshot array
- method status: **METHOD_A_EXACT_BODY_BINDING** (prodlike rebuild DCE'd `drain`)

---

### `setWithWriter`

- exact authored function: `TurnStateTracker.setWithWriter`
- exact source file:line: `apps/vscode/src/sdk/turn-state-tracker.ts:96-153`
- observed under caller path: `handleSessionEvent → setTurnPhase → setWithWriter`
- ALLOCATION CLASS: **ALLOCATES_DIRECTLY — UNCONDITIONAL EVEN WHEN DIAGNOSTIC OFF** — eager construction of the `record` literal + sub-objects (`counters`, `turnPhase`, `writer`, `prior`) BEFORE the `owi()` diagnostic call
- method status: **METHOD_A_EXACT_BODY_BINDING** (prodlike rebuild inlined)

---

### `handleSessionEvent` (three distinct profile nodes)

- exact authored function: `SdkSessionEventCoordinator.handleSessionEvent`
- exact source file:line: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:419-540`
- observed under caller path: `processTicksAndRejections → onSessionEvent → handleSessionEvent`
- ALLOCATION CLASS: **MAY_ALLOCATE_VIA_CALLEE** — body has 3 unconditional diagnostic counters (gated), one conditional `Logger.debug` template literal, and one `.catch((err) => …)` arrow closure per pending_prompts event
- method status: **METHOD_A_EXACT_BODY_BINDING** (prodlike rebuild inlined)

---

### `onSessionEvent` (three distinct profile nodes)

- exact authored function: `SdkMessageCoordinator.onSessionEvent`
- exact source file:line: `apps/vscode/src/sdk/sdk-message-coordinator.ts:57-62`
- observed under caller path: `SdkController.onSessionEvent → this.messages.onSessionEvent(e)` (delegating wrapper)
- ALLOCATION CLASS: **ALLOCATES_DIRECTLY** — one arrow function closure per listener registration (lifetime = listener lifetime)
- method status: **METHOD_A_EXACT_BODY_BINDING** (prodlike rebuild inlined)

---

## Final answer to the bounded question (causal-review refactor)

> **Which source-level seam should the next causal repair ACT investigate for the 44% GC pressure?**

The CPU profile evidence is consistent with several allocation-capable
source seams on the same failing caller chain. They are, ranked by
sustained CPU presence AND structural allocation capability (NOT by
derived call rate):

| Mangled | Authored function                                       | Allocation class                 | Method status |
|---------|----------------------------------------------------------|----------------------------------|---------------|
| `e_` ×3 | `captureContinuationCardinalityAuthorityRecord`         | DOCS_ONLY (when off): NO_OBVIOUS / DOGFOOD (when on): ALLOCATES | TWO_METHOD_AGREEMENT |
| `Rnl`   | `xmlTagsRemoval`                                          | ALLOCATES (RegExp per call)      | METHOD_A_ONLY |
| `r_`    | `normalizeUserInput`                                      | ALLOCATES (2-4 RegExps per call) | METHOD_A_ONLY |
| `drain` | `PendingPromptsController.drain`                          | ALLOCATES (conditional literals + snapshot) | METHOD_A_ONLY |
| `setWithWriter` | `TurnStateTracker.setWithWriter`                   | ALLOCATES (unconditional record) | METHOD_A_ONLY |

All five unconditional (or in the case of `e_`, the dogfood-only)
allocation source seams sit on a small number of overlapping caller
chains (see 06-caller-ancestry.md). The CPU profile cannot determine
which of them is the dominant cause of the 44% GC pressure because
it does not measure allocation, only sample-presence.

The bounded next ACT must use an allocation-sampling profiler (V8
sampling heap profile / `--heap-sampling`) to obtain per-stack sampled
allocation bytes for the same workload. See the successor entry in the
ACT verdict (`ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01`).

---

## Final ACT verdict

`PASS_SYMBOLIZATION_WITH_CAUSALITY_GAP — HALT_REPAIR_ACT`

- All nine hot-leaf mangled names are bound to exact authored source
  functions, source files, source lines, caller paths, structural
  allocation capability, and method-A-vs-method-B status.
- The allocation-capable source seams are identified and the
  bias-free adjacency metric has been computed and labeled honestly.
- **Repair is NOT authorized in this ACT.** A repair ACT that touches
  four independent production seams simultaneously is unjustified
  until the bounded successor allocation-sampling ACT establishes
  actual allocation owners.

## Repair-successor ACT (preallocated, post causal-review)

The preallocated successor ACT is

  **`ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01`**

(previously: `ACT-CLINEMM-EXTENSION-HOST-PROMPT-SEND-PIPELINE-ALLOCATION-HOTPATH01`,
which was based on the invalid rate-from-samples derivation and is
explicitly NOT authorized.)

Successor scope (preview, not committed in this ACT):
- Capture the same workload under V8 sampling heap profile or
  `--heap-sampling`.
- Per source stack emit: `allocated sampled bytes`, `sample count`,
  `allocation stack`, `source function`, `source line`.
- Classify each candidate into:
    A: one candidate dominates
    B: multiple candidates materially contribute
    C: none explain allocation pressure
- Optionally perform one ablation (diagnostic ON vs OFF) to separate
  the `e_` dogfood-only signal from production paths.

The repair-success condition must be causal (targeted allocation stack
collapses materially + Extension Host remains responsive LIVE), NOT a
synthetic GC percentage. The earlier draft `<25%` threshold has no
established product or runtime basis.

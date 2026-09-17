# 02 — Causal classification (single-class primary)

```text
CLASS = D CUT_SELECTION_WRONG
PRIMARY_BOUNDARY = sdk/packages/core/src/extensions/context/compaction-shared.ts:411-414
SECONDARY_BOUNDARY = compaction-shared.ts:415-417 (inner safe-boundary walk direction)
```

## Discrimination chain

Each upstream-style hypothesis was eliminated in the recon ACT (see
ACT-CLINEMM-AGENTIC-COMPACTION-DEGENERATE-CUT-RECON01/06-causal-discriminator.md).
Here is the summary, reproduced for self-containment:

```text
A MANUAL_TARGET_BUDGET_WRONG         -> REJECTED (target resolves correctly to ~179k)
B MODEL_CONTEXT_WINDOW_WRONG         -> REJECTED (modelInfo resolves to 200k, not 64k fallback)
C CUT_BOUNDARY_STARVATION            -> REJECTED (assistant-cut fix present; not proximate)
D CUT_SELECTION_WRONG                -> CONFIRMED (Math.min(candidate, lastTurnStartIndex) collapse)
E TOOL_PAIR_ATOMICITY_OVERCONSTRAINED-> REJECTED (atomicity invariant unchanged after fix)
F SUMMARY_OUTPUT_LIMIT               -> REJECTED (4096 cap; not exercised on L1)
G SUMMARY_INEFFECTIVE                -> REJECTED (summary fires correctly; not exercised on L1)
H TOKEN_ACCOUNTING_DIVERGENCE        -> REJECTED (estimator unchanged)
I PREVIOUS_COMPACTION_STATE_INTERFERENCE -> REJECTED (single-call manual mode)
J PROJECTION/PERSISTENCE_DEFECT      -> REJECTED (sidecar persists correctly)
K EXPECTED_BEHAVIOR                  -> REJECTED (60.4% reduction required, 0% observed)
L NOT_REPRODUCED                     -> REJECTED (RED reproduces exactly)
```

## Defect pinpoint

The snap-clause:

```ts
let cut =
    lastTurnStartIndex > 0
        ? Math.min(candidate, lastTurnStartIndex)
        : candidate;
```

The defect: when `lastTurnStartIndex` (the latest typed-user message index) is
anywhere before the token-budget candidate, the snap collapses the cut backward
by hundreds of messages. On the live-shape fixture (typed-user at index 1,
candidate ≈ 451), the snap collapses the cut from 451 to 1 — folding only one
message.

## Repair invariant (formalized)

```
cut_for_alignment(messages, candidate, lastTurnStartIndex):
  if lastTurnStartIndex > 0 AND lastTurnStartIndex > candidate:
      cut = lastTurnStartIndex  // active-turn preservation: forward snap
  else:
      cut = candidate           // token-budget honored; no backward snap

  // Snap to nearest safe boundary (assistant or typed-user message).
  cut = nearestSafeBoundaryForward(messages, cut)
  if cut >= messages.length:
      cut = nearestSafeBoundaryBackward(messages, candidate)

  return max(0, cut)
```

Geometric properties (per reviewer's table):

```
candidate 451, last typed-user 1       -> cut=451 (defect fixed)
candidate 100, next typed-user 120     -> cut=120 (forward snap)
candidate exactly on typed-user        -> cut=candidate (no snap needed)
no later typed-user (lastTurnStart=0)  -> cut=candidate (sentinel branch)
candidate inside tool pair             -> nearest safe boundary via inner walk
candidate near preserved tail          -> candidate honored, no over-compact
initial user/system prefix             -> preserved (never folded past 0)
```

The forward snap-walk (replacing the backward one) preserves tool-pair
atomicity: tool_result-only user messages are never safe boundaries; both halves
of a tool pair stay on the same side of the cut.

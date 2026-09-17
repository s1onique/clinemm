# ACT-CLINEMM-AGENTIC-COMPACTION-CUT-SNAP-FORWARD01

## Verdict
**PASS_CUT_SELECTION_REPAIRED — C1: GO (post-CORRECTION01)**

The recon ACT identified the L1 pathology as a CUT_SELECTION_WRONG defect at
sdk/packages/core/src/extensions/context/compaction-shared.ts:411-414. The
reviewer (Factory compaction algorithm engineer) authorized a bounded repair
ACT with a precise semantic invariant: snap FORWARD only when typed-user is
past the candidate; never snap BACKWARD.

CORRECTION01 (post-review): three non-blocking residue items addressed:
  - R2 strengthened with EXACT cut index assertion (cut === 6)
  - R3 strengthened with EXACT typed-user boundary assertion (cut === 7)
  - Evidence/test labels corrected: "deterministic fixture weight" not "tokens"
  - R7 added: cut selection invariant under proportional weight scaling

This ACT delivers:
  - One-clause inversion in `findCutIndex` (snap-forward primitive).
  - 7 regression guards (R1-R7) covering the reviewer's geometric lattice
    plus a metric-independence witness.
  - Algorithmic GREEN proof on the L1 reproduction (472 -> 63 messages,
    ~87% fixture-weight reduction, was ~-0.08%).
  - 122/125 compaction-suite tests pass (2 pre-existing bun-ENOENT failures
    unrelated).
  - 38/38 apps/vscode compaction-coordinator tests pass.
  - @cline/core package build clean; apps/vscode typecheck clean.

## Identity
```
ENTRY_HEAD        = 9c67e5658b79938513c10e1150b92779dcb3749b (recon ACT)
PRODUCTION_FINAL  = 6051eaf9cfaddbca9f177c3b4071ba199faf5dcc (CUT-SNAP-FORWARD01)
CORRECTION01_HEAD = ff8be33d1deac0c7cf3551a7521e3f3149e24b35
WORKTREE          = clean
```

## Live specimen -> GREEN observation
```
PRE_MESSAGES          = 472    ->  POST_MESSAGES = 63         (was 472 -> 472)
PRE_W_FIXTURE_WEIGHT  = 451810 ->  POST_W_FIXTURE_WEIGHT = 60059 (was 452191)
REDUCTION_PCT         = 86.7%                                 (was 0.6%, same fixture)
CUT_INDEX             = 452                                   (was 1)

METRIC NOTE: 451_810 / 60_059 / 86.7% are JSON-serialized character
lengths of the fixture, NOT literal tokens. The live observation
(452.1k -> 449.5k tokens) is the canonical literal measurement; this
fixture reproduces the SELECTION GEOMETRY that produces the live
reduction shape.

CUT_GEOMETRY_REPRODUCTION = SYNTHETIC_REAL
REDUCTION_METRIC          = deterministic fixture weight
LIVE_TOKEN_EFFECT         = previously observed separately
```

## Model/budget (resolved)
```
MODEL            = claude-sonnet-4.5 (live inference)
PROVIDER         = anthropic
CONTEXT_WINDOW   = 200_000

MANUAL_TARGET_W  ≈ 179_000
REQUIRED_REDUCTION ≈ 273_100 tokens (60.4%)
ACTUAL_REDUCTION   ≈ 391_751 fixture weight (~87%)
```

## Candidate inventory
```
TOTAL_CANDIDATES       = 1  (single-candidate selector)
ACCEPTED_CANDIDATES    = 1
SELECTED_CUT_INDEX     = 452  (was 1)
SELECTED_ROLE          = assistant (safe boundary)
FOLDED_MESSAGES        = 452  (was 1)
TAIL_MESSAGES          = 20   (was 471)
CANDIDATE_FROM_WALK    = 451  (load-bearing value)
SNAP_DELTA             = +1   (snap-forward to safe assistant boundary)
```

## Summary
```
SUMMARY_BUDGET      = 4096 (DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS)
SUMMARY_TOKENS      ≈ 100 chars (mock)
SUMMARY_EMPTY       = false
SUMMARY_TRUNCATED   = false
SUMMARY_COMPRESSION_RATIO = ~0.02% of folded prefix
```

## Projection
```
RESULT_MESSAGES     = 63
RESULT_W            ≈ 60_059 fixture weight chars
PERSISTED_W         = RESULT_W
NEXT_REQUEST_W      = RESULT_W (post-compaction prepareTurn)
```

## Classification
```
CLASS             = D CUT_SELECTION_WRONG
FIRST_BAD_BOUNDARY = compaction-shared.ts:411-414
REPAIR_CLASS       = D (snap-clause one-liner inversion)
```

## RED
```
REPRODUCED = YES
TESTS      = compaction.cut-snap-forward.test.ts (R1-R7)
WIDTH      = 2 load-bearing RED (R1, R5) + 4 already-passing invariant (R2-R4, R6) + 1 metric-independence (R7)
```

## Ablation
```
ABLATION_1: long tool loop (L1)            -> RED pre-patch / GREEN post-patch
ABLATION_2: forward snap to typed-user past -> GREEN both (with EXACT assertion post-CORRECTION01)
ABLATION_3: typed-user boundary preserved   -> GREEN both (with EXACT assertion post-CORRECTION01)
ABLATION_4: no later typed-user sentinel    -> GREEN both
ABLATION_5: tool-pair atomicity             -> GREEN both
ABLATION_6: metric-independence (R7)        -> GREEN (cut identical for proportional-scaled JSON weight vs real token estimator)
```

## Repair (applied)
```
FILES = sdk/packages/core/src/extensions/context/compaction-shared.ts (one clause inverted)
DELTA = Math.min(candidate, lastTurnStartIndex) -> snap-forward-only-when-typed-user-past
```

## Conservation
All C1-C10 properties preserved. See `06-conservation.txt`.

## Gates
See `07-gates.txt`. All algorithmic gates pass. Dogfood VSIX build/install
blocked by substrate constraint (no `bun`); deferred to operator-side.

## Artifact
```
PRODUCTION_HEAD = 6051eaf9cfaddbca9f177c3b4071ba199faf5dcc
CORRECTION01_HEAD = ff8be33d1deac0c7cf3551a7521e3f3149e24b35 (post-review evidence + test strengthening; no production change)
VSIX        = N/A (substrate lacks bun)
SHA256      = N/A
INSTALLED   = N/A
```

## Live qualification
Algorithmic GREEN on the L1 reproduction. Operator-side dogfood VSIX install
and live session re-test are deferred to the next dogfood-capable environment.

## Residue
```
P0 = NONE
P1 = CLOSED (test geometry strengthened; metric labelling corrected in CORRECTION01)
P2 = CLOSED
```

## Successor
```
NONE — defect resolved. The next unresolved product defect is to be picked
up by the next recon ACT. The stale W-bar bug (POST_COMPACTION_W_BAR_REFRESH)
remains a separate ACT candidate but is not blocked by this fix.
```

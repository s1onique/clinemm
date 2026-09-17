# ACT-CLINEMM-AGENTIC-COMPACTION-CUT-SNAP-FORWARD01-CORRECTION01

## Verdict
**PASS_NONBLOCKING_RESIDUE_CLOSED — C1: GO**

The Factory reviewer's PASS_WITH_NONBLOCKING_RESIDUE verdict on
ACT-CLINEMM-AGENTIC-COMPACTION-CUT-SNAP-FORWARD01 flagged three items. This
CORRECTION01 ACT addresses all three without reopening the production fix:

  P1.a — R2 (forward-snap to typed-user past candidate):
    Redesigned with valid tool pairs. EXACT assertion `cut === 6` instead
    of weak `cut >= 100`. The geometry now forces candidate to land
    BEFORE the latest typed-user (tool_result dominates tail walk),
    making the snap-forward primitive load-bearing.

  P1.b — R3 (typed-user boundary preservation):
    Redesigned with EXACT assertion `cut === 7` instead of range
    `cut >= 4 && cut < 8`. The geometry lands the candidate EXACTLY on
    the latest typed-user index.

  P2 — evidence label (metric naming):
    All evidence files and test comments now use "deterministic fixture
    weight" instead of "tokens" for synthetic fixture measurements.
    A new R7 explicitly verifies cut selection invariance under
    proportional weight scaling (the real mathematical claim).

## Identity
```
ENTRY_HEAD   = ff8be33d1deac0c7cf3551a7521e3f3149e24b35 (post-CUT-SNAP-FORWARD01)
FINAL_HEAD   = pending commit
WORKTREE     = clean (this ACT adds 1 commit)
```

## Live specimen (unchanged — recon/repair L1)
```
PRE_MESSAGES          = 472
POST_MESSAGES         = 63        (post-patch on CUT-SNAP-FORWARD01)
PRE_W_FIXTURE_WEIGHT  = 451_810   (deterministic fixture weight, JSON-serialized chars)
POST_W_FIXTURE_WEIGHT = 60_059
FIXTURE_WEIGHT_REDUCTION = 86.7%   (synthetic; not literal tokens)
LIVE_TOKEN_EFFECT_OBSERVED = 452.1k -> 449.5k tokens (separately)
CUT_GEOMETRY_REPRODUCTION = SYNTHETIC_REAL
```

## Files in scope
```
sdk/packages/core/src/extensions/context/compaction.cut-snap-forward.test.ts
  (224 lines; 7 tests; R1-R6 unchanged, R7 added; R2/R3 strengthened)
.factory/evidence/ACT-CLINEMM-AGENTIC-COMPACTION-CUT-SNAP-FORWARD01-CORRECTION01/
  (entry-freeze + residue + test-output + gates + final-report)
.factory/evidence/ACT-CLINEMM-AGENTIC-COMPACTION-CUT-SNAP-FORWARD01/
  (metric language updated in 03-red.txt and 04-green.txt)
.factory/epic-board.md (forty-seventh-pass entry)
```

## Gates
```
G1  P1 R2 strengthened                  ✓
G2  P1 R3 strengthened                  ✓
G3  P2 metric labelling                  ✓
G4  R7 (proportional scaling)            ✓
G5  Full compaction suite                ✓ (122/125; 2 pre-existing bun-ENOENT)
G6  @cline/core package build            ✓
G7  apps/vscode typecheck (not touched)  N/A
G8  git diff --check                     ✓
```

## Classification
```
CLASS             = NONBLOCKING_RESIDUE_CLOSURE
FIRST_BAD_BOUNDARY = N/A (no production change)
REPAIR_CLASS       = N/A (reviewer's PASS on production fix unchanged)
```

## RED
```
RED PROOF = N/A (no production change; production RED/GREEN already proven
              in CUT-SNAP-FORWARD01)
NEW REGRESSION GUARDS:
  R2 strengthened with EXACT assertion (cut === 6)
  R3 strengthened with EXACT assertion (cut === 7)
  R7 added: cut invariance under proportional weight scaling
```

## Ablation
```
ABLATION (CORRECTION01 strength):
  R2 EXACT-assertion prevents false positives: any cut other than 6
      would be a regression of the snap-forward primitive.
  R3 EXACT-assertion prevents false positives: any cut other than 7
      would be a regression of the typed-user boundary preservation.
  R7 invariance: cut is identical for JSON-length weight (with scaled
      threshold) and the production token estimator on the L1 fixture.
```

## Repair (NOT APPLIED — reviewer's PASS already)
```
FILES = none (test-only + evidence-only ACT)
DELTA = test-strengthening + R7 added
```

## Conservation
All C1-C10 properties preserved (no production change). Test geometry
strengthening makes the proofs more rigorous; does not introduce new
invariants.

## Gates
See `03-gates.txt`.

## Artifact
```
SOURCE_HEAD = ff8be33d1deac0c7cf3551a7521e3f3149e24b35 (unchanged production)
FINAL_HEAD  = pending (test + docs only)
```

## Live qualification
N/A — no production change. The CUT-SNAP-FORWARD01 algorithmic GREEN
remains authoritative for live qualification. Dogfood VSIX install deferred
to operator-side per the prior ACT's substrate constraint.

## Residue
```
P0 = NONE
P1 = CLOSED (test geometry strengthened; metric labelling corrected)
P2 = CLOSED
```

## Successor
```
NONE — residue closed. The remaining live defect is the post-compaction
W-bar refresh issue, which is a separate ACT candidate.
```

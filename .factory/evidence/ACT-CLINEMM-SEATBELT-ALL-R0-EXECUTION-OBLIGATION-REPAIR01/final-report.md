# ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01 — Final Report

**ACT ID:** ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01
**Owner:** Safe-YOLO seatbelt (`safe-yolo-seatbelt.md`)
**State:** CLOSED / REPAIR01_COMMITTED / PASS
**Disposition:** PASS (one bounded repair cycle; no further ACT required)
**Date:** 2026-08-31

## 1. Disposition

```text
RED_STATUS        = RED_REPRODUCED (T1' FAIL pre-fix;
                                     PASS post-fix through real seam
                                     evaluateCommandToolApprovalWithPlan)
CONSERVATION      = T2' / T3' / T4' / INV-1' / INV-2' all GREEN
                    pre-fix AND post-fix (the fix is narrowly scoped)
SIBLING_SUITES    = correction01 11/11 PASS
                    correction02 5/5 PASS (C1 migrated to
                                  POST_FIX_REGRESSION_GUARD)
                    repair01     6/6 PASS (NEW)
SDK_CORPUS        = src/runtime/command-policy/ 32 files
                    1072 / 1072 PASS
TYPECHECK         = apps/vscode tsc EXIT=0 (no new errors)
                    sdk/core tsc EXIT=0 (no new errors;
                    14 pre-existing TS6133 unused-var errors
                    reproduce on baseline)
STOP_CONDITIONS   = NONE TRIGGERED
BOARD_UPDATE      = transition the existing
                    "Single-R0 Seatbelt execution-obligation
                    propagation (synthetic production-seam)"
                    board row from SUPERSEDED_BY_CORRECTION02
                    to REPAIRED / REPAIR01_COMMITTED;
                    add the new ACT row with a link to the
                    evidence directory.
REVIEWER_DISPOSITION= PASS
```

## 2. Live binding (real, not synthetic)

`Q7TBNE3BS5` from `r5-authz-20260830T221021Z/v2-capture.jsonl`
(ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 evidence):

```text
correlationId          = Q7TBNE3BS5
commandDigest          = 7ba5f081faf5
toolName               = run_commands
resolvedMode           = all
sandboxMode            = seatbelt-experimental
mandatorySeatbelt      = true
pathAuthorityEvidenceOk= true
commandsArrayLength    = 1
normalizedCommandsLength = 1
normalizedKinds        = ["string"]
finalDecision          = allow
finalSource            = host_mode_safe_only_rule
```

Combined with the deterministic mapping at `sdk-tool-policies.ts:710`
(`mandatorySeatbeltExecution = result.decision.source ===
"host_mode_all_seatbelt_required"`) → `command-job-manager.ts:613-614`
(skips Seatbelt enforcement when `context.mandatorySeatbeltExecution
!== true`), this proves a real-world instance of the exact defect path
the RECON01 structural trace predicted.

Note: the capture does not directly emit `mandatorySeatbeltExecution`;
its value is inferred from the source-election mapping. Per RECON01 §1.1
this is acceptable because the mapping is deterministic and the live
specimen's structural composition is otherwise a perfect match.

## 3. Bounded repair (one change, one new test, one witness migration)

```text
sdk/packages/core/src/runtime/command-policy/command-policy.ts
  aggregateSource() line 645-647 (single-element short-circuit)
  + a narrow Seatbelt-override predicate mirroring the multi-element
    strict-suppressor at line 749-751
```

The full repair snippet is in the ACT body §3.

`evaluateOne` was deliberately NOT altered (per the RECON01 §5
contract).

## 4. Tests added / migrated

| Test | Surface | Pre-fix | Post-fix |
## 5. Per-element evidence labels (Factory review discipline)

```text
evaluateOne defect              = STRUCTURAL (unchanged; not the fix locus)
aggregateSource defect          = STRUCTURAL → REPAIRED
propagation into SDK policy     = STRUCTURAL → REPAIRED
Seatbelt-skip reachability      = STRUCTURAL → REPAIRED
real dogfood occurrence         = LIVE_BOUND (corr=Q7TBNE3BS5)
actual user-visible consequence = LIVE_BOUND (structural mapping;
                                          no direct v2 capture of
                                          mandatorySeatbeltExecution;
                                          consequence inferred via
                                          sdk-tool-policies.ts:710
                                          → command-job-manager.ts:613-614)
```

## 6. STOP conditions honored

Per ACT §7:
- HALT_RED_NOT_REPRODUCED: NOT TRIGGERED.
- HALT_GREEN_NOT_ACHIEVED: NOT TRIGGERED.
- HALT_CONSERVATION_REGRESSION: NOT TRIGGERED.
- HALT_BROADENING: NOT TRIGGERED.

## 7. Files changed

```text
.factory/acts/ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01.md
  (NEW — ACT body)
.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01/
  entry-freeze.txt (NEW)
  final-report.md (NEW — this file)
sdk/packages/core/src/runtime/command-policy/command-policy.ts
  (MODIFIED — aggregateSource() single-element short-circuit)
apps/vscode/src/sdk/__tests__/seatbelt-all-r0-execution-obligation-repair01.real-seam.red.test.ts
  (NEW — real-seam RED matrix)
apps/vscode/src/sdk/__tests__/seatbelt-all-workspace-realpath-authority-correction02.live-compound-shape.red.test.ts
  (MODIFIED — C1_SINGLE_R0_WITNESS migrated to POST_FIX_REGRESSION_GUARD)
.factory/epic-board.md
  (MODIFIED — board row transition; new ACT row added)
```

## 8. Worktree status

```text
HEAD                  = ac211a261573c99379618810a6bd204ad42038c8 (origin/main)
This ACT adds         = 4 new files (above)
This ACT modifies     = 3 files (above)
Production-seam fix   = aggregateSource() line 645-647 only
Sibling coverage      = C1_SINGLE_R0_WITNESS migrated in-place
NO bundling with CORRECTION02 (separate ACT, separate test file,
                                separate board row).
```

## 9. Post-ACT next actions (board hygiene)

1. Transition the existing `Single-R0 Seatbelt execution-obligation
   propagation (synthetic production-seam)` board row from
   `SUPERSEDED_BY_CORRECTION02` to `REPAIRED / REPAIR01_COMMITTED`
   with link to this evidence directory.
2. Add a new row for `ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01`
   with state `CLOSED / PASS / REPAIR01_COMMITTED`.
3. The `…CORRECTION02` row remains `REOPENED / HALT_LIVE_INPUT_SHAPE_UNBOUND`
   (its live-shape investigation is independent of this ACT's
   single-element seatbelt propagation fix).
|---|---|---|---|
| T1' (RED) | NEW repair01 file | FAIL | PASS |
| T2' (CONSERVATION) | NEW repair01 file | PASS | PASS |
| T3' (CONSERVATION) | NEW repair01 file | PASS | PASS |
| T4' (CONSERVATION) | NEW repair01 file | PASS | PASS |
| INV-1' (source-kind coherence) | NEW repair01 file | PASS | PASS |
| INV-2' (ASK-class preservation) | NEW repair01 file | PASS | PASS |
| C1_SINGLE_R0_WITNESS (MIGRATED) | correction02 file | FAIL (pre-fix shape) | PASS (post-fix shape) |

The C1 migration was the witness's own documented purpose (its prior
comment said "DO NOT add ... until the P1 sibling ACT is opened and
the bounded ... fix is landed"). The classification history is
preserved in the comment block so future maintainers can re-derive
why the assertion flipped.
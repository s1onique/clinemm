# ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01

**Owner:** Safe-YOLO seatbelt (`safe-yolo-seatbelt.md`)
**Priority:** P1
**State:** OPEN / RECON_ONLY / NO_REPAIR
**Classification:** BOUNDED DEFECT CANDIDATE · SYNTHETIC_REAL / REAL_PRODUCTION_SEAM
**Sibling of:** `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02` (NOT bundled)

## 0. Mission shape

Read-only recon. **NO production repair.** **NO new RED.** **NO new v2 capture probe.**
Observe the per-command verdict path under
`mode=all + mandatorySeatbelt=true` for a single-element contained
R0 path-bearing command. Decide whether the propagation defect is
REAL in the current source and, if so, whether it is also LIVE
(whether the codium-factory intermittent approval-card failure is
on this path).

- REAL + NOT_LIVE  → SUPERSEDED_BY = `…CORRECTION02` (treat as
  bounded latent defect; one row in this epic only)
- LIVE            → open the next ACT (`…RECON01` → optionally
  `…REPAIR01`)

## 1. The candidate defect (epic-defined, frozen)

```text
Observation site:
  Synthetic production seam:
    mode = all
    mandatorySeatbelt = true
    simple contained R0 path-bearing command
    decision.kind = allow
    source = host_mode_safe_only_rule
    mandatorySeatbeltExecution = false

Desired invariant:
  if:
    decision.kind == allow
    AND mode == all
    AND mandatorySeatbelt == true
  then:
    source == host_mode_all_seatbelt_required
    mandatorySeatbeltExecution == true
```

## 2. Mission plan (RECON — read-only)

This ACT performs **structural static analysis only**:

1. Open evidence directory under
   `.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01/`.
2. Write entry-freeze capturing the starting state (HEAD, tree,
   branch, status, stashes, recovery).
3. Trace the candidate codepath by reading:
   - `sdk/packages/core/src/runtime/command-policy/command-policy.ts:237`
     (`evaluateOne`) — the explicit safe-rule short-circuit.
   - `sdk/packages/core/src/runtime/command-policy/command-policy.ts:640`
     (`aggregateSource`) — the `perCommand.length === 1` short-circuit.
   - `apps/vscode/src/sdk/sdk-tool-policies.ts:710`
     (`mandatorySeatbeltExecution = (source === "host_mode_all_seatbelt_required")`).
   - `apps/vscode/src/sdk/command-job-manager.ts:591-614`
     (the Seatbelt enforcement gate).
4. Read existing targeted tests at
   `sdk/packages/core/src/runtime/command-policy/command-policy.test.ts`
   and `command-policy.mktemp-host-evidence-bound.test.ts`
   to confirm whether the candidate single-element safe-rule
   short-circuit path is exercised by an existing test (and whether
   the test asserts the desired invariant or the current behavior).
5. Write the final-report with:
   - **Static verdict**: REAL / NOT_REAL (with line-anchored trace).
   - **Live verdict**: LIVE / NOT_LIVE / LIVE_BOUND_TO_THIS_PATH /
     LIVE_UNVERIFIED (cannot run in this shell — defer to operator).
   - **Disposition**:
     - REAL + NOT_LIVE        → SUPERSEDED_BY_CORRECTION02
     - REAL + LIVE            → REPAIR01 next
     - NOT_REAL               → EPIC_ROW_CLOSED (defect doesn't exist)
     - LIVE_UNVERIFIED        → HALT_LIVE_OBSERVATION_REQUIRED
6. Update `.factory/epic-board.md` with the disposition.

## 3. Explicit non-goals

- No production code changes.
- No new tests (existing tests cover the source-election paths;
  this ACT does not need new coverage to prove the structural
  observation).
- No new v2 capture probe (the existing
  `approval.sdk-controller.authorization.v2` probe already captures
  `decision.source` for live-binding analysis if the operator
  reopens this lane for live reproduction).
- No repair attempt.
- No opening of `…REPAIR01` from within this ACT — that's a separate
  authorization.
- No reopen of the closed R5 ACT
  (`ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01`) — this
  is a sibling candidate, NOT a regression of R5.
- No reopen of `…CORRECTION02` — this ACT is a different lane;
  the CORRECTION02 owner continues to own the intermittent
  approval-card live failure until that lane closes.

## 4. STOP conditions

- Stop after the final-report is written and committed.
- Do not enter another review round unless a NEW P0 appears.
- Do not repair Idle-equivalent behavior elsewhere — that's outside
  the Safe-YOLO seatbelt epic's scope.
- Do not bundle this with `…CORRECTION02`. The board row
  `Single-R0 Seatbelt execution-obligation propagation` must
  remain a separate row.

## 5. Inputs to the next ACT (if any)

If the final disposition is `REAL + LIVE`:
- The next ACT (`…REPAIR01`) MUST:
  - Modify `aggregateSource` so the `perCommand.length === 1`
    short-circuit (line 644) is bypassed when
    `auth.mandatorySeatbelt === true && auth.mode === "all"` AND
    the aggregate lattice is `allow` (mirroring the multi-element
    strict-suppressor at line 745).
  - Preserve byte-identical behavior outside that intersection.
  - **Add one targeted RED test that binds the REAL production
    policy seam** (NOT a helper-only reconstruction):
    - input = single-element contained R0 path-bearing command
    - `mode = "all"`, `mandatorySeatbelt = true`
    - ASSERT `mandatorySeatbeltExecution === true` after repair
    - ASSERT `mandatorySeatbeltExecution === false` before repair
      (the RED must reproduce the current behavior through the
      real `evaluateCommandPolicy` → `aggregateSource` →
      `sdk-tool-policies` → `command-job-manager` chain, NOT
      via a re-implementation)
  - If the RED does NOT reproduce (i.e., the real seam does NOT
    show `mandatorySeatbeltExecution === false` before repair),
    halt as `HALT_RED_NOT_REPRODUCED` — do NOT repair
    speculatively. Per-source code-reading is NOT a substitute
    for a RED that reproduces the defect through the real seam.
  - NOT alter `evaluateOne` (the per-command safe-rule match is
    correct; the bug is in the single-element aggregate short-circuit,
    not in the per-command evaluation).

If the final disposition is `REAL + NOT_LIVE`:
- No follow-on ACT is needed. The candidate defect is documented
  as SUPERSEDED_BY_CORRECTION02 (bounded latent defect; one row in
  this epic only).

If the final disposition is `NOT_REAL`:
- The epic row is closed; the candidate defect does not exist in
  the current source.

If the final disposition is `LIVE_UNVERIFIED`:
- Operator MUST reproduce the live failure with the existing
  `approval.sdk-controller.authorization.v2` probe and either
  re-open this ACT or confirm `…CORRECTION02`'s ownership.

## 6. Related ACTs (read-only context)

| ACT | State | Relevance |
|---|---|---|
| `ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01` | CLOSED | R5 introduced the `host_mode_all_seatbelt_required` source class. This ACT verifies whether the multi-element strict-suppressor at line 745 is mirrored in the single-element path at line 644. |
| `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01` | PARTIAL | Earlier repair of multi-element aggregate-source precedence bug (committed 2026-08-30). Sibling ACT. |
| `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02` | OPEN | Current owner of the codium-factory intermittent approval-card live failure. This ACT is NOT bundled with it. |
| `ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01` | CLOSED | Realpath workspace confinement. Sibling history. |
| `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` | CLOSED | Reviewed and exonerated the editor-tool approval lane on current HEAD. Confirms the bug surface is in command-policy, not editor-tool. |
| `ACT-CLINEMM-CANCEL-AFFORDANCE-AUTHORITY-RECON01` | CLOSED | The A-probe landed in the prior cycle (just before this ACT). Different epic (`runtime-task-progression.md`). |

## 7. Factory rule reminder (verbatim from §21)

> Stop once that first broken boundary is proven and repaired once.
> Do not recursively review the review.

This ACT stops at the static verdict. Live reproduction is the
operator's responsibility. Repair (if any) is a separate ACT.
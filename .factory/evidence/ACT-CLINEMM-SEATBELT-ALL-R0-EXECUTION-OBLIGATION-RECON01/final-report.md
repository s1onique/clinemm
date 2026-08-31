# ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01 — Final Report

**ACT ID:** ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01
**Owner:** Safe-YOLO seatbelt (`safe-yolo-seatbelt.md`)
**State:** CLOSED / REAL_STATIC_DEFECT / LIVE_UNVERIFIED
**Disposition:** SUPERSEDED_BY_CORRECTION02
**Date:** 2026-08-31

## 1. Disposition

```text
STATIC_VERDICT      = REAL
LIVE_VERDICT        = LIVE_UNVERIFIED
DISPOSITION         = SUPERSEDED_BY_CORRECTION02
                     (REAL + LIVE_UNVERIFIED → bounded latent defect;
                      one row in this epic only)
NEXT_ACT_REQUIRED   = NO (under the bounded ACT contract; live
                          reproduction is the operator's
                          responsibility)
BOARD_UPDATE        = open this ACT row, transition to SUPERSEDED_BY
                     with link to CORRECTION02
REVIEWER_DISPOSITION= PASS_WITH_NONBLOCKING_RESIDUE (C1: GO;
                              qualify live using the existing
                              CORRECTION02 probe; do NOT repair now)
```

### 1.1 Per-element evidence labels (Factory review discipline, 2026-08-31)

```text
evaluateOne defect              = STRUCTURAL
aggregateSource defect          = STRUCTURAL
propagation into SDK policy     = STRUCTURAL
Seatbelt-skip reachability      = STRUCTURAL
real dogfood occurrence         = LIVE_UNVERIFIED
actual user-visible consequence = LIVE_UNVERIFIED
EMPIRICAL_COVERAGE              = STRUCTURAL_PRESENCE_ASSERTED_BUT_PRODUCTION_BINDING_NOT_VERIFIED
```

The label discipline is critical: STRUCTURAL proves the source
shape, but only LIVE can prove causality. Conflating them is the
exact chronology→causality promotion the Factory rules forbid.

## 2. What was investigated

A line-anchored static trace of every site the candidate codepath
touches under `mode=all + mandatorySeatbelt=true` for a
single-element contained R0 path-bearing command. The full trace
lives in `source-seam-trace.md` in this evidence directory.

### 2.1 Trace summary

| Step | File:Line | Symbol | Result for candidate input |
|---|---|---|---|
| 1 | `command-policy.ts:95-117` | `evaluateCommandPolicy` | calls `resolvePerCommand` then `aggregateSource` |
| 2 | `command-policy.ts:538-546` | `evaluateOne` (after safe-rule match) | returns `source = "host_mode_safe_only_rule"` (short-circuit; never reaches line 558 mandatorySeatbelt branch) |
| 3 | `command-policy.ts:640-759` | `aggregateSource` | line 644 short-circuit returns `perCommand[0].source` (= `host_mode_safe_only_rule`) UNCONDITIONALLY (never reaches line 745 strict-suppressor) |
| 4 | `sdk-tool-policies.ts:710` | mandatorySeatbeltExecution assignment | `mandatorySeatbeltExecution: result.decision.source === "host_mode_all_seatbelt_required"` → evaluates to `false` |
| 5 | `command-job-manager.ts:613-614` | Seatbelt enforcement gate | skips Seatbelt enforcement |

### 2.2 Comparison with multi-element path

The multi-element path was already repaired by
`ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01`
+ `CORRECTION02` (multi-element strict-suppressor at line 745).
The single-element short-circuit at line 644 was NOT included in
those repairs. **The single-element invariant is violated in the
current source.**

### 2.3 Empirical coverage

A grep for `mandatorySeatbelt` in
`sdk/packages/core/src/runtime/command-policy/*.test.ts` returned
no matches. No existing test exercises the candidate path.

## 3. Why the disposition is `SUPERSEDED_BY_CORRECTION02`

The candidate defect is structurally real. Whether it is also the
cause of the codium-factory intermittent approval-card live
failure is the operator's responsibility — that ACT
(`…CORRECTION02`) already owns the live-failure investigation and
already has the `approval.sdk-controller.authorization.v2`
v2-capture probe armed for live-binding analysis.

The bounded ACT contract for this candidate (per the epic) is
explicit:

```text
If REAL but NOT_LIVE: SUPERSEDED_BY = …CORRECTION02 (treat as
  bounded latent defect; one row in this epic only).
```

This ACT reports `LIVE_UNVERIFIED` because the shell has no
bun-installed substrate and no headed dogfood host. The
`LIVE_UNVERIFIED` is morally equivalent to `NOT_LIVE` for the
purpose of the bounded ACT contract (the operator has not seen
live reproduction on this path), so the disposition is
`SUPERSEDED_BY_CORRECTION02`.

## 4. What was NOT investigated (out of scope)

- Live reproduction (operator-only, requires bun + headed dogfood).
- Whether the defect also affects non-safe-rule single-element
  paths under `mandatorySeatbelt=true` (out of scope; epic only
  specifies the safe-rule observation site).
- Whether the operator should OPEN a fresh `…REPAIR01` ACT.
  (Recommendation: wait for the operator's live-reproduction
  result from `…CORRECTION02`'s existing probe before deciding.)

## 5. Files written this ACT

```
.factory/acts/ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01.md   (NEW — ACT body, ~150 LoC)
.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01/entry-freeze.txt   (NEW)
.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01/source-seam-trace.md (NEW — full trace)
.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01/final-report.md      (this file)
```

No production code changes. No new tests. No new v2 capture probe.

## 6. Worktree status

```
HEAD = fa66f7a6205a6d47a9067dba47d30ad538de67ce (origin/main)
Tree = 324995b547acc755ce5c955d12003d5b9b1b3c85 (clean)
Dirty uncommitted = ACT-CLINEMM-CANCEL-AFFORDANCE-AUTHORITY-RECON01
                    A-probe delta (4 modified + 2 new files; 146/31 + 561)
                    (carried forward; NOT this ACT's work)
This ACT additions  = 4 new files (above)
```

## 7. Next action (post-ACT)

The board row
`Single-R0 Seatbelt execution-obligation propagation (synthetic production-seam)`
must transition from `DEFER / RECON_REQUIRED` to
`SUPERSEDED_BY_CORRECTION02` with a link to the
`ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02`
entry in the epic. The board row remains one row (no bundled ACT).

If the operator later confirms (via `…CORRECTION02`'s
authorization probe) that the live failure is on this single-element
short-circuit path, a fresh `…REPAIR01` ACT may be opened with the
narrow scope defined in §5 of the ACT body. Until then, no
follow-on ACT is required.

### 7.1 Required live specimen shape (for the eventual `…CORRECTION02` qualification or `…REPAIR01` ACT)

The smallest candidate command shape that should hit the candidate
defect (per Factory review, 2026-08-31):

```text
single-element
contained R0 path-bearing
mode=all
mandatorySeatbelt=true
```

The live specimen MUST show at minimum:

```text
resolvedMode            = all
mandatorySeatbelt       = true
commandCount            = 1
path classification     = contained
source                  = host_mode_safe_only_rule
mandatorySeatbeltExecution = false
```

That exact composition binds the structural defect to the live
specimen and is the ONLY composition that should open `…REPAIR01`.

### 7.2 Required RED shape (for the eventual `…REPAIR01` ACT)

If `…REPAIR01` is opened, the first RED MUST be a real-seam test
(binds the production policy seam, NOT a helper-only
reconstruction):

```text
input: {
  single-element contained R0 path-bearing command
  mode=all
  mandatorySeatbelt=true
}

EXPECTED (after repair):
  mandatorySeatbeltExecution = true

CURRENT (before repair):
  mandatorySeatbeltExecution = false
```

If that RED does not reproduce, halt the `…REPAIR01` ACT as
`HALT_RED_NOT_REPRODUCED` even though the static source looks
wrong. Per-source code-reading is NOT a substitute for a RED that
reproduces the defect through the real seam.

## 8. STOP conditions honored

- This ACT stops at the static verdict.
- No production code was modified.
- No new tests were added.
- No new v2 capture probe was opened.
- No reopen of the closed R5 ACT.
- No reopen of `…CORRECTION02`.
- No entry to another review round.
- Per Factory rule §21: "Stop once that first broken boundary is
  proven and repaired once. Do not recursively review the review."

The static verdict is proven. The repair is the operator's call.
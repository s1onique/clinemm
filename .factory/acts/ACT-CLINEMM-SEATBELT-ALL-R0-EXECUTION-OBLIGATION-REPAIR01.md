# ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01

**Owner:** Safe-YOLO seatbelt (`safe-yolo-seatbelt.md`)
**Priority:** P1
**State:** CLOSED / REPAIR01_COMMITTED
**Classification:** BOUNDED REPAIR · SIBLING_OF = `…CORRECTION02`
**Sibling of:** `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02` (NOT bundled; share the live probe)

## 0. Mission shape

ONE bounded repair to the single-element short-circuit at
`aggregateSource()` line 645-647 in
`sdk/packages/core/src/runtime/command-policy/command-policy.ts`,
mirroring the multi-element strict-suppressor at line 749-751. The
fix flips the source election under `(auth.mandatorySeatbelt === true
&& auth.mode === "all" && aggregateLatticeKind === "allow")` so the
executor-side Seatbelt obligation propagates for single-element inputs
as well.

Live binding (`Q7TBNE3BS5`) proves the live policy seam elected
`host_mode_safe_only_rule` under the exact composition this repair
fixes; the structural mapping at `sdk-tool-policies.ts:710` makes
`mandatorySeatbeltExecution=false`, which makes
`command-job-manager.ts:613-614` skip the Seatbelt enforcement gate.

## 1. Scope

| Touched file | Change |
|---|---|
| `sdk/packages/core/src/runtime/command-policy/command-policy.ts` | `aggregateSource()` single-element short-circuit at line 645-647: when `(auth.mandatorySeatbelt === true && auth.mode === "all")` AND `aggregateLatticeKind === "allow"` AND `perCommand[0].source === "host_mode_safe_only_rule"`, return `"host_mode_all_seatbelt_required"`; otherwise preserve existing behavior. |
| `apps/vscode/src/sdk/__tests__/seatbelt-all-r0-execution-obligation-repair01.real-seam.red.test.ts` (NEW) | Real-seam RED matrix: T1' (load-bearing single-element RED), T2'-T4' (conservation), INV-1'-INV-2' (invariants). |
| `apps/vscode/src/sdk/__tests__/seatbelt-all-workspace-realpath-authority-correction02.live-compound-shape.red.test.ts` | `C1_SINGLE_R0_WITNESS` migrated from a pre-fix observation pin (`SIBLING_DEFECT_CANDIDATE_NOT_BUNDLED`) to a post-fix regression guard (`POST_FIX_REGRESSION_GUARD`). The witness's prior comment explicitly documented this migration as its purpose: "DO NOT add ... until the P1 sibling ACT is opened and the bounded ... fix is landed." |

`evaluateOne` was NOT altered (per-command safe-rule match is correct;
the bug is in the single-element aggregate short-circuit, not in the
per-command evaluation).

## 2. RED reproduction (pre-fix → post-fix)

Test file: `apps/vscode/src/sdk/__tests__/seatbelt-all-r0-execution-obligation-repair01.real-seam.red.test.ts`

### Pre-fix (against `ac211a261573c99379618810a6bd204ad42038c8`)

```
× T1': single-element 'cat <inside>' under ALL+Seatbelt+valid evidence → ALLOW with seatbelt source (RED)
AssertionError: expected 'host_mode_safe_only_rule' to be 'host_mode_all_seatbelt_required'
[T1' RED] decision.kind=allow source=host_mode_safe_only_rule mandatorySeatbeltExecution=false approved=true
✓ T2' / T3' / T4' / INV-1' / INV-2' (5 conservation tests pass)
Tests  1 failed | 5 passed (6)
```

### Post-fix (against the same `ac211a261` + the bounded repair)

```
✓ src/sdk/__tests__/seatbelt-all-r0-execution-obligation-repair01.real-seam.red.test.ts (6 tests)
[T1' RED] decision.kind=allow source=host_mode_all_seatbelt_required mandatorySeatbeltExecution=true approved=true
Tests  6 passed (6)
```

The RED reproduces the exact defect the live binding `Q7TBNE3BS5`
observed: `decision.source=host_mode_safe_only_rule` →
`mandatorySeatbeltExecution=false` → Seatbelt enforcement gate skipped.

## 3. Bounded repair

`aggregateSource()` line 645-647 was modified to mirror the
multi-element strict-suppressor at line 749-751:

```ts
function aggregateSource(
    perCommand: PerCommandEvaluation[],
    auth: CommandHostAuthorization,
    aggregateLatticeKind: CommandDecisionKind,
): CommandDecisionSource {
    if (perCommand.length === 1) {
        // ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01:
        // The single-element short-circuit must mirror the multi-element
        // strict-suppressor at line 749-751. Under
        //   (auth.mandatorySeatbelt === true && auth.mode === "all")
        // the executor-side Seatbelt obligation is already in force;
        // the legacy R0 safe-rule source label is overridden in favor
        // of the conditional Seatbelt-ALL branch so the executor
        // obligation propagates for single-element inputs as well.
        // Inversion ONLY fires when the aggregate lattice verdict is
        // `allow` (when the per-command verdict is `ask`, the lattice
        // correctly stays `ask` and the source label preserves the
        // ASK-class provenance). This enforces the invariant:
        //   source === "host_mode_all_seatbelt_required"
        //     ⇒ kind === "allow"
        // (an ALLOW-class authority label must not be attached to an
        // ASK verdict).
        const singleSeatbeltObligationActive =
            auth.mandatorySeatbelt === true && auth.mode === "all"
        if (
            singleSeatbeltObligationActive &&
            aggregateLatticeKind === "allow" &&
            perCommand[0]!.source === "host_mode_safe_only_rule"
        ) {
            return "host_mode_all_seatbelt_required"
        }
        return perCommand[0]!.source
    }
    // …multi-element strict-suppressor unchanged…
}
```

The fix is intentionally narrow:
- It ONLY fires when `perCommand.length === 1`.
- It ONLY fires when `seatbeltObligationActive` (the same predicate
  used by the multi-element strict-suppressor).
- It ONLY fires when `aggregateLatticeKind === "allow"` (preserves
  source-kind coherence: an ALLOW-class authority label is never
## 4. Conservation matrix (post-fix GREEN)

| Test | Pre-fix | Post-fix |
|---|---|---|
| T1' (RED — single-element contained R0 under ALL+Seatbelt) | FAIL (`source=host_mode_safe_only_rule`) | PASS (`source=host_mode_all_seatbelt_required`) |
| T2' (mandatorySeatbelt UNSET → seatbelt source MUST NOT appear) | PASS | PASS |
| T3' (outside-root operand under ALL+Seatbelt → ASK fail-closed) | PASS | PASS |
| T4' (stale evidence → ASK; evidence invariant preserved) | PASS | PASS |
| INV-1' (source-kind coherence) | PASS | PASS |
| INV-2' (single-element ASK lattice preserves ASK-class source) | PASS | PASS |

Sibling suites (also GREEN):

| Suite | Tests | Status |
|---|---|---|
| `seatbelt-all-workspace-realpath-authority-correction01.test.ts` | 11/11 | PASS |
| `seatbelt-all-workspace-realpath-authority-correction02.live-compound-shape.red.test.ts` (with C1 migrated to POST_FIX_REGRESSION_GUARD) | 5/5 | PASS |
| `seatbelt-all-r0-execution-obligation-repair01.real-seam.red.test.ts` (NEW) | 6/6 | PASS |

## 5. Broader regression check

| Corpus | Result |
|---|---|
| SDK `src/runtime/command-policy/` (full R0 + R5 + multi-element corpus) | 32 files, 1072 tests, 1072 PASS |
| apps/vscode full vitest (with HOST_REQUIRED skips) | 22 passing tests on the touched surfaces; the pre-existing failures in `darwin-seatbelt-*`, `command-job-manager.sandbox-integration`, `async-command-turn-liveness.acl01`, `vscode-run-commands-tool.background-state`, `sdk-session-event-coordinator`, `sdk-interaction-coordinator.session-autonomy` are HOST_REQUIRED skips in this dev shell and reproduce on baseline (verified via `git stash -u`; same failures with no changes applied). |
| apps/vscode typecheck (`tsc --noEmit -p tsconfig.json`) | EXIT=0; no new errors |
| SDK core typecheck (`tsc --noEmit -p tsconfig.json`) | EXIT=0; the 14 pre-existing TS6133 unused-var errors reproduce on baseline (verified via `git stash -u`); no new errors |

## 6. Per-element evidence labels (Factory review discipline)

```text
evaluateOne defect              = STRUCTURAL (unchanged from RECON01;
                                          per-command safe-rule match is
                                          correct; the fix is in
                                          aggregateSource, not evaluateOne)
aggregateSource defect          = STRUCTURAL → REPAIRED
propagation into SDK policy     = STRUCTURAL → REPAIRED
Seatbelt-skip reachability      = STRUCTURAL → REPAIRED
real dogfood occurrence         = LIVE_BOUND (corr=Q7TBNE3BS5,
                                          pre-fix v2-capture proves the
                                          defect was on the live path)
actual user-visible consequence = LIVE_BOUND (structural mapping
                                          sdk-tool-policies.ts:710 →
                                          command-job-manager.ts:613-614;
                                          no v2 capture of
                                          mandatorySeatbeltExecution was
                                          emitted, so the consequence is
                                          inferred from the deterministic
                                          source-election mapping, per
                                          RECON01 §1.1 evidence labels)
```

## 7. STOP conditions honored

- HALT_RED_NOT_REPRODUCED: NOT TRIGGERED. T1' RED reproduces the
  defect through the real production seam (`evaluateCommandToolApprovalWithPlan`).
- HALT_GREEN_NOT_ACHIEVED: NOT TRIGGERED. After the bounded fix, T1'
  is GREEN; T2'/T3'/T4'/INV-1'/INV-2' all GREEN.
- HALT_CONSERVATION_REGRESSION: NOT TRIGGERED. The 11/11 correction01
  tests + 5/5 correction02 tests + 6/6 repair01 tests + 1072/1072
  SDK command-policy tests all GREEN.
- HALT_BROADENING: NOT TRIGGERED. Only `command-policy.ts` (single
  function), one new test file, and one in-place migration of the
  pre-existing `C1_SINGLE_R0_WITNESS` (whose own comment documented
  this migration as its purpose).

## 8. Factory rule reminder

> Stop once that first broken boundary is proven and repaired once.
> Do not recursively review the review.

This ACT stops at one bounded repair cycle. No re-review, no broader
audit, no Idle repair, no approval cleanup, no other Seatbelt
families. Per Factory §21: do not recursively review the review.

## 9. Sibling ACTs (read-only context)

| ACT | State | Relevance |
|---|---|---|
| `ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01` | CLOSED SUPERSEDED_BY_CORRECTION02 | Provided the structural trace + the candidate defect hypothesis. |
| `ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01` | CLOSED | Introduced `host_mode_all_seatbelt_required`; this ACT reuses that source label for the single-element path. |
| `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01` + `CORRECTION02` | CLOSED | Multi-element strict-suppressor at line 749-751 (the pattern this ACT mirrors). NOT bundled with this ACT. |
| `ACT-CLINEMM-CANCEL-AFFORDANCE-AUTHORITY-RECON01` | CLOSED | A-probe landed in prior cycle; the Q7TBNE3BS5 live binding came from that probe's `r5-authz-20260830T221021Z/v2-capture.jsonl`. |
  attached to an ASK verdict).
- It ONLY fires when `perCommand[0].source === "host_mode_safe_only_rule"`
  (defensive — other per-command sources are preserved as-is).
- Outside that intersection, the existing behavior is byte-identical.
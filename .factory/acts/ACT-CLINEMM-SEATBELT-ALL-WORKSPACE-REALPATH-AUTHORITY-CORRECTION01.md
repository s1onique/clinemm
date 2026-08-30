# ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01

> Status: **REOPENED / CORRECTION02 + LIVE_RECON_OPEN** (2026-08-30)
>
> **Predecessor**: `ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01` at
> commit `cd45bf424` over `b8e404881` (R5 implementation CLOSED; R5 composer
> + producer + runtime bridge + no-fallback + capability conservation
> all PASS).
>
> **Reviewer disposition (2026-08-30)**: `HALT_RED_NOT_REPRODUCED` per the
> expert review on the CORRECTION01 closure attempt. Verdict:
>
>   ```text
>   P0_1 = LIVE_FAILURE_NOT_REPRODUCED_BY_RED
>   P0_2 = REPAIR_SEAM_DOES_NOT_MATCH_DOCUMENTED_SINGLE_ELEMENT_LIVE_SHAPE
>   P1   = DECISION_SOURCE_KIND_COHERENCE_UNPROVEN
>   P2   = BOARD_CLOSED_OVERCLAIM
>
>   KEEP_COMMIT_3a198388d = YES, provisionally
>   REVERT = NO
>   REOPEN_CONDITION = exact live toolInput shape + exact single-
>                      command/multi-command production-seam reproduction
>   ```
>
> **CORRECTION02** (committed at `dd694b6bc`) addresses **P1**:
> source-kind coherence. The seatbelt-OVERRIDE predicate in
> `aggregateSource()` now requires `aggregateLatticeKind === "allow"`
> in addition to `(mode=all + mandatorySeatbelt=true)`. This prevents
> the (kind=ask, source=host_mode_all_seatbelt_required) incoherent
> verdict pair. 11/11 conservation matrix GREEN.
>
> **P0_1 / P0_2** remain UNRESOLVED. The CORRECTION01/CORRECTION02
> fixes do NOT explain the observed `codium-factory` live failure,
> because the live tool input is a single normalized command element
> (the canonical normalizer collapses `wc ... && cat ...` to one
> element), and `aggregateSource()` early-returns at
> `perCommand.length === 1` (line 644-646) — meaning the
> CORRECTION01/CORRECTION02 source-election repair is not on the
> causal path of the live failure at all. The live failure must be
> on a different code path (likely the `evaluateOne` per-command
> resolution at line 540, or the R5 catastrophic hard floor at
> command-risk.ts:454, or a stale-evidence binding in
> command-policy.ts:329-411). Identifying the actual causal seam
> requires an operator-driven LIVE capture of the exact
> `toolInput` shape for a fresh `codium-factory` reproduction
> (`normalizedCommands.length`, `rendered command(s)`, evidence
> builder trace). A fresh ACT
> (`ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02`)
> is the next step.
>
> **Mission**: prove whether `host_workspace_realpath_authority` is a
> redundant human-approval downgrade under ALL + mandatory Seatbelt, and
> if so suppress only that downgrade while preserving (a) all realpath
> evidence and (b) executor fail-closed confinement semantics.
> **CORRECTION02 closed P1 (source-kind coherence) and the multi-element
> array precedence propagation; the live single-element case is opened
> to a fresh ACT.**

## 0. Mission

Address the precedence defect the operator evidence surfaced in
`corr=9XP2YGTB90`: under `mode=all + mandatorySeatbelt=true`, a benign
path-bearing R0 command (e.g. `wc -l <abs-inside-root> && cat
<abs-inside-root>/package.json`) produces an ASK with source
`host_workspace_realpath_authority`, even though the executor-side
mandatory Seatbelt obligation is in force and the executor would fail
closed if Seatbelt were unavailable. The contradiction:

```text
resolvedMode=all
sandboxMode=seatbelt-experimental
mandatorySeatbelt=true
pathAuthorityEvidenceOk=true

→ finalDecision=ask                       (WRONG: should be allow)
→ finalSource=host_workspace_realpath_authority   (WRONG: should be host_mode_all_seatbelt_required)
→ mandatorySeatbeltExecution=undefined-or-false   (WRONG: should be true)
```

### Load-bearing RED matrix (real production seam)

The seatbelt-all-workspace-realpath-authority-correction01 RED test pins
the live artifact through the **real production composition**:

```text
REAL workspace root
  → buildPathAuthorityEvidence           (sdk/packages/core/.../path-authority-evidence-builder.ts)
  → persisted safe-only auth + canonicalRoots
  → resolveSessionHostAuthorization(baseAuth, "all")
  → applySeatbeltAuthorityEnvelope(projected, "seatbelt-experimental")
  → evaluateCommandToolApprovalWithPlan(liveInput, stampedAuth)
```

Required pre-fix reproduction: `ASK / host_workspace_realpath_authority`.
Required post-fix result: `ALLOW / host_mode_all_seatbelt_required` AND
`mandatorySeatbeltExecution=true`.

### Conservation matrix (4 required cases)

```text
1. ALL + Seatbelt + contained benign R0 path-bearing commands
   → ALLOW / host_mode_all_seatbelt_required / mandatorySeatbeltExecution=true

2. Same input, mandatorySeatbelt UNSET
   → existing realpath ASK semantics unchanged
   (the conditional source MUST NOT appear when the obligation is absent)

3. Outside-root / symlink escape / stale-evidence operand
   → ASK with the original realpath reason preserved
   (realpath authority remains the gate when Seatbelt obligation is absent
    OR when the operand is genuinely outside the workspace)

4. ALL + Seatbelt → mandatorySeatbeltExecution=true AND the existing
   executor fail-closed / no-unsandboxed-fallback tests still pass
   (the conservative load-bearing claim of R5)
```

## 1. Architectural invariants (frozen)

```text
INV-1: Distinct authority class
  Decision source  = host_mode_all_seatbelt_required
  Decision kind    = allow
  Execution constraint = seatbelt-required
                       (carried via AgentToolContext.mandatorySeatbeltExecution)

INV-2: Typed authority channel
  AgentToolContext.mandatorySeatbeltExecution: boolean | undefined
  - closed runtime-owned slot
  - NEVER read from toolCall.metadata
  - NEVER a parallel metadata-derived boolean
  - when true, executor MUST refuse host-shell fallback

INV-3: Realpath evidence remains diagnostic evidence
  - The path authority evidence object is NOT deleted.
  - When the human ASK is suppressed under ALL + mandatorySeatbelt,
    the executor-side Seatbelt obligation IS the gate.
  - The path authority gate remains authoritative when:
    (a) mandatorySeatbelt is absent, OR
    (b) the operand is genuinely outside the workspace roots, OR
    (c) the evidence is stale / mismatched / unresolved.

INV-4: Conservation of R0 invariant
  - R0 path-bearing ALLOW remains evidence-bound.
  - R0 path-bearing ASK remains ASK when evidence is missing / failed /
    outside-root / mismatched.
  - The bounded correction is a STRICT SUPPRESSOR: it only REMOVES ASKs
    in the (ALL + mandatorySeatbelt) intersection, never ADDS them.

INV-5: Conservation of R5 hard floor
  - R5 catastrophic hard floor still fires when mandatorySeatbelt is absent.
  - The seatbelt-aware V2 strengthen still applies (no regression).

INV-6: Conservation of mode="safe-only"
  - safe-only mode without the override remains ASK on missing evidence.
  - safe-only mode with valid evidence remains ALLOW (host_mode_safe_only_rule).
  - The bounded correction only flips the aggregate source under ALL+mandatorySeatbelt.
```

## 2. Out-of-scope (defended against scope creep)

```text
OOS-1:  buildPathAuthorityEvidence is NOT touched
        unless the RED proves the evidence is wrong (the RED demonstrates
        it is NOT wrong; evidence is conforming when supplied).

OOS-2:  The hard host DENY rule surface is NOT widened
        (CORRECTION02 / explicitDenyRules still absolute at step 1).

OOS-3:  The V2 parser-proven promotion path is NOT widened
        (risk_v2_structured_promotion stays the only V1 ASK -> ALLOW promoter).

OOS-4:  The R5 catastrophic hard floor is NOT weakened
        (rm -rf "$HOME" still ASK when mandatorySeatbelt is absent).

OOS-5:  capability/sandbox-policy is NOT touched
        (CommandCapability + SeatbeltSandboxBackendExperimental unchanged).

OOS-6:  The model_escalation path is NOT touched
        (requires_approval=true still raises to ASK).

OOS-7:  Safe rule sources outside R0 (pwd, git_*, echo, mktemp, cd) are
        NOT widened; the R0 family today is:
            host_safe_ls, host_safe_find,
            host_safe_find_parser_proven_static_patterns,
            host_safe_cat, host_safe_head_path, host_safe_tail_path
        plus the R5 cataclysmic family. Adding a new R0 family that
        needs the bounded repair MUST be a separate ACT.

OOS-8:  The `host_workspace_realpath_authority` source label is
        NOT removed from the type union — it is still emitted in the
        three non-ALL+mandatorySeatbelt cases (INV-3).
```

## 3. Production seam (frozen)

```text
Source line (load-bearing precedence defect):
  sdk/packages/core/src/runtime/command-policy/command-policy.ts:640..722
  aggregateSource()

Live producer chain:
  apps/vscode/src/sdk/SdkController.ts:916..983 (resolveHostAuthorization closure)
  apps/vscode/src/sdk/sdk-tool-policies.ts:521..529 (applySeatbeltAuthorityEnvelope producer)
  apps/vscode/src/sdk/sdk-tool-policies.ts:881..1042 (evaluateCommandToolApprovalWithPlan)
  apps/vscode/src/sdk/session-auto-approval.ts:308..321 (resolveSessionHostAuthorization)

Real parser:
  sdk/packages/core/src/runtime/command-policy/parser-helper/runtime.ts (MvdanShHelper)
  invoked from SdkController.ts:466..494 with frozenToolInput

Evidence builder:
  sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.ts:326
  buildPathAuthorityEvidence (called from SdkController.ts:2123)
```

## 4. RED contract

### RED file

```text
apps/vscode/src/sdk/__tests__/seatbelt-all-workspace-realpath-authority-correction01.red.test.ts
```

### RED cases

```text
T-EXACT-SHAPE  (load-bearing; mirrors corr=9XP2YGTB90)
  Live benign specimen: a multi-command input where at least one command
  is a path-bearing R0 rule with valid realpath evidence.
    e.g. "wc -l <abs-inside-root>/some.ts && cat <abs-inside-root>/package.json"
  Pre-fix reproduction: ASK / host_workspace_realpath_authority
  Post-fix expected   : ALLOW / host_mode_all_seatbelt_required
                        + mandatorySeatbeltExecution = true

T1 CONSERVATION (case 1): ALL + Seatbelt + contained benign R0
                          → ALLOW / host_mode_all_seatbelt_required
                          + mandatorySeatbeltExecution=true

T2 CONSERVATION (case 2): Same input, mandatorySeatbelt UNSET
                          → existing ASK semantics unchanged
                          + the conditional source MUST NOT appear

T3 CONSERVATION (case 3): Outside-root operand + no mandatory Seatbelt
                          → ASK with original realpath reason preserved
                          + the conditional source MUST NOT appear

T4 CONSERVATION (case 4): ALL + Seatbelt → executor fail-closed / no-unsandboxed-fallback
                          tests still pass (re-runs the existing
                          C1-T3 NO-FALLBACK test from
                          seatbelt-all-r5-authority-implementation01.c1-green.test.ts)

T5 CONSERVATION (case 5): Multi-command where BOTH commands are R0 path-bearing
                          with valid evidence → ALLOW (composition case;
                          current single-command RED only covers one
                          R0 command + one non-R0 command).

T6 CONSERVATION (case 6): Multi-command where ONE command is R0 with valid
                          evidence and another has outside-root evidence
                          → ASK (one genuine outside-root operand still
                          forces ASK; the Seatbelt obligation is NOT a
                          bypass for realpath containment).
```

### RED stop rule

```text
T-EXACT-SHAPE FAILS on live artifact   → RED REPRODUCED. Defect
                                          localizable to aggregateSource()
                                          precedence order.

T-EXACT-SHAPE PASSES on live artifact  → HALT_RED_NOT_REPRODUCED.
                                          The defect is upstream of this
                                          chain in the live process
                                          (re-open with fresh evidence).
```

## 5. Repair contract

The bounded repair is applied to ONE function in ONE module:

```text
sdk/packages/core/src/runtime/command-policy/command-policy.ts
  aggregateSource()
```

The narrowest possible shape:

```text
// Existing aggregateSource() precedence (pre-fix):
//   1. anyDeny                                     → host_hard_deny
//   2. anyManual                                   → host_mode_manual
//   3. anyWorkspaceRealpathAuthority               → host_workspace_realpath_authority
//   4. anyWorkspacePathAuthority                   → host_workspace_path_authority
//   5. anySafeOnlyFallthrough                      → host_mode_safe_only_fallthrough
//   6. anySafeOnlyRule                             → host_mode_safe_only_rule
//   7. anyAllSeatbeltRequired || (mandatorySeatbelt && mode==="all")
//                                                  → host_mode_all_seatbelt_required
//   8. anyAll || (mode==="all")                    → host_mode_all
//   9. default                                     → host_mode_manual

// Bounded repair (CORRECTION01):
//   Before returning "host_workspace_realpath_authority" at step 3,
//   check whether ALL+mandatorySeatbelt is in force for this aggregate.
//   If yes, the per-command realpath ASK is a redundant human-approval
//   downgrade (kernel is the gate). Treat it as ALLOW-eligible for the
//   aggregate source election, but ONLY when:
//     (a) auth.mandatorySeatbelt === true
//     (b) auth.mode === "all"
//   Otherwise the existing behavior is preserved exactly.
//
//   Additionally, when (a)+(b) hold, the Seatbelt-ALL branch (step 7)
//   wins over both host_mode_safe_only_rule (step 6) AND the existing
//   host_mode_all (step 8). This makes the executor-side obligation
//   propagate for ANY aggregate that contains at least one safe-rule
//   ALLOW under ALL+mandatorySeatbelt.
```

Concretely the change is a single conditional that swaps the precedence
election in the `(a)+(b)` case:

```text
if (anyWorkspaceRealpathAuthority) {
    if (auth.mandatorySeatbelt === true && auth.mode === "all") {
        // Skip the realpath downgrade; the executor-side Seatbelt
        // obligation is the gate. Fall through to step 7.
    } else {
        return "host_workspace_realpath_authority"
    }
}
```

This is a STRICT SUPPRESSOR: in the non-(a)+(b) case the behavior is
byte-identical to the pre-fix code.

### Pre/post byte-diff verification

```text
Pre-fix:  aggregateSource([...realpathAuthority_only_when_all_AND_mandatory])
Post-fix: aggregateSource([...realpathAuthority_only_when_all_AND_mandatory])
          === "host_mode_all_seatbelt_required" (in (a)+(b))
          === "host_workspace_realpath_authority" (otherwise; unchanged)

Pre-fix:  aggregateSource([...safeRuleAuthority_only_when_all_AND_mandatory])
Post-fix: aggregateSource([...safeRuleAuthority_only_when_all_AND_mandatory])
          === "host_mode_all_seatbelt_required" (step 6 → step 7 in (a)+(b))
          === "host_mode_safe_only_rule" (otherwise; unchanged)
```

The second byte-diff (safeRule case) is necessary to honor INV-1: when
ALL+mandatorySeatbelt is in force, the executor-side obligation MUST
propagate regardless of whether the per-command source is
`host_mode_safe_only_rule` or `host_workspace_realpath_authority`.

## 6. Exit criteria

```text
GREEN:
  - T-EXACT-SHAPE passes (was failing pre-fix)
  - T1..T6 conservation pass (the bounded repair is non-widening)
  - The existing R5 implementation tests still PASS at the implementation
    head (no regression of the seatbelt-all-r5-authority-implementation01
    suite):
      * seatbelt-all-r5-authority-implementation01.c1-green.test.ts
      * seatbelt-all-r5-authority-implementation01.c2-runtime-bridge.test.ts
      * seatbelt-all-r5-authority-implementation01.q-real-kernel-confinement.test.ts
      * seatbelt-all-r5-authority-implementation01.live-producer-composer-chain.red.test.ts
      * seatbelt-all-r5-authority-implementation01.go-parser-result-red.test.ts
      * seatbelt-all-r5-authority-implementation01.active-session-immediate-next-tool-call.red.test.ts
  - The existing R0 path-authority corpus still passes:
      * command-risk-corpus.path-authority.test.ts (host_workspace_realpath_authority
        corpus entries still ASK outside the (a)+(b) intersection)
      * path-authority.realpath.test.ts
      * structured-command-risk.reader-path-authority.test.ts
  - The existing legacy R0 realpath tests still pass at the byte level
    for the non-(a)+(b) cases (no widening).

COMMITTED:
  - Single bounded commit: RED test (fail-first evidence) + repair
    + board update.

FACTORY BOARD:
  - .factory/epic-board.md updates the SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
    lane to add a `NEXT_BOUNDED_CORRECTION01` row with the RED commit
    SHA + post-fix GREEN commit SHA.
  - safe-yolo-seatbelt.md epic ledger adds a row pinning this ACT.
```

## 7. Halt conditions

```text
HALT_DENY_RULE_REGRESSION          - Any case that was host_hard_deny becomes ALLOW.
HALT_REALPATH_OUTSIDE_ROOT_BYPASS  - Outside-root operand becomes ALLOW under ALL+Seatbelt.
HALT_EVIDENCE_BUILDER_DELETION     - The evidence builder is weakened or removed.
HALT_SAFE_RULE_WIDENING            - A non-R0 family starts matching R0 path authority.
HALT_R5_FLOOR_WEAKENING            - R5 catastrophic ASK becomes ALLOW with mandatorySeatbelt absent.
HALT_V2_PROMOTION_WIDENING         - The V2 parser-proven promotion branch widens.
HALT_EXECUTOR_FALLBACK             - Executor reaches spawnSupervisableShellCommand when mandatorySeatbelt=true.
HALT_CAPABILITY_DELTA              - buildExperimentalReconCapability output byte-changes.
```

## 8. Recon anchor points (frozen)

```text
SOURCE_OF_TRUTH:          sdk/packages/core/src/runtime/command-policy/command-policy.ts
PRODUCER:                 apps/vscode/src/sdk/sdk-tool-policies.ts applySeatbeltAuthorityEnvelope (line 521)
SESSION_OVERRIDE:         apps/vscode/src/sdk/session-auto-approval.ts resolveSessionHostAuthorization (line 308)
HOST_AUTHORITY_SEAM:      apps/vscode/src/sdk/SdkController.ts resolveHostAuthorization (line 916)
                          apps/vscode/src/sdk/SdkController.ts buildPathAuthorityEvidence (line 2123)
EVIDENCE_BUILDER:         sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.ts
R5_FLOOR:                 sdk/packages/core/src/runtime/command-policy/command-risk.ts
EXECUTOR:                 apps/vscode/src/sdk/command-job-manager.ts (CommandJobManager.start)
                          sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts
                          (no changes to either)
```

## 9. Implementation verdict (frozen; awaits ACT closure)

```text
LIVE_DEFECT              = REAL / BOUND
FIRST_BROKEN_BOUNDARY    = REALPATH-AUTHORITY ↔ SEATBELT-ALL COMPOSITION (aggregateSource precedence)
WRONG_WORKSPACE_ROOT     = NOT CURRENT LEADING CAUSE
R5_REGRESSION            = NO
SESSION_ALL_PROPAGATION  = PASS
SEATBELT_ENVELOPE        = PASS
P0                       = BOUNDED_POLICY_PRECEDENCE_DEFECT

REPAIR SURFACE           = aggregateSource() in command-policy.ts
                          (single conditional; strict-suppressor shape)

CONSERVATION             = INV-1..INV-6 frozen; OOS-1..OOS-8 frozen
                          + 4-case conservation matrix + multi-command
                          composition + genuine outside-root preservation

MAX_REVIEW_CYCLE         = 1
```
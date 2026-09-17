# Final Report — ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01

## Outcome

```text
CLASS:        CASE_A — FAIL_CLOSED / NOT_VULNERABLE
VERDICT:      APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN
STOP:         YES
REPAIR:       NOT NEEDED
EPIC_DELTA:   EPIC-APPROVAL-PROTECTION row 19 (editor-tool recon
              sister); no follow-up ACT required for the
              command-policy lane.
```

## One-line answer

> Can untrusted model/tool-call metadata reduce command execution
> authority below the minimum required by ClineMM's own policy?
> **NO** (proven at the canonical real production seam).

## Evidence summary

| Evidence artifact | Location |
|-------------------|----------|
| ACT body | `.factory/acts/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01.md` |
| Entry freeze | `.factory/evidence/.../entry-freeze.txt` |
| Authority seam map | `.factory/evidence/.../authority-seam-map.md` |
| Trust model | `.factory/evidence/.../trust-model.md` |
| Discriminator | `.factory/evidence/.../discriminator.md` |
| Discriminator test | `sdk/packages/core/src/runtime/command-policy/command-policy-authority-fail-closed-recon01.test.ts` |
| Test output | `bun test`: 30 pass / 0 fail / 68 expect() calls in 193ms |
## Key findings

1. **The composition rule at `command-policy.ts:120` is monotone-only.**
   The ONLY model-driven branch in the canonical command policy
   checks `effectiveEscalation && finalKind === "allow"` and only
   raises allow→ask. There is no mirror branch that lowers.

2. **`parseCommandModelHints` cannot emit a deescalation signal.**
   The aggregator (`command-model-hints.ts:46-51`) returns
   `effectiveEscalation: true` only when at least one hint is `true`.
   False / missing / malformed hints collapse to `undefined`
   (no effect on verdict).

3. **The host-authority input is host-built.** `CommandHostAuthorization`
   is constructed by `getCommandHostAuthorization` /
   `resolveSessionHostAuthorization` / `applySeatbeltAuthorityEnvelope`,
   none of which accept model input. Model input flows only through
   `toolInput`.

4. **The session override "stripRequiresApproval" path is user-controlled,
   not model-controlled.** It only fires AFTER the user has set
   `override === "all"` — a USER_CONFIG decision, not MODEL_UNTRUSTED.
   It strips the model hint so the user's explicit ALLOW is not
   downgraded into ASK. This is "model cannot override user"; not
   "model can override harness".

5. **All failure paths fail closed.** Normalizer throws → ASK +
   unknown_input. Empty command list → ASK + unknown_input. Malformed
   `requires_approval` → no effect (collapses to undefined).

6. **Multi-command input aggregates correctly.** `aggregateLattice`
   enforces `ANY DENY → deny | ANY ASK → ask | else allow`. A compound
   `safe && dangerous` input remains ASK even when the model supplies
   `requires_approval=false`.

7. **R5 catastrophic hard floor survives model hint.** The hard floor
   runs AFTER `evaluateCommandPolicy` in `evaluateCommandToolApproval`
   and forces ALLOW → ASK on `risk_hard_floor` matches. The model
   hint cannot erase it.

## Adversarial matrix — verdicts (executed)

All 30 cases GREEN. The load-bearing cases are A3' (SAFE_ONLY,
the auto-approve / safe-command path) and A3'' (YOLO + R5 hard
floor, the explicit user opt-in). The legacy A3 (manual mode) is
a conservation witness only — MANUAL always asks regardless of
classification, so it does NOT prove the upstream #12020 surface.

### A3' load-bearing: SAFE_ONLY lane

```text
INPUT:
  toolInput        = { command: "rm -rf $HOME", requires_approval: false }
  hostAuthorization = commandHostAuthorization({
                        mode: "safe-only",
                        explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
                      })

PRODUCTION ENTRY POINT:
  evaluateCommandPolicy({ toolInput, hostAuthorization })
    [sdk/packages/core/src/runtime/command-policy/command-policy.ts:80]

OUTPUT:
  decision.kind   = "ask"
  decision.source ≠ "host_mode_safe_only_rule"
                  (positive matcher refused to match — the safe
                  rule engine does not include rm -rf $HOME in its
                  bounded allow list; "absence of danger never
                  implies ALLOW")

VERDICT:  A3' GREEN. SAFE_ONLY + R5-catastrophic + model=false
          remains ASK. The model hint cannot trick the bounded
          positive matcher into ALLOW for an unknown/destructive
          command. Upstream #12020 pattern is NOT reproducible.
```

### A3'' load-bearing: YOLO + R5 hard floor

```text
INPUT:
  toolInput        = { command: "rm -rf $HOME", requires_approval: false }
  hostAuthorization = commandHostAuthorization({ mode: "all" })

CANONICAL LATTICE (evaluateCommandPolicy):
  decision.kind   = "allow"
  decision.source = "host_mode_all"

HOST-ADAPTER CHAIN (evaluateCommandRiskWithParser at sdk-tool-policies.ts:633):
  decision       = "ask"
  disposition    = "never-auto-approve"

PRODUCTION FINAL VERDICT (sdk-tool-policies.ts:665-679):
  approved = false
  decision.source = "risk_hard_floor"

VERDICT:  A3'' GREEN. Under YOLO mode + model=false + R5-catastrophic,
          the composed host-adapter authority chain downgrades ALLOW → ASK via the R5
          hard floor. The user's YOLO opt-in cannot waive approval
          for catastrophic commands. Upstream #12020 pattern is
          NOT reproducible in ClineMM.
```

## Stop rule applied (per ACT §15)

```text
If A3' GREEN AND A3'' GREEN:
  NOT_A_CLINEMM_DEFECT
  APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN
  STOP
```

All conditions met. ACT CLOSED.

## Scope freeze (per Factory causal reviewer round 2)

```text
PROVEN:
  model-supplied requires_approval=false
  cannot waive ClineMM host-required command approval

NOT PROVEN BY THIS ACT (out of scope):
  approval identity / replay safety
  reject-then-retry correlation
  cross-command approval reuse
  (see upstream #10783 et al.)
```

The A3'' (YOLO + R5) case is a STRONGER ClineMM conservation, not
a direct #12020 reproduction (the upstream bug does not require
global YOLO). It is proven as part of the **composed proof**
(structural callsite proof in ACT §8 + functional entry-point
proof in this discriminator's §6 A3'').

## Conservation matrix (per ACT §9)

No prior verdict is weakened. No new policy engine is added.

| Prior ACT | Status before | Status after |
|-----------|---------------|--------------|
| `ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01` | CLOSED GREEN | unchanged |
| `ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-ASSISTED01` | CLOSED HALT_SHIPPING | unchanged |
| `ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01` | CLOSED STRUCTURAL | unchanged |
| `ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01` | CLOSED (P0) | unchanged |
| `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-*` | CLOSED | unchanged |
| `ACT-CLINEMM-SESSION-AUTONOMY01 + CORRECTION01 + 02` | CLOSED | unchanged |

## ClineMM is structurally immune to upstream #12020

The upstream bug pattern would require one of:

  (a) a code branch that reads `requires_approval=false` and lowers
      a verdict — does NOT exist;
  (b) a way for the model to construct `CommandHostAuthorization`
      directly — does NOT exist;
  (c) a way to bypass `aggregateLattice` or the per-command
      `evaluateOne` deny precedence — does NOT exist;
  (d) a way for the model to disable the R5 hard floor — does NOT
      exist;
  (e) a way to weaken the explicit-deny rule precedence — does NOT
      exist.

None of these exist in ClineMM. The doctrine
`effectiveDecision >= hostDecision` (ALLOW < ASK < DENY)
is enforced by source.

## Open questions / no remaining work

None. ACT scope is closed.

## Files added / modified

- `.factory/acts/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01.md` (new)
- `.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/entry-freeze.txt` (new)
- `.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/authority-seam-map.md` (new)
- `.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/trust-model.md` (new)
- `.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/discriminator.md` (new)
- `.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/final-report.md` (new — this file)
- `sdk/packages/core/src/runtime/command-policy/command-policy-authority-fail-closed-recon01.test.ts` (new — discriminator; passes 30/30)
